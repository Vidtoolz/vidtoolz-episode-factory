// Frozen M1 CameraTrajectory authority. In memory only; no persisted schema changes.
// Contract SHA256: 19f98b6a39b0cb079c46e79fa4293a88c04b64a59d124f033d42be9fb3887171
(function earthStudioCameraTrajectoryBootstrap(globalScope) {
  "use strict";
  const TRAJECTORY_SCHEMA = "vidtoolz.camera.trajectory.v1";
  function motionPolicy(plan, options = {}) {
    const p = (plan && plan.motion_policy) || null;
    return {
      coherentTrajectory: !!(p && p.coherent_trajectory) && !options.compareLegacyMotion,
      dedupeKeyframes: !!(p && p.dedupe_keyframes) && !options.compareLegacyMotion,
    };
  }

  function exportLongitudeTrack(track, espKeyframe, round6) {
    const out = [];
    for (const cur of track) {
      const kf = espKeyframe(cur.time, round6(cur.value));
      if (cur.sampledInterior) kf.sampledInterior = cur.sampledInterior === "in" ? "in"
        : cur.sampledInterior === "out" ? "out" : true;
      if (cur.orbitTravelHandoff) {
        kf.orbitTravelHandoff = cur.orbitTravelHandoff;
        if (cur.semanticBoundary) kf.semanticBoundary = true;
      }
      if (out.length && out[out.length - 1].time === kf.time) out[out.length - 1] = kf;
      else if (!out.length || out[out.length - 1].time < kf.time) out.push(kf);
    }
    return out;
  }

  function dropRedundantKeyframes(track) {
    if (!Array.isArray(track) || track.length < 3) return track;
    const same = (a, b) => Math.abs(a - b) <= Math.max(1e-9, 1e-12 * Math.max(Math.abs(a), Math.abs(b)));
    let out = track;
    for (let pass = 0; pass < 64; pass += 1) {
      const next = out.filter((kf, i) => {
        if (i === 0 || i === out.length - 1) return true;
        return kf.semanticBoundary || kf.aimAt
          || !(same(kf.value, out[i - 1].value) && same(out[i + 1].value, kf.value));
      });
      if (next.length === out.length) return next;
      out = next;
    }
    return out;
  }

  function espKeyframe(frame, value, transition = "linear") {
    return { time: Math.max(0, Math.round(frame)), value, transitionIn: { type: transition }, transitionOut: { type: transition } };
  }

  function computeTrajectoryMarkers(plan) {
    const finalSeg = [...plan.segments].reverse().find((sg) => sg.location && sg.duration_seconds > 0);
    return plan.segments
      .filter((sg) => sg.location && sg.duration_seconds > 0
        && ["fly_to", "zoom_in", "zoom_out"].includes(sg.action)
        && !sg.ends_at_orbit_entry
        && (!finalSeg || sg.segment_id !== finalSeg.segment_id))
      .map((sg) => ({ kind: "segment-arrival", segment_id: sg.segment_id, frame: sg.end_frame }));
  }
  function legacyTracksFromTrajectory(trajectory) {
    const tracks = {};
    for (const name of ["lng", "lat", "alt", "pan", "tilt"]) {
      tracks[name] = trajectory.keyed[name].map((key) => key.aimAt
        ? { ...key, aimAt: { latitude: key.aimAt.lat, longitude: key.aimAt.lng } }
        : { ...key });
    }
    return tracks;
  }

  // D-4: retain the existing geodesy arithmetic and constants in their owner.
  // Bind only pure helpers/configuration, never a planner or serializer callback.
  function createCompiler(dependencies) {
    const { FRAME_RATE, DEFAULT_ALTITUDE_M, SPACE_ZOOM_COMPOSITION_SAMPLES, ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S, ORBIT_SAMPLE_STEP_DEG, ORBIT_TRAVEL_HANDOFF, ACQUISITION_PROFILES, ACQUISITION_DEFAULT_PROFILE, FRAMING_STABLE_ACQUISITION_DEFAULT, ORBIT_ENTRY_DENSITY_DEFAULT, ORBIT_ENTRY_TILT_SCHEDULE_DEFAULT, ORBIT_ENTRY_MIN_SECONDS, ORBIT_ENTRY_MAX_FRACTION, ORBIT_ENTRY_RING_TOLERANCE_FRACTION, ORBIT_ENTRY_RING_TOLERANCE_M, ORBIT_ENTRY_TILT_TOLERANCE_DEG, CRUISE_MIN_SECONDS, CRUISE_MIN_DISTANCE_M, CRUISE_PROFILES, CRUISE_DEFAULT_PROFILE, ORBIT_LEGACY_SAMPLE_STEP_DEG, clampAltitude, maxDerivedSpaceZoomTiltDeg, toRadians, round6, smoothstep, haversineMeters, shortestLngDelta, continuousLng, AIM_UNDEFINED_M, aimHeading, offsetPoint, bearingDeg, orbitExitTheta, seededCameraState, initialCameraState, orbitRingRadiusMeters, MOTION_SETTLE } = dependencies;
  function buildEspKeyframes(plan, options, policy) {
    const tracks = { lng: [], lat: [], alt: [], pan: [], tilt: [] };
    // `sampledInterior` marks a keyframe that is an INTERIOR SAMPLE of a curve
    // this code is describing point-by-point — an orbit's ring, a space zoom's
    // composition-constrained climb. The serializer emits those hard-linear;
    // see the note at the emit site for why ease handles are actively harmful
    // on a sampled curve.
    //
    // `true` means BOTH sides are linear. `"in"` means only the incoming side
    // is: the keyframe closes a sampled curve but then departs into something
    // else, so the curve must be protected on the way in while the departure
    // is still allowed to ease. `"out"` is the mirror image: the keyframe keeps
    // its own eased arrival but the span LEAVING it must be exactly flat, which
    // is what fences a static hold from the movements on either side of it.
    const put = (trackName, frame, value, sampledInterior = false, semanticBoundary = false) => {
      const track = tracks[trackName];
      const kf = espKeyframe(frame, value);
      // Preserve the VARIANT: "in" must not collapse to true, or a closing
      // sample is treated as an interior one and loses its arrival easing.
      if (sampledInterior) kf.sampledInterior = sampledInterior === "in" ? "in"
        : sampledInterior === "out" ? "out" : true;
      // Same-valued boundary keys fence a preceding hold from the following
      // movement. Keep the marker internal; the serializer ignores it.
      if (semanticBoundary) kf.semanticBoundary = true;
      if (track.length && track[track.length - 1].time === kf.time) track[track.length - 1] = kf;
      else if (!track.length || track[track.length - 1].time < kf.time) track.push(kf);
    };
    // Attach an analytic slope (value units per FRAME) to the most recent
    // keyframe on a track. The serializer turns it into a handle whose y
    // actually carries that slope, instead of the default horizontal y = 0.
    const setRate = (trackName, side, ratePerFrame) => {
      const kf = tracks[trackName][tracks[trackName].length - 1];
      if (!kf || !Number.isFinite(ratePerFrame)) return;
      if (side === "in" || side === "both") kf.rateIn = ratePerFrame;
      if (side === "out" || side === "both") kf.rateOut = ratePerFrame;
    };
    // Pin the OUT side of the newest keyframe hard-linear without disturbing the
    // easing it already carries on the way IN. A keyframe already protected on
    // the way in becomes linear on both sides.
    const pinOut = (trackName) => {
      const kf = tracks[trackName][tracks[trackName].length - 1];
      if (!kf) return;
      kf.sampledInterior = (kf.sampledInterior === "in" || kf.sampledInterior === true) ? true : "out";
    };
    const last = (trackName) => (tracks[trackName].length ? tracks[trackName][tracks[trackName].length - 1] : null);
    // Mark the newest pan key as an AIMED heading at `subject`. Internal only
    // (the serializer ignores it): dedupe keeps aimed keys even when their
    // values coincide (a ring around the pole aims due north at every key).
    const tagAim = (subject) => { const kf = last("pan"); if (kf) kf.aimAt = { latitude: subject.latitude, longitude: subject.longitude }; };
    const locationOf = (segment) => {
      const orbitSeg = resolved.find((s) => s && s.segment_id === segment.stages_orbit_entry);
      return orbitSeg && orbitSeg.location ? orbitSeg.location : segment.location;
    };
    // Move a track to `value` across [startFrame, endFrame], anchoring the old
    // value at startFrame so the change does not bleed back through a hold.
    const change = (trackName, startFrame, endFrame, value) => {
      const previous = last(trackName);
      if (previous && previous.value === value) return;
      if (previous && previous.time < startFrame) put(trackName, startFrame, previous.value, false, true);
      put(trackName, endFrame, value);
    };
    const anchor = (trackName, startFrame) => {
      const previous = last(trackName);
      if (previous && previous.time < startFrame) put(trackName, startFrame, previous.value, false, true);
    };

    const resolved = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
    if (!resolved.length) return { tracks, state: null };

    let state = null;
    // Did the opening camera come from a continuation seed? A seeded opening is
    // the previous animation's exact final frame and must never be re-placed.
    let openedFromSeed = false;
    resolved.forEach((segment, idx) => {
      const location = segment.location;
      const minAlt = location.min_altitude_m || 0;
      const endAltitude = clampAltitude(segment.altitude_m || DEFAULT_ALTITUDE_M, minAlt);
      const tilt = typeof segment.tilt_deg === "number" ? segment.tilt_deg : 45;
      const sf = segment.start_frame;
      const ef = segment.end_frame;

      if (!state) {
        // A continuation seed replaces ONLY the opening state; every downstream
        // rule (easing, arcs, settle-hold, orbit ring entry) is untouched.
        const seed = options.initialCamera;
        openedFromSeed = !!(seed && typeof seed === "object");
        state = openedFromSeed
          ? seededCameraState(seed, segment, endAltitude, tilt)
          : initialCameraState(segment, endAltitude, tilt);
        // STAGE THE OPENING HOLD AT THE ORBIT'S EXIT-ALIGNED BEARING.
        //
        // A staged hold is free to choose WHERE on the ring it establishes from,
        // and that choice also fixes where the following orbit ENDS — the sweep
        // runs from the staged bearing. `orbitExitTheta` can solve for an exit
        // where the orbit's tangential motion already points at the next
        // destination, but it was only allowed to when the orbit opened the shot.
        // A staged hold makes the same freedom available one movement earlier:
        // measured on "hold the Colosseum, half-orbit it, then travel to Paris",
        // the orbit exited 176 deg away from the destination; solving the phase
        // backwards from the exit brings it in line, and costs nothing because
        // the hold had to pick some bearing anyway.
        //
        // A continuation seed is never restaged (frame 0 belongs to the previous
        // animation), and if no later destination qualifies this does nothing.
        if (policy.coherentTrajectory && !openedFromSeed && segment.stages_orbit_entry) {
          const orbitSeg = resolved[idx + 1];
          if (orbitSeg && orbitSeg.action === "orbit" && orbitSeg.segment_id === segment.stages_orbit_entry) {
            const orbitRadius = orbitRingRadiusMeters(
              orbitSeg.location,
              clampAltitude(orbitSeg.altitude_m || DEFAULT_ALTITUDE_M, (orbitSeg.location && orbitSeg.location.min_altitude_m) || 0),
              typeof orbitSeg.tilt_deg === "number" ? orbitSeg.tilt_deg : 45,
            );
            const orbitSweep = (orbitSeg.orbit_degrees || 360) * (orbitSeg.orbit_direction || 1);
            let dest = null;
            for (let j = idx + 2; j < resolved.length; j += 1) {
              const cand = resolved[j];
              if (!cand.location) continue;
              if (cand.action === "orbit") break;
              if (!["fly_to", "zoom_in", "zoom_out"].includes(cand.action)) continue;
              if (haversineMeters(orbitSeg.location, cand.location) > Math.max(orbitRadius * 2, 1000)) { dest = cand; break; }
            }
            if (dest && orbitRadius > 1) {
              const thetaEndStaged = orbitExitTheta(orbitSeg.location, orbitRadius, orbitSweep, dest.location);
              const theta0Staged = thetaEndStaged - orbitSweep;
              const staged = offsetPoint(orbitSeg.location, theta0Staged, orbitRadius);
              const stagedLng = continuousLng(state.longitude, staged.longitude);
              state = { ...state, latitude: staged.latitude, longitude: stagedLng, facing: theta0Staged + 180,
                pan: aimHeading({ latitude: staged.latitude, longitude: stagedLng }, orbitSeg.location, theta0Staged + 180, theta0Staged + 180) };
            }
          }
        }
        put("lng", sf, state.longitude);
        put("lat", sf, state.latitude);
        put("alt", sf, state.altitude);
        put("pan", sf, state.pan);
        if (segment.stages_orbit_entry && state.facing !== state.pan) tagAim(locationOf(segment));
        put("tilt", sf, state.tilt);
      }

      // The segment's target longitude expressed in the camera's UNWRAPPED
      // frame: continue along the shortest arc from wherever the camera is
      // (state.longitude may legitimately sit outside ±180 after a crossing).
      // This is the continuous-longitude rule (see continuousLng) in its
      // original arithmetic — kept verbatim because the planar entry bearing
      // below feeds ulps of this value into the pan track of every tracked
      // hold→orbit canary.
      const targetLng = state.longitude + shortestLngDelta(state.longitude, location.longitude);
      const locRef = { ...location, longitude: targetLng };

      if (segment.action === "orbit") {
        const sweep = (segment.orbit_degrees || 360) * (segment.orbit_direction || 1);
        const radius = orbitRingRadiusMeters(location, endAltitude, tilt);
        // Enter the circle at the bearing the camera is already facing away
        // from, so the pan track stays continuous (fixes the orbit-after-orbit
        // static bug: each orbit adds its sweep to the accumulated pan).
        // Where is this orbit actually leaving TO?
        //
        // The immediate successor is not always the answer. The `cinematic`
        // travel style opens with a same-place pull-back, so an orbit followed
        // by a real crossing had an immediate successor sitting on its own
        // subject: the exit-alignment gate saw zero distance and never fired.
        // Measured on "orbit the Colosseum then fly to Paris": with a direct
        // fly the orbit exits 5 deg off the travel direction; with the cinematic
        // style, which is what the GUI actually builds, it exited 142 deg off.
        // Look past same-place preparatory moves to the first successor that
        // genuinely travels somewhere else.
        const exitTarget = (() => {
          for (let j = idx + 1; j < resolved.length; j += 1) {
            const cand = resolved[j];
            if (!cand.location) continue;
            if (!["fly_to", "zoom_in", "zoom_out"].includes(cand.action)) {
              if (cand.action === "orbit") return null; // another orbit owns its own phase
              continue;
            }
            if (haversineMeters(location, cand.location) > Math.max(radius * 2, 1000)) return cand;
          }
          return null;
        })();
        const canChooseInitialPhase = policy.coherentTrajectory
          && idx === 0
          && exitTarget;
        const thetaEnd = canChooseInitialPhase
          ? orbitExitTheta(locRef, radius, sweep, exitTarget.location)
          : null;
        // Where does the sweep start from?
        //
        // `state.pan - 180` is the camera's own facing, which is the right entry
        // bearing whenever the camera is already looking at the target from the
        // ring. It is NOT right for a camera that arrived from somewhere else —
        // a continuation seed, or any prior movement that left pan unrelated to
        // where the camera actually sits. Measured with a seeded opening 1,106 m
        // from the Colosseum: pan said the ring entry was at -180 deg while the
        // camera physically sat at -9.5 deg, so acquisition flew it 170.5 deg
        // AROUND the ring, losing the subject by up to 170 deg on the way.
        //
        // When the camera is already off-centre and no exit constraint applies,
        // enter the ring at the bearing it is ALREADY on. Acquisition then only
        // has to close the radius and turn to face the subject — it never
        // travels around a circle it is already standing on.
        const preCosLat = Math.cos(toRadians(locRef.latitude)) || 1e-6;
        const preRadiusM = Math.hypot(
          (state.latitude - locRef.latitude) * 111320,
          (state.longitude - locRef.longitude) * 111320 * preCosLat,
        );
        const preBearingDeg = (Math.atan2(
          (state.longitude - locRef.longitude) * 111320 * preCosLat,
          (state.latitude - locRef.latitude) * 111320,
        ) * 180) / Math.PI;
        // "Already facing the target" means pan agrees with the geometry; then
        // pan is authoritative and this changes nothing.
        // A CONTINUATION SEED has no carried ring state. Its inherited pan is
        // trusted as the ring-facing convention only within six-decimal
        // serialization precision; a camera that actually sits on this ring
        // gets its ring bearing from where it physically is.
        if (state.facingFromSeed && preRadiusM > 1) {
          const seedRingBearing = bearingDeg(locRef, state);
          const precisionDeg = (Math.atan2(AIM_UNDEFINED_M, preRadiusM) * 180) / Math.PI + 0.000001;
          const onThisRing = Math.abs(haversineMeters(state, locRef) - radius) <= Math.max(radius * ORBIT_ENTRY_RING_TOLERANCE_FRACTION, ORBIT_ENTRY_RING_TOLERANCE_M);
          if (onThisRing && Math.abs(shortestLngDelta(seedRingBearing, state.facing - 180)) > precisionDeg) {
            state = { ...state, facing: seedRingBearing + 180 };
          }
          state = { ...state, facingFromSeed: false };
        }
        // GEOMETRIC AGREEMENT. The carried ring state says the camera stands at
        // ring bearing `facing − 180`; if the camera physically sits on that ring
        // point (within the ring tolerance) the state is self-consistent and
        // authoritative, whatever the planar bearing above makes of it. The
        // planar test breaks where the ring crosses a pole: the camera due
        // north of an 89.9°N subject sits at the antipodal longitude, and the
        // equirectangular bearing reads −109.5° for a camera that is exactly at
        // ring bearing 0 — the opening then slid 56 km around the ring (oracle
        // v2 pole_enclosing). Away from the poles the two tests agree.
        const carriedRingPoint = offsetPoint(locRef, state.facing - 180, radius);
        const ringStateConsistent = preRadiusM > 1
          && haversineMeters(state, carriedRingPoint) <= Math.max(radius * ORBIT_ENTRY_RING_TOLERANCE_FRACTION, ORBIT_ENTRY_RING_TOLERANCE_M);
        const panAgreesWithPosition = preRadiusM > 1
          && (Math.abs(shortestLngDelta(state.facing - 180, preBearingDeg)) < 1 || ringStateConsistent);
        const enterWhereItStands = policy.coherentTrajectory
          && thetaEnd === null
          && preRadiusM > 1
          && !panAgreesWithPosition;
        const theta0 = thetaEnd !== null ? thetaEnd - sweep
          : enterWhereItStands ? preBearingDeg
          : state.facing - 180;
        const orbitStartFacing = thetaEnd === null && !enterWhereItStands ? state.facing : theta0 + 180;
        // ORBIT BEARING AS A DIRECTORIAL VARIABLE.
        //
        // Which side of the subject an orbit starts on has always existed, but only
        // as a by-product: it falls out of the exit solver, or out of wherever the
        // arrival happened to leave the camera. A directorial layer cannot choose a
        // side it cannot see, so the bearing and — more importantly — WHY it has
        // that value are recorded here.
        //
        // Three sources, in the order the code resolves them:
        //   exit_alignment    the successor travel fixes the END bearing, so the
        //                     start is back-solved from it. Not free.
        //   incoming_arrival  the camera was already off-centre, so the orbit
        //                     enters on the bearing it is standing on.
        //   carried_camera    nothing constrains it; it follows the pan it inherits.
        //
        // Freedom is stated separately from source, because "inherited" and
        // "constrained" are different things: an arrival bearing could be chosen
        // upstream, whereas an exit requirement genuinely cannot move.
        const bearingSource = thetaEnd !== null ? "exit_alignment"
          : enterWhereItStands ? "incoming_arrival"
          : "carried_camera";
        // WHERE COULD A DIRECTOR ACTUALLY CHOOSE THIS?
        //
        // "Inherited" was true but not actionable: it says the bearing came from the
        // previous shot without saying whether that shot could have been asked to
        // arrive somewhere else. That distinction is the whole architectural
        // question, because a bearing selector that cannot influence the arrival can
        // only act on orbits that are already free.
        //
        //   fixed_by_exit_alignment   the successor needs a specific exit; no freedom
        //   fixed_by_continuation     inherited camera state is authoritative
        //   free                      nothing upstream or downstream constrains it
        //   arrival_controllable      a fly/zoom onto the SAME subject precedes it,
        //                             so the earliest legitimate control point is
        //                             that arrival, not the orbit
        //   inherited_not_controllable the previous shot is not an arrival this orbit
        //                             could redirect (another orbit, a different
        //                             subject) — freedom would require reaching
        //                             further back than one movement
        const previousSeg = idx > 0 ? resolved[idx - 1] : null;
        const previousIsArrival = !!(previousSeg
          && ["fly_to", "zoom_in", "zoom_out"].includes(previousSeg.action)
          && previousSeg.location && locRef
          && Math.abs(previousSeg.location.latitude - locRef.latitude) < 1e-6
          && Math.abs(previousSeg.location.longitude - locRef.longitude) < 1e-6);
        // A hold between the arrival and the orbit is transparent to this question:
        // it holds whatever the arrival delivered.
        const beforeHold = idx > 1 ? resolved[idx - 2] : null;
        const holdCameFromArrival = !!(previousSeg && previousSeg.holds_camera && beforeHold
          && ["fly_to", "zoom_in", "zoom_out"].includes(beforeHold.action)
          && beforeHold.location && locRef
          && Math.abs(beforeHold.location.latitude - locRef.latitude) < 1e-6
          && Math.abs(beforeHold.location.longitude - locRef.longitude) < 1e-6);
        const bearingFreedom = thetaEnd !== null ? "fixed_by_exit_alignment"
          : (idx === 0 && openedFromSeed) ? "fixed_by_continuation"
          : (idx === 0) ? "free"
          : (previousIsArrival || holdCameFromArrival) ? "arrival_controllable"
          : "inherited_not_controllable";
        if (Array.isArray(options.orbitBearing)) {
          options.orbitBearing.push({
            segment_id: segment.segment_id,
            subject: segment.location_name || (locRef && locRef.name) || null,
            start_bearing_deg: ((theta0 % 360) + 360) % 360,
            exit_bearing_deg: (((theta0 + sweep) % 360) + 360) % 360,
            sweep_deg: sweep,
            bearing_source: bearingSource,
            bearing_freedom: bearingFreedom,
            // The earliest place a directorial layer could legitimately set it.
            earliest_control_point: bearingFreedom === "arrival_controllable"
              ? (holdCameFromArrival ? `segment ${beforeHold.segment_id} (arrival before the hold)`
                : `segment ${previousSeg.segment_id} (arrival)`)
              : bearingFreedom === "free" ? "the orbit itself"
              : bearingFreedom === "fixed_by_exit_alignment" ? "not free — successor fixes the exit"
              : bearingFreedom === "fixed_by_continuation" ? "not free — inherited camera state"
              : "further back than one movement",
            radius_m: radius,
            altitude_m: endAltitude,
            tilt_deg: tilt,
          });
        }
        // OPENING ORBIT: place frame 0 ON the ring at the bearing the sweep
        // actually starts from. initialCameraState puts an opening orbit at
        // bearing 0 with pan 180, which was right while theta0 was always 0 —
        // but the exit-phase lookahead back-solves theta0 from where the orbit
        // needs to END, and the opening position was left behind. Measured on
        // "orbit the Colosseum, then fly to Paris": frame 0 sat at bearing 0
        // with pan 47.9°, a 132° aim error, and the camera then slid 122° around
        // the ring inside the first 0.57 s.
        //
        // Frame 0 is the shot's own first frame, so placing it is composition,
        // not a jump — nothing precedes it. A CONTINUATION seed is different:
        // that frame belongs to the previous animation and is never re-placed.
        // With theta0 === 0 this reproduces the old values exactly.
        if (idx === 0 && !openedFromSeed) {
          const opening = offsetPoint(locRef, theta0, radius);
          opening.longitude = continuousLng(state.longitude, opening.longitude);
          const openingPan = aimHeading(opening, locRef, orbitStartFacing, orbitStartFacing);
          state = { ...state, latitude: opening.latitude, longitude: opening.longitude, pan: openingPan, facing: orbitStartFacing };
          put("lng", sf, opening.longitude);
          put("lat", sf, opening.latitude);
          put("pan", sf, openingPan);
          tagAim(locRef);
        }
        const stepDeg = policy.coherentTrajectory ? ORBIT_SAMPLE_STEP_DEG : ORBIT_LEGACY_SAMPLE_STEP_DEG;
        const sampleCount = Math.max(4, Math.ceil(Math.abs(sweep) / stepDeg));
        anchor("lng", sf);
        anchor("lat", sf);
        if (policy.coherentTrajectory) anchor("pan", sf);
        let lastPoint = { latitude: state.latitude, longitude: state.longitude };
        // ── Phase B: RING ACQUISITION ──────────────────────────────────────
        // Where is the camera relative to the geometry this orbit needs?
        const fps = plan.frame_rate || FRAME_RATE;
        const orbitSeconds = Math.max(1e-6, (ef - sf) / fps);
        const cosLat = Math.cos(toRadians(locRef.latitude)) || 1e-6;
        const radialM = (pt) => Math.hypot(
          (pt.latitude - locRef.latitude) * 111320,
          (pt.longitude - locRef.longitude) * 111320 * cosLat,
        );
        const bearingOf = (pt) => (Math.atan2(
          (pt.longitude - locRef.longitude) * 111320 * cosLat,
          (pt.latitude - locRef.latitude) * 111320,
        ) * 180) / Math.PI;
        const ringEntry = offsetPoint(locRef, theta0, radius);
        const startRadius = radialM(state);
        const offRingM = haversineMeters(state, ringEntry);
        const ringTolM = Math.max(radius * ORBIT_ENTRY_RING_TOLERANCE_FRACTION, ORBIT_ENTRY_RING_TOLERANCE_M);
        const tiltDeltaDeg = Math.abs(tilt - state.tilt);
        const needsRing = offRingM > ringTolM;
        const needsTilt = tiltDeltaDeg > ORBIT_ENTRY_TILT_TOLERANCE_DEG;
        // Entry duration is DERIVED, not picked: the pitch change gets the calm
        // rotation rate this module already uses for orbit entry, and the lateral
        // move gets the orbit's OWN ground speed, so acquisition and sweep travel
        // at the same pace and read as one continuous camera performance. Bounded
        // so a long acquisition can never eat the shot.
        const acquisitionProfile = ACQUISITION_PROFILES[options.acquisitionProfile || ACQUISITION_DEFAULT_PROFILE] || null;
        const lateralFactor = acquisitionProfile ? acquisitionProfile.lateralSpeedFactor : 1;
        const tiltRate = acquisitionProfile ? acquisitionProfile.tiltRateDegPerS : ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S;
        const sweepGroundSpeed = (radius * Math.abs(toRadians(sweep))) / orbitSeconds;
        const lateralSeconds = sweepGroundSpeed > 1e-6 ? offRingM / (sweepGroundSpeed * lateralFactor) : 0;
        const tiltSeconds = tiltDeltaDeg / tiltRate;
        // The HEADING turn is work too. A camera arriving from elsewhere may not
        // be facing the subject at all — a continuation seed measured 170.5 deg
        // off — and sizing the phase from pitch and distance alone whipped that
        // turn through in about 0.7 s. Heading gets the same calm rotation rate
        // as pitch.
        const panDeltaDeg = Math.abs(shortestLngDelta(state.facing, theta0 + 180));
        const panSeconds = panDeltaDeg / tiltRate;
        const needsPan = panDeltaDeg > 1;
        let entryFrames = 0;
        if (policy.coherentTrajectory && (needsRing || needsTilt || needsPan)) {
          const wanted = Math.max(
            ORBIT_ENTRY_MIN_SECONDS,
            needsRing ? lateralSeconds : 0,
            needsTilt ? tiltSeconds : 0,
            needsPan ? panSeconds : 0,
          );
          const capped = Math.min(wanted, orbitSeconds * ORBIT_ENTRY_MAX_FRACTION);
          entryFrames = Math.round(capped * fps);
          if (entryFrames < 1) entryFrames = 0;
        }
        const sweepStart = sf + entryFrames;
        // Acquisition duration is DERIVED here, during keyframe generation, from
        // the camera state this walk has built up — the plan layer cannot know it.
        // That is exactly why the cost of it was invisible: the segment keeps its
        // requested duration and the sweep quietly gets whatever is left, so a
        // requested 180 deg over 16 s can be delivered as 180 deg over 11.2 s.
        // Nothing was wrong with the frames; the ANGULAR RATE silently stopped
        // matching the operator's own number.
        //
        // An opt-in out-parameter so a caller can report that instead of having to
        // re-derive it. Pure observation: no behaviour depends on it.
        if (Array.isArray(options.orbitTiming)) {
          options.orbitTiming.push({
            segment_id: segment.segment_id,
            requested_seconds: segment.duration_seconds,
            requested_arc_deg: Math.abs(Number(segment.orbit_degrees) || 0),
            segment_frames: ef - sf,
            acquisition_frames: entryFrames,
            sweep_frames: ef - sweepStart,
            frame_rate: fps,
            // Which channel actually SIZES the acquisition. `wanted` is a max over
            // three independent demands, so speeding up a channel that is not the
            // binding one buys nothing at all.
            acquisition_channels: {
              off_ring_m: offRingM,
              tilt_delta_deg: tiltDeltaDeg,
              pan_delta_deg: panDeltaDeg,
              sweep_ground_speed_mps: sweepGroundSpeed,
              lateral_seconds: needsRing ? lateralSeconds : 0,
              tilt_seconds: needsTilt ? tiltSeconds : 0,
              pan_seconds: needsPan ? panSeconds : 0,
              floor_seconds: ORBIT_ENTRY_MIN_SECONDS,
              cap_seconds: orbitSeconds * ORBIT_ENTRY_MAX_FRACTION,
              profile: options.acquisitionProfile || ACQUISITION_DEFAULT_PROFILE || null,
              lateral_speed_factor: lateralFactor,
              tilt_rate_deg_per_s: tiltRate,
            },
          });
        }
        if (entryFrames > 0) {
          // Bearing runs from wherever the camera actually is to the sweep's
          // starting bearing, along the shortest arc; radius converges
          // monotonically to the ring. At the ring's CENTRE the bearing is
          // undefined, so the camera moves straight out along theta0 — a purely
          // radial acquisition, which is also the shortest way onto the ring.
          const startBearing = startRadius > 1 ? bearingOf(state) : theta0;
          const bearingDelta = shortestLngDelta(startBearing, theta0);
          // Heading turns with the camera so it keeps facing the subject. Near
          // the centre at a top-down pitch heading is not visually meaningful,
          // so a smooth turn beats snapping to the ring's aim.
          const panTarget = aimHeading(ringEntry, locRef, state.pan, state.facing + shortestLngDelta(state.facing, theta0 + 180));
          const bearingSamples = Math.max(2, Math.ceil(Math.abs(bearingDelta) / stepDeg));
          // See ORBIT_ENTRY_DENSITY_DEFAULT. Gated on coherentTrajectory so the
          // legacy/freeform paths — including the byte-frozen controls — keep the
          // sampling they were frozen with.
          const densityMode = options.orbitEntryDensity !== undefined
            ? options.orbitEntryDensity : ORBIT_ENTRY_DENSITY_DEFAULT;
          let entrySamples = bearingSamples;
          // "with_altitude" additionally pins altitude on the sample time base.
          // Position density ALONE was measured 3.1x worse in real Earth Studio
          // (0.0948 -> 0.2969) because lat/lng/tilt linearize while altitude keeps
          // its two-keyframe ease, so the position triple desynchronizes. This
          // emits the altitude values the existing ramp already targets at the
          // same frames — no formula changes, radius stays linear in u.
          const tiltSchedule = options.orbitEntryTiltSchedule !== undefined
            ? options.orbitEntryTiltSchedule : ORBIT_ENTRY_TILT_SCHEDULE_DEFAULT;
          // Gated on coherentTrajectory like the density switch, so byte-frozen and
          // legacy paths keep the linear schedule they were frozen with.
          const identityTilt = policy.coherentTrajectory && tiltSchedule === "identity";
          const densifyAltitude = densityMode === 'with_altitude'
            || (densityMode && typeof densityMode === 'object' && densityMode.altitude);
          if (policy.coherentTrajectory && densityMode) {
            const raw = densityMode && typeof densityMode === 'object'
              ? densityMode.multiplier : densityMode;
            const multiplier = Number.isFinite(raw) ? Math.max(1, raw) : 1;
            const sweepStepGroundM = Math.abs(radius) * toRadians(stepDeg);
            const radialTravelM = Math.abs(radius - startRadius);
            const radialSamples = sweepStepGroundM > 1e-6
              ? Math.ceil((radialTravelM * multiplier) / sweepStepGroundM) : 0;
            entrySamples = Math.max(2, bearingSamples, radialSamples);
          }
          // Anchor pitch and altitude at the boundary FIRST. Without this the
          // acquisition's tilt keyframe is the track's next keyframe after the
          // opening one, so the change interpolates from frame 0 and the pitch
          // creeps upward through the whole PRECEDING movement: a fly->orbit
          // measured 45 deg at t=0 drifting to 51.8 deg by the time the orbit
          // even started. Acquisition must be confined to its own window.
          anchor("tilt", sf);
          anchor("alt", sf);
          // See FRAMING_STABLE_ACQUISITION_DEFAULT. Co-sampling altitude here is
          // what makes the coupling computable: the two-keyframe eased altitude is
          // exactly the channel that breaks it.
          const framingStable = options.framingStableAcquisition !== undefined
            ? !!options.framingStableAcquisition : FRAMING_STABLE_ACQUISITION_DEFAULT;
          const coupleRadius = framingStable && needsRing && needsTilt
            && Math.abs(tilt) > 1e-6 && endAltitude > 0;
          // Scale so the last sample lands on the ring EXACTLY, whatever the
          // look-at product happens to be there (the ring radius carries its own
          // clamp and rounding).
          const couplingScale = coupleRadius
            ? radius / Math.max(1e-6, endAltitude * Math.tan(toRadians(tilt))) : 1;
          let acquisitionLng = state.longitude;
          for (let i = 1; i <= entrySamples; i += 1) {
            const u = i / entrySamples;
            const altAtU = state.altitude + (endAltitude - state.altitude) * u;
            const tiltAtU = state.tilt + (tilt - state.tilt) * u;
            const radiusAtU = coupleRadius
              ? altAtU * Math.tan(toRadians(tiltAtU)) * couplingScale
              : startRadius + (radius - startRadius) * u;
            const pt = offsetPoint(locRef, startBearing + bearingDelta * u, radiusAtU);
            pt.longitude = continuousLng(acquisitionLng, pt.longitude);
            acquisitionLng = pt.longitude;
            const frame = sf + entryFrames * u;
            const interior = i < entrySamples;
            // Altitude has to be sampled on the same time base or the coupling is
            // against a curve the radius never actually sees.
            if (coupleRadius || densifyAltitude) put("alt", frame, altAtU, interior);
            // Only emit what actually has to be acquired. When the camera is
            // already on the ring (a fly/zoom annotated to land on the ring
            // entry) and only the pitch has to settle, re-placing position adds
            // keyframes that move the camera by ~1 m of rounding noise and
            // nothing else.
            if (needsRing) {
              put("lat", frame, pt.latitude, interior);
              put("lng", frame, pt.longitude, interior);
            }
            if (needsRing || needsPan) {
              put("pan", frame, state.pan + (panTarget - state.pan) * u, interior);
              if (i === entrySamples) tagAim(locRef);
            }
            if (needsTilt) {
              let tiltValue = state.tilt + (tilt - state.tilt) * u;
              if (identityTilt && radiusAtU > 0 && altAtU > 0) {
                // Force the LAST sample to the orbit's own tilt: atan returns it to
                // ~1e-13 already, but the sweep's geometry must not inherit a
                // rounding residual.
                tiltValue = i === entrySamples
                  ? tilt : (Math.atan2(radiusAtU, altAtU) * 180) / Math.PI;
              }
              put("tilt", frame, round6(tiltValue), interior);
            }
          }
          // Altitude also finishes here, so the sweep holds it. When coupled it was
          // already emitted sample by sample above.
          if (!coupleRadius && !densifyAltitude && state.altitude !== endAltitude) change("alt", sf, sweepStart, endAltitude);
          if (needsRing) {
            lastPoint = offsetPoint(locRef, theta0, radius);
            lastPoint.longitude = continuousLng(acquisitionLng, lastPoint.longitude);
            state = { ...state, latitude: lastPoint.latitude, longitude: lastPoint.longitude, pan: panTarget, facing: theta0 + 180 };
          } else {
            // Heading was acquired without re-placing position: the sweep
            // continues from the acquired heading, never from a fresh base
            // representative (measured: 729.96° → 19.74° in 15 frames).
            state = { ...state, pan: needsPan ? panTarget : state.pan, facing: theta0 + 180 };
          }
          state = { ...state, altitude: endAltitude, tilt };
        }
        // Snap to the sweep's opening heading ONLY when no acquisition phase is
        // going to interpolate pan itself. Doing both put a spurious keyframe at
        // the boundary and the heading dipped and came back (measured 170.5 ->
        // 85.3 -> 170.5 within 15 frames) — a pan wobble at the very moment the
        // orbit starts.
        if (policy.coherentTrajectory && entryFrames === 0 && orbitStartFacing !== state.facing) {
          const snapped = aimHeading(state, locRef, state.pan, orbitStartFacing);
          put("pan", sf, snapped);
          tagAim(locRef);
          state = { ...state, pan: snapped, facing: orbitStartFacing };
        }
        // After an acquisition the sweep continues from the pan the entry left.
        // `sweepFacingBase` is the ring-facing shadow (θ + 180) the old pan was;
        // `sweepPan` is the emitted heading, aimed from each ring sample.
        const sweepFacingBase = entryFrames > 0 ? theta0 + 180 : orbitStartFacing;
        let sweepPan = state.pan;
        const spanFrames = ef - sweepStart;
        for (let i = 1; i <= sampleCount; i += 1) {
          // TIME-QUANTIZED SAMPLING: take the ANGLE at the frame this sample
          // actually lands on, not at the ideal fractional time.
          //
          // Every keyframe is rounded to an integer frame. When the sweep's frame
          // span does not divide by the sample count the intervals alternate —
          // 27,26,27,27,26,... for 480 frames over 18 samples — and that
          // distribution is already optimal: they differ by exactly one frame and
          // alternate regularly, which is what a Bresenham-style redistribution
          // would produce anyway. Redistributing the rounding therefore cannot
          // help, and 480/18 simply has no integer answer.
          //
          // The ripple came from a MISMATCH rather than from the rounding. The
          // angle was taken at the ideal time while the keyframe landed at the
          // rounded one, so every chord subtended an identical angle but was
          // given a different number of frames to cross. Angular rate alternated
          // by the same 1/26 the frames did: 3.85% measured on a 180 deg / 16 s
          // orbit, an order of magnitude above the 0.38% the 10 deg chord
          // geometry contributes.
          //
          // Taking the angle at the ACTUAL frame makes each chord proportional to
          // the frames available to cross it, so the rate is uniform by
          // construction. Same sample count, same keyframes, same 10 deg
          // geometry, exact first and last frame, exact swept arc — only the
          // sample times and the angles that match them change.
          // Gated with every other motion improvement in this file, so the
          // byte-frozen freeform path stays byte-frozen by construction rather
          // than by luck. (It happens to be a no-op on the current frozen
          // control — its legacy 30 deg sampling gives 1080 frames over 24
          // samples, exactly 45 each — but a freeform orbit whose span did not
          // divide would have moved, and that is not a thing to leave to chance.)
          const frame = sweepStart + (policy.coherentTrajectory
            ? Math.round((spanFrames * i) / sampleCount)
            : (spanFrames * i) / sampleCount);
          const t = policy.coherentTrajectory && spanFrames > 0
            ? (frame - sweepStart) / spanFrames
            : i / sampleCount;
          const ringSample = offsetPoint(locRef, theta0 + sweep * t, radius);
          ringSample.longitude = continuousLng(lastPoint.longitude, ringSample.longitude);
          lastPoint = ringSample;
          // Interior samples sweep at a constant rate; the closing sample keeps
          // its normal arrival easing so the orbit settles rather than stopping
          // dead.
          const closing = i === sampleCount;
          const interior = policy.coherentTrajectory
            ? (closing ? (resolved[idx + 1] ? "in" : false) : true)
            : false;
          put("lat", frame, lastPoint.latitude, interior);
          put("lng", frame, lastPoint.longitude, interior);
          // Heading is CO-SAMPLED with position: the camera faces the target
          // from wherever it actually is, on the same time base and with the
          // same transition shape. A 2-keyframe eased pan against a ~uniform
          // multi-sample ground path gives look direction and position two
          // different velocity profiles, and the subject slides across frame
          // through the middle of the orbit (measured: 28 deg off-target).
          if (policy.coherentTrajectory) {
            sweepPan = aimHeading(lastPoint, locRef, sweepPan, sweepFacingBase + sweep * t);
            put("pan", frame, sweepPan, interior);
            tagAim(locRef);
          }
        }
        // Phase C holds radius, altitude and pitch — acquisition already put the
        // camera in orbit geometry, so these are no-ops after a real entry.
        change("alt", sweepStart, ef, endAltitude);
        change("tilt", sweepStart, ef, tilt);
        let legacyEndPan = null;
        if (!policy.coherentTrajectory) {
          // A two-key legacy sweep has no interior samples to accumulate the
          // winding through, so the end representative is chosen relative to
          // the commanded sweep from the current heading.
          legacyEndPan = aimHeading(lastPoint, locRef, state.pan + sweep, orbitStartFacing + sweep);
          change("pan", sf, ef, legacyEndPan);
          if (last("pan") && last("pan").time === ef) tagAim(locRef);
        }
        // ── SETTLE-THEN-LAUNCH orbit→travel handoff (human-approved DIRN17) ──
        // If the next playable segment travels somewhere materially different
        // from this orbit's exit tangent, the boundary keyframe would redirect
        // the ground-velocity vector in one frame (DIRN17 measured 73.12° in
        // real playback). Decelerate the orbit into the boundary, hold for the
        // reviewed 0.5 s, and let the travel leg launch from rest. Activation
        // is geometric: heading mismatch above ORBIT_TRAVEL_HANDOFF.
        // direction_threshold_deg with both speeds over the floor. A benign
        // handoff keeps the existing continuous transition byte-for-byte.
        const handoffNext = (() => {
          for (let j = idx + 1; j < resolved.length; j += 1) {
            const cand = resolved[j];
            if (!cand.location || cand.holds_camera) continue;
            if (["fly_to", "zoom_in", "zoom_out"].includes(cand.action)) return cand;
            return null; // another orbit/hover owns what follows
          }
          return null;
        })();
        if (policy.coherentTrajectory && handoffNext && options.compareLegacyMotion !== true) {
          const h = ORBIT_TRAVEL_HANDOFF;
          const fpsH = plan.frame_rate || FRAME_RATE;
          // Only a successor that genuinely TRAVELS somewhere else qualifies —
          // the same gate the orbit's exit-phase solver uses. A same-subject
          // zoom_out/pull-back after an orbit is already continuous with it
          // (measured on DIRN17 segment 6: no seam, real playback clean) and
          // must keep its existing launch.
          const travelsAway = haversineMeters(location, handoffNext.location) > Math.max(radius * 2, 1000);
          const exitRadialDeg = theta0 + sweep;
          const tangentBearing = exitRadialDeg + 90 * Math.sign(sweep || 1);
          const cosLatH = Math.cos(toRadians(lastPoint.latitude)) || 1e-6;
          const dLngH = shortestLngDelta(0, handoffNext.location.longitude - lastPoint.longitude);
          const eastM = dLngH * 111320 * cosLatH;
          const northM = (handoffNext.location.latitude - lastPoint.latitude) * 111320;
          const travelBearing = Number.isFinite(Math.atan2(eastM, northM))
            ? (Math.atan2(eastM, northM) * 180) / Math.PI : tangentBearing;
          const turnDeg = Math.abs(((travelBearing - tangentBearing + 540) % 360) - 180);
          const exitTangentSpeed = radius * Math.abs(toRadians(sweep)) / Math.max(1e-6, (ef - sweepStart) / fpsH);
          const travelDistanceM = haversineMeters(lastPoint, handoffNext.location);
          const activates = travelsAway && turnDeg > h.direction_threshold_deg
            && exitTangentSpeed > h.speed_floor_mps && travelDistanceM > 1000;
          if (Array.isArray(options.orbitTravelHandoff)) {
            options.orbitTravelHandoff.push({
              segment_id: segment.segment_id,
              successor: handoffNext.segment_id,
              turn_deg: Math.round(turnDeg * 100) / 100,
              threshold_deg: h.direction_threshold_deg,
              exit_tangent_speed_mps: Math.round(exitTangentSpeed),
              activates,
            });
          }
          if (activates && ef + h.hold_frames < (plan.total_frames || ef + h.hold_frames + 1)) {
            const boundaryFrame = ef;
            const holdFrame = ef + h.hold_frames;
            const markBoundary = (trackName) => {
              const track = tracks[trackName];
              const kf = track[track.length - 1];
              if (!kf || kf.time !== boundaryFrame) {
                // No keyframe on this channel exactly at the boundary (e.g.
                // altitude/tilt were last keyed at sweep start and hold a
                // constant value through the orbit's end): anchor one at the
                // boundary and hold it, mirroring the reviewed candidate,
                // which authored the hold on every one of these channels.
                put(trackName, boundaryFrame, track.length ? track[track.length - 1].value : 0, "out");
                const anchorKf = track[track.length - 1];
                anchorKf.orbitTravelHandoff = "settle_boundary";
                anchorKf.semanticBoundary = true;
                const holdKf = espKeyframe(holdFrame, anchorKf.value);
                holdKf.orbitTravelHandoff = "settle_hold";
                holdKf.semanticBoundary = true;
                track.push(holdKf);
                return;
              }
              kf.orbitTravelHandoff = "settle_boundary";
              kf.semanticBoundary = true;
              const holdKf = espKeyframe(holdFrame, kf.value);
              holdKf.orbitTravelHandoff = "settle_hold";
              holdKf.semanticBoundary = true;
              track.push(holdKf);
            };
            ["lat", "lng", "alt", "tilt"].forEach(markBoundary);
            // Pan matches the approved candidate exactly: the boundary key
            // gets the decelerating custom arrival, but NO hold key — the
            // candidate left pan unkeyed after the boundary, and a hold key
            // here would be a redundant flat key whenever the following
            // travel keeps pan fixed.
            {
              const track = tracks.pan;
              const kf = track[track.length - 1];
              if (!kf || kf.time !== boundaryFrame) {
                put("pan", boundaryFrame, track.length ? track[track.length - 1].value : 0, "out");
              }
              const panKf = track[track.length - 1];
              panKf.orbitTravelHandoff = "settle_boundary";
              panKf.semanticBoundary = true;
              // The approved candidate authored ONLY the custom arrival on
              // pan — no out-transition at all. Mark it so the serializer
              // omits transitionOut here instead of emitting linear.
              panKf.orbitTravelHandoffPanArrivalOnly = true;
            }
          }
        }
        state = { latitude: lastPoint.latitude, longitude: lastPoint.longitude, altitude: endAltitude,
          pan: policy.coherentTrajectory ? sweepPan : legacyEndPan, facing: sweepFacingBase + sweep, tilt };
        return;
      }

      // fly_to / hover / zoom_in / zoom_out: move (or hold) position, with an
      // eased altitude profile and a cinematic arc on long flights.
      // Settle-hold (motion profile v2): the shot's FINAL positional move
      // completes early and holds — approved internet references end all
      // motion before the last frame (mountkinabalu t=0.80) instead of moving
      // into a hard final-frame stop.
      let em = ef;
      if (!options.compareLegacyMotion && idx === resolved.length - 1 && segment.action !== "hover" && segment.duration_seconds >= MOTION_SETTLE.min_segment_seconds) {
        const fpsFrames = (plan.frame_rate || FRAME_RATE);
        const hold = Math.min(Math.round((ef - sf) * MOTION_SETTLE.fraction), Math.round(MOTION_SETTLE.max_seconds * fpsFrames));
        if (hold >= Math.round(MOTION_SETTLE.min_hold_seconds * fpsFrames)) em = ef - hold;
      }
      const distance = haversineMeters(state, location);
      // The cinematic arc adds a sine hump inside one fly_to, which reads as the
      // camera wobbling up and back down mid-move (measured: a 15 s Helsinki ->
      // Stockholm route climbed 51 -> 190 -> 51 km). Under a coherent-trajectory
      // policy the altitude profile belongs to the journey's travel shape
      // (pull back / cruise / descend), which is monotonic per movement.
      const arcBump = !policy.coherentTrajectory && segment.action === "fly_to" && distance > 30000
        ? Math.min(distance * 0.35, 2500000) : 0;
      const constrainedSpaceZoom = segment.action === "zoom_out"
        && segment.tilt_source === "semantic_space_composition";
      // A MONOTONIC altitude change needs exactly two keyframes. Sampling a
      // smoothstep at 0.25/0.5/0.75/1 and then letting the serializer ease each
      // sample shapes the same move twice, and because a default handle has
      // y = 0 (horizontal, slope pinned to zero) every interior sample becomes
      // a dead stop: measured 3 interior stalls on every altitude change, so a
      // simple climb or push played as four little lurches. The easing profile
      // already supplies the ease-out departure and decelerating arrival, so
      // dropping the interior samples is both smoother AND fewer keyframes.
      //
      // Two cases keep their samples because the samples carry real
      // information rather than a re-shaped ease:
      //   arcBump            — the legacy sine hump is not monotonic.
      //   constrainedSpaceZoom — each sample enforces the globe-limb
      //                          composition bound at that altitude.
      const monotonicAltitude = policy.coherentTrajectory && !arcBump && !constrainedSpaceZoom;
      if (monotonicAltitude) {
        if (state.altitude !== endAltitude) {
          change("alt", sf, em, Math.round(clampAltitude(endAltitude, minAlt)));
        }
      } else if (arcBump || state.altitude !== endAltitude) {
        anchor("alt", sf);
        const altitudeFractions = constrainedSpaceZoom
          ? Array.from({ length: SPACE_ZOOM_COMPOSITION_SAMPLES }, (_, i) => (i + 1) / SPACE_ZOOM_COMPOSITION_SAMPLES)
          : [0.25, 0.5, 0.75, 1];
        altitudeFractions.forEach((t, sampleIndex) => {
          const eased = state.altitude + (endAltitude - state.altitude) * smoothstep(t);
          const sampledAltitude = Math.round(clampAltitude(eased + arcBump * Math.sin(Math.PI * t), minAlt));
          // A constrained space zoom NEEDS all 16 samples — each one pins the
          // globe-limb composition bound at that altitude — but their ease
          // handles were pinning the climb rate to zero 14 times on the way up.
          // Keep the samples, drop the handles.
          const interior = policy.coherentTrajectory && constrainedSpaceZoom
            && sampleIndex < altitudeFractions.length - 1;
          put("alt", sf + (em - sf) * t, sampledAltitude, interior);
          if (constrainedSpaceZoom) {
            const authoredTilt = state.tilt
              + (segment.unconstrained_tilt_deg - state.tilt) * smoothstep(t);
            put("tilt", sf + (em - sf) * t,
              round6(Math.min(authoredTilt, maxDerivedSpaceZoomTiltDeg(sampledAltitude))), interior);
          }
        });
      }
      // Successor-orbit ring entry (plan-annotated lookahead): land the move
      // exactly where the following orbit begins — its ring point at the
      // bearing the camera already faces away from (state.pan − 180, the
      // orbit's own accepted entry convention), at the radius the orbit will
      // use (its altitude·tan(tilt)). Position becomes continuous through the
      // boundary; altitude/tilt keep their existing in-orbit transitions.
      let destLat = location.latitude;
      let destLng = targetLng;
      let orbitEntryApproach = null;
      // A camera-position hold (hover at the same target) stays exactly where
      // the camera is — after an orbit that is the ring, not the center.
      // A STAGED opening hold also holds: it was deliberately placed on the
      // following orbit's ring, and an opening hover does not set holds_camera
      // (there is no previous camera to hold), so without this it would spend
      // its whole duration sliding from the ring back to the target centre and
      // undo the staging.
      if (segment.holds_camera || segment.stages_orbit_entry) {
        destLat = state.latitude;
        destLng = state.longitude;
      }
      // A hold sitting between a staged arrival and its orbit must be EXACTLY
      // static, and equal-valued keyframes alone do not guarantee that: Earth
      // Studio derives an `auto` tangent from the keyframes on either SIDE of
      // the hold, so the fly's approach-shaping point and the orbit's first ring
      // sample together bow the flat span between them. Measured at 27.7 m of
      // position drift inside a hold that must not move at all, first violation
      // one frame in.
      //
      // Hard-linear between two equal values is exactly flat, and it is the one
      // transition semantics this repo has proven Earth Studio preserves
      // verbatim. Only the hold-facing sides are pinned, so the fly keeps its
      // eased arrival and the orbit keeps its own departure.
      const stagedThroughHold = !!(segment.holds_camera && idx > 0
        && resolved[idx - 1] && resolved[idx - 1].ends_at_orbit_entry
        && resolved[idx - 1].ends_at_orbit_entry !== segment.segment_id
        && resolved.some((s) => s && s.segment_id === resolved[idx - 1].ends_at_orbit_entry
          && s.action === "orbit"));
      const next = resolved[idx + 1];
      // `ends_at_orbit_entry` names a segment BY ID, and since the mid-journey
      // staging reads through a held segment that orbit is not always the very
      // next one. Resolve it by id: assuming adjacency here silently dropped the
      // staging for `fly -> hold -> orbit`.
      const orbitEntrySeg = segment.ends_at_orbit_entry
        ? resolved.find((s) => s && s.segment_id === segment.ends_at_orbit_entry) : null;
      if (orbitEntrySeg && orbitEntrySeg.action === "orbit") {
        const nextMinAlt = (orbitEntrySeg.location && orbitEntrySeg.location.min_altitude_m) || 0;
        const nextAlt = clampAltitude(orbitEntrySeg.altitude_m || DEFAULT_ALTITUDE_M, nextMinAlt);
        const nextTilt = typeof orbitEntrySeg.tilt_deg === "number" ? orbitEntrySeg.tilt_deg : 45;
        const entry = offsetPoint({ latitude: location.latitude, longitude: targetLng },
          state.facing - 180, orbitRingRadiusMeters(orbitEntrySeg.location, nextAlt, nextTilt));
        entry.longitude = continuousLng(state.longitude, entry.longitude);
        destLat = entry.latitude;
        destLng = entry.longitude;
        if (policy.coherentTrajectory) {
          const entryRadius = orbitRingRadiusMeters(orbitEntrySeg.location, nextAlt, nextTilt);
          const entryBearing = state.facing - 180;
          const orbitTangent = entryBearing + 90 * (orbitEntrySeg.orbit_direction || 1);
          const approachDistance = Math.min(
            haversineMeters(state, entry) * 0.25,
            entryRadius * 0.75,
            50000,
          );
          if (approachDistance > 100) {
            // Approach from behind the first orbital tangent. This adds only a
            // final shaping point; the endpoint remains the exact ring entry.
            orbitEntryApproach = offsetPoint(entry, orbitTangent + 180, approachDistance);
          }
        }
      }
      if (orbitEntryApproach && em - sf >= 4) {
        // The approach key is emitted before the endpoint change below. Fence
        // every position channel at the segment boundary first, otherwise the
        // later key becomes the first neighbour and Earth Studio starts the
        // orbit approach inside the preceding hold.
        anchor("lng", sf);
        anchor("lat", sf);
        const approachFrame = sf + Math.max(1, Math.round((em - sf) * 0.8));
        const approachLng = state.longitude + shortestLngDelta(state.longitude, orbitEntryApproach.longitude);
        put("lng", approachFrame, approachLng);
        put("lat", approachFrame, orbitEntryApproach.latitude);
      }
      // ── Long-crossing cruise (see CRUISE_* constants) ──────────────────
      // Three segments instead of one: ease up to a travel speed, hold it, ease
      // down. The cruise boundaries carry the cruise SLOPE as a real handle, so
      // the accelerating segment ARRIVES at travel speed instead of stalling
      // against a horizontal y = 0 handle, and the cruise itself is
      // linear-to-linear — the one interpolation this repo has proven Earth
      // Studio reproduces verbatim.
      const cruiseProfile = CRUISE_PROFILES[options.cruiseProfile || CRUISE_DEFAULT_PROFILE] || null;
      const cruiseMoveSeconds = (em - sf) / (plan.frame_rate || FRAME_RATE);
      const cruiseApplies = policy.coherentTrajectory
        && cruiseProfile
        && segment.action === "fly_to"
        && !segment.holds_camera
        && !segment.ends_at_orbit_entry
        && cruiseMoveSeconds > CRUISE_MIN_SECONDS
        && distance > CRUISE_MIN_DISTANCE_M
        && (destLat !== state.latitude || destLng !== state.longitude);
      if (cruiseApplies) {
        const { accel, decel } = cruiseProfile;
        const v = 1 / (1 - (accel + decel) / 2);
        const spanF = em - sf;
        const fromLat = state.latitude;
        const fromLng = state.longitude;
        const dLat = destLat - fromLat;
        const dLng = destLng - fromLng;
        const pA = (v * accel) / 2;
        const pB = 1 - (v * decel) / 2;
        const frameA = sf + spanF * accel;
        const frameB = sf + spanF * (1 - decel);
        const rateLat = (dLat * v) / spanF;
        const rateLng = (dLng * v) / spanF;
        anchor("lng", sf);
        anchor("lat", sf);
        put("lat", frameA, fromLat + dLat * pA, true);
        setRate("lat", "in", rateLat);
        put("lng", frameA, fromLng + dLng * pA, true);
        setRate("lng", "in", rateLng);
        put("lat", frameB, fromLat + dLat * pB, true);
        setRate("lat", "out", rateLat);
        put("lng", frameB, fromLng + dLng * pB, true);
        setRate("lng", "out", rateLng);
        put("lat", em, destLat);
        put("lng", em, destLng);
      } else {
        change("lng", sf, em, destLng);
        change("lat", sf, em, destLat);
      }
      if (stagedThroughHold) {
        pinOut("lng");
        pinOut("lat");
        put("lng", em, destLng, "in", true);
        put("lat", em, destLat, "in", true);
      }
      // A HOLD AFTER A MOVEMENT THAT IS STILL MOVING AT THE BOUNDARY must be
      // fenced hard-linear on both hold-facing sides. An orbit's sweep ends at
      // full tangential speed (its closing ring sample is a through-boundary
      // key, not a terminal settle), and an `auto` handle on that key — or on
      // the hold's end key — derives its tangent from the MOVING neighbours, so
      // Earth Studio bows the flat hold span: measured 210.7 m of transient
      // position drift inside a 4 s hold after a 17 km-altitude orbit, returning
      // to the same endpoint (invisible to endpoint checks, visible in playback).
      // Fly / zoom arrivals already decelerate to rest (custom arrival handles),
      // so their holds do not bow and are left byte-identical. A hold that ENDS
      // the animation has no far-side neighbour for a tangent to lean on, so it
      // cannot bow either and stays exactly as before (no end key is added).
      // Only the hold-facing sides are pinned: the arrival keeps its easing on
      // the way in, the next movement keeps its own departure.
      const holdAfterMotion = !!(segment.holds_camera && idx > 0
        && resolved[idx - 1] && resolved[idx - 1].action === "orbit"
        && resolved[idx + 1]);
      if (holdAfterMotion) {
        for (const trackName of ["lng", "lat", "alt", "pan", "tilt"]) {
          const prev = last(trackName);
          if (!prev || prev.time !== sf) continue;
          pinOut(trackName);
          put(trackName, em, prev.value, "in", true);
        }
      }
      if (!constrainedSpaceZoom) {
        const enteringOrbit = policy.coherentTrajectory && segment.ends_at_orbit_entry
          && last("tilt") && last("tilt").value !== tilt;
        if (enteringOrbit) {
          // Hold the incoming tilt, then tip into the ring over as much of the
          // move as a calm rotation rate needs (never more than the whole move).
          const fps = plan.frame_rate || FRAME_RATE;
          const delta = Math.abs(tilt - last("tilt").value);
          const needFrames = Math.min(em - sf, (delta / ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S) * fps);
          anchor("tilt", sf);
          put("tilt", em - needFrames, last("tilt").value);
        }
        change("tilt", sf, em, tilt);
      }
      state = { latitude: destLat, longitude: destLng, altitude: endAltitude, pan: state.pan, tilt, facing: state.facing };
    });
    // Terminal camera state out-channel: the state machine's last state IS the
    // ending frame's camera, in real-world units (longitude still unwrapped —
    // finalCameraState wraps it for export). Purely additive: callers that do
    // not pass captureState see byte-identical behavior.
    // Longitude is exported as the continuous scalar the state machine
    // authored (see exportLongitudeTrack); no seam scaffolding is added.
    tracks.lng = api.exportLongitudeTrack(tracks.lng, espKeyframe, round6);
    if (options.captureState && typeof options.captureState === "object") {
      options.captureState.final = state ? { ...state } : null;
    }
    if (policy.dedupeKeyframes) {
      Object.keys(tracks).forEach((k) => { tracks[k] = api.dropRedundantKeyframes(tracks[k]); });
    }
    return { tracks, state };
  }
    function compileTrajectory(plan, options = {}) {
      const policy = api.motionPolicy(plan, options);
      const { tracks, state } = buildEspKeyframes(plan, options, policy);
      // Convert only after legacy longitude preprocessing/deduplication, where
      // aimAt participates in retention. The compatibility adapter inverts it.
      for (const name of Object.keys(tracks)) {
        tracks[name] = tracks[name].map((key) => key.aimAt
          ? { ...key, aimAt: { lat: key.aimAt.latitude, lng: key.aimAt.longitude } }
          : key);
      }
      return {
        schema: TRAJECTORY_SCHEMA,
        frame_rate: plan.frame_rate,
        total_frames: plan.total_frames,
        keyed: tracks,
        terminal_camera: state ? { lat: state.latitude, lng: state.longitude,
          alt: state.altitude, pan: state.pan, tilt: state.tilt } : null,
        markers: computeTrajectoryMarkers(plan),
        motion_policy: policy,
      };
    }
    return { compileTrajectory };

  }
  const api = { TRAJECTORY_SCHEMA, motionPolicy, exportLongitudeTrack,
    dropRedundantKeyframes, computeTrajectoryMarkers, legacyTracksFromTrajectory, createCompiler };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.EarthStudioCameraTrajectory = api;
})(typeof window !== "undefined" ? window : globalThis);
