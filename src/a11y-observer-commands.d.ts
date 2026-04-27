/// <reference types="cypress" />

export interface LiveA11yRunOptions {
  resultTypes?: Array<"violations" | "passes" | "incomplete" | "inapplicable">;
  iframes?: boolean;
  includedImpacts?: Array<"critical" | "serious" | "moderate" | "minor">;
  onlyWarnImpacts?: Array<"critical" | "serious" | "moderate" | "minor">;
  impactLevels?: Array<"critical" | "serious" | "moderate" | "minor">;
  runOnly?: {
    type?: string;
    values?: string[];
  };
  rules?: Record<string, unknown>;
  [option: string]: unknown;
}

export interface LiveA11yMonitorOptions {
  root?: Element | Document;
  autoArm?: boolean;
  minVisibleMs?: number;
  stableFrames?: number;
  maxSettleMs?: number;
  quietMs?: number;
  waitForIdleTimeoutMs?: number;
  maxQueueSize?: number;
  treatOpacityZeroAsHidden?: boolean;
  semanticRootSelector?: string;
  stateRootSelector?: string;
  conventionRootSelector?: string;
  useConventionRoots?: boolean;
  interactiveSelector?: string;
  ignoreSelector?: string;
  rootIdAttribute?: string;
  htmlSnippetMax?: number;
  mutationAncestorDepth?: number;
  fallbackFullPageScan?: {
    enabled?: boolean;
    throttleMs?: number;
  };
  preNavigationFlush?: {
    enabled?: boolean;
    minIntervalMs?: number;
    triggerOnClick?: boolean;
    triggerOnSubmit?: boolean;
    triggerOnPageHide?: boolean;
  };
  initialAxeOptions?: LiveA11yRunOptions;
  liveAxeOptions?: LiveA11yRunOptions;
  [option: string]: unknown;
}

export type LiveA11yObserverOptions = Omit<
  LiveA11yMonitorOptions,
  "initialAxeOptions" | "liveAxeOptions"
>;

export interface SetupLiveA11yMonitorOptions {
  initialAxeOptions?: LiveA11yRunOptions;
  liveAxeOptions?: LiveA11yRunOptions;
  observerOptions?: LiveA11yObserverOptions;
  includeIncompleteInReport?: boolean;
  generateReports?: boolean;
  runAccessibility?: boolean;
  skipAccessibility?: boolean;
}

export interface RunInitialLiveA11yScanCommandOptions {
  armAfter?: boolean;
  armOptions?: ArmLiveA11yMonitorOptions;
}

export interface CheckAccessibilityCommandOptions {
  waitForIdleBeforeScan?: boolean;
  waitForIdleOptions?: WaitForLiveA11yIdleOptions;
}

export interface ArmLiveA11yMonitorOptions {
  scanCurrent?: boolean;
}

export interface WaitForLiveA11yIdleOptions {
  quietMs?: number;
  timeoutMs?: number;
}

export interface ReportLiveA11yValidationOptions {
  enabled?: boolean;
  requireInitialScan?: boolean;
  minLiveScans?: number;
  requireNoRuntimeErrors?: boolean;
  minUniqueLiveRuleIds?: number;
  requiredLiveRuleIds?: string[];
  minGroupedBySeverity?: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>;
  failOnIncludedImpacts?: boolean;
}

export interface ReportLiveA11yResultsOptions {
  outputPath?: string;
  checkpointLabel?: string;
  validation?: ReportLiveA11yValidationOptions;
  throwOnValidationFailure?: boolean;
  includeIncompleteInReport?: boolean;
  generateReports?: boolean;
}

