#!/usr/bin/env node
/**
 * Regenerate the human-readable HTML report from a saved live-a11y JSON file.
 * Usage: node src/a11y-json2html.js path/to/live-axe-foo.json
 */
const fs = require("fs");
const path = require("path");
const { renderLiveA11yReportHtml } = require("./a11y-html-template");

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: node src/a11y-json2html.js <report.json>");
  process.exit(1);
}
const abs = path.resolve(jsonPath);
if (!fs.existsSync(abs)) {
  console.error("File not found:", abs);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(abs, "utf8"));
const outPath = abs.replace(/\.json$/i, ".html");
fs.writeFileSync(outPath, renderLiveA11yReportHtml(report), "utf8");
console.log("Wrote", outPath);
