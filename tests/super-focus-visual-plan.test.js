const { test, assert } = require('./_helpers.js');
const vp = require('../super-focus-visual-plan.js');

const SCRIPT = [
  'More AI tools can make you less productive. Every tool adds an interface.',
  'Wan 2.2 renders fast. FLUX.1 makes the plates. DaVinci 21.0.2 is stable.',
  'One system beats five tools.',
].join('\n');

function planFor(script) { return vp.createBeats(script, null, { now: '2026-07-19T00:00:00Z' }); }

function draftedPlan(script) {
  let plan = planFor(script);
  const beat = plan.beats[0];
  plan = vp.saveAssignment(plan, script, beat.beat_id, {
    viewer_task: 'Understand tool overhead.',
    visual_function: 'clarify',
    assignment: 'Show one creator surrounded by multiplying tool panels.',
    acceptance_criteria: ['Idea readable in one second', 'Lower-right stays quiet'],
    media_type: 'image_to_video',
  }, { now: '2026-07-19T00:01:00Z' });
  return { plan, beat };
}

// Simulate a LEGACY persisted beat disposition without going through the guarded
// write route (setBeatDisposition now rejects assignment-excluding dispositions).
// This models a project saved before the "every beat requires a visual" rule.
function forceDisposition(plan, beatId, disposition) {
  return Object.assign({}, plan, {
    beats: plan.beats.map((b) => (b.beat_id === beatId
      ? Object.assign({}, b, { visual_disposition: disposition })
      : b)),
  });
}

// ── segmentation ─────────────────────────────────────────────────────────────

test('visual-plan: beats keep version numbers and decimals whole', () => {
  const plan = planFor(SCRIPT);
  const texts = plan.beats.map((b) => b.script_text);
  assert.ok(texts.some((t) => t.includes('Wan 2.2 renders fast.')), texts);
  assert.ok(!texts.some((t) => /\bWan 2\.$/.test(t)), 'no beat ends mid-version');
  assert.ok(texts.some((t) => t.includes('DaVinci 21.0.2 is stable.')));
  // Exact text anchoring: every beat slice matches the script offsets.
  plan.beats.forEach((b) => {
    assert.equal(SCRIPT.slice(b.start_char, b.end_char), b.script_text);
  });
});

test('visual-plan: newlines are hard beat boundaries; long paragraphs pack sentences', () => {
  const plan = planFor(SCRIPT);
  assert.ok(plan.beats.length >= 3, `expected >=3 beats, got ${plan.beats.length}`);
  const orders = plan.beats.map((b) => b.order);
  assert.deepEqual(orders, orders.slice().sort((a, b) => a - b));
  const long = `${'A claim here. '.repeat(40)}`;
  const p2 = planFor(long);
  assert.ok(p2.beats.length > 1, 'long paragraph splits into multiple beats');
  p2.beats.forEach((b) => assert.ok(b.script_text.length <= vp.BOUNDS.beat_target_chars + 20));
});

test('visual-plan: unicode/emoji survive segmentation without surrogate splits', () => {
  const script = 'Tämä toimii hyvin 🎬🚀. Käsikirjoitus on valmis. 日本語のテキストも動く。';
  const plan = planFor(script);
  plan.beats.forEach((b) => {
    assert.equal(script.slice(b.start_char, b.end_char), b.script_text);
    assert.ok(vp.isSurrogateSafe(script, b.start_char));
    assert.ok(vp.isSurrogateSafe(script, b.end_char));
    // A lone surrogate would make JSON round-trip lossy.
    assert.equal(JSON.parse(JSON.stringify(b.script_text)), b.script_text);
  });
});

test('visual-plan: abbreviations and quoted punctuation do not shatter beats', () => {
  const plan = planFor('Use e.g. the fast lane. He said "stop." Then we left.');
  const texts = plan.beats.map((b) => b.script_text);
  assert.ok(texts[0].includes('e.g. the fast lane'), texts);
});

test('visual-plan: empty script is rejected', () => {
  assert.throws(() => vp.createBeats('   ', null), (e) => e.statusCode === 400);
});

// ── data model validation ────────────────────────────────────────────────────

