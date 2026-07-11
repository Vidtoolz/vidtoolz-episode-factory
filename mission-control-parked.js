/*
  Mission Control — data-derived "Parked" and "Approved Ideas" sections.

  Purpose
  -------
  Replaces the previously HARD-CODED Parked/Approved cards (which described
  purged package-runs and never changed) with cards derived from authoritative,
  read-only sources. See reports/state-derived-parked-cards-2026-07-10.md.

  Authoritative sources (read-only, no new endpoints)
  ---------------------------------------------------
  - Parked runs:   GET /api/package-runs/list  (package-runs-index.json,
                   regenerated from each run's package-run-state.md).
                   A run is PARKED only when its explicit lifecycle marker is
                   packageRunState.state === "parked". It is NEVER inferred from
                   inactivity, age, git state, a missing next action, or a
                   handoff document. Note: "inactive" also covers "superseded",
                   which is NOT parked and is excluded here.
  - Approved ideas: GET mission-control/approved-ideas.md, which declares itself
                   the single source of truth for this section.

  Read-only guarantees
  --------------------
  This module only issues GET requests and only reads the DOM roots it owns. It
  never mutates project state, never posts, and never fabricates a card when a
  source is empty or unreachable — it renders honest empty/unavailable/stale
  states instead. All source text is inserted via textContent / createTextNode
  (never innerHTML), so a hostile title/reason cannot inject markup.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.MissionControlParked = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PARKED_STATE = "parked";
  const RUN_LIST_ENDPOINT = "/api/package-runs/list";
  const APPROVED_IDEAS_ENDPOINT = "mission-control/approved-ideas.md";
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  const IDEA_FIELD_LABELS = ["Scored", "Score", "Pattern", "One-line", "Risk flags", "Next step"];

  // ── Pure classification ────────────────────────────────────────────────────

  // A run counts as parked ONLY with an explicit, validated "parked" lifecycle
  // marker and a stable id. Everything else (active, superseded, archived,
  // blocked, unknown, missing state) is excluded.
  function isParkedRun(run) {
    if (!run || typeof run !== "object") return false;
    if (typeof run.runId !== "string" || run.runId.trim() === "") return false;
    const prs = run.packageRunState;
    if (!prs || typeof prs !== "object") return false;
    if (typeof prs.state !== "string") return false;
    return prs.state.trim().toLowerCase() === PARKED_STATE;
  }

  // Select parked runs from a /api/package-runs/list payload. Skips malformed
  // entries (counted, not fatal), deduplicates by stable runId, and orders
  // deterministically (newest runId first).
  function selectParkedRuns(indexData) {
    const runs = indexData && Array.isArray(indexData.runs) ? indexData.runs : [];
    const seen = new Set();
    const parked = [];
    let malformed = 0;
    for (const run of runs) {
      if (!run || typeof run !== "object") {
        malformed += 1;
        continue;
      }
      if (!isParkedRun(run)) continue;
      if (seen.has(run.runId)) continue;
      seen.add(run.runId);
      parked.push(run);
    }
    parked.sort((a, b) => String(b.runId).localeCompare(String(a.runId)));
    return { parked, malformed };
  }

  function dateFromRunId(runId) {
    const match = String(runId || "").match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  }

  // Freshness is derived from the index's own generated-at timestamp, never a
  // UI clock guess. Returns "current" | "stale" | "unknown".
  function freshness(indexData, nowMs) {
    const generatedAt =
      indexData && typeof indexData.generatedAt === "string" ? indexData.generatedAt.trim() : "";
    if (!generatedAt) return { state: "unknown", generatedAt: "" };
    const parsed = Date.parse(generatedAt);
    if (Number.isNaN(parsed)) return { state: "unknown", generatedAt };
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    const ageMs = now - parsed;
    return { state: ageMs > STALE_AFTER_MS ? "stale" : "current", generatedAt, ageMs };
  }

  // ── Approved-ideas parsing (single source of truth: approved-ideas.md) ──────

  function stripHtmlComments(markdown) {
    return String(markdown || "").replace(/<!--[\s\S]*?-->/g, "");
  }

  function parseIdeaFields(body) {
    const fields = {};
    for (const label of IDEA_FIELD_LABELS) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\*\\*${escaped}:\\*\\*\\s*(.+?)\\s*$`, "im");
      const m = body.match(re);
      if (m && m[1].trim()) fields[label] = m[1].trim();
    }
    return fields;
  }

  // Parse "## <Working Title>" sections into idea entries. Non-idea sections
  // (Status:, Legend) and the commented-out template are ignored. A section is
  // only an idea if it carries at least one recognized field marker.
  function parseApprovedIdeas(markdown) {
    const text = stripHtmlComments(markdown);
    const ideas = [];
    let malformed = 0;
    const parts = text.split(/^##\s+/m).slice(1);
    for (const part of parts) {
      const newline = part.indexOf("\n");
      const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
      const body = newline === -1 ? "" : part.slice(newline + 1);
      if (!heading) {
        malformed += 1;
        continue;
      }
      if (/^(status\b|legend\b)/i.test(heading)) continue;
      const fields = parseIdeaFields(body);
      if (Object.keys(fields).length === 0) continue; // prose section, not an idea
      ideas.push({ title: heading, fields });
    }
    return { ideas, malformed };
  }

  // ── DOM helpers (doc is injectable for tests) ───────────────────────────────

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function noteParagraph(doc, text, tone) {
    const p = el(doc, "p", null, text);
    const color = tone === "warn" ? "var(--warn, #f2b84b)" : "var(--muted)";
    p.setAttribute("style", `color:${color};font-size:12px;padding:12px 0;margin:0;`);
    return p;
  }

  function placeholderThumb(doc, lines) {
    const thumb = el(doc, "div", "mc-thumb");
    const inner = el(doc, "div", "mc-thumb-placeholder");
    (lines && lines.length ? lines : ["PARKED"]).forEach((line, i) => {
      if (i) inner.appendChild(doc.createElement("br"));
      inner.appendChild(doc.createTextNode(String(line)));
    });
    thumb.appendChild(inner);
    return thumb;
  }

  function thumbWords(title, runId) {
    const source = String(title || runId || "").toUpperCase().replace(/[^\w\s]/g, " ").trim();
    const words = source.split(/\s+/).filter(Boolean).slice(0, 4);
    return words.length ? words : ["PARKED", "RUN"];
  }

  function renderParkedCard(doc, run) {
    const article = el(doc, "article", "mc-video-card parked");
    article.setAttribute("tabindex", "0");
    article.appendChild(placeholderThumb(doc, thumbWords(run.title, run.runId)));

    const body = el(doc, "div", "mc-card-body");
    const top = el(doc, "div", "mc-card-top");
    top.appendChild(el(doc, "span", "mc-date", dateFromRunId(run.runId) || run.runId));
    top.appendChild(el(doc, "span", "mc-badge parked-badge", "Parked"));
    body.appendChild(top);

    body.appendChild(el(doc, "h2", "mc-topic", run.title || run.runId));

    const stageText = run.activeStatus || run.status || "";
    if (stageText) body.appendChild(el(doc, "div", "mc-stage", "Last stage: " + stageText));

    const blocker = run.firstBlockerReason || run.status || "";
    if (blocker) body.appendChild(el(doc, "div", "mc-blocker", "Parked · " + blocker));

    if (run.updatedAt) {
      const meta = el(doc, "div", "mc-next", "");
      const strong = el(doc, "strong", null, "Last activity: ");
      meta.appendChild(strong);
      meta.appendChild(doc.createTextNode(String(run.updatedAt)));
      body.appendChild(meta);
    }

    const footer = el(doc, "div", "mc-card-footer");
    const link = el(doc, "a", null, "Open in Dashboard →");
    link.setAttribute("href", "package-runs-dashboard.html"); // constant href — runId never enters a URL
    footer.appendChild(link);
    body.appendChild(footer);

    article.appendChild(body);
    return article;
  }

  function freshnessNote(doc, fresh) {
    if (fresh.state === "stale") {
      return noteParagraph(
        doc,
        "Source package-runs-index.json was generated " + fresh.generatedAt + " (stale — regenerate the index to confirm current parked runs).",
        "warn"
      );
    }
    if (fresh.state === "unknown") {
      return noteParagraph(doc, "Source freshness is unknown (index has no valid generated-at timestamp).", "warn");
    }
    return null;
  }

  // Render the whole Parked section into `rootEl` from an index payload.
  function renderParkedSection(doc, rootEl, indexData) {
    const { parked, malformed } = selectParkedRuns(indexData);
    const fresh = freshness(indexData, undefined);
    const children = [];
    if (parked.length === 0) {
      children.push(noteParagraph(doc, "No package runs are currently marked as parked."));
    } else {
      parked.forEach((run) => children.push(renderParkedCard(doc, run)));
    }
    const note = freshnessNote(doc, fresh);
    if (note) children.push(note);
    if (malformed > 0) {
      children.push(
        noteParagraph(doc, malformed + " run entr" + (malformed === 1 ? "y was" : "ies were") + " unreadable and skipped.", "warn")
      );
    }
    rootEl.replaceChildren.apply(rootEl, children);
  }

  function renderParkedUnavailable(doc, rootEl, detail) {
    const p = noteParagraph(
      doc,
      "Parked run status is unavailable (could not read the package-runs index). Refresh to retry.",
      "warn"
    );
    rootEl.replaceChildren(p);
    if (detail && typeof console !== "undefined") console.error("Parked runs fetch failed:", detail);
  }

  function renderApprovedIdeaCard(doc, idea) {
    const article = el(doc, "article", "mc-video-card");
    article.setAttribute("tabindex", "0");
    const words = String(idea.title || "IDEA").toUpperCase().replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 4);
    article.appendChild(placeholderThumb(doc, words.length ? words : ["APPROVED", "IDEA"]));

    const body = el(doc, "div", "mc-card-body");
    const top = el(doc, "div", "mc-card-top");
    if (idea.fields.Scored) top.appendChild(el(doc, "span", "mc-date", idea.fields.Scored));
    top.appendChild(el(doc, "span", "mc-badge parked-badge", "Approved idea"));
    body.appendChild(top);

    body.appendChild(el(doc, "h2", "mc-topic", idea.title));
    if (idea.fields["One-line"]) body.appendChild(el(doc, "div", "mc-stage", idea.fields["One-line"]));
    const detailBits = [];
    if (idea.fields.Score) detailBits.push("Score " + idea.fields.Score);
    if (idea.fields.Pattern) detailBits.push(idea.fields.Pattern);
    if (idea.fields["Risk flags"]) detailBits.push("Risks: " + idea.fields["Risk flags"]);
    if (detailBits.length) body.appendChild(el(doc, "div", "mc-blocker", detailBits.join(" · ")));
    if (idea.fields["Next step"]) {
      const next = el(doc, "div", "mc-next", "");
      next.appendChild(el(doc, "strong", null, "Next: "));
      next.appendChild(doc.createTextNode(idea.fields["Next step"]));
      body.appendChild(next);
    }
    article.appendChild(body);
    return article;
  }

  function renderApprovedIdeasSection(doc, rootEl, markdown) {
    const { ideas, malformed } = parseApprovedIdeas(markdown);
    const children = [];
    if (ideas.length === 0) {
      children.push(noteParagraph(doc, "No approved ideas yet. Ideas appear here after Mikko greenlights them in mission-control/approved-ideas.md."));
    } else {
      ideas.forEach((idea) => children.push(renderApprovedIdeaCard(doc, idea)));
    }
    if (malformed > 0) {
      children.push(noteParagraph(doc, malformed + " idea entr" + (malformed === 1 ? "y was" : "ies were") + " unreadable and skipped.", "warn"));
    }
    rootEl.replaceChildren.apply(rootEl, children);
  }

  function renderApprovedIdeasUnavailable(doc, rootEl, detail) {
    rootEl.replaceChildren(
      noteParagraph(doc, "Approved-ideas status is unavailable (could not read approved-ideas.md). Refresh to retry.", "warn")
    );
    if (detail && typeof console !== "undefined") console.error("Approved ideas fetch failed:", detail);
  }

  // ── Loaders with in-flight guards (no overlapping requests) ──────────────────

  function makeController(opts) {
    const doc = (opts && opts.doc) || (typeof document !== "undefined" ? document : null);
    const fetchImpl = (opts && opts.fetchImpl) || (typeof fetch !== "undefined" ? fetch : null);
    let parkedInFlight = false;
    let approvedInFlight = false;

    function loadParked() {
      const rootEl = doc && doc.getElementById("parked-runs-root");
      if (!rootEl || !fetchImpl) return Promise.resolve();
      if (parkedInFlight) return Promise.resolve();
      parkedInFlight = true;
      return fetchImpl(RUN_LIST_ENDPOINT, { cache: "no-store" })
        .then((response) =>
          response.json().then((json) => {
            if (!response.ok) throw new Error((json && json.error) || "Request failed (" + response.status + ")");
            return json && json.data !== undefined ? json.data : json;
          })
        )
        .then((data) => renderParkedSection(doc, rootEl, data))
        .catch((error) => renderParkedUnavailable(doc, rootEl, error))
        .then(() => {
          parkedInFlight = false;
        });
    }

    function loadApprovedIdeas() {
      const rootEl = doc && doc.getElementById("approved-ideas-root");
      if (!rootEl || !fetchImpl) return Promise.resolve();
      if (approvedInFlight) return Promise.resolve();
      approvedInFlight = true;
      return fetchImpl(APPROVED_IDEAS_ENDPOINT, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Request failed (" + response.status + ")");
          return response.text();
        })
        .then((markdown) => renderApprovedIdeasSection(doc, rootEl, markdown))
        .catch((error) => renderApprovedIdeasUnavailable(doc, rootEl, error))
        .then(() => {
          approvedInFlight = false;
        });
    }

    return { loadParked, loadApprovedIdeas };
  }

  function init(opts) {
    const controller = makeController(opts || {});
    controller.loadParked();
    controller.loadApprovedIdeas();
    return controller;
  }

  return {
    // constants
    PARKED_STATE,
    RUN_LIST_ENDPOINT,
    APPROVED_IDEAS_ENDPOINT,
    STALE_AFTER_MS,
    // pure
    isParkedRun,
    selectParkedRuns,
    dateFromRunId,
    freshness,
    parseApprovedIdeas,
    // render (doc injectable)
    renderParkedCard,
    renderParkedSection,
    renderParkedUnavailable,
    renderApprovedIdeaCard,
    renderApprovedIdeasSection,
    renderApprovedIdeasUnavailable,
    // wiring
    makeController,
    init,
  };
});
