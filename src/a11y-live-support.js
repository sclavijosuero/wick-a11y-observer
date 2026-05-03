import { installLiveA11yMonitorOnWindow } from './a11y-setup';
import {
  AXE_IMPACT_ORDER,
  DEFAULT_ACCESSIBILITY_RESULTS_FOLDER,
} from './a11y-shared-constants.js';

/**
 * Helpers for live axe monitoring: shared state, env/options, paths, axe merge, tracking,
 * command-log UX, monitor install resolution, hook helpers, and auto-lifecycle visit/navigation
 * installers. Cypress commands live in `a11y-observer-commands.js`.
 *
 * Consumption: `import a11yLive from './a11y-live-support.js'` — one default export object; see
 * `liveA11yIntegration` for flags the commands layer mutates (e.g. idempotent hook registration).
 *
 * Reading guide (top → bottom):
 *   Env keys & Cypress.expose ··· mutable auto-lifecycle state ··· runtime option setters
 *   Report paths / reportMeta ··· default axe profile ··· monitor store (checkpoint vs live)
 *   Boolean toggles & env refresh ··· cross-test Maps (emissions, checkpoints, first report ids)
 *   Mocha test identity ··· Command Log UX (severity styling, ghost overlay, logGroupedViolations)
 *   Monitor install merge ··· hook-safe test failure ··· cy.setLiveA11yAuto* commands
 *   Auto lifecycle setup merge ··· validation banner log ··· cy.visit overwrite & window:before:load
 *   default export (facade for a11y-observer-commands.js)
 */

// -----------------------------------------------------------------------------
// Environment keys & Cypress.expose mirrors
// What: String keys for live-a11y env vars and for values stashed on Cypress.expose.
// Why: Browser hooks and Node-side Cypress tasks read the same toggles; exposing keys keeps
//      naming consistent and documents what the runner expects (see plugin/task code).
// -----------------------------------------------------------------------------
const LIVE_A11Y_AUTO_REPORT_OPTIONS_ENV_KEY = '__liveA11yAutoReportOptions';
const LIVE_A11Y_AUTO_SETUP_OPTIONS_ENV_KEY = '__liveA11yAutoSetupOptions';
const LIVE_A11Y_INCLUDE_INCOMPLETE_ENV_VAR = 'LIVE_A11Y_INCLUDE_INCOMPLETE';
const LIVE_A11Y_GENERATE_REPORTS_ENV_VAR = 'LIVE_A11Y_GENERATE_REPORTS';
const LIVE_A11Y_RUN_ENV_VAR = 'LIVE_A11Y_RUN';

// -----------------------------------------------------------------------------
// Module-level mutable state (auto lifecycle)
// What: Active monitor store pointer, per-run setup/report option overrides, env-derived toggles,
//       and Sets/Maps tracking checkpoint reports and tests that already failed on violations.
// Why: Cypress commands and hooks run in one JS realm but across tests; this state ties the
//      shared store to the current spec and drives afterEach validation without passing globals.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Runtime setup/report overrides + env snapshot on Cypress.expose
// What: Setters/getters/clearers for options applied after registration (`cy.setLiveA11yAuto*`).
// Why: Hooks and plugins read the latest overrides via expose without importing this module on
//      the Node side; env snapshot mirrors LIVE_A11Y_* so CLI/env can gate scans and reports.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Report filenames, paths, reportId, and metadata
// What: Builds default output paths under the accessibility folder, stable sortable timestamps,
//       spec stems, test ordinals, checkpoint labels, and a structured reportMeta object.
// Why: Artifacts must be unique per run/emission, safe on Windows, sortable in CI artifacts,
//      and rich enough for HTML/JSON consumers without re-parsing the spec path.
// -----------------------------------------------------------------------------
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
  // Spec identity: raw filename + slug stem (drops .cy.*) for stable artifact prefixes.
  const specRaw = Cypress.spec?.name || fileBasename(Cypress.spec?.relative) || 'unknown-spec';
  const stem = sanitizeSpecStemForFilename(String(specRaw).replace(/\.cy\.(js|jsx|ts|tsx)$/i, ''));
  // Timestamp + monotonic emission counter → unique sortable filenames within one Cypress run.
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
  // Prefer suite ordinal for Txx when known; else fall back to emission index so paths stay unique.
  const testNumberInSpec = suiteOrd?.index || emission;
  const testNumberInSpecPadded = String(testNumberInSpec).padStart(2, '0');
  const sanitizedCheckpointLabel = checkpointLabel
    ? sanitizeCheckpointLabel(checkpointLabel)
    : undefined;
  const isCheckpointScanReport = scanType === 'checkpoint';
  // Filename + reportId pattern: continuous live scans vs checkpoint scans (extra checkpoint segment).
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
  // Structured metadata travels into JSON/HTML (identity rows, dedupe, checkpoint labels).
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

