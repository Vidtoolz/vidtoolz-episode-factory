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
const { APPROVAL_SCOPES, isApprovalScope } = require('./approval-scopes.js');

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(REPO_ROOT, "config", "agent-contract.json");
const REGISTRY_PATH = path.join(REPO_ROOT, "config", "agent-registry.json");

const DISAGREEMENT_STATES = ["NONE", "RESOLVED_BY_CONTRACT", "NEEDS_SPECIALIST_REVIEW", "NEEDS_HUMAN_DECISION", "BLOCKED"];
const ATTENTION_LEVELS = ["AUTONOMOUS", "INFORMATION", "REVIEW", "DECISION"];

// Lifecycle: doctrine completeness, provenness, and executability are three
// different facts. Contract status is the classification; the registry
// lifecycle block is the only thing that grants dispatch.
const DEFAULT_STATUS_MAP = {
  BUILT: { registry_proven: "PROVEN", autonomous_dispatch: "ENABLED" },
  PLANNED: { registry_proven: "NOT_PROVEN", autonomous_dispatch: "DISABLED" },
  PLANNED_LAST: { registry_proven: "NOT_PROVEN", autonomous_dispatch: "DISABLED" },
};
const PROVEN_VALUES = ["PROVEN", "NOT_PROVEN"];
const DISPATCH_VALUES = ["ENABLED", "DISABLED"];

// An allowed_action may never claim a human-only decision, whatever the role.
const FORBIDDEN_ALLOWED_ACTIONS = [
  /\bgreenlight\b/i,
  /\brecord\b[^.]*\bhuman approval\b/i,
  /\bapprove\b[^.]*\b(final|publication|episode|greenlight)\b/i,
  /\bpublish\b(?!-gate)/i,
];

// The two highest-risk roles must disown every human-only decision explicitly.
const HUMAN_ONLY_GUARDS = {
  creative_director: [
    /greenlight/i, /final cut/i, /final music/i, /final title/i,
    /final thumbnail/i, /publish/i, /record human approval/i,
  ],
  presenter_director: [
    /greenlight/i, /final cut/i, /publication|publish/i, /record human approval/i,
  ],
};

// Specialist responsibilities the Creative Director must not absorb.
const CREATIVE_NON_ABSORPTION = [
  /shot prompts?/i, /camera mechanics/i, /research verdicts/i,
  /QC verdicts/i, /generation backend/i,
];

function lifecycleOf(agent) {
  return agent && typeof agent.lifecycle === "object" && !Array.isArray(agent.lifecycle) ? agent.lifecycle : null;
}

