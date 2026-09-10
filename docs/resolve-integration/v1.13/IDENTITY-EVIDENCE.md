# IDENTITY-EVIDENCE.md — the occurrence-identity evidence contract (v1.6, FROZEN_NOW as contract; no observation exists)

Addresses the missing contract between "the `GetUniqueId` getter can be read" and "an id may be used to select an object for a write" (Claude M-ID; Codex GetUniqueId scope boundary).

## Three separate M0 claims, derived from re-parsed captures

Every claim is computed by `authority_lib.identity_claims` from individual `RAW_CAPABILITY_CAPTURE` records — one capture per receiver per read pass, each with its own receiver navigation path — and never from a probe-written summary.

| Claim | Statement | Derivation | False when |
|---|---|---|---|
| **A — callable** | the identity getter returns a non-empty string on every observed object | every capture in every pass derives `SUCCESS` | any capture derives `EXCEPTION`, `NULL_NOT_ALLOWED`, `TYPE_MISMATCH`, `UNSUPPORTED`, … |
| **B — unique within one pass** | within one no-mutation read of one timeline, no two receivers returned the same id | duplicate detection over the decoded values of pass 1 | any duplicate (listed) or any null |
| **C — stable across passes** | the same receiver path returns the same id in ≥ 3 consecutive no-mutation reads of the same session | per-path equality across all passes | fewer than three passes, a missing path, or any changed value |

Records: `IDENTITY_UNIQUENESS_OBSERVATION` (claim B) and `IDENTITY_STABILITY_OBSERVATION` (claim C), each carrying the pass lists of raw capture digests and the claim block. `authority_lib.semantic_identity_observation` recomputes every claim from the captures and rejects any declared value that differs — an observation cannot assert uniqueness over captures that contain duplicates.

## What is never claimed

Survival across append/replace/delete (M3 P6), survival across `SaveProject` + reopen (M3 P15), survival across `DuplicateTimeline`/DRT round trip, take finalization, and uniqueness across timelines or projects. An identity observation that carries such a claim is refused. `M3-MATRIX.md` remains the only place those questions are answered, and only per tested operation.

## Promotion ladder

After M0: with A, B and C observed on at least one multi-item qualification timeline, the `read: object identity (readable now)` row may become `QUALIFIED_READ` through the ordinary refreeze law, and `IDENTITY-BINDING.md` may record `current_read_unique` / `current_read_stable` as OBSERVED **for the qualification library**. A failure is recorded, blocks the identity-dependent M3 claims, and does not block M0 exit.

After M3: survival claims per operation. Only then may a mutation plan rely on `item_unique_id` selectors for `DELETE`, `DISABLE`, `ENABLE` or take swaps.

Independently of all three claims, verification stays fail-closed on duplicate ids: `occurrence_index` refuses to build an index when two OBSERVED ids collide (`DUPLICATE_OCCURRENCE_IDENTITY`), `derive_delta` returns nothing and `verify_transaction` reports `UNOBSERVABLE_STATE`.

## v1.7: uniqueness is validated before any index exists (Codex C16-M1)

v1.6 derived claims by writing `ids[path] = value` for each capture in a pass. A second observation of the same
receiver path overwrote the first, the conflict disappeared, and claim B was then asserted true over a pass that had
in fact observed one path twice. v1.6 also asserted claim C over a population whose identity values were not unique.

v1.7 builds each pass as an **ordered list** of observations, one per capture, in capture order, and validates it
before any uniqueness or stability map is constructed:

| code | refusal |
|---|---|
| `DUPLICATE_RECEIVER_PATH` | the same receiver path observed twice in one pass |
| `PATH_HANDLE_CONFLICT` | the same receiver path under two different handle tokens |
| `PATH_ID_CONFLICT` | the same receiver path returning two different identity values |
| `DUPLICATE_ATTEMPT_ID` | two observations sharing one getter attempt id |
| `NULL_RECEIVER_PATH` | an observation with no receiver path to be unique about |
| `MISSING_HANDLE_TOKEN` | an observation with no handle token binding the path to a live object |
| `PASS_SET_MISMATCH` | a later pass observing a different receiver-path set than the first |

A pass carrying any of these produces **no claims at all**. There is no first-wins and no last-wins.

Claim C now requires claim B. Identity that is not unique within a single pass is not identity, so the fact that the
same non-unique values reappear in later passes says nothing about identity stability. An identity observation record
must carry the recomputed input errors and observation count alongside its claims, and the record law compares them.
