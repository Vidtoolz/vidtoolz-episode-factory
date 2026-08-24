'use strict';

const { assert, fs, os, path, test, tests } = require('./_helpers.js');
const childProcess = require('node:child_process');
const editor = require('../scripts/editor.js');
const ep = require('../scripts/edit-plan.js');
const vp = require('../scripts/visual-plan.js');
const ptm = require('../scripts/presenter-take-manifest.js');
const aigen = require('../aigen-authority-chain.js');

const NOW = '2026-08-23T18:45:00.000Z';
const H = (value) => ep.sha256(Buffer.isBuffer(value) ? value : String(value));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-v1-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
function ffmpeg(args) { childProcess.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }

const PRESENTER = path.join(TMP, 'presenter.mp4');
const BROLL = path.join(TMP, 'broll.mp4');
const SCREEN = path.join(TMP, 'screen.mp4');
const STILL = path.join(TMP, 'still.png');
const MUSIC = path.join(TMP, 'music.wav');
ffmpeg(['-f','lavfi','-i','color=c=0x222222:s=360x640:r=25:d=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',PRESENTER]);
ffmpeg(['-f','lavfi','-i','color=c=0x555555:s=360x640:r=25:d=4','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',BROLL]);
ffmpeg(['-f','lavfi','-i','testsrc2=s=360x640:r=25:d=4','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',SCREEN]);
ffmpeg(['-f','lavfi','-i','color=c=0x775533:s=360x640','-frames:v','1',STILL]);
ffmpeg(['-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=12','-c:a','pcm_s16le',MUSIC]);

