'use strict';

// KNOWLEDGE STEWARD V1 — NON-AGENT PROPOSAL LIBRARY.
//
// Knowledge Steward is a supporting architectural role, NOT a production agent.
// Per config/agent-contract.json it is `is_specialist: false`, absent from
// role_roster, and agent-contract-validator.js refuses to let it be registered
// in config/agent-registry.json. The canonical production architecture is and
// stays exactly 12 registered agents. This module therefore deliberately
// exposes NO AGENT_ID, NO lifecycle state and NO runner CLI entry, exactly like
// the other non-agent role library (scripts/hermes-escalation.js).
//
// Authority: PROPOSE, NEVER APPLY.
//
//   production evidence -> steward proposal -> Mikko review
//     -> future sanctioned Hermes-side canonical writer -> brain
//
// This module ends at "proposal ready for human review". The canonical Hermes
// knowledge store (hermes-organiser/brain/) lives outside this repository, its
// writer is Hermes-side, and its README states "No automatic writes into Hermes
// internals". Accordingly this library:
//
//   * has no brain writer and no filesystem reach outside this repository
//   * never reads the brain directly: canonical state is supplied BY THE CALLER
//     as an explicit snapshot, or the proposal declares it unavailable
//   * writes only non-canonical proposal artifacts under one allowlisted root
//   * never mutates the source evidence it reads
//
// A proposal is governance evidence. It is NOT canonical knowledge and every
// artifact says so.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const STEWARD_VERSION = 'knowledge-steward-v1';

// Identity is a ROLE, never an agent id. Mirrors hermes-escalation.js ACTOR.
const ACTOR = Object.freeze({
  identity_type: 'SUPPORT_ROLE',
  identity: 'knowledge_steward',
  authenticated: false,
  context: 'knowledge stewardship support role — non-agent per agent contract; build-order support role 6',
});

// Every artifact this library produces carries this marker.
const NOT_CANONICAL = 'NOT_CANONICAL_KNOWLEDGE';

const ACTIONS = Object.freeze(['inspect_candidate', 'create_proposal', 'validate_proposal', 'status']);

// Structurally absent capabilities. Asserted by test, not merely documented.
const PROHIBITED_ACTIONS = Object.freeze([
  'APPLY', 'WRITE_BRAIN', 'AUTO_MERGE', 'BULK_REWRITE', 'SCAN_EVERYTHING',
  'RECORD_HUMAN_APPROVAL', 'MUTATE_CANONICAL_KNOWLEDGE', 'MUTATE_AGENT_REGISTRY',
]);

const KNOWLEDGE_CLASSES = Object.freeze([
  'HUMAN_DOCTRINE',            // Mikko's creative/production doctrine
  'PROJECT_KNOWLEDGE',         // durable project facts
  'RESEARCH_CLAIM',            // sourced claim with evidence + confidence
  'DETERMINISTIC_SYSTEM_FACT', // machine-provable (hash/schema/validator)
  'HISTORICAL_RECORD',         // immutable past evidence
  'TEMPORARY_RUNTIME_STATE',   // volatile; never durable knowledge
  'AGENT_GOVERNANCE',          // registry/contract facts — reference only
]);

const OPERATIONS = Object.freeze(['add', 'amend', 'supersede', 'deprecate', 'merge']);

const AUTHORITY_CLASSES = Object.freeze([
  'HUMAN_VERDICT',          // a human review artifact decided exactly this
  'DETERMINISTIC_PROOF',    // validator/hash proof supports it
  'SPECIALIST_CONCLUSION',  // an agent concluded it; proposal authority only
  'UNVERIFIED',             // prose without durable backing
]);

const DISPOSITIONS = Object.freeze([
  'NO_DURABLE_VALUE',
  'PROPOSAL_READY',
  'HUMAN_REVIEW_REQUIRED',
  'CONFLICT_REQUIRES_HUMAN_REVIEW',
  'POSSIBLE_DUPLICATE_REQUIRES_REVIEW',
  'DUPLICATE_NO_CHANGE',
  'APPROVED_AWAITING_CANONICAL_WRITER',
  'BLOCKED',
]);

// Classes whose durable adoption always needs Mikko, whatever the evidence.
const HUMAN_APPROVAL_REQUIRED_CLASSES = Object.freeze(['HUMAN_DOCTRINE', 'AGENT_GOVERNANCE']);

const CANONICAL_UNAVAILABLE = 'CANONICAL_STATE_UNAVAILABLE_FOR_COMPARISON';

