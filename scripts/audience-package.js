"use strict";
const crypto = require("node:crypto");
const SCHEMA_VERSION = 1,
  ARTIFACT_TYPE = "audience-package";
const PACKAGE_STATES = Object.freeze([
  "PREVIEW_ONLY",
  "AWAITING_HUMAN_REVIEW",
  "RETURN_TO_STORY",
  "RETURN_TO_RESEARCH",
  "NEEDS_HUMAN_DECISION",
  "STALE",
]);
const TITLE_STRATEGIES = Object.freeze([
  "DIRECT_CLAIM",
  "TENSION_QUESTION",
  "CONTRAST_FRAME",
  "SPECIFIC_NUMBER",
  "MISTAKE_FRAME",
  "REVELATION",
]);
const SYNERGY_CLASSES = Object.freeze([
  "STRONG_PAIR",
  "COMPLEMENTARY",
  "DUPLICATIVE",
  "CONTRADICTORY",
  "DECEPTIVE_ASYMMETRY",
  "UNRELATED",
]);
const PRESENTER_NEEDS = Object.freeze([
  "NONE",
  "FACE_OPTIONAL",
  "FACE_REQUIRED",
  "EXPRESSION_REQUIRED",
]);
const ABSOLUTE_WORD_RE =
  /\b(best|only|always|never|guarantee|guaranteed|proven|official|newest|latest|fastest|instant|cheapest|first|everyone|nobody|free|dead)\b/i;
const THUMBNAIL_TEXT_MAX_CHARS = 24,
  ID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/,
  SHA_RE = /^[a-f0-9]{64}$/;
const SET = (...v) => new Set(v);
const F = {
  root: SET(
    "schema_version",
    "artifact_type",
    "package_plan_id",
    "package_revision",
    "supersedes",
    "created_at",
    "created_by",
    "state",
    "phase",
    "source",
    "audience",
    "viewer_promise",
    "title_candidates",
    "thumbnail_candidates",
    "pair_candidates",
    "description_draft",
    "description_claims",
    "research_refs",
    "packaging_floor",
    "semantic_verification",
    "human_attention",
    "package_digest_sha256",
  ),
  source: SET("story_ref", "final_content_ref"),
  story: SET("project_id", "version_id", "content_hash", "approval_state"),
  final: SET("artifact_id", "digest_sha256"),
  audience: SET("target_viewer", "viewer_problem"),
  promise: SET(
    "statement",
    "curiosity_gap",
    "expected_payoff",
    "research_sensitive",
    "research_refs",
  ),
  title: SET(
    "title_candidate_id",
    "text",
    "strategy",
    "promise",
    "tension",
    "packaging_assertion",
    "research_sensitive",
    "research_refs",
    "risks",
    "rationale",
  ),
  thumb: SET(
    "thumbnail_candidate_id",
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
    "research_refs",
    "risks",
    "rationale",
  ),
  pair: SET(
    "pair_candidate_id",
    "title_candidate_id",
    "thumbnail_candidate_id",
    "synergy",
    "duplication_risk",
    "contradiction_risk",
    "promise_alignment",
    "rationale",
    "recommendation_rank",
    "risks",
  ),
  ref: SET(
    "binding_id",
    "claim_ref",
    "research_result_ref",
    "assertion_text_sha256",
    "required_constraint_ids",
    "satisfied_constraint_ids",
    "human_exception_ref",
  ),
  claim: SET("namespace", "canonical_id", "revision"),
  result: SET("result_id", "result_revision", "result_digest_sha256"),
  desc: SET(
    "assertion",
    "assertion_sha256",
    "research_sensitive",
    "research_refs",
  ),
  supersedes: SET(
    "package_plan_id",
    "package_revision",
    "package_digest_sha256",
  ),
  floor: SET("ok", "warnings"),
  warning: SET("code", "message", "action"),
  verify: SET(
    "ok",
    "promise",
    "description",
    "titles",
    "pairs",
    "description_claims",
    "human_attention",
  ),
  verifyItem: SET("index", "classification", "reason"),
  approval: SET(
    "artifact_type",
    "package_plan_id",
    "package_revision",
    "package_digest_sha256",
    "story_ref",
    "final_content_ref",
    "title_candidate_id",
    "thumbnail_candidate_id",
    "pair_candidate_id",
    "approver",
    "approved_at",
    "scope",
    "created_by",
  ),
};
const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v), "utf8").digest("hex");
function ulid(now = Date.now()) {
  const a = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let t = now,
    o = "";
  for (let i = 0; i < 10; i++) {
    o = a[t % 32] + o;
    t = Math.floor(t / 32);
  }
  for (const b of crypto.randomBytes(16)) o += a[b % 32];
  return o;
}
function canonicalize(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`)
    .join(",")}}`;
}
function packageDigest(p) {
  const c = { ...p };
  delete c.package_digest_sha256;
  return sha256(canonicalize(c));
}
const normalizeTitle = (v) =>
  String(v || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
function exact(v, allowed, w, e) {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    e.push(`${w} must be object`);
    return;
  }
  for (const k of Object.keys(v))
    if (!allowed.has(k)) e.push(`${w}.${k}: unknown field`);
}
const sameStory = (a, b) =>
  Boolean(
    a &&
    b &&
    a.project_id === b.project_id &&
    a.version_id === b.version_id &&
    a.content_hash === b.content_hash &&
    a.approval_state === b.approval_state,
  );
