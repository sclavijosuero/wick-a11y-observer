# wick-a11y-observer Cypress Commands API

See command docs below.

## Commands

- `cy.setupLiveA11yMonitor(monitorOptions?)`
- `cy.setupStandardLiveA11yMonitor(monitorOptions?)`
- `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`
- `cy.armLiveA11yMonitor(options?)`
- `cy.waitForLiveA11yIdle(options?)`
- `cy.stopLiveA11yMonitor()`
- `cy.getLiveA11yResults()`
- `cy.reportLiveA11yResults(options?)`
# wick-a11y-observer Cypress Commands API

This plugin adds custom commands to `Cypress.Chainable` for:
- installing a live accessibility monitor in the AUT
- running initial and live `axe-core` scans
- waiting for live-scan completion
- generating JSON + HTML reports

This document is command-first and self-contained:
- each command explains what it does
- each parameter and nested option is explained inline
- defaults are listed in place
- examples include intent

---

## Quick Setup

Import commands in `cypress/support/e2e.js`:

```js
import "../../src/a11y-observer-commands.js";
```

Register reporter tasks in `cypress.config.js`:

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
- `cy.setupStandardLiveA11yMonitor(monitorOptions?)`
- `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`
- `cy.armLiveA11yMonitor(options?)`
- `cy.waitForLiveA11yIdle(options?)`
- `cy.stopLiveA11yMonitor()`
- `cy.getLiveA11yResults()`
- `cy.reportLiveA11yResults(options?)`

---

## Common axe run options (used by multiple commands)

All fields below are optional unless noted by your own test policy:

- `resultTypes: ("violations" | "passes" | "incomplete" | "inapplicable")[]`
- `iframes: boolean`
- `includedImpacts: ("critical" | "serious" | "moderate" | "minor")[]`
- `impactLevels: ("critical" | "serious" | "moderate" | "minor")[]`
- `runOnly.type: string` (commonly `"tag"`)
- `runOnly.values: string[]` (for example `["wcag2a", "wcag2aa"]`)
- `rules: Record<string, unknown>`
- additional axe options are passed through

---

## 1) `cy.setupLiveA11yMonitor(monitorOptions?)`

### What it is for

Installs the live monitor and creates/aliases the shared live results store.

### Signature

```ts
cy.setupLiveA11yMonitor(monitorOptions?)
```

### Parameters

- `monitorOptions` *(optional object; all fields optional)*

  Core timing/queue fields:
  - `autoArm` *(boolean, default: `false`)*
  - `minVisibleMs` *(number, default: `250`)*
  - `stableFrames` *(number, default: `3`)*
  - `maxSettleMs` *(number, default: `2000`)*
  - `quietMs` *(number, default: `400`)*
  - `waitForIdleTimeoutMs` *(number, default: `10000`)*
  - `maxQueueSize` *(number, default: `20`)*

  Visibility and rooting:
  - `root` *(Element | Document, default: `document.documentElement`)*
  - `treatOpacityZeroAsHidden` *(boolean, default: `true`)*
  - `semanticRootSelector` *(string, default: built-in semantic selectors)*
  - `stateRootSelector` *(string, default: built-in state selectors)*
  - `conventionRootSelector` *(string, default: `""`)*
  - `useConventionRoots` *(boolean, default: `false`)*
  - `interactiveSelector` *(string, default: built-in interactive selectors)*
  - `ignoreSelector` *(string, default: `html, body, script, style, link, meta, title, head, template, noscript`)*
  - `mutationAncestorDepth` *(number, default: `5`)*

  Output/capture:
  - `rootIdAttribute` *(string, default: `"data-live-axe-root-id"`)*
  - `htmlSnippetMax` *(number, default: `1500`)*

  Fallback full-page scan:
  - `fallbackFullPageScan.enabled` *(boolean, default: `true`)*
  - `fallbackFullPageScan.throttleMs` *(number, default: `1500`)*

  Scan run options:
  - `initialAxeOptions` *(object, default: `{ resultTypes: ["violations", "incomplete"] }`)*
  - `liveAxeOptions` *(object, default: `{ resultTypes: ["violations", "incomplete"] }`)*

