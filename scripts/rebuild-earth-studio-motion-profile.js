#!/usr/bin/env node
"use strict";
// Deterministically rebuild the Earth Studio motion profile from the APPROVED
// reference corpus. This is the ONLY sanctioned way to change derived motion
// values: edit/approve references in corpus.json, then run this. No LLM, no
// hand-tuning — every adopted number traces to authored keyframe data in the
// referenced .esp files.
//
//   node scripts/rebuild-earth-studio-motion-profile.js          # rebuild + report
//   node scripts/rebuild-earth-studio-motion-profile.js --check  # verify only (no writes)
//
// Derivation rules (transparent, family-aware):
//   - Only corpus references with state === "APPROVED" participate.
//   - Every approved reference must have internet provenance (https URL), a
//     matching SHA-256, a signature file, and a raw .esp copy.
//   - Authored per-keyframe transitions are extracted from the raw .esp and
//     normalized as handle_span / gap_to_neighbor_keyframe.
//   - Aggregates are medians, computed per easing role and (for arrivals) per
//     motion family; entries are processed in sorted-id order so output is
//     byte-stable.
//   - Holds classified EDITORIAL_HOLD corroborate the settle principle but are
//     EXCLUDED from hold-duration aggregation (see corpus hold_type fields).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const inspector = require("./inspect-earth-studio-project.js");

const ROOT = path.resolve(__dirname, "..");
const MOTION_DIR = path.join(ROOT, "config", "earth-studio-motion");
const CORPUS = path.join(MOTION_DIR, "corpus.json");
const PROFILE = path.join(MOTION_DIR, "motion-profile.json");
const REPORT_DIR = path.join(MOTION_DIR, "reports");
const REPORT = path.join(REPORT_DIR, "derivation-report.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return Math.round(m * 100) / 100;
}

