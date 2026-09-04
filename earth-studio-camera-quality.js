'use strict';

const motionContinuity = require('./earth-studio-motion-continuity.js');

// Machine-checkable continuity evidence for generated Earth Studio jobs. This
// is additive and does not claim aesthetic approval.
const FINITE_TRACKS = ['longitude', 'latitude', 'altitude', 'rotationX', 'rotationY'];

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.values(node).forEach((value) => {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  });
}

function cameraTracks(esp) {
  const tracks = {};
  walk(esp, (node) => {
    if (FINITE_TRACKS.includes(node.type) && Array.isArray(node.keyframes)) tracks[node.type] = node;
  });
  return tracks;
}

function signChanges(numbers) {
  const signs = numbers.map((n) => Math.sign(n)).filter((n) => n !== 0);
  let changes = 0;
  for (let i = 1; i < signs.length; i += 1) if (signs[i] !== signs[i - 1]) changes += 1;
  return changes;
}

function trackReport(track) {
  const nums = (track && track.keyframes || []).map((keyframe) => Number(keyframe.value));
  const deltas = nums.slice(1).map((value, i) => value - nums[i]);
  return {
    keyframes: nums.length,
    finite: nums.every(Number.isFinite),
    duplicate_keyframes: nums.slice(1).filter((value, i) => value === nums[i]).length,
    direction_changes: signChanges(deltas),
  };
}

// ── Movement coherence ─────────────────────────────────────────────────────
// "One editorial action should normally produce one coherent camera action."
// Mathematical smoothness does not PROVE visual quality, but detectable
// oscillation in a track that should be monotonic is a defect.
//
// The longitude/latitude tracks describe the camera's GROUND PATH. Inside ONE
// travel move (fly_to / zoom_in / zoom_out) a clean A→B move commits to a
// direction and holds it. Direction reversals of a position track INSIDE such
// a segment mean the camera wandered, backtracked or oscillated while
// travelling. Reversals at SEGMENT BOUNDARIES are legitimate (a multi-stop
// journey turns at each stop), so the check is per-segment, not whole-track.
// Orbit segments are exempt: circling a subject reverses the ground path by
// definition — that is the shot.
const POSITION_TRACKS = ['longitude', 'latitude'];
// Tolerance of 1 inside one travel move: an intentional shaped departure that
// overshoots the straight line before committing reverses exactly once.
// Everything measured in production reads 0.
const POSITION_DIRECTION_TOLERANCE = 1;
const TRAVEL_ACTIONS = ['fly_to', 'zoom_in', 'zoom_out'];

function rollReport(esp) {
  let rollTrack = null;
  walk(esp, (node) => {
    if (node.type === 'rotationZ' && Array.isArray(node.keyframes)) rollTrack = node;
  });
  // rotationZ is never keyframed by this generator; if it appears at all it
  // was injected, and any non-zero value is camera roll — a defect by doctrine.
  if (rollTrack === null) return { present: false, non_zero: 0, keyframes: 0, max_abs_deg: 0 };
  const min = rollTrack.value ? Number(rollTrack.value.minValueRange) || 0 : 0;
  const max = rollTrack.value ? Number(rollTrack.value.maxValueRange) : NaN;
  const degrees = rollTrack.keyframes.map((keyframe) => {
    const raw = Number(keyframe.value);
    return Number.isFinite(max) ? raw * (max - min) + min : raw;
  });
  const nonZero = degrees.filter((value) => Math.abs(value) > SMOOTHNESS_TOLERANCES.roll_noise_deg).length;
  return { present: true, non_zero: nonZero, keyframes: rollTrack.keyframes.length,
    max_abs_deg: degrees.length ? Math.max(...degrees.map(Math.abs)) : 0 };
}

function directionChanges(nums) {
  const deltas = nums.slice(1).map((value, i) => value - nums[i]);
  return signChanges(deltas);
}

// Per-segment ground-path coherence. Needs the plan (segment bounds + actions)
// and the position tracks; returns one finding per offending travel segment.
function coherenceReport({ plan, tracks }) {
  const findings = [];
  const totalFrames = plan && plan.total_frames;
  const segments = (plan && plan.segments) || [];
  if (!totalFrames || !segments.length) return findings;
  segments.forEach((seg) => {
    if (!TRAVEL_ACTIONS.includes(seg.action)) return;
    const t0 = seg.start_frame / totalFrames;
    const t1 = seg.end_frame / totalFrames;
    POSITION_TRACKS.forEach((name) => {
      // Real units, and CONTINUOUS longitude: the exported track wraps at ±180°
      // with a one-frame +180/-180 seam pair, which is one meridian, not a
      // reversal. Counting sign changes on the wrapped values reported a
      // correct seam flight as "reverses 2 times".
      const decoded = denormalized(tracks[name], name)
        .filter((k) => k.time >= t0 - 1e-9 && k.time <= t1 + 1e-9)
        .map((k) => k.value);
      const keyframes = name === 'longitude' ? motionContinuity.unwrapDegrees(decoded) : decoded;
      if (keyframes.length < 2) return;
      const changes = directionChanges(keyframes);
      if (changes > POSITION_DIRECTION_TOLERANCE) {
        findings.push(`segment ${seg.segment_id} (${seg.action}${seg.location_name ? ' ' + seg.location_name : ''}) — its ground path reverses ${changes} times instead of committing to one move`);
      }
    });
  });
  return findings;
}


// ── Orbit geometry ─────────────────────────────────────────────────────────
// The ground-path coherence check above EXEMPTS orbit segments, because
// circling a subject reverses the ground path by definition. That exemption
// left orbits with no geometric check at all, and three visible defects lived
// in the gap: a ring that breathed 3.5% of its radius, a look direction that
// drifted 28 deg off the subject mid-orbit, and a cruise angular velocity that
// swung 142%. These measure the shot an orbit is supposed to be: a steady
// circle at a fixed distance with the subject pinned in frame.
//
// Reported as WARNINGS with their measured values. They are real defects, but
// promoting them to errors would flip the legacy freeform path (which still
// generates them) from PASS to FAIL, and that pass/fail change is not this
// module's call to make.
const ORBIT_RADIUS_BREATHING_TOLERANCE_PCT = 2;
const ORBIT_AIM_TOLERANCE_DEG = 2;
const ORBIT_TILT_TOLERANCE_DEG = 1;
const ORBIT_ENTRY_MAX_FRACTION = 0.40;
// ── Geometric truth authority ──────────────────────────────────────────────
// Every ground quantity in this module is measured on the sphere with the
// shared primitives in earth-studio-motion-continuity.js (haversine distance,
// spherical initial bearing, wrap-safe angle deltas), on CONTINUOUS longitude.
// The former `Δ° × 111320 × cos(lat)` tangent-plane arithmetic on wrapped
// longitude measured a correct ring straddling ±180° as 600% radius breathing
// and 125° of heading drift, and at high latitude its reverse-bearing
// convention (centre→camera + 180) could not see the real camera→subject
// heading error of a large ring (r·tan(lat)/R: 1.2° at 60°N / 80 km, 8.2° at
// 85°N). The diagnostic observes production; it must measure the geometry that
// actually exists, so real error stays visible and representation artifacts do
// not become verdicts. Thresholds are unchanged.
//
// AIM ERROR here is one specific quantity: the HORIZONTAL heading-to-subject
// error — |camera pan − spherical initial bearing from the camera to the orbit
// subject|. It is not the 3-D camera-ray error and does not include tilt.
const groundDistanceM = (a, b) => motionContinuity.haversineMeters(a, b);
const headingToSubjectErrorDeg = (camera, subject, panDeg) => Math.abs(motionContinuity.angleDeltaDeg(
  motionContinuity.initialBearing(camera, subject), panDeg));