test('visual-plan: invalid disposition, function, media type, criteria all rejected', () => {
  const { plan, beat } = draftedPlan(SCRIPT);
  assert.throws(() => vp.setBeatDisposition(plan, SCRIPT, beat.beat_id, 'sideways'), /visual_disposition/);
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, plan.beats[1].beat_id, {
    assignment: 'x', visual_function: 'confuse',
  }), /visual_function/);
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, plan.beats[1].beat_id, {
    assignment: 'x', media_type: 'hologram',
  }), /media_type/);
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, plan.beats[1].beat_id, {
    assignment: 'x', acceptance_criteria: 'not-an-array',
  }), /acceptance_criteria/);
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, plan.beats[1].beat_id, {
    assignment: { object: true },
  }), /must be a string/);
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, plan.beats[1].beat_id, {
    assignment: 'x'.repeat(vp.BOUNDS.assignment_max + 1),
  }), /too long/);
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, plan.beats[1].beat_id, {
    assignment: 'x', visual_function: 'custom', // custom requires a bounded label
  }), /visual_function_custom/);
});

test('visual-plan: plan validation rejects duplicates, orphans, overlaps', () => {
  const plan = planFor(SCRIPT);
  const dupe = JSON.parse(JSON.stringify(plan));
  dupe.beats.push(Object.assign({}, dupe.beats[0]));
  assert.throws(() => vp.validatePlan(dupe, SCRIPT), /Duplicate beat id/);
  const orphan = JSON.parse(JSON.stringify(plan));
  orphan.assignments.push({ assignment_id: 'assignment-zz', beat_id: 'beat-nope', status: 'draft' });
  assert.throws(() => vp.validatePlan(orphan, SCRIPT), /missing beat/);
  const overlap = JSON.parse(JSON.stringify(plan));
  overlap.beats[1].start_char = overlap.beats[0].start_char + 1;
  overlap.beats[1].beat_id = 'beat-overlap1';
  assert.throws(() => vp.validatePlan(overlap, SCRIPT), /overlap/);
});

test('visual-plan: assignment hash is stable and content-derived', () => {
  const { plan, beat } = draftedPlan(SCRIPT);
  const a1 = vp.assignmentForBeat(plan, beat.beat_id);
  const again = vp.saveAssignment(plan, SCRIPT, beat.beat_id, {
    viewer_task: a1.viewer_task,
    visual_function: a1.visual_function,
    assignment: a1.assignment,
    acceptance_criteria: a1.acceptance_criteria,
    media_type: a1.media_type,
  });
  const a2 = vp.assignmentForBeat(again, beat.beat_id);
  assert.equal(a1.assignment_hash, a2.assignment_hash, 'byte-identical content → identical hash');
  const edited = vp.saveAssignment(plan, SCRIPT, beat.beat_id, {
    viewer_task: a1.viewer_task, visual_function: a1.visual_function,
    assignment: 'Show something different.', acceptance_criteria: a1.acceptance_criteria,
    media_type: a1.media_type,
  });
  assert.notEqual(vp.assignmentForBeat(edited, beat.beat_id).assignment_hash, a1.assignment_hash);
});

// ── split / merge ────────────────────────────────────────────────────────────

test('visual-plan: split keeps exact text, ids stable, assignment flagged on first half', () => {
  const { plan, beat } = draftedPlan(SCRIPT);
  const at = beat.start_char + beat.script_text.indexOf('Every tool');
  const split = vp.splitBeat(plan, SCRIPT, beat.beat_id, at);
  assert.equal(split.beats.length, plan.beats.length + 1);
  const first = vp.findBeat(split, beat.beat_id);
  assert.ok(first.script_text.startsWith('More AI tools'));
  const carried = vp.assignmentForBeat(split, beat.beat_id);
  assert.ok(carried && carried.stale, 'assignment survives split, flagged for review');
  split.beats.forEach((b) => assert.equal(SCRIPT.slice(b.start_char, b.end_char), b.script_text));
});

