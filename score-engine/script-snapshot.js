"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The project-local snapshot is the durable script authority for score
// planning. Callers must not rely on transient project.script_text after a
// process restart because that field is deliberately not persisted.
function readScriptSnapshot(projectDir) {
  const file = path.join(projectDir, "script-snapshot.txt");
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

module.exports = { readScriptSnapshot };