// Decoded longitude keys re-expressed as one continuous sequence, so that
// interpolating across a serialization seam pair never passes through the far
// side of the globe.
const continuousLongitudeKeys = (keys) => {
  const values = motionContinuity.unwrapDegrees(keys.map((key) => key.value));
  return keys.map((key, index) => ({ time: key.time, value: values[index] }));
};
// Earth Studio's altitude encoding. Without this, `denormalized(..., 'altitude')`
// silently returned the RAW normalized value: ratios still came out right because
// both ends scale identically, but any figure reported in metres read as 0, and an
// altitude term mixed into a distance (the orbit dead-shot check) was inert.
const ALTITUDE_SCALE = 1.5356706349899208e-08;

// Real units back out of the normalized .esp encoding.
function denormalized(leaf, kind) {
  const keyframes = (leaf && leaf.keyframes) || [];
  const min = leaf && leaf.value ? Number(leaf.value.minValueRange) || 0 : 0;
  const max = leaf && leaf.value ? Number(leaf.value.maxValueRange) : undefined;
  return keyframes.map((keyframe) => {
    const raw = Number(keyframe.value);
    let value = raw;
    if (kind === 'longitude') value = raw * (180 - min) + min;
    else if (kind === 'latitude') value = raw * (90 - min) + min;
    else if (kind === 'pan') value = Number.isFinite(max) ? raw * (max - min) + min : raw;
    else if (kind === 'tilt') value = raw * 180;
    else if (kind === 'altitude') value = raw / ALTITUDE_SCALE;
    return { time: Number(keyframe.time), value };
  });
}

// Piecewise-linear read of a track. Orbit interiors are authored hard-linear on
// purpose, so linear reconstruction IS the played curve through a sweep.
function valueAt(keyframes, time) {
  if (!keyframes.length) return null;
  if (time <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 1; i < keyframes.length; i += 1) {
    if (time <= keyframes[i].time) {
      const a = keyframes[i - 1];
      const b = keyframes[i];
      const span = b.time - a.time;
      return span > 0 ? a.value + (b.value - a.value) * ((time - a.time) / span) : b.value;
    }
  }
  return last.value;
}

// An orbit has two phases and they have DIFFERENT rules.
//
//   Phase B, ring acquisition — the camera is allowed (indeed required) to
//   change radius, altitude and pitch here. It must do so without reversing,
//   without losing the subject, and within a bounded slice of the shot.
//
//   Phase C, the sweep — radius, altitude and pitch must all HOLD while only
//   the angle advances.
//
// Measuring the two together is what a naive check does, and it reports a
// correct hold-then-orbit as 109% radius breathing and 180 degrees of aim drift
// purely because the acquisition is inside the window. Splitting them is the
// difference between a gate the operator trusts and one they learn to ignore.
function orbitPhases({ plan, tracks, segment }) {
  const total = plan.total_frames;
  const centre = segment.location;
  const lat = denormalized(tracks.latitude, 'latitude');
  const lng = continuousLongitudeKeys(denormalized(tracks.longitude, 'longitude'));
  const pan = denormalized(tracks.rotationX, 'pan');
  const tilt = denormalized(tracks.rotationY, 'tilt');
  if (lat.length < 2 || lng.length < 2) return null;
  const t0 = segment.start_frame / total;
  const t1 = segment.end_frame / total;
  if (!(t1 > t0)) return null;
  const SAMPLES = 300;
  const rows = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const time = t0 + (t1 - t0) * (i / SAMPLES);
    const camera = { latitude: valueAt(lat, time), longitude: valueAt(lng, time) };
    const radius = groundDistanceM(centre, camera);
    let aim = null;
    if (pan.length) {
      // At the ring's centre the bearing is undefined; an aim error there is a
      // measurement artifact, not a camera defect.
      aim = radius > 10 ? headingToSubjectErrorDeg(camera, centre, valueAt(pan, time)) : null;
    }
    rows.push({ radius, aim, tilt: tilt.length ? valueAt(tilt, time) : null,
      point: { lat: camera.latitude, lng: camera.longitude } });
  }
  const ring = Number(segment.orbit_ring_radius_m);
  const target = Number.isFinite(ring) && ring > 0
    ? ring
    : rows.slice(Math.floor(rows.length / 2)).reduce((a, r) => a + r.radius, 0) / Math.ceil(rows.length / 2);
  // Acquisition ends once radius has converged AND pitch has stopped moving.
  let acquired = 0;
  const limit = Math.floor(rows.length * ORBIT_ENTRY_MAX_FRACTION);
  for (let i = 1; i <= limit && i < rows.length; i += 1) {
    const offRing = target > 1 && Math.abs(rows[i].radius - target) > 0.02 * target;
    const pitchMoving = rows[i].tilt !== null && Math.abs(rows[i].tilt - rows[i - 1].tilt) > 1e-4;
    if (offRing || pitchMoving) acquired = i + 1;
  }
  return { rows, target, acquired, samples: rows.length };
}

// A requested orbit that never leaves its own starting point. See the call site
// for why this is an error rather than a warning.
const DEAD_ORBIT_MIN_ARC_DEG = 15;
const DEAD_ORBIT_MIN_DISPLACEMENT_M = 5;
function deadOrbitReport({ plan, tracks }) {
  const out = [];
  const total = plan && plan.total_frames;
  const segments = (plan && plan.segments || []).filter((s) => s && s.location && s.duration_seconds > 0);
  const lat = denormalized(tracks.latitude, 'latitude');
  const lng = continuousLongitudeKeys(denormalized(tracks.longitude, 'longitude'));
  const alt = denormalized(tracks.altitude, 'altitude');
  if (!total || lat.length < 2 || lng.length < 2) return out;
  for (const segment of segments) {
    if (segment.action !== 'orbit') continue;
    const arc = Math.abs(Number(segment.orbit_degrees) || 0);
    if (!(arc >= DEAD_ORBIT_MIN_ARC_DEG)) continue;
    const t0 = segment.start_frame / total;
    const t1 = segment.end_frame / total;
    if (!(t1 > t0)) continue;
    const start = { latitude: valueAt(lat, t0), longitude: valueAt(lng, t0) };
    const alt0 = alt.length ? valueAt(alt, t0) : 0;
    const SAMPLES = 300;
    let moved = 0;
    for (let i = 0; i <= SAMPLES; i += 1) {
      const time = t0 + (t1 - t0) * (i / SAMPLES);
      const ground = groundDistanceM(start, { latitude: valueAt(lat, time), longitude: valueAt(lng, time) });
      const dz = alt.length ? valueAt(alt, time) - alt0 : 0;
      moved = Math.max(moved, Math.hypot(ground, dz));
    }
    if (moved >= DEAD_ORBIT_MIN_DISPLACEMENT_M) continue;
    // The ring the engine actually rode: a terrain focal point's ring is
    // measured from its declared elevation (plan.terrain_pose), others from
    // sea level.
    const ring = segment.terrain_pose && Number.isFinite(segment.terrain_pose.ring_radius_m)
      ? segment.terrain_pose.ring_radius_m
      : Number.isFinite(segment.altitude_m) && Number.isFinite(segment.tilt_deg)
        ? segment.altitude_m * Math.tan((segment.tilt_deg * Math.PI) / 180) : null;
    out.push(`segment ${segment.segment_id || '?'} requests a ${Math.round(arc)}\u00b0 orbit but the camera never moves `
      + `(${moved.toFixed(1)} m of travel across the whole movement`
      + (Number.isFinite(segment.tilt_deg) ? `, tilt ${segment.tilt_deg}\u00b0` : '')
      + (Number.isFinite(ring) ? `, ring radius ${ring.toFixed(0)} m` : '')
      + `) \u2014 only the heading turns, so this plays as the map rotating under a stationary camera, not as an orbit.`);
  }
  return out;
}