test('visual-plan: split rejects offsets outside the beat or inside surrogate pairs', () => {
  const script = 'AA🎬BB. Second sentence here.';
  const plan = planFor(script);
  const beat = plan.beats[0];
  const surrogateMid = script.indexOf('🎬') + 1;
  assert.throws(() => vp.splitBeat(plan, script, beat.beat_id, surrogateMid), /surrogate/);
  assert.throws(() => vp.splitBeat(plan, script, beat.beat_id, beat.start_char), /inside the beat/);
  assert.throws(() => vp.splitBeat(plan, script, beat.beat_id, beat.end_char), /inside the beat/);
});

test('visual-plan: merge refuses two assignments; carries one, flagged', () => {
  const { plan } = draftedPlan(SCRIPT);
  const [b1, b2] = vp.createBeats(SCRIPT, null).beats; void b1; void b2;
  const ordered = plan.beats;
  const merged = vp.mergeWithNext(plan, SCRIPT, ordered[0].beat_id);
  const carried = vp.assignmentForBeat(merged, ordered[0].beat_id);
  assert.ok(carried && carried.stale, 'single assignment carries over, flagged');
  // Two assignments → refuse.
  let both = vp.saveAssignment(plan, SCRIPT, ordered[1].beat_id, { assignment: 'Second visual.' });
  assert.throws(() => vp.mergeWithNext(both, SCRIPT, ordered[0].beat_id), (e) => e.statusCode === 409);
});

test('visual-plan: split/merge refuse to run against a stale plan', () => {
  const { plan, beat } = draftedPlan(SCRIPT);
  const newScript = `${SCRIPT}\nA new closing line.`;
  assert.throws(() => vp.splitBeat(plan, newScript, beat.beat_id, beat.start_char + 5), /stale/i);
  assert.throws(() => vp.mergeWithNext(plan, newScript, beat.beat_id), /stale/i);
});

// ── slot safety ──────────────────────────────────────────────────────────────

test('visual-plan: generation selects only missing; skips populated/approved/rejected/presenter/reuse', () => {
  let { plan } = draftedPlan(SCRIPT); // beat[0] has a draft
  const ordered = plan.beats;
  plan = forceDisposition(plan, ordered[1].beat_id, 'presenter_only'); // legacy stored beat
  plan = forceDisposition(plan, ordered[2].beat_id, 'reuse_previous'); // legacy stored beat
  const picked = vp.selectBeatsForGeneration(plan, {});
  assert.ok(!picked.beats.some((b) => b.beat_id === ordered[0].beat_id), 'draft not overwritten');
  assert.ok(!picked.beats.some((b) => b.beat_id === ordered[1].beat_id), 'presenter-only skipped');
  assert.ok(!picked.beats.some((b) => b.beat_id === ordered[2].beat_id), 'reuse-previous skipped');
  const reasons = picked.skipped.map((s) => s.reason).join('|');
  assert.match(reasons, /already exists/);
  assert.match(reasons, /Presenter only/);
  assert.match(reasons, /previous visual/);
});

test('visual-plan: rejected assignment regenerates only when explicitly selected', () => {
  let { plan, beat } = draftedPlan(SCRIPT);
  const a = vp.assignmentForBeat(plan, beat.beat_id);
  plan = vp.rejectAssignment(plan, SCRIPT, a.assignment_id);
  const implicit = vp.selectBeatsForGeneration(plan, {});
  assert.ok(!implicit.beats.some((b) => b.beat_id === beat.beat_id));
  assert.ok(implicit.skipped.some((s) => /Rejected/i.test(s.reason) || /rejected/.test(s.reason)));
  const explicit = vp.selectBeatsForGeneration(plan, { beatIds: [beat.beat_id] });
  assert.ok(explicit.beats.some((b) => b.beat_id === beat.beat_id));
});

test('visual-plan: generation batch is bounded (default 3)', () => {
  const many = planFor(Array.from({ length: 9 }, (_, i) => `Claim number ${i + 1} stands alone.`).join('\n'));
  const picked = vp.selectBeatsForGeneration(many, {});
  assert.equal(picked.beats.length, 3);
  assert.equal(picked.truncated, 6);
});

// ── approvals ────────────────────────────────────────────────────────────────