// -----------------------------------------------------------------------------
// Default axe scan profile and normalization helpers
// What: WCAG tag set, default impacts (fail vs warn), and functions to normalize impact arrays
//       and runOnly tag lists against AXE_IMPACT_ORDER / dedupe rules.
// Why: Gives commands a single baseline; user options merge predictably and invalid levels drop.
// -----------------------------------------------------------------------------
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

const normalizeImpactLevels = (values) => {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => AXE_IMPACT_ORDER.includes(value));
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

// -----------------------------------------------------------------------------
// Monitor store: checkpoint policy, scan type, live buffer hygiene
// What: Writes analysis metadata (checkpoint vs live, configured impacts/tags), clears prior live
//       entries before one-off scans, and derives scan type / checkpoint labels for reporting.
// Why: HTML/report layers need policy context; checkpoint scans must not mix stale live rows;
//       auto checkpoint labels (A, B, …) keep filenames distinct without user input.
// -----------------------------------------------------------------------------
const syncCheckpointScanPolicyOnStore = (store, axeOptions = {}) => {
  if (!store || typeof store !== 'object') return;
  if (!store.meta || typeof store.meta !== 'object') {
    store.meta = {};
  }
  const analysis = store.meta.analysis && typeof store.meta.analysis === 'object'
    ? store.meta.analysis
    : {};

  // Detect per-checkpoint axe overrides so we can mirror them into meta.analysis for reporters.
  const hasIncludedImpactsOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'includedImpacts');
  const hasImpactLevelsOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'impactLevels');
  const hasWarnImpactsOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'onlyWarnImpacts');
  const hasRunOnlyOverride = Object.prototype.hasOwnProperty.call(axeOptions, 'runOnly');

  // No axe overrides: only stamp scan type (checkpoint) and keep existing analysis fields.
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

  // Overrides present: rebuild included/warn/considered impacts + optional runOnly tags for HTML/summary.
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

