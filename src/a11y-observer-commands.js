import { attachLiveA11yMonitor, createLiveA11yStore, installLiveA11yMonitorOnWindow } from './a11y-setup';

const DEFAULT_ACCESSIBILITY_RESULTS_FOLDER = 'cypress/accessibility';
const LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY = '__liveA11yAutoReportOptions';
const LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY = '__liveA11yAutoSetupOptions';
const LIVE_A11Y_INCLUDE_INCOMPLETE_ENV_VAR = 'LIVE_A11Y_INCLUDE_INCOMPLETE';
const LIVE_A11Y_GENERATE_REPORTS_ENV_VAR = 'LIVE_A11Y_GENERATE_REPORTS';
const LIVE_A11Y_RUN_ENV_VAR = 'LIVE_A11Y_RUN';
let liveA11yAutoActiveStore = null;
let liveA11yAutoRuntimeSetupOptions = undefined;
let liveA11yAutoRuntimeReportOptions = undefined;
let liveA11yRuntimeEnvConfig = {
  runAccessibility: undefined,
  generateReports: undefined,
  includeIncompleteInReport: undefined,
};
const testsWithExplicitCheckpointReports = new Set();
const testsWithFailingViolations = new Map();

const setActiveLiveA11yStore = (store) => {
  liveA11yAutoActiveStore = store || null;
};

const getActiveLiveA11yStore = () =>
  liveA11yAutoActiveStore || null;

const setLiveA11yAutoSetupRuntimeOptions = (options) => {
  liveA11yAutoRuntimeSetupOptions = options || undefined;
  Cypress.expose(LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY, liveA11yAutoRuntimeSetupOptions);
};

const getLiveA11yAutoSetupRuntimeOptions = () => liveA11yAutoRuntimeSetupOptions || {};

const clearLiveA11yAutoSetupRuntimeOptions = () => {
  liveA11yAutoRuntimeSetupOptions = undefined;
  Cypress.expose(LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY, undefined);
};

const setLiveA11yAutoReportRuntimeOptions = (options) => {
  liveA11yAutoRuntimeReportOptions = options || undefined;
  Cypress.expose(LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY, liveA11yAutoRuntimeReportOptions);
};

const getLiveA11yAutoReportRuntimeOptions = () => liveA11yAutoRuntimeReportOptions || {};

const clearLiveA11yAutoReportRuntimeOptions = () => {
  liveA11yAutoRuntimeReportOptions = undefined;
  Cypress.expose(LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY, undefined);
};

const setLiveA11yRuntimeEnvConfig = (config = {}) => {
  liveA11yRuntimeEnvConfig = {
    runAccessibility: parseOptionalBoolean(config.runAccessibility),
    generateReports: parseOptionalBoolean(config.generateReports),
    includeIncompleteInReport: parseOptionalBoolean(config.includeIncompleteInReport),
  };
  Cypress.expose('__liveA11yRuntimeEnvConfig', liveA11yRuntimeEnvConfig);
};

const toPerTestTrackingKey = (testTitle) => `${currentSpecKey()}::${String(testTitle || 'unknown-test')}`;

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

const normalizeScanType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'checkpoint' ? 'checkpoint' : 'live';
};

const normalizeAccessibilityResultsFolder = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized;
};

const resolveAccessibilityResultsFolder = () => {
  const fromConfig = normalizeAccessibilityResultsFolder(Cypress.config('accessibilityFolder'));
  if (fromConfig) return fromConfig;
  return DEFAULT_ACCESSIBILITY_RESULTS_FOLDER;
};

const buildDefaultLiveA11yReportFileName = (sortableLocal, testNumberPadded) =>
  `a11y-live-auto--${sortableLocal}--T${testNumberPadded}.json`;

const sanitizeCheckpointLabel = (label) => {
  const normalized = String(label || '').trim().replace(/^checkpoint[-_\s]*/i, '');
  const sanitized = sanitizeSpecStemForFilename(normalized);
  return (sanitized || 'checkpoint').toUpperCase();
};

const buildDefaultCheckpointA11yReportFileName = (
  sortableLocal,
  testNumberPadded,
  checkpointLabel
) =>
  checkpointLabel
    ? `a11y-checkpoint--${sortableLocal}--T${testNumberPadded}-checkpoint-${checkpointLabel}.json`
    : `a11y-checkpoint--${sortableLocal}--T${testNumberPadded}.json`;

/**
 * Default live-axe JSON path and report metadata. Uses the current spec file stem, sortable
 * local timestamp, per-spec emission number, and current test title (for unique ID when a file
 * emits more than one report per run).
 * @param {string | undefined} outputPathOverride
 * @param {{ checkpointLabel?: string, scanType?: "live" | "checkpoint" }} [namingOptions]
 * @returns {{ outputPath: string, reportMeta: Record<string, string | number | undefined> }}
 */