// GENERAL DEAD-SHOT LAW — "a requested movement must materially perform the
// movement it names".
//
// The orbit case above is one instance. The same class of failure exists for every
// movement whose name is a promise:
//
//   push in / descend   must end materially CLOSER
//   pull back / reveal  must end materially WIDER
//   fly                 must actually TRAVEL, when it names a different place
//
// This is not an aesthetic judgement. "Push in on Helsinki Cathedral" once
// produced 1418 m -> 1418 m with a single position keyframe: a requested approach
// that played as a static shot. That should never have needed a human to notice.
//
// Each action gets its OWN test, because one distance threshold cannot serve a
// globe zoom and a landmark nudge. Framing moves are judged on RELATIVE change in
// framing altitude — the quantity the planner uses to express framing — and travel
// on ground distance, but only when the movement names a different subject.
//
// The bands are set far below anything the generator legitimately produces.
// Measured across the 14-case acceptance set: the weakest real push ends at 0.447
// of its starting altitude, the weakest real reveal at 1.923x, and the shortest
// real fly travels 100 m. So:
//
//   DEGENERATE (error)  no change at all, or change in the WRONG direction
//   WEAK (warning)      right direction, but under a few percent
//
// Holds are exempt by construction: a hover's whole purpose is to not move, and it
// never reaches these checks.
const DEAD_MOVE_DEGENERATE_FRACTION = 0.005;   // 0.5% — indistinguishable from no change
const DEAD_MOVE_WEAK_FRACTION = 0.05;          // 5% — real but very slight
const DEAD_FLY_DEGENERATE_M = 25;              // shortest real fly measured: 100 m
const FRAMING_ACTIONS = { zoom_in: 'closer', zoom_out: 'wider' };
function deadMovementReport({ plan, tracks }) {
  const errors = [];
  const warnings = [];
  const total = plan && plan.total_frames;
  const segments = (plan && plan.segments || []).filter((s) => s && s.location && s.duration_seconds > 0);
  const lat = denormalized(tracks.latitude, 'latitude');
  const lng = continuousLongitudeKeys(denormalized(tracks.longitude, 'longitude'));
  const alt = denormalized(tracks.altitude, 'altitude');
  if (!total || !alt.length) return { errors, warnings };
  const sameResolved = (a, b) => a && b
    && Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6;
  segments.forEach((segment, index) => {
    const t0 = segment.start_frame / total;
    const t1 = segment.end_frame / total;
    if (!(t1 > t0)) return;
    const want = FRAMING_ACTIONS[segment.action];
    if (want) {
      const from = valueAt(alt, t0);
      const to = valueAt(alt, t1);
      if (!(from > 0) || !Number.isFinite(to)) return;
      // Signed change in the direction the movement PROMISES.
      const change = want === 'closer' ? (from - to) / from : (to - from) / from;
      const label = `segment ${segment.segment_id || '?'} (${segment.action})`;
      const detail = `${from.toFixed(0)} m -> ${to.toFixed(0)} m`;
      if (change <= DEAD_MOVE_DEGENERATE_FRACTION) {
        errors.push(`${label} asks the camera to move ${want} but its framing altitude goes ${detail} `
          + `(${(change * 100).toFixed(2)}% ${want}) — the movement does not perform the movement it names.`);
      } else if (change < DEAD_MOVE_WEAK_FRACTION) {
        warnings.push(`${label} moves only ${(change * 100).toFixed(1)}% ${want} (${detail}) — `
          + `weak for a movement whose whole purpose is that change.`);
      }
      return;
    }
    if (segment.action !== 'fly_to') return;
    // A fly that names the place it is already at is a legitimate preparatory
    // step (a climb-out before a crossing), so travel is only promised when the
    // resolved subject actually changes.
    const previous = segments[index - 1];
    if (!previous || !previous.location) return;
    if (sameResolved(previous.location, segment.location)) return;
    const travelled = groundDistanceM({ latitude: valueAt(lat, t0), longitude: valueAt(lng, t0) },
      { latitude: valueAt(lat, t1), longitude: valueAt(lng, t1) });
    if (travelled < DEAD_FLY_DEGENERATE_M) {
      errors.push(`segment ${segment.segment_id || '?'} (fly_to) names `
        + `${segment.location.name || 'another place'} but the camera travels ${travelled.toFixed(1)} m `
        + `from where it started — a flight to a different subject that never leaves.`);
    }
  });
  return { errors, warnings };
}

