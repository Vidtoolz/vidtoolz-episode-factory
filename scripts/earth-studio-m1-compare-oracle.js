#!/usr/bin/env node
'use strict';
// Supplemental comparison; never writes, updates, or relaxes the frozen oracle.
// Usage: node scripts/earth-studio-m1-compare-oracle.js BASELINE_ROOT CANDIDATE_ROOT OUTPUT_DIR
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),os=require('node:os');
const [baselineRoot,candidateRoot,output]=process.argv.slice(2).map(p=>path.resolve(p));
assert.ok(baselineRoot && candidateRoot && output);
const rel='package-runs/2026-09-08-earth-studio-m1-self-baseline';
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const b=path.join(baselineRoot,rel),c=path.join(candidateRoot,rel);
assert.equal(hash(fs.readFileSync(path.join(baselineRoot,'scripts/earth-studio-m1-self-baseline.js'))),hash(fs.readFileSync(path.join(candidateRoot,'scripts/earth-studio-m1-self-baseline.js'))));
const ids=fs.readdirSync(path.join(b,'cases')).sort();
assert.equal(ids.length,199);assert.deepEqual(fs.readdirSync(path.join(c,'cases')).sort(),ids);
const oldPlanner=require(path.join(baselineRoot,'earth-studio-job-planner'));
const planner=require(path.join(candidateRoot,'earth-studio-job-planner'));
const oldQC=require(path.join(baselineRoot,'earth-studio-camera-quality'));
const qc=require(path.join(candidateRoot,'earth-studio-camera-quality'));
const oldLane=require(path.join(baselineRoot,'earth-studio-lane'));
const lane=require(path.join(candidateRoot,'earth-studio-lane'));
const rows=[];
fs.mkdirSync(output,{recursive:true});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'m1-lane-equivalence-'));
let laneCases=0,hashes=0;
try {
  for(const id of ids) {
    const a=json(path.join(b,'cases',id,'record.json')), z=json(path.join(c,'cases',id,'record.json'));
    assert.equal(a.exception,null,id);assert.deepEqual(z,a,id); // ALL fields, including all captured out-channels and round trips.
    hashes+=Object.keys(a.baseline_artifact_hashes).length;
    const source=a.source_shot_plan.path,plan=json(path.join(baselineRoot,source));
    const oldPlan=structuredClone(plan),oldEsp=JSON.parse(oldPlanner.buildArtifactsFromPlan(oldPlan)['earth-studio.esp']);
    const context=planner.buildArtifactContextFromPlan(structuredClone(plan));
    const before=oldQC.evaluate({plan:oldPlan,esp:oldEsp}),after=qc.evaluateTrajectory(context);
    assert.deepEqual(after,before,id);
    fs.mkdirSync(path.join(output,'qc',id),{recursive:true});
    fs.writeFileSync(path.join(output,'qc',id,'baseline.json'),JSON.stringify(before,null,2)+'\n');
    fs.writeFileSync(path.join(output,'qc',id,'candidate.json'),JSON.stringify(after,null,2)+'\n');
    // Additional actual lane replay from recorded entry inputs (not a claim
    // that description reparsing reproduces every hand-authored shot-plan).
    const inputDir=path.dirname(path.join(baselineRoot,source));
    const payload={jobName:plan.job_name,description:plan.source_description,aspect:plan.aspect};
    for(const name of ['journey','direction']) {
      const file=path.join(inputDir,name+'.json');if(fs.existsSync(file))payload[name]=json(file);
    }
    if(plan.initial_camera && !payload.journey)payload.openingCamera=plan.initial_camera;
    const pkg=path.join(scratch,id);
    const call=fn=>{try{return {result:fn(pkg,structuredClone(payload),{now:plan.generated_at})};}catch(e){return {error:{message:e.message,code:e.code,statusCode:e.statusCode}};}};
    const lr0=call(oldLane.writeJob);
    const files=fs.existsSync(path.join(pkg,'earth-studio')) ? fs.readdirSync(path.join(pkg,'earth-studio')).filter(f=>fs.statSync(path.join(pkg,'earth-studio',f)).isFile()).sort() : [];
    const originals=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(pkg,'earth-studio',f),'utf8')]));
    const lr1=call(lane.writeJob);
    assert.deepEqual(lr1,lr0,`${id}: lane response`);
    const filesAfter=fs.existsSync(path.join(pkg,'earth-studio')) ? fs.readdirSync(path.join(pkg,'earth-studio')).filter(f=>fs.statSync(path.join(pkg,'earth-studio',f)).isFile()).sort() : [];
    assert.deepEqual(filesAfter,files,id);
    for(const f of files)assert.equal(fs.readFileSync(path.join(pkg,'earth-studio',f),'utf8'),originals[f],`${id}: lane ${f}`);
    if(!lr0.error)laneCases++;
    rows.push({case_id:id,artifact_hash_count:Object.keys(a.baseline_artifact_hashes).length,qc_sha256:hash(JSON.stringify(before,null,2)+'\n'),lane_replay:lr0.error?'identical input rejection':'exact files and response'});
  }
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
assert.deepEqual(json(path.join(c,'fixtures/fixtures.json')),json(path.join(b,'fixtures/fixtures.json')));
const report={verdict:'PASS',oracle_version:'1.1.0',natural_cases:ids.length,replay_failures:0,artifact_hashes_compared:hashes,artifact_difference_count:0,full_qc_reports_compared:ids.length,qc_difference_count:0,side_channel_difference_count:0,synthetic_fixtures:'all exact',lane_replays:laneCases,lane_identical_rejections:ids.length-laneCases,lane_difference_count:0,exceptions_added:0,repins:0,epsilon:0,cases:rows};
fs.writeFileSync(path.join(output,'oracle-comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cases:undefined},null,2));
