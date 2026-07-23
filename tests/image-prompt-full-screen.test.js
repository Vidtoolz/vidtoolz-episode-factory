/**
 * VIDTOOLZ Episode Factory — full-screen image-prompt composition (regression).
 *
 * Proves the LIVE text-to-image model instruction, on every generation path,
 * treats each generated image as a COMPLETE FULL-SCREEN 9:16 composition and
 * carries NO active presenter-space requirement. Tests the assembled request /
 * canonical builder for each path the server actually calls:
 *   - Super Focus batch                    super-focus-prompts.buildImagePromptsRequest(script, n)
 *   - Super Focus top-up (missing-only)     super-focus-prompts.buildImagePromptsRequest(script, n, existing)
 *   - Visual Plan assignment                super-focus-visual-plan.buildAssignmentRequest(...)
 *   - Visual Plan → prompt                   super-focus-visual-plan.buildPromptFromAssignmentRequest(...)
 *   - Project (AIGEN) build + normalize     project-image-prompts.buildImagePromptRequest / parseImagePrompts
 *
 * Also asserts the preserved contracts: 9:16 vertical constraint, strict-JSON
 * parsing, and top-up slot-safety (existing prompts passed as do-not-repeat).
 */

const { test, assert } = require('./_helpers.js');
const sfPrompts = require('../super-focus-prompts.js');
const vp = require('../super-focus-visual-plan.js');
const pip = require('../project-image-prompts.js');

// The generated image is a complete full-screen composition.
const FULL_SCREEN = /full[- ]screen|full[- ]frame|uses the entire (frame|canvas)|entire 9:16 frame|complete standalone composition/i;
// The instruction explicitly refuses to reserve space for a presenter.
const NO_PRESENTER_RESERVE = /do not reserve[^\n.]*presenter/i;
// The 9:16 vertical constraint is preserved.
const VERTICAL = /9:16|1080x1920|vertical/i;

// Active presenter-space requirements that must NOT survive anywhere in the
// live instruction. Wording variants, not one obsolete phrase. These are the
// OLD directives; the new negated guidance ("do not reserve space for a
// presenter") deliberately shares none of these tokens.
const FORBIDDEN = [
  /presenter[- ]safe/i,
  /negative space/i,
  /lower[- ]right/i,
  /background[- ]plate/i,
  /behind (a |an )?(on-camera )?(presenter|host)/i,
  /leave (clean|room|uncluttered|empty) /i,
  /(sits|shifted|shift|placed|biased)\s+(the\s+)?(subject\s+)?(left|upper|off[- ]cent)/i,
  /stays? (visually )?quiet/i,
  /keep (the )?lower[- ]right (empty|clear)/i,
];

function assertClean(text, label) {
  FORBIDDEN.forEach((re) => assert.doesNotMatch(text, re, `${label} still carries a presenter-space requirement: ${re}`));
}

const SCRIPT = [
  'More AI tools can make you less productive. Every tool adds an interface.',
  'Wan 2.2 renders fast. FLUX.1 makes the plates. DaVinci 21.0.2 is stable.',
  'One system beats five tools.',
].join('\n');

// ── Super Focus batch ─────────────────────────────────────────────────────────

test('full-screen: Super Focus batch image-prompt request is full-screen, no presenter reservation', () => {
  const req = sfPrompts.buildImagePromptsRequest(SCRIPT, 8);
  assert.match(req.user, FULL_SCREEN);
  assert.match(req.user, NO_PRESENTER_RESERVE);
  assert.match(req.user, VERTICAL);
  assertClean(req.user, 'SF batch user');
  assertClean(req.system, 'SF batch system');
  // Preserved: strict-JSON output contract (schema) still present.
  assert.ok(req.schema && req.schema.type === 'array', 'batch keeps its array schema');
});

// ── Super Focus top-up (missing-only) ───────────────────────────────────────────

