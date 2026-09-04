'use strict';
// FILE_OR_CODE adapter — exact file range from an approved repository, bound to
// the repository's current Git identity and the file's content hash. The raw
// artifact is the exact selected text (format TEXT); its hash equals the
// captured_text_sha256 the oracle recomputes from the file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { sha256Bytes, gitIdentity, withinRoot, unsafePathText } = require('../contract.js');

const ADAPTER = Object.freeze({ id: 'vidtoolz-file-code-adapter', version: '1.0.0' });
function fail(code, message) { return Object.assign(new Error(message), { code, stage: 'capture' }); }

function capture(spec, ctx) {
  const s = spec.source;
  const approved = ctx.repositories[s.repository_id];
  if (!approved || path.resolve(approved.root) !== path.resolve(s.repository_root)) throw fail('SPEC_REJECTED', 'repository is not an approved identity/root');
  const root = fs.realpathSync(s.repository_root);
  if (root !== path.resolve(s.repository_root)) throw fail('SOURCE_PREFLIGHT_FAILED', 'repository root resolves through a symlink');
  if (unsafePathText(s.path)) throw fail('SPEC_REJECTED', 'unsafe source path');
  const absolute = path.resolve(root, s.path);
  if (!withinRoot(root, absolute)) throw fail('SPEC_REJECTED', 'file escapes repository');
  const st = fs.lstatSync(absolute);
  if (st.isSymbolicLink()) throw fail('SOURCE_PREFLIGHT_FAILED', 'source is a symlink');
  if (!st.isFile()) throw fail('SOURCE_PREFLIGHT_FAILED', st.isFIFO() ? 'source is a FIFO (not read)' : 'source is not a regular file');
  if (fs.realpathSync(absolute) !== absolute) throw fail('SOURCE_PREFLIGHT_FAILED', 'source path resolves through a symlinked component');
  const git = gitIdentity(root);
  if (!git || git.head !== s.git_head || git.branch !== s.git_branch || git.worktree_state_sha256 !== s.git_worktree_state_sha256) throw fail('SOURCE_PREFLIGHT_FAILED', 'repository HEAD/branch/worktree state is not the requested state');
  const bytes = fs.readFileSync(absolute);
  if (sha256Bytes(bytes) !== s.source_sha256) throw fail('SOURCE_PREFLIGHT_FAILED', 'file content differs from the requested source hash');
  const lines = bytes.toString('utf8').split(/\r?\n/);
  if (s.line_end > lines.length) throw fail('EVIDENCE_INSUFFICIENT', `file has ${lines.length} lines; requested range ends at ${s.line_end}`);
  for (const n of s.required_context_lines) if (n < s.line_start || n > s.line_end) throw fail('EVIDENCE_INSUFFICIENT', `required context line ${n} lies outside the captured range`);
  const selected = lines.slice(s.line_start - 1, s.line_end).join('\n');
  const capturedSha = sha256Bytes(selected);
  // post-read mutation check: the file must still be the requested bytes
  if (sha256Bytes(fs.readFileSync(absolute)) !== s.source_sha256) throw fail('INTEGRITY_FAILED', 'file changed during capture');
  const observedAt = new Date().toISOString();
  const visibleLines = []; for (let n = s.line_start; n <= s.line_end; n += 1) visibleLines.push(n);
  return {
    adapter: ADAPTER,
    snapshot: { type: 'FILE_OR_CODE', machine_id: spec.machine.id, session_id: spec.machine.session_id, observed_at: observedAt, cache_state: 'FRESH', capture_id: spec.capture_id, repository_id: s.repository_id, repository_root: s.repository_root, git_head: git.head, git_branch: git.branch, git_worktree_state_sha256: git.worktree_state_sha256, git_tree: git.tree, git_common_dir: git.common_dir, git_remote_url: git.remote_url, git_dirty: git.dirty, path: s.path, source_sha256: s.source_sha256, line_start: s.line_start, line_end: s.line_end, visible_line_numbers: visibleLines, captured_text_sha256: capturedSha, hostname: os.hostname() },
    raw: { format: 'TEXT', bytes: Buffer.from(selected, 'utf8'), visible_text: selected, visible_tokens: [...new Set(selected.split(/\s+/).filter((t) => t.length >= 4 && t.length <= 120))] },
    surfaces: [{ id: 'file-range', text: selected }],
    evidence: { visible_text: selected, git_head: git.head, line_start: s.line_start, line_end: s.line_end },
    required_context_boxes: [{ id: 'file-identity', kind: 'annotation', text: `${s.repository_id} ${s.path} L${s.line_start}-${s.line_end} @ ${git.branch} ${git.head.slice(0, 12)}` }],
    operations: ['STAT_SOURCE', 'READ_FILE_RANGE', 'QUERY_GIT_IDENTITY'],
    source_identity_line: `${s.repository_id} · ${s.path} · lines ${s.line_start}–${s.line_end} · ${git.branch}@${git.head.slice(0, 12)}${git.dirty ? ' · worktree dirty' : ''}`,
    line_numbers_from: s.line_start,
    started_at: observedAt, completed_at: observedAt,
  };
}

module.exports = { ADAPTER, capture };
