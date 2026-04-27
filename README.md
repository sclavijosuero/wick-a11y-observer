# wick-a11y-observer Cypress API

`wick-a11y-observer` registers custom commands under the Cypress namespace.

This README documents:
- public plugin commands
- required vs optional params
- supported options
- defaults from source code
- examples with plain-language explanations

## Import / Setup

Load the plugin commands in your Cypress support file:

```js
// Installed package (recommended for consumers)
import "wick-a11y-observer";
```

If you are developing inside this repository (local source import), use:

```js
import "../../src/a11y-observer-commands.js";
```

Import automatically registers auto lifecycle hooks (no extra call required).

Register the Node-side reporter task in `cypress.config.js`:

```js
const { registerLiveA11yReporterTasks } = require("./src/a11y-reporter");

module.exports = {
  e2e: {
    setupNodeEvents(on, config) {
      registerLiveA11yReporterTasks(on);
      return config;
    },
  },
};
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

Runs a one-time manual full-page accessibility scan for the current page.

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

Use this command for one-time manual checkpoints. It does not arm additional live monitoring.
It clears previously captured live entries before running the manual scan, so the checkpoint reflects the current one-time snapshot.
When `axeOptions` includes impact or `runOnly` overrides, report policy metadata is synced for this test so severity sections reflect that manual configuration.

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

### Example

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

This performs initial scan, then starts watching only future changes.

---

## `cy.setLiveA11yAutoSetupOptions(options?)`

Sets runtime setup/observer options for the auto lifecycle in the current test.

### Parameters

- `options` (optional): `SetupLiveA11yMonitorOptions`
  - `initialAxeOptions?: LiveA11yRunOptions`
  - `liveAxeOptions?: LiveA11yRunOptions`
  - `observerOptions?: LiveA11yObserverOptions`
  - `includeIncompleteInReport?: boolean`
  - `generateReports?: boolean`
  - `runAccessibility?: boolean`
  - `skipAccessibility?: boolean`

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
  - `outputPath?: string`
  - `validation?: ReportLiveA11yValidationOptions`
  - `throwOnValidationFailure?: boolean`
  - `includeIncompleteInReport?: boolean`
  - `generateReports?: boolean`

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

### Env Toggles

- `LIVE_A11Y_RUN=true|false` (default when omitted: `false`)
- `LIVE_A11Y_GENERATE_REPORTS=true|false` (default when omitted: `true`)
- `LIVE_A11Y_INCLUDE_INCOMPLETE=true|false` (default when omitted: `false`)

---

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

### 3) One-time manual snapshot after UI stabilizes

```js
it("captures a one-time manual checkpoint after stabilization", () => {
  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="app-ready"]').should("be.visible");

  cy.checkAccessibility();
});
```

Notes:
- Requires `LIVE_A11Y_RUN=true` (for example via `cypress.env.json` or CLI `--env LIVE_A11Y_RUN=true`).
- This creates a one-time manual checkpoint at the moment you call it.
- By default, `checkAccessibility()` waits for monitor idle before running the scan.

### 4) One-time manual snapshot with custom axe options (`runOnly`, `rules`, impacts)

```js
it("captures one-time manual checkpoint with custom axe configuration", () => {
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

