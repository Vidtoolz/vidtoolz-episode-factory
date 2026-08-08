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

// Extract gap-relative authored easing samples from one parsed reference,
// labeled by PROPERTY CLASS and SEMANTIC ROLE — unlike properties and unlike
// roles must never share a pool (audit 2026-08-08 findings 1-2):
//   property class: positional (lat/lng/pan/tilt) | altitude
//   role: departure          — first keyframe's outgoing ease into motion
//         interior           — auto eases at mid keyframes
//         interior_arrival   — easeIn/custom decelerations INTO a mid keyframe
//                              (NOT terminal; mountkinabalu authors these)
//         terminal_arrival   — the track's final keyframe's incoming ease
// Translation terminal arrivals use the reference's DOMINANT axis (the axis
// that actually moves most) — the Zoom-To template eases the dominant axis at
// ~0.99×gap while the minor axis gets a lighter handle; our writer authors
// the same handle on both axes, so the dominant sample is the honest model.
// Handles MAY legitimately exceed one keyframe gap (template altitude arrival
// = 2.5×gap) — no cap is applied.
function easingSamples(parsed) {
  const out = { departures: [], interiors: [], interior_influences: [], interior_arrivals: [], terminal_arrivals: [] };
  const classOf = (name) => (name === "altitude" ? "altitude" : "positional");
  const trackDelta = (track) => track.reduce((acc, k, i) => (i ? acc + Math.abs(k.value - track[i - 1].value) : 0), 0);
  // dominant translation axis for terminal-arrival sampling
  const latDelta = parsed.tracks.latitude ? trackDelta(parsed.tracks.latitude) : 0;
  const lonDelta = parsed.tracks.longitude ? trackDelta(parsed.tracks.longitude) : 0;
  const dominantAxis = lonDelta >= latDelta ? "longitude" : "latitude";
  for (const [name, track] of Object.entries(parsed.tracks)) {
    if (!track || track.length < 2) continue;
    const cls = classOf(name);
    track.forEach((k, i) => {
      const gapNext = i < track.length - 1 ? track[i + 1].time - k.time : 0;
      const gapPrev = i > 0 ? k.time - track[i - 1].time : 0;
      const movesNext = i < track.length - 1 && Math.abs(track[i + 1].value - k.value) > 1e-9;
      const movesPrev = i > 0 && Math.abs(k.value - track[i - 1].value) > 1e-9;
      const frac = (x, gap) => Math.round((x / gap) * 100) / 100;
      if (i === 0 && k.transitionOut && k.transitionOut.type !== "linear" && movesNext && gapNext > 0) {
        out.departures.push({ property: cls, track: name, fraction: frac(k.transitionOut.x, gapNext) });
      } else if (i > 0 && i < track.length - 1 && k.transitionIn && movesPrev && gapPrev > 0) {
        if (k.transitionIn.type === "auto") {
          out.interiors.push({ property: cls, track: name, fraction: frac(-k.transitionIn.x, gapPrev) });
          if (typeof k.transitionIn.influence === "number") {
            out.interior_influences.push(Math.round(k.transitionIn.influence * 100) / 100);
          }
        } else if (k.transitionIn.type === "custom" || k.transitionIn.type === "easeIn") {
          if (!(cls === "positional" && (name === "latitude" || name === "longitude") && name !== dominantAxis)) {
            out.interior_arrivals.push({
              property: cls, track: name, fraction: frac(-k.transitionIn.x, gapPrev),
              influence: typeof k.transitionIn.influence === "number" ? Math.round(k.transitionIn.influence * 100) / 100 : null,
            });
          }
        }
      }
      if (i === track.length - 1 && k.transitionIn && k.transitionIn.type !== "linear" && movesPrev && gapPrev > 0) {
        if (cls === "positional" && (name === "latitude" || name === "longitude") && name !== dominantAxis) return;
        out.terminal_arrivals.push({
          property: cls,
          track: name,
          fraction: frac(-k.transitionIn.x, gapPrev),
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
  const pools = {
    departures: [],
    interiors: [],
    interior_influences: [],
    interior_arrivals_by_family_property: {},
    terminal_by_family_property: {},
  };
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
    pools.departures.push(...samples.departures.map((x) => x.fraction));
    pools.interiors.push(...samples.interiors.map((x) => x.fraction));
    pools.interior_influences.push(...samples.interior_influences);
    for (const ia of samples.interior_arrivals) {
      const familyGroup = family === "APPROACH_DRIFT" ? "approach" : "other";
      const key = `${familyGroup}.${ia.property}`;
      if (!pools.interior_arrivals_by_family_property[key]) pools.interior_arrivals_by_family_property[key] = [];
      pools.interior_arrivals_by_family_property[key].push({ fraction: ia.fraction, influence: ia.influence, ref: ref.id, track: ia.track });
    }
    for (const t of samples.terminal_arrivals) {
      const familyGroup = family === "APPROACH_DRIFT" ? "approach" : "other";
      const key = `${familyGroup}.${t.property}`;
      if (!pools.terminal_by_family_property[key]) pools.terminal_by_family_property[key] = [];
      pools.terminal_by_family_property[key].push({ fraction: t.fraction, influence: t.influence, ref: ref.id, track: t.track });
    }
    if (ref.hold_type === "CAMERA_SETTLE" && ref.settle_fraction_observed != null) {
      holdSamples.push(ref.settle_fraction_observed);
    }
  }

  if (errors.length) {
    console.error("CORPUS INTEGRITY FAILURES:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  // Family × property terminal arrivals; influence falls back to the OTHER
  // pool's derived value only when a pool has no authored influences at all
  // (kinabalu's auto-typed finals carry none) — never to a magic constant.
  const arrivalPool = (key) => pools.terminal_by_family_property[key] || [];
  const arrivalStat = (key, fallbackInfluence) => {
    const pool = arrivalPool(key);
    const influences = pool.map((x) => x.influence).filter((x) => x != null);
    return {
      fraction: median(pool.map((x) => x.fraction)),
      influence: influences.length ? median(influences) : fallbackInfluence,
      sample_count: pool.length,
    };
  };
  const iaPool = (key) => pools.interior_arrivals_by_family_property[key] || [];
  const iaStat = (key) => {
    const pool = iaPool(key);
    const influences = pool.map((x) => x.influence).filter((x) => x != null);
    return { fraction: median(pool.map((x) => x.fraction)), influence: influences.length ? median(influences) : null, sample_count: pool.length };
  };
  const otherPositional = arrivalStat("other.positional", null);
  const derived = {
    departure_fraction: median(pools.departures),
    interior_fraction: median(pools.interiors),
    interior_influence: median(pools.interior_influences),
    // Segment-boundary arrivals: the Google Zoom-To template's signature
    // deceleration lands on the keyframe that ENDS the big move (an interior
    // keyframe of the track), with altitude eased far harder than position.
    segment_arrival_positional: iaStat("approach.positional"),
    segment_arrival_altitude: iaStat("approach.altitude"),
    // Track-final (terminal) arrivals: gentle multi-reference values — the
    // template itself ends its tracks LINEAR after the drift.
    terminal_arrival_positional: otherPositional,
    terminal_arrival_altitude: arrivalStat("other.altitude", otherPositional.influence),
    settle_hold_fraction: median(holdSamples),
  };

  const profile = {
    profile_version: 4,
    corpus_version: corpus.corpus_version,
    analysis_schema_version: 2,
    rebuilt_by: "scripts/rebuild-earth-studio-motion-profile.js",
    derived_from: approved.map((r) => r.id),
    rule: "gap-relative eased handles on every moving keyframe — easeOut departure, auto interiors (derived influence), custom terminal arrivals split by motion family AND property class (altitude decelerates far harder than position in the Google template) + final settle-hold for eligible fly/zoom finals",
    evidence_levels: {
      easing_topology: "cross_source_supported (4 approved references)",
      departure_fraction: "multi_reference (3 sources, range 0.2-0.31)",
      interior_fraction: "cross_source_supported (google template export + mountkinabalu + darien-gap)",
      interior_influence: "multi_reference (servyx 0.5 x6, darien-gap 0.35 x2 — derived median, no longer hardcoded)",
      segment_arrival: "google_authored (Zoom-To template dominant-axis deceleration into the move-ending INTERIOR keyframe: positional 0.99x gap, altitude 2.5x gap — handles legitimately exceed one keyframe gap; flyover easeIns at 0.31 corroborate the boundary-deceleration concept at lower magnitude)",
      terminal_arrival: "multi_reference (mountkinabalu terminal autos + radiator custom; the template itself ends tracks LINEAR after its drift)",
      settle_hold: "single_reference (mountkinabalu CAMERA_SETTLE; darien-gap EDITORIAL_HOLD corroborates the principle only)",
    },
    easing: {
      departure_fraction: derived.departure_fraction,
      interior_fraction: derived.interior_fraction,
      interior_influence: derived.interior_influence,
      segment_arrival: {
        positional: { fraction: derived.segment_arrival_positional.fraction, influence: derived.segment_arrival_positional.influence },
        altitude: { fraction: derived.segment_arrival_altitude.fraction, influence: derived.segment_arrival_altitude.influence },
      },
      terminal_arrival: {
        positional: { fraction: derived.terminal_arrival_positional.fraction, influence: derived.terminal_arrival_positional.influence },
        altitude: { fraction: derived.terminal_arrival_altitude.fraction, influence: derived.terminal_arrival_altitude.influence },
      },
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
      "named motion archetypes (no family has >=2 independent members; timing archetypes premature)",
      "interior_arrival easeIns as a distinct authored role (mountkinabalu mid-keyframe decelerations, n=1 reference — tracked separately in the report, not adopted as a production role)",
      "shared cross-property keyframe grids (observed in 3 refs; approximated by per-segment keyframing already)",
    ],
  };

  const report = {
    generated_by: "scripts/rebuild-earth-studio-motion-profile.js",
    corpus_version: corpus.corpus_version,
    approved_references: approved.map((r) => ({ id: r.id, family: r.motion_family, tier: r.quality_tier, hold_type: r.hold_type || null })),
    raw_samples: perReference,
    pooled: {
      departures: [...pools.departures].sort((a, b) => a - b),
      interiors: [...pools.interiors].sort((a, b) => a - b),
      interior_influences: [...pools.interior_influences].sort((a, b) => a - b),
      interior_arrivals_by_family_property: pools.interior_arrivals_by_family_property,
      terminal_arrivals_by_family_property: pools.terminal_by_family_property,
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
