#!/usr/bin/env node
/**
 * I/O for live-a11y reporting: filesystem, HTML artifacts, terminal logging, Cypress tasks.
 *
 * CLI — write sibling `.html` from a saved JSON report:
 *   node src/a11y-reporter-io.js path/to/report.json
 */

const fs = require("fs");
const path = require("path");
const {
  A11Y_REPORT_DISCLAIMER,
  A11Y_REPORT_DISCLAIMER_LINES,
  renderLiveA11yReportHtml,
} = require("./a11y-html-template");
const core = require("./a11y-reporter");

/* ---------------------------------------------------------------------------
 * Persist report payloads: JSON for machines/CI, sibling HTML for humans (same basename).
 * --------------------------------------------------------------------------- */
const writeJson = (outputPath, payload) => {
  const absolutePath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2));
  return absolutePath;
};

/**
 * Writes sibling `.html` next to the JSON report (same basename).
 * @param {string} jsonOutputPath
 * @param {object} payload
 * @returns {string} absolute path to the HTML file
 */
const writeLiveA11yHtmlReport = (jsonOutputPath, payload) => {
  const dir = path.dirname(path.resolve(jsonOutputPath));
  const base = path.basename(jsonOutputPath, path.extname(jsonOutputPath));
  const htmlPath = path.join(dir, `${base}.html`);
  const html = renderLiveA11yReportHtml(payload);
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
};

/**
 * Read a saved live-a11y JSON report and write the sibling `.html` (same basename).
 * @param {string} jsonPath
 * @returns {string} absolute path to the HTML file
 */
