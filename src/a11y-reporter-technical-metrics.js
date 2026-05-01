/**
 * Static labels, metric key ordering, and helpers for the technical metrics section of live-a11y reports.
 */

// -----------------------------------------------------------------------------
// Violation-focused technical metrics (ordering)
// Keys match counted fields in the report payload. Order is intentional: raw initial
// counts, live deltas excluding overlap with initial, then combined totals—so readers
// can reconcile “initial vs live vs sum” without hunting arbitrary object key order.
// -----------------------------------------------------------------------------
const ISSUE_TECHNICAL_METRIC_ORDER = [
  "initialViolationsRaw",
  "liveDistinctViolationInstancesExcludingInitial",
  "totalViolationsInitialPlusLiveDistinct",
  "initialDistinctNodesWithIssues",
  "liveDistinctNodesWithIssuesExcludingInitial",
  "totalNodesInitialPlusLiveDistinct",
];

// -----------------------------------------------------------------------------
// Incomplete-rule technical metrics (ordering)
// Mirrors the violation block but for axe “incomplete” (needs manual review). Kept
// separate so UIs can omit the whole incomplete subsection when `includeIncompleteInReport`
// is false or when no incomplete metrics are present.
// -----------------------------------------------------------------------------
const INCOMPLETE_TECHNICAL_METRIC_ORDER = [
  "initialIncompleteRaw",
  "liveDistinctIncompleteInstancesExcludingInitial",
  "totalIncompleteInitialPlusLiveDistinct",
  "initialDistinctNodesWithIncomplete",
  "liveDistinctNodesWithIncompleteExcludingInitial",
  "totalNodesIncompleteInitialPlusLiveDistinct",
];

// -----------------------------------------------------------------------------
// Monitor runtime / pipeline health
// Operational counters (not a11y findings): how much scanning ran, what was dropped
// under load, and internal monitor failures—useful for diagnosing flaky runs vs real violations.
// -----------------------------------------------------------------------------
const RUNTIME_TECHNICAL_METRIC_ORDER = [
  "liveScansCaptured",
  "monitorDroppedScans",
  "monitorErrors",
];

// -----------------------------------------------------------------------------
// Cross-report deduplication metrics (canonical key list)
// Tracks overlap with earlier emissions in the same spec (repeat scans / checkpoints).
// `buildTechnicalMetricOrder` inlines a subset of these keys with extra gating for incomplete dupes.
// -----------------------------------------------------------------------------
const DUPLICATE_TECHNICAL_METRIC_ORDER = [
  "duplicatedViolationsFromEarlierReports",
  "duplicatedIncompleteFindingsFromEarlierReports",
  "duplicatedNodesFromEarlierReports",
  "previousReportsInSpec",
];

