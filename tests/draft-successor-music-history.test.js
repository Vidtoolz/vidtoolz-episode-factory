'use strict';

/*
 * Draft-successor music decision history authority.
 *
 * Canonical chain semantics (proven by real Production evidence,
 * e.g. V3-MUSIC-DECISION.json: root B with predecessor null, successor C
 * pointing at B, ACTIVE at the head):
 *   - history entry 0 is a root: predecessor_decision_id === null
 *   - every later entry points at the previous LOCAL decision_id
 *   - exactly one ACTIVE decision, and it is the head
 *   - cross-run inheritance is provenance (predecessor_source), never local
 *     history linkage.
 * The renderer's activeMusicDecision() is the chain authority; these tests
 * pin the validator matrix and prove the successor producer emits a chain
 * that authority accepts.
 */

const { assert, fs, path, test } = require('./_helpers.js');
const crypto = require('node:crypto');
const renderer = require('../scripts/production-assembly-renderer.js');
const successor = require('../scripts/draft-bespoke-successor-authority.js');

const MUSIC_BYTES = 'exact draft music bytes';
const MUSIC_SHA = crypto.createHash('sha256').update(MUSIC_BYTES).digest('hex');

function entry(overrides = {}) {
  const value = {
    decision_id: 'root-decision',
    predecessor_decision_id: null,
    policy: 'FULL_PROGRAMME',
    status: 'ACTIVE',
    authority: { type: 'HUMAN', id: 'Mikko' },
    decided_at: '2026-08-30T00:00:00Z',
    basis: 'fixture human music decision',
    music_sha256: MUSIC_SHA,
    music_path: '/fixture/music.wav',
    music_duration_measured_ms: 230000,
    ...overrides,
  };
  delete value.binding_digest_sha256;
  value.binding_digest_sha256 = renderer.musicDecisionDigest(value);
  return value;
}

function chain(history) {
  return { policy: history[history.length - 1].policy, sha256: history[history.length - 1].music_sha256, policy_history: history };
}

function errorCode(fn, code) { assert.throws(fn, (error) => error.code === code, code); }

/* ------------------------------------------------ validator chain matrix --- */

test('MH01 root decision with null predecessor is accepted', () => {
  const active = renderer.activeMusicDecision(chain([entry()]));
  assert.equal(active.decision_id, 'root-decision');
});

test('MH02 one valid successor pointing at the root is accepted', () => {
  const root = entry({ status: 'SUPERSEDED' });
  const next = entry({ decision_id: 'second-decision', predecessor_decision_id: 'root-decision' });
  assert.equal(renderer.activeMusicDecision(chain([root, next])).decision_id, 'second-decision');
});

test('MH03 multi-step chain with ACTIVE head is accepted', () => {
  const a = entry({ status: 'SUPERSEDED' });
  const b = entry({ decision_id: 'second-decision', predecessor_decision_id: 'root-decision', status: 'SUPERSEDED' });
  const c = entry({ decision_id: 'third-decision', predecessor_decision_id: 'second-decision' });
  assert.equal(renderer.activeMusicDecision(chain([a, b, c])).decision_id, 'third-decision');
});