// The single allowlisted proposal root. Proposals are governance evidence and
// live beside the other governance records; they are never a knowledge store.
const PROPOSAL_ROOT = path.join('governance', 'knowledge-proposals');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_TEXT = 2000;

const CANDIDATE_FIELDS = Object.freeze([
  'candidate_id', 'statement', 'knowledge_class', 'operation', 'target',
  'source_artifacts', 'evidence', 'rationale', 'predecessor', 'source_run_id',
  'proposing_agent', 'confidence',
]);
const TARGET_FIELDS = Object.freeze(['namespace', 'reference_id', 'canonical_path_hint', 'expected_predecessor_digest']);
const SOURCE_FIELDS = Object.freeze(['artifact_id', 'path', 'sha256', 'kind']);

class KnowledgeStewardError extends Error {
  constructor(code, message) { super(message); this.name = 'KnowledgeStewardError'; this.code = code; }
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  throw new KnowledgeStewardError('KS_CANONICALIZE_INVALID', 'proposal contains a non-canonical value');
}

function safeId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new KnowledgeStewardError('KS_ID_INVALID', `${label} is not a safe identifier`);
  }
  return value;
}

function text(value, label, { required = true, max = MAX_TEXT } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', `${label} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', `${label} must be a string`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > max) {
    throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', `${label} is empty or exceeds ${max} characters`);
  }
  return normalized;
}

function strictObject(value, allowed, label) {
  if (!plain(value)) throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', `${label} must be an object`);
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', `${label} unknown field ${unknown[0]}`);
}

// ── normalization used for deterministic duplicate detection ──────────────
// Whitespace and terminal punctuation collapse; case folds. This is a
// deterministic comparison only. Semantic similarity is never auto-merged.
function normalizeStatement(statement) {
  return String(statement).toLowerCase().replace(/\s+/g, ' ').replace(/[.;:!?]+$/, '').trim();
}

function statementFingerprint(statement) {
  return sha256(normalizeStatement(statement));
}

// ── path safety ───────────────────────────────────────────────────────────
function containedWithin(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

// Source evidence may only be read from inside this repository. The library has
// no sanctioned reach into hermes-organiser/ or any other sibling repo.
function safeRepoPath(candidate, label, repoRoot) {
  if (typeof candidate !== 'string' || !candidate) {
    throw new KnowledgeStewardError('KS_PATH_INVALID', `${label} must be a non-empty string`);
  }
  if (candidate.includes('\0')) throw new KnowledgeStewardError('KS_PATH_INVALID', `${label} contains a null byte`);
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, candidate);
  if (!containedWithin(root, resolved)) {
    throw new KnowledgeStewardError('KS_PATH_ESCAPE', `${label} resolves outside the repository root`);
  }
  return resolved;
}

// Proposal artifacts may only be written under the one allowlisted root.
function proposalPaths(repoRoot, proposalId) {
  safeId(proposalId, 'proposal_id');
  const root = path.resolve(repoRoot);
  const proposalRoot = path.resolve(root, PROPOSAL_ROOT);
  const dir = path.resolve(proposalRoot, proposalId);
  if (path.dirname(dir) !== proposalRoot) {
    throw new KnowledgeStewardError('KS_PROPOSAL_PATH_INVALID', 'proposal path escapes the allowlisted proposal root');
  }
  return {
    proposalRoot,
    dir,
    jsonPath: path.join(dir, 'proposal.json'),
    reviewPath: path.join(dir, 'REVIEW.md'),
  };
}

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, filePath);
}

// ── candidate validation ──────────────────────────────────────────────────
function validateCandidate(candidate) {
  strictObject(candidate, CANDIDATE_FIELDS, 'candidate');
  safeId(candidate.candidate_id, 'candidate_id');
  const statement = text(candidate.statement, 'candidate.statement');
  if (!KNOWLEDGE_CLASSES.includes(candidate.knowledge_class)) {
    throw new KnowledgeStewardError('KS_CLASS_INVALID', `unknown knowledge_class ${candidate.knowledge_class}`);
  }
  if (!OPERATIONS.includes(candidate.operation)) {
    throw new KnowledgeStewardError('KS_OPERATION_INVALID', `unknown operation ${candidate.operation}`);
  }
  strictObject(candidate.target, TARGET_FIELDS, 'candidate.target');
  safeId(candidate.target.namespace, 'target.namespace');
  if (candidate.target.reference_id != null) safeId(candidate.target.reference_id, 'target.reference_id');
  if (candidate.target.expected_predecessor_digest != null && !HASH_RE.test(candidate.target.expected_predecessor_digest)) {
    throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', 'target.expected_predecessor_digest must be a sha256');
  }
  const sources = candidate.source_artifacts || [];
  if (!Array.isArray(sources)) throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', 'source_artifacts must be an array');
  for (const source of sources) {
    strictObject(source, SOURCE_FIELDS, 'source artifact');
    safeId(source.artifact_id, 'source.artifact_id');
    if (source.sha256 != null && !HASH_RE.test(source.sha256)) {
      throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', `source ${source.artifact_id} sha256 is malformed`);
    }
  }
  if (candidate.operation === 'supersede' && !candidate.predecessor) {
    throw new KnowledgeStewardError('KS_CANDIDATE_INVALID', 'supersede requires a predecessor reference');
  }
  return { statement };
}