function isEnabled(agent) {
  const lifecycle = lifecycleOf(agent);
  return Boolean(lifecycle && lifecycle.proven === "PROVEN" && lifecycle.autonomous_dispatch === "ENABLED");
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// approval_binding — generalized Earth Studio durability principle.
// A durable approval binds to: artifact path, sha256, commit, approver,
// timestamp, scope. STALE/INVALID approvals carry no authority.
// ---------------------------------------------------------------------------
function verifyApprovalBinding(binding, currentArtifactBytes, expectedScope = null) {
  if (!binding || typeof binding !== "object") {
    return { verdict: "INVALID", reason: "no approval binding present" };
  }
  for (const field of ["artifact_path", "artifact_sha256", "commit", "approved_by", "approved_at", "scope"]) {
    if (!binding[field]) {
      return { verdict: "INVALID", reason: `detached approval: missing ${field}` };
    }
  }
  if (!isApprovalScope(binding.scope)) {
    return { verdict: "INVALID", reason: `approval scope is not canonical: ${binding.scope}` };
  }
  const requiredScope = expectedScope && typeof expectedScope === 'object'
    ? expectedScope.expectedScope
    : expectedScope;
  if (requiredScope && (!isApprovalScope(requiredScope) || binding.scope !== requiredScope)) {
    return { verdict: "INVALID", reason: `approval scope mismatch: expected ${requiredScope}, received ${binding.scope}` };
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

// Gate authorization is intentionally separate from generic forensic structure
// validation. A gate consumer must name the exact scope it is consuming.
function verifyApprovalBindingForScope(binding, currentArtifactBytes, expectedScope) {
  if (!expectedScope) return { verdict: 'INVALID', reason: 'gate authorization requires expectedScope' };
  return verifyApprovalBinding(binding, currentArtifactBytes, expectedScope);
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

  // -------------------------------------------------------------------------
  // Doctrine completeness. Every canonical roster role carries a registry
  // doctrine entry regardless of lifecycle: registry presence proves doctrine,
  // lifecycle decides executability. A PASS therefore means the canonical
  // role architecture is structurally complete, not that today's proven
  // agents happen to be represented.
  // -------------------------------------------------------------------------
  const lc = contract.lifecycle_classification || {};
  const statusMap = lc.status_map || DEFAULT_STATUS_MAP;
  const roster = contract.role_roster || [];
  const registryById = new Map((registry.agents || []).map((a) => [a.agent_id, a]));
  const nonAgentRoles = new Set(["hermes", "knowledge_steward"]);

  if (!lc.doctrine_completeness_invariant) add("contract missing lifecycle_classification.doctrine_completeness_invariant");
  if (typeof lc.canonical_role_count === "number" && roster.length !== lc.canonical_role_count) {
    add(`role_roster holds ${roster.length} roles but canonical_role_count is ${lc.canonical_role_count}`);
  }

  for (const role of roster) {
    const expected = statusMap[role.status];
    const registered = registryById.get(role.role_id);
    if (!registered) {
      if (expected && expected.autonomous_dispatch === "ENABLED") {
        add(`proven roster role "${role.role_id}" (status ${role.status}) has no registry doctrine entry`);
      } else {
        add(`planned roster role "${role.role_id}" (status ${role.status}) has no registry doctrine entry — roster roles carry doctrine regardless of lifecycle`);
      }
      continue;
    }
    const lifecycle = lifecycleOf(registered);
    if (!lifecycle) {
      add(`registry role "${role.role_id}" has no lifecycle block; doctrine presence must never imply enablement`);
      continue;
    }
    if (lifecycle.doctrine !== "DEFINED") add(`registry role "${role.role_id}" lifecycle.doctrine must be DEFINED`);
    if (!PROVEN_VALUES.includes(lifecycle.proven)) {
      add(`registry role "${role.role_id}" lifecycle.proven must be one of ${PROVEN_VALUES.join(" | ")}`);
    }
    if (!DISPATCH_VALUES.includes(lifecycle.autonomous_dispatch)) {
      add(`registry role "${role.role_id}" lifecycle.autonomous_dispatch must be one of ${DISPATCH_VALUES.join(" | ")}`);
    }
    if (lifecycle.proven === "NOT_PROVEN" && lifecycle.autonomous_dispatch !== "DISABLED") {
      add(`registry role "${role.role_id}" is NOT_PROVEN but autonomous_dispatch is not DISABLED — doctrine must never self-promote into autonomy`);
    }
    if (!expected) {
      add(`roster role "${role.role_id}" has unmapped lifecycle status ${role.status}`);
    } else {
      if (lifecycle.proven !== expected.registry_proven) {
        add(`registry role "${role.role_id}" is ${lifecycle.proven} but contract status ${role.status} requires ${expected.registry_proven}`);
      }
      if (lifecycle.autonomous_dispatch !== expected.autonomous_dispatch) {
        add(`registry role "${role.role_id}" dispatch ${lifecycle.autonomous_dispatch} contradicts contract status ${role.status} (expected ${expected.autonomous_dispatch})`);
      }
    }
    if (lifecycle.autonomous_dispatch === "DISABLED" && !lifecycle.dispatch_blocked_reason) {
      add(`registry role "${role.role_id}" is dispatch-DISABLED without a dispatch_blocked_reason`);
    }
  }

  // Registry exclusivity: only roster roles are agents.
  const rosterRoleIds = new Set(roster.map((r) => r.role_id));
  for (const a of registry.agents || []) {
    if (a.agent_id === "knowledge_steward") {
      add("knowledge_steward is a non-specialist contract role and must never be registered as an agent");
    } else if (!rosterRoleIds.has(a.agent_id) && !nonAgentRoles.has(a.agent_id)) {
      add(`unexpected registry role "${a.agent_id}" is not in the canonical role_roster`);
    }
  }

  // -------------------------------------------------------------------------
  // Escalation rules must be mechanically routable for every registered role:
  // a structured map keyed only by the canonical attention taxonomy.
  // -------------------------------------------------------------------------
  for (const a of registry.agents || []) {
    const rules = a.escalation_rules;
    if (rules === undefined) {
      add(`registry role "${a.agent_id}" has no escalation_rules`);
      continue;
    }
    if (typeof rules === "string" || typeof rules !== "object" || Array.isArray(rules)) {
      add(`registry role "${a.agent_id}" escalation_rules must be a structured attention map, not prose`);
      continue;
    }
    const keys = Object.keys(rules);
    if (!keys.length) add(`registry role "${a.agent_id}" escalation_rules is empty`);
    for (const key of keys) {
      if (!ATTENTION_LEVELS.includes(key)) {
        add(`registry role "${a.agent_id}" escalation level "${key}" is outside the canonical attention taxonomy (${ATTENTION_LEVELS.join(" | ")})`);
      }
      if (typeof rules[key] !== "string" || !rules[key].trim()) {
        add(`registry role "${a.agent_id}" escalation level "${key}" has no routable condition`);
      }
    }
  }
  for (const level of ATTENTION_LEVELS) {
    if (!registry.attention_levels || !registry.attention_levels[level]) {
      add(`registry attention_levels missing canonical level ${level}`);
    }
  }
  for (const level of Object.keys(registry.attention_levels || {})) {
    if (!ATTENTION_LEVELS.includes(level)) add(`registry defines a second attention taxonomy level: ${level}`);
  }

  // -------------------------------------------------------------------------
  // Human-only authority may never be claimed by any agent, and the two
  // highest-risk roles must disown each human-only decision explicitly.
  // -------------------------------------------------------------------------
  for (const a of registry.agents || []) {
    for (const action of a.allowed_actions || []) {
      for (const pattern of FORBIDDEN_ALLOWED_ACTIONS) {
        if (pattern.test(action)) add(`registry role "${a.agent_id}" claims a human-only action: "${action}"`);
      }
    }
    // No agent may publish, and every role must say so explicitly.
    if (!(a.prohibited_actions || []).some((p) => /publish/i.test(p))) {
      add(`registry role "${a.agent_id}" lacks an explicit publish prohibition`);
    }
  }
  for (const [roleId, patterns] of Object.entries(HUMAN_ONLY_GUARDS)) {
    const registered = registryById.get(roleId);
    if (!registered) continue;
    const prohibited = (registered.prohibited_actions || []).join(" | ");
    for (const pattern of patterns) {
      if (!pattern.test(prohibited)) add(`registry role "${roleId}" must explicitly prohibit ${pattern.source}`);
    }
  }
  const creative = registryById.get("creative_director");
  if (creative) {
    const prohibited = (creative.prohibited_actions || []).join(" | ");
    for (const pattern of CREATIVE_NON_ABSORPTION) {
      if (!pattern.test(prohibited)) {
        add(`creative_director must disown the specialist responsibility ${pattern.source} (super-agent guard)`);
      }
    }
    if (!/specialist/i.test(prohibited)) add("creative_director must prohibit seizing specialist-agent responsibilities");
  }

  const enabled = (registry.agents || []).filter(isEnabled).map((a) => a.agent_id);
  const summary = {
    canonical_roles: roster.length,
    registered_doctrine: (registry.agents || []).length,
    doctrine_complete: roster.every((r) => registryById.has(r.role_id)),
    enabled_for_dispatch: enabled,
    doctrine_only: (registry.agents || []).filter((a) => !isEnabled(a)).map((a) => a.agent_id),
    hermes_registered: agentIds.has("hermes"),
  };

  return { ok: errors.length === 0, errors, warnings, summary };
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

module.exports = {
  DISAGREEMENT_STATES, ATTENTION_LEVELS, APPROVAL_SCOPES, PROVEN_VALUES, DISPATCH_VALUES, DEFAULT_STATUS_MAP,
  lifecycleOf, isEnabled, sha256, verifyApprovalBinding, verifyApprovalBindingForScope, validateContract, main,
};

if (require.main === module) {
  const result = main(process.argv.slice(2));
  if (result.warnings.length) result.warnings.forEach((w) => console.warn(`warning: ${w}`));
  if (result.ok) {
    const s = result.summary;
    console.log(`agent contract: VALID — ${s.canonical_roles}-role architecture structurally complete`);
    console.log(`  doctrine entries: ${s.registered_doctrine}/${s.canonical_roles} (complete: ${s.doctrine_complete})`);
    console.log(`  enabled for dispatch: ${s.enabled_for_dispatch.length} — ${s.enabled_for_dispatch.join(", ")}`);
    console.log(`  doctrine only, dispatch refused: ${s.doctrine_only.length} — ${s.doctrine_only.join(", ") || "none"}`);
  } else {
    result.errors.forEach((e) => console.error(`error: ${e}`));
    process.exitCode = 1;
  }
}
