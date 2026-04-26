const { A11Y_REPORT_DISCLAIMER_LINES } = require("./a11y-disclaimer");

/**
 * Renders a human-readable HTML view of a live-a11y report payload
 * (same shape as written to cypress/accessibility/*.json by liveA11yReporter).
 * @param {object} report
 * @returns {string}
 */
const escapeHtml = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const renderDisclaimerLineHtml = (line) =>
  escapeHtml(line)
    .replace(
      "github.com/dequelabs/axe-core",
      '<a href="https://github.com/dequelabs/axe-core" target="_blank" rel="noopener noreferrer">github.com/dequelabs/axe-core</a>'
    )
    .replace(
      "deque.com",
      '<a href="https://deque.com" target="_blank" rel="noopener noreferrer">deque.com</a>'
    );

const renderOptionPills = (values = []) =>
  values
    .map((value) => `<span class="option-pill">${escapeHtml(value)}</span>`)
    .join(" ");

const uniqueStringValues = (...groups) => [
  ...new Set(
    groups
      .filter(Array.isArray)
      .flat()
      .map((value) => String(value))
      .filter(Boolean)
  ),
];

const reportSuffixFromArtifact = (artifact = {}) => {
  const reportIdMatch = String(artifact.reportId || "").match(/--(R\d+)$/i);
  if (reportIdMatch) {
    return reportIdMatch[1].toUpperCase();
  }
  if (artifact.reportEmissionInSpec == null) {
    return "";
  }
  return `R${String(artifact.reportEmissionInSpec).padStart(2, "0")}`;
};

const formatIsoLocal = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "medium",
    });
  } catch {
    return String(iso);
  }
};

const severityClass = (impact) => {
  const s = String(impact || "").toLowerCase();
  if (s === "critical") return "sev-critical";
  if (s === "serious") return "sev-serious";
  if (s === "moderate") return "sev-moderate";
  if (s === "minor") return "sev-minor";
  return "sev-unknown";
};

const INITIAL_SOURCE = "full-page";

/** Pairs counts with the same human labels used in the JSON (`source` + `sourceLabel`). */
const renderNodeSourceAndCounts = (node) => {
  const inits = Number(node.initialDetections) || 0;
  const liveN = Number(node.liveDetections) || 0;
  const sources = node.sources || [];
  const labels = (node.sourceLabels && node.sourceLabels.length === sources.length
    ? node.sourceLabels
    : sources.map((s) => s));

  const initialIdx = sources.findIndex((s) => s === INITIAL_SOURCE);
  const initialLabel = initialIdx >= 0 ? labels[initialIdx] : "Initial scan (full page)";

  const liveEntries = sources
    .map((s, i) => ({ s, label: labels[i] || s }))
    .filter((entry) => entry.s !== INITIAL_SOURCE);

  const initialBlock =
    inits > 0
      ? `<div class="sc-line"><span class="sc-what">${escapeHtml(initialLabel)}</span> <span class="sc-x">× ${inits}</span></div>`
      : "";

  let liveBlock = "";
  if (liveN > 0) {
    const list =
      liveEntries.length > 0
        ? `<ul class="sc-live-parts">${liveEntries
          .map((e) => `<li>${escapeHtml(e.label)}</li>`)
          .join("")}</ul>`
        : `<p class="subtle sc-live-fallback">Live detections: ${liveN} (source details not split in this row)</p>`;
    // Same heading style as initial: label + sc-x count; list below lists per-root source labels.
    liveBlock = `<div class="sc-line sc-live-block"><div class="sc-live-head"><span class="sc-what">Live scan (DOM element)</span> <span class="sc-x">× ${liveN}</span></div>${list}</div>`;
  }

  if (!initialBlock && !liveBlock) {
    return "<span class=\"subtle\">—</span>";
  }
  return `<div class="source-counts">${initialBlock}${liveBlock}</div>`;
};