// -----------------------------------------------------------------------------
// Display copy + cross-links for HTML / console “technical metrics” UI
// Each entry supplies a short label, longer description, and `related` keys so templates
// can surface “see also” context without duplicating prose in every consumer.
// -----------------------------------------------------------------------------
const TECHNICAL_METRIC_HELP = {
  initialViolationsRaw: {
    label: "Initial full-page violations (raw rule groups)",
    description:
      "How many violation rule groups axe found in the first full-page scan.",
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
  initialIncompleteRaw: {
    label: "Initial incomplete findings (raw rule groups)",
    description:
      "How many axe-core incomplete rule groups were found in the first full-page scan (manual-review findings).",
    related: ["liveDistinctIncompleteInstancesExcludingInitial", "totalIncompleteInitialPlusLiveDistinct"],
  },
  liveDistinctIncompleteInstancesExcludingInitial: {
    label: "Live distinct incomplete findings (excluding initial)",
    description:
      "How many NEW live incomplete rule groups were found, counted by rule + page, excluding groups already seen in the initial full-page scan.",
    related: ["initialIncompleteRaw", "totalIncompleteInitialPlusLiveDistinct"],
  },
  totalIncompleteInitialPlusLiveDistinct: {
    label: "Total incomplete findings (initial + live distinct)",
    description:
      "Overall grouped incomplete total for this report: initial full-page incomplete groups + new live incomplete groups (excluding initial overlaps).",
    related: ["initialIncompleteRaw", "liveDistinctIncompleteInstancesExcludingInitial"],
  },
  initialDistinctNodesWithIssues: {
    label: "Initial distinct nodes with issues",
    description:
      "How many unique elements had issues in the initial full-page scan.",
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
  initialDistinctNodesWithIncomplete: {
    label: "Initial distinct nodes with incomplete findings",
    description:
      "How many unique elements had incomplete findings in the initial full-page scan.",
    related: ["liveDistinctNodesWithIncompleteExcludingInitial", "totalNodesIncompleteInitialPlusLiveDistinct"],
  },
  liveDistinctNodesWithIncompleteExcludingInitial: {
    label: "Live distinct incomplete nodes (excluding initial)",
    description:
      "How many NEW unique elements had incomplete findings in live scans, excluding elements already seen as incomplete in the initial full-page scan.",
    related: ["initialDistinctNodesWithIncomplete", "totalNodesIncompleteInitialPlusLiveDistinct"],
  },
  totalNodesIncompleteInitialPlusLiveDistinct: {
    label: "Total incomplete nodes (initial + live distinct)",
    description:
      "Overall unique-node total for incomplete findings: initial distinct nodes + new live distinct nodes (excluding initial overlaps).",
    related: ["initialDistinctNodesWithIncomplete", "liveDistinctNodesWithIncompleteExcludingInitial"],
  },
  liveScansCaptured: {
    label: "Live scans",
    description:
      "How many live/delta scans were actually executed while monitoring dynamic changes.",
    related: ["monitorDroppedScans", "monitorErrors"],
  },
  monitorDroppedScans: {
    label: "Dropped scans",
    description:
      "How many queued live scan attempts were dropped by the monitor queue logic.",
    related: ["liveScansCaptured", "monitorErrors"],
  },
  monitorErrors: {
    label: "Monitor errors",
    description:
      "Internal monitor runtime errors (engine/scan pipeline issues), not accessibility violations.",
    related: ["liveScansCaptured", "monitorDroppedScans"],
  },
  duplicatedViolationsFromEarlierReports: {
    label: "Duplicated grouped issue findings from earlier reports",
    description:
      "How many grouped issue findings (fail/warn, rule + page) in this report were already detected in earlier reports in the same spec file.",
    related: ["duplicatedIncompleteFindingsFromEarlierReports", "duplicatedNodesFromEarlierReports", "previousReportsInSpec"],
  },
  duplicatedIncompleteFindingsFromEarlierReports: {
    label: "Duplicated grouped incomplete findings from earlier reports",
    description:
      "How many grouped incomplete findings (manual-review, rule + page) in this report were already detected in earlier reports in the same spec file.",
    related: ["duplicatedViolationsFromEarlierReports", "duplicatedNodesFromEarlierReports", "previousReportsInSpec"],
  },
  duplicatedNodesFromEarlierReports: {
    label: "Duplicated nodes from earlier reports",
    description:
      "How many node+page targets in this report were already seen in earlier reports in the same spec file.",
    related: ["duplicatedViolationsFromEarlierReports", "duplicatedIncompleteFindingsFromEarlierReports", "previousReportsInSpec"],
  },
  previousReportsInSpec: {
    label: "Previous reports in this spec",
    description:
      "How many reports were already emitted in this spec before this one. First report is 0.",
    related: ["duplicatedViolationsFromEarlierReports", "duplicatedIncompleteFindingsFromEarlierReports", "duplicatedNodesFromEarlierReports"],
  },
};

// -----------------------------------------------------------------------------
// Dynamic metric key sequence for a single report
// Composes violation metrics always; adds incomplete + incomplete-duplicate rows only when
// relevant (respects `includeIncompleteInReport` and non-zero values). Appends runtime
// then dedupe keys so reports stay readable when incomplete sections are hidden.
// -----------------------------------------------------------------------------
const buildTechnicalMetricOrder = (
  technicalMetrics = {},
  { includeIncompleteInReport = true } = {}
) => {
  const hasIncompleteMetrics = includeIncompleteInReport && INCOMPLETE_TECHNICAL_METRIC_ORDER.some(
    (key) => Number(technicalMetrics[key] || 0) > 0
  );
  const hasIncompleteDuplicates = includeIncompleteInReport && Number(
    technicalMetrics.duplicatedIncompleteFindingsFromEarlierReports || 0
  ) > 0;
  return [
    ...ISSUE_TECHNICAL_METRIC_ORDER,
    ...(hasIncompleteMetrics ? INCOMPLETE_TECHNICAL_METRIC_ORDER : []),
    ...RUNTIME_TECHNICAL_METRIC_ORDER,
    "duplicatedViolationsFromEarlierReports",
    ...(hasIncompleteDuplicates ? ["duplicatedIncompleteFindingsFromEarlierReports"] : []),
    "duplicatedNodesFromEarlierReports",
    "previousReportsInSpec",
  ];
};

// -----------------------------------------------------------------------------
// Public surface for the reporter: static orders/help plus `buildTechnicalMetricOrder`.
// -----------------------------------------------------------------------------
module.exports = {
  ISSUE_TECHNICAL_METRIC_ORDER,
  INCOMPLETE_TECHNICAL_METRIC_ORDER,
  RUNTIME_TECHNICAL_METRIC_ORDER,
  DUPLICATE_TECHNICAL_METRIC_ORDER,
  TECHNICAL_METRIC_HELP,
  buildTechnicalMetricOrder,
};
