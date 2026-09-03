// Antimeridian continuous-longitude authority (2026-09-03).
//
// Motion longitude is CONTINUOUS; wrapped ±180 longitude is a serialization
// representation. Before this repair every geographic constructor (offsetPoint)
// handed a WRAPPED longitude back to the UNWRAPPED camera state machine, so a
// fly→orbit ring entry across the seam lapped the globe 350° the wrong way in
// the last 20% of the move, a ring straddling ±180° lapped twice per orbit, and
// a seeded continuation lapped 359.9° during acquisition — while every FINAL
// camera state stayed numerically correct. These tests therefore judge the whole
// rendered interval with Earth-Studio-style scalar playback, not endpoints.
//
// A legal serialization seam is a ONE-FRAME pair of keys at exactly ±180 (the
// same physical meridian, nothing rendered between them). Any other interval
// that changes longitude by more than 180° is a wrong-way lap.
const { assert, test } = require("./_helpers.js");
const planner = require("../earth-studio-job-planner.js");

const POLICY = { coherent_trajectory: true, dedupe_keyframes: true, source: "journey" };
const buildLng = (description, extra = {}) => {
  const options = { aspect: "16:9", motionPolicy: POLICY, ...extra };
  const plan = planner.buildShotPlan("seam", description, "2026-09-03T00:00:00.000Z", options);
  const tracks = planner.buildEspKeyframes(plan, options);
  return { plan, tracks, options, lng: tracks.lng, pan: tracks.pan, final: planner.finalCameraState(plan, options) };
};

// The .esp longitude track is CONTINUOUS (2026-09-03 physical-equivalence
// contract): it may run past ±180°, and a seam crossing is simply the track
// passing an odd multiple of 180° between two authored keys. Scalar playback
// accounting: every consecutive step must stay below 180° (no wrong-way lap) and
// no key may be a serializer-pinned exact ±180.
function playback(lng) {
  let total = 0; let wrongWay = 0; let maxStep = 0; let seams = 0;
  const laps = [];
  for (let i = 1; i < lng.length; i += 1) {
    const a = lng[i - 1]; const b = lng[i];
    if (a.time === b.time) continue;
    const d = b.value - a.value;
    total += Math.abs(d);
    maxStep = Math.max(maxStep, Math.abs(d));
    if (Math.abs(d) > 180) { wrongWay += Math.abs(d); laps.push(`${a.time}:${a.value}→${b.time}:${b.value}`); }
    // crossings of the seam meridian (odd multiples of 180°) inside this step
    const lo = Math.min(a.value, b.value); const hi = Math.max(a.value, b.value);
    for (let s = 180 + Math.ceil((lo - 180) / 360) * 360; s <= hi; s += 360) if (s > lo && s <= hi) seams += 1;
  }
  return { total, wrongWay, maxStep, seams, laps };
}

function assertContinuous(label, lng, maxTotalDeg) {
  const p = playback(lng);
  assert.ok(lng.every((k) => Number.isFinite(k.value)), `${label}: finite longitude`);
  assert.equal(p.wrongWay, 0, `${label}: wrong-way laps ${p.laps.join(" | ")}`);
  assert.ok(p.total <= maxTotalDeg, `${label}: ${p.total.toFixed(3)}° of longitude playback exceeds ${maxTotalDeg}°`);
  return p;
}

const panSweep = (pan) => pan[pan.length - 1].value - pan[0].value;

test("continuousLng: nearest representative, bit-exact when already nearest, ties eastward", () => {
  assert.equal(planner.continuousLng(179.99, -179.99), 180.01);
  assert.equal(planner.continuousLng(-179.99, 179.99), -180.01);
  assert.equal(planner.continuousLng(190, -170.06), 189.94);
  assert.equal(planner.continuousLng(-190, 170.06), -189.94);
  assert.equal(planner.continuousLng(24.9384, 24.6559), 24.6559); // identity, not 24.9384 + delta
  assert.equal(planner.continuousLng(500, 170), 530);
  assert.equal(planner.continuousLng(0, 180), 180);
  assert.equal(planner.continuousLng(0, -180), 180); // tie → eastward, like shortestLngDelta
  assert.equal(planner.continuousLng(10, 10), 10);
});

