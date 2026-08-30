'use strict';

/*
 * Same-Story successor runs (V2-SUCCESSOR-STRATEGY): a V2 draft of the same
 * Story is a CLEARLY LINKED SUCCESSOR RUN — never an overwrite. The
 * predecessor's rendered draft is permanent A/B evidence; this module builds
 * and verifies the typed link and proves the predecessor is byte-frozen.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SUCCESSOR_SCHEMA = 'vidtoolz.visualDraftSuccessor.v1';

class SuccessorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SuccessorError';
    this.code = code;
  }
}
function fail(code, message) { throw new SuccessorError(code, message); }

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/*
 * Build the successor link. The predecessor output is hashed HERE, from disk,
 * so the link is evidence, not a claim.
 */
function buildSuccessorLink({ predecessorRunDir, predecessorOutputRelative, successorRunId, successorOutputName, story }) {
  if (!predecessorRunDir || !fs.existsSync(predecessorRunDir)) fail('SUCCESSOR_PREDECESSOR_MISSING', String(predecessorRunDir));
  const predecessorRunId = path.basename(path.resolve(predecessorRunDir));
  if (!successorRunId || successorRunId === predecessorRunId) fail('SUCCESSOR_RUN_ID_INVALID', 'a successor is a NEW run');
  const outputPath = path.join(predecessorRunDir, predecessorOutputRelative);
  if (!fs.existsSync(outputPath)) fail('SUCCESSOR_PREDECESSOR_OUTPUT_MISSING', outputPath);
  if (!successorOutputName || successorOutputName === path.basename(predecessorOutputRelative)) fail('SUCCESSOR_OUTPUT_NAME_INVALID', 'the successor output must not shadow the predecessor output');
  if (!story?.project_id || !story.version_id || !/^[a-f0-9]{64}$/.test(story.content_hash || '')) fail('SUCCESSOR_STORY_REQUIRED', 'same-Story linkage requires the exact Story identity');
  return {
    schema: SUCCESSOR_SCHEMA,
    predecessor_run_id: predecessorRunId,
    predecessor_output: {
      relative_path: predecessorOutputRelative,
      sha256: sha256File(outputPath),
      bytes: fs.statSync(outputPath).size,
    },
    predecessor_frozen: true,
    successor_run_id: successorRunId,
    successor_output_name: successorOutputName,
    same_story: { project_id: story.project_id, version_id: story.version_id, content_hash: story.content_hash },
    forbidden: ['overwrite predecessor', 'rerender predecessor', 'rename predecessor', 'rewrite predecessor manifests/QC/evidence/review binding'],
  };
}

/* Re-hash the predecessor output and require an exact byte match. */
function verifyPredecessorFrozen(link, predecessorRunDir) {
  if (link?.schema !== SUCCESSOR_SCHEMA) fail('SUCCESSOR_SCHEMA_INVALID', String(link?.schema));
  const outputPath = path.join(predecessorRunDir, link.predecessor_output.relative_path);
  if (!fs.existsSync(outputPath)) fail('SUCCESSOR_FREEZE_VIOLATED', `predecessor output vanished: ${outputPath}`);
  const sha = sha256File(outputPath);
  if (sha !== link.predecessor_output.sha256) fail('SUCCESSOR_FREEZE_VIOLATED', `predecessor bytes changed: ${sha}`);
  if (fs.statSync(outputPath).size !== link.predecessor_output.bytes) fail('SUCCESSOR_FREEZE_VIOLATED', 'predecessor size changed');
  return { frozen: true, sha256: sha };
}

module.exports = { SUCCESSOR_SCHEMA, SuccessorError, buildSuccessorLink, verifyPredecessorFrozen };