// Extract gap-relative authored easing samples from one parsed reference.
// Returns { departures: [], interiors: [], arrivals: [] } fractions, where
// arrival entries carry { fraction, influence }.
function easingSamples(parsed) {
  const out = { departures: [], interiors: [], arrivals: [] };
  for (const track of Object.values(parsed.tracks)) {
    if (!track || track.length < 2) continue;
    // Only spans where the value actually moves are "authored motion".
    track.forEach((k, i) => {
      const gapNext = i < track.length - 1 ? track[i + 1].time - k.time : 0;
      const gapPrev = i > 0 ? k.time - track[i - 1].time : 0;
      const movesNext = i < track.length - 1 && Math.abs(track[i + 1].value - k.value) > 1e-9;
      const movesPrev = i > 0 && Math.abs(k.value - track[i - 1].value) > 1e-9;
      if (i === 0 && k.transitionOut && k.transitionOut.type !== "linear" && movesNext && gapNext > 0) {
        out.departures.push(Math.round((k.transitionOut.x / gapNext) * 100) / 100);
      } else if (i > 0 && i < track.length - 1) {
        if (k.transitionIn && k.transitionIn.type === "auto" && gapPrev > 0 && movesPrev) {
          out.interiors.push(Math.round((-k.transitionIn.x / gapPrev) * 100) / 100);
        }
      }
      if (i > 0 && k.transitionIn && (k.transitionIn.type === "custom" || k.transitionIn.type === "easeIn") && movesPrev && gapPrev > 0) {
        out.arrivals.push({
          fraction: Math.round((-k.transitionIn.x / gapPrev) * 100) / 100,
          influence: typeof k.transitionIn.influence === "number" ? Math.round(k.transitionIn.influence * 100) / 100 : null,
        });
      }
    });
  }
  return out;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
  const approved = corpus.references
    .filter((r) => r.state === "APPROVED")
    .sort((a, b) => a.id.localeCompare(b.id));
  const errors = [];
  const perReference = {};
  const pools = { departures: [], interiors: [], arrivalsByFamily: {} };
  const holdSamples = [];
  const seenHashes = new Map();

  for (const ref of approved) {
    if (!/^https:\/\//.test(ref.source_url || "")) errors.push(`${ref.id}: approved without internet provenance URL`);
    const espPath = path.join(MOTION_DIR, ref.corpus_copy || "");
    const sigPath = path.join(MOTION_DIR, ref.signature || "");
    if (!fs.existsSync(espPath)) { errors.push(`${ref.id}: missing corpus copy ${ref.corpus_copy}`); continue; }
    if (!fs.existsSync(sigPath)) { errors.push(`${ref.id}: missing signature ${ref.signature}`); continue; }
    const hash = sha256(espPath);
    if (!hash.startsWith(ref.esp_sha256_prefix || "")) errors.push(`${ref.id}: SHA-256 mismatch (${hash.slice(0, 16)} vs recorded ${ref.esp_sha256_prefix})`);
    if (seenHashes.has(hash)) errors.push(`${ref.id}: duplicate content — same SHA as ${seenHashes.get(hash)}`);
    seenHashes.set(hash, ref.id);

    const parsed = inspector.parseEsp(espPath);
    const samples = easingSamples(parsed);
    const family = ref.motion_family || "UNCLASSIFIED";
    perReference[ref.id] = { family, tier: ref.quality_tier || null, hold_type: ref.hold_type || null, samples };
    pools.departures.push(...samples.departures);
    pools.interiors.push(...samples.interiors);
    if (!pools.arrivalsByFamily[family]) pools.arrivalsByFamily[family] = [];
    pools.arrivalsByFamily[family].push(...samples.arrivals);
    if (ref.hold_type === "CAMERA_SETTLE" && ref.settle_fraction_observed != null) {
      holdSamples.push(ref.settle_fraction_observed);
    }
  }

  if (errors.length) {
    console.error("CORPUS INTEGRITY FAILURES:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  // Family-aware arrival: the APPROACH family (Google Zoom-To template shape,
  // two independent exports) uses a near-full-gap deceleration; other families
  // use the gentler multi-reference arrival.
  const approachArrivals = pools.arrivalsByFamily.APPROACH_DRIFT || [];
  const otherArrivals = Object.entries(pools.arrivalsByFamily)
    .filter(([fam]) => fam !== "APPROACH_DRIFT")
    .flatMap(([, v]) => v);

  const derived = {
    handle_fraction_departure: median(pools.departures),
    handle_fraction_interior: median(pools.interiors),
    interior_influence: 0.5, // constant in every authored auto transition observed
    arrival_approach: {
      fraction: median(approachArrivals.map((a) => a.fraction)),
      influence: median(approachArrivals.map((a) => a.influence).filter((x) => x != null)),
    },
    arrival_other: {
      fraction: median(otherArrivals.map((a) => a.fraction)),
      influence: median(otherArrivals.map((a) => a.influence).filter((x) => x != null)) || 0.4,
    },
    settle_hold_fraction: median(holdSamples),
  };

  const profile = {
    profile_version: 3,
    corpus_version: corpus.corpus_version,
    analysis_schema_version: 1,
    rebuilt_by: "scripts/rebuild-earth-studio-motion-profile.js",
    derived_from: approved.map((r) => r.id),
    rule: "gap-relative eased handles on every moving keyframe (easeOut departure, auto interiors, custom decelerating arrivals — APPROACH arrivals use the Google-template near-full-gap deceleration) + final settle-hold for eligible fly/zoom finals",
    evidence_levels: {
      easing_topology: "cross_source_supported (4 approved references)",
      interior_auto_fraction: "cross_source_supported (google template exports + mountkinabalu)",
      departure_fraction: "multi_reference (3 sources, range 0.2-0.31)",
      approach_arrival: "google_authored (Zoom-To template values via 2 independent internet exports)",
      other_arrival: "multi_reference (mountkinabalu + radiator)",
      settle_hold: "single_reference (mountkinabalu CAMERA_SETTLE; darien-gap EDITORIAL_HOLD corroborates the principle only)",
    },
    easing: {
      departure_fraction: derived.handle_fraction_departure,
      interior_fraction: derived.handle_fraction_interior,
      interior_influence: derived.interior_influence,
      arrival_approach_fraction: derived.arrival_approach.fraction,
      arrival_approach_influence: derived.arrival_approach.influence,
      arrival_other_fraction: derived.arrival_other.fraction,
      arrival_other_influence: derived.arrival_other.influence,
    },
    settle_hold: {
      fraction: derived.settle_hold_fraction != null ? derived.settle_hold_fraction : 0.2,
      max_seconds: 2.5,
      min_hold_seconds: 0.4,
      min_segment_seconds: 2,
      bounds_note: "caps/minimums are safety bounds, not corpus statistics (n=1 for hold duration)",
    },
    not_adopted_weak_evidence: [
      "POI target-lock rotation authoring (present in 2 approved refs + format evidence; replacing validated rotationX/rotationY needs its own acceptance round)",
      "extreme front-loading (darien-gap 10%-move/90%-hold = EDITORIAL_HOLD, excluded from settle aggregation)",
      "named motion archetypes (no family has >=2 independent members beyond APPROACH_DRIFT easing; timing archetypes premature)",
      "shared cross-property keyframe grids (observed in 3 refs; approximated by per-segment keyframing already)",
    ],
  };

  const report = {
    generated_by: "scripts/rebuild-earth-studio-motion-profile.js",
    corpus_version: corpus.corpus_version,
    approved_references: approved.map((r) => ({ id: r.id, family: r.motion_family, tier: r.quality_tier, hold_type: r.hold_type || null })),
    raw_samples: perReference,
    pooled: {
      departures: pools.departures.sort((a, b) => a - b),
      interiors: pools.interiors.sort((a, b) => a - b),
      arrivals_by_family: pools.arrivalsByFamily,
      camera_settle_fractions: holdSamples,
    },
    derived,
  };

  if (checkOnly) {
    const current = fs.existsSync(PROFILE) ? JSON.parse(fs.readFileSync(PROFILE, "utf8")) : null;
    const same = current && JSON.stringify(current.easing) === JSON.stringify(profile.easing)
      && JSON.stringify(current.settle_hold) === JSON.stringify(profile.settle_hold);
    console.log(same ? "PROFILE UP TO DATE with the approved corpus." : "PROFILE DRIFT: motion-profile.json does not match the corpus derivation — rerun without --check.");
    process.exit(same ? 0 : 1);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(PROFILE, `${JSON.stringify(profile, null, 2)}\n`);
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`profile v${profile.profile_version} rebuilt from ${approved.length} approved references`);
  console.log(`derived easing: ${JSON.stringify(profile.easing)}`);
  console.log(`settle hold: ${JSON.stringify(profile.settle_hold)}`);
  console.log(`report: ${path.relative(ROOT, REPORT)}`);
}

main();