function refsOf(p) {
  return [
    ...(p.viewer_promise?.research_refs || []),
    ...(p.title_candidates || []).flatMap((x) => x.research_refs || []),
    ...(p.thumbnail_candidates || []).flatMap((x) => x.research_refs || []),
    ...(p.description_claims || []).flatMap((x) => x.research_refs || []),
  ];
}
function validateRef(r, w, o, e) {
  exact(r, F.ref, w, e);
  exact(r?.claim_ref, F.claim, `${w}.claim_ref`, e);
  exact(r?.research_result_ref, F.result, `${w}.research_result_ref`, e);
  const rr = r?.research_result_ref || {};
  if (
    !r?.binding_id ||
    !r.claim_ref?.canonical_id ||
    !Number.isInteger(r.claim_ref?.revision) ||
    !rr.result_id ||
    !Number.isInteger(rr.result_revision) ||
    !SHA_RE.test(rr.result_digest_sha256 || "") ||
    !SHA_RE.test(r?.assertion_text_sha256 || "")
  )
    e.push(`${w}: canonical Research identity incomplete`);
  if (
    !Array.isArray(r?.required_constraint_ids) ||
    !Array.isArray(r?.satisfied_constraint_ids)
  )
    e.push(`${w}: constraint arrays required`);
  const a = o.researchAuthorityByBinding?.[r?.binding_id];
  if (!a) {
    e.push(`${w}: unresolved Research authority ${r?.binding_id || "?"}`);
    return;
  }
  if (a.result_state !== "VALID")
    e.push(`${w}: Research state ${a.result_state || "INVALID"}`);
  if (
    ["RESEARCH_MORE", "DO_NOT_USE"].includes(a.recommendation) ||
    a.authorization_ok !== true
  )
    e.push(
      `${w}: Research unauthorized (${a.recommendation || "UNAUTHORIZED"})`,
    );
  if (
    a.result_id !== rr.result_id ||
    a.result_revision !== rr.result_revision ||
    a.result_digest_sha256 !== rr.result_digest_sha256
  )
    e.push(`${w}: Research Result identity/digest mismatch`);
  if (canonicalize(a.claim_ref) !== canonicalize(r.claim_ref))
    e.push(`${w}: canonical claim mismatch`);
  if (a.assertion_text_sha256 !== r.assertion_text_sha256)
    e.push(`${w}: assertion identity mismatch`);
  const required = a.required_constraint_ids || [];
  const absent = required.filter(
    (id) =>
      !(r.required_constraint_ids || []).includes(id) ||
      !(r.satisfied_constraint_ids || []).includes(id),
  );
  if (absent.length)
    e.push(`${w}: canonical constraints omitted ${absent.join(",")}`);
  const ownMissing = (r.required_constraint_ids || []).filter(
    (id) => !(r.satisfied_constraint_ids || []).includes(id),
  );
  if (ownMissing.length)
    e.push(`${w}: unsatisfied constraints ${ownMissing.join(",")}`);
  if (
    a.human_exception_ref &&
    canonicalize(a.human_exception_ref) !== canonicalize(r.human_exception_ref)
  )
    e.push(`${w}: human exception scope mismatch`);
}
function validatePackage(p, o = {}) {
  const e = [];
  let stale = false;
  if (!p || typeof p !== "object" || Array.isArray(p))
    return { ok: false, stale: false, errors: ["package is not object"] };
  exact(p, F.root, "$", e);
  if (p.schema_version !== 1) e.push("schema_version invalid");
  if (p.artifact_type !== ARTIFACT_TYPE) e.push("artifact_type invalid");
  if (!ID_RE.test(p.package_plan_id || "")) e.push("package_plan_id malformed");
  if (!Number.isInteger(p.package_revision) || p.package_revision < 1)
    e.push("package_revision invalid");
  if (!p.created_at || Number.isNaN(Date.parse(p.created_at)) || !p.created_by)
    e.push("creation metadata invalid");
  if (!PACKAGE_STATES.includes(p.state)) e.push("state invalid");
  if (!["EARLY", "FINAL"].includes(p.phase)) e.push("phase invalid");
  if (!SHA_RE.test(p.package_digest_sha256 || ""))
    e.push("package_digest_sha256 required");
  else if (packageDigest(p) !== p.package_digest_sha256)
    e.push("PACKAGE_DIGEST_MISMATCH");
  if (p.supersedes != null) {
    exact(p.supersedes, F.supersedes, "$.supersedes", e);
    if (
      !ID_RE.test(p.supersedes?.package_plan_id || "") ||
      !Number.isInteger(p.supersedes?.package_revision) ||
      !SHA_RE.test(p.supersedes?.package_digest_sha256 || "")
    )
      e.push("supersedes incomplete");
  }
  exact(p.source, F.source, "$.source", e);
  const s = p.source?.story_ref || {};
  exact(s, F.story, "$.source.story_ref", e);
  if (
    !s.project_id ||
    !s.version_id ||
    !SHA_RE.test(s.content_hash || "") ||
    !["draft", "approved"].includes(s.approval_state)
  )
    e.push("source.story_ref incomplete");
  if (p.source?.final_content_ref != null) {
    exact(p.source.final_content_ref, F.final, "$.source.final_content_ref", e);
    if (
      !p.source.final_content_ref.artifact_id ||
      !SHA_RE.test(p.source.final_content_ref.digest_sha256 || "")
    )
      e.push("final_content_ref incomplete");
  }
  if (p.phase === "FINAL" && !p.source?.final_content_ref)
    e.push("FINAL package requires final_content_ref");
  const max =
    s.approval_state === "approved" ? "AWAITING_HUMAN_REVIEW" : "PREVIEW_ONLY";
  if (
    ![
      max,
      "RETURN_TO_STORY",
      "RETURN_TO_RESEARCH",
      "NEEDS_HUMAN_DECISION",
      "STALE",
    ].includes(p.state)
  )
    e.push(`state exceeds source authority; maximum ${max}`);
  exact(p.audience, F.audience, "$.audience", e);
  if (
    !String(p.audience?.target_viewer || "").trim() ||
    !String(p.audience?.viewer_problem || "").trim()
  )
    e.push("audience incomplete");
  exact(p.viewer_promise, F.promise, "$.viewer_promise", e);
  for (const k of ["statement", "curiosity_gap", "expected_payoff"])
    if (!String(p.viewer_promise?.[k] || "").trim())
      e.push(`viewer_promise.${k} required`);
  if (
    p.viewer_promise?.research_sensitive &&
    !(p.viewer_promise.research_refs || []).length
  )
    e.push("viewer_promise Research refs required");
  const titles = Array.isArray(p.title_candidates) ? p.title_candidates : [],
    tids = new Set(),
    texts = new Set();
  if (titles.length < 3) e.push("at least 3 title_candidates required");
  titles.forEach((t, i) => {
    const w = `$.title_candidates[${i}]`;
    exact(t, F.title, w, e);
    if (
      !ID_RE.test(t.title_candidate_id || "") ||
      tids.has(t.title_candidate_id)
    )
      e.push(`${w}: invalid/duplicate ID`);
    tids.add(t.title_candidate_id);
    const n = normalizeTitle(t.text);
    if (!n || texts.has(n)) e.push(`${w}: empty/duplicate normalized title`);
    texts.add(n);
    if (
      String(t.text || "").length > 100 ||
      !TITLE_STRATEGIES.includes(t.strategy)
    )
      e.push(`${w}: text/strategy invalid`);
    for (const k of ["promise", "tension", "rationale"])
      if (!String(t[k] || "").trim()) e.push(`${w}.${k} required`);
    if (
      t.research_sensitive &&
      (!String(t.packaging_assertion || "").trim() ||
        !(t.research_refs || []).length)
    )
      e.push(`${w}: factual assertion/Research refs required`);
  });
  const thumbs = Array.isArray(p.thumbnail_candidates)
      ? p.thumbnail_candidates
      : [],
    cids = new Set();
  if (thumbs.length < 2) e.push("at least 2 thumbnail_candidates required");
  thumbs.forEach((t, i) => {
    const w = `$.thumbnail_candidates[${i}]`;
    exact(t, F.thumb, w, e);
    if (
      !ID_RE.test(t.thumbnail_candidate_id || "") ||
      cids.has(t.thumbnail_candidate_id)
    )
      e.push(`${w}: invalid/duplicate ID`);
    cids.add(t.thumbnail_candidate_id);
    for (const k of [
      "communication_goal",
      "primary_subject",
      "hierarchy",
      "visual_tension",
      "title_relation",
      "rationale",
    ])
      if (!String(t[k] || "").trim()) e.push(`${w}.${k} required`);
    if (!PRESENTER_NEEDS.includes(t.presenter_need))
      e.push(`${w}.presenter_need invalid`);
    if (
      t.optional_text != null &&
      (typeof t.optional_text !== "string" || t.optional_text.length > 24)
    )
      e.push(`${w}.optional_text invalid`);
    if (
      t.research_sensitive &&
      (!String(t.visual_assertion || "").trim() ||
        !(t.research_refs || []).length)
    )
      e.push(`${w}: factual assertion/Research refs required`);
  });
  const pairs = Array.isArray(p.pair_candidates) ? p.pair_candidates : [],
    pids = new Set(),
    ranks = new Set();
  if (!pairs.length) e.push("pair_candidates required");
  pairs.forEach((x, i) => {
    const w = `$.pair_candidates[${i}]`;
    exact(x, F.pair, w, e);
    if (!ID_RE.test(x.pair_candidate_id || "") || pids.has(x.pair_candidate_id))
      e.push(`${w}: invalid/duplicate ID`);
    pids.add(x.pair_candidate_id);
    if (!tids.has(x.title_candidate_id) || !cids.has(x.thumbnail_candidate_id))
      e.push(`${w}: unknown candidate ref`);
    if (!SYNERGY_CLASSES.includes(x.synergy)) e.push(`${w}.synergy invalid`);
    if (
      !Number.isInteger(x.recommendation_rank) ||
      ranks.has(x.recommendation_rank)
    )
      e.push(`${w}.rank invalid/duplicate`);
    ranks.add(x.recommendation_rank);
  });
  for (const x of pairs) {
    const t = titles.find((y) => y.title_candidate_id === x.title_candidate_id),
      c = thumbs.find(
        (y) => y.thumbnail_candidate_id === x.thumbnail_candidate_id,
      );
    if (
      normalizeTitle(t?.text) &&
      normalizeTitle(t?.text) === normalizeTitle(c?.optional_text) &&
      x.synergy !== "DUPLICATIVE"
    )
      e.push(
        `pair ${x.pair_candidate_id}: normalized title/thumbnail duplication must be DUPLICATIVE`,
      );
  }
  if (
    p.description_draft != null &&
    (typeof p.description_draft !== "string" ||
      p.description_draft.length > 2000)
  )
    e.push("description_draft invalid");
  if (!Array.isArray(p.description_claims))
    e.push("description_claims required");
  for (const [i, c] of (p.description_claims || []).entries()) {
    const w = `$.description_claims[${i}]`;
    exact(c, F.desc, w, e);
    if (
      !String(c.assertion || "").trim() ||
      sha256(c.assertion) !== c.assertion_sha256
    )
      e.push(`${w}: exact assertion identity required`);
    if (c.research_sensitive && !(c.research_refs || []).length)
      e.push(`${w}: factual assertion requires Research refs`);
  }
  if (!Array.isArray(p.research_refs)) e.push("research_refs required");
  refsOf(p).forEach((r, i) => validateRef(r, `research_ref[${i}]`, o, e));
  exact(p.packaging_floor, F.floor, "$.packaging_floor", e);
  if (
    typeof p.packaging_floor?.ok !== "boolean" ||
    !Array.isArray(p.packaging_floor?.warnings)
  )
    e.push("packaging_floor invalid");
  (p.packaging_floor?.warnings || []).forEach((w, i) =>
    exact(w, F.warning, `$.packaging_floor.warnings[${i}]`, e),
  );
  exact(p.semantic_verification, F.verify, "$.semantic_verification", e);
  if (p.semantic_verification?.ok !== true)
    e.push("semantic verification not passed");
  for (const k of [
    "promise",
    "description",
    "titles",
    "pairs",
    "description_claims",
  ]) {
    const a = p.semantic_verification?.[k];
    if (!Array.isArray(a)) e.push(`semantic_verification.${k} required`);
    else
      a.forEach((x, i) =>
        exact(x, F.verifyItem, `$.semantic_verification.${k}[${i}]`, e),
      );
  }
  if (
    p.semantic_verification?.promise?.some(
      (x) => x.classification !== "VERIFIED",
    ) ||
    p.semantic_verification?.description?.some(
      (x) => x.classification !== "VERIFIED",
    ) ||
    p.semantic_verification?.titles?.some(
      (x) => x.classification !== "VERIFIED",
    ) ||
    p.semantic_verification?.description_claims?.some(
      (x) => x.classification !== "VERIFIED",
    )
  )
    e.push("promise/title/description verification failed");
  if (
    p.semantic_verification?.pairs?.some(
      (x) => !["VERIFIED", "DUPLICATIVE"].includes(x.classification),
    )
  )
    e.push("pair verification failed");
  if (!Array.isArray(p.human_attention)) e.push("human_attention required");
  if (o.currentStory && !sameStory(s, o.currentStory)) {
    e.push("SOURCE_STORY_CHANGED");
    stale = true;
  }
  if (
    o.finalContentRefCheck &&
    p.source?.final_content_ref &&
    canonicalize(o.finalContentRefCheck) !==
      canonicalize(p.source.final_content_ref)
  ) {
    e.push("FINAL_CONTENT_CHANGED");
    stale = true;
  }
  return { ok: e.length === 0, stale, errors: e };
}
function validateSuccessorPackage(a, b, o = {}) {
  const e = [];
  if (b.package_plan_id !== a.package_plan_id)
    e.push("package_plan_id mismatch");
  if (b.package_revision !== a.package_revision + 1)
    e.push("revision must increment by 1");
  const x = {
    package_plan_id: a.package_plan_id,
    package_revision: a.package_revision,
    package_digest_sha256: a.package_digest_sha256,
  };
  if (canonicalize(b.supersedes) !== canonicalize(x))
    e.push("supersedes mismatch");
  const v = validatePackage(b, o);
  e.push(...v.errors);
  return { ok: e.length === 0, errors: e };
}
function verifyPackageApprovalBinding(p, a, c = {}) {
  const e = [];
  exact(a, F.approval, "$approval", e);
  if (
    a?.artifact_type !== "audience-package-approval" ||
    a?.created_by === "audience_packaging_director" ||
    !a?.approver ||
    !a?.approved_at ||
    Number.isNaN(Date.parse(a?.approved_at)) ||
    a?.scope !== "TITLE_THUMBNAIL_APPROVAL"
  )
    e.push("approval metadata invalid");
  for (const k of [
    "package_plan_id",
    "package_revision",
    "package_digest_sha256",
  ])
    if (a?.[k] !== p?.[k]) e.push(`approval ${k} mismatch`);
  if (canonicalize(a?.story_ref) !== canonicalize(p?.source?.story_ref))
    e.push("approval Story mismatch");
  if (
    canonicalize(a?.final_content_ref || null) !==
    canonicalize(p?.source?.final_content_ref || null)
  )
    e.push("approval final-content mismatch");
  const pair = (p?.pair_candidates || []).find(
    (x) => x.pair_candidate_id === a?.pair_candidate_id,
  );
  if (
    !pair ||
    pair.title_candidate_id !== a?.title_candidate_id ||
    pair.thumbnail_candidate_id !== a?.thumbnail_candidate_id
  )
    e.push("approval selection mismatch");
  if (c.requireFinal && !p?.source?.final_content_ref)
    e.push("final content required");
  return { ok: e.length === 0, errors: e };
}
function evaluatePackageAuthority(p, c = {}) {
  const v = validatePackage(p, c),
    preview = p?.source?.story_ref?.approval_state !== "approved",
    floorPass = p?.packaging_floor?.ok === true,
    approval = c.approval
      ? verifyPackageApprovalBinding(p, c.approval, {
          requireFinal: c.requireFinalApproval,
        })
      : { ok: false, errors: ["human package approval absent"] },
    reasons = [
      ...v.errors,
      ...approval.errors,
      ...(floorPass ? [] : ["packaging floor not passed"]),
    ];
  const state = reasons.includes("FINAL_CONTENT_CHANGED")
    ? "RETURN_TO_STORY"
    : v.stale
      ? "STALE"
      : preview
        ? "PREVIEW_ONLY"
        : v.ok && floorPass
          ? "AWAITING_HUMAN_REVIEW"
          : reasons.some((x) => /Research|constraint/.test(x))
            ? "RETURN_TO_RESEARCH"
            : reasons.some((x) => /promise|Story|FINAL_CONTENT/.test(x))
              ? "RETURN_TO_STORY"
              : "BLOCKED";
  return {
    structurally_valid: v.ok,
    source_current: !v.stale,
    preview_only: preview,
    story_authorized: !preview,
    final_content_current: !reasons.includes("FINAL_CONTENT_CHANGED"),
    research_authorized: !reasons.some((x) => /Research|constraint/.test(x)),
    packaging_floor_pass: floorPass,
    promise_verified:
      p?.semantic_verification?.promise?.every(
        (x) => x.classification === "VERIFIED",
      ) === true,
    pair_verified:
      p?.semantic_verification?.pairs?.every((x) =>
        ["VERIFIED", "DUPLICATIVE"].includes(x.classification),
      ) === true,
    approval_valid: approval.ok,
    publish_gate_ready_for_human:
      v.ok && floorPass && !preview && Boolean(p?.source?.final_content_ref),
    authorization_ok: v.ok && floorPass && !preview,
    state,
    reasons: [...new Set(reasons)],
  };
}
function buildVisualPlanningHandoff(p, id, c = {}) {
  const t = (p.thumbnail_candidates || []).find(
    (x) => x.thumbnail_candidate_id === id,
  );
  if (!t) throw Error("thumbnail candidate not found");
  const pair = (p.pair_candidates || []).find(
      (x) => x.thumbnail_candidate_id === id,
    ),
    title =
      pair &&
      (p.title_candidates || []).find(
        (x) => x.title_candidate_id === pair.title_candidate_id,
      );
  return {
    artifact_type: "audience-package-vpd-handoff",
    package_ref: {
      package_plan_id: p.package_plan_id,
      package_revision: p.package_revision,
      package_digest_sha256: p.package_digest_sha256,
    },
    thumbnail_candidate_id: id,
    communication_goal: t.communication_goal,
    primary_subject: t.primary_subject,
    secondary_subject: t.secondary_subject,
    hierarchy: t.hierarchy,
    title_relation: t.title_relation,
    title_text: title?.text || null,
    optional_text_overlay: t.optional_text,
    presenter_requirement: t.presenter_need,
    research_refs: t.research_refs,
    aspect: c.aspect || null,
  };
}
function buildReviewBundle(p, a = {}) {
  const topPair = [...(p.pair_candidates || [])].sort(
    (x, y) => x.recommendation_rank - y.recommendation_rank,
  )[0];
  return {
    artifact_type: ARTIFACT_TYPE,
    package_plan_id: p.package_plan_id,
    package_revision: p.package_revision,
    package_digest_sha256: p.package_digest_sha256,
    state: a.state || p.state,
    phase: p.phase,
    source: p.source,
    audience: p.audience,
    viewer_promise: p.viewer_promise,
    totals: {
      titles: p.title_candidates?.length || 0,
      thumbnails: p.thumbnail_candidates?.length || 0,
      pairs: p.pair_candidates?.length || 0,
      research_sensitive_titles: (p.title_candidates || []).filter(
        (x) => x.research_sensitive,
      ).length,
      research_sensitive_thumbnails: (p.thumbnail_candidates || []).filter(
        (x) => x.research_sensitive,
      ).length,
    },
    top_recommendation: topPair
      ? {
          pair_candidate_id: topPair.pair_candidate_id,
          synergy: topPair.synergy,
          rank: topPair.recommendation_rank,
          title: p.title_candidates.find(
            (x) => x.title_candidate_id === topPair.title_candidate_id,
          )?.text,
          thumbnail_goal: p.thumbnail_candidates.find(
            (x) => x.thumbnail_candidate_id === topPair.thumbnail_candidate_id,
          )?.communication_goal,
          rationale: topPair.rationale,
        }
      : null,
    packaging_floor: p.packaging_floor,
    semantic_verification: p.semantic_verification,
    authority: a,
    human_attention: {
      items: p.human_attention || [],
      note: "Ranking is advisory. Mikko selects; publish-gate records publication authority.",
    },
    description_draft: p.description_draft,
  };
}
const renderMarkdown = (b) =>
  `# Audience Package Review — ${b.package_plan_id} (rev ${b.package_revision})\n\n- State: ${b.state}\n- Digest: ${b.package_digest_sha256}\n- Promise: ${b.viewer_promise?.statement || "?"}\n\n_Ranking is advisory. Final selection: Mikko._`;
module.exports = {
  SCHEMA_VERSION,
  ARTIFACT_TYPE,
  PACKAGE_STATES,
  TITLE_STRATEGIES,
  SYNERGY_CLASSES,
  PRESENTER_NEEDS,
  ABSOLUTE_WORD_RE,
  THUMBNAIL_TEXT_MAX_CHARS,
  sha256,
  ulid,
  canonicalize,
  packageDigest,
  normalizeTitle,
  validatePackage,
  validateSuccessorPackage,
  verifyPackageApprovalBinding,
  evaluatePackageAuthority,
  buildVisualPlanningHandoff,
  buildReviewBundle,
  renderMarkdown,
  newPackageId: () => ulid(),
  newCandidateId: () => ulid(),
};
