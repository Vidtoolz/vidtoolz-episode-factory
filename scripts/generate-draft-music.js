#!/usr/bin/env node
'use strict';

/*
 * generate-draft-music — the one canonical Draft music entry point.
 *
 *   node scripts/generate-draft-music.js --run-id <run-id> [--narration <wav>]
 *   node scripts/generate-draft-music.js --script-file <path> [--out-dir <dir>]
 *   node scripts/generate-draft-music.js status
 *
 * Hermes never needs model directories, GPU ids, endpoints, temporary paths
 * or prompt files: the orchestrator resolves everything through the canonical
 * music_generation compute lane and operator-tunnel authority.
 */

const orchestrator = require('./draft-music-orchestrator.js');

const argv = process.argv.slice(2);
const withCommand = ['generate', 'analyze', 'status'].includes(argv[0]) ? argv : ['generate', ...argv];
orchestrator.main(withCommand).then((code) => { process.exitCode = code; });