test("seam travel: eastbound and westbound flights stay the short arc (regression guard)", () => {
  for (const [label, desc, arc] of [
    ["179→-179", "hover over 45, 179 for 1 seconds then fly to 45, -179 for 10 seconds", 2],
    ["179.9→-179.9", "hover over 45, 179.9 for 1 seconds then fly to 45, -179.9 for 10 seconds", 0.2],
    ["-179.9→179.9", "hover over 45, -179.9 for 1 seconds then fly to 45, 179.9 for 10 seconds", 0.2],
    ["179.999999→-179.999999", "hover over 45, 179.999999 for 1 seconds then fly to 45, -179.999999 for 5 seconds", 0.00001],
  ]) {
    const p = assertContinuous(label, buildLng(desc).lng, arc + 1e-6);
    assert.equal(p.seams, 1, `${label}: exactly one seam pair`);
  }
});

test("fly → orbit across the seam approaches the ring locally instead of lapping the globe (both directions, with and without a zoom)", () => {
  const cases = [
    ["fly→orbit E", "hover over 45, 170 for 2 seconds then fly to 45, -170 for 10 seconds then orbit 45, -170 once clockwise tilted 60 degrees for 20 seconds"],
    ["fly→zoom→orbit E", "hover over 45, 170 for 2 seconds then fly to 45, -170 for 10 seconds then zoom in on 45, -170 tilted 60 degrees for 3 seconds then orbit 45, -170 once clockwise tilted 60 degrees for 20 seconds"],
    ["fly→zoom→orbit W", "hover over 45, -170 for 2 seconds then fly to 45, 170 for 10 seconds then zoom in on 45, 170 tilted 60 degrees for 3 seconds then orbit 45, 170 once clockwise tilted 60 degrees for 20 seconds"],
    ["travel→hold→orbit", "hover over 45, 170 for 2 seconds then fly to 45, -170 for 10 seconds then hover over 45, -170 for 2 seconds then orbit 45, -170 once clockwise tilted 60 degrees for 20 seconds"],
  ];
  for (const [label, desc] of cases) {
    const r = buildLng(desc);
    // 20° of travel plus the ring's own ≤0.3° of longitude breathing.
    const p = assertContinuous(label, r.lng, 20.5);
    assert.equal(p.seams, 1, `${label}: one seam pair`);
    // One continuous flight: the largest interval is the 20° leg up to the 80 % approach shaping point.
    assert.ok(p.maxStep <= 20.1, `${label}: largest interval ${p.maxStep}° (approach shaping point preserved at 80%)`);
    assert.equal(Math.round(panSweep(r.pan)), 360, `${label}: the orbit's intentional 360° sweep is unchanged`);
    // The approach shaping point still exists: a fly annotated to land on the
    // ring entry emits its 80% key (production staging semantics preserved).
    const fly = r.plan.segments.find((s) => s.action === "fly_to" && s.ends_at_orbit_entry);
    if (fly) {
      const approachFrame = fly.start_frame + Math.round((fly.end_frame - fly.start_frame) * 0.8);
      assert.ok(r.lng.some((k) => k.time === approachFrame), `${label}: approach point key at frame ${approachFrame}`);
    }
    // Final state is the orbit's exit on the ring, wrapped into the contract.
    assert.ok(Math.abs(r.final.longitude) <= 180 && Math.abs(Math.abs(r.final.longitude) - 170) < 0.3, `${label}: final longitude ${r.final.longitude}`);
  }
});