function orbitReport({ plan, tracks }) {
  const findings = [];
  const total = plan && plan.total_frames;
  const segments = ((plan && plan.segments) || []).filter((seg) => seg.action === 'orbit'
    && seg.location && seg.duration_seconds > 0);
  if (!total || !segments.length) return findings;

  const seededOpeningState = !!(plan && plan.initial_camera);
  segments.forEach((segment) => {
    const phase = orbitPhases({ plan, tracks, segment });
    if (!phase) return;
    const { rows, target, acquired, samples } = phase;
    const label = `segment ${segment.segment_id}${segment.location_name ? ' ' + segment.location_name : ''}`;

    // ── Phase C: the sweep must hold its geometry ──────────────────────────
    const sweep = rows.slice(Math.max(acquired, 1));
    if (sweep.length > 4) {
      const radii = sweep.map((r) => r.radius);
      const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
      if (mean > 1) {
        const breathing = (100 * (Math.max(...radii) - Math.min(...radii))) / mean;
        if (breathing > ORBIT_RADIUS_BREATHING_TOLERANCE_PCT) {
          findings.push(`${label} — its orbit radius breathes ${breathing.toFixed(1)}% of ${Math.round(mean)}m during the sweep, so the camera visibly pulses closer and further while circling`);
        }
      }
      const aims = sweep.map((r) => r.aim).filter((a) => a !== null);
      if (aims.length && Math.max(...aims) > ORBIT_AIM_TOLERANCE_DEG) {
        findings.push(`${label} — its look direction drifts ${Math.max(...aims).toFixed(1)}° off the subject during the sweep, so the subject slides across frame instead of staying put`);
      }
      const tilts = sweep.map((r) => r.tilt).filter((t) => t !== null);
      if (tilts.length) {
        const swing = Math.max(...tilts) - Math.min(...tilts);
        if (swing > ORBIT_TILT_TOLERANCE_DEG) {
          findings.push(`${label} — its tilt moves ${swing.toFixed(1)}° during the sweep; once circling, an orbit should hold its pitch`);
        }
      }
    }

    // ── Phase B: acquisition must be deliberate, not a spring or a slide ───
    if (acquired > 1) {
      const entry = rows.slice(0, acquired).map((r) => r.radius);
      // Below the polygonization amplitude of the sweep's own sampling this
      // would measure the polygon, not an overshoot.
      const noiseFloor = 0.005 * Math.max(target, 1);
      let direction = 0;
      let reversals = 0;
      for (let i = 1; i < entry.length; i += 1) {
        const delta = entry[i] - entry[i - 1];
        if (Math.abs(delta) < noiseFloor) continue;
        const sign = Math.sign(delta);
        if (direction && sign !== direction) reversals += 1;
        direction = sign;
      }
      if (reversals > 0) {
        findings.push(`${label} — while moving onto the orbit ring its radius reverses ${reversals} time(s), so the camera overshoots the ring and springs back instead of settling onto it`);
      }
      const entryAims = rows.slice(0, acquired).map((r) => r.aim).filter((a) => a !== null);
      if (entryAims.length && Math.max(...entryAims) > ORBIT_AIM_TOLERANCE_DEG) {
        findings.push(`${label} — while moving onto the orbit ring the camera is up to ${Math.max(...entryAims).toFixed(1)}° off the subject, so it loses what it is circling before it starts circling`);
      }
      if (acquired / samples > ORBIT_ENTRY_MAX_FRACTION) {
        findings.push(`${label} — moving onto the orbit ring takes ${(100 * acquired / samples).toFixed(0)}% of the shot, so most of what was asked for as an orbit is spent getting into position`);
      }
    } else if (rows.length) {
      // No acquisition phase: frame one must already BE the orbit geometry.
      if (target > 1 && Math.abs(rows[0].radius - target) > 0.05 * target) {
        findings.push(`${label} — the orbit begins ${Math.round(Math.abs(rows[0].radius - target))}m off its ${Math.round(target)}m ring with no move onto it, so the camera slides sideways onto the circle while already sweeping`);
      }
    }

    // STAGING PROMISE. When the plan says the preceding hold was staged on this
    // orbit's ring, the orbit must actually start there. A staged hold that
    // still leaves the camera off the ring is a broken promise: the operator
    // was given an establishing composition that does not match the movement it
    // was composed for, and the orbit pays for it in correction.
    //
    // This is intent-aware on purpose. An UNSTAGED hold before an orbit is not
    // flagged — that is a legitimate deliberate acquisition (an explicit
    // top-down hold, a continuation seed, a hold of a previous camera), and
    // hard-failing it would punish exactly the cases the fallback exists for.
    // EXIT ALIGNMENT. If this orbit is followed by travel to somewhere else,
    // its last motion should already be heading that way — otherwise the camera
    // finishes the circle pointing the wrong direction and the next movement
    // yanks it round. Measured before the fix: 176 deg off on a staged
    // hold -> orbit -> travel, i.e. leaving almost exactly backwards.
    //
    // Warning only, and only when an alignment was POSSIBLE: a standalone orbit
    // has nothing to align to, and a continuation-seeded opening cannot be
    // rephased. Tolerance is generous because the solver optimises a tangent,
    // not a bearing, and a partial arc cannot always reach the ideal phase.
    if (rows.length > 4) {
      const idx = segments.indexOf(segment);
      const all = (plan && plan.segments) || [];
      const here = all.indexOf(segment);
      let destination = null;
      for (let j = here + 1; j < all.length; j += 1) {
        const cand = all[j];
        if (!cand.location || !(cand.duration_seconds > 0)) continue;
        if (cand.action === 'orbit') break;
        if (!TRAVEL_ACTIONS.includes(cand.action)) continue;
        if (groundDistanceM(segment.location, cand.location) > 5000) { destination = cand; break; }
      }
      if (destination && !seededOpeningState) {
        const bearing = (from, to) => motionContinuity.initialBearing(
          { latitude: from.lat, longitude: from.lng }, { latitude: to.lat, longitude: to.lng });
        const n = rows.length;
        const a = rows[n - 4];
        const b = rows[n - 1];
        if (a && b && a.point && b.point) {
          const motion = bearing({ lat: a.point.lat, lng: a.point.lng }, { lat: b.point.lat, lng: b.point.lng });
          const toward = bearing({ lat: b.point.lat, lng: b.point.lng },
            { lat: destination.location.latitude, lng: destination.location.longitude });
          let err = motion - toward;
          while (err > 180) err -= 360;
          while (err < -180) err += 360;
          if (Math.abs(err) > 60) {
            findings.push(`${label} — it finishes circling ${Math.abs(err).toFixed(0)}° away from the direction it then travels to segment ${destination.segment_id}, so the next movement has to swing the camera round before it can leave`);
          }
        }
      }
    }

    // A CONTINUATION opening is authoritative: frame 0 belongs to the previous
    // animation and is never repositioned, so staging cannot be delivered there
    // and the acquisition fallback is the correct outcome, not a broken promise.
    const seededOpening = !!(plan && plan.initial_camera);
    const stagedBy = seededOpening
      ? null
      : ((plan && plan.segments) || []).find((sg) => sg.stages_orbit_entry === segment.segment_id);
    if (stagedBy && rows.length) {
      if (target > 1 && Math.abs(rows[0].radius - target) > 0.05 * target) {
        findings.push(`${label} — segment ${stagedBy.segment_id} is staged on this orbit's ring, but the orbit still begins ${Math.round(Math.abs(rows[0].radius - target))}m off the ${Math.round(target)}m ring`);
      }
      if (rows[0].tilt !== null && Math.abs(rows[0].tilt - Number(segment.tilt_deg)) > ORBIT_TILT_TOLERANCE_DEG) {
        findings.push(`${label} — segment ${stagedBy.segment_id} is staged for this orbit, but the orbit begins at pitch ${rows[0].tilt.toFixed(1)}° instead of its own ${Number(segment.tilt_deg).toFixed(1)}°`);
      }
      if (acquired > 1) {
        findings.push(`${label} — segment ${stagedBy.segment_id} is staged on this orbit's ring, yet the orbit still spends ${(100 * acquired / samples).toFixed(0)}% of itself moving into position`);
      }
    }
  });
  return findings;
}

// Per-segment reversal count for the scalar tracks. Inside ONE movement the
// altitude and the pitch should each commit to a direction; a reversal there is
// the camera lurching mid-move. Boundaries between movements are legitimate
// turning points and are not counted.
const SCALAR_TRACK_TOLERANCE = 1;

// ── Production-wide smoothness doctrine ───────────────────────────────────
// Units matter. These are deliberately separate rather than one magic wobble
// number shared by metres, degrees and normalized rates.
const SMOOTHNESS_TOLERANCES = Object.freeze({
  // Metres. Sub-metre altitude changes are below useful authored camera
  // precision and should not turn floating noise into an altitude correction.
  altitude_noise_m: 0.5,
  // Fraction of a segment's intentional altitude range. A reversal must exceed
  // both this relative floor and the absolute metre floor to be a pump.
  altitude_reversal_fraction: 0.0025,
  // Degrees. Two hundredths is well below a visible pitch correction while
  // remaining above serialized/keyframe rounding noise.
  tilt_noise_deg: 0.02,
  // Fraction of intentional tilt range used with the absolute degree floor.
  tilt_reversal_fraction: 0.005,
  // Percent of mean ground radius. Accepted 10-degree rings measure about
  // 0.38%; 4% sits above that evidence and above the old 30-degree chord model.
  radius_breathing_hard_pct: 4,
  // Metres. Radial reversals smaller than this are geometry/rounding noise.
  radius_reversal_noise_m: 5,
  // Degrees. Existing accepted target-locked orbits stay below 2 degrees; five
  // degrees is a hard structural miss rather than a composition preference.
  target_drift_hard_deg: 5,
  // Degrees. Serialized angular steps below this are treated as equality/noise.
  angular_reversal_noise_deg: 0.001,
  // Degrees/second. Absolute floor for changes in heading speed.
  heading_speed_noise_dps: 0.05,
  // Fraction of median cruise speed. Smaller fluctuations are not counted as
  // a new acceleration/deceleration phase.
  heading_speed_pulse_fraction: 0.12,
  // Count of meaningful acceleration-direction changes inside cruise. A normal
  // launch→cruise→settle has at most one; two indicates repeated pulsing.
  heading_speed_pulse_changes: 2,
  // Dimensionless |after-before| / local speed scale. Calibration fixtures
  // tolerate small representation differences; a 65% rate seam is substantial.
  boundary_velocity_discontinuity: 0.65,
  // Unit-specific rate floors prevent divisions by numerical zero.
  boundary_position_floor_mps: 1,
  boundary_altitude_floor_mps: 0.5,
  boundary_angle_floor_dps: 0.05,
  // Degrees between consecutive ground-velocity vectors. Authenticated Earth
  // Studio travel→orbit handoffs measured 0.34–5.10° per frame, while the
  // confirmed orbit→travel seam measured 73.12° and its offline proxy 72.55°.
  boundary_direction_snap_deg: 30,
  // Metres/second. Direction is undefined at rest; both sides must exceed this
  // floor before a velocity-vector angle can become a hard defect.
  boundary_direction_speed_floor_mps: 1,
  // Frames. Cross-track acceleration peaks within two frames on calibrated
  // clean handoffs. Larger offsets remain advisory because custom-handle
  // playback is only approximately reconstructed offline.
  boundary_channel_phase_warning_frames: 8,
  // Degrees. Normal VIDTOOLZ motion has zero roll; this ignores only encoded
  // numerical residue while still rejecting any intentional-looking roll key.
  roll_noise_deg: 0.01,
});

