# VIDTOOLZ Package Engine Generation Prompt

Topic / session focus:

DaVinci Resolve 20 - What Changed For Shorts Creators

Source workflow file:

/home/vidtoolz/hermes-organiser/brain/workflows/vidtoolz-package-engine.md

## Instructions

Use the Hermes workflow below as the source instruction for this package generation session.

Generate exactly 10 ranked YouTube package candidates for VIDTOOLZ.

Output valid JSON only. Do not wrap the JSON in Markdown fences. Do not include commentary before or after the JSON.

If valid JSON cannot be produced, explain the problem instead of inventing invalid structure.

Do not create outlines, scripts, descriptions, chapters, pinned comments, publishing assets, or episode folders yet.

The output must match this package-candidates.json shape:

{
  "project": "VIDTOOLZ Package Engine",
  "generatedAt": "ISO-8601 timestamp",
  "candidates": [
    {
      "id": "pkg-001",
      "packageNumber": 1,
      "score": 0,
      "recommendation": "Make | Maybe | Reject",
      "proposedTitle": "",
      "idea": "",
      "thumbnailConcept": "",
      "onThumbnailText": "",
      "thumbnailImage": "",
      "viewerPromise": "",
      "targetViewer": "",
      "productionDifficulty": "Low | Medium | High",
      "mainRisk": "",
      "shortsIdeas": [
        "",
        "",
        "",
        "",
        ""
      ],
      "why_this_matters_now": "",
      "why_this_stays_relevant": "",
      "why_this_fits_vidtoolz": "",
      "why_vidtoolz_can_make_it_better": "",
      "audience_demand_rationale": "",
      "suggested_production_approach": ""
    }
  ]
}

Important output rules:
- Use exactly 10 objects in the candidates array.
- Use recommendation values only: Make, Maybe, Reject.
- Use productionDifficulty values only: Low, Medium, High.
- Score must be an integer from 0 to 100.
- shortsIdeas must contain exactly five strings.
- Fill every strategic field.
- Prefer specific, practical packages over broad generic ideas.
- Be critical. Reject weak ideas instead of flattering them.

## Hermes Workflow Content

---
title: vidtoolz-package-engine
status: active
tags: [vidtoolz, package-engine, youtube, ai-video, workflow]
---

# VIDTOOLZ Package Engine

## Purpose
The VIDTOOLZ Package Engine helps select the next high-potential YouTube video for the VIDTOOLZ channel.

Its job is to do most of the idea discovery, research, scoring, packaging, and early creative development so the creator can focus on final editorial choice and video production.

## Core Channel Positioning
VIDTOOLZ = practical video creation in the AI era.

VIDTOOLZ helps serious solo creators stay relevant, make better videos faster, and understand which AI/video tools actually matter without losing real production quality.

## Core Viewer Question
Every video idea should answer some version of this viewer question:

How do I stay relevant, make better videos faster, and know which AI/video tools actually matter?

## Primary Audience
The primary audience is serious solo creators adapting to AI.

This includes:
- YouTube creators
- solo video makers
- creator-educators
- small production operators
- editors adapting to AI
- practical creators overwhelmed by new tools

The audience should not be treated as total beginners, but the content should still be clear enough for ambitious beginners to follow.

## Secondary Audience
The secondary audience is experienced editors and video people who need to modernize their workflow because of AI.

This audience gives VIDTOOLZ credibility, but the channel should not become too narrow or expert-only.

## Tone
Default tone: practical teacher with critical tester instincts.

This means:
- explain clearly
- be useful quickly
- avoid hype
- test assumptions
- point out weaknesses
- prefer real workflow value over novelty
- judge AI/video tools by actual production usefulness

Avoid:
- generic AI hype
- shallow reaction content
- motivational creator talk with no practical workflow
- narrow software tutorials with no broader relevance
- "make money with AI" framing

## Content Angle
The channel should focus on AI tools inside real production, judged by durable production principles.

The clickable surface of a video can be about an AI tool, DaVinci Resolve feature, workflow, or creator problem, but the lasting value must come from real video production judgment.

Example:
- Clickable topic: Can AI B-roll Actually Save a YouTube Video?
- Durable principle: B-roll must clarify, pace, support, and strengthen the story, not merely look impressive.

## Strategic Responsibility Split
AI does roughly 90% of idea discovery, research, scoring, packaging, outlining, and first-draft scripting.

The creator keeps the final 10% editorial veto:
- taste
- willingness
- final selection
- actual video creation

The creator should not be required to watch competitor videos or do manual market research unless they choose to.

## Core Workflow
1. AI researches market signals.
2. AI generates ranked YouTube packages.
3. User chooses, rejects, combines, or debates the packages.
4. AI refines one final selected package.
5. AI generates three structurally different outlines.
6. User chooses and edits the preferred outline.
7. AI writes the detailed script.
8. User creates the video.
9. AI analyzes the finished video or transcript and creates publishing assets.

## Definition Of A Strong VIDTOOLZ Idea
A strong VIDTOOLZ video idea must sit at the intersection of:
- audience demand
- VIDTOOLZ expertise fit
- creator willingness / production feasibility
- ability to make the video better than competitors
- long-term relevance in the AI era

Reject an idea if it only satisfies one or two of these.

