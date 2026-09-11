'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const Module = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const planner = require('../earth-studio-job-planner');
const trajectory = require('../earth-studio-camera-trajectory');
const quality = require('../earth-studio-camera-quality');
const { audit, body } = require('../scripts/earth-studio-m1-seam-audit');
const cases = [];
const test = (name, fn) => cases.push({ name: `M1 seam: ${name}`, fn });
const fixture = () => planner.buildShotPlan('m1-seam',
  'orbit Helsinki once clockwise at 6500m tilted 60 degrees for 20 seconds then fly to Stockholm at 12000m for 8 seconds then orbit Stockholm once clockwise at 6500m tilted 60 degrees for 20 seconds then fly to Oslo at 12000m for 8 seconds then hover over Oslo for 3 seconds',
  '2026-09-08T00:00:00.000Z', { motionPolicy: { coherent_trajectory: true, dedupe_keyframes: true } });
function baseline() {
  const filename = path.join(ROOT, 'm1-baseline-in-memory.cjs');
  const m = new Module(filename); m.filename = filename; m.paths = module.paths;
  m._compile(cp.execFileSync('git', ['show', 'f30e4543b0af17d047f803ae9044aef859ef13bc:earth-studio-job-planner.js'], { cwd: ROOT, encoding: 'utf8' }), filename);
  return m.exports;
}
function instrumentedBrowser() {
  const probe = { walks: 0, compiles: 0, policies: 0, helpers: [], serialized: [] };
  const ctx = vm.createContext({ probe });
  for (const file of ['earth-studio-camera-trajectory.js', 'earth-studio-serializer.js']) {
    let src = fs.readFileSync(path.join(ROOT,file),'utf8');
    if (file.includes('trajectory')) src = src.replace('function buildEspKeyframes(plan, options, policy) {', 'function buildEspKeyframes(plan, options, policy) { probe.walks++;');
    vm.runInContext(src,ctx,{filename:file});
  }
  const t = ctx.EarthStudioCameraTrajectory;
  for (const key of ['motionPolicy','exportLongitudeTrack','dropRedundantKeyframes']) {
    const original = t[key]; t[key] = (...args) => {
      if (key === 'motionPolicy') probe.policies++; else probe.helpers.push(key);
      return original(...args);
    };
  }
  const createCompiler = t.createCompiler;
  t.createCompiler = (...args) => {
    const compiler = createCompiler(...args), compile = compiler.compileTrajectory;
    compiler.compileTrajectory = (...inputs) => { probe.compiles++; const result = compile(...inputs); probe.trajectory = result; return result; };
    return compiler;
  };
  const sm = ctx.EarthStudioSerializer, createSerializer = sm.createSerializer;
  sm.createSerializer = (...args) => {
    const serializer = createSerializer(...args), serialize = serializer.buildEspFromTrajectory;
    serializer.buildEspFromTrajectory = (t,c) => { probe.serialized.push(t); probe.policy = t.motion_policy; return serialize(t,c); };
    return serializer;
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT,'earth-studio-job-planner.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'earth-studio-terrain-morphology.js'),'utf8'),ctx);
  return { planner: ctx.EarthStudioJobPlanner, probe };
}
const json = x => JSON.parse(JSON.stringify(x));

test('one compile, one walk, one resolved policy; shared serializer/QC authority', () => {
  const { planner: p, probe } = instrumentedBrowser();
  const context = p.buildArtifactContextFromPlan(fixture());
  assert.equal(probe.compiles,1); assert.equal(probe.walks,1); assert.equal(probe.policies,1);
  assert.equal(context.trajectory,probe.trajectory); assert.equal(probe.serialized[0],context.trajectory);
  assert.equal(probe.policy,context.trajectory.motion_policy);
  assert.deepEqual(probe.helpers,['exportLongitudeTrack', ...Array(5).fill('dropRedundantKeyframes')]);
  const serialize = planner.buildEspFromTrajectory;
  let seen;
  planner.buildEspFromTrajectory = (t,c) => { seen=t; return serialize(t,c); };
  try { assert.deepEqual(quality.evaluateTrajectory(context),quality.evaluate({plan:context.plan,esp:json(context.esp)})); }
  finally { planner.buildEspFromTrajectory=serialize; }
  assert.equal(seen,context.trajectory);
  assert.equal(probe.compiles,1); assert.equal(probe.walks,1); assert.equal(probe.policies,1);
});

test('serializer is independent of plan, consumes marker boundaries and policy', () => {
  const p = fixture(); const context=planner.buildArtifactContextFromPlan(p);
  const expected=JSON.stringify(context.esp);
  Object.defineProperty(p,'segments',{get(){throw Error('forbidden upstream segment read');}});
  assert.equal(JSON.stringify(planner.buildEspFromTrajectory(context.trajectory,context.serializerConfig)),expected);
  const a=audit().after;
  assert.equal(a.serializer_plan_reads,0); assert.equal(a.serializer_policy_evaluations,0);
  assert.equal(a.serializer_keyframe_walks,0); assert.equal(a.compiler_keyframe_walks,1);
  assert.equal(a.compiler_policy_evaluations,1); assert.equal(a.artifact_compile_calls,1);
  assert.equal(a.empty_marker_fallbacks,0);
  assert.equal(a.serializer_consumes_markers,true); assert.equal(a.serializer_consumes_resolved_policy,true);
  assert.deepEqual(a.algorithm_bodies,{motionPolicy:1,exportLongitudeTrack:1,dropRedundantKeyframes:1});
});

for (const [name, patch, expected] of [
  ['unresolved segment',{location:null},false], ['zero-duration segment',{duration_seconds:0},false],
  ['orbit-entry-ending segment',{ends_at_orbit_entry:true},false],
  ['qualifying fly_to segment',{action:'fly_to'},true], ['qualifying zoom_in segment',{action:'zoom_in'},true],
  ['qualifying zoom_out segment',{action:'zoom_out'},true], ['nonqualifying orbit',{action:'orbit'},false],
]) test(`marker predicate: ${name}`, () => {
  const base={segment_id:'a',location:{latitude:1,longitude:1},duration_seconds:2,action:'fly_to',end_frame:61};
  const plan={total_frames:100,segments:[{...base,...patch},{...base,segment_id:'last',end_frame:99}]};
  assert.deepEqual(trajectory.computeTrajectoryMarkers(plan),expected ? [{kind:'segment-arrival',segment_id:'a',frame:61}] : []);
});
test('final segment exclusion, original order, unrounded marker frames and legacy fraction guard', () => {
  const sg={location:{},duration_seconds:1,action:'fly_to'};
  const p={total_frames:0,segments:[{...sg,segment_id:'b',end_frame:1.25},{...sg,segment_id:'a',end_frame:-2},{...sg,segment_id:'last',end_frame:90}]};
  const markers=trajectory.computeTrajectoryMarkers(p);
  assert.deepEqual(markers,[{kind:'segment-arrival',segment_id:'b',frame:1.25},{kind:'segment-arrival',segment_id:'a',frame:-2}]);
  const frac=f=>Math.min(1,Math.max(0,f/Math.max(1,p.total_frames||1)));
  assert.deepEqual(markers.map(m=>frac(m.frame)),[1,0]);
});

test('canonical helpers retain exact legacy algorithm bodies and public aliases', () => {
  const old=cp.execFileSync('git',['show','f30e454:earth-studio-job-planner.js'],{cwd:ROOT,encoding:'utf8'});
  const now=fs.readFileSync(path.join(ROOT,'earth-studio-camera-trajectory.js'),'utf8');
  for(const name of ['motionPolicy','exportLongitudeTrack','dropRedundantKeyframes']) {
    assert.equal(body(now,name).replace('exportLongitudeTrack(track, espKeyframe, round6)','exportLongitudeTrack(track)'),body(old,name));
  }
  assert.equal(planner.motionPolicy,trajectory.motionPolicy);
  assert.equal(planner.dropRedundantKeyframes,trajectory.dropRedundantKeyframes);
});

test('199 natural plans: exact artifacts, all legacy keys, terminal output and side channels', () => {
  const old=baseline();
  const paths=cp.execFileSync('git',['ls-tree','-r','--name-only','f30e454','--','package-runs'],{cwd:ROOT,encoding:'utf8'}).split('\n').filter(f=>f.endsWith('/shot-plan.json'));
  assert.equal(paths.length,199);
  for(const file of paths) {
    const plan=JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
    assert.deepEqual(planner.buildArtifactsFromPlan(structuredClone(plan)),old.buildArtifactsFromPlan(structuredClone(plan)),file);
    for(const initialCamera of [undefined,plan.initial_camera]) {
      const a={captureState:{sentinel:true},orbitTiming:[],orbitBearing:[],initialCamera}, b=structuredClone(a);
      assert.deepEqual(planner.buildEspKeyframes(plan,b),old.buildEspKeyframes(plan,a),file);
      assert.deepEqual(b,a,file);
      // MA-001 intentionally corrects the previously frozen no-seed terminal
      // query. Keep the old planner and all plans unchanged; give the old
      // planner this plan's seed explicitly to observe the intended behavior.
      const oldFinalOptions = initialCamera === undefined && plan.initial_camera
        ? { ...a, initialCamera: plan.initial_camera } : a;
      assert.deepEqual(planner.finalCameraState(plan,b),old.finalCameraState(plan,oldFinalOptions),file);
    }
    const context=planner.buildArtifactContextFromPlan(structuredClone(plan));
    assert.deepEqual(quality.evaluateTrajectory(context),quality.evaluate({plan:context.plan,esp:old.buildEsp(plan)}),file);
  }
});

test('shape, pure compilation, full capture including seeded facing; empty route compatibility', () => {
  const old=baseline();
  for(const p of [fixture(),{...fixture(),segments:[]}]) {
    for(const seed of [undefined,{latitude:60,longitude:190,altitude_m:10000,pan_deg:20,tilt_deg:35}]) {
      const a={captureState:{existing:true},orbitTiming:['sentinel'],orbitBearing:['sentinel'],initialCamera:seed}; const b=structuredClone(a);
      const before=JSON.stringify(p),t=planner.compileTrajectory(p,b),keys=old.buildEspKeyframes(p,a);
      assert.equal(JSON.stringify(p),before);assert.deepEqual(trajectory.legacyTracksFromTrajectory(t),keys);assert.deepEqual(b,a);
      assert.deepEqual(Object.keys(t),['schema','frame_rate','total_frames','keyed','terminal_camera','markers','motion_policy']);
      assert.equal(t.schema,'vidtoolz.camera.trajectory.v1');assert.equal(t.total_frames,p.total_frames);assert.equal(t.frame_rate,p.frame_rate);
      for(const keys of Object.values(t.keyed)) for(const key of keys) {
        if(key.aimAt) assert.deepEqual(Object.keys(key.aimAt),['lat','lng']);
      }
      if(t.terminal_camera) assert.deepEqual(Object.keys(t.terminal_camera),['lat','lng','alt','pan','tilt']);
      for(const m of t.markers) assert.deepEqual(Object.keys(m),['kind','segment_id','frame']);
      assert.deepEqual(planner.finalCameraStateFromTrajectory(t),old.finalCameraState(p,{initialCamera:seed}));
    }
  }
});

test('artifact wrapper preserves its legacy capture/timing/bearing forwarding and annotations', () => {
  const old=baseline(),a=fixture(),b=structuredClone(a);
  const ao={captureState:{sentinel:true},orbitTiming:['caller'],orbitBearing:['caller']},bo=structuredClone(ao);
  assert.deepEqual(planner.buildArtifactsFromPlan(b,bo),old.buildArtifactsFromPlan(a,ao));
  assert.deepEqual(bo,ao);assert.deepEqual(b,a);
  assert.deepEqual(bo.captureState,{sentinel:true});
  assert.deepEqual(bo.orbitTiming,['caller']);
  assert.ok(bo.orbitBearing.length>1);
});

test('playback projection preserves normalized handles, inverse round trip and trace exactly', () => {
  const context=planner.buildArtifactContextFromPlan(fixture());
  const mc=require('../earth-studio-motion-continuity');
  assert.deepEqual(quality.predictPlayback(context.trajectory,{serializerConfig:context.serializerConfig}),
    mc.playbackPositionTrace(mc.extractEspCameraTracks(context.esp),context.plan.total_frames,context.plan.frame_rate));
});

test('duplicate final IDs are excluded and clamped markers actually control easing', () => {
  const old=baseline(),base=fixture();
  const qualifying=base.segments.find(s=>s.location && ['fly_to','zoom_in','zoom_out'].includes(s.action) && !s.ends_at_orbit_entry);
  assert.ok(qualifying);
  for(const end of [-20,0,base.total_frames,base.total_frames+90]) {
    const plan=structuredClone(base);
    plan.segments.find(s=>s.segment_id===qualifying.segment_id).end_frame=end;
    assert.deepEqual(planner.buildEsp(plan),old.buildEsp(plan));
  }
  const plan=structuredClone(base),last=plan.segments.filter(s=>s.location&&s.duration_seconds>0).at(-1);
  plan.segments.find(s=>s.segment_id===qualifying.segment_id).segment_id=last.segment_id;
  assert.deepEqual(planner.buildEsp(plan),old.buildEsp(plan));
  assert.ok(!planner.compileTrajectory(plan).markers.some(m=>m.segment_id===last.segment_id));
});

test('browser entry dependency order, equivalent semantics, visible missing-dependency failure', () => {
  const html=fs.readFileSync(path.join(ROOT,'project-earth-studio.html'),'utf8');
  for(const file of ['earth-studio-camera-trajectory.js','earth-studio-serializer.js']) assert.ok(html.indexOf(`src="${file}"`) < html.indexOf('src="earth-studio-job-planner.js"'));
  const {planner:p}=instrumentedBrowser(),plan=fixture();
  assert.ok(planner.compileTrajectory(plan).markers.length > 0);
  assert.deepEqual(json(p.compileTrajectory(plan)),json(planner.compileTrajectory(plan)));
  assert.deepEqual(json(p.buildArtifactsFromPlan(structuredClone(plan))),planner.buildArtifactsFromPlan(structuredClone(plan)));
  assert.throws(()=>vm.runInNewContext(fs.readFileSync(path.join(ROOT,'earth-studio-job-planner.js'),'utf8'),{}),/EarthStudioCameraTrajectory must load/);
});

module.exports={cases,fixture};
if(require.main===module) {
  for(const {name,fn} of cases){fn();console.log(`PASS ${name}`);}
  console.log(`${cases.length}/${cases.length} M1 seam tests PASS`);
}