function defectRecord({ defectClass, parameter, segment, before = null, after = null,
  frameStart, frameEnd, measured, threshold, explanation, severity = 'error' }) {
  return {
    defect_class: defectClass,
    parameter,
    segment_id: segment && segment.segment_id != null ? segment.segment_id : null,
    primitive_before: before || (segment && segment.action) || null,
    primitive_after: after || (segment && segment.action) || null,
    frame_start: Math.max(0, Math.round(Number(frameStart) || 0)),
    frame_end: Math.max(0, Math.round(Number(frameEnd) || 0)),
    measured_value: measured,
    threshold,
    explanation,
    severity,
  };
}

function motionEnvelope(segment) {
  const explicit = String(segment && (segment.motion_envelope || segment.radius_envelope
    || segment.altitude_envelope) || '').toLowerCase();
  const action = String(segment && segment.action || '').toLowerCase();
  if (action === 'hold' || action === 'hover') return 'HOLD';
  if (action === 'orbit') {
    if (/descend|fall|lower/.test(explicit)) return 'DESCENDING_ORBIT';
    if (/ascend|climb|rise/.test(explicit)) return 'ASCENDING_ORBIT';
    if (/pull|increas|outward/.test(explicit)) return 'PULLBACK_ORBIT';
    if (/approach|decreas|inward/.test(explicit)) return 'APPROACH_ORBIT';
    return 'CONSTANT_RADIUS_ORBIT';
  }
  if (action === 'zoom_out') return 'REVEAL';
  if (action === 'zoom_in') return 'APPROACH';
  if (action === 'fly_to') return 'STRAIGHT_TRAVEL';
  return 'UNKNOWN';
}

function sortedTimedSamples(samples, { angular = false } = {}) {
  const sorted = (samples || []).map((sample) => ({ ...sample, time: Number(sample.time), value: Number(sample.value) }))
    .filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.value))
    .sort((a, b) => a.time - b.time)
    .filter((sample, index, rows) => index === 0 || sample.time > rows[index - 1].time);
  const values = angular ? motionContinuity.unwrapDegrees(sorted.map((sample) => sample.value))
    : sorted.map((sample) => sample.value);
  return sorted.map((sample, index) => ({ ...sample, value: values[index] }));
}

function timeAwareDerivatives(samples) {
  const rows = sortedTimedSamples(samples);
  const velocity = [];
  for (let index = 1; index < rows.length; index += 1) {
    const dt = rows[index].time - rows[index - 1].time;
    if (!(dt > 0)) continue;
    velocity.push({
      time: (rows[index].time + rows[index - 1].time) / 2,
      frame_start: rows[index - 1].frame,
      frame_end: rows[index].frame,
      value: (rows[index].value - rows[index - 1].value) / dt,
    });
  }
  const acceleration = [];
  for (let index = 1; index < velocity.length; index += 1) {
    const dt = velocity[index].time - velocity[index - 1].time;
    if (!(dt > 0)) continue;
    acceleration.push({
      time: (velocity[index].time + velocity[index - 1].time) / 2,
      frame_start: velocity[index - 1].frame_end,
      frame_end: velocity[index].frame_end,
      value: (velocity[index].value - velocity[index - 1].value) / dt,
    });
  }
  return { samples: rows, velocity, acceleration };
}

function segmentSamples(leaf, kind, segment, plan, angular = false) {
  if (!leaf || !plan || !(plan.total_frames > 0) || !(plan.total_duration_seconds > 0)) return [];
  const decoded = denormalized(leaf, kind);
  const t0 = segment.start_frame / plan.total_frames;
  const t1 = segment.end_frame / plan.total_frames;
  if (!(t1 > t0) || !decoded.length) return [];
  const times = [t0, ...decoded.filter((key) => key.time > t0 + 1e-9 && key.time < t1 - 1e-9)
    .map((key) => key.time), t1];
  const values = times.map((time) => valueAt(decoded, time));
  const unwrapped = angular ? motionContinuity.unwrapDegrees(values) : values;
  return times.map((time, index) => ({
    time: time * plan.total_duration_seconds,
    frame: time * plan.total_frames,
    value: unwrapped[index],
  }));
}

function reversalEvents(samples, absoluteNoise, relativeNoise = 0) {
  if (samples.length < 3) return [];
  const values = samples.map((sample) => sample.value);
  const range = Math.max(...values) - Math.min(...values);
  const tolerance = Math.max(absoluteNoise, range * relativeNoise);
  let direction = 0;
  const events = [];
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].value - samples[index - 1].value;
    if (Math.abs(delta) <= tolerance) continue;
    const sign = Math.sign(delta);
    if (direction && sign !== direction) events.push({ index, delta, tolerance,
      frame_start: samples[index - 1].frame, frame_end: samples[index].frame });
    direction = sign;
  }
  return events;
}

function scalarPumpDefects({ plan, tracks }) {
  const defects = [];
  const segments = (plan && plan.segments) || [];
  for (const segment of segments) {
    if (!(segment.duration_seconds > 0)) continue;
    const envelope = motionEnvelope(segment);
    for (const spec of [
      { track: 'altitude', kind: 'altitude', parameter: 'altitude', defect: 'ALTITUDE_PUMP',
        absolute: SMOOTHNESS_TOLERANCES.altitude_noise_m, relative: SMOOTHNESS_TOLERANCES.altitude_reversal_fraction },
      { track: 'rotationY', kind: 'tilt', parameter: 'tilt', defect: 'TILT_PUMP',
        absolute: SMOOTHNESS_TOLERANCES.tilt_noise_deg, relative: SMOOTHNESS_TOLERANCES.tilt_reversal_fraction },
    ]) {
      const samples = segmentSamples(tracks[spec.track], spec.kind, segment, plan);
      if (samples.length < 3) continue;
      const events = reversalEvents(samples, spec.absolute, spec.relative);
      for (const event of events) {
        defects.push(defectRecord({ defectClass: spec.defect, parameter: spec.parameter, segment,
          frameStart: event.frame_start, frameEnd: event.frame_end,
          measured: Math.abs(event.delta), threshold: event.tolerance,
          explanation: `${spec.parameter} reverses locally inside the ${envelope} envelope instead of following one coherent progression` }));
      }
    }
  }
  return defects;
}

