'use strict';

/*
 * Retrospective AIGEN authority reconstruction.
 *
 * This module never edits a script package and never creates authority-chain.json.
 * Legacy artifacts remain in script-packages/<id>; new operator decisions live in
 * the separate aigen/authority-review/<id> namespace. Decisions are append-only,
 * hash-chained, and bound to both the reviewed artifact and its exact upstream
 * authority. Currentness and invalidation are derived on every read.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const authority = require('./aigen-authority-chain.js');
const visualPlan = require('./super-focus-visual-plan.js');

const SCHEMA_VERSION = 1;
const TOOL_VERSION = 'aigen-authority-review/1';
const WORKSPACE_FILE = 'workspace.json';
const ASSIGNMENTS_FILE = 'proposed-assignments.json';
const DECISIONS_FILE = 'decisions.json';
const DECISIONS = ['approved', 'rejected', 'requires_rework'];
const DECISION_TYPES = ['script', 'assignment', 'image_prompt', 'selected_image', 'i2v_prompt', 'clip', 'handoff'];
const SLOT_STAGE_TYPES = ['assignment', 'image_prompt', 'selected_image', 'i2v_prompt', 'clip'];
const HASH_RE = /^[a-f0-9]{64}$/;
const PACKAGE_RE = /^[A-Za-z0-9._-]+$/;
const ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const NOTE_MAX = 2000;
const OPERATOR_MAX = 120;
const PURPOSE_MAX = 600;

function reviewError(message, code = 'AUTHORITY_REVIEW_INVALID', statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function stableHash(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedString(value, label, max, options = {}) {
  if (typeof value !== 'string') throw reviewError(`${label} must be a string.`, 'AUTHORITY_REVIEW_FIELD_INVALID', 400);
  const clean = value.trim();
  if (options.required && !clean) throw reviewError(`${label} is required.`, 'AUTHORITY_REVIEW_FIELD_INVALID', 400);
  if (clean.length > max) throw reviewError(`${label} exceeds ${max} characters.`, 'AUTHORITY_REVIEW_FIELD_INVALID', 400);
  return clean;
}

function assertHash(value, label) {
  if (!HASH_RE.test(String(value || ''))) {
    throw reviewError(`${label} must be a lowercase 64-hex SHA-256.`, 'AUTHORITY_REVIEW_HASH_INVALID', 422);
  }
  return value;
}

function assertPackageId(value) {
  const id = String(value || '');
  if (!PACKAGE_RE.test(id)) throw reviewError('Invalid package ID.', 'AUTHORITY_REVIEW_PACKAGE_INVALID', 400);
  return id;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw reviewError(`Could not persist retrospective review state: ${error.message}`, 'AUTHORITY_REVIEW_WRITE_FAILED', 500);
  }
}

function readJsonStrict(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw reviewError(`${label} is missing.`, 'AUTHORITY_REVIEW_STATE_MISSING', 404);
    throw reviewError(`${label} could not be read.`, 'AUTHORITY_REVIEW_STATE_UNREADABLE', 500);
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw reviewError(`${label} is corrupt JSON; refusing to treat it as empty.`, 'AUTHORITY_REVIEW_STATE_CORRUPT', 422);
  }
}

function reviewPaths(reviewDir) {
  const root = path.resolve(reviewDir);
  return {
    root,
    workspace: path.join(root, WORKSPACE_FILE),
    assignments: path.join(root, ASSIGNMENTS_FILE),
    decisions: path.join(root, DECISIONS_FILE),
  };
}

function fileIdentity(packageDir, relativePath) {
  const snapshot = authority.fileSnapshot(packageDir, relativePath);
  return {
    artifact_type: path.extname(snapshot.path).toLowerCase() === '.mp4' ? 'video_file' : 'file',
    artifact_path: snapshot.path,
    artifact_sha256: snapshot.sha256,
    size_bytes: snapshot.size_bytes,
  };
}

function readPackageJson(packageDir, relativePath, label) {
  const target = path.join(packageDir, relativePath);
  const parsed = readJsonStrict(target, label || relativePath);
  if (!isPlainObject(parsed)) {
    throw reviewError(`${label || relativePath} must be a JSON object.`, 'AUTHORITY_REVIEW_LEGACY_CORRUPT', 422);
  }
  return parsed;
}

function rowIdentity(relativePath, selector, row, artifactType) {
  return {
    artifact_type: artifactType,
    artifact_path: `${relativePath}#${selector}`,
    artifact_sha256: stableHash(row),
  };
}

function textIdentity(relativePath, selector, text, artifactType, extra = {}) {
  return {
    artifact_type: artifactType,
    artifact_path: `${relativePath}#${selector}`,
    artifact_sha256: sha256(Buffer.from(String(text), 'utf8')),
    text: String(text),
    ...extra,
  };
}

function findBySlot(items, keys, slot, label) {
  const matches = items.filter((item) => {
    if (!isPlainObject(item)) return false;
    const raw = keys.map((key) => item[key]).find((value) => value != null);
    return Number(raw) === slot;
  });
  if (matches.length !== 1) {
    throw reviewError(`${label} slot ${slot} has ${matches.length} records; exactly one is required.`, 'AUTHORITY_REVIEW_SLOT_AMBIGUOUS', 422);
  }
  return matches[0];
}

function validatePassage(scriptText, scriptHash, slot, proposal) {
  if (!isPlainObject(proposal)) throw reviewError(`Slot ${slot} proposal must be an object.`, 'AUTHORITY_REVIEW_ASSIGNMENT_INVALID', 422);
  const start = Number(proposal.start_char);
  const end = Number(proposal.end_char);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > scriptText.length || start >= end) {
    throw reviewError(`Slot ${slot} passage offsets are outside the final script.`, 'AUTHORITY_REVIEW_ASSIGNMENT_INVALID', 422);
  }
  if (!visualPlan.isSurrogateSafe(scriptText, start) || !visualPlan.isSurrogateSafe(scriptText, end)) {
    throw reviewError(`Slot ${slot} passage offsets split a Unicode surrogate pair.`, 'AUTHORITY_REVIEW_ASSIGNMENT_INVALID', 422);
  }
  const exact = scriptText.slice(start, end);
  if (!exact.trim()) throw reviewError(`Slot ${slot} passage is empty.`, 'AUTHORITY_REVIEW_ASSIGNMENT_INVALID', 422);
  if (proposal.exact_text != null && proposal.exact_text !== exact) {
    throw reviewError(`Slot ${slot} proposed passage text does not match its offsets.`, 'AUTHORITY_REVIEW_ASSIGNMENT_STALE', 409);
  }
  const textHash = sha256(Buffer.from(exact, 'utf8'));
  if (proposal.selected_text_sha256 != null && proposal.selected_text_sha256 !== textHash) {
    throw reviewError(`Slot ${slot} proposed passage hash is stale.`, 'AUTHORITY_REVIEW_ASSIGNMENT_STALE', 409);
  }
  return {
    slot_id: slot,
    final_script_sha256: scriptHash,
    offset_encoding: 'utf16_code_units',
    start_char: start,
    end_char: end,
    exact_text: exact,
    selected_text_sha256: textHash,
    communicative_purpose: boundedString(
      proposal.communicative_purpose || '',
      `slot ${slot} communicative_purpose`,
      PURPOSE_MAX,
      { required: true },
    ),
    forensic_confidence: boundedString(
      proposal.forensic_confidence || 'ambiguous',
      `slot ${slot} forensic_confidence`,
      80,
      { required: true },
    ),
    forensic_warning: boundedString(
      proposal.forensic_warning || '',
      `slot ${slot} forensic_warning`,
      1000,
    ),
  };
}

function passageArtifact(passage) {
  const value = {
    slot_id: passage.slot_id,
    final_script_sha256: passage.final_script_sha256,
    offset_encoding: passage.offset_encoding,
    start_char: passage.start_char,
    end_char: passage.end_char,
    exact_text: passage.exact_text,
    selected_text_sha256: passage.selected_text_sha256,
    communicative_purpose: passage.communicative_purpose,
  };
  return {
    artifact_type: 'script_to_slot_assignment',
    artifact_path: `review:slot:${passage.slot_id}:script-passage`,
    artifact_sha256: stableHash(value),
    value,
  };
}

function scriptUpstream(packageDir) {
  for (const relativePath of ['promoted-from-idea.json', 'selected-package.json', 'manifest.json']) {
    if (fs.existsSync(path.join(packageDir, relativePath))) {
      const file = fileIdentity(packageDir, relativePath);
      return {
        upstream_artifact_type: 'package_origin',
        upstream_identity: relativePath,
        upstream_sha256: file.artifact_sha256,
      };
    }
  }
  const id = path.basename(packageDir);
  return {
    upstream_artifact_type: 'package_identity',
    upstream_identity: `package:${id}`,
    upstream_sha256: sha256(Buffer.from(id, 'utf8')),
  };
}

function packageArtifactSnapshot(packageDir, slots, proposalBySlot, options = {}) {
  const packageId = path.basename(packageDir);
  const script = authority.finalScriptSnapshot(packageDir);
  const scriptText = fs.readFileSync(path.join(packageDir, script.path), 'utf8');
  const imagePromptsFile = readPackageJson(packageDir, 'image-prompts.json');
  const selectionsFile = readPackageJson(packageDir, 'selected-images.json');
  const videoPromptsFile = readPackageJson(packageDir, 'video-prompts.json');
  const handoffFile = readPackageJson(packageDir, path.join('resolve-handoff', 'media-manifest.json'));
  if (!Array.isArray(imagePromptsFile.image_prompts)
      || !Array.isArray(selectionsFile.selections)
      || !Array.isArray(videoPromptsFile.prompts)
      || !Array.isArray(handoffFile.clips)) {
    throw reviewError('Legacy package arrays are malformed; reconstruction cannot start.', 'AUTHORITY_REVIEW_LEGACY_CORRUPT', 422);
  }

  const slotRows = slots.map((slot) => {
    const imagePromptRow = findBySlot(imagePromptsFile.image_prompts, ['index', 'prompt_index'], slot, 'image prompt');
    const selectionRow = findBySlot(selectionsFile.selections, ['prompt_index', 'index'], slot, 'selection');
    const i2vRow = findBySlot(videoPromptsFile.prompts, ['prompt_index', 'index'], slot, 'I2V prompt');
    const handoffRow = findBySlot(handoffFile.clips, ['prompt_index', 'index'], slot, 'handoff');
    const selectedPath = String(selectionRow.selected_path || selectionRow.path || '');
    const image = fileIdentity(packageDir, selectedPath);
    image.artifact_type = 'selected_image';
    const clipPath = String(handoffRow.staged_video_relative_path || '');
    const clip = fileIdentity(packageDir, clipPath);
    clip.artifact_type = 'generated_clip';

    const canonicalPrompt = rowIdentity(
      'image-prompts.json',
      `image_prompts[index=${slot}]`,
      imagePromptRow,
      'image_prompt_record',
    );
    canonicalPrompt.text = String(imagePromptRow.prompt || '');

    // Slot 21's reconstructed prompt is the v2-specific text preserved on the
    // selection row. The canonical legacy image-prompts row remains untouched.
    const prompt = slot === 21 && String(selectionRow.prompt || '') !== canonicalPrompt.text
      ? textIdentity(
        'selected-images.json',
        `selections[prompt_index=${slot}].prompt`,
        String(selectionRow.prompt || ''),
        'reconstructed_image_prompt_text',
        { legacy_canonical_prompt: canonicalPrompt },
      )
      : canonicalPrompt;

    const i2vText = String(i2vRow.prompt || i2vRow.i2v_prompt || '');
    const i2v = textIdentity(
      'video-prompts.json',
      `prompts[prompt_index=${slot}].prompt`,
      i2vText,
      'i2v_prompt_text',
      {
        legacy_record_sha256: stableHash(i2vRow),
        legacy_source_image: String(i2vRow.source_image || ''),
      },
    );
    const handoff = rowIdentity(
      path.join('resolve-handoff', 'media-manifest.json'),
      `clips[prompt_index=${slot}]`,
      handoffRow,
      'resolve_handoff_entry',
    );
    handoff.position = Number(handoffRow.order);
    let passage;
    try {
      passage = validatePassage(scriptText, script.sha256, slot, proposalBySlot.get(slot));
    } catch (error) {
      if (!options.allowStaleAssignments) throw error;
      const saved = proposalBySlot.get(slot);
      if (!isPlainObject(saved)
          || saved.slot_id !== slot
          || !Number.isInteger(saved.start_char)
          || !Number.isInteger(saved.end_char)
          || typeof saved.exact_text !== 'string'
          || !HASH_RE.test(String(saved.final_script_sha256 || ''))
          || !HASH_RE.test(String(saved.selected_text_sha256 || ''))) {
        throw error;
      }
      // Preserve the previously proposed identity as evidence. Its old script
      // hash makes the reconstructed decision visibly stale; it is never
      // normalized onto the changed script.
      passage = {
        slot_id: slot,
        final_script_sha256: saved.final_script_sha256,
        offset_encoding: saved.offset_encoding,
        start_char: saved.start_char,
        end_char: saved.end_char,
        exact_text: saved.exact_text,
        selected_text_sha256: saved.selected_text_sha256,
        communicative_purpose: saved.communicative_purpose,
        forensic_confidence: saved.forensic_confidence,
        forensic_warning: saved.forensic_warning || '',
      };
    }
    const warnings = [];
    if (passage.forensic_warning) warnings.push(passage.forensic_warning);
    if (slot === 21) {
      warnings.push('The legacy I2V row still names the superseded original source path. Any reconstructed I2V approval must bind this text to exact v2 bytes.');
    }
    if (slot === 22) {
      warnings.push('Confirmed semantic mismatch: selected image/clip show a traveler and suitcase while the intended prompt requires an empty terminal/luggage-cart concept.');
    }
    const row = {
      slot_id: slot,
      assignment: passage,
      assignment_artifact: passageArtifact(passage),
      image_prompt: prompt,
      selected_image: image,
      i2v_prompt: i2v,
      clip,
      handoff,
      force_rework: slot === 22,
      warnings,
    };
    if (slot === 21) {
      const originalPath = 'images/flux-local/flux-021.png';
      row.slot_21 = {
        original_image: fileIdentity(packageDir, originalPath),
        selected_v2_image: image,
        historical_sidecar: fs.existsSync(path.join(packageDir, 'images/flux-local/flux-021-v2.provenance.json'))
          ? fileIdentity(packageDir, 'images/flux-local/flux-021-v2.provenance.json')
          : null,
      };
    }
    return row;
  });

  const handoffManifest = fileIdentity(packageDir, path.join('resolve-handoff', 'media-manifest.json'));
  handoffManifest.artifact_type = 'resolve_handoff_manifest';
  const ordered = slotRows.slice().sort((a, b) => a.handoff.position - b.handoff.position);
  if (ordered.some((row, index) => !Number.isInteger(row.handoff.position) || row.handoff.position !== index + 1)) {
    throw reviewError('Resolve handoff ordering is missing, duplicated, or non-contiguous.', 'AUTHORITY_REVIEW_HANDOFF_AMBIGUOUS', 422);
  }
  return {
    package_id: packageId,
    script: {
      path: script.path,
      sha256: script.sha256,
      size_bytes: script.size_bytes,
      text: scriptText,
      identical_copies: [
        'script/script-draft.md',
        'music/script-snapshot.txt',
      ].filter((rel) => {
        try { return authority.sha256File(path.join(packageDir, rel)) === script.sha256; } catch (_) { return false; }
      }),
      upstream: scriptUpstream(packageDir),
    },
    slots: slotRows,
    handoff: {
      manifest: handoffManifest,
      ordered_slots: ordered.map((row) => row.slot_id),
      ordered_clip_set_sha256: stableHash(ordered.map((row) => ({
        slot_id: row.slot_id,
        position: row.handoff.position,
        clip_sha256: row.clip.artifact_sha256,
      }))),
    },
  };
}

function validateWorkspace(workspace, packageId) {
  if (!isPlainObject(workspace)
      || workspace.schema_version !== SCHEMA_VERSION
      || workspace.kind !== 'retrospective_authority_reconstruction'
      || workspace.package_id !== packageId
      || !Array.isArray(workspace.retained_slots)
      || !isPlainObject(workspace.baseline)
      || !isPlainObject(workspace.forensic_evidence)) {
    throw reviewError('Review workspace is malformed or belongs to another package.', 'AUTHORITY_REVIEW_WORKSPACE_CORRUPT', 422);
  }
  if (workspace.retained_slots.length !== 10
      || new Set(workspace.retained_slots).size !== workspace.retained_slots.length
      || workspace.retained_slots.some((slot) => !Number.isInteger(slot) || slot <= 0)) {
    throw reviewError('Review workspace has invalid retained slot identities.', 'AUTHORITY_REVIEW_WORKSPACE_CORRUPT', 422);
  }
  return workspace;
}

function validateAssignments(manifest, workspace) {
  if (!isPlainObject(manifest)
      || manifest.schema_version !== SCHEMA_VERSION
      || manifest.package_id !== workspace.package_id
      || manifest.final_script_sha256 !== workspace.baseline.script.sha256
      || !Array.isArray(manifest.assignments)
      || manifest.assignments.length !== workspace.retained_slots.length) {
    throw reviewError('Proposed assignment manifest is malformed or stale.', 'AUTHORITY_REVIEW_ASSIGNMENTS_CORRUPT', 422);
  }
  const slots = manifest.assignments.map((assignment) => assignment.slot_id);
  if (new Set(slots).size !== slots.length
      || slots.some((slot) => !workspace.retained_slots.includes(slot))) {
    throw reviewError('Proposed assignment manifest has duplicate or unknown slots.', 'AUTHORITY_REVIEW_ASSIGNMENTS_CORRUPT', 422);
  }
  return manifest;
}

function initialLedger(packageId, stamp) {
  return {
    schema_version: SCHEMA_VERSION,
    kind: 'retrospective_operator_decisions',
    package_id: packageId,
    created_at: stamp,
    head_hash: null,
    records: [],
  };
}

function recordHash(record) {
  const copy = { ...record };
  delete copy.record_hash;
  return stableHash(copy);
}

function validateDecisionRecord(record, index, packageId, previousHash, ids) {
  if (!isPlainObject(record)
      || record.schema_version !== SCHEMA_VERSION
      || record.package_id !== packageId
      || record.sequence !== index + 1
      || !ID_RE.test(String(record.decision_id || ''))
      || !DECISION_TYPES.includes(record.decision_type)
      || !DECISIONS.includes(record.decision)
      || record.source !== 'retrospective_operator_review'
      || typeof record.operator_identity !== 'string'
      || !record.operator_identity.trim()
      || typeof record.decision_timestamp !== 'string'
      || record.tool_version !== TOOL_VERSION
      || !isPlainObject(record.artifact)
      || !isPlainObject(record.upstream)
      || record.invalidated !== false
      || record.invalidation_reason !== null) {
    throw reviewError(`Decision record ${index + 1} is malformed.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  if (ids.has(record.decision_id)) throw reviewError(`Duplicate decision ID: ${record.decision_id}.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  ids.add(record.decision_id);
  if (record.slot_id != null && (!Number.isInteger(record.slot_id) || record.slot_id <= 0)) {
    throw reviewError(`Decision ${record.decision_id} has an invalid slot.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  if (SLOT_STAGE_TYPES.includes(record.decision_type) && record.slot_id == null) {
    throw reviewError(`Decision ${record.decision_id} is missing its slot.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  if (record.decision_type === 'assignment') {
    if (!isPlainObject(record.artifact_details)
        || record.artifact_details.slot_id !== record.slot_id
        || passageArtifact(record.artifact_details).artifact_sha256 !== record.artifact.artifact_sha256) {
      throw reviewError(`Assignment decision ${record.decision_id} lacks its exact passage identity.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
    }
  } else if (record.artifact_details != null) {
    throw reviewError(`Decision ${record.decision_id} has unexpected artifact details.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  if (!SLOT_STAGE_TYPES.includes(record.decision_type) && record.slot_id != null) {
    throw reviewError(`Decision ${record.decision_id} must not carry a slot.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  for (const [obj, prefix] of [[record.artifact, 'artifact'], [record.upstream, 'upstream']]) {
    const typeKey = prefix === 'artifact' ? 'artifact_type' : 'upstream_artifact_type';
    const pathKey = prefix === 'artifact' ? 'artifact_path' : 'upstream_identity';
    const hashKey = prefix === 'artifact' ? 'artifact_sha256' : 'upstream_sha256';
    if (typeof obj[typeKey] !== 'string' || !obj[typeKey]
        || typeof obj[pathKey] !== 'string' || !obj[pathKey]) {
      throw reviewError(`Decision ${record.decision_id} has malformed ${prefix} identity.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
    }
    assertHash(obj[hashKey], `${record.decision_id} ${prefix} hash`);
  }
  if (record.previous_record_hash !== previousHash) {
    throw reviewError(`Decision ${record.decision_id} breaks the append-only hash chain.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  if (record.record_hash !== recordHash(record)) {
    throw reviewError(`Decision ${record.decision_id} has an invalid record hash.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  return record;
}

function decisionKey(record) {
  return record.slot_id == null ? record.decision_type : `${record.decision_type}:${record.slot_id}`;
}

function activeDecisionMap(records) {
  const byId = new Map(records.map((record) => [record.decision_id, record]));
  const active = new Map();
  const superseded = new Map();
  for (const record of records) {
    const key = decisionKey(record);
    const current = active.get(key);
    if (current) {
      if (record.previous_decision_id !== current.decision_id) {
        throw reviewError(`Duplicate active decision for ${key}.`, 'AUTHORITY_REVIEW_DUPLICATE_ACTIVE', 422);
      }
      superseded.set(current.decision_id, record.decision_id);
    } else if (record.previous_decision_id != null) {
      const prior = byId.get(record.previous_decision_id);
      if (!prior || decisionKey(prior) !== key) {
        throw reviewError(`Decision ${record.decision_id} has an invalid supersession target.`, 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
      }
      throw reviewError(`Decision ${record.decision_id} supersedes a non-active decision.`, 'AUTHORITY_REVIEW_DUPLICATE_ACTIVE', 422);
    }
    active.set(key, record);
  }
  return { active, superseded };
}

function readLedger(reviewDir, packageId) {
  const paths = reviewPaths(reviewDir);
  const parsed = readJsonStrict(paths.decisions, DECISIONS_FILE);
  if (!isPlainObject(parsed)
      || parsed.schema_version !== SCHEMA_VERSION
      || parsed.kind !== 'retrospective_operator_decisions'
      || parsed.package_id !== packageId
      || !Array.isArray(parsed.records)
      || (parsed.head_hash !== null && !HASH_RE.test(String(parsed.head_hash)))) {
    throw reviewError('Decision ledger has an invalid shape; refusing to treat it as empty.', 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  let previousHash = null;
  const ids = new Set();
  parsed.records.forEach((record, index) => {
    validateDecisionRecord(record, index, packageId, previousHash, ids);
    previousHash = record.record_hash;
  });
  if (parsed.head_hash !== previousHash) {
    throw reviewError('Decision ledger head hash does not match its records.', 'AUTHORITY_REVIEW_LEDGER_CORRUPT', 422);
  }
  activeDecisionMap(parsed.records);
  return parsed;
}

function loadReviewState(packageDir, reviewDir) {
  const packageId = path.basename(packageDir);
  const paths = reviewPaths(reviewDir);
  const workspace = validateWorkspace(readJsonStrict(paths.workspace, WORKSPACE_FILE), packageId);
  const assignments = validateAssignments(readJsonStrict(paths.assignments, ASSIGNMENTS_FILE), workspace);
  const ledger = readLedger(reviewDir, packageId);
  return { paths, workspace, assignments, ledger };
}

function initializeWorkspace(packageDir, reviewDir, payload = {}, options = {}) {
  const packageId = assertPackageId(path.basename(packageDir));
  const paths = reviewPaths(reviewDir);
  if (fs.existsSync(paths.workspace) || fs.existsSync(paths.assignments) || fs.existsSync(paths.decisions)) {
    const loaded = loadReviewState(packageDir, reviewDir);
    return { created: false, ...buildReviewView(packageDir, reviewDir, { loaded }) };
  }
  const retainedSlots = Array.isArray(payload.retained_slots)
    ? payload.retained_slots.map(Number)
    : [];
  if (retainedSlots.length !== 10
      || new Set(retainedSlots).size !== 10
      || retainedSlots.some((slot) => !Number.isInteger(slot) || slot <= 0)) {
    throw reviewError('Exactly ten unique retained slot IDs are required.', 'AUTHORITY_REVIEW_SLOTS_INVALID', 400);
  }
  const proposals = Array.isArray(payload.proposed_assignments) ? payload.proposed_assignments : [];
  if (proposals.length !== retainedSlots.length) {
    throw reviewError('One proposed script assignment is required for every retained slot.', 'AUTHORITY_REVIEW_ASSIGNMENTS_INVALID', 400);
  }
  const proposalBySlot = new Map();
  for (const proposal of proposals) {
    const slot = Number(proposal && proposal.slot_id);
    if (!retainedSlots.includes(slot) || proposalBySlot.has(slot)) {
      throw reviewError('Proposed assignments contain a duplicate or unknown slot.', 'AUTHORITY_REVIEW_ASSIGNMENTS_INVALID', 400);
    }
    proposalBySlot.set(slot, proposal);
  }
  const baseline = packageArtifactSnapshot(packageDir, retainedSlots, proposalBySlot);
  if (payload.expected_script_sha256 && baseline.script.sha256 !== payload.expected_script_sha256) {
    throw reviewError('Final script changed before workspace initialization.', 'AUTHORITY_REVIEW_BASELINE_DRIFT', 409);
  }
  const stamp = options.nowIso || nowIso();
  const forensic = isPlainObject(payload.forensic_evidence) ? payload.forensic_evidence : {};
  const reportPath = boundedString(forensic.report_path || '', 'forensic report path', 1000, { required: true });
  const reportHash = assertHash(forensic.report_sha256, 'forensic report hash');
  const workspace = {
    schema_version: SCHEMA_VERSION,
    kind: 'retrospective_authority_reconstruction',
    label: 'Retrospective Authority Reconstruction',
    package_id: packageId,
    created_at: stamp,
    created_by_tool: TOOL_VERSION,
    retained_slots: retainedSlots,
    review_order: [2, 9, 10, 17, 19, 21, 22, 23, 24, 25].filter((slot) => retainedSlots.includes(slot)),
    warnings: [
      'Existing artifacts are legacy evidence, not historical proof of approval.',
      'Review decisions are being made now as retrospective reconstruction decisions.',
      'Approval does not prove an artifact was historically approved.',
      'Slot 22 requires reconstruction.',
      'Production remains blocked until the complete chain is valid.',
    ],
    forensic_evidence: {
      report_path: reportPath,
      report_sha256: reportHash,
      verdict: 'PARTIALLY REUSABLE',
      source: 'completed_read_only_forensic_review',
    },
    baseline,
  };
  const assignmentManifest = {
    schema_version: SCHEMA_VERSION,
    kind: 'proposed_script_to_slot_assignments',
    package_id: packageId,
    final_script_sha256: baseline.script.sha256,
    created_at: stamp,
    source: 'forensic_review_proposal_not_approval',
    assignments: baseline.slots.map((slot) => ({
      ...slot.assignment,
      artifact_sha256: slot.assignment_artifact.artifact_sha256,
    })),
  };
  fs.mkdirSync(paths.root, { recursive: true });
  writeJsonAtomic(paths.workspace, workspace);
  writeJsonAtomic(paths.assignments, assignmentManifest);
  writeJsonAtomic(paths.decisions, initialLedger(packageId, stamp));
  return { created: true, ...buildReviewView(packageDir, reviewDir) };
}

function currentBaseline(packageDir, workspace, assignments) {
  const proposalBySlot = new Map(assignments.assignments.map((item) => [item.slot_id, item]));
  return packageArtifactSnapshot(packageDir, workspace.retained_slots, proposalBySlot, {
    allowStaleAssignments: true,
  });
}

function assignmentFromPayload(script, slot, fields) {
  return validatePassage(script.text, script.sha256, slot, {
    slot_id: slot,
    start_char: fields.start_char,
    end_char: fields.end_char,
    exact_text: fields.exact_text,
    selected_text_sha256: fields.selected_text_sha256,
    communicative_purpose: fields.communicative_purpose,
    forensic_confidence: fields.forensic_confidence || 'operator_selected',
    forensic_warning: fields.forensic_warning || '',
  });
}

function rawArtifactForDecision(type, slotRow, baseline, assignmentOverride) {
  if (type === 'script') {
    return {
      artifact: {
        artifact_type: 'final_script',
        artifact_path: baseline.script.path,
        artifact_sha256: baseline.script.sha256,
      },
      upstream: baseline.script.upstream,
    };
  }
  if (type === 'assignment') {
    const assignment = assignmentOverride || slotRow.assignment;
    return {
      artifact: passageArtifact(assignment),
      upstream: {
        upstream_artifact_type: 'final_script',
        upstream_identity: baseline.script.path,
        upstream_sha256: baseline.script.sha256,
      },
    };
  }
  if (type === 'image_prompt') {
    return {
      artifact: slotRow.image_prompt,
      upstream: {
        upstream_artifact_type: 'script_to_slot_assignment',
        upstream_identity: slotRow.assignment_artifact.artifact_path,
        upstream_sha256: slotRow.assignment_artifact.artifact_sha256,
      },
    };
  }
  if (type === 'selected_image') {
    return {
      artifact: slotRow.selected_image,
      upstream: {
        upstream_artifact_type: slotRow.image_prompt.artifact_type,
        upstream_identity: slotRow.image_prompt.artifact_path,
        upstream_sha256: slotRow.image_prompt.artifact_sha256,
      },
    };
  }
  if (type === 'i2v_prompt') {
    return {
      artifact: slotRow.i2v_prompt,
      upstream: {
        upstream_artifact_type: 'selected_image',
        upstream_identity: slotRow.selected_image.artifact_path,
        upstream_sha256: slotRow.selected_image.artifact_sha256,
      },
    };
  }
  if (type === 'clip') {
    return {
      artifact: slotRow.clip,
      upstream: {
        upstream_artifact_type: 'i2v_dispatch_bundle',
        upstream_identity: `slot:${slotRow.slot_id}:selected_image+i2v_prompt`,
        upstream_sha256: stableHash({
          selected_image_sha256: slotRow.selected_image.artifact_sha256,
          i2v_prompt_sha256: slotRow.i2v_prompt.artifact_sha256,
        }),
      },
    };
  }
  if (type === 'handoff') {
    return {
      artifact: baseline.handoff.manifest,
      upstream: {
        upstream_artifact_type: 'ordered_clip_set',
        upstream_identity: `package:${baseline.package_id}:resolve-order`,
        upstream_sha256: baseline.handoff.ordered_clip_set_sha256,
      },
    };
  }
  throw reviewError(`Unknown decision type: ${type}.`, 'AUTHORITY_REVIEW_DECISION_INVALID', 400);
}

function decisionState(activeRecord, currentArtifact, prerequisite, supersededBy) {
  if (!activeRecord) return {
    status: 'not_reviewed',
    decision: null,
    authority_valid: false,
    invalidated: false,
    invalidation_reason: null,
  };
  let reason = null;
  if (activeRecord.artifact.artifact_sha256 !== currentArtifact.artifact.artifact_sha256) {
    reason = 'Artifact bytes or canonical content changed after this decision.';
  } else if (activeRecord.upstream.upstream_sha256 !== currentArtifact.upstream.upstream_sha256) {
    reason = 'Upstream authority changed after this decision.';
  } else if (activeRecord.decision === 'approved' && prerequisite && !prerequisite.authority_valid) {
    reason = `Upstream ${prerequisite.decision_type || 'decision'} is not currently approved and valid.`;
  }
  const invalidated = Boolean(reason);
  return {
    status: invalidated ? 'invalidated' : activeRecord.decision,
    decision: activeRecord.decision,
    decision_id: activeRecord.decision_id,
    decision_type: activeRecord.decision_type,
    operator_identity: activeRecord.operator_identity,
    decision_timestamp: activeRecord.decision_timestamp,
    note: activeRecord.operator_note || '',
    artifact_sha256: activeRecord.artifact.artifact_sha256,
    upstream_sha256: activeRecord.upstream.upstream_sha256,
    authority_valid: !invalidated && activeRecord.decision === 'approved',
    invalidated,
    invalidation_reason: reason,
    superseded_by: supersededBy || null,
    artifact_details: activeRecord.artifact_details || null,
  };
}

function buildDecisionStates(baseline, ledger) {
  const maps = activeDecisionMap(ledger.records);
  const states = {};
  const scriptRaw = rawArtifactForDecision('script', null, baseline);
  const scriptRecord = maps.active.get('script');
  states.script = {
    decision_type: 'script',
    ...decisionState(scriptRecord, scriptRaw, null, scriptRecord ? maps.superseded.get(scriptRecord.decision_id) : null),
  };
  states.slots = {};
  for (const row of baseline.slots) {
    const slotStates = {};
    let prerequisite = states.script;
    for (const type of SLOT_STAGE_TYPES) {
      const record = maps.active.get(`${type}:${row.slot_id}`);
      let assignmentOverride = null;
      if (type === 'assignment' && record && isPlainObject(record.artifact_details)) {
        const details = record.artifact_details;
        const currentText = baseline.script.text.slice(details.start_char, details.end_char);
        if (details.final_script_sha256 === baseline.script.sha256
            && currentText === details.exact_text
            && sha256(Buffer.from(currentText, 'utf8')) === details.selected_text_sha256) {
          assignmentOverride = details;
        }
      }
      const raw = rawArtifactForDecision(type, row, baseline, assignmentOverride);
      // When an approved assignment differs from the forensic proposal, its
      // exact decision artifact is the current upstream authority for the prompt.
      if (type === 'image_prompt' && prerequisite && prerequisite.authority_valid) {
        raw.upstream = {
          upstream_artifact_type: 'script_to_slot_assignment',
          upstream_identity: `review:slot:${row.slot_id}:script-passage`,
          upstream_sha256: prerequisite.artifact_sha256,
        };
      }
      if (type === 'clip') {
        const imageState = slotStates.selected_image;
        const i2vState = slotStates.i2v_prompt;
        if (imageState && i2vState && imageState.authority_valid && i2vState.authority_valid) {
          raw.upstream.upstream_sha256 = stableHash({
            selected_image_sha256: imageState.artifact_sha256,
            i2v_prompt_sha256: i2vState.artifact_sha256,
          });
        }
      }
      const state = {
        decision_type: type,
        ...decisionState(record, raw, prerequisite, record ? maps.superseded.get(record.decision_id) : null),
      };
      slotStates[type] = state;
      prerequisite = state;
    }
    states.slots[String(row.slot_id)] = slotStates;
  }
  const allClips = baseline.slots.map((row) => states.slots[String(row.slot_id)].clip);
  const orderedCurrent = baseline.slots
    .slice()
    .sort((a, b) => a.handoff.position - b.handoff.position)
    .map((row) => {
      const clipState = states.slots[String(row.slot_id)].clip;
      return {
        slot_id: row.slot_id,
        position: row.handoff.position,
        clip_sha256: clipState.authority_valid ? clipState.artifact_sha256 : row.clip.artifact_sha256,
      };
    });
  const handoffRaw = rawArtifactForDecision('handoff', null, baseline);
  handoffRaw.upstream.upstream_sha256 = stableHash(orderedCurrent);
  const handoffRecord = maps.active.get('handoff');
  const clipPrerequisite = {
    decision_type: 'clip set',
    authority_valid: allClips.length > 0 && allClips.every((state) => state.authority_valid),
  };
  states.handoff = {
    decision_type: 'handoff',
    ...decisionState(
      handoffRecord,
      handoffRaw,
      clipPrerequisite,
      handoffRecord ? maps.superseded.get(handoffRecord.decision_id) : null,
    ),
  };
  return states;
}

function readiness(states, workspace) {
  const required = 2 + (workspace.retained_slots.length * SLOT_STAGE_TYPES.length);
  const all = [states.script, states.handoff];
  workspace.retained_slots.forEach((slot) => {
    SLOT_STAGE_TYPES.forEach((type) => all.push(states.slots[String(slot)][type]));
  });
  const completed = all.filter((state) => state.decision != null).length;
  const rejected = all.filter((state) => state.decision === 'rejected' && !state.invalidated).length;
  const rework = all.filter((state) => state.decision === 'requires_rework' && !state.invalidated).length;
  const invalidated = all.filter((state) => state.invalidated).length;
  const approvedCurrent = all.filter((state) => state.authority_valid).length;
  let nextAction = 'Review and decide the current final script.';
  if (states.script.decision && states.script.decision !== 'approved') {
    nextAction = 'The current script is not approved; revise or supersede the script decision before downstream authority can become valid.';
  } else if (states.script.authority_valid) {
    const assignment = workspace.review_order
      .map((slot) => ({ slot, state: states.slots[String(slot)].assignment }))
      .find((item) => !item.state.authority_valid);
    if (assignment) nextAction = `Review the script-to-slot assignment for slot ${assignment.slot}.`;
    else {
      const downstream = workspace.review_order.flatMap((slot) => (
        ['image_prompt', 'selected_image', 'i2v_prompt', 'clip']
          .map((type) => ({ slot, type, state: states.slots[String(slot)][type] }))
      )).find((item) => !item.state.authority_valid);
      if (downstream) nextAction = downstream.slot === 22
        ? 'Confirm slot 22 requires rework; replacement generation remains a separate blocked action.'
        : `Review slot ${downstream.slot} ${downstream.type.replace(/_/g, ' ')}.`;
      else if (!states.handoff.authority_valid) nextAction = 'Rebuild and explicitly approve the handoff from the approved clip set.';
      else nextAction = 'Run a separate controlled authority-binding audit.';
    }
  }
  const ready = approvedCurrent === required && rejected === 0 && rework === 0 && invalidated === 0;
  return {
    required_decisions: required,
    completed_decisions: completed,
    remaining_decisions: required - completed,
    approved_current_decisions: approvedCurrent,
    rejected_decisions: rejected,
    rework_required_decisions: rework,
    invalidated_decisions: invalidated,
    authority: ready ? 'review_complete' : 'incomplete',
    package_ready_for_binding: ready,
    binding_permitted: false,
    blocker: ready
      ? 'A separate operator-authorized dry-run binding audit is still required.'
      : 'Retrospective authority reconstruction is incomplete.',
    next_action: nextAction,
  };
}

function decisionHistory(ledger, states) {
  const maps = activeDecisionMap(ledger.records);
  const currentByKey = new Map();
  currentByKey.set('script', states.script);
  currentByKey.set('handoff', states.handoff);
  Object.entries(states.slots).forEach(([slot, slotStates]) => {
    SLOT_STAGE_TYPES.forEach((type) => currentByKey.set(`${type}:${slot}`, slotStates[type]));
  });
  return ledger.records.map((record) => {
    const supersededBy = maps.superseded.get(record.decision_id) || null;
    const current = currentByKey.get(decisionKey(record));
    const isActive = maps.active.get(decisionKey(record)) === record;
    const invalidated = supersededBy != null || (isActive && Boolean(current && current.invalidated));
    return {
      ...record,
      invalidated,
      invalidation_reason: supersededBy
        ? `Superseded by ${supersededBy}.`
        : (invalidated ? current.invalidation_reason : null),
      active: isActive,
      superseded_by: supersededBy,
    };
  });
}

function buildReviewView(packageDir, reviewDir, options = {}) {
  const loaded = options.loaded || loadReviewState(packageDir, reviewDir);
  const current = currentBaseline(packageDir, loaded.workspace, loaded.assignments);
  const states = buildDecisionStates(current, loaded.ledger);
  current.slots.forEach((row) => {
    const activeAssignment = states.slots[String(row.slot_id)].assignment.artifact_details;
    row.current_assignment = activeAssignment || row.assignment;
  });
  return {
    ok: true,
    label: 'Retrospective Authority Reconstruction',
    package_id: loaded.workspace.package_id,
    workspace_path: loaded.paths.root,
    authority_chain_exists: fs.existsSync(path.join(packageDir, authority.AUTHORITY_FILE)),
    legacy_evidence_immutable: true,
    forensic_evidence: loaded.workspace.forensic_evidence,
    warnings: loaded.workspace.warnings,
    script: current.script,
    retained_slots: loaded.workspace.retained_slots,
    review_order: loaded.workspace.review_order,
    slots: current.slots,
    handoff: current.handoff,
    decisions: states,
    readiness: readiness(states, loaded.workspace),
    ledger: {
      path: loaded.paths.decisions,
      schema_version: loaded.ledger.schema_version,
      record_count: loaded.ledger.records.length,
      head_hash: loaded.ledger.head_hash,
      history: decisionHistory(loaded.ledger, states),
    },
  };
}

function prerequisiteStateFor(type, slot, states) {
  if (type === 'script') return null;
  if (type === 'assignment') return states.script;
  const slotStates = states.slots[String(slot)];
  if (type === 'image_prompt') return slotStates.assignment;
  if (type === 'selected_image') return slotStates.image_prompt;
  if (type === 'i2v_prompt') return slotStates.selected_image;
  if (type === 'clip') {
    return {
      authority_valid: slotStates.selected_image.authority_valid && slotStates.i2v_prompt.authority_valid,
      decision_type: 'selected image and I2V prompt',
    };
  }
  if (type === 'handoff') {
    return {
      authority_valid: Object.values(states.slots).every((slotState) => slotState.clip.authority_valid),
      decision_type: 'clip set',
    };
  }
  return null;
}

function appendDecision(packageDir, reviewDir, payload = {}, options = {}) {
  const loaded = loadReviewState(packageDir, reviewDir);
  const packageId = loaded.workspace.package_id;
  if (payload.package_id !== packageId) {
    throw reviewError('Decision package ID does not match the review workspace.', 'AUTHORITY_REVIEW_PACKAGE_MISMATCH', 409);
  }
  const type = String(payload.decision_type || '');
  const outcome = String(payload.decision || '');
  if (!DECISION_TYPES.includes(type)) throw reviewError('Unknown decision type.', 'AUTHORITY_REVIEW_DECISION_INVALID', 400);
  if (!DECISIONS.includes(outcome)) throw reviewError('Unknown decision outcome.', 'AUTHORITY_REVIEW_DECISION_INVALID', 400);
  const slot = payload.slot_id == null ? null : Number(payload.slot_id);
  if (SLOT_STAGE_TYPES.includes(type)) {
    if (!Number.isInteger(slot) || !loaded.workspace.retained_slots.includes(slot)) {
      throw reviewError('Decision has an unknown slot ID.', 'AUTHORITY_REVIEW_SLOT_INVALID', 400);
    }
  } else if (slot != null) {
    throw reviewError('Package-level decisions must not carry a slot.', 'AUTHORITY_REVIEW_SLOT_INVALID', 400);
  }
  if (slot === 22 && ['selected_image', 'i2v_prompt', 'clip'].includes(type) && outcome === 'approved') {
    throw reviewError(
      `Slot 22 ${type.replace(/_/g, ' ')} cannot be approved while the confirmed mismatch remains.`,
      'AUTHORITY_REVIEW_SLOT_22_REWORK_REQUIRED',
      409,
    );
  }
  const operator = boundedString(payload.operator_identity || '', 'operator_identity', OPERATOR_MAX, { required: true });
  const note = payload.operator_note == null
    ? ''
    : boundedString(payload.operator_note, 'operator_note', NOTE_MAX);
  const current = currentBaseline(packageDir, loaded.workspace, loaded.assignments);
  const states = buildDecisionStates(current, loaded.ledger);
  const row = slot == null ? null : current.slots.find((item) => item.slot_id === slot);
  let assignmentOverride = null;
  if (type === 'assignment') {
    if (!isPlainObject(payload.assignment)) {
      throw reviewError('An exact script passage assignment is required.', 'AUTHORITY_REVIEW_ASSIGNMENT_INVALID', 400);
    }
    assignmentOverride = assignmentFromPayload(current.script, slot, payload.assignment);
  }
  const raw = rawArtifactForDecision(type, row, current, assignmentOverride);
  const prerequisite = prerequisiteStateFor(type, slot, states);
  if (outcome === 'approved' && prerequisite && !prerequisite.authority_valid) {
    throw reviewError(
      `Cannot approve ${type.replace(/_/g, ' ')}: upstream ${prerequisite.decision_type || 'authority'} is not approved and current.`,
      'AUTHORITY_REVIEW_UPSTREAM_INVALID',
      409,
    );
  }
  if (outcome === 'approved') {
    if (type === 'image_prompt') {
      raw.upstream.upstream_sha256 = states.slots[String(slot)].assignment.artifact_sha256;
    } else if (type === 'clip') {
      const slotState = states.slots[String(slot)];
      raw.upstream.upstream_sha256 = stableHash({
        selected_image_sha256: slotState.selected_image.artifact_sha256,
        i2v_prompt_sha256: slotState.i2v_prompt.artifact_sha256,
      });
    } else if (type === 'handoff') {
      raw.upstream.upstream_sha256 = stableHash(
        current.slots.slice().sort((a, b) => a.handoff.position - b.handoff.position).map((item) => ({
          slot_id: item.slot_id,
          position: item.handoff.position,
          clip_sha256: states.slots[String(item.slot_id)].clip.artifact_sha256,
        })),
      );
    }
  }
  const activeMaps = activeDecisionMap(loaded.ledger.records);
  const key = slot == null ? type : `${type}:${slot}`;
  const existing = activeMaps.active.get(key) || null;
  const providedPrevious = payload.previous_decision_id == null ? null : String(payload.previous_decision_id);
  if (existing && providedPrevious !== existing.decision_id) {
    throw reviewError(
      `A current ${key} decision already exists; provide its decision ID to supersede it explicitly.`,
      'AUTHORITY_REVIEW_DECISION_CONFLICT',
      409,
    );
  }
  if (!existing && providedPrevious != null) {
    throw reviewError('No current decision exists to supersede.', 'AUTHORITY_REVIEW_DECISION_CONFLICT', 409);
  }
  const stamp = options.nowIso || nowIso();
  const decisionId = options.decisionId || `decision-${crypto.randomUUID()}`;
  if (!ID_RE.test(decisionId)) throw reviewError('Generated decision ID is invalid.', 'AUTHORITY_REVIEW_DECISION_INVALID', 500);
  const record = {
    schema_version: SCHEMA_VERSION,
    package_id: packageId,
    sequence: loaded.ledger.records.length + 1,
    decision_id: decisionId,
    decision_type: type,
    slot_id: slot,
    artifact: {
      artifact_type: raw.artifact.artifact_type,
      artifact_path: raw.artifact.artifact_path,
      artifact_sha256: raw.artifact.artifact_sha256,
    },
    artifact_details: type === 'assignment' ? raw.artifact.value : null,
    upstream: {
      upstream_artifact_type: raw.upstream.upstream_artifact_type,
      upstream_identity: raw.upstream.upstream_identity,
      upstream_sha256: raw.upstream.upstream_sha256,
    },
    decision: outcome,
    operator_identity: operator,
    decision_timestamp: stamp,
    source: 'retrospective_operator_review',
    operator_note: note,
    previous_decision_id: existing ? existing.decision_id : null,
    invalidated: false,
    invalidation_reason: null,
    tool_version: TOOL_VERSION,
    previous_record_hash: loaded.ledger.head_hash,
  };
  record.record_hash = recordHash(record);
  const nextLedger = {
    ...loaded.ledger,
    head_hash: record.record_hash,
    records: loaded.ledger.records.concat([record]),
  };
  // Validate the complete next ledger before atomically replacing the file.
  const ids = new Set();
  let previousHash = null;
  nextLedger.records.forEach((item, index) => {
    validateDecisionRecord(item, index, packageId, previousHash, ids);
    previousHash = item.record_hash;
  });
  activeDecisionMap(nextLedger.records);
  writeJsonAtomic(loaded.paths.decisions, nextLedger);
  return { record, view: buildReviewView(packageDir, reviewDir) };
}

module.exports = {
  ASSIGNMENTS_FILE,
  DECISIONS,
  DECISIONS_FILE,
  DECISION_TYPES,
  SCHEMA_VERSION,
  SLOT_STAGE_TYPES,
  TOOL_VERSION,
  WORKSPACE_FILE,
  appendDecision,
  buildReviewView,
  initializeWorkspace,
  isSurrogateSafe: visualPlan.isSurrogateSafe,
  loadReviewState,
  passageArtifact,
  readLedger,
  reviewError,
  reviewPaths,
  sha256,
  stableHash,
  validatePassage,
};
