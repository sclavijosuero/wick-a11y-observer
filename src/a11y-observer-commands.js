import { attachLiveA11yMonitor, createLiveA11yStore, installLiveA11yMonitorOnWindow } from './a11y-setup';

const DEFAULT_ACCESSIBILITY_RESULTS_FOLDER = 'cypress/accessibility';
const LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY = '__liveA11yAutoReportOptions';
const LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY = '__liveA11yAutoSetupOptions';
const LIVE_A11Y_AUTO_ACTIVE_STORE_ENV_KEY = '__liveA11yAutoActiveStore';

/**
 * @param {string} p
 * @returns {string}
 */
const fileBasename = (p) => {
  if (!p) return '';
  const normalized = String(p).replace(/\\/g, '/');
  const i = normalized.lastIndexOf('/');
  return i >= 0 ? normalized.slice(i + 1) : normalized;
};

/**
 * @param {string} stem
 * @returns {string}
 */
const sanitizeSpecStemForFilename = (stem) => {
  const cleaned = stem
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'spec';
};

/**
 * Local wall-clock time: sorts lexicographically and reads as YYYY-MM-DD then time (24h) + ms.
 * Safe for Windows filenames (no `:` / `?` / `*`).
 * @param {Date} d
 * @returns {string}
 */