### Return

- `Chainable<LiveA11yStore>`

### Example

```js
cy.setupLiveA11yMonitor({
  minVisibleMs: 180,
  stableFrames: 2,
  maxQueueSize: 40,
  fallbackFullPageScan: { enabled: false },
});
```

Explanation: faster settle profile and no full-page fallback.

---

## 2) `cy.setupStandardLiveA11yMonitor(monitorOptions?)`

### What it is for

Sets up the same live monitor, but with a standard scan profile pre-applied.  
This is the recommended high-level entrypoint.

### Signature

```ts
cy.setupStandardLiveA11yMonitor(monitorOptions?)
```

### Parameters

- `monitorOptions` *(optional object)*

  - `runOptions` *(optional object; preferred way to configure scan rules)*
    - `shared` *(optional object)*  
      Applied to both initial and live scans.
    - `initial` *(optional object)*  
      Applied only to initial scan.
    - `live` *(optional object)*  
      Applied only to live scans.

  - any monitor behavior option from `setupLiveA11yMonitor` can also be passed
    (for example `quietMs`, `stableFrames`, `fallbackFullPageScan`, selectors, etc.)

### Standard defaults used by this command

- `resultTypes: ["violations", "incomplete"]`
- `iframes: true`
- `includedImpacts: ["critical", "serious"]`
- `runOnly.type: "tag"`
- `runOnly.values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]`

### Merge behavior

- Initial run options = `DEFAULT` + `runOptions.shared` + `runOptions.initial`
- Live run options = `DEFAULT` + `runOptions.shared` + `runOptions.live`

### Return

- `Chainable<LiveA11yStore>`

### Example

```js
cy.setupStandardLiveA11yMonitor({
  runOptions: {
    shared: {
      includedImpacts: ["critical", "serious", "moderate"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    },
    live: {
      iframes: false,
    },
  },
  fallbackFullPageScan: { enabled: false },
});
```

Explanation: keeps standard defaults, then narrows tags/impacts and speeds live scans.

---

## 3) `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`

### What it is for

Runs the initial full-page scan immediately, then optionally arms live monitoring.

### Signature

```ts
cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)
```

### Parameters

- `axeOptions` *(optional object)*  
  Axe run options for this initial scan call.  
  If omitted, the monitor's configured `initialAxeOptions` is used.

- `commandOptions` *(optional object; default: `{ armAfter: false, armOptions: { scanCurrent: false } }`)*
  - `armAfter` *(boolean, default: `false`)*
  - `armOptions.scanCurrent` *(boolean, default: `false`)*

### Return

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

Explanation: full initial scan, then watch only future changes.

---

## 4) `cy.armLiveA11yMonitor(options?)`

### What it is for

Arms live monitoring.

### Signature

```ts
cy.armLiveA11yMonitor(options?)
```

### Parameters

- `options` *(optional object; default: `{ scanCurrent: false }`)*
  - `scanCurrent` *(boolean)*  
    `true`: immediately scan current state on arm.  
    `false`: wait for future changes.

### Return

- `Chainable<void>`

### Example

```js
cy.armLiveA11yMonitor({ scanCurrent: true });
```

---

## 5) `cy.waitForLiveA11yIdle(options?)`

### What it is for

Waits for live scanning to become idle before assertions/reporting.

### Signature

```ts
cy.waitForLiveA11yIdle(options?)
```

### Parameters

- `options` *(optional object)*
  - `quietMs` *(number, default: `500`)*
  - `timeoutMs` *(number, default: `8000`)*

### Return

- `Chainable<LiveA11yStore | null>`

### Example

```js
cy.waitForLiveA11yIdle({ quietMs: 400, timeoutMs: 12000 });
```

---

## 6) `cy.stopLiveA11yMonitor()`

### What it is for

Stops the monitor and detaches observers/listeners.

### Signature

```ts
cy.stopLiveA11yMonitor()
```

### Parameters

- none

### Return

- `Chainable<void>`

