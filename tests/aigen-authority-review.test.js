const {
  assert,
  fs,
  http,
  os,
  path,
  test,
} = require('./_helpers.js');

const review = require('../aigen-authority-review.js');
const serverModule = require('../package-engine-server.js');

const LEGACY_SLOTS = [2, 9, 10, 17, 19, 21, 22, 23, 24, 25];

function write(root, rel, value) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.isBuffer(value) ? value : String(value));
}

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigen-authority-review-'));
  const aigenRoot = path.join(root, 'aigen');
  const scriptPackages = path.join(aigenRoot, 'script-packages');
  const packageId = options.packageId || 'retrospective-review-fixture';
  const packageDir = path.join(scriptPackages, packageId);
  const reviewDir = path.join(aigenRoot, 'authority-review', packageId);
  const slots = options.slots || Array.from({ length: 10 }, (_, i) => i + 1);
  const script = [
    '# Final Script',
    '',
    ...slots.map((slot) => `Slot ${slot} passage 😀 explains visual authority ${slot} without ambiguity.`),
    '',
  ].join('\n');
  write(packageDir, 'selected-package.json', JSON.stringify({ package: { title: 'Review Fixture' } }));
  write(packageDir, 'script/script-final.md', script);
  const imagePrompts = [];
  const selections = [];
  const videoPrompts = [];
  const clips = [];
  slots.forEach((slot, position) => {
    const prompt = `Vertical visual prompt for slot ${slot}.`;
    imagePrompts.push({ index: slot, prompt, aspect_ratio: '9:16' });
    let selectedPath = `images/flux-local/flux-${String(slot).padStart(3, '0')}.png`;
    if (slot === 21) {
      write(packageDir, 'images/flux-local/flux-021.png', 'slot 21 original bytes');
      selectedPath = 'images/flux-local/flux-021-v2.png';
      write(packageDir, 'images/flux-local/flux-021-v2.provenance.json', JSON.stringify({
        status: 'replacement',
        original_path: 'images/flux-local/flux-021.png',
        replacement_path: selectedPath,
      }));
    }
    write(packageDir, selectedPath, `selected image bytes for slot ${slot}`);
    selections.push({
      prompt_index: slot,
      selected_path: selectedPath,
      prompt: slot === 21 ? 'Slot 21 v2-specific retained image prompt.' : prompt,
    });
    videoPrompts.push({
      prompt_index: slot,
      prompt: `Controlled motion for the exact image in slot ${slot}.`,
      source_image: slot === 21 ? 'images/flux-local/flux-021.png' : selectedPath,
    });
    const clipPath = `videos/mp4-hq-720p/clip-${String(slot).padStart(3, '0')}.mp4`;
    write(packageDir, clipPath, `clip bytes for slot ${slot}`);
    clips.push({ prompt_index: slot, order: position + 1, staged_video_relative_path: clipPath });
  });
  write(packageDir, 'image-prompts.json', JSON.stringify({ image_prompts: imagePrompts }));
  write(packageDir, 'selected-images.json', JSON.stringify({ selections }));
  write(packageDir, 'video-prompts.json', JSON.stringify({ prompts: videoPrompts }));
  write(packageDir, 'resolve-handoff/media-manifest.json', JSON.stringify({ clips }));
  const proposedAssignments = slots.map((slot) => {
    const exact = `Slot ${slot} passage 😀 explains visual authority ${slot} without ambiguity.`;
    const start = script.indexOf(exact);
    return {
      slot_id: slot,
      start_char: start,
      end_char: start + exact.length,
      exact_text: exact,
      communicative_purpose: `Communicate the authority claim for slot ${slot}.`,
      forensic_confidence: slot === 22 ? 'confirmed_mismatch_downstream' : 'semantic_match_provenance_missing',
      forensic_warning: slot === 22 ? 'Selected image and descendants require reconstruction.' : '',
    };
  });
  const payload = {
    package_id: packageId,
    retained_slots: slots,
    expected_script_sha256: review.sha256(Buffer.from(script, 'utf8')),
    forensic_evidence: {
      report_path: '/audit/aigen-legacy-authority-review.md',
      report_sha256: 'a'.repeat(64),
    },
    proposed_assignments: proposedAssignments,
  };
  const initialized = review.initializeWorkspace(packageDir, reviewDir, payload, {
    nowIso: '2026-07-31T09:00:00.000Z',
  });
  return {
    root, aigenRoot, scriptPackages, packageId, packageDir, reviewDir,
    slots, script, payload, proposedAssignments, initialized,
  };
}

