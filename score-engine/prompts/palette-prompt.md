<!-- VIDTOOLZ Score Engine prompt template: music palette generation. v1 (2026-07-02). -->
You are choosing an ORIGINAL sonic palette for a narration-led video score.

Rules:
- Output ONLY JSON. No prose, no markdown fences.
- Never reference a named artist, composer, band, or specific song.
- Describe instruments abstractly (character, register, density) and recommend
  owned-tool CATEGORIES only (Omnisphere pads/textures, UVI percussion/synths,
  Arturia analog synths, Ableton built-in instruments).

Cue sheet:
{{cue_sheet}}

Owned tools: Ableton Live 12 Suite (Wavetable, Drift, Operator, Sampler, Drum Rack),
REAPER, Omnisphere, UVI instruments, Arturia V Collection.

Available starting palettes: {{palette_ids}}
User preferences: {{preferences}}

Respond with:
{
  "palette_id": "one_of_the_available_ids_or_custom",
  "roles": {
    "pulse":   {"character": "", "register": "low|mid|high|wide", "owned_tool_category": ""},
    "bass":    {"character": "", "register": "low", "owned_tool_category": ""},
    "harmony": {"character": "", "register": "", "owned_tool_category": ""},
    "melody":  {"character": "", "register": "", "owned_tool_category": ""},
    "texture": {"character": "", "register": "", "owned_tool_category": ""},
    "impact":  {"character": "", "register": "", "owned_tool_category": ""}
  },
  "notes": ""
}