function radiusAndTargetDefects({ plan, tracks }) {
  const defects = [];
  for (const segment of ((plan && plan.segments) || []).filter((row) => row.action === 'orbit' && row.location)) {
    const phase = orbitPhases({ plan, tracks, segment });
    if (!phase || phase.rows.length < 4) continue;
    const envelope = motionEnvelope(segment);
    const explicitRadialEnvelope = envelope === 'PULLBACK_ORBIT' || envelope === 'APPROACH_ORBIT';
    const explicitConstant = String(segment.radius_envelope || '').toLowerCase() === 'constant';
    const rows = explicitRadialEnvelope || explicitConstant ? phase.rows : phase.rows.slice(Math.max(phase.acquired, 1));
    if (rows.length < 4) continue;
    const radii = rows.map((row) => row.radius);
    const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    if (explicitRadialEnvelope) {
      const samples = radii.map((value, index) => ({ value, frame: segment.start_frame
        + (segment.end_frame - segment.start_frame) * index / Math.max(1, radii.length - 1) }));
      const events = reversalEvents(samples, SMOOTHNESS_TOLERANCES.radius_reversal_noise_m, 0.0025);
      for (const event of events) defects.push(defectRecord({ defectClass: 'RADIUS_BREATHING', parameter: 'camera_target_radius', segment,
        frameStart: event.frame_start, frameEnd: event.frame_end, measured: Math.abs(event.delta), threshold: event.tolerance,
        explanation: `radius reverses inside the intentional ${envelope} progression` }));
    } else if (mean > 1) {
      const spread = 100 * (Math.max(...radii) - Math.min(...radii)) / mean;
      if (spread > SMOOTHNESS_TOLERANCES.radius_breathing_hard_pct) defects.push(defectRecord({
        defectClass: 'RADIUS_BREATHING', parameter: 'camera_target_radius', segment,
        frameStart: segment.start_frame, frameEnd: segment.end_frame, measured: spread,
        threshold: SMOOTHNESS_TOLERANCES.radius_breathing_hard_pct,
        explanation: 'constant-radius orbit departs materially from its planned ring',
      }));
    }
    const aims = rows.map((row) => row.aim).filter(Number.isFinite);
    const maxAim = aims.length ? Math.max(...aims) : 0;
    if (maxAim > SMOOTHNESS_TOLERANCES.target_drift_hard_deg) defects.push(defectRecord({
      defectClass: 'TARGET_DRIFT', parameter: 'pan_target_alignment', segment,
      frameStart: segment.start_frame, frameEnd: segment.end_frame, measured: maxAim,
      threshold: SMOOTHNESS_TOLERANCES.target_drift_hard_deg,
      explanation: 'camera heading drifts materially away from the fixed orbit target',
    }));
  }
  return defects;
}

function headingDefects({ plan, tracks }) {
  const defects = [];
  for (const segment of ((plan && plan.segments) || []).filter((row) => row.action === 'orbit')) {
    const samples = segmentSamples(tracks.rotationX, 'pan', segment, plan, true);
    if (samples.length < 4) continue;
    const direction = motionContinuity.angularDirectionReport(samples.map((sample) => sample.value), {
      expectedSign: Number(segment.orbit_direction) || 0,
      toleranceDeg: SMOOTHNESS_TOLERANCES.angular_reversal_noise_deg,
    });
    if (!direction.monotonic) defects.push(defectRecord({ defectClass: 'HEADING_REVERSAL', parameter: 'pan', segment,
      frameStart: samples[direction.reverse_steps[0].from_index].frame,
      frameEnd: samples[direction.reverse_steps.at(-1).to_index].frame,
      measured: direction.reverse_displacement_deg,
      threshold: SMOOTHNESS_TOLERANCES.angular_reversal_noise_deg,
      explanation: 'unwrapped orbit heading reverses against the intended orbit direction' }));
    const derivatives = timeAwareDerivatives(samples);
    const span = segment.end_frame - segment.start_frame;
    const cruise = derivatives.velocity.filter((row) => {
      const middle = ((row.frame_start + row.frame_end) / 2 - segment.start_frame) / span;
      return middle >= 0.2 && middle <= 0.8;
    });
    const speeds = cruise.map((row) => Math.abs(row.value));
    if (speeds.length < 4) continue;
    const sorted = [...speeds].sort((a, b) => a - b);
    const medianSpeed = sorted[Math.floor(sorted.length / 2)];
    const noise = Math.max(SMOOTHNESS_TOLERANCES.heading_speed_noise_dps,
      medianSpeed * SMOOTHNESS_TOLERANCES.heading_speed_pulse_fraction);
    const changes = speeds.slice(1).map((value, index) => value - speeds[index])
      .filter((value) => Math.abs(value) > noise);
    if (signChanges(changes) >= SMOOTHNESS_TOLERANCES.heading_speed_pulse_changes) defects.push(defectRecord({
      defectClass: 'HEADING_SPEED_PULSE', parameter: 'pan_angular_speed', segment,
      frameStart: cruise[0].frame_start, frameEnd: cruise.at(-1).frame_end,
      measured: signChanges(changes), threshold: SMOOTHNESS_TOLERANCES.heading_speed_pulse_changes,
      explanation: 'cruise repeatedly accelerates and decelerates instead of maintaining one coherent motion phase',
    }));
  }
  return defects;
}

function trajectoryDefects({ plan, tracks }) {
  const defects = [];
  for (const segment of ((plan && plan.segments) || []).filter((row) => TRAVEL_ACTIONS.includes(row.action))) {
    for (const [track, kind] of [['latitude', 'latitude'], ['longitude', 'longitude']]) {
      const samples = segmentSamples(tracks[track], kind, segment, plan, kind === 'longitude');
      const events = reversalEvents(samples, kind === 'longitude' ? 1e-7 : 1e-7, 0.001);
      if (events.length <= POSITION_DIRECTION_TOLERANCE) continue;
      defects.push(defectRecord({ defectClass: 'TRAJECTORY_REVERSAL', parameter: kind, segment,
        frameStart: events[0].frame_start, frameEnd: events.at(-1).frame_end,
        measured: events.length, threshold: POSITION_DIRECTION_TOLERANCE,
        explanation: `${kind} repeatedly reverses inside one travel primitive instead of committing to its route` }));
    }
  }
  return defects;
}

function normalizedDiscontinuity(before, after, floor) {
  if (![before, after].every(Number.isFinite)) return null;
  return Math.abs(after - before) / Math.max(Math.abs(before), Math.abs(after), floor);
}

function boundaryTransitionTypes(rawTracks, normalizedTime) {
  const types = [];
  for (const name of FINITE_TRACKS) {
    const keys = ((rawTracks[name] || {}).keyframes) || [];
    const key = keys.find((row) => Math.abs(Number(row.time) - normalizedTime) < 1e-7);
    if (!key) continue;
    types.push({ parameter: name, incoming: key.transitionIn && key.transitionIn.type,
      outgoing: key.transitionOut && key.transitionOut.type });
  }
  return types;
}

function boundaryVectorMetrics(trace, boundary, frameRate = 30) {
  const beforeSpeed = trace.speed[boundary];
  const afterSpeed = trace.speed[boundary + 1];
  const beforeBearing = trace.bearing[boundary];
  const afterBearing = trace.bearing[boundary + 1];
  const directionSnap = [beforeSpeed, afterSpeed, beforeBearing, afterBearing].every(Number.isFinite)
    && beforeSpeed > SMOOTHNESS_TOLERANCES.boundary_direction_speed_floor_mps
    && afterSpeed > SMOOTHNESS_TOLERANCES.boundary_direction_speed_floor_mps
    ? Math.abs(motionContinuity.angleDeltaDeg(beforeBearing, afterBearing)) : null;
  const derivative = (rates, frame) => frame > 0 && Number.isFinite(rates[frame]) && Number.isFinite(rates[frame - 1])
    ? (rates[frame] - rates[frame - 1]) * frameRate : null;
  const series = {
    position: (frame) => trace.acceleration[frame],
    pan: (frame) => derivative(trace.panRate, frame),
    altitude: (frame) => derivative(trace.altitudeRate, frame),
    tilt: (frame) => derivative(trace.tiltRate, frame),
  };
  const floors = { position: 1, pan: 0.05, altitude: 0.5, tilt: 0.05 };
  const peakFrames = {};
  for (const [name, valueAtFrame] of Object.entries(series)) {
    let peak = null;
    for (let frame = Math.max(1, boundary - 15); frame <= Math.min(trace.frames.length - 1, boundary + 15); frame += 1) {
      const value = valueAtFrame(frame);
      if (!Number.isFinite(value) || Math.abs(value) <= floors[name]) continue;
      if (!peak || Math.abs(value) > peak.value) peak = { frame, value: Math.abs(value) };
    }
    peakFrames[name] = peak ? peak.frame : null;
  }
  const finitePeaks = Object.values(peakFrames).filter(Number.isFinite);
  return {
    before_speed_mps: beforeSpeed,
    after_speed_mps: afterSpeed,
    before_bearing_deg: beforeBearing,
    after_bearing_deg: afterBearing,
    direction_snap_deg: directionSnap,
    acceleration_peak_frames: peakFrames,
    channel_phase_span_frames: finitePeaks.length > 1 ? Math.max(...finitePeaks) - Math.min(...finitePeaks) : 0,
  };
}

