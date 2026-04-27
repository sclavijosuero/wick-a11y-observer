# wick-a11y-observer Cypress API

`wick-a11y-observer` adds continuous accessibility intelligence to your regular Cypress E2E flow, so you can catch issues while tests already run (without adding manual a11y-only test passes).

## Features

- **No app instrumentation required: run dynamic, on-the-fly accessibility analysis during normal Cypress tests.**
- **Works across navigations: pages visited during the test flow are analyzed as part of the run lifecycle.**
- Tracks dynamic UI changes after the initial scan and continues analyzing as the page updates.
- Supports both live monitoring and explicit checkpoint scanning (`cy.checkAccessibility(...)`) in the same API.
- Supports multiple checkpoints in one test, with optional custom checkpoint labels when provided.
- **Detects repeated accessibility findings on the same DOM nodes across tests in the same spec file and highlights first-seen context in reports.**
- **Optional inclusion of axe `incomplete` findings in reporting.**
- Accessibility analysis summaries are also surfaced in the Cypress command log for fast, in-run feedback.
- Selecting a reported finding in the Cypress command log highlights the related element(s) in the Cypress runner for faster visual debugging.
- CI-friendly terminal output: the Node reporter task prints a summary by severity and a grouped list of violations with affected nodes.
- Generates paired artifacts (`.json` + `.html`) with scan metadata, impact summaries, and report IDs for traceability.
- Per-test runtime overrides for setup and reporting (`cy.setLiveA11yAutoSetupOptions(...)` and `cy.setLiveA11yAutoReportOptions(...)`).
- Built-in validation controls (for example included-impact failure, minimum live scans, runtime error checks).

## Import / Setup

Load the plugin commands in your Cypress support file:

```js
// Installed package (recommended for consumers)
import "wick-a11y-observer";
```

**This import automatically registers auto lifecycle hooks (no extra call required).**

Register the Node-side reporter task in `cypress.config.js`:

```js
const { defineConfig } = require("cypress");
const { registerLiveA11yReporterTasks } = require("./src/a11y-reporter");

module.exports = defineConfig({
  // Override output folder for generated .json/.html accessibility reports
  accessibilityFolder: "cypress/a11y",
  e2e: {
    setupNodeEvents(on, config) {
      registerLiveA11yReporterTasks(on, config);
      return config;
    },
  },
});
```

---

## Public Command Index

Only the following commands are part of the public plugin API:

- `cy.checkAccessibility(axeOptions?, commandOptions?)`
- `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`
- `cy.setLiveA11yAutoSetupOptions(options?)`
- `cy.setLiveA11yAutoReportOptions(options?)`

---

## Shared Option Types

### `LiveA11yRunOptions` (axe-core run options)

All fields are optional.

- `resultTypes?: ("violations" | "passes" | "incomplete" | "inapplicable")[]`
- `iframes?: boolean`
- `includedImpacts?: ("critical" | "serious" | "moderate" | "minor")[]`
- `impactLevels?: ("critical" | "serious" | "moderate" | "minor")[]`
- `runOnly?: { type?: string; values?: string[] }`
- `rules?: Record<string, unknown>`
- additional unknown fields are allowed/passed through

### Default scan profile

- `resultTypes: ["violations", "incomplete"]`
- `iframes: true`
- `includedImpacts: ["critical", "serious"]`
- `runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }`

---

## `cy.checkAccessibility(axeOptions?, commandOptions?)`

Runs a one-time checkpoint full-page accessibility scan for the current page.

### Parameters

- `axeOptions` (optional): `LiveA11yRunOptions`
  - If omitted, uses monitor's configured `initialAxeOptions`.
- `commandOptions` (optional):
  - `waitForIdleBeforeScan?: boolean` (default: `true`)
  - `waitForIdleOptions?: { quietMs?: number; timeoutMs?: number }` (default: `{ quietMs: 500, timeoutMs: 8000 }`)

### Returns

- `Chainable<void>`

### Example

```js
cy.checkAccessibility({
  includedImpacts: ["critical", "serious", "moderate", "minor"],
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
  },
});
```

Use this command for one-time checkpoints. It does not arm additional live monitoring.
It clears previously captured live entries before running the checkpoint scan, so the checkpoint reflects the current one-time snapshot.
When `axeOptions` includes impact or `runOnly` overrides, report policy metadata is synced for this test so severity sections reflect that checkpoint configuration.

---

## `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`

Runs the initial full-page scan and can optionally arm live monitoring.

### Parameters

- `axeOptions` (optional): `LiveA11yRunOptions`
  - If omitted, uses monitor's configured `initialAxeOptions`.
