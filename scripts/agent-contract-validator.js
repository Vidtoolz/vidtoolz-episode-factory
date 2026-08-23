#!/usr/bin/env node
"use strict";

// agent-contract-validator.js
// Deterministic validator for the VIDTOOLZ multi-agent authority contract
// (config/agent-contract.json). This is a SERVICE, not an agent — per the
// deterministic-first doctrine it owns machine-checkable contract invariants
// and must never be represented as an autonomous agent in the registry.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(REPO_ROOT, "config", "agent-contract.json");
const REGISTRY_PATH = path.join(REPO_ROOT, "config", "agent-registry.json");

const DISAGREEMENT_STATES = ["NONE", "RESOLVED_BY_CONTRACT", "NEEDS_SPECIALIST_REVIEW", "NEEDS_HUMAN_DECISION", "BLOCKED"];
const ATTENTION_LEVELS = ["AUTONOMOUS", "INFORMATION", "REVIEW", "DECISION"];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// approval_binding — generalized Earth Studio durability principle.
// A durable approval binds to: artifact path, sha256, commit, approver,
// timestamp, scope. STALE/INVALID approvals carry no authority.
// ---------------------------------------------------------------------------
function verifyApprovalBinding(binding, currentArtifactBytes) {
  if (!binding || typeof binding !== "object") {
    return { verdict: "INVALID", reason: "no approval binding present" };
  }
  for (const field of ["artifact_path", "artifact_sha256", "commit", "approved_by", "approved_at", "scope"]) {
    if (!binding[field]) {
      return { verdict: "INVALID", reason: `detached approval: missing ${field}` };
    }
  }
  if (!currentArtifactBytes) {
    return { verdict: "STALE", reason: "artifact no longer exists" };
  }
  const currentHash = sha256(currentArtifactBytes);
  if (currentHash !== binding.artifact_sha256) {
    return { verdict: "STALE", reason: "artifact bytes changed since approval" };
  }
  return { verdict: "VALID" };
}

