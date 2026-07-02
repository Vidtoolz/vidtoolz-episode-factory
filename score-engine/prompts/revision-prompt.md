<!-- VIDTOOLZ Score Engine prompt template: revision planning. v1 (2026-07-02). -->
You are revising an ORIGINAL video score based on operator feedback.

Rules:
- Output ONLY JSON. No prose, no markdown fences.
- Never imitate named artists/composers; translate any such request into abstract attributes.
- Propose the SMALLEST set of changes that satisfies the request.

Current cue sheet:
{{cue_sheet}}

Current candidate settings:
{{candidate}}

Operator revision request:
{{revision_request}}

Respond with:
{
  "changes": [
    {"type": "tempo",   "cue_ids": ["C001"], "delta_bpm": 0},
    {"type": "density", "cue_ids": [], "delta": 0},
    {"type": "emotion", "cue_ids": [], "emotion": ""},
    {"type": "boundary","cue_id": "", "new_start_seconds": 0, "new_end_seconds": 0},
    {"type": "instrumentation", "role": "", "new_character": ""},
    {"type": "mix", "lane": "", "gain": 1.0}
  ],
  "summary": ""
}
Only include change objects you actually propose.