test('visual-plan: approve/revoke/reject transitions enforced; operator is authority', () => {
  let { plan, beat } = draftedPlan(SCRIPT);
  const a = vp.assignmentForBeat(plan, beat.beat_id);
  plan = vp.approveAssignment(plan, SCRIPT, a.assignment_id);
  assert.equal(vp.assignmentForBeat(plan, beat.beat_id).status, 'approved');
  // Approved cannot be edited or re-approved or rejected directly.
  assert.throws(() => vp.saveAssignment(plan, SCRIPT, beat.beat_id, { assignment: 'sneaky edit' }),
    (e) => e.statusCode === 409);
  assert.throws(() => vp.approveAssignment(plan, SCRIPT, a.assignment_id), (e) => e.statusCode === 409);
  assert.throws(() => vp.rejectAssignment(plan, SCRIPT, a.assignment_id), /Revoke approval first/);
  assert.throws(() => vp.clearAssignment(plan, SCRIPT, a.assignment_id), /Revoke approval/);
  plan = vp.revokeAssignment(plan, SCRIPT, a.assignment_id);
  assert.equal(vp.assignmentForBeat(plan, beat.beat_id).status, 'draft');
  plan = vp.rejectAssignment(plan, SCRIPT, a.assignment_id);
  assert.equal(vp.assignmentForBeat(plan, beat.beat_id).status, 'rejected');
  // Rejected is kept as a record unless explicitly cleared.
  assert.throws(() => vp.clearAssignment(plan, SCRIPT, a.assignment_id), (e) => e.statusCode === 409);
  plan = vp.clearAssignment(plan, SCRIPT, a.assignment_id, { allowRejected: true });
  assert.equal(vp.assignmentForBeat(plan, beat.beat_id), null);
});

test('visual-plan: stale or empty assignments cannot be approved', () => {
  let { plan, beat } = draftedPlan(SCRIPT);
  const at = beat.start_char + beat.script_text.indexOf('Every tool');
  plan = vp.splitBeat(plan, SCRIPT, beat.beat_id, at); // flags the assignment stale
  const a = vp.assignmentForBeat(plan, beat.beat_id);
  assert.throws(() => vp.approveAssignment(plan, SCRIPT, a.assignment_id), /flagged for review/);
});

// ── staleness & re-anchoring ─────────────────────────────────────────────────

test('visual-plan: script change marks plan stale; byte-identical revert unstales', () => {
  const { plan } = draftedPlan(SCRIPT);
  const stale = vp.refreshPlanStaleness(plan, `${SCRIPT} edited`);
  assert.equal(stale.stale, true);
  assert.match(stale.stale_reason, /Re-anchor/);
  const fresh = vp.refreshPlanStaleness(stale, SCRIPT);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.stale_reason, undefined);
});

test('visual-plan: re-anchor rebinds matching beats, flags unmatched, deletes nothing', () => {
  const { plan, beat } = draftedPlan(SCRIPT);
  // Insert a new opening line — all original text still present, shifted.
  const shifted = `A brand new opening line.\n${SCRIPT}`;
  const re = vp.reanchorPlan(plan, shifted);
  assert.equal(re.stale, false, 'fully matched plan is fresh again');
  assert.equal(re.beats.length, plan.beats.length);
  re.beats.forEach((b) => assert.equal(shifted.slice(b.start_char, b.end_char), b.script_text));
  assert.ok(vp.assignmentForBeat(re, beat.beat_id), 'assignment survives re-anchor');
  // Now remove the assigned beat's text entirely.
  const gone = shifted.replace('More AI tools can make you less productive. Every tool adds an interface.', 'Rewritten.');
  const re2 = vp.reanchorPlan(plan, gone);
  assert.equal(re2.stale, true);
  const lost = vp.findBeat(re2, beat.beat_id);
  assert.equal(lost.stale, true);
  const a2 = vp.assignmentForBeat(re2, beat.beat_id);
  assert.ok(a2 && a2.stale, 'assignment kept but flagged');
  assert.equal(re2.beats.length, plan.beats.length, 'nothing deleted');
});

// ── generation request + provider validation ────────────────────────────────