const SECTIONS = [
  { section_id:'sec-speed',order:1,dialogue:'Speed multiplies output. It does nothing for value.',framing_preset:'right-third',type:'presenter',presenter_relation:'PRESENT' },
  { section_id:'sec-value',order:2,dialogue:'Viewers never see your speed. They see the result.',framing_preset:'right-third',type:'presenter',presenter_relation:'PRESENT' },
  { section_id:'sec-proof',order:3,dialogue:'One good stop beat fifty fast renders.',framing_preset:'center-lower',type:'composited',presenter_relation:'PRESENT' },
];
const STORY_HASH = H('Stop Chasing AI Speed Story');
const STORY = { project_id:'stop-chasing-ai-speed',version_id:'story-v1',content_hash:STORY_HASH,approval:{state:'approved',approved_by:'TEST_HUMAN',approved_at:NOW,version_id:'story-v1',content_hash:STORY_HASH},section_ids:SECTIONS.map((s)=>s.section_id),sections:SECTIONS };
const PT_STORY = { project_id:STORY.project_id,version_id:STORY.version_id,content_hash:STORY.content_hash,approval_state:'approved',sections:SECTIONS };
const BEATS = ['visual-beat-01HF7YAT010000000000000001','visual-beat-01HF7YAT020000000000000002','visual-beat-01HF7YAT030000000000000003'];
const SHOTS = ['shot-01HF7YAT040000000000000004','shot-01HF7YAT050000000000000005','shot-01HF7YAT060000000000000006'];
const PROMPTS = ['prompt-01HF7YAT070000000000000007','prompt-01HF7YAT080000000000000008'];
let counter = 100;
function uid() { counter += 1; return String(counter).padStart(26, '0'); }
function idFactory(prefix) { return `${prefix}-${uid()}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fileHash(file) { return H(fs.readFileSync(file)); }
function range(inFrame,outFrame) { return { in_frame:inFrame,out_frame:outFrame }; }
function refs(section,beat=null,shot=null,unit=null) { return { section_id:section,beat_id:beat,shot_id:shot,recording_unit_id:unit }; }
function coverage(ref_id,state='COVERED') { return { ref_id,state,reason:null,exception_id:null }; }
function authority(type,id) { return { authority_type:type,authority_id:id,authority_digest_sha256:H(id),scope:'editor-source' }; }
function media(file,kind) { return { path_or_artifact_ref:file,expected_sha256:fileHash(file),kind }; }

function makeVisualPlan() {
  const visualStory=clone(STORY); delete visualStory.sections;
  const beats = SECTIONS.map((s,index)=>({ canonical_beat_id:BEATS[index],section_id:s.section_id,aliases:[],source_provenance:null }));
  const definitions = [
    ['GENERATED_VIDEO','DIRECT_VIDEO','BROLL_OVERLAY','conveyor','generated_video'],
    ['GENERATED_STILL','STILL','BROLL_OVERLAY','hourglass','generated_still'],
    ['SCREEN_CAPTURE','NOT_APPLICABLE','PICTURE_IN_PICTURE','authentic Script Builder proof','screen_capture'],
  ];
  const shots = definitions.map((d,index)=>({
    shot_id:SHOTS[index],section_ref:{section_id:SECTIONS[index].section_id},beat_ref:beats[index],narrative_function:'support canonical Story',subject:d[3],media_type:d[0],generation_mode:d[1],shot_brief:`shot ${index+1}`,visual_assertion:null,presenter_relation:d[2],research_sensitive:false,research_refs:[],camera_intent:null,
    generation_requirements:{artifact_class:d[4],aspect_target:'9:16',duration_target_s:4,input_artifact_refs:[],quality_constraints:['truthful provenance'],candidate_count_request:1,generation_mode:d[1]},continuity_notes:[],edit_placement:`section ${index+1}`,priority:'HIGH',status:index<2?'PROMPT_READY':'PLANNED',prompt_refs:index<2?[PROMPTS[index]]:[],
  }));
  const plan = { schema_version:1,artifact_type:'visual-plan',plan_id:'visual-plan-01HF7YAT000000000000000000',plan_revision:1,supersedes:null,created_at:NOW,created_by:'TEST_WRITER',lifecycle_state:'AWAITING_HUMAN_REVIEW',story:visualStory,required_beats:beats,coverage:shots.map((s,i)=>({beat_ref:beats[i],decision:'PLAN_SHOTS',shot_ids:[s.shot_id],reason:null})),shots,prompts:[],plan_digest_sha256:'' };
  plan.prompts = shots.slice(0,2).map((shot,index)=>({prompt_id:PROMPTS[index],prompt_revision:1,shot_id:shot.shot_id,shot_intent_digest_sha256:vp.shotIntentDigest(shot),prompt_text:`bounded prompt ${index}`,prompt_type:index?'PRESENTER_AWARE':'VIDEO',created_by:'test',origin:'test',legacy_aliases:[]}));
  plan.plan_digest_sha256 = vp.planDigest(plan);
  return plan;
}

function ptProbe(input) { const bytes=fs.readFileSync(input.path_or_artifact_ref); return {ok:true,available:true,actual_sha256:H(bytes),byte_size:bytes.length,duration_s:4,has_video:true,has_audio:true}; }
function makePresenter() {
  let base = ptm.createManifest(PT_STORY,{manifestId:uid(),newUnitId:()=>`recording-unit-${uid()}`,now:NOW});
  const selected=[]; let recommendation=null;
  for (const [index,unit] of base.recording_units.entries()) {
    if (index===0) {
      recommendation=`take-${uid()}`;
      base=ptm.registerTake(base,{recording_unit_id:unit.recording_unit_id,take_id:recommendation,media:{path_or_artifact_ref:PRESENTER,sha256:fileHash(PRESENTER),byte_size:fs.statSync(PRESENTER).size,duration_s:4,media_type:'video/mp4',requires_audio:true},captured_at:NOW,pickup_of_take_id:null},{mediaProbe:ptProbe,manifestId:uid(),now:NOW});
      base=ptm.bindTranscript(base,recommendation,{text:unit.approved_dialogue,source:'HUMAN_SUPPLIED',created_at:NOW},{manifestId:uid(),now:NOW});
      base=ptm.createFidelityRecord(base,recommendation,{}, {manifestId:uid(),now:NOW});
    }
    const take=`take-${uid()}`; selected.push(take);
    base=ptm.registerTake(base,{recording_unit_id:unit.recording_unit_id,take_id:take,media:{path_or_artifact_ref:PRESENTER,sha256:fileHash(PRESENTER),byte_size:fs.statSync(PRESENTER).size,duration_s:4,media_type:'video/mp4',requires_audio:true},captured_at:NOW,pickup_of_take_id:null},{mediaProbe:ptProbe,manifestId:uid(),now:NOW});
    base=ptm.bindTranscript(base,take,{text:unit.approved_dialogue,source:'HUMAN_SUPPLIED',created_at:NOW},{manifestId:uid(),now:NOW});
    base=ptm.createFidelityRecord(base,take,{}, {manifestId:uid(),now:NOW});
  }
  base.recommendations=[{recording_unit_id:base.recording_units[0].recording_unit_id,take_id:recommendation,rank:1,reason:'advisory',created_by:'presenter_director',created_at:NOW}];
  base.manifest_digest_sha256=ptm.manifestDigest(base);
  const manifests=selected.map((take)=>ptm.createHumanSelection(base,{take_id:take,selector:{type:'HUMAN',id:'TEST_HUMAN'},selected_at:NOW,scope:'editor-take-selection'},{manifestId:uid(),now:NOW,allowedHumanIds:['TEST_HUMAN']}));
  return {base,manifests,selected,recommendation};
}

function visualSources() { return [
  {visual_source_id:'asset-conveyor',shot_id:SHOTS[0],media_mode:'GENERATED_VIDEO',presenter_relation:'BROLL_OVERLAY',provenance_class:'GENERATED_VIDEO',media:media(BROLL,'VIDEO'),selection_authority:authority('AIGEN_SELECTED_ASSET','conveyor-selection'),generation_provenance:{generator:'generation-supervisor',job_id:'job-conveyor',artifact_id:'asset-conveyor',source_shot_id:SHOTS[0],generation_mode:'DIRECT_VIDEO'},technical_eligibility:{evidence_id:'elig-conveyor',evidence_digest_sha256:H('elig-conveyor'),state:'ELIGIBLE'}},
  {visual_source_id:'asset-hourglass',shot_id:SHOTS[1],media_mode:'GENERATED_STILL',presenter_relation:'BROLL_OVERLAY',provenance_class:'GENERATED_IMAGE',media:media(STILL,'IMAGE'),selection_authority:authority('AIGEN_SELECTED_ASSET','hourglass-selection'),generation_provenance:{generator:'generation-supervisor',job_id:'job-hourglass',artifact_id:'asset-hourglass',source_shot_id:SHOTS[1],generation_mode:'STILL'},technical_eligibility:{evidence_id:'elig-hourglass',evidence_digest_sha256:H('elig-hourglass'),state:'ELIGIBLE'}},
  {visual_source_id:'asset-proof',shot_id:SHOTS[2],media_mode:'SCREEN_CAPTURE',presenter_relation:'PICTURE_IN_PICTURE',provenance_class:'AUTHENTIC_UI_PROOF',media:media(SCREEN,'VIDEO'),selection_authority:authority('HUMAN_CAPTURE_SELECTION','proof-selection'),generation_provenance:{generator:'supervised-capture',job_id:'capture-proof',artifact_id:'asset-proof',source_shot_id:SHOTS[2],generation_mode:'NOT_APPLICABLE'},technical_eligibility:{evidence_id:'elig-proof',evidence_digest_sha256:H('elig-proof'),state:'ELIGIBLE'}},
]; }
function soundSources() { return [{sound_source_id:'sound-main',cue_id:'cue-main',production_mix_id:'production-mix-test',production_selection_identity:H('sound-selection'),listening_review_identity:H('listening'),resolve_source_identity:H('resolve-source'),functional_intent:'support dialogue',media:media(MUSIC,'AUDIO'),selection_authority:authority('SCORECRAFT_FINAL_SELECTION','sound-selection')}]; }
function probeResolver(ref,kind) { const bytes=fs.readFileSync(ref); if(kind==='IMAGE') return {bytes,probe:{readable:true,duration_us:null,width:360,height:640,frame_rate:null,has_video:true,has_audio:false}}; if(kind==='AUDIO') return {bytes,probe:{readable:true,duration_us:12000000,width:null,height:null,frame_rate:null,has_video:false,has_audio:true}}; return {bytes,probe:{readable:true,duration_us:4000000,width:360,height:640,frame_rate:{numerator:25,denominator:1},has_video:true,has_audio:true}}; }

function specFor(ctx) {
  const units=ctx.presenter.base.recording_units; const ids=ctx.presenter.manifests.map((m)=>`presenter:${m.human_selections[0].take_id}`);
  const p=(id,unit,role,start,end,transform=null)=>({source_type:'PRESENTER',source_id:id,track_role:role,refs:refs(unit.section_id,null,null,unit.recording_unit_id),presenter_relation:null,playback_mode:'NORMAL',source_range:range(0,end-start),timeline_range:range(start,end),transform,transition_refs:[]});
  const v=(id,index,role,start,end,relation,mode='NORMAL')=>({source_type:'VISUAL',source_id:id,track_role:role,refs:refs(SECTIONS[index].section_id,BEATS[index],SHOTS[index],null),presenter_relation:relation,playback_mode:mode,source_range:id==='asset-hourglass'?null:range(0,end-start),timeline_range:range(start,end),transform:null,transition_refs:[]});
  return {created_by:'editor',timeline:{frame_rate:{numerator:25,denominator:1},orientation:'VERTICAL',width:1080,height:1920,output_class:'VIDTOOLZ_SHORT',expected_duration_frames:225,tracks:['VIDEO_PRIMARY','VIDEO_OVERLAY','PRESENTER_PIP','GRAPHICS','CAPTIONS','AUDIO_DIALOGUE','AUDIO_MUSIC']},clips:[
    p(ids[0],units[0],'VIDEO_PRIMARY',0,75),p(ids[0],units[0],'AUDIO_DIALOGUE',0,75),v('asset-conveyor',0,'VIDEO_OVERLAY',10,65,'BROLL_OVERLAY','FRAME_SAMPLE'),
    p(ids[1],units[1],'VIDEO_PRIMARY',75,150),p(ids[1],units[1],'AUDIO_DIALOGUE',75,150),v('asset-hourglass',1,'VIDEO_OVERLAY',85,140,'BROLL_OVERLAY'),
    v('asset-proof',2,'VIDEO_PRIMARY',150,225,'PICTURE_IN_PICTURE','FRAME_SAMPLE'),p(ids[2],units[2],'PRESENTER_PIP',150,225,{preset:'right-third',position_x:0.75,position_y:0.5,scale:0.32,crop:{left:0,top:0,right:0,bottom:0},safe_area_ref:'vertical-safe',composite_role:'FOREGROUND'}),p(ids[2],units[2],'AUDIO_DIALOGUE',150,225),
    {source_type:'SOUND',source_id:'sound-main',track_role:'AUDIO_MUSIC',refs:refs(null),presenter_relation:null,playback_mode:'NORMAL',source_range:range(0,225),timeline_range:range(0,225),transform:null,transition_refs:[]},
  ],transitions:[{type:'DISSOLVE',from_clip_index:0,to_clip_index:3,duration_frames:4}],graphics:[{track_role:'GRAPHICS',text:'Ask about value, not speed',text_kind:'TITLE_CARD',text_authority_ref:{authority_type:'STORY_TEXT',authority_id:'sec-proof-title',authority_digest_sha256:H('Ask about value, not speed')},timeline_range:range(170,210),style_template_ref:'vidtoolz-title',section_id:SECTIONS[2].section_id,research_refs:[]}],story_coverage:SECTIONS.map((s)=>coverage(s.section_id)),visual_coverage:SHOTS.map((s)=>coverage(s,'PLACED')),presenter_coverage:units.map((u)=>coverage(u.recording_unit_id)),sound_coverage:[coverage('sound-main')],human_exceptions:[]};
}

function fixture(overrides={}) {
  const presenter=makePresenter(); const currentVisualPlan=makeVisualPlan();
  const ctx={presenter,currentVisualPlan};
  const task={task_id:'EDITOR-CANARY',action:'plan_edit',project_id:STORY.project_id,requested_by:'hermes',current_story:clone(STORY),current_visual_plan:currentVisualPlan,presenter_manifests:presenter.manifests,visual_sources:visualSources(),visual_authority_contexts:[],sound_sources:soundSources(),sound_authority_contexts:[],edit_plan_spec:specFor(ctx),privacy:{local_only:true},...overrides};
  const options={now:NOW,idFactory,mediaResolver:probeResolver,presenterManifestOptions:{currentStory:PT_STORY,mediaProbe:ptProbe,allowedHumanIds:['TEST_HUMAN']},verifyVisualAuthority:(source)=>visualSources().some((v)=>v.visual_source_id===source.visual_source_id&&v.selection_authority.authority_digest_sha256===source.selection_authority.authority_digest_sha256),verifySoundAuthority:(source)=>soundSources().some((s)=>s.sound_source_id===source.sound_source_id&&s.production_selection_identity===source.production_selection_identity),verifyHuman:(person)=>person?.type==='HUMAN'&&person.id==='TEST_HUMAN',verifyHumanIdentity:(id)=>id==='TEST_HUMAN'};
  return {task,options,presenter};
}
function runFx(overrides={},optionOverrides={}) { const fx=fixture(overrides); return {fx,out:editor.run(fx.task,{...fx.options,...optionOverrides})}; }

test('ED1 production canary reaches ROUGH_CUT_READY_FOR_QC',()=>{const {fx,out}=runFx();assert.equal(out.state,'ROUGH_CUT_READY_FOR_QC',`${out.errors?.join('; ')} / ${vp.validatePlan(fx.task.current_visual_plan,{currentStory:fx.task.current_visual_plan.story}).reason_codes.join(',')}`);assert.equal(out.authority.qc_handoff_ready,true);});
test('ED2 canary includes Presenter, B-roll, still, proof, PiP, music, graphic and dissolve',()=>{const {out}=runFx();const p=out.edit_plan;assert.equal(p.presenter_sources.length,3);assert.equal(p.visual_sources.length,3);assert.equal(p.sound_sources.length,1);assert.ok(p.graphic_instances.length);assert.equal(p.transition_instances[0].type,'DISSOLVE');assert.ok(p.timeline.tracks.some((t)=>t.role==='PRESENTER_PIP'));});
test('ED3 Resolve handoff is canonical projection',()=>{const {out}=runFx();assert.equal(out.resolve_handoff.edit_plan_id,out.edit_plan.edit_plan_id);assert.equal(out.resolve_handoff.render,undefined);assert.equal(out.resolve_handoff.sources.every((s)=>s.sha256),true);});
test('ED4 QC handoff contains no verdict',()=>{const {out}=runFx();assert.equal(out.qc_handoff.edit_plan_digest_sha256,out.edit_plan.edit_plan_digest_sha256);assert.equal(out.qc_handoff.qc_pass,undefined);});
test('ED5 generation does not create human acceptance',()=>{const {out}=runFx();assert.equal(out.human_acceptance.state,'NOT_RECORDED');assert.equal(out.state.includes('COMPLETE'),false);});
test('ED6 Story drift blocks status',()=>{const {fx,out}=runFx();const task={...fx.task,action:'status',previous_edit_plan:out.edit_plan,edit_plan_spec:undefined,current_story:{...fx.task.current_story,content_hash:H('changed')}};delete task.edit_plan_spec;const r=editor.run(task,fx.options);assert.equal(r.state,'STALE');assert.equal(r.resolve_handoff,null);});
test('ED7 Visual Plan drift blocks',()=>{const {fx,out}=runFx();const changed=clone(fx.task.current_visual_plan);changed.plan_revision++;changed.plan_digest_sha256=vp.planDigest(changed);const task={...fx.task,action:'status',previous_edit_plan:out.edit_plan,current_visual_plan:changed};delete task.edit_plan_spec;const r=editor.run(task,fx.options);assert.equal(r.state,'STALE');});
test('ED8 wrong Presenter take blocks',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].source_id=`presenter:${fx.presenter.recommendation}`;const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED9 recommendation cannot replace human selection',()=>{const {fx,out}=runFx();assert.notEqual(out.edit_plan.presenter_sources[0].take_id,fx.presenter.recommendation);});
test('ED10 visual selected flag without verifier blocks',()=>{const fx=fixture();delete fx.options.verifyVisualAuthority;fx.task.visual_sources[0].selected=true;const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED11 Sound selected flag without verifier blocks',()=>{const fx=fixture();delete fx.options.verifySoundAuthority;fx.task.sound_sources[0].selected=true;const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED12 missing media blocks',()=>{const fx=fixture();fx.task.visual_sources[0].media.path_or_artifact_ref=path.join(TMP,'missing.mp4');const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED13 wrong SHA blocks',()=>{const fx=fixture();fx.task.visual_sources[0].media.expected_sha256=H('wrong');const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED14 changed bytes at same path block status',()=>{const fx=fixture();const first=editor.run(fx.task,fx.options);const copy=path.join(TMP,`mut-${uid()}.mp4`);fs.copyFileSync(BROLL,copy);fx.task.visual_sources[0].media={...fx.task.visual_sources[0].media,path_or_artifact_ref:copy,expected_sha256:fileHash(copy)};const built=editor.run(fx.task,fx.options);fs.appendFileSync(copy,'mutation');const task={...fx.task,action:'status',previous_edit_plan:built.edit_plan};delete task.edit_plan_spec;const out=editor.run(task,fx.options);assert.equal(out.authority.media_verified,false);assert.equal(out.resolve_handoff,null);assert.equal(first.state,'ROUGH_CUT_READY_FOR_QC');});
test('ED15 source range overflow blocks',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].source_range.out_frame=500;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED16 negative frame interval blocks',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].timeline_range.in_frame=-1;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED17 zero frame interval blocks',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].timeline_range.out_frame=0;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED18 primary overlap blocks',()=>{const fx=fixture();const extra=clone(fx.task.edit_plan_spec.clips[0]);extra.timeline_range=range(10,50);extra.source_range=range(0,40);fx.task.edit_plan_spec.clips.push(extra);assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED19 missing Story section blocks QC readiness',()=>{const fx=fixture();fx.task.edit_plan_spec.story_coverage[2].state='MISSING';fx.task.edit_plan_spec.clips=fx.task.edit_plan_spec.clips.filter((c)=>c.refs.section_id!==SECTIONS[2].section_id);const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');assert.equal(out.qc_handoff,null);});
test('ED20 generated UI cannot satisfy authentic proof',()=>{const fx=fixture();fx.task.visual_sources[2].provenance_class='GENERATED_VIDEO';assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED21 unsupported factual lower-third blocks',()=>{const fx=fixture();fx.task.edit_plan_spec.graphics[0].text_authority_ref=null;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED22 structural reorder without exception blocks',()=>{const fx=fixture();for(const c of fx.task.edit_plan_spec.clips){if(c.refs.section_id===SECTIONS[0].section_id){c.timeline_range.in_frame+=150;c.timeline_range.out_frame+=150;}if(c.refs.section_id===SECTIONS[2].section_id){c.timeline_range.in_frame-=150;c.timeline_range.out_frame-=150;}}assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED23 revision uses canonical immutable successor',()=>{const {fx,out:first}=runFx();fx.task.action='revise_edit';fx.task.previous_edit_plan=first.edit_plan;fx.task.edit_plan_spec.timeline.output_class='VIDTOOLZ_SHORT_REVISED';const second=editor.run(fx.task,fx.options);assert.equal(second.edit_plan.edit_plan_revision,2);assert.equal(second.edit_plan.supersedes,first.edit_plan.edit_plan_id);assert.equal(second.edit_plan.supersedes_digest,first.edit_plan.edit_plan_digest_sha256);assert.notEqual(second.edit_plan.edit_plan_id,first.edit_plan.edit_plan_id);});
test('ED24 previous plan remains immutable after revision',()=>{const {fx,out:first}=runFx();const snapshot=JSON.stringify(first.edit_plan);fx.task.action='revise_edit';fx.task.previous_edit_plan=first.edit_plan;fx.task.edit_plan_spec.timeline.output_class='REV2';editor.run(fx.task,fx.options);assert.equal(JSON.stringify(first.edit_plan),snapshot);});
test('ED25 detached predecessor fails status authority',()=>{const {fx,out}=runFx();const bad=clone(out.edit_plan);bad.edit_plan_revision=2;bad.supersedes='edit-plan-00000000000000000000000000';bad.supersedes_digest=H('wrong');bad.edit_plan_digest_sha256=ep.editPlanDigest(bad);const task={...fx.task,action:'status',previous_edit_plan:bad,predecessor_edit_plan:out.edit_plan};delete task.edit_plan_spec;assert.equal(editor.run(task,fx.options).state,'BLOCKED');});
test('ED26 caller QC_PASS field rejected',()=>{const fx=fixture();fx.task.qc_pass=true;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED27 caller final approval field rejected',()=>{const fx=fixture();fx.task.final_edit_approved=true;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED28 publication readiness field rejected',()=>{const fx=fixture();fx.task.publish_ready=true;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED29 path-only media identity rejected',()=>{const fx=fixture();delete fx.task.visual_sources[0].media.expected_sha256;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED30 inconsistent frame arithmetic blocks',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].timeline_range.out_frame=74;assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
for(const rate of [[25,1],[30,1],[30000,1001],[24000,1001]]) test(`ED rational timebase ${rate[0]}/${rate[1]}`,()=>{const fx=fixture();fx.task.edit_plan_spec.timeline.frame_rate={numerator:rate[0],denominator:rate[1]};for(const c of fx.task.edit_plan_spec.clips) if(c.source_type!=='VISUAL'||c.source_id!=='asset-hourglass') c.playback_mode='FRAME_SAMPLE';const out=editor.run(fx.task,fx.options);assert.notEqual(out.state,'BLOCKED');});
test('ED31 unknown action rejected',()=>{const fx=fixture({action:'publish'});assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED32 Edit Plan schema rejects model clip ID',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].clip_instance_id='model-id';assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED33 no final authority fields appear',()=>{const {out}=runFx();const raw=JSON.stringify(out);for(const field of ['QC_PASS','FINAL_EDIT_APPROVED','READY_TO_PUBLISH','PUBLISHED'])assert.equal(raw.includes(field),false);});
test('ED34 control room exposes exact authority state',()=>{const {out}=runFx();assert.equal(out.control_room.edit_plan.digest,out.edit_plan.edit_plan_digest_sha256);assert.equal(out.control_room.qc_handoff_ready,true);assert.equal(out.control_room.next_owner,'qc_director');});
test('ED35 stale human acceptance cannot elevate successor',()=>{const {fx,out:first}=runFx();const approval=ep.createEditApprovalBinding(first.edit_plan,{approver:{type:'HUMAN',id:'TEST_HUMAN'},approved_at:NOW,scope:'FINAL_CUT_APPROVAL'},fx.options);fx.task.action='revise_edit';fx.task.previous_edit_plan=first.edit_plan;fx.task.human_edit_approval=approval;fx.task.edit_plan_spec.timeline.output_class='REV2';const second=editor.run(fx.task,fx.options);assert.equal(second.human_acceptance.state,'INVALID_OR_STALE');assert.equal(second.state,'ROUGH_CUT_READY_FOR_QC');});
test('ED36 missing visual verifier fails closed',()=>{const fx=fixture();delete fx.options.verifyVisualAuthority;const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED37 missing Sound verifier fails closed',()=>{const fx=fixture();delete fx.options.verifySoundAuthority;const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');});
test('ED38 no render or Resolve execution API exported',()=>{for(const name of ['render','publish','openResolve','qcPass','selectTake'])assert.equal(editor[name],undefined);});

test('ED39 real AIGEN authority adapter binds selected image bytes',()=>{
  const pkg=path.join(TMP,`aigen-${uid()}`);fs.mkdirSync(path.join(pkg,'images','flux-local'),{recursive:true});fs.mkdirSync(path.join(pkg,'script'),{recursive:true});
  fs.writeFileSync(path.join(pkg,'script','script-final.md'),'approved script');fs.writeFileSync(path.join(pkg,'image-prompts.json'),JSON.stringify({image_prompts:[{index:1,prompt:'x'}]}));fs.copyFileSync(STILL,path.join(pkg,'images','flux-local','flux-001.png'));fs.writeFileSync(path.join(pkg,'selected-images.json'),JSON.stringify({selections:[{prompt_index:1,selected_path:'images/flux-local/flux-001.png'}]}));
  aigen.recordStage(pkg,'image_prompts',{now:NOW});aigen.recordStage(pkg,'selected_images',{now:NOW});const record=aigen.readAuthorityLedger(pkg).stages.selected_images;
  const source={visual_source_id:'asset-aigen',media:{path_or_artifact_ref:path.join(pkg,'images','flux-local','flux-001.png'),sha256:fileHash(path.join(pkg,'images','flux-local','flux-001.png'))},selection_authority:{authority_id:`aigen:${path.basename(pkg)}:selected_images:1`,authority_digest_sha256:aigen.stableHash(record)}};
  assert.equal(editor.verifyAigenSource(source,{package_dir:pkg,stage:'selected_images',prompt_index:1}),true);fs.appendFileSync(source.media.path_or_artifact_ref,'mutated');assert.equal(editor.verifyAigenSource(source,{package_dir:pkg,stage:'selected_images',prompt_index:1}),false);
});
test('ED40 human capture adapter requires exact bytes and human identity',()=>{const bytes=fs.readFileSync(SCREEN);const binding={artifact_path:SCREEN,artifact_sha256:H(bytes),commit:'test-commit',approved_by:'TEST_HUMAN',approved_at:NOW,scope:'CANDIDATE_SELECTION'};const source={media:{path_or_artifact_ref:SCREEN},selection_authority:{authority_digest_sha256:H(ep.canonicalize(binding))}};assert.equal(editor.verifyHumanCaptureSource(source,{kind:'HUMAN_MEDIA_SELECTION',approval_binding:binding},{verifyHumanIdentity:(id)=>id==='TEST_HUMAN'}),true);assert.equal(editor.verifyHumanCaptureSource(source,{kind:'HUMAN_MEDIA_SELECTION',approval_binding:binding},{verifyHumanIdentity:()=>false}),false);});
test('ED41 CLI help is bounded',()=>{const out=childProcess.execFileSync('node',[path.join(__dirname,'..','scripts','editor.js'),'--help'],{encoding:'utf8'});assert.match(out,/editor-task/);});
test('ED42 successor status requires exact predecessor',()=>{const {fx,out:first}=runFx();fx.task.action='revise_edit';fx.task.previous_edit_plan=first.edit_plan;fx.task.edit_plan_spec.timeline.output_class='REV2';const second=editor.run(fx.task,fx.options);const task={...fx.task,action:'status',previous_edit_plan:second.edit_plan,predecessor_edit_plan:first.edit_plan};delete task.edit_plan_spec;assert.equal(editor.run(task,fx.options).state,'ROUGH_CUT_READY_FOR_QC');delete task.predecessor_edit_plan;assert.equal(editor.run(task,fx.options).state,'BLOCKED');});
test('ED43 skipped revision is rejected at Editor status',()=>{const {fx,out:first}=runFx();fx.task.action='revise_edit';fx.task.previous_edit_plan=first.edit_plan;fx.task.edit_plan_spec.timeline.output_class='REV2';const second=editor.run(fx.task,fx.options);const skipped=clone(second.edit_plan);skipped.edit_plan_revision=3;skipped.edit_plan_digest_sha256=ep.editPlanDigest(skipped);const task={...fx.task,action:'status',previous_edit_plan:skipped,predecessor_edit_plan:first.edit_plan};delete task.edit_plan_spec;assert.equal(editor.run(task,fx.options).state,'BLOCKED');});
test('ED44 contract promotion explicitly locks downstream and upstream authority',()=>{const contract=require('../config/agent-contract.json');const role=contract.role_roster.find((r)=>r.role_id==='editor');assert.equal(role.status,'BUILT');const disowned=role.does_not_own.join(' ');for(const term of ['Story','Research','Presenter','visual asset','Sound','QC PASS','human edit','publication'])assert.match(disowned,new RegExp(term,'i'));});
test('ED45 registry exposes only bounded Editor actions',()=>{const registry=require('../config/agent-registry.json');const role=registry.agents.find((r)=>r.agent_id==='editor');for(const action of editor.ACTIONS)assert.ok(role.allowed_actions.includes(action));for(const banned of ['publish','approve_take','select_take','qc_pass'])assert.equal(role.allowed_actions.includes(banned),false);});
test('ED46 canonical runner registers Editor once',()=>{const runner=fs.readFileSync(path.join(__dirname,'run-tests.js'),'utf8');assert.equal(runner.split('editor-agent.test.js').length-1,1);});
test('ED47 rendered-media reference is byte-bound before QC projection',()=>{const fx=fixture({rendered_media_ref:{path_or_artifact_ref:SCREEN,sha256:fileHash(SCREEN),byte_size:fs.statSync(SCREEN).size}});const out=editor.run(fx.task,fx.options);assert.equal(out.qc_handoff.rendered_media_ref.sha256,fileHash(SCREEN));fx.task.rendered_media_ref.sha256=H('wrong');assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED48 invalid deadline and non-local privacy fail before planning',()=>{const fx=fixture({deadline:'not-a-date'});assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');fx.task.deadline=undefined;fx.task.privacy={local_only:false};assert.equal(editor.run(fx.task,fx.options).state,'BLOCKED');});
test('ED49 preview-only authority produces REVIEW attention',()=>{assert.equal(editor.deriveAttention({state:'PREVIEW_ONLY',reasons:['STORY_NOT_APPROVED'],blocking_gaps:[],blocking_conflicts:[]}), 'REVIEW');});
test('ED50 meaning-changing sequence conflict produces DECISION attention',()=>{const fx=fixture();for(const c of fx.task.edit_plan_spec.clips){if(c.refs.section_id===SECTIONS[0].section_id){c.timeline_range.in_frame+=150;c.timeline_range.out_frame+=150;}if(c.refs.section_id===SECTIONS[2].section_id){c.timeline_range.in_frame-=150;c.timeline_range.out_frame-=150;}}const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');assert.equal(out.attention,'DECISION');assert.equal(out.control_room.attention_level,'DECISION');});
test('ED51 rough-cut readiness remains INFORMATION',()=>{const {out}=runFx();assert.equal(out.state,'ROUGH_CUT_READY_FOR_QC');assert.equal(out.attention,'INFORMATION');assert.equal(out.control_room.attention,'INFORMATION');});
test('ED52 explicit attention prevents Control Room from hiding blocked review',()=>{const fx=fixture();fx.task.edit_plan_spec.clips[0].source_range.out_frame=500;const out=editor.run(fx.task,fx.options);assert.equal(out.state,'BLOCKED');assert.equal(out.attention,'REVIEW');assert.equal(out.control_room.attention_level,'REVIEW');});

if(require.main===module){(async()=>{let passed=0,failed=0;for(const item of tests){try{await item.fn();passed++;console.log(`ok ${passed} - ${item.name}`);}catch(error){failed++;console.error(`not ok - ${item.name}`);console.error(error.stack||error.message);}}console.log(`${passed}/${passed+failed} Editor V1 tests passed`);if(failed)process.exitCode=1;})();}

module.exports={tests};
