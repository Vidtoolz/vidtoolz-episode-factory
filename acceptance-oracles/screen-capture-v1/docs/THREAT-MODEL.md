# Threat model

Protected claim: displayed evidence came from the requested real source after the requested state occurred, on the named machine/session, and survived presentation without a silent change of meaning.

Critical threats are synthetic substitution, wrong app/repo/machine/session, stale or cached state, capture before action completion, detached raw/presentation/provenance, secrets or personal data, arbitrary command or filesystem access, hidden representation fallback, and mutation of a live Resolve editorial session. High threats include wrong browser state, misleading crop/zoom/callout, unreadable mobile evidence, corrupt/frozen video, output races, and stale filename reuse.

Trust boundaries:

- CaptureSpec is untrusted input and fails closed on unknown or dangerous semantics.
- Source adapters have only class-specific bounded operations; they are not a general shell or RPA service.
- Raw pixels/transcript and source-state receipt are immutable evidence. A presentation is a derivative.
- Privacy scanning precedes handoff; V1 blocks secret-bearing captures.
- Independent QC proves the evidence intent, not only file validity.
- Desktop/Resolve observation yields to recent human activity, modal/busy state, and exact project/timeline/playhead identity.
- Hash manifests detect inconsistency; production storage must additionally provide access control/immutability because hashes alone do not defeat a malicious party able to rewrite every record.
