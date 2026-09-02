(function earthStudioHeightFraming(globalScope) {
  'use strict';

  // Earth Studio rotationY is degrees from nadir: 0deg is top-down and larger
  // values approach the horizon. These references deliberately span the
  // camera's useful logarithmic scale rather than forming altitude bands.
  const EARTH_STUDIO_TOP_DOWN_TILT_DEG = 0;
  const EARTH_STUDIO_HORIZON_SAFE_TILT_DEG = 72;
  const LOWEST_PRACTICAL_ALTITUDE_M = 500;
  const HIGHEST_PRACTICAL_ALTITUDE_M = 12000000;
  // Mikko's 2026-08-25 height-aware review established HIGHER_A as the
  // lowest tested usable travel regime. HIGHER_A's generator target was
  // exactly 0.8 mean frame-widths of ground per second. B/C are usable
  // headroom, not defaults, so production solves for this boundary directly.
  const CALIBRATED_TRAVEL_APPARENT_SPEED_FW_PER_S = 0.8;
  const EARTH_STUDIO_DEFAULT_FOV_DEG = 20;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Quintic smootherstep is monotone on [0, 1], with zero first and second
  // derivatives at both ends. That makes the practical-altitude clamps C2.
  function smootherstep(value) {
    const x = clamp(Number(value) || 0, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  function smootherstepDerivative(value) {
    const x = clamp(Number(value) || 0, 0, 1);
    return 30 * x * x * (x - 1) * (x - 1);
  }

  function normalizedLogHeight(altitudeM, options = {}) {
    const lowAltitudeM = Math.max(1, Number(options.lowAltitudeM) || LOWEST_PRACTICAL_ALTITUDE_M);
    const highAltitudeM = Math.max(lowAltitudeM + 1,
      Number(options.highAltitudeM) || HIGHEST_PRACTICAL_ALTITUDE_M);
    const altitude = clamp(Number(altitudeM) || lowAltitudeM, lowAltitudeM, highAltitudeM);
    return clamp(Math.log(altitude / lowAltitudeM) / Math.log(highAltitudeM / lowAltitudeM), 0, 1);
  }

  // Authoritative universal height -> Earth Studio tilt law. A whole-shot
  // operator lock is the only direct bypass; local/morphology anchors belong
  // on phase endpoints and are handled by coupledHeightTiltEnvelope below.
  function tiltForAltitude(altitudeM, options = {}) {
    if (Number.isFinite(options.wholeShotTiltDeg)) {
      return clamp(Number(options.wholeShotTiltDeg), 0, 85);
    }
    const lowTiltDeg = clamp(Number.isFinite(options.lowTiltDeg)
      ? Number(options.lowTiltDeg) : EARTH_STUDIO_HORIZON_SAFE_TILT_DEG, 0, 85);
    const highTiltDeg = clamp(Number.isFinite(options.highTiltDeg)
      ? Number(options.highTiltDeg) : EARTH_STUDIO_TOP_DOWN_TILT_DEG, 0, lowTiltDeg);
    const progress = smootherstep(normalizedLogHeight(altitudeM, options));
    return lowTiltDeg + (highTiltDeg - lowTiltDeg) * progress;
  }

  // Ground-footprint proxy used by the reviewed altitude ladder. Earth Studio
  // tilt is measured from nadir, so slant range is h/cos(tilt). The formula is
  // intentionally the same calibrated proxy used for human review; it is not
  // presented as a full optical-flow model.
  function frameWidthMetersForAltitude(altitudeM, options = {}) {
    const altitude = Math.max(1, Number(altitudeM) || 1);
    const tiltDeg = Number.isFinite(options.tiltDeg)
      ? Number(options.tiltDeg) : tiltForAltitude(altitude, options.heightLaw);
    const fovDeg = Number.isFinite(options.fovDeg)
      ? Number(options.fovDeg) : EARTH_STUDIO_DEFAULT_FOV_DEG;
    const radians = Math.PI / 180;
    const cosine = Math.max(1e-9, Math.cos(tiltDeg * radians));
    return 2 * (altitude / cosine) * Math.tan((fovDeg * radians) / 2);
  }

  function apparentTravelSpeedFrameWidths(distanceM, durationS, altitudeM, options = {}) {
    const distance = Number(distanceM);
    const duration = Number(durationS);
    if (!(distance > 0) || !(duration > 0)) return 0;
    const frameWidth = frameWidthMetersForAltitude(altitudeM, options);
    return frameWidth > 0 ? (distance / duration) / frameWidth : Infinity;
  }

  // Solve the circular production condition
  //   h -> tiltForAltitude(h) -> footprint(h, tilt) -> apparent speed
  // and return the LOWEST height satisfying the calibrated target. The proxy
  // is monotone over the practical domain, so a fixed-count binary search is
  // deterministic and cannot oscillate. There is no separate safety multiplier:
  // the human-confirmed 0.8 target is the complete calibrated margin.
  function solveMinimumSufficientTravelAltitude(distanceM, durationS, options = {}) {
    const distance = Number(distanceM);
    const duration = Number(durationS);
    const minimumAltitudeM = Math.max(1, Number(options.minimumAltitudeM)
      || LOWEST_PRACTICAL_ALTITUDE_M);
    const maximumAltitudeM = Math.max(minimumAltitudeM, Number(options.maximumAltitudeM)
      || HIGHEST_PRACTICAL_ALTITUDE_M);
    const targetFwS = Number.isFinite(options.targetFwS)
      ? Number(options.targetFwS) : CALIBRATED_TRAVEL_APPARENT_SPEED_FW_PER_S;
    if (!(distance > 0) || !(duration > 0) || !(targetFwS > 0)) {
      return {
        altitude_m: Math.ceil(minimumAltitudeM),
        tilt_deg: tiltForAltitude(minimumAltitudeM, options.heightLaw),
        predicted_apparent_speed_fw_s: 0,
        target_apparent_speed_fw_s: targetFwS,
        satisfied: true,
        clamped: false,
        iterations: 0,
      };
    }
    const speedAt = (height) => apparentTravelSpeedFrameWidths(distance, duration, height, {
      fovDeg: options.fovDeg,
      heightLaw: options.heightLaw,
    });
    const minimumSpeed = speedAt(minimumAltitudeM);
    if (minimumSpeed <= targetFwS) {
      return {
        altitude_m: Math.ceil(minimumAltitudeM),
        tilt_deg: tiltForAltitude(minimumAltitudeM, options.heightLaw),
        predicted_apparent_speed_fw_s: minimumSpeed,
        target_apparent_speed_fw_s: targetFwS,
        satisfied: true,
        clamped: false,
        iterations: 0,
      };
    }
    const maximumSpeed = speedAt(maximumAltitudeM);
    if (maximumSpeed > targetFwS) {
      return {
        altitude_m: Math.floor(maximumAltitudeM),
        tilt_deg: tiltForAltitude(maximumAltitudeM, options.heightLaw),
        predicted_apparent_speed_fw_s: maximumSpeed,
        target_apparent_speed_fw_s: targetFwS,
        satisfied: false,
        clamped: true,
        iterations: 0,
      };
    }
    let low = minimumAltitudeM;
    let high = maximumAltitudeM;
    let iterations = 0;
    for (; iterations < 64 && high - low > 0.01; iterations += 1) {
      const middle = (low + high) / 2;
      if (speedAt(middle) <= targetFwS) high = middle;
      else low = middle;
    }
    // Integer metres are the serialized production unit. Round upward so the
    // returned metre remains on the satisfying side of the threshold.
    const altitudeM = Math.ceil(high);
    return {
      altitude_m: altitudeM,
      tilt_deg: tiltForAltitude(altitudeM, options.heightLaw),
      predicted_apparent_speed_fw_s: speedAt(altitudeM),
      target_apparent_speed_fw_s: targetFwS,
      satisfied: true,
      clamped: false,
      iterations,
    };
  }

  function phaseTiltForAltitude(altitudeM, fromAltitudeM, toAltitudeM, fromTiltDeg, toTiltDeg) {
    if (Math.abs(toAltitudeM - fromAltitudeM) < 1e-9) return Number(toTiltDeg);
    const low = Math.min(fromAltitudeM, toAltitudeM);
    const high = Math.max(fromAltitudeM, toAltitudeM);
    const heightProgress = normalizedLogHeight(altitudeM, { lowAltitudeM: low, highAltitudeM: high });
    const forward = toAltitudeM >= fromAltitudeM ? heightProgress : 1 - heightProgress;
    // Phase timing is already eased once by samplePhase. Applying another
    // smootherstep here compresses most of a large tilt change into a short
    // mid-climb burst. Linear interpolation in log-height space preserves the
    // scale-aware height relationship while keeping altitude and tilt on the
    // same single cinematic progress variable.
    return fromTiltDeg + (toTiltDeg - fromTiltDeg) * forward;
  }

  function samplePhase(fromFrame, toFrame, fromAltitudeM, toAltitudeM, fromTiltDeg, toTiltDeg, count) {
    const span = Math.max(1, toFrame - fromFrame);
    const samples = [];
    const changing = Math.abs(toAltitudeM - fromAltitudeM) >= 1e-9;
    const fromLogAltitude = changing ? Math.log(Math.max(1, fromAltitudeM)) : 0;
    const toLogAltitude = changing ? Math.log(Math.max(1, toAltitudeM)) : 0;
    const logAltitudeDelta = toLogAltitude - fromLogAltitude;
    for (let i = 0; i <= count; i += 1) {
      const u = i / count;
      const motion = smootherstep(u);
      // Camera scale is logarithmic. Interpolating log altitude makes the
      // climb occupy the whole phase perceptually instead of covering nearly
      // the entire scale change in its opening frames.
      const altitudeM = changing
        ? Math.exp(fromLogAltitude + logAltitudeDelta * motion)
        : fromAltitudeM;
      const tiltDeg = phaseTiltForAltitude(
        altitudeM, fromAltitudeM, toAltitudeM, fromTiltDeg, toTiltDeg,
      );
      const altitudeRate = changing
        ? altitudeM * logAltitudeDelta * smootherstepDerivative(u) / span : 0;
      const tiltRate = changing
        ? (toTiltDeg - fromTiltDeg) * smootherstepDerivative(u) / span : 0;
      samples.push({
        frame: i === count ? toFrame : fromFrame + span * u,
        altitude_m: altitudeM,
        tilt_deg: tiltDeg,
        altitude_rate_per_frame: altitudeRate,
        tilt_rate_per_frame: tiltRate,
      });
    }
    return samples;
  }

  // Restrict derivative-matched Hermite slopes to the monotonicity region for
  // every serialized interval. This preserves one C1 derivative at each key
  // without allowing a generic cubic to overshoot geography/framing values.
  function limitMonotoneRates(samples, valueKey, rateKey) {
    const rates = samples.map((sample) => Number(sample[rateKey]) || 0);
    for (let i = 0; i < samples.length - 1; i += 1) {
      const gap = samples[i + 1].frame - samples[i].frame;
      const secant = gap > 0 ? (samples[i + 1][valueKey] - samples[i][valueKey]) / gap : 0;
      if (Math.abs(secant) < 1e-15) {
        rates[i] = 0; rates[i + 1] = 0; continue;
      }
      if (rates[i] * secant < 0) rates[i] = 0;
      if (rates[i + 1] * secant < 0) rates[i + 1] = 0;
      const alpha = rates[i] / secant;
      const beta = rates[i + 1] / secant;
      const magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        rates[i] = scale * alpha * secant;
        rates[i + 1] = scale * beta * secant;
      }
    }
    samples.forEach((sample, index) => { sample[rateKey] = rates[index]; });
  }

  // One coordinated local -> climb -> cruise -> descent -> local envelope.
  // Endpoint tilts may be explicit/morphology/continuation anchors. The cruise
  // tilt is always derived from the canonical height law, so every candidate's
  // perspective follows its own altitude without independent correction keys.
  function coupledHeightTiltEnvelope(options) {
    const startFrame = Number(options.startFrame) || 0;
    const climbEndFrame = Number(options.climbEndFrame);
    const descentStartFrame = Number(options.descentStartFrame);
    const endFrame = Number(options.endFrame);
    const startAltitudeM = Number(options.startAltitudeM);
    const cruiseAltitudeM = Number(options.cruiseAltitudeM);
    const endAltitudeM = Number(options.endAltitudeM);
    if (![climbEndFrame, descentStartFrame, endFrame, startAltitudeM, cruiseAltitudeM, endAltitudeM]
      .every(Number.isFinite)) throw new Error('coupled height/tilt envelope requires finite frames and altitudes');
    if (!(startFrame <= climbEndFrame && climbEndFrame <= descentStartFrame && descentStartFrame <= endFrame)) {
      throw new Error('coupled height/tilt envelope phases are out of order');
    }
    const startTiltDeg = Number.isFinite(options.startTiltDeg) ? Number(options.startTiltDeg)
      : tiltForAltitude(startAltitudeM, options.heightLaw);
    const endTiltDeg = Number.isFinite(options.endTiltDeg) ? Number(options.endTiltDeg)
      : tiltForAltitude(endAltitudeM, options.heightLaw);
    const cruiseTiltDeg = tiltForAltitude(cruiseAltitudeM, options.heightLaw);
    const count = Math.max(4, Math.min(24, Math.round(Number(options.samplesPerPhase) || 8)));
    const climb = samplePhase(startFrame, climbEndFrame, startAltitudeM, cruiseAltitudeM,
      startTiltDeg, cruiseTiltDeg, count);
    const descent = samplePhase(descentStartFrame, endFrame, cruiseAltitudeM, endAltitudeM,
      cruiseTiltDeg, endTiltDeg, count);
    const combined = [
      ...climb,
      ...(descentStartFrame > climbEndFrame ? [{ frame: descentStartFrame, altitude_m: cruiseAltitudeM,
        tilt_deg: cruiseTiltDeg, altitude_rate_per_frame: 0, tilt_rate_per_frame: 0 }] : []),
      ...descent.slice(descentStartFrame === climbEndFrame ? 1 : 1),
    ];
    const unique = [];
    for (const sample of combined.sort((a, b) => a.frame - b.frame)) {
      if (unique.length && unique.at(-1).frame === sample.frame) unique[unique.length - 1] = sample;
      else unique.push(sample);
    }
    limitMonotoneRates(unique, 'altitude_m', 'altitude_rate_per_frame');
    limitMonotoneRates(unique, 'tilt_deg', 'tilt_rate_per_frame');
    return unique.map((sample) => ({
      ...sample,
      altitude_m: Number(sample.altitude_m.toFixed(6)),
      tilt_deg: Number(sample.tilt_deg.toFixed(6)),
      altitude_rate_per_frame: [startFrame, climbEndFrame, descentStartFrame, endFrame].includes(sample.frame)
        ? 0 : Number(sample.altitude_rate_per_frame.toFixed(9)),
      tilt_rate_per_frame: [startFrame, climbEndFrame, descentStartFrame, endFrame].includes(sample.frame)
        ? 0 : Number(sample.tilt_rate_per_frame.toFixed(9)),
    }));
  }

  function altitudeTiltCouplingDiagnostics(samples, options = {}) {
    const toleranceDeg = Number.isFinite(options.toleranceDeg) ? options.toleranceDeg : 1;
    const defects = [];
    for (let i = 1; i < samples.length; i += 1) {
      const previous = samples[i - 1];
      const current = samples[i];
      const altitudeDelta = current.altitude_m - previous.altitude_m;
      const tiltDelta = current.tilt_deg - previous.tilt_deg;
      if ((altitudeDelta > 1 && tiltDelta > toleranceDeg)
        || (altitudeDelta < -1 && tiltDelta < -toleranceDeg)) {
        defects.push({
          code: 'ALTITUDE_TILT_DECOUPLING',
          advisory: true,
          frames: [previous.frame, current.frame],
          altitude_delta_m: Number(altitudeDelta.toFixed(3)),
          tilt_delta_deg: Number(tiltDelta.toFixed(3)),
          expected: altitudeDelta > 0 ? 'numeric tilt must not increase during climb'
            : 'numeric tilt must not decrease during descent',
        });
      }
    }
    return defects;
  }

  const api = {
    EARTH_STUDIO_TOP_DOWN_TILT_DEG,
    EARTH_STUDIO_HORIZON_SAFE_TILT_DEG,
    LOWEST_PRACTICAL_ALTITUDE_M,
    HIGHEST_PRACTICAL_ALTITUDE_M,
    CALIBRATED_TRAVEL_APPARENT_SPEED_FW_PER_S,
    EARTH_STUDIO_DEFAULT_FOV_DEG,
    smootherstep,
    smootherstepDerivative,
    normalizedLogHeight,
    tiltForAltitude,
    frameWidthMetersForAltitude,
    apparentTravelSpeedFrameWidths,
    solveMinimumSufficientTravelAltitude,
    phaseTiltForAltitude,
    coupledHeightTiltEnvelope,
    altitudeTiltCouplingDiagnostics,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalScope.VidtoolzEarthStudioHeightFraming = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

