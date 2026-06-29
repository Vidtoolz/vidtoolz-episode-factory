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

test('GET /api/package-runs/artifact-text returns content for an existing text file', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'GET', artifactTextRoute(runId, 'rough-cut-review.md'));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.runId, runId);
  assert.equal(res.body.data.filename, 'rough-cut-review.md');
  assert.equal(res.body.data.exists, true);
  assert.equal(res.body.data.content, '# Review\n\nLooks good.\n');
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

test('POST /api/package-runs/open-file requires a local write nonce', async () => {
  const { root, runId } = makeArtifactRun();
  const server = packageEngineServer.createServer({ root });
  const res = await request(server, 'POST', packageEngineServer.OPEN_FILE_API, {
    runId,
    file: 'rough-cut-review.md',
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /valid local write nonce/);
});

test('shared clipboard.js exists and exposes copyToClipboard', () => {
  const clipboardPath = path.join(__dirname, '..', 'clipboard.js');
  assert.equal(fs.existsSync(clipboardPath), true);
  const source = fs.readFileSync(clipboardPath, 'utf8');
  assert.match(source, /window\.copyToClipboard\s*=/);
});