### Example

```js
cy.stopLiveA11yMonitor();
```

---

## 7) `cy.getLiveA11yResults()`

### What it is for

Returns current in-memory results (without writing files).

### Signature

```ts
cy.getLiveA11yResults()
```

### Parameters

- none

### Return

- `Chainable<LiveA11yStore | null>`

### Example

```js
cy.getLiveA11yResults().then((results) => {
  expect(results?.meta?.started ?? 0).to.be.greaterThan(0);
});
```

---

## 8) `cy.reportLiveA11yResults(options?)`

### What it is for

Builds + validates + writes report artifacts:
- JSON report
- sibling HTML report
- validation checks

### Signature

```ts
cy.reportLiveA11yResults(options?)
```

### Parameters

- `options` *(optional object)*
  - `outputPath` *(string, optional)*  
    Output JSON path.  
    Default: generated unique path under `cypress/accessibility/`.
  - `validation` *(optional object)*
    - `enabled` *(boolean, default: `true`)*
    - `requireInitialScan` *(boolean, default: `true`)*
    - `minLiveScans` *(number, default: `1`)*
    - `requireNoRuntimeErrors` *(boolean, default: `true`)*
    - `minUniqueLiveRuleIds` *(number, default: `0`)*
    - `requiredLiveRuleIds` *(string[], default: `[]`)*
    - `minGroupedBySeverity` *(object, default: `{}`; keys: `critical|serious|moderate|minor`)*

### Return

- `Chainable<LiveA11yReport>`

### Example

```js
cy.reportLiveA11yResults({
  outputPath: "cypress/accessibility/checkout-a11y.json",
  validation: {
    minLiveScans: 2,
    requiredLiveRuleIds: ["color-contrast"],
    minGroupedBySeverity: { critical: 0, serious: 1 },
  },
});
```

If validation fails, this command throws with all failing conditions.

---

## Recommended Workflow

