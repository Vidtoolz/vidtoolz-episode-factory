const fs = require("node:fs");
const path = require("node:path");

const authority = require("../aigen-authority-chain.js");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function ensureFinalScript(packageDir) {
  const target = path.join(packageDir, "script", "script-final.md");
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `# Final Script\n\n${"Approved test authority. ".repeat(10)}\n`, "utf8");
  }
}

function ensureImagePrompts(packageDir) {
  const target = path.join(packageDir, "image-prompts.json");
  if (!fs.existsSync(target)) {
    const selected = (() => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(packageDir, "selected-images.json"), "utf8"));
        return Array.isArray(parsed.selections) ? parsed.selections : [];
      } catch (_) {
        return [];
      }
    })();
    const indexes = selected.length
      ? selected.map((item, i) => Number(item.prompt_index) || i + 1)
      : [1];
    writeJson(target, {
      image_prompts: indexes.map((index) => ({
        index,
        prompt: `Authority fixture visual prompt for slot ${index}.`,
      })),
    });
  }
}

function bindImagePrompts(packageDir) {
  ensureFinalScript(packageDir);
  ensureImagePrompts(packageDir);
  return authority.recordStage(packageDir, "image_prompts");
}

function bindSelections(packageDir) {
  bindImagePrompts(packageDir);
  return authority.recordStage(packageDir, "selected_images");
}

function bindI2vPrompts(packageDir) {
  bindSelections(packageDir);
  return authority.recordStage(packageDir, "i2v_prompts");
}

module.exports = {
  bindI2vPrompts,
  bindImagePrompts,
  bindSelections,
  ensureFinalScript,
  ensureImagePrompts,
};
