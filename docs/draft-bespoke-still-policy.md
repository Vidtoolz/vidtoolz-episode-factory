# Draft bespoke-still policy

Draft Mode and Directed Draft review iterations use a bounded visual prototype: approximately 20 script-specific still slots for a normal three-to-four-minute script. Each slot binds exact current Story text, a canonical section/beat, one visual concept, and one canonical generation prompt.

The canonical asset class is `DRAFT_BESPOKE_STILL`. It is non-temporal, non-final, and has no publication authority. One normal FLUX image generation is allowed. One replacement is allowed only after the system records a computed `TECHNICAL_FAILURE`; a technically valid `CREATIVE_WEAKNESS` is retained without automatic retry. Candidate grids, aesthetic retries, automatic selection, video generation, I2V, and Kling are prohibited.

The Editor uses fixed `COVER` or `CONTAIN` geometry and hard cuts. Pan, zoom, slow scale, reveal, opacity/position/scale/crop animation, parallax, drift, and simulated camera motion are rejected before rendering. A fixed fit transform is legal because it is constant for the whole interval. V4 reveal remains available to other asset classes.

Generation Supervisor writes immutable per-attempt provenance plus a registry and `vidtoolz.draftBespokeStillThroughputMetrics.v1`. The existing `vidtoolz.draftReview.v2` authority optionally distinguishes `VISUAL_CONCEPT` from `IMAGE_EXECUTION`; KEEP preserves creative intent, never the disposable Draft bytes as a final asset.

Final Production doctrine is unchanged. Draft assets cannot become `FINAL_STILL`, `FINAL_VIDEO_SOURCE`, or publication media through this workflow.

When the predecessor package-run is already in Production, do not change its mode or reuse its immutable release. Resolve the current approved Story and create a separate Draft successor through `scripts/draft-bespoke-successor-authority.js`; see `docs/draft-bespoke-successor-authority.md`. The successor adapter projects the canonical still registry into static composition, Draft release, and Directed Draft handoff authorities without caller media paths.

The bounded real-canary command is:

```bash
node scripts/package-run-draft-bespoke-stills.js package-runs/<run-id> --visual-plan <canonical-visual-plan.json> --execute
```

Run it once only after separate real-canary authorization. Without `--execute`, the command reports the exact sequential dispatch plan and the 51-second-per-image baseline estimate without generating media.
