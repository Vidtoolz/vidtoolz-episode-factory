const { test, assert } = require("./_helpers.js");
const ev = require("../script-evaluator.js");

// Build a complete, well-formed model output for the given sentence ids so
// normalize/score tests start from a valid baseline and vary one thing.
function fullModelOutput(sentenceIds, over) {
  const categories = ev.CATEGORIES.map((c) => ({
    id: c.id, score: 100, status: "pass", positives: ["p"], negatives: [], recommendation: "keep it",
  }));
  const hard_gates = ev.HARD_GATES.map((g) => ({ id: g.id, status: "pass", reason: "ok", suggested_fix: "" }));
  const checklist = ev.CHECKLIST.map((c) => ({ id: c.id, status: "pass", reason: "ok" }));
  const sentences = (sentenceIds || []).map((sid) => ({
    sentence_id: sid, role: "claim", score: 90, status: "strong",
    positives: ["clear claim"], negatives: [],
    highlighted_phrases: [{ text: "sharper way to think", type: "positive", reason: "on-brand" }],
    edit_suggestion: "keep", optional_rewrite: "",
  }));
  return Object.assign({
    summary: "solid", categories, hard_gates, checklist, sentences,
    top_strengths: ["spine"], top_problems: [], fix_plan: ["ship it"], next_edit: "nothing",
  }, over || {});
}

// (1) stable sentence IDs
test("script-eval: sentence splitter is deterministic with stable 1..N ids", () => {
  const s = "The plate did not render. So I built a gate.\nNow every clip passes it.";
  const a = ev.splitScriptIntoSentences(s);
  const b = ev.splitScriptIntoSentences(s);
  assert.deepEqual(a.map((x) => x.sentence_id), b.map((x) => x.sentence_id));
  assert.deepEqual(a.map((x) => x.sentence_id), [1, 2, 3]);
  assert.equal(a[0].text, "The plate did not render.");
  assert.equal(a[2].text, "Now every clip passes it.");
  assert.deepEqual(ev.splitScriptIntoSentences("").length ? "nonempty" : "empty", "empty");
});

// (2) prompt contains rubric, weights, hard gates, and sentence IDs
test("script-eval: prompt includes standard, rubric+weights, hard gates, and sentence ids", () => {
  const sentences = ev.splitScriptIntoSentences("A sharp claim. A second line.");
  const req = ev.buildScriptEvaluationPrompt("A sharp claim. A second line.", sentences, {});
  assert.match(req.user, /sharper way to think AND gives the production system clear things to build/);
  assert.match(req.user, /core_claim.*weight 15/);
  assert.match(req.user, /production_feasibility.*weight 10/);
  assert.match(req.user, /central_claim_one_sentence/);
  assert.match(req.user, /speakable_naturally/);
  assert.match(req.user, /generates_useful_visuals/);
  assert.match(req.user, /Do NOT pretend to verify the internet|Anti-fact-checking/i);
  assert.match(req.user, /PENALIZE generic glowing-AI/i);
  assert.match(req.user, /"sentence_id":1/); // deterministic id list embedded
  assert.match(req.user, /put the EXACT id shown above in an "id" field/i);
  assert.match(req.user, /Do not invent extra sentence IDs/i);
  assert.ok(req.schema && req.schema.type === "object");
});

// (3) strict JSON parse
test("script-eval: parser accepts clean strict JSON", () => {
  const out = ev.parseScriptEvaluationOutput(JSON.stringify({ categories: [], sentences: [], next_edit: "x" }));
  assert.equal(out.next_edit, "x");
});

// (4) fenced JSON parse
test("script-eval: parser strips ```json fences", () => {
  const out = ev.parseScriptEvaluationOutput("```json\n{\"fix_plan\":[\"a\"],\"next_edit\":\"y\"}\n```");
  assert.deepEqual(out.fix_plan, ["a"]);
});

// (5) <think> stripping (and leading prose + unwrap wrapper key)
test("script-eval: parser strips <think> and unwraps a single wrapper key", () => {
  const raw = "<think>let me reason...</think>\nHere is the result:\n{ \"evaluation\": { \"categories\": [], \"next_edit\": \"z\" } }";
  const out = ev.parseScriptEvaluationOutput(raw);
  assert.equal(out.next_edit, "z");
});

// (6) unparseable output rejection
test("script-eval: parser rejects unparseable output with 502 and writes nothing", () => {
  assert.throws(() => ev.parseScriptEvaluationOutput("the model is thinking out loud, no json here"),
    (e) => e.statusCode === 502);
  assert.throws(() => ev.parseScriptEvaluationOutput("{ not: valid json at all "),
    (e) => e.statusCode === 502);
  // A JSON object that is clearly not an evaluation is also rejected.
  assert.throws(() => ev.parseScriptEvaluationOutput(JSON.stringify({ hello: "world" })),
    (e) => e.statusCode === 502);
});

