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

## Manual 1of10 Input Mode

Use this mode for CSV, JSON, or Markdown copied manually from 1of10 outlier/trending pages:

```sh
node scripts/topic-scout.js --oneof10-input path/to/manual-oneof10.csv
```

Accepted local file types:

- `.csv`
- `.json`
- `.md` Markdown table

Useful columns:

- `title`
- `channel`
- `views`
- `age` or `date`
- `url`
- `1of10 score`, `outlier score`, or `multiplier`
- `topic`, `keyword`, or `niche`

Manual mode makes no network calls and labels the report:

```text
MANUAL 1OF10 INPUT — USER-COPIED DATA, NOT LIVE YOUTUBE DATA
```

The scout treats copied 1of10 rows as observed performance evidence only. It does not scrape 1of10, verify the copied data, or imply VIDTOOLZ will reproduce the outlier result.

## Manual 1of10 Helper

Use the helper when preparing Mikko's local CSV:

```sh
node scripts/oneof10-input-helper.js template --open
node scripts/oneof10-input-helper.js validate inputs/oneof10/manual-oneof10-template.csv
node scripts/oneof10-input-helper.js run inputs/oneof10/manual-oneof10-template.csv --open
```

The helper creates or opens the local template, validates that at least 10 rows have `Title` and parseable `Views`, warns about generic/hype rows that Topic Scout is likely to reject, and only runs Topic Scout when the CSV has enough valid rows. It does not scrape 1of10, store browser data, or make network calls.

Optional cleanup:

```sh
node scripts/oneof10-input-helper.js clean inputs/oneof10/manual-oneof10-template.csv
```

Cleanup writes a `.cleaned.csv` copy and leaves the original unchanged.

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

Topic Scout keeps the original weighted scores for compatibility:

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

The report also includes a 10-criteria `total_score` from 10 to 100. Every
criterion used in `total_score` is higher-is-better:

- `audience_demand`
- `channel_fit`
- `authority_building`
- `novelty`
- `production_feasibility`
- `proof_availability`
- `title_thumbnail_potential`
- `generic_safety`
- `promise_safety`
- `beats_existing`

Raw risk diagnostics may also appear:

- `risk_generic`
- `risk_overpromising`

Those raw risk values are lower-is-better diagnostics and are not summed into
`total_score`. `generic_safety` and `promise_safety` are the inverted
higher-is-better versions used for ranking.

## Verification

Run:

```sh
./scripts/verify.sh
```

The test suite uses mocked/fixture data only. No live API tests are included.