- `commandOptions` (optional): `RunInitialLiveA11yScanCommandOptions`
  - `armAfter?: boolean` (default: `false`)
  - `armOptions?: { scanCurrent?: boolean }` (default when arming path applies: `{ scanCurrent: false }`)

### Returns

- `Chainable<void>`

### Examples

#### Example 1: Initial scan only (no `armAfter`, no `armOptions`)

```js
cy.runInitialLiveA11yScan({
  includedImpacts: ["critical", "serious", "moderate", "minor"],
});
```

What this does:

- Runs one initial full-page accessibility scan with the provided `axeOptions`.
- Does **not** arm the live monitor afterward.
- No additional DOM-change live scans are started by this command.
- Use this when you only need a one-time baseline initial scan.

#### Example 2: Initial scan, then arm live monitoring (`armAfter` + `armOptions`)

```js
cy.runInitialLiveA11yScan(
  {
    includedImpacts: ["critical", "serious", "moderate", "minor"],
  },
  {
    armAfter: true,
    armOptions: { scanCurrent: false },
  }
);
```

What this does (detailed):

- Runs the initial full-page scan first.
- Because `armAfter: true`, it then arms the monitor so live observation starts.
- `armOptions.scanCurrent: false` means:
  - do **not** immediately scan the current DOM again at arm time,
  - start watching and scanning on subsequent DOM changes only.
- This avoids an immediate extra scan right after the initial scan and focuses on future UI mutations.

---

## `cy.setLiveA11yAutoSetupOptions(options?)`

Sets runtime setup/observer options for the auto lifecycle in the current test.

### Parameters

- `options` (optional): `SetupLiveA11yMonitorOptions`
  - `initialAxeOptions?: LiveA11yRunOptions`: axe options used for the initial full-page scan after navigation.
  - `liveAxeOptions?: LiveA11yRunOptions`: axe options used for follow-up live scans triggered by DOM changes.
  - `observerOptions?: LiveA11yObserverOptions`: monitor behavior settings (for example queue size, fallback scanning behavior, debounce/idle behavior).
  - `includeIncompleteInReport?: boolean`: includes axe `incomplete` results in report counts/details when reports are generated.
  - `generateReports?: boolean`: enables/disables writing JSON + HTML report artifacts in the auto lifecycle.
  - `runAccessibility?: boolean`: explicit on/off switch for this test's auto lifecycle (`true` runs it, `false` skips it).
  - `skipAccessibility?: boolean`: inverse switch of `runAccessibility` (`true` skips, `false` allows running).

### Returns

- `Chainable<void>`

### Example

```js
cy.setLiveA11yAutoSetupOptions({
  observerOptions: {
    fallbackFullPageScan: { enabled: false },
    maxQueueSize: 80,
  },
  runAccessibility: true,
});
```

---

## `cy.setLiveA11yAutoReportOptions(options?)`

Sets runtime report options for the auto lifecycle in the current test.

### Parameters

- `options` (optional): `ReportLiveA11yResultsOptions`
  - `outputPath?: string`: Custom output path/filename for the report artifact.
  - `checkpointLabel?: string`: Optional label appended as `-checkpoint-<LABEL>` in checkpoint report names.
    - If provided, that value is used for the label (for example `ANALYSIS_2` becomes `-checkpoint-ANALYSIS_2`).
    - If omitted, checkpoint reports are still generated without a checkpoint label suffix.
  - `validation?: ReportLiveA11yValidationOptions`: Overrides report validation behavior for this test.
  - `throwOnValidationFailure?: boolean`: If `true` (default), throws when validation fails.
  - `includeIncompleteInReport?: boolean`: If `true`, includes axe `incomplete` results in report output and counters.
  - `generateReports?: boolean`: If `false`, skips writing JSON/HTML artifacts (summary still logs to Cypress output).

### Returns

- `Chainable<void>`

### Example

```js
cy.setLiveA11yAutoReportOptions({
  validation: {
    failOnIncludedImpacts: true,
    minLiveScans: 1,
  },
  generateReports: false,
});
```

---

## Auto Lifecycle Notes

- Importing `wick-a11y-observer` (or local `src/a11y-observer-commands.js` during repo development) auto-registers lifecycle hooks.
- Per-test runtime overrides should be set with:
  - `cy.setLiveA11yAutoSetupOptions(...)`
  - `cy.setLiveA11yAutoReportOptions(...)`

### Important note about Cypress runner status

In the Cypress command log, individual test commands can still show green check marks even when accessibility violations were found.

Why this happens:

- Live a11y validation is evaluated in lifecycle hooks (`afterEach` / final `after` strict-mode check), not as a direct assertion inside each command line.
- Because of that, Cypress may show command-level steps as successful while the plugin still records accessibility validation failures.
- At the end of the run, strict mode performs a consolidated failure if one or more tests had live a11y validation failures, so the final failing item often appears on the last test/hook.