const formatRuleSourceSummary = (v) => {
  const sources = v.sources || [];
  const labels = (v.sourceLabels && v.sourceLabels.length === sources.length
    ? v.sourceLabels
    : null);
  if (!labels) return (sources || []).join(" — ");
  return sources.map((s, i) => labels[i] || s).join(" — ");
};

/**
 * axe-core `failureSummary` often starts with "Fix any of the following:" — show that as the summary and the rest in an expandable block.
 * @param {string | null | undefined} text
 * @returns {string}
 */

/**
 * Rule-level context from grouped violation (Deque link, help, description, tags).
 * @param {object} v
 * @returns {string}
 */
const renderA11yRuleReference = (v) => {
  const helpUrl = v.helpUrl ? String(v.helpUrl) : "";
  const primaryLink = helpUrl
    ? `<p class="axe-doc-lead">
  <a class="axe-doc-primary" href="${escapeHtml(helpUrl)}" target="_blank" rel="noopener noreferrer">Deque University — full rule documentation →</a>
</p>`
    : `<p class="subtle">No <code>helpUrl</code> in this result.</p>`;
  const tags = (v.tags || []).length
    ? `<p class="axe-tags">Tags: ${(v.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")}</p>`
    : "";
  return `<section class="axe-rule-ref" aria-label="Accessibility rule ${escapeHtml(v.id || "")}">
  ${primaryLink}
  <p class="axe-help-title"><strong>Help:</strong> ${escapeHtml(v.help || "—")}</p>
  <p class="axe-desc"><strong>Description:</strong> ${escapeHtml(v.description || "—")}</p>
  ${tags}
</section>`;
};

const renderFailureSummaryBlock = (text) => {
  const raw = text == null ? "" : String(text).replace(/\r\n/g, "\n");
  if (!raw.trim()) {
    return "<p class=\"failure-empty subtle\">—</p>";
  }
  const t = raw.trim();
  if (/^fix any of the following:/i.test(t)) {
    const after = t.replace(/^fix any of the following:\s*/i, "").trim() || "—";
    return `<details class="failure-details">
  <summary class="failure-summary">Fix any of the following:</summary>
  <div class="failure failure-body">${escapeHtml(after)}</div>
</details>`;
  }
  return `<details class="failure-details">
  <summary class="failure-summary">Failure details</summary>
  <div class="failure failure-body">${escapeHtml(t)}</div>
</details>`;
};

/**
 * @param {object[]} nodeDetails
 * @param {string} [ruleId]
 * @returns {string}
 */