function boundaryContinuityDefects({ plan, esp, tracks }) {
  const defects = [];
  const warnings = [];
  if (!plan || !(plan.total_frames > 0)) return { defects, warnings };
  const decoded = motionContinuity.extractEspCameraTracks(esp);
  const trace = motionContinuity.playbackPositionTrace(decoded, plan.total_frames, plan.frame_rate || 30);
  const segments = (plan.segments || []).filter((segment) => segment && segment.duration_seconds > 0);
  for (let index = 0; index < segments.length - 1; index += 1) {
    const before = segments[index];
    const after = segments[index + 1];
    if (before.hard_transition || after.hard_transition || before.transition === 'hard' || after.transition === 'hard') continue;
    const boundary = before.end_frame;
    const metadata = boundaryTransitionTypes(tracks, boundary / plan.total_frames);
    const positionHasLinearBoundary = metadata.some((row) => ['longitude', 'latitude'].includes(row.parameter)
      && (row.incoming === 'linear' || row.outgoing === 'linear'));
    const vector = boundaryVectorMetrics(trace, boundary, plan.frame_rate || 30);
    const movingToMoving = !['hold', 'hover'].includes(before.action) && !['hold', 'hover'].includes(after.action);
    const boundaryPair = `${before.action}->${after.action}`;
    const calibratedVectorPair = ['fly_to->orbit', 'zoom_in->orbit', 'orbit->fly_to'].includes(boundaryPair);
    if (movingToMoving && Number.isFinite(vector.direction_snap_deg)
        && vector.direction_snap_deg > SMOOTHNESS_TOLERANCES.boundary_direction_snap_deg
        && positionHasLinearBoundary) {
      const record = defectRecord({ defectClass: calibratedVectorPair
        ? 'BOUNDARY_DIRECTION_SNAP' : 'BOUNDARY_DIRECTION_SNAP_UNCALIBRATED', parameter: 'ground_velocity_vector',
        segment: before, before: before.action, after: after.action,
        frameStart: boundary - 1, frameEnd: boundary + 1, measured: vector.direction_snap_deg,
        threshold: SMOOTHNESS_TOLERANCES.boundary_direction_snap_deg,
        explanation: calibratedVectorPair
          ? `${before.action}→${after.action} changes ground-velocity direction ${vector.direction_snap_deg.toFixed(1)}° in one frame while both primitives are moving`
          : `${before.action}→${after.action} has a ${vector.direction_snap_deg.toFixed(1)}° modeled vector change, but this boundary family lacks real-playback calibration`,
        severity: calibratedVectorPair ? 'error' : 'warning' });
      (calibratedVectorPair ? defects : warnings).push(record);
    }
    if (movingToMoving && vector.channel_phase_span_frames > SMOOTHNESS_TOLERANCES.boundary_channel_phase_warning_frames) {
      warnings.push(defectRecord({ defectClass: 'BOUNDARY_CHANNEL_PHASE_UNCERTAIN', parameter: 'coordinated_camera_tracks',
        segment: before, before: before.action, after: after.action,
        frameStart: boundary - 15, frameEnd: boundary + 15, measured: vector.channel_phase_span_frames,
        threshold: SMOOTHNESS_TOLERANCES.boundary_channel_phase_warning_frames,
        explanation: `${before.action}→${after.action} has modeled channel-acceleration peaks separated by ${vector.channel_phase_span_frames} frames; custom playback authority remains advisory`,
        severity: 'warning' }));
    }
    const report = motionContinuity.playbackBoundaryRates(decoded, boundary, plan.total_frames, plan.frame_rate || 30);
    const candidates = [
      { parameter: 'position_speed', before: report.before.speed_mps, after: report.after.speed_mps,
        floor: SMOOTHNESS_TOLERANCES.boundary_position_floor_mps },
      { parameter: 'altitude_speed', before: report.before.altitude_rate_mps, after: report.after.altitude_rate_mps,
        floor: SMOOTHNESS_TOLERANCES.boundary_altitude_floor_mps },
      { parameter: 'pan_speed', before: report.before.pan_rate_dps, after: report.after.pan_rate_dps,
        floor: SMOOTHNESS_TOLERANCES.boundary_angle_floor_dps },
      { parameter: 'tilt_speed', before: report.before.tilt_rate_dps, after: report.after.tilt_rate_dps,
        floor: SMOOTHNESS_TOLERANCES.boundary_angle_floor_dps },
    ].map((row) => ({ ...row, score: normalizedDiscontinuity(row.before, row.after, row.floor) }))
      .filter((row) => Number.isFinite(row.score));
    const worst = candidates.sort((a, b) => b.score - a.score)[0];
    if (!worst || worst.score <= SMOOTHNESS_TOLERANCES.boundary_velocity_discontinuity) continue;
    const movingLinear = metadata.some((row) => row.incoming === 'linear' && row.outgoing === 'linear');
    const record = defectRecord({ defectClass: 'BOUNDARY_VELOCITY_DISCONTINUITY', parameter: worst.parameter,
      segment: before, before: before.action, after: after.action,
      frameStart: boundary - 1, frameEnd: boundary + 1, measured: worst.score,
      threshold: SMOOTHNESS_TOLERANCES.boundary_velocity_discontinuity,
      explanation: `${before.action}→${after.action} changes normalized ${worst.parameter} rate abruptly at an interior boundary`,
      severity: movingLinear ? 'error' : 'warning' });
    (movingLinear ? defects : warnings).push(record);
  }
  return { defects, warnings };
}

function endpointEasingDefects({ plan, tracks }) {
  const defects = [];
  if (!plan || !(plan.total_frames > 0) || !plan.motion_policy || !plan.motion_policy.coherent_trajectory) return defects;
  const segments = (plan.segments || []).filter((segment) => segment && segment.duration_seconds > 0);
  if (!segments.length) return defects;
  for (const [edge, segment, time] of [['start', segments[0], 0], ['stop', segments.at(-1), 1]]) {
    if (['hold', 'hover'].includes(segment.action) || segment.hard_transition || segment.transition === 'hard') continue;
    for (const [name, kind] of [['longitude', 'longitude'], ['latitude', 'latitude'], ['altitude', 'altitude'],
      ['rotationX', 'pan'], ['rotationY', 'tilt']]) {
      const keys = ((tracks[name] || {}).keyframes) || [];
      if (keys.length < 2) continue;
      const key = edge === 'start' ? keys[0] : keys.at(-1);
      if (Math.abs(Number(key.time) - time) > 1e-7) continue;
      const handle = edge === 'start' ? key.transitionOut : key.transitionIn;
      const adjacent = edge === 'start' ? keys[1] : keys.at(-2);
      if ((!handle || handle.type === 'linear') && Math.abs(Number(key.value) - Number(adjacent.value)) > 1e-9) {
        defects.push(defectRecord({ defectClass: edge === 'start' ? 'HARD_START' : 'HARD_STOP', parameter: kind,
          segment, frameStart: edge === 'start' ? 0 : plan.total_frames - 1,
          frameEnd: edge === 'start' ? 1 : plan.total_frames,
          measured: 'linear', threshold: 'non-linear eased endpoint',
          explanation: `${kind} begins or ends moving with a linear endpoint instead of the declared coherent envelope` }));
      }
    }
  }
  return defects;
}