This behavior is intentional: it allows the full test run to finish and produce complete accessibility artifacts and summaries before failing the run.

### Env Toggles

- `LIVE_A11Y_RUN=true|false` (default when omitted: `false`)
- `LIVE_A11Y_GENERATE_REPORTS=true|false` (default when omitted: `true`)
- `LIVE_A11Y_INCLUDE_INCOMPLETE=true|false` (default when omitted: `false`)

---

## Important Guidance: Do Not Mix Scan Modes

Mixing live scanning and checkpoint scanning in the same test is not recommended because it does not make practical sense for report interpretation.

- Use either:
  - Auto lifecycle live scanning flow, or
  - Checkpoint scanning flow
- Do not combine both flows in a single test case.

## Practical Flow Examples

### 1) Regular flow: initial + live scans (minimum params, defaults)

```js
it("runs with default initial + live behavior", () => {
  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="open-dialog"]').click();
  cy.get('[data-cy="dialog"]').should("be.visible");
});
```

Notes:
- Requires `LIVE_A11Y_RUN=true` (for example via `cypress.env.json` or CLI `--env LIVE_A11Y_RUN=true`).
- Uses default monitor/report behavior.
- Auto lifecycle performs initial scan after navigation, then live scans on changes.

### 2) Same flow, but custom impact policy (`includedImpacts` + `onlyWarnImpacts`)

```js
it("runs with custom impact policy for initial + live scans", () => {
  cy.setLiveA11yAutoSetupOptions({
    runAccessibility: true,
    initialAxeOptions: {
      iframes: true,
      includedImpacts: ["critical", "serious"],
      onlyWarnImpacts: ["moderate", "minor"],
    },
    liveAxeOptions: {
      iframes: true,
      includedImpacts: ["critical", "serious"],
      onlyWarnImpacts: ["moderate", "minor"],
    },
  });

  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="open-dialog"]').click();
});
```

Notes:
- `runAccessibility` in `cy.setLiveA11yAutoSetupOptions(...)` can force behavior per test (`true` to run, `false` to skip).
- This per-test option overrides the `LIVE_A11Y_RUN` env variable.

### 3) One-time checkpoint snapshot after UI stabilizes

```js
it("captures a one-time checkpoint after stabilization", () => {
  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="app-ready"]').should("be.visible");

  cy.checkAccessibility();
});
```

Notes:
- Requires `LIVE_A11Y_RUN=true` (for example via `cypress.env.json` or CLI `--env LIVE_A11Y_RUN=true`).
- This creates a one-time checkpoint at the moment you call it.
- By default, `checkAccessibility()` waits for monitor idle before running the scan.

### 4) One-time checkpoint snapshot with custom axe options (`runOnly`, `rules`, impacts)

```js
it("captures one-time checkpoint with custom axe configuration", () => {
  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="app-ready"]').should("be.visible");

  cy.checkAccessibility({
    iframes: true,
    includedImpacts: ["critical", "serious", "moderate"],
    onlyWarnImpacts: ["minor"],
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
    },
    rules: {
      // Example rule override: disable this rule for this one-time run
      "color-contrast": { enabled: false },
    },
  });
});
```

Notes:
- Requires `LIVE_A11Y_RUN=true` (for example via `cypress.env.json` or CLI `--env LIVE_A11Y_RUN=true`).
- These axe options apply only to this explicit `checkAccessibility(...)` call.
- `liveAxeOptions` are not used by this one-time command call; they apply to live observer scans.
- This call does not start additional live monitoring.

### 5) Multiple checkpoints in one test (different configs, separate reports)

```js
it("captures checkpoint A and B in the same test", () => {
  // Disable the auto afterEach report artifact for this test because
  // we will write explicit checkpoint reports ourselves.
  cy.setLiveA11yAutoReportOptions({
    generateReports: false,
    validation: { enabled: false },
  });

  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="app-ready"]').should("be.visible");
  cy.get('[data-cy="inject-second-only-issues"]').click();
  cy.get('[data-cy="second-only-issues-panel"]').should("be.visible");
  cy.get('[data-cy="reveal-existing-issues"]').click();
  cy.get('[data-cy="existing-issues-panel"]').should("be.visible");

  // Checkpoint A
  cy.checkAccessibility({
    iframes: true,
    includedImpacts: ["critical", "serious"],
    onlyWarnImpacts: ["moderate", "minor"],
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
    },
    rules: { "color-contrast": { enabled: true } },
  });
  cy.reportLiveA11yResults({
    checkpointLabel: "A",
    includeIncompleteInReport: true,
    validation: { enabled: false },
    throwOnValidationFailure: false,
  });

  // Checkpoint B
  cy.checkAccessibility({
    iframes: true,
    includedImpacts: ["critical"],
    onlyWarnImpacts: ["serious", "moderate"],
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
    },
    rules: { "color-contrast": { enabled: false } },
  });
  cy.reportLiveA11yResults({
    checkpointLabel: "B",
    includeIncompleteInReport: true,
    validation: { enabled: false },
    throwOnValidationFailure: false,
  });
});
```

