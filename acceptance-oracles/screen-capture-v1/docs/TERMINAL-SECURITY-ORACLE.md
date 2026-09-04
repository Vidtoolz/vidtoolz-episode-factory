# Terminal security oracle

Terminal capture is an exact structured process invocation under a read-only template. No shell is involved. Template, executable, complete argv, approved non-symlink cwd, exit code, stdout hash, capture nonce, and (for Git) repository state are evidence.

Critical reds cover `;`, `&&`, `||`, pipes, subshells, `$()`, backticks, redirections, environment expansion, globs, newlines/CR, single/double-quote smuggling, PowerShell/cmd variables and caret escaping, arbitrary executables/templates/scripts, wrong cwd, stale output, fake nonce imagery, and detached transcript. Template parameters must be typed narrowly; an allowlisted program name does not authorize arbitrary flags.
