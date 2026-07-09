'use strict';

// Pure prompt-builder + tolerant parser for the Script Evaluator rewrite step.
// No network here — the server injects the local-Ollama call. The rewrite takes
// the original script plus the structured evaluation and returns a full
// corrected script that keeps approved parts and fixes disapproved ones, in the
// channel's blunt spoken voice, without inventing facts.

function asStr(v) { return typeof v === 'string' ? v.trim() : ''; }
function asList(v) { return (Array.isArray(v) ? v : []).map(asStr).filter(Boolean); }

const REWRITE_SYSTEM =
  'You are rewriting a short-form video script for a creator who makes blunt, funny, ' +
  'informative ~3-minute vertical explainers about AI-native video production systems ' +
  'for serious solo creators. You are given the original script and a structured ' +
  'evaluation. Keep the passages the evaluation approved where they work. Fix the ' +
  'passages it disapproved using the given suggestions. Preserve the intended topic ' +
  'and the spoken voice: blunt, conversational, funny, practical — like talking to a ' +
  'friend, never a blog post or LinkedIn. Do NOT add unsupported factual claims, ' +
  'invented stats, or hype. Keep it speakable and suitable for a ~3-minute vertical ' +
  'video. Return ONLY strict JSON matching the schema — no preamble, no markdown fences.';

function rewriteSchema() {
  return {
    type: 'object',
    properties: {
      corrected_script: { type: 'string' },
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['corrected_script'],
  };
}

// Build the {system, user, schema} prompt from the original script + evaluation.
function buildRewritePrompt(script, evaluation) {
  const ev = evaluation && typeof evaluation === 'object' ? evaluation : {};
  const disapproved = (Array.isArray(ev.sentences) ? ev.sentences : [])
    .filter((s) => s && (s.status === 'revise' || s.status === 'cut'))
    .map((s) => {
      const bad = asStr(s.text);
      const why = asList(s.negatives)[0] || asStr(s.edit_suggestion) || 'weak';
      const fix = asStr(s.edit_suggestion) || asStr(s.optional_rewrite);
      return `- "${bad}" → problem: ${why}${fix ? `; fix: ${fix}` : ''}`;
    });
  const approved = (Array.isArray(ev.sentences) ? ev.sentences : [])
    .filter((s) => s && (s.status === 'strong' || s.status === 'okay'))
    .map((s) => `- "${asStr(s.text)}"`);
  const user = [
    'THE VIDTOOLZ STANDARD: a script is good when it gives the viewer a sharper way to think AND gives the production system clear things to build.',
    ev.summary ? `\nEVALUATION SUMMARY:\n${asStr(ev.summary)}` : '',
    disapproved.length ? `\nDISAPPROVED PASSAGES (fix these):\n${disapproved.join('\n')}` : '',
    approved.length ? `\nAPPROVED PASSAGES (keep where they work):\n${approved.slice(0, 40).join('\n')}` : '',
    asList(ev.fix_plan).length ? `\nFIX PLAN (highest-leverage first):\n${asList(ev.fix_plan).map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
    asStr(ev.next_edit) ? `\nMOST IMPORTANT SINGLE EDIT:\n${asStr(ev.next_edit)}` : '',
    '\nORIGINAL SCRIPT:\n',
    String(script == null ? '' : script).trim(),
    '\nReturn ONLY strict JSON: { "corrected_script": "<full rewritten script>", "notes": ["what changed and why", ...] }.',
  ].filter(Boolean).join('\n');
  return { system: REWRITE_SYSTEM, user, schema: rewriteSchema() };
}

function stripThinkingAndFences(raw) {
  let text = String(raw == null ? '' : raw);
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<think>[\s\S]*$/i, '');
  text = text.replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, '$1');
  text = text.replace(/```/g, '');
  return text.trim();
}

function firstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

// Tolerant parse of the rewrite output. Accepts strict JSON, fenced JSON, a
// <think>…</think> preamble, or a single wrapper key. Also accepts a plain-text
// body as the corrected script (last-resort) so a model that ignores the schema
// but returns a usable script is not wasted. Throws 502 only when there is no
// usable corrected script at all.
function parseRewriteOutput(raw) {
  const text = stripThinkingAndFences(raw);
  let obj = null;
  try { obj = JSON.parse(text); } catch (_) { /* fall through */ }
  if (!obj) { const b = firstBalancedObject(text); if (b) { try { obj = JSON.parse(b); } catch (_) {} } }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    if (typeof obj.corrected_script !== 'string' && obj.evaluation && typeof obj.evaluation === 'object') obj = obj.evaluation;
    const cs = typeof obj.corrected_script === 'string' ? obj.corrected_script
      : (typeof obj.script === 'string' ? obj.script : (typeof obj.rewrite === 'string' ? obj.rewrite : null));
    if (cs && cs.trim()) {
      return { corrected_script: cs, notes: asList(obj.notes) };
    }
  }
  // Last resort: a non-JSON body with real prose is treated as the script.
  if (text && !/^[\s{[]*$/.test(text) && text.replace(/\s+/g, ' ').length > 20) {
    return { corrected_script: text, notes: [] };
  }
  const e = new Error('The model did not return a usable corrected script.');
  e.statusCode = 502;
  throw e;
}

module.exports = {
  REWRITE_SYSTEM,
  rewriteSchema,
  buildRewritePrompt,
  parseRewriteOutput,
};