function smoothnessDoctrineReport({ plan, esp, tracks = cameraTracks(esp) }) {
  const defects = [
    ...scalarPumpDefects({ plan, tracks }),
    ...radiusAndTargetDefects({ plan, tracks }),
    ...headingDefects({ plan, tracks }),
    ...trajectoryDefects({ plan, tracks }),
    ...endpointEasingDefects({ plan, tracks }),
  ];
  const boundary = boundaryContinuityDefects({ plan, esp, tracks });
  defects.push(...boundary.defects);
  const roll = rollReport(esp);
  if (roll.present && roll.non_zero > 0) defects.push(defectRecord({ defectClass: 'ROLL_INSTABILITY', parameter: 'roll',
    segment: null, frameStart: 0, frameEnd: plan && plan.total_frames,
    measured: roll.max_abs_deg, threshold: SMOOTHNESS_TOLERANCES.roll_noise_deg,
    explanation: 'roll is animated without an explicit roll contract' }));
  return { schema_version: 1, tolerances: SMOOTHNESS_TOLERANCES, defects, warnings: boundary.warnings };
}

function segmentTrackReversals({ plan, tracks }) {
  const findings = [];
  const total = plan && plan.total_frames;
  const segments = (plan && plan.segments) || [];
  if (!total || !segments.length) return findings;
  const named = { altitude: 'altitude', rotationY: 'tilt' };
  segments.forEach((seg) => {
    if (!TRAVEL_ACTIONS.includes(seg.action)) return;
    const t0 = seg.start_frame / total;
    const t1 = seg.end_frame / total;
    Object.entries(named).forEach(([track, label]) => {
      const values = (((tracks[track] || {}).keyframes) || [])
        .filter((k) => k.time >= t0 - 1e-9 && k.time <= t1 + 1e-9)
        .map((k) => Number(k.value));
      if (values.length < 3) return;
      const changes = directionChanges(values);
      if (changes > SCALAR_TRACK_TOLERANCE) {
        findings.push(`${label} reverses ${changes} times inside segment ${seg.segment_id} (${seg.action}${seg.location_name ? ' ' + seg.location_name : ''}) instead of committing to one direction`);
      }
    });
  });
  return findings;
}

function evaluate({ plan, esp }) {
  const tracks = cameraTracks(esp);
  const trackReports = Object.fromEntries(FINITE_TRACKS.map((name) => [name, trackReport(tracks[name])]));
  const errors = [];
  const warnings = [];
  const missing = FINITE_TRACKS.filter((name) => !tracks[name]);
  if (missing.length) errors.push(`camera tracks missing: ${missing.join(', ')}`);
  if (!FINITE_TRACKS.every((name) => trackReports[name].finite)) errors.push('camera tracks contain NaN or Infinity');
  if (!plan || !Number.isFinite(plan.total_duration_seconds) || plan.total_duration_seconds <= 0) errors.push('plan has no positive duration');
  const segments = (plan && plan.segments || []).filter((segment) => segment && segment.duration_seconds > 0);
  if (!segments.length) errors.push('plan has no playable camera segments');
  segments.forEach((segment) => {
    if (!Number.isFinite(segment.start_frame) || !Number.isFinite(segment.end_frame) || segment.end_frame < segment.start_frame) errors.push(`segment ${segment.segment_id || '?'} has invalid frame bounds`);
    if (!Number.isFinite(segment.altitude_m) || !Number.isFinite(segment.tilt_deg)) errors.push(`segment ${segment.segment_id || '?'} has incomplete camera framing values`);
    if (segment.target_offset_half_frames > 1 && segment.action !== 'orbit') warnings.push(`segment ${segment.segment_id || '?'} target is outside the guaranteed frame centre margin`);
  });
  // Altitude and pitch reversals are counted PER SEGMENT, the same doctrine the
  // ground-path check above already uses. Whole-track counting punishes a
  // journey for being a journey: a three-stop route climbs and descends once
  // per leg, which is exactly what it should do, and the old check reported
  // that correct shot as "altitude direction changes 3 times". A warning that
  // fires on correct output teaches the operator to ignore warnings.
  segmentTrackReversals({ plan, tracks }).forEach((message) => warnings.push(message));

  // Movement-coherence doctrine: no detectable ground-path oscillation inside a
  // single travel move, no roll.
  const coherence = coherenceReport({ plan, tracks });
  coherence.forEach((message) => errors.push(`movement coherence: ${message}`));
  const orbit = orbitReport({ plan, tracks });
  orbit.forEach((message) => warnings.push(`orbit geometry: ${message}`));
  // DEAD ORBIT — "if the user asks for an orbit, the camera must actually orbit".
  //
  // An orbit rides a ring of radius `altitude · tan(tilt)`. At tilt 0 that radius
  // is zero, so the camera sits over the subject and only pan changes: the map
  // turns underneath a stationary camera. Measured in real Earth Studio, exactly
  // that shipped — position identical to fourteen decimal places for all 480
  // frames of a requested 180 deg orbit while pan swept the full arc.
  //
  // This is not an aesthetic judgement and it needs no tolerance debate: a
  // movement whose whole meaning is travelling around a subject did not travel.
  // So it is an ERROR, not a warning.
  //
  // Deliberately narrow. It requires a non-trivial requested arc, and it asks
  // only whether the camera MOVED — an intentional stationary hold has no arc
  // and never reaches this check.
  deadOrbitReport({ plan, tracks }).forEach((message) => errors.push(`orbit geometry: ${message}`));
  // The same law for every other movement whose name is a promise.
  const deadMoves = deadMovementReport({ plan, tracks });
  deadMoves.errors.forEach((message) => errors.push(`movement intent: ${message}`));
  deadMoves.warnings.forEach((message) => warnings.push(`movement intent: ${message}`));
  const smoothness = smoothnessDoctrineReport({ plan, esp, tracks });
  smoothness.defects.forEach((finding) => errors.push(`smoothness ${finding.defect_class}: ${finding.explanation}`));
  smoothness.warnings.forEach((finding) => warnings.push(`smoothness ${finding.defect_class}: ${finding.explanation}`));
  const roll = rollReport(esp);

  return {
    schema_version: 1,
    verdict: errors.length ? 'FAIL' : 'PASS_FOR_HUMAN_REVIEW',
    scope: 'machine continuity and serialization checks; not an aesthetic approval',
    errors, warnings, tracks: trackReports, segments: segments.length,
    coherence: { position_direction_tolerance: POSITION_DIRECTION_TOLERANCE, findings: coherence },
    orbit_geometry: {
      radius_breathing_tolerance_pct: ORBIT_RADIUS_BREATHING_TOLERANCE_PCT,
      aim_tolerance_deg: ORBIT_AIM_TOLERANCE_DEG,
      tilt_tolerance_deg: ORBIT_TILT_TOLERANCE_DEG,
      findings: orbit,
    },
    roll,
    smoothness,
    motion_policy: plan.motion_policy || null,
  };
}

module.exports = { cameraTracks, evaluate, coherenceReport, orbitReport, deadOrbitReport, deadMovementReport,
  rollReport, sortedTimedSamples, timeAwareDerivatives, motionEnvelope,
  scalarPumpDefects, radiusAndTargetDefects, headingDefects, trajectoryDefects, boundaryContinuityDefects,
  boundaryVectorMetrics, smoothnessDoctrineReport, SMOOTHNESS_TOLERANCES, POSITION_DIRECTION_TOLERANCE };