// ── source verification: never mutate, always hash-check ──────────────────
function verifySources(candidate, repoRoot, blockers) {
  const verified = [];
  for (const source of candidate.source_artifacts || []) {
    const record = {
      artifact_id: source.artifact_id,
      kind: source.kind || null,
      path: source.path || null,
      declared_sha256: source.sha256 || null,
      observed_sha256: null,
      state: 'DECLARED_ONLY',
    };
    if (!source.path) { verified.push(record); continue; }
    let resolved;
    try { resolved = safeRepoPath(source.path, `source ${source.artifact_id} path`, repoRoot); }
    catch (error) {
      record.state = 'PATH_UNSAFE';
      blockers.push({ code: error.code, detail: error.message, artifact_id: source.artifact_id });
      verified.push(record);
      continue;
    }
    let bytes = null;
    try {
      const stat = fs.lstatSync(resolved);
      if (stat.isFile() && !stat.isSymbolicLink()) bytes = fs.readFileSync(resolved);
    } catch (_) { bytes = null; }
    if (!bytes) {
      record.state = 'UNREADABLE';
      blockers.push({ code: 'KS_SOURCE_UNREADABLE', detail: `source ${source.artifact_id} is not a readable regular file`, artifact_id: source.artifact_id });
      verified.push(record);
      continue;
    }
    record.observed_sha256 = sha256(bytes);
    if (record.declared_sha256 && record.declared_sha256 !== record.observed_sha256) {
      record.state = 'HASH_MISMATCH';
      blockers.push({ code: 'KS_SOURCE_HASH_MISMATCH', detail: `source ${source.artifact_id} bytes do not match its declared sha256`, artifact_id: source.artifact_id });
      verified.push(record);
      continue;
    }
    record.state = record.declared_sha256 ? 'VERIFIED' : 'HASHED_UNDECLARED';
    verified.push(record);
  }
  return verified;
}

// ── classification ────────────────────────────────────────────────────────
function classifyCandidate(candidate) {
  const knowledgeClass = candidate.knowledge_class;
  const durable = knowledgeClass !== 'TEMPORARY_RUNTIME_STATE';
  return {
    knowledge_class: knowledgeClass,
    durable_value: durable,
    reason: durable
      ? `${knowledgeClass} is a durable knowledge class`
      : 'transient runtime state is operational state, not durable knowledge',
    human_approval_required: HUMAN_APPROVAL_REQUIRED_CLASSES.includes(knowledgeClass),
    // Agent governance may be documented as reference; it can never be applied
    // to the registry or the contract by this library or its future bridge.
    governance_reference_only: knowledgeClass === 'AGENT_GOVERNANCE',
    historical_immutable: knowledgeClass === 'HISTORICAL_RECORD',
  };
}

function classifyAuthority(candidate, verifiedSources) {
  const evidence = candidate.evidence || {};
  const kinds = new Set((verifiedSources || []).map((s) => s.kind).filter(Boolean));
  if (evidence.human_verdict_artifact) {
    return { authority: 'HUMAN_VERDICT', reason: 'a human review artifact decided exactly this statement' };
  }
  if (kinds.has('HUMAN_REVIEW')) {
    return { authority: 'HUMAN_VERDICT', reason: 'backed by a human review source artifact' };
  }
  if (kinds.has('DETERMINISTIC_PROOF') || kinds.has('VALIDATOR_RESULT') || kinds.has('PROOF_PACKAGE')) {
    return { authority: 'DETERMINISTIC_PROOF', reason: 'backed by a deterministic validator or proof artifact' };
  }
  if (candidate.proposing_agent) {
    return { authority: 'SPECIALIST_CONCLUSION', reason: `concluded by ${candidate.proposing_agent}; proposal authority only, never human doctrine` };
  }
  return { authority: 'UNVERIFIED', reason: 'no durable evidence backs this statement' };
}

