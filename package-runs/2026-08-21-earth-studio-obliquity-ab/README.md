# Opening-Obliquity A/B Evaluation (2026-08-21)

A = heading-aware baseline WITHOUT automatic obliquity promotion.
B = the same operator intent WITH the live obliquity policy.
Same fixed timestamp, same production path — the ONLY difference is the
obliquity decision. INTENTIONALLY_IDENTICAL pairs are byte-identical on
purpose: the policy honestly kept the flat default (operator authority,
map-view purpose, restraint, scale, budget, or geometry).

Technical evidence only. Nothing here claims the promoted openings are
beautiful — that verdict belongs to Mikko in the A/B review.

Review:       node scripts/earth-studio-opening-ab-review.js --gate package-runs/2026-08-21-earth-studio-obliquity-ab
Import check: node scripts/earth-studio-journey-import-gate.js --gate package-runs/2026-08-21-earth-studio-obliquity-ab --list
