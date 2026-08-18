"use strict";
// Gate 3 native-template tests.
//
// The single most important test in this file is the BYTE-STABILITY gate:
// untemplated plans regenerated with the CURRENT code path must stay
// byte-identical to the frozen v0.9.4 controls
// (controls/v094-byte-control-manifest.json). It must remain green after
// every Gate 3 phase — any diff means template work leaked into the generic
// planner path.
const { assert, fs, path, test } = require("./_helpers.js");
const crypto = require("node:crypto");
const planner = require("../earth-studio-job-planner.js");
const native = require("../earth-studio-native-template-profiles.js");
const inspector = require("../scripts/inspect-earth-studio-project.js");

const ROOT = path.join(__dirname, "..");
const EVIDENCE = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-templates");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "controls/v094-byte-control-manifest.json")));
const shaFile = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const shaStr = (s) => crypto.createHash("sha256").update(Buffer.from(s)).digest("hex");

test("gate3 BYTE-STABILITY: regenerated untemplated plans are byte-identical to the frozen v0.9.4 controls", () => {
  assert.equal(MANIFEST.controls.length, 11, "control manifest entry count");
  // 1) every manifest entry's on-disk file is still byte-frozen
  for (const c of MANIFEST.controls) {
    assert.equal(shaFile(path.join(ROOT, c.path)), c.sha256, `frozen on disk: ${c.path}`);
  }
  // 2) the three v0.9.4 control plans REGENERATE byte-identically from their
  // recorded inputs (job.json description+aspect, shot-plan generated_at)
  // through the current planner code path with NO template request.
  const plans = [...new Set(MANIFEST.controls.filter((c) => !/pinned/.test(c.artifact)).map((c) => c.plan))];
  assert.equal(plans.length, 3, "regenerable control plans");
  for (const plan of plans) {
    const dir = path.join(ROOT, "package-runs", plan, "earth-studio");
    const job = JSON.parse(fs.readFileSync(path.join(dir, "job.json")));
    const generatedAt = JSON.parse(fs.readFileSync(path.join(dir, "shot-plan.json"))).generated_at;
    const artifacts = planner.buildArtifacts(job.jobName, job.description, generatedAt, { aspect: job.aspect });
    for (const artifact of ["earth-studio.esp", "shot-plan.json"]) {
      const expected = MANIFEST.controls.find((c) => c.plan === plan && c.artifact === artifact);
      assert.ok(expected, `${plan}/${artifact} in manifest`);
      assert.equal(shaStr(artifacts[artifact]), expected.sha256, `BYTE IDENTICAL: ${plan}/${artifact}`);
    }
  }
});

test("gate3 provenance: module pins the exact frozen Gate 2 spec", () => {
  assert.equal(native.TEMPLATE_PROFILE_VERSION, "ges-native-derived-v1");
  assert.equal(shaFile(path.join(ROOT, native.GATE2_SPEC_PATH)), native.GATE2_SPEC_SHA256, "Gate 2 spec drifted from the pinned hash");
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, native.GATE2_SPEC_PATH)));
  assert.equal(spec.version, 1);
});

test("gate3 altitude codec: linear and logarithmic round-trips across the working range", () => {
  const points = [-500, 0, 25.5, 500, 1028.3, 20000, 312624, 65117481];
  for (const logarithmic of [false, true]) {
    for (const m of points) {
      const n = native.altitudeMetersToNativeNorm(m, { logarithmic });
      assert.ok(n >= 0 && n <= 1, `norm in [0,1] for ${m}`);
      const back = native.nativeNormToAltitudeMeters(n, { logarithmic });
      assert.ok(Math.abs(back - m) < 1e-6 * Math.max(1, Math.abs(m)), `round-trip ${m} m (log=${logarithmic}) got ${back}`);
    }
  }
  // exact edges
  assert.equal(native.altitudeMetersToNativeNorm(-500), 0);
  assert.equal(native.altitudeMetersToNativeNorm(65117481), 1);
  assert.equal(native.altitudeMetersToNativeNorm(65117481, { logarithmic: true }), 1);
  // out-of-range and junk throw
  assert.throws(() => native.altitudeMetersToNativeNorm(-501), /outside native range/);
  assert.throws(() => native.altitudeMetersToNativeNorm(65117482), /outside native range/);
  assert.throws(() => native.altitudeMetersToNativeNorm(NaN), /not finite/);
  assert.throws(() => native.nativeNormToAltitudeMeters(1.0001), /out of \[0,1\]/);
});

test("gate3 altitude codec: decodes frozen native evidence anchors exactly", () => {
  // zoom-to ref-a (logarithmic model): camera end framing = 1028.3 m (live
  // editor observation), POI ground = ~25.5 m, start = slider max
  assert.ok(Math.abs(native.nativeNormToAltitudeMeters(0.49132400748554, { logarithmic: true }) - 1028.3) < 0.05);
  assert.ok(Math.abs(native.nativeNormToAltitudeMeters(1, { logarithmic: true }) - 65117481) < 1e-6);
  // orbit ref-a (linear model): camera altitude norm from the frozen .esp
  const linearAnchor = native.nativeNormToAltitudeMeters(0.000012991803293164142);
  assert.ok(Math.abs(linearAnchor - (0.000012991803293164142 * 65117981 - 500)) < 1e-9);
  // encoding direction reproduces the frozen norm
  assert.ok(Math.abs(native.altitudeMetersToNativeNorm(1028.3, { logarithmic: true }) - 0.49132400748554) < 1e-6);
});