// ── canonical comparison (caller-supplied snapshot only) ──────────────────
// The library never reads hermes-organiser/. Hermes supplies what it already
// legitimately reads; absent that, the proposal says so and needs more review.
function normalizeSnapshot(canonicalSnapshot) {
  if (canonicalSnapshot == null) return null;
  if (!Array.isArray(canonicalSnapshot)) {
    throw new KnowledgeStewardError('KS_SNAPSHOT_INVALID', 'canonical snapshot must be an array of known entries');
  }
  return canonicalSnapshot.map((entry) => {
    if (!plain(entry)) throw new KnowledgeStewardError('KS_SNAPSHOT_INVALID', 'snapshot entry must be an object');
    return {
      reference_id: entry.reference_id ?? null,
      namespace: entry.namespace ?? null,
      statement: typeof entry.statement === 'string' ? entry.statement : null,
      authority: entry.authority ?? null,
      digest: entry.digest ?? null,
      status: entry.status ?? 'active',
    };
  });
}

// Duplicate analysis is purely textual and deterministic. It never judges
// meaning: an exact normalized match is a duplicate, the same statement stored
// under a second reference is duplicated knowledge, and everything else is
// simply not a duplicate. Semantic similarity is never inferred or merged.
function analyzeDuplicates(statement, snapshot, target) {
  if (snapshot === null) return { state: CANONICAL_UNAVAILABLE, matches: [] };
  const fingerprint = statementFingerprint(statement);
  const matches = snapshot.filter((e) => e.statement && statementFingerprint(e.statement) === fingerprint);
  if (!matches.length) return { state: 'NO_DUPLICATE', matches: [] };
  const describe = (e) => ({ reference_id: e.reference_id, authority: e.authority, statement: e.statement });
  const here = matches.filter((e) => !target.reference_id || e.reference_id === target.reference_id);
  if (here.length) return { state: 'EXACT_DUPLICATE', matches: here.map(describe) };
  // Same statement already stored under a different reference: real duplicated
  // knowledge, but which reference should own it is a human decision.
  return {
    state: 'POSSIBLE_DUPLICATE',
    matches: matches.map(describe),
    note: 'this exact statement is already stored under a different canonical reference; a human decides which reference owns it',
  };
}

// Conflict detection is STRUCTURAL, never semantic. The steward cannot read
// meaning, so it never claims two statements contradict. What it can prove
// deterministically is an operation conflict: `add` targets a reference that
// already holds a different active statement. Whether the two agree,
// contradict, or one supersedes the other is exactly the judgement a human
// must make, and the artifact says so rather than guessing.
function analyzeConflicts(candidate, statement, snapshot, operation) {
  if (snapshot === null) return { state: CANONICAL_UNAVAILABLE, conflicts: [] };
  const conflicts = [];
  for (const entry of snapshot) {
    if (!entry.statement || entry.status !== 'active') continue;
    if (!candidate.target.reference_id || entry.reference_id !== candidate.target.reference_id) continue;
    if (statementFingerprint(entry.statement) === statementFingerprint(statement)) continue;
    // amend / supersede / deprecate legitimately target existing content.
    if (operation !== 'add') continue;
    conflicts.push({
      reference_id: entry.reference_id,
      current_statement: entry.statement,
      current_authority: entry.authority,
      proposed_statement: statement,
      proposed_operation: operation,
      conflict_kind: 'OCCUPIED_REFERENCE',
      note: 'add targets a reference that already holds a different active statement; '
        + 'the steward cannot determine whether these agree, contradict, or supersede — a human decides. No winner is chosen.',
    });
  }
  return { state: conflicts.length ? 'CONFLICT' : 'NO_CONFLICT', conflicts };
}

function analyzeSupersession(candidate, snapshot) {
  if (candidate.operation !== 'supersede') return { state: 'NOT_A_SUPERSESSION', predecessor: null };
  const predecessor = candidate.predecessor;
  const record = {
    state: 'SUPERSESSION_PROPOSED',
    predecessor: plain(predecessor) ? { ...predecessor } : { reference_id: String(predecessor) },
    // Historical truth is preserved: the predecessor is referenced, never
    // deleted or rewritten. The canonical writer decides representation.
    predecessor_preserved: true,
    rewrites_history: false,
  };
  if (snapshot !== null && record.predecessor.reference_id) {
    const found = snapshot.find((e) => e.reference_id === record.predecessor.reference_id);
    record.predecessor_found_in_snapshot = Boolean(found);
    if (found) record.predecessor_statement = found.statement;
  } else if (snapshot === null) {
    record.predecessor_found_in_snapshot = CANONICAL_UNAVAILABLE;
  }
  return record;
}

