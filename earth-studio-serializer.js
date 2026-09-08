// Frozen M1 ESP projection. Camera semantics come only from CameraTrajectory.
(function earthStudioSerializerBootstrap(globalScope) {
  "use strict";
  function createSerializer({ MOTION_EASING, ORBIT_TRAVEL_HANDOFF, ESP_MODEL_VERSION, ESP_ALTITUDE_SCALE, round6 }) {
  function espLeaf(type, keyframes, valueMeta = {}) {
    if (!keyframes || !keyframes.length) return { type, value: { ...valueMeta } };
    return { type, value: { relative: 0, ...valueMeta }, keyframes, intimeline: true };
  }
  function buildEspFromTrajectory(cameraTrajectory, options) {
    const { width, height } = options;
    const totalFrames = Math.max(1, cameraTrajectory.total_frames || 1);
    const policy = cameraTrajectory.motion_policy;
    const tracks = cameraTrajectory.keyed;
    const frac = (frame) => Math.min(1, Math.max(0, frame / totalFrames));
    // Reference-informed easing (see MOTION_EASING): handles span a fraction of
    // the gap to the neighbor keyframe — easeOut departure, auto interiors,
    // custom decelerating arrival. Single-keyframe tracks stay untouched.
    // Role-correct easing (profile v4):
    //   departure        — first keyframe eases out (0.25 x gap)
    //   interior         — auto both sides (0.30 x gap, derived influence)
    //   segment arrival  — the keyframe ENDING a fly/zoom move mid-track gets
    //                      the Google-template deceleration (positional
    //                      0.99 x gap, altitude 2.5 x gap; out-side LINEAR,
    //                      exactly as the template authors it). Boundaries
    //                      flagged ends_at_orbit_entry are excluded — the
    //                      fly->orbit transition must stay continuous.
    //   terminal arrival — the track's last keyframe eases in gently
    //                      (multi-reference 0.25/0.29, influence 0.4).
    const legacy = Boolean(options.compareLegacyMotion);
    // SETTLE-THEN-LAUNCH orbit→travel handoff: keyframes marked during the
    // state walk. The boundary key decelerates the orbit into rest (calibrated
    // custom arrival, -0.25·gap / influence 0.4 — the same settle law as a
    // terminal arrival) and departs hard-linear into the hold; the hold key
    // departs easeOut so the following travel launches progressively from
    // rest. Pan keeps only the incoming deceleration (the reviewed candidate's
    // exact treatment). dropRedundantKeyframes preserves these via
    // semanticBoundary.
    const handoffBoundary = new Set();
    const handoffHold = new Set();
    for (const trackName of ["lat", "lng", "alt", "tilt", "pan"]) {
      (tracks[trackName] || []).forEach((k, i) => {
        if (k.orbitTravelHandoff === "settle_boundary") {
          handoffBoundary.add(`${trackName}:${i}`);
          const next = (tracks[trackName] || [])[i + 1];
          if (next && next.orbitTravelHandoff === "settle_hold") handoffHold.add(`${trackName}:${i + 1}`);
        }
      });
    }
    const boundaryFracs = new Set(cameraTrajectory.markers
      .filter((marker) => marker.kind === "segment-arrival")
      .map((marker) => frac(marker.frame)));
    const kfs = (arr, mapValue, kind, trackName0) => arr.map((k, i) => {
      const kf = { time: frac(k.time), value: mapValue(k.value) };
      // Interior sample of a described curve (orbit ring, space-zoom climb):
      // hard-linear on BOTH sides.
      //
      // A default handle has y = 0, i.e. it is horizontal, which pins the
      // value's slope to zero at that keyframe. Correct for a departure or an
      // arrival; ruinous on a sampled circle, where it makes the camera
      // decelerate to a standstill at every sample (measured: 142% swing in
      // cruise angular velocity — a visibly stuttering orbit).
      //
      // Two ways out: author the circle's true tangent as a non-zero handle y
      // (what the human-authored reference darien-gap.esp does), or drop the
      // handles so the segment is straight. Tangent handles model the circle
      // better in theory, but their playback depends on how Earth Studio weighs
      // `influence`, which cannot be verified without a real import; hard-linear
      // is the one transition semantics this repo has already PROVEN Earth
      // Studio preserves verbatim. Measured on a 20 s / 360 deg orbit, linear
      // interiors give 6.8% cruise ripple against 13.8% for modelled tangent
      // handles, so the proven option is also the better-measuring one.
      // Residual ripple is pure polygonization and shrinks with sample density.
      //
      // The opening and closing keyframes are NOT flagged, so the move still
      // eases out of rest and settles at the end.
      if (!legacy && k.sampledInterior === true) {
        kf.transitionIn = { x: 0, y: 0, type: "linear" };
        kf.transitionOut = { x: 0, y: 0, type: "linear" };
        // A CRUISE BOUNDARY is a sampled interior with an analytic slope on one
        // side. The cruise side stays hard-linear (constant speed); the side
        // facing the eased departure or arrival carries the cruise slope as a
        // real handle, so that neighbouring segment meets travel speed instead
        // of the zero slope a default y = 0 handle would force. mapValue is
        // affine for every track, so its scale is recovered with a probe wide
        // enough to survive the round6 inside the mapper.
        const rateSide = (rate, gap, sign) => {
          const vScale = (mapValue(1000) - mapValue(0)) / 1000;
          const x = sign * gap / 3;
          const slope = rate * vScale * totalFrames;
          return { x: round6(x), y: round6(slope * x), type: "auto", influence: MOTION_EASING.interior_influence };
        };
        const gapPrevC = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        const gapNextC = i < arr.length - 1 ? frac(arr[i + 1].time) - frac(k.time) : 0;
        if (Number.isFinite(k.rateIn) && gapPrevC > 0) kf.transitionIn = rateSide(k.rateIn, gapPrevC, -1);
        if (Number.isFinite(k.rateOut) && gapNextC > 0) kf.transitionOut = rateSide(k.rateOut, gapNextC, 1);
        return kf;
      }
      if (!legacy && arr.length >= 2) {
        const gapPrev = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        const gapNext = i < arr.length - 1 ? frac(arr[i + 1].time) - frac(k.time) : 0;
        const cls = kind === "altitude" ? "altitude" : "positional";
      // SETTLE-THEN-LAUNCH orbit→travel handoff easing (checked before the
      // generic cases so the reviewed candidate's exact handle shapes win).
      const hKey = `${trackName0}:${i}`;
      if (!legacy && handoffBoundary.has(hKey)) {
        const gapPrevH = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        if (gapPrevH > 0) {
          kf.transitionIn = { x: round6(-ORBIT_TRAVEL_HANDOFF.arrival_fraction * gapPrevH), y: 0,
            influence: ORBIT_TRAVEL_HANDOFF.arrival_influence, type: "custom" };
        }
        // Pan matches the approved candidate exactly: the custom arrival and
        // NO out-transition at all (the candidate left pan unkeyed after the
        // boundary, so ES holds it; an authored out-handle would be noise).
        if (k.orbitTravelHandoffPanArrivalOnly) { delete kf.transitionOut; return kf; }
        // Departure into the hold is exactly flat — the settle itself.
        kf.transitionOut = { x: 0, y: 0, type: "linear" };
        return kf;
      }
      if (!legacy && handoffHold.has(hKey)) {
        const gapNextH = i < arr.length - 1 ? frac(arr[i + 1].time) - frac(k.time) : 0;
        // Launch the following travel progressively from rest. The hold key
        // sits at the START of the travel segment, so its out-span IS the
        // travel leg's opening.
        kf.transitionIn = { x: 0, y: 0, type: "linear" };
        kf.transitionOut = gapNextH > 0
          ? { x: round6(MOTION_EASING.departure_fraction * gapNextH), y: 0, type: "easeOut" }
          : { x: 0, y: 0, type: "linear" };
        return kf;
      }
      if (i === 0) {
          kf.transitionOut = { x: round6(MOTION_EASING.departure_fraction * gapNext), y: 0, type: "easeOut" };
        } else if (i === arr.length - 1) {
          const t = MOTION_EASING.terminal_arrival[cls];
          kf.transitionIn = { x: round6(-t.fraction * gapPrev), y: 0, influence: t.influence, type: "custom" };
        } else if (boundaryFracs.has(kf.time)) {
          const sa = MOTION_EASING.segment_arrival[cls];
          kf.transitionIn = { x: round6(-sa.fraction * gapPrev), y: 0, influence: sa.influence, type: "custom" };
          // Does motion continue through this boundary? If it does, a linear
          // out-side means the next movement starts instantly at full speed.
          const motionContinues = i < arr.length - 1 && arr[i + 1].value !== k.value;
          kf.transitionOut = (policy.coherentTrajectory && motionContinues)
            ? { x: round6(MOTION_EASING.interior_fraction * gapNext), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" }
            : { x: 0, y: 0, type: "linear" };
        } else {
          const wasStill = arr[i - 1].value === k.value;
          const willMove = i < arr.length - 1 && arr[i + 1].value !== k.value;
          const startsMoving = policy.coherentTrajectory && wasStill && willMove;
          const stopsMoving = policy.coherentTrajectory && !wasStill && !willMove;
          if (startsMoving) {
            // a real departure: hold still, then ease away
            kf.transitionIn = { x: round6(-MOTION_EASING.interior_fraction * gapPrev), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
            kf.transitionOut = { x: round6(MOTION_EASING.departure_fraction * gapNext), y: 0, type: "easeOut" };
          } else if (stopsMoving) {
            // a real arrival at rest: decelerate in, then hold still
            const t = MOTION_EASING.terminal_arrival[cls];
            kf.transitionIn = { x: round6(-t.fraction * gapPrev), y: 0, influence: t.influence, type: "custom" };
            kf.transitionOut = { x: round6(MOTION_EASING.interior_fraction * gapNext), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
          } else {
            kf.transitionIn = { x: round6(-MOTION_EASING.interior_fraction * gapPrev), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
            kf.transitionOut = { x: round6(MOTION_EASING.interior_fraction * gapNext), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
          }
        }
      }
      // Closing sample of a sampled curve: protect the curve on the way IN.
      //
      // An `auto` handle is NOT a zero-value tangent in real Earth Studio — it
      // derives a tangent from the NEIGHBOURING keyframes. The keyframe that
      // ends an orbit is also the keyframe that departs toward the next place,
      // so its incoming tangent was being derived against that destination.
      // Measured on "orbit the Colosseum, then fly to Paris": the ring bulged
      // from 1,214 m out to 3,745 m inside the last 0.57 s of the orbit,
      // because the incoming tangent pointed at Paris, 7 degrees of latitude
      // away.
      //
      // The fix is an explicit arrival handle rather than a derived one. A
      // `custom` handle's y is authored, not inferred from neighbours, so the
      // ring survives — and unlike a hard-linear in-side it also DECELERATES
      // the sweep into the boundary instead of arriving at full rate and then
      // dropping to the departure's zero slope, which is a hard stop.
      // Mirror of the "in" variant: protect only the span LEAVING this keyframe.
      // Used to fence a static hold, where the arrival easing must survive but
      // the hold itself must not bow.
      if (!legacy && k.sampledInterior === "out") {
        kf.transitionOut = { x: 0, y: 0, type: "linear" };
        return kf;
      }
      if (!legacy && k.sampledInterior === "in") {
        const arrival = MOTION_EASING.terminal_arrival[kind === "altitude" ? "altitude" : "positional"];
        const gap = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        // A closing orbit sample that is followed by another movement is a
        // through-boundary tangent, not a terminal settle. Arrival easing here
        // brakes the orbit into the boundary, then the next segment launches
        // again; real playback exposed that as a speed dip and pan-rate pulse.
        const continues = (i < arr.length - 1 && arr[i + 1].value !== k.value)
          // Orbit exit currently keeps pan fixed during the following travel;
          // its closing pan sample therefore has no later pan keyframe to
          // prove continuation, but it is still a through-boundary channel.
          || kind === "pan";
        // SETTLE-THEN-LAUNCH handoff boundary overrides the through-boundary
        // rule: the approved candidate decelerates the orbit into rest here
        // (calibrated custom arrival) even on pan, then holds.
        if (trackName0 && handoffBoundary.has(`${trackName0}:${i}`)) {
          kf.transitionIn = gap > 0
            ? { x: round6(-ORBIT_TRAVEL_HANDOFF.arrival_fraction * gap), y: 0,
              influence: ORBIT_TRAVEL_HANDOFF.arrival_influence, type: "custom" }
            : { x: 0, y: 0, type: "linear" };
          if (k.orbitTravelHandoffPanArrivalOnly) {
            // Approved candidate's exact pan treatment: arrival handle only.
            delete kf.transitionOut;
            return kf;
          }
          kf.transitionOut = { x: 0, y: 0, type: "linear" };
          return kf;
        }
        kf.transitionIn = continues
          ? { x: 0, y: 0, type: "linear" }
          : (gap > 0
            ? { x: round6(-arrival.fraction * gap), y: 0, influence: arrival.influence, type: "custom" }
            : { x: 0, y: 0, type: "linear" });
      }
      return kf;
    });
    const values = (arr) => arr.map((k) => k.value);

    const lngVals = values(tracks.lng);
    const latVals = values(tracks.lat);
    const panVals = values(tracks.pan);
    const lonMin = lngVals.length ? Math.min(...lngVals) : 0;
    const lonSpan = (180 - lonMin) || 360;
    const latMin = latVals.length ? Math.min(...latVals) : 0;
    const latSpan = (90 - latMin) || 180;
    const panMin = panVals.length ? Math.min(...panVals) : 0;
    const panSpan = (panVals.length ? Math.max(...panVals) - panMin : 0) || 360;

    return {
      modelVersion: ESP_MODEL_VERSION,
      settings: {
        name: options.name,
        frameRate: cameraTrajectory.frame_rate,
        dimensions: { width, height },
        duration: totalFrames,
        timeFormat: "frames",
      },
      scenes: [
        {
          world: { kmls: [] },
          animationModel: { roving: false, logarithmic: false, groupedPosition: true },
          duration: totalFrames,
          attributes: [
            {
              type: "cameraGroup",
              inTimeline: true,
              attributes: [
                {
                  type: "cameraPositionGroup",
                  inTimeline: true,
                  attributes: [
                    espLeaf("longitude", kfs(tracks.lng, (v) => (v - lonMin) / lonSpan, "positional", "lng"), { minValueRange: lonMin }),
                    espLeaf("latitude", kfs(tracks.lat, (v) => (v - latMin) / latSpan, "positional", "lat"), { minValueRange: latMin }),
                    espLeaf("altitude", kfs(tracks.alt, (v) => v * ESP_ALTITUDE_SCALE, "altitude", "alt"), { logarithmic: false }),
                  ],
                },
                {
                  type: "cameraTargetEffect",
                  attributes: [
                    { type: "enabled", value: {} },
                    {
                      type: "poi",
                      attributes: [
                        { type: "longitudePOI", value: {} },
                        { type: "latitudePOI", value: {} },
                        { type: "altitudePOI", value: { logarithmic: false } },
                      ],
                    },
                    { type: "influence", value: {} },
                  ],
                },
                {
                  type: "cameraRotationGroup",
                  inTimeline: true,
                  attributes: [
                    espLeaf("rotationX", kfs(tracks.pan, (v) => (v - panMin) / panSpan, "pan", "pan"),
                      tracks.pan.length ? { minValueRange: panMin, maxValueRange: panMin + panSpan } : {}),
                    espLeaf("rotationY", kfs(tracks.tilt, (v) => v / 180, "tilt", "tilt")),
                    { type: "rotationZ", value: {} },
                  ],
                },
                {
                  type: "cameraLensGroup",
                  attributes: [
                    { type: "fov", value: {} },
                    { type: "exposure", value: {} },
                    { type: "aperture", value: {} },
                    { type: "minFocusLength", value: {} },
                  ],
                },
              ],
            },
            {
              type: "environmentGroup",
              attributes: [
                {
                  type: "sunGroup",
                  attributes: [
                    { type: "sunVisibility", value: {} },
                    { type: "worldTime", value: { relative: 0.5 } },
                  ],
                },
                {
                  type: "cloudGroup",
                  attributes: [
                    { type: "cloudVisibility", value: {} },
                    { type: "cloudopacity", value: {} },
                    { type: "cloudheight", value: {} },
                    { type: "clouddate", value: {} },
                  ],
                },
                { type: "starsPlanetsGroup", attributes: [{ type: "starsEnabled", value: {} }] },
                {
                  type: "seawaterGroup",
                  attributes: [
                    { type: "seawater", value: {} },
                    { type: "influence", value: { relative: 1 } },
                  ],
                },
                { type: "buildingsEnabled", value: {} },
              ],
            },
          ],
          cameraExport: { logarithmic: false, modelVersion: 2 },
        },
      ],
      playbackManager: { range: { start: 0, end: totalFrames } },
    };
  }
    return { buildEspFromTrajectory };
  }
  const api = { createSerializer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.EarthStudioSerializer = api;
})(typeof window !== "undefined" ? window : globalThis);