test("gate3 lon/lat codec: round-trips and matches frozen orbit ref-a normalization", () => {
  for (const lon of [-180, -0.119344, 0, 24.9384, 180]) {
    assert.ok(Math.abs(native.nativeNormToLon(native.lonToNativeNorm(lon)) - lon) < 1e-12, `lon ${lon}`);
  }
  for (const lat of [-90, 0, 51.503077, 90]) {
    assert.ok(Math.abs(native.nativeNormToLat(native.latToNativeNorm(lat)) - lat) < 1e-12, `lat ${lat}`);
  }
  // frozen orbit ref-a longitude norm 0.49966848881254916 = London Eye lon
  assert.ok(Math.abs(native.nativeNormToLon(0.49966848881254916) - -0.11934) < 1e-4);
  assert.throws(() => native.lonToNativeNorm(181), /longitude out of range/);
  assert.throws(() => native.latToNativeNorm(-91), /latitude out of range/);
});

// ---- Gate 3B: Zoom-To + Point-to-Point reconstruction vs frozen natives ----
const comparator = require("../scripts/compare-earth-studio-template-reconstruction.js");

const loadEsp = (rel) => JSON.parse(fs.readFileSync(path.join(EVIDENCE, rel)));
const findNode = (raw, type) => {
  let hit = null;
  (function w(o) { if (o && typeof o === "object") { if (o.type === type && !hit) hit = o; for (const k in o) if (typeof o[k] === "object") w(o[k]); } })(raw);
  return hit;
};
const worldTimeOf = (raw) => findNode(raw, "worldTime").value.minValueRange + 86400000;
const LOG = { logarithmic: true };

function zoomInputsFrom(raw) {
  const lon = findNode(raw, "longitude").keyframes, lat = findNode(raw, "latitude").keyframes, alt = findNode(raw, "altitude").keyframes;
  return {
    name: raw.settings.name,
    durationS: raw.settings.duration / raw.settings.frameRate,
    framing: { lonDeg: native.nativeNormToLon(lon[0].value), latDeg: native.nativeNormToLat(lat[0].value), altitudeM: native.nativeNormToAltitudeMeters(alt[1].value, LOG) },
    poi: {
      lonDeg: native.nativeNormToLon(findNode(raw, "longitudePOI").keyframes[0].value),
      latDeg: native.nativeNormToLat(findNode(raw, "latitudePOI").keyframes[0].value),
      altitudeM: native.nativeNormToAltitudeMeters(findNode(raw, "altitudePOI").keyframes[0].value, LOG),
    },
    startAltitudeM: native.nativeNormToAltitudeMeters(alt[0].value, LOG),
    worldTimeMs: worldTimeOf(raw),
  };
}