// (7) invented sentence IDs ignored (with warning)
test("script-eval: normalizer ignores invented sentence ids and warns", () => {
  const sentences = ev.splitScriptIntoSentences("One. Two.");
  const parsed = fullModelOutput([1, 2, 99]); // 99 is invented
  const norm = ev.normalizeScriptEvaluation(parsed, sentences);
  assert.deepEqual(norm.sentences.map((s) => s.sentence_id), [1, 2]);
  assert.ok(norm.warnings.some((w) => /invented sentence id 99/.test(w)));
});

// (8) missing sentence IDs create warnings + unevaluated rows
test("script-eval: normalizer marks omitted sentences unevaluated with a warning", () => {
  const sentences = ev.splitScriptIntoSentences("One. Two. Three.");
  const parsed = fullModelOutput([1, 3]); // sentence 2 omitted
  const norm = ev.normalizeScriptEvaluation(parsed, sentences);
  const two = norm.sentences.find((s) => s.sentence_id === 2);
  assert.equal(two.status, "unevaluated");
  assert.equal(two.text, "Two."); // backend text authoritative
  assert.ok(norm.warnings.some((w) => /sentence 2 was not evaluated/.test(w)));
});

// (9) weight math
test("script-eval: scorer applies category weights (sum 100) correctly", () => {
  const sentences = ev.splitScriptIntoSentences("Hook. Claim.");
  // All 100 -> total 100 -> PRODUCE.
  const allHundred = ev.scoreScriptEvaluation(ev.normalizeScriptEvaluation(fullModelOutput([1, 2]), sentences));
  assert.equal(allHundred.total_score, 100);
  assert.equal(allHundred.verdict, "PRODUCE");
  assert.equal(allHundred.score_band, "PRODUCE");
  // core_claim (weight 15) at 0 -> total 85 -> PRODUCE (minor edits band).
  const dropCore = fullModelOutput([1, 2]);
  dropCore.categories = dropCore.categories.map((c) => (c.id === "core_claim" ? Object.assign({}, c, { score: 0 }) : c));
  const scored = ev.scoreScriptEvaluation(ev.normalizeScriptEvaluation(dropCore, sentences));
  assert.equal(scored.total_score, 85);
  assert.equal(scored.score_band, "PRODUCE_MINOR_EDITS");
  assert.equal(scored.verdict, "PRODUCE");
  // channel_fit (weight 15) at 50 -> weighted 7.5.
  const cf = scored.categories.find((c) => c.id === "channel_fit");
  assert.equal(cf.weighted_score, 15); // still 100 in this fixture
  const half = fullModelOutput([1, 2]);
  half.categories = half.categories.map((c) => (c.id === "channel_fit" ? Object.assign({}, c, { score: 50 }) : c));
  const halfScored = ev.scoreScriptEvaluation(ev.normalizeScriptEvaluation(half, sentences));
  assert.equal(halfScored.categories.find((c) => c.id === "channel_fit").weighted_score, 7.5);
});

// (10) hard-gate failure caps verdict at REVISE (or worse), regardless of score
test("script-eval: a failing hard gate caps a PRODUCE score at REVISE", () => {
  const sentences = ev.splitScriptIntoSentences("Hook. Claim.");
  const parsed = fullModelOutput([1, 2]); // all 100 -> would be PRODUCE
  parsed.hard_gates = parsed.hard_gates.map((g) =>
    (g.id === "generates_useful_visuals" ? Object.assign({}, g, { status: "fail", reason: "generic robots", suggested_fix: "rewrite beats" }) : g));
  const scored = ev.scoreScriptEvaluation(ev.normalizeScriptEvaluation(parsed, sentences));
  assert.equal(scored.total_score, 100);
  assert.equal(scored.verdict, "REVISE", "PRODUCE capped to REVISE by failing gate");
  assert.equal(scored.verdict_capped_by_gate, true);
  assert.ok(scored.warnings.some((w) => /capped at REVISE.*generates_useful_visuals/.test(w)));
});

// (11) robustness: categories keyed by "name" (not "id") are still matched.
// Real qwen3:14b output uses {"name":"core_claim",...}; the old normalizer keyed
// only on "id" and silently scored every category 0 -> a false REWRITE/0.
test("script-eval: normalizer matches categories keyed by name (not id)", () => {
  const sentences = ev.splitScriptIntoSentences("Hook. Claim.");
  const parsed = fullModelOutput([1, 2]);
  // Re-key every category object from id -> name, dropping id entirely.
  parsed.categories = parsed.categories.map((c) => {
    const { id, ...rest } = c; return Object.assign({ name: id }, rest);
  });
  const scored = ev.scoreScriptEvaluation(ev.normalizeScriptEvaluation(parsed, sentences));
  assert.equal(scored.total_score, 100, "name-keyed categories score normally");
  assert.equal(scored.verdict, "PRODUCE");
  assert.ok(!scored.warnings.some((w) => /missing from model output/.test(w)), "no false 'missing category' warnings");
});

