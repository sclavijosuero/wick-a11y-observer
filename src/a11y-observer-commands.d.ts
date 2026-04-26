/// <reference types="cypress" />

export interface LiveA11yRunOptions {
  resultTypes?: Array<"violations" | "passes" | "incomplete" | "inapplicable">;
  iframes?: boolean;
  includedImpacts?: Array<"critical" | "serious" | "moderate" | "minor">;
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
  initialAxeOptions?: LiveA11yRunOptions;
  liveAxeOptions?: LiveA11yRunOptions;
  [option: string]: unknown;
}

export interface StandardLiveA11yMonitorRunOptions {
  shared?: LiveA11yRunOptions;
  initial?: LiveA11yRunOptions;
  live?: LiveA11yRunOptions;
}

export type StandardLiveA11yMonitorOptions = Omit<
  LiveA11yMonitorOptions,
  "initialAxeOptions" | "liveAxeOptions"
> & {
  runOptions?: StandardLiveA11yMonitorRunOptions;
};

export interface RunInitialLiveA11yScanCommandOptions {
  armAfter?: boolean;
  armOptions?: ArmLiveA11yMonitorOptions;
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
}

export interface ReportLiveA11yResultsOptions {
  outputPath?: string;
  validation?: ReportLiveA11yValidationOptions;
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
    initialNodesWithViolations: number;
    liveScans: number;
    liveViolations: number;
    liveNodesWithViolations: number;
    groupedViolations: number;
    groupedBySeverity: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>;
  };
  severityOrder: string[];
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
  validation?: {
    valid: boolean;
    errors: string[];
    liveRuleIds: string[];
  };
}

export interface LiveA11yGroupedViolation {
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
  reportEmissionInSpec?: number;
  testOrdinalInSuite?: number;
  testCountInSuite?: number;
  testOrdinalLabel?: string;
}

declare global {
  namespace Cypress {
    interface Chainable<Subject = any> {
      setupLiveA11yMonitor(
        monitorOptions?: LiveA11yMonitorOptions
      ): Chainable<LiveA11yStore>;

      setupStandardLiveA11yMonitor(
        monitorOptions?: StandardLiveA11yMonitorOptions
      ): Chainable<LiveA11yStore>;

      runInitialLiveA11yScan(
        axeOptions?: LiveA11yRunOptions,
        commandOptions?: RunInitialLiveA11yScanCommandOptions
      ): Chainable<void>;

      armLiveA11yMonitor(options?: ArmLiveA11yMonitorOptions): Chainable<void>;

      waitForLiveA11yIdle(options?: WaitForLiveA11yIdleOptions): Chainable<LiveA11yStore | null>;

      stopLiveA11yMonitor(): Chainable<void>;

      getLiveA11yResults(): Chainable<LiveA11yStore | null>;

      reportLiveA11yResults(options?: ReportLiveA11yResultsOptions): Chainable<LiveA11yReport>;
    }
  }
}
