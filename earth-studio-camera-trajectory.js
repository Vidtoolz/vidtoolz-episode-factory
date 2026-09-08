// M1 CameraTrajectory seam — canonical authority (frozen contract 2026-09-08).
// SHA256: 19f98b6a39b0cb079c46e79fa4293a88c04b64a59d124f033d42be9fb3887171
//
// Owns trajectory compilation between the camera state machine (planner) and
// the Earth Studio .esp serializer. In-memory only (D-3 accepted): no file,
// no sidecar, no job.json field.
//
// Node: require('./earth-studio-camera-trajectory')
// Browser: window.EarthStudioCameraTrajectory (IIFE sets global)

(function earthStudioCameraTrajectoryBootstrap(globalScope) {
  "use strict";

  const TRAJECTORY_SCHEMA = "vidtoolz.camera.trajectory.v1";

  // §4.1 motionPolicy ownership: moved from planner:2268 verbatim. Evaluated
  // exactly once per compile, from the same inputs, with the same defaults.
  // The serializer consumes only the resolved policy object as explicit
  // options.motionPolicy.
  function motionPolicy(plan, options) {
    const opts = options || {};
    const p = (plan && plan.motion_policy) || null;
    return {
      coherentTrajectory: !!(p && p.coherent_trajectory) && !opts.compareLegacyMotion,
      dedupeKeyframes: !!(p && p.dedupe_keyframes) && !opts.compareLegacyMotion,
    };
  }

  // §2.1 step 2: longitude export runs BEFORE deduplication. Preserves the
  // production asymmetry exactly: rateIn/rateOut and aimAt are dropped from
  // the lng track while preserved on all other tracks. Moved verbatim from
  // planner:2058.
  // For M1 the planner keeps its own copy (it uses closure helpers espKeyframe
  // and round6). This is the canonical reference — structurally identical,
  // parameterized for the extracted module.
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

  // Moved verbatim from planner:2280. Flat-redundancy removal, aimAt /
  // semanticBoundary retention, 64-pass fixpoint, same() tolerance expression
  // textually identical to the planner's version.
  function dropRedundantKeyframes(track) {
    if (!Array.isArray(track) || track.length < 3) return track;
    const same = function (a, b) {
      return Math.abs(a - b) <= Math.max(1e-9, 1e-12 * Math.max(Math.abs(a), Math.abs(b)));
    };
    let out = track;
    for (let pass = 0; pass < 64; pass += 1) {
      const next = out.filter(function (kf, i) {
        if (i === 0 || i === out.length - 1) return true;
        return kf.semanticBoundary || kf.aimAt
          || !(same(kf.value, out[i - 1].value) && same(out[i + 1].value, kf.value));
      });
      if (next.length === out.length) return next;
      out = next;
    }
    return out;
  }

  // §3.2 (D-1): segment-arrival easing markers, computed from the same
  // finalSeg filter and membership rule the serializer used inline today.
  // Predicate preserved exactly.
  function computeTrajectoryMarkers(plan, totalFrames) {
    const tf = totalFrames || Math.max(1, (plan && plan.total_frames) || 1);
    const frac = function (frame) { return Math.min(1, Math.max(0, frame / tf)); };
    const segments = (plan && plan.segments) || [];
    const finalSeg = [...segments].reverse().find(function (sg) {
      return sg.location && sg.duration_seconds > 0;
    });
    const markers = [];
    segments
      .filter(function (sg) {
        return ["fly_to", "zoom_in", "zoom_out"].indexOf(sg.action) >= 0
          && !sg.ends_at_orbit_entry
          && (!finalSeg || sg.segment_id !== finalSeg.segment_id);
      })
      .forEach(function (sg) {
        markers.push({
          kind: "segment-arrival",
          segment_id: sg.segment_id,
          frame: sg.end_frame,
          frac: frac(sg.end_frame),
        });
      });
    return markers;
  }

  // §4.3 legacy compatibility adapter: converts a CameraTrajectory back to
  // the complete legacy {lng,lat,alt,pan,tilt} keyframe shape for consumers
  // that predate the seam.
  function legacyTracksFromTrajectory(trajectory) {
    if (!trajectory || !trajectory.keyed) return null;
    return {
      lng: trajectory.keyed.lng,
      lat: trajectory.keyed.lat,
      alt: trajectory.keyed.alt,
      pan: trajectory.keyed.pan,
      tilt: trajectory.keyed.tilt,
    };
  }

  // §3.3 compileTrajectory: constructs a CameraTrajectory v1 from pre-compiled
  // tracks and plan metadata. Called by the planner's buildEsp after
  // buildEspKeyframes produces the physical tracks.
  function compileTrajectory(plan, options, tracks) {
    const opts = options || {};
    const totalFrames = Math.max(1, (plan && plan.total_frames) || 1);
    const policy = motionPolicy(plan, opts);
    return {
      schema: TRAJECTORY_SCHEMA,
      frame_rate: plan && plan.frame_rate,
      total_frames: plan && plan.total_frames,
      keyed: {
        lng: tracks.lng, lat: tracks.lat, alt: tracks.alt, pan: tracks.pan, tilt: tracks.tilt,
      },
      terminal_camera: tracks.terminalState || null,
      markers: computeTrajectoryMarkers(plan, totalFrames),
      motion_policy: policy,
    };
  }

  var api = {
    TRAJECTORY_SCHEMA: TRAJECTORY_SCHEMA,
    motionPolicy: motionPolicy,
    exportLongitudeTrack: exportLongitudeTrack,
    dropRedundantKeyframes: dropRedundantKeyframes,
    computeTrajectoryMarkers: computeTrajectoryMarkers,
    compileTrajectory: compileTrajectory,
    legacyTracksFromTrajectory: legacyTracksFromTrajectory,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.EarthStudioCameraTrajectory = api;
})(typeof window !== "undefined" ? window : globalThis);