// (12) robustness: hard_gates returned positionally with NO id field.
// Real qwen3:14b output returns [{status,reason,suggested_fix}, ...] in the
// canonical gate order. Positional fallback must align them to the 3 gates.
test("script-eval: normalizer aligns positional (id-less) hard_gates by order", () => {
  const sentences = ev.splitScriptIntoSentences("Hook. Claim.");
  const parsed = fullModelOutput([1, 2]);
  parsed.hard_gates = [
    { status: "pass", reason: "one sentence", suggested_fix: "" },
    { status: "pass", reason: "reads aloud", suggested_fix: "" },
    { status: "fail", reason: "generic robots", suggested_fix: "name a concrete object" },
  ];
  const norm = ev.normalizeScriptEvaluation(parsed, sentences);
  assert.deepEqual(norm.hard_gates.map((g) => g.id),
    ["central_claim_one_sentence", "speakable_naturally", "generates_useful_visuals"]);
  assert.deepEqual(norm.hard_gates.map((g) => g.status), ["pass", "pass", "fail"]);
  assert.equal(norm.hard_gates[2].suggested_fix, "name a concrete object");
  assert.ok(!norm.warnings.some((w) => /hard gate .* missing/.test(w)), "no false 'missing gate' warnings");
  // And the failing gate still caps the verdict.
  const scored = ev.scoreScriptEvaluation(norm);
  assert.equal(scored.verdict, "REVISE");
  assert.equal(scored.verdict_capped_by_gate, true);
});

// (13) robustness: checklist keyed by "item" (not "id"). Old code defaulted all
// 10 items to "warn" with no warning; the model's real statuses were dropped.
test("script-eval: normalizer matches checklist keyed by item (not id)", () => {
  const sentences = ev.splitScriptIntoSentences("Hook. Claim.");
  const parsed = fullModelOutput([1, 2]);
  parsed.checklist = parsed.checklist.map((c, i) => ({ item: c.id, status: i === 0 ? "fail" : "pass", reason: "r" }));
  const norm = ev.normalizeScriptEvaluation(parsed, sentences);
  assert.equal(norm.checklist[0].status, "fail", "model's real status is used, not the 'warn' default");
  assert.ok(norm.checklist.slice(1).every((c) => c.status === "pass"));
});

// (14) partial keying must NOT trigger positional fallback (avoid mis-alignment):
// if the model keyed some categories, an absent id genuinely means "missing".
test("script-eval: keyed lists do not fall back to positional alignment", () => {
  const sentences = ev.splitScriptIntoSentences("Hook. Claim.");
  const parsed = fullModelOutput([1, 2]);
  // Keep ids on all but core_claim; give core_claim a bogus id. It must be
  // reported missing (score 0), NOT positionally back-filled from array[0].
  parsed.categories = parsed.categories.map((c) =>
    (c.id === "core_claim" ? Object.assign({}, c, { id: "totally_made_up", score: 100 }) : c));
  const scored = ev.scoreScriptEvaluation(ev.normalizeScriptEvaluation(parsed, sentences));
  const core = scored.categories.find((c) => c.id === "core_claim");
  assert.equal(core.score, 0);
  assert.ok(scored.warnings.some((w) => /category "core_claim" missing/.test(w)));
});

// bonus: end-to-end with a stubbed provider (no network) + empty-script guard
test("script-eval: evaluateScriptWithProvider runs the pure pipeline with a stub generate", async () => {
  const script = "The plate did not render. So I built a gate.";
  const sentences = ev.splitScriptIntoSentences(script);
  const generate = async () => JSON.stringify(fullModelOutput(sentences.map((s) => s.sentence_id)));
  const result = await ev.evaluateScriptWithProvider({ scriptText: script, generate, options: { now: "2026-07-09T00:00:00Z", model: { provider: "ollama" } } });
  assert.equal(result.schema_version, ev.SCHEMA_VERSION);
  assert.equal(result.verdict, "PRODUCE");
  assert.equal(result.evaluated_at, "2026-07-09T00:00:00Z");
  assert.equal(result.script_hash, ev.hashScriptText(script));
  assert.equal(result.sentences.length, sentences.length);
  // empty script is rejected before any provider call
  let called = false;
  await assert.rejects(
    () => ev.evaluateScriptWithProvider({ scriptText: "   ", generate: async () => { called = true; return "{}"; } }),
    (e) => e.statusCode === 400
  );
  assert.equal(called, false, "provider not called for empty script");
});