export interface LiveA11yStore {
  initial: unknown | null;
  initialPageUrl?: string;
  live: LiveA11yScan[];
  errors: unknown[];
  meta: {
    started: number;
    finished: number;
    dropped: number;
    rescans: number;
    analysis?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface LiveA11yScan {
  rootId?: string | number;
  rootType?: string;
  rootHtmlId?: string;
  url?: string;
  reason?: string;
  results?: LiveA11yRawResults;
  [key: string]: unknown;
}

export interface LiveA11yRawResults {
  violations?: LiveA11yViolation[];
  incomplete?: LiveA11yViolation[];
  passes?: LiveA11yViolation[];
  inapplicable?: LiveA11yViolation[];
  [key: string]: unknown;
}

export interface LiveA11yViolation {
  id?: string;
  impact?: "critical" | "serious" | "moderate" | "minor" | string;
  help?: string;
  helpUrl?: string;
  description?: string;
  tags?: string[];
  nodes?: LiveA11yNode[];
  [key: string]: unknown;
}

export interface LiveA11yNode {
  target?: string | string[];
  html?: string;
  failureSummary?: string;
  any?: unknown[];
  all?: unknown[];
  none?: unknown[];
  [key: string]: unknown;
}

export interface LiveA11yReport {
  generatedAt: string;
  meta: LiveA11yStore["meta"];
  errors: unknown[];
  counts: {
    initialScans: number;
    initialViolations: number;
    initialIncomplete?: number;
    initialNodesWithViolations: number;
    initialNodesWithIncomplete?: number;
    liveScans: number;
    liveViolations: number;
    liveIncomplete?: number;
    liveNodesWithViolations: number;
    liveNodesWithIncomplete?: number;
    liveDistinctViolationInstancesExcludingInitial?: number;
    liveDistinctIncompleteInstancesExcludingInitial?: number;
    liveDistinctNodesWithIssuesExcludingInitial?: number;
    liveDistinctNodesWithIncompleteExcludingInitial?: number;
    totalViolationsInitialPlusLiveDistinct?: number;
    totalIncompleteInitialPlusLiveDistinct?: number;
    totalNodesInitialPlusLiveDistinct?: number;
    totalNodesIncompleteInitialPlusLiveDistinct?: number;
    groupedViolations: number;
    groupedIncomplete?: number;
    groupedFindingsTotal?: number;
    groupedBySeverity: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>;
    groupedBySeverityIssues?: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>;
    groupedBySeverityIncomplete?: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>;
    groupedBySeverityDisposition?: Partial<
      Record<
        "critical" | "serious" | "moderate" | "minor",
        {
          fail: number;
          warn: number;
          incomplete?: number;
          sectionType: "violation" | "warning" | "incomplete" | "none";
        }
      >
    >;
    groupedByDisposition?: Partial<Record<"fail" | "warn" | "incomplete", number>>;
  };
  severityOrder: string[];
  impactPolicy?: {
    included: Array<"critical" | "serious" | "moderate" | "minor">;
    warn: Array<"critical" | "serious" | "moderate" | "minor">;
    considered: Array<"critical" | "serious" | "moderate" | "minor">;
  };
  reportOptions?: {
    includeIncompleteInReport?: boolean;
  };
  groupedViolations: LiveA11yGroupedViolation[];
  raw: LiveA11yStore;
  reportArtifact?: LiveA11yReportArtifact;
  footnote?: {
    text: string;
    lines: string[];
  };
  savedTo?: string;
  savedHtmlTo?: string;
  htmlReportRelative?: string;
  summary?: {
    identity?: {
      reportId?: string;
      specFile?: string;
      cypressTest?: string;
      testInSuite?: string;
      generatedLocal?: string;
      reportFileJson?: string;
    };
    technicalOrder?: string[];
    technicalMetrics?: Record<string, number>;
    metricHelp?: Record<
      string,
      {
        label?: string;
        description?: string;
        related?: string[];
      }
    >;
  };
  validation?: {
    valid: boolean;
    errors: string[];
    liveRuleIds: string[];
  };
}

export interface LiveA11yGroupedViolation {
  findingType?: "violation" | "incomplete" | string;
  id: string;
  impact: string;
  help?: string;
  helpUrl?: string;
  description?: string;
  tags: string[];
  totalOccurrences: number;
  phases: string[];
  sources: string[];
  sourceLabels: string[];
  nodes: string[];
  nodeDetails: LiveA11yGroupedNode[];
  uniqueNodeCount: number;
  disposition?: "fail" | "warn" | "incomplete";
  rawViolations: unknown[];
}

export interface LiveA11yGroupedNode {
  target: string;
  rawTarget?: string;
  pageUrl?: string;
  html?: string;
  failureSummary?: string;
  phases: string[];
  sources: string[];
  sourceLabels: string[];
  initialDetections: number;
  liveDetections: number;
  repeatedFromEarlierReport?: boolean;
  firstReportId?: string | null;
  [key: string]: unknown;
}

export interface LiveA11yReportArtifact {
  relativePath: string;
  fileName: string;
  absolutePath: string;
  reportId?: string;
  specFile?: string;
  specStem?: string;
  sortableLocalTimestamp?: string;
  humanReadableLocal?: string;
  cypressSpecRelative?: string;
  testTitle?: string;
  testTitleForFilename?: string;
  scanType?: "live" | "checkpoint";
  testNumberInSpec?: number;
  testNumberInSpecLabel?: string;
  reportEmissionInSpec?: number;
  equivalentLiveReportNumber?: number;
  testOrdinalInSuite?: number;
  testCountInSuite?: number;
  testOrdinalLabel?: string;
  checkpointLabel?: string;
}

declare global {
  namespace Cypress {
    interface Chainable<Subject = any> {
      /**
       * Public API: run full-page initial scan and optionally arm live monitor.
       */
      runInitialLiveA11yScan(
        axeOptions?: LiveA11yRunOptions,
        commandOptions?: RunInitialLiveA11yScanCommandOptions
      ): Chainable<void>;

      /**
       * Public API: run a one-time checkpoint accessibility scan for the current page.
       */
      checkAccessibility(
        axeOptions?: LiveA11yRunOptions,
        commandOptions?: CheckAccessibilityCommandOptions
      ): Chainable<void>;

      /**
       * Public API: per-test runtime override for report options.
       */
      setLiveA11yAutoReportOptions(options?: ReportLiveA11yResultsOptions): Chainable<void>;

      /**
       * Public API: per-test runtime override for setup/observer options.
       */
      setLiveA11yAutoSetupOptions(options?: SetupLiveA11yMonitorOptions): Chainable<void>;
    }
  }
}