## Research Scope
When researching candidate topics, consider signals from:
- AI-assisted video creation
- DaVinci Resolve
- video editing workflows
- AI video generation
- AI b-roll
- creator productivity
- YouTube workflow
- scripting and packaging workflows
- video files, codecs, media management, and technical fundamentals
- post-production automation
- Shorts repurposing
- practical creator operating systems

DaVinci Resolve should remain an important credibility anchor, but VIDTOOLZ should not be limited to Resolve tutorials.

## Package Generation Task
When asked to generate video ideas, create 10 ranked YouTube packages, not just topic ideas.

Each package must include:
- Package name
- Core idea
- Proposed title
- Thumbnail concept
- On-thumbnail text
- Viewer promise
- Target viewer
- Why this matters now
- Why this may stay relevant
- Why this fits VIDTOOLZ
- Why VIDTOOLZ can make it better than generic competitors
- Evidence or rationale for audience demand
- Production difficulty
- Suggested production approach
- Five possible Shorts extracted from the video
- Main weakness or risk
- Score out of 100
- Recommendation: make / maybe / reject

## Scoring Criteria
Score each package from 1-10 on the following dimensions:
- audience demand
- AI-era relevance
- VIDTOOLZ expertise fit
- production feasibility
- creator willingness / likely enjoyment
- ability to outperform generic competitors
- title strength
- thumbnail strength
- evergreen value
- Shorts extraction potential

Then calculate a score out of 100.

## Scoring Guidance
High-scoring ideas usually have:
- a clear creator pain
- broad appeal beyond existing subscribers
- a practical payoff
- a strong title/thumbnail promise
- connection to AI-era video creation
- room for real production judgment
- ability to be demonstrated or explained clearly
- potential for one 10-14 minute video and at least five Shorts

Low-scoring ideas usually are:
- too narrow
- too generic
- too news-based
- too dependent on one software update
- too hard to produce quickly
- too similar to existing videos
- too focused on tools without a larger creator problem

## Package Verification Gate
Before generating outlines, the selected package must pass this gate:
- Can a non-expert understand the promise in three seconds?
- Does the title create a specific curiosity gap?
- Does the thumbnail concept communicate without needing the title?
- Is the promise practical rather than vague?
- Can VIDTOOLZ credibly make this better than generic AI/video channels?
- Can the first 30 seconds prove value quickly?
- Does the topic help serious solo creators adapt to AI?
- Does the idea have potential beyond one temporary trend?

If the package fails, refine or reject it before outlining.

## Outline Generation Task
After one package is selected, generate three structurally different outlines.

The three outlines should not be minor variations. They should represent meaningfully different approaches, such as:
- practical tutorial / workflow version
- critical test / myth-busting version
- strategic framework / workflow architect version

Each outline should include:
- opening hook
- viewer problem
- promise setup
- section-by-section structure
- suggested demonstrations or screen recordings
- key production principle
- AI/tool evaluation moments
- retention risks
- ending/payoff
- possible Shorts moments

## Script Generation Task
After the creator selects and edits the final outline, generate a detailed script.

The script should include:
- spoken narration
- screen action notes
- visual beats
- B-roll suggestions
- demo moments
- chapter structure
- retention checks
- places where the title/thumbnail promise is paid off
- possible Shorts extraction points

The script should be practical, clear, and production-oriented. Avoid sounding like generic AI copywriting.

## Finished Video Publishing Task
After the video is produced, analyze the final video, script, or transcript and create:
- final title check
- final thumbnail/title alignment check
- description
- chapters
- pinned comment
- five Shorts angles
- five Shorts titles/hooks
- community post
- newsletter blurb
- follow-up video ideas

Publishing assets should be generated after the video exists, because the final video may differ from the original script.

## Default Weekly Prompt
Use this prompt when starting a new video package session:

```text
Act as the VIDTOOLZ Autonomous Package Engine.

VIDTOOLZ is positioned as practical video creation in the AI era.

The channel helps serious solo creators answer:
"How do I stay relevant, make better videos faster, and know which AI/video tools actually matter?"

Do 90% of the idea discovery work for me. Research current public signals and generate 10 ranked YouTube packages for my next video.

Each package must fit this filter:
- audience demand
- my real expertise
- my willingness / production feasibility
- my ability to make it better than competitors
- long-term relevance in the AI era

Do not require me to watch competitor videos.
Do not write the outline or script yet.
The goal is to help me choose the strongest package first.
```

## Output Format For Package Sessions
Use this format for each package:

```markdown
## Package [number]: [Package Name]

**Idea:**

**Proposed title:**

**Thumbnail concept:**

**On-thumbnail text:**

**Viewer promise:**

**Target viewer:**

**Why this matters now:**

**Why this stays relevant:**

**Why this fits VIDTOOLZ:**

**Why VIDTOOLZ can make it better:**

**Audience demand rationale:**

**Production difficulty:**

**Suggested production approach:**

**Five Shorts extracted from this video:**
1.
2.
3.
4.
5.

**Main risk / weakness:**

**Score:** /100

**Recommendation:** Make / Maybe / Reject
```

## Final Rule
The Package Engine should be critical. Its job is not to produce many flattering ideas. Its job is to protect the creator from wasting production time on weak ideas.

Prefer fewer strong, specific, practical packages over many broad or generic suggestions.
