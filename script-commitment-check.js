/**
 * VIDTOOLZ Vertical Script Commitment Check — mechanical model (browser + server).
 *
 * One narrow pre-media checkpoint for the vertical Shorts path: "is this saved script
 * worth spending image / I2V / PRESTO effort on?" This module holds only the deterministic
 * [mechanical] parts (word count, runtime estimate, empty input, generic-opening detection,
 * length warnings) plus verdict assembly. Judgment ([LLM-assisted]) checks are layered on by
 * the server via the existing local-Ollama path; this module never calls a network.
 *
 * Advisory only — it never blocks the operator.
 */
(function scriptCommitmentCheckModule(globalScope) {
  "use strict";

  // ~150 spoken words / minute = 2.5 words/second.
  const WORDS_PER_SECOND = 2.5;

  // Generic warm-up openers that weaken a Short's first line. Matched as lowercased prefixes.
  const GENERIC_OPENINGS = [
    "today i want to talk about",
    "today i'm going to",
    "today we're going to",
    "today we are going to",
    "in this video",
    "in today's video",
    "welcome back",
    "hey guys",
    "what's up guys",
    "what is up guys",
    "i'm going to show you",
    "let's talk about",
    "let me tell you about",
    "have you ever wondered",
  ];

  function countWords(text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  function estimateRuntimeSeconds(words) {
    const n = Number(words) || 0;
    return Math.round(n / WORDS_PER_SECOND);
  }

  function hasGenericOpening(text) {
    const head = String(text == null ? "" : text).trim().toLowerCase().replace(/^["'“”\s]+/, "");
    return GENERIC_OPENINGS.some((phrase) => head.startsWith(phrase));
  }

  // Deterministic checks + signals. Returns the runtime check, flags, and counts.
  function mechanicalChecks(script) {
    const text = String(script == null ? "" : script).trim();
    const words = countWords(text);
    const runtimeSeconds = estimateRuntimeSeconds(words);
    const empty = words === 0;
    const wayTooLong = words > 600;
    const tooLong = words > 400;
    const genericOpening = !empty && hasGenericOpening(text);

    let runtimeStatus = "pass";
    let runtimeDetail = `${words} words (~${runtimeSeconds}s) — within Short range.`;
    if (empty) {
      runtimeStatus = "fail";
      runtimeDetail = "No script text.";
    } else if (wayTooLong) {
      runtimeStatus = "fail";
      runtimeDetail = `${words} words (~${runtimeSeconds}s) — over 600; reroute to horizontal or cut heavily.`;
    } else if (tooLong) {
      runtimeStatus = "warning";
      runtimeDetail = `${words} words (~${runtimeSeconds}s) — over the 400-word Short ceiling; trim.`;
    } else if (words < 120) {
      runtimeStatus = "warning";
      runtimeDetail = `${words} words (~${runtimeSeconds}s) — under 120; may be too thin for a Short.`;
    }

    return {
      words,
      runtimeSeconds,
      empty,
      tooLong,
      wayTooLong,
      genericOpening,
      runtimeCheck: { label: "Runtime fit", status: runtimeStatus, detail: runtimeDetail },
    };
  }

  // Assemble the overall verdict from the combined check list + mechanical flags.
  // Advisory: warnings never force a non-pass; only empty / way-too-long / hard fails do.
  function buildVerdict(checks, flags) {
    const f = flags || {};
    if (f.empty) {
      return { verdict: "revise", recommendedNextAction: "Revise script" };
    }
    if (f.wayTooLong) {
      return { verdict: "reroute", recommendedNextAction: "Consider horizontal" };
    }
    const anyFail = (Array.isArray(checks) ? checks : []).some((c) => c && c.status === "fail");
    if (anyFail) {
      return { verdict: "revise", recommendedNextAction: "Revise script" };
    }
    return { verdict: "pass", recommendedNextAction: "Proceed to image prompts" };
  }

  const api = {
    WORDS_PER_SECOND,
    GENERIC_OPENINGS,
    countWords,
    estimateRuntimeSeconds,
    hasGenericOpening,
    mechanicalChecks,
    buildVerdict,
  };

  globalScope.ScriptCommitmentCheck = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
