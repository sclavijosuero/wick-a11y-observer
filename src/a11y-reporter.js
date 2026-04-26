const fs = require("fs");
const path = require("path");
const { A11Y_REPORT_DISCLAIMER, A11Y_REPORT_DISCLAIMER_LINES } = require("./a11y-disclaimer");
const { renderLiveA11yReportHtml } = require("./a11y-html-template");

const SEVERITY_ORDER = ["critical", "serious", "moderate", "minor"];
const TEST_SELECTOR_ATTRIBUTES = [
  "data-cy",
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-qa-id",
  "data-automation-id",
  "data-automationid",
];
const DEFAULT_ACCESSIBILITY_RESULTS_FOLDER = "cypress/accessibility";
const DEFAULT_ACCESSIBILITY_REPORT_FILE_NAME = "accessibility-results.json";
const DEFAULT_ACCESSIBILITY_REPORT_PATH = `${DEFAULT_ACCESSIBILITY_RESULTS_FOLDER}/${DEFAULT_ACCESSIBILITY_REPORT_FILE_NAME}`;

const severityRank = (impact) => {
  const normalized = String(impact || "").toLowerCase();
  const index = SEVERITY_ORDER.indexOf(normalized);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const escapeSelectorAttrValue = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

const extractPreferredTestingSelector = (selectorFragment = "", htmlSnippet = "") => {
  const selectorSource = String(selectorFragment || "");
  const htmlSource = String(htmlSnippet || "");

  for (const attr of TEST_SELECTOR_ATTRIBUTES) {
    const selectorRegex = new RegExp(
      `\\[${attr}\\s*=\\s*["']?([^"'\\]\\s>]+)["']?\\]`,
      "i"
    );
    const selectorMatch = selectorSource.match(selectorRegex);
    if (selectorMatch?.[1]) {
      return `[${attr}="${escapeSelectorAttrValue(selectorMatch[1])}"]`;
    }

    const htmlRegex = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
    const htmlMatch = htmlSource.match(htmlRegex);
    if (htmlMatch?.[1]) {
      return `[${attr}="${escapeSelectorAttrValue(htmlMatch[1])}"]`;
    }
  }

  return null;
};

const normalizeTargetPath = (target, htmlSnippet) => {
  const toStringPath = () => {
    if (Array.isArray(target)) {
      if (target.length === 0) return "<unknown>";
      if (target.length === 1) return String(target[0] || "<unknown>");
      const first = String(target[0] || "").trim();
      const rest = target
        .slice(1)
        .map((part) => String(part || "").trim())
        .filter(Boolean);

      if (first.startsWith("iframe")) {
        return `${first} >>> ${rest.join(" > ")}`;
      }
      return [first, ...rest].join(" > ");
    }
    return String(target || "<unknown>");
  };

  const rawPath = toStringPath();
  // If an iframe path is expressed as "iframe[...] > ...", normalize to ">>>"
  // to consistently represent frame-boundary hops.
  if (rawPath.startsWith("iframe") && rawPath.includes(" > ") && !rawPath.includes(" >>> ")) {
    return rawPath.replace(" > ", " >>> ");
  }
  const frameSplitIndex = rawPath.lastIndexOf(" >>> ");
  const hasFramePrefix = frameSplitIndex > -1;
  const framePrefix = hasFramePrefix ? rawPath.slice(0, frameSplitIndex) : "";
  const leafSelector = hasFramePrefix ? rawPath.slice(frameSplitIndex + 5) : rawPath;
  const preferredLeaf = extractPreferredTestingSelector(leafSelector, htmlSnippet);
  if (!preferredLeaf) return rawPath;

  return hasFramePrefix ? `${framePrefix} >>> ${preferredLeaf}` : preferredLeaf;
};

/**
 * Normalizes a page URL for stable equality in merge keys and repeated-node detection.
 * @param {string | null | undefined} u
 * @returns {string}
 */
const normalizePageUrlKey = (u) => {
  if (u == null) return "";
  const s = String(u).trim();
  if (s === "") return "";
  try {
    if (/^https?:\/\//i.test(s)) {
      return new URL(s).href;
    }
  } catch {
    // fall through
  }
  return s;
};

const sameNodeIdentity = (a, b) => {
  const ta = a?.rawTarget || a?.target || "<unknown>";
  const tb = b?.rawTarget || b?.target || "<unknown>";
  if (ta !== tb) return false;
  return normalizePageUrlKey(a?.pageUrl) === normalizePageUrlKey(b?.pageUrl);
};

/**
 * Same string as cypress/support/commands.js `nodeViolationKey` (rule + target + page).
 * @param {string} ruleId
 * @param {string} [target]
 * @param {string} [pageUrl]
 * @returns {string}
 */
const buildNodeRepeatKey = (ruleId, target, pageUrl) =>
  `${ruleId}@@${target || "<unknown>"}@@${normalizePageUrlKey(pageUrl)}`;

/**
 * Marks nodes that already appeared in an earlier `reportLiveA11yResults` in this spec (Cypress only).
 * @param {object[]} groupedViolations
 * @param {{ previousNodeKeys?: string[], firstReportIdByKey?: Record<string, string> } | null | undefined} repeatInfo
 */
const enrichNodesWithCrossReportRepeat = (groupedViolations, repeatInfo) => {
  if (!repeatInfo || !Array.isArray(groupedViolations)) {
    return;
  }
  const prev = new Set(repeatInfo.previousNodeKeys || []);
  const byKey = repeatInfo.firstReportIdByKey && typeof repeatInfo.firstReportIdByKey === "object"
    ? repeatInfo.firstReportIdByKey
    : {};
  for (const v of groupedViolations) {
    if (!v?.id || !Array.isArray(v.nodeDetails)) {
      continue;
    }
    for (const node of v.nodeDetails) {
      const k = buildNodeRepeatKey(v.id, node.rawTarget || node.target, node.pageUrl);
      if (prev.has(k)) {
        node.repeatedFromEarlierReport = true;
        const rid = byKey[k];
        node.firstReportId = typeof rid === "string" && rid ? rid : null;
      }
    }
  }
};

/**
 * Human-readable label for a live scan row (shown next to "Live" counts in reports).
 * @param {object} scan
 * @returns {string}
 */
const formatLiveScanSourceLabel = (scan) => {
  if (!scan) return "unknown";
  const t = scan.rootType || "unknown";
  const monId = scan.rootId != null ? String(scan.rootId) : "n/a";
  if (t === "full-page-fallback" && (monId === "document" || monId === "n/a")) {
    return "Live · full-page fallback (entire document)";
  }
  const htmlId = scan.rootHtmlId && String(scan.rootHtmlId).trim() !== "" ? String(scan.rootHtmlId).trim() : null;
  if (htmlId) {
    return `Live · DOM id="${htmlId}" · live-axe root #${monId}`;
  }
  const typePretty = t === "full-page-fallback" ? "full-page fallback" : t;
  return `Live · ${typePretty} · live-axe root #${monId}`;
};

const getConfiguredSeverities = (results) => {
  const configured = results?.meta?.analysis?.configuredImpactLevels;
  if (!Array.isArray(configured) || configured.length === 0) {
    return [...SEVERITY_ORDER];
  }

  const configuredSet = new Set(configured.map((severity) => String(severity).toLowerCase()));
  const filtered = SEVERITY_ORDER.filter((severity) => configuredSet.has(severity));
  return filtered.length > 0 ? filtered : [...SEVERITY_ORDER];
};

const toViolationDetails = (results) => {
  const initialPage = normalizePageUrlKey(results?.initialPageUrl);

  const initialViolations = (results?.initial?.violations || []).map((violation) => ({
    phase: "initial",
    source: "full-page",
    sourceLabel: "Initial scan (full page)",
    id: violation.id,
    impact: violation.impact || "none",
    help: violation.help,
    helpUrl: violation.helpUrl,
    description: violation.description,
    tags: violation.tags || [],
    nodes: (violation.nodes || []).map((node) => normalizeTargetPath(node.target, node.html)),
    nodeDetails: (violation.nodes || []).map((node) => ({
      rawTarget: normalizeTargetPath(node.target),
      target: normalizeTargetPath(node.target, node.html),
      pageUrl: initialPage,
      html: node.html,
      failureSummary: node.failureSummary,
      any: node.any || [],
      all: node.all || [],
      none: node.none || [],
    })),
    rawViolation: violation,
  }));

  const liveViolations = (results?.live || []).flatMap((scan) => {
    const pageFromScan = normalizePageUrlKey(scan?.url);
    return (scan?.results?.violations || []).map((violation) => ({
      phase: "live",
      source: `${scan.rootType || "unknown"}:${scan.rootId != null ? String(scan.rootId) : "n/a"}`,
      sourceLabel: formatLiveScanSourceLabel(scan),
      id: violation.id,
      impact: violation.impact || "none",
      help: violation.help,
      helpUrl: violation.helpUrl,
      description: violation.description,
      tags: violation.tags || [],
      nodes: (violation.nodes || []).map((node) => normalizeTargetPath(node.target, node.html)),
      nodeDetails: (violation.nodes || []).map((node) => ({
        rawTarget: normalizeTargetPath(node.target),
        target: normalizeTargetPath(node.target, node.html),
        pageUrl: pageFromScan,
        html: node.html,
        failureSummary: node.failureSummary,
        any: node.any || [],
        all: node.all || [],
        none: node.none || [],
      })),
      rawViolation: violation,
    }));
  });

  return [...initialViolations, ...liveViolations];
};

const groupViolations = (violationDetails) => {
  const byRule = new Map();

  violationDetails.forEach((violation) => {
    let existing = byRule.get(violation.id);

    if (!existing) {
      existing = {
        id: violation.id,
        impact: violation.impact || "none",
        help: violation.help,
        helpUrl: violation.helpUrl,
        description: violation.description,
        tags: violation.tags || [],
        totalOccurrences: 1,
        phases: [violation.phase],
        sources: [violation.source],
        sourceLabels: [violation.sourceLabel || violation.source],
        nodes: [],
        nodeDetails: [],
        uniqueNodeCount: 0,
        rawViolations: [
          {
            phase: violation.phase,
            source: violation.source,
            raw: violation.rawViolation,
          },
        ],
      };
      byRule.set(violation.id, existing);
    } else {
      existing.totalOccurrences += 1;

      if (severityRank(violation.impact) < severityRank(existing.impact)) {
        existing.impact = violation.impact || existing.impact;
      }
      if (!existing.phases.includes(violation.phase)) {
        existing.phases.push(violation.phase);
      }
      if (!existing.sources.includes(violation.source)) {
        existing.sources.push(violation.source);
        existing.sourceLabels.push(violation.sourceLabel || violation.source);
      }

      existing.rawViolations.push({
        phase: violation.phase,
        source: violation.source,
        raw: violation.rawViolation,
      });
    }

    (violation.nodeDetails || []).forEach((node) => {
      const currentNode = existing.nodeDetails.find((current) => sameNodeIdentity(current, node));

      if (!currentNode) {
        existing.nodeDetails.push({
          ...node,
          phases: [violation.phase],
          sources: [violation.source],
          sourceLabels: [violation.sourceLabel || violation.source],
          initialDetections: violation.phase === "initial" ? 1 : 0,
          liveDetections: violation.phase === "live" ? 1 : 0,
        });
      } else {
        if (!currentNode.phases.includes(violation.phase)) {
          currentNode.phases.push(violation.phase);
        }
        if (!currentNode.sourceLabels) {
          currentNode.sourceLabels = currentNode.sources.map((s) => s);
        }
        if (!currentNode.sources.includes(violation.source)) {
          currentNode.sources.push(violation.source);
          currentNode.sourceLabels.push(violation.sourceLabel || violation.source);
        }
        if (violation.phase === "initial") {
          currentNode.initialDetections = (currentNode.initialDetections || 0) + 1;
        }
        if (violation.phase === "live") {
          currentNode.liveDetections = (currentNode.liveDetections || 0) + 1;
        }
      }
    });

    existing.nodes = existing.nodeDetails.map((n) => n.target);
    existing.uniqueNodeCount = existing.nodeDetails.length;
  });

  return [...byRule.values()].sort((a, b) => {
    const severityDiff = severityRank(a.impact) - severityRank(b.impact);
    if (severityDiff !== 0) return severityDiff;
    return a.id.localeCompare(b.id);
  });
};

const buildLiveA11yReport = (results) => {
  const violationDetails = toViolationDetails(results);
  const configuredSeverities = getConfiguredSeverities(results);
  const groupedViolations = groupViolations(violationDetails).filter((violation) =>
    configuredSeverities.includes(String(violation?.impact || "").toLowerCase())
  );
  const initialNodesWithViolations = new Set(
    violationDetails
      .filter((entry) => entry.phase === "initial")
      .flatMap((entry) => entry.nodeDetails || [])
      .map((node) => node?.target)
      .filter(Boolean)
  );
  const liveNodesWithViolations = new Set(
    violationDetails
      .filter((entry) => entry.phase === "live")
      .flatMap((entry) => entry.nodeDetails || [])
      .map((node) => node?.target)
      .filter(Boolean)
  );
  const liveViolationIds = new Set(
    violationDetails
      .filter((entry) => entry.phase === "live")
      .map((entry) => entry.id)
  );
  const countsBySeverity = configuredSeverities.reduce((acc, severity) => {
    acc[severity] = groupedViolations.filter((v) => v.impact === severity).length;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    meta: results?.meta || {},
    errors: results?.errors || [],
    counts: {
      initialScans: results?.initial ? 1 : 0,
      initialViolations: results?.initial?.violations?.length || 0,
      initialNodesWithViolations: initialNodesWithViolations.size,
      liveScans: results?.live?.length || 0,
      liveViolations: liveViolationIds.size,
      liveNodesWithViolations: liveNodesWithViolations.size,
      groupedViolations: groupedViolations.length,
      groupedBySeverity: countsBySeverity,
    },
    severityOrder: configuredSeverities,
    groupedViolations,
    raw: results,
  };
};

const validateLiveA11yReport = (report, validation = {}) => {
  const options = {
    enabled: true,
    requireInitialScan: true,
    minLiveScans: 1,
    requireNoRuntimeErrors: true,
    minUniqueLiveRuleIds: 0,
    requiredLiveRuleIds: [],
    minGroupedBySeverity: {},
    ...validation,
  };

  if (!options.enabled) {
    return { valid: true, errors: [] };
  }

  const issues = [];
  const counts = report?.counts || {};
  const errors = report?.errors || [];
  const liveRuleIds = [
    ...new Set(
      (report?.raw?.live || [])
        .flatMap((scan) => scan?.results?.violations || [])
        .map((violation) => violation?.id)
        .filter(Boolean)
    ),
  ];

  if (options.requireInitialScan && (counts.initialScans || 0) < 1) {
    issues.push("Expected an initial scan, but none was captured.");
  }

  if ((counts.liveScans || 0) < Number(options.minLiveScans || 0)) {
    issues.push(
      `Expected at least ${options.minLiveScans} live scans, got ${counts.liveScans || 0}.`
    );
  }

  if (options.requireNoRuntimeErrors && errors.length > 0) {
    issues.push(`Expected no monitor runtime errors, got ${errors.length}.`);
  }

  if (liveRuleIds.length < Number(options.minUniqueLiveRuleIds || 0)) {
    issues.push(
      `Expected at least ${options.minUniqueLiveRuleIds} unique live rule IDs, got ${liveRuleIds.length}.`
    );
  }

  for (const ruleId of options.requiredLiveRuleIds || []) {
    if (!liveRuleIds.includes(ruleId)) {
      issues.push(`Expected live rule ID "${ruleId}" was not found.`);
    }
  }

  const groupedBySeverity = counts.groupedBySeverity || {};
  Object.entries(options.minGroupedBySeverity || {}).forEach(([severity, minCount]) => {
    const required = Number(minCount || 0);
    const actual = Number(groupedBySeverity[severity] || 0);
    if (actual < required) {
      issues.push(
        `Expected at least ${required} grouped "${severity}" violations, got ${actual}.`
      );
    }
  });

  return {
    valid: issues.length === 0,
    errors: issues,
    liveRuleIds,
  };
};

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

const registerLiveA11yReporterTasks = (on) => {
  on("task", {
    "liveA11y:buildReport"({
      results,
      outputPath = DEFAULT_ACCESSIBILITY_REPORT_PATH,
      validation = {},
      reportMeta = undefined,
      repeatInfo = undefined,
    }) {
      const report = buildLiveA11yReport(results);
      enrichNodesWithCrossReportRepeat(report.groupedViolations, repeatInfo);
      const validationResult = validateLiveA11yReport(report, validation);
      const absolutePath = path.resolve(outputPath);
      const payload = {
        ...report,
        reportArtifact: attachReportArtifact(outputPath, absolutePath, reportMeta),
        footnote: {
          text: A11Y_REPORT_DISCLAIMER,
          lines: A11Y_REPORT_DISCLAIMER_LINES,
        },
      };
      const savedTo = writeJson(outputPath, payload);
      const savedHtmlTo = writeLiveA11yHtmlReport(outputPath, {
        ...payload,
        validation: validationResult,
      });

      const htmlReportRelative = String(outputPath)
        .replace(/\\/g, "/")
        .replace(/\.json$/i, ".html");

      if (!validationResult.valid) {
        throw new Error(
          `Live axe validation failed:\n- ${validationResult.errors.join("\n- ")}`
        );
      }

      return {
        ...payload,
        savedTo,
        savedHtmlTo,
        htmlReportRelative,
        validation: validationResult,
      };
    },
  });
};

module.exports = {
  registerLiveA11yReporterTasks,
  normalizePageUrlKey,
  sameNodeIdentity,
  buildNodeRepeatKey,
  enrichNodesWithCrossReportRepeat,
  SEVERITY_ORDER,
};