const buildLiveA11yOutputPathAndMeta = (outputPathOverride, namingOptions = {}) => {
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
  const scanType = normalizeScanType(namingOptions?.scanType);
  const checkpointLabel = namingOptions?.checkpointLabel;
  const testNumberInSpec = suiteOrd?.index || emission;
  const testNumberInSpecPadded = String(testNumberInSpec).padStart(2, '0');
  const sanitizedCheckpointLabel = checkpointLabel
    ? sanitizeCheckpointLabel(checkpointLabel)
    : undefined;
  const isCheckpointScanReport = scanType === 'checkpoint';
  // Default live id + filename: a11y-live-auto--<ts>--T01
  // Checkpoint scan id + filename: a11y-checkpoint--<ts>--T01-checkpoint-A
  const defaultReportFileName = isCheckpointScanReport
    ? buildDefaultCheckpointA11yReportFileName(
      sortableLocal,
      testNumberInSpecPadded,
      sanitizedCheckpointLabel
    )
    : buildDefaultLiveA11yReportFileName(
      sortableLocal,
      testNumberInSpecPadded
    );
  const accessibilityResultsFolder = resolveAccessibilityResultsFolder();
  const defaultPath = `${accessibilityResultsFolder}/${defaultReportFileName}`;
  const reportId = isCheckpointScanReport
    ? (sanitizedCheckpointLabel
      ? `a11y-checkpoint--${sortableLocal}--T${testNumberInSpecPadded}-checkpoint-${sanitizedCheckpointLabel}`
      : `a11y-checkpoint--${sortableLocal}--T${testNumberInSpecPadded}`)
    : `a11y-live-auto--${sortableLocal}--T${testNumberInSpecPadded}`;
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
    scanType,
    testNumberInSpec,
    testNumberInSpecLabel: `T${testNumberInSpecPadded}`,
    reportEmissionInSpec: emission,
    equivalentLiveReportNumber: testNumberInSpec,
    testOrdinalInSuite: suiteOrd?.index,
    testCountInSuite: suiteOrd?.total,
    testOrdinalLabel,
    checkpointLabel: sanitizedCheckpointLabel,
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

const IMPACT_SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];

const normalizeImpactLevels = (values) => {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => IMPACT_SEVERITY_ORDER.includes(value));
  return [...new Set(normalized)];
};

const normalizeWarnImpactLevels = (values, included = []) => {
  const includedSet = new Set(normalizeImpactLevels(included));
  return normalizeImpactLevels(values).filter((level) => !includedSet.has(level));
};

const normalizeRunOnlyValues = (runOnly) => {
  const values = runOnly?.values;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

const syncCheckpointScanPolicyOnStore = (store, axeOptions = {}) => {
  if (!store || typeof store !== 'object') return;
  if (!store.meta || typeof store.meta !== 'object') {
    store.meta = {};
  }
  const analysis = store.meta.analysis && typeof store.meta.analysis === 'object'
    ? store.meta.analysis
    : {};

  const hasIncludedImpactsOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'includedImpacts');
  const hasImpactLevelsOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'impactLevels');
  const hasWarnImpactsOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'onlyWarnImpacts');
  const hasRunOnlyOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'runOnly');

  if (
    !hasIncludedImpactsOverride &&
    !hasImpactLevelsOverride &&
    !hasWarnImpactsOverride &&
    !hasRunOnlyOverride
  ) {
    store.meta.analysis = {
      ...analysis,
      scanType: 'checkpoint',
    };
    return;
  }

  const included = normalizeImpactLevels(
    hasIncludedImpactsOverride
      ? axeOptions.includedImpacts
      : hasImpactLevelsOverride
        ? axeOptions.impactLevels
        : analysis.configuredIncludedImpactLevels || analysis.configuredImpactLevels || []
  );
  const warn = normalizeWarnImpactLevels(
    hasWarnImpactsOverride ? axeOptions.onlyWarnImpacts : analysis.configuredWarnImpactLevels || [],
    included
  );
  const considered = [...new Set([...included, ...warn])];

  const mergedAnalysis = {
    ...analysis,
    scanType: 'checkpoint',
    configuredImpactLevels: considered,
    configuredIncludedImpactLevels: included,
    configuredWarnImpactLevels: warn,
    initialImpactLevels: included,
    initialWarnImpactLevels: warn,
  };

  if (hasRunOnlyOverride) {
    const runOnlyTags = normalizeRunOnlyValues(axeOptions.runOnly);
    mergedAnalysis.configuredRunOnlyTags = runOnlyTags;
    mergedAnalysis.initialRunOnlyTags = runOnlyTags;
  }

  store.meta.analysis = mergedAnalysis;
};

const clearPriorLiveEntriesOnStore = (store) => {
  if (!store || typeof store !== 'object') return;
  store.live = [];
};

const setScanTypeOnStore = (store, scanType = 'live') => {
  if (!store || typeof store !== 'object') return;
  if (!store.meta || typeof store.meta !== 'object') {
    store.meta = {};
  }
  const analysis = store.meta.analysis && typeof store.meta.analysis === 'object'
    ? store.meta.analysis
    : {};
  store.meta.analysis = {
    ...analysis,
    scanType: normalizeScanType(scanType),
  };
};

const resolveScanTypeForReport = (results, checkpointLabel) => {
  if (checkpointLabel) {
    return 'checkpoint';
  }
  const scanTypeFromMeta = normalizeScanType(results?.meta?.analysis?.scanType);
  return scanTypeFromMeta;
};