function cleanup(fx) {
  fs.rmSync(fx.root, { recursive: true, force: true });
}

let decisionSequence = 0;
function append(fx, decisionType, slotId, decision = 'approved', extra = {}) {
  decisionSequence += 1;
  return review.appendDecision(fx.packageDir, fx.reviewDir, {
    package_id: fx.packageId,
    decision_type: decisionType,
    slot_id: slotId,
    decision,
    operator_identity: 'fixture-operator',
    ...extra,
  }, {
    nowIso: `2026-07-31T09:${String(decisionSequence % 60).padStart(2, '0')}:00.000Z`,
    decisionId: `decision-test-${String(decisionSequence).padStart(6, '0')}`,
  });
}

function approveScript(fx) {
  return append(fx, 'script', null);
}

function assignmentPayload(fx, slot) {
  const item = fx.proposedAssignments.find((row) => row.slot_id === slot);
  return {
    start_char: item.start_char,
    end_char: item.end_char,
    exact_text: item.exact_text,
    communicative_purpose: item.communicative_purpose,
    forensic_confidence: item.forensic_confidence,
    forensic_warning: item.forensic_warning,
  };
}

function approveAssignment(fx, slot, override) {
  return append(fx, 'assignment', slot, 'approved', { assignment: override || assignmentPayload(fx, slot) });
}

function approveSlot(fx, slot) {
  approveAssignment(fx, slot);
  append(fx, 'image_prompt', slot);
  append(fx, 'selected_image', slot);
  append(fx, 'i2v_prompt', slot);
  append(fx, 'clip', slot);
}

function approveCompleteGenericChain(fx) {
  approveScript(fx);
  fx.slots.forEach((slot) => approveSlot(fx, slot));
  append(fx, 'handoff', null);
}

function state(fx) {
  return review.buildReviewView(fx.packageDir, fx.reviewDir);
}

function packageFingerprint(packageDir) {
  const rows = [];
  function walk(dir, prefix = '') {
    fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
      const rel = path.posix.join(prefix, entry.name);
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, rel);
      else rows.push(`${rel}\0${review.sha256(fs.readFileSync(absolute))}`);
    });
  }
  walk(packageDir);
  return review.sha256(Buffer.from(rows.join('\n'), 'utf8'));
}

function rewriteLedger(fx, mutate) {
  const ledgerPath = path.join(fx.reviewDir, review.DECISIONS_FILE);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  mutate(ledger);
  let previous = null;
  ledger.records.forEach((record) => {
    record.previous_record_hash = previous;
    const copy = { ...record };
    delete copy.record_hash;
    record.record_hash = review.stableHash(copy);
    previous = record.record_hash;
  });
  ledger.head_hash = previous;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  return ledgerPath;
}

test('retrospective review: initialization creates a separate empty append-only workspace and no authority chain', () => {
  const fx = fixture({ slots: LEGACY_SLOTS });
  try {
    assert.equal(fx.initialized.created, true);
    assert.equal(fx.initialized.readiness.required_decisions, 52);
    assert.equal(fx.initialized.readiness.completed_decisions, 0);
    assert.equal(fs.existsSync(path.join(fx.packageDir, 'authority-chain.json')), false);
    assert.equal(fx.reviewDir.startsWith(fx.packageDir), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fx.reviewDir, review.DECISIONS_FILE))).records, []);
  } finally { cleanup(fx); }
});

