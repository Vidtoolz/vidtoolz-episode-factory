"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ap = require("./audience-package.js");
const episodeModel = require("../episode-model.js");
const AGENT_ID = "audience_packaging_director",
  LANE = "large_text",
  ACTIONS = Object.freeze(["plan_packaging", "review_packaging", "status"]),
  STATES = Object.freeze([
    "PLANNING",
    "REVIEWING",
    "PREVIEW_ONLY",
    "AWAITING_HUMAN_REVIEW",
    "RETURN_TO_STORY",
    "RETURN_TO_RESEARCH",
    "NEEDS_HUMAN_DECISION",
    "ESCALATED",
    "BLOCKED",
    "STALE",
    "COMPLETE",
  ]),
  MAX_ATTEMPTS = 3;
const norm = (v) =>
    String(v ?? "")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim(),
  hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex"),
  nowIso = () => new Date().toISOString();
class RoutingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function routeCapability(t) {
  const r = t.risk_level || "LOCAL_AUTO",
    local = t.privacy?.local_only !== false;
  if (r === "FRONTIER_RECOMMENDED")
    return local
      ? { ok: false, code: "PRIVACY_LOCAL_ONLY" }
      : { ok: true, auto_dispatch: false, mode: r };
  if (!["LOCAL_AUTO", "LOCAL_PARALLEL"].includes(r))
    return { ok: false, code: "NO_AUTHORIZED_ROUTE" };
  return { ok: true, auto_dispatch: true, mode: r };
}
function selectComputeRoute(t, o = {}) {
  let s;
  if (o.routeSelector)
    s = o.routeSelector({
      lane: LANE,
      risk_level: t.risk_level || "LOCAL_AUTO",
      privacy: t.privacy,
    });
  else {
    const root = path.resolve(
      o.computeRoot ||
        process.env.VIDTOOLZ_COMPUTE_ROOT ||
        path.join(os.homedir(), "vidtoolz-compute"),
    );
    try {
      s = JSON.parse(
        execFileSync(
          "python3",
          [path.join(root, "vidtoolz-compute.py"), "select", LANE, "--json"],
          { encoding: "utf8", timeout: 120000 },
        ),
      );
      const required =
        JSON.parse(fs.readFileSync(path.join(root, "registry.json"), "utf8"))
          .lanes?.[LANE]?.required_models || [];
      s.model = required.find(
        (m) => !s.checks?.models || s.checks.models.includes(m),
      );
    } catch (e) {
      throw new RoutingError("ROUTING_UNAVAILABLE", e.message);
    }
  }
  if (!s || s.ok !== true || s.decision !== "ROUTE")
    throw new RoutingError(
      "NO_AUTHORIZED_ROUTE",
      s?.reason || "selector declined route",
    );
  if (!s.selected_host || !s.endpoint || !s.model)
    throw new RoutingError("ROUTING_UNAVAILABLE", "route incomplete");
  return {
    lane: LANE,
    host: s.selected_host,
    endpoint: s.endpoint,
    model: s.model,
  };
}
async function invokeModel(prompt, route, o = {}) {
  if (o.modelAdapter) return o.modelAdapter({ prompt, route });
  const response = await fetch(
    `${route.endpoint.replace(/\/+$/, "")}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: route.model,
        stream: false,
        think: false,
        format: "json",
        messages: [
          {
            role: "system",
            content:
              "Return one compact JSON object only. No IDs, authority, routing, approval, Story edits, image prompts, or camera mechanics.",
          },
          { role: "user", content: prompt },
        ],
        options: { temperature: 0, num_ctx: 16384 },
      }),
      signal: AbortSignal.timeout(o.timeoutMs || 120000),
    },
  );
  if (!response.ok) throw Error(`model HTTP ${response.status}`);
  const b = await response.json();
  return b.message?.content || b.response || "";
}
function bindingAuthority(t, id) {
  return t.research?.authority_by_binding?.[id];
}
function bindingById(t, id) {
  return t.research?.bindings_doc?.bindings?.find((b) => b.binding_id === id);
}
function currentRef(t, id) {
  return t.research?.current_result_refs?.find((r) => r.binding_id === id);
}
function validateBindingInput(t, b, e) {
  const a = bindingAuthority(t, b.binding_id),
    r = b.research_result_ref || currentRef(t, b.binding_id);
  if (
    !b.claim_ref?.canonical_id ||
    !Number.isInteger(b.claim_ref?.revision) ||
    !b.assertion_text_sha256 ||
    !r?.result_id ||
    !Number.isInteger(r.result_revision) ||
    !/^[a-f0-9]{64}$/.test(r.result_digest_sha256 || "")
  )
    e.push(`binding ${b.binding_id}: canonical identity incomplete`);
  if (!a) e.push(`binding ${b.binding_id}: authority missing`);
  else if (
    a.result_state !== "VALID" ||
    a.authorization_ok !== true ||
    ["RESEARCH_MORE", "DO_NOT_USE"].includes(a.recommendation)
  )
    e.push(
      `binding ${b.binding_id}: ${a.result_state || a.recommendation || "UNAUTHORIZED"}`,
    );
  else if (
    a.result_id !== r?.result_id ||
    a.result_revision !== r?.result_revision ||
    a.result_digest_sha256 !== r?.result_digest_sha256 ||
    ap.canonicalize(a.claim_ref) !== ap.canonicalize(b.claim_ref) ||
    a.assertion_text_sha256 !== b.assertion_text_sha256
  )
    e.push(`binding ${b.binding_id}: authority identity mismatch`);
}
function preflight(t, o = {}) {
  const errors = [],
    researchBlockers = [];
  if (!t || typeof t !== "object")
    return { ok: false, errors: ["task required"], researchBlockers };
  if (!ACTIONS.includes(t.action)) errors.push("action invalid");
  if (!norm(t.task_id) || !norm(t.requested_by) || !norm(t.project_id))
    errors.push("task identity incomplete");
  if (!t.privacy || typeof t.privacy.local_only !== "boolean")
    errors.push("privacy.local_only required");
  if (
    t.retry_budget !== undefined &&
    (!Number.isInteger(t.retry_budget) ||
      t.retry_budget < 1 ||
      t.retry_budget > 3)
  )
    errors.push("retry_budget invalid");
  if (
    t.deadline &&
    (Number.isNaN(Date.parse(t.deadline)) ||
      Date.parse(o.now || nowIso()) > Date.parse(t.deadline))
  )
    errors.push("deadline invalid or expired");
  if (t.action === "status")
    return { ok: !errors.length, errors, researchBlockers };
  const s = t.story;
  if (
    !s ||
    s.project_id !== t.project_id ||
    !norm(s.version_id) ||
    !/^[a-f0-9]{64}$/.test(s.content_hash || "") ||
    !Array.isArray(s.sections) ||
    !s.sections.length
  )
    errors.push("canonical Story identity/sections invalid");
  if (!norm(s?.central_claim)) errors.push("central_claim required");
  if (!["draft", "approved"].includes(s?.approval_state))
    errors.push("story approval_state required");
  if (!norm(t.audience?.target_viewer) || !norm(t.audience?.viewer_problem))
    errors.push("audience incomplete");
  for (const b of t.research?.bindings_doc?.bindings || [])
    validateBindingInput(t, b, researchBlockers);
  if (t.action === "review_packaging" && !t.existing_package)
    errors.push("existing_package required");
  return {
    ok: !errors.length && !researchBlockers.length,
    errors,
    researchBlockers,
  };
}
const SEM_ROOT = new Set([
  "viewer_promise",
  "title_candidates",
  "thumbnail_candidates",
  "pair_candidates",
  "description_draft",
  "description_claims",
  "package_findings",
  "human_attention",
  "recommendation",
]);
const TITLE_KEYS = new Set([
  "text",
  "strategy",
  "promise",
  "tension",
  "packaging_assertion",
  "research_sensitive",
  "research_binding_ids",
  "required_constraint_ids",
  "risks",
  "rationale",
]);
const THUMB_KEYS = new Set([
  "communication_goal",
  "primary_subject",
  "secondary_subject",
  "hierarchy",
  "visual_tension",
  "optional_text",
  "visual_assertion",
  "title_relation",
  "presenter_need",
  "research_sensitive",
  "research_binding_ids",
  "required_constraint_ids",
  "risks",
  "rationale",
]);
const PAIR_KEYS = new Set([
  "title_index",
  "thumbnail_index",
  "synergy",
  "duplication_risk",
  "contradiction_risk",
  "promise_alignment",
  "rationale",
  "recommendation_rank",
  "risks",
]);
const PROMISE_KEYS = new Set([
  "statement",
  "curiosity_gap",
  "expected_payoff",
  "research_sensitive",
  "research_binding_ids",
  "required_constraint_ids",
]);
const DESC_KEYS = new Set([
  "assertion",
  "research_sensitive",
  "research_binding_ids",
  "required_constraint_ids",
]);
function unknown(obj, keys, w, e) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    e.push(`${w} must be object`);
    return;
  }
  for (const k of Object.keys(obj))
    if (!keys.has(k)) e.push(`${w}.${k}: unknown field`);
}
function checkDeclaredRefs(x, w, t, e) {
  const ids = x.research_binding_ids || [];
  if (
    x.research_sensitive &&
    (!norm(x.packaging_assertion || x.visual_assertion) || !ids.length)
  )
    e.push(`${w}: factual assertion and Research binding required`);
  for (const id of ids) {
    const b = bindingById(t, id),
      a = bindingAuthority(t, id);
    if (!b || !a) e.push(`${w}: unresolved Research binding ${id}`);
    else {
      const required = a.required_constraint_ids || [];
      const supplied = x.required_constraint_ids || [];
      for (const c of required)
        if (!supplied.includes(c)) e.push(`${w}: missing constraint ${c}`);
    }
  }
}
function validateSemanticOutput(raw, t) {
  let v;
  try {
    v =
      typeof raw === "string"
        ? JSON.parse(raw)
        : JSON.parse(JSON.stringify(raw));
  } catch {
    return { ok: false, errors: ["invalid JSON"] };
  }
  const e = [];
  unknown(v, SEM_ROOT, "$", e);
  unknown(v.viewer_promise, PROMISE_KEYS, "viewer_promise", e);
  for (const k of ["statement", "curiosity_gap", "expected_payoff"])
    if (!norm(v.viewer_promise?.[k])) e.push(`viewer_promise.${k} required`);
  checkDeclaredRefs(
    { ...v.viewer_promise, packaging_assertion: v.viewer_promise?.statement },
    "viewer_promise",
    t,
    e,
  );
  const titles = Array.isArray(v.title_candidates) ? v.title_candidates : [];
  if (titles.length < 3 || titles.length > 5)
    e.push("3-5 title_candidates required");
  const seen = new Set();
  titles.forEach((x, i) => {
    const w = `title_candidates[${i}]`;
    unknown(x, TITLE_KEYS, w, e);
    for (const k of ["text", "strategy", "promise", "tension", "rationale"])
      if (!norm(x[k])) e.push(`${w}.${k} required`);
    if (
      !ap.TITLE_STRATEGIES.includes(x.strategy) ||
      String(x.text || "").length > 100
    )
      e.push(`${w}: strategy/text invalid`);
    const n = ap.normalizeTitle(x.text);
    if (seen.has(n)) e.push("duplicate normalized title text");
    seen.add(n);
    if (ap.ABSOLUTE_WORD_RE.test(x.text || "") && !x.research_sensitive)
      e.push(`${w}: absolute factual wording requires Research`);
    checkDeclaredRefs(x, w, t, e);
  });
  const thumbs = Array.isArray(v.thumbnail_candidates)
    ? v.thumbnail_candidates
    : [];
  if (thumbs.length < 2 || thumbs.length > 4)
    e.push("2-4 thumbnail_candidates required");
  thumbs.forEach((x, i) => {
    const w = `thumbnail_candidates[${i}]`;
    unknown(x, THUMB_KEYS, w, e);
    for (const k of [
      "communication_goal",
      "primary_subject",
      "hierarchy",
      "visual_tension",
      "title_relation",
      "rationale",
    ])
      if (!norm(x[k])) e.push(`${w}.${k} required`);
    if (!ap.PRESENTER_NEEDS.includes(x.presenter_need))
      e.push(`${w}.presenter_need invalid`);
    if (x.optional_text != null && String(x.optional_text).length > 24)
      e.push(`${w}.optional_text too long`);
    if (
      x.optional_text != null &&
      (ap.ABSOLUTE_WORD_RE.test(x.optional_text) ||
        /\d/.test(x.optional_text)) &&
      !x.research_sensitive
    )
      e.push(`${w}.optional_text factual wording requires Research`);
    checkDeclaredRefs(x, w, t, e);
  });
  const pairs = Array.isArray(v.pair_candidates) ? v.pair_candidates : [];
  if (!pairs.length) e.push("pair_candidates required");
  pairs.forEach((x, i) => {
    const w = `pair_candidates[${i}]`;
    unknown(x, PAIR_KEYS, w, e);
    if (
      !Number.isInteger(x.title_index) ||
      !titles[x.title_index] ||
      !Number.isInteger(x.thumbnail_index) ||
      !thumbs[x.thumbnail_index]
    )
      e.push(`${w}: refs invalid`);
    if (
      !ap.SYNERGY_CLASSES.includes(x.synergy) ||
      !Number.isInteger(x.recommendation_rank) ||
      !Array.isArray(x.risks)
    )
      e.push(`${w}: fields invalid`);
    if (
      ap.normalizeTitle(titles[x.title_index]?.text) ===
        ap.normalizeTitle(thumbs[x.thumbnail_index]?.optional_text) &&
      x.synergy !== "DUPLICATIVE"
    )
      e.push(`${w}: exact title/thumbnail duplication must be DUPLICATIVE`);
  });
  if (
    typeof v.description_draft !== "string" ||
    v.description_draft.length > 2000
  )
    e.push("description_draft invalid/over-limit");
  if (!Array.isArray(v.description_claims))
    e.push("description_claims required");
  else
    v.description_claims.forEach((x, i) => {
      unknown(x, DESC_KEYS, `description_claims[${i}]`, e);
      if (!norm(x.assertion))
        e.push(`description_claims[${i}]: assertion required`);
      checkDeclaredRefs(
        {
          ...x,
          research_sensitive: Boolean(x.research_sensitive),
          packaging_assertion: x.assertion,
        },
        `description_claims[${i}]`,
        t,
        e,
      );
    });
  if (
    /\b(?:company|revenue|grew|growth|increased|decreased|\d+(?:\.\d+)?%|\d+x|20\d{2})\b/i.test(
      v.description_draft || "",
    ) &&
    Array.isArray(v.description_claims) &&
    v.description_claims.length === 0
  )
    e.push("description_draft contains undeclared factual claim");
  for (const k of ["package_findings", "human_attention"])
    if (!Array.isArray(v[k])) e.push(`${k} must be array`);
  if (
    ![
      "PACKAGE_READY_FOR_REVIEW",
      "RETURN_TO_STORY",
      "RETURN_TO_RESEARCH",
      "NEEDS_HUMAN_DECISION",
    ].includes(v.recommendation)
  )
    e.push("recommendation invalid");
  return { ok: !e.length, errors: e, value: v };
}
function buildPrompt(t) {
  const schema = {
    viewer_promise: {
      statement: "text",
      curiosity_gap: "text",
      expected_payoff: "text",
      research_sensitive: false,
      research_binding_ids: [],
      required_constraint_ids: [],
    },
    title_candidates: [
      {
        text: "text",
        strategy: ap.TITLE_STRATEGIES.join("|"),
        promise: "text",
        tension: "text",
        packaging_assertion: null,
        research_sensitive: false,
        research_binding_ids: [],
        required_constraint_ids: [],
        risks: [],
        rationale: "text",
      },
    ],
    thumbnail_candidates: [
      {
        communication_goal: "text",
        primary_subject: "text",
        secondary_subject: null,
        hierarchy: "text",
        visual_tension: "text",
        optional_text: null,
        visual_assertion: null,
        title_relation: "text",
        presenter_need: ap.PRESENTER_NEEDS.join("|"),
        research_sensitive: false,
        research_binding_ids: [],
        required_constraint_ids: [],
        risks: [],
        rationale: "text",
      },
    ],
    pair_candidates: [
      {
        title_index: 0,
        thumbnail_index: 0,
        synergy: ap.SYNERGY_CLASSES.join("|"),
        duplication_risk: null,
        contradiction_risk: null,
        promise_alignment: "text",
        rationale: "text",
        recommendation_rank: 1,
        risks: [],
      },
    ],
    description_draft: "text <= 2000 chars",
    description_claims: [
      {
        assertion: "exact proposition",
        research_sensitive: false,
        research_binding_ids: [],
        required_constraint_ids: [],
      },
    ],
    package_findings: [],
    human_attention: [],
    recommendation:
      "PACKAGE_READY_FOR_REVIEW|RETURN_TO_STORY|RETURN_TO_RESEARCH|NEEDS_HUMAN_DECISION",
  };
  return [
    "Propose accurate packaging for this exact Story. Return JSON only. No IDs, approvals, selections, Story changes, prompts, Camera, Presenter execution, or infrastructure.",
    `Central claim: ${t.story.central_claim}`,
    `Narrative spine: ${t.story.narrative_spine || ""}`,
    `Sections: ${JSON.stringify(t.story.sections.map((s) => ({ section_id: s.section_id, text: s.dialogue || s.beat || "" })))}`,
    `Audience: ${JSON.stringify(t.audience)}`,
    `Research bindings: ${JSON.stringify((t.research?.bindings_doc?.bindings || []).map((b) => ({ binding_id: b.binding_id, assertion: b.assertion_text, constraints: bindingAuthority(t, b.binding_id)?.required_constraint_ids || [] })))}`,
    `Output schema: ${JSON.stringify(schema)}`,
    "Return 3-5 genuinely distinct titles, 2-4 thumbnail concepts, and at least one pair. Every factual proposition must declare exact binding IDs and constraints. Opinion/experience framing uses packaging_assertion/visual_assertion null and no Research refs.",
    "Without an exact Research binding, optional_text must contain no number and none of: best, only, always, never, guarantee, proven, official, newest, latest, fastest, instant, cheapest, first, everyone, nobody, free, dead.",
  ].join("\n");
}
function buildVerificationPrompt(t, s) {
  return [
    "INDEPENDENT PACKAGING VERIFIER. Do not rewrite candidates. Verify source compatibility, factual broadening, promise delivery, and pair relationship.",
    `Story: ${JSON.stringify({ central_claim: t.story.central_claim, sections: t.story.sections.map((x) => ({ section_id: x.section_id, text: x.dialogue || x.beat || "" })) })}`,
    `Packaging: ${JSON.stringify(s)}`,
    "Return exactly: {ok,promise:[{index,classification,reason}],description:[{index,classification,reason}],titles:[...],pairs:[...],description_claims:[...],human_attention:[]}. Verify the complete description draft separately so undeclared factual additions cannot hide outside description_claims. classification is VERIFIED,BROADENED,UNSUPPORTED,RETURN_TO_STORY,NEEDS_HUMAN_DECISION,DUPLICATIVE,CONTRADICTORY,DECEPTIVE_ASYMMETRY,UNRELATED. Every input item exactly once. ok only when promise/titles/complete description/declared description claims are VERIFIED and pairs are VERIFIED or DUPLICATIVE.",
  ].join("\n");
}
function validateVerificationOutput(raw, s) {
  let v;
  try {
    v =
      typeof raw === "string"
        ? JSON.parse(raw)
        : JSON.parse(JSON.stringify(raw));
  } catch {
    return { ok: false, errors: ["invalid verification JSON"] };
  }
  const e = [];
  unknown(
    v,
    new Set([
      "ok",
      "promise",
      "description",
      "titles",
      "pairs",
      "description_claims",
      "human_attention",
    ]),
    "verification",
    e,
  );
  const specs = [
      ["promise", 1],
      ["description", 1],
      ["titles", s.title_candidates.length],
      ["pairs", s.pair_candidates.length],
      ["description_claims", s.description_claims.length],
    ],
    allowed = new Set([
      "VERIFIED",
      "BROADENED",
      "UNSUPPORTED",
      "RETURN_TO_STORY",
      "NEEDS_HUMAN_DECISION",
      "DUPLICATIVE",
      "CONTRADICTORY",
      "DECEPTIVE_ASYMMETRY",
      "UNRELATED",
    ]);
  for (const [k, n] of specs) {
    if (!Array.isArray(v[k]) || v[k].length !== n)
      e.push(`${k}: exact coverage required`);
    else {
      const ids = new Set();
      v[k].forEach((x, i) => {
        unknown(
          x,
          new Set(["index", "classification", "reason"]),
          `${k}[${i}]`,
          e,
        );
        if (
          !Number.isInteger(x.index) ||
          x.index < 0 ||
          x.index >= n ||
          ids.has(x.index) ||
          !allowed.has(x.classification) ||
          !norm(x.reason)
        )
          e.push(`${k}[${i}]: invalid assessment`);
        ids.add(x.index);
      });
    }
  }
  if (!Array.isArray(v.human_attention) || typeof v.ok !== "boolean")
    e.push("verification metadata invalid");
  const actuallyOk =
    !e.length &&
    v.promise.every((x) => x.classification === "VERIFIED") &&
    v.description.every((x) => x.classification === "VERIFIED") &&
    v.titles.every((x) => x.classification === "VERIFIED") &&
    v.description_claims.every((x) => x.classification === "VERIFIED") &&
    v.pairs.every((x) =>
      ["VERIFIED", "DUPLICATIVE"].includes(x.classification),
    );
  return { ok: !e.length, value: { ...v, ok: actuallyOk }, errors: e };
}
function researchRef(t, id, constraints) {
  const b = bindingById(t, id),
    a = bindingAuthority(t, id),
    rr = b?.research_result_ref || currentRef(t, id);
  if (!b || !a || !rr) throw Error(`UNRESOLVED_RESEARCH_BINDING:${id}`);
  return {
    binding_id: id,
    claim_ref: b.claim_ref,
    research_result_ref: {
      result_id: rr.result_id,
      result_revision: rr.result_revision,
      result_digest_sha256: rr.result_digest_sha256,
    },
    assertion_text_sha256: b.assertion_text_sha256,
    required_constraint_ids: [...(constraints || [])],
    satisfied_constraint_ids: [...(constraints || [])],
    human_exception_ref: a.human_exception_ref || null,
  };
}
function refList(t, x) {
  return (x.research_binding_ids || []).map((id) =>
    researchRef(t, id, x.required_constraint_ids),
  );
}
function packagingFloor(t, s) {
  const episode = episodeModel.normalizeEpisode({
    topic: t.story.central_claim,
    workingTitle: s.title_candidates[0]?.text,
    titleOptions: s.title_candidates.map((x) => x.text).join("\n"),
    targetViewer: t.audience.target_viewer,
    viewerProblem: t.audience.viewer_problem,
    thumbnailConcept: s.thumbnail_candidates[0]?.communication_goal,
    corePromise: s.viewer_promise.statement,
    scriptOutline: t.story.sections
      .map((x) => x.dialogue || x.beat || "")
      .join("\n"),
    sourceNotes:
      "verify: independent packaging verification; canonical Research bindings required for factual claims",
    nextAction: "Mikko reviews package",
  });
  const r = episodeModel.buildPackagingReview(episode);
  return {
    ok: r.ok,
    warnings: r.warnings.map((x) => ({
      code: x.code,
      message: x.message,
      action: x.action,
    })),
  };
}
function writePackage(t, s, o = {}) {
  const id = o.newCandidateId || ap.newCandidateId,
    titles = s.title_candidates.map((x) => ({
      title_candidate_id: id(),
      text: x.text,
      strategy: x.strategy,
      promise: x.promise,
      tension: x.tension,
      packaging_assertion: x.packaging_assertion || null,
      research_sensitive: Boolean(x.research_sensitive),
      research_refs: refList(t, x),
      risks: [...(x.risks || [])],
      rationale: x.rationale,
    })),
    thumbs = s.thumbnail_candidates.map((x) => ({
      thumbnail_candidate_id: id(),
      communication_goal: x.communication_goal,
      primary_subject: x.primary_subject,
      secondary_subject: x.secondary_subject || null,
      hierarchy: x.hierarchy,
      visual_tension: x.visual_tension,
      optional_text: x.optional_text ?? null,
      visual_assertion: x.visual_assertion || null,
      title_relation: x.title_relation,
      presenter_need: x.presenter_need,
      research_sensitive: Boolean(x.research_sensitive),
      research_refs: refList(t, x),
      risks: [...(x.risks || [])],
      rationale: x.rationale,
    })),
    pairs = s.pair_candidates.map((x, index) => ({
      pair_candidate_id: id(),
      title_candidate_id: titles[x.title_index].title_candidate_id,
      thumbnail_candidate_id: thumbs[x.thumbnail_index].thumbnail_candidate_id,
      synergy:
        o.semanticVerification?.pairs?.[index]?.classification === "DUPLICATIVE"
          ? "DUPLICATIVE"
          : x.synergy,
      duplication_risk: x.duplication_risk ?? null,
      contradiction_risk: x.contradiction_risk ?? null,
      promise_alignment: x.promise_alignment || null,
      rationale: x.rationale,
      recommendation_rank: x.recommendation_rank,
      risks: [...(x.risks || [])],
    })),
    desc = s.description_claims.map((x) => ({
      assertion: x.assertion,
      assertion_sha256: ap.sha256(x.assertion),
      research_sensitive: Boolean(x.research_sensitive),
      research_refs: refList(t, x),
    }));
  const all = [
      ...refList(t, s.viewer_promise),
      ...titles.flatMap((x) => x.research_refs),
      ...thumbs.flatMap((x) => x.research_refs),
      ...desc.flatMap((x) => x.research_refs),
    ],
    uniq = [];
  for (const r of all)
    if (!uniq.some((x) => ap.canonicalize(x) === ap.canonicalize(r)))
      uniq.push(r);
  const p = {
    schema_version: 1,
    artifact_type: ap.ARTIFACT_TYPE,
    package_plan_id:
      o.existingPackage?.package_plan_id ||
      (o.newPackageId ? o.newPackageId() : ap.newPackageId()),
    package_revision: o.existingPackage
      ? o.existingPackage.package_revision + 1
      : 1,
    supersedes: o.existingPackage
      ? {
          package_plan_id: o.existingPackage.package_plan_id,
          package_revision: o.existingPackage.package_revision,
          package_digest_sha256: o.existingPackage.package_digest_sha256,
        }
      : null,
    created_at: o.now || nowIso(),
    created_by: AGENT_ID,
    state:
      t.story.approval_state === "approved"
        ? "AWAITING_HUMAN_REVIEW"
        : "PREVIEW_ONLY",
    phase: t.final_content_ref ? "FINAL" : "EARLY",
    source: {
      story_ref: {
        project_id: t.story.project_id,
        version_id: t.story.version_id,
        content_hash: t.story.content_hash,
        approval_state: t.story.approval_state,
      },
      final_content_ref: t.final_content_ref || null,
    },
    audience: {
      target_viewer: t.audience.target_viewer,
      viewer_problem: t.audience.viewer_problem,
    },
    viewer_promise: {
      statement: s.viewer_promise.statement,
      curiosity_gap: s.viewer_promise.curiosity_gap,
      expected_payoff: s.viewer_promise.expected_payoff,
      research_sensitive: Boolean(s.viewer_promise.research_sensitive),
      research_refs: refList(t, s.viewer_promise),
    },
    title_candidates: titles,
    thumbnail_candidates: thumbs,
    pair_candidates: pairs,
    description_draft: s.description_draft,
    description_claims: desc,
    research_refs: uniq,
    packaging_floor: o.packagingFloor,
    semantic_verification: o.semanticVerification,
    human_attention: [
      ...(s.human_attention || []),
      ...(o.semanticVerification?.human_attention || []),
    ],
    package_digest_sha256: "",
  };
  p.package_digest_sha256 = ap.packageDigest(p);
  return p;
}
function finish(b, state, reason, next) {
  b.state = state;
  b.reason = reason || null;
  b.owner = AGENT_ID;
  b.next_owner = next;
  b.attention = [
    "BLOCKED",
    "ESCALATED",
    "NEEDS_HUMAN_DECISION",
    "RETURN_TO_STORY",
    "RETURN_TO_RESEARCH",
    "STALE",
  ].includes(state)
    ? "DECISION"
    : state === "AWAITING_HUMAN_REVIEW"
      ? "REVIEW"
      : "INFORMATION";
  b.events.push({ at: nowIso(), state, reason: reason || null });
  return b;
}
async function run(t, o = {}) {
  const out = {
    agent_id: AGENT_ID,
    task_id: t?.task_id || null,
    action: t?.action || null,
    state: "PLANNING",
    attempts: 0,
    verification_attempts: 0,
    max_attempts: Math.min(
      t?.retry_budget || 2,
      t?.cost_budget?.max_model_calls || 3,
      3,
    ),
    route: null,
    audience_package: null,
    review_bundle: null,
    package_findings: [],
    events: [],
  };
  if (t?.action === "status") return finish(out, "COMPLETE", null, "hermes");
  const pre = preflight(t, o);
  if (pre.researchBlockers.length)
    return finish(
      out,
      "RETURN_TO_RESEARCH",
      pre.researchBlockers.join("; "),
      "research_director",
    );
  if (!pre.ok) return finish(out, "BLOCKED", pre.errors.join("; "), "hermes");
  if (t.action === "review_packaging") {
    const auth = ap.evaluatePackageAuthority(t.existing_package, {
      currentStory: {
        project_id: t.story.project_id,
        version_id: t.story.version_id,
        content_hash: t.story.content_hash,
        approval_state: t.story.approval_state,
      },
      researchAuthorityByBinding: t.research?.authority_by_binding || {},
      finalContentRefCheck: t.final_content_ref_check,
      approval: t.package_approval,
    });
    out.review_bundle = ap.buildReviewBundle(t.existing_package, auth);
    return finish(
      out,
      auth.state,
      auth.reasons.join("; ") || null,
      auth.state === "AWAITING_HUMAN_REVIEW"
        ? "mikko"
        : auth.state === "RETURN_TO_RESEARCH"
          ? "research_director"
          : auth.state === "RETURN_TO_STORY"
            ? "story_editor"
            : "hermes",
    );
  }
  const cap = routeCapability(t);
  if (!cap.ok)
    return finish(
      out,
      cap.code === "PRIVACY_LOCAL_ONLY" ? "BLOCKED" : "ESCALATED",
      cap.code,
      "hermes",
    );
  if (!cap.auto_dispatch)
    return finish(
      out,
      "ESCALATED",
      "FRONTIER_RECOMMENDED_NO_AUTO_DISPATCH",
      "mikko",
    );
  let route;
  try {
    route = selectComputeRoute(t, o);
  } catch (e) {
    return finish(
      out,
      "BLOCKED",
      `${e.code || "ROUTING_UNAVAILABLE"}: ${e.message}`,
      "hermes",
    );
  }
  out.route = { lane: route.lane, host: route.host, model: route.model };
  let sem,
    fail = [];
  for (let i = 1; i <= out.max_attempts; i++) {
    out.attempts = i;
    try {
      const raw = await invokeModel(buildPrompt(t), route, o);
      out.raw_response_sha256 = hash(
        typeof raw === "string" ? raw : JSON.stringify(raw),
      );
      const r = validateSemanticOutput(raw, t);
      if (r.ok) {
        sem = r.value;
        break;
      }
      fail = r.errors;
      if (
        fail.some((message) =>
          /absolute factual wording|unresolved Research binding|missing constraint|factual wording requires Research/.test(
            message,
          ),
        )
      )
        return finish(
          out,
          "RETURN_TO_RESEARCH",
          fail.join("; ").slice(0, 500),
          "research_director",
        );
    } catch (e) {
      fail = [e.message];
    }
  }
  if (!sem)
    return finish(
      out,
      "ESCALATED",
      `semantic retry exhausted: ${fail.join("; ").slice(0, 500)}`,
      "hermes",
    );
  out.package_findings = sem.package_findings;
  if (sem.recommendation === "RETURN_TO_RESEARCH")
    return finish(
      out,
      "RETURN_TO_RESEARCH",
      "semantic Research authority required",
      "research_director",
    );
  if (sem.recommendation === "RETURN_TO_STORY")
    return finish(
      out,
      "RETURN_TO_STORY",
      "packaged promise exceeds source",
      "story_editor",
    );
  if (
    sem.recommendation === "NEEDS_HUMAN_DECISION" ||
    sem.human_attention.includes("CREATIVE_DIRECTION_REQUIRED")
  )
    return finish(
      out,
      "NEEDS_HUMAN_DECISION",
      "CREATIVE_DIRECTION_REQUIRED",
      "mikko",
    );
  let verification,
    vfail = [];
  for (let i = 1; i <= out.max_attempts; i++) {
    out.verification_attempts = i;
    try {
      const adapter = o.verificationAdapter
        ? { ...o, modelAdapter: o.verificationAdapter }
        : o;
      const raw = await invokeModel(
        buildVerificationPrompt(t, sem),
        route,
        adapter,
      );
      out.verification_response_sha256 = hash(
        typeof raw === "string" ? raw : JSON.stringify(raw),
      );
      const r = validateVerificationOutput(raw, sem);
      if (r.ok) {
        verification = r.value;
        break;
      }
      vfail = r.errors;
    } catch (e) {
      vfail = [e.message];
    }
  }
  if (!verification)
    return finish(
      out,
      "ESCALATED",
      `verification retry exhausted: ${vfail.join("; ").slice(0, 500)}`,
      "hermes",
    );
  if (!verification.ok) {
    const cls = [
      ...verification.promise,
      ...verification.titles,
      ...verification.pairs,
      ...verification.description_claims,
    ].map((x) => x.classification);
    if (cls.some((x) => ["BROADENED", "UNSUPPORTED"].includes(x)))
      return finish(
        out,
        "RETURN_TO_RESEARCH",
        "independent packaging verification rejected factual scope",
        "research_director",
      );
    if (cls.includes("RETURN_TO_STORY"))
      return finish(
        out,
        "RETURN_TO_STORY",
        "viewer promise not delivered by Story",
        "story_editor",
      );
    return finish(
      out,
      "NEEDS_HUMAN_DECISION",
      "packaging verification requires human decision",
      "mikko",
    );
  }
  const current = o.reloadStory ? await o.reloadStory(t.story) : t.story;
  if (
    !current ||
    current.project_id !== t.story.project_id ||
    current.version_id !== t.story.version_id ||
    current.content_hash !== t.story.content_hash ||
    current.approval_state !== t.story.approval_state
  )
    return finish(out, "BLOCKED", "SOURCE_STORY_CHANGED", "story_editor");
  const floor = packagingFloor(t, sem);
  if (!floor.ok)
    return finish(
      out,
      "RETURN_TO_STORY",
      `PACKAGING_FLOOR: ${floor.warnings.map((x) => x.code).join(",")}`,
      "story_editor",
    );
  let pkg;
  try {
    pkg = writePackage(t, sem, {
      ...o,
      packagingFloor: floor,
      semanticVerification: verification,
    });
  } catch (e) {
    return finish(out, "RETURN_TO_RESEARCH", e.message, "research_director");
  }
  const context = {
    currentStory: {
      project_id: t.story.project_id,
      version_id: t.story.version_id,
      content_hash: t.story.content_hash,
      approval_state: t.story.approval_state,
    },
    researchAuthorityByBinding: t.research?.authority_by_binding || {},
  };
  const authority = ap.evaluatePackageAuthority(pkg, context);
  out.audience_package = pkg;
  out.authority = authority;
  out.review_bundle = ap.buildReviewBundle(pkg, authority);
  if (!authority.structurally_valid)
    return finish(
      out,
      authority.state,
      authority.reasons.join("; ").slice(0, 600),
      authority.state === "RETURN_TO_RESEARCH"
        ? "research_director"
        : "audience_packaging_director",
    );
  return finish(out, authority.state, null, "mikko");
}
function controlRoomView(o) {
  const p = o.audience_package,
    b = o.review_bundle,
    a = o.authority || b?.authority;
  return {
    role: "Audience & Packaging Director",
    action: o.action,
    state: o.state,
    story: p?.source?.story_ref || b?.source?.story_ref || null,
    package_plan_id: p?.package_plan_id || b?.package_plan_id || null,
    package_revision: p?.package_revision || b?.package_revision || null,
    package_digest:
      p?.package_digest_sha256 || b?.package_digest_sha256 || null,
    phase: p?.phase || b?.phase || null,
    final_content:
      p?.source?.final_content_ref || b?.source?.final_content_ref || null,
    audience: p?.audience || b?.audience || null,
    target_viewer:
      p?.audience?.target_viewer || b?.audience?.target_viewer || null,
    viewer_problem:
      p?.audience?.viewer_problem || b?.audience?.viewer_problem || null,
    viewer_promise: p?.viewer_promise || b?.viewer_promise || null,
    totals: b?.totals || null,
    top_recommendation: b?.top_recommendation || null,
    normalized_duplicate_findings: (a?.reasons || []).filter((x) =>
      /duplicate normalized/.test(x),
    ),
    research_blockers: (a?.reasons || []).filter((x) =>
      /Research|constraint/.test(x),
    ),
    packaging_floor: p?.packaging_floor || b?.packaging_floor || null,
    package_findings: (o.package_findings || []).map((finding, index) => ({ ref: `package-finding-${index + 1}`, summary: typeof finding === "string" ? finding : JSON.stringify(finding) })),
    operational_rationale: {
      decision: o.state,
      reason: o.reason || (o.attention === "REVIEW" ? "Audience package is ready for human review" : `Audience packaging state is ${o.state}`),
      evidence_refs: (o.package_findings || []).map((finding, index) => ({ ref: `package-finding-${index + 1}`, summary: typeof finding === "string" ? finding : JSON.stringify(finding) })),
      confidence: null,
      escalation_reason: ["REVIEW", "DECISION"].includes(o.attention) ? o.reason : null,
    },
    promise_verified: a?.promise_verified ?? null,
    pair_verified: a?.pair_verified ?? null,
    vpd_handoff_ready: Boolean(a?.structurally_valid),
    package_approval_valid: a?.approval_valid ?? false,
    publish_gate_ready_for_human: a?.publish_gate_ready_for_human ?? false,
    authorization_ok: a?.authorization_ok ?? false,
    owner: o.owner,
    next_owner: o.next_owner,
    blocker: o.reason,
    attention: o.attention,
    latest_event: o.events.at(-1) || null,
  };
}
module.exports = {
  AGENT_ID,
  LANE,
  ACTIONS,
  STATES,
  MAX_ATTEMPTS,
  routeCapability,
  selectComputeRoute,
  invokeModel,
  preflight,
  validateSemanticOutput,
  buildPrompt,
  buildVerificationPrompt,
  validateVerificationOutput,
  packagingFloor,
  writePackage,
  run,
  controlRoomView,
};
if (require.main === module)
  (async () => {
    const i = process.argv.indexOf("--task");
    if (i < 0) process.exit(2);
    const out = await run(
      JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8")),
    );
    console.log(
      JSON.stringify({ ...out, control_room: controlRoomView(out) }, null, 2),
    );
    process.exit(
      ["COMPLETE", "AWAITING_HUMAN_REVIEW", "PREVIEW_ONLY"].includes(out.state)
        ? 0
        : 1,
    );
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
