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

const dispositionClass = (disposition) =>
  String(disposition || "").toLowerCase() === "warn"
    ? "disp-warn"
    : String(disposition || "").toLowerCase() === "incomplete"
      ? "disp-incomplete"
      : "disp-fail";

const dispositionLabel = (disposition) =>
  String(disposition || "").toLowerCase() === "warn"
    ? "DOES NOT FAIL TEST"
    : String(disposition || "").toLowerCase() === "incomplete"
      ? "MANUAL REVIEW RECOMMENDED"
      : "FAILS TEST";

const severitySectionTypeLabel = (severity, groupedBySeverityDisposition = {}, impactPolicy = {}) => {
  const entry = groupedBySeverityDisposition?.[severity];
  if (entry?.sectionType === "incomplete") return "INCOMPLETE";
  if (entry?.sectionType === "warning") return "WARNINGS";
  if (entry?.sectionType === "violation") return "VIOLATIONS";
  if (Number(entry?.incomplete || 0) > 0 && Number(entry?.warn || 0) === 0 && Number(entry?.fail || 0) === 0) {
    return "INCOMPLETE";
  }
  if (Number(entry?.warn || 0) > 0 && Number(entry?.fail || 0) === 0) return "WARNINGS";
  const normalizedSeverity = String(severity || "").toLowerCase();
  const included = new Set(
    Array.isArray(impactPolicy?.included)
      ? impactPolicy.included.map((level) => String(level).toLowerCase())
      : []
  );
  const warn = new Set(
    Array.isArray(impactPolicy?.warn)
      ? impactPolicy.warn.map((level) => String(level).toLowerCase())
      : []
  );
  if (warn.has(normalizedSeverity) && !included.has(normalizedSeverity)) return "WARNINGS";
  return "VIOLATIONS";
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
  const sourceOccurrenceCounts = node.sourceOccurrenceCounts && typeof node.sourceOccurrenceCounts === "object"
    ? node.sourceOccurrenceCounts
    : {};

  const initialIdx = sources.findIndex((s) => s === INITIAL_SOURCE);
  const initialLabel = initialIdx >= 0 ? labels[initialIdx] : "Initial scan (full page)";

  const liveEntries = sources
    .map((s, i) => ({ s, label: labels[i] || s }))
    .filter((entry) => entry.s !== INITIAL_SOURCE);
  const seenLiveLabels = new Set();
  const uniqueLiveLabelEntries = liveEntries.reduce((acc, entry) => {
    const key = String(entry.label || "unknown");
    if (seenLiveLabels.has(key)) {
      return acc;
    }
    seenLiveLabels.add(key);
    acc.push({
      label: key,
      count: Number(sourceOccurrenceCounts[key] || 1),
    });
    return acc;
  }, []);

  const initialBlock =
    inits > 0
      ? `<div class="sc-line"><span class="sc-what">${escapeHtml(initialLabel)}</span> <span class="sc-x">× ${inits}</span></div>`
      : "";

  let liveBlock = "";
  if (liveN > 0) {
    const list =
      liveEntries.length > 0
        ? `<ul class="sc-live-parts">${uniqueLiveLabelEntries
          .map((e) => `<li>${escapeHtml(e.label)} <span class="sc-live-count">× ${e.count}</span></li>`)
          .join("")}</ul>`
        : `<p class="subtle sc-live-fallback">Live detections: ${liveN} (source details not split in this row)</p>`;
    // Same heading style as initial: label + sc-x count; list below lists per-root source labels.
    liveBlock = `<div class="sc-line sc-live-block"><div class="sc-live-head"><span class="sc-what">Live detections (by scan root)</span> <span class="sc-x">× ${liveN}</span></div>${list}</div>`;
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
  const prioritizedNodeDetails = [...nodeDetails].sort((a, b) => {
    const aRepeated = Boolean(a?.repeatedFromEarlierReport);
    const bRepeated = Boolean(b?.repeatedFromEarlierReport);
    return Number(aRepeated) - Number(bRepeated);
  });

  return prioritizedNodeDetails
    .map(
      (node, index) => {
        const rowId = `node-${safe}-${index}`;
        const pageLine = node.pageUrl
          ? `<p class="node-page subtle" title="Page when this node was reported">Page: <a href="${escapeHtml(
            node.pageUrl
          )}" rel="noreferrer" target="_blank">${escapeHtml(node.pageUrl)}</a></p>`
          : "";
        const rowRecurrence = Boolean(node.repeatedFromEarlierReport);
        const recurrenceBanner = rowRecurrence
          ? `<aside class="node-recurrence" role="note" aria-label="Cross-test recurrence">
  <span class="node-recurrence-title">Same finding in an earlier report (this spec) — lower triage priority</span>
</aside>`
          : "";
        const trClass = `node-group${rowRecurrence ? " node-group--recurrence" : ""}`;
        const recurrenceCompactBlock = rowRecurrence
          ? `<details class="node-recurrence-compact">
  <summary class="node-recurrence-compact-summary">Show recurring finding details</summary>
  <div class="node-recurrence-compact-body">
    <div class="node-section node-section-counts node-detail-block">
      <div class="node-section-eyebrow">Scans</div>
      ${renderNodeSourceAndCounts(node)}
    </div>
    <div class="node-fix-html-column" role="group" aria-label="Fix guidance and source HTML">
      <div class="node-section node-section-axe node-section-bleed node-detail-block">
        ${renderFailureSummaryBlock(node.failureSummary)}
      </div>
      ${node.html
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
</details>`
          : "";
        const standardBlock = !rowRecurrence
          ? `<div class="node-section node-section-counts node-detail-block">
            <div class="node-section-eyebrow">Scans</div>
            ${renderNodeSourceAndCounts(node)}
          </div>
          <div class="node-fix-html-column" role="group" aria-label="Fix guidance and source HTML">
            <div class="node-section node-section-axe node-section-bleed node-detail-block">
              ${renderFailureSummaryBlock(node.failureSummary)}
            </div>
            ${node.html
            ? `<div class="node-section node-section-html node-section-bleed node-detail-block">
              <details class="html-snippet">
                <summary class="html-snippet-summary">Show HTML</summary>
                <pre class="code code-block-bleed">${escapeHtml(
              node.html.length > 2000 ? `${node.html.slice(0, 2000)}…` : node.html
            )}</pre>
              </details>
            </div>`
            : ""
          }`
          : "";
        return `
    <tr class="${trClass}" id="${rowId}">
      <th class="col-target" scope="row" valign="top">
        <div class="node-target-label">Selector / target</div>
        <p class="node-priority-chip-wrap">
          <span class="node-priority-chip ${rowRecurrence ? "node-priority-repeated" : "node-priority-new"}">
            ${rowRecurrence ? "Repeated" : "New"}
          </span>
        </p>
        <code class="node-target-code" title="${escapeHtml(node.target)}">${escapeHtml(node.target)}</code>
        ${pageLine}
      </th>
      <td class="col-node-rollup" valign="top">
        <div class="node-rollup" role="group" aria-label="Details for this row’s target">
          ${recurrenceBanner}
          ${standardBlock}
          ${recurrenceCompactBlock}
        </div>
      </td>
    </tr>`;
      }
    )
    .join("");
};

const renderViolationCard = (v) => {
  const findingType = String(v.findingType || "violation").toLowerCase();
  const findingTypeBadge = findingType === "incomplete"
    ? `<span class="finding-type-badge finding-type-incomplete">INCOMPLETE - MANUAL REVIEW</span>`
    : "";
  const manualReviewNote = findingType === "incomplete"
    ? `<p class="meta incomplete-note">This finding was reported by axe-core as <strong>incomplete</strong> and should be reviewed manually.</p>`
    : "";
  return `
  <article class="violation" id="rule-${escapeHtml(v.id)}">
    <header>
      <span class="badge ${severityClass(v.impact)}">${escapeHtml(v.impact || "n/a")}</span>
      ${findingTypeBadge}
      <h3><code class="violation-rule-id">${escapeHtml(v.id)}</code></h3>
    </header>
    ${manualReviewNote}
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

const renderSeverityBucket = (title, cards = [], kind = "issues") => {
  if (!Array.isArray(cards) || cards.length === 0) return "";
  const cssClass = kind === "incomplete" ? "sev-subsection sev-subsection-incomplete" : "sev-subsection";
  return `<section class="${cssClass}">
    <h3 class="sev-subsection-title">${escapeHtml(title)}</h3>
    ${cards.map(renderViolationCard).join("\n")}
  </section>`;
};

const chunkIntoRows = (items = [], rowSize = 3) => {
  const rows = [];
  for (let i = 0; i < items.length; i += rowSize) {
    rows.push(items.slice(i, i + rowSize));
  }
  return rows;
};

const buildFallbackDuplicateStats = (groupedViolations = []) => {
  const duplicateGroupedViolationKeys = new Set();
  const duplicateNodeKeys = new Set();

  (Array.isArray(groupedViolations) ? groupedViolations : []).forEach((violation) => {
    const ruleId = String(violation?.id || "<unknown-rule>");
    (Array.isArray(violation?.nodeDetails) ? violation.nodeDetails : []).forEach((node) => {
      if (!node?.repeatedFromEarlierReport) {
        return;
      }
      const page = String(node?.pageUrl || "");
      const target = String(node?.rawTarget || node?.target || "<unknown>");
      duplicateNodeKeys.add(`${target}@@${page}`);
      duplicateGroupedViolationKeys.add(`${ruleId}@@${page}`);
    });
  });

  return {
    duplicatedViolationsFromEarlierReports: duplicateGroupedViolationKeys.size,
    duplicatedNodesFromEarlierReports: duplicateNodeKeys.size,
  };
};

/**
 * @param {object} report
 */
const renderLiveA11yReportHtml = (report) => {
  const counts = report.counts || {};
  const artifact = report.reportArtifact || {};
  const bySevDisposition = counts.groupedBySeverityDisposition || {};
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
  const configuredIncludedImpactLevels = uniqueStringValues(
    analysisMeta.configuredIncludedImpactLevels,
    analysisMeta.initialImpactLevels,
    analysisMeta.liveImpactLevels
  );
  const configuredWarnImpactLevels = uniqueStringValues(
    analysisMeta.configuredWarnImpactLevels,
    analysisMeta.initialWarnImpactLevels,
    analysisMeta.liveWarnImpactLevels
  ).filter((level) => !configuredIncludedImpactLevels.includes(level));
  const severityTotalsOrder = configuredImpactLevels.length > 0 ? configuredImpactLevels : sevOrder;
  const testInSuiteLabel = artifact.testOrdinalLabel || (artifact.testOrdinalInSuite
    ? `Test ${artifact.testOrdinalInSuite} of ${artifact.testCountInSuite} in current suite`
    : "—");
  const reportSuffix = reportSuffixFromArtifact(artifact);
  const testAndReportLabel = reportSuffix
    ? `${testInSuiteLabel} (${reportSuffix})`
    : testInSuiteLabel;
  const duplicateStats = buildFallbackDuplicateStats(violations);
  const reportEmissionInSpec = Number(artifact.reportEmissionInSpec || 0);
  const fallbackSummary = {
    identity: {
      reportId: artifact.reportId || "—",
      specFile: artifact.specFile || "—",
      cypressTest: artifact.testTitle || "—",
      testInSuite: testAndReportLabel,
      generatedLocal: formatIsoLocal(report.generatedAt),
      reportFileJson: artifact.fileName || "—",
    },
    technicalOrder: [
      "initialViolationsRaw",
      "liveDistinctViolationInstancesExcludingInitial",
      "totalViolationsInitialPlusLiveDistinct",
      "initialDistinctNodesWithIssues",
      "liveDistinctNodesWithIssuesExcludingInitial",
      "totalNodesInitialPlusLiveDistinct",
      "liveScansCaptured",
      "monitorDroppedScans",
      "monitorErrors",
      "duplicatedViolationsFromEarlierReports",
      "duplicatedNodesFromEarlierReports",
      "previousReportsInSpec",
    ],
    technicalMetrics: {
      initialViolationsRaw: Number(counts.initialViolations ?? 0),
      liveDistinctViolationInstancesExcludingInitial: Number(
        counts.liveDistinctViolationInstancesExcludingInitial ?? 0
      ),
      totalViolationsInitialPlusLiveDistinct: Number(
        counts.totalViolationsInitialPlusLiveDistinct ?? (
          Number(counts.initialViolations ?? 0) +
          Number(counts.liveDistinctViolationInstancesExcludingInitial ?? 0)
        )
      ),
      initialDistinctNodesWithIssues: Number(counts.initialNodesWithViolations ?? 0),
      liveDistinctNodesWithIssuesExcludingInitial: Number(
        counts.liveDistinctNodesWithIssuesExcludingInitial ?? 0
      ),
      totalNodesInitialPlusLiveDistinct: Number(
        counts.totalNodesInitialPlusLiveDistinct ?? (
          Number(counts.initialNodesWithViolations ?? 0) +
          Number(counts.liveDistinctNodesWithIssuesExcludingInitial ?? 0)
        )
      ),
      liveScansCaptured: Number(counts.liveScans ?? 0),
      monitorDroppedScans: Number(monitorMeta.dropped ?? 0),
      monitorErrors: Number((report.errors || []).length ?? 0),
      duplicatedViolationsFromEarlierReports: Number(
        duplicateStats.duplicatedViolationsFromEarlierReports ?? 0
      ),
      duplicatedNodesFromEarlierReports: Number(
        duplicateStats.duplicatedNodesFromEarlierReports ?? 0
      ),
      previousReportsInSpec: Math.max(0, reportEmissionInSpec > 0 ? reportEmissionInSpec - 1 : 0),
    },
    metricHelp: {
      initialViolationsRaw: {
        label: "Initial full-page violations (raw rule groups)",
        description: "How many violation rule groups axe found in the first full-page scan.",
        related: ["liveDistinctViolationInstancesExcludingInitial", "totalViolationsInitialPlusLiveDistinct"],
      },
      liveDistinctViolationInstancesExcludingInitial: {
        label: "Live distinct violations (excluding initial)",
        description:
          "How many NEW live violation groups were found, counted by rule + page, excluding groups already seen in the initial full-page scan.",
        related: ["initialViolationsRaw", "totalViolationsInitialPlusLiveDistinct"],
      },
      totalViolationsInitialPlusLiveDistinct: {
        label: "Total violations (initial + live distinct)",
        description:
          "Overall grouped violation total for this report: initial full-page rule groups + new live rule groups (excluding initial overlaps).",
        related: ["initialViolationsRaw", "liveDistinctViolationInstancesExcludingInitial"],
      },
      initialDistinctNodesWithIssues: {
        label: "Initial distinct nodes with issues",
        description: "How many unique elements had issues in the initial full-page scan.",
        related: ["liveDistinctNodesWithIssuesExcludingInitial", "totalNodesInitialPlusLiveDistinct"],
      },
      liveDistinctNodesWithIssuesExcludingInitial: {
        label: "Live distinct nodes (excluding initial)",
        description:
          "How many NEW unique elements had issues in live scans, excluding elements already seen in the initial full-page scan.",
        related: ["initialDistinctNodesWithIssues", "totalNodesInitialPlusLiveDistinct"],
      },
      totalNodesInitialPlusLiveDistinct: {
        label: "Total nodes (initial + live distinct)",
        description:
          "Overall unique-node total: initial distinct nodes + new live distinct nodes (excluding initial overlaps).",
        related: ["initialDistinctNodesWithIssues", "liveDistinctNodesWithIssuesExcludingInitial"],
      },
      liveScansCaptured: {
        label: "Live scans",
        description:
          "How many live/delta scans were actually executed while monitoring dynamic changes.",
        related: ["monitorDroppedScans", "monitorErrors"],
      },
      monitorDroppedScans: {
        label: "Dropped scans",
        description: "How many queued live scan attempts were dropped by the monitor queue logic.",
        related: ["liveScansCaptured", "monitorErrors"],
      },
      monitorErrors: {
        label: "Monitor errors",
        description: "Internal monitor runtime errors (engine/scan pipeline issues), not accessibility violations.",
        related: ["liveScansCaptured", "monitorDroppedScans"],
      },
      duplicatedViolationsFromEarlierReports: {
        label: "Duplicated grouped violations from earlier reports",
        description:
          "How many grouped violations (rule + page) in this report were already detected in earlier reports in the same spec file.",
        related: ["duplicatedNodesFromEarlierReports", "previousReportsInSpec"],
      },
      duplicatedNodesFromEarlierReports: {
        label: "Duplicated nodes from earlier reports",
        description:
          "How many node+page targets in this report were already seen in earlier reports in the same spec file.",
        related: ["duplicatedViolationsFromEarlierReports", "previousReportsInSpec"],
      },
      previousReportsInSpec: {
        label: "Previous reports in this spec",
        description:
          "How many reports were already emitted in this spec before this one. First report is 0.",
        related: ["duplicatedViolationsFromEarlierReports", "duplicatedNodesFromEarlierReports"],
      },
    },
  };
  const summary = report.summary || fallbackSummary;
  const identityRows = [
    ["Report ID", escapeHtml(summary.identity?.reportId || "—")],
    ["Spec file", escapeHtml(summary.identity?.specFile || "—")],
    ["Cypress test", escapeHtml(summary.identity?.cypressTest || "—")],
    ["Test in suite", escapeHtml(summary.identity?.testInSuite || "—")],
    ["Local time (browser would vary)", escapeHtml(summary.identity?.generatedLocal || "—")],
    ["Report file (JSON)", escapeHtml(summary.identity?.reportFileJson || "—")],
  ];
  const identityTable = identityRows
    .map(
      ([k, val]) => `
    <tr><th scope="row">${k}</th><td>${val}</td></tr>`
    )
    .join("");
  const technicalOrder = Array.isArray(summary.technicalOrder) && summary.technicalOrder.length > 0
    ? summary.technicalOrder
    : fallbackSummary.technicalOrder;
  const technicalRowHtml = chunkIntoRows(technicalOrder, 3)
    .map((row) => {
      const cells = row.map((metricKey) => {
        const metricHelp = summary.metricHelp?.[metricKey] || {};
        const metricLabel = escapeHtml(metricHelp.label || metricKey);
        const metricValue = escapeHtml(summary.technicalMetrics?.[metricKey] ?? "—");
        const metricDescription = escapeHtml(metricHelp.description || "No description available.");
        const related = Array.isArray(metricHelp.related) ? metricHelp.related : [];
        const relatedLabels = related
          .map((relatedKey) => summary.metricHelp?.[relatedKey]?.label || relatedKey)
          .join(", ");
        const relatedHtml = relatedLabels
          ? `<p class="tech-related subtle"><strong>Related:</strong> ${escapeHtml(relatedLabels)}</p>`
          : "";
        return `<td class="tech-cell">
  <details class="tech-metric">
    <summary>
      <span class="tech-metric-label">${metricLabel}</span>
      <span class="tech-metric-value">${metricValue}</span>
    </summary>
    <div class="tech-metric-help">
      <p>${metricDescription}</p>
      ${relatedHtml}
    </div>
  </details>
</td>`;
      }).join("");
      const padCount = 3 - row.length;
      const pads = padCount > 0 ? "<td class=\"tech-cell tech-cell-empty\"></td>".repeat(padCount) : "";
      return `<tr>${cells}${pads}</tr>`;
    });
  const technicalRowsPreview = technicalRowHtml.slice(0, 1).join("");
  const technicalRowsExpandedRemainder = technicalRowHtml.slice(1).join("");
  const technicalTotalRows = technicalRowHtml.length;

  const sevPills = severityTotalsOrder
    .map((s) => {
      const sevEntry = bySevDisposition?.[s] || {};
      const failCount = Number(sevEntry.fail || 0);
      const warnCount = Number(sevEntry.warn || 0);
      const incompleteCount = Number(sevEntry.incomplete || 0);
      const issuesCount = failCount + warnCount;
      const sectionType = severitySectionTypeLabel(s, bySevDisposition, report.impactPolicy || {});
      return `<a class="sev-pill ${severityClass(s)}" href="#sev-${escapeHtml(s)}">${sectionType} - ${escapeHtml(s)}: ISSUES ${issuesCount} | INCOMPLETE ${incompleteCount}</a>`;
    })
    .join(" ");

  const analysisOptions = `
      <h2>Analysis Options</h2>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Rule tags used</span>
        <span class="analysis-option-values">${renderOptionPills(configuredRunOnlyTags) || "All configured axe-core rules"}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Impacts that fail</span>
        <span class="analysis-option-values">${renderOptionPills(configuredIncludedImpactLevels) || '<span class="subtle">None</span>'}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Impacts that warn only</span>
        <span class="analysis-option-values">${renderOptionPills(configuredWarnImpactLevels) || '<span class="subtle">None</span>'}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Include incomplete findings</span>
        <span class="analysis-option-values">${report?.reportOptions?.includeIncompleteInReport ? "Yes" : "No (default)"}</span>
      </div>`;

  const bySeveritySections = sevOrder
    .map((sev) => {
      const list = violations.filter((v) => String(v.impact || "").toLowerCase() === sev);
      if (list.length === 0) return "";
      const issueCards = list.filter((v) => String(v?.disposition || "").toLowerCase() !== "incomplete");
      const incompleteCards = list.filter((v) => String(v?.disposition || "").toLowerCase() === "incomplete");
      const sectionCounts = bySevDisposition?.[sev] || {};
      const failCount = Number(sectionCounts.fail || 0);
      const warnCount = Number(sectionCounts.warn || 0);
      const incompleteCount = Number(sectionCounts.incomplete || 0);
      const normalizedSeverity = String(sev || "").toLowerCase();
      const included = new Set(
        Array.isArray(report?.impactPolicy?.included)
          ? report.impactPolicy.included.map((level) => String(level).toLowerCase())
          : []
      );
      const warn = new Set(
        Array.isArray(report?.impactPolicy?.warn)
          ? report.impactPolicy.warn.map((level) => String(level).toLowerCase())
          : []
      );
      const checkedAsWarnings = warn.has(normalizedSeverity) && !included.has(normalizedSeverity);
      const sectionDisposition = checkedAsWarnings ? "warn" : "fail";
      const issueCount = failCount + warnCount;
      const sectionPolicyLabel = checkedAsWarnings ? "Checked as warnings" : "Checked as violations";
      const issueBucketTitle = checkedAsWarnings
        ? "Warning issues (does not fail test)"
        : "Violation issues (fails test)";
      const issueSummaryLabel = checkedAsWarnings
        ? "WARNING ISSUES"
        : "VIOLATION ISSUES";
      const sectionBody = [
        renderSeverityBucket(issueBucketTitle, issueCards, "issues"),
        renderSeverityBucket("Incomplete (manual review)", incompleteCards, "incomplete"),
      ].filter(Boolean).join("\n");
      return `
  <section class="sev-block ${severityClass(sev)}-section" id="sev-${escapeHtml(sev)}" aria-labelledby="sev-${escapeHtml(sev)}-heading">
    <header class="sev-block-header">
      <div>
        <h2 class="sev-block-title" id="sev-${escapeHtml(sev)}-heading">
          <span class="sev-block-title-label">Severity section</span>
          <span class="badge ${severityClass(sev)}">${escapeHtml(sev)}</span>
        </h2>
        <p class="sev-policy-line">
          <span class="sev-policy-chip">${escapeHtml(sectionPolicyLabel)}</span>
          <span class="outcome-badge ${dispositionClass(sectionDisposition)}">${escapeHtml(
        dispositionLabel(sectionDisposition)
      )}</span>
        </p>
        <p class="sev-breakdown subtle">${issueSummaryLabel}: ${issueCount} · INCOMPLETE: ${incompleteCount}</p>
      </div>
      <a class="sev-block-top-link" href="#top">Back to summary</a>
    </header>
    <div class="sev-block-body">
      ${sectionBody}
    </div>
    <div class="sev-block-end" aria-hidden="true">End of ${String(sev).toUpperCase()} severity section (${escapeHtml(
        dispositionLabel(sectionDisposition).toLowerCase()
      )})</div>
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
      --bg: #0d131b;
      --card: #172130;
      --text: #f2f7ff;
      --muted: #d2deed;
      --border: #617891;
      --link: #8fd1ff;
      --focus: #ffd166;
    }
    * { box-sizing: border-box; }
    html { font-size: 16px; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      margin: 0;
      padding: 1.5rem 1.25rem 3rem;
    }
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 0;
      z-index: 10000;
      padding: 0.55rem 0.75rem;
      border-radius: 8px;
      background: #fff8d6;
      color: #101418;
      border: 2px solid #101418;
      font-weight: 700;
    }
    .skip-link:focus,
    .skip-link:focus-visible {
      left: 1rem;
      top: 1rem;
    }
    .wrap { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
    h2 { font-size: 1.1rem; margin: 0; font-weight: 600; }
    h3 { font-size: 1rem; margin: 0; display: inline; font-weight: 600; }
    a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
    a:hover { color: #b4e0ff; }
    :where(a, button, summary, [role="button"], [tabindex]):focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
      border-radius: 4px;
    }
    .subtle { color: var(--muted); font-size: 1rem; }
    .summary {
      width: 100%;
      border-collapse: collapse;
      background: var(--card);
      border-radius: 8px;
      overflow: hidden;
      margin: 0.5rem 0 1rem;
    }
    .summary th, .summary td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
    .summary th { width: 42%; color: var(--muted); font-weight: 500; }
    .summary-groups {
      display: grid;
      grid-template-columns: minmax(18rem, 1fr);
      gap: 1rem;
      margin: 1rem 0 1.25rem;
    }
    .summary-group {
      background: #111821;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.7rem 0.75rem 0.15rem;
    }
    .summary-group h2 {
      font-size: 1rem;
      margin: 0.15rem 0 0.35rem;
    }
    .summary-group .subtle {
      margin: 0;
    }
    .tech-grid {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0.5rem;
      margin: 0.35rem 0 0.65rem;
    }
    .tech-grid-preview {
      margin: 0.35rem 0 0.35rem;
    }
    .tech-expand {
      margin: 0.2rem 0 0.65rem;
    }
    .tech-expand > summary {
      cursor: pointer;
      list-style: none;
      color: var(--link);
      font-size: 0.88rem;
      font-weight: 600;
      outline: none;
      padding: 0.1rem 0;
    }
    .tech-expand > summary::-webkit-details-marker { display: none; }
    .tech-expand > summary::before {
      content: "▶ ";
      font-size: 0.72rem;
      color: var(--muted);
    }
    .tech-expand[open] > summary::before { content: "▼ "; }
    .tech-expand-hint {
      display: inline-block;
      margin-left: 0.25rem;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 500;
    }
    .tech-grid-expanded {
      margin-top: 0.25rem;
    }
    .tech-cell {
      width: 33.33%;
      vertical-align: top;
      background: #161b22;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.4rem 0.5rem;
    }
    .tech-cell-empty {
      background: transparent;
      border-style: dashed;
      border-color: #232a34;
    }
    .tech-metric summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.22rem;
      outline: none;
    }
    .tech-metric summary::-webkit-details-marker { display: none; }
    .tech-metric summary::before {
      content: "▶";
      font-size: 0.65rem;
      color: var(--muted);
      margin-right: 0.32rem;
      display: inline-block;
      vertical-align: middle;
    }
    .tech-metric[open] summary::before { content: "▼"; }
    .tech-metric-label {
      color: var(--muted);
      font-size: 0.88rem;
      font-weight: 600;
      line-height: 1.25;
    }
    .tech-metric-value {
      color: var(--text);
      font-size: 1.1rem;
      font-weight: 700;
      line-height: 1.1;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      margin-left: 0.98rem;
    }
    .tech-metric-help {
      margin-top: 0.45rem;
      border-top: 1px dashed var(--border);
      padding-top: 0.45rem;
      font-size: 0.84rem;
      color: #c9d1d9;
      line-height: 1.45;
    }
    .tech-metric-help p {
      margin: 0.25rem 0;
    }
    .analysis-option-row {
      display: grid;
      grid-template-columns: minmax(9rem, 13rem) 1fr;
      gap: 0.75rem;
      align-items: baseline;
      margin: 0.45rem 0;
    }
    .analysis-option-label { color: var(--muted); font-size: 0.95rem; font-weight: 700; }
    .analysis-option-values { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .option-pill {
      display: inline-block;
      background: #21262d;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: #c9d1d9;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.9rem;
      padding: 0.12rem 0.45rem;
    }
    .severity-entry-title {
      margin: 2rem 0 0.75rem;
      padding-top: 1.4rem;
      border-top: 3px solid var(--border);
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: #eaf2ff;
    }
    .sev-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0 1rem; }
    .sev-pill { text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.95rem; font-weight: 700; }
    .sev-critical { background: #5f0000; color: #fff0ee; }
    .sev-serious { background: #5b2b00; color: #fff2df; }
    .sev-moderate { background: #3d3518; color: #f3d35a; }
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
    .sev-serious-section { border-color: rgba(255, 166, 87, 0.55); }
    .sev-serious-section .sev-block-header { background: linear-gradient(90deg, rgba(255, 166, 87, 0.24), rgba(255, 166, 87, 0.05)); }
    .sev-moderate-section { border-color: rgba(243, 211, 90, 0.55); }
    .sev-moderate-section .sev-block-header { background: linear-gradient(90deg, rgba(243, 211, 90, 0.22), rgba(243, 211, 90, 0.05)); }
    .sev-minor-section { border-color: rgba(121, 192, 255, 0.5); }
    .sev-minor-section .sev-block-header { background: linear-gradient(90deg, rgba(121, 192, 255, 0.2), rgba(121, 192, 255, 0.04)); }
    .sev-block-eyebrow {
      margin: 0 0 0.35rem;
      color: var(--muted);
      font-size: 0.86rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .sev-block-title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .sev-block-title-label {
      color: var(--muted);
      font-size: 0.86rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .sev-block-top-link {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 0.92rem;
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
    .sev-subsection {
      margin-bottom: 1rem;
    }
    .sev-subsection-title {
      margin: 0.15rem 0 0.6rem;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .sev-subsection-incomplete .sev-subsection-title {
      color: #c4b5fd;
    }
    .sev-block-end {
      margin: 0.25rem 1rem 1rem;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--border);
      color: var(--muted);
      font-size: 0.88rem;
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
    .outcome-badge {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-weight: 700;
    }
    .disp-fail {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      border-color: rgba(248, 81, 73, 0.45);
    }
    .disp-warn {
      background: rgba(227, 179, 65, 0.16);
      color: #e3b341;
      border-color: rgba(227, 179, 65, 0.45);
    }
    .disp-incomplete {
      background: rgba(123, 92, 255, 0.16);
      color: #c4b5fd;
      border-color: rgba(123, 92, 255, 0.5);
    }
    .finding-type-badge {
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-weight: 700;
    }
    .finding-type-incomplete {
      background: rgba(123, 92, 255, 0.16);
      color: #c4b5fd;
      border-color: rgba(123, 92, 255, 0.5);
    }
    .incomplete-note {
      margin: 0.35rem 0 0.55rem;
      color: #c4b5fd;
    }
    .sev-policy-line {
      margin: 0.35rem 0 0;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
    }
    .sev-policy-chip {
      display: inline-block;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: rgba(13, 17, 23, 0.45);
      font-weight: 700;
    }
    .sev-breakdown { margin: 0.45rem 0 0; font-size: 0.88rem; }
    .help { margin: 0.5rem 0; }
    .meta { font-size: 0.9rem; color: var(--muted); }
    .tag { display: inline-block; background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.88rem; margin: 0.1rem; }
    .ext { font-size: 1rem; }
    .nodes { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 0.88rem; margin: 0.75rem 0; }
    .nodes th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--border); padding: 0.4rem; }
    .nodes th:first-child { width: 28%; }
    .nodes th:last-child { width: 72%; }
    .nodes td, .nodes th.col-target {
      vertical-align: top;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid var(--border);
    }
    .nodes th.col-target {
      text-align: left;
      font-weight: 400;
    }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .node-group { border-left: 3px solid #30363d; }
    .node-group--recurrence { border-left-color: #a371f7; }
    .node-group td { background: #161b22; }
    .node-group--recurrence td {
      background: #181225;
      color: #d7c7f3;
    }
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
    .node-recurrence-title { display: block; font-size: 0.86rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #e1c2ff; margin-bottom: 0.3rem; }
    .node-recurrence-body { margin: 0; font-size: 0.84rem; color: #c9d1d9; line-height: 1.45; }
    .node-recurrence-rid { font-size: 0.8rem; background: #0d1117; padding: 0.15rem 0.4rem; border-radius: 4px; }
    .node-recurrence-compact { margin-top: 0.3rem; }
    .node-recurrence-compact-summary {
      cursor: pointer;
      color: var(--link);
      font-size: 0.85rem;
      list-style: none;
      padding: 0;
    }
    .node-recurrence-compact .node-recurrence-compact-summary::-webkit-details-marker { display: none; }
    .node-recurrence-compact-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .node-recurrence-compact[open] .node-recurrence-compact-summary::before { content: "▼ "; }
    .node-recurrence-compact-body { margin-top: 0.4rem; }
    .node-target-label { font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.3rem; }
    .node-priority-chip-wrap { margin: 0 0 0.3rem; }
    .node-priority-chip {
      display: inline-block;
      border-radius: 999px;
      padding: 0.08rem 0.45rem;
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid var(--border);
    }
    .node-priority-new {
      background: rgba(58, 166, 85, 0.16);
      color: #56d364;
      border-color: rgba(86, 211, 100, 0.45);
    }
    .node-priority-repeated {
      background: #3f245f;
      color: #f5e9ff;
      border-color: #8f5ed8;
    }
    .node-target-code { display: block; font-size: 0.8rem; word-break: break-all; }
    .node-page { margin: 0.4rem 0 0; font-size: 0.92rem; word-break: break-all; }
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
    .sc-live-count { color: var(--muted); font-size: 0.8rem; font-weight: 600; }
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
    .pill { display: inline-block; background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; margin-right: 0.25rem; font-size: 0.9rem; }
    .pill.subtle { background: transparent; color: var(--muted); }
    .node-section-bleed .failure-details, .node-section-bleed .html-snippet { width: 100%; max-width: 100%; text-align: left; }
    .failure-details { margin: 0.1rem 0 0.4rem; }
    .failure-summary { cursor: pointer; color: var(--link); font-size: 1rem; list-style: none; text-align: left; padding: 0; }
    .failure-details .failure-summary::-webkit-details-marker { display: none; }
    .failure-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .failure-details[open] .failure-summary::before { content: "▼ "; }
    .failure { white-space: pre-wrap; font-size: 1rem; color: #dce6f5; text-align: left; }
    .failure-body { margin: 0.35rem 0 0.15rem; padding: 0.6rem 0.65rem; background: #0d1117; border-radius: 6px; border: 1px solid var(--border); width: 100%; max-width: 100%; box-sizing: border-box; }
    .failure-empty { margin: 0.25rem 0; }
    .html-snippet { margin: 0; width: 100%; max-width: 100%; }
    .html-snippet-summary { cursor: pointer; color: var(--link); font-size: 1rem; text-align: left; list-style: none; padding: 0; }
    .html-snippet .html-snippet-summary::-webkit-details-marker { display: none; }
    .html-snippet .html-snippet-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .html-snippet[open] .html-snippet-summary::before { content: "▼ "; }
    .code, .code-block-bleed { background: #0d1117; padding: 0.6rem 0.65rem; border-radius: 6px; overflow: auto; max-height: 280px; font-size: 0.9rem; text-align: left; width: 100%; max-width: 100%; box-sizing: border-box; }
    .errors { margin-top: 2rem; }
    .errors ul { color: #f85149; }
    .nodata { color: var(--muted); }
    footer { margin-top: 2rem; font-size: 0.95rem; color: var(--muted); }
    .report-footnote { margin-top: 0.75rem; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to report content</a>
  <main class="wrap" id="main-content">
    <h1 id="top">wick-a11y-observer accessibility report</h1>
    <p class="subtle">Readable summary of grouped axe-core findings (violations and optional incomplete/manual-review items). Open <strong>Rule docs</strong> for remediation.</p>
    <div class="summary-groups" aria-label="Top summary sections">
      <section class="summary-group summary-group-identity" aria-label="Report identity">
        <h2>Report Identity</h2>
        <p class="subtle">Stable report metadata and file references.</p>
        <table class="summary" role="table" aria-label="Report identity summary">
          <tbody>${identityTable}</tbody>
        </table>
      </section>
      <section class="summary-group summary-group-analysis" aria-label="Analysis options">
        ${analysisOptions}
      </section>
      <section class="summary-group summary-group-technical" aria-label="Technical metrics">
        <h2>Technical Metrics</h2>
        <p class="subtle">Click any metric card to see plain-language meaning and how it relates to others.</p>
        <table class="tech-grid tech-grid-preview" role="table" aria-label="Technical metrics preview (first row)">
          <tbody>${technicalRowsPreview}</tbody>
        </table>
        <details class="tech-expand">
          <summary>
            Show more technical metrics
            <span class="tech-expand-hint">(${Math.max(technicalTotalRows - 1, 0)} more row(s) available)</span>
          </summary>
          <table class="tech-grid tech-grid-expanded" role="table" aria-label="Technical metrics additional rows">
            <tbody>${technicalRowsExpandedRemainder || '<tr><td class="tech-cell tech-cell-empty" colspan="3">No additional rows.</td></tr>'}</tbody>
          </table>
        </details>
      </section>
    </div>
    <h2 class="severity-entry-title">By severity (grouped findings)</h2>
    <div class="sev-pills">${sevPills || "<span class=\"subtle\">No grouped findings in output.</span>"}</div>
    ${errorsBlock}
    ${bySeveritySections || "<p class=\"subtle\">No grouped findings to show.</p>"}
    <footer>
      <p>Generated for interactive review — keep JSON for machine use.</p>
      <p class="report-footnote">${footnoteHtml}</p>
    </footer>
  </main>
</body>
</html>`;
};

module.exports = {
  renderLiveA11yReportHtml,
  escapeHtml,
};