test('MH04 root claiming a predecessor is rejected', () => {
  errorCode(() => renderer.activeMusicDecision(chain([entry({ predecessor_decision_id: 'some-external-decision' })])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH05 non-root entry without a predecessor is rejected', () => {
  const root = entry({ status: 'SUPERSEDED' });
  const orphan = entry({ decision_id: 'second-decision', predecessor_decision_id: null });
  errorCode(() => renderer.activeMusicDecision(chain([root, orphan])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH06 predecessor id mismatch is rejected', () => {
  const root = entry({ status: 'SUPERSEDED' });
  const wrong = entry({ decision_id: 'second-decision', predecessor_decision_id: 'not-the-root' });
  errorCode(() => renderer.activeMusicDecision(chain([root, wrong])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH07 successor referencing a missing predecessor is rejected', () => {
  errorCode(() => renderer.activeMusicDecision(chain([entry({ decision_id: 'second-decision', predecessor_decision_id: 'never-recorded' })])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH08 duplicate decision id is rejected', () => {
  const root = entry({ status: 'SUPERSEDED' });
  const dup = entry({ predecessor_decision_id: 'root-decision' });
  errorCode(() => renderer.activeMusicDecision(chain([root, dup])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH09 lineage loop is rejected', () => {
  const a = entry({ status: 'SUPERSEDED' });
  const b = entry({ decision_id: 'second-decision', predecessor_decision_id: 'root-decision', status: 'SUPERSEDED' });
  const loop = entry({ predecessor_decision_id: 'second-decision' }); // reuses root's id, closing A -> B -> A
  errorCode(() => renderer.activeMusicDecision(chain([a, b, loop])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH10 ACTIVE decision not at the head is rejected', () => {
  const activeFirst = entry();
  const supersededHead = entry({ decision_id: 'second-decision', predecessor_decision_id: 'root-decision', status: 'SUPERSEDED' });
  errorCode(() => renderer.activeMusicDecision(chain([activeFirst, supersededHead])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH11 render policy not bound by the active decision is rejected', () => {
  const music = chain([entry()]); music.policy = 'FADE_EARLY';
  errorCode(() => renderer.activeMusicDecision(music), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH12 render music artifact not bound by the active decision is rejected', () => {
  const music = chain([entry()]); music.sha256 = 'f'.repeat(64);
  errorCode(() => renderer.activeMusicDecision(music), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH13 tampered history entry fails its binding digest', () => {
  const tampered = entry(); tampered.policy = 'FADE_EARLY'; // digest no longer matches
  errorCode(() => renderer.activeMusicDecision(chain([tampered])), 'MUSIC_POLICY_HISTORY_INVALID');
});

test('MH14 non-human active decision is rejected', () => {
  errorCode(() => renderer.activeMusicDecision(chain([entry({ authority: { type: 'AGENT', id: 'not-a-human' } })])), 'MUSIC_HUMAN_AUTHORITY_REQUIRED');
});

/* --------------------------------------------- successor producer matrix --- */

function producerFixture(mutate) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'music-history-'));
  const runDir = path.join(dir, 'draft-successor-run'); fs.mkdirSync(runDir);
  const musicPath = path.join(dir, 'predecessor-music.wav'); fs.writeFileSync(musicPath, MUSIC_BYTES);
  const rootDecision = entry({ decision_id: 'music-decision-B', status: 'SUPERSEDED', music_path: musicPath });
  const activeDecision = entry({ decision_id: 'music-decision-C', predecessor_decision_id: 'music-decision-B', music_path: musicPath });
  const predecessorDoc = {
    schema: 'vidtoolz.visualDraftMusicDecision.v1', run_id: 'production-run',
    policy_history: [rootDecision, activeDecision], active_decision: 'music-decision-C', active_policy: 'FULL_PROGRAMME',
    music_asset: { path: musicPath, sha256: MUSIC_SHA },
  };
  if (mutate) mutate(predecessorDoc);
  const decisionPath = path.join(dir, 'predecessor-music-decision.json');
  fs.writeFileSync(decisionPath, `${JSON.stringify(predecessorDoc, null, 2)}\n`);
  const contract = {
    predecessor: { run_id: 'production-run' },
    created_at: '2026-08-31T00:00:00Z',
    draft_inputs: { music: { path: musicPath, sha256: MUSIC_SHA, duration_ms: 230000, policy: 'FULL_PROGRAMME', decision_path: decisionPath, decision_sha256: successor.sha256File(decisionPath) } },
  };
  return { runDir, contract, decisionPath, musicPath };
}

test('MH15 valid Draft-successor inheritance produces an accepted root chain', () => {
  const f = producerFixture();
  const doc = successor.buildMusicDecision(f.contract, f.runDir);
  assert.equal(doc.policy_history.length, 1);
  assert.equal(doc.policy_history[0].predecessor_decision_id, null);
  assert.equal(doc.policy_history[0].status, 'ACTIVE');
  const active = renderer.activeMusicDecision({ policy: doc.active_policy, sha256: doc.music_asset.sha256, policy_history: doc.policy_history });
  assert.equal(active.decision_id, doc.active_decision);
  assert.deepEqual(doc.predecessor_source, { run_id: 'production-run', decision_id: 'music-decision-C', path: f.decisionPath, sha256: f.contract.draft_inputs.music.decision_sha256 });
  assert.equal(active.authority.type, 'HUMAN');
});

test('MH16 building the successor decision never touches predecessor bytes', () => {
  const f = producerFixture();
  const before = { decision: successor.sha256File(f.decisionPath), music: successor.sha256File(f.musicPath) };
  successor.buildMusicDecision(f.contract, f.runDir);
  assert.deepEqual({ decision: successor.sha256File(f.decisionPath), music: successor.sha256File(f.musicPath) }, before);
});

test('MH17 successor decision construction is deterministic', () => {
  const f = producerFixture();
  assert.deepEqual(successor.buildMusicDecision(f.contract, f.runDir), successor.buildMusicDecision(f.contract, f.runDir));
});

test('MH18 caller-authored policy divergence is rejected', () => {
  const f = producerFixture();
  f.contract.draft_inputs.music.policy = 'FADE_EARLY';
  errorCode(() => successor.buildMusicDecision(f.contract, f.runDir), 'DRAFT_SUCCESSOR_MUSIC_AUTHORITY_INVALID');
});

test('MH19 mutated predecessor decision authority is rejected', () => {
  const bySha = producerFixture((doc) => { doc.policy_history[1].music_sha256 = 'f'.repeat(64); });
  errorCode(() => successor.buildMusicDecision(bySha.contract, bySha.runDir), 'DRAFT_SUCCESSOR_MUSIC_AUTHORITY_INVALID');
  const byStatus = producerFixture((doc) => { doc.policy_history[1].status = 'SUPERSEDED'; });
  errorCode(() => successor.buildMusicDecision(byStatus.contract, byStatus.runDir), 'DRAFT_SUCCESSOR_MUSIC_AUTHORITY_INVALID');
});

test('MH20 same inherited authority yields the same semantic chain and binding digest', () => {
  const a = producerFixture(); const b = producerFixture();
  const docA = successor.buildMusicDecision(a.contract, a.runDir);
  const docB = successor.buildMusicDecision(b.contract, b.runDir);
  const semantic = (doc) => ({ id: doc.active_decision, predecessor: doc.policy_history[0].predecessor_decision_id, policy: doc.active_policy, authority: doc.policy_history[0].authority, inherited: doc.predecessor_source.decision_id });
  assert.deepEqual({ ...semantic(docA), digest: null }, { ...semantic(docB), digest: null });
  assert.equal(docA.policy_history[0].binding_digest_sha256, renderer.musicDecisionDigest({ ...docA.policy_history[0], binding_digest_sha256: undefined }));
});

/* -------------------------------------------- regression of the defect ---- */

test('MH21 the exact failed-canary shape (cross-run id in local root) stays rejected', () => {
  const defective = entry({ decision_id: 'music-decision-C-draft-successor-run', predecessor_decision_id: 'music-decision-C-2026-08-26' });
  errorCode(() => renderer.activeMusicDecision(chain([defective])), 'MUSIC_POLICY_HISTORY_INVALID');
});