// ── disposition ───────────────────────────────────────────────────────────
function deriveDisposition({ classification, duplicates, conflicts, authority, blockers, humanApproval }) {
  if (blockers.length) return { disposition: 'BLOCKED', reason: blockers[0].detail };
  if (!classification.durable_value) return { disposition: 'NO_DURABLE_VALUE', reason: classification.reason };
  if (duplicates.state === 'EXACT_DUPLICATE') {
    return { disposition: 'DUPLICATE_NO_CHANGE', reason: 'canonical knowledge already carries this exact statement' };
  }
  if (conflicts.state === 'CONFLICT') {
    return { disposition: 'CONFLICT_REQUIRES_HUMAN_REVIEW', reason: conflicts.conflicts[0].note };
  }
  if (duplicates.state === 'POSSIBLE_DUPLICATE') {
    return { disposition: 'POSSIBLE_DUPLICATE_REQUIRES_REVIEW', reason: duplicates.note };
  }
  if (humanApproval?.state === 'VALID') {
    return {
      disposition: 'APPROVED_AWAITING_CANONICAL_WRITER',
      reason: 'human approval binds this exact proposal; application is owned by the Hermes-side canonical writer, not this library',
    };
  }
  if (classification.human_approval_required) {
    return {
      disposition: 'HUMAN_REVIEW_REQUIRED',
      reason: `${classification.knowledge_class} may only become durable through Mikko's explicit approval`,
    };
  }
  if (authority.authority === 'UNVERIFIED') {
    return { disposition: 'HUMAN_REVIEW_REQUIRED', reason: 'statement is unverified; no durable evidence backs it' };
  }
  return { disposition: 'PROPOSAL_READY', reason: 'proposal is complete and awaits human review' };
}

// The substantive digest deliberately EXCLUDES created_at and any approval, so
// the same candidate + snapshot + evidence always yields the same digest.
function proposalDigest(proposal) {
  return sha256(canonicalize({
    schema_version: proposal.schema_version,
    steward_version: proposal.steward_version,
    candidate: proposal.candidate,
    classification: proposal.classification,
    target: proposal.target,
    operation: proposal.operation,
    statement: proposal.statement,
    sources: proposal.sources,
    evidence: proposal.evidence,
    canonical_comparison: proposal.canonical_comparison,
    duplicates: proposal.duplicates,
    conflicts: proposal.conflicts,
    supersession: proposal.supersession,
    authority: proposal.authority,
    revision: proposal.revision,
  }));
}

/**
 * Build a Knowledge Steward proposal. PURE: reads source artifacts to verify
 * their hashes and writes nothing at all.
 *
 * @param {object} input                 { candidate, canonical_snapshot?, approval? }
 * @param {object} [options]             { repoRoot, now, revision }
 * @returns {object} immutable proposal artifact
 */
function createKnowledgeProposal(input, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const now = options.now || new Date().toISOString();
  if (!plain(input) || !plain(input.candidate)) {
    throw new KnowledgeStewardError('KS_INPUT_INVALID', 'input.candidate is required');
  }
  const candidate = input.candidate;
  const { statement } = validateCandidate(candidate);

  const blockers = [];
  const sources = verifySources(candidate, repoRoot, blockers);
  const classification = classifyCandidate(candidate);
  const authority = classifyAuthority(candidate, sources);
  const snapshot = normalizeSnapshot(input.canonical_snapshot ?? null);
  const duplicates = analyzeDuplicates(statement, snapshot, candidate.target);
  const conflicts = analyzeConflicts(candidate, statement, snapshot, candidate.operation);
  const supersession = analyzeSupersession(candidate, snapshot);

  const revision = Number.isInteger(options.revision) && options.revision > 0 ? options.revision : 1;
  const proposal = {
    schema_version: SCHEMA_VERSION,
    artifact_type: 'knowledge-steward-proposal',
    canonical_status: NOT_CANONICAL,
    steward_version: STEWARD_VERSION,
    actor: { ...ACTOR },
    proposal_id: `ksp-${candidate.candidate_id}-r${revision}`,
    revision,
    created_at: now,
    candidate: {
      candidate_id: candidate.candidate_id,
      proposing_agent: candidate.proposing_agent || null,
      source_run_id: candidate.source_run_id || null,
      confidence: candidate.confidence ?? null,
    },
    statement,
    operation: candidate.operation,
    target: {
      namespace: candidate.target.namespace,
      reference_id: candidate.target.reference_id ?? null,
      canonical_path_hint: candidate.target.canonical_path_hint ?? null,
      expected_predecessor_digest: candidate.target.expected_predecessor_digest ?? null,
      // The canonical store is Hermes-side and is not written by this library.
      canonical_store: 'hermes-organiser/brain (Hermes-side canonical writer)',
      writable_by_this_library: false,
    },
    classification,
    authority,
    sources,
    evidence: candidate.evidence || {},
    rationale: candidate.rationale ? text(candidate.rationale, 'rationale', { required: false }) : null,
    canonical_comparison: snapshot === null
      ? { state: CANONICAL_UNAVAILABLE, entries_compared: 0,
          note: 'no canonical snapshot was supplied; a human must confirm current canonical state before adoption' }
      : { state: 'COMPARED', entries_compared: snapshot.length },
    duplicates,
    conflicts,
    supersession,
    blockers,
    human_approval: { required: null, state: 'NOT_RECORDED', approval: null },
    disposition: null,
    reason: null,
    applied: false,
    application_owner: 'future sanctioned Hermes-side canonical knowledge writer',
    proposal_digest_sha256: null,
  };

  const humanApproval = input.approval ? verifyApprovalBinding(proposal, input.approval) : null;
  const decided = deriveDisposition({ classification, duplicates, conflicts, authority, blockers, humanApproval });
  proposal.disposition = decided.disposition;
  proposal.reason = decided.reason;
  proposal.human_approval = {
    required: classification.human_approval_required || decided.disposition === 'HUMAN_REVIEW_REQUIRED'
      || decided.disposition === 'CONFLICT_REQUIRES_HUMAN_REVIEW',
    state: humanApproval ? humanApproval.state : 'NOT_RECORDED',
    approval: humanApproval ? humanApproval.record : null,
    reason: humanApproval ? humanApproval.reason : null,
  };
  proposal.proposal_digest_sha256 = proposalDigest(proposal);
  return proposal;
}

