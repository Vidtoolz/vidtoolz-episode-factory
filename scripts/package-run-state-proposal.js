#!/usr/bin/env node
"use strict";

const activeStateAudit = require("./package-run-active-state-audit.js");

const EXACT_NEXT_SAFE_ACTION =
  "Review this proposal, then explicitly choose which single package run remains active before package-run-specific cockpit panels make decisions.";
const BLOCKED_ACTIONS = [
  "approve-production",
  "ready-to-shoot",
  "capture intake",
  "publish",
  "archive",
  "Hermes/project-state promotion",
];
const SAFETY = {
  readOnly: true,
  externalApisCalled: false,
  packageRunFilesWritten: false,
  packageRunsIndexUpdated: false,
  approvalMarkersAdded: false,
  gitActionsPerformed: false,
  mediaMutated: false,
  hermesOrProjectStateUpdated: false,
  scheduledJobsCreated: false,
};

function usage() {
  return `Package Run State Proposal

Usage:
  node scripts/package-run-state-proposal.js
  node scripts/package-run-state-proposal.js --json
  node scripts/package-run-state-proposal.js --help

Read-only proposal packet for resolving active package-run ambiguity.
This script does not write package-run-state.md, update package-runs-index.json,
add approval markers, mutate media, run Git commands, update Hermes/project state,
create scheduled jobs, or call external APIs.`;
}