```js
beforeEach(() => {
  cy.setupStandardLiveA11yMonitor({
    fallbackFullPageScan: { enabled: false },
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

# wick-a11y-observer Cypress Commands API

This plugin adds custom commands to `Cypress.Chainable` for:

- installing a live accessibility monitor in the AUT
- running initial + live scans with `axe-core`
- waiting for scan completion
- generating JSON + HTML reports

This document is intentionally command-first and self-contained:
- each command explains what it does
- every parameter (and nested option) is explained inline
- defaults are listed next to each option
- examples include why/when to use them

---

## Quick Start

Import commands in `cypress/support/e2e.js`:

```js
import "../../src/a11y-observer-commands.js";
```

Register reporter tasks in `cypress.config.js`:

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
- `cy.setupStandardLiveA11yMonitor(monitorOptions?)`
- `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`
- `cy.armLiveA11yMonitor(options?)`
- `cy.waitForLiveA11yIdle(options?)`
- `cy.stopLiveA11yMonitor()`
- `cy.getLiveA11yResults()`
- `cy.reportLiveA11yResults(options?)`

---

## 1) `cy.setupLiveA11yMonitor(monitorOptions?)`

### What this command is for

Installs the live monitor into the application-under-test window and creates a shared in-memory results store.

Use this when you want direct monitor control (selectors, stability timings, fallback scan behavior, etc.).

### Signature

```ts
cy.setupLiveA11yMonitor(monitorOptions?)
```

### Parameters

- `monitorOptions` *(optional, object)*  
  All fields inside `monitorOptions` are optional.

  Commonly used fields:

  - `root` *(Element | Document, default: `document.documentElement`)*  
    Root DOM subtree observed for mutations.
  - `autoArm` *(boolean, default: `false`)*  
    Auto-start live scanning immediately on install.
  - `minVisibleMs` *(number, default: `250`)*  
    Minimum visible time before a root can be scanned.
  - `stableFrames` *(number, default: `3`)*  
    Number of consecutive frames with same geometry/style signature.
  - `maxSettleMs` *(number, default: `2000`)*  
    Maximum time to wait for stability before scanning anyway.
  - `quietMs` *(number, default: `400`)*  
    Idle quiet period required by monitor idle logic.
  - `waitForIdleTimeoutMs` *(number, default: `10000`)*  
    Upper bound for monitor-side idle waiting.
  - `maxQueueSize` *(number, default: `20`)*  
    Max queued roots before lower-priority roots are dropped.
  - `treatOpacityZeroAsHidden` *(boolean, default: `true`)*  
    Treat fully transparent nodes as non-visible.
  - `semanticRootSelector` *(string, default: built-in semantic selector list)*  
    Preferred semantic roots (dialogs, live regions, popups, etc.).
  - `stateRootSelector` *(string, default: built-in state-open selector list)*  
    State roots (`[open]`, `[aria-expanded=true]`, etc.).
  - `conventionRootSelector` *(string, default: `""`)*  
    App-specific root selector.
  - `useConventionRoots` *(boolean, default: `false`)*  
    Enable convention root strategy.
  - `interactiveSelector` *(string, default: built-in interactive selector list)*  
    Selector used to detect interactive elements.
  - `ignoreSelector` *(string, default: `html, body, script, style, link, meta, title, head, template, noscript`)*  
    Ignored candidates.
  - `rootIdAttribute` *(string, default: `"data-live-axe-root-id"`)*  
    Attribute used to identify scan roots in artifacts.
  - `htmlSnippetMax` *(number, default: `1500`)*  
    Max HTML snippet length captured per scan.
  - `mutationAncestorDepth` *(number, default: `5`)*  
    Max ancestor depth used by mutation fallback root selection.
  - `fallbackFullPageScan.enabled` *(boolean, default: `true`)*  
    Run full-page scan when no suitable root is found.
  - `fallbackFullPageScan.throttleMs` *(number, default: `1500`)*  
    Throttle for fallback full-page scans.
  - `initialAxeOptions` *(object, default: `{ resultTypes: ["violations", "incomplete"] }`)*  
    Axe options for initial full-page scan.
  - `liveAxeOptions` *(object, default: `{ resultTypes: ["violations", "incomplete"] }`)*  
    Axe options for live scans.

### Return value

- `Chainable<LiveA11yStore>`

### Example

```js
cy.setupLiveA11yMonitor({
  minVisibleMs: 180,
  stableFrames: 2,
  maxQueueSize: 40,
  fallbackFullPageScan: { enabled: false },
});
```

Explanation: faster settle profile + no full-page fallback, useful in controlled test pages.

---

## 2) `cy.setupStandardLiveA11yMonitor(monitorOptions?)`

### What this command is for

Same as `setupLiveA11yMonitor`, but with a standard scan profile pre-applied and merged with your overrides.

### Signature

```ts
cy.setupStandardLiveA11yMonitor(monitorOptions?)
```

### Parameters

- `monitorOptions` *(optional, object)*

  - `axeConfig` *(optional, object)*  
    Structured way to override run options:
    - `sharedRunOptions` *(optional, object)*  
      Applied to both initial and live scan options.
    - `initialRunOptions` *(optional, object)*  
      Applied only to initial scan.
    - `liveRunOptions` *(optional, object)*  
      Applied only to live scans.

  - `initialAxeOptions` *(optional, object)*  
    Direct/legacy initial override path.
  - `liveAxeOptions` *(optional, object)*  
    Direct/legacy live override path.
  - any monitor options from command #1 can also be passed here.

### Standard defaults used by this command

- `resultTypes: ["violations", "incomplete"]`
- `iframes: true`
- `includedImpacts: ["critical", "serious"]`
- `runOnly.type: "tag"`
- `runOnly.values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]`

### Return value

- `Chainable<LiveA11yStore>`

### Example

```js
cy.setupStandardLiveA11yMonitor({
  axeConfig: {
    sharedRunOptions: {
      includedImpacts: ["critical", "serious", "moderate"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    },
    liveRunOptions: {
      iframes: false,
    },
  },
  fallbackFullPageScan: { enabled: false },
});
```

Explanation: keeps standard behavior but narrows rules and speeds live scans by disabling iframe scanning.

---

## 3) `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`

### What this command is for

Runs the initial full-page scan now. Optionally arms the monitor immediately after this first scan.

### Signature

```ts
cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)
```

### Parameters

- `axeOptions` *(optional, object)*  
  If provided, overrides monitor `initialAxeOptions` for this call.

  Available fields:
  - `resultTypes` *(array)*
  - `iframes` *(boolean)*
  - `includedImpacts` / `impactLevels` *(array: critical/serious/moderate/minor)*
  - `runOnly.type` *(string, usually `"tag"`)*
  - `runOnly.values` *(string[])*
  - `rules` *(object)*
  - any additional axe run option fields are passed through

- `commandOptions` *(optional, object; default: `{ armAfter: false, armOptions: { scanCurrent: false } }`)*
  - `armAfter` *(boolean, default: `false`)*  
    If true, calls `arm()` after initial scan.
  - `armOptions.scanCurrent` *(boolean, default: `false`)*  
    If true, arming triggers immediate scan of current state.

### Return value

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

Explanation: run broad first scan, then monitor only future mutations/events.

---

## 4) `cy.armLiveA11yMonitor(options?)`

### What this command is for

Starts live tracking/scanning (if monitor is installed).

### Signature

```ts
cy.armLiveA11yMonitor(options?)
```

### Parameters

- `options` *(optional, object; default: `{ scanCurrent: false }`)*
  - `scanCurrent` *(boolean)*  
    `true`: schedule immediate current-state rescan on arm.  
    `false`: only react to future changes.

### Return value

- `Chainable<void>`

### Example

```js
cy.armLiveA11yMonitor({ scanCurrent: true });
```

Explanation: useful when you intentionally delayed arming and now want one immediate sweep.

---

## 5) `cy.waitForLiveA11yIdle(options?)`

### What this command is for

Waits until monitor has no pending/active scans and reaches quiet period.

### Signature

```ts
cy.waitForLiveA11yIdle(options?)
```

### Parameters

- `options` *(optional, object; defaults below)*
  - `quietMs` *(number, default: `500`)*
  - `timeoutMs` *(number, default: `8000`)*

### Return value

- `Chainable<LiveA11yStore | null>`

### Example

```js
cy.waitForLiveA11yIdle({ quietMs: 400, timeoutMs: 12000 });
```

Explanation: longer timeout for busy pages; short quiet window to keep tests fast.

---

## 6) `cy.stopLiveA11yMonitor()`

### What this command is for

Stops monitor activity and detaches observers/listeners.

### Signature

```ts
cy.stopLiveA11yMonitor()
```

### Parameters

- none

### Return value

- `Chainable<void>`

### Example

```js
cy.stopLiveA11yMonitor();
```

---

## 7) `cy.getLiveA11yResults()`

### What this command is for

Returns current in-memory raw store (without writing report files).

### Signature

```ts
cy.getLiveA11yResults()
```

### Parameters

- none

### Return value

- `Chainable<LiveA11yStore | null>`

### Example

```js
cy.getLiveA11yResults().then((results) => {
  expect(results?.meta?.started ?? 0).to.be.greaterThan(0);
});
```

Explanation: use this for custom assertions/debugging before report generation.

---

## 8) `cy.reportLiveA11yResults(options?)`

### What this command is for

Generates final artifacts and validation:
- writes JSON report
- writes sibling HTML report
- validates report against requested thresholds/requirements
- returns full report object

### Signature

```ts
cy.reportLiveA11yResults(options?)
```

### Parameters

- `options` *(optional, object)*

  - `outputPath` *(string, optional)*  
    Target JSON path.  
    Default: generated unique path under `cypress/accessibility/` (per spec + timestamp + report number).

  - `validation` *(optional, object)*  
    Validation rules run before returning:
    - `enabled` *(boolean, default: `true`)*
    - `requireInitialScan` *(boolean, default: `true`)*
    - `minLiveScans` *(number, default: `1`)*
    - `requireNoRuntimeErrors` *(boolean, default: `true`)*
    - `minUniqueLiveRuleIds` *(number, default: `0`)*
    - `requiredLiveRuleIds` *(string[], default: `[]`)*
    - `minGroupedBySeverity` *(object, default: `{}`)*  
      Allowed keys: `critical`, `serious`, `moderate`, `minor`.

### Return value

- `Chainable<LiveA11yReport>`

### Example

```js
cy.reportLiveA11yResults({
  outputPath: "cypress/accessibility/checkout-a11y.json",
  validation: {
    minLiveScans: 2,
    requiredLiveRuleIds: ["color-contrast"],
    minGroupedBySeverity: { critical: 0, serious: 1 },
  },
});
```

Explanation: enforce minimum live activity and require specific rule coverage.

If validation fails, the command throws with all failed conditions.

---

## Typical Workflow (Recommended)

```js
beforeEach(() => {
  cy.setupStandardLiveA11yMonitor({
    fallbackFullPageScan: { enabled: false },
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

What this gives you:
- full baseline scan first
- live scans for meaningful DOM changes
- deterministic end-of-test report artifacts

---

## Note About Type Definitions

Full TypeScript interfaces remain in:
- `src/a11y-observer-commands.d.ts`

But this README is designed so you can use the API without needing to jump there.

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
- `cy.setupStandardLiveA11yMonitor(monitorOptions?)`
- `cy.runInitialLiveA11yScan(axeOptions?, commandOptions?)`
- `cy.armLiveA11yMonitor(options?)`
- `cy.waitForLiveA11yIdle(options?)`
- `cy.stopLiveA11yMonitor()`
- `cy.getLiveA11yResults()`
- `cy.reportLiveA11yResults(options?)`

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

### Default scan profile used by `setupStandardLiveA11yMonitor()`

- `resultTypes: ["violations", "incomplete"]`
- `iframes: true`
- `includedImpacts: ["critical", "serious"]`
- `runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }`

---

## `cy.setupLiveA11yMonitor(monitorOptions?)`

Installs the live monitor in the AUT window and creates/aliases an internal store.

### Parameters

- `monitorOptions` (optional): monitor behavior and scan settings

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

### Example

```js
cy.setupLiveA11yMonitor({
  maxQueueSize: 50,
  quietMs: 300,
  fallbackFullPageScan: { enabled: false },
});
```

Use this when you want direct control of monitor behavior and will set run options yourself.

---

## `cy.setupStandardLiveA11yMonitor(monitorOptions?)`

Convenience setup command that merges your run options with the standard defaults.

### Parameters

- `monitorOptions` (optional)
  - `axeConfig?` (optional)
    - `sharedRunOptions?: LiveA11yRunOptions`
    - `initialRunOptions?: LiveA11yRunOptions`
    - `liveRunOptions?: LiveA11yRunOptions`
  - `initialAxeOptions?: LiveA11yRunOptions` (legacy/direct override path)
  - `liveAxeOptions?: LiveA11yRunOptions` (legacy/direct override path)
  - plus any `setupLiveA11yMonitor` options

### Returns

- `Chainable<LiveA11yStore>`

### Merge behavior

- Initial scan options = `DEFAULT` + `axeConfig.sharedRunOptions` + `axeConfig.initialRunOptions` (or `initialAxeOptions`)
- Live scan options = `DEFAULT` + `axeConfig.sharedRunOptions` + `axeConfig.liveRunOptions` (or `liveAxeOptions`)

### Example

```js
cy.setupStandardLiveA11yMonitor({
  axeConfig: {
    sharedRunOptions: {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      includedImpacts: ["critical", "serious", "moderate"],
    },
    liveRunOptions: {
      iframes: false,
    },
  },
  fallbackFullPageScan: { enabled: false },
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

If validation fails, the command throws an error with all validation issues.

---

## Typical End-to-End Flow

```js
beforeEach(() => {
  cy.setupStandardLiveA11yMonitor({
    fallbackFullPageScan: { enabled: false },
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

This pattern captures:
- initial full-page baseline
- live/delta changes during interaction
- machine + human-readable artifacts