// ── approval binding ──────────────────────────────────────────────────────
// An approval binds to the EXACT proposal digest, target and operation. If the
// proposal changes, the approval is stale. Approval never causes application.
function verifyApprovalBinding(proposal, approval) {
  const base = { record: plain(approval) ? { ...approval } : null };
  if (!plain(approval)) return { ...base, state: 'INVALID', reason: 'approval is not an object' };
  for (const field of ['approved_by', 'approved_at', 'proposal_digest_sha256', 'target_namespace', 'operation']) {
    if (!approval[field]) return { ...base, state: 'INVALID', reason: `detached approval: missing ${field}` };
  }
  if (!HASH_RE.test(approval.proposal_digest_sha256)) {
    return { ...base, state: 'INVALID', reason: 'approval proposal_digest_sha256 is malformed' };
  }
  if (approval.target_namespace !== proposal.target.namespace) {
    return { ...base, state: 'INVALID', reason: 'approval binds a different target namespace' };
  }
  if (approval.operation !== proposal.operation) {
    return { ...base, state: 'INVALID', reason: 'approval binds a different operation' };
  }
  const current = proposalDigest(proposal);
  if (approval.proposal_digest_sha256 !== current) {
    return { ...base, state: 'STALE', reason: 'proposal content changed after approval; the approval no longer binds it' };
  }
  return { ...base, state: 'VALID', reason: null };
}

/**
 * Attach an approval to an already-built proposal. Returns a NEW proposal
 * object; the input is never mutated. Even a VALID approval only moves the
 * proposal to APPROVED_AWAITING_CANONICAL_WRITER. Nothing is applied here.
 */
function bindApproval(proposal, approval) {
  const next = JSON.parse(JSON.stringify(proposal));
  const verified = verifyApprovalBinding(next, approval);
  next.human_approval = {
    required: proposal.human_approval.required,
    state: verified.state,
    approval: verified.record,
    reason: verified.reason,
  };
  if (verified.state === 'VALID') {
    next.disposition = 'APPROVED_AWAITING_CANONICAL_WRITER';
    next.reason = 'human approval binds this exact proposal; application is owned by the Hermes-side canonical writer, not this library';
  } else {
    next.disposition = 'BLOCKED';
    next.reason = `approval is ${verified.state}: ${verified.reason}`;
  }
  next.applied = false;
  return next;
}

