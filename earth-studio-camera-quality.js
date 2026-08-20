'use strict';

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
  let rollKeyframes = null;
  walk(esp, (node) => {
    if (node.type === 'rotationZ' && Array.isArray(node.keyframes)) rollKeyframes = node.keyframes;
  });
  // rotationZ is never keyframed by this generator; if it appears at all it
  // was injected, and any non-zero value is camera roll — a defect by doctrine.
  if (rollKeyframes === null) return { present: false, non_zero: 0, keyframes: 0 };
  const nonZero = rollKeyframes.filter((k) => Math.abs(Number(k.value)) > 1e-9).length;
  return { present: true, non_zero: nonZero, keyframes: rollKeyframes.length };
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
      const keyframes = ((tracks[name] || {}).keyframes || [])
        .filter((k) => k.time >= t0 - 1e-9 && k.time <= t1 + 1e-9)
        .map((k) => Number(k.value));
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
const EARTH_M_PER_DEG = 111320;
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
  const cosLat = Math.cos((centre.latitude * Math.PI) / 180) || 1e-6;
  const lat = denormalized(tracks.latitude, 'latitude');
  const lng = denormalized(tracks.longitude, 'longitude');
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
    const dy = (valueAt(lat, time) - centre.latitude) * EARTH_M_PER_DEG;
    const dx = (valueAt(lng, time) - centre.longitude) * EARTH_M_PER_DEG * cosLat;
    const radius = Math.hypot(dx, dy);
    let aim = null;
    if (pan.length) {
      const bearingToCamera = (Math.atan2(dx, dy) * 180) / Math.PI;
      let err = valueAt(pan, time) - (bearingToCamera + 180);
      while (err > 180) err -= 360;
      while (err < -180) err += 360;
      // At the ring's centre the bearing is undefined; an aim error there is a
      // measurement artifact, not a camera defect.
      aim = radius > 10 ? Math.abs(err) : null;
    }
    rows.push({ radius, aim, tilt: tilt.length ? valueAt(tilt, time) : null,
      point: { lat: valueAt(lat, time), lng: valueAt(lng, time) } });
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
  const lng = denormalized(tracks.longitude, 'longitude');
  const alt = denormalized(tracks.altitude, 'altitude');
  if (!total || lat.length < 2 || lng.length < 2) return out;
  for (const segment of segments) {
    if (segment.action !== 'orbit') continue;
    const arc = Math.abs(Number(segment.orbit_degrees) || 0);
    if (!(arc >= DEAD_ORBIT_MIN_ARC_DEG)) continue;
    const t0 = segment.start_frame / total;
    const t1 = segment.end_frame / total;
    if (!(t1 > t0)) continue;
    const cosLat = Math.cos((segment.location.latitude * Math.PI) / 180) || 1e-6;
    const lat0 = valueAt(lat, t0);
    const lng0 = valueAt(lng, t0);
    const alt0 = alt.length ? valueAt(alt, t0) : 0;
    const SAMPLES = 300;
    let moved = 0;
    for (let i = 0; i <= SAMPLES; i += 1) {
      const time = t0 + (t1 - t0) * (i / SAMPLES);
      const dy = (valueAt(lat, time) - lat0) * EARTH_M_PER_DEG;
      const dx = (valueAt(lng, time) - lng0) * EARTH_M_PER_DEG * cosLat;
      const dz = alt.length ? valueAt(alt, time) - alt0 : 0;
      moved = Math.max(moved, Math.hypot(Math.hypot(dx, dy), dz));
    }
    if (moved >= DEAD_ORBIT_MIN_DISPLACEMENT_M) continue;
    const ring = Number.isFinite(segment.altitude_m) && Number.isFinite(segment.tilt_deg)
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
  const lng = denormalized(tracks.longitude, 'longitude');
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
    const cosLat = Math.cos((segment.location.latitude * Math.PI) / 180) || 1e-6;
    const dy = (valueAt(lat, t1) - valueAt(lat, t0)) * EARTH_M_PER_DEG;
    const dx = (valueAt(lng, t1) - valueAt(lng, t0)) * EARTH_M_PER_DEG * cosLat;
    const travelled = Math.hypot(dx, dy);
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
        const dy = (cand.location.latitude - segment.location.latitude) * EARTH_M_PER_DEG;
        const dx = (cand.location.longitude - segment.location.longitude) * EARTH_M_PER_DEG
          * Math.cos((segment.location.latitude * Math.PI) / 180);
        if (Math.hypot(dx, dy) > 5000) { destination = cand; break; }
      }
      if (destination && !seededOpeningState) {
        const bearing = (from, to) => {
          const la1 = (from.lat * Math.PI) / 180;
          const la2 = (to.lat * Math.PI) / 180;
          const dlo = ((to.lng - from.lng) * Math.PI) / 180;
          const y = Math.sin(dlo) * Math.cos(la2);
          const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
          return (Math.atan2(y, x) * 180) / Math.PI;
        };
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
  const roll = rollReport(esp);
  if (roll.present && roll.non_zero > 0) errors.push(`movement coherence: roll (rotationZ) is keyframed non-zero in ${roll.non_zero} keyframe(s) — roll should stay near zero`);

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
    motion_policy: plan.motion_policy || null,
  };
}

module.exports = { cameraTracks, evaluate, coherenceReport, orbitReport, deadOrbitReport, deadMovementReport, rollReport, POSITION_DIRECTION_TOLERANCE };