test('retrospective review: script approval is explicit, hash-bound, and source-labeled', () => {
  const fx = fixture();
  try {
    const result = approveScript(fx);
    assert.equal(result.record.decision, 'approved');
    assert.equal(result.record.artifact.artifact_sha256, fx.payload.expected_script_sha256);
    assert.equal(result.record.source, 'retrospective_operator_review');
    assert.equal(result.view.decisions.script.authority_valid, true);
  } finally { cleanup(fx); }
});

for (const outcome of ['rejected', 'requires_rework']) {
  test(`retrospective review: script ${outcome} keeps downstream authority blocked`, () => {
    const fx = fixture();
    try {
      append(fx, 'script', null, outcome);
      assert.equal(state(fx).decisions.script.status, outcome);
      assert.throws(
        () => approveAssignment(fx, fx.slots[0]),
        (error) => error.code === 'AUTHORITY_REVIEW_UPSTREAM_INVALID',
      );
    } finally { cleanup(fx); }
  });
}

test('retrospective review: passage identity uses exact Unicode-safe offsets and text hash', () => {
  const fx = fixture();
  try {
    approveScript(fx);
    const result = approveAssignment(fx, fx.slots[0]);
    const details = result.record.artifact_details;
    assert.equal(details.offset_encoding, 'utf16_code_units');
    assert.equal(fx.script.slice(details.start_char, details.end_char), details.exact_text);
    assert.equal(details.selected_text_sha256, review.sha256(Buffer.from(details.exact_text, 'utf8')));
  } finally { cleanup(fx); }
});

test('retrospective review: passage offsets that split a Unicode surrogate pair fail closed', () => {
  const fx = fixture();
  try {
    approveScript(fx);
    const base = assignmentPayload(fx, fx.slots[0]);
    const emoji = fx.script.indexOf('😀', base.start_char);
    assert.throws(
      () => approveAssignment(fx, fx.slots[0], { ...base, start_char: emoji + 1, exact_text: undefined }),
      (error) => error.code === 'AUTHORITY_REVIEW_ASSIGNMENT_INVALID',
    );
  } finally { cleanup(fx); }
});

test('retrospective review: every stage decision binds both artifact and exact upstream hashes', () => {
  const fx = fixture();
  try {
    approveScript(fx);
    approveSlot(fx, fx.slots[0]);
    const records = review.readLedger(fx.reviewDir, fx.packageId).records;
    for (const type of ['assignment', 'image_prompt', 'selected_image', 'i2v_prompt', 'clip']) {
      const record = records.find((item) => item.decision_type === type);
      assert.match(record.artifact.artifact_sha256, /^[a-f0-9]{64}$/);
      assert.match(record.upstream.upstream_sha256, /^[a-f0-9]{64}$/);
    }
  } finally { cleanup(fx); }
});