function validateProposal(proposal) {
  const errors = [];
  if (!plain(proposal)) return { ok: false, errors: ['proposal must be an object'] };
  if (proposal.schema_version !== SCHEMA_VERSION) errors.push('unsupported schema_version');
  if (proposal.artifact_type !== 'knowledge-steward-proposal') errors.push('wrong artifact_type');
  if (proposal.canonical_status !== NOT_CANONICAL) errors.push('proposal must be marked NOT_CANONICAL_KNOWLEDGE');
  if (proposal.applied !== false) errors.push('a steward proposal may never report itself as applied');
  if (!DISPOSITIONS.includes(proposal.disposition)) errors.push(`unknown disposition ${proposal.disposition}`);
  if (proposal.target?.writable_by_this_library !== false) errors.push('proposal must declare the canonical target unwritable by this library');
  if (proposal.proposal_digest_sha256 !== proposalDigest(proposal)) errors.push('proposal digest does not match its content');
  return { ok: errors.length === 0, errors };
}

// ── human review artifact ─────────────────────────────────────────────────
function renderReviewMarkdown(proposal) {
  const list = (items, render) => (items.length ? items.map(render).join('\n') : '- none');
  // "Current" must show every canonical statement this proposal touches,
  // whichever analysis surfaced it. A conflicting statement appears under
  // conflicts, not duplicates, and omitting it here would let a reviewer
  // approve an overwrite while being told nothing exists.
  const known = new Map();
  for (const m of proposal.duplicates.matches || []) {
    known.set(`${m.reference_id}|${m.statement}`, { ...m, via: 'duplicate' });
  }
  for (const c of proposal.conflicts.conflicts || []) {
    known.set(`${c.reference_id}|${c.current_statement}`,
      { reference_id: c.reference_id, authority: c.current_authority, statement: c.current_statement, via: 'conflict' });
  }
  if (proposal.supersession.predecessor_statement) {
    const ref = proposal.supersession.predecessor.reference_id;
    known.set(`${ref}|${proposal.supersession.predecessor_statement}`,
      { reference_id: ref, authority: null, statement: proposal.supersession.predecessor_statement, via: 'predecessor' });
  }
  const current = proposal.canonical_comparison.state === CANONICAL_UNAVAILABLE
    ? '**UNKNOWN** — no canonical snapshot was supplied, so current canonical state could not be compared. Confirm before adopting.'
    : (known.size
      ? [...known.values()].map((m) => `- \`${m.reference_id}\` (${m.authority || 'authority unknown'}, seen as ${m.via}): ${m.statement}`).join('\n')
      : '- no existing statement found at this reference');
  return `# Proposed knowledge change

**Status: PROPOSAL_ONLY — NOT APPLIED.** This document is ${NOT_CANONICAL}.
Knowledge Steward cannot write the canonical brain; a sanctioned Hermes-side
writer applies approved proposals.

- Proposal: \`${proposal.proposal_id}\` (revision ${proposal.revision})
- Digest: \`${proposal.proposal_digest_sha256}\`
- Disposition: **${proposal.disposition}**
- Operation: \`${proposal.operation}\` on \`${proposal.target.namespace}\`${proposal.target.reference_id ? ` / \`${proposal.target.reference_id}\`` : ''}

## Current

${current}

## Proposed

> ${proposal.statement}

## Why

${proposal.rationale || '- no rationale supplied'}

Authority: **${proposal.authority.authority}** — ${proposal.authority.reason}
Knowledge class: **${proposal.classification.knowledge_class}**

## Sources

${list(proposal.sources, (s) => `- \`${s.artifact_id}\` ${s.path ? `(\`${s.path}\`)` : ''} — ${s.state}${s.observed_sha256 ? ` \`${s.observed_sha256.slice(0, 16)}…\`` : ''}`)}

## Conflicts / duplicates

- Duplicates: **${proposal.duplicates.state}**
${list(proposal.duplicates.matches, (m) => `  - conflicts with \`${m.reference_id}\`: ${m.statement}`)}
- Conflicts: **${proposal.conflicts.state}**
${list(proposal.conflicts.conflicts || [], (c) => `  - current (\`${c.current_authority}\`): ${c.current_statement}\n    proposed: ${c.proposed_statement}`)}
- Supersession: **${proposal.supersession.state}**${proposal.supersession.predecessor ? ` (predecessor \`${proposal.supersession.predecessor.reference_id}\` preserved, history not rewritten)` : ''}

## Impact

Adopting this would ${proposal.operation} \`${proposal.target.namespace}\`${proposal.target.reference_id ? `/\`${proposal.target.reference_id}\`` : ''} in ${proposal.target.canonical_store}.
${proposal.classification.governance_reference_only ? '\n**Agent governance is reference only.** This can never modify the agent registry or contract.\n' : ''}
## Required authority

${proposal.human_approval.required ? '`MIKKO_APPROVAL_REQUIRED`' : '`REVIEW_RECOMMENDED`'}${proposal.classification.human_approval_required ? ` (${proposal.classification.knowledge_class} always requires explicit human approval)` : ''}

