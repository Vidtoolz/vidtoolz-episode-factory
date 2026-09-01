# Final Production Lock → Final Production Package

The immutable bridge from an approved Draft into manually supervised Final
Production.

```
DRAFT_REVIEW_READY
  → (real human review through vidtoolz.draftReview.v2) → DRAFT_APPROVED
  → vidtoolz.finalProductionLock.v1        (immutable, fully bound)
  → vidtoolz.finalProductionPackage.v1     (lock-bound, operational)
  → manual final asset production · manual human performance
  → Resolve final edit · final QC · publication approval
```

This pipeline ends at `FINAL_PRODUCTION_PACKAGE_READY`. It never performs the
final production and never grants publication authority.

## Recording the approval

`DRAFT_APPROVED` is not a new field: it is the **derived** state of the
existing review authority — an overall `draft_verdict = KEEP` with zero
`CHANGE`/`CUT`/`REWRITE` notes. `draft-review-intake.promotionDecisionView`
computes it. No second review schema, vocabulary or approval mechanism exists,
and recording an approval requires no invented notes or ratings.

## The lock

`scripts/final-production-lock.js` means exactly one thing:

> **This script and creative direction are approved for Final Production.**

It does **not** mean the Draft media is publication media. It binds the
approved draft bytes and review-subject digest, the approval identity
(authority, review id, review file hash, binding and submission digests,
verdict), the locked Story/script, the beat identity with timings, the
Directed Draft handoff/release/evidence/execution identity, the research
approval, and the Draft narration's explicit non-authority. Every authority
field that could escalate (`publication_*`, `final_master_exists`,
`final_qc_pass`, `grants_final_*`) is validated `false`.

After locking, the script and creative direction are immutable. A change
requires an explicit `breakFinalProductionLock` naming a human authority and a
reason, then a successor lock and a new human approval.

### Research approval and successor lineage

A lock requires approved research evidence. A Draft **successor** run carries
no research pack by design — it inherits its Story from an immutable Production
predecessor. Inheritance is therefore allowed, but only through the chain the
successor authority already hash-binds: both `draft-bespoke-successor.json` and
`story-binding.json` must name the same predecessor, the pinned
`predecessor_binding_sha256` must match the predecessor's actual bytes, the
predecessor must be `PRODUCTION` mode and the same Story project, and its
research evidence must be `PASS`. This is verification through existing
provenance — **not a waiver**, and there is no bypass flag.

## The package

`scripts/final-production-package.js` answers *"what exactly must be manually
produced to turn the approved Draft into the publishable final video?"*

| Component | Schema |
|---|---|
| `final-script.json` | `vidtoolz.finalScriptPackage.v1` |
| `final-performance-package.json` | `vidtoolz.finalPerformancePackage.v1` |
| `final-visual-package.json` | `vidtoolz.finalVisualPackage.v1` |
| `final-asset-tracker.json` | `vidtoolz.finalAssetTracker.v1` (living state) |
| `final-music-brief.json` | `vidtoolz.finalMusicBrief.v1` |
| `final-resolve-blueprint.json` | `vidtoolz.finalResolveBlueprint.v1` |

Final visuals are **rebuilt from the locked script**. Each beat carries a
production-grade GPT Image prompt composed from the locked line plus the
approved creative intent, 9:16 geometry, explicit safe regions and negative
constraints. Text-bearing roles (infographic / diagram / text card) carry an
exact allowed-text contract derived verbatim from the locked line; every other
prompt forbids text outright. No prompt references an ephemeral Draft image
path — the Draft still appears only as `CONCEPTUAL_CONTINUITY_ONLY`.

### Still vs video source

A recommendation with a stated basis, overridable by Mikko: a video source
needs concrete imagery (`SCENE`/`METAPHOR`) **and** a hold of at least 9000 ms.
Designed text cards are never motion sources. Everything else is a still, so
motion has to earn its generation cost.

### The image-bound motion boundary

An authoritative I2V/Kling prompt **cannot exist before the selected final
image exists**, because the prompt must describe that image. The package ships
motion *intent* plus a template with `authoritative_prompt: null`.
`bindMotionPrompt` mints the real prompt only against an already `SELECTED`
image, binding its sha256, and refuses otherwise.

### Asset tracker

`REQUIRED → PROMPT_READY → GENERATED → SELECTED → I2V_READY →
VIDEO_GENERATED → FINAL_ASSET_SELECTED`. `GENERATED` never implies `SELECTED`:
selection is a separate transition requiring a named human authority and a
hash-verified, in-run, already-registered candidate.

## Performance and music

The performance package requires a **fresh** Mikko performance of the locked
script. This production's r2 carries a human-recorded narration as a Draft
**exception**; normal Draft narration is synthetic
(`DRAFT_SYNTHETIC_PROXY`, DRAFT-only), and neither satisfies final performance
authority. Draft music is provisional: the final music brief stays `REQUIRED`
with `final_music_authority: false` and treats Draft music as inspiration only.

## Next action

`nextActions()` resolves dependencies and reports ready / blocked / waiting-on-
Mikko / completed tasks with concrete instructions ("Generate final image for
beat final-visual-007 using prompt …"). It never schedules or executes.

## Entry point

```bash
node scripts/final-production-package.js lock    --run-id <run> [--expect-draft-sha <sha>]
node scripts/final-production-package.js package --run-id <run>
node scripts/final-production-package.js next    --run-id <run>
node scripts/final-production-package.js status  --run-id <run>
```

## Manual authority preserved

Mikko selects final images, chooses which become video, selects Kling clips,
records the performance, selects the take, edits in Resolve, approves music,
approves QC and approves publication. These are product doctrine, not missing
automation.
