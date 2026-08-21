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

  const OPENING_COMPOSITION_VERSION = 2;

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

  // ── Subject-aware opening OBLIQUITY (Stage 1, mission 3) ──────────────────
  // The engine law (proven on real ESP output, 2026-08-20):
  //   * A CENTERED opening (hold/zoom — the camera directly above its target)
  //     can frame the subject only within ~6 degrees of nadir. The journey
  //     model caps DERIVED tilt at that optical limit and warns that an
  //     intentional tilt on a centered camera points the camera OFF the
  //     subject. That cap is why subject openings render as "Google Maps
  //     rotated to a different direction" instead of a composed shot.
  //   * RING geometry (orbit family, or a hold staged onto an orbit ring)
  //     places the camera alt·tan(tilt) away and facing the subject, so the
  //     subject stays framed at ANY tilt, and the tilt is stable from frame 0
  //     (no corrective bump).
  // Oblique opening presence therefore means: the opening movement must ride
  // a ring. This module decides WHEN a flat centered opening is promoted to a
  // half-orbit ring opening and at WHAT tilt — following the mission's policy
  // order: editorial purpose → subject class/scale → geometry/evidence →
  // movement context → camera configuration. NEVER "subject label → fixed
  // angle": the tilt band comes from purpose and evidence, and choosing to
  // stay top-down is part of the intelligence (route, orientation, scale and
  // comparison stories WANT the map view).
  //
  // Camera-configuration values are injected by the caller (director passes
  // the planner's own constants); the fallbacks mirror them so the module
  // stays usable standalone/in the browser.
  const OBLIQUITY_DEFAULT_CONFIG = {
    orbit_default_tilt_deg: 60,   // planner DEFAULT_TILT_DEG.orbit
    terrain_oblique_tilt_deg: 72, // director TERRAIN_OBLIQUE_TILT_DEG
    establish_presence_tilt_deg: 50, // softer "camera positioned to introduce"
    max_ring_m: 80000,            // planner orbitRadiusMeters cap
  };
  // Purposes whose reason for existing is an oblique view of the subject.
  const OBLIQUE_PURPOSES = new Set(['INSPECT', 'EMPHASIZE', 'REVEAL', 'SHOW_TERRAIN']);
  // Purposes that want the map view — never promoted, recorded honestly.
  const TOPDOWN_PURPOSES = new Set([
    'ORIENT', 'LOCATE', 'COMPARE', 'SHOW_SCALE', 'SHOW_ROUTE', 'RELATE',
    'TRAVEL', 'TRANSITION', 'CONTINUE', 'CONCLUDE',
  ]);
  // Subject scales whose physical form can carry an oblique shot.
  const OBLIQUE_SCALES = new Set(['landmark', 'neighborhood', 'district']);
  // Roles that mark the opening place as the story's subject rather than its
  // backdrop.
  const SUBJECT_ROLES = new Set(['PRIMARY_SUBJECT', 'DESTINATION', 'FINAL_REVEAL']);
  const HIGH_IMPORTANCE = new Set(['HIGH', 'HERO']);
  // Tilt must stay inside the planner's clamp and below the horizon.
  const MIN_OBLIQUE_TILT_DEG = 20;
  const MAX_OBLIQUE_TILT_DEG = 78;
  // The engine law (proven on real ESP output): a CENTERED camera keeps its
  // subject framed only within about this tilt from nadir at FOV 20°. Beyond
  // it a centered hold points off-subject; a stationary oblique hold is
  // therefore not something the engine supports cleanly.
  const CENTERED_TILT_CAP_DEG = 6;

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

  // ── Opening obliquity decision ────────────────────────────────────────────
  // Decides whether a FLAT CENTERED opening hold should be promoted to a
  // half-orbit RING opening so the subject reads with visual presence instead
  // of as a rotated map. Follows the mission's policy order exactly:
  // editorial purpose -> subject class/scale -> geometry/evidence -> movement
  // context -> camera configuration. Returns:
  //   { action: 'PROMOTE_TO_RING', movement: 'half_orbit', tilt_deg,
  //     tilt_band, reason }
  // or { action: 'KEEP_FLAT', reason } with an honest explanation either way.
  //
  // ctx (all optional unless noted):
  //   opening_beat      the director's opening movement key (REQUIRED for
  //                     promotion; only a centered 'hold' is promotable).
  //   next_beat         following movement key (orbit staging defers).
  //   purposes          opening stop purposes array (REQUIRED for policy).
  //   role              opening stop narrative role.
  //   importance        LOW/NORMAL/HIGH/HERO.
  //   scale             framing scale of the subject (REQUIRED for policy).
  //   span_m            gazetteer framing span of the subject.
  //   single_stop       true when the story has exactly one stop (the only
  //                     place IS the subject, whatever role label it got).
  //   departs           true when the story travels onward from the opening
  //                     stop — departure-first openings stay flat.
  //   first_travel      null or { distance_m } — travel-first stories keep a
  //                     flat opening that flows into the departure.
  //   scale_story_ahead true when a later stop carries SHOW_SCALE: the
  //                     opening is the anchor rung of a nested widening and
  //                     must stay a plan view.
  //   flourish_budget   SELECTIVE restraint budget available at the opening.
  //   negatives         operator negative constraints ('orbit' blocks rings).
  //   explicit_movement the movement primitive the OPERATOR named for this
  //                     opening ('hold' for "hover over X", 'slow_orbit' for
  //                     "orbit X", ...). Operator movement authority: when
  //                     set, automatic obliquity must never substitute a
  //                     different movement primitive.
  //   explicit_opening  null or { heading_deg?, tilt_deg?, oblique?,
  //                     oblique_band? } — explicit operator opening language.
  //                     A finite tilt/heading outranks the automatic bands;
  //                     an oblique request can only steer a promotion the
  //                     policy already allows, never force one.
  //   config            camera-configuration constants (injected).
  //
  // Every returned decision carries `source` ('USER_SPECIFIED',
  // 'CARRIED_OVER', 'POLICY' for automatic keeps, 'AUTOMATIC' for automatic
  // promotion) so provenance can answer WHO decided, not just what.
  function planOpeningObliquity(ctx = {}) {
    const cfg = { ...OBLIQUITY_DEFAULT_CONFIG, ...(ctx.config || {}) };
    const purposes = Array.isArray(ctx.purposes) ? ctx.purposes : [];
    const primary = purposes[0] || 'ESTABLISH';
    const keep = (reason, source) => ({ action: 'KEEP_FLAT', tilt_deg: null, tilt_band: null, movement: null, source: source || 'POLICY', reason });

    // HARD guards: an exact continuation hand-off, an operator-specified
    // movement primitive, and any explicit operator opening direction all
    // outrank automatic obliquity — in that order.
    if (ctx.continuation) {
      return keep('Continuation: frame 0 belongs to the previous animation\'s exact terminal state; automatic obliquity never re-frames a hand-off.', 'CARRIED_OVER');
    }
    const explicitOpening = ctx.explicit_opening || null;
    const explicitTilt = explicitOpening && Number.isFinite(explicitOpening.tilt_deg) ? explicitOpening.tilt_deg : null;
    const obliqueBand = explicitOpening && (explicitOpening.oblique_band === 'high' || explicitOpening.oblique_band === 'low')
      ? explicitOpening.oblique_band : null;
    const wantsOblique = !!(explicitOpening && (explicitOpening.oblique || obliqueBand)) || (explicitTilt !== null && explicitTilt > CENTERED_TILT_CAP_DEG);
    // An explicit tilt (numeric or high/low-oblique wording) RIDING an
    // orbit-family opening is compatible, not a conflict: the ring frames the
    // subject at any angle, so the operator's tilt decorates the operator's
    // (or planner's) own ring movement instead of replacing anything.
    if (ORBIT_FAMILY.has(ctx.opening_beat) && (explicitTilt !== null || obliqueBand)) {
      const requested = explicitTilt !== null ? explicitTilt
        : (obliqueBand === 'high' ? cfg.terrain_oblique_tilt_deg : cfg.establish_presence_tilt_deg);
      const applied = Math.min(MAX_OBLIQUE_TILT_DEG, Math.max(0, Math.round(requested)));
      return {
        action: 'APPLY_TILT',
        movement: null,
        tilt_deg: applied,
        tilt_band: 'user_specified',
        source: 'USER_SPECIFIED',
        reason: applied === Math.round(requested)
          ? `The operator asked for ${obliqueBand ? `a ${obliqueBand}-oblique view` : `tilt ${applied}°`} on a ${ctx.opening_beat} — the ring frames the subject at any angle, so the requested tilt is applied to the operator's own movement.`
          : `The operator asked for tilt ${requested}° on a ${ctx.opening_beat}; the ring applies it clamped to ${applied}° so the view stays below the horizon.`,
      };
    }
    // OPERATOR MOVEMENT AUTHORITY — the settled doctrine: automatic directing
    // may fill unspecified camera behavior, but it must never replace an
    // explicitly specified movement primitive with a different one. "Hover
    // over X" stays a hover even where a ring opening would read grander.
    if (ctx.explicit_movement) {
      if (wantsOblique && ctx.opening_beat === 'hold') {
        return keep(`The operator explicitly asked for a stationary "${ctx.explicit_movement}" AND an oblique view. The engine cannot hold a stationary oblique framing on a centered camera (the ~${CENTERED_TILT_CAP_DEG}° optical cap), and a ring opening would replace the requested movement — so the explicit movement wins and the opening stays flat. The oblique request is declined honestly, not reinterpreted as an orbit.`, 'USER_SPECIFIED');
      }
      return keep(`The operator explicitly specified the opening movement ("${ctx.explicit_movement}"). Automatic directing may fill unspecified camera behavior, but it never replaces an explicitly specified movement primitive.`, 'USER_SPECIFIED');
    }
    if (explicitOpening && (Number.isFinite(explicitOpening.tilt_deg) || Number.isFinite(explicitOpening.heading_deg))) {
      return keep('The operator specified the opening direction explicitly; explicit direction outranks automatic obliquity.', 'USER_SPECIFIED');
    }
    // Movement context: only a centered hold is the "rotated map" defect, and
    // only when no ring already follows (a staged orbit owns its geometry).
    if (ctx.opening_beat !== 'hold') {
      return keep(`The opening movement is "${ctx.opening_beat || 'unknown'}", not a centered hold — obliquity promotion only replaces flat holds.`);
    }
    if (ctx.next_beat && ORBIT_FAMILY.has(ctx.next_beat)) {
      return keep('The next beat is already an orbit — the planner stages the opening on its ring; composition defers.');
    }
    // Editorial purpose: map-view stories want the plan view. Choosing NOT to
    // tilt is part of the intelligence.
    if (TOPDOWN_PURPOSES.has(primary)) {
      return keep(`The opening purpose ${primary} wants a map view — a plan reading is what the shot is for.`);
    }
    // Nested scale story: the opening is the smallest rung; the widening only
    // reads if the rungs start as comparable plan views.
    if (ctx.scale_story_ahead) {
      return keep('A nested scale story widens from this subject — the anchor rung stays a plan view so the size rungs compare honestly.');
    }
    // Movement context: a departure-first story keeps a flat opening so frame
    // one flows into the first travel vector (route foreshadowing owns that).
    if (ctx.departs === true || (ctx.first_travel && Number.isFinite(ctx.first_travel.distance_m))) {
      return keep('The shot departs from this subject — a flat opening faces the departure and flows into the first movement instead of circling.');
    }
    // Operator negatives are hard constraints.
    const negatives = Array.isArray(ctx.negatives) ? ctx.negatives : [];
    if (negatives.some((n) => /orbit|ring|spiral/i.test(String(n)))) {
      return keep('The operator ruled out orbit-family moves; the opening keeps the flat default.', 'USER_SPECIFIED');
    }
    // Subject class/scale: only compact subjects whose physical form can carry
    // an oblique shot are candidates (landmarks, monuments, terrain, districts
    // with form). City/country/continent openings keep the map view.
    if (!OBLIQUE_SCALES.has(ctx.scale)) {
      return keep(`The subject is ${ctx.scale || 'unknown'}-scale geography — its meaning is 2D layout, which a plan view reads better than a tilted one.`);
    }
    // The opening place must actually BE the story's subject: an explicit
    // subject role, real importance, or the only stop in the story.
    const subjectByStory = SUBJECT_ROLES.has(ctx.role)
      || HIGH_IMPORTANCE.has(ctx.importance)
      || ctx.single_stop === true;
    if (!subjectByStory) {
      return keep('The opening place is context, not the subject — it gets bearings, not a performed angle.');
    }
    // Restraint: a ring opening is a SELECTIVE move and must be earned.
    const budget = Number.isFinite(ctx.flourish_budget) ? ctx.flourish_budget : 0;
    if (budget < 1) {
      return keep('A ring opening costs a selective flourish this opening has not earned; the flat default stays.');
    }
    // Tilt band from PURPOSE + evidence — never one fixed angle per label.
    // An explicit operator band request ("high oblique" / "low oblique")
    // steers a promotion the policy already allows; a bare "oblique" request
    // keeps the purpose-derived band.
    let tilt = null;
    let band = null;
    let source = 'AUTOMATIC';
    if (obliqueBand) {
      tilt = obliqueBand === 'high' ? cfg.terrain_oblique_tilt_deg : cfg.establish_presence_tilt_deg;
      band = obliqueBand === 'high' ? 'terrain_raking' : 'establish_presence';
      source = 'USER_SPECIFIED';
    } else if (purposes.includes('SHOW_TERRAIN')) {
      tilt = cfg.terrain_oblique_tilt_deg; band = 'terrain_raking';
    } else if (purposes.some((p) => OBLIQUE_PURPOSES.has(p))) {
      tilt = cfg.orbit_default_tilt_deg; band = 'inspection';
    } else {
      // ESTABLISH / ARRIVE on a true subject: the "camera intentionally
      // positioned to introduce the subject" band — present, not performing.
      tilt = cfg.establish_presence_tilt_deg; band = 'establish_presence';
    }
    tilt = Math.min(MAX_OBLIQUE_TILT_DEG, Math.max(MIN_OBLIQUE_TILT_DEG, Math.round(tilt)));
    // Camera configuration / geometry evidence: the ring the tilt implies must
    // fit inside the generator's ring cap, or the camera would lose the
    // subject. Altitude estimate from the same optical law journey uses.
    const spanM = Number(ctx.span_m) || 0;
    if (spanM > 0) {
      const fovRad = (20 / 2) * (Math.PI / 180);
      const altitudeEstimate = (spanM * Math.cos(toRadians(tilt))) / (2 * Math.tan(fovRad));
      const ringRadius = altitudeEstimate * Math.tan(toRadians(tilt));
      if (ringRadius > cfg.max_ring_m) {
        return keep(`At ${tilt}° the implied ring (${Math.round(ringRadius / 1000)} km) exceeds the generator's ${Math.round(cfg.max_ring_m / 1000)} km cap — the subject would leave the frame.`);
      }
    }
    return {
      action: 'PROMOTE_TO_RING',
      movement: 'half_orbit',
      tilt_deg: tilt,
      tilt_band: band,
      source,
      reason: `A centered hold frames ${ctx.scale} subjects only near-nadir (the generator's optical limit), which reads as a rotated map. `
        + `${source === 'USER_SPECIFIED' ? `The operator asked for a ${obliqueBand}-oblique view` : `The purpose ${primary} wants the subject seen with form`}, so the opening rides a half-orbit ring at ${tilt}° (${band}) — `
        + 'the only engine geometry that keeps the subject framed at an oblique angle, stable from frame 0.',
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
    planOpeningObliquity,
    auditOpeningContinuity,
    bearingDeg,
    angleDeltaDeg,
    distanceM,
    wrap360,
    ORBIT_FAMILY,
    OBLIQUE_PURPOSES,
    TOPDOWN_PURPOSES,
    OBLIQUE_SCALES,
    OBLIQUITY_DEFAULT_CONFIG,
    MIN_OBLIQUE_TILT_DEG,
    MAX_OBLIQUE_TILT_DEG,
    CENTERED_TILT_CAP_DEG,
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
