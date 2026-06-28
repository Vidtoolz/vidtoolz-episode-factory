"use strict";

/**
 * Pure, deterministic model for the "Ready for Resolve" checklist (B2-A).
 *
 * It answers exactly ONE question: is the SYSTEM side of a package run finished,
 * so the run can be handed off to DaVinci Resolve?
 *
 * It deliberately STOPS at the handoff boundary. It knows nothing about editing,
 * assembly, export, or publishing — those are Mikko's domain, not the system's, and
 * this module must never imply or track them. No clocks, no randomness, no I/O: the
 * caller gathers the file signals and passes them in.
 *
 * Item status is one of: "ready" | "partial" | "missing" | "unknown".
 * "unknown" means the run's aigen package isn't linked, so the media side can't be read.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function countStatus(count, packageLinked, missingDetail) {
  if (!packageLinked) return { status: "unknown", detail: "Link the run's package to check." };
  const n = num(count);
  return n > 0
    ? { status: "ready", detail: `${n} present.` }
    : { status: "missing", detail: missingDetail };
}

function clipsStatus(input) {
  if (!input.packageLinked) return { status: "unknown", detail: "Link the run's package to check." };
  const selections = num(input.selectionsCount);
  const completed = num(input.clipsCompleted);
  const pending = num(input.clipsPending);
  const failed = num(input.clipsFailed);
  if (selections === 0) return { status: "missing", detail: "No images selected to render yet." };
  if (completed >= selections && pending === 0 && failed === 0) {
    return { status: "ready", detail: `${completed}/${selections} clips rendered.` };
  }
  const bits = [`${completed}/${selections} rendered`];
  if (pending > 0) bits.push(`${pending} pending`);
  if (failed > 0) bits.push(`${failed} failed`);
  return { status: completed > 0 ? "partial" : "missing", detail: `${bits.join(", ")}.` };
}

function buildResolveReadiness(input = {}) {
  const workflowPath = String(input.workflowPath || "") === "vertical" ? "vertical" : "horizontal";
  const packageLinked = Boolean(input.packageLinked);
  const items = [];

  items.push({
    key: "script",
    label: "Final script saved",
    ...(input.scriptSaved
      ? { status: "ready", detail: "final-script.md present." }
      : { status: "missing", detail: "Save the final script first." }),
  });

  items.push({
    key: "image-prompts",
    label: "Image prompts generated",
    ...countStatus(input.imagePromptsCount, packageLinked, "Create or import image prompts."),
  });

  items.push({
    key: "images",
    label: "Images generated",
    ...countStatus(input.imagesCount, packageLinked, "Generate FLUX images (or upload GPT images)."),
  });

  items.push({
    key: "image-select",
    label: "Images selected",
    ...countStatus(input.selectionsCount, packageLinked, "Select which images go to video."),
  });

  if (workflowPath === "vertical") {
    items.push({
      key: "i2v-prompts",
      label: "Image-to-video prompts saved",
      ...countStatus(input.i2vPromptsCount, packageLinked, "Save the image-to-video prompts."),
    });
  }

  items.push({
    key: "clips",
    label: "Video clips generated (viewable)",
    ...clipsStatus(input),
  });

  items.push({
    key: "resolve-handoff",
    label: "Resolve handoff assembled",
    ...(!packageLinked
      ? { status: "unknown", detail: "Link the run's package to check." }
      : input.resolveHandoffReady
        ? { status: "ready", detail: "assembly-plan + media manifest present." }
        : { status: "missing", detail: "Create the Resolve assembly handoff." }),
  });

  const unknown = items.filter((i) => i.status === "unknown");
  const notReady = items.filter((i) => i.status === "missing" || i.status === "partial");
  const ready = notReady.length === 0 && unknown.length === 0;

  let nextAction;
  if (ready) {
    nextAction = "System side complete — hand this run off to Resolve for editing.";
  } else if (unknown.length && !input.scriptSaved) {
    nextAction = "Save the final script, then link this run's aigen package to assess media readiness.";
  } else if (unknown.length) {
    nextAction = "Link this run's aigen package to assess image and clip readiness.";
  } else {
    nextAction = `Before Resolve, finish: ${notReady.map((i) => i.label).join(", ")}.`;
  }

  return {
    workflowPath,
    packageLinked,
    items,
    ready,
    readyCount: items.filter((i) => i.status === "ready").length,
    totalCount: items.length,
    nextAction,
    // Explicit scope marker so no consumer reads past-Resolve intent into this verdict.
    boundary: "ready-for-resolve",
  };
}

module.exports = { buildResolveReadiness };
