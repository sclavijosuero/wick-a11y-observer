/// <reference types="cypress" />

/** Options for lightweight DOM + computed-style previews in HTML reports (see README). */
export interface LiveA11yVisualSnapshotsPageOverviewOptions {
  enabled?: boolean;
  maxDepth?: number;
  maxNodes?: number;
  maxTextChars?: number;
  rootSelector?: string;
}

export interface LiveA11yVisualSnapshotsElementOptions {
  enabled?: boolean;
  maxDepth?: number;
  maxNodes?: number;
  maxTextChars?: number;
  /** Prefer nearest modal/drawer/popover container via `closest()` before shallow ancestor fallback. */
  preferSemanticContainer?: boolean;
  /** When no semantic container matches, climb at most this many parents (default 1). */
  maxFallbackAncestorDepth?: number;
  /** Legacy alias for `maxFallbackAncestorDepth`. */
  contextAncestorDepth?: number;
  /** Extra selector tokens merged into the default overlay/container selector list. */
  extraContainerSelectors?: string[] | string;
  /** Full override for the `Element.closest(selector)` string. */
  containerSelector?: string;
}

export interface LiveA11yVisualSnapshotsOptions {
  enabled?: boolean;
  maxNodesPerScan?: number;
  pageOverview?: LiveA11yVisualSnapshotsPageOverviewOptions;
  element?: LiveA11yVisualSnapshotsElementOptions;
  /** Computed property names to mirror as inline `style` (keep the list small). */
  styleProps?: string[];
}

/** Compact tree nodes produced by the in-browser visual snapshot serializer (`r` on payloads). */
export type LiveA11yVisualSnapshotTreeNode =
  | { x: string; t?: undefined; s?: undefined; a?: undefined; c?: undefined; f?: undefined }
  | {
      t: string;
      s?: string;
      a?: Record<string, string>;
      c?: LiveA11yVisualSnapshotTreeNode[];
      /** Rule impact — report viewer draws a dashed outline in the matching severity color. */
      f?: string;
      x?: undefined;
    };

/** Normalized highlight rect on the page overview (`nx`/`ny`/`nw`/`nh` are 0–1 vs overview root). */
export interface LiveA11yVisualHighlightNorm {
  i: string;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export interface LiveA11yVisualSnapshotPayload {
  v?: number;
  kind?: string;
  err?: string;
  url?: string;
  capturedAt?: number;
  viewport?: { w?: number; h?: number };
  rect?: { x?: number; y?: number; w?: number; h?: number };
  /** Context-root bounds in the AUT so report previews don’t collapse to 0×0 (drawers/modals with only out-of-flow layout). */
  contextLayout?: { w?: number; h?: number };
  visibleHint?: boolean;
  truncated?: boolean;
  r?: LiveA11yVisualSnapshotTreeNode | null;
  hl?: LiveA11yVisualHighlightNorm[];
  [key: string]: unknown;
}

/** One persisted initial-scan page overview (may repeat across navigations in one test). */
export type LiveA11yInitialPageVisualEntry = LiveA11yVisualSnapshotPayload & {
  pageUrl?: string;
  scanOrdinal?: number;
};

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
  visualSnapshots?: LiveA11yVisualSnapshotsOptions;
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
  /** Shorthand for `observerOptions.visualSnapshots` (wins over nested duplicate when both set). */
  visualSnapshots?: LiveA11yVisualSnapshotsOptions;
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
  initialPageVisual?: LiveA11yVisualSnapshotPayload | null;
  initialPageVisuals?: LiveA11yInitialPageVisualEntry[];
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
  visualSnapshot?: LiveA11yVisualSnapshotPayload;
  [key: string]: unknown;
}

export interface LiveA11yReport {
  generatedAt: string;
  meta: LiveA11yStore["meta"];
  initialPageVisual?: LiveA11yVisualSnapshotPayload | null;
  initialPageVisuals?: LiveA11yInitialPageVisualEntry[];
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
  visualSnapshot?: LiveA11yVisualSnapshotPayload;
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
