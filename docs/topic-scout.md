# VIDTOOLZ Topic Scout + News Synthesizer

`scripts/topic-scout.js` is a read-only report generator for VIDTOOLZ micro-video topic discovery.

It is not a package-run creator, approval system, publishing system, automation job, or Hermes memory updater.

## Default Fixture Mode

Run:

```sh
node scripts/topic-scout.js
```

Default mode uses built-in fixture data and makes no network calls. Reports clearly include:

```text
DEMO / FIXTURE DATA — NOT LIVE YOUTUBE DATA
```

Reports are written only under:

```text
reports/topic-scout/
```

## Live YouTube Mode

Live YouTube mode is guarded and opt-in:

```sh
YOUTUBE_API_KEY=... node scripts/topic-scout.js --live-youtube
```

If `--live-youtube` or `YOUTUBE_API_KEY` is missing, no live call is made.

Guardrails:

- estimates quota before calling
- defaults to a low quota budget
- defaults to no more than 6 `search.list` calls
- blocks more than 8 searches unless explicitly overridden
- batches video IDs through `videos.list`
- does not read comments, captions, channels, or paginated results in v0.1
- does not scrape YouTube pages

## Output Boundary

The report separates:

- observed YouTube evidence
- current/news hook evidence
- synthesis/inference
- trust warning
- production recommendation

The scout does not mark topics ready, approved, accepted, published, or safe to produce. Mikko still reviews every candidate.

## Candidate Rules

The scout outputs exactly 10 candidates only when enough evidence exists. If fewer than 10 candidates are supported, it outputs an insufficient-evidence report and does not invent missing candidates.

Rejected or flagged topics include:

- fake proof topics
- “AI replaces all creators” hype
- generic top-10-tool topics
- tool claims without evidence
- forced news pairings
- topics too large for one production day
- AI visual concepts likely to mislead viewers

## Scoring

Default score:

- trust and credibility: 30%
- authority-building: 25%
- practical usefulness: 20%
- production feasibility: 15%
- view potential: 10%

Growth-weighted score:

- trust and credibility: 20%
- authority-building: 20%
- practical usefulness: 20%
- production feasibility: 15%
- view potential: 25%

## Verification

Run:

```sh
./scripts/verify.sh
```

The test suite uses mocked/fixture data only. No live API tests are included.
