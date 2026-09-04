# Screen Capture V1 acceptance oracle

Independent, candidate-blind qualification authority for authentic `SCREEN_CAPTURE` evidence. The executable contract is `oracle.js`; `tests/run.js` supplies positive references, red tests, hostile fixtures, real Git/process/browser/media checks, and naive-implementation self-audits.

Run:

```bash
node acceptance-oracles/screen-capture-v1/tests/run.js
```

A Stage 7 candidate is not qualified merely because this harness executes. An adapter must be mapped to the public CaptureSpec/evidence/failure records and pass all mandatory gates in `docs/QUALIFICATION-GATES.md`, including independent intent QC and real-source trials.
