#!/usr/bin/env node
/*
 * Vacuous-test check: for each zero-kill test file from the campaign, re-apply
 * a sample of mutants that OTHER files killed in modules mapped to this file,
 * and run ONLY this file. Kills here prove the file has teeth (zero-kill was
 * attribution bias); zero kills here are strong vacuous evidence.
 * Temp-workspace only.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = __dirname;
const EV = process.argv[2];
const state = JSON.parse(fs.readFileSync(path.join(EV, "mutation-results.json"), "utf8"));
const mapping = JSON.parse(fs.readFileSync(path.join(EV, "module-test-mapping.json"), "utf8"));

// ── mutant generation (identical to mutation-harness.js) ─────────────────────
function maskLine(line, inTemplate) {
  let out = "";
  let stateQ = inTemplate ? "`" : null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]; const prev = line[i - 1];
    if (stateQ) { if (c === stateQ && prev !== "\\") { stateQ = null; out += c; } else out += " "; }
    else if (c === '"' || c === "'" || c === "`") { stateQ = c; out += c; }
    else if (c === "/" && line[i + 1] === "/") { out += " ".repeat(line.length - i); break; }
    else out += c;
  }
  return { masked: out, endsInTemplate: stateQ === "`" };
}
const OPERATORS = [
  { name: "eq3-flip", re: /===/g, sub: "!==" },
  { name: "neq3-flip", re: /!==/g, sub: "===" },
  { name: "eq2-flip", re: /(?<![=!<>])==(?!=)/g, sub: "!=" },
  { name: "neq2-flip", re: /(?<!!)!=(?!=)/g, sub: "==" },
  { name: "lt-flip", re: /(?<![<=-])<(?![<=])/g, sub: "<=" },
  { name: "lte-flip", re: /<=/g, sub: "<" },
  { name: "gt-flip", re: /(?<![>=])>(?![>=])/g, sub: ">=" },
  { name: "gte-flip", re: />=/g, sub: ">" },
  { name: "and-flip", re: /&&/g, sub: "||" },
  { name: "or-flip", re: /\|\|/g, sub: "&&" },
  { name: "true-flip", re: /\btrue\b/g, sub: "false" },
  { name: "false-flip", re: /\bfalse\b/g, sub: "true" },
  { name: "num-boundary", re: /(?<=[<>]=?\s{0,3})\b(\d+)\b/g, sub: (n) => String(Number(n) + 1) },
];
function generateMutants(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const lines = src.split("\n");
  const mutants = [];
  let inTemplate = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]; const trimmed = line.trim();
    const wasInTemplate = inTemplate;
    const { masked, endsInTemplate } = maskLine(line, inTemplate);
    inTemplate = endsInTemplate;
    if (wasInTemplate && endsInTemplate) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const op of OPERATORS) {
      op.re.lastIndex = 0; let m;
      while ((m = op.re.exec(masked))) {
        if (masked.slice(m.index, m.index + m[0].length).includes(" ")) continue;
        if ((op.name === "gt-flip" || op.name === "gte-flip") && masked[m.index - 1] === "=") continue;
        const sub = typeof op.sub === "function" ? op.sub(m[1]) : op.sub;
        mutants.push({ file, line: li + 1, op: op.name, col: m.index + 1, mutated: line.slice(0, m.index) + sub + line.slice(m.index + m[0].length) });
      }
    }
    const rm = masked.match(/^(\s*)return\s+([^; ]+);?\s*$/);
    if (rm && !/^(undefined|null)\s*$/.test(rm[2]) && !rm[2].includes(" ")) {
      mutants.push({ file, line: li + 1, op: "return-undefined", col: 1, mutated: rm[1] + "return undefined;" });
    }
  }
  return mutants;
}

// ── main ─────────────────────────────────────────────────────────────────────
const zeroKill = Object.keys(state.fileRuns).filter((f) => !(state.fileKills || {})[f]);
const testToMods = {};
for (const [mod, tests] of Object.entries(mapping)) for (const t of tests) (testToMods[t] = testToMods[t] || []).push(mod);

const report = {};
for (const tf of zeroKill) {
  const mods = new Set(testToMods[tf] || []);
  const killedMutants = state.results.filter((r) => r.verdict === "killed" && mods.has(r.file));
  const sample = [];
  const step = Math.max(1, Math.floor(killedMutants.length / 12));
  for (let i = 0; i < killedMutants.length && sample.length < 12; i += step) sample.push(killedMutants[i]);
  let kills = 0, ran = 0;
  for (const km of sample) {
    const genned = generateMutants(km.file).find((g) => g.line === km.line && g.col === km.col && g.op === km.op);
    if (!genned) continue;
    const abs = path.join(ROOT, km.file);
    const pristine = fs.readFileSync(abs, "utf8");
    const lines = pristine.split("\n");
    lines[km.line - 1] = genned.mutated;
    fs.writeFileSync(abs, lines.join("\n"));
    try {
      const r = cp.spawnSync("node", ["mutation-mini-runner.js", tf], { cwd: ROOT, encoding: "utf8", timeout: 60000, killSignal: "SIGKILL" });
      ran++;
      if (r.status !== 0) kills++;
    } finally {
      fs.writeFileSync(abs, pristine);
    }
  }
  report[tf] = { mappedModules: mods.size, campaignRuns: state.fileRuns[tf], sampleSize: ran, killsInVacuousCheck: kills };
  console.log(tf, JSON.stringify(report[tf]));
}
fs.writeFileSync(path.join(EV, "vacuous-check.json"), JSON.stringify(report, null, 1));
console.log("VACUOUS PHASE COMPLETE");