test('full-screen: Super Focus top-up is full-screen AND preserves do-not-repeat slot-safety', () => {
  const existing = ['A calm oak desk at dawn with a single mug', 'A misty grey ocean seen from a cliff'];
  const req = sfPrompts.buildImagePromptsRequest(SCRIPT, 3, existing);
  assert.match(req.user, FULL_SCREEN);
  assert.match(req.user, NO_PRESENTER_RESERVE);
  assert.match(req.user, VERTICAL);
  assertClean(req.user, 'SF top-up user');
  // Slot-safety: existing prompts are carried as do-not-repeat context, not overwritten.
  assert.match(req.user, /do NOT repeat/i);
  existing.forEach((p) => assert.ok(req.user.includes(p), 'existing prompt passed as exclusion'));
});

// ── Visual Plan: assignment (must not bake presenter framing into metadata) ─────

test('full-screen: Visual Plan assignment request states full-screen channel format, no presenter-safe criteria', () => {
  const plan = vp.createBeats(SCRIPT, null, { now: '2026-07-19T00:00:00Z' });
  const req = vp.buildAssignmentRequest(SCRIPT, plan, plan.beats[0]);
  const full = `${req.system}\n${req.user}`;
  assert.match(req.user, FULL_SCREEN);
  assert.match(req.user, NO_PRESENTER_RESERVE);
  assert.match(req.user, VERTICAL);
  assertClean(full, 'visual-plan assignment');
});

// ── Visual Plan: image prompt from an approved assignment ───────────────────────

test('full-screen: Visual Plan prompt-from-assignment instruction is full-screen, no presenter reservation', () => {
  const beat = { beat_id: 'b1', script_text: 'One system beats five tools.' };
  const assignment = {
    assignment_id: 'a1',
    viewer_task: 'Understand consolidation.',
    visual_function: 'clarify',
    assignment: 'Show five scattered tool panels collapsing into one clean workspace.',
    acceptance_criteria: ['Reads in one second', 'Works as a complete full-frame 9:16 image'],
    media_type: 'image_to_video',
  };
  const req = vp.buildPromptFromAssignmentRequest(beat, assignment, { styleNotes: 'Nordic minimal grey' });
  const full = `${req.system}\n${req.user}`;
  assert.match(req.system, FULL_SCREEN);
  assert.match(req.system, NO_PRESENTER_RESERVE);
  assert.match(req.system, VERTICAL);
  assertClean(full, 'visual-plan prompt');
});

// ── Project (AIGEN) build + normalized output ───────────────────────────────────

test('full-screen: project image-prompt build instruction is full-screen, no presenter-safe negative space', () => {
  const r = pip.buildImagePromptRequest({ title: 'T', premise: 'P', script: 'SCRIPT BODY', count: 25 });
  assert.match(r.system, FULL_SCREEN);
  assert.match(r.system, NO_PRESENTER_RESERVE);
  assert.match(r.system, VERTICAL);
  assertClean(r.system, 'project build system');
});

test('full-screen: project normalized prompts carry full-frame constraint, not presenter-safe negative space', () => {
  // Three genuinely distinct scenes so the existing dedup (jaccard) keeps all three.
  const distinctScenes = [
    'A dim home studio at night with soft lamp glow and a coffee mug on a shelf',
    'Close-up of weathered hands shaping clay on a spinning pottery wheel',
    'A recording studio with session musicians around a grand piano and brass instruments',
  ];
  const scenes = distinctScenes.map((prompt, i) => ({
    index: i + 1, category: 'cinematic', beat: 'problem', intended_use: 'u', prompt,
  }));
  const content = JSON.stringify({ prompts: scenes });
  const recs = pip.parseImagePrompts(content, 3, { projectId: 'demo', nowIso: 'T' });
  assert.equal(recs.length, 3);
  recs.forEach((r) => {
    assert.match(r.prompt, FULL_SCREEN);
    assert.match(r.prompt, VERTICAL);
    assertClean(r.prompt, 'project normalized prompt');
  });
  // Preserved: the anti-text doctrine still rides on every prompt.
  assert.ok(recs.every((r) => /no readable text/i.test(r.prompt)), 'anti-text preserved');
});

// ── Preserved parsing contract ──────────────────────────────────────────────────

test('full-screen: strict-JSON prompt parsing contract is unchanged', () => {
  const out = sfPrompts.parsePromptArray('["a full-frame vertical scene", "another distinct vertical scene"]', 8);
  assert.deepEqual(out, ['a full-frame vertical scene', 'another distinct vertical scene']);
});