const formatSortableLocalTimestamp = (d) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}`;
};

const buildDefaultLiveA11yReportFileName = (stem, sortableLocal, emissionPadded) =>
  `live-axe--${stem}--${sortableLocal}--R${emissionPadded}.json`;

/**
 * Default live-axe JSON path and report metadata. Uses the current spec file stem, sortable
 * local timestamp, per-spec emission number, and current test title (for unique ID when a file
 * emits more than one report per run).
 * @param {string | undefined} outputPathOverride
 * @returns {{ outputPath: string, reportMeta: Record<string, string | number | undefined> }}
 */
const buildLiveA11yOutputPathAndMeta = (outputPathOverride) => {
  const specRaw = Cypress.spec?.name || fileBasename(Cypress.spec?.relative) || 'unknown-spec';
  const stem = sanitizeSpecStemForFilename(String(specRaw).replace(/\.cy\.(js|jsx|ts|tsx)$/i, ''));
  const d = new Date();
  const sortableLocal = formatSortableLocalTimestamp(d);
  const emission = getAndIncrementSpecReportEmission();
  const testTitle = getCurrentTestTitleForMeta();
  const testTitleSlug = sanitizeSpecStemForFilename(
    testTitle
      .replace(/[^a-zA-Z0-9._\s-]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 64)
  );
  const suiteOrd = getTestOrdinalInCurrentMochaSuite();
  const emissionPadded = String(emission).padStart(2, '0');
  // Short id + filename: live-axe--<spec>--<ts>--R01 (no per-test title slug in id)
  const defaultReportFileName = buildDefaultLiveA11yReportFileName(
    stem,
    sortableLocal,
    emissionPadded
  );
  const defaultPath = `${DEFAULT_ACCESSIBILITY_RESULTS_FOLDER}/${defaultReportFileName}`;
  const reportId = `live-axe--${stem}--${sortableLocal}--R${emissionPadded}`;
  const testOrdinalLabel =
    suiteOrd != null ? `Test ${suiteOrd.index} of ${suiteOrd.total} in current suite` : undefined;
  const reportMeta = {
    reportId,
    specFile: specRaw,
    specStem: stem,
    sortableLocalTimestamp: sortableLocal,
    humanReadableLocal: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }),
    cypressSpecRelative: Cypress.spec?.relative,
    testTitle,
    testTitleForFilename: testTitleSlug,
    reportEmissionInSpec: emission,
    testOrdinalInSuite: suiteOrd?.index,
    testCountInSuite: suiteOrd?.total,
    testOrdinalLabel,
  };
  return {
    outputPath: outputPathOverride || defaultPath,
    reportMeta,
  };
};

const AXE_STANDARD_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'best-practice',
];

const DEFAULT_AXE_SCAN_OPTIONS = {
  resultTypes: ['violations', 'incomplete'],
  iframes: true,
  includedImpacts: ['critical', 'serious'],
  onlyWarnImpacts: [],
  runOnly: {
    type: 'tag',
    values: AXE_STANDARD_TAGS,
  },
};

const normalizeRunOnly = (baseRunOnly = {}, overrideRunOnly = {}) => ({
  ...baseRunOnly,
  ...overrideRunOnly,
  values: overrideRunOnly.values || baseRunOnly.values,
});

const mergeA11yRunOptions = (baseOptions = {}, overrideOptions = {}) => ({
  ...baseOptions,
  ...overrideOptions,
  runOnly: normalizeRunOnly(baseOptions.runOnly, overrideOptions.runOnly),
  rules: {
    ...(baseOptions.rules || {}),
    ...(overrideOptions.rules || {}),
  },
});

// Tracks previously seen rule+node pairs across tests in the same spec file
// (key includes normalized page URL so the same target on a different page is not "repeated").
const seenNodeViolationsBySpec = new Map();
// Monotonically increasing report emission number per spec file (resets per Cypress run),
// for unique filenames and report IDs when a spec calls reportLiveA11yResults more than once.
const specReportEmissionBySpec = new Map();
// specKey -> Map<nodeViolationKey, firstReportId> for cross-report "repeated" HTML + log context
const specToNodeKeyFirstReportId = new Map();

const currentSpecKey = () => Cypress.spec?.relative || Cypress.spec?.name || 'unknown-spec';

const getNodeFirstReportIdMapForCurrentSpec = () => {
  const k = currentSpecKey();
  if (!specToNodeKeyFirstReportId.has(k)) {
    specToNodeKeyFirstReportId.set(k, new Map());
  }
  return specToNodeKeyFirstReportId.get(k);
};

/**
 * @param {string} [u]
 * @returns {string}
 */
const normalizePageUrlForKey = (u) => {
  if (u == null) return '';
  const s = String(u).trim();
  if (s === '') return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      return new URL(s).href;
    }
  } catch { /* use raw */ }
  return s;
};

const nodeViolationKey = (ruleId, target, pageUrl) =>
  `${ruleId}@@${target || '<unknown>'}@@${normalizePageUrlForKey(pageUrl)}`;

const canonicalNodeTarget = (node = {}) => node.rawTarget || node.target;

const getAndIncrementSpecReportEmission = () => {
  const k = currentSpecKey();
  const n = (specReportEmissionBySpec.get(k) || 0) + 1;
  specReportEmissionBySpec.set(k, n);
  return n;
};

/**
 * Mocha `it()` for the test case, not a hook. In `afterEach` the active `runnable` is
 * a hook, so `ctx.test` is the hook — the finished `it` is on `ctx.currentTest`.
 * @returns {object | null}
 */
const resolveMochaTestCase = () => {
  const r = cy.state('runnable');
  const ctx = r?.ctx;
  if (r?.type === 'hook' && ctx?.currentTest) {
    return ctx.currentTest;
  }
  if (ctx?.test && ctx.test.type === 'test') {
    return ctx.test;
  }
  if (ctx?.currentTest && ctx.currentTest.type === 'test') {
    return ctx.currentTest;
  }
  if (Cypress.currentTest && Cypress.currentTest.type === 'test') {
    return Cypress.currentTest;
  }
  // Some Mocha builds omit `type` on Test — treat as test if it has fullTitle and parent.tests
  if (r?.type === 'hook' && ctx?.currentTest && typeof ctx.currentTest.fullTitle === 'function') {
    return ctx.currentTest;
  }
  if (ctx?.test && typeof ctx.test.fullTitle === 'function' && Array.isArray(ctx.test.parent?.tests)) {
    return ctx.test;
  }
  return null;
};

/**
 * Mocha: current `it` title path for report metadata and filenames.
 * @returns {string}
 */
const getCurrentTestTitleForMeta = () => {
  const resolved = resolveMochaTestCase();
  if (resolved) {
    if (resolved.titlePath?.length) {
      return resolved.titlePath.join(' > ');
    }
    if (resolved.title) {
      return resolved.title;
    }
  }
  if (Cypress.currentTest?.titlePath?.length) {
    return Cypress.currentTest.titlePath.join(' > ');
  }
  if (Cypress.currentTest?.title) {
    return Cypress.currentTest.title;
  }
  try {
    const t = cy.state('runnable')?.ctx?.currentTest || cy.state('runnable')?.ctx?.test;
    if (t?.titlePath?.length) {
      return t.titlePath.join(' > ');
    }
    if (t?.title) {
      return t.title;
    }
  } catch {
    /* no-op */
  }
  return 'unknown-test';
};

/**
 * 1-based index of the current `it` among runnable tests in the same suite, or null.
 * @returns {object | null} shape `{ index, total }` or null if unknown
 */
const getTestOrdinalInCurrentMochaSuite = () => {
  try {
    const test = resolveMochaTestCase();
    if (!test?.parent?.tests) {
      return null;
    }
    const tests = test.parent.tests.filter((t) => !t.pending);
    if (!tests.length) {
      return null;
    }
    const full = typeof test.fullTitle === 'function' ? test.fullTitle() : null;
    const idx = tests.findIndex(
      (t) =>
        t === test ||
        (full && typeof t.fullTitle === 'function' && t.fullTitle() === full)
    );
    if (idx < 0) {
      return null;
    }
    return { index: idx + 1, total: tests.length };
  } catch {
    return null;
  }
};
const GHOST_OVERLAY_ID = 'live-axe-ghost-overlay';

const getSeenNodeSetForCurrentSpec = () => {
  const specKey = currentSpecKey();
  if (!seenNodeViolationsBySpec.has(specKey)) {
    seenNodeViolationsBySpec.set(specKey, new Set());
  }
  return seenNodeViolationsBySpec.get(specKey);
};

/**
 * After a report is written, record the first report id for each rule+target+page key (unchanged = first spec run only).
 * @param {object[]} [groupedViolations]
 * @param {string} [reportId]
 */
const recordFirstReportIdsFromGroupedReport = (groupedViolations, reportId) => {
  if (!reportId || !Array.isArray(groupedViolations)) {
    return;
  }
  const m = getNodeFirstReportIdMapForCurrentSpec();
  groupedViolations.forEach((v) => {
    (v?.nodeDetails || []).forEach((n) => {
      const k = nodeViolationKey(v.id, canonicalNodeTarget(n), n.pageUrl);
      if (!m.has(k)) {
        m.set(k, reportId);
      }
    });
  });
};

const severityBadge = (impact) => {
  switch ((impact || '').toLowerCase()) {
    case 'critical':
      return 'CRITICAL';
    case 'serious':
      return 'SERIOUS';
    case 'moderate':
      return 'MODERATE';
    case 'minor':
      return 'MINOR';
    default:
      return 'UNKNOWN';
  }
};

const severityColorMark = (impact) => {
  switch ((impact || '').toLowerCase()) {
    case 'critical':
      return '🟥';
    case 'serious':
      return '🟧';
    case 'moderate':
      return '🟨';
    case 'minor':
      return '🟦';
    default:
      return '⬜';
  }
};

const severityGhostColor = (impact) => {
  switch ((impact || '').toLowerCase()) {
    case 'critical':
      return '#d14343';
    case 'serious':
      return '#e0911b';
    case 'moderate':
      return '#b8a100';
    case 'minor':
      return '#2f6de2';
    default:
      return '#7a7a7a';
  }
};

const severitySectionEmoji = (impact) => {
  switch ((impact || '').toLowerCase()) {
    case 'critical':
      return '🟥';
    case 'serious':
      return '🟧';
    case 'moderate':
      return '🟨';
    case 'minor':
      return '🟦';
    default:
      return '•';
  }
};

const outcomeLabel = (violation = {}) =>
  violation?.disposition === 'warn' ? 'WARNING' : 'FAIL';

const severitySectionTypeLabel = ({ failCount = 0, warnCount = 0 } = {}) => {
  if (Number(failCount) > 0) return 'VIOLATIONS';
  if (Number(warnCount) > 0) return 'WARNINGS';
  return 'VIOLATIONS';
};

const severitySummaryLabel = (severity, impactPolicy = {}) => {
  const included = new Set(impactPolicy?.included || []);
  const warn = new Set(impactPolicy?.warn || []);
  const normalized = String(severity || '').toLowerCase();
  if (warn.has(normalized) && !included.has(normalized)) {
    return `${String(normalized).toUpperCase()} WARNINGS`;
  }
  return `${String(normalized).toUpperCase()} VIOLATIONS`;
};

const autDocument = () => Cypress.state('window')?.document || null;

const ensureGhostOverlay = () => {
  const doc = autDocument();
  if (!doc) return null;

  let overlay = doc.getElementById(GHOST_OVERLAY_ID);
  if (overlay) return overlay;

  overlay = doc.createElement('div');
  overlay.id = GHOST_OVERLAY_ID;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '2147483647';
  overlay.style.pointerEvents = 'none';
  doc.body.appendChild(overlay);
  return overlay;
};

const resetGhostOverlay = () => {
  const doc = autDocument();
  if (!doc) return;
  const overlay = doc.getElementById(GHOST_OVERLAY_ID);
  if (overlay) {
    overlay.remove();
  }
};

const ghostNodeId = (ruleId, target) =>
  `live-axe-ghost-${`${ruleId}-${target || 'unknown'}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 120)}`;

const sourceKeyForLiveScan = (scan = {}) => `${scan.rootType || 'unknown'}:${scan.rootId || 'n/a'}`;

const liveSourceRectMap = (rawResults) => {
  const map = new Map();
  (rawResults?.live || []).forEach((scan) => {
    const rect = scan?.rootRect;
    if (!rect) return;
    map.set(sourceKeyForLiveScan(scan), rect);
  });
  return map;
};

const firstKnownRectForNode = (node, sourceRectMap) => {
  const sources = node?.sources || [];
  for (const source of sources) {
    const rect = sourceRectMap.get(source);
    if (rect) return rect;
  }
  return null;
};

const createGhostNode = ({ ruleId, target, severity, rect }) => {
  const doc = autDocument();
  const overlay = ensureGhostOverlay();
  if (!doc || !overlay) return null;

  const id = ghostNodeId(ruleId, target);
  const existing = doc.getElementById(id);
  if (existing) return existing;

  const chip = doc.createElement('div');
  chip.id = id;
  const left = Math.max(0, Math.round(rect?.x ?? 12));
  const top = Math.max(0, Math.round(rect?.y ?? 12));
  const width = Math.max(18, Math.round(rect?.width ?? 22));
  const height = Math.max(18, Math.round(rect?.height ?? 22));
  chip.style.position = 'fixed';
  chip.style.left = `${left}px`;
  chip.style.top = `${top}px`;
  chip.style.width = `${width}px`;
  chip.style.height = `${height}px`;
  chip.style.border = `2px dashed ${severityGhostColor(severity)}`;
  chip.style.borderRadius = '4px';
  chip.style.opacity = '0';
  chip.style.background = 'transparent';
  chip.style.pointerEvents = 'none';
  chip.setAttribute('title', `${severityBadge(severity)} (NOT IN DOM) ${target || '<unknown>'}`);
  overlay.appendChild(chip);
  return chip;
};

const detectionSummary = (node) => {
  const initialCount = node.initialDetections || 0;
  const liveCount = node.liveDetections || 0;

  if (initialCount > 0 && liveCount > 0) {
    return `INITIAL+LIVEx${liveCount}`;
  }
  if (initialCount > 0) {
    return 'INITIAL';
  }
  return `LIVEx${liveCount}`;
};

const resolveElementsForSelectors = (selectors = []) => {
  const autWindow = Cypress.state('window');
  const autDocument = autWindow?.document;
  if (!autDocument) return Cypress.$();

  const uniqueSelectors = [...new Set((selectors || []).filter(Boolean))];
  const elements = uniqueSelectors.flatMap((selector) => {
    try {
      return Array.from(autDocument.querySelectorAll(selector));
    } catch {
      // Ignore invalid selectors coming from axe target serialization.
      return [];
    }
  });

  return Cypress.$(elements);
};

const logGroupedViolations = (groupedViolations = [], rawResults = null) => {
  const previouslySeenNodeKeys = getSeenNodeSetForCurrentSpec();
  const currentTestNodeKeys = new Set();
  let previousSeverity = null;
  let hasLoggedGroupInSeverity = false;
  const sourceRectMap = liveSourceRectMap(rawResults);

  groupedViolations.forEach((violation, violationIndex) => {
    const badge = severityBadge(violation.impact);
    const colorMark = severityColorMark(violation.impact);
    const severityKey = String(violation.impact || '').toLowerCase();

    if (severityKey !== previousSeverity) {
      const sectionEmoji = severitySectionEmoji(violation.impact);
      const violationsForSeverity = groupedViolations.filter(
        (item) => String(item?.impact || '').toLowerCase() === severityKey
      );
      const totalGroupsForSeverity = violationsForSeverity.length;
      const totalNodesForSeverity = violationsForSeverity.reduce(
        (acc, item) => acc + Number(item?.uniqueNodeCount || 0),
        0
      );
      const warnGroupsForSeverity = violationsForSeverity.filter(
        (item) => item?.disposition === 'warn'
      ).length;
      const failGroupsForSeverity = totalGroupsForSeverity - warnGroupsForSeverity;
      const sectionTypeLabel = severitySectionTypeLabel({
        failCount: failGroupsForSeverity,
        warnCount: warnGroupsForSeverity,
      });
      const sectionMessage = `────── ${sectionEmoji} ${sectionTypeLabel} - ${badge} (FAIL:${failGroupsForSeverity} | WARN:${warnGroupsForSeverity} | N:${totalNodesForSeverity}) ${sectionEmoji} ──────`;
      Cypress.log({
        name: '',
        message: sectionMessage,
        consoleProps: () => ({
          type: 'severity-section',
          severity: severityKey,
          severityBadge: badge,
          sectionType: sectionTypeLabel,
          totalViolationsInSeverity: totalGroupsForSeverity,
          totalNodesAffectedInSeverity: totalNodesForSeverity,
          groupedViolationsForSeverity: violationsForSeverity.map((item) => ({
            id: item.id,
            help: item.help,
            impact: item.impact,
            disposition: item.disposition || 'fail',
            uniqueNodeCount: item.uniqueNodeCount,
            totalOccurrences: item.totalOccurrences,
            phases: item.phases,
          })),
          message: sectionMessage,
        }),
      });
      previousSeverity = severityKey;
      hasLoggedGroupInSeverity = false;
    } else if (hasLoggedGroupInSeverity) {
      const groupDividerMessage = '·   ·   ·   ·   ·';
      Cypress.log({
        name: '',
        message: groupDividerMessage,
        consoleProps: () => ({
          message: groupDividerMessage,
        }),
      });
    }

    const nodesWithDomState = (violation.nodeDetails || []).map((node) => {
      const elements = resolveElementsForSelectors([canonicalNodeTarget(node)]);
      const visibleElements = Cypress.$(
        elements.toArray().filter((el) => {
          try {
            return Cypress.dom.isVisible(el);
          } catch {
            return false;
          }
        })
      );
      const isMissingFromDom = elements.length === 0;
      const isInDomButHidden = elements.length > 0 && visibleElements.length === 0;
      return {
        node,
        nodeElements: elements,
        visibleNodeElements: visibleElements,
        isMissingFromDom,
        isInDomButHidden,
        notCurrentlyAvailableForHighlight: isMissingFromDom || isInDomButHidden,
        fallbackRect: firstKnownRectForNode(node, sourceRectMap),
      };
    });
    const repeatedNodesInGroup = (violation.nodeDetails || []).filter((node) =>
      previouslySeenNodeKeys.has(
        nodeViolationKey(violation.id, canonicalNodeTarget(node), node.pageUrl)
      )
    ).length;
    const repeatedGroupSuffix =
      repeatedNodesInGroup > 0
        ? ` [⚠️REPEATED:${repeatedNodesInGroup}]`
        : '';
    const groupElements = Cypress.$(
      nodesWithDomState.flatMap(
        ({ node, visibleNodeElements, notCurrentlyAvailableForHighlight, fallbackRect }) => {
          if (!notCurrentlyAvailableForHighlight) {
            return visibleNodeElements.toArray();
          }
          const ghostNode = createGhostNode({
            ruleId: violation.id,
            target: node.target,
            severity: violation.impact,
            rect: fallbackRect,
          });
          return ghostNode ? [ghostNode] : [];
        })
    );
    const unavailableNodesCount = nodesWithDomState.filter(
      (entry) => entry.notCurrentlyAvailableForHighlight
    ).length;
    const missingNodesCount = nodesWithDomState.filter((entry) => entry.isMissingFromDom).length;
    const hiddenNodesCount = nodesWithDomState.filter((entry) => entry.isInDomButHidden).length;
    const totalNodesCount = nodesWithDomState.length;
    let missingGroupElementsSuffix = '';
    if (totalNodesCount > 0 && unavailableNodesCount === totalNodesCount) {
      missingGroupElementsSuffix = ` [⚠️UNAVAIL:${unavailableNodesCount}/${totalNodesCount}]`;
    } else if (unavailableNodesCount > 0) {
      missingGroupElementsSuffix = ` [⚠️UNAVAIL:${unavailableNodesCount}/${totalNodesCount}]`;
    }

    Cypress.log({
      name: `${colorMark} A11Y`,
      message: `#${violationIndex + 1} [${badge}] [${outcomeLabel(violation)}] ${violation.id} - ${violation.help} (NODES:${violation.uniqueNodeCount})${repeatedGroupSuffix}${missingGroupElementsSuffix}`,
      $el: groupElements,
      consoleProps: () => ({
        ruleId: violation.id,
        severity: violation.impact,
        disposition: violation.disposition || 'fail',
        help: violation.help,
        helpUrl: violation.helpUrl,
        description: violation.description,
        tags: violation.tags,
        phases: violation.phases,
        sources: violation.sources,
        uniqueNodeCount: violation.uniqueNodeCount,
        totalOccurrences: violation.totalOccurrences,
        nodes: violation.nodes,
        nodeDetails: violation.nodeDetails,
        highlightedTargets: (violation.nodeDetails || []).map((node) => node.target),
        highlightedElementsCount: groupElements.length,
        notCurrentlyInDom: missingNodesCount > 0,
        inDomButNotVisibleCount: hiddenNodesCount,
        missingFromDomCount: missingNodesCount,
        unavailableForHighlightCount: unavailableNodesCount,
        axeCoreViolations: violation.rawViolations,
      }),
    });
    hasLoggedGroupInSeverity = true;

    nodesWithDomState.forEach(
      (
        {
          node,
          visibleNodeElements,
          isMissingFromDom,
          isInDomButHidden,
          notCurrentlyAvailableForHighlight,
          fallbackRect,
        },
        nodeIndex
      ) => {
        const nodeKey = nodeViolationKey(violation.id, canonicalNodeTarget(node), node.pageUrl);
        const wasSeenInPreviousTest = previouslySeenNodeKeys.has(nodeKey);
        const firstSpecReportIdForKey = wasSeenInPreviousTest
          ? getNodeFirstReportIdMapForCurrentSpec().get(nodeKey)
          : undefined;
        const statusTags = [
          `[${detectionSummary(node)}]`,
          wasSeenInPreviousTest
            ? `[⚠️REPEATED${firstSpecReportIdForKey ? ` → first: ${firstSpecReportIdForKey}` : ''}]`
            : '',
          isMissingFromDom ? '[⚠️NO-DOM]' : '',
          isInDomButHidden ? '[⚠️HIDDEN]' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const highlightElements = notCurrentlyAvailableForHighlight
          ? Cypress.$(
            createGhostNode({
              ruleId: violation.id,
              target: node.target,
              severity: violation.impact,
              rect: fallbackRect,
            })
          )
          : visibleNodeElements;
        const pageHint = node.pageUrl
          ? ` | page: ${String(node.pageUrl).length > 56
            ? `${String(node.pageUrl).slice(0, 53)}…`
            : String(node.pageUrl)
          }`
          : '';
        Cypress.log({
          name: 'NODE',
          message: `  -> (${nodeIndex + 1}) ${node.target || '<unknown>'}${pageHint} ${statusTags}`,
          $el: highlightElements,
          consoleProps: () => ({
            ruleId: violation.id,
            pageUrl: node.pageUrl,
            severity: violation.impact,
            detectionSummary: detectionSummary(node),
            detectionSummaryVerbose:
              (node.initialDetections || 0) > 0 && (node.liveDetections || 0) > 0
                ? `Initial scan + Live scans x${node.liveDetections || 0}`
                : (node.initialDetections || 0) > 0
                  ? 'Initial scan'
                  : `Live scans x${node.liveDetections || 0}`,
            initialDetections: node.initialDetections || 0,
            liveDetections: node.liveDetections || 0,
            phases: node.phases || [],
            sources: node.sources || [],
            target: node.target,
            html: node.html,
            failureSummary: node.failureSummary,
            any: node.any || [],
            all: node.all || [],
            none: node.none || [],
            highlightedTarget: node.target,
            highlightedElementsCount: highlightElements.length,
            notCurrentlyInDom: isMissingFromDom,
            inDomButNotVisible: isInDomButHidden,
            notCurrentlyAvailableForHighlight,
            statusTags,
            repeatedFromPreviousTest: wasSeenInPreviousTest,
            firstReportIdInThisSpec: firstSpecReportIdForKey,
          }),
        });

        currentTestNodeKeys.add(nodeKey);
      });
  });

  currentTestNodeKeys.forEach((key) => previouslySeenNodeKeys.add(key));
};

Cypress.Commands.add('setupCoreLiveA11yMonitor', (monitorOptions = {}) => {
  const store = createLiveA11yStore();
  attachLiveA11yMonitor(store, monitorOptions);
  return cy.wrap(store, { log: false }).as('liveA11yStore');
});

const resolveLiveA11yMonitorInstallOptions = (monitorOptions = {}) => {
  const {
    initialAxeOptions = {},
    liveAxeOptions = {},
    observerOptions = {},
  } = monitorOptions;

  const computedInitialOptions = mergeA11yRunOptions(
    DEFAULT_AXE_SCAN_OPTIONS,
    initialAxeOptions
  );
  const computedLiveOptions = mergeA11yRunOptions(
    DEFAULT_AXE_SCAN_OPTIONS,
    liveAxeOptions
  );

  return {
    ...observerOptions,
    initialAxeOptions: computedInitialOptions,
    liveAxeOptions: computedLiveOptions,
  };
};

Cypress.Commands.add('setupLiveA11yMonitor', (monitorOptions = {}) => {
  return cy.setupCoreLiveA11yMonitor(resolveLiveA11yMonitorInstallOptions(monitorOptions));
});

Cypress.Commands.add(
  'runInitialLiveA11yScan',
  (
    axeOptions = undefined,
    commandOptions = { armAfter: false, armOptions: { scanCurrent: false } }
  ) => {
    return cy.window({ log: false }).then(async (win) => {
      if (!win.__liveA11yMonitor) {
        throw new Error('Live a11y monitor is not installed on window. Call cy.setupLiveA11yMonitor() before running scans.');
      }

      await win.__liveA11yMonitor.runInitialFullPageScan(axeOptions);

      if (commandOptions?.armAfter) {
        win.__liveA11yMonitor.arm(commandOptions.armOptions || { scanCurrent: false });
      }
    });
  }
);

Cypress.Commands.add('armLiveA11yMonitor', (options = { scanCurrent: false }) => {
  return cy.window({ log: false }).then((win) => {
    if (!win.__liveA11yMonitor) return;
    win.__liveA11yMonitor.arm(options);
  });
});

Cypress.Commands.add('waitForLiveA11yIdle', (options = {}) => {
  const idleOptions = {
    quietMs: 500,
    timeoutMs: 8000,
    ...options,
  };

  return cy.window({ log: false }).then((win) => {
    if (!win.__liveA11yMonitor) return null;

    const monitor = win.__liveA11yMonitor;
    const hardTimeoutMs = Number(idleOptions.timeoutMs || 8000) + 1000;
    const idlePromise = Cypress.Promise.race([
      monitor.waitForIdle(idleOptions),
      new Cypress.Promise((resolve) => {
        setTimeout(() => resolve(monitor?.store ?? null), hardTimeoutMs);
      }),
    ]).catch(() => monitor?.store ?? null);

    // Use cy.wrap timeout > hard fallback timeout.
    return cy.wrap(idlePromise, {
      log: false,
      timeout: hardTimeoutMs + 500,
    });
  });
});

Cypress.Commands.add('stopLiveA11yMonitor', () => {
  return cy.window({ log: false }).then((win) => {
    if (!win.__liveA11yMonitor) return;
    win.__liveA11yMonitor?.stop?.();
  });
});

Cypress.Commands.add('getLiveA11yResults', () => {
  return cy.window({ log: false }).then((win) => win.__liveA11yMonitor?.store ?? null);
});

Cypress.Commands.add('reportLiveA11yResults', (options = {}) => {
  const { outputPath, reportMeta } = buildLiveA11yOutputPathAndMeta(options.outputPath);
  const throwOnValidationFailure = options.throwOnValidationFailure !== false;
  const validation = {
    enabled: true,
    requireInitialScan: true,
    minLiveScans: 1,
    requireNoRuntimeErrors: true,
    failOnIncludedImpacts: true,
    ...options.validation,
  };

  return cy.getLiveA11yResults().then((results) => {
    Cypress.expose('liveA11yResults', results);
    const frMap = getNodeFirstReportIdMapForCurrentSpec();
    const previousNodeKeys = [...getSeenNodeSetForCurrentSpec()];
    const firstReportIdByKey = Object.fromEntries(frMap);
    return cy.task(
      'liveA11y:buildReport',
      {
        results,
        outputPath,
        validation,
        reportMeta,
        repeatInfo: { previousNodeKeys, firstReportIdByKey },
        deferValidationFailure: true,
      },
      { log: false }
    ).then((report) => {
      const rid = report?.reportArtifact?.reportId;
      recordFirstReportIdsFromGroupedReport(report?.groupedViolations, rid);
      resetGhostOverlay();
      const groupedBySeverity = report.counts.groupedBySeverity || {};
      const groupedByDisposition = report.counts.groupedByDisposition || {};
      const reportSummary = report?.summary || {};
      const technicalOrder = Array.isArray(reportSummary?.technicalOrder) && reportSummary.technicalOrder.length > 0
        ? reportSummary.technicalOrder
        : [];
      const technicalMetrics = reportSummary?.technicalMetrics || {};
      const metricHelp = reportSummary?.metricHelp || {};
      const summaryForConsole = {
        initialScans: report.counts.initialScans,
        initialViolations: report.counts.initialViolations,
        initialDistinctNodesWithViolations: report.counts.initialNodesWithViolations || 0,
        liveScans: report.counts.liveScans,
        liveViolations: report.counts.liveViolations,
        liveDistinctNodesWithViolations: report.counts.liveNodesWithViolations || 0,
        droppedScans: report.meta?.dropped || 0,
        monitorErrors: report.errors?.length || 0,
        groupedViolations: report.counts.groupedViolations,
        severityCounts: groupedBySeverity,
        outcomeCounts: groupedByDisposition,
        technicalMetrics,
      };
      cy.log('──────────── 📊 𝗩𝗜𝗢𝗟𝗔𝗧𝗜𝗢𝗡 𝗦𝗨𝗠𝗠𝗔𝗥𝗬 📊 ────────────');
      Cypress.log({
        name: '',
        message: '──────────── 📝 𝗩𝗜𝗢𝗟𝗔𝗧𝗜𝗢𝗡 𝗗𝗘𝗧𝗔𝗜𝗟𝗦 (𝗰𝗼𝗻𝘀𝗼𝗹𝗲 𝗽𝗿𝗼𝗽𝘀) 📝 ────────────',

        consoleProps: () => summaryForConsole,
      });
      const severityOrder = Array.isArray(report?.severityOrder)
        ? report.severityOrder
        : ['critical', 'serious', 'moderate', 'minor'];
      const ar = report?.reportArtifact || {};
      severityOrder.forEach((severity) => {
        const count = Number(groupedBySeverity?.[severity] ?? 0);
        const label = severitySummaryLabel(severity, report?.impactPolicy || {});
        cy.log(`• ${label} ${severityColorMark(severity)} : ${count}`);
      });
      logGroupedViolations(report.groupedViolations, report.raw);
      cy.log('· · · · ·');
      technicalOrder.forEach((metricKey) => {
        const metricLabel = metricHelp?.[metricKey]?.label || metricKey;
        const metricValue = Number(technicalMetrics?.[metricKey] ?? 0);
        cy.log(`${metricLabel}: ${metricValue}`);
      });
      cy.log('· · · · ·');
      if (ar.reportId) {
        cy.log(`Live a11y reportId: ${ar.reportId}`);
      }
      if (ar.testTitle) {
        cy.log(`Live a11y test: ${ar.testTitle}`);
      }
      if (ar.testOrdinalLabel) {
        cy.log(`Live a11y ${ar.testOrdinalLabel}`);
      }
      if (ar.reportEmissionInSpec != null) {
        cy.log(`Live a11y report #${ar.reportEmissionInSpec} in this spec (this run)`);
      }
      const jsonPath = report?.reportArtifact?.relativePath || report?.savedTo;
      if (jsonPath) {
        cy.log(`Live a11y JSON: ${jsonPath}`);
      }
      if (report?.htmlReportRelative) {
        cy.log(`Live a11y HTML: ${report.htmlReportRelative}`);
      }
      return cy.wrap(report, { log: false }).then((resolvedReport) => {
        if (!resolvedReport?.validation?.valid && throwOnValidationFailure) {
          const errors = Array.isArray(resolvedReport?.validation?.errors)
            ? resolvedReport.validation.errors
            : ['Unknown validation error'];
          throw new Error(`Live a11y validation failed:\n- ${errors.join('\n- ')}`);
        }
        return resolvedReport;
      });
    });
  });
});

const resolveCurrentTestFromHookContext = (hookThis) => {
  if (hookThis?.currentTest) {
    return hookThis.currentTest;
  }
  return cy.state('runnable')?.ctx?.currentTest || null;
};

const markTestAsFailedWithoutThrowingHook = (hookThis, message, report) => {
  const test = resolveCurrentTestFromHookContext(hookThis);
  if (!test) {
    return;
  }
  const error = new Error(message);
  error.name = 'LiveA11yValidationError';
  error.reportPath = report?.reportArtifact?.relativePath || report?.savedTo;
  error.reportId = report?.reportArtifact?.reportId;
  const runner = Cypress.mocha?.getRunner?.();
  if (runner && typeof runner.fail === 'function') {
    runner.fail(test, error);
    return;
  }
  test.err = error;
  test.state = 'failed';
};

Cypress.Commands.add('setLiveA11yAutoReportOptions', (options = {}) => {
  return cy.then(() => {
    Cypress.env(LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY, options);
  });
});

Cypress.Commands.add('setLiveA11yAutoSetupOptions', (options = {}) => {
  return cy.then(() => {
    Cypress.env(LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY, options);
  });
});

const mergeLiveA11ySetupOptions = (base = {}, override = {}) => ({
  ...base,
  ...override,
  initialAxeOptions: {
    ...(base.initialAxeOptions || {}),
    ...(override.initialAxeOptions || {}),
  },
  liveAxeOptions: {
    ...(base.liveAxeOptions || {}),
    ...(override.liveAxeOptions || {}),
  },
  observerOptions: {
    ...(base.observerOptions || {}),
    ...(override.observerOptions || {}),
  },
});

const logLiveA11yValidationMarker = ({
  testKey,
  reportPath,
  validationErrors = [],
  failCount = 0,
  warnCount = 0,
  markedFailed = false,
  isValid = false,
}) => {
  const prefix = isValid
    ? '✅ LIVE A11Y TEST PASS'
    : markedFailed
      ? '❌ LIVE A11Y TEST FAILURE'
      : '❌ LIVE A11Y VALIDATION (TEST MAY APPEAR PASSED)';
  const shortErrors = (validationErrors || []).slice(0, 3);
  const shortErrorsLabel = shortErrors.length > 0 ? shortErrors.join(' | ') : 'Unknown validation error';
  const message = isValid
    ? `${testKey} | fail-groups:${failCount} | warn-groups:${warnCount} | no failing violations`
    : `${testKey} | fail-groups:${failCount} | warn-groups:${warnCount} | ${shortErrorsLabel}`;
  Cypress.log({
    name: prefix,
    message,
    consoleProps: () => ({
      test: testKey,
      failGroups: failCount,
      warnGroups: warnCount,
      reportPath,
      validationErrors,
      note: markedFailed
        ? 'Validation failure was mapped to this test.'
        : isValid
          ? 'Validation passed for this test.'
          : 'Validation failed but test may still appear passed in Cypress summary.',
    }),
  });
};

let isLiveA11yAutoNavigationHookInstalled = false;
const AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP = {
  observerOptions: {
    minVisibleMs: 0,
    stableFrames: 1,
    maxSettleMs: 300,
  },
};

const ensureLiveA11yAutoNavigationHook = ({ setupOptions, initialScan }) => {
  if (isLiveA11yAutoNavigationHookInstalled) {
    return;
  }

  Cypress.on('window:before:load', (win) => {
    const store = Cypress.env(LIVE_A11Y_AUTO_ACTIVE_STORE_ENV_KEY);
    if (!store) {
      return;
    }

    const resolvedCommandOptions = initialScan?.commandOptions || {
      armAfter: false,
      armOptions: { scanCurrent: false },
    };
    const runtimeSetupOptions = Cypress.env(LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY) || {};
    const setupWithAutoPreNavFlush = mergeLiveA11ySetupOptions(
      AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP,
      setupOptions
    );
    const mergedSetupOptions = mergeLiveA11ySetupOptions(
      setupWithAutoPreNavFlush,
      runtimeSetupOptions
    );
    const resolvedSetupOptions = resolveLiveA11yMonitorInstallOptions(mergedSetupOptions);
    installLiveA11yMonitorOnWindow(win, store, resolvedSetupOptions);

    win.addEventListener('load', () => {
      const monitor = win.__liveA11yMonitor;
      if (!monitor) {
        return;
      }
      monitor
        .runInitialFullPageScan(initialScan?.axeOptions)
        .then(() => {
          if (resolvedCommandOptions?.armAfter) {
            monitor.arm(resolvedCommandOptions.armOptions || { scanCurrent: false });
          }
        })
        .catch((error) => {
          monitor.store?.errors?.push({
            url: win.location.href,
            timestamp: Date.now(),
            phase: 'initial-scan',
            reason: 'auto-navigation-load',
            message: error?.message || String(error),
          });
        });
    });
  });
  isLiveA11yAutoNavigationHookInstalled = true;
};

/**
 * Registers global hooks once (from cypress/support/e2e.js) for low-instrumentation
 * live a11y checks. It hooks each page load so initial scan + arm happens for
 * cy.visit() and click-driven full navigations alike.
 * @param {object} [options]
 */
export const registerLiveA11yAutoLifecycle = (options = {}) => {
  const {
    setupOptions = {
      observerOptions: { fallbackFullPageScan: { enabled: false } },
    },
    initialScan = {
      axeOptions: undefined,
      commandOptions: { armAfter: true, armOptions: { scanCurrent: false } },
    },
    waitForIdleOptions = { quietMs: 500, timeoutMs: 8000 },
    reportOptions = {},
    failTestOnValidationError = true,
    failRunOnValidationError = true,
    stopMonitorAfterEach = true,
  } = options;
  const pendingValidationFailuresByTest = new Map();

  ensureLiveA11yAutoNavigationHook({ setupOptions, initialScan });

  beforeEach(() => {
    Cypress.env(LIVE_A11Y_AUTO_ACTIVE_STORE_ENV_KEY, createLiveA11yStore());
  });

  afterEach(function liveA11yAutoAfterEach() {
    const titlePath = typeof this.currentTest?.titlePath === 'function'
      ? this.currentTest.titlePath()
      : this.currentTest?.titlePath;
    const testKey =
      (Array.isArray(titlePath) ? titlePath.join(' > ') : undefined) ||
      this.currentTest?.fullTitle?.() ||
      this.currentTest?.title ||
      'unknown-test';
    const runtimeReportOptions = Cypress.env(LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY) || {};
    Cypress.env(LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY, undefined);
    Cypress.env(LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY, undefined);
    const resolvedReportOptions = {
      ...reportOptions,
      ...runtimeReportOptions,
      validation: {
        ...(reportOptions.validation || {}),
        ...(runtimeReportOptions.validation || {}),
      },
    };
    cy.waitForLiveA11yIdle(waitForIdleOptions).then(
      () => null,
      (error) => {
        Cypress.log({
          name: '⚠ LIVE A11Y IDLE TIMEOUT',
          message: `Proceeding after idle wait failure for test "${testKey}"`,
          consoleProps: () => ({
            test: testKey,
            waitForIdleOptions,
            error: error?.message || String(error),
          }),
        });
        return null;
      }
    );
    cy.reportLiveA11yResults({
      ...resolvedReportOptions,
      // Avoid hook throw. We fail the test directly below.
      throwOnValidationFailure: false,
    }).then((report) => {
      const failCount = Number(report?.counts?.groupedByDisposition?.fail || 0);
      const warnCount = Number(report?.counts?.groupedByDisposition?.warn || 0);
      if (report?.validation?.valid) {
        pendingValidationFailuresByTest.delete(testKey);
        logLiveA11yValidationMarker({
          testKey,
          reportPath: report?.reportArtifact?.relativePath || report?.savedTo || 'unknown report path',
          failCount,
          warnCount,
          isValid: true,
        });
        return;
      }
      const validationErrors = Array.isArray(report?.validation?.errors)
        ? report.validation.errors
        : ['Unknown validation error'];
      const reportPath = report?.reportArtifact?.relativePath || report?.savedTo || 'unknown report path';
      const message = `Live a11y validation failed for this test:\n- ${validationErrors.join('\n- ')}\nReport: ${reportPath}`;
      pendingValidationFailuresByTest.set(testKey, {
        testKey,
        message,
        reportPath,
        validationErrors,
        failCount,
      });
      logLiveA11yValidationMarker({
        testKey,
        reportPath,
        validationErrors,
        failCount,
        warnCount,
        markedFailed: Boolean(failTestOnValidationError),
      });
      if (!failTestOnValidationError) {
        return;
      }
      markTestAsFailedWithoutThrowingHook(this, message, report);
    });
    if (stopMonitorAfterEach) {
      cy.stopLiveA11yMonitor();
    }
    Cypress.env(LIVE_A11Y_AUTO_ACTIVE_STORE_ENV_KEY, undefined);
  });

  after(() => {
    if (!failRunOnValidationError || pendingValidationFailuresByTest.size === 0) {
      return;
    }
    Cypress.log({
      name: '⛔ LIVE A11Y STRICT MODE',
      message: '════════════ FINAL RUN FAILURE (STRICT MODE) ════════════',
      consoleProps: () => ({
        failingTests: [...pendingValidationFailuresByTest.keys()],
        totalFailingTests: pendingValidationFailuresByTest.size,
      }),
    });
    const details = [...pendingValidationFailuresByTest.values()]
      .map((entry) => `- ${entry.testKey}\n  ${entry.message.replace(/\n/g, '\n  ')}`)
      .join('\n');
    throw new Error(
      `Live a11y strict mode detected validation failures in ${pendingValidationFailuresByTest.size} test(s):\n${details}`
    );
  });
};