## Status

\`PROPOSAL_ONLY — NOT APPLIED\`

- Applied: **${proposal.applied}**
- Application owner: ${proposal.application_owner}
- Blockers: ${proposal.blockers.length ? proposal.blockers.map((b) => `\`${b.code}\``).join(', ') : 'none'}
`;
}

/**
 * Persist a proposal under the single allowlisted proposal root. Writes ONLY
 * non-canonical governance artifacts. Finalized proposals are immutable: a
 * differing digest under the same id is refused, and a revision must be made.
 */
function writeProposal(proposal, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const validation = validateProposal(proposal);
  if (!validation.ok) {
    throw new KnowledgeStewardError('KS_PROPOSAL_INVALID', `refusing to persist an invalid proposal: ${validation.errors.join('; ')}`);
  }
  const paths = proposalPaths(repoRoot, proposal.proposal_id);
  if (fs.existsSync(paths.jsonPath)) {
    const existing = JSON.parse(fs.readFileSync(paths.jsonPath, 'utf8'));
    if (existing.proposal_digest_sha256 !== proposal.proposal_digest_sha256) {
      throw new KnowledgeStewardError('KS_PROPOSAL_IMMUTABLE',
        'a finalized proposal may not be rewritten in place; create a new revision instead');
    }
    return { ...paths, written: false, reason: 'identical proposal already persisted' };
  }
  atomicWrite(paths.jsonPath, `${JSON.stringify(proposal, null, 2)}\n`);
  atomicWrite(paths.reviewPath, renderReviewMarkdown(proposal));
  return { ...paths, written: true, reason: null };
}

/** Bounded read-only summary. Never touches the brain. */
function status() {
  return {
    schema_version: SCHEMA_VERSION,
    steward_version: STEWARD_VERSION,
    actor: { ...ACTOR },
    is_agent: false,
    registered_in_agent_registry: false,
    dispatchable_via_agent_runner: false,
    canonical_production_agents: 12,
    actions: [...ACTIONS],
    prohibited_actions: [...PROHIBITED_ACTIONS],
    knowledge_classes: [...KNOWLEDGE_CLASSES],
    proposal_root: PROPOSAL_ROOT,
    canonical_store: 'hermes-organiser/brain (Hermes-side canonical writer)',
    canonical_store_writable: false,
    note: 'Knowledge Steward proposes durable knowledge changes; it never applies them.',
  };
}

/** Support-role projection. Deliberately NOT an agent control-room row. */
function supportProjection(proposals = []) {
  const byDisposition = proposals.reduce((acc, p) => {
    acc[p.disposition] = (acc[p.disposition] || 0) + 1;
    return acc;
  }, {});
  const latest = proposals.at(-1) || null;
  return {
    role: 'knowledge_steward',
    kind: 'SUPPORT_ROLE',
    is_agent: false,
    proposals_total: proposals.length,
    pending_human_review: proposals.filter((p) => ['HUMAN_REVIEW_REQUIRED', 'CONFLICT_REQUIRES_HUMAN_REVIEW', 'POSSIBLE_DUPLICATE_REQUIRES_REVIEW'].includes(p.disposition)).length,
    blocked: proposals.filter((p) => p.disposition === 'BLOCKED').length,
    approved_awaiting_writer: proposals.filter((p) => p.disposition === 'APPROVED_AWAITING_CANONICAL_WRITER').length,
    by_disposition: byDisposition,
    latest_proposal: latest ? { proposal_id: latest.proposal_id, disposition: latest.disposition, target: latest.target.namespace } : null,
    canonical_mutations_performed: 0,
    canonical_store_writable: false,
  };
}

module.exports = {
  SCHEMA_VERSION, STEWARD_VERSION, ACTOR, NOT_CANONICAL, ACTIONS, PROHIBITED_ACTIONS,
  KNOWLEDGE_CLASSES, OPERATIONS, AUTHORITY_CLASSES, DISPOSITIONS,
  HUMAN_APPROVAL_REQUIRED_CLASSES, CANONICAL_UNAVAILABLE, PROPOSAL_ROOT,
  KnowledgeStewardError, sha256, canonicalize, normalizeStatement, statementFingerprint,
  safeRepoPath, proposalPaths, validateCandidate, verifySources,
  classifyCandidate, classifyAuthority, analyzeDuplicates, analyzeConflicts, analyzeSupersession,
  deriveDisposition, proposalDigest, createKnowledgeProposal,
  verifyApprovalBinding, bindApproval, validateProposal,
  renderReviewMarkdown, writeProposal, status, supportProjection,
};