const resolveCheckpointLabelForReport = (scanType, checkpointLabel) => {
  const normalizedCheckpointLabel = typeof checkpointLabel === 'string'
    ? checkpointLabel.trim()
    : checkpointLabel;
  if (normalizedCheckpointLabel) {
    return normalizedCheckpointLabel;
  }
  if (
    scanType === 'checkpoint'
    && (checkpointLabel === true || normalizedCheckpointLabel === 'auto')
  ) {
    return getAndIncrementAutoCheckpointLabelForCurrentTest();
  }
  return undefined;
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

const parseOptionalBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

const resolveIncludeIncompleteInReport = (...optionSources) => {
  for (const source of optionSources) {
    if (
      source &&
      Object.prototype.hasOwnProperty.call(source, 'includeIncompleteInReport')
    ) {
      const parsed = parseOptionalBoolean(source.includeIncompleteInReport);
      if (typeof parsed === 'boolean') return parsed;
    }
  }
  const parsedFromEnv = parseOptionalBoolean(liveA11yRuntimeEnvConfig.includeIncompleteInReport);
  if (typeof parsedFromEnv === 'boolean') return parsedFromEnv;
  return false;
};

const resolveGenerateLiveA11yReports = (...optionSources) => {
  for (const source of optionSources) {
    if (
      source &&
      Object.prototype.hasOwnProperty.call(source, 'generateReports')
    ) {
      const parsed = parseOptionalBoolean(source.generateReports);
      if (typeof parsed === 'boolean') return parsed;
    }
  }
  const parsedFromEnv = parseOptionalBoolean(liveA11yRuntimeEnvConfig.generateReports);
  if (typeof parsedFromEnv === 'boolean') return parsedFromEnv;
  return true;
};

const resolveSkipLiveA11y = (...optionSources) => {
  for (const source of optionSources) {
    if (
      source &&
      Object.prototype.hasOwnProperty.call(source, 'runAccessibility')
    ) {
      const parsed = parseOptionalBoolean(source.runAccessibility);
      if (typeof parsed === 'boolean') return !parsed;
    }
    if (
      source &&
      Object.prototype.hasOwnProperty.call(source, 'skipAccessibility')
    ) {
      const parsed = parseOptionalBoolean(source.skipAccessibility);
      if (typeof parsed === 'boolean') return parsed;
    }
  }
  const parsedFromEnv = parseOptionalBoolean(liveA11yRuntimeEnvConfig.runAccessibility);
  if (typeof parsedFromEnv === 'boolean') return !parsedFromEnv;
  return true;
};

const refreshLiveA11yRuntimeEnvConfigFromCyEnv = () =>
  cy.env([
    LIVE_A11Y_RUN_ENV_VAR,
    LIVE_A11Y_GENERATE_REPORTS_ENV_VAR,
    LIVE_A11Y_INCLUDE_INCOMPLETE_ENV_VAR,
  ]).then((envValues = {}) => {
    setLiveA11yRuntimeEnvConfig({
      runAccessibility: envValues[LIVE_A11Y_RUN_ENV_VAR],
      generateReports: envValues[LIVE_A11Y_GENERATE_REPORTS_ENV_VAR],
      includeIncompleteInReport: envValues[LIVE_A11Y_INCLUDE_INCOMPLETE_ENV_VAR],
    });
  });

// Tracks previously seen rule+node pairs across tests in the same spec file
// (key includes normalized page URL so the same target on a different page is not "repeated").
const seenNodeViolationsBySpec = new Map();
// Monotonically increasing report emission number per spec file (resets per Cypress run),
// for unique filenames and report IDs when a spec calls reportLiveA11yResults more than once.
const specReportEmissionBySpec = new Map();
// spec+test key -> auto checkpoint label emission counter (A, B, ...).
const autoCheckpointLabelEmissionByTest = new Map();
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

const nodeViolationKey = (_ruleId, target, pageUrl, _findingType = 'violation') =>
  `${target || '<unknown>'}@@${normalizePageUrlForKey(pageUrl)}`;

const canonicalNodeTarget = (node = {}) => node.rawTarget || node.target;

const getAndIncrementSpecReportEmission = () => {
  const k = currentSpecKey();
  const n = (specReportEmissionBySpec.get(k) || 0) + 1;
  specReportEmissionBySpec.set(k, n);
  return n;
};

/**
 * 1 -> A, 2 -> B, ... 26 -> Z, 27 -> AA, ...
 * @param {number} index
 * @returns {string}
 */
const toAlphabeticLabel = (index) => {
  let n = Number(index) || 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
};

/**
 * Auto checkpoint label for current test context: checkpoint-A, checkpoint-B, ...
 * @returns {string}
 */
const getAndIncrementAutoCheckpointLabelForCurrentTest = () => {
  const key = `${currentSpecKey()}::${getCurrentTestTitleForMeta()}`;
  const next = (autoCheckpointLabelEmissionByTest.get(key) || 0) + 1;
  autoCheckpointLabelEmissionByTest.set(key, next);
  return `checkpoint-${toAlphabeticLabel(next)}`;
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
      const k = nodeViolationKey(v.id, canonicalNodeTarget(n), n.pageUrl, v.findingType);
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

const severitySectionTypeLabel = ({ failCount = 0, warnCount = 0, incompleteCount = 0 } = {}) => {
  if (Number(failCount) > 0) return 'VIOLATIONS';
  if (Number(warnCount) > 0) return 'WARNINGS';
  if (Number(incompleteCount) > 0) return 'INCOMPLETE (MANUAL REVIEW)';
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

const detectionPhaseLabel = (node) => {
  const initialCount = node.initialDetections || 0;
  const liveCount = node.liveDetections || 0;
  if (initialCount > 0 && liveCount > 0) return 'SCANS:initial+live';
  if (initialCount > 0) return 'SCANS:initial';
  return 'SCANS:live';
};

const compactPageLabel = (pageUrl) => {
  if (!pageUrl) return '';
  const raw = String(pageUrl);
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.length > 90 ? `${raw.slice(0, 87)}...` : raw;
  }
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
  let previousDispositionBucket = null;
  const sourceRectMap = liveSourceRectMap(rawResults);
  const severitySummaries = groupedViolations.reduce((acc, item) => {
    const severityKey = String(item?.impact || '').toLowerCase();
    if (!acc[severityKey]) {
      acc[severityKey] = {
        failGroups: 0,
        warnGroups: 0,
        incompleteGroups: 0,
        issueGroups: 0,
        issueNodes: 0,
        incompleteNodes: 0,
      };
    }
    const summary = acc[severityKey];
    const nodeCount = Number(item?.uniqueNodeCount || 0);
    if (item?.disposition === 'incomplete') {
      summary.incompleteGroups += 1;
      summary.incompleteNodes += nodeCount;
    } else {
      summary.issueGroups += 1;
      summary.issueNodes += nodeCount;
      if (item?.disposition === 'warn') {
        summary.warnGroups += 1;
      } else {
        summary.failGroups += 1;
      }
    }
    return acc;
  }, {});

  groupedViolations.forEach((violation, violationIndex) => {
    const badge = severityBadge(violation.impact);
    const colorMark = severityColorMark(violation.impact);
    const severityKey = String(violation.impact || '').toLowerCase();
    const severitySummary = severitySummaries[severityKey] || {
      failGroups: 0,
      warnGroups: 0,
      incompleteGroups: 0,
      issueGroups: 0,
      issueNodes: 0,
      incompleteNodes: 0,
    };

    if (severityKey !== previousSeverity) {
      previousSeverity = severityKey;
      hasLoggedGroupInSeverity = false;
      previousDispositionBucket = null;
    }
    const currentDispositionBucket = violation?.disposition === 'incomplete' ? 'incomplete' : 'issues';
    if (currentDispositionBucket !== previousDispositionBucket) {
      const sectionEmoji = severitySectionEmoji(violation.impact);
      const analysisMeta = rawResults?.meta?.analysis || {};
      const includedSet = new Set(
        (analysisMeta.configuredIncludedImpactLevels || []).map((s) => String(s || '').toLowerCase())
      );
      const warnSet = new Set(
        (analysisMeta.configuredWarnImpactLevels || []).map((s) => String(s || '').toLowerCase())
      );
      const issuePolicyLabel = warnSet.has(severityKey) && !includedSet.has(severityKey)
        ? 'WARNINGS'
        : 'VIOLATIONS';
      const issueSummaryLabel = severitySummary.failGroups > 0
        ? 'VIOLATION-ISSUES'
        : severitySummary.warnGroups > 0
          ? 'WARNING-ISSUES'
          : 'ISSUES';
      const sectionMessage = currentDispositionBucket === 'incomplete'
        ? `━━━━ ${sectionEmoji} ${badge} INCOMPLETE | groups:${severitySummary.incompleteGroups} | nodes:${severitySummary.incompleteNodes}`
        : `━━━━ ${sectionEmoji} ${badge} ${issuePolicyLabel} | groups:${severitySummary.issueGroups} | nodes:${severitySummary.issueNodes}`;
      const shouldShowSection = currentDispositionBucket === 'incomplete'
        ? severitySummary.incompleteGroups > 0
        : severitySummary.issueGroups > 0;
      if (shouldShowSection) {
        Cypress.log({
          name: '',
          message: sectionMessage,
          consoleProps: () => ({
            type: currentDispositionBucket === 'incomplete' ? 'severity-incomplete-section' : 'severity-issues-section',
            severity: severityKey,
            severityBadge: badge,
            sectionType: currentDispositionBucket === 'incomplete' ? 'INCOMPLETE' : issuePolicyLabel,
            failGroupsInSeverity: severitySummary.failGroups,
            warnGroupsInSeverity: severitySummary.warnGroups,
            incompleteGroupsInSeverity: severitySummary.incompleteGroups,
            issueGroupsInSeverity: severitySummary.issueGroups,
            issueNodesInSeverity: severitySummary.issueNodes,
            incompleteNodesInSeverity: severitySummary.incompleteNodes,
            issueSummaryLabel,
            message: sectionMessage,
          }),
        });
      }
      hasLoggedGroupInSeverity = false;
    }
    if (hasLoggedGroupInSeverity && currentDispositionBucket === previousDispositionBucket) {
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
        nodeViolationKey(violation.id, canonicalNodeTarget(node), node.pageUrl, violation.findingType)
      )
    ).length;
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
    const groupStateDetails = [
      repeatedNodesInGroup > 0 ? `repeated:${repeatedNodesInGroup}` : '',
      missingNodesCount > 0 ? `unavailable:${missingNodesCount}` : '',
      hiddenNodesCount > 0 ? `hidden:${hiddenNodesCount}` : '',
    ].filter(Boolean);
    const groupStateSummary = groupStateDetails.length > 0
      ? ` (${groupStateDetails.join(' · ')})`
      : '';
    const ruleDocSuffix = violation.helpUrl
      ? ` | [More info](${String(violation.helpUrl)})`
      : '';
    const ruleHelpUpper = String(violation.help || violation.id || 'UNKNOWN RULE').toUpperCase();
    const ruleIdLabel = `*(Rule ID: ${violation.id})*`;
    const logName = `[${colorMark} ${badge}]`;

    Cypress.log({
      name: logName,
      message: `\\#${violationIndex + 1} **${ruleHelpUpper} ${ruleIdLabel}** | NODES:${violation.uniqueNodeCount}${groupStateSummary}${ruleDocSuffix}`,
      $el: groupElements,
      consoleProps: () => ({
        ruleId: violation.id,
        severity: violation.impact,
        disposition: violation.disposition || 'fail',
        findingType: violation.findingType || 'violation',
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
        highlightedElementsCount: groupElements.length,
        notCurrentlyInDom: missingNodesCount > 0,
        inDomButNotVisibleCount: hiddenNodesCount,
        missingFromDomCount: missingNodesCount,
        unavailableForHighlightCount: unavailableNodesCount,
        axeCoreViolations: violation.rawViolations,
        groupStateBadges: groupStateDetails,
        groupStateLabel: `NODES:${violation.uniqueNodeCount}${groupStateSummary}`,
      }),
    });
    hasLoggedGroupInSeverity = true;
    previousDispositionBucket = currentDispositionBucket;

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
        const nodeKey = nodeViolationKey(
          violation.id,
          canonicalNodeTarget(node),
          node.pageUrl,
          violation.findingType
        );
        const wasSeenInPreviousTest = previouslySeenNodeKeys.has(nodeKey);
        const firstSpecReportIdForKey = wasSeenInPreviousTest
          ? getNodeFirstReportIdMapForCurrentSpec().get(nodeKey)
          : undefined;
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

        const repeatedBadge = wasSeenInPreviousTest
          ? `repeated`
          : '';
        const nodeStateDescriptors = [
          isMissingFromDom ? 'unavailable' : '',
          isInDomButHidden ? 'hidden' : '',
          repeatedBadge,
        ].filter(Boolean);
        const nodeStatusLabel = nodeStateDescriptors.length > 0
          ? `NODE: ${nodeStateDescriptors.join(' · ')}`
          : 'NODE: available';
        const nodeStateSuffix = nodeStateDescriptors.length > 0
          ? ` | ${nodeStatusLabel}`
          : '';
        Cypress.log({
          name: '---(🛠️ Node Fixme)▶',
          message: `(${nodeIndex + 1}) ${node.target || '<unknown>'} | ${detectionPhaseLabel(node)}${nodeStateSuffix}`,
          $el: highlightElements,
          consoleProps: () => ({
            ruleId: violation.id,
            pageUrl: node.pageUrl,
            severity: violation.impact,
            detectionSummary: detectionPhaseLabel(node),
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
            highlightedElementsCount: highlightElements.length,
            notCurrentlyInDom: isMissingFromDom,
            inDomButNotVisible: isInDomButHidden,
            notCurrentlyAvailableForHighlight,
            nodeStatusLabel,
            nodeStateBadges: nodeStateDescriptors,
            detectionPhaseLabel: detectionPhaseLabel(node),
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
      setScanTypeOnStore(win.__liveA11yMonitor.store, 'live');
      await win.__liveA11yMonitor.runInitialFullPageScan(axeOptions);

      if (commandOptions?.armAfter) {
        win.__liveA11yMonitor.arm(commandOptions.armOptions || { scanCurrent: false });
      }
    });
  }
);

Cypress.Commands.add(
  'checkAccessibility',
  (
    axeOptions = undefined,
    commandOptions = {
      waitForIdleBeforeScan: true,
      waitForIdleOptions: { quietMs: 500, timeoutMs: 8000 },
    }
  ) => {
    const runOneTimeScan = () => {
      return cy.window({ log: false }).then(async (win) => {
        if (!win.__liveA11yMonitor) {
          throw new Error('Live a11y monitor is not installed on window. Call cy.setupLiveA11yMonitor() before running scans.');
        }
        const monitorStore = win.__liveA11yMonitor.store;
        clearPriorLiveEntriesOnStore(monitorStore);
        syncCheckpointScanPolicyOnStore(monitorStore, axeOptions || {});
        await win.__liveA11yMonitor.runInitialFullPageScan(axeOptions);
      });
    };

    if (commandOptions?.waitForIdleBeforeScan === false) {
      return runOneTimeScan();
    }

    return cy
      .waitForLiveA11yIdle(
        commandOptions?.waitForIdleOptions || { quietMs: 500, timeoutMs: 8000 }
      )
      .then(() => runOneTimeScan());
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
  return cy.window({ log: false }).then((win) => {
    const monitorStore = win.__liveA11yMonitor?.store;
    if (monitorStore) {
      return monitorStore;
    }
    return getActiveLiveA11yStore();
  });
});

Cypress.Commands.add('reportLiveA11yResults', (options = {}) => {
  const throwOnValidationFailure = options.throwOnValidationFailure !== false;
  const includeIncompleteInReport = resolveIncludeIncompleteInReport(options);
  const generateArtifacts = resolveGenerateLiveA11yReports(options);
  const validation = {
    enabled: true,
    requireInitialScan: true,
    minLiveScans: 1,
    requireNoRuntimeErrors: true,
    failOnIncludedImpacts: true,
    ...options.validation,
  };

  return cy.getLiveA11yResults().then((results) => {
    const scanType = resolveScanTypeForReport(results, options.checkpointLabel);
    const checkpointLabel = resolveCheckpointLabelForReport(scanType, options.checkpointLabel);
    const { outputPath, reportMeta } = buildLiveA11yOutputPathAndMeta(options.outputPath, {
      checkpointLabel,
      scanType,
    });
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
        includeIncompleteInReport,
        generateArtifacts,
        deferValidationFailure: true,
      },
      { log: false }
    ).then((report) => {
      const reportTestTitle = report?.reportArtifact?.testTitle || getCurrentTestTitleForMeta();
      const perTestTrackingKey = toPerTestTrackingKey(reportTestTitle);
      if (checkpointLabel) {
        testsWithExplicitCheckpointReports.add(perTestTrackingKey);
      }
      const reportFailGroups = Number(report?.counts?.groupedByDisposition?.fail || 0);
      if (reportFailGroups > 0) {
        const existingFailEntry = testsWithFailingViolations.get(perTestTrackingKey) || {
          testKey: reportTestTitle,
          failGroups: 0,
          reports: [],
        };
        existingFailEntry.failGroups += reportFailGroups;
        existingFailEntry.reports.push({
          reportId: report?.reportArtifact?.reportId || 'unknown-report',
          checkpointLabel: checkpointLabel || null,
          failGroups: reportFailGroups,
        });
        testsWithFailingViolations.set(perTestTrackingKey, existingFailEntry);
      }
      const rid = report?.reportArtifact?.reportId;
      recordFirstReportIdsFromGroupedReport(report?.groupedViolations, rid);
      resetGhostOverlay();
      const includeIncompleteInReportInPayload = report?.reportOptions?.includeIncompleteInReport === true;
      const groupedBySeverity = report.counts.groupedBySeverity || {};
      const groupedBySeverityIssues = report.counts.groupedBySeverityIssues || {};
      const groupedBySeverityIncomplete = report.counts.groupedBySeverityIncomplete || {};
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
        groupedIssues: report.counts.groupedViolations,
        groupedFindingsTotal: report.counts.groupedFindingsTotal || 0,
        severityCounts: groupedBySeverity,
        severityIssueCounts: groupedBySeverityIssues,
        outcomeCounts: groupedByDisposition,
        technicalMetrics,
        ...(includeIncompleteInReportInPayload
          ? {
            initialIncomplete: report.counts.initialIncomplete || 0,
            initialDistinctNodesWithIncomplete: report.counts.initialNodesWithIncomplete || 0,
            liveIncomplete: report.counts.liveIncomplete || 0,
            liveDistinctNodesWithIncomplete: report.counts.liveNodesWithIncomplete || 0,
            groupedIncomplete: report.counts.groupedIncomplete || 0,
            severityIncompleteCounts: groupedBySeverityIncomplete,
          }
          : {}),
      };
      const ar = report?.reportArtifact || {};
      const reportCheckpointLabel = String(ar?.checkpointLabel || options?.checkpointLabel || '').trim().toUpperCase();
      const checkpointTag = reportCheckpointLabel ? ` [CHECKPOINT ${reportCheckpointLabel}]` : '';
      if (reportCheckpointLabel) {
        Cypress.log({
          name: '📍 CHECKPOINT',
          message: `Results for checkpoint ${reportCheckpointLabel}`,
          consoleProps: () => ({
            checkpointLabel: reportCheckpointLabel,
            reportId: ar.reportId,
            testTitle: ar.testTitle,
          }),
        });
      }
      cy.log(`════════════ 📊 𝗔11𝗬 𝗙𝗜𝗡𝗗𝗜𝗡𝗚 𝗦𝗨𝗠𝗠𝗔𝗥𝗬${checkpointTag}`);
      Cypress.log({
        name: '',
        message: `════════════ 📝 𝗔11𝗬 𝗙𝗜𝗡𝗗𝗜𝗡𝗚 𝗗𝗘𝗧𝗔𝗜𝗟𝗦${checkpointTag} (𝗰𝗼𝗻𝘀𝗼𝗹𝗲 𝗽𝗿𝗼𝗽𝘀)`,

        consoleProps: () => summaryForConsole,
      });
      const severityOrder = Array.isArray(report?.severityOrder)
        ? report.severityOrder
        : ['critical', 'serious', 'moderate', 'minor'];
      severityOrder.forEach((severity) => {
        const issuesCount = Number(groupedBySeverityIssues?.[severity] ?? 0);
        const incompleteCount = Number(groupedBySeverityIncomplete?.[severity] ?? 0);
        const failCount = Number(report?.counts?.groupedBySeverityDisposition?.[severity]?.fail || 0);
        const warnCount = Number(report?.counts?.groupedBySeverityDisposition?.[severity]?.warn || 0);
        const issueSummaryLabel = (failCount > 0 || warnCount > 0)
          ? 'CONFIRMED'
          : 'ISSUES';
        const label = severitySummaryLabel(severity, report?.impactPolicy || {});
        const summaryBreakdown = includeIncompleteInReportInPayload
          ? `${issueSummaryLabel}:${issuesCount} | INCOMPLETE:${incompleteCount}`
          : `${issueSummaryLabel}:${issuesCount}`;
        cy.log(
          `•${checkpointTag ? ` ${checkpointTag.trim()}` : ''} ${label} ${severityColorMark(severity)} : ${summaryBreakdown}`
        );
      });
      logGroupedViolations(report.groupedViolations, report.raw);
      cy.log('· · · · ·');
      technicalOrder.forEach((metricKey) => {
        const metricLabel = metricHelp?.[metricKey]?.label || metricKey;
        const metricValue = Number(technicalMetrics?.[metricKey] ?? 0);
        cy.log(`${metricLabel}: ${metricValue}`);
      });
      cy.log('· · · · ·');
      const jsonPath = report?.savedTo;
      const htmlPath = report?.savedHtmlTo || report?.htmlReportRelative;
      const artifactsGenerated = Boolean(jsonPath || htmlPath);
      if (!artifactsGenerated) {
        cy.log('Live a11y report artifacts skipped (generateReports=false)');
      } else {
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
        if (jsonPath) {
          cy.log(`Live a11y JSON: ${jsonPath}`);
        }
        if (htmlPath) {
          cy.log(`Live a11y HTML: ${htmlPath}`);
        }
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
  error.reportPath = report?.savedTo || 'in-memory report (artifacts disabled)';
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
    setLiveA11yAutoReportRuntimeOptions(options);
  });
});

Cypress.Commands.add('setLiveA11yAutoSetupOptions', (options = {}) => {
  return cy.then(() => {
    setLiveA11yAutoSetupRuntimeOptions(options);
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

const resolveAutoLifecycleSetupOptions = (setupOptions = {}, runtimeSetupOptions = {}) =>
  resolveLiveA11yMonitorInstallOptions(
    mergeLiveA11ySetupOptions(
      mergeLiveA11ySetupOptions(AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP, setupOptions),
      runtimeSetupOptions
    )
  );

const logLiveA11yValidationMarker = ({
  testKey,
  reportPath,
  validationErrors = [],
  failCount = 0,
  warnCount = 0,
  incompleteCount = 0,
  includeIncompleteInReport = false,
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
  const findingsCountsLabel = includeIncompleteInReport
    ? `fail-groups:${failCount} | warn-groups:${warnCount} | incomplete-groups:${incompleteCount}`
    : `fail-groups:${failCount} | warn-groups:${warnCount}`;
  const message = isValid
    ? `${testKey} | ${findingsCountsLabel} | no failing violations`
    : `${testKey} | ${findingsCountsLabel} | ${shortErrorsLabel}`;
  Cypress.log({
    name: prefix,
    message,
    consoleProps: () => ({
      test: testKey,
      failGroups: failCount,
      warnGroups: warnCount,
      ...(includeIncompleteInReport ? { incompleteGroups: incompleteCount } : {}),
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
let isLiveA11yAutoVisitCommandOverwriteInstalled = false;
let isLiveA11yAutoLifecycleRegistered = false;
const AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP = {
  observerOptions: {
    minVisibleMs: 0,
    stableFrames: 1,
    maxSettleMs: 300,
  },
};

const ensureLiveA11yAutoVisitCommandOverwrite = ({ setupOptions }) => {
  if (isLiveA11yAutoVisitCommandOverwriteInstalled) {
    return;
  }

  Cypress.Commands.overwrite('visit', (originalFn, ...args) => {
    const runtimeSetupOptions = getLiveA11yAutoSetupRuntimeOptions();
    const shouldSkipLiveA11y = resolveSkipLiveA11y(runtimeSetupOptions, setupOptions);
    if (shouldSkipLiveA11y) {
      return originalFn(...args);
    }
    const store = getActiveLiveA11yStore();
    if (!store) {
      return originalFn(...args);
    }
    const resolvedSetupOptions = resolveAutoLifecycleSetupOptions(setupOptions, runtimeSetupOptions);

    const wrapOnBeforeLoad = (existingOnBeforeLoad) => (win) => {
      installLiveA11yMonitorOnWindow(win, store, resolvedSetupOptions);
      if (typeof existingOnBeforeLoad === 'function') {
        existingOnBeforeLoad(win);
      }
    };

    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const onlyOptionsArg = args[0];
      return originalFn({
        ...onlyOptionsArg,
        onBeforeLoad: wrapOnBeforeLoad(onlyOptionsArg.onBeforeLoad),
      });
    }

    if (args.length >= 2 && args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])) {
      const [url, options, ...rest] = args;
      return originalFn(url, {
        ...options,
        onBeforeLoad: wrapOnBeforeLoad(options.onBeforeLoad),
      }, ...rest);
    }

    if (args.length >= 1) {
      const [url, ...rest] = args;
      return originalFn(url, {
        onBeforeLoad: wrapOnBeforeLoad(undefined),
      }, ...rest);
    }

    return originalFn(...args);
  });

  isLiveA11yAutoVisitCommandOverwriteInstalled = true;
};

const ensureLiveA11yAutoNavigationHook = ({ setupOptions, initialScan }) => {
  if (isLiveA11yAutoNavigationHookInstalled) {
    return;
  }

  Cypress.on('window:before:load', (win) => {
    const store = getActiveLiveA11yStore();
    if (!store) {
      return;
    }

    const resolvedCommandOptions = initialScan?.commandOptions || {
      armAfter: false,
      armOptions: { scanCurrent: false },
    };
    const runtimeSetupOptions = getLiveA11yAutoSetupRuntimeOptions();
    const shouldSkipLiveA11y = resolveSkipLiveA11y(runtimeSetupOptions, setupOptions);
    if (shouldSkipLiveA11y) {
      return;
    }
    const resolvedSetupOptions = resolveAutoLifecycleSetupOptions(setupOptions, runtimeSetupOptions);
    installLiveA11yMonitorOnWindow(win, store, resolvedSetupOptions);

    win.addEventListener('load', () => {
      const monitor = win.__liveA11yMonitor;
      if (!monitor) {
        return;
      }
      setScanTypeOnStore(monitor.store, 'live');
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
  if (isLiveA11yAutoLifecycleRegistered) {
    return;
  }
  isLiveA11yAutoLifecycleRegistered = true;
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

  ensureLiveA11yAutoVisitCommandOverwrite({ setupOptions });
  ensureLiveA11yAutoNavigationHook({ setupOptions, initialScan });

  beforeEach(function liveA11yAutoBeforeEach() {
    const titlePath = typeof this.currentTest?.titlePath === 'function'
      ? this.currentTest.titlePath()
      : this.currentTest?.titlePath;
    const testKey =
      (Array.isArray(titlePath) ? titlePath.join(' > ') : undefined) ||
      this.currentTest?.fullTitle?.() ||
      this.currentTest?.title ||
      'unknown-test';
    const perTestTrackingKey = toPerTestTrackingKey(this.currentTest?.title || testKey);
    testsWithExplicitCheckpointReports.delete(perTestTrackingKey);
    testsWithFailingViolations.delete(perTestTrackingKey);
    setActiveLiveA11yStore(createLiveA11yStore());
    refreshLiveA11yRuntimeEnvConfigFromCyEnv();
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
    const perTestTrackingKey = toPerTestTrackingKey(this.currentTest?.title || testKey);
    const runtimeSetupOptions = getLiveA11yAutoSetupRuntimeOptions();
    const runtimeReportOptions = getLiveA11yAutoReportRuntimeOptions();
    const shouldSkipLiveA11y = resolveSkipLiveA11y(runtimeSetupOptions, setupOptions);
    const shouldGenerateReports = resolveGenerateLiveA11yReports(
      runtimeSetupOptions,
      setupOptions,
      runtimeReportOptions,
      reportOptions
    );
    const includeIncompleteInReport = resolveIncludeIncompleteInReport(
      runtimeSetupOptions,
      setupOptions,
      runtimeReportOptions,
      reportOptions
    );
    clearLiveA11yAutoReportRuntimeOptions();
    clearLiveA11yAutoSetupRuntimeOptions();
    if (shouldSkipLiveA11y) {
      pendingValidationFailuresByTest.delete(testKey);
      Cypress.log({
        name: '⏭ LIVE A11Y SKIPPED',
        message: `Skipping live a11y monitor + report for "${testKey}" (${LIVE_A11Y_RUN_ENV_VAR}=false)`,
        consoleProps: () => ({
          test: testKey,
          envVar: LIVE_A11Y_RUN_ENV_VAR,
          runtimeSetupOptions,
          setupOptions,
        }),
      });
      if (stopMonitorAfterEach) {
        cy.stopLiveA11yMonitor();
      }
      cy.then(() => {
        setActiveLiveA11yStore(null);
      });
      return;
    }

    if (testsWithExplicitCheckpointReports.has(perTestTrackingKey)) {
      pendingValidationFailuresByTest.delete(testKey);
      if (stopMonitorAfterEach) {
        cy.stopLiveA11yMonitor();
      }
      cy.then(() => {
        setActiveLiveA11yStore(null);
      });
      return;
    }

    const resolvedReportOptions = {
      ...reportOptions,
      ...runtimeReportOptions,
      generateReports: shouldGenerateReports,
      includeIncompleteInReport,
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
      const incompleteCount = Number(report?.counts?.groupedByDisposition?.incomplete || 0);
      const includeIncompleteInReportInPayload = report?.reportOptions?.includeIncompleteInReport === true;
      if (report?.validation?.valid) {
        pendingValidationFailuresByTest.delete(testKey);
        logLiveA11yValidationMarker({
          testKey,
          reportPath: report?.savedTo || 'in-memory report (artifacts disabled)',
          failCount,
          warnCount,
          incompleteCount,
          includeIncompleteInReport: includeIncompleteInReportInPayload,
          isValid: true,
        });
        return;
      }
      const validationErrors = Array.isArray(report?.validation?.errors)
        ? report.validation.errors
        : ['Unknown validation error'];
      const reportPath = report?.savedTo || 'in-memory report (artifacts disabled)';
      const message = `Live a11y validation failed for this test:\n- ${validationErrors.join('\n- ')}\nReport: ${reportPath}`;
      pendingValidationFailuresByTest.set(testKey, {
        testKey,
        message,
        reportPath,
        validationErrors,
        failCount,
        incompleteCount,
      });
      logLiveA11yValidationMarker({
        testKey,
        reportPath,
        validationErrors,
        failCount,
        warnCount,
        incompleteCount,
        includeIncompleteInReport: includeIncompleteInReportInPayload,
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
    cy.then(() => {
      setActiveLiveA11yStore(null);
    });
  });

  after(() => {
    if (!failRunOnValidationError) {
      return;
    }
    const validationFailureCount = pendingValidationFailuresByTest.size;
    const failingViolationEntries = [...testsWithFailingViolations.values()]
      .filter((entry) => Number(entry?.failGroups || 0) > 0);
    if (validationFailureCount === 0 && failingViolationEntries.length === 0) {
      return;
    }
    Cypress.log({
      name: '⛔ LIVE A11Y STRICT MODE',
      message: '════════════ FINAL RUN FAILURE (STRICT MODE) ════════════',
      consoleProps: () => ({
        failingTests: [...pendingValidationFailuresByTest.keys()],
        totalFailingValidationTests: validationFailureCount,
        failingViolationTests: failingViolationEntries.map((entry) => entry.testKey),
        totalFailingViolationTests: failingViolationEntries.length,
      }),
    });
    const validationDetails = [...pendingValidationFailuresByTest.values()]
      .map((entry) => `- ${entry.testKey}\n  ${entry.message.replace(/\n/g, '\n  ')}`)
      .join('\n');
    const failingViolationDetails = failingViolationEntries
      .map((entry) => {
        const reportDetails = (entry.reports || [])
          .map((reportEntry) => {
            const checkpointSuffix = reportEntry.checkpointLabel
              ? ` (checkpoint ${String(reportEntry.checkpointLabel).toUpperCase()})`
              : '';
            return `${reportEntry.reportId}${checkpointSuffix}: fail-groups=${reportEntry.failGroups}`;
          })
          .join(', ');
        return `- ${entry.testKey}\n  failing grouped violations: ${entry.failGroups}\n  reports: ${reportDetails}`;
      })
      .join('\n');
    const detailsSections = [
      validationDetails
        ? `Validation failures (${validationFailureCount} test(s)):\n${validationDetails}`
        : '',
      failingViolationDetails
        ? `Failing grouped violations detected (${failingViolationEntries.length} test(s)):\n${failingViolationDetails}`
        : '',
    ].filter(Boolean);
    throw new Error(
      `Live a11y strict mode detected failures:\n${detailsSections.join('\n\n')}`
    );
  });
};

// Auto-register global lifecycle hooks when this module is imported from cypress/support/e2e.js.
registerLiveA11yAutoLifecycle();