test("orbit ring straddling ±180°: continuous ring, seam pairs only, intentional sweep and direction preserved", () => {
  const cases = [
    ["cw @179.99", "orbit 45, 179.99 once clockwise tilted 60 degrees for 20 seconds", 360],
    ["cw @-179.99", "orbit 45, -179.99 once clockwise tilted 60 degrees for 20 seconds", 360],
    ["ccw @179.95", "orbit 45, 179.95 once counterclockwise tilted 60 degrees for 20 seconds", -360],
    ["half @179.99", "orbit 45, 179.99 half clockwise tilted 60 degrees for 10 seconds", 180],
    ["tiny ring @179.999", "orbit 45, 179.999 once clockwise at 500 meters tilted 30 degrees for 8 seconds", 360],
    ["huge ring @179.5", "orbit 45, 179.5 once clockwise at 300 km tilted 60 degrees for 30 seconds", 360],
    ["exactly 180", "orbit 45, 180 once clockwise tilted 60 degrees for 20 seconds", 360],
    ["exactly -180", "orbit 45, -180 once clockwise tilted 60 degrees for 20 seconds", 360],
  ];
  for (const [label, desc, sweep] of cases) {
    const r = buildLng(desc);
    // A ring's longitude extent is tiny (≤ ~4° for the 300 km ring); the whole
    // orbit must play as that, not as two laps of the globe.
    const p = assertContinuous(label, r.lng, 5);
    assert.ok(p.seams >= 1, `${label}: the ring crosses the seam, so at least one seam pair`);
    assert.ok(p.maxStep < 1, `${label}: consecutive ring keys ${p.maxStep}° apart`);
    assert.equal(Math.round(panSweep(r.pan)), sweep, `${label}: pan sweep ${panSweep(r.pan)} (direction and revolutions are authoritative)`);
    assert.ok(Math.abs(r.final.longitude) <= 180, `${label}: final longitude in contract`);
  }
});

test("intentional multi-revolution orbit (twice) keeps 720° of sweep while longitude never laps", () => {
  const seam = buildLng("orbit 45, 179.99 twice clockwise tilted 60 degrees for 30 seconds");
  const control = buildLng("orbit 45, 10 twice clockwise tilted 60 degrees for 30 seconds");
  assert.equal(Math.round(panSweep(seam.pan)), 720);
  assert.equal(Math.round(panSweep(control.pan)), 720);
  const ps = assertContinuous("twice @179.99", seam.lng, 1);
  const pc = assertContinuous("twice @10", control.lng, 1);
  assert.equal(ps.seams, 4, "two crossings per revolution, two revolutions");
  assert.equal(pc.seams, 0);
  // Same ring, same playback distance: only the representation differs.
  assert.ok(Math.abs(ps.total - pc.total) < 0.01, `seam ${ps.total} vs control ${pc.total}`);
  // Same ring samples at the same frames; the seam track differs only by its
  // ±180 pair keys (a crossing inside the last frame before a ring sample makes
  // that sample the pair's second half, so it is ±180 to sub-frame precision).
  const controlFrames = new Set(control.lng.map((k) => k.time));
  const seamExtra = seam.lng.filter((k) => !controlFrames.has(k.time));
  assert.ok(seamExtra.every((k) => Math.abs(k.value) === 180), "every extra key is a seam pair member");
  control.lng.forEach((k) => assert.ok(seam.lng.some((s) => s.time === k.time), "ring sample frame " + k.time + " present in the seam track"));
});

test("orbit → travel across the seam launches along the short arc", () => {
  const r = buildLng("orbit 45, 179.99 once clockwise tilted 60 degrees for 20 seconds then fly to 45, -170 for 10 seconds");
  const p = assertContinuous("orbit→travel", r.lng, 10.5);
  assert.ok(p.seams >= 1);
  assert.equal(r.final.longitude, -170);
});

test("seeded continuation across the seam: acquisition closes the radius, it does not circle the globe", () => {
  const seed = { latitude: 45.2, longitude: 179.9, altitude_m: 20000, pan_deg: 100, tilt_deg: 60 };
  const r = buildLng("orbit 45, -179.9 once clockwise tilted 60 degrees for 20 seconds", { initialCamera: seed });
  const p = assertContinuous("seeded 179.9 → orbit -179.9", r.lng, 1);
  assert.equal(p.seams, 1);
  assert.equal(r.lng[0].value, 179.9, "the seed's frame 0 is never re-placed");
  // Chain: journey A ends near the seam, journey B continues from A's public final state.
  const a = buildLng("hover over 45, 179 for 1 seconds then fly to 45, 179.95 for 6 seconds");
  const b = buildLng("orbit 45, -179.95 once clockwise tilted 60 degrees for 12 seconds", { initialCamera: a.final });
  assert.equal(a.final.longitude, 179.95);
  assert.equal(b.lng[0].value, a.final.longitude, "B opens exactly on A's final frame");
  assertContinuous("continuation B", b.lng, 1);
});

