# Final Script

- Run: 2026-08-25-lifecycle-integration-canary-canary-not-for-publication
- CANARY — NOT FOR PUBLICATION. This script exists so the canonical lifecycle
  has real script content to review. It is not editorial work and will not ship.

## Hook

Your production system can describe where a run is. The question is whether every
part of it describes the same place.

## Viewer Problem

A production pipeline usually grows several ways to answer one question: what
stage is this in? A gate engine says one thing, a UI tracker says another, a
durable status file says a third. Each looks reasonable alone. Together they let
work appear further along than the evidence supports.

## The Point

One authority answers that question. Everything else is a view of that answer.

## Evidence

The research for this run cites three in-repository sources: the gate engine that
defines the fourteen canonical gates, the authority document that records which
surfaces are views rather than authorities, and a recorded proof artifact showing
a contradiction between a gate and a display being detected and closed. Those
citations are listed in source-support-map.md.

## What This Run Demonstrates

This package run moved through real gates using real evidence. Where evidence was
missing, the gate held. Where a human decision was required, the run stopped and
waited for it. That behaviour is the subject of this script.

## Close

A detailed view is useful. A second authority is not.

## Final Packaging Check

- Title and thumbnail assumptions verified: not applicable, this run does not ship.
- Claims in the script map to entries in source-support-map.md.