test('visual-plan: assignment request is explicitly not an image prompt and carries context', () => {
  const plan = planFor(SCRIPT);
  const req = vp.buildAssignmentRequest(SCRIPT, plan, plan.beats[1]);
  assert.match(req.user, /not an image prompt/);
  assert.match(req.system, /never write image\s+prompts/);
  assert.match(req.user, /PREVIOUS BEAT/);
  assert.match(req.user, /NEXT BEAT/);
  // Full-screen composition intent; no presenter-safe framing baked into the assignment.
  assert.match(req.user, /complete full-screen 9:16 image that uses the entire frame/i);
  assert.match(req.user, /do not reserve space for a presenter/i);
  assert.doesNotMatch(req.user, /presenter-safe|negative space|lower[- ]right|stay.*quiet/i);
  assert.ok(req.schema.required.indexOf('acceptance_criteria') !== -1);
});

test('visual-plan: malformed provider output rejected; near-miss enums tolerated', () => {
  assert.throws(() => vp.parseGeneratedAssignment('no json at all'), (e) => e.statusCode === 502);
  assert.throws(() => vp.parseGeneratedAssignment('{"assignment": ""}'), (e) => e.statusCode === 502);
  assert.throws(() => vp.parseGeneratedAssignment(JSON.stringify({
    viewer_task: { nested: true }, assignment: 'x', acceptance_criteria: [], visual_function: 'clarify', media_type: 'generated_still',
  })), (e) => e.statusCode === 502);
  const ok = vp.parseGeneratedAssignment(`<think>hmm</think>\n\`\`\`json\n${JSON.stringify({
    viewer_task: 'Get it.', visual_function: 'Reset Attention', assignment: 'Show the thing.',
    acceptance_criteria: ['readable fast'], media_type: 'Image To Video',
  })}\n\`\`\``);
  assert.equal(ok.visual_function, 'reset_attention');
  assert.equal(ok.media_type, 'image_to_video');
});

// ── prompt-creation gate ─────────────────────────────────────────────────────

test('visual-plan: only approved, fresh, image-lane assignments create prompts; all skips reasoned', () => {
  let { plan } = draftedPlan(SCRIPT);
  const ordered = plan.beats;
  // beat0: draft; beat1: approved image_to_video; beat2: approved screen_capture.
  plan = vp.saveAssignment(plan, SCRIPT, ordered[1].beat_id, {
    assignment: 'Approved visual.', media_type: 'image_to_video', visual_function: 'prove',
  });
  plan = vp.approveAssignment(plan, SCRIPT, vp.assignmentForBeat(plan, ordered[1].beat_id).assignment_id);
  plan = vp.saveAssignment(plan, SCRIPT, ordered[2].beat_id, {
    assignment: 'A screen capture.', media_type: 'screen_capture', visual_function: 'demonstrate',
  });
  plan = vp.approveAssignment(plan, SCRIPT, vp.assignmentForBeat(plan, ordered[2].beat_id).assignment_id);

  const sel = vp.selectAssignmentsForPromptCreation(plan, []);
  assert.equal(sel.eligible.length, 1);
  assert.equal(sel.eligible[0].beat.beat_id, ordered[1].beat_id);
  const reasons = sel.skipped.map((s) => s.reason).join('|');
  assert.match(reasons, /not approved yet/);
  assert.match(reasons, /screen capture.*not produced by the image lane/);

  // An existing prompt row for the assignment blocks duplication.
  const aid = vp.assignmentForBeat(plan, ordered[1].beat_id).assignment_id;
  const sel2 = vp.selectAssignmentsForPromptCreation(plan, [{ index: 1, text: 'x', assignment_id: aid }]);
  assert.equal(sel2.eligible.length, 0);
  assert.ok(sel2.skipped.some((s) => /Prompt already exists/.test(s.reason)));
});

test('visual-plan: prompt request is full-screen, carries assignment + style, no presenter reservation', () => {
  const { plan, beat } = draftedPlan(SCRIPT);
  const a = vp.assignmentForBeat(plan, beat.beat_id);
  const req = vp.buildPromptFromAssignmentRequest(beat, a, { styleNotes: 'Nordic minimal grey' });
  assert.match(req.user, /VISUAL ASSIGNMENT/);
  assert.match(req.user, /PROJECT VISUAL STYLE: Nordic minimal grey/);
  // The canonical model instruction is full-screen with no presenter-safe framing.
  assert.match(req.system, /full-screen vertical 9:16/i);
  assert.match(req.system, /uses the entire frame/i);
  assert.match(req.system, /do not reserve space for a presenter/i);
  assert.doesNotMatch(req.system, /lower[- ]right|negative space|background\s+plate|presenter-safe|stay.*quiet/i);
});

