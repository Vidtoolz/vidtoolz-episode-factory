# Test manifest

Command: `node acceptance-oracles/screen-capture-v1/tests/run.js`

Frozen pre-commit qualification run: **196 / 196 PASS** — 145 critical, 48 high, 3 medium, 0 low; zero failures at every severity. Groups: browser 17, CaptureSpec 24, concurrency 5, desktop 11, failure 4, file/code 13, Git 9, idempotence 2, intent 1, naive self-audit 10, output 5, presentation 12, privacy 10, provenance 19, Resolve 10, source references 5, terminal 31, video 8.

Real checks include `spawnSync(..., shell:false)` nonce execution, live Git repositories, current Git state querying, a real headless-Chrome local-page PNG, CRC-checked PNGs, a generated two-second 1080×1920 H.264 motion fixture, and `ffprobe` decoding. Scratch secrets are synthetic. The self-audit rejects a screenshot wrapper, arbitrary shell executor, OBS-only evidence without state proof, CDP substitution for Resolve, fake UI, cached frame, absent secret scan/provenance/QC, and technical-only intent.

Harness success proves the oracle's own reference/red cases behave as specified. Candidate qualification requires mapping candidate output to these public records and passing the gates; this run does not pre-approve an unseen candidate.