function parseArgs(argv = []) {
  const result = {
    json: false,
    help: false,
  };
  argv.forEach((arg) => {
    if (arg === "--json") {
      result.json = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  });
  return result;
}

function runDateKey(run = {}) {
  const match = String(run.runId || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isProductionRelevant(run = {}) {
  const text = [run.workflowBucket, run.activeWorkflowBucket, run.status, run.activeStatus].join(" ").toLowerCase();
  return /production|shoot|qa repair|script|capture/.test(text);
}

function hasReliableStateData(run = {}) {
  return Boolean(run.sourcePresentInIndex && run.sourcePresentOnDisk && !run.scanError && !run.packageRunState?.warning);
}

function chooseConservativeKeepCandidate(candidates = []) {
  const reliable = candidates.filter((run) => hasReliableStateData(run));
  const productionRelevant = reliable.filter((run) => isProductionRelevant(run));
  const pool = productionRelevant.length ? productionRelevant : reliable;
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => {
    const dateCompare = runDateKey(b).localeCompare(runDateKey(a));
    if (dateCompare !== 0) return dateCompare;
    return String(b.runId || "").localeCompare(String(a.runId || ""));
  });
  const first = sorted[0];
  const second = sorted[1];
  if (second && runDateKey(first) === runDateKey(second)) return null;
  return first;
}

function proposalForRun(run, keepCandidate, activeCount) {
  const rationale = [
    run.inferredReason || "The active-state audit reported this run as an active candidate.",
  ];
  let proposedState = "manual-review";
  let confidence = "low";

  if (activeCount === 1) {
    proposedState = "keep-active";
    confidence = hasReliableStateData(run) ? "high" : "medium";
    rationale.push("This is the only active candidate found by the audit.");
  } else if (!keepCandidate) {
    proposedState = "manual-review";
    confidence = "low";
    rationale.push("Multiple active candidates exist and no single conservative keep-active candidate can be justified.");
  } else if (run.path === keepCandidate.path) {
    proposedState = "keep-active";
    confidence = "medium";
    rationale.push("This is the most current production-relevant candidate with reliable local audit data.");
  } else if (runDateKey(run) && runDateKey(keepCandidate) && runDateKey(run) < runDateKey(keepCandidate)) {
    proposedState = "park";
    confidence = "medium";
    rationale.push("This active candidate is older than the proposed keep-active run; park is reversible and does not discard work.");
  } else {
    proposedState = "manual-review";
    confidence = "low";
    rationale.push("The script cannot safely classify this active candidate without Mikko review.");
  }

  return {
    runId: run.runId,
    path: run.path,
    currentState: run.packageRunState?.state || run.state || "unknown",
    proposedState,
    confidence,
    rationale,
    blockedActions: [...BLOCKED_ACTIONS],
    requiredHumanReview: true,
  };
}

function buildStateProposal(options = {}) {
  const audit = activeStateAudit.buildActiveStateAudit(options);
  const candidates = audit.candidateActiveRuns || [];
  const keepCandidate = candidates.length > 1 ? chooseConservativeKeepCandidate(candidates) : candidates[0] || null;
  const proposals = candidates.map((run) => proposalForRun(run, keepCandidate, candidates.length));
  const selectedActiveRun = proposals.filter((item) => item.proposedState === "keep-active").length === 1
    ? proposals.find((item) => item.proposedState === "keep-active").path
    : "";

  return {
    name: "package_run_state_proposal",
    ok: audit.ok && candidates.length === 1,
    ambiguity: Boolean(audit.ambiguity),
    selectedActiveRun,
    proposals,
    exactNextSafeAction: EXACT_NEXT_SAFE_ACTION,
    auditSummary: {
      ok: audit.ok,
      ambiguity: audit.ambiguity,
      selectedActiveRun: audit.selectedActiveRun,
      candidateActiveRunCount: candidates.length,
      sourceIndex: {
        ok: audit.sourceIndex?.ok || false,
        path: audit.sourceIndex?.path || "",
        error: audit.sourceIndex?.error || "",
      },
      packageRunsDirectory: audit.packageRunsDirectory || {},
      errors: audit.errors || [],
    },
    safety: { ...SAFETY },
  };
}

function renderProposal(proposal) {
  const lines = [
    `- ${proposal.path}`,
    `  - runId: ${proposal.runId}`,
    `  - current state: ${proposal.currentState}`,
    `  - proposed state: ${proposal.proposedState}`,
    `  - confidence: ${proposal.confidence}`,
    `  - required human review: ${proposal.requiredHumanReview ? "yes" : "no"}`,
    "  - rationale:",
  ];
  proposal.rationale.forEach((item) => {
    lines.push(`    - ${item}`);
  });
  lines.push(`  - blocked actions: ${proposal.blockedActions.join(", ")}`);
  return lines.join("\n");
}

function renderText(packet) {
  const lines = [
    "# Package Run State Proposal",
    "",
    `- OK: ${packet.ok ? "true" : "false"}`,
    `- Ambiguity: ${packet.ambiguity ? "true" : "false"}`,
    `- Selected active run proposal: ${packet.selectedActiveRun || "not selected"}`,
    "",
    "## Proposals",
  ];

  if (packet.proposals.length) {
    packet.proposals.forEach((proposal) => {
      lines.push(renderProposal(proposal), "");
    });
  } else {
    lines.push("- No active package-run candidates were found.", "");
  }

  lines.push(
    "## Exact Next Safe Action",
    "",
    packet.exactNextSafeAction,
    "",
    "## Safety Boundary",
    "",
    `- readOnly: ${packet.safety.readOnly}`,
    `- externalApisCalled: ${packet.safety.externalApisCalled}`,
    `- packageRunFilesWritten: ${packet.safety.packageRunFilesWritten}`,
    `- packageRunsIndexUpdated: ${packet.safety.packageRunsIndexUpdated}`,
    `- approvalMarkersAdded: ${packet.safety.approvalMarkersAdded}`,
    `- gitActionsPerformed: ${packet.safety.gitActionsPerformed}`,
    `- mediaMutated: ${packet.safety.mediaMutated}`,
    `- hermesOrProjectStateUpdated: ${packet.safety.hermesOrProjectStateUpdated}`,
    `- scheduledJobsCreated: ${packet.safety.scheduledJobsCreated}`
  );

  return lines.join("\n");
}

function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const packet = buildStateProposal(options);
  if (args.json) {
    console.log(JSON.stringify(packet, null, 2));
  } else {
    console.log(renderText(packet));
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  EXACT_NEXT_SAFE_ACTION,
  BLOCKED_ACTIONS,
  SAFETY,
  usage,
  parseArgs,
  buildStateProposal,
  renderText,
  main,
};