test('retrospective review: decisions append and an outcome change requires explicit supersession', () => {
  const fx = fixture();
  try {
    const first = approveScript(fx);
    assert.throws(
      () => append(fx, 'script', null, 'rejected'),
      (error) => error.code === 'AUTHORITY_REVIEW_DECISION_CONFLICT',
    );
    const second = append(fx, 'script', null, 'rejected', { previous_decision_id: first.record.decision_id });
    assert.equal(second.record.previous_decision_id, first.record.decision_id);
    assert.equal(review.readLedger(fx.reviewDir, fx.packageId).records.length, 2);
    assert.equal(second.view.decisions.script.status, 'rejected');
    assert.equal(second.view.ledger.history[0].invalidated, true);
    assert.match(second.view.ledger.history[0].invalidation_reason, /Superseded by/);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: final-script byte change invalidates every reconstructed downstream decision', () => {
  const fx = fixture();
  try {
    approveScript(fx);
    approveSlot(fx, fx.slots[0]);
    write(fx.packageDir, 'script/script-final.md', fx.script.replace('Slot 1 passage', 'Slot 1 PASSAGE'));
    const next = state(fx);
    assert.equal(next.decisions.script.invalidated, true);
    for (const type of review.SLOT_STAGE_TYPES) assert.equal(next.decisions.slots['1'][type].invalidated, true);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: changed assignment remains current and invalidates prompt through handoff', () => {
  const fx = fixture();
  try {
    approveCompleteGenericChain(fx);
    const current = state(fx).decisions.slots['1'].assignment;
    const other = assignmentPayload(fx, 2);
    const changed = append(fx, 'assignment', 1, 'approved', {
      previous_decision_id: current.decision_id,
      assignment: { ...other, communicative_purpose: 'Deliberately reassign slot 1 to the exact slot 2 passage.' },
    }).view;
    assert.equal(changed.decisions.slots['1'].assignment.authority_valid, true);
    for (const type of ['image_prompt', 'selected_image', 'i2v_prompt', 'clip']) {
      assert.equal(changed.decisions.slots['1'][type].invalidated, true);
    }
    assert.equal(changed.decisions.handoff.invalidated, true);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: image-prompt text change invalidates image, I2V, clip, and handoff', () => {
  const fx = fixture();
  try {
    approveCompleteGenericChain(fx);
    const file = JSON.parse(fs.readFileSync(path.join(fx.packageDir, 'image-prompts.json')));
    file.image_prompts[0].prompt = 'Changed prompt text.';
    write(fx.packageDir, 'image-prompts.json', JSON.stringify(file));
    const next = state(fx);
    for (const type of ['image_prompt', 'selected_image', 'i2v_prompt', 'clip']) assert.equal(next.decisions.slots['1'][type].invalidated, true);
    assert.equal(next.decisions.handoff.invalidated, true);
    const promptHistory = next.ledger.history.find(
      (record) => record.decision_type === 'image_prompt' && record.slot_id === 1,
    );
    assert.equal(promptHistory.invalidated, true);
    assert.match(promptHistory.invalidation_reason, /Artifact bytes|canonical content/);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: selected-image byte change invalidates image, I2V, clip, and handoff', () => {
  const fx = fixture();
  try {
    approveCompleteGenericChain(fx);
    write(fx.packageDir, 'images/flux-local/flux-001.png', 'changed exact image bytes');
    const next = state(fx);
    for (const type of ['selected_image', 'i2v_prompt', 'clip']) assert.equal(next.decisions.slots['1'][type].invalidated, true);
    assert.equal(next.decisions.handoff.invalidated, true);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: I2V-prompt text change invalidates prompt, clip, and handoff', () => {
  const fx = fixture();
  try {
    approveCompleteGenericChain(fx);
    const file = JSON.parse(fs.readFileSync(path.join(fx.packageDir, 'video-prompts.json')));
    file.prompts[0].prompt = 'Changed I2V prompt.';
    write(fx.packageDir, 'video-prompts.json', JSON.stringify(file));
    const next = state(fx);
    assert.equal(next.decisions.slots['1'].i2v_prompt.invalidated, true);
    assert.equal(next.decisions.slots['1'].clip.invalidated, true);
    assert.equal(next.decisions.handoff.invalidated, true);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: clip-byte change invalidates clip and handoff', () => {
  const fx = fixture();
  try {
    approveCompleteGenericChain(fx);
    write(fx.packageDir, 'videos/mp4-hq-720p/clip-001.mp4', 'changed exact clip bytes');
    const next = state(fx);
    assert.equal(next.decisions.slots['1'].clip.invalidated, true);
    assert.equal(next.decisions.handoff.invalidated, true);
  } finally { cleanup(fx); }
});

test('retrospective review invalidation: handoff order change invalidates handoff approval', () => {
  const fx = fixture();
  try {
    approveCompleteGenericChain(fx);
    const file = JSON.parse(fs.readFileSync(path.join(fx.packageDir, 'resolve-handoff/media-manifest.json')));
    [file.clips[0].order, file.clips[1].order] = [file.clips[1].order, file.clips[0].order];
    write(fx.packageDir, 'resolve-handoff/media-manifest.json', JSON.stringify(file));
    assert.equal(state(fx).decisions.handoff.invalidated, true);
  } finally { cleanup(fx); }
});

test('retrospective review: slot 21 decisions bind v2 bytes and never accept the stale original source path as authority', () => {
  const fx = fixture({ slots: LEGACY_SLOTS });
  try {
    approveScript(fx);
    approveAssignment(fx, 21);
    append(fx, 'image_prompt', 21);
    const image = append(fx, 'selected_image', 21);
    const row = image.view.slots.find((item) => item.slot_id === 21);
    assert.equal(image.record.artifact.artifact_sha256, row.slot_21.selected_v2_image.artifact_sha256);
    assert.notEqual(image.record.artifact.artifact_sha256, row.slot_21.original_image.artifact_sha256);
    const i2v = append(fx, 'i2v_prompt', 21);
    assert.equal(i2v.record.upstream.upstream_sha256, row.slot_21.selected_v2_image.artifact_sha256);
    assert.equal(row.i2v_prompt.legacy_source_image, 'images/flux-local/flux-021.png');
  } finally { cleanup(fx); }
});

test('retrospective review: slot 22 selected image, I2V prompt, and clip are forced to rework', () => {
  const fx = fixture({ slots: LEGACY_SLOTS });
  try {
    approveScript(fx);
    approveAssignment(fx, 22);
    append(fx, 'image_prompt', 22);
    for (const type of ['selected_image', 'i2v_prompt', 'clip']) {
      assert.throws(
        () => append(fx, type, 22),
        (error) => error.code === 'AUTHORITY_REVIEW_SLOT_22_REWORK_REQUIRED',
      );
      const result = append(fx, type, 22, 'requires_rework');
      assert.equal(result.record.decision, 'requires_rework');
    }
  } finally { cleanup(fx); }
});

test('retrospective review: nine valid legacy slots cannot make the package ready while slot 22 requires reconstruction', () => {
  const fx = fixture({ slots: LEGACY_SLOTS });
  try {
    approveScript(fx);
    fx.slots.forEach((slot) => {
      approveAssignment(fx, slot);
      append(fx, 'image_prompt', slot);
      if (slot !== 22) {
        append(fx, 'selected_image', slot);
        append(fx, 'i2v_prompt', slot);
        append(fx, 'clip', slot);
      }
    });
    append(fx, 'selected_image', 22, 'requires_rework');
    append(fx, 'i2v_prompt', 22, 'requires_rework');
    append(fx, 'clip', 22, 'requires_rework');
    const next = state(fx);
    assert.equal(next.readiness.package_ready_for_binding, false);
    assert.equal(next.readiness.binding_permitted, false);
    assert.equal(next.readiness.rework_required_decisions, 3);
    assert.equal(fs.existsSync(path.join(fx.packageDir, 'authority-chain.json')), false);
  } finally { cleanup(fx); }
});

test('retrospective review: malformed decision-ledger shapes fail closed and are not overwritten', () => {
  for (const malformed of ['{', 'null', '[]', '7', '{}', JSON.stringify({ records: null })]) {
    const fx = fixture();
    try {
      const ledgerPath = path.join(fx.reviewDir, review.DECISIONS_FILE);
      fs.writeFileSync(ledgerPath, malformed);
      const before = fs.readFileSync(ledgerPath, 'utf8');
      assert.throws(() => review.readLedger(fx.reviewDir, fx.packageId));
      assert.throws(() => append(fx, 'script', null));
      assert.equal(fs.readFileSync(ledgerPath, 'utf8'), before);
    } finally { cleanup(fx); }
  }
});

test('retrospective review: duplicate decision IDs fail closed', () => {
  const fx = fixture();
  try {
    const first = approveScript(fx);
    append(fx, 'script', null, 'rejected', { previous_decision_id: first.record.decision_id });
    rewriteLedger(fx, (ledger) => { ledger.records[1].decision_id = ledger.records[0].decision_id; });
    assert.throws(
      () => review.readLedger(fx.reviewDir, fx.packageId),
      (error) => error.code === 'AUTHORITY_REVIEW_LEDGER_CORRUPT',
    );
  } finally { cleanup(fx); }
});

test('retrospective review: duplicate active approvals fail closed', () => {
  const fx = fixture();
  try {
    const first = approveScript(fx);
    append(fx, 'script', null, 'rejected', { previous_decision_id: first.record.decision_id });
    rewriteLedger(fx, (ledger) => { ledger.records[1].previous_decision_id = null; });
    assert.throws(
      () => review.readLedger(fx.reviewDir, fx.packageId),
      (error) => error.code === 'AUTHORITY_REVIEW_DUPLICATE_ACTIVE',
    );
  } finally { cleanup(fx); }
});

test('retrospective review: invalid hashes, unknown decision types, and mismatched package IDs fail closed', () => {
  for (const mutation of [
    (ledger) => { ledger.records[0].artifact.artifact_sha256 = 'bad'; },
    (ledger) => { ledger.records[0].decision_type = 'invented_type'; },
    (ledger) => { ledger.package_id = 'another-package'; },
  ]) {
    const fx = fixture();
    try {
      approveScript(fx);
      rewriteLedger(fx, mutation);
      assert.throws(() => review.readLedger(fx.reviewDir, fx.packageId));
    } finally { cleanup(fx); }
  }
});

function request(server, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: pathname,
      headers: {
        Host: 'localhost:8010',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('retrospective review routes: GET and decision POST are review-only with no PRESTO, queue, package, or authority mutation', async () => {
  const fx = fixture({ slots: LEGACY_SLOTS });
  let externalCalls = 0;
  const server = serverModule.createServer({
    aigenRoot: fx.aigenRoot,
    scriptPackages: fx.scriptPackages,
    fetchImpl: async () => { externalCalls += 1; throw new Error('unexpected external call'); },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const before = packageFingerprint(fx.packageDir);
    const get = await request(server, 'GET', `${serverModule.AIGEN_AUTHORITY_REVIEW_API}?package=${fx.packageId}`);
    assert.equal(get.status, 200);
    assert.equal(get.body.data.readiness.completed_decisions, 0);
    const nonce = get.body.data.localWriteNonce;
    const post = await request(
      server,
      'POST',
      serverModule.AIGEN_AUTHORITY_REVIEW_DECISION_API,
      {
        package_id: fx.packageId,
        decision_type: 'script',
        slot_id: null,
        decision: 'approved',
        operator_identity: 'route-test-operator',
      },
      { 'x-vidtoolz-local-write-nonce': nonce },
    );
    assert.equal(post.status, 200);
    assert.equal(post.body.data.record.source, 'retrospective_operator_review');
    assert.equal(packageFingerprint(fx.packageDir), before);
    assert.equal(fs.existsSync(path.join(fx.packageDir, 'authority-chain.json')), false);
    assert.equal(externalCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(fx);
  }
});

test('retrospective review UI: exposes exact artifacts, separate decisions, warnings, and no automatic approval or generation action', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'aigen-authority-review.html'), 'utf8');
  assert.match(html, /Retrospective Authority Reconstruction/);
  assert.match(html, /Operator identity/);
  assert.match(html, /Current final script/);
  assert.match(html, /data-outcome="approved"/);
  assert.match(html, /image_prompt.*selected_image.*i2v_prompt.*clip/s);
  assert.match(html, /Slot 21 source normalization/);
  assert.match(html, /Confirmed mismatch/);
  assert.match(html, /approvalsAllowed/);
  assert.doesNotMatch(html, /PRESTO|resolve-assembly\/create|generate-images|generate-videos|authority-chain\.json/);
  assert.doesNotMatch(html, /checked|selected\s*=\s*["']approved/i);
});
