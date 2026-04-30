/**
 * Core live-a11y reporting logic (build/validate/summary): no filesystem or console I/O here.
 */

const {
  DEFAULT_ACCESSIBILITY_RESULTS_FOLDER,
  DEFAULT_ACCESSIBILITY_REPORT_FILE_NAME,
  AXE_IMPACT_ORDER,
} = require("./a11y-shared-constants");
const {
  buildTechnicalMetricOrder,
  TECHNICAL_METRIC_HELP,
} = require("./a11y-reporter-technical-metrics");

const SEVERITY_ORDER = AXE_IMPACT_ORDER;
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
const IMPACT_LEVEL_SET = new Set(SEVERITY_ORDER);

const omitIncompleteField = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const { incomplete, ...rest } = value;
  return rest;
};

const stripIncompleteFindingsFromRawResults = (results) => {
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    return results;
  }
  const nextResults = {
    ...results,
  };
  if (nextResults.initial && typeof nextResults.initial === "object") {
    nextResults.initial = omitIncompleteField(nextResults.initial);
  }
  if (Array.isArray(nextResults.live)) {
    nextResults.live = nextResults.live.map((scan) => {
      if (!scan || typeof scan !== "object" || Array.isArray(scan)) {
        return scan;
      }
      const nextScan = {
        ...scan,
      };
      if (nextScan.results && typeof nextScan.results === "object") {
        nextScan.results = omitIncompleteField(nextScan.results);
      }
      return nextScan;
    });
  }
  return nextResults;
};

const normalizeAccessibilityResultsFolder = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
};

const resolveDefaultAccessibilityReportPath = (accessibilityFolder) => {
  const normalizedFolder = normalizeAccessibilityResultsFolder(accessibilityFolder);
  const resolvedFolder = normalizedFolder || DEFAULT_ACCESSIBILITY_RESULTS_FOLDER;
  return `${resolvedFolder}/${DEFAULT_ACCESSIBILITY_REPORT_FILE_NAME}`;
};

const severityRank = (impact) => {
  const normalized = String(impact || "").toLowerCase();
  const index = SEVERITY_ORDER.indexOf(normalized);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const normalizeSeverities = (values) => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((severity) => String(severity || "").toLowerCase()))].filter((severity) =>
    IMPACT_LEVEL_SET.has(severity)
  );
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

const buildNodeIdentityKey = (target, pageUrl) =>
  `${String(target || "<unknown>")}@@${normalizePageUrlKey(pageUrl)}`;

const buildRulePageKey = (ruleId, pageUrl, findingType = "violation") =>
  `${String(findingType || "violation")}@@${String(ruleId || "<unknown-rule>")}@@${normalizePageUrlKey(pageUrl)}`;

const buildRulePageKeysFromEntry = (entry) => {
  const pages = new Set(
    (entry?.nodeDetails || [])
      .map((node) => normalizePageUrlKey(node?.pageUrl))
      .filter((value) => value !== "")
  );
  if (pages.size === 0) {
    return [buildRulePageKey(entry?.id, "", entry?.findingType)];
  }
  return [...pages].map((pageUrl) => buildRulePageKey(entry?.id, pageUrl, entry?.findingType));
};

const sameNodeIdentity = (a, b) => {
  const ta = a?.rawTarget || a?.target || "<unknown>";
  const tb = b?.rawTarget || b?.target || "<unknown>";
  if (ta !== tb) return false;
  return normalizePageUrlKey(a?.pageUrl) === normalizePageUrlKey(b?.pageUrl);
};

/**
 * Same string as cypress/support/commands.js `nodeViolationKey` (target + page).
 * @param {string} [target]
 * @param {string} [pageUrl]
 * @returns {string}
 */
const buildNodeRepeatKey = (target, pageUrl) =>
  `${target || "<unknown>"}@@${normalizePageUrlKey(pageUrl)}`;

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
      const k = buildNodeRepeatKey(node.rawTarget || node.target, node.pageUrl);
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

