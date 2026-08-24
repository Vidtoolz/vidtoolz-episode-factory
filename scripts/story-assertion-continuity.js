'use strict';

function normalizeAssertionText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function sentenceUnits(value) {
  const text = normalizeAssertionText(value);
  if (!text.trim()) return [];
  if (typeof Intl?.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return [...segmenter.segment(text)].map((entry) => normalizeAssertionText(entry.segment)).filter(Boolean);
  }
  return text.split(/(?<=[.!?])\s+/u).map(normalizeAssertionText).filter(Boolean);
}

function containingUnits(sectionText, assertionText) {
  const assertion = normalizeAssertionText(assertionText);
  if (!assertion) return [];
  return sentenceUnits(sectionText).filter((unit) => unit.includes(assertion));
}

function assertionContinuity(sourceText, candidateText, assertionText) {
  const source = containingUnits(sourceText, assertionText);
  const candidate = containingUnits(candidateText, assertionText);
  const retained = source.length === 1 && candidate.length === 1 && source[0] === candidate[0];
  return { retained, source_units: source, candidate_units: candidate };
}

function normalizedAssertionOccurrences(sectionText, assertionText) {
  const assertion = normalizeAssertionText(assertionText);
  if (!assertion) return 0;
  return sentenceUnits(sectionText).filter((unit) => unit.includes(assertion)).length;
}

module.exports = { normalizeAssertionText, sentenceUnits, containingUnits, assertionContinuity, normalizedAssertionOccurrences };