// ── readiness ────────────────────────────────────────────────────────────────

test('visual-plan: readiness excludes presenter-only, names blockers, tracks next action', () => {
  let { plan } = draftedPlan(SCRIPT); // beat0: draft
  const ordered = plan.beats;
  plan = forceDisposition(plan, ordered[1].beat_id, 'presenter_only'); // legacy stored beat
  let r = vp.computeVisualPlanReadiness(plan, SCRIPT);
  assert.equal(r.exists, true);
  assert.equal(r.ready, false);
  assert.equal(r.presenter_only, 1);
  assert.equal(r.assignments_required, plan.beats.length - 1);
  assert.equal(r.assignments_draft, 1);
  assert.ok(r.uncovered_beats >= 1);
  assert.match(r.blockers.join('|'), /no assignment yet/);
  assert.match(r.next_action, /Generate assignments/);
  // Approve everything required → ready.
  plan.beats.forEach((b) => {
    if (b.visual_disposition === 'presenter_only') return;
    if (!vp.assignmentForBeat(plan, b.beat_id)) {
      plan = vp.saveAssignment(plan, SCRIPT, b.beat_id, { assignment: 'Do the visual job.' });
    }
    const a = vp.assignmentForBeat(plan, b.beat_id);
    if (a.status !== 'approved') plan = vp.approveAssignment(plan, SCRIPT, a.assignment_id);
  });
  r = vp.computeVisualPlanReadiness(plan, SCRIPT);
  assert.equal(r.ready, true, JSON.stringify(r.blockers));
  assert.deepEqual(r.blockers, []);
  // A stale plan blocks readiness.
  r = vp.computeVisualPlanReadiness(plan, `${SCRIPT} changed`);
  assert.equal(r.ready, false);
  assert.equal(r.stale, true);
  assert.match(r.next_action, /Re-anchor/);
});

test('visual-plan: readiness with no plan reports create-beats next action', () => {
  const r = vp.computeVisualPlanReadiness(null, SCRIPT);
  assert.equal(r.exists, false);
  assert.equal(r.ready, false);
  assert.match(r.next_action, /Create beats/);
});

test('visual-plan: rejected assignment blocks readiness with a named beat', () => {
  let { plan, beat } = draftedPlan(SCRIPT);
  // Park the other beats so the rejected one is the only blocker (uncovered
  // beats correctly outrank rejected ones in next_action priority).
  plan.beats.forEach((b) => {
    if (b.beat_id !== beat.beat_id) plan = forceDisposition(plan, b.beat_id, 'presenter_only'); // legacy stored beats
  });
  const a = vp.assignmentForBeat(plan, beat.beat_id);
  plan = vp.rejectAssignment(plan, SCRIPT, a.assignment_id);
  const r = vp.computeVisualPlanReadiness(plan, SCRIPT);
  assert.ok(r.blockers.some((b) => /rejected/.test(b)));
  assert.match(r.next_action, /Resolve the rejected assignment for beat \d+/);
});

// ── minimal i2v integration (motion serves the visual function) ─────────────

test('visual-plan: i2v request carries assignment context and bans generic motion', () => {
  const sfPrompts = require('../super-focus-prompts.js');
  const withA = sfPrompts.buildI2vPromptRequest({
    script: 'S', imagePrompt: 'P',
    assignment: {
      assignment: 'Show expanding tool overhead.', viewer_task: 'Get the overhead idea.',
      visual_function: 'clarify', acceptance_criteria: ['Readable fast'],
    },
  });
  assert.match(withA.user, /VISUAL ASSIGNMENT/);
  assert.match(withA.user, /the motion must serve it/);
  assert.match(withA.user, /no generic filler.*floating particles/);
  const without = sfPrompts.buildI2vPromptRequest({ script: 'S', imagePrompt: 'P' });
  assert.ok(!/VISUAL ASSIGNMENT/.test(without.user), 'legacy rows get the unchanged request');
});