const getConfiguredImpactPolicy = (results) => {
  const analysis = results?.meta?.analysis || {};
  const hasExplicitIncluded = Object.prototype.hasOwnProperty.call(
    analysis,
    "configuredIncludedImpactLevels"
  );
  const hasExplicitWarn = Object.prototype.hasOwnProperty.call(
    analysis,
    "configuredWarnImpactLevels"
  );
  const hasLegacyConfigured = Object.prototype.hasOwnProperty.call(
    analysis,
    "configuredImpactLevels"
  );
  const hasExplicitPolicy = hasExplicitIncluded || hasExplicitWarn || hasLegacyConfigured;
  const explicitIncluded = normalizeSeverities(analysis.configuredIncludedImpactLevels);
  const explicitWarn = normalizeSeverities(analysis.configuredWarnImpactLevels);
  const legacyConfigured = normalizeSeverities(analysis.configuredImpactLevels);

  const included = hasExplicitIncluded ? explicitIncluded : legacyConfigured;
  const includedSet = new Set(included);
  const warnBase = hasExplicitWarn ? explicitWarn : [];
  const warn = warnBase.filter((severity) => !includedSet.has(severity));
  const considered = [...new Set([...included, ...warn])];

  if (considered.length === 0 && !hasExplicitPolicy) {
    return {
      included: [...SEVERITY_ORDER],
      warn: [],
      considered: [...SEVERITY_ORDER],
    };
  }

  return {
    included,
    warn,
    considered,
  };
};

const getConfiguredSeverities = (results) => {
  const configured = getConfiguredImpactPolicy(results).considered;
  if (configured.length === 0) {
    return [];
  }
  const configuredSet = new Set(configured);
  return SEVERITY_ORDER.filter((severity) => configuredSet.has(severity));
};

const findingResultTypeFor = (findingType) => (findingType === "incomplete" ? "incomplete" : "violations");

