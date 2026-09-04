# Acceptance contract

| Class | Preconditions | Allowed operations | Required provenance / success | Forbidden substitution and failure |
|---|---|---|---|---|
| BROWSER | approved http(s) URL/network zone, exact selector and state nonce, auth ready | bounded navigation/wait/observation | requested/final URL, redirect policy, selector visibility, fresh nonce in authentic pixels | no inaccessible/fake/cached page; auth/redirect/selector failure is typed and fail-closed |
| TERMINAL | approved machine/root, exact read-only template, structured argv, unique nonce | execute only the selected template without a shell | exact executable/argv/cwd/exit/stdout hash plus visible nonce; Git adds repo/HEAD/branch/worktree hash | no arbitrary executable, metacharacters, expansion, redirection, or synthetic terminal image |
| FILE_OR_CODE | approved repository/root, regular non-symlink file, frozen Git and source hashes, bounded lines/context | read/render exact line range | repo/path/HEAD/branch/worktree/source/text hashes and all protected context visible | no substitute text, traversal, special file, wrong branch/repo, or omitted contradictory lines |
| DESKTOP_APPLICATION | exact app/process/window/session/monitor, visible ready unobscured target, no recent human activity | observation and pixel capture only | exact application state receipt and raw pixels | no focus theft, modal/minimized/obscured/wrong-session capture or generic computer use |
| DAVINCI_RESOLVE | Resolve idle; exact project/timeline/playhead; no modal/play/render/background work or recent human activity | observation and pixel capture only | exact Resolve state and operations manifest | no opening/switching/seeking/editing to manufacture state; fail or request a separately qualified control contract |

All classes require a current CaptureSpec binding, exact raw and presentation paths/hashes, privacy `ALLOW`, evidence-intent `SATISFIED`, independent QC `PASS`, and Episode Factory handoff digest. Capture failure creates no substitute artifact and requires Visual Director replan or explicit human escalation.