test("gate3B zoom-to: reconstruction from frozen-ref inputs is structurally exact for all three references", () => {
  for (const ref of ["ref-a", "ref-b", "ref-c"]) {
    const raw = loadEsp(`zoom-to/${ref}/export/VIDTOOLZ-TPL-ZOOM-${ref.slice(-1).toUpperCase()}.esp`);
    const { project, provenance } = native.buildZoomToProject(zoomInputsFrom(raw));
    const report = comparator.compareProjects(project, raw);
    assert.equal(report.verdict, "RECONSTRUCTED_EXACT",
      `${ref}: ${JSON.stringify(report.diffs.filter((d) => d.severity !== "META").slice(0, 5))}`);
    assert.equal(provenance.template_id, "ges_zoom_to_derived_v1");
    assert.equal(provenance.template_profile_version, "ges-native-derived-v1");
    assert.match(provenance.import_status, /^IMPORT_VERIFIED \(Gate 3C/);
  }
});

function p2pInputsFrom(raw) {
  const fps = raw.settings.frameRate, totalS = raw.settings.duration / fps;
  const lon = findNode(raw, "longitude").keyframes, lat = findNode(raw, "latitude").keyframes, alt = findNode(raw, "altitude").keyframes;
  const t1 = lon[1].time, t3 = lon[3].time;
  const plon = findNode(raw, "longitudePOI").keyframes, plat = findNode(raw, "latitudePOI").keyframes, palt = findNode(raw, "altitudePOI").keyframes;
  const point = (i, pi) => ({
    framing: { lonDeg: native.nativeNormToLon(lon[i].value), latDeg: native.nativeNormToLat(lat[i].value), altitudeM: native.nativeNormToAltitudeMeters(alt[i].value, LOG) },
    poi: { lonDeg: native.nativeNormToLon(plon[pi].value), latDeg: native.nativeNormToLat(plat[pi].value), altitudeM: native.nativeNormToAltitudeMeters(palt[pi].value, LOG) },
    holdS: pi === 0 ? t1 * totalS : (1 - t3) * totalS,
  });
  return {
    name: raw.settings.name,
    points: [point(0, 0), point(4, 2)],
    transitS: (t3 - t1) * totalS,
    transitPeakAltitudeM: native.nativeNormToAltitudeMeters(alt[2].value, LOG),
    worldTimeMs: worldTimeOf(raw),
  };
}

test("gate3B point-to-point: reconstruction matches frozen refs (exact motion; inert-scaffolding variance tolerated where natives themselves vary)", () => {
  const expected = { "ref-a": ["RECONSTRUCTED_EXACT"], "ref-b": ["RECONSTRUCTED_WITH_INERT_VARIANCE"], "ref-c": ["RECONSTRUCTED_EXACT", "RECONSTRUCTED_WITH_INERT_VARIANCE"] };
  for (const [ref, allowed] of Object.entries(expected)) {
    const raw = loadEsp(`point-to-point/${ref}/export/VIDTOOLZ-TPL-POINT-${ref.slice(-1).toUpperCase()}.esp`);
    const { project } = native.buildPointToPointProject(p2pInputsFrom(raw));
    const report = comparator.compareProjects(project, raw);
    assert.ok(allowed.includes(report.verdict),
      `${ref}: got ${report.verdict}: ${JSON.stringify(report.diffs.filter((d) => d.severity === "FAIL").slice(0, 5))}`);
    assert.equal(report.fail_count, 0, `${ref} has FAIL diffs`);
  }
});

test("gate3B point-to-point: default transit-peak law lands within 5% of both frozen observations", () => {
  for (const ref of ["ref-a", "ref-b"]) {
    const raw = loadEsp(`point-to-point/${ref}/export/VIDTOOLZ-TPL-POINT-${ref.slice(-1).toUpperCase()}.esp`);
    const inputs = p2pInputsFrom(raw);
    const observedPeak = inputs.transitPeakAltitudeM;
    delete inputs.transitPeakAltitudeM;
    const built = native.buildPointToPointProject(inputs);
    const meanHold = (inputs.points[0].framing.altitudeM + inputs.points[1].framing.altitudeM) / 2;
    const relErr = Math.abs((built.transit_peak_m - meanHold) - (observedPeak - meanHold)) / (observedPeak - meanHold);
    assert.ok(relErr < 0.05, `${ref}: default peak-above-hold off by ${(relErr * 100).toFixed(1)}%`);
    assert.ok(built.provenance.confidence_notes.some((n) => /MEDIUM/.test(n)), "default-law use must be flagged MEDIUM in provenance");
  }
});

test("gate3B guards: required explicit inputs, 2-point scope, evidence-domain extrapolation flag", () => {
  const base = p2pInputsFrom(loadEsp("point-to-point/ref-a/export/VIDTOOLZ-TPL-POINT-A.esp"));
  assert.throws(() => native.buildZoomToProject({ name: "x", poi: { lonDeg: 0, latDeg: 0, altitudeM: 0 }, worldTimeMs: 1786962725077 }), /framing.*required explicit input/);
  assert.throws(() => native.buildPointToPointProject({ ...base, points: [...base.points, base.points[0]] }), /exactly 2 entries/);
  assert.throws(() => native.buildPointToPointProject({ ...base, points: [{ framing: base.points[0].framing }, base.points[1]] }), /poi.*required/);
  // 1 km leg is below the 3 km evidence floor -> flagged EXTRAPOLATED, not an error
  const close = JSON.parse(JSON.stringify(base));
  close.points[1].framing.latDeg = close.points[0].framing.latDeg + 0.009;
  close.points[1].framing.lonDeg = close.points[0].framing.lonDeg;
  const built = native.buildPointToPointProject(close);
  assert.ok(built.provenance.extrapolations.some((e) => /EXTRAPOLATED/.test(e)), JSON.stringify(built.provenance.extrapolations));
  // in-domain legs carry no extrapolation flag
  assert.equal(native.buildPointToPointProject(base).provenance.extrapolations.length, 0);
});

// ---- Gate 3C/3D: Orbit + locked Camera Target serialization ----

function orbitInputsFrom(raw) {
  const lon = findNode(raw, "longitude").keyframes, lat = findNode(raw, "latitude").keyframes, alt = findNode(raw, "altitude").keyframes;
  const target = {
    lonDeg: native.nativeNormToLon(findNode(raw, "longitudePOI").keyframes[0].value),
    latDeg: native.nativeNormToLat(findNode(raw, "latitudePOI").keyframes[0].value),
    altitudeM: native.nativeNormToAltitudeMeters(findNode(raw, "altitudePOI").keyframes[0].value),
  };
  const cam0 = { lonDeg: native.nativeNormToLon(lon[0].value), latDeg: native.nativeNormToLat(lat[0].value) };
  return {
    name: raw.settings.name,
    durationS: raw.settings.duration / raw.settings.frameRate,
    target,
    radiusM: native.haversineNativeMeters(target, cam0),
    cameraAltitudeM: native.nativeNormToAltitudeMeters(alt[0].value),
    startAzimuthDeg: 0, // all standalone refs start due north (Gate 2)
    direction: "ccw",
    worldTimeMs: worldTimeOf(raw),
  };
}

test("gate3C camera-target serializer: locked subtree is byte-equal to the frozen native Orbit subtree", () => {
  const raw = loadEsp("orbit/ref-a/export/VIDTOOLZ-TPL-ORBIT-A.esp");
  const frozen = findNode(raw, "cameraTargetEffect");
  const built = native.buildLockedCameraTarget({
    lonNorm: findNode(raw, "longitudePOI").keyframes[0].value,
    latNorm: findNode(raw, "latitudePOI").keyframes[0].value,
    altNorm: findNode(raw, "altitudePOI").keyframes[0].value,
  });
  assert.equal(JSON.stringify(built), JSON.stringify(frozen), "locked camera-target subtree must match the native shape exactly (keys, order, flags)");
});

test("gate3D orbit: reconstruction from frozen-ref inputs is structurally exact for all three references", () => {
  for (const ref of ["ref-a", "ref-b", "ref-c"]) {
    const raw = loadEsp(`orbit/${ref}/export/VIDTOOLZ-TPL-ORBIT-${ref.slice(-1).toUpperCase()}.esp`);
    const { project, provenance } = native.buildOrbitProject(orbitInputsFrom(raw));
    const report = comparator.compareProjects(project, raw);
    assert.equal(report.verdict, "RECONSTRUCTED_EXACT",
      `${ref}: ${JSON.stringify(report.diffs.filter((d) => d.severity !== "META").slice(0, 6))}`);
    assert.equal(provenance.template_id, "ges_orbit_derived_v1");
    assert.match(provenance.import_status, /^IMPORT_VERIFIED \(Gate 3C/);
  }
});

test("gate3D orbit: default camera-altitude law, direction topology, and non-cardinal extrapolation flag", () => {
  const base = orbitInputsFrom(loadEsp("orbit/ref-a/export/VIDTOOLZ-TPL-ORBIT-A.esp"));
  // default law round(target_alt + 312) reproduces the frozen default within 0.5 m
  const defaults = { ...base };
  delete defaults.cameraAltitudeM;
  const built = native.buildOrbitProject(defaults);
  assert.ok(Math.abs(built.camera_altitude_m - base.cameraAltitudeM) < 0.5, `default alt ${built.camera_altitude_m} vs frozen ${base.cameraAltitudeM}`);
  assert.ok(built.provenance.confidence_notes.some((n) => /MEDIUM/.test(n)));
  // ccw bearing decreases; cw increases (inferred, flagged MEDIUM)
  const az = (p) => {
    const lon = findNode(p, "longitude").keyframes.map((k) => k.value);
    return lon[1] - lon[0]; // first quarter step: west negative for ccw from north
  };
  assert.ok(az(native.buildOrbitProject(base).project) < 0, "ccw first step heads west");
  const cw = native.buildOrbitProject({ ...base, direction: "cw" });
  assert.ok(az(cw.project) > 0, "cw first step heads east");
  assert.ok(cw.provenance.confidence_notes.some((n) => /clockwise.*MEDIUM|MEDIUM.*clockwise/i.test(n)));
  const diag = native.buildOrbitProject({ ...base, startAzimuthDeg: 225 });
  assert.ok(diag.provenance.extrapolations.some((e) => /non-cardinal/.test(e)));
});

// ---- Gate 3D: Spiral (semantic) + Fly-To-and-Orbit reconstruction ----

const bearingDeg = (t, p) => {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(p.lonDeg - t.lonDeg)) * Math.cos(rad(p.latDeg));
  const x = Math.cos(rad(t.latDeg)) * Math.sin(rad(p.latDeg)) - Math.sin(rad(t.latDeg)) * Math.cos(rad(p.latDeg)) * Math.cos(rad(p.lonDeg - t.lonDeg));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const targetOf = (raw) => ({
  lonDeg: native.nativeNormToLon(findNode(raw, "longitudePOI").keyframes[0].value),
  latDeg: native.nativeNormToLat(findNode(raw, "latitudePOI").keyframes[0].value),
  altitudeM: native.nativeNormToAltitudeMeters(findNode(raw, "altitudePOI").keyframes[0].value),
});
const camAt = (raw, i) => ({
  lonDeg: native.nativeNormToLon(findNode(raw, "longitude").keyframes[i].value),
  latDeg: native.nativeNormToLat(findNode(raw, "latitude").keyframes[i].value),
});

test("gate3D spiral: values exact, arc-length timing within the documented residual, easing family correct (semantic vs frozen refs)", () => {
  for (const ref of ["ref-a", "ref-b"]) {
    const raw = loadEsp(`spiral/${ref}/export/VIDTOOLZ-TPL-SPIRAL-${ref.slice(-1).toUpperCase()}.esp`);
    const target = targetOf(raw);
    const lon = findNode(raw, "longitude").keyframes, lat = findNode(raw, "latitude").keyframes, alt = findNode(raw, "altitude").keyframes;
    const n = lon.length - 1;
    const { project, provenance } = native.buildSpiralProject({
      name: raw.settings.name, durationS: raw.settings.duration / raw.settings.frameRate, target,
      radiusStartM: native.haversineNativeMeters(target, camAt(raw, 0)),
      radiusEndM: native.haversineNativeMeters(target, camAt(raw, n)),
      angleTotalDeg: n * 90,
      altitudeStartM: native.nativeNormToAltitudeMeters(alt[0].value),
      altitudeEndM: native.nativeNormToAltitudeMeters(alt[n].value),
      worldTimeMs: worldTimeOf(raw),
    });
    const glon = findNode(project, "longitude").keyframes, glat = findNode(project, "latitude").keyframes, galt = findNode(project, "altitude").keyframes;
    assert.equal(glon.length, n + 1, `${ref} keyframe count`);
    for (let i = 0; i <= n; i++) {
      assert.ok(Math.abs(glon[i].time - lon[i].time) < 0.006, `${ref} kf${i} time ${glon[i].time} vs ${lon[i].time}`);
      assert.ok(Math.abs(glon[i].value - lon[i].value) < 5e-10, `${ref} kf${i} lon`);
      assert.ok(Math.abs(glat[i].value - lat[i].value) < 5e-10, `${ref} kf${i} lat`);
      assert.ok(Math.abs(galt[i].value - alt[i].value) < 1e-9, `${ref} kf${i} alt`);
    }
    // easing family: extreme keyframes carry the exact orbit auto(0.066/0.5);
    // interior center-crossings carry 0.16-influence autos with x within 2%
    assert.deepEqual(glat[0].transitionOut, { x: 0.066, y: 0, influence: 0.5, type: "auto" }, `${ref} lat kf0 extreme auto`);
    assert.deepEqual(glon[0].transitionIn, { x: 0, y: 0, type: "linear" }, `${ref} lon kf0 endpoint linear`);
    const gIn = glon[2].transitionIn, rIn = lon[2].transitionIn;
    assert.equal(gIn.type, "auto");
    assert.ok(Math.abs(gIn.x - rIn.x) / Math.abs(rIn.x) < 0.02, `${ref} 0.16-handle x`);
    assert.ok(gIn.y * rIn.y > 0 && Math.abs(gIn.y) > Math.abs(rIn.y) / 2.5 && Math.abs(gIn.y) < Math.abs(rIn.y) * 2.5, `${ref} 0.16-handle y same sign/order`);
    assert.ok(Math.abs(gIn.influence - 0.16) < 1e-9);
    // locked target byte-equal
    assert.equal(JSON.stringify(findNode(project, "cameraTargetEffect")), JSON.stringify(findNode(raw, "cameraTargetEffect")), `${ref} target subtree`);
    assert.ok(provenance.confidence_notes.some((x) => /APPROXIMAT/.test(x)), "timing/handle approximation must be flagged");
  }
  // ref-c (720°): kf0 is contaminated (Gate 1 manifest); verify grid + laws on clean interior keyframes
  const rawC = loadEsp("spiral/ref-c/export/VIDTOOLZ-TPL-SPIRAL-C.esp");
  const targetC = targetOf(rawC);
  const lonC = findNode(rawC, "longitude").keyframes, altC = findNode(rawC, "altitude").keyframes;
  assert.equal(lonC.length, 9, "720° -> 9 keyframes");
  const { project: projC } = native.buildSpiralProject({
    name: "C", durationS: rawC.settings.duration / rawC.settings.frameRate, target: targetC,
    radiusStartM: 1997.76, radiusEndM: 499.44, angleTotalDeg: 720, // A-derived constants (Gate 2)
    altitudeStartM: targetC.altitudeM + 978.56, altitudeEndM: targetC.altitudeM + 78.90,
    worldTimeMs: worldTimeOf(rawC),
  });
  const gC = findNode(projC, "longitude").keyframes;
  assert.equal(gC.length, 9);
  for (let i = 1; i <= 8; i++) { // skip contaminated kf0
    assert.ok(Math.abs(gC[i].time - lonC[i].time) < 0.008, `ref-c kf${i} time`);
    // inputs are A-derived rounded constants, so tolerance reflects the
    // Gate 2 law residual (~0.1% of radius), not reconstruction precision
    assert.ok(Math.abs(gC[i].value - lonC[i].value) < 1.5e-7, `ref-c kf${i} lon ${gC[i].value} vs ${lonC[i].value}`);
  }
});

function flyOrbitInputsFrom(raw) {
  const target = targetOf(raw);
  const alt = findNode(raw, "altitude").keyframes;
  const entryAz = Math.round(bearingDeg(target, camAt(raw, 1))) % 360;
  const az2 = bearingDeg(target, camAt(raw, 2));
  return {
    name: raw.settings.name, durationS: raw.settings.duration / raw.settings.frameRate, target,
    endAltitudeM: native.nativeNormToAltitudeMeters(alt[1].value),
    orbitRadiusM: native.haversineNativeMeters(target, camAt(raw, 1)),
    approachAngleDeg: entryAz,
    clockwise: (((az2 - entryAz + 540) % 360) - 180) > 0,
    worldTimeMs: worldTimeOf(raw),
  };
}
// entry in-handles on lon/lat jitter between native captures (influence
// 0.52-0.54, center y ratio ~0.036-0.039) — stripped for the structural
// comparison and asserted semantically below
const stripEntryIn = (p) => {
  const c = JSON.parse(JSON.stringify(p));
  for (const prop of ["longitude", "latitude"]) delete findNode(c, prop).keyframes[1].transitionIn;
  return c;
};

test("gate3D fly-to-and-orbit: reconstruction structurally exact vs all four refs incl. sup-e (CW, 90°)", () => {
  for (const [ref, file] of [["ref-a", "VIDTOOLZ-TPL-FLY-ORBIT-A"], ["ref-b", "VIDTOOLZ-TPL-FLY-ORBIT-B"], ["ref-c", "VIDTOOLZ-TPL-FLY-ORBIT-C2"], ["sup-e", "VIDTOOLZ-TPL-FLY-ORBIT-SUP-E"]]) {
    const raw = loadEsp(`fly-to-and-orbit/${ref}/export/${file}.esp`);
    const inputs = flyOrbitInputsFrom(raw);
    const { project, provenance } = native.buildFlyToAndOrbitProject(inputs);
    const report = comparator.compareProjects(stripEntryIn(project), stripEntryIn(raw));
    assert.equal(report.verdict, "RECONSTRUCTED_EXACT",
      `${ref}: ${JSON.stringify(report.diffs.filter((d) => d.severity !== "META").slice(0, 5))}`);
    // entry in-handles: exact altitude law, semantic lon/lat (x = influence x 0.2)
    const altIn = findNode(project, "altitude").keyframes[1].transitionIn;
    assert.deepEqual(altIn, { x: -0.5, y: 0, influence: 1, type: "custom" }, `${ref} altitude entry flat-in`);
    for (const prop of ["longitude", "latitude"]) {
      const gen = findNode(project, prop).keyframes[1].transitionIn;
      const obs = findNode(raw, prop).keyframes[1].transitionIn;
      assert.equal(gen.type, "custom");
      assert.ok(Math.abs(gen.x - obs.x) <= 0.006, `${ref} ${prop} entry x ${gen.x} vs ${obs.x}`);
      assert.ok(Math.abs(gen.influence - obs.influence) <= 0.03, `${ref} ${prop} entry influence`);
      assert.ok(Math.abs(gen.x + gen.influence * 0.2) < 1e-9, `${ref} ${prop} x = -influence x 0.2`);
    }
    assert.equal(provenance.template_id, "ges_fly_to_and_orbit_derived_v1");
  }
  // sup-e semantics pinned: CW + entry due east
  const supe = flyOrbitInputsFrom(loadEsp("fly-to-and-orbit/sup-e/export/VIDTOOLZ-TPL-FLY-ORBIT-SUP-E.esp"));
  assert.equal(supe.approachAngleDeg, 90);
  assert.equal(supe.clockwise, true);
});

test("gate3D fly-to-and-orbit: synthetic 225° approach is generated and labeled EXTRAPOLATED", () => {
  const base = flyOrbitInputsFrom(loadEsp("fly-to-and-orbit/ref-a/export/VIDTOOLZ-TPL-FLY-ORBIT-A.esp"));
  const built = native.buildFlyToAndOrbitProject({ ...base, approachAngleDeg: 225 });
  assert.ok(built.provenance.extrapolations.some((e) => /non-cardinal.*EXTRAPOLATED/.test(e)));
  // geometry still holds: start azimuth 225 - 90x(-1) = 315, entry at 225
  const target = base.target;
  const p = built.project;
  const entry = { lonDeg: native.nativeNormToLon(findNode(p, "longitude").keyframes[1].value), latDeg: native.nativeNormToLat(findNode(p, "latitude").keyframes[1].value) };
  const start = { lonDeg: native.nativeNormToLon(findNode(p, "longitude").keyframes[0].value), latDeg: native.nativeNormToLat(findNode(p, "latitude").keyframes[0].value) };
  assert.ok(Math.abs(bearingDeg(target, entry) - 225) < 0.01, "entry azimuth 225");
  assert.ok(Math.abs(bearingDeg(target, start) - 315) < 0.01, "start azimuth 315 (ccw)");
  assert.ok(Math.abs(native.haversineNativeMeters(target, start) - (base.orbitRadiusM + 20000)) < 0.5, "start distance radius+20km");
});

// ---- Gate 3C: real-import proof evidence (frozen) ----
const G3_EVIDENCE = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-template-implementation");

test("gate3C import proof: frozen fixtures and real GES re-exports round-trip with zero structural differences", () => {
  const record = JSON.parse(fs.readFileSync(path.join(G3_EVIDENCE, "comparison/gate3c-import-proof.json")));
  assert.equal(record.gate, "CAMERA_TARGET_SERIALIZATION=IMPORT_VERIFIED");
  for (const tpl of ["orbit", "zoom-to"]) {
    const r = record.results[tpl];
    // evidence files are frozen at their recorded hashes
    for (const side of ["fixture", "roundtrip"]) {
      assert.equal(shaFile(path.join(G3_EVIDENCE, r[side].file)), r[side].sha256, `${tpl} ${side} drifted`);
    }
    // the round-trip comparison reproduces: no FAIL, no WARN (only META:
    // Save-As name + scrub-position value.relative snapshots)
    const fixture = JSON.parse(fs.readFileSync(path.join(G3_EVIDENCE, r.fixture.file)));
    const roundtrip = JSON.parse(fs.readFileSync(path.join(G3_EVIDENCE, r.roundtrip.file)));
    const rep = comparator.compareProjects(roundtrip, fixture, { valueRelativeAsMeta: true });
    assert.equal(rep.verdict, "RECONSTRUCTED_EXACT", `${tpl}: ${JSON.stringify(rep.diffs.filter((d) => d.severity !== "META"))}`);
  }
  // the orbit fixture was generated from this module's builder — regenerable
  const gen = JSON.parse(fs.readFileSync(path.join(G3_EVIDENCE, "imports/VIDTOOLZ-G3C-ORBIT-IMPORT.generation.json")));
  const rebuilt = native.buildOrbitProject(gen.inputs);
  assert.equal(shaStr(JSON.stringify(rebuilt.project)), gen.esp_sha256, "orbit fixture regenerates byte-identically from recorded inputs");
});

// ---- Gate 3E: explicit intent, lane integration, frozen matrix, negatives ----
const lane = require("../earth-studio-lane.js");
const os = require("node:os");

test("gate3E intent: explicit phrases activate templates; generic motion words never do", () => {
  const hit = (s) => native.detectExplicitTemplateIntent(s);
  assert.equal(hit("template: fly-to-and-orbit around the Eiffel Tower").template_id, "ges_fly_to_and_orbit_derived_v1");
  assert.equal(hit("Template: Zoom To Paris").template_id, "ges_zoom_to_derived_v1");
  assert.equal(hit("use the Earth Studio Orbit template on the London Eye").template_id, "ges_orbit_derived_v1");
  assert.equal(hit("use Quick Start Spiral over Tokyo").template_id, "ges_spiral_derived_v1");
  assert.equal(hit("quickstart point-to-point London to Paris").template_id, "ges_point_to_point_derived_v1");
  // negative controls: the generic planner vocabulary must never match
  for (const s of [
    "orbit around the Eiffel Tower twice for 10 seconds",
    "fly to Helsinki in 5 seconds, then orbit Helsinki",
    "zoom out from London to space",
    "spiral staircase visible from above", // mentions a template word without explicit framing
    "hover over the point to point out the bridge",
  ]) assert.equal(hit(s), null, `false positive: ${s}`);
});

test("gate3E lane: template selection persists provenance in job.json; untemplated job.json format unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "es-native-lane-"));
  const pkg = path.join(root, "pkg"); fs.mkdirSync(pkg);
  // untemplated: no template key in job.json (byte-frozen v0.9.4 field set)
  lane.writeJob(pkg, { jobName: "Plain", description: "fly to London in 5 seconds" });
  const plainJob = JSON.parse(fs.readFileSync(path.join(pkg, "earth-studio/job.json")));
  assert.ok(!("template" in plainJob), "untemplated job.json must not gain fields");
  // selector request without params: intent + provenance recorded, no native esp
  const out = lane.writeJob(pkg, { jobName: "Tpl", description: "fly to London in 5 seconds", template: "orbit" });
  assert.equal(out.template.template_id, "ges_orbit_derived_v1");
  assert.equal(out.template.template_profile_version, "ges-native-derived-v1");
  assert.equal(out.template.gate2_spec_sha256, native.GATE2_SPEC_SHA256);
  assert.equal(out.template.native_esp, null);
  assert.match(out.template.note, /never invented/);
  const job = JSON.parse(fs.readFileSync(path.join(pkg, "earth-studio/job.json")));
  assert.equal(job.template.requested_via, "selector");
  // description intent alone also records provenance
  const out2 = lane.writeJob(pkg, { jobName: "Tpl2", description: "template: spiral over the Eiffel Tower" });
  assert.equal(out2.template.template_id, "ges_spiral_derived_v1");
  assert.equal(out2.template.requested_via, "description");
  // full params: native .esp is generated beside the generic one
  const out3 = lane.writeJob(pkg, {
    jobName: "TplFull", description: "template: orbit the London Eye", template: "orbit",
    template_params: { target: { lonDeg: -0.119344, latDeg: 51.503077, altitudeM: 34.34 }, radiusM: 624, cameraAltitudeM: 346, durationS: 50 },
  });
  assert.equal(out3.template.native_esp, "earth-studio-native-template.esp");
  const nativeEsp = JSON.parse(fs.readFileSync(path.join(pkg, "earth-studio/earth-studio-native-template.esp")));
  assert.equal(nativeEsp.type, "quickstart");
  assert.equal(nativeEsp.modelVersion, 18);
  assert.ok(fs.existsSync(path.join(pkg, "earth-studio/earth-studio.esp")), "generic .esp still written");
  // bad template / bad params -> 400s
  assert.throws(() => lane.writeJob(pkg, { jobName: "X", description: "fly to London in 5 seconds", template: "corkscrew" }), /unknown template/);
  assert.throws(() => lane.writeJob(pkg, { jobName: "X", description: "d", template: "orbit", template_params: { radiusM: 624 } }), /required explicit input/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("gate3E matrix: regenerated reconstruction matrix matches the frozen verdicts", () => {
  const frozen = JSON.parse(fs.readFileSync(path.join(G3_EVIDENCE, "comparison/reconstruction-matrix.json")));
  assert.equal(frozen.gate2_spec_sha256, native.GATE2_SPEC_SHA256);
  assert.equal(frozen.rows.length, 15);
  assert.ok(frozen.rows.every((r) => /RECONSTRUCTED_EXACT|RECONSTRUCTED_WITH_INERT_VARIANCE|SEMANTIC_MATCH/.test(r.verdict)));
  const matrix = require("../scripts/earth-studio-reconstruction-matrix.js");
  const { compareProjects } = comparator;
  for (const [i, r] of matrix.RECONSTRUCTIONS.entries()) {
    const { project, raw } = r.run();
    const verdict = r.mode === "semantic" ? matrix.semanticVerdict(project, raw).verdict : compareProjects(project, raw).verdict;
    assert.equal(verdict, frozen.rows[i].verdict, `${r.template}/${r.ref}`);
  }
});

test("gate3E negatives: untemplated planner output has no cameraTargetEffect; inspector handles modelVersion 17 and 18", () => {
  // the generic v0.9.4 serializer carries only the empty default
  // cameraTargetEffect scaffold — it must never AUTHOR a target (no
  // keyframes, no POI values, no enabled/influence values) even for orbit
  // descriptions; only explicit native templates author targets
  const esp = planner.buildEsp(planner.buildShotPlan("T", "orbit the Eiffel Tower twice for 10 seconds", "2026-08-08T00:00:00.000Z"));
  const tgt = findNode(esp, "cameraTargetEffect");
  assert.ok(tgt, "default scaffold present (frozen v0.9.4 shape)");
  const subtree = JSON.stringify(tgt);
  assert.equal(subtree.includes("keyframes"), false, "generic target scaffold has no keyframes");
  assert.equal(subtree.includes("relative"), false, "generic target scaffold has no authored values");
  // template builders on modelVersion 18; inspector parses both 17 and 18
  const mv18 = loadEsp("orbit/ref-a/export/VIDTOOLZ-TPL-ORBIT-A.esp");
  const mv17 = JSON.parse(JSON.stringify(mv18));
  mv17.modelVersion = 17;
  const tmp = path.join(os.tmpdir(), `es-mv17-${process.pid}.esp`);
  fs.writeFileSync(tmp, JSON.stringify(mv17));
  const p17 = inspector.parseEsp(tmp);
  fs.unlinkSync(tmp);
  assert.equal(p17.modelVersion, 17);
  assert.equal(p17.shape, "native");
  const p18 = inspector.parseEsp(path.join(EVIDENCE, "orbit/ref-a/export/VIDTOOLZ-TPL-ORBIT-A.esp"));
  assert.deepEqual(p17.tracks, p18.tracks, "mv17/18 parse identically");
});

// ---- Gate 4: human visual acceptance evidence (frozen) ----
const G4_EVIDENCE = path.join(ROOT, "package-runs/2026-08-18-earth-studio-native-template-visual-acceptance");

test("gate4 acceptance: Mikko's six PASS verdicts are recorded, statuses final, and the evidence is hash-frozen", () => {
  const obs = JSON.parse(fs.readFileSync(path.join(G4_EVIDENCE, "operator/visual-observation.json")));
  assert.deepEqual(obs.operator_verdicts_verbatim, [
    "Zoom-To: PASS", "Orbit: PASS", "Point-to-Point: PASS", "Spiral: PASS",
    "Fly-To and Orbit 16:9: PASS", "Fly-To and Orbit 9:16: PASS",
  ]);
  for (const t of Object.values(obs.templates)) assert.equal(t.overall_verdict, "PASS");
  assert.equal(obs.templates["zoom-to"].final_status, "VERIFIED_NATIVE_MATCH");
  assert.match(obs.templates["point-to-point"].final_status, /^VERIFIED_NATIVE_MATCH \(within the documented 2-point/);
  assert.equal(obs.templates["fly-to-and-orbit-916-flagship"].final_status, "FLY_TO_AND_ORBIT_9_16_VISUAL_ACCEPTED");
  // module status map agrees and flows into provenance
  for (const id of Object.keys(native.TEMPLATE_KEYS).map((k) => native.TEMPLATE_KEYS[k])) {
    assert.match(native.VISUAL_STATUS[id], /VERIFIED_NATIVE_MATCH/);
    assert.match(native.IMPORT_STATUS[id], /^IMPORT_VERIFIED/);
  }
  const built = native.buildOrbitProject({
    name: "t", target: { lonDeg: 0, latDeg: 0, altitudeM: 10 }, worldTimeMs: 1786962725077,
  });
  assert.equal(built.provenance.visual_status, "VERIFIED_NATIVE_MATCH");
  // direct-import round-trips remain SEMANTICALLY_STABLE on the frozen files
  for (const [tpl, src, rt] of [
    ["point-to-point", "VIDTOOLZ-G3-RECON-P2P", "roundtrips/point-to-point/VIDTOOLZ-G4-IMPORT-P2P"],
    ["spiral", "VIDTOOLZ-G3-RECON-SPIRAL", "roundtrips/spiral/VIDTOOLZ-G4-IMPORT-SPIRAL"],
    ["fly-to-and-orbit", "VIDTOOLZ-G3-RECON-FLY-ORBIT", "roundtrips/fly-to-and-orbit/VIDTOOLZ-G4-IMPORT-FLY-ORBIT"],
  ]) {
    const a = JSON.parse(fs.readFileSync(path.join(G3_EVIDENCE, "reconstructions", src + ".esp")));
    const b = JSON.parse(fs.readFileSync(path.join(G4_EVIDENCE, rt + ".esp")));
    const rep = comparator.compareProjects(b, a, { valueRelativeAsMeta: true });
    assert.equal(rep.verdict, "RECONSTRUCTED_EXACT", `${tpl} round-trip drifted`);
  }
  // frozen evidence hashes. SHA256SUMS covers the whole Gate 4 root; the raw
  // per-checkpoint viewport captures are local-only evidence (repo policy:
  // bulk screenshots stay untracked, like the Gate 1 corpus) — they are
  // hash-pinned here but tolerated as absent on fresh clones. Everything
  // else (esp/json/md/contact sheets/import proofs) must exist and match.
  const sums = fs.readFileSync(path.join(G4_EVIDENCE, "SHA256SUMS"), "utf8").trim().split("\n");
  assert.ok(sums.length >= 90, `Gate 4 SHA256SUMS entries: ${sums.length}`);
  const localOnly = /(native|recon)[0-9]*-t\d+-f\d+\.png$/;
  let verified = 0;
  for (const line of sums) {
    const [expected, rel] = line.split(/\s+/);
    const abs = path.join(G4_EVIDENCE, rel);
    if (!fs.existsSync(abs)) {
      assert.ok(localOnly.test(rel), `committed Gate 4 evidence missing: ${rel}`);
      continue;
    }
    assert.equal(shaFile(abs), expected, `Gate 4 evidence drifted: ${rel}`);
    verified++;
  }
  assert.ok(verified >= 25, `verified Gate 4 files: ${verified}`);
});

test("gate3 inspector fix: logarithmic-model altitude now decodes to real meters (both models regression)", () => {
  // logarithmic project (zoom-to ref-a): previously decoded to ~32,000 km
  const zoom = inspector.parseEsp(path.join(EVIDENCE, "zoom-to/ref-a/export/VIDTOOLZ-TPL-ZOOM-A.esp"));
  assert.equal(zoom.animation_model.logarithmic, true);
  const alt = zoom.tracks.altitude;
  assert.ok(Math.abs(alt[0].value - 65117481) < 1, `log start ${alt[0].value}`);
  assert.ok(Math.abs(alt[alt.length - 1].value - 1028.3) < 0.5, `log end ${alt[alt.length - 1].value}`);
  assert.ok(Math.abs(zoom.poi.altitude[0].value - 25.5) < 0.5, `log POI alt ${zoom.poi.altitude[0].value}`);
  // linear project (orbit ref-a): decode unchanged by the fix
  const orbit = inspector.parseEsp(path.join(EVIDENCE, "orbit/ref-a/export/VIDTOOLZ-TPL-ORBIT-A.esp"));
  assert.equal(orbit.animation_model.logarithmic, false);
  const expectLinear = 0.000012991803293164142 * 65117981 - 500;
  assert.ok(Math.abs(orbit.tracks.altitude[0].value - expectLinear) < 1e-6, `linear alt ${orbit.tracks.altitude[0].value}`);
  // import shape (VIDTOOLZ planner output): no logarithmic flag -> unchanged
  const plan = planner.buildShotPlan("T", "fly to Helsinki in 5 seconds", "2026-08-08T00:00:00.000Z");
  const os = require("node:os");
  const tmp = path.join(os.tmpdir(), `es-native-inspect-${process.pid}.esp`);
  fs.writeFileSync(tmp, JSON.stringify(planner.buildEsp(plan)));
  const imported = inspector.parseEsp(tmp);
  fs.unlinkSync(tmp);
  assert.equal(imported.shape, "import");
  assert.ok(imported.tracks.altitude.every((k) => Number.isFinite(k.value)));
});