const toFindingDetails = (results, findingType = "violation") => {
  const resultType = findingResultTypeFor(findingType);
  const initialPage = normalizePageUrlKey(results?.initialPageUrl);

  const initialFindings = (results?.initial?.[resultType] || []).map((violation) => ({
    phase: "initial",
    source: "full-page",
    sourceLabel: "Initial scan (full page)",
    findingType,
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

  const liveFindings = (results?.live || []).flatMap((scan) => {
    const pageFromScan = normalizePageUrlKey(scan?.url);
    return (scan?.results?.[resultType] || []).map((violation) => ({
      phase: "live",
      source: `${scan.rootType || "unknown"}:${scan.rootId != null ? String(scan.rootId) : "n/a"}`,
      sourceLabel: formatLiveScanSourceLabel(scan),
      findingType,
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

  return [...initialFindings, ...liveFindings];
};

const groupViolations = (violationDetails) => {
  const byRule = new Map();

  violationDetails.forEach((violation) => {
    const findingKey = `${String(violation.findingType || "violation")}@@${String(violation.id || "<unknown-rule>")}`;
    let existing = byRule.get(findingKey);

    if (!existing) {
      existing = {
        findingType: violation.findingType || "violation",
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
            findingType: violation.findingType || "violation",
            raw: violation.rawViolation,
          },
        ],
      };
      byRule.set(findingKey, existing);
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
        findingType: violation.findingType || "violation",
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
          sourceOccurrenceCounts: {
            [violation.sourceLabel || violation.source]: 1,
          },
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
        const sourceKey = violation.sourceLabel || violation.source;
        currentNode.sourceOccurrenceCounts = currentNode.sourceOccurrenceCounts || {};
        currentNode.sourceOccurrenceCounts[sourceKey] =
          (currentNode.sourceOccurrenceCounts[sourceKey] || 0) + 1;
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
    const aFindingRank = String(a.findingType || "violation") === "incomplete" ? 1 : 0;
    const bFindingRank = String(b.findingType || "violation") === "incomplete" ? 1 : 0;
    if (aFindingRank !== bFindingRank) return aFindingRank - bFindingRank;
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return String(a.findingType || "violation").localeCompare(String(b.findingType || "violation"));
  });
};

const buildLiveA11yReport = (results, options = {}) => {
  const includeIncompleteInReport = options?.includeIncompleteInReport === true;
  const violationDetails = toFindingDetails(results, "violation");
  const incompleteDetails = includeIncompleteInReport
    ? toFindingDetails(results, "incomplete")
    : [];
  const findingDetails = [...violationDetails, ...incompleteDetails];
  const configuredSeverities = getConfiguredSeverities(results);
  const impactPolicy = getConfiguredImpactPolicy(results);
  const failSeverities = new Set(impactPolicy.included);
  const warnSeverities = new Set(impactPolicy.warn);
  const groupedViolations = groupViolations(findingDetails).filter((violation) =>
    configuredSeverities.includes(String(violation?.impact || "").toLowerCase())
  ).map((violation) => {
    if (violation?.findingType === "incomplete") {
      return {
        ...violation,
        disposition: "incomplete",
      };
    }
    const severity = String(violation?.impact || "").toLowerCase();
    const disposition = failSeverities.has(severity)
      ? "fail"
      : warnSeverities.has(severity)
        ? "warn"
        : "fail";
    return {
      ...violation,
      disposition,
    };
  });
  const initialNodesWithViolations = new Set(
    violationDetails
      .filter((entry) => entry.phase === "initial")
      .flatMap((entry) =>
        (entry.nodeDetails || []).map((node) => buildNodeIdentityKey(node?.target, node?.pageUrl))
      )
      .filter(Boolean)
  );
  const liveNodesWithViolations = new Set(
    violationDetails
      .filter((entry) => entry.phase === "live")
      .flatMap((entry) =>
        (entry.nodeDetails || []).map((node) => buildNodeIdentityKey(node?.target, node?.pageUrl))
      )
      .filter(Boolean)
  );
  const liveDistinctNodesWithIssuesExcludingInitial = new Set(
    [...liveNodesWithViolations].filter((key) => !initialNodesWithViolations.has(key))
  );
  const initialNodesWithIncomplete = new Set(
    incompleteDetails
      .filter((entry) => entry.phase === "initial")
      .flatMap((entry) =>
        (entry.nodeDetails || []).map((node) => buildNodeIdentityKey(node?.target, node?.pageUrl))
      )
      .filter(Boolean)
  );
  const liveNodesWithIncomplete = new Set(
    incompleteDetails
      .filter((entry) => entry.phase === "live")
      .flatMap((entry) =>
        (entry.nodeDetails || []).map((node) => buildNodeIdentityKey(node?.target, node?.pageUrl))
      )
      .filter(Boolean)
  );
  const liveDistinctNodesWithIncompleteExcludingInitial = new Set(
    [...liveNodesWithIncomplete].filter((key) => !initialNodesWithIncomplete.has(key))
  );
  const initialRulePageKeys = new Set(
    violationDetails
      .filter((entry) => entry.phase === "initial")
      .flatMap((entry) => buildRulePageKeysFromEntry(entry))
      .filter(Boolean)
  );
  const liveRulePageKeys = new Set(
    violationDetails
      .filter((entry) => entry.phase === "live")
      .flatMap((entry) => buildRulePageKeysFromEntry(entry))
      .filter(Boolean)
  );
  const liveDistinctViolationGroupsExcludingInitial = new Set(
    [...liveRulePageKeys].filter((key) => !initialRulePageKeys.has(key))
  );
  const initialIncompleteRulePageKeys = new Set(
    incompleteDetails
      .filter((entry) => entry.phase === "initial")
      .flatMap((entry) => buildRulePageKeysFromEntry(entry))
      .filter(Boolean)
  );
  const liveIncompleteRulePageKeys = new Set(
    incompleteDetails
      .filter((entry) => entry.phase === "live")
      .flatMap((entry) => buildRulePageKeysFromEntry(entry))
      .filter(Boolean)
  );
  const liveDistinctIncompleteGroupsExcludingInitial = new Set(
    [...liveIncompleteRulePageKeys].filter((key) => !initialIncompleteRulePageKeys.has(key))
  );
  const liveViolationIds = new Set(
    violationDetails
      .filter((entry) => entry.phase === "live")
      .map((entry) => entry.id)
  );
  const liveIncompleteIds = new Set(
    incompleteDetails
      .filter((entry) => entry.phase === "live")
      .map((entry) => entry.id)
  );
  const countsBySeverity = configuredSeverities.reduce((acc, severity) => {
    acc[severity] = groupedViolations.filter(
      (v) => String(v?.impact || "").toLowerCase() === severity
    ).length;
    return acc;
  }, {});
  const groupedBySeverityDisposition = configuredSeverities.reduce((acc, severity) => {
    const bySeverity = groupedViolations.filter(
      (violation) => String(violation?.impact || "").toLowerCase() === severity
    );
    const fail = bySeverity.filter((violation) => violation.disposition === "fail").length;
    const warn = bySeverity.filter((violation) => violation.disposition === "warn").length;
    const incomplete = bySeverity.filter((violation) => violation.disposition === "incomplete").length;
    const sectionType = fail > 0
      ? "violation"
      : warn > 0
        ? "warning"
        : includeIncompleteInReport && incomplete > 0
          ? "incomplete"
          : "none";
    acc[severity] = {
      fail,
      warn,
      ...(includeIncompleteInReport ? { incomplete } : {}),
      sectionType,
    };
    return acc;
  }, {});
  const groupedByDisposition = {
    fail: groupedViolations.filter((violation) => violation.disposition === "fail").length,
    warn: groupedViolations.filter((violation) => violation.disposition === "warn").length,
    ...(includeIncompleteInReport
      ? {
        incomplete: groupedViolations.filter((violation) => violation.disposition === "incomplete").length,
      }
      : {}),
  };
  const groupedBySeverityIssues = configuredSeverities.reduce((acc, severity) => {
    const bySeverity = groupedViolations.filter(
      (violation) => String(violation?.impact || "").toLowerCase() === severity
    );
    acc[severity] = bySeverity.filter(
      (violation) => violation.disposition === "fail" || violation.disposition === "warn"
    ).length;
    return acc;
  }, {});
  const groupedBySeverityIncomplete = includeIncompleteInReport
    ? configuredSeverities.reduce((acc, severity) => {
      const bySeverity = groupedViolations.filter(
        (violation) => String(violation?.impact || "").toLowerCase() === severity
      );
      acc[severity] = bySeverity.filter((violation) => violation.disposition === "incomplete").length;
      return acc;
    }, {})
    : undefined;
  const groupedFindingsTotal = groupedViolations.length;
  const groupedIssuesTotal = groupedByDisposition.fail + groupedByDisposition.warn;

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
      liveDistinctViolationInstancesExcludingInitial:
        liveDistinctViolationGroupsExcludingInitial.size,
      liveDistinctNodesWithIssuesExcludingInitial:
        liveDistinctNodesWithIssuesExcludingInitial.size,
      totalNodesInitialPlusLiveDistinct:
        initialNodesWithViolations.size + liveDistinctNodesWithIssuesExcludingInitial.size,
      totalViolationsInitialPlusLiveDistinct:
        (results?.initial?.violations?.length || 0) + liveDistinctViolationGroupsExcludingInitial.size,
      groupedViolations: groupedIssuesTotal,
      groupedFindingsTotal,
      groupedBySeverity: countsBySeverity,
      groupedBySeverityIssues,
      ...(includeIncompleteInReport ? { groupedBySeverityIncomplete } : {}),
      groupedBySeverityDisposition,
      groupedByDisposition,
      ...(includeIncompleteInReport
        ? {
          initialIncomplete: results?.initial?.incomplete?.length || 0,
          initialNodesWithIncomplete: initialNodesWithIncomplete.size,
          liveIncomplete: liveIncompleteIds.size,
          liveNodesWithIncomplete: liveNodesWithIncomplete.size,
          liveDistinctIncompleteInstancesExcludingInitial:
            liveDistinctIncompleteGroupsExcludingInitial.size,
          liveDistinctNodesWithIncompleteExcludingInitial:
            liveDistinctNodesWithIncompleteExcludingInitial.size,
          totalNodesIncompleteInitialPlusLiveDistinct:
            initialNodesWithIncomplete.size + liveDistinctNodesWithIncompleteExcludingInitial.size,
          totalIncompleteInitialPlusLiveDistinct:
            (results?.initial?.incomplete?.length || 0) +
            liveDistinctIncompleteGroupsExcludingInitial.size,
          groupedIncomplete: groupedByDisposition.incomplete,
        }
        : {}),
    },
    severityOrder: configuredSeverities,
    impactPolicy,
    reportOptions: {
      includeIncompleteInReport,
    },
    groupedViolations,
    raw: includeIncompleteInReport ? results : stripIncompleteFindingsFromRawResults(results),
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
    failOnIncludedImpacts: true,
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

  if (options.failOnIncludedImpacts) {
    const failCount = Number(report?.counts?.groupedByDisposition?.fail || 0);
    if (failCount > 0) {
      const failSummary = (report?.groupedViolations || [])
        .filter((violation) => violation.disposition === "fail")
        .map((violation) => `${violation.id} (${violation.impact})`)
        .slice(0, 8);
      const extra = failSummary.length > 0
        ? ` Top failing grouped rules: ${failSummary.join(", ")}${failCount > failSummary.length ? ", ..." : ""}.`
        : "";
      issues.push(
        `Found ${failCount} grouped violations in failing impacts.${extra}`
      );
    }
  }

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

const buildCrossReportDuplicateStats = (groupedViolations = []) => {
  const duplicateGroupedIssueKeys = new Set();
  const duplicateGroupedIncompleteKeys = new Set();
  const duplicateNodeKeys = new Set();

  (Array.isArray(groupedViolations) ? groupedViolations : []).forEach((violation) => {
    const ruleId = String(violation?.id || "<unknown-rule>");
    const findingType = String(violation?.findingType || "violation");
    (Array.isArray(violation?.nodeDetails) ? violation.nodeDetails : []).forEach((node) => {
      if (!node?.repeatedFromEarlierReport) {
        return;
      }
      const target = node?.rawTarget || node?.target;
      const nodeKey = buildNodeIdentityKey(target, node?.pageUrl);
      duplicateNodeKeys.add(nodeKey);
      const groupedKey = buildRulePageKey(ruleId, node?.pageUrl, findingType);
      if (findingType === "incomplete") {
        duplicateGroupedIncompleteKeys.add(groupedKey);
      } else {
        duplicateGroupedIssueKeys.add(groupedKey);
      }
    });
  });

  return {
    duplicatedViolationsFromEarlierReports: duplicateGroupedIssueKeys.size,
    duplicatedIncompleteFindingsFromEarlierReports: duplicateGroupedIncompleteKeys.size,
    duplicatedNodesFromEarlierReports: duplicateNodeKeys.size,
  };
};

const buildReportSummary = (payload = {}) => {
  const artifact = payload.reportArtifact || {};
  const counts = payload.counts || {};
  const monitorMeta = payload.meta || {};
  const includeIncompleteInReport = payload?.reportOptions?.includeIncompleteInReport === true;
  const validationStatus = String(payload?.validation?.status || "—").toUpperCase();
  const duplicateStats = buildCrossReportDuplicateStats(payload.groupedViolations);
  const reportEmissionInSpec = Number(artifact.reportEmissionInSpec || 0);
  const generatedLocal = payload.generatedAt
    ? new Date(payload.generatedAt).toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "medium",
    })
    : "—";
  const testNumberLabel = artifact.testNumberInSpec != null
    ? `T${String(artifact.testNumberInSpec).padStart(2, "0")}`
    : "";
  const checkpointLabel = String(artifact.checkpointLabel || "").trim();
  const checkpointSuffix = checkpointLabel
    ? ` · Checkpoint ${checkpointLabel.toUpperCase()}`
    : "";
  const testInSuiteWithLabel = artifact.testOrdinalLabel
    ? (testNumberLabel ? `${artifact.testOrdinalLabel} (${testNumberLabel})` : artifact.testOrdinalLabel)
      + checkpointSuffix
    : "—";
  const technicalMetrics = {
    initialViolationsRaw: Number(counts.initialViolations || 0),
    liveDistinctViolationInstancesExcludingInitial: Number(
      counts.liveDistinctViolationInstancesExcludingInitial || 0
    ),
    totalViolationsInitialPlusLiveDistinct: Number(
      counts.totalViolationsInitialPlusLiveDistinct || 0
    ),
    initialDistinctNodesWithIssues: Number(counts.initialNodesWithViolations || 0),
    liveDistinctNodesWithIssuesExcludingInitial: Number(
      counts.liveDistinctNodesWithIssuesExcludingInitial || 0
    ),
    totalNodesInitialPlusLiveDistinct: Number(
      counts.totalNodesInitialPlusLiveDistinct || 0
    ),
    ...(includeIncompleteInReport
      ? {
        initialIncompleteRaw: Number(counts.initialIncomplete || 0),
        liveDistinctIncompleteInstancesExcludingInitial: Number(
          counts.liveDistinctIncompleteInstancesExcludingInitial || 0
        ),
        totalIncompleteInitialPlusLiveDistinct: Number(
          counts.totalIncompleteInitialPlusLiveDistinct || 0
        ),
        initialDistinctNodesWithIncomplete: Number(counts.initialNodesWithIncomplete || 0),
        liveDistinctNodesWithIncompleteExcludingInitial: Number(
          counts.liveDistinctNodesWithIncompleteExcludingInitial || 0
        ),
        totalNodesIncompleteInitialPlusLiveDistinct: Number(
          counts.totalNodesIncompleteInitialPlusLiveDistinct || 0
        ),
      }
      : {}),
    liveScansCaptured: Number(counts.liveScans || 0),
    monitorDroppedScans: Number(monitorMeta.dropped || 0),
    monitorErrors: Number((payload.errors || []).length || 0),
    duplicatedViolationsFromEarlierReports: Number(
      duplicateStats.duplicatedViolationsFromEarlierReports || 0
    ),
    ...(includeIncompleteInReport
      ? {
        duplicatedIncompleteFindingsFromEarlierReports: Number(
          duplicateStats.duplicatedIncompleteFindingsFromEarlierReports || 0
        ),
      }
      : {}),
    duplicatedNodesFromEarlierReports: Number(
      duplicateStats.duplicatedNodesFromEarlierReports || 0
    ),
    previousReportsInSpec: Math.max(0, reportEmissionInSpec > 0 ? reportEmissionInSpec - 1 : 0),
  };
  const technicalOrder = buildTechnicalMetricOrder(technicalMetrics, {
    includeIncompleteInReport,
  });
  const metricHelp = technicalOrder.reduce((acc, metricKey) => {
    if (TECHNICAL_METRIC_HELP[metricKey]) {
      acc[metricKey] = TECHNICAL_METRIC_HELP[metricKey];
    }
    return acc;
  }, {});

  return {
    identity: {
      reportId: artifact.reportId || "—",
      specFile: artifact.specFile || "—",
      cypressTest: artifact.testTitle || "—",
      testInSuite: testInSuiteWithLabel,
      validationStatus,
      generatedLocal,
      reportFileJson: artifact.fileName || "—",
    },
    technicalOrder,
    technicalMetrics,
    metricHelp,
  };
};

const resolveValidationStatus = (counts = {}, validationResult = {}) => {
  const groupedByDisposition = counts.groupedByDisposition || {};
  const hasFailingIncludedImpacts = Number(groupedByDisposition.fail || 0) > 0;
  const status = hasFailingIncludedImpacts || !validationResult?.valid ? "FAIL" : "PASS";
  return {
    status,
    hasFailingIncludedImpacts,
  };
};

const formatTerminalSeverityLine = (severity, severityDisposition = {}, includeIncomplete = false) => {
  const fail = Number(severityDisposition.fail || 0);
  const warn = Number(severityDisposition.warn || 0);
  const incomplete = Number(severityDisposition.incomplete || 0);
  const base = `${severity}: fail=${fail}, warn=${warn}`;
  return includeIncomplete ? `${base}, incomplete=${incomplete}` : base;
};

module.exports = {
  SEVERITY_ORDER,
  normalizePageUrlKey,
  sameNodeIdentity,
  buildNodeRepeatKey,
  enrichNodesWithCrossReportRepeat,
  resolveDefaultAccessibilityReportPath,
  buildLiveA11yReport,
  validateLiveA11yReport,
  buildReportSummary,
  buildCrossReportDuplicateStats,
  resolveValidationStatus,
  formatTerminalSeverityLine,
};
