(function earthStudioJourney(globalScope) {
  "use strict";

  // ───────────────────────────────────────────────────────────────────────────
  // Earth Studio CAMERA JOURNEY model (journey_version 1)
  //
  // This module is a GUI-facing ABSTRACTION over the proven generator. It owns
  // no Earth Studio semantics of its own: every journey compiles down to the
  // planner's five validated primitives (fly_to / hover / orbit / zoom_in /
  // zoom_out) expressed in the planner's own description grammar, and the
  // existing keyframe engine, easing profile and .esp serializer then run
  // completely unchanged. Nothing here invents an Earth Studio capability.
  //
  //   journey (this module)
  //     -> canonical description string (planner grammar)
  //     -> planner.parseDescription / buildShotPlan   [proven, byte-frozen]
  //     -> buildEsp                                   [proven, import-verified]
  //
  // Because the compile target is the description grammar, every compile is
  // VERIFIED by re-parsing it and checking each segment against the intent
  // (see verifyCompilation) — a silent grammar drift becomes a loud error
  // rather than a wrong animation.
  //
  // DIRECT JOURNEY IR (structured path, shadow-only until activated): the same
  // compiled steps can be handed to the planner as SEGMENT SPECS instead of
  // English, skipping splitSegments/extractSegmentSpec while every semantic
  // rule still runs in the planner's shared assembleSegment / lookaheads /
  // plan literal (one semantic authority, two input channels):
  //
  //   journey -> compileJourney -> steps -> segment specs
  //           -> planner.buildParsedFromSegmentSpecs -> buildShotPlanFromParsed
  //
  // The generated description is still recorded in the plan as provenance
  // (`source_description`, per-segment `source_text`) — produced, not parsed.
  // Equivalence with the text path is asserted byte-for-byte over the tracked
  // journey canaries in tests/earth-studio-path-equivalence.test.js.
  // ───────────────────────────────────────────────────────────────────────────

  // Strict numeric coercion: null / undefined / "" mean ABSENT, not zero.
  // (Number(null) === 0, which would silently turn "no override" into 0 m.)
  function numOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Invalidity evidence. Normalization is deliberately tolerant (it must never
  // throw on junk), but tolerance must not become authority: whenever a value
  // that WAS present is discarded by coercion — a non-numeric number, an unknown
  // enum, a non-list where a list belongs — the original is kept on the
  // normalized record under `invalid_fields` and carried across repeated
  // normalization, so validation can refuse it regardless of call order.
  // Valid input never produces this field, so canonical output is unchanged.
  const wasGiven = (v) => !(v === undefined || v === null || v === "");
  // Non-finite numbers cannot survive JSON (they become null = "absent"), so
  // the evidence is stored as text ("NaN", "Infinity") — still non-numeric to
  // the validator, but durable across serialization.
  const evidenceValue = (v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v);
  function carryInvalid(target, src, rejected) {
    const carried = src && typeof src === "object" && src.invalid_fields && typeof src.invalid_fields === "object" ? src.invalid_fields : null;
    const merged = { ...(carried || {}), ...rejected };
    if (Object.keys(merged).length) target.invalid_fields = merged;
    return target;
  }

  const JOURNEY_VERSION = 1;
  const CONTINUATION_STATE_VERSION = 1;

  function loadPlanner(injected) {
    if (injected) return injected;
    if (globalScope && globalScope.EarthStudioJobPlanner) return globalScope.EarthStudioJobPlanner;
    if (typeof require === "function") return require("./earth-studio-job-planner.js");
    throw new Error("earth-studio-journey: planner module unavailable");
  }

  // ── Framing: geographic scale -> camera distance ──────────────────────────
  // The camera altitude needed to fit a ground span S in frame, for a camera
  // tilted `tilt` degrees from straight-down, is a plain optical identity:
  //
  //   visible span at the subject = 2 * slantRange * tan(FOV/2)
  //   slantRange                  = altitude / cos(tilt)
  //   => altitude = S * cos(tilt) / (2 * tan(FOV/2))
  //
  // FOV is Earth Studio's documented default (planner.EARTH_STUDIO_DEFAULT_FOV_DEG
  // = 20 deg); our .esp never keyframes `fov`, so that default genuinely holds
  // for every frame we generate. The law is CROSS-CHECKED against the verified
  // gazetteer: the calibrated Eiffel Tower altitude (1000 m) is what this
  // formula returns for a 500 m landmark span at the default 45 deg tilt
  // (1002 m) — i.e. the existing hand-validated framing and this derivation
  // agree at the landmark end of the range.
  //
  // `span_m` is the ground width the frame should cover, breathing room already
  // included (a subject is framed with margin, not edge-to-edge).
  const FRAMING_SCALES = {
    landmark: { key: "landmark", label: "Landmark / building", span_m: 500, blurb: "Very close — a single building or monument fills the frame." },
    neighborhood: { key: "neighborhood", label: "Neighborhood", span_m: 2500, blurb: "Close — a few streets and blocks." },
    district: { key: "district", label: "District", span_m: 8000, blurb: "Medium-close — a downtown or island district." },
    city: { key: "city", label: "City", span_m: 12000, blurb: "Medium-close — the city's core and centre." },
    metro: { key: "metro", label: "Metropolitan area", span_m: 55000, blurb: "Medium — city plus its suburbs and surroundings." },
    region: { key: "region", label: "Region", span_m: 350000, blurb: "Wider — a province, mountain range, or sea." },
    country: { key: "country", label: "Country", span_m: 1300000, blurb: "Wide — a whole country in frame." },
    subcontinent: { key: "subcontinent", label: "Sub-continental area", span_m: 2500000, blurb: "Very wide — a large sea or group of countries." },
    continent: { key: "continent", label: "Continent", span_m: 5000000, blurb: "Very wide — a whole continent." },
    // The whole globe is just another span: Earth's diameter. Deriving it with
    // the same law is what actually fits the planet inside the frame — the
    // planner's flat SPACE_ALTITUDE_M (12,000 km) leaves the Earth overflowing
    // the 20 deg frame, which is not a "whole globe" shot.
    globe: { key: "globe", label: "Whole globe", span_m: 12742000, blurb: "From space — the whole planet in frame." },
  };
  // Wide -> close, so "one step closer / wider" is well defined.
  const SCALE_LADDER = ["landmark", "neighborhood", "district", "city", "metro", "region", "country", "subcontinent", "continent", "globe"];

  // Fixtures whose scale class is not a plain city and which carry no `scale`
  // field in the planner's gazetteer (that field is only on the entries added
  // with the large-area geography; adding keys to pre-existing fixture objects
  // would change byte-frozen shot-plan.json output, so those classifications
  // live here instead).
  const SCALE_OVERRIDES = {
    "midtown manhattan": "district",
    "lower manhattan": "district",
    "downtown boston": "district",
    "manhattan": "district",
    "bali": "region",
    "santorini": "district",
    "lofoten": "region",
    "galapagos": "region",
    "great barrier reef": "region",
    "grand canyon": "region",
    "yellowstone": "region",
    "yosemite": "region",
    "banff": "region",
    "monument valley": "region",
    "torres del paine": "region",
    "the great wall of china": "region",
    "great wall of china": "region",
    "geirangerfjord": "district",
    "central park": "neighborhood",
    "palm jumeirah": "neighborhood",
  };
  // Word cues for a place the gazetteer does not know (free text or an explicit
  // coordinate pair). Ordered: first match wins.
  const SCALE_KEYWORDS = [
    [/\b(continent)\b/i, "continent"],
    [/\b(ocean)\b/i, "continent"],
    [/\b(sea|gulf|strait|archipelago|desert|rainforest|steppe|tundra)\b/i, "region"],
    [/\b(country|republic|kingdom|federation)\b/i, "country"],
    [/\b(province|county|region|highlands|mountains|range|alps|valley|coast|riviera|lakeland|fjords)\b/i, "region"],
    [/\b(metro|metropolitan|greater)\b/i, "metro"],
    [/\b(downtown|district|quarter|old town|city cent(?:re|er)|waterfront|harbou?r|island)\b/i, "district"],
    [/\b(neighbou?rhood|park|campus|zoo|stadium|airport|port|marina|beach)\b/i, "neighborhood"],
    [/\b(tower|cathedral|church|temple|mosque|palace|castle|bridge|square|monument|statue|museum|theat(?:re|er)|arena|lighthouse|fort|ruins|building|skyscraper|hotel|station)\b/i, "landmark"],
    [/\b(city|town|village)\b/i, "city"],
  ];

  function scaleOf(key) { return FRAMING_SCALES[key] || null; }

  // ── Target-framing tilt limit (real-import finding, 2026-08-19) ────────────
  // The generator positions a fly / hover / zoom camera at the TARGET'S OWN
  // coordinates and then tilts it. The target therefore sits at nadir while the
  // view axis points `tilt` degrees away from nadir, so the target's angular
  // distance from frame centre IS the tilt. With Earth Studio's 20 deg FOV the
  // frame only reaches FOV/2 = 10 deg from its centre, so any tilt beyond that
  // pushes the requested place completely out of shot. Real imports confirmed
  // this exactly: at tilt 60 the target measured 4.9 half-frames off centre
  // (sin(60)/tan(10) = 4.9), a Stockholm descent showed open sea, and country /
  // continent framing rendered as horizon-only or fully black.
  //
  // An ORBIT is exempt and needs no cap: the engine offsets the camera onto a
  // ring of radius altitude*tan(tilt) and points it back at the centre, so the
  // target is dead-centre at any tilt (verified in the same import round).
  //
  // marginFraction is how much of the frame half-height the target is allowed to
  // sit away from centre. This is the LIMIT used to validate an operator's own
  // tilt; a DERIVED tilt goes further and uses TARGET_FRAMING_TILT_DEG below.
  const TARGET_FRAMING_MARGIN_FRACTION = 0.6;

  // The derived tilt for a movement that must frame its target. A camera above
  // the target sees it `tilt` degrees off the view axis, so ONLY a top-down
  // camera puts the requested place in the middle of the shot — which is exactly
  // what the framing law computes a span for. Round 2 of the real-import gate
  // showed the difference plainly: at the 6.07 deg limit Finland was in frame but
  // pushed 60% toward the bottom edge with Arctic ocean filling the top half;
  // top-down centres it. Oblique, cinematic looks come from orbits and from the
  // ring entry into an orbit, both of which point the camera AT the target and
  // are visually accepted at their full tilt.
  const TARGET_FRAMING_TILT_DEG = 0;
  function maxTargetFramingTiltDeg(options = {}) {
    const planner = loadPlanner(options.planner);
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const margin = Number.isFinite(options.marginFraction) ? options.marginFraction : TARGET_FRAMING_MARGIN_FRACTION;
    const rad = (d) => (d * Math.PI) / 180;
    const sin = Math.min(1, margin * Math.tan(rad(fov / 2)));
    return Math.round(((Math.asin(sin) * 180) / Math.PI) * 100) / 100;
  }

  // The generator caps how far an orbit's camera may sit from the target
  // (orbitRadiusMeters). Beyond that cap the camera can no longer be placed at
  // the look-at offset the tilt implies, so the orbit stops facing its target and
  // the shot degenerates to sky. Read the cap from the planner's own law instead
  // of duplicating the constant.
  function orbitRingCapM(planner) {
    return planner.orbitRadiusMeters(1e12, 45);
  }

  // Can an orbit at this altitude/tilt actually be placed on a ring that faces
  // its target? Real import (canary H): "Slow Orbit" around Finland needed a
  // 3,192 km ring, got the 80 km cap, and rendered as a near-black frame with
  // only the Earth's limb at the bottom edge.
  function orbitCanFaceTarget(altitudeM, tiltDeg, options = {}) {
    const planner = loadPlanner(options.planner);
    const rad = (d) => (d * Math.PI) / 180;
    const needed = Math.abs(Number(altitudeM)) * Math.tan(rad(Math.min(89.9, Math.abs(tiltDeg))));
    return needed <= orbitRingCapM(planner) + 1;
  }

  // How far off frame centre a nadir target sits, in half-frames, for a camera
  // directly above it at `tilt`. > 1 means the target is outside the frame.
  function targetOffsetHalfFrames(tiltDeg, options = {}) {
    const planner = loadPlanner(options.planner);
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const rad = (d) => (d * Math.PI) / 180;
    return Math.sin(rad(Math.min(89.9, Math.abs(tiltDeg)))) / Math.tan(rad(fov / 2));
  }

  // Inverse of framingAltitudeM at the reference tilt: the ground span an
  // altitude puts in frame.
  const REFERENCE_TILT_DEG = 45;
  function spanForAltitudeM(altitudeM, options = {}) {
    const planner = loadPlanner(options.planner);
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const rad = (d) => (d * Math.PI) / 180;
    const tilt = Number.isFinite(options.tiltDeg) ? options.tiltDeg : REFERENCE_TILT_DEG;
    return (2 * (Number(altitudeM) / Math.cos(rad(tilt)))) * Math.tan(rad(fov / 2));
  }

  // The ladder scale whose nominal span is closest (in log space, since the
  // ladder is geometric) to a given span.
  function scaleForSpanM(spanM) {
    const candidates = SCALE_LADDER.filter((k) => Number.isFinite(FRAMING_SCALES[k].span_m));
    let best = candidates[0];
    let bestErr = Infinity;
    candidates.forEach((k) => {
      const err = Math.abs(Math.log(FRAMING_SCALES[k].span_m) - Math.log(Math.max(1, spanM)));
      if (err < bestErr) { bestErr = err; best = k; }
    });
    return best;
  }

  // Classify a place's geographic scale. Returns { scale, source }.
  function classifyScale(resolved, rawName) {
    const name = String(rawName == null ? "" : rawName).trim();
    const norm = name.toLowerCase().replace(/^the\s+/, "").trim();
    if (resolved && resolved.scale && FRAMING_SCALES[resolved.scale]) {
      return { scale: resolved.scale, source: "gazetteer_scale" };
    }
    const resolvedNorm = resolved && resolved.name ? resolved.name.toLowerCase() : "";
    for (const candidate of [resolvedNorm, resolvedNorm.replace(/^the\s+/, ""), norm, name.toLowerCase()]) {
      if (candidate && SCALE_OVERRIDES[candidate]) return { scale: SCALE_OVERRIDES[candidate], source: "classified_override" };
    }
    // A gazetteer-calibrated altitude means the framing for this place was
    // hand-validated. Name its scale by inverting the framing law — what ground
    // span does that altitude actually put in frame? — so the label describes
    // what the operator will see.
    if (resolved && Number.isFinite(resolved.altitude_m)) {
      return { scale: scaleForSpanM(spanForAltitudeM(resolved.altitude_m)), source: "calibrated_altitude" };
    }
    for (const [pattern, scale] of SCALE_KEYWORDS) {
      if (pattern.test(name)) return { scale, source: "classified_keyword" };
    }
    // An explicit coordinate pair carries no scale information at all — say so,
    // so the GUI can prompt for a framing choice instead of quietly assuming.
    if (resolved && resolved.source === "explicit_coordinates") {
      return { scale: "city", source: "assumed_coordinates" };
    }
    if (resolved) return { scale: "city", source: "gazetteer_default_city" };
    return { scale: "city", source: "assumed_city" };
  }

  function stepScale(scaleKey, steps) {
    const i = SCALE_LADDER.indexOf(scaleKey);
    if (i < 0) return scaleKey;
    return SCALE_LADDER[Math.min(SCALE_LADDER.length - 1, Math.max(0, i + steps))];
  }

  // altitude = span * cos(tilt) / (2 * tan(FOV/2)), floored by the place's
  // terrain minimum and clamped to Earth Studio's altitude range.
  function framingAltitudeM(scaleKey, tiltDeg, options = {}) {
    const planner = loadPlanner(options.planner);
    const scale = scaleOf(scaleKey) || FRAMING_SCALES.city;
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const tilt = Math.min(80, Math.max(0, Number.isFinite(tiltDeg) ? tiltDeg : 45));
    const rad = (d) => (d * Math.PI) / 180;
    const spanM = Number.isFinite(options.spanM) && options.spanM > 0 ? options.spanM : scale.span_m;
    const raw = (spanM * Math.cos(rad(tilt))) / (2 * Math.tan(rad(fov / 2)));
    const floor = Math.max(planner.MIN_ALTITUDE_M, options.minAltitudeM || 0);
    return Math.round(Math.min(planner.MAX_ALTITUDE_M, Math.max(floor, raw)));
  }

  // ── Readability of a crossing (operator directive 2026-08-19) ──────────────
  // "Moving long distances close to the ground is not recommended by default —
  // the image changes so quickly one cannot understand the locations."
  //
  // The measurable quantity is how much of the FRAME the ground traverses per
  // second: groundSpeed / frameWidth, in frame-widths per second. Measured
  // against the operator's own verdicts on real playback: everything accepted sat
  // at or below 0.80 fw/s (a 396 km leg at 156 km altitude; a 4 km leg at 1 km),
  // and everything reported unreadable was 3.29 fw/s or worse (up to 21.8 fw/s
  // for 8,873 km flown at 34 km altitude). The limit therefore sits between the
  // two, at 1.0.
  const READABLE_SCREEN_SPEED_FW_PER_S = 1.0;

  function frameWidthMeters(altitudeM, tiltDeg, options = {}) {
    const planner = loadPlanner(options.planner);
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const rad = (d) => (d * Math.PI) / 180;
    const tilt = Math.min(85, Math.max(0, Number.isFinite(tiltDeg) ? tiltDeg : 0));
    return 2 * (Math.abs(Number(altitudeM)) / Math.cos(rad(tilt))) * Math.tan(rad(fov / 2));
  }

  // How many frame-widths of ground sweep past per second on this crossing.
  function screenSpeedFrameWidths(distanceM, durationS, altitudeM, tiltDeg, options = {}) {
    const d = Number(distanceM);
    const t = Number(durationS);
    if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0 || d <= 0) return 0;
    const w = frameWidthMeters(altitudeM, tiltDeg, options);
    if (!(w > 0)) return Infinity;
    return (d / t) / w;
  }

  // The lowest altitude at which a crossing still reads.
  function readableTransitAltitudeM(distanceM, durationS, tiltDeg, options = {}) {
    const planner = loadPlanner(options.planner);
    const d = Number(distanceM);
    const t = Number(durationS);
    if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0 || d <= 0) return 0;
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const rad = (deg) => (deg * Math.PI) / 180;
    const limit = Number.isFinite(options.limit) ? options.limit : READABLE_SCREEN_SPEED_FW_PER_S;
    const tilt = Math.min(85, Math.max(0, Number.isFinite(tiltDeg) ? tiltDeg : 0));
    // groundSpeed / (2*(alt/cos t)*tan(fov/2)) <= limit
    const alt = (d / t) * Math.cos(rad(tilt)) / (2 * Math.tan(rad(fov / 2)) * limit);
    return Math.round(Math.min(planner.SPACE_ALTITUDE_M, Math.max(planner.MIN_ALTITUDE_M, alt)));
  }

  // Cruising altitude for a crossing. Driven by LEGIBILITY, not by spectacle:
  // climb exactly as high as the ground needs to be readable (with headroom), and
  // no higher. Framing the entire route is the ceiling, not the target — route
  // framing for a 396 km leg is 1,122 km up, which shows all of Scandinavia and
  // loses the cities the leg is actually about, while ~190 km reads fine.
  const TRANSIT_LEGIBILITY_HEADROOM = 1.5;
  // Below this relative margin a "climb" has not actually climbed (mirrors the
  // camera-quality gate's DEAD_MOVE_DEGENERATE_FRACTION).
  const DEAD_CLIMB_FRACTION = 0.005;
  function transitAltitudeM(distanceM, tiltDeg, floorM, options = {}) {
    const planner = loadPlanner(options.planner);
    if (!Number.isFinite(distanceM) || distanceM <= 0) return Math.round(Math.max(floorM || 0, planner.DEFAULT_ALTITUDE_M));
    const fov = options.fovDeg || planner.EARTH_STUDIO_DEFAULT_FOV_DEG;
    const rad = (d) => (d * Math.PI) / 180;
    const tilt = Math.min(80, Math.max(0, Number.isFinite(tiltDeg) ? tiltDeg : 45));
    // Upper bound: the altitude that frames the whole route.
    const routeFraming = (distanceM * Math.cos(rad(tilt))) / (2 * Math.tan(rad(fov / 2)));
    // Target: legible at the generator's own baseline duration for this distance
    // (the real duration is only ever longer once pace is applied, so this is the
    // conservative reading), plus headroom.
    const seconds = planner.defaultDuration("fly_to", { distanceM });
    const legible = readableTransitAltitudeM(distanceM, seconds, tilt, { planner, fovDeg: fov })
      * TRANSIT_LEGIBILITY_HEADROOM;
    const target = Math.min(routeFraming, legible);
    return Math.round(Math.min(planner.SPACE_ALTITUDE_M, Math.max(floorM || 0, target)));
  }

  // ── Movement catalogue ────────────────────────────────────────────────────
  // `slot`: "at" = a movement performed AT a location (start or destination);
  //         "travel" = a movement that forms part of getting from A to B.
  // `primitive`: the planner action every step of this type compiles into.
  // Everything here is one of the five proven actions; the only compositions
  // are multi-step travel presets, which are ordinary ordered step lists.
  const MOVEMENTS = {
    hold: {
      key: "hold", slot: "at", primitive: "hover", label: "Hold", icon: "■",
      blurb: "No camera movement — the shot sits still and lets the viewer read the place.",
      suggested: [3, 6], holdsCamera: true,
    },
    slow_orbit: {
      key: "slow_orbit", slot: "at", primitive: "orbit", label: "Slow Orbit", icon: "↻",
      blurb: "Calmly circle the location once. The signature establishing move.",
      suggested: [10, 22], revolutions: 1, paceStretch: 1.35, orientable: true,
    },
    orbit: {
      key: "orbit", slot: "at", primitive: "orbit", label: "Orbit", icon: "↻",
      blurb: "Circle the location once at a normal pace.",
      suggested: [8, 16], revolutions: 1, orientable: true,
    },
    orbit_twice: {
      key: "orbit_twice", slot: "at", primitive: "orbit", label: "Double Orbit", icon: "↻↻",
      blurb: "Two full circles — for a hero shot you want to sit on.",
      suggested: [18, 36], revolutions: 2, orientable: true,
    },
    half_orbit: {
      key: "half_orbit", slot: "at", primitive: "orbit", label: "Half Orbit", icon: "⤾",
      blurb: "Swing halfway around the location, ending on the opposite side.",
      suggested: [5, 11], revolutions: 0.5, orientable: true,
    },
    zoom_in: {
      key: "zoom_in", slot: "at", primitive: "zoom_in", label: "Push In", icon: "⤓",
      blurb: "Move closer, tightening onto the subject.",
      suggested: [4, 9], scaleShift: -1,
    },
    zoom_out: {
      key: "zoom_out", slot: "at", primitive: "zoom_out", label: "Pull Back", icon: "⤒",
      blurb: "Move away, opening the shot up.",
      suggested: [4, 9], scaleShift: +1,
    },
    reveal: {
      key: "reveal", slot: "at", primitive: "zoom_out", label: "Reveal", icon: "◈",
      blurb: "Pull back two steps to reveal where this place sits in the world.",
      suggested: [6, 13], scaleShift: +2,
    },
    spiral_in: {
      key: "spiral_in", slot: "at", primitive: "orbit", label: "Spiral In", icon: "◉",
      blurb: "Circle the location while moving closer — orbit and descent at once.",
      suggested: [12, 24], revolutions: 1, scaleShift: -1, orientable: true,
    },
    spiral_out: {
      key: "spiral_out", slot: "at", primitive: "orbit", label: "Spiral Out", icon: "◎",
      blurb: "Circle the location while pulling away — orbit and ascent at once.",
      suggested: [12, 24], revolutions: 1, scaleShift: +1, orientable: true,
    },
    // ── travel slot ──
    fly: {
      key: "fly", slot: "travel", primitive: "fly_to", label: "Fly To", icon: "→",
      blurb: "Travel straight to the next location. Long flights automatically arc up and back down.",
      suggested: null, travelsToDestination: true,
    },
    cruise: {
      key: "cruise", slot: "travel", primitive: "fly_to", label: "Cruise", icon: "→",
      blurb: "Travel to the next location keeping the altitude you are already at.",
      suggested: null, travelsToDestination: true, holdAltitude: true,
    },
    fly_high: {
      key: "fly_high", slot: "travel", primitive: "fly_to", label: "Fly High", icon: "⇗",
      blurb: "Travel at an altitude high enough to see both ends of the journey.",
      suggested: null, travelsToDestination: true, useTransitAltitude: true,
    },
    fly_low: {
      key: "fly_low", slot: "travel", primitive: "fly_to", label: "Low Approach", icon: "⇘",
      blurb: "Come in low and tilted toward the horizon, like an aircraft on approach.",
      suggested: null, travelsToDestination: true, scaleShift: -1, tiltDeg: 72,
    },
    pull_back: {
      key: "pull_back", slot: "travel", primitive: "zoom_out", label: "Pull Back", icon: "⤒",
      blurb: "Rise away from where you are before setting off.",
      suggested: [3, 7], scaleShift: +1,
    },
    climb_to_transit: {
      key: "climb_to_transit", slot: "travel", primitive: "zoom_out", label: "Climb Out", icon: "⇑",
      blurb: "Climb to travelling altitude — high enough to see the whole route.",
      suggested: [4, 9], useTransitAltitude: true,
    },
    descend: {
      key: "descend", slot: "travel", primitive: "zoom_in", label: "Descend", icon: "⤓",
      blurb: "Drop smoothly into the destination's framing.",
      suggested: [4, 10], atDestination: true,
    },
    pause: {
      key: "pause", slot: "travel", primitive: "hover", label: "Pause", icon: "■",
      blurb: "Hold still for a beat mid-journey.",
      suggested: [2, 4], holdsCamera: true,
    },
  };

  const AT_MOVEMENT_KEYS = Object.keys(MOVEMENTS).filter((k) => MOVEMENTS[k].slot === "at");
  const TRAVEL_MOVEMENT_KEYS = Object.keys(MOVEMENTS).filter((k) => MOVEMENTS[k].slot === "travel");

  // Named travel styles: each one just POPULATES the travel step list, so
  // "+ add movement" and a preset produce the same kind of data.
  const TRAVEL_STYLES = {
    direct: {
      key: "direct", label: "Direct Fly-To", icon: "→",
      blurb: "One smooth flight from here to there. Long flights arc up and back down on their own.",
      steps: ["fly"],
    },
    cinematic: {
      key: "cinematic", label: "Cinematic", icon: "⤒→⤓",
      blurb: "Pull back from where you are, travel high, then descend into the destination.",
      steps: ["pull_back", "cruise", "descend"],
    },
    high_transit: {
      key: "high_transit", label: "High Transit", icon: "⇑→",
      blurb: "Climb to an altitude that shows the whole route, then cross to the destination.",
      steps: ["climb_to_transit", "fly"],
    },
    low_approach: {
      key: "low_approach", label: "Low Approach", icon: "⇘",
      blurb: "Stay low and tilted toward the horizon all the way in.",
      steps: ["fly_low"],
    },
    custom: { key: "custom", label: "Custom", icon: "✎", blurb: "Build the travel out of individual movements.", steps: ["fly"] },
  };

  // ── Pacing ────────────────────────────────────────────────────────────────
  // Baseline durations come from planner.defaultDuration(), the magnitude-scaled
  // law that real Earth Studio playback validated across acceptance rounds 2-4
  // (flight time by ground distance, orbit seconds per revolution stretched by
  // tan(tilt) for camera proximity, zooms on a log altitude ratio). A pace
  // preset scales that baseline; it never replaces it. CALM is the default.
  const PACE_PRESETS = {
    calm: { key: "calm", label: "Calm", factor: 1.35, low: 1.15, high: 1.6, blurb: "Deliberate and cinematic. The default." },
    relaxed: { key: "relaxed", label: "Relaxed", factor: 1.15, low: 1.0, high: 1.35, blurb: "A little tighter, still unhurried." },
    standard: { key: "standard", label: "Standard", factor: 1.0, low: 0.9, high: 1.15, blurb: "The generator's validated baseline pacing." },
    quick: { key: "quick", label: "Quick", factor: 0.8, low: 0.7, high: 0.95, blurb: "Faster cuts. Watch for movement that reads as frantic." },
  };
  const DEFAULT_PACE = "calm";

  function paceOf(key) { return PACE_PRESETS[key] || PACE_PRESETS[DEFAULT_PACE]; }

  // ── Presets ───────────────────────────────────────────────────────────────
  const JOURNEY_PRESETS = {
    establish: {
      key: "establish", label: "Establish Location",
      blurb: "Approach a place, settle, then orbit it slowly. One location, no travel.",
      build: (a) => ({ start: a[0] || "Helsinki", startMovements: ["slow_orbit"], legs: [] }),
    },
    city_to_city: {
      key: "city_to_city", label: "City to City",
      blurb: "Establish A, pull back, fly across, descend, establish B.",
      build: (a) => ({
        start: a[0] || "Helsinki", startMovements: ["slow_orbit"],
        legs: [{ destination: a[1] || "Stockholm", travelStyle: "cinematic", movements: ["slow_orbit"] }],
      }),
    },
    location_reveal: {
      key: "location_reveal", label: "Location Reveal",
      blurb: "Start wide, come in close, settle. Shows where a place sits in the world.",
      build: (a) => ({
        start: a[0] || "Suomenlinna", startFraming: "region", startMovements: ["hold"],
        legs: [{ destination: a[0] || "Suomenlinna", travelStyle: "low_approach", movements: ["hold"] }],
      }),
    },
    orbit_and_depart: {
      key: "orbit_and_depart", label: "Orbit and Depart",
      blurb: "Circle the first location, then travel on to the second.",
      build: (a) => ({
        start: a[0] || "Helsinki", startMovements: ["orbit"],
        legs: [{ destination: a[1] || "Stockholm", travelStyle: "direct", movements: ["hold"] }],
      }),
    },
    multi_city: {
      key: "multi_city", label: "Multi-City Journey",
      blurb: "Four stops, each established with a slow orbit.",
      build: (a) => ({
        start: a[0] || "Helsinki", startMovements: ["slow_orbit"],
        legs: [a[1] || "Stockholm", a[2] || "Copenhagen", a[3] || "Berlin"].map((d) => ({
          destination: d, travelStyle: "cinematic", movements: ["slow_orbit"],
        })),
      }),
    },
  };

  function applyPreset(key, places = [], base = {}) {
    const preset = JOURNEY_PRESETS[key];
    if (!preset) throw new Error(`unknown journey preset "${key}"`);
    const shape = preset.build(places);
    const mkSteps = (keys, slot) => (keys || []).map((k) => newStep(k, slot));
    return normalizeJourney({
      ...base,
      preset: key,
      start: { location: shape.start, framing: shape.startFraming || "auto" },
      start_movements: mkSteps(shape.startMovements, "at"),
      legs: (shape.legs || []).map((leg) => ({
        destination: { location: leg.destination, framing: leg.framing || "auto" },
        travel_style: leg.travelStyle || "direct",
        travel: mkSteps((TRAVEL_STYLES[leg.travelStyle] || TRAVEL_STYLES.direct).steps, "travel"),
        movements: mkSteps(leg.movements, "at"),
      })),
    });
  }

  // ── Journey normalization (schema v1 + migration) ─────────────────────────
  let stepCounter = 0;
  function newStep(type, slot, extra = {}) {
    stepCounter += 1;
    const def = MOVEMENTS[type];
    return {
      id: `s${stepCounter}`,
      type: def ? type : (slot === "travel" ? "fly" : "hold"),
      duration_seconds: null,   // null = use the suggested (paced) duration
      pace: null,               // null = inherit the journey pace
      emphasis: null,           // directorial dwell multiplier over the paced suggestion
      direction: 1,             // orbit only: 1 = clockwise, -1 = counterclockwise
      altitude_m: null,         // manual override
      tilt_deg: null,           // manual override
      framing: null,            // manual framing scale for this step's target
      ...extra,
    };
  }

  function normalizeStep(raw, slot) {
    const src = raw && typeof raw === "object" ? raw : { type: raw };
    const def = MOVEMENTS[src.type];
    const valid = def && def.slot === slot;
    const step = newStep(valid ? src.type : undefined, slot);
    if (src.id) step.id = String(src.id);
    step.duration_seconds = numOrNull(src.duration_seconds);
    step.pace = PACE_PRESETS[src.pace] ? src.pace : null;
    // Narrative emphasis (the Director's dwell multiplier). The physical,
    // playback-validated duration law stays the baseline; this only scales it.
    step.emphasis = numOrNull(src.emphasis);
    step.direction = Number(src.direction) === -1 ? -1 : 1;
    step.altitude_m = numOrNull(src.altitude_m);
    step.tilt_deg = numOrNull(src.tilt_deg);
    step.revolutions = numOrNull(src.revolutions);
    step.framing = FRAMING_SCALES[src.framing] ? src.framing : null;
    // Invalidity EVIDENCE is preserved, never erased: an unknown / wrong-slot /
    // missing type still normalizes to a safe default (this function must never
    // throw — see "normalizing junk yields a safe journey"), but the original
    // identity rides along as `unsupported_type` ("" = no type given) and is
    // carried across repeated normalization, so validation sees it whichever
    // order a caller uses. Enforcement lives in validateJourneyInput.
    if (!valid) step.unsupported_type = src.type == null ? "" : String(src.type);
    else if (src.unsupported_type !== undefined && src.unsupported_type !== null) step.unsupported_type = String(src.unsupported_type);
    const rejected = {};
    ["duration_seconds", "emphasis", "altitude_m", "tilt_deg", "revolutions"].forEach((k) => { if (wasGiven(src[k]) && step[k] === null) rejected[k] = evidenceValue(src[k]); });
    if (wasGiven(src.pace) && !PACE_PRESETS[src.pace]) rejected.pace = src.pace;
    if (wasGiven(src.framing) && src.framing !== "auto" && !FRAMING_SCALES[src.framing]) rejected.framing = src.framing;
    if (wasGiven(src.direction) && Number(src.direction) !== 1 && Number(src.direction) !== -1) rejected.direction = src.direction;
    return carryInvalid(step, src, rejected);
  }

  // Story intent attached to a stop: what this place is DOING in the sequence.
  // The journey model only carries and persists it — the meaning lives in
  // earth-studio-director.js, which reads it to choose camera treatment.
  function normalizeStory(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const purposes = Array.isArray(src.purposes) ? src.purposes.filter((p) => typeof p === "string" && p) : [];
    return {
      role: typeof src.role === "string" && src.role ? src.role : null,
      importance: typeof src.importance === "string" && src.importance ? src.importance : null,
      purposes,
    };
  }

  function normalizePlace(raw) {
    const src = raw && typeof raw === "object" ? raw : { location: raw };
    const place = {
      location: String(src.location == null ? "" : src.location).trim(),
      story: normalizeStory(src.story),
      framing: src.framing === "auto" || !src.framing ? "auto" : (FRAMING_SCALES[src.framing] ? src.framing : "auto"),
      altitude_m: numOrNull(src.altitude_m),
      tilt_deg: numOrNull(src.tilt_deg),
    };
    const rejected = {};
    if (wasGiven(src.framing) && src.framing !== "auto" && !FRAMING_SCALES[src.framing]) rejected.framing = src.framing;
    ["altitude_m", "tilt_deg"].forEach((k) => { if (wasGiven(src[k]) && place[k] === null) rejected[k] = evidenceValue(src[k]); });
    return carryInvalid(place, src, rejected);
  }

  function normalizeJourney(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const start = normalizePlace(src.start);
    const startSource = src.start && src.start.source === "continuation" ? "continuation" : "location";
    const continuation = startSource === "continuation" && src.start.continuation ? src.start.continuation : null;
    const startRejected = {};
    if (src.start && typeof src.start === "object" && wasGiven(src.start.source)
      && src.start.source !== "location" && src.start.source !== "continuation") startRejected.source = src.start.source;
    const journeyRejected = {};
    if (wasGiven(src.journey_version) && Number(src.journey_version) !== JOURNEY_VERSION) journeyRejected.journey_version = src.journey_version;
    if (wasGiven(src.pace) && !PACE_PRESETS[src.pace]) journeyRejected.pace = src.pace;
    if (wasGiven(src.start_movements) && !Array.isArray(src.start_movements)) journeyRejected.start_movements = src.start_movements;
    if (wasGiven(src.legs) && !Array.isArray(src.legs)) journeyRejected.legs = src.legs;
    const journey = {
      journey_version: JOURNEY_VERSION,
      pace: PACE_PRESETS[src.pace] ? src.pace : DEFAULT_PACE,
      aspect: src.aspect || null,
      preset: src.preset || null,
      start: carryInvalid({
        source: startSource,
        ...start,
        ...(continuation ? { continuation } : {}),
      }, start, startRejected),
      start_movements: (Array.isArray(src.start_movements) ? src.start_movements : []).map((s) => normalizeStep(s, "at")),
      legs: (Array.isArray(src.legs) ? src.legs : []).map((leg) => {
        const l = leg && typeof leg === "object" ? leg : {};
        const styleKey = TRAVEL_STYLES[l.travel_style] ? l.travel_style : "direct";
        const travel = Array.isArray(l.travel) && l.travel.length
          ? l.travel.map((s) => normalizeStep(s, "travel"))
          : TRAVEL_STYLES[styleKey].steps.map((k) => newStep(k, "travel"));
        const legRejected = {};
        if (wasGiven(l.travel_style) && !TRAVEL_STYLES[l.travel_style]) legRejected.travel_style = l.travel_style;
        if (wasGiven(l.travel) && !Array.isArray(l.travel)) legRejected.travel = l.travel;
        if (wasGiven(l.movements) && !Array.isArray(l.movements)) legRejected.movements = l.movements;
        return carryInvalid({
          destination: normalizePlace(l.destination),
          travel_style: styleKey,
          travel,
          movements: (Array.isArray(l.movements) ? l.movements : []).map((s) => normalizeStep(s, "at")),
        }, l, legRejected);
      }),
    };
    // `start.invalid_fields` from a previous pass rides inside `start` via the spread above.
    return carryInvalid(journey, src, journeyRejected);
  }

  function moveLeg(journey, index, delta) {
    const j = normalizeJourney(journey);
    const to = index + delta;
    if (index < 0 || index >= j.legs.length || to < 0 || to >= j.legs.length) return j;
    const [leg] = j.legs.splice(index, 1);
    j.legs.splice(to, 0, leg);
    return j;
  }

  // ── Compilation ───────────────────────────────────────────────────────────
  // Walks the journey, resolving each place, deriving each step's framing
  // altitude / tilt / duration, and emitting one planner-grammar phrase per
  // step. State carried between steps mirrors what the keyframe engine itself
  // carries (location, altitude, tilt) so suggested durations use the same
  // magnitudes the generator will use.

  const BAD_PLACE_TEXT = /[,;\n]|\bthen\b/i;

  function resolvePlace(planner, place) {
    const text = place.location;
    if (!text) return { text, resolved: null, ok: false, reason: "missing" };
    if (BAD_PLACE_TEXT.test(text) && !planner.parseExplicitCoords(text)) {
      return { text, resolved: null, ok: false, reason: "punctuation" };
    }
    const resolved = planner.resolveLocation(text);
    if (!resolved) return { text, resolved: null, ok: false, reason: "unknown" };
    return { text, resolved, ok: true, reason: null };
  }

  // The name to write into the description: the gazetteer's canonical name
  // (never contains a comma, so segment splitting is safe) or the raw
  // coordinate pair (which the splitter explicitly protects).
  function descriptionName(planner, resolvePlaceResult) {
    const { text, resolved } = resolvePlaceResult;
    if (resolved && resolved.source === "gazetteer_fixture") return resolved.name;
    if (planner.parseExplicitCoords(text)) return text.trim();
    return resolved ? resolved.name : text.trim();
  }

  function framingFor(planner, place, resolvedInfo, tiltDeg) {
    const classified = classifyScale(resolvedInfo.resolved, resolvedInfo.text);
    const scale = place.framing === "auto" ? classified.scale : place.framing;
    const minAltitudeM = (resolvedInfo.resolved && resolvedInfo.resolved.min_altitude_m) || 0;
    const calibrated = resolvedInfo.resolved && Number.isFinite(resolvedInfo.resolved.altitude_m)
      ? resolvedInfo.resolved.altitude_m : null;
    let altitude = null;
    let source = null;
    if (Number.isFinite(place.altitude_m)) {
      altitude = place.altitude_m; source = "manual_altitude";
    } else if (place.framing === "auto" && calibrated !== null) {
      // The gazetteer's hand-validated altitude for this place wins on AUTO:
      // it is verified framing, and leaving it implicit keeps the exact proven
      // planner path (altitude_source stays "gazetteer").
      altitude = calibrated; source = "gazetteer_calibrated";
    } else {
      const extent = place.framing === "auto" && resolvedInfo.resolved
        && Number.isFinite(resolvedInfo.resolved.frame_span_m)
        ? resolvedInfo.resolved.frame_span_m : null;
      altitude = framingAltitudeM(scale, tiltDeg, { planner, minAltitudeM, spanM: extent });
      source = extent ? "derived_optical_extent" : "derived_optical";
    }
    return {
      scale, scale_label: (scaleOf(scale) || {}).label || scale,
      classified_scale: classified.scale, classification_source: classified.source,
      altitude_m: Math.round(altitude), altitude_source: source,
      min_altitude_m: minAltitudeM,
      implicit: source === "gazetteer_calibrated",
    };
  }

  function compiledLocationLabel(info) {
    return (info && info.resolved && info.resolved.name) || (info && info.text) || "this place";
  }

  function orbitDegreesFor(def, step) {
    const revs = Number.isFinite(step.revolutions) ? step.revolutions : def.revolutions;
    return Math.round((Number.isFinite(revs) ? revs : 1) * 360);
  }

  function suggestedRange(planner, action, magnitude, def, paceKey, emphasis) {
    let raw = planner.defaultDuration(action, magnitude);
    if (action === "fly_to") {
      const from = Math.max(1, magnitude.fromAltitudeM || 1);
      const to = Math.max(1, magnitude.toAltitudeM || 1);
      const ratio = Math.max(from, to) / Math.min(from, to);
      if (ratio > 4) {
        // The same move read as an altitude change: whichever law needs more
        // time is the one that governs whether it reads on screen.
        raw = Math.max(raw, planner.defaultDuration(to < from ? "zoom_in" : "zoom_out", magnitude));
      }
    }
    const emph = Number.isFinite(emphasis) && emphasis > 0 ? Math.max(0.5, Math.min(2.5, emphasis)) : 1;
    const base = raw * (def.paceStretch || 1) * emph;
    const pace = paceOf(paceKey);
    const clamp = (v) => Math.max(1, Math.round(v));
    return {
      base_seconds: Math.round(base * 10) / 10,
      low_seconds: clamp(base * pace.low),
      high_seconds: clamp(base * pace.high),
      seconds: clamp(base * pace.factor),
    };
  }

  function orbitPhrase(degrees, direction) {
    const parts = [];
    if (degrees === 720) parts.push("twice");
    else if (degrees === 1080) parts.push("thrice");
    else if (degrees === 360) parts.push("once");
    else if (degrees === 180) parts.push("half");
    else if (degrees === 90) parts.push("a quarter");
    else parts.push(`${degrees} degrees`);
    if (direction === -1) parts.push("counterclockwise");
    else parts.push("clockwise");
    return parts.join(" ");
  }

  function phraseFor(compiled) {
    const p = [];
    const n = compiled.location_phrase;
    if (compiled.action === "fly_to") p.push(`fly to ${n}`);
    else if (compiled.action === "hover") p.push(`hover over ${n}`);
    else if (compiled.action === "orbit") p.push(`orbit ${n} ${orbitPhrase(compiled.orbit_degrees, compiled.orbit_direction)}`);
    else if (compiled.action === "zoom_in") p.push(`zoom in on ${n}`);
    else if (compiled.action === "zoom_out") p.push(`zoom out from ${n}`);
    if (compiled.emit_altitude) p.push(`at ${Math.round(compiled.altitude_m)}m`);
    if (compiled.emit_tilt) p.push(`tilted ${round2(compiled.tilt_deg)} degrees`);
    p.push(`for ${round2(compiled.duration_seconds)} seconds`);
    return p.join(" ");
  }

  function round2(v) { return Math.round(Number(v) * 100) / 100; }

  function compileJourney(journey, options = {}) {
    const planner = loadPlanner(options.planner);
    const j = normalizeJourney(journey);
    const steps = [];
    const warnings = [];

    // Resolve every place once.
    const startInfo = resolvePlace(planner, j.start);
    const legInfos = j.legs.map((leg) => resolvePlace(planner, leg.destination));

    // Camera state carried through the walk, mirroring the keyframe engine. The
    // opening altitude is the START location's own framing (not the planner's
    // flat default), so a Hold that opens the journey holds the framing the
    // operator chose rather than a generic altitude.
    const startFraming = startInfo.resolved
      ? framingFor(planner, j.start, startInfo, planner.DEFAULT_TILT_DEG.hover)
      : null;
    let cursor = {
      info: startInfo,
      place: j.start,
      altitude_m: startFraming ? startFraming.altitude_m : planner.DEFAULT_ALTITUDE_M,
      tilt_deg: null,
      framing: startFraming ? startFraming.scale : null,
    };
    if (j.start.source === "continuation" && j.start.continuation) {
      const seed = planner.normalizeInitialCamera(j.start.continuation);
      if (seed) {
        if (Number.isFinite(seed.altitude_m)) cursor.altitude_m = seed.altitude_m;
        if (Number.isFinite(seed.tilt_deg)) cursor.tilt_deg = seed.tilt_deg;
      }
    }

    // Does `next` orbit the same resolved point that `info` names? This mirrors
    // the planner's own successor-orbit lookahead (parseDescription), which makes
    // such a move terminate on the orbit's ring instead of the target centre.
    const sameResolved = (a, b) => a && b && a.resolved && b.resolved
      && Math.abs(a.resolved.latitude - b.resolved.latitude) < 1e-6
      && Math.abs(a.resolved.longitude - b.resolved.longitude) < 1e-6;

    function emit(step, slot, targetInfo, targetPlace, context, next, after, prev) {
      const def = MOVEMENTS[step.type] || MOVEMENTS[slot === "travel" ? "fly" : "hold"];
      const action = def.primitive;
      // Set inside the useTransitAltitude branch: the climb had no legible
      // altitude above the cursor and was reclassified to a hold (see below).
      let transitReclassified = false;
      // Set by the at-slot widening guard: a zoom_out whose shifted framing is
      // not wider than where the camera already is.
      let zoomOutReclassified = false;
      // Symmetric: a push-in with no meaningful tightening available.
      let zoomInReclassified = false;
      // A fly/zoom immediately followed by an orbit around the SAME target lands
      // on that orbit's ring entry, so it is correctly framed and must keep the
      // orbit's tilt for a continuous boundary (the v0.8 zero-slide property).
      const nextDef = next ? (MOVEMENTS[next.step.type] || null) : null;
      const afterDef = after ? (MOVEMENTS[after.step.type] || null) : null;
      const prevDef = prev ? (MOVEMENTS[prev.step.type] || null) : null;
      // MID-JOURNEY STAGING: the same lookahead, one movement further, for when
      // a plain hold sits between the arrival and the orbit.
      //
      // `fly -> hold -> orbit` on one subject is the ordinary sequence and it
      // was the last place the camera still corrected itself in public. The fly
      // framed the target from above, the hold faithfully held that top-down
      // 1,418 m composition at the ring's dead CENTRE, and the orbit then spent
      // 143 of its 480 frames -- 29.8% -- descending to 709 m and sliding
      // 1,228 m outward before it could sweep. The adjacent `fly -> orbit` case
      // already lands on the ring at 0.0%, so the ring geometry was never the
      // problem: the lookahead simply stopped one movement short.
      //
      // The fix stages the ARRIVAL; it does not reposition the hold. A hold
      // holds the previous camera by definition and that contract is kept
      // exactly -- the hold still holds whatever the fly delivered, we only
      // change where the fly delivers it. That is why this reads THROUGH the
      // hold rather than restaging it.
      //
      // "Transparent" means the hold carries no composition of its own. An
      // explicit tilt, altitude or framing is the operator asking for a
      // particular hold, and those keep the bounded ring acquisition.
      const holdReadsThrough = !!(nextDef && nextDef.holdsCamera
        && afterDef && afterDef.primitive === "orbit"
        && sameResolved(targetInfo, next.targetInfo)
        && sameResolved(targetInfo, after.targetInfo)
        && !Number.isFinite(next.step.tilt_deg)
        && !Number.isFinite(next.targetPlace && next.targetPlace.tilt_deg)
        && !Number.isFinite(next.step.altitude_m)
        && !next.step.framing);
      // The orbit this movement stages for, whether it is the next movement or
      // sits just past a transparent hold. One reference, so the flag below and
      // the tilt derivation cannot disagree.
      const orbitAhead = (nextDef && nextDef.primitive === "orbit") ? next
        : holdReadsThrough ? after : null;
      const endsAtOrbitEntry = !!(orbitAhead
        && ["fly_to", "zoom_in", "zoom_out"].includes(action)
        && sameResolved(targetInfo, orbitAhead.targetInfo));
      // The transparent hold seen from its own side. The camera it inherits was
      // staged for the orbit, so it must KEEP that ring geometry instead of
      // flattening to a target-framing tilt -- the flattening is precisely what
      // put the held camera at the ring's centre. Inheritance already carries
      // the right value, so this only has to stop the flatten; it never forces
      // a tilt of its own, and it never moves the camera.
      //
      // Deliberately emits NO plan annotation. The planner's consent check is
      // that the hold's altitude and tilt match the orbit's, so carrying the
      // geometry here IS the signal and no new schema field is needed.
      const holdsOrbitEntryGeometry = !!(orbitAhead && orbitAhead === next
        && !!def.holdsCamera && cursor.started
        && prevDef && ["fly_to", "zoom_in", "zoom_out"].includes(prevDef.primitive)
        && sameResolved(targetInfo, prev.targetInfo)
        && !Number.isFinite(step.tilt_deg)
        && !Number.isFinite(targetPlace && targetPlace.tilt_deg)
        && !Number.isFinite(step.altitude_m)
        && !step.framing);
      // DIRECTORIAL STAGING: an opening hold whose next movement is an orbit
      // around the SAME subject should establish from the orbit's own geometry,
      // not from a generic top-down framing.
      //
      // Measured on case K in real Earth Studio: a top-down establishing hold
      // put the camera at the CENTRE of the orbit's 1,228 m ring, so the orbit
      // then spent frames 90-238 of a 510-frame shot climbing 1,419 m -> 710 m
      // and travelling 0 m -> 1,229 m outward before it could start sweeping —
      // 35% of the shot correcting a state the director could simply have
      // staged. A skilled operator frames the establishing shot where the orbit
      // begins and then starts moving.
      //
      // Only the OPENING hold qualifies: a later hold holds the previous camera
      // by definition, and repositioning it would break that contract, so those
      // keep the bounded ring-acquisition fallback. Explicit operator geometry
      // and continuation state both outrank this (see the guards below and the
      // seeded-opening guard in the planner).
      const stagesOrbitEntry = !!(nextDef && nextDef.primitive === "orbit"
        && !!def.holdsCamera && !cursor.started
        && sameResolved(targetInfo, next.targetInfo)
        && !Number.isFinite(step.tilt_deg)
        && !Number.isFinite(targetPlace && targetPlace.tilt_deg)
        && !Number.isFinite(step.altitude_m)
        && !step.framing);
      const successorOrbitTilt = (endsAtOrbitEntry || stagesOrbitEntry)
        ? (Number.isFinite(orbitAhead.step.tilt_deg) ? orbitAhead.step.tilt_deg
          : Number.isFinite(orbitAhead.targetPlace && orbitAhead.targetPlace.tilt_deg) ? orbitAhead.targetPlace.tilt_deg
          // matches the orbit's own derivation below: a flattened carried tilt is
          // not inheritable by an orbit, so it takes the oblique orbit default.
          : (Number.isFinite(cursor.tilt_deg) && !cursor.tilt_capped) ? cursor.tilt_deg
          : planner.DEFAULT_TILT_DEG.orbit)
        : null;
      // Provenance of the tilt matters: an operator's explicit tilt, and a
      // movement whose whole point is a tilt (Low Approach), stay authoritative.
      const tiltExplicit = Number.isFinite(step.tilt_deg) || Number.isFinite(targetPlace && targetPlace.tilt_deg);
      const tiltIntentional = tiltExplicit || Number.isFinite(def.tiltDeg);
      // Tilt carry-over keeps a journey visually stable, but a tilt that was
      // FLATTENED for target framing is only meaningful for a camera sitting above
      // its target. An orbit rides a ring and faces the target, so it must fall
      // back to its own oblique default rather than inherit the flattened value —
      // otherwise picking "Orbit" silently produced a top-down spin-in-place.
      //
      // The same reasoning has to apply to a tilt the operator asked for
      // EXPLICITLY, and for a while it did not. `tilt_capped` is only set when a
      // tilt was DERIVED and then clamped (`!tiltIntentional`), so an explicit
      // "hold tilted 0 degrees" sailed through and the following orbit inherited
      // 0. An orbit rides a ring of radius `altitude · tan(tilt)`, so at tilt 0
      // it has no ring: measured in real Earth Studio, the camera held position
      // to fourteen decimal places for all 480 frames while pan swept the full
      // 180 deg. A dead nadir spin — the map turning under a static camera —
      // presented as an orbit.
      //
      // An explicit tilt governs the shot it was given to. It is not an
      // instruction about the NEXT shot. So the refusal to inherit now depends
      // on whether the carried tilt leaves the orbit a usable ring, not on how
      // that tilt came about. The threshold is the existing calibrated
      // "camera is essentially above its target" limit — the same one the
      // derived-cap path uses — rather than a new constant.
      //
      // An explicit tilt on the ORBIT ITSELF still wins: it is the first branch
      // of `baseTilt` below, and asking for a top-down orbit is the operator's
      // own choice to make.
      const carriedTiltLeavesNoRing = action === "orbit"
        && Number.isFinite(cursor.tilt_deg)
        && cursor.tilt_deg <= maxTargetFramingTiltDeg({ planner });
      const inheritable = Number.isFinite(cursor.tilt_deg)
        && !(action === "orbit" && (cursor.tilt_capped || carriedTiltLeavesNoRing));
      let baseTilt = Number.isFinite(step.tilt_deg) ? step.tilt_deg
        : Number.isFinite(def.tiltDeg) ? def.tiltDeg
        : Number.isFinite(targetPlace && targetPlace.tilt_deg) ? targetPlace.tilt_deg
        : (endsAtOrbitEntry || stagesOrbitEntry) ? successorOrbitTilt
        : inheritable ? cursor.tilt_deg
        : (planner.DEFAULT_TILT_DEG[action] != null ? planner.DEFAULT_TILT_DEG[action] : 45);
      // Cap a DERIVED tilt so the requested place is actually in shot.
      const framesTargetFromAbove = action !== "orbit" && !endsAtOrbitEntry && !stagesOrbitEntry
        && !holdsOrbitEntryGeometry;
      if (framesTargetFromAbove && !tiltIntentional && baseTilt > TARGET_FRAMING_TILT_DEG) {
        baseTilt = TARGET_FRAMING_TILT_DEG;
      }
      // "Flattened" describes the tilt itself, not which step clamped it: a
      // derived target-framing tilt at or below the optical limit is only
      // meaningful for a camera above its target. The flag must therefore be
      // sticky across carry-over (a second Hold inherits 0 without re-clamping),
      // so an orbit further down the journey still refuses to inherit it.
      let tiltCapped = framesTargetFromAbove && !tiltIntentional
        && baseTilt <= maxTargetFramingTiltDeg({ planner });

      // Framing for this step's target, shifted by the movement's own intent
      // (push in = one step closer, reveal = two steps wider, ...).
      const frameBase = framingFor(planner, {
        ...targetPlace,
        framing: step.framing || targetPlace.framing,
      }, targetInfo, baseTilt);
      let altitude = frameBase.altitude_m;
      let altitudeSource = frameBase.altitude_source;
      let scale = frameBase.scale;
      const shift = Number.isFinite(step.scaleShift) ? step.scaleShift : def.scaleShift;
      if (Number.isFinite(shift) && shift !== 0 && !Number.isFinite(step.altitude_m)) {
        const shifted = stepScale(frameBase.scale, shift);
        if (shifted !== frameBase.scale) {
          scale = shifted;
          altitude = framingAltitudeM(scale, baseTilt, { planner, minAltitudeM: frameBase.min_altitude_m });
          altitudeSource = "derived_optical_shifted";
        }
        else {
          // The NAMED ladder has no rung left in this direction, but the MOVE
          // still has to happen. Keeping the base framing here is what made
          // "push in on Helsinki Cathedral" play as a static shot: landmark is
          // rung 0, so the push clamped to its own starting altitude and
          // produced 1418m -> 1418m with a single position keyframe. A
          // requested approach that silently becomes a hover is a defect.
          //
          // Continue past the end of the ladder using the SAME geometric step
          // the ladder itself uses at that boundary, so "one step closer" keeps
          // the meaning it has everywhere else, then clamp to what Earth Studio
          // actually allows. Named rungs are unchanged; this only fills in the
          // open ends.
          // A place's hand-validated gazetteer altitude is NOT overridden here.
          // That guard came from real playback ("the camera can be too close to
          // a building": a Spiral In on the Eiffel Tower re-derived 709 m
          // instead of the validated 1,000 m), and Mikko's calibrated distance
          // outranks a derived one. Only a framing this code derived itself is
          // continued past the ladder.
          // Only an AT-slot framing movement (Push In / Pull Back / Reveal)
          // continues past the ladder. A TRAVEL step is already going somewhere
          // and its arrival framing is what matters, so pushing it below the
          // last rung just drives the camera at the ground: `fly_low` carries an
          // oblique 72 deg tilt, and continuing it past `landmark` put the
          // Eiffel approach at 196 m before the orbit pulled back to 438 m — an
          // altitude reversal in the middle of the transition that is supposed
          // to be the smoothest thing in the shot.
          const framingMove = slot === "at";
          const calibrated = frameBase.altitude_source === "gazetteer_calibrated";
          const i = SCALE_LADDER.indexOf(frameBase.scale);
          const inward = shift < 0;
          const neighbour = SCALE_LADDER[inward
            ? Math.min(SCALE_LADDER.length - 1, i + 1)
            : Math.max(0, i - 1)];
          const here = framingAltitudeM(frameBase.scale, baseTilt, { planner, minAltitudeM: frameBase.min_altitude_m });
          const there = framingAltitudeM(neighbour, baseTilt, { planner, minAltitudeM: frameBase.min_altitude_m });
          const ratio = here > 0 && there > 0 ? Math.max(here, there) / Math.min(here, there) : 1;
          if (framingMove && !calibrated && ratio > 1.0001 && neighbour !== frameBase.scale) {
            // HALF a rung per shift, not a whole one. Past the end of the ladder
            // there is no calibrated rung to land on, and the same playback
            // feedback says erring closer is the dangerous direction — so take
            // the conservative step that still reads as a real move.
            const factor = Math.pow(Math.sqrt(ratio), Math.abs(shift));
            const floor = Math.max(planner.MIN_ALTITUDE_M, frameBase.min_altitude_m || 0);
            const raw = inward ? altitude / factor : altitude * factor;
            const next = Math.min(planner.MAX_ALTITUDE_M, Math.max(floor, raw));
            if (Math.abs(next - altitude) > 1) {
              altitude = next;
              altitudeSource = "derived_optical_beyond_ladder";
            }
          }
        }
      }
      if (def.holdAltitude && !Number.isFinite(step.altitude_m)) {
        altitude = cursor.altitude_m;
        altitudeSource = "cruise_held";
        scale = cursor.framing || scale;
      }
      // MOVEMENT-INTENT GUARD, at-slot widening (zoom_out / reveal). A shifted
      // framing that lands AT OR BELOW the camera's current altitude is not a
      // pull-back at all — it is a descent wearing a zoom_out label (measured:
      // DIRN17 segment 11, fly arrives at continent-scale 4,537,025 m and the
      // +1-rung "reveal" resolves to country 3,686,333 m = −18.75% wider).
      // Same resolution as the transit guard: there is nothing meaningful to
      // pull back TO, so hold the camera instead of emitting a dead move.
      if (!transitReclassified && slot === "at" && action === "zoom_out"
        && Number.isFinite(shift) && shift > 0 && !Number.isFinite(step.altitude_m)
        && altitude <= cursor.altitude_m * (1 + DEAD_CLIMB_FRACTION)) {
        altitude = cursor.altitude_m;
        altitudeSource = "already_wider_than_target_framing";
        scale = cursor.framing || scale;
        zoomOutReclassified = true;
      }
      // Symmetric guard for tightening: a push-in whose resolved framing is
      // not meaningfully CLOSER than where the camera already is (typically a
      // calibrated landmark the ladder cannot go below) would be a dead move.
      // Only when the ladder itself had no closer rung — a real one-rung move
      // is legitimate even when a calibrated place altitude makes the
      // percentage small.
      if (!transitReclassified && !zoomOutReclassified && slot === "at" && action === "zoom_in"
        && Number.isFinite(shift) && shift < 0 && !Number.isFinite(step.altitude_m)
        && stepScale(frameBase.scale, shift) === frameBase.scale
        && altitude >= cursor.altitude_m * (1 - DEAD_CLIMB_FRACTION)) {
        altitude = cursor.altitude_m;
        altitudeSource = "already_tighter_than_target_framing";
        scale = cursor.framing || scale;
        zoomInReclassified = true;
      }
      if (def.useTransitAltitude && !Number.isFinite(step.altitude_m)) {
        const dist = context && Number.isFinite(context.distanceM) ? context.distanceM : null;
        altitude = transitAltitudeM(dist, baseTilt, Math.max(cursor.altitude_m, frameBase.altitude_m), { planner });
        altitudeSource = "derived_transit";
        scale = "transit";
        // MOVEMENT-INTENT GUARD (zoom_out that cannot zoom). The floor above
        // keeps the crossing legible, but when the camera ALREADY sits at or
        // above the legible transit height the clamp collapses this step to
        // its own starting altitude: a "Climb Out" labelled zoom_out with a
        // 0% framing change — exactly the dead move the camera-quality gate
        // flags as movement-intent failure (measured on DIRN17 segment 2:
        // region-framed start at 992,474 m, legible transit ~240,624 m,
        // clamped back to 992,474 → 992,474).
        //
        // There is genuinely nothing to climb to, so the honest resolution is
        // reclassification, not a fake pull-back: hold the camera at the
        // travelling altitude it already has and let the cruise do the
        // crossing. The step keeps its slot, duration and place so pacing and
        // segment counts stay stable; only the primitive changes.
        if (altitude <= cursor.altitude_m * (1 + DEAD_CLIMB_FRACTION)) {
          altitude = cursor.altitude_m;
          altitudeSource = "transit_already_legible";
          transitReclassified = true;
        }
      }
      // LEGIBILITY FLOOR on a travelling leg's climb.
      //
      // The `cinematic` style climbs with `pull_back`, a fixed one-rung shift,
      // so Helsinki -> Stockholm (400 km) and Helsinki -> New York (6,600 km)
      // both cruised at the metro rung — the same travel geometry for a journey
      // 16x longer. At 155,960 m the New York crossing sweeps the ground past at
      // 1.14 frame-widths/second, over this module's own readable limit of
      // READABLE_SCREEN_SPEED_FW_PER_S, so the surface just smears.
      //
      // The limit was already defined and already produced an advisory warning;
      // this enforces it. RAISE ONLY: for short legs the readable altitude is
      // far below the framing rung, so those are untouched and keep their
      // hand-tuned look. A manual altitude still wins (set below).
      if (slot === "travel" && Number.isFinite(def.scaleShift) && def.scaleShift > 0
          && !def.holdAltitude && !def.useTransitAltitude
          && context && Number.isFinite(context.distanceM) && context.distanceM > 0
          && Number.isFinite(context.transitSeconds) && context.transitSeconds > 0) {
        const readable = readableTransitAltitudeM(context.distanceM, context.transitSeconds, baseTilt, { planner });
        if (Number.isFinite(readable) && readable > altitude + 1) {
          altitude = Math.min(planner.SPACE_ALTITUDE_M, Math.round(readable));
          altitudeSource = "derived_transit_legibility";
        }
      }
      if (Number.isFinite(step.altitude_m)) { altitude = step.altitude_m; altitudeSource = "manual_altitude"; }

      // An orbit only frames its target because the engine puts the camera on a
      // ring of altitude*tan(tilt) facing inward. Past the generator's ring cap
      // that placement is impossible and the orbit points at empty sky, so a
      // DERIVED tilt goes top-down — which the planner documents as the top-down
      // orbit look (a spin in place) and which keeps the target centred.
      let orbitFlattened = false;
      if (action === "orbit" && !orbitCanFaceTarget(altitude, baseTilt, { planner })) {
        if (tiltIntentional) {
          warnings.push(`${def.label} around ${compiledLocationLabel(targetInfo)} needs the camera ${Math.round(altitude * Math.tan((baseTilt * Math.PI) / 180) / 1000)} km out to face it at ${round2(baseTilt)}\u00b0, but the generator holds an orbit within ${Math.round(orbitRingCapM(planner) / 1000)} km. At this framing the orbit will point at empty sky instead of ${compiledLocationLabel(targetInfo)} — lower the tilt, or orbit a smaller target.`);
        } else {
          baseTilt = TARGET_FRAMING_TILT_DEG;
          orbitFlattened = true;
          // The framing altitude depends on the tilt, so re-derive it at the new
          // one unless the altitude came from somewhere else entirely.
          if (altitudeSource === "derived_optical") {
            altitude = framingAltitudeM(frameBase.scale, baseTilt, { planner, minAltitudeM: frameBase.min_altitude_m });
          } else if (altitudeSource === "derived_optical_shifted") {
            altitude = framingAltitudeM(scale, baseTilt, { planner, minAltitudeM: frameBase.min_altitude_m });
          }
        }
      }

      // A hold must not carry an explicit altitude/tilt: an explicit value turns
      // the planner's camera HOLD into a move. Holds therefore emit neither —
      // EXCEPT the very first movement of a journey, where there is no previous
      // camera to hold. parseSegment only applies hold semantics when a previous
      // location exists, so the opening hold states its framing instead (that is
      // the only way an opening shot can be framed at all).
      const isHold = !!def.holdsCamera;
      const openingHold = isHold && !cursor.started;
      if (isHold && !openingHold) { altitude = cursor.altitude_m; altitudeSource = "held"; }

      const orbitDegrees = action === "orbit" ? orbitDegreesFor(def, step) : null;
      const distanceM = targetInfo.resolved && cursor.info && cursor.info.resolved
        ? planner.haversineMeters(cursor.info.resolved, targetInfo.resolved) : null;
      const magnitude = {
        // A flight that is the journey's FIRST movement has no previous camera
        // position, so the generator plays it as an establishing dive onto the
        // target rather than a crossing — distance is not the magnitude then.
        // This mirrors parseSegment's own rule (previousLocation === null).
        distanceM: action === "fly_to" && !cursor.started ? null : distanceM,
        orbitDegrees: orbitDegrees || 360,
        tiltDeg: baseTilt,
        fromAltitudeM: cursor.altitude_m,
        toAltitudeM: altitude,
      };
      const suggestion = suggestedRange(planner, action, magnitude, def, step.pace || j.pace, step.emphasis);
      const duration = Number.isFinite(step.duration_seconds) ? step.duration_seconds : suggestion.seconds;

      const compiled = {
        step_id: step.id,
        slot,
        movement: def.key,
        movement_label: def.label,
        action,
        location_name: targetInfo.resolved ? targetInfo.resolved.name : targetInfo.text,
        location_text: targetInfo.text,
        location_phrase: descriptionName(planner, targetInfo),
        location_resolved: !!targetInfo.resolved,
        framing_scale: scale,
        framing_label: (scaleOf(scale) || {}).label || scale,
        classified_scale: frameBase.classified_scale,
        classification_source: frameBase.classification_source,
        altitude_m: Math.round(altitude),
        altitude_source: altitudeSource,
        tilt_deg: round2(baseTilt),
        // Only an UNSHIFTED auto framing may stay implicit (letting the planner
        // apply its own hand-validated gazetteer altitude, which keeps the exact
        // proven path). Anything that moved the altitude must say so.
        emit_altitude: (!isHold || openingHold) && altitudeSource !== "gazetteer_calibrated",
        emit_tilt: !isHold || openingHold,
        orbit_degrees: orbitDegrees,
        orbit_direction: action === "orbit" ? (step.direction === -1 ? -1 : 1) : null,
        duration_seconds: round2(duration),
        duration_source: Number.isFinite(step.duration_seconds) ? "manual"
          : (Number.isFinite(step.emphasis) && step.emphasis !== 1 ? "suggested_with_emphasis" : "suggested"),
        emphasis: Number.isFinite(step.emphasis) ? step.emphasis : null,
        suggestion,
        pace: step.pace || j.pace,
        distance_m: Number.isFinite(distanceM) ? Math.round(distanceM) : null,
        altitude_from_m: Math.round(cursor.altitude_m),
        holds_camera: isHold && !openingHold,
        ends_at_orbit_entry: endsAtOrbitEntry,
        stages_orbit_entry: stagesOrbitEntry ? (next && next.step ? next.step.id : true) : false,
        tilt_intentional: tiltIntentional,
        tilt_capped: tiltCapped,
        orbit_flattened: orbitFlattened,
        target_offset_half_frames: action === "orbit" || endsAtOrbitEntry || stagesOrbitEntry
          ? 0 : Math.round(targetOffsetHalfFrames(baseTilt, { planner }) * 100) / 100,
      };
      // An authoritative tilt that puts the place out of shot is the operator's
      // call, but they must be told — this is the exact defect real imports found.
      if (framesTargetFromAbove && tiltIntentional && targetOffsetHalfFrames(baseTilt, { planner }) > 1) {
        warnings.push(`${def.label} at ${compiledLocationLabel(targetInfo)} uses a ${round2(baseTilt)}\u00b0 tilt, which points the camera away from the place itself — ${compiledLocationLabel(targetInfo)} will not be visible in frame during this movement. Lower the tilt below ${maxTargetFramingTiltDeg({ planner })}\u00b0, or use an orbit, which frames the target at any tilt.`);
      }
      // On AUTO framing with a calibrated gazetteer altitude the phrase omits
      // the altitude, so the planner applies its own gazetteer value — record
      // what that will be so the summary is truthful.
      if (altitudeSource === "gazetteer_calibrated" && (!isHold || openingHold)) {
        compiled.altitude_m = Math.round(frameBase.altitude_m);
      }
      if (orbitFlattened) compiled.tilt_capped = tiltCapped = true;
      // Reclassified dead climb (see the useTransitAltitude guard above):
      // emit a hold, not a zoom_out. A hold keeps the camera exactly where it
      // is, so the altitude must NOT be re-emitted (the planner would apply it
      // as an authoritative move) and the phrase must read as hovering.
      if (transitReclassified || zoomOutReclassified || zoomInReclassified) {
        compiled.action = "hover";
        compiled.reclassified_from = "zoom_out";
        compiled.reclassification_reason = transitReclassified
          ? "already_at_or_above_legible_transit_altitude"
          : zoomOutReclassified
            ? "already_wider_than_target_framing"
            : "already_tighter_than_target_framing";
        compiled.emit_altitude = false;
        compiled.emit_tilt = false;
        compiled.altitude_m = Math.round(cursor.altitude_m);
        warnings.push(`${def.label} at ${compiledLocationLabel(targetInfo)} ${transitReclassified
          ? `was already at or above the legible crossing altitude (${formatAltitude(compiled.altitude_m)}), so there was nothing to climb to`
          : zoomOutReclassified
            ? `is already framed wider than the requested pull-back framing (${formatAltitude(compiled.altitude_m)}), so there was nothing meaningful to pull back to`
            : `is already framed as tight as the requested push-in framing (${formatAltitude(compiled.altitude_m)}), so there was nothing meaningful to tighten onto`} — the movement holds the camera instead of pretending to zoom.`);
      }
      compiled.phrase = phraseFor(compiled);
      steps.push(compiled);

      cursor = {
        info: targetInfo,
        place: targetPlace,
        altitude_m: compiled.altitude_m,
        tilt_deg: compiled.tilt_deg,
        tilt_capped: tiltCapped,
        framing: scale,
        started: true,
        moved: true,
      };
      return compiled;
    }

    // Plan the whole ordered walk BEFORE emitting, so every step can see its
    // successor (needed for the ring-entry rule above). Travel steps that run
    // where the camera already is resolve their target during the walk.
    const planned = [];
    j.start_movements.forEach((step) => planned.push({ step, slot: "at", targetInfo: startInfo, targetPlace: j.start, context: null }));
    let walkInfo = startInfo;
    let walkPlace = j.start;
    j.legs.forEach((leg, i) => {
      const destInfo = legInfos[i];
      const distanceM = destInfo.resolved && walkInfo && walkInfo.resolved
        ? planner.haversineMeters(walkInfo.resolved, destInfo.resolved) : null;
      // How long the camera actually spends CROSSING, which is what decides
      // whether the ground is legible on the way. transitAltitudeM has to guess
      // this from the generator's baseline duration; here the real number is
      // known, so the legibility floor below can use it.
      const transitSeconds = leg.travel.reduce((sum, st) => {
        const d = MOVEMENTS[st.type] || MOVEMENTS.fly;
        return sum + (d.travelsToDestination && Number.isFinite(st.duration_seconds) ? st.duration_seconds : 0);
      }, 0);
      leg.travel.forEach((step) => {
        const def = MOVEMENTS[step.type] || MOVEMENTS.fly;
        const targetsDestination = !!(def.travelsToDestination || def.atDestination);
        const info = targetsDestination ? destInfo : walkInfo;
        const place = targetsDestination ? leg.destination : walkPlace;
        planned.push({ step, slot: "travel", targetInfo: info, targetPlace: place, context: { distanceM, transitSeconds } });
        if (targetsDestination) { walkInfo = destInfo; walkPlace = leg.destination; }
      });
      leg.movements.forEach((step) => planned.push({ step, slot: "at", targetInfo: destInfo, targetPlace: leg.destination, context: null }));
      walkInfo = destInfo; walkPlace = leg.destination;
    });
    planned.forEach((p, i) => emit(p.step, p.slot, p.targetInfo, p.targetPlace, p.context,
      planned[i + 1] || null, planned[i + 2] || null, planned[i - 1] || null));

    const description = steps.map((s) => s.phrase).join(" then ");
    const total = steps.reduce((sum, s) => sum + s.duration_seconds, 0);

    if (j.start.source === "continuation" && steps.length && steps[0].action === "orbit") {
      warnings.push("The first movement after a continuation is an orbit. The camera will slide sideways onto the orbit circle at the very start — begin a continuation with Hold or a travel movement for a seamless join.");
    }

    // Any crossing whose ground sweeps past faster than the readable limit gets an
    // advisory: the operator may still want it, but they must know the locations
    // will not be legible.
    steps.forEach((s) => {
      if (!["fly_to"].includes(s.action)) return;
      if (!Number.isFinite(s.distance_m) || s.distance_m < 1000) return;
      // A move that changes altitude while travelling is only as legible as its
      // lowest point, so judge the crossing there rather than at its endpoint.
      const worstAlt = Math.min(
        Number.isFinite(s.altitude_from_m) ? s.altitude_from_m : s.altitude_m,
        s.altitude_m,
      );
      const fw = screenSpeedFrameWidths(s.distance_m, s.duration_seconds, worstAlt, s.tilt_deg, { planner });
      s.screen_speed_frame_widths_per_second = Math.round(fw * 100) / 100;
      s.screen_speed_judged_at_altitude_m = worstAlt;
      if (fw <= READABLE_SCREEN_SPEED_FW_PER_S) return;
      const need = readableTransitAltitudeM(s.distance_m, s.duration_seconds, s.tilt_deg, { planner });
      warnings.push(`${s.movement_label} covers ${formatDistance(s.distance_m)} to ${compiledLocationLabel({ resolved: { name: s.location_name } })} in ${round2(s.duration_seconds)}s at ${formatAltitude(worstAlt)}. The ground sweeps past ${round2(fw)} frame-widths per second, which is too fast to read the locations — cross at about ${formatAltitude(need)} instead (High Transit or Cinematic travel does that), or give the leg more time.`);
    });

    // Hold-then-orbit slide (confirmed by real import, canary G): a hold keeps the
    // camera exactly where it is, so an orbit that follows it around a DIFFERENT
    // place has to glide onto its ring during its own first revolution instead of
    // starting on it. A fly/zoom arrival does not have this problem — it is
    // annotated to terminate on the ring entry — so this only needs saying when a
    // hold or pause sits directly in front of the orbit. Advisory only: the move
    // is legal and reads as a swoop, it is just not a clean circle from frame one.
    //
    // The SAME place is not automatically safe, which is what this check used to
    // assume. An orbit rides a ring of radius altitude*tan(tilt) around its
    // target, while a hold sits wherever it already was — and a hold framed
    // top-down (tilt 0) sits at the ring's CENTRE. Generating "hold the
    // Colosseum, then half-orbit it" produced exactly that: the hold held at
    // tilt 0 / radius 0, then the orbit had to travel 1,228 m out to its ring
    // while already circling, measured as 103% radius breathing, 180 degrees of
    // look-direction drift and a 60 degree pitch swing mid-circle. So the test
    // is whether the hold actually SITS on the ring, not whether the place
    // matches.
    steps.forEach((s, i) => {
      const prev = steps[i - 1];
      // What matters is whether the previous step leaves the camera ON the
      // orbit's ring. Two ways it does not: a hold keeps the camera wherever it
      // already was, and a hover — including the OPENING hover of a shot — puts
      // the camera directly above its target, i.e. at the ring's centre. The
      // opening hover does not set holds_camera (it is establishing, not
      // holding), which is why keying on that flag alone missed the case.
      if (!prev || s.action !== "orbit") return;
      const leavesCameraOffRing = prev.holds_camera || prev.action === "hover";
      if (!leavesCameraOffRing) return;
      const ringRadiusM = planner.orbitRadiusMeters(s.altitude_m, s.tilt_deg);
      const samePlace = prev.location_name === s.location_name;
      // Same place AND no ring to travel to (a top-down spin in place) is fine.
      if (samePlace && ringRadiusM < 1) return;
      const geometry = samePlace
        ? `The hold sits at the centre of the orbit's ${Math.round(ringRadiusM)} m ring, not on it, so the camera travels outward while it is already circling`
        : "A hold leaves the camera where it is, so the orbit glides onto its circle during its first revolution rather than starting on it";
      warnings.push(`${prev.movement_label} at ${prev.location_name} is immediately followed by ${s.movement_label} around ${s.location_name}. ${geometry}. Put a travel movement between them (Fly To or Cruise) for a clean orbit, or accept the swoop.`);
    });

    return {
      journey: j,
      description,
      steps,
      total_duration_seconds: Math.round(total * 100) / 100,
      initial_camera: j.start.source === "continuation" && j.start.continuation
        ? planner.normalizeInitialCamera(j.start.continuation) : null,
      places: {
        start: startInfo,
        destinations: legInfos,
      },
      warnings,
    };
  }

  // ── Compile verification ──────────────────────────────────────────────────
  // Re-parse the emitted description through the real planner and check every
  // segment against the compiled intent. This is what makes compiling to the
  // description grammar safe: grammar drift fails loudly instead of silently
  // producing a different animation.
  function verifyCompilation(compiled, options = {}) {
    const planner = loadPlanner(options.planner);
    const parsed = planner.parseDescription(compiled.description);
    const problems = [];
    if (parsed.segments.length !== compiled.steps.length) {
      problems.push(`compiled ${compiled.steps.length} movements but the planner parsed ${parsed.segments.length} segments`);
    }
    const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= tol;
    compiled.steps.forEach((step, i) => {
      const seg = parsed.segments[i];
      if (!seg) return;
      const at = `movement ${i + 1} (${step.movement_label})`;
      if (seg.action !== step.action) problems.push(`${at}: expected action ${step.action}, planner read ${seg.action}`);
      if (step.location_resolved && seg.location_name !== step.location_name) {
        problems.push(`${at}: expected location "${step.location_name}", planner read "${seg.location_name}"`);
      }
      if (!near(seg.duration_seconds, step.duration_seconds, 0.011)) {
        problems.push(`${at}: expected ${step.duration_seconds}s, planner read ${seg.duration_seconds}s`);
      }
      if (step.emit_tilt && !near(seg.tilt_deg, step.tilt_deg, 0.011)) {
        problems.push(`${at}: expected tilt ${step.tilt_deg}deg, planner read ${seg.tilt_deg}deg`);
      }
      if (step.emit_altitude && !near(seg.altitude_m, step.altitude_m, 1)) {
        problems.push(`${at}: expected altitude ${step.altitude_m}m, planner read ${seg.altitude_m}m`);
      }
      if (step.action === "orbit") {
        if (seg.orbit_degrees !== step.orbit_degrees) problems.push(`${at}: expected ${step.orbit_degrees}deg of orbit, planner read ${seg.orbit_degrees}deg`);
        if (seg.orbit_direction !== step.orbit_direction) problems.push(`${at}: expected orbit direction ${step.orbit_direction}, planner read ${seg.orbit_direction}`);
      }
    });
    return { ok: problems.length === 0, problems, parsed };
  }

  // ── Direct journey IR → planner segment specs (structured path) ───────────
  // One spec per compiled step, carrying exactly the values the phrase would
  // carry: the same rounding (round2 tilt/duration, Math.round altitude), the
  // same omission rules (emit_altitude / emit_tilt), the same canonical
  // location phrase, the same orbit degrees/direction. Nothing is re-derived
  // here — the planner's shared assembly owns every downstream rule.
  function segmentSpecsFromCompiled(compiled) {
    return compiled.steps.map((step) => ({
      source_text: step.phrase,
      action: step.action,
      resolution_status: "parsed",
      action_warning: null,
      location_phrase: step.location_phrase,
      duration_seconds: round2(step.duration_seconds),
      altitude_m: step.emit_altitude ? Math.round(step.altitude_m) : null,
      altitude_spec_source: step.emit_altitude ? "explicit" : null,
      tilt_deg: step.emit_tilt ? round2(step.tilt_deg) : null,
      orbit_degrees: step.action === "orbit" ? step.orbit_degrees : null,
      orbit_direction: step.action === "orbit" ? (step.orbit_direction === -1 ? -1 : 1) : 1,
    }));
  }

  // Structured entry point. Validation is NOT bypassed: by default the journey
  // goes through validateJourney (operator-language errors, the same gate the
  // lane applies) before compiling. Returns the parsed-description object the
  // planner's buildShotPlanFromParsed / buildArtifactsFromParsed consume, plus
  // out-of-band provenance. NOTE: `parsed.parser_strategy` keeps the historical
  // string for byte identity with the text path; the truthful origin lives in
  // `provenance`, never inside the plan bytes.
  function compileJourneyToParsed(journey, options = {}) {
    const planner = loadPlanner(options.planner);
    const j = normalizeJourney(journey);
    let compiled;
    if (options.validate === false) {
      compiled = compileJourney(j, { planner });
    } else {
      // Validate the RAW input, not a pre-normalized copy: normalizeStep records
      // an unsupported movement type as `unsupported_type` on the first pass and
      // drops it on a second pass, so validating an already-normalized journey
      // silently accepts a coerced default movement. (The lane's
      // normalize-then-validate order has that gap; the structured entry point
      // must not inherit it.)
      const check = validateJourney(journey, { planner });
      if (!check.ok) {
        const e = new Error(`this camera journey cannot be generated yet:\n- ${check.errors.join("\n- ")}`);
        e.statusCode = 400; e.journey_errors = check.errors; throw e;
      }
      compiled = check.compiled;
    }
    const specs = segmentSpecsFromCompiled(compiled);
    const parsed = planner.buildParsedFromSegmentSpecs(compiled.description, specs, {
      aspect: options.aspect || j.aspect || undefined,
      calibratedPortraitFraming: options.calibratedPortraitFraming,
      frameRate: options.frameRate,
    });
    return {
      parsed,
      compiled,
      specs,
      provenance: {
        input: "structured_journey",
        journey_version: j.journey_version,
        text_parsed_for_authority: false,
        text_parsed_for_verification: options.validate !== false,
        planner_version: planner.VERSION,
      },
    };
  }

  // Structured-output equivalence check (sibling of verifyCompilation, used by
  // the equivalence tests): the parsed object the text path recovers from the
  // generated English must equal, field for field, the one built directly from
  // the steps. Exact equality — no tolerances.
  function verifyParsedEquivalence(fromText, fromSteps) {
    const a = JSON.stringify(fromText);
    const b = JSON.stringify(fromSteps);
    if (a === b) return { ok: true, problems: [] };
    const problems = [];
    const keys = new Set([...Object.keys(fromText || {}), ...Object.keys(fromSteps || {})]);
    keys.forEach((k) => {
      const x = JSON.stringify(fromText ? fromText[k] : undefined);
      const y = JSON.stringify(fromSteps ? fromSteps[k] : undefined);
      if (x !== y) problems.push(`${k}: text path ${x && x.slice(0, 200)} vs structured ${y && y.slice(0, 200)}`);
    });
    return { ok: false, problems };
  }

  // ── Validation (operator language) ────────────────────────────────────────
  //
  // AUTHORITY CONTRACT (2026-09-02 repair):
  //   raw journey ─► validateJourneyInput (structure + intent, on the RAW input)
  //               ─► normalizeJourney      (compatibility canonicalization; tolerant, never throws)
  //               ─► canonical checks      (places resolve, durations, compile verification)
  //               ─► compile
  // Validity is INVARIANT under normalization: normalizeStep preserves the
  // evidence of an unsupported movement (`unsupported_type`), and the raw stage
  // enforces that evidence too, so validate(raw) and validate(normalize(raw))
  // reach the same verdict. Normalization can therefore never turn an invalid
  // journey into a valid one, whatever order a caller happens to use.
  //
  // "Present" below means not undefined / null / "" — an absent optional is
  // never an error (compatibility), but a present value must be inside the
  // contract: numeric fields must coerce to a finite number (numeric strings
  // stay accepted), enums must be known, movements must exist for their slot.
  const isPresent = (v) => !(v === undefined || v === null || v === "");
  // Exactly numOrNull's acceptance: whatever normalization would coerce to a
  // finite number is valid here, so raw and normalized verdicts cannot disagree.
  const isFiniteLike = (v) => numOrNull(v) !== null;
  // A record with `invalid_fields` evidence is validated as if the rejected raw
  // values were still present — the evidence re-materializes the input.
  const restoreView = (rec) => (rec && typeof rec === "object" && !Array.isArray(rec) && rec.invalid_fields && typeof rec.invalid_fields === "object")
    ? { ...rec, ...rec.invalid_fields } : rec;
  const NUMERIC_STEP_FIELDS = ["duration_seconds", "emphasis", "altitude_m", "tilt_deg", "revolutions"];
  const NUMERIC_PLACE_FIELDS = ["altitude_m", "tilt_deg"];

  function movementList(slot) {
    return (slot === "travel" ? TRAVEL_MOVEMENT_KEYS : AT_MOVEMENT_KEYS).map((k) => MOVEMENTS[k].label).join(", ");
  }

  function validateStepInput(rawStep, slot, at, errors) {
    const raw = restoreView(rawStep);
    if (typeof raw === "string") {
      const def = MOVEMENTS[raw];
      if (!raw.trim()) errors.push(`${at} has no movement type. Pick one of: ${movementList(slot)}.`);
      else if (!def || def.slot !== slot) errors.push(`${at} is "${raw}", which this generator cannot produce. Pick one of: ${movementList(slot)}.`);
      return;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${at} is not a movement. Each movement needs a type — pick one of: ${movementList(slot)}.`);
      return;
    }
    // Evidence carried by an already-normalized step wins: the original type is
    // what the operator asked for, not the safe default it was normalized to.
    const askedType = raw.unsupported_type !== undefined && raw.unsupported_type !== null ? String(raw.unsupported_type) : raw.type;
    if (!isPresent(askedType) || (typeof askedType === "string" && !askedType.trim())) {
      errors.push(`${at} has no movement type. Pick one of: ${movementList(slot)}.`);
    } else if (typeof askedType !== "string") {
      errors.push(`${at} has a movement type that is not a name (${JSON.stringify(askedType)}). Pick one of: ${movementList(slot)}.`);
    } else {
      const def = MOVEMENTS[askedType];
      if (!def || def.slot !== slot) errors.push(`${at} is "${askedType}", which this generator cannot produce. Pick one of: ${movementList(slot)}.`);
    }
    NUMERIC_STEP_FIELDS.forEach((k) => {
      if (isPresent(raw[k]) && !isFiniteLike(raw[k])) errors.push(`${at} has a ${k.replace(/_/g, " ")} that is not a number (${JSON.stringify(raw[k])}).`);
    });
    if (isPresent(raw.revolutions) && isFiniteLike(raw.revolutions) && Number(raw.revolutions) < 0) {
      errors.push(`${at} has negative revolutions (${raw.revolutions}). Use a positive number of turns, and set the direction to counterclockwise for the other way round.`);
    }
    if (isPresent(raw.direction) && Number(raw.direction) !== 1 && Number(raw.direction) !== -1) {
      errors.push(`${at} has direction ${JSON.stringify(raw.direction)}; use 1 (clockwise) or -1 (counterclockwise).`);
    }
    if (isPresent(raw.pace) && !PACE_PRESETS[raw.pace]) {
      errors.push(`${at} has pace "${raw.pace}", which is not one of: ${Object.keys(PACE_PRESETS).join(", ")}.`);
    }
    if (isPresent(raw.framing) && raw.framing !== "auto" && !FRAMING_SCALES[raw.framing]) {
      errors.push(`${at} has framing "${raw.framing}", which is not one of: auto, ${Object.keys(FRAMING_SCALES).join(", ")}.`);
    }
  }

  function validatePlaceInput(rawPlace, label, errors) {
    const raw = restoreView(rawPlace);
    if (raw === undefined || raw === null || typeof raw === "string") return; // bare name or absent: canonical checks handle it
    if (typeof raw !== "object" || Array.isArray(raw)) { errors.push(`${label} is not a place. Give a place name, or coordinates like 60.17,24.94.`); return; }
    if (isPresent(raw.framing) && raw.framing !== "auto" && !FRAMING_SCALES[raw.framing]) {
      errors.push(`${label} has framing "${raw.framing}", which is not one of: auto, ${Object.keys(FRAMING_SCALES).join(", ")}.`);
    }
    NUMERIC_PLACE_FIELDS.forEach((k) => {
      if (isPresent(raw[k]) && !isFiniteLike(raw[k])) errors.push(`${label} has a ${k.replace(/_/g, " ")} that is not a number (${JSON.stringify(raw[k])}).`);
    });
  }

  // Stage 1: RAW structure + intent validation. Runs on exactly what the caller
  // supplied (raw or already-normalized), before any canonicalization.
  function validateJourneyInput(rawJourney, options = {}) {
    const planner = loadPlanner(options.planner);
    const errors = [];
    if (!rawJourney || typeof rawJourney !== "object" || Array.isArray(rawJourney)) {
      return { ok: false, errors: ["This is not a camera journey. Send the journey object built by the journey builder."] };
    }
    const journey = restoreView(rawJourney);
    if (isPresent(journey.journey_version) && Number(journey.journey_version) !== JOURNEY_VERSION) {
      errors.push(`This journey is version ${JSON.stringify(journey.journey_version)}; this generator understands journey version ${JOURNEY_VERSION}.`);
    }
    if (isPresent(journey.pace) && !PACE_PRESETS[journey.pace]) {
      errors.push(`The journey pace "${journey.pace}" is not one of: ${Object.keys(PACE_PRESETS).join(", ")}.`);
    }
    if (isPresent(journey.aspect) && planner && planner.ASPECTS && !planner.ASPECTS[journey.aspect]) {
      errors.push(`The aspect "${journey.aspect}" is not one of: ${Object.keys(planner.ASPECTS).join(", ")}.`);
    }
    if (journey.start !== undefined && journey.start !== null && typeof journey.start === "object" && !Array.isArray(journey.start)) {
      const startView = restoreView(journey.start);
      if (isPresent(startView.source) && startView.source !== "location" && startView.source !== "continuation") {
        errors.push(`The start source "${startView.source}" is not one of: location, continuation.`);
      }
    }
    validatePlaceInput(journey.start, "The start location", errors);
    if (journey.start_movements !== undefined && journey.start_movements !== null && !Array.isArray(journey.start_movements)) {
      errors.push("Start movements must be a list of movements.");
    } else {
      (journey.start_movements || []).forEach((s, i) => validateStepInput(s, "at", `Start movement ${i + 1}`, errors));
    }
    if (journey.legs !== undefined && journey.legs !== null && !Array.isArray(journey.legs)) {
      errors.push("Destinations must be a list.");
    } else {
      (journey.legs || []).forEach((rawLeg, i) => {
        const label = `Destination ${i + 1}`;
        if (!rawLeg || typeof rawLeg !== "object" || Array.isArray(rawLeg)) { errors.push(`${label} is not a destination. Give it a place and its movements.`); return; }
        const leg = restoreView(rawLeg);
        validatePlaceInput(leg.destination, `${label}'s location`, errors);
        if (isPresent(leg.travel_style) && !TRAVEL_STYLES[leg.travel_style]) {
          errors.push(`${label} has travel style "${leg.travel_style}", which is not one of: ${Object.keys(TRAVEL_STYLES).join(", ")}.`);
        }
        if (leg.travel !== undefined && leg.travel !== null && !Array.isArray(leg.travel)) errors.push(`${label}'s travel must be a list of movements.`);
        else (leg.travel || []).forEach((s, k) => validateStepInput(s, "travel", `${label} travel movement ${k + 1}`, errors));
        if (leg.movements !== undefined && leg.movements !== null && !Array.isArray(leg.movements)) errors.push(`${label}'s movements must be a list.`);
        else (leg.movements || []).forEach((s, k) => validateStepInput(s, "at", `${label} movement ${k + 1}`, errors));
      });
    }
    return { ok: errors.length === 0, errors };
  }

  function validateJourney(journey, options = {}) {
    const planner = loadPlanner(options.planner);
    // Stage 1 — raw input authority. Refuse before normalization can soften anything.
    const raw = validateJourneyInput(journey, { planner });
    if (!raw.ok) return { ok: false, errors: raw.errors, warnings: [], compiled: null, journey: null };
    // Stage 2 — compatibility canonicalization; Stage 3 — canonical checks below.
    const j = normalizeJourney(journey);
    const errors = [];
    const warnings = [];

    const placeProblem = (info, label) => {
      if (info.reason === "missing") return `${label} has no place yet. Type a city, landmark, country, or coordinates like 60.17,24.94.`;
      if (info.reason === "punctuation") return `${label} "${info.text}" contains a comma or the word "then", which the generator reads as a new movement. Use a single plain name — "Helsinki", not "Helsinki, Finland".`;
      if (info.reason === "unknown") return `${label} "${info.text}" is not a place the generator knows. Pick one from the place list, or give coordinates like 60.17,24.94.`;
      return null;
    };

    if (j.start.source === "continuation") {
      const check = validateContinuationState(j.start.continuation);
      errors.push(...check.errors);
      if (!j.start.location) {
        warnings.push("The continuation start has no place name. The camera position is exact, but the journey summary will not be able to name where it begins.");
      }
    }
    const startInfo = resolvePlace(planner, j.start);
    if (j.start.source !== "continuation" || j.start.location) {
      const problem = placeProblem(startInfo, "The start location");
      if (problem) errors.push(problem);
    }

    if (!j.start_movements.length && !j.legs.length) {
      errors.push("This journey has nothing in it yet. Add an opening movement at the start location, or add a destination to travel to.");
    }

    const checkSteps = (steps, label) => {
      steps.forEach((step, i) => {
        const def = MOVEMENTS[step.type];
        const at = `${label} movement ${i + 1}`;
        // Unsupported / missing types were refused by validateJourneyInput
        // (stage 1) before we got here; defensively skip if evidence survived.
        if (step.unsupported_type !== undefined) return;
        if (step.duration_seconds === null) return;
        if (step.duration_seconds < 0) {
          errors.push(`${at} (${def ? def.label : step.type}) has a negative duration. Durations must be at least 1 second.`);
        } else if (step.duration_seconds === 0) {
          errors.push(`${at} (${def ? def.label : step.type}) is set to 0 seconds, so it would never play. Give it at least 1 second, or remove the movement.`);
        } else if (step.duration_seconds < 1) {
          warnings.push(`${at} (${def ? def.label : step.type}) is under a second — that is less than 30 frames and will read as a jump cut.`);
        }
      });
    };
    checkSteps(j.start_movements.map((s) => ({ ...s, slot: "at" })), "Start");

    j.legs.forEach((leg, i) => {
      const label = `Destination ${i + 1}`;
      const info = resolvePlace(planner, leg.destination);
      const hasTravel = leg.travel.length > 0;
      if (!leg.destination.location && hasTravel) {
        errors.push(`${label} has a travel movement but no destination location. Name the place the camera travels to, or remove the travel movement.`);
      } else {
        const problem = placeProblem(info, `${label}'s location`);
        if (problem) errors.push(problem);
      }
      if (!hasTravel && leg.destination.location) {
        const previous = i === 0 ? j.start.location : j.legs[i - 1].destination.location;
        if (previous && info.resolved) {
          warnings.push(`${label} (${info.resolved.name}) has no travel movement, so the camera will jump there rather than travel. Add a travel movement for a continuous shot.`);
        }
      }
      checkSteps(leg.travel.map((s) => ({ ...s, slot: "travel" })), `${label} travel`);
      checkSteps(leg.movements.map((s) => ({ ...s, slot: "at" })), label);
    });

    // Only compile when the shape is sound; a compile of a broken journey is
    // noise on top of the real errors.
    let compiled = null;
    if (!errors.length) {
      compiled = compileJourney(j, { planner });
      warnings.push(...compiled.warnings);
      const verified = verifyCompilation(compiled, { planner });
      if (!verified.ok) {
        errors.push(...verified.problems.map((p) => `Internal check failed — the generator would not build what the journey describes: ${p}. This is a bug; please report it with the journey.`));
      }
      if (compiled.total_duration_seconds <= 0) {
        errors.push("The whole journey adds up to zero seconds. Give at least one movement a duration.");
      }
    }

    return { ok: errors.length === 0, errors, warnings, compiled, journey: j };
  }

  // ── Summary / timeline ────────────────────────────────────────────────────
  function formatClock(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function formatAltitude(m) {
    const v = Number(m);
    if (!Number.isFinite(v)) return "—";
    if (v >= 100000) return `${Math.round(v / 1000).toLocaleString("en-US")} km`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)} km`;
    return `${Math.round(v)} m`;
  }

  // A distance below ~100 m means the two endpoints are effectively the same
  // point (e.g. a reveal that approaches the place it started over), where
  // printing "(0 m)" is noise rather than information.
  function formatDistance(m) {
    const v = Number(m);
    if (!Number.isFinite(v) || v < 100) return null;
    return v >= 1000 ? `${Math.round(v / 1000).toLocaleString("en-US")} km` : `${Math.round(v)} m`;
  }

  function sentenceFor(step, index) {
    const secs = `${round2(step.duration_seconds)} second${step.duration_seconds === 1 ? "" : "s"}`;
    const where = step.location_name || "the current location";
    const framing = step.framing_label ? String(step.framing_label).toLowerCase() : null;
    switch (step.movement) {
      case "hold":
      case "pause":
        return index === 0
          ? `Open on ${where} at ${formatAltitude(step.altitude_m)} (${framing} framing) and hold for ${secs} without moving the camera.`
          : `Hold on ${where} for ${secs} without moving the camera.`;
      case "slow_orbit":
        return `Slowly orbit ${where} ${step.orbit_direction === -1 ? "counterclockwise " : ""}for ${secs}.`;
      case "orbit":
        return `Orbit ${where} ${step.orbit_direction === -1 ? "counterclockwise " : ""}once over ${secs}.`;
      case "orbit_twice":
        return `Circle ${where} twice ${step.orbit_direction === -1 ? "counterclockwise " : ""}over ${secs}.`;
      case "half_orbit":
        return `Swing halfway around ${where} over ${secs}, finishing on the far side.`;
      case "spiral_in":
        return `Spiral in around ${where} over ${secs}, closing to ${formatAltitude(step.altitude_m)}.`;
      case "spiral_out":
        return `Spiral out around ${where} over ${secs}, opening to ${formatAltitude(step.altitude_m)}.`;
      case "zoom_in":
        return `Push in on ${where} over ${secs} to a ${framing} framing at ${formatAltitude(step.altitude_m)}.`;
      case "zoom_out":
        return `Pull back from ${where} over ${secs} to a ${framing} framing at ${formatAltitude(step.altitude_m)}.`;
      case "reveal":
        return `Pull back over ${secs} to reveal ${where} at ${framing} scale (${formatAltitude(step.altitude_m)}).`;
      case "pull_back":
        return `Pull back from ${where} over ${secs} before setting off.`;
      case "climb_to_transit":
        return `Climb to ${formatAltitude(step.altitude_m)} over ${secs} — high enough to see the whole route.`;
      case "cruise": {
        const dist = formatDistance(step.distance_m);
        return `Cruise to ${where}${dist ? ` (${dist})` : ""} over ${secs}, holding ${formatAltitude(step.altitude_m)}.`;
      }
      case "fly":
      case "fly_high": {
        const dist = formatDistance(step.distance_m);
        return `Fly to ${where}${dist ? ` (${dist})` : ""} over ${secs}${step.movement === "fly_high" ? `, cruising at ${formatAltitude(step.altitude_m)}` : ""}.`;
      }
      case "fly_low": {
        const dist = formatDistance(step.distance_m);
        return `Come in low to ${where}${dist ? ` (${dist})` : ""} over ${secs}, tilted toward the horizon.`;
      }
      case "descend":
        return `Descend into ${where} over ${secs}, settling on a ${framing} framing at ${formatAltitude(step.altitude_m)}.`;
      default:
        return `${step.movement_label} at ${where} for ${secs}.`;
    }
  }

  function summarizeJourney(journey, options = {}) {
    const planner = loadPlanner(options.planner);
    const check = validateJourney(journey, { planner });
    const compiled = check.compiled || compileJourney(journey, { planner });
    const j = compiled.journey;
    const lines = [];

    const first = compiled.steps[0];
    if (j.start.source === "continuation") {
      const seed = compiled.initial_camera || {};
      lines.push(`Begin exactly where the previous animation ended${j.start.location ? ` (over ${j.start.location})` : ""}: ${formatAltitude(seed.altitude_m)} up, heading ${Math.round(((seed.pan_deg || 0) % 360 + 360) % 360)}deg, tilted ${round2(seed.tilt_deg)}deg.`);
    } else if (first) {
      lines.push(`Start over ${compiled.places.start.resolved ? compiled.places.start.resolved.name : j.start.location} with a ${String(first.framing_label).toLowerCase()} framing at ${formatAltitude(first.altitude_m)}.`);
    }
    compiled.steps.forEach((step, i) => lines.push(sentenceFor(step, i)));
    lines.push(`Estimated duration: ${Math.round(compiled.total_duration_seconds)} seconds (${formatClock(compiled.total_duration_seconds)}) at ${paceOf(j.pace).label.toLowerCase()} pace.`);

    // Compact route timeline: stops with the movements performed at them, and
    // the travel between.
    const timeline = [];
    const pushStop = (name, framing) => timeline.push({ kind: "stop", label: name, framing, movements: [] });
    pushStop(compiled.places.start.resolved ? compiled.places.start.resolved.name : (j.start.location || "Previous ending"),
      first ? first.framing_label : null);
    let cursorIndex = 0;
    j.start_movements.forEach(() => {
      const step = compiled.steps[cursorIndex++];
      if (step) timeline[timeline.length - 1].movements.push({ icon: (MOVEMENTS[step.movement] || {}).icon || "·", label: step.movement_label, seconds: step.duration_seconds });
    });
    j.legs.forEach((leg, i) => {
      const travel = [];
      leg.travel.forEach(() => {
        const step = compiled.steps[cursorIndex++];
        if (step) travel.push({ icon: (MOVEMENTS[step.movement] || {}).icon || "·", label: step.movement_label, seconds: step.duration_seconds, distance_m: step.distance_m });
      });
      if (travel.length) timeline.push({ kind: "travel", steps: travel, seconds: Math.round(travel.reduce((a, b) => a + b.seconds, 0) * 100) / 100 });
      const dest = compiled.places.destinations[i];
      const movementsStart = cursorIndex;
      pushStop(dest.resolved ? dest.resolved.name : (leg.destination.location || `Destination ${i + 1}`), null);
      leg.movements.forEach(() => {
        const step = compiled.steps[cursorIndex++];
        if (step) timeline[timeline.length - 1].movements.push({ icon: (MOVEMENTS[step.movement] || {}).icon || "·", label: step.movement_label, seconds: step.duration_seconds });
      });
      const framingStep = compiled.steps[movementsStart] || compiled.steps[movementsStart - 1];
      if (framingStep) timeline[timeline.length - 1].framing = framingStep.framing_label;
    });

    return {
      prose: lines,
      text: lines.join("\n\n"),
      timeline,
      breakdown: compiled.steps.map((s) => ({
        label: `${s.movement_label}${s.location_name ? ` · ${s.location_name}` : ""}`,
        seconds: s.duration_seconds,
      })),
      total_duration_seconds: compiled.total_duration_seconds,
      total_clock: formatClock(compiled.total_duration_seconds),
      total_frames: Math.round(compiled.total_duration_seconds * planner.FRAME_RATE),
      ok: check.ok,
      errors: check.errors,
      warnings: check.warnings,
      description: compiled.description,
    };
  }

  // ── Continuation state ────────────────────────────────────────────────────
  // A continuation state is a CAMERA state, deliberately distinct from a
  // location: `camera` is where the lens is and how it points, `target` is the
  // semantic place the animation was looking at. Only the five values the .esp
  // actually keyframes appear under `camera` — longitude, latitude, altitude,
  // rotationX (pan/heading) and rotationY (tilt). Earth Studio's rotationZ
  // (roll) and fov are never keyframed by this generator, so they are not part
  // of a camera state and are NOT invented here.
  function continuationStateFromPlan(plan, options = {}) {
    const planner = loadPlanner(options.planner);
    const camera = planner.finalCameraState(plan);
    if (!camera) return null;
    const resolved = (plan.segments || []).filter((s) => s.location && s.duration_seconds > 0);
    const finalSegment = resolved.length ? resolved[resolved.length - 1] : null;
    return {
      continuation_state_version: CONTINUATION_STATE_VERSION,
      generated_by: "earth-studio-journey",
      planner_version: plan.version || planner.VERSION,
      motion_profile_version: (plan.motion_profile && plan.motion_profile.profile_version) || planner.MOTION_PROFILE_VERSION,
      source_animation: plan.job_name || null,
      timestamp: plan.generated_at || null,
      aspect: plan.aspect || null,
      frame_rate: plan.frame_rate || planner.FRAME_RATE,
      total_frames: plan.total_frames || null,
      ends_at_frame: plan.total_frames != null ? Math.max(0, plan.total_frames - 1) : null,
      // The camera state itself, in real-world units.
      camera: {
        latitude: camera.latitude,
        longitude: camera.longitude,
        altitude_m: camera.altitude_m,
        pan_deg: camera.pan_deg,
        heading_deg: camera.heading_deg,
        tilt_deg: camera.tilt_deg,
      },
      // How those values map onto the .esp attributes that carry them.
      esp_mapping: {
        longitude: "cameraPositionGroup.longitude",
        latitude: "cameraPositionGroup.latitude",
        altitude_m: "cameraPositionGroup.altitude",
        pan_deg: "cameraRotationGroup.rotationX",
        tilt_deg: "cameraRotationGroup.rotationY",
        not_keyframed: ["rotationZ", "fov", "exposure", "aperture", "minFocusLength"],
      },
      // Semantic, NOT camera: what the animation was looking at when it ended.
      target: finalSegment && finalSegment.location ? {
        name: finalSegment.location.name,
        latitude: finalSegment.location.latitude,
        longitude: finalSegment.location.longitude,
      } : null,
      final_movement: finalSegment ? {
        segment_id: finalSegment.segment_id,
        action: finalSegment.action,
        location_name: finalSegment.location_name,
      } : null,
    };
  }

  function validateContinuationState(state) {
    const errors = [];
    if (!state || typeof state !== "object") {
      return { ok: false, errors: ["No continuation state was supplied. Export one from a finished animation first, or start from a new location instead."] };
    }
    const v = state.continuation_state_version;
    if (v === undefined || v === null) {
      errors.push("That file is not an Earth Studio continuation state — it has no continuation_state_version. Use the file exported by \"Export continuation state\".");
    } else if (!Number.isInteger(Number(v))) {
      errors.push(`That continuation state's version ("${v}") is not a whole number, so it cannot be read.`);
    } else if (Number(v) > CONTINUATION_STATE_VERSION) {
      errors.push(`That continuation state is version ${v}, but this generator only understands version ${CONTINUATION_STATE_VERSION}. It was made by a newer version of the tool — regenerate it here, or update the tool.`);
    } else if (Number(v) < CONTINUATION_STATE_VERSION) {
      errors.push(`That continuation state is version ${v}, which this generator no longer reads (current version is ${CONTINUATION_STATE_VERSION}). Re-export it from the source animation.`);
    }
    const cam = state.camera;
    if (!cam || typeof cam !== "object") {
      errors.push("That continuation state has no camera block, so there is no camera position to continue from.");
    } else {
      const required = [["latitude", -90, 90], ["longitude", -180, 180], ["altitude_m", 0, Infinity], ["tilt_deg", -360, 360], ["pan_deg", -100000, 100000]];
      required.forEach(([field, lo, hi]) => {
        const value = Number(cam[field]);
        if (!Number.isFinite(value)) errors.push(`That continuation state's camera is missing a usable ${field.replace(/_/g, " ")}, so the starting camera cannot be reproduced.`);
        else if (value < lo || value > hi) errors.push(`That continuation state's camera ${field.replace(/_/g, " ")} (${cam[field]}) is outside the range Earth Studio accepts.`);
      });
    }
    return { ok: errors.length === 0, errors };
  }

  // Seed a NEW journey from a finished animation's ending state. The camera is
  // exact; the place name is carried across only as a LABEL (a continuation is
  // a camera state, not a location — see §21 of the data-model note above).
  function journeyFromContinuationState(state, options = {}) {
    const check = validateContinuationState(state);
    if (!check.ok) { const e = new Error(check.errors[0]); e.errors = check.errors; throw e; }
    return normalizeJourney({
      pace: options.pace || DEFAULT_PACE,
      aspect: options.aspect || state.aspect || null,
      start: {
        source: "continuation",
        location: (state.target && state.target.name) || "",
        framing: "auto",
        continuation: state,
      },
      start_movements: [newStep("hold", "at")],
      legs: options.destination ? [{
        destination: { location: options.destination, framing: "auto" },
        travel_style: "cinematic",
        travel: TRAVEL_STYLES.cinematic.steps.map((k) => newStep(k, "travel")),
        movements: [newStep("slow_orbit", "at")],
      }] : [],
    });
  }

  const api = {
    JOURNEY_VERSION,
    CONTINUATION_STATE_VERSION,
    numOrNull,
    normalizeStory,
    FRAMING_SCALES,
    SCALE_LADDER,
    SCALE_OVERRIDES,
    MOVEMENTS,
    AT_MOVEMENT_KEYS,
    TRAVEL_MOVEMENT_KEYS,
    TRAVEL_STYLES,
    PACE_PRESETS,
    DEFAULT_PACE,
    JOURNEY_PRESETS,
    applyPreset,
    newStep,
    normalizeJourney,
    normalizeStep,
    moveLeg,
    classifyScale,
    stepScale,
    maxTargetFramingTiltDeg,
    targetOffsetHalfFrames,
    orbitRingCapM,
    orbitCanFaceTarget,
    TARGET_FRAMING_MARGIN_FRACTION,
    TARGET_FRAMING_TILT_DEG,
    READABLE_SCREEN_SPEED_FW_PER_S,
    TRANSIT_LEGIBILITY_HEADROOM,
    frameWidthMeters,
    screenSpeedFrameWidths,
    readableTransitAltitudeM,
    spanForAltitudeM,
    scaleForSpanM,
    framingAltitudeM,
    transitAltitudeM,
    compileJourney,
    segmentSpecsFromCompiled,
    compileJourneyToParsed,
    verifyCompilation,
    verifyParsedEquivalence,
    validateJourneyInput,
    validateJourney,
    summarizeJourney,
    continuationStateFromPlan,
    validateContinuationState,
    journeyFromContinuationState,
    formatClock,
    formatAltitude,
    formatDistance,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.EarthStudioJourney = api;
})(typeof window !== "undefined" ? window : globalThis);
