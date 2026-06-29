const {
  assert,
  fs,
  http,
  os,
  packageEngineServer,
  path,
  test,
} = require('./_helpers.js');

function makeArtifactRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-access-'));
  const runId = '2026-06-29-artifact-test';
  const runDir = path.join(root, 'package-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'rough-cut-review.md'), '# Review\n\nLooks good.\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'notes.txt'), 'plain text notes\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({ ok: true }), 'utf8');
  fs.writeFileSync(path.join(runDir, 'metrics.csv'), 'name,value\nwatch,1\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'package-run-state.md'), '# Package Run State\n\nPackage run state: active\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'render.mp4'), 'not really video', 'utf8');
  return { root, runId, runDir };
}

function request(server, method, route, payload) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const body = payload == null ? '' : JSON.stringify(payload);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: route,
          method,
          headers: {
            host: '127.0.0.1:8010',
            ...(body
              ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
              : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            server.close((closeError) => {
              if (closeError) return reject(closeError);
              resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
            });
          });
        }
      );
      req.on('error', (error) => {
        server.close(() => reject(error));
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

function artifactTextRoute(runId, file) {
  return `${packageEngineServer.ARTIFACT_TEXT_API}?runId=${encodeURIComponent(runId)}&file=${encodeURIComponent(file)}`;
}

function artifactsListRoute(runId) {
  return `${packageEngineServer.ARTIFACTS_LIST_API}?runId=${encodeURIComponent(runId)}`;
}

test('GET /api/package-runs/artifact-text returns content and metadata for an existing text file', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, 'rough-cut-review.md'));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.runId, runId);
  assert.equal(res.body.data.file, 'rough-cut-review.md');
  assert.equal(res.body.data.content, '# Review\n\nLooks good.\n');
  assert.equal(res.body.data.sizeBytes, Buffer.byteLength('# Review\n\nLooks good.\n'));
  assert.match(res.body.data.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.data, 'filename'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.data, 'exists'), false);
});

test('GET /api/package-runs/artifact-text returns 404 for a missing file', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, 'missing.md'));
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'File not found');
  assert.equal(res.body.exists, false);
});

test('GET /api/package-runs/artifact-text rejects path escape attempts', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, '../../etc/passwd'));
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('GET /api/package-runs/artifact-text rejects non-text file extensions', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, 'render.mp4'));
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('GET /api/package-runs/artifact-text rejects package-run-state.md as operational state', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, 'package-run-state.md'));
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'package-run-state.md is not a text artifact.');
});

test('GET /api/package-runs/artifact-text rejects files larger than the text cap', async () => {
  const { root, runId, runDir } = makeArtifactRun();
  fs.writeFileSync(
    path.join(runDir, 'too-large.txt'),
    Buffer.alloc(packageEngineServer.PACKAGE_RUN_ARTIFACT_TEXT_MAX_BYTES + 1, 'a')
  );
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, 'too-large.txt'));
  assert.equal(res.status, 413);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'File exceeds maximum size.');
});

test('GET /api/package-runs/artifacts lists safe root-level text artifacts only', async () => {
  const { root, runId, runDir } = makeArtifactRun();
  fs.writeFileSync(path.join(runDir, 'selected-package.md'), '# Selected\n', 'utf8');
  fs.writeFileSync(path.join(runDir, '.hidden.md'), '# Hidden\n', 'utf8');
  fs.mkdirSync(path.join(runDir, 'nested'));
  fs.writeFileSync(path.join(runDir, 'nested', 'nested.md'), '# Nested\n', 'utf8');
  fs.writeFileSync(
    path.join(runDir, 'too-large.md'),
    Buffer.alloc(packageEngineServer.PACKAGE_RUN_ARTIFACT_TEXT_MAX_BYTES + 1, 'b')
  );

  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactsListRoute(runId));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.runId, runId);

  const files = res.body.data.artifacts.map((artifact) => artifact.file);
  assert.deepEqual(files.sort(), ['metadata.json', 'metrics.csv', 'notes.txt', 'rough-cut-review.md', 'selected-package.md'].sort());
  assert.equal(files.includes('package-run-state.md'), false);
  assert.equal(files.includes('.hidden.md'), false);
  assert.equal(files.includes('nested.md'), false);
  assert.equal(files.includes('render.mp4'), false);
  assert.equal(files.includes('too-large.md'), false);

  const roughCut = res.body.data.artifacts.find((artifact) => artifact.file === 'rough-cut-review.md');
  assert.equal(roughCut.label, 'Rough-Cut Review');
  assert.equal(typeof roughCut.sizeBytes, 'number');
  assert.match(roughCut.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);

  const metadata = res.body.data.artifacts.find((artifact) => artifact.file === 'metadata.json');
  assert.equal(metadata.label, 'Metadata');
});

test('POST /api/package-runs/open-file requires a local write nonce with open-file wording', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'POST', packageEngineServer.OPEN_FILE_API, {
    runId,
    file: 'rough-cut-review.md',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /valid local write nonce/);
  assert.equal(res.body.error.includes('Capture evidence write API'), false);
});

test('POST /api/package-runs/open-file rejects package-run-state.md before opening', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'POST', packageEngineServer.OPEN_FILE_API, {
    runId,
    file: 'package-run-state.md',
    localWriteNonce: packageEngineServer.localWriteNonce(),
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'package-run-state.md is not a text artifact.');
});

test('shared clipboard.js exists and exposes copyToClipboard', () => {
  const clipboardPath = path.join(__dirname, '..', 'clipboard.js');
  assert.equal(fs.existsSync(clipboardPath), true);
  const source = fs.readFileSync(clipboardPath, 'utf8');
  assert.match(source, /window\.copyToClipboard\s*=/);
});