const renderNodeRows = (nodeDetails, ruleId) => {
  if (!Array.isArray(nodeDetails) || nodeDetails.length === 0) {
    return "<p class=\"nodata\">No node details.</p>";
  }
  const safe = String(ruleId || "rule").replace(/[^a-zA-Z0-9_-]/g, "_");
  return nodeDetails
    .map(
      (node, index) => {
        const rowId = `node-${safe}-${index}`;
        const pageLine = node.pageUrl
          ? `<p class="node-page subtle" title="Page when this node was reported">Page: <a href="${escapeHtml(
            node.pageUrl
          )}" rel="noreferrer" target="_blank">${escapeHtml(node.pageUrl)}</a></p>`
          : "";
        const rowRecurrence = Boolean(node.repeatedFromEarlierReport);
        const rid = node.firstReportId ? String(node.firstReportId) : "";
        const recurrenceBanner = rowRecurrence
          ? `<aside class="node-recurrence" role="note" aria-label="Cross-test recurrence">
  <span class="node-recurrence-title">Same finding in an earlier report (this spec)</span>
  <p class="node-recurrence-body">${
  rid
    ? `First captured under report ID <code class="node-recurrence-rid">${escapeHtml(rid)}</code>.`
    : "This row matches a rule+target+page URL seen in a prior <code>reportLiveA11yResults</code> in this file."
} This is the same logical finding — not a new unique node for triage count.</p>
</aside>`
          : "";
        const trClass = `node-group${rowRecurrence ? " node-group--recurrence" : ""}`;
        return `
    <tr class="${trClass}" id="${rowId}">
      <td class="col-target" scope="row" valign="top">
        <div class="node-target-label">Selector / target</div>
        <code class="node-target-code" title="${escapeHtml(node.target)}">${escapeHtml(node.target)}</code>
        ${pageLine}
        ${
  rowRecurrence
    ? `<p class="node-repeat-pill" title="Recurrence from an earlier report in the same spec file">
  <span class="node-repeat-pill-label">Recurrence</span>${
  rid
    ? ` · first report <code>${escapeHtml(rid)}</code>`
    : " · see banner →"
}
</p>`
    : ""
}
      </td>
      <td class="col-node-rollup" valign="top">
        <div class="node-rollup" role="group" aria-label="Details for this row’s target">
          ${recurrenceBanner}
          <div class="node-section node-section-counts node-detail-block">
            <div class="node-section-eyebrow">Scans</div>
            ${renderNodeSourceAndCounts(node)}
          </div>
          <div class="node-fix-html-column" role="group" aria-label="Fix guidance and source HTML">
            <div class="node-section node-section-axe node-section-bleed node-detail-block">
              ${renderFailureSummaryBlock(node.failureSummary)}
            </div>
            ${
  node.html
    ? `<div class="node-section node-section-html node-section-bleed node-detail-block">
              <details class="html-snippet">
                <summary class="html-snippet-summary">Show HTML</summary>
                <pre class="code code-block-bleed">${escapeHtml(
      node.html.length > 2000 ? `${node.html.slice(0, 2000)}…` : node.html
    )}</pre>
              </details>
            </div>`
    : ""
}
          </div>
        </div>
      </td>
    </tr>`;
      }
    )
    .join("");
};

const renderViolationCard = (v) => {
  return `
  <article class="violation" id="rule-${escapeHtml(v.id)}">
    <header>
      <span class="badge ${severityClass(v.impact)}">${escapeHtml(v.impact || "n/a")}</span>
      <h3><code class="violation-rule-id">${escapeHtml(v.id)}</code></h3>
    </header>
    ${renderA11yRuleReference(v)}
    <p class="meta violation-stats">
      <strong>${Number(v.uniqueNodeCount || 0)}</strong> unique node(s) ·
      <strong>${Number(v.totalOccurrences || 0)}</strong> occurrence(s)
    </p>
    <table class="nodes">
      <thead><tr><th>Selector / target</th><th>Scans, axe message, and HTML for that row</th></tr></thead>
      <tbody>
        ${renderNodeRows(v.nodeDetails, v.id)}
      </tbody>
    </table>
  </article>`;
};

/**
 * @param {object} report
 */
