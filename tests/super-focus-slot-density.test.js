const { test, assert, fs, path } = require('./_helpers.js');

// ── Prompt-slot density (static page assertions) ─────────────────────────────
// Reimplements the unique intent of the 2026-07-09 usability stash with a
// hide-never-remove contract: every slot row stays in the DOM so the page's
// `.prompt-row` / `.pinput` scans, per-row ids, and media mounts keep working.
// These tests pin that contract.

function page() { return fs.readFileSync(path.join(__dirname, '..', 'super-focus.html'), 'utf8'); }
function densitySlice(html) {
  const start = html.indexOf('function applySlotDensity');
  assert.ok(start !== -1, 'applySlotDensity defined');
  const end = html.indexOf('function renderPromptGrid', start);
  assert.ok(end !== -1, 'density code precedes renderPromptGrid');
  return html.slice(start, end);
}

test('slot-density: hidden rows are class-hidden via CSS, never removed from the DOM', () => {
  const html = page();
  assert.ok(/\.prompt-row\.slot-hidden\s*\{\s*display:\s*none;?\s*\}/.test(html), 'slot-hidden CSS present');
  const slice = densitySlice(html);
  assert.ok(slice.includes("classList.toggle('slot-hidden'"), 'visibility is class-toggled');
  assert.ok(!/removeChild|\.remove\(\)|innerHTML/.test(slice), 'density code never removes rows or uses innerHTML');
});

test('slot-density: applied after every grid render and after per-row save/clear', () => {
  const html = page();
  const render = html.slice(html.indexOf('function renderPromptGrid'));
  const renderBody = render.slice(0, render.indexOf('function updateStaleBanner'));
  const calls = (renderBody.match(/applySlotDensity\(elId\)/g) || []).length;
  assert.ok(calls >= 3, `re-applied on render + save + clear (found ${calls} call sites)`);
});

test('slot-density: summary and toggle render via textContent and stay session-only', () => {
  const slice = densitySlice(page());
  assert.ok(slice.includes('slots filled'), 'summary copy present');
  assert.ok(slice.includes('Show all slots') && slice.includes('Hide trailing empty slots'), 'toggle labels');
  assert.ok(!/localStorage|apiPost|fetch\(/.test(slice), 'density is session-only UI: no persistence, no API');
  assert.ok((slice.match(/textContent/g) || []).length >= 2, 'labels set via textContent');
});

test('slot-density: documented in the authoritative Super Focus doc', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'super-focus.md'), 'utf8');
  assert.ok(doc.includes('Prompt-slot density'), 'docs section present');
  assert.ok(doc.includes('Show all slots'), 'docs name the toggle');
});

// ── Slice B: narrow-viewport layout ──────────────────────────────────────────

test('slice-b: 640px media query adjusts wrap, topbar, and prompt-row layout only', () => {
  const html = page();
  // Anchor on the slice-B marker: the page has an unrelated, earlier 640px
  // media query for the landing grid.
  const marker = html.indexOf('/* Narrow-viewport layout (slice B');
  assert.ok(marker !== -1, 'slice-B marker present');
  const start = html.indexOf('@media (max-width: 640px)', marker);
  assert.ok(start !== -1, 'narrow-viewport media query present after marker');
  const block = html.slice(start, html.indexOf('}', html.indexOf('.pctrl .btn', start)) + 1);
  assert.ok(block.includes('.wrap {'), 'wrap padding adapts');
  assert.ok(block.includes('.topbar {'), 'topbar stacks');
  assert.ok(block.includes('.prompt-row {') && block.includes('grid-template-columns: 28px 1fr'), 'prompt rows narrow to two columns');
  assert.ok(block.includes('.prompt-row .pctrl {'), 'row controls reflow horizontally');
});

// ── Slice C: prerequisite-aware generate buttons ─────────────────────────────

function prereqSlice(html) {
  const start = html.indexOf('function updatePrereqButtons');
  assert.ok(start !== -1, 'updatePrereqButtons defined');
  const end = html.indexOf('// ---- Prompt-slot density', start);
  assert.ok(end !== -1, 'prereq code precedes density code');
  return html.slice(start, end);
}

test('slice-c: prerequisite gating reads persisted state and gives a reason per disabled button', () => {
  const html = page();
  const slice = prereqSlice(html);
  assert.ok(slice.includes('lastSavedTitle') && slice.includes('lastSavedScript'), 'gates on PERSISTED title/script, not input values');
  assert.ok(!/apiPost|fetch\(|localStorage/.test(slice), 'affordance only — no API calls, no persistence');
  for (const id of ['script-generate', 'imgp-generate', 'imggen-generate']) {
    assert.ok(slice.includes(`'${id}'`), `${id} gated`);
  }
  assert.ok(slice.includes('Save a title first') && slice.includes('Save a script first')
    && slice.includes('at least one image prompt'), 'every disabled state carries a reason tooltip');
  assert.ok(html.includes("lastSavedTitle = proj.title || ''"), 'persisted title tracked on open/save');
});

test('slice-c: gating re-applies on open, title save, script save, row save/clear, and idle status polls', () => {
  const html = page();
  const calls = (html.match(/updatePrereqButtons\(\)/g) || []).length;
  assert.ok(calls >= 6, `re-applied at all state-change sites (found ${calls})`);
  assert.ok(/if \(!active && !d\.busy_elsewhere\) updatePrereqButtons\(\)/.test(html),
    'idle status polls defer to prerequisite gating instead of unconditionally re-enabling');
});
