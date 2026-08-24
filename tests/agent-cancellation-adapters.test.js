'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, tests } = require('./_helpers.js');
const adapters = require('../scripts/agent-cancellation-adapters.js');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-adapter-'));
  const taskPath = path.join(directory, 'task.json');
  fs.writeFileSync(taskPath, '{"task_id":"task-1"}\n');
  const taskBytes = fs.readFileSync(taskPath);
  const context = { invocationId: 'alpha:task-1:1', record: { task_id: 'task-1' }, directory, taskBytes };
  const bindingPath = path.join(directory, 'resource-job.json');
  adapters.writeBinding(taskPath, { provider_id: 'flux', job_id: 'job-1', host: 'vidnux' }, { invocationId: context.invocationId, taskSha256: crypto.createHash('sha256').update(taskBytes).digest('hex'), bindingPath, now: '2026-08-24T10:00:00.000Z' });
  return { directory, taskPath, context };
}

test('cancellation binds one exact invocation to one exact worker job', async () => { const f = fixture(); let cancelled = 0; const provider = adapters.createProvider({ flux: { host: 'vidnux', status: async () => ({ active: true, job_id: 'job-1' }), cancel: async () => { cancelled++; return { ok: true, signal_sent: 'SIGTERM' }; } } }); const out = await provider(f.context); assert.equal(cancelled, 1); assert.equal(out.outcome, 'CANCEL_REQUEST_ACCEPTED'); assert.equal(out.remote_may_continue, false); await assert.rejects(() => provider({ ...f.context, invocationId: 'alpha:task-1:2' }), (e) => e.code === 'CANCELLATION_BINDING_INVALID'); });
test('stale job binding is rejected before provider mutation', async () => { const f = fixture(); let cancelled = 0; const provider = adapters.createProvider({ flux: { host: 'vidnux', status: async () => ({ active: true, job_id: 'job-2' }), cancel: async () => { cancelled++; } } }); await assert.rejects(() => provider(f.context), (e) => e.code === 'CANCELLATION_JOB_BINDING_STALE'); assert.equal(cancelled, 0); });
test('completed job is reported ALREADY_COMPLETE without false cancellation', async () => { const f = fixture(); let cancelled = 0; const provider = adapters.createProvider({ flux: { host: 'vidnux', status: async () => ({ active: false, job_id: 'job-1', exit_state: 'completed' }), cancel: async () => { cancelled++; } } }); const out = await provider(f.context); assert.equal(out.outcome, 'ALREADY_COMPLETE'); assert.equal(cancelled, 0); });
test('missing adapter and provider failure remain honest', async () => { const f = fixture(); const missing = adapters.createProvider({}); assert.equal((await missing(f.context)).outcome, 'NOT_SUPPORTED'); const failed = adapters.createProvider({ flux: { host: 'vidnux', status: async () => ({ active: true, job_id: 'job-1' }), cancel: async () => { throw new Error('signal refused'); }, remoteMayContinue: true } }); const out = await failed(f.context); assert.equal(out.outcome, 'PROVIDER_FAILED'); assert.equal(out.remote_may_continue, true); });
test('remote continuation is explicit for process-only GPU cancellation', async () => { const f = fixture(); const provider = adapters.createProvider({ flux: { host: 'vidnux', status: async () => ({ active: true, job_id: 'job-1' }), cancel: async () => ({ ok: true }), remoteMayContinue: true } }); const out = await provider(f.context); assert.equal(out.outcome, 'REMOTE_MAY_CONTINUE'); assert.equal(out.certainty, 'LOCAL_PROCESS_SIGNAL_ONLY'); assert.ok(adapters.OUTCOMES.includes(out.outcome)); });

if (require.main === module) { (async () => { let passed = 0; for (const item of tests) { try { await item.fn(); passed++; console.log(`ok - ${item.name}`); } catch (error) { console.error(`not ok - ${item.name}`); console.error(error); process.exitCode = 1; break; } } console.log(`${passed}/${tests.length} Cancellation Adapter tests passed`); })(); }
