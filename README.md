# wick-a11y-observer Cypress API

`wick-a11y-observer` registers custom commands under the Cypress namespace.

This README documents:
- all custom commands
- required vs optional params
- supported options
- defaults from source code
- examples with plain-language explanations

## Import / Setup

Load the plugin commands in your Cypress support file:

```js
import "../../src/a11y-observer-commands.js";
```

Or use the one-time auto lifecycle helper (minimal test instrumentation):

```js
import { registerLiveA11yAutoLifecycle } from "../../src/a11y-observer-commands.js";

registerLiveA11yAutoLifecycle({
  setupOptions: {
    observerOptions: { fallbackFullPageScan: { enabled: false } },
  },
});
```

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

## Command Index

- `cy.setupLiveA11yMonitor(monitorOptions?)`
- `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`
- `cy.armLiveA11yMonitor(options?)`
- `cy.waitForLiveA11yIdle(options?)`
- `cy.stopLiveA11yMonitor()`
- `cy.getLiveA11yResults()`
- `cy.reportLiveA11yResults(options?)`
- `registerLiveA11yAutoLifecycle(options?)`

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

### Default scan profile used by `setupLiveA11yMonitor()`

- `resultTypes: ["violations", "incomplete"]`
- `iframes: true`
- `includedImpacts: ["critical", "serious"]`
- `runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }`

---

## `cy.setupLiveA11yMonitor(monitorOptions?)`

Installs the live monitor in the AUT window, creates/aliases an internal store, and merges your initial/live axe options with the standard scan defaults.

### Parameters

- `monitorOptions` (optional)
  - `initialAxeOptions?: LiveA11yRunOptions`
  - `liveAxeOptions?: LiveA11yRunOptions`
  - `observerOptions?: LiveA11yObserverOptions`

### Returns

- `Chainable<LiveA11yStore>`

### Important defaults

When called through this command, these defaults are applied before your overrides:

- `autoArm: false`
- `minVisibleMs: 250`
- `stableFrames: 3`
- `maxSettleMs: 2000`
- `maxQueueSize: 20`
- `useConventionRoots: false`
- `liveAxeOptions.resultTypes: ["violations", "incomplete"]`

Lower-level monitor defaults also include:

- `quietMs: 400`
- `waitForIdleTimeoutMs: 10000`
- `treatOpacityZeroAsHidden: true`
- `fallbackFullPageScan.enabled: true`
- `fallbackFullPageScan.throttleMs: 1500`

### Merge behavior

- Initial scan options = `DEFAULT` + `initialAxeOptions`
- Live scan options = `DEFAULT` + `liveAxeOptions`

### Example

```js
cy.setupLiveA11yMonitor({
  initialAxeOptions: {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    includedImpacts: ["critical", "serious", "moderate"],
  },
  liveAxeOptions: {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    includedImpacts: ["critical", "serious", "moderate"],
    iframes: false,
  },
  observerOptions: {
    fallbackFullPageScan: { enabled: false },
  },
});
```

Use this for most projects because it keeps sane defaults while allowing targeted overrides.

---

## `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`

Runs the initial full-page scan immediately.

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

## `cy.armLiveA11yMonitor(options?)`

Arms the monitor so live changes are tracked/scanned.

### Parameters

- `options` (optional): `ArmLiveA11yMonitorOptions`
  - `scanCurrent?: boolean` (default: `false`)

### Returns

- `Chainable<void>`

### Example

```js
cy.armLiveA11yMonitor({ scanCurrent: true });
```

`scanCurrent: true` triggers an immediate current-state rescan on arm.

---

## `cy.waitForLiveA11yIdle(options?)`

Waits until the monitor is idle (no queued/active scans and quiet period reached).

### Parameters

- `options` (optional): `WaitForLiveA11yIdleOptions`
  - `quietMs?: number` (default: `500`)
  - `timeoutMs?: number` (default: `8000`)

### Returns

- `Chainable<LiveA11yStore | null>`

### Example

```js
cy.waitForLiveA11yIdle({
  quietMs: 400,
  timeoutMs: 12000,
});
```

Use this before reporting to reduce race conditions and partial captures.

---

## `cy.stopLiveA11yMonitor()`

Stops the monitor, disconnects observers/listeners, and prevents further live scans.

### Parameters

- none

### Returns

- `Chainable<void>`

### Example

