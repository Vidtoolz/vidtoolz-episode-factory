// earth-studio-opening-composition.js
//
// SUBJECT-AWARE OPENING COMPOSITION — Stage 1 individual-animator quality.
//
// The planner's derived opening camera is deterministic but SUBJECT-BLIND:
// a fresh (non-continuation) shot always opens with pan 0 — camera due south
// of the subject, facing north — regardless of where the subject is, where
// the shot is going, or what the operator asked for. That default is safe,
// but it is also exactly the "arbitrary automatic default" look: a journey
// that departs east still opens facing north, then corrects itself.
//
// This module decides WHEN the opening may deviate from that default and
// WHEN it must keep it. The bar is deliberately high — no phoney photogenic
// lookups, no invented façade knowledge:
//
//   CONTINUATION        exact hand-off wins; never re-frame (hard exception).
//   USER_SPECIFIED      explicit operator heading/tilt language wins.
//   ORBIT_STAGING       orbit-family openings are planner-owned (exit-aligned
//                       ring staging); composition defers instead of fighting.
//   COMPARISON_MATCHED  matched comparisons keep both cities on one neutral
//                       policy — no per-city glamour angles.
//   ROUTE_FORESHADOW    when the first real action is travel far enough to
//                       matter, open facing the departure direction so the
//                       first frame already flows into the first movement.
//   DEFAULT_RETAINED    anything weaker keeps the proven planner default.
//
// The output is a partial camera seed ({pan_deg} and/or {tilt_deg}) for the
// planner's EXISTING initialCamera mechanism (per-field fallback: every
// field not seeded keeps the planner-derived value) plus a full provenance
// record answering "why did the system start from THIS angle?".
//
// Deterministic: same inputs, same composition. No network, no LLM, no
// randomness. Browser-compatible (GUI loads it beside the director).
(function composeOpeningScope(globalScope) {
  'use strict';

  const OPENING_COMPOSITION_VERSION = 1;

  // Compass helpers ----------------------------------------------------------
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const wrap360 = (deg) => ((deg % 360) + 360) % 360;

  // Initial bearing A -> B on a local tangent plane. Longitude is handled as
  // the SHORTEST delta, so the antimeridian and unwrapped longitudes (a
  // continuation frame may sit outside ±180) cannot break it. Latitude
  // distortion is corrected with cos(lat) at the origin.
  function bearingDeg(a, b) {
    if (!a || !b) return null;
    const dLat = Number(b.latitude) - Number(a.latitude);
    let dLng = Number(b.longitude) - Number(a.longitude);
    dLng = ((dLng + 540) % 360) - 180; // shortest signed delta, antimeridian-safe
    const x = dLng * Math.cos(toRadians(Number(a.latitude)));
    const y = dLat;
    if (x === 0 && y === 0) return null;
    return wrap360((Math.atan2(x, y) * 180) / Math.PI);
  }

  // Signed shortest angular difference a -> b in (-180, 180].
  function angleDeltaDeg(a, b) {
    const d = wrap360(b - a);
    return d > 180 ? d - 360 : d;
  }

  // Ground distance on the same tangent plane (metres). Fine for the
  // regional scales this module reasons about; the planner's haversine
  // remains authoritative wherever it is already available.
  function distanceM(a, b) {
    if (!a || !b) return null;
    const dLat = (Number(b.latitude) - Number(a.latitude)) * 111320;
    let dLng = Number(b.longitude) - Number(a.longitude);
    dLng = ((dLng + 540) % 360) - 180;
    const dLngM = dLng * 111320 * Math.cos(toRadians(Number(a.latitude)));
    return Math.hypot(dLat, dLngM);
  }

  // Policy constants ---------------------------------------------------------
  // A route only earns an opening re-orientation when the destination lies
  // OUTSIDE the opening frame — otherwise the subject's context already shows
  // where the shot is going and the default composition still reads. The
  // frame width is the gazetteer's framing span; a floor keeps tiny local
  // hops (a few hundred metres between landmarks) from rotating the opening.
  const ROUTE_FORESHADOW_MIN_SPAN_MULTIPLIER = 1;
  const ROUTE_FORESHADOW_MIN_METERS = 1500;
  // Opening-to-first-motion continuity: flag when the opening heading and the
  // first travel vector diverge by more than this (subject ends up behind the
  // departure vector — the classic "pretty frame, immediate correction").
  const CONTINUITY_CORRECTION_WARN_DEG = 90;

  const ORBIT_FAMILY = new Set([
    'orbit', 'slow_orbit', 'orbit_twice', 'half_orbit', 'spiral_in', 'spiral_out',
  ]);

  function strategyRecord(partial) {
    return {
      strategy: partial.strategy,
      heading_source: partial.heading_source,
      subject_axis_deg: partial.subject_axis_deg !== undefined ? partial.subject_axis_deg : null,
      preferred_view_axis_deg: partial.preferred_view_axis_deg !== undefined ? partial.preferred_view_axis_deg : null,
      opening_heading_deg: partial.opening_heading_deg !== undefined ? partial.opening_heading_deg : null,
      opening_tilt_deg: partial.opening_tilt_deg !== undefined ? partial.opening_tilt_deg : null,
      confidence: partial.confidence,
      reason: partial.reason,
    };
  }

  // The composition decision for one opening.
  //
  // ctx.subject      { name, latitude, longitude, span_m, scale } of the
  //                  opening place (span_m from the gazetteer's framing span;
  //                  null when unknown).
  // ctx.opening_beat the director's opening decision movement key ('hold',
  //                  'zoom_in', 'orbit', ...) — null when unknown.
  // ctx.next_beat    the following decision's movement key (detects
  //                  staged hold → orbit) — null when none.
  // ctx.first_travel null or { to: {name, latitude, longitude}, distance_m }
  //                  describing the shot's first genuine travel leg.
  // ctx.continuation true when the journey starts from an exact prior
  //                  terminal state.
  // ctx.explicit     null or { heading_deg?, tilt_deg?, source_text } parsed
  //                  from operator language (authoritative).
  // ctx.compare      null or { matched: true } when the opening place is part
  //                  of a matched comparison group.
  function planOpening(ctx = {}) {
    const subject = ctx.subject || {};

    // HARD EXCEPTION 1 — exact continuation. Frame 0 belongs to the previous
    // animation; composition must not even suggest a re-frame.
    if (ctx.continuation) {
      return {
        opening_camera: null,
        composition: strategyRecord({
          strategy: 'CARRIED_OVER',
          heading_source: 'CARRIED_OVER',
          confidence: 'high',
          reason: 'Continuation: the opening is the previous animation\'s exact terminal camera state. Automatic composition never re-frames a hand-off.',
        }),
      };
    }

    // HARD EXCEPTION 2 — explicit operator direction wins over every
    // automatic policy below (recorded, never silent).
    const explicit = ctx.explicit || null;
    if (explicit && (Number.isFinite(explicit.heading_deg) || Number.isFinite(explicit.tilt_deg))) {
      const camera = {};
      if (Number.isFinite(explicit.heading_deg)) camera.pan_deg = wrap360(explicit.heading_deg);
      if (Number.isFinite(explicit.tilt_deg)) camera.tilt_deg = explicit.tilt_deg;
      const parts = [];
      if (Number.isFinite(explicit.heading_deg)) parts.push(`heading ${Math.round(wrap360(explicit.heading_deg))}°`);
      if (Number.isFinite(explicit.tilt_deg)) parts.push(`tilt ${explicit.tilt_deg}°`);
      return {
        opening_camera: camera,
        composition: strategyRecord({
          strategy: 'USER_SPECIFIED',
          heading_source: 'USER_SPECIFIED',
          opening_heading_deg: Number.isFinite(explicit.heading_deg) ? wrap360(explicit.heading_deg) : null,
          opening_tilt_deg: Number.isFinite(explicit.tilt_deg) ? explicit.tilt_deg : null,
          confidence: 'high',
          reason: `Operator specified the opening (${parts.join(', ')}${explicit.source_text ? ` — "${explicit.source_text}"` : ''}). Explicit direction outranks automatic composition.`,
        }),
      };
    }

    // HARD EXCEPTION 3 — orbit-family openings are planner-owned. The planner
    // stages the opening on the orbit ring and (for coherent journeys) solves
    // the ring phase from the exit destination. A composition seed here
    // would fight that geometry, so composition defers and says so.
    const openingBeat = ctx.opening_beat || null;
    const nextBeat = ctx.next_beat || null;
    if ((openingBeat && ORBIT_FAMILY.has(openingBeat)) || (nextBeat && ORBIT_FAMILY.has(nextBeat))) {
      return {
        opening_camera: null,
        composition: strategyRecord({
          strategy: 'ORBIT_STAGING_PLANNER',
          heading_source: 'DEFAULTED',
          confidence: 'medium',
          reason: 'The opening belongs to an orbit (or stages one): the planner owns ring placement and exit-aligned phase. Composition defers rather than fight the orbit geometry.',
        }),
      };
    }

    // HARD EXCEPTION 4 — matched comparison. Both cities must read as one
    // repeated shot, so the opening keeps the neutral shared policy instead
    // of an individually optimized angle that would break comparability.
    if (ctx.compare && ctx.compare.matched) {
      return {
        opening_camera: null,
        composition: strategyRecord({
          strategy: 'COMPARISON_MATCHED',
          heading_source: 'SUBJECT_TYPE_HEURISTIC',
          confidence: 'medium',
          reason: 'Matched comparison: the opening must stay comparable to the other city\'s framing, so the neutral default composition wins over any route foreshadowing.',
        }),
      };
    }

    // LEVEL A — route-aware foreshadowing. When the shot's first real action
    // is travel far enough to matter, open facing the departure direction:
    // the first frame already points where the camera is going, and the first
    // movement needs no corrective rotation. The subject axis of a route is
    // the one geometric axis this system honestly has (gazetteer entries are
    // points + framing spans, not footprints).
    const travel = ctx.first_travel || null;
    const spanM = Number(subject.span_m) || 0;
    const minRouteM = Math.max(ROUTE_FORESHADOW_MIN_SPAN_MULTIPLIER * spanM, ROUTE_FORESHADOW_MIN_METERS);
    if (travel && travel.to && Number.isFinite(travel.distance_m) && travel.distance_m > minRouteM) {
      const outbound = bearingDeg(subject, travel.to);
      if (outbound !== null) {
        return {
          opening_camera: { pan_deg: outbound },
          composition: strategyRecord({
            strategy: 'ROUTE_FORESHADOW',
            heading_source: 'GEOMETRY_DERIVED',
            subject_axis_deg: outbound,
            preferred_view_axis_deg: outbound,
            opening_heading_deg: outbound,
            confidence: 'high',
            reason: `First action is travel to ${travel.to.name || 'the next destination'} (${Math.round(travel.distance_m / 1000)} km > ${Math.round(minRouteM / 1000)} km threshold). Opening faces the departure direction so frame one flows directly into the first movement instead of correcting toward it.`,
          }),
        };
      }
    }

    // LEVEL C — safe default. No reliable subject-aware evidence (no façade
    // geometry, no coastline data, no DEM): the proven planner default wins.
    // Reporting the retention honestly is the point — fake intelligence here
    // would be worse than the default.
    const subjectLabel = subject.name ? `${subject.name} (${subject.scale || 'unknown scale'})` : 'The subject';
    return {
      opening_camera: null,
      composition: strategyRecord({
        strategy: 'DEFAULT_RETAINED',
        heading_source: 'DEFAULTED',
        confidence: 'low',
        reason: `${subjectLabel}: no route, explicit direction, or geometry evidence strong enough to beat the proven default opening. Retaining the planner default rather than inventing a composition.`,
      }),
    };
  }

  // Opening-to-first-motion continuity audit. Pure diagnostics (absence of
  // obvious structural defects — never beauty): given the opening heading
  // actually used and the first travel vector, report corrections a human
  // would notice in the first second.
  function auditOpeningContinuity({ opening_heading_deg = null, first_travel_bearing_deg = null, opening_was_seeded = false } = {}) {
    const warnings = [];
    if (Number.isFinite(opening_heading_deg) && Number.isFinite(first_travel_bearing_deg)) {
      const delta = Math.abs(angleDeltaDeg(opening_heading_deg, first_travel_bearing_deg));
      if (delta > CONTINUITY_CORRECTION_WARN_DEG) {
        warnings.push(`OPENING_CONTINUITY — opening heading ${Math.round(opening_heading_deg)}° diverges ${Math.round(delta)}° from the first travel direction ${Math.round(first_travel_bearing_deg)}° (> ${CONTINUITY_CORRECTION_WARN_DEG}°): the subject sits behind the departure vector, so playback begins with a visible corrective swing.`);
      }
    }
    return { ok: warnings.length === 0, warnings };
  }

  const api = {
    OPENING_COMPOSITION_VERSION,
    planOpening,
    auditOpeningContinuity,
    bearingDeg,
    angleDeltaDeg,
    distanceM,
    wrap360,
    ORBIT_FAMILY,
    ROUTE_FORESHADOW_MIN_SPAN_MULTIPLIER,
    ROUTE_FORESHADOW_MIN_METERS,
    CONTINUITY_CORRECTION_WARN_DEG,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    globalScope.EarthStudioOpeningComposition = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