// ---------------------------------------------------------------------------
// Contract validation — returns { ok, errors: [], warnings: [] }.
// ---------------------------------------------------------------------------
function validateContract(contract, registry) {
  const errors = [];
  const warnings = [];
  const add = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // Hermes contract
  if (!contract.hermes) add("contract missing hermes definition");
  else {
    if (contract.hermes.is_specialist !== false) add("hermes must not be a specialist");
    for (const p of [
      "performing specialist creative work", "overriding a specialist verdict", "overriding QC",
      "recording human approval on Mikko's behalf", "publishing", "manufacturing consensus",
      "hiding or silently resolving disagreement",
    ]) {
      if (!contract.hermes.prohibited.some((x) => x === p)) add(`hermes.prohibited missing: ${p}`);
    }
  }

  // Deterministic-first: registry agents must not duplicate validator services
  if (!contract.deterministic_first || !contract.deterministic_first.principle) {
    add("contract missing deterministic_first principle");
  }
  const agentIds = new Set((registry.agents || []).map((a) => a.agent_id));
  const serviceTokens = ["validator", "predicate", "deriver", "provenance_stamper", "media_router", "schema_validator"];
  for (const svc of (contract.deterministic_first && contract.deterministic_first.services) || []) {
    const svcId = svc.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
    if (agentIds.has(svcId)) add(`deterministic service "${svc}" is registered as an autonomous agent (${svcId})`);
    const firstToken = svcId.split("_")[0];
    if ((firstToken === "media" || firstToken === "camera" || firstToken === "run" || firstToken === "schema") && [...agentIds].some((id) => id.startsWith(svcId.slice(0, firstToken.length + 1)) && /valid|predicate|deriv|stamp|routing/.test(id))) {
      add(`deterministic service "${svc}" appears re-registered as an autonomous agent`);
    }
  }
  for (const id of agentIds) {
    for (const tok of serviceTokens) {
      if (id.includes(tok)) add(`registered agent "${id}" looks like a deterministic service (${tok}), not an agent`);
    }
  }

  // Exactly one authoritative owner per decision class
  const ownership = new Map();
  for (const role of contract.role_roster || []) {
    for (const o of role.owns || []) {
      const key = o.toLowerCase().trim();
      if (ownership.has(key) && ownership.get(key) !== role.role_id) {
        add(`two roles own "${o}": ${ownership.get(key)} and ${role.role_id}`);
      }
      ownership.set(key, role.role_id);
    }
  }
  // Known cross-role conflict classes that MUST resolve to exactly one owner
  const singleOwnerChecks = [
    ["camera movement", "camera_director"],
    ["machine/backend routing", "generation_supervisor"],
    ["shot briefs", "visual_planning_director"],
    ["episode creative identity", "creative_director"],
    ["music generation provenance", "sound_music_director"],
    ["take logging", "presenter_director"],
    ["run-state maintenance", "production_operations"],
  ];
  for (const [owned, expected] of singleOwnerChecks) {
    const actual = ownership.get(owned);
    if (actual !== expected) add(`decision class "${owned}" must be owned solely by ${expected}, found: ${actual}`);
  }

  // Authority-boundary invariants (structural, not wording)
  const byId = Object.fromEntries((contract.role_roster || []).map((r) => [r.role_id, r]));
  const notOwns = (role, phrase) => {
    const r = byId[role];
    return r && (r.does_not_own || []).some((d) => d.toLowerCase().includes(phrase));
  };
  if (!notOwns("qc_director", "regeneration") || !notOwns("qc_director", "aesthetic")) {
    add("qc_director must not own regeneration or aesthetic selection");
  }
  if (!notOwns("editor", "argument")) add("editor must not own argument authority");
  if (!notOwns("visual_planning_director", "creative identity")) {
    add("visual_planning_director must not own episode creative identity");
  }
  if (!notOwns("creative_director", "shot prompts")) add("creative_director must not own shot prompts");
  if (!notOwns("generation_supervisor", "creative brief")) add("generation_supervisor must not own the creative brief");
  if (!notOwns("presenter_director", "argument")) add("presenter_director must not own the argument");

  // Hermes must not appear in the specialist roster
  if ((contract.role_roster || []).some((r) => r.role_id === "hermes")) {
    add("hermes must not be listed in role_roster (not specialist #13)");
  }

  // Knowledge Steward write gate
  const ks = contract.knowledge_steward;
  if (!ks) add("contract missing knowledge_steward");
  else {
    if (!ks.write_gate || !/human-gated/i.test(ks.write_gate)) {
      add("knowledge_steward durable writes must be human-gated");
    }
    if (!ks.does_not_own.some((d) => /parallel knowledge universe/i.test(d))) {
      add("knowledge_steward must disown a parallel knowledge universe");
    }
  }

  // Disagreement model
  const dm = contract.disagreement_model;
  if (!dm || JSON.stringify(dm.states) !== JSON.stringify(DISAGREEMENT_STATES)) {
    add(`disagreement states must be exactly: ${DISAGREEMENT_STATES.join(", ")}`);
  }

  // Lifecycle authority: 14 gates canonical
  const la = contract.lifecycle_authority || {};
  if (!/14/.test(la.canonical || "")) add("lifecycle canonical must name the 14-gate workflow");
  if (!la.run_state || !/AMBIGUOUS/.test(JSON.stringify(la.run_state.ambiguity || ""))) {
    add("run-state ambiguity policy must prefer AMBIGUOUS over guessing");
  }

  // Approval binding shape
  const ab = contract.approval_binding || {};
  for (const f of ["artifact_path", "artifact_sha256", "commit", "approved_by", "approved_at", "scope"]) {
    if (!(ab.required_fields || []).includes(f)) add(`approval_binding.required_fields missing ${f}`);
  }
  if (!/STALE/.test(ab.stale_rule || "")) add("approval_binding must define the STALE rule");

  // Build order: creative_director last
  const bo = contract.build_order || [];
  if (bo[bo.length - 1] !== "creative_director") add("creative_director must be last in build_order");
  const rosterIds = new Set([...(contract.role_roster || []).map((r) => r.role_id), "knowledge_steward"]);
  for (const id of bo) if (!rosterIds.has(id)) add(`build_order references unknown role ${id}`);

  // Registry compatibility: the five proven agents must remain registered
  for (const required of ["production_operations", "camera_director", "generation_supervisor", "editor", "qc_director"]) {
    if (!agentIds.has(required)) add(`registry missing proven agent ${required}`);
  }
  // Registry agents must not claim contract-prohibited authority
  for (const a of registry.agents || []) {
    if (a.agent_id === "qc_director" && (a.allowed_actions || []).some((x) => /repair|regenerate|rewrite/i.test(x))) {
      add("registry qc_director claims a repair/regeneration action");
    }
    if (a.agent_id === "hermes") add("hermes must never be registered as an agent");
  }

  return { ok: errors.length === 0, errors, warnings };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--contract") args.contract = argv[++i];
    else if (argv[i] === "--registry") args.registry = argv[++i];
  }
  const contract = JSON.parse(fs.readFileSync(args.contract || CONTRACT_PATH, "utf8"));
  const registry = JSON.parse(fs.readFileSync(args.registry || REGISTRY_PATH, "utf8"));
  const result = validateContract(contract, registry);
  return { contract_path: args.contract || CONTRACT_PATH, registry_path: args.registry || REGISTRY_PATH, ...result };
}

module.exports = { DISAGREEMENT_STATES, ATTENTION_LEVELS, sha256, verifyApprovalBinding, validateContract, main };

if (require.main === module) {
  const result = main(process.argv.slice(2));
  if (result.warnings.length) result.warnings.forEach((w) => console.warn(`warning: ${w}`));
  if (result.ok) {
    console.log("agent contract: VALID");
  } else {
    result.errors.forEach((e) => console.error(`error: ${e}`));
    process.exitCode = 1;
  }
}
