# File/code evidence oracle

The source is a regular non-symlink file under an approved repository root. The request freezes repository id/root, full HEAD, branch/detached status, worktree-state SHA-256, file SHA-256, bounded line range, and protected context lines. Current Git/file state is re-read before acceptance; rendered text is hashed against the exact requested range.

Critical reds cover mutation after request, wrong repository/root, traversal, `/proc`, symlink, FIFO, source hash mismatch, generated substitute text, wrong HEAD/branch, wrong range, and omission of a contradictory line.
