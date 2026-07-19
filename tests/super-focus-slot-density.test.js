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
