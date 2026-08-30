#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const handoff = require('./directed-draft-assembly-handoff.js');
const authority = require('./production-assembly-release-authority.js');

class ProductionAssemblyReleaseSuccessorError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductionAssemblyReleaseSuccessorError'; this.code = code; }
}
function fail(code, message) { throw new ProductionAssemblyReleaseSuccessorError(code, message); }
function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail('RELEASE_SUCCESSOR_JSON_INVALID', `${filePath}: ${error.message}`); }
}
function nextRevisionName(name) {
  const match = /^(.*-R)(\d+)(\.json)$/.exec(name);
  if (!match) fail('RELEASE_SUCCESSOR_NAME_INVALID', name);
  return `${match[1]}${Number(match[2]) + 1}${match[3]}`;
}
function payload(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function writePairImmutable(firstPath, firstValue, secondPath, secondValue) {
  for (const target of [firstPath, secondPath]) if (fs.existsSync(target)) fail('IMMUTABLE_SUCCESSOR_CONFLICT', target);
  const firstTmp = `${firstPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const secondTmp = `${secondPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(firstTmp, payload(firstValue), { flag: 'wx' });
    fs.writeFileSync(secondTmp, payload(secondValue), { flag: 'wx' });
    fs.renameSync(firstTmp, firstPath);
    fs.renameSync(secondTmp, secondPath);
  } catch (error) {
    for (const temporary of [firstTmp, secondTmp]) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}
function exactActive(records, predicate, code) {
  const matches = records.filter(predicate);
  if (matches.length !== 1) fail(code, `expected one active artifact, found ${matches.length}`);
  return matches[0];
}

function createGraphicsAuthoritySuccessor(runDirInput, options = {}) {
  const runDir = fs.realpathSync(runDirInput);
  const intakeRecord = handoff.discoverActiveIntake(runDir);
  const intakeSha = handoff.sha256FileSync(intakeRecord.path);
  const records = handoff.flattenArtifacts(intakeRecord.value);
  const releaseArtifact = exactActive(records, (item) => item.schema === authority.PACKET_SCHEMA && item.status === 'ACTIVE', 'RELEASE_PACKET_AUTHORITY_AMBIGUOUS');
  const graphicsArtifact = exactActive(records, (item) => item.schema === authority.GRAPHICS_DIRECTION_SCHEMA && item.status === 'ACTIVE', 'GRAPHICS_DIRECTION_AUTHORITY_AMBIGUOUS');
  const roots = (options.allowedRoots || handoff.defaultAllowedRoots(runDir)).map((item) => fs.realpathSync(item));
  const releasePath = handoff.resolveAuthorityPath(runDir, releaseArtifact.path, roots, 'release packet');
  const graphicsPath = handoff.resolveAuthorityPath(runDir, graphicsArtifact.path, roots, 'graphics direction');
  if (handoff.sha256FileSync(releasePath) !== releaseArtifact.sha256) fail('RELEASE_PACKET_AUTHORITY_STALE', releaseArtifact.path);
  if (handoff.sha256FileSync(graphicsPath) !== graphicsArtifact.sha256) fail('GRAPHICS_DIRECTION_HASH_MISMATCH', graphicsArtifact.path);
  const predecessor = readJson(releasePath);
  const graphicsValue = readJson(graphicsPath);
  const releaseName = nextRevisionName(path.basename(releaseArtifact.path));
  const intakeName = nextRevisionName(intakeRecord.name);
  const successor = authority.buildVisualDraftGraphicsAuthoritySuccessor(predecessor, {
    predecessorPath: releaseArtifact.path,
    predecessorSha256: releaseArtifact.sha256,
    graphicsArtifact,
    graphicsValue,
  });
  const successorSha = crypto.createHash('sha256').update(payload(successor)).digest('hex');
  const intakeSuccessor = structuredClone(intakeRecord.value);
  intakeSuccessor.created_at = options.createdAt || new Date().toISOString();
  intakeSuccessor.predecessor = { path: intakeRecord.name, sha256: intakeSha, status: 'HISTORICAL' };
  const releaseSlot = intakeSuccessor.slots.find((slot) => slot.slot === releaseArtifact.slot);
  if (!releaseSlot) fail('RELEASE_PACKET_SLOT_MISSING', String(releaseArtifact.slot));
  const releaseIndex = releaseSlot.artifacts.findIndex((item) => item.schema === authority.PACKET_SCHEMA && item.status === 'ACTIVE');
  if (releaseIndex < 0) fail('RELEASE_PACKET_SLOT_MISSING', String(releaseArtifact.slot));
  releaseSlot.artifacts[releaseIndex] = {
    ...releaseSlot.artifacts[releaseIndex],
    path: releaseName,
    sha256: successorSha,
    predecessor_sha256: releaseArtifact.sha256,
  };
  const releaseSuccessorPath = path.join(runDir, releaseName);
  const intakeSuccessorPath = path.join(runDir, intakeName);
  if (!options.dryRun) writePairImmutable(releaseSuccessorPath, successor, intakeSuccessorPath, intakeSuccessor);
  return {
    predecessor: { intake_path: intakeRecord.path, intake_sha256: intakeSha, release_path: releasePath, release_sha256: releaseArtifact.sha256 },
    successor: { intake_path: intakeSuccessorPath, intake_sha256: crypto.createHash('sha256').update(payload(intakeSuccessor)).digest('hex'), release_path: releaseSuccessorPath, release_sha256: successorSha },
    graphics_direction: { path: graphicsPath, sha256: graphicsArtifact.sha256, schema: graphicsArtifact.schema, authority: graphicsValue.authority, decision: graphicsValue.decision },
    release_packet: successor,
    intake: intakeSuccessor,
  };
}

function parseArgs(argv) {
  const out = { command: argv[0] };
  if (out.command !== 'correct-visual-draft-graphics-binding') fail('RELEASE_SUCCESSOR_COMMAND_INVALID', String(out.command));
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--repo') out.repo = argv[++index];
    else if (argv[index] === '--dry-run') out.dryRun = true;
    else fail('RELEASE_SUCCESSOR_ARGUMENT_INVALID', argv[index]);
  }
  if (!out.runId) fail('RELEASE_SUCCESSOR_RUN_ID_REQUIRED', '--run-id required');
  return out;
}
function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repo = path.resolve(args.repo || path.join(__dirname, '..'));
    const runDir = handoff.resolveRunDir(repo, args.runId);
    const result = createGraphicsAuthoritySuccessor(runDir, { dryRun: args.dryRun });
    process.stdout.write(`${JSON.stringify({ status: args.dryRun ? 'DRY_RUN_PASS' : 'ACTIVE_SUCCESSOR_CREATED', run_id: args.runId, predecessor: result.predecessor, successor: result.successor, graphics_direction: result.graphics_direction })}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'RELEASE_SUCCESSOR_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ProductionAssemblyReleaseSuccessorError, nextRevisionName, writePairImmutable, createGraphicsAuthoritySuccessor, parseArgs, main };
if (require.main === module) main();