const renderLiveA11yReportHtml = (report) => {
  const counts = report.counts || {};
  const artifact = report.reportArtifact || {};
  const bySev = counts.groupedBySeverity || {};
  const sevOrder = report.severityOrder || ["critical", "serious", "moderate", "minor"];
  const violations = report.groupedViolations || [];
  const monitorMeta = report.meta || {};
  const analysisMeta = monitorMeta.analysis || {};
  const configuredRunOnlyTags = uniqueStringValues(
    analysisMeta.configuredRunOnlyTags,
    analysisMeta.initialRunOnlyTags,
    analysisMeta.liveRunOnlyTags
  );
  const configuredImpactLevels = uniqueStringValues(
    analysisMeta.configuredImpactLevels,
    analysisMeta.initialImpactLevels,
    analysisMeta.liveImpactLevels
  );
  const severityTotalsOrder = configuredImpactLevels.length > 0 ? configuredImpactLevels : sevOrder;
  const testInSuiteLabel = artifact.testOrdinalLabel || (artifact.testOrdinalInSuite
    ? `Test ${artifact.testOrdinalInSuite} of ${artifact.testCountInSuite} in current suite`
    : "—");
  const reportSuffix = reportSuffixFromArtifact(artifact);
  const testAndReportLabel = reportSuffix
    ? `${testInSuiteLabel} (${reportSuffix})`
    : testInSuiteLabel;

  const summaryRows = [
    ["Report ID", escapeHtml(artifact.reportId || "—")],
    ["Spec file", escapeHtml(artifact.specFile || "—")],
    ["Cypress test", escapeHtml(artifact.testTitle || "—")],
    ["Test in suite", escapeHtml(testAndReportLabel)],
    ["Local time (browser would vary)", formatIsoLocal(report.generatedAt)],
    ["Report file (JSON)", escapeHtml(artifact.fileName || "—")],
    ["Initial full-page violations (raw)", String(counts.initialViolations ?? "—")],
    ["Initial distinct nodes w/ issues", String(counts.initialNodesWithViolations ?? "—")],
    ["Live scans captured", String(counts.liveScans ?? "—")],
    ["Unique live rule IDs (approx.)", String(counts.liveViolations ?? "—")],
    ["Grouped rules (after merge)", String(counts.groupedViolations ?? "—")],
    ["Monitor: started / finished", `${monitorMeta.started ?? "—"} / ${monitorMeta.finished ?? "—"}`],
    ["Rescans / dropped", `${monitorMeta.rescans ?? "—"} / ${monitorMeta.dropped ?? "—"}`],
  ];

  const summaryTable = summaryRows
    .map(
      ([k, val]) => `
    <tr><th scope="row">${k}</th><td>${val}</td></tr>`
    )
    .join("");

  const sevPills = severityTotalsOrder
    .map((s) => {
      const n = bySev[s] ?? 0;
      return `<a class="sev-pill ${severityClass(s)}" href="#sev-${escapeHtml(s)}">${escapeHtml(s)}: ${n}</a>`;
    })
    .join(" ");

  const analysisOptions = `
    <section class="analysis-options" aria-label="Analysis options">
      <h2>Analysis Options</h2>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Rule tags used</span>
        <span class="analysis-option-values">${renderOptionPills(configuredRunOnlyTags) || "All configured axe-core rules"}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Impacts included</span>
        <span class="analysis-option-values">${renderOptionPills(severityTotalsOrder)}</span>
      </div>
    </section>`;

  const bySeveritySections = sevOrder
    .map((sev) => {
      const list = violations.filter((v) => String(v.impact || "").toLowerCase() === sev);
      if (list.length === 0) return "";
      return `
  <section class="sev-block ${severityClass(sev)}-section" id="sev-${escapeHtml(sev)}" aria-labelledby="sev-${escapeHtml(sev)}-heading">
    <header class="sev-block-header">
      <div>
        <p class="sev-block-eyebrow">Severity section</p>
        <h2 id="sev-${escapeHtml(sev)}-heading">
          <span class="badge ${severityClass(sev)}">${escapeHtml(sev)}</span>
          <span>${list.length} grouped rule(s)</span>
        </h2>
      </div>
      <a class="sev-block-top-link" href="#top">Back to summary</a>
    </header>
    <div class="sev-block-body">
      ${list.map(renderViolationCard).join("\n")}
    </div>
    <div class="sev-block-end" aria-hidden="true">End of ${escapeHtml(sev)} section</div>
  </section>`;
    })
    .join("");

  const errors = Array.isArray(report.errors) ? report.errors : [];
  const footnoteLines = Array.isArray(report.footnote?.lines)
    ? report.footnote.lines
    : A11Y_REPORT_DISCLAIMER_LINES;
  const footnoteHtml = footnoteLines.map(renderDisclaimerLineHtml).join("<br />");
  const errorsBlock =
    errors.length === 0
      ? ""
      : `<section class="errors"><h2>Monitor / runtime errors (${errors.length})</h2><ul>${errors
        .map(
          (e) =>
            `<li><code>${escapeHtml(e.message || e.reason || JSON.stringify(e))}</code></li>`
        )
        .join("")}</ul></section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>wick-a11y-observer report — ${escapeHtml(artifact.reportId || artifact.specStem || "run")}</title>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a222d;
      --text: #e6edf3;
      --muted: #8b9cad;
      --border: #30363d;
      --link: #58a6ff;
    }
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      margin: 0;
      padding: 1.5rem 1.25rem 3rem;
    }
    .wrap { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
    h2 { font-size: 1.1rem; margin: 0; font-weight: 600; }
    h3 { font-size: 1rem; margin: 0; display: inline; font-weight: 600; }
    a { color: var(--link); }
    .subtle { color: var(--muted); font-size: 0.9rem; }
    .summary { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 8px; overflow: hidden; margin: 1rem 0; }
    .summary th, .summary td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
    .summary th { width: 42%; color: var(--muted); font-weight: 500; }
    .analysis-options {
      margin: 1rem 0 1.25rem;
      padding: 1rem;
      background: #111821;
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .analysis-options h2 { font-size: 1rem; margin: 0 0 0.75rem; }
    .analysis-option-row {
      display: grid;
      grid-template-columns: minmax(9rem, 13rem) 1fr;
      gap: 0.75rem;
      align-items: baseline;
      margin: 0.45rem 0;
    }
    .analysis-option-label { color: var(--muted); font-size: 0.85rem; font-weight: 600; }
    .analysis-option-values { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .option-pill {
      display: inline-block;
      background: #21262d;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: #c9d1d9;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.78rem;
      padding: 0.12rem 0.45rem;
    }
    .sev-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
    .sev-pill { text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; }
    .sev-critical { background: #3d1f1f; color: #f85149; }
    .sev-serious { background: #3d2a1a; color: #d4a15f; }
    .sev-moderate { background: #3d3518; color: #e3b341; }
    .sev-minor { background: #1c2a3d; color: #79c0ff; }
    .sev-unknown { background: #2d2d2d; color: #aaa; }
    .sev-block {
      margin: 2.25rem 0 3rem;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #111821;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
      overflow: hidden;
    }
    .sev-block-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.1rem;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(90deg, rgba(88, 166, 255, 0.12), rgba(88, 166, 255, 0.02));
    }
    .sev-critical-section { border-color: rgba(248, 81, 73, 0.55); }
    .sev-critical-section .sev-block-header { background: linear-gradient(90deg, rgba(248, 81, 73, 0.22), rgba(248, 81, 73, 0.04)); }
    .sev-serious-section { border-color: rgba(212, 161, 95, 0.55); }
    .sev-serious-section .sev-block-header { background: linear-gradient(90deg, rgba(212, 161, 95, 0.22), rgba(212, 161, 95, 0.04)); }
    .sev-moderate-section { border-color: rgba(227, 179, 65, 0.55); }
    .sev-moderate-section .sev-block-header { background: linear-gradient(90deg, rgba(227, 179, 65, 0.2), rgba(227, 179, 65, 0.04)); }
    .sev-minor-section { border-color: rgba(121, 192, 255, 0.5); }
    .sev-minor-section .sev-block-header { background: linear-gradient(90deg, rgba(121, 192, 255, 0.2), rgba(121, 192, 255, 0.04)); }
    .sev-block-eyebrow {
      margin: 0 0 0.35rem;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .sev-block h2 {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .sev-block-top-link {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 0.82rem;
      text-decoration: none;
      padding: 0.2rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(13, 17, 23, 0.4);
    }
    .sev-block-top-link:hover { color: var(--link); border-color: var(--link); }
    .sev-block-body {
      padding: 1rem 1rem 0.15rem;
    }
    .sev-block-end {
      margin: 0.25rem 1rem 1rem;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--border);
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    .violation {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1rem 0.5rem;
      margin-bottom: 1rem;
    }
    .violation-rule-id { font-size: 0.95rem; font-weight: 600; }
    .axe-rule-ref {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
      margin: 0.6rem 0 0.75rem;
    }
    .axe-doc-lead { margin: 0 0 0.35rem; }
    .axe-doc-primary {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--link);
      text-decoration: none;
    }
    .axe-doc-primary:hover { text-decoration: underline; }
    .axe-help-title, .axe-desc { font-size: 0.9rem; margin: 0.4rem 0; line-height: 1.45; }
    .axe-tags { margin: 0.45rem 0 0.15rem; font-size: 0.85rem; }
    .violation-stats { margin: 0.4rem 0; }
    .violation header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .badge { font-size: 0.7rem; text-transform: uppercase; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; }
    .help { margin: 0.5rem 0; }
    .meta { font-size: 0.9rem; color: var(--muted); }
    .tag { display: inline-block; background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.75rem; margin: 0.1rem; }
    .ext { font-size: 0.9rem; }
    .nodes { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 0.88rem; margin: 0.75rem 0; }
    .nodes th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--border); padding: 0.4rem; }
    .nodes th:first-child { width: 28%; }
    .nodes th:last-child { width: 72%; }
    .nodes td { vertical-align: top; padding: 0.5rem 0.4rem; border-bottom: 1px solid var(--border); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .node-group { border-left: 3px solid #30363d; }
    .node-group--recurrence { border-left-color: #a371f7; }
    .node-group td { background: #161b22; }
    .node-group--recurrence td { background: #1c1428; }
    .node-repeat-pill { margin: 0.4rem 0 0; font-size: 0.76rem; color: #d2a8ff; }
    .node-repeat-pill-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.68rem; }
    .node-repeat-pill code { background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.75rem; color: #e6edf3; }
    .node-recurrence {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      margin: 0 0 0.6rem;
      padding: 0.55rem 0.7rem;
      background: #211830;
      border: 1px solid #3d2a54;
      border-radius: 6px;
    }
    .node-recurrence-title { display: block; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #d2a8ff; margin-bottom: 0.3rem; }
    .node-recurrence-body { margin: 0; font-size: 0.84rem; color: #c9d1d9; line-height: 1.45; }
    .node-recurrence-rid { font-size: 0.8rem; background: #0d1117; padding: 0.15rem 0.4rem; border-radius: 4px; }
    .node-target-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.3rem; }
    .node-target-code { display: block; font-size: 0.8rem; word-break: break-all; }
    .node-page { margin: 0.4rem 0 0; font-size: 0.78rem; word-break: break-all; }
    .node-page a { color: var(--link); }
    .node-rollup { padding: 0; text-align: left; width: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: stretch; }
    .node-detail-block { width: 100%; max-width: 100%; align-self: stretch; }
    .node-section { margin-top: 0.55rem; }
    .node-section-counts { margin-top: 0.1rem; }
    .node-section-eyebrow { font-size: 0.8rem; font-weight: 600; color: var(--muted); margin: 0 0 0.35rem; }
    .node-section-bleed { text-align: left; width: 100%; max-width: 100%; }
    .node-section-axe { margin-top: 0.6rem; }
    .node-section-html { margin-top: 0.5rem; }
    .source-counts { font-size: 0.88rem; }
    .sc-line { margin: 0.3rem 0; }
    .sc-what { font-weight: 600; }
    .sc-x { font-weight: 700; color: #58a6ff; margin-left: 0.2rem; }
    .sc-live-block { margin-top: 0.4rem; padding-top: 0.35rem; border-top: 1px solid var(--border); }
    .sc-live-head { margin-bottom: 0.2rem; }
    .sc-live-parts { list-style: disc; margin: 0.2rem 0 0.15rem; padding: 0 0 0 1.4rem; text-align: left; }
    .sc-live-parts li { margin: 0.2rem 0; padding: 0 0 0 0.2rem; }
    .sc-live-fallback { margin: 0.2rem 0 0 0.75rem; }
    .node-fix-html-column {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      margin-top: 0.5rem;
      padding: 0.4rem 0 0.15rem 1.1rem;
      border-left: 2px solid #30363d;
    }
    .node-fix-html-column .node-section-axe,
    .node-fix-html-column .node-section-html { margin-top: 0.45rem; }
    .node-fix-html-column .node-section-axe:first-child { margin-top: 0; }
    .node-fix-html-column .failure-details,
    .node-fix-html-column .html-snippet { width: 100%; max-width: 100%; box-sizing: border-box; }
    .node-fix-html-column .failure-body,
    .node-fix-html-column .code-block-bleed { width: 100%; box-sizing: border-box; }
    .sc-rule-src { display: inline; }
    .pill { display: inline-block; background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; margin-right: 0.25rem; font-size: 0.8rem; }
    .pill.subtle { background: transparent; color: var(--muted); }
    .node-section-bleed .failure-details, .node-section-bleed .html-snippet { width: 100%; max-width: 100%; text-align: left; }
    .failure-details { margin: 0.1rem 0 0.4rem; }
    .failure-summary { cursor: pointer; color: var(--link); font-size: 0.9rem; list-style: none; text-align: left; padding: 0; }
    .failure-details .failure-summary::-webkit-details-marker { display: none; }
    .failure-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .failure-details[open] .failure-summary::before { content: "▼ "; }
    .failure { white-space: pre-wrap; font-size: 0.85rem; color: #c9d1d9; text-align: left; }
    .failure-body { margin: 0.35rem 0 0.15rem; padding: 0.6rem 0.65rem; background: #0d1117; border-radius: 6px; border: 1px solid var(--border); width: 100%; max-width: 100%; box-sizing: border-box; }
    .failure-empty { margin: 0.25rem 0; }
    .html-snippet { margin: 0; width: 100%; max-width: 100%; }
    .html-snippet-summary { cursor: pointer; color: var(--link); font-size: 0.9rem; text-align: left; list-style: none; padding: 0; }
    .html-snippet .html-snippet-summary::-webkit-details-marker { display: none; }
    .html-snippet .html-snippet-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .html-snippet[open] .html-snippet-summary::before { content: "▼ "; }
    .code, .code-block-bleed { background: #0d1117; padding: 0.6rem 0.65rem; border-radius: 6px; overflow: auto; max-height: 280px; font-size: 0.75rem; text-align: left; width: 100%; max-width: 100%; box-sizing: border-box; }
    .errors { margin-top: 2rem; }
    .errors ul { color: #f85149; }
    .nodata { color: var(--muted); }
    footer { margin-top: 2rem; font-size: 0.8rem; color: var(--muted); }
    .report-footnote { margin-top: 0.75rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1 id="top">wick-a11y-observer accessibility report</h1>
    <p class="subtle">Readable summary of grouped axe-core violations (initial + live). Open <strong>Rule docs</strong> for remediation.</p>
    <table class="summary" role="table" aria-label="Run summary">
      <tbody>${summaryTable}</tbody>
    </table>
    ${analysisOptions}
    <p class="subtle">By severity (grouped rules)</p>
    <div class="sev-pills">${sevPills || "<span class=\"subtle\">No violations in grouped output.</span>"}</div>
    ${errorsBlock}
    ${bySeveritySections || "<p class=\"subtle\">No violations to show.</p>"}
    <footer>
      <p>Generated for interactive review — keep JSON for machine use.</p>
      <p class="report-footnote">${footnoteHtml}</p>
    </footer>
  </div>
</body>
</html>`;
};

module.exports = {
  renderLiveA11yReportHtml,
  escapeHtml,
};
