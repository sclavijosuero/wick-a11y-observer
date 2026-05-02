import { attachLiveA11yMonitor, createLiveA11yStore } from './a11y-setup';
import { AXE_IMPACT_ORDER } from './a11y-shared-constants.js';
import a11yLive from './a11y-live-support.js';

/**
 * Cypress commands and auto lifecycle hooks for live axe monitoring.
 * Shared logic: default export from `./a11y-live-support.js` (`a11yLive`).
 */

// -----------------------------------------------------------------------------
// Monitor setup
// Installs the live axe monitor on the AUT window and aliases the in-memory store
// as `@liveA11yStore`. `setupLiveA11yMonitor` applies library defaults (observer,
// checkpoint policy) so behavior stays consistent with the rest of live a11y.
// -----------------------------------------------------------------------------
Cypress.Commands.add('setupCoreLiveA11yMonitor', (monitorOptions = {}) => {
  const store = createLiveA11yStore();
  attachLiveA11yMonitor(store, monitorOptions);
  return cy.wrap(store, { log: false }).as('liveA11yStore');
});

Cypress.Commands.add('setupLiveA11yMonitor', (monitorOptions = {}) => {
  return cy.setupCoreLiveA11yMonitor(a11yLive.resolveLiveA11yMonitorInstallOptions(monitorOptions));
});

// -----------------------------------------------------------------------------
// Explicit initial full-page scan (live pipeline)
// Runs axe once and marks the store as “live” scanning; optionally arms the monitor
// afterward for ongoing DOM-driven scans. Use when tests control timing outside
// auto `visit` hooks.
// -----------------------------------------------------------------------------
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
      a11yLive.setScanTypeOnStore(win.__liveA11yMonitor.store, 'live');
      await win.__liveA11yMonitor.runInitialFullPageScan(axeOptions);

      if (commandOptions?.armAfter) {
        win.__liveA11yMonitor.arm(commandOptions.armOptions || { scanCurrent: false });
      }
    });
  }
);

// -----------------------------------------------------------------------------
// Checkpoint-style one-shot scan (`checkAccessibility`)
// Clears accumulated live findings and aligns store policy with the passed axe options,
// then runs a full-page scan. Waits for monitor “idle” first by default so late DOM
// updates are less likely to produce one-off violations right before assertions.
// -----------------------------------------------------------------------------
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
        a11yLive.clearPriorLiveEntriesOnStore(monitorStore);
        a11yLive.clearInitialPageVisualsOnStore(monitorStore);
        a11yLive.syncCheckpointScanPolicyOnStore(monitorStore, axeOptions || {});
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

// -----------------------------------------------------------------------------
// Monitor control: arm, idle wait, stop, read store
// `arm` enables ongoing scans after navigation/DOM changes. `waitForLiveA11yIdle`
// bounds how long we wait for queued scans to finish (with a hard fallback). `stop`
// prevents timers/observers leaking across tests. `getLiveA11yResults` returns the
// window store or falls back to the active store tracked in Node context.
// -----------------------------------------------------------------------------
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
    return a11yLive.getActiveLiveA11yStore();
  });
});