Notes:
- You must call `cy.reportLiveA11yResults(...)` after each `cy.checkAccessibility(...)` to persist each checkpoint separately.
- Using `checkpointLabel` generates checkpoint artifact names like `a11y-checkpoint--<timestamp>--T06-checkpoint-A.json` (and matching `.html`), where `T06` is the test number in the spec file.
- `generateReports: false` in `cy.setLiveA11yAutoReportOptions(...)` avoids an extra auto `afterEach` artifact that would otherwise reflect only the final state.
- `validation.enabled: false` is important here because default validation assumes auto-lifecycle expectations (for example minimum live scans and fail-on-included-impacts). In a multi-checkpoint comparison test, those defaults can fail the test even when the checkpoint capture itself is correct.

Analysis options in the HTML report now include a `Scan mode` row so you can quickly tell whether the report came from a live or checkpoint flow.

## Report naming convention (easy to read)

All generated reports are saved under `cypress/accessibility/` by default and are written as:

- You can override the default folder with `accessibilityFolder` in `cypress.config.js` (for example `accessibilityFolder: "cypress/my-a11y-artifacts"`).
- If `accessibilityFolder` is omitted or empty, the default `cypress/accessibility/` folder is used.

- one `.json` file (raw/report data), and
- one `.html` file (human-readable report UI),
- both sharing the same base name.

### 1) Live auto lifecycle reports

Pattern:

`a11y-live-auto--<timestamp>--T<test-number>.json`

Example:

`a11y-live-auto--2026-04-27_00-26-34_467--T01.json`

### 2) Checkpoint reports

Pattern (when `checkpointLabel` is omitted):

`a11y-checkpoint--<timestamp>--T<test-number>.json`

Example (no label):

`a11y-checkpoint--2026-04-27_00-26-45_458--T06.json`

Pattern (custom label when `checkpointLabel` is provided):

`a11y-checkpoint--<timestamp>--T<test-number>-checkpoint-<LABEL>.json`

Example (custom label):

`a11y-checkpoint--2026-04-27_00-26-47_494--T07-checkpoint-RELEASE_CANDIDATE_V2.json`


### 3) How to decode each part

- `a11y-live-auto` / `a11y-checkpoint`: scan mode that produced the artifact.
- `<timestamp>`: local sortable timestamp in `YYYY-MM-DD_HH-mm-ss_mmm` format.
  - `YYYY-MM-DD`: local date.
  - `HH-mm-ss`: local 24-hour time.
  - `mmm`: milliseconds.
- `T<test-number>`: test execution order within the current test file/spec (zero-padded, for example `T01`, `T07`).
- `-checkpoint-<LABEL>`: optional suffix for checkpoint reports.
  - It appears when `checkpointLabel` is provided in `cy.setLiveA11yAutoReportOptions()` (option `checkpointLabel`) or `cy.reportLiveA11yResults()` (option `checkpointLabel`).
  - If no `checkpointLabel` is provided, the suffix is omitted.

### 4) Important notes

- `Txx` is per test execution order within the test file/spec and helps map a report back to the test position in that spec.
- If you pass `outputPath` explicitly in `cy.reportLiveA11yResults(...)` or `cy.setLiveA11yAutoReportOptions(...)`, that custom path/name is used instead of the default naming convention above.

## Terminal output (CI-friendly)

When `cy.reportLiveA11yResults(...)` runs, the Node reporter task (`liveA11y:buildReport`) now writes a plain-text accessibility summary to the terminal/CI logs.

This output includes:

- report identity (`reportId`, scan mode, spec, test),
- validation result (`PASS` / `FAIL`),
- totals (grouped findings, issues, fail/warn and optional incomplete counts),
- per-severity summary,
- artifact paths (`.json` and `.html`, when generated),
- grouped violations and their affected node targets (including page URL when available).

This lets CI users see key accessibility results directly in terminal output without opening report files.
The same computed validation status (`PASS` / `FAIL`) is also persisted into the JSON payload and displayed in the HTML report summary.

## Change Log

### `1.0.0-beta.0`

- First public beta release: continuous live + checkpoint accessibility scanning for Cypress, including violations, warnings and optional `incomplete` findings, with strict end-of-run validation, rich JSON/HTML reports, and CI-friendly terminal summaries.