const writeLiveA11yHtmlFromJsonFile = (jsonPath) => {
  const abs = path.resolve(jsonPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  const report = JSON.parse(fs.readFileSync(abs, "utf8"));
  return writeLiveA11yHtmlReport(abs, report);
};

/* ---------------------------------------------------------------------------
 * Shapes `reportArtifact` on the payload so HTML/JSON consumers know paths + test metadata.
 * --------------------------------------------------------------------------- */
/**
 * @param {string} outputPath
 * @param {string} absolutePath
 * @param {Record<string, string | undefined> | undefined} reportMeta
 */
const attachReportArtifact = (outputPath, absolutePath, reportMeta) => {
  const fileName = path.basename(absolutePath);
  return {
    relativePath: String(outputPath).replace(/\\/g, "/"),
    fileName,
    absolutePath,
    ...(reportMeta || {}),
  };
};

/* ---------------------------------------------------------------------------
 * CI/local visibility: prints validation outcome, counts, paths, and grouped violations
 * without opening the HTML report (complements core.formatTerminalSeverityLine).
 * --------------------------------------------------------------------------- */
const logLiveA11yReportToTerminal = (payload, validationResult, { savedTo, savedHtmlTo } = {}) => {
  const artifact = payload?.reportArtifact || {};
  const counts = payload?.counts || {};
  const summary = payload?.summary || {};
  const groupedViolations = Array.isArray(payload?.groupedViolations) ? payload.groupedViolations : [];
  const includeIncomplete = payload?.reportOptions?.includeIncompleteInReport === true;
  const severityOrder = Array.isArray(payload?.severityOrder) && payload.severityOrder.length > 0
    ? payload.severityOrder
    : core.SEVERITY_ORDER;
  const groupedBySeverityDisposition = counts.groupedBySeverityDisposition || {};
  const groupedByDisposition = counts.groupedByDisposition || {};
  const scanType = String(artifact.scanType || "live").toLowerCase();
  const scanLabel = scanType === "checkpoint" ? "checkpoint" : "live";
  const reportId = artifact.reportId || "unknown-report";
  const reportPath = savedTo || "in-memory (generateReports=false)";
  const htmlPath = savedHtmlTo || "not-generated";
  const validationState = core.resolveValidationStatus(counts, validationResult).status;
  const terminalSeparator = "[A11Y] " + "=".repeat(86);

  console.log(`\n${terminalSeparator}`);
  console.log(`[A11Y] Report ${reportId} (${scanLabel})`);
  console.log(`[A11Y] Spec: ${summary?.identity?.specFile || artifact.specFile || "unknown-spec"}`);
  console.log(`[A11Y] Test: ${summary?.identity?.cypressTest || artifact.testTitle || "unknown-test"}`);
  console.log(`[A11Y] Validation: ${validationState}`);
  console.log(
    `[A11Y] Totals: groupedFindings=${Number(counts.groupedFindingsTotal || 0)}, issues=${Number(counts.groupedViolations || 0)}, fail=${Number(groupedByDisposition.fail || 0)}, warn=${Number(groupedByDisposition.warn || 0)}`
    + (includeIncomplete ? `, incomplete=${Number(groupedByDisposition.incomplete || 0)}` : "")
  );
  console.log("[A11Y] Severity summary:");
  severityOrder.forEach((severity) => {
    console.log(`  - ${core.formatTerminalSeverityLine(severity, groupedBySeverityDisposition[severity], includeIncomplete)}`);
  });
  console.log(`[A11Y] JSON: ${reportPath}`);
  console.log(`[A11Y] HTML: ${htmlPath}`);
  console.log("[A11Y] Violations and affected nodes:");

  if (groupedViolations.length === 0) {
    console.log("  - none");
    return;
  }

  groupedViolations.forEach((violation, index) => {
    const disposition = String(violation?.disposition || "fail").toLowerCase();
    const findingType = String(violation?.findingType || "violation").toLowerCase();
    const impact = String(violation?.impact || "none").toLowerCase();
    const nodeDetails = Array.isArray(violation?.nodeDetails) ? violation.nodeDetails : [];
    console.log(
      `  ${index + 1}. [${disposition}] ${violation?.id || "unknown-rule"} (${impact}, ${findingType}) nodes=${nodeDetails.length}`
    );
    nodeDetails.forEach((node) => {
      const page = node?.pageUrl ? ` @ ${node.pageUrl}` : "";
      console.log(`     - ${node?.target || "<unknown-node>"}${page}`);
    });
  });
  console.log(terminalSeparator);
};

/* ---------------------------------------------------------------------------
 * Cypress plugin hook: `liveA11y:buildReport` task builds the report in Node, optionally
 * writes artifacts, logs to terminal, and fails the task when validation fails (unless deferred).
 * --------------------------------------------------------------------------- */
const registerLiveA11yReporterTasks = (on, config = {}) => {
  const defaultOutputPath = core.resolveDefaultAccessibilityReportPath(config?.accessibilityFolder);
  on("task", {
    "liveA11y:buildReport"({
      results,
      outputPath = defaultOutputPath,
      validation = {},
      reportMeta = undefined,
      repeatInfo = undefined,
      includeIncompleteInReport = false,
      generateArtifacts = true,
      deferValidationFailure = false,
    }) {
      const report = core.buildLiveA11yReport(results, {
        includeIncompleteInReport: includeIncompleteInReport === true,
      });
      core.enrichNodesWithCrossReportRepeat(report.groupedViolations, repeatInfo);
      const validationResult = core.validateLiveA11yReport(report, validation);
      const absolutePath = path.resolve(outputPath);
      const validationStatus = core.resolveValidationStatus(report.counts, validationResult);
      /* Payload mirrors disk JSON/HTML: counts + grouped findings + validation + artifact paths. */
      const payload = {
        ...report,
        validation: {
          ...validationResult,
          ...validationStatus,
        },
        reportArtifact: attachReportArtifact(outputPath, absolutePath, reportMeta),
        summary: undefined,
        footnote: {
          text: A11Y_REPORT_DISCLAIMER,
          lines: A11Y_REPORT_DISCLAIMER_LINES,
        },
      };
      payload.summary = core.buildReportSummary(payload);
      let savedTo;
      let savedHtmlTo;
      let htmlReportRelative;
      /* In-memory-only mode skips writes (e.g. tests) but still logs and validates. */
      if (generateArtifacts !== false) {
        savedTo = writeJson(outputPath, payload);
        savedHtmlTo = writeLiveA11yHtmlReport(outputPath, payload);
        htmlReportRelative = String(outputPath)
          .replace(/\\/g, "/")
          .replace(/\.json$/i, ".html");
      }

      logLiveA11yReportToTerminal(payload, validationResult, { savedTo, savedHtmlTo });

      /* Defer when the runner will assert separately (e.g. custom Cypress flow). */
      if (!validationResult.valid && !deferValidationFailure) {
        throw new Error(
          `Live a11y validation failed:\n- ${validationResult.errors.join("\n- ")}`
        );
      }

      return {
        ...payload,
        savedTo,
        savedHtmlTo,
        htmlReportRelative,
        validation: payload.validation,
      };
    },
  });
};

/* ---------------------------------------------------------------------------
 * CLI entry: regenerate HTML from an existing JSON report (e.g. shareable artifact).
 * --------------------------------------------------------------------------- */
if (require.main === module) {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("Usage: node src/a11y-reporter-io.js <report.json>");
    process.exit(1);
  }
  try {
    const outPath = writeLiveA11yHtmlFromJsonFile(jsonPath);
    console.log("Wrote", outPath);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

/* Public API for Cypress setup; CLI-only helper exported for tests or tooling. */
module.exports = {
  registerLiveA11yReporterTasks,
  writeLiveA11yHtmlFromJsonFile,
};