// -----------------------------------------------------------------------------
// Report build + console summary + validation surface
// Delegates to the Node `liveA11y:buildReport` task for JSON/HTML artifacts and
// validation. Tracks first-seen nodes per spec for dedupe metadata, updates strict-
// mode aggregates when grouped violations fail disposition, logs human-readable
// summaries to the Cypress command log, and optionally throws on validation errors.
// -----------------------------------------------------------------------------
Cypress.Commands.add('reportLiveA11yResults', (options = {}) => {
  const throwOnValidationFailure = options.throwOnValidationFailure !== false;
  const includeIncompleteInReport = a11yLive.resolveIncludeIncompleteInReport(options);
  const generateArtifacts = a11yLive.resolveGenerateLiveA11yReports(options);
  const validation = {
    enabled: true,
    requireInitialScan: true,
    minLiveScans: 1,
    requireNoRuntimeErrors: true,
    failOnIncludedImpacts: true,
    ...options.validation,
  };

  // Resolve output paths/meta from the active store, expose results for debugging, invoke Node task.
  return cy.getLiveA11yResults().then((results) => {
    const scanType = a11yLive.resolveScanTypeForReport(results, options.checkpointLabel);
    const checkpointLabel = a11yLive.resolveCheckpointLabelForReport(scanType, options.checkpointLabel);
    const { outputPath, reportMeta } = a11yLive.buildLiveA11yOutputPathAndMeta(options.outputPath, {
      checkpointLabel,
      scanType,
    });
    Cypress.expose('liveA11yResults', results);
    const frMap = a11yLive.getNodeFirstReportIdMapForCurrentSpec();
    const previousNodeKeys = [...a11yLive.getSeenNodeSetForCurrentSpec()];
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
      // Checkpoint flags, strict-mode violation aggregates, Command Log + detailed violation lines.
      const reportTestTitle = report?.reportArtifact?.testTitle || a11yLive.getCurrentTestTitleForMeta();
      const perTestTrackingKey = a11yLive.toPerTestTrackingKey(reportTestTitle);
      if (checkpointLabel) {
        a11yLive.testsWithExplicitCheckpointReports.add(perTestTrackingKey);
      }

      // Records, per test, any failing grouped violations for later summary/reporting.
      // Aggregates fail counts and checkpoints for each test run.
      const reportFailGroups = Number(report?.counts?.groupedByDisposition?.fail || 0);
      if (reportFailGroups > 0) {
        const existingFailEntry =
          a11yLive.testsWithFailingViolations.get(perTestTrackingKey) ||
          { testKey: reportTestTitle, failGroups: 0, reports: [] };
        existingFailEntry.failGroups += reportFailGroups;
        existingFailEntry.reports.push({
          reportId: report?.reportArtifact?.reportId || 'unknown-report',
          checkpointLabel: checkpointLabel || null,
          failGroups: reportFailGroups,
        });
        a11yLive.testsWithFailingViolations.set(perTestTrackingKey, existingFailEntry);
      }
      
      // Record the first report IDs associated with each grouped violation from this report. 
      // This links violations reported at this checkpoint to a unique reportId,
      // allowing further aggregation and traceability across multiple checkpoints or test runs.
      const reportId = report?.reportArtifact?.reportId;
      a11yLive.recordFirstReportIdsFromGroupedReport(report?.groupedViolations, reportId);
      
      // Resetting the ghost overlay to ensure the UI reflects the most current accessibility scan results.
      a11yLive.resetGhostOverlay();
      
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

      // --- User-facing run log: checkpoint context, findings, metrics, and artifact paths ---
      // Optional checkpoint label from this emission (checkpoint scans append tag text to headers below).
      const ar = report?.reportArtifact || {};
      const reportCheckpointLabel = String(ar?.checkpointLabel || options?.checkpointLabel || '').trim().toUpperCase();
      const checkpointTag = reportCheckpointLabel ? ` [CHECKPOINT ${reportCheckpointLabel}]` : '';
      // Pin checkpoint identity in the Cypress Command Log for traceability (distinct from cy.log lines).
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

      // Section banner + expandable console snapshot of high-level counts (summaryForConsole).
      cy.log(`════════════ 📊 𝗔11𝗬 𝗙𝗜𝗡𝗗𝗜𝗡𝗚 𝗦𝗨𝗠𝗠𝗔𝗥𝗬${checkpointTag}`);
      Cypress.log({
        name: '',
        message: `════════════ 📝 𝗔11𝗬 𝗙𝗜𝗡𝗗𝗜𝗡𝗚 𝗗𝗘𝗧𝗔𝗜𝗟𝗦${checkpointTag} (𝗰𝗼𝗻𝘀𝗼𝗹𝗲 𝗽𝗿𝗼𝗽𝘀)`,

        consoleProps: () => summaryForConsole,
      });
      // One line per configured impact level: fail/warn issue counts and optional incomplete tallies.
      const severityOrder = Array.isArray(report?.severityOrder)
        ? report.severityOrder
        : AXE_IMPACT_ORDER;
      severityOrder.forEach((severity) => {
        const issuesCount = Number(groupedBySeverityIssues?.[severity] ?? 0);
        const incompleteCount = Number(groupedBySeverityIncomplete?.[severity] ?? 0);
        const failCount = Number(report?.counts?.groupedBySeverityDisposition?.[severity]?.fail || 0);
        const warnCount = Number(report?.counts?.groupedBySeverityDisposition?.[severity]?.warn || 0);
        const issueSummaryLabel = (failCount > 0 || warnCount > 0)
          ? 'CONFIRMED'
          : 'ISSUES';
        const label = a11yLive.severitySummaryLabel(severity, report?.impactPolicy || {});
        const summaryBreakdown = includeIncompleteInReportInPayload
          ? `${issueSummaryLabel}:${issuesCount} | INCOMPLETE:${incompleteCount}`
          : `${issueSummaryLabel}:${issuesCount}`;
        cy.log(
          `•${checkpointTag ? ` ${checkpointTag.trim()}` : ''} ${label} ${a11yLive.severityColorMark(severity)} : ${summaryBreakdown}`
        );
      });

      // Deeper pass: per-rule / per-node details in the Command Log (grouped violations + raw context).
      a11yLive.logGroupedViolations(report.groupedViolations, report.raw);
      cy.log('· · · · ·');
      // Technical metrics block (same ordering/labels as HTML report header / buildReportSummary).
      technicalOrder.forEach((metricKey) => {
        const metricLabel = metricHelp?.[metricKey]?.label || metricKey;
        const metricValue = Number(technicalMetrics?.[metricKey] ?? 0);
        cy.log(`${metricLabel}: ${metricValue}`);
      });
      cy.log('· · · · ·');

      // Report identity and on-disk paths when JSON/HTML were written; otherwise note that writes were disabled.
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
      
      // Auto lifecycle passes `throwOnValidationFailure: false`; direct callers can fail fast here.
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

// -----------------------------------------------------------------------------
// Runtime overrides for the auto lifecycle (single-test scope)
// `cy.setLiveA11yAuto*` queues options consumed during `afterEach` of `registerLiveA11yAutoLifecycle`;
// they are cleared after each test so later tests do not inherit one-off settings.
// -----------------------------------------------------------------------------
Cypress.Commands.add('setLiveA11yAutoReportOptions', (options = {}) => {
  return cy.then(() => {
    a11yLive.setLiveA11yAutoReportRuntimeOptions(options);
  });
});

Cypress.Commands.add('setLiveA11yAutoSetupOptions', (options = {}) => {
  return cy.then(() => {
    a11yLive.setLiveA11yAutoSetupRuntimeOptions(options);
  });
});

/**
 * Registers global Cypress hooks once (typically from `cypress/support/e2e.js`) so apps get
 * live accessibility monitoring with little boilerplate: initial scan + armed monitor on navigations,
 * per-test reporting, and optional strict failure handling at end of run.
 *
 * High-level flow:
 * 1. One-time wiring — patch `cy.visit` and listen for loads so each URL gets an initial axe scan
 *    and the monitor arms (`ensureLiveA11yAutoVisitCommandOverwrite`, `ensureLiveA11yAutoNavigationHook` on `a11yLive`).
 * 2. `beforeEach` — new monitor store, reset per-test checkpoint/failure tracking, refresh env-based toggles.
 * 3. `afterEach` — unless skipped or checkpoint-handled, wait for DOM idle, emit JSON/HTML report + validation;
 *    fail the test or queue failures for the suite-level `after` hook depending on options.
 * 4. `after` (when strict) — single aggregate error so CI sees one clear failure after retries.
 *
 * @param {object} [options]
 */
export const registerLiveA11yAutoLifecycle = (options = {}) => {
  // Idempotent: importing this module multiple times must not stack hooks.
  if (a11yLive.liveA11yIntegration.autoLifecycleRegistered) {
    return;
  }

  a11yLive.liveA11yIntegration.autoLifecycleRegistered = true;

  // Registration-time defaults: how the monitor behaves on visit, initial scan + arm,
  // idle thresholds before reporting, artifact generation, and failure strategy
  // (per-test vs end-of-run strict aggregation).
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

  // When validation fails but we avoid throwing inside `afterEach` (and when deferring to suite strict mode),
  // entries accumulate here so `after` can throw one consolidated error with every failing test.
  const pendingValidationFailuresByTest = new Map();

  // Patch `cy.visit` / listen for loads so each navigation gets setup + initial scan + arm
  // without every spec repeating boilerplate.
  a11yLive.ensureLiveA11yAutoVisitCommandOverwrite({ setupOptions });
  a11yLive.ensureLiveA11yAutoNavigationHook({ setupOptions, initialScan });

  // --- Per test (`beforeEach`): fresh store and clean tracking ---
  // Why: tests must not share violation history or checkpoint/failure maps; env vars may
  // change reporting between examples, so refresh cached LIVE_A11Y_* config each time.
  beforeEach(function liveA11yAutoBeforeEach() {
    const titlePath = typeof this.currentTest?.titlePath === 'function'
      ? this.currentTest.titlePath()
      : this.currentTest?.titlePath;
    const testKey =
      (Array.isArray(titlePath) ? titlePath.join(' > ') : undefined) ||
      this.currentTest?.fullTitle?.() ||
      this.currentTest?.title ||
      'unknown-test';
    const perTestTrackingKey = a11yLive.toPerTestTrackingKey(this.currentTest?.title || testKey);
    // Checkpoint-only tests manage their own reports; reset markers so this test starts clean.
    a11yLive.testsWithExplicitCheckpointReports.delete(perTestTrackingKey);
    a11yLive.testsWithFailingViolations.delete(perTestTrackingKey);
    a11yLive.setActiveLiveA11yStore(createLiveA11yStore());
    // Pick up LIVE_A11Y_* env for this test run (generate reports, include incomplete, etc.).
    a11yLive.refreshLiveA11yRuntimeEnvConfigFromCyEnv();
  });

  // --- Per test (`afterEach`): idle → report → validate → teardown ---
  // Why: snapshot after DOM settles; skip when disabled or checkpoint already reported;
  // defer throwing so options can fail the test inline or aggregate once in suite `after`.
  afterEach(function liveA11yAutoAfterEach() {
    const titlePath = typeof this.currentTest?.titlePath === 'function'
      ? this.currentTest.titlePath()
      : this.currentTest?.titlePath;
    const testKey =
      (Array.isArray(titlePath) ? titlePath.join(' > ') : undefined) ||
      this.currentTest?.fullTitle?.() ||
      this.currentTest?.title ||
      'unknown-test';
    const perTestTrackingKey = a11yLive.toPerTestTrackingKey(this.currentTest?.title || testKey);
    const runtimeSetupOptions = a11yLive.getLiveA11yAutoSetupRuntimeOptions();
    const runtimeReportOptions = a11yLive.getLiveA11yAutoReportRuntimeOptions();
    const shouldSkipLiveA11y = a11yLive.resolveSkipLiveA11y(runtimeSetupOptions, setupOptions);
    const shouldGenerateReports = a11yLive.resolveGenerateLiveA11yReports(
      runtimeSetupOptions,
      setupOptions,
      runtimeReportOptions,
      reportOptions
    );
    const includeIncompleteInReport = a11yLive.resolveIncludeIncompleteInReport(
      runtimeSetupOptions,
      setupOptions,
      runtimeReportOptions,
      reportOptions
    );
    // Runtime options apply only to the current test; clear so the next test does not inherit them.
    a11yLive.clearLiveA11yAutoReportRuntimeOptions();
    a11yLive.clearLiveA11yAutoSetupRuntimeOptions();

    // User turned live a11y off for this run — skip reporting and tear down without failing.
    if (shouldSkipLiveA11y) {
      pendingValidationFailuresByTest.delete(testKey);
      Cypress.log({
        name: '⏭ LIVE A11Y SKIPPED',
        message: `Skipping live a11y monitor + report for "${testKey}" (${a11yLive.LIVE_A11Y_RUN_ENV_VAR}=false)`,
        consoleProps: () => ({
          test: testKey,
          envVar: a11yLive.LIVE_A11Y_RUN_ENV_VAR,
          runtimeSetupOptions,
          setupOptions,
        }),
      });
      if (stopMonitorAfterEach) {
        cy.stopLiveA11yMonitor();
      }
      cy.then(() => {
        a11yLive.setActiveLiveA11yStore(null);
      });
      return;
    }

    // Checkpoints already produced report(s); avoid duplicate auto report for the same test body.
    if (a11yLive.testsWithExplicitCheckpointReports.has(perTestTrackingKey)) {
      pendingValidationFailuresByTest.delete(testKey);
      if (stopMonitorAfterEach) {
        cy.stopLiveA11yMonitor();
      }
      cy.then(() => {
        a11yLive.setActiveLiveA11yStore(null);
      });
      return;
    }

    // Merge static defaults, register-time options, and `cy.setLiveA11yAutoReportOptions` overrides.
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

    // Let mutations and monitor queue drain before snapshotting results into the report.
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

    // Node task builds JSON/HTML; validation runs there too. Suppress task throw so we can
    // choose per-test failure vs suite-level strict aggregation (`failTestOnValidationError`).
    cy.reportLiveA11yResults({
      ...resolvedReportOptions,
      throwOnValidationFailure: false,
    }).then((report) => {
      const failCount = Number(report?.counts?.groupedByDisposition?.fail || 0);
      const warnCount = Number(report?.counts?.groupedByDisposition?.warn || 0);
      const incompleteCount = Number(report?.counts?.groupedByDisposition?.incomplete || 0);
      const includeIncompleteInReportInPayload = report?.reportOptions?.includeIncompleteInReport === true;
      // Node validation (min scans, initial scan present, etc.) passed — clear any stale strict-mode entry.
      if (report?.validation?.valid) {
        pendingValidationFailuresByTest.delete(testKey);
        a11yLive.logLiveA11yValidationMarker({
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

      // Record for suite `after` and optionally mark this test failed without throwing in the hook.
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
      a11yLive.logLiveA11yValidationMarker({
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
      // Throwing inside Cypress hooks is brittle; mark failed like an assertion would.
      a11yLive.markTestAsFailedWithoutThrowingHook(this, message, report);
    });

    // Prevent monitor state and timers from leaking into the next test.
    if (stopMonitorAfterEach) {
      cy.stopLiveA11yMonitor();
    }
    cy.then(() => {
      a11yLive.setActiveLiveA11yStore(null);
    });
  });

  // --- Suite end: optional single failure listing every validation issue and grouped violation failures ---
  after(() => {
    if (!failRunOnValidationError) {
      return;
    }
    const validationFailureCount = pendingValidationFailuresByTest.size;
    const failingViolationEntries = [...a11yLive.testsWithFailingViolations.values()]
      .filter((entry) => Number(entry?.failGroups || 0) > 0);
    // Nothing to enforce — strict mode is a no-op for fully passing runs.
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

    // One throw after all specs gives CI a deterministic failure (esp. when per-test hooks are skipped or retried).
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

// Importing this module from support (e.g. `e2e.js`) opts into auto lifecycle without an
// explicit `registerLiveA11yAutoLifecycle()` call; registration is idempotent if imported twice.
registerLiveA11yAutoLifecycle();
