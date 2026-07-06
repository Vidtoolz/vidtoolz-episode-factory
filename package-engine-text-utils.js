'use strict';

// Pure text / markdown formatting helpers extracted from package-engine-server.js.
//
// These functions depend only on their arguments and the JS standard library
// (no module-level state, no I/O, no other package-engine functions), so they
// are safe to share and to unit-test in isolation. Behaviour is identical to
// the original in-server definitions; this is a maintainability extraction, not
// a behaviour change.

function slugify(value) {
  return String(value || 'thumbnail')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'thumbnail';
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownCell(value = '') {
  return String(value || '').trim().replace(/\r?\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ');
}

function markdownText(value = '', fallback = 'None reported.') {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return fallback;
  return text
    .split('\n')
    .map((line) => line.replace(/\|/g, '/').trimEnd())
    .join('\n');
}

function lineValue(markdown = '', label = '') {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(markdown || '').match(new RegExp(`^(?:[-*]\\s*)?${escaped}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

module.exports = {
  slugify,
  escapeXml,
  markdownCell,
  markdownText,
  lineValue,
};