```js
cy.stopLiveA11yMonitor();
```

---

## `cy.getLiveA11yResults()`

Reads the current in-memory monitor store.

### Parameters

- none

### Returns

- `Chainable<LiveA11yStore | null>`

### Example

```js
cy.getLiveA11yResults().then((results) => {
  expect(results?.meta?.started ?? 0).to.be.greaterThan(0);
});
```

Use when you want raw data without writing report artifacts.

---

## `cy.reportLiveA11yResults(options?)`

Builds report payload, validates it, writes JSON+HTML artifacts, and returns the report object.

### Parameters

- `options` (optional): `ReportLiveA11yResultsOptions`
  - `outputPath?: string`
    - default: generated under `cypress/accessibility/` with unique file name
  - `throwOnValidationFailure?: boolean` (default: `true`)
  - `validation?: ReportLiveA11yValidationOptions`
    - `enabled?: boolean` (default: `true`)
    - `requireInitialScan?: boolean` (default: `true`)
    - `minLiveScans?: number` (default: `1`)
    - `requireNoRuntimeErrors?: boolean` (default: `true`)
    - `minUniqueLiveRuleIds?: number` (default: `0`)
    - `requiredLiveRuleIds?: string[]` (default: `[]`)
    - `minGroupedBySeverity?: Partial<Record<"critical" | "serious" | "moderate" | "minor", number>>` (default: `{}`)

### Returns

- `Chainable<LiveA11yReport>`

### Example

```js
cy.reportLiveA11yResults({
  outputPath: "cypress/accessibility/checkout-a11y.json",
  validation: {
    minLiveScans: 2,
    minGroupedBySeverity: { critical: 0, serious: 1 },
    requiredLiveRuleIds: ["color-contrast"],
  },
});
```

If validation fails, the command throws by default. Set `throwOnValidationFailure: false` when you need to handle failures without throwing from hook context.

---

## `registerLiveA11yAutoLifecycle(options?)`

Registers plugin-managed `beforeEach` + `afterEach` hooks once (typically in `cypress/support/e2e.js`) so each test is checked with minimal spec instrumentation.

This helper:
- sets up the monitor before each test
- patches `cy.visit()` to run initial scan + arm live monitoring after each navigation
- waits for idle + writes report after each test
- marks the current test as failed when validation fails (without throwing a hook error)

### Parameters

- `options` (optional)
  - `setupOptions?: SetupLiveA11yMonitorOptions`
  - `initialScan?: { axeOptions?: LiveA11yRunOptions; commandOptions?: RunInitialLiveA11yScanCommandOptions }`
  - `waitForIdleOptions?: WaitForLiveA11yIdleOptions`
  - `reportOptions?: ReportLiveA11yResultsOptions`
  - `failTestOnValidationError?: boolean` (default: `true`)
  - `failRunOnValidationError?: boolean` (default: `true`)
  - `stopMonitorAfterEach?: boolean` (default: `true`)

### Example

```js
import { registerLiveA11yAutoLifecycle } from "../../src/a11y-observer-commands.js";

registerLiveA11yAutoLifecycle({
  setupOptions: {
    observerOptions: { fallbackFullPageScan: { enabled: false } },
  },
  reportOptions: {
    outputPath: "cypress/accessibility/live-a11y.json",
  },
});
```

Note: this mode relies on `cy.visit()` calls to trigger initial scan + arm for each loaded page.
In strict mode (`failRunOnValidationError: true`), the run is failed at the end of the spec if any test has validation failures, while still allowing remaining tests to execute.

---

## Typical End-to-End Flow (Manual Hooks)

```js
beforeEach(() => {
  cy.setupLiveA11yMonitor({
    observerOptions: { fallbackFullPageScan: { enabled: false } },
  });

  cy.visit("/page-under-test");
  cy.runInitialLiveA11yScan(undefined, {
    armAfter: true,
    armOptions: { scanCurrent: false },
  });
});

afterEach(() => {
  cy.waitForLiveA11yIdle({ quietMs: 500, timeoutMs: 8000 });
  cy.reportLiveA11yResults();
  cy.stopLiveA11yMonitor();
});
```

For per-test failure behavior without hook-failure cascade, prefer `registerLiveA11yAutoLifecycle()`.

This pattern captures:
- initial full-page baseline
- live/delta changes during interaction
- machine + human-readable artifacts