/** Checkpoint scans: drop accumulated multi-nav page overviews so each checkpoint report only shows that scan’s URL(s). */
const clearInitialPageVisualsOnStore = (store) => {
  if (!store || typeof store !== 'object') return;
  store.initialPageVisual = null;
  store.initialPageVisuals = [];
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

/**
 * Live vs checkpoint artifact naming follows the monitor store (`results.meta.analysis.scanType`).
 * A checkpoint label option alone must not promote a live store to checkpoint filenames.
 */
const resolveScanTypeForReport = (results, _checkpointLabel) =>
  normalizeScanType(results?.meta?.analysis?.scanType);

const resolveCheckpointLabelForReport = (scanType, checkpointLabel) => {
  if (scanType !== 'checkpoint') {
    return undefined;
  }
  if (checkpointLabel === true || checkpointLabel === 'auto') {
    return getAndIncrementAutoCheckpointLabelForCurrentTest();
  }
  if (typeof checkpointLabel === 'string' && checkpointLabel.trim()) {
    return checkpointLabel.trim();
  }
  return getAndIncrementAutoCheckpointLabelForCurrentTest();
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

// -----------------------------------------------------------------------------
// Boolean coercion and effective toggles (options + env)
// What: parseOptionalBoolean for loose strings; resolve* walks option objects left-to-right then
//       runtime env snapshot (includeIncomplete, generateReports, skip/disable accessibility).
// Why: Supports Cypress.env, cy commands, and numeric/boolean CLI values with predictable wins:
//      explicit per-call options override softer env defaults.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Refresh runtime env snapshot from Cypress.env
// What: cy.env(...) batch read of LIVE_A11Y_* keys into setLiveA11yRuntimeEnvConfig.
// Why: Ensures each test sees updated env without restarting Cypress; hooks call this early.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Per-spec cross-test tracking (repeated violations, emissions, auto checkpoints)
// What: Maps/Sets keyed by spec relative path — seen node keys, report emission counter per spec,
//       auto checkpoint label sequences per test, first reportId per node key for “repeated” UX.
// Why: Surfaces “same issue as earlier in this spec” in logs/HTML; keeps filenames/reportIds
//      unique when multiple writes happen; distinguishes same selector on different URLs.
// -----------------------------------------------------------------------------
const seenNodeViolationsBySpec = new Map();
// Monotonically increasing report emission number per spec file (resets per Cypress run),
// for unique filenames and report IDs when a spec calls reportLiveA11yResults more than once.
const specReportEmissionBySpec = new Map();
// spec+test key -> auto checkpoint label emission counter (A, B, ...).
const autoCheckpointLabelEmissionByTest = new Map();
// specKey -> Map<nodeViolationKey, firstReportId> for cross-report "repeated" HTML + log context
const specToNodeKeyFirstReportId = new Map();

const currentSpecKey = () => Cypress.spec?.relative || Cypress.spec?.name || 'unknown-spec';

// -----------------------------------------------------------------------------
// Node/page keys and “first seen in this spec” report id
// What: normalizePageUrlForKey, nodeViolationKey, canonicalNodeTarget, per-spec Map of first reportId.
// Why: Stable keys power dedupe and cross-report linking; URL normalization avoids trivial dupes.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Mocha test identity (titles and suite ordinals)
// What: resolveMochaTestCase walks runnable/ctx for the real `it` during hooks; titlePath for
//       metadata; getTestOrdinalInCurrentMochaSuite for “Test N of M” labels and filenames.
// Why: In afterEach/beforeEach the active runnable is often a hook — Cypress.currentTest alone
//      can point at the wrong node; this avoids mis-attributing reports to hook titles.
// -----------------------------------------------------------------------------
/**
 * Mocha `it()` for the test case, not a hook. In `afterEach` the active `runnable` is
 * a hook, so `ctx.test` is the hook — the finished `it` is on `ctx.currentTest`.
 * @returns {object | null}
 */
const resolveMochaTestCase = () => {
  const r = cy.state('runnable');
  const ctx = r?.ctx;
  // Hook runnable → the finished `it` hangs off ctx.currentTest (not ctx.test).
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
  // Fallbacks for Mocha variants that omit `type` but still expose fullTitle / parent.tests.
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
  // Prefer resolved real `it` (correct during hooks); then Cypress.currentTest; then cy.state probe.
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
    // Same suite only (parent.tests); match by reference or fullTitle for robustness.
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

// -----------------------------------------------------------------------------
// Command-log UX: severity labels, colors, and ghost overlay for missing/hidden nodes
// What: Maps impact → badge text, emoji, colors; maintains a full-screen fixed overlay and
//       “ghost” chips positioned from last known live-scan rects when DOM nodes are gone/hidden.
// Why: Cypress.log $el highlights need a DOM node — ghosts preserve spatial context and severity
//      signaling so failures stay actionable in the runner UI even after DOM churn.
// -----------------------------------------------------------------------------
const GHOST_OVERLAY_ID = 'live-axe-ghost-overlay';

// --- Per-spec Set of node keys already logged this run (for “repeated” badges in Command Log) ---
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

// --- Severity presentation (badges, emoji, CSS colors) shared by group + node logs ---
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

// --- Full-screen ghost layer: fixed overlay + dashed chips when axe targets are gone/hidden ---
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

// Map live-scan root identity → last bounding rect (anchors ghosts when node selectors no longer match).
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

// Resolve axe selector strings to real DOM nodes in the AUT (invalid selectors ignored).
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

// -----------------------------------------------------------------------------
// Cypress.log tree: grouped rules and per-node entries with $el highlights
// What: Aggregates severity sections, rule groups, and node-level logs; resolves DOM for selectors,
//       falls back to ghost nodes, tracks “repeated” keys, and records keys for next test.
// Why: Gives a scannable hierarchy in the Command Log aligned with report grouping; ghosts attach
//      to $el so screenshots and hover states remain meaningful when elements disappeared.
// -----------------------------------------------------------------------------
const logGroupedViolations = (groupedViolations = [], rawResults = null) => {
  const previouslySeenNodeKeys = getSeenNodeSetForCurrentSpec();
  const currentTestNodeKeys = new Set();
  let previousSeverity = null;
  let hasLoggedGroupInSeverity = false;
  let previousDispositionBucket = null;
  const sourceRectMap = liveSourceRectMap(rawResults);
  // Pre-pass: per-impact counts (fail/warn/incomplete groups + nodes) for section header lines.
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

  // Main pass: emit Cypress.log hierarchy — severity sections → rule groups → per-node rows.
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

    // New impact bucket: reset disposition tracking so we can emit a fresh section banner below.
    if (severityKey !== previousSeverity) {
      previousSeverity = severityKey;
      hasLoggedGroupInSeverity = false;
      previousDispositionBucket = null;
    }
    const currentDispositionBucket = violation?.disposition === 'incomplete' ? 'incomplete' : 'issues';
    // Crossing incomplete vs fail/warn issues within same severity → new subsection header + counts.
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
        ? `━━━━ ${sectionEmoji} ${badge} INCOMPLETE | rules:${severitySummary.incompleteGroups} | nodes:${severitySummary.incompleteNodes}`
        : `━━━━ ${sectionEmoji} ${badge} ${issuePolicyLabel} | rules:${severitySummary.issueGroups} | nodes:${severitySummary.issueNodes}`;
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
    // Visual separator between consecutive rule groups inside the same severity/disposition block.
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

    // Per node: query AUT for selector, split visible vs missing/hidden, attach fallback rects for ghosts.
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
    // How many nodes in this rule were already seen in an earlier report this spec (repeat UX).
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
    // Rule-level log line: $el is union of visible nodes + ghost elements so runner highlights something.
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

    // Node-level log lines: one Cypress.log per failing node with highlight or ghost + repeat metadata.
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

  // Persist keys from this test so the next emission can mark repeats correctly.
  currentTestNodeKeys.forEach((key) => previouslySeenNodeKeys.add(key));
};

// -----------------------------------------------------------------------------
// Resolve merged monitor install options (initial vs live axe + observer)
// What: Deep-merge DEFAULT_AXE_SCAN_OPTIONS with initialAxeOptions and liveAxeOptions separately.
// Why: Install path (`a11y-setup`) expects fully merged axe config objects; keeps defaults stable.
// -----------------------------------------------------------------------------
const resolveLiveA11yMonitorInstallOptions = (monitorOptions = {}) => {
  const {
    initialAxeOptions = {},
    liveAxeOptions = {},
    observerOptions = {},
    visualSnapshots,
  } = monitorOptions;

  // Initial vs live axe configs merge independently against the same defaults (tags, impacts, rules).
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
    ...(visualSnapshots !== undefined ? { visualSnapshots } : {}),
    initialAxeOptions: computedInitialOptions,
    liveAxeOptions: computedLiveOptions,
  };
};

// -----------------------------------------------------------------------------
// Fail the active test from a hook without a thrown exception
// What: resolveCurrentTestFromHookContext + markTestAsFailedWithoutThrowingHook uses runner.fail.
// Why: Validation in afterEach must not break Cypress’s hook chain; Mocha’s fail marks the test
//      failed while allowing teardown and remaining hooks to behave predictably.
// -----------------------------------------------------------------------------
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
  // Enrich error for debugging artifacts; avoid throw inside hook (use runner.fail when available).
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

// -----------------------------------------------------------------------------
// Cypress commands: stash per-test setup/report overrides for auto lifecycle
// What: cy.setLiveA11yAutoReportOptions / cy.setLiveA11yAutoSetupOptions wrap setters above.
// Why: Tests can tune axe or reporting for the next navigation/hook cycle without re-registering.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Merge registration setup + runtime overrides + fast pre-navigation observer defaults
// What: mergeLiveA11ySetupOptions shallow-merges nested initial/live/observer blocks;
//       resolveAutoLifecycleSetupOptions layers AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP first.
// Why: Auto lifecycle needs aggressive settle defaults so flush scans run quickly after nav;
//      runtime cy.setLiveA11yAutoSetupOptions wins over static plugin options where provided.
// -----------------------------------------------------------------------------
// Shallow top-level merge + deep merge for nested axe/observer blocks (runtime overrides patch defaults).
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

// Layering order: fast pre-nav observer defaults → static plugin setup → cy.setLiveA11yAutoSetupOptions wins.
const resolveAutoLifecycleSetupOptions = (setupOptions = {}, runtimeSetupOptions = {}) =>
  resolveLiveA11yMonitorInstallOptions(
    mergeLiveA11ySetupOptions(
      mergeLiveA11ySetupOptions(AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP, setupOptions),
      runtimeSetupOptions
    )
  );

// -----------------------------------------------------------------------------
// Auto lifecycle validation banner in the Command Log
// What: logLiveA11yValidationMarker emits pass vs failure messaging with counts and errors.
// Why: Distinguishes “hard fail” vs “validation failed but Cypress still green” when hooks differ.
// -----------------------------------------------------------------------------
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
  // Single banner summarizing validation outcome vs grouped findings (strict mode vs soft fail).
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

// -----------------------------------------------------------------------------
// One-time installers + default observer tuning for navigation-driven scans
// What: Flags prevent double overwrite of cy.visit / window:before:load; AUTO_LIVE_A11Y_* holds
//       short idle thresholds; liveA11yIntegration.autoLifecycleRegistered for idempotent register.
// Why: Duplicate hooks would stack monitors or double-scan; fast settle reduces flake on SPA nav.
// -----------------------------------------------------------------------------
let isLiveA11yAutoNavigationHookInstalled = false;
let isLiveA11yAutoVisitCommandOverwriteInstalled = false;

/** Mutated from `a11y-observer-commands.js` for idempotent `registerLiveA11yAutoLifecycle`. */
export const liveA11yIntegration = {
  autoLifecycleRegistered: false,
  /** Registration-time `setupOptions` — used with `resolveSkipLiveA11y` in `cy.checkAccessibility`. */
  autoLifecycleDefaultSetupOptions: undefined,
};
const AUTO_LIVE_A11Y_PRE_NAV_FLUSH_SETUP = {
  observerOptions: {
    minVisibleMs: 0,
    stableFrames: 1,
    maxSettleMs: 300,
  },
};

// -----------------------------------------------------------------------------
// Auto lifecycle: cy.visit overwrite — install monitor before AUT scripts run
// What: Overwrites visit once; merges onBeforeLoad to call installLiveA11yMonitorOnWindow with the
//       shared store and resolved setup when live a11y is not skipped.
// Why: Guarantees the monitor exists for the first paint; matches user mental model (visit = app).
// -----------------------------------------------------------------------------
const ensureLiveA11yAutoVisitCommandOverwrite = ({ setupOptions }) => {
  if (isLiveA11yAutoVisitCommandOverwriteInstalled) {
    return;
  }

  Cypress.Commands.overwrite('visit', (originalFn, ...args) => {
    const runtimeSetupOptions = getLiveA11yAutoSetupRuntimeOptions();
    const shouldSkipLiveA11y = resolveSkipLiveA11y(runtimeSetupOptions, setupOptions);
    // Accessibility off or no shared store → delegate to native visit unchanged.
    if (shouldSkipLiveA11y) {
      return originalFn(...args);
    }
    const store = getActiveLiveA11yStore();
    if (!store) {
      return originalFn(...args);
    }
    const resolvedSetupOptions = resolveAutoLifecycleSetupOptions(setupOptions, runtimeSetupOptions);

    // Chain user onBeforeLoad after installing monitor so axe observer exists before app scripts.
    const wrapOnBeforeLoad = (existingOnBeforeLoad) => (win) => {
      installLiveA11yMonitorOnWindow(win, store, resolvedSetupOptions);
      if (typeof existingOnBeforeLoad === 'function') {
        existingOnBeforeLoad(win);
      }
    };

    // Cypress.visit overload shapes: options-only object, (url, options), or (url) with synthetic options.
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

// -----------------------------------------------------------------------------
// Auto lifecycle: window:before:load — SPA navigations not using cy.visit
// What: On each new window, installs monitor; on load, runs initial full-page scan and optionally
//       arms live observer per initialScan.commandOptions.
// Why: In-app routing replaces history without cy.visit; this path keeps monitoring consistent.
// -----------------------------------------------------------------------------
const ensureLiveA11yAutoNavigationHook = ({ setupOptions, initialScan }) => {
  if (isLiveA11yAutoNavigationHookInstalled) {
    return;
  }

  Cypress.on('window:before:load', (win) => {
    const store = getActiveLiveA11yStore();
    if (!store) {
      return;
    }

    // Mirrors visit overwrite: respect skip flags, merge setup, install monitor on each new window.
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

    // After full load: initial full-page scan, then optionally arm live observer (SPA navigations).
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

// -----------------------------------------------------------------------------
// Default export — commands-layer façade
// What: Named helpers/constants consumed by `a11y-observer-commands.js` (no Cypress commands here
//       except the two setLiveA11yAuto* registrations above).
// Why: Keeps command definitions thin and centralizes live-a11y policy in one test-support module.
// -----------------------------------------------------------------------------
/** Default export: API surface used by `a11y-observer-commands.js` only. */
export default {
  LIVE_A11Y_RUN_ENV_VAR,
  buildLiveA11yOutputPathAndMeta,
  clearLiveA11yAutoReportRuntimeOptions,
  clearLiveA11yAutoSetupRuntimeOptions,
  clearPriorLiveEntriesOnStore,
  clearInitialPageVisualsOnStore,
  ensureLiveA11yAutoNavigationHook,
  ensureLiveA11yAutoVisitCommandOverwrite,
  getActiveLiveA11yStore,
  getCurrentTestTitleForMeta,
  getLiveA11yAutoReportRuntimeOptions,
  getLiveA11yAutoSetupRuntimeOptions,
  getNodeFirstReportIdMapForCurrentSpec,
  getSeenNodeSetForCurrentSpec,
  liveA11yIntegration,
  logGroupedViolations,
  logLiveA11yValidationMarker,
  markTestAsFailedWithoutThrowingHook,
  recordFirstReportIdsFromGroupedReport,
  refreshLiveA11yRuntimeEnvConfigFromCyEnv,
  resetGhostOverlay,
  resolveCheckpointLabelForReport,
  resolveGenerateLiveA11yReports,
  resolveIncludeIncompleteInReport,
  resolveLiveA11yMonitorInstallOptions,
  resolveScanTypeForReport,
  resolveSkipLiveA11y,
  setActiveLiveA11yStore,
  setLiveA11yAutoReportRuntimeOptions,
  setLiveA11yAutoSetupRuntimeOptions,
  setScanTypeOnStore,
  severityColorMark,
  severitySummaryLabel,
  syncCheckpointScanPolicyOnStore,
  testsWithExplicitCheckpointReports,
  testsWithFailingViolations,
  toPerTestTrackingKey,
};
