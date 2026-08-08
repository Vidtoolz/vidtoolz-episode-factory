'use strict';
// VIDTOOLZ ComfyUI Production Gateway — the stable semantic boundary between
// VIDTOOLZ production and raw ComfyUI graphs. See docs/comfyui-production-gateway.md.
const registry = require('./registry.js');
const contracts = require('./contracts.js');
const client = require('./client.js');
const preflight = require('./preflight.js');
const failures = require('./failures.js');
const provenance = require('./provenance.js');
const fingerprint = require('./fingerprint.js');
const qualification = require('./qualification.js');
const fixtures = require('./fixtures.js');
const qualify = require('./qualify.js');
const permits = require('./permits.js');
const upgrade = require('./upgrade.js');
const environment = require('./environment.js');
const deployment = require('./deployment.js');

module.exports = { registry, contracts, client, preflight, failures, provenance, fingerprint, qualification, fixtures, qualify, permits, upgrade, environment, deployment };