test("high-latitude and polar rings: seam crossing at 80°N, a pole-enclosing ring accumulates its own longitude and nothing else", () => {
  const high = buildLng("hover over 80, 170 for 2 seconds then fly to 80, -170 for 10 seconds then orbit 80, -170 once clockwise tilted 60 degrees for 20 seconds");
  assertContinuous("80°N fly→orbit", high.lng, 21.5);
  // A ring around a point 1.1 km from the pole encloses the pole: the camera's
  // longitude legitimately runs through all 360° once per revolution, in steps
  // that are never more than a few degrees — never a 351° jump.
  const polar = buildLng("orbit 89.99, 179 once counterclockwise tilted 60 degrees for 20 seconds");
  const p = assertContinuous("polar ring @89.99,179", polar.lng, 361);
  assert.ok(p.total > 359 && p.total < 361, `one physical lap of longitude around the pole, got ${p.total}`);
  assert.ok(p.maxStep < 30, `largest ring step ${p.maxStep}°`);
  // Heading authority (2026-09-03): pan faces the subject. A ring that encloses
  // the pole completes its revolution in POSITION (asserted above); the
  // target-facing pan has no full winding and stays finite and continuous.
  assert.ok(polar.pan.every((k) => Number.isFinite(k.value)));
  assert.ok(Math.abs(panSweep(polar.pan)) < 180, `pole-enclosing ring pan sweep ${panSweep(polar.pan)}`);
  const plain = buildLng("orbit 89.9, 0 once clockwise tilted 60 degrees for 20 seconds");
  assertContinuous("polar ring @89.9,0", plain.lng, 100);
});

test("repeated crossings then an orbit: every crossing is a seam pair, the ring is local", () => {
  const r = buildLng("hover over 45, 179.9 for 1 seconds then fly to 45, -179.9 for 4 seconds then fly to 45, 179.9 for 4 seconds then fly to 45, -179.9 for 4 seconds then orbit 45, -179.9 once clockwise tilted 60 degrees for 12 seconds");
  const p = assertContinuous("repeated crossings", r.lng, 1);
  assert.equal(p.seams, 3);
});

test("Tokyo → Los Angeles → orbit: the Pacific short arc, then a local ring", () => {
  const r = buildLng("hover over Tokyo for 2 seconds then fly to Los Angeles for 20 seconds then orbit Los Angeles once clockwise tilted 60 degrees for 20 seconds");
  const p = assertContinuous("Tokyo→LA→orbit", r.lng, 103);
  assert.equal(p.seams, 1);
  assert.ok(Math.abs(r.final.longitude - -118.2437) < 0.3, `final ${r.final.longitude}`);
});

test("non-seam control is untouched by the authority: no seam keys, ring local, sweep intact", () => {
  const r = buildLng("hover over 45, 10 for 2 seconds then fly to 45, 30 for 10 seconds then zoom in on 45, 30 tilted 60 degrees for 3 seconds then orbit 45, 30 once clockwise tilted 60 degrees for 20 seconds");
  const p = assertContinuous("control", r.lng, 20.5);
  assert.equal(p.seams, 0);
  assert.equal(Math.round(panSweep(r.pan)), 360);
  assert.equal(r.final.longitude, 30);
});

test("continuous track: a ring sample exactly on the ±180 meridian is an ordinary authored key (no serializer pair)", () => {
  const r = buildLng("orbit 45, 180 once clockwise tilted 60 degrees for 20 seconds");
  const p = assertContinuous("exact 180", r.lng, 5);
  assert.ok(p.seams >= 1, "the ring crosses the meridian");
  // Every longitude key is planner-authored: it sits on a latitude key frame.
  const latTimes = new Set(r.tracks.lat.map((k) => k.time));
  r.lng.forEach((k) => assert.ok(latTimes.has(k.time), `longitude key at ${k.time} is authored`));
  // No adjacent-frame ±180 pair exists any more.
  for (let i = 1; i < r.lng.length; i += 1) assert.ok(r.lng[i].time - r.lng[i - 1].time > 1 || Math.abs(r.lng[i].value - r.lng[i - 1].value) < 180);
  assert.equal(r.final.longitude, 180, "finalCameraState reports the meridian canonically as 180");
});
