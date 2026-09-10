# REVIEW-MARKER-POLICY.md — Resolve markers and human review (v1.1, FROZEN_NOW)

Corrects adjudication finding M3. Marker colour, name or customData in Resolve MAY **locate** a review candidate: the adapter may map a marker to the beat/binding whose interval contains it and pre-fill a *draft* note in the Episode Factory review UI.

Markers MUST NOT establish any of: `KEEP`, `CHANGE`, `CUT`, `REWRITE`, `target_domain`, ratings, `DRAFT_APPROVED`, or any approval. Only an explicit human attestation submitted through `draft-review-intake.js` (producing a `vidtoolz.draftReview.v2` record with reviewer authority, review subject hashes, disposition and domain) or an existing authoritative review record establishes a review decision. `NO_FEEDBACK != KEEP` continues to hold: an absent marker is not a KEEP. Marker-derived text is stored, if at all, as `source: RESOLVE_MARKER_HINT` on an unsubmitted proposal and is discarded if the reviewer does not adopt it.
