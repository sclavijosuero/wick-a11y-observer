# wick-a11y-observer

**wick-a11y-observer** runs **[axe-core](https://github.com/dequelabs/axe-core)** in **Cypress**: scans run on each visit and as the DOM changes, with optional **`cy.checkAccessibility()`** checkpoints—no app instrumentation, only support + Node reporter setup.

## Table of contents

- [Features](#features)
- [Import / Setup](#import--setup)
- [Public Command Index](#public-command-index)
- [Shared Option Types](#shared-option-types)
  - [`LiveA11yRunOptions` (axe-core run options)](#livea11yrunoptions-axe-core-run-options)
  - [`ReportLiveA11yValidationOptions` (structural validation)](#reportlivea11yvalidationoptions-structural-validation)
  - [`ReportLiveA11yResultsOptions`](#reportlivea11yresultsoptions)
  - [`CheckAccessibilityCommandOptions`](#checkaccessibilitycommandoptions)
  - [`SetupLiveA11yMonitorOptions`](#setuplivea11ymonitoroptions)
  - [`LiveA11yObserverOptions`](#livea11yobserveroptions)
  - [`LiveA11yVisualSnapshotsOptions`](#livea11yvisualsnapshotsoptions)
- [API](#api)
  - [`cy.checkAccessibility(axeOptions?, commandOptions?)`](#cycheckaccessibilityaxeoptions-commandoptions)
  - [`cy.setLiveA11yAutoSetupOptions(options?)`](#cysetlivea11yautosetupoptionsoptions)
  - [`cy.setLiveA11yAutoReportOptions(options?)`](#cysetlivea11yautoreportoptionsoptions)
  - [`cy.reportLiveA11yResults(options?)`](#cyreportlivea11yresultsoptions)
- [Auto Lifecycle Notes](#auto-lifecycle-notes)
  - [Important note about Cypress runner status](#important-note-about-cypress-runner-status)
  - [Environment Variable Toggles](#env-toggles)
- [Important Guidance: Do Not Mix Scan Modes](#important-guidance-do-not-mix-scan-modes)
- [Practical Flow Examples](#practical-flow-examples)
  - [1) Regular flow: initial + live scans (minimum params, defaults)](#1-regular-flow-initial-live-scans-minimum-params-defaults)
  - [2) Same flow, but custom impact policy (`includedImpacts` + `onlyWarnImpacts`)](#2-same-flow-but-custom-impact-policy-includedimpacts-onlywarnimpacts)
  - [3) One-time checkpoint snapshot after UI stabilizes](#3-one-time-checkpoint-snapshot-after-ui-stabilizes)
  - [4) One-time checkpoint snapshot with custom axe options (`runOnly`, `rules`, impacts)](#4-one-time-checkpoint-snapshot-with-custom-axe-options-runonly-rules-impacts)
  - [5) Multiple checkpoints in one test (different configs, separate reports)](#5-multiple-checkpoints-in-one-test-different-configs-separate-reports)
- [Accessibility reports (JSON and HTML)](#accessibility-reports-json-and-html)
  - [JSON structure (overview)](#json-structure-overview)
  - [HTML layout (overview)](#html-layout-overview)
  - [Incomplete findings](#incomplete-findings)
- [Visual snapshots in HTML reports](#visual-snapshots-in-html-reports)
  - [How this differs from Cypress screenshots](#how-this-differs-from-cypress-screenshots)
  - [Where previews appear](#where-previews-appear)
  - [Why a row says “Unresolved …”](#why-a-row-says-unresolved)
  - [Configuration (`visualSnapshots`)](#configuration-visualsnapshots)
  - [Performance tradeoffs](#performance-tradeoffs)
- [Report naming convention (easy to read)](#report-naming-convention-easy-to-read)
  - [1) Live auto lifecycle reports](#1-live-auto-lifecycle-reports)
  - [2) Checkpoint reports](#2-checkpoint-reports)
  - [3) How to decode each part](#3-how-to-decode-each-part)
  - [4) Important notes](#4-important-notes)
- [Terminal output (CI-friendly)](#terminal-output-ci-friendly)
- [Change Log](#change-log)

---

## Features

What it gives you:

✅**Comprehensive Accessibility Analysis: <u>Leverages axe-core®</u> for thorough accessibility checks.**

  ▪️Axe-core® https://github.com/dequelabs/axe-core is a trademark of Deque Systems, Inc. https://www.deque.com/ in the US and other countries.

✅ **<u>No app instrumentation required</u>: run dynamic, on-the-fly accessibility analysis during normal Cypress tests.**

  ▪️Tracks dynamic UI changes after the initial scan and continues analyzing as the page updates.

  ▪️Default auto lifecycle wires `cy.visit()`, scans, idle waits, strict failure handling, and artifacts—no custom hook boilerplate necessary.

✅ **<u>Works across page navigations</u>: pages visited during the test flow are analyzed as part of the run lifecycle.**

  ▪️ Fewer escaped defects — Issues from navigations, dialogs, drawers, async UI, and SPAs surface in the **same E2E runs** that already gate releases, not only on a one-off static scan.

✅ **Supports both <u>live monitoring</u> and explicit <u>checkpoint scanning</u> (`cy.checkAccessibility(...)`) in the same API.**

  ▪️ Also supporting multiple checkpoints in one test; optional **`checkpointLabel`** (**`string`** for a fixed artifact suffix, or omit it for sequential **`A`**, **`B`**, … per test title within the spec — checkpoint mode only; ignored on live reports)
  
  ▪️By default emits JSON/HTML after each checkpoint.

✅ **<u>Detects repeated accessibility findings</u> on the same DOM nodes across tests in the same spec file and highlights first-seen context in reports, for faster triage.**

✅ **Control <u>relevant accessibility information vs noise</u>.**

  ▪️ Configure Errors vs Warnings by severity level.

  ▪️ Support of the optional axe-core-parameter **`incomplete`** (to flag issues that needs manual review)

✅ **Accessibility <u>analysis summaries</u> are also surfaced in the <u>Cypress Log</u> for fast, in-run feedback.**

  ▪️ Selecting a reported finding in the Cypress command log highlights the related element(s) in the Cypress runner for faster visual debugging.

✅ **<u>Enhanced reporting</u> of accessibility violations.**

  ▪️ Generates paired artifacts (`.json` + `.html`) with scan metadata, impact summaries, and report IDs for traceability.

  ▪️ Optional lightweight visual previews in HTML reports (**_serialized DOM + selected computed styles — not Cypress screenshots_**): initial page overview plus per-node thumbnails, with previews omitted for cross-report repeated findings to save space.

✅ **<u>CI-friendly</u> terminal output and artifacts**.

   ▪️ The Node reporter task prints a summary by severity and a grouped list of violations with affected nodes.

   ▪️Configure your json and html reports as CI/CD artifacts.

✅ **<u>Configuration per-test</u> tuning**

  ▪️ Call **`cy.setLiveA11yAutoSetupOptions(...)`** early in a test to change how the **monitor** behaves for that test only (axe options for initial/live scans, observer settings, whether the run is active).

  ▪️ Call **`cy.setLiveA11yAutoReportOptions(...)`** to change how the **next report** is built (validation, **`includeIncompleteInReport`**, **`generateReports`**, checkpoint label, etc.). Both are **cleared after each test** so later tests do not inherit them.

✅ **<u>Built-in validation controls</u> (for example included-impact failure, minimum live scans, runtime error checks).**


## Import / Setup

1. Load the plugin commands in your Cypress support file:

```js
// Installed package (recommended for consumers)
import "wick-a11y-observer";
```

**This import automatically registers auto lifecycle hooks (no extra call required).**

2. Register the Node-side reporter task in `cypress.config.js`:

```js
const { defineConfig } = require("cypress");
const {
  registerLiveA11yReporterTasks,
} = require("wick-a11y-observer/reporter");

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

3. Enable accessibility analysis

Set the environment variable **`LIVE_A11Y_RUN`** to `true`. By default is disabled.

For example in **`cypress.config.js`** (`env: { LIVE_A11Y_RUN: true }`), **`cypress.env.json`**, or **`npx cypress run --env LIVE_A11Y_RUN=true`**.

---

## Public Command Index

Only the following commands are part of the **public** plugin API:

- `cy.checkAccessibility(axeOptions?, commandOptions?)`
- `cy.setLiveA11yAutoSetupOptions(options?)`
- `cy.setLiveA11yAutoReportOptions(options?)`
- `cy.reportLiveA11yResults(options?)`

> The plugin import still registers **non-public** Cypress commands (for example **`cy.runInitialLiveA11yScan`** for manual setups, monitor setup, idle waits). Those are **not** part of this public surface, are **not** declared on **`Chainable`** in the published typings, and may change without a semver guarantee.

---

## Shared Option Types

| Layer                     | Question it answers                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Axe**                   | “What accessibility issues are on the page?”                                                                                                                                                            |
| **Structural validation** | “Is the **report** itself plausible?” — e.g. did we record an initial scan? Enough **live** (DOM-driven) scans? Any monitor errors? Optionally: should “failing” grouped findings also fail validation? |

### `LiveA11yRunOptions` (axe-core run options) - very common

All fields are optional.

- `resultTypes?: ("violations" | "passes" | "incomplete" | "inapplicable")[]`
- `iframes?: boolean`
- `includedImpacts?: ("critical" | "serious" | "moderate" | "minor")[]`
- `onlyWarnImpacts?: ("critical" | "serious" | "moderate" | "minor")[]` — impacts treated as warnings (disposition **warn**) under the plugin’s policy
- `impactLevels?: ("critical" | "serious" | "moderate" | "minor")[]`
- `runOnly?: { type?: string; values?: string[] }`
- `rules?: Record<string, unknown>`
- additional unknown fields are allowed/passed through

#### Default scan profile

- `resultTypes: ["violations", "incomplete"]`
- `iframes: true`
- `includedImpacts: ["critical", "serious"]`
- `runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }`

### `ReportLiveA11yResultsOptions` - common

Used by `cy.setLiveA11yAutoReportOptions(...)`, `cy.reportLiveA11yResults(...)`, and (when `emitReport` is true) the object passed as `checkAccessibility(..., { report: ... })`. Fields are merged with command defaults and auto-lifecycle defaults where applicable.

| Property                       | Meaning                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `outputPath?`                  | Custom output path/filename for the JSON report (HTML follows same base name unless configured otherwise on the Node task).                                                                                                                                                    |
| `checkpointLabel?`             | **`string`**: fixed suffix for checkpoint artifacts (e.g. `"A"` → `-checkpoint-A`). **Omitted** (or empty after trim): sequential labels **`A`**, **`B`**, … per test title within the spec (**checkpoint** scan mode only — values are **ignored** when the active store is a **live** report). **`true`** / **`"auto"`** are equivalent to omitting (sequential labels).                     |
| `validation?`                  | Structural validation — **[`ReportLiveA11yValidationOptions`](#reportlivea11yvalidationoptions-structural-validation)** (mental model, defaults, examples, field table).                                                                                                                                                     |
| `throwOnValidationFailure?`    | Default **`true`** for direct `reportLiveA11yResults`; **`false`** for auto `afterEach` and for the default chain after `checkAccessibility`.                                                                                                                                  |
| `includeIncompleteInReport?`   | When **`true`**, includes axe **`incomplete`** in counts and report body.                                                                                                                                                                                                      |
| `generateReports?`             | When **`false`**, skips writing JSON/HTML files (logging may still run). After `checkAccessibility`, the default emitted call forces **`true`** unless you override via `report.generateReports` or an explicit `false` in merged runtime options (see merge order below).     |
| `suppressEndOfTestAutoReport?` | When **`true`**, the auto **`afterEach`** report is skipped for this test. **`checkAccessibility`** sets this on its emitted report so you do not get a duplicate end-of-test artifact. You rarely need to set this yourself unless you call `reportLiveA11yResults` manually. |

### `ReportLiveA11yValidationOptions` (structural validation) - less common

These options control **structural validation**: an extra pass **after** axe runs that inspects the **report object** (counts, scan history, monitor errors, grouped findings). They apply when you pass **`validation`** through **`cy.setLiveA11yAutoReportOptions`**, **`cy.reportLiveA11yResults`**, or the auto **`afterEach`** path (which calls **`reportLiveA11yResults`**).

> Structural validation does **not** change how axe rules run.

#### Defaults: checkpoint vs end-of-test

| Situation                                                      | What most people want                               | Default structural validation                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`cy.checkAccessibility`** with **`emitReport: true`**        | JSON/HTML for this moment in the test; axe outcomes | **Off** — the command starts merge at **`enabled: false`**. Spec **Tests 5–7** in **`cypress/e2e/live-a11y-auto-lifecycle.cy.js`** follow this; they do **not** pass **`report.validation`**. |
| **`cy.reportLiveA11yResults`** with no **`validation`** object | Same checks as a normal CLI-friendly summary        | **On** — **`enabled`** defaults to **`true`** with the field defaults in the table below.                                                                                                     |
| Auto **`afterEach`** live report                               | Confidence the monitor ran end-to-end               | Same as **`reportLiveA11yResults`** merge, unless **`setLiveA11yAutoReportOptions`** overrides it.                                                                                            |

> You still need **`validation: { enabled: false }`** yourself when you call **`cy.reportLiveA11yResults`** directly on **checkpoint-shaped** data (store cleared / few live scans), because that command’s **default** is **`enabled: true`**. You may also need it if **`setLiveA11yAutoReportOptions`** turned validation **on** and you want one emission without it.

#### Examples

**1. Checkpoint only (common)** — structural validation stays off; nothing to add:

```js
cy.checkAccessibility({
  includedImpacts: ["critical", "serious"],
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "best-practice"] },
});
```

**2. Scan now, report manually (more advance)** — turn structural validation off so lifecycle rules do not fight an empty live queue:

```js
cy.checkAccessibility(axeOpts, { emitReport: false });
cy.reportLiveA11yResults({
  checkpointLabel: "after-modal",
  validation: { enabled: false },
});
```

**3. Structural validation on a checkpoint file (rare)** — opt in and relax live-scan expectations (otherwise **`minLiveScans: 1`** often fails because **`checkAccessibility`** clears **`store.live`** right before the checkpoint scan):

```js
cy.checkAccessibility(axeOpts, {
  report: {
    validation: {
      enabled: true,
      minLiveScans: 0,
      requireInitialScan: true,
      failOnIncludedImpacts: true, // set false if you only want “report shape” checks, not fail-on-violations
    },
  },
});
```

**4. End-of-test live test** — usually **no** `validation` block; defaults apply when the auto lifecycle emits **`reportLiveA11yResults`** from **`afterEach`**.

#### Reference: fields

If **`enabled`** is **`false`**, the rest are ignored. If validation runs (**`enabled: true`** or omitted on **`reportLiveA11yResults`** where the merge default is on), missing keys use the defaults here.

| Property                 | Default                                                                   | Meaning (human)                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                | **`true`** for **`reportLiveA11yResults`** when you omit **`validation`** | **`false`** = skip every row below. **`checkAccessibility`** chained report starts from **`false`** before merging **`setLiveA11yAutoReportOptions`** / **`report.validation`**.                                                                                              |
| `requireInitialScan`     | `true`                                                                    | Report must show at least one initial full-page scan.                                                                                                                                                                                                                         |
| `minLiveScans`           | `1`                                                                       | Report must include at least this many **live** DOM-driven scans. Checkpoint emissions often need **`0`** if you turned **`enabled`** on (see example 3).                                                                                                                     |
| `requireNoRuntimeErrors` | `true`                                                                    | **`errors`** on the report must be empty (no monitor/runtime faults).                                                                                                                                                                                                         |
| `minUniqueLiveRuleIds`   | `0`                                                                       | At least this many **different** axe rule IDs among violations from **live** scans only.                                                                                                                                                                                      |
| `requiredLiveRuleIds`    | `[]`                                                                      | Each ID listed must appear as a violation on at least one **live** scan.                                                                                                                                                                                                      |
| `minGroupedBySeverity`   | `{}`                                                                      | Per severity, minimum count in **`counts.groupedBySeverity`**; only keys you list are checked.                                                                                                                                                                                |
| `failOnIncludedImpacts`  | `true`                                                                    | If **`true`**, any grouped finding with disposition **fail** adds a validation error (separate from axe listing issues in JSON/HTML). If **`false`**, those do not add validation errors; HTML summary **PASS/FAIL** may still reflect grouped fails — see terminal vs badge. |

The HTML/JSON summary **status badge** can still show **FAIL** when grouped failing impacts exist; turning structural validation off does not always clear that badge.

### `CheckAccessibilityCommandOptions` - rarely common

Second argument to `cy.checkAccessibility(axeOptions, commandOptions?)`. Unspecified fields use the defaults in the right-hand column.

| Property                | Default                             | Meaning                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waitForIdleBeforeScan` | `true`                              | Wait for monitor idle before running the checkpoint scan (reduces flaky one-off scans).                                                                                                                                                            |
| `waitForIdleOptions`    | `{ quietMs: 500, timeoutMs: 8000 }` | Passed to `cy.waitForLiveA11yIdle` when `waitForIdleBeforeScan` is true.                                                                                                                                                                           |
| `emitReport`            | `true`                              | When **`true`**, runs **`cy.reportLiveA11yResults`** after the scan (checkpoint artifacts + logs). When **`false`**, scan only — call **`reportLiveA11yResults`** yourself if you need files.                                                      |
| `checkpointLabel`       | _(none)_                            | **Shorthand** for `report.checkpointLabel` when `emitReport` is true. Same rules as **[`ReportLiveA11yResultsOptions`](#reportlivea11yresultsoptions)**: fixed **`string`** suffix, or omit for sequential **`A`**, **`B`**, … Ignored if `report.checkpointLabel` is already set. |
| `report`                | `{}`                                | Extra options forwarded to **`cy.reportLiveA11yResults`** (same shape as **[`ReportLiveA11yResultsOptions`](#reportlivea11yresultsoptions)**). Wins over overlapping keys from **`cy.setLiveA11yAutoReportOptions`** for that emission.                                             |

**Merge order for the report emitted by `checkAccessibility`**

1. **`cy.setLiveA11yAutoReportOptions`** (this test only).
2. **`commandOptions.report`** (this call wins on overlaps).
3. Command defaults: **`generateReports: true`**, **`throwOnValidationFailure: false`**, **`suppressEndOfTestAutoReport: true`**, and **`validation`** starting at **`{ enabled: false }`**, then overlaid by (1) and (2). So you can turn structural validation **on** for one checkpoint via **`report: { validation: { enabled: true, … } }`** — see examples under **[`ReportLiveA11yValidationOptions`](#reportlivea11yvalidationoptions-structural-validation)**.

### `SetupLiveA11yMonitorOptions`

Passed to **`cy.setLiveA11yAutoSetupOptions(...)`**. Combines axe profiles for navigation-driven scans, observer tuning, optional HTML visual previews, and reporting/accessibility toggles for that test.

| Field | Type / notes |
| ----- | --------------------------------------------- |
| **`initialAxeOptions`** | **[`LiveA11yRunOptions`](#livea11yrunoptions-axe-core-run-options)** for the **first full-page axe scan** after each navigation. **If you omit it**, the plugin uses the same **[built-in default scan profile](#default-scan-profile)** (tags, impacts, `iframes`, `resultTypes`). If you pass only some fields, those override that baseline; the rest stay default. |
| **`liveAxeOptions`** | **[`LiveA11yRunOptions`](#livea11yrunoptions-axe-core-run-options)** for **later live scans** when the DOM changes. **If you omit it**, you get that **same built-in default profile**—but merged **separately** from `initialAxeOptions`. Changing one does **not** automatically change the other. |
| **`observerOptions`** | **[`LiveA11yObserverOptions`](#livea11yobserveroptions)** — queue, idle, fallback scans, etc. |
| **`visualSnapshots`** | **[`LiveA11yVisualSnapshotsOptions`](#livea11yvisualsnapshotsoptions)** — shorthand for `observerOptions.visualSnapshots` (top-level wins if both are set). |
| **`includeIncompleteInReport`** | Optional boolean. **`true`** → include axe **`incomplete`** rows in report counts and detail. **`false`** → leave them out of the emitted report body. If you omit it here, **`LIVE_A11Y_INCLUDE_INCOMPLETE`** (env) and **`cy.setLiveA11yAutoReportOptions`** can still apply—see **[Environment Variable Toggles](#env-toggles)**. |
| **`generateReports`** | Optional boolean. **`false`** → skip writing JSON/HTML files when the auto report path runs (terminal/log output may still appear). **`true`** → allow artifacts. If omitted, env **`LIVE_A11Y_GENERATE_REPORTS`** applies when set; otherwise defaults to **`true`** — see **[Environment Variable Toggles](#env-toggles)**. |
| **`runAccessibility`** | Optional boolean. **`true`** → run live a11y for this test even if **`LIVE_A11Y_RUN`** is off. **`false`** → skip it (no monitor install from this plugin, **`cy.checkAccessibility`** becomes a no-op, auto **`afterEach`** report skipped)—same idea as turning accessibility off for that test. |
| **`skipAccessibility`** | Optional boolean. **`true`** → skip live a11y for this test. **`false`** → do not force a skip by this flag alone (env / other options still apply). Inverse wording of **`runAccessibility`**, not a second independent feature. |

> **`runAccessibility` and `skipAccessibility`:** They are **not** meant to be used together on the **same** options object. Pick **one** (or neither and rely on **`LIVE_A11Y_RUN`**). If both keys are set on the **same** object with boolean values, the plugin evaluates **`runAccessibility` first** and **ignores `skipAccessibility` on that object**.

Full shape: **`a11y-observer-commands.d.ts`**.

### `LiveA11yObserverOptions`

DOM monitor behavior (debounce/idle, queue size, fallback full-page scans, selectors, …). Typings are based on **`LiveA11yMonitorOptions`** without the nested **`initialAxeOptions`** / **`liveAxeOptions`** keys — see **`a11y-observer-commands.d.ts`**.

### `LiveA11yVisualSnapshotsOptions`

Lightweight serialized DOM + computed-style previews in HTML reports. Behavior, limits, and tradeoffs: **[Configuration (`visualSnapshots`)](#configuration-visualsnapshots)**.

---

## API

### `cy.checkAccessibility(axeOptions?, commandOptions?)`

Runs a one-time **checkpoint** full-page axe scan on the current page: clears accumulated **live** findings and prior checkpoint **page visuals**, syncs scan policy from `axeOptions`, then runs **`runInitialFullPageScan`**. Does **not** arm extra live monitoring by itself.

When live a11y is **skipped**—same conditions as **`LIVE_A11Y_RUN=false`** / unset (or **`skipAccessibility: true`**) unless overridden for that test by **`cy.setLiveA11yAutoSetupOptions({ runAccessibility: true })`**—this command **does nothing**: no idle wait, no scan, no report. It resolves to **`null`** and logs **CHECK ACCESSIBILITY SKIPPED** in the Cypress command log.

#### Parameters

- **`axeOptions`** (optional): **[`LiveA11yRunOptions`](#livea11yrunoptions-axe-core-run-options)** — passed to `axe.run` for this scan; omitted → monitor’s configured **`initialAxeOptions`**.
- **`commandOptions`** (optional): **[`CheckAccessibilityCommandOptions`](#checkaccessibilitycommandoptions)** — field table under **Shared Option Types**.

##### `checkpointLabel` (quick reference)

Use a **string** when you want a **fixed** suffix; **omit** the field when you want **automatic** **`A`**, **`B`**, … per test (checkpoint emissions only — live **`afterEach`** reports ignore this option):

```js
// Fixed label (filename contains -checkpoint-A)
cy.checkAccessibility(axeOpts, { checkpointLabel: "A" });

// Sequential labels for this test: first checkpoint 1, second 2, … (default when omitted)
cy.checkAccessibility(axeOpts1);
cy.checkAccessibility(axeOpts2);

// Same options under report:
cy.checkAccessibility(axeOpts, { report: { checkpointLabel: "after-login" } });
```

#### Returns

- When live a11y is **skipped** (**`LIVE_A11Y_RUN`** off / **`skipAccessibility`**, unless **`runAccessibility`** overrides): **`Chainable<null>`** — checkpoint behavior is disabled.
- When **`emitReport`** is **`false`** (and live a11y is active): **`Chainable<null>`** (scan only).
- When **`emitReport`** is **`true`** (default) and live a11y is active: **`Chainable<object>`** — the same object **`cy.reportLiveA11yResults`** resolves to (built by the Node task **`liveA11y:buildReport`**). Highlights you can use in a **`cy.then`**:

  | Field                             | Role                                                                                                                               |
  | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
  | **`savedTo`** / **`savedHtmlTo`** | Paths to the **`.json`** / **`.html`** files when writes ran (`undefined` if skipped).                                             |
  | **`validation`**                  | **`valid`**, **`errors`**, and a summary **`status`** (**PASS** / **FAIL**) combining structural checks + grouped failing impacts. |
  | **`counts`**                      | Numbers for initial vs live scans, violations, grouped severity/disposition, optional incomplete tallies.                          |
  | **`groupedViolations`**           | Per-rule cards with **`nodeDetails`**, **`disposition`** (**fail** / **warn** / **incomplete**), **`uniqueNodeCount`**.            |
  | **`reportArtifact`**              | **`reportId`**, **`scanType`**, **`checkpointLabel`**, spec/test labels for filenames and traceability.                            |
  | **`raw`**                         | Monitor store snapshot (initial axe payload, **`live`** scans, **`errors`**, **`meta`** / analysis options).                       |
  | **`summary`**                     | Identity + technical metrics (mirrors HTML header).                                                                                |

  Full shape: **`LiveA11yReport`** (+ task-added **`savedTo`** / **`savedHtmlTo`**) in **`a11y-observer-commands.d.ts`**. See **[Accessibility reports (JSON and HTML)](#accessibility-reports-json-and-html)**.

#### Examples

**Scan + default report** (waits for idle, writes artifacts unless disabled in `report` / env, suppresses duplicate **`afterEach`** report):

```js
cy.checkAccessibility({
  includedImpacts: ["critical", "serious", "moderate", "minor"],
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
  },
});
```

**Scan only** (legacy / custom reporting):

```js
cy.checkAccessibility(axeOpts, { emitReport: false });
cy.reportLiveA11yResults({
  checkpointLabel: "manual",
  validation: { enabled: false },
});
```

#### Behavior notes

**Live monitoring**

- After **`cy.visit`**, the default auto lifecycle still runs an initial scan and arms the DOM observer (`armAfter: true`). That happens **before** any **`checkAccessibility`** call.
- The plugin does **not** disable live scans just because you plan a checkpoint later (compare Test 1 vs Test 5 in the sample spec).
- **`checkAccessibility`** clears prior **live** scan entries on the store, then runs its full-page checkpoint scan. The checkpoint report is based on that step—not on “checkpoint mode” from page load.

**Checkpoint-heavy runs (what you can configure today)**

- **Default npm import** (`import "wick-a11y-observer"`): the package loads **`registerLiveA11yAutoLifecycle()`** once with **built-in defaults**. Every navigation still runs an **initial full-page scan**, then **`armAfter: true`** arms live DOM scans. There is **no env flag** to skip the initial scan or live arming on that path.
- **Turn off live DOM rescans** (initial scan on navigation **still runs**): the lifecycle API is **`registerLiveA11yAutoLifecycle({ initialScan: { commandOptions: { armAfter: false } } })`**. The stock **`import "wick-a11y-observer"`** already ran **`registerLiveA11yAutoLifecycle()`** with defaults at module load, so npm consumers **cannot** inject this from support/config alone—only a **fork/local patch** that replaces that single registration. Example shape when you control the call site:

```js
registerLiveA11yAutoLifecycle({
  initialScan: {
    commandOptions: { armAfter: false },
  },
});
```

- **Skip the navigation initial scan**: **not supported** by current options — the load handler always calls **`runInitialFullPageScan`** before **`armAfter`**.
- **Practical recommendation for “only care about `checkAccessibility` reports”**: keep the default import; call **`cy.checkAccessibility()`** where it matters (it clears **`store.live`** then runs its own full-page scan and emits JSON/HTML). Use **`emitReport: false`** + manual **`reportLiveA11yResults`** only if you need different timing. Tune **`afterEach`** / **`setLiveA11yAutoReportOptions`** (for example **`validation.minLiveScans`**) if an end-of-test artifact still runs and clashes with checkpoint-shaped data.

**Structural validation**

- The default report chained from **`checkAccessibility`** starts with structural validation **off**, then merges **`setLiveA11yAutoReportOptions`** / **`report.validation`**. Details: **[`ReportLiveA11yValidationOptions`](#reportlivea11yvalidationoptions-structural-validation)**.
- End-of-test reports from auto **`afterEach`** use stricter **`reportLiveA11yResults`** defaults unless you override them.

**Artifacts**

- Unless you set **`report.generateReports: false`** on this call, the default emission writes JSON/HTML even if **`setLiveA11yAutoReportOptions`** had **`generateReports: false`**.

**Report metadata**

- **`axeOptions`** from the checkpoint (impacts, **`runOnly`**, etc.) are stored on the monitor so HTML **Analysis options** match this scan.

---

### `cy.setLiveA11yAutoSetupOptions(options?)`

Sets runtime setup/observer options for the auto lifecycle in the current test.

#### Parameters

- `options` (optional): **[`SetupLiveA11yMonitorOptions`](#setuplivea11ymonitoroptions)**
  - `initialAxeOptions?:` **[`LiveA11yRunOptions`](#livea11yrunoptions-axe-core-run-options)** — initial full-page scan after navigation.
  - `liveAxeOptions?:` **[`LiveA11yRunOptions`](#livea11yrunoptions-axe-core-run-options)** — follow-up live scans triggered by DOM changes.
  - `observerOptions?:` **[`LiveA11yObserverOptions`](#livea11yobserveroptions)** — monitor behavior (queue size, fallback scanning, debounce/idle, …).
  - `visualSnapshots?:` **[`LiveA11yVisualSnapshotsOptions`](#livea11yvisualsnapshotsoptions)** — HTML report DOM previews (can also live under `observerOptions.visualSnapshots`; top-level wins when both are set).
  - `includeIncompleteInReport?: boolean` — see **[`SetupLiveA11yMonitorOptions`](#setuplivea11ymonitoroptions)** table (**`includeIncompleteInReport`** row).
  - `generateReports?: boolean` — same table (**`generateReports`** row).
  - `runAccessibility?: boolean` / `skipAccessibility?: boolean` — same table (**`runAccessibility`** / **`skipAccessibility`** rows and the note below the table).

#### Returns

- `Chainable<void>`

#### Example

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

### `cy.setLiveA11yAutoReportOptions(options?)`

Sets runtime report options for the auto lifecycle in the current test.

#### Parameters

- `options` (optional): **[`ReportLiveA11yResultsOptions`](#reportlivea11yresultsoptions)** — full field table under **Shared Option Types** (`checkpointLabel`, `validation`, `suppressEndOfTestAutoReport`, etc.).

#### Returns

- `Chainable<void>`

#### Example

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

### `cy.reportLiveA11yResults(options?)`

Writes the monitor store to JSON/HTML (unless disabled), runs validation, updates strict-mode data, and logs summaries.

- **`cy.checkAccessibility()`** calls this for you when **`emitReport`** is **`true`** (default).
- Call it yourself for custom timing, extra emissions, or after **`emitReport: false`**.
- Auto **`afterEach`** calls it when this test did not already emit a report (no **`checkAccessibility`** emission with **`suppressEndOfTestAutoReport`**).

#### Parameters

- `options` (optional): **[`ReportLiveA11yResultsOptions`](#reportlivea11yresultsoptions)** — full field reference is the table under **Shared Option Types**. Highlights:
  - **`checkpointLabel`**: non-empty **string** for a fixed suffix; **omitted** → sequential **`A`**, **`B`**, … (**checkpoint** mode only; ignored for **live** reports).
  - **`validation`**: **[`ReportLiveA11yValidationOptions`](#reportlivea11yvalidationoptions-structural-validation)** — structural checks on the built report (defaults differ for **`reportLiveA11yResults`** vs checkpoint emissions; see that section).
  - **`throwOnValidationFailure`**: default **`true`** here; auto **`afterEach`** and the default chain after **`checkAccessibility`** use **`false`** so failures aggregate at suite level instead of throwing inside the hook.
  - **`suppressEndOfTestAutoReport`**: skip duplicate **`afterEach`** artifact when you already emitted from **`checkAccessibility`** or explicit checkpoints.

#### Returns

- `Chainable<object>`: Resolves to the report payload (includes `validation`, `counts`, paths, and so on).

#### Example

```js
cy.reportLiveA11yResults({
  checkpointLabel: "after-login",
  validation: {
    enabled: true,
    minLiveScans: 0,
    failOnIncludedImpacts: true,
  },
});
```

---

## Auto Lifecycle Notes

- Importing **`wick-a11y-observer`** registers lifecycle hooks (no extra call).
- Per test, tune behavior with **`cy.setLiveA11yAutoSetupOptions`** / **`cy.setLiveA11yAutoReportOptions`**.
- Default **`cy.checkAccessibility()`** emits a report and sets **`suppressEndOfTestAutoReport`** so **`afterEach`** does not write a second file for that test.
- Use **`emitReport: false`** on **`checkAccessibility`** if you only want the scan and will report from **`afterEach`** or **`reportLiveA11yResults`** yourself.

### Important note about Cypress runner status

Commands can look **green** in the log even when the plugin recorded a11y failures.

- Failures are often finalized in **`afterEach`** / suite **`after`** (strict mode), not on each **`cy.*`** line.
- You still get JSON/HTML and logs; the run may fail at the end so artifacts stay complete.

That is intentional.

<a id="env-toggles"></a>

### Environment Variable Toggles

These variables are read through **`Cypress.env`** / **`cy.env()`**.

| Variable | Purpose | Default | `true` / truthy | `false` / falsy |
| -------- | ------- | --------- | ---------------- | ---------------- |
| **`LIVE_A11Y_RUN`** | Master switch for **running** live a11y **and** **`cy.checkAccessibility()`** checkpoints. | **`false`** / omitted (accessibility analysis skipped). | Enables monitor install, live scanning pipeline, and **`cy.checkAccessibility`**. | Disables live a11y and **`cy.checkAccessibility`** scans entirely. Logs **CHECK ACCESSIBILITY SKIPPED** in the Cypress log. |
| **`LIVE_A11Y_GENERATE_REPORTS`** | Whether to **write** JSON/HTML artifacts (still subject to other report options). | **`true`** (reports **are** written by default). | Write reports when the reporting path runs. | Skip writing files from the reporter path (useful for fast local runs or CI that only needs logs). |
| **`LIVE_A11Y_INCLUDE_INCOMPLETE`** | Whether axe-core **incomplete** violations findings appear in emitted reports/HTML. | **`false`** (omit incomplete groups by default). | Include axe-core incomplete violations in the outputs. | Omit them from the outputs. |

Per-test **`cy.setLiveA11yAutoSetupOptions`** / **`cy.setLiveA11yAutoReportOptions`** can override **`runAccessibility`**, **`generateReports`**, and **`includeIncompleteInReport`** for that test only (see **Shared Option Types**).

> 👉 **`cy.visit` is overwritten once by the plugin**: it merges an **`onBeforeLoad`** hook so the live monitor can attach **before** your app scripts run. **`LIVE_A11Y_RUN`** (and per-test **`runAccessibility`** / **`skipAccessibility`** on setup options) decides whether that path runs:

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

Notes: needs **`LIVE_A11Y_RUN=true`**; default initial + live scans after **`cy.visit`**.

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

Notes: **`cy.setLiveA11yAutoSetupOptions({ runAccessibility })`** overrides **`LIVE_A11Y_RUN`** for that test.

### 3) One-time checkpoint snapshot after UI stabilizes

```js
it("captures a one-time checkpoint after stabilization", () => {
  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="app-ready"]').should("be.visible");

  cy.checkAccessibility();
});
```

Notes: needs **`LIVE_A11Y_RUN=true`**; waits for idle by default; default **`emitReport`** writes JSON/HTML and skips duplicate **`afterEach`** report for this test.

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

Notes: checkpoint **`axeOptions`** apply only to this call (live scans still use **`liveAxeOptions`** from setup). Default report emission; **`emitReport: false`** for scan-only.

### 5) Multiple checkpoints in one test (different configs, separate reports)

```js
it("captures checkpoint A and B in the same test", () => {
  // Optional per-test report tweaks; checkAccessibility already defaults validation.enabled to false.
  cy.setLiveA11yAutoReportOptions({
    includeIncompleteInReport: true,
  });

  cy.visit("/live-a11y-playground");
  cy.get('[data-cy="app-ready"]').should("be.visible");
  cy.get('[data-cy="inject-second-only-issues"]').click();
  cy.get('[data-cy="second-only-issues-panel"]').should("be.visible");
  cy.get('[data-cy="reveal-existing-issues"]').click();
  cy.get('[data-cy="existing-issues-panel"]').should("be.visible");

  // Checkpoint A — scan + report in one command
  cy.checkAccessibility(
    {
      iframes: true,
      includedImpacts: ["critical", "serious"],
      onlyWarnImpacts: ["moderate", "minor"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
      rules: { "color-contrast": { enabled: true } },
    },
    { checkpointLabel: "A" },
  );

  // Checkpoint B
  cy.checkAccessibility(
    {
      iframes: true,
      includedImpacts: ["critical"],
      onlyWarnImpacts: ["serious", "moderate"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
      rules: { "color-contrast": { enabled: false } },
    },
    { checkpointLabel: "B" },
  );
});
```

Notes: two default emissions ⇒ two artifact pairs; **`checkpointLabel`** adds **`-checkpoint-<LABEL>`** to names; **`afterEach`** report suppressed so you do not get a third file. Structural **`validation`** defaults for checkpoints: **[`ReportLiveA11yValidationOptions`](#reportlivea11yvalidationoptions-structural-validation)**.

## Accessibility reports (JSON and HTML)

Each successful build writes a **matching pair**: **`.json`** (data) + **`.html`** (readable UI), same basename, under **`accessibilityFolder`** (see **Report naming convention**). Skipped when **`generateReports: false`** or the Node task does not write files.

### JSON structure (overview)

The **`.json`** file is the payload returned on **`cy.checkAccessibility`** / **`cy.reportLiveA11yResults`** (TypeScript **`LiveA11yReport`** plus **`savedTo`** / **`savedHtmlTo`**).

| Block                   | Purpose                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`reportArtifact`**    | Identity: **`reportId`**, spec/test labels, **`scanType`** (`live` \| `checkpoint`), **`checkpointLabel`**, paths.                                                              |
| **`counts`**            | Scan tallies, violations vs incomplete, grouped severity and **fail** / **warn** / **incomplete** disposition.                                                                  |
| **`groupedViolations`** | One entry per axe **rule** (merged across scans): **`uniqueNodeCount`**, **`nodeDetails`** (per-element rows), **`disposition`**, metadata linking back to **`rawViolations`**. |
| **`raw`**               | Underlying store: latest **initial** axe result, **`live`** scan history, monitor **`errors`**, **`meta`** (URLs, analysis / scan options).                                     |
| **`validation`**        | Structural validation outcome (**`valid`**, **`errors`**) plus summary **`status`** used with grouped findings.                                                                 |
| **`summary`**           | Compact header block (identity + technical metrics) shared with HTML/terminal.                                                                                                  |

Grouped cards: **unique node(s)** = distinct DOM targets (selector + page) for that rule; table rows match that count. JSON rows can include **`initialDetections`** / **`liveDetections`** (and related fields) when both phases contributed.

### HTML layout (overview)

Open the **`.html`** in any browser (no Cypress). Top sections match **`report.summary`** in JSON (identity, analysis mirror, technical metrics).

1. **Title & intro** — Document heading and short subtitle (“violations and optional incomplete…”).
2. **Report identity** — Validation status badge (**PASS** / **FAIL** / …) and a table: **`reportId`**, spec file, Cypress test title, **test in suite**, local generation time, JSON path (and related identity fields from the reporter).
3. **Analysis options** — Effective axe policy for this artifact: **scan mode** (live vs checkpoint), **rule tags**, impacts that **fail** vs **warn only**, whether **incomplete** is included in the report body.
4. **Technical metrics** — **Technical Metrics** heading with a grid of scan/run statistics (for example initial vs live scans, violation counts, dropped scans, monitor errors, duplicated findings vs earlier reports in the spec). The first rows stay visible; additional rows sit behind **Show more technical metrics**. Each metric is a **`<details>`** cell—expand for a plain-language description and related metrics (same data as **`summary.technicalMetrics`** / **`metricHelp`** in JSON when present).
5. **Jump to page overview (optional)** — When visual snapshots are enabled and a full-page overview is available, a **Go to page visual overview (at end of report)** link appears **above** the severity blocks so you can skip straight to the snapshot section (anchors **`#page-visual-full`**, **`#page-visual-full-1`**, … — see **Visual snapshots**).
6. **Findings by severity** — **By severity** heading, severity **pills** (deep-link into sections), then rule **cards**: impact badge, axe help links, **unique node(s)**, table of selector / optional **Visual snapshot** thumbnail / help, HTML, and scan context.
7. **Incomplete** (optional) — When **`includeIncompleteInReport`** is enabled, **incomplete** items appear inside the severity layout with **manual review** labeling; disposition follows your impact policy.
8. **Page visual overview** — Near the **end of `<main>`** (before the short footer): one **Page visual overview** block per stored initial full-page scan (URL line + serialized DOM preview with dashed highlights — **not** a Cypress screenshot). Checkpoint reports only carry overviews from that checkpoint’s scan. Full detail: **[Visual snapshots in HTML reports](#visual-snapshots-in-html-reports)**.
9. **Footer** — Brief “generated for review” note plus static disclaimer text.

### Incomplete findings

Axe **`incomplete`** means automation could not fully decide pass/fail. They are **excluded** from default reporting unless you opt in (**`LIVE_A11Y_INCLUDE_INCOMPLETE`**, **`setLiveA11yAutoReportOptions`**, or per-emission **`includeIncompleteInReport`**). Treat them as **review queues**, not automatic production blockers unless your policy maps them to **fail**.

## Visual snapshots in HTML reports

HTML reports can include **approximate visual previews** built from a **small serialized DOM subtree** and a **whitelist of computed CSS properties** converted to inline styles. This is **not** a bitmap screenshot: the plugin never calls Cypress screenshot APIs, so capture stays cheap enough to run during rapid live scans.

### How this differs from Cypress screenshots

- **No `cy.screenshot()`** — previews are reconstructed in the standalone HTML via embedded JSON and a tiny inline script.
- **Fast path** — work runs synchronously after each axe pass with strict caps (max nodes per scan, subtree depth, text length).
- **Approximate** — complex layout (fonts, transforms, images, shadow DOM, cross-origin iframes) may differ from what users see in a browser.

### Where previews appear

- **Page overview** — End of the HTML: dashed boxes on affected nodes from the **latest stored initial/full-page scan** (checkpoint **`checkAccessibility`** refreshes that baseline). Anchors **`#page-visual-full`**, **`#page-visual-full-1`**, … per URL round.
- **Per violation row** — Small **Visual snapshot** thumbnail; click opens a dialog with serialized subtree (approximate layout, not **`cy.screenshot`**).
- **Repeated nodes** — Preview omitted when **`repeatedFromEarlierReport`** (smaller artifacts).

Previews use **`contain`** clipping and tame **`position: fixed` / `z-index`** so overlays do not cover the report.

### Why a row says “Unresolved …”

Snapshot capture must **resolve axe’s `target` selector chain** in the live DOM. Common reasons resolution fails:

- **Cross-origin or tightly sandboxed iframe** — `contentDocument` is not available, so nodes inside the frame cannot be serialized (`unresolved-cross-origin-or-sandboxed-iframe`).
- **Closed shadow roots** or **selectors that no longer match** after the scan (timing / DOM churn).
- **Invalid selector segments** in the chain.

Hover or inspect the short message in the report for the machine-readable code (also stored on `visualSnapshot.err` in JSON).

### Configuration (`visualSnapshots`) - only for advance configuration

Pass options via `cy.setupLiveA11yMonitor({ ... })`, `cy.setupCoreLiveA11yMonitor({ ... })`, or `cy.setLiveA11yAutoSetupOptions({ observerOptions: { visualSnapshots: ... }, ... })`.

All fields are optional; defaults enable snapshots with conservative limits.

| Option                             | Default           | Purpose                                                                                         |
| ---------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `enabled`                          | `true`            | Master switch for capture and HTML mounts.                                                      |
| `maxNodesPerScan`                  | `48`              | Cap axe nodes receiving element snapshots per scan (initial, live, fallback, pre-navigation).   |
| `pageOverview.enabled`             | `true`            | Capture `body` (or `pageOverview.rootSelector`) after the initial full-page scan.               |
| `pageOverview.maxDepth`            | `5`               | Max DOM depth for the page overview.                                                            |
| `pageOverview.maxNodes`            | `450`             | Max nodes serialized for the overview.                                                          |
| `pageOverview.maxTextChars`        | `72`              | Max characters per text node in the overview.                                                   |
| `pageOverview.rootSelector`        | `"body"`          | Root element for the overview.                                                                  |
| `element.enabled`                  | `true`            | Per-violation element subtree snapshots.                                                        |
| `element.maxDepth`                 | `8`               | Max depth for each affected element (within the contextual subtree).                            |
| `element.maxNodes`                 | `160`             | Max nodes per element subtree (includes wrapper context).                                       |
| `element.maxTextChars`             | `120`             | Max characters per text node in element previews.                                               |
| `element.preferSemanticContainer`  | `true`            | Use `Element.closest(...)` on dialog/drawer/popover/menu/etc. before falling back to ancestors. |
| `element.maxFallbackAncestorDepth` | `1`               | If no semantic container matches, walk up at most this many parents (keeps previews tight).     |
| `element.extraContainerSelectors`  | `[]`              | Extra selectors merged into the default container list (array or comma-separated string).       |
| `element.containerSelector`        | _(built-in list)_ | Full override string for `closest()` when you need app-specific wrappers.                       |
| `element.contextAncestorDepth`     | _(legacy)_        | Alias for `maxFallbackAncestorDepth` when set.                                                  |
| `styleProps`                       | built-in list     | Computed properties copied into inline `style` (keep small for performance/size).               |

Disable entirely:

```js
cy.setupLiveA11yMonitor({
  observerOptions: {
    visualSnapshots: { enabled: false },
  },
});
```

### Performance tradeoffs

Enabling snapshots adds **CPU time proportional to violation count** (bounded by `maxNodesPerScan`) plus **one extra subtree walk** for the page overview after each initial scan. JSON/HTML artifacts grow with preview payload; disabling `pageOverview` or lowering `maxNodesPerScan` / depth limits is the main lever when reports become large.

## Report naming convention (easy to read)

All generated reports are saved under `cypress/accessibility/` by default and are written as:

- You can override the default folder with `accessibilityFolder` in `cypress.config.js` (for example `accessibilityFolder: "cypress/my-a11y-artifacts"`).
- If `accessibilityFolder` is omitted or empty, the default `cypress/accessibility/` folder is used.

- one `.json` file (raw/report data), and
- one `.html` file (human-readable report UI),
- both sharing the same base name.

Default base names include a **sanitized test title** segment so CI/CD artifact lists and downloads are easier to match to the **`it(...)`** that produced them. The same segments appear in **`reportId`** inside JSON/HTML (without the `.json` extension).

### 1) Live auto lifecycle reports

Pattern:

`a11y-live-auto--<test-title-slug>--<timestamp>--T<test-number>.json`

Example:

`a11y-live-auto--Login_flow--2026-04-27_00-26-34_467--T01.json`

### 2) Checkpoint reports

Pattern (**`checkpointLabel` omitted** → sequential **`A`**, **`B`**, … for that test):

`a11y-checkpoint--<test-title-slug>--<timestamp>--T<test-number>-checkpoint-<LABEL>.json`

Example (first checkpoint in that test → **`A`**):

`a11y-checkpoint--Modal_dialog--2026-04-27_00-26-45_458--T06-checkpoint-A.json`

Pattern (**non-empty string** `checkpointLabel` → fixed suffix; same shape):

`a11y-checkpoint--<test-title-slug>--<timestamp>--T<test-number>-checkpoint-<LABEL>.json`

Example (custom label):

`a11y-checkpoint--Release_gate--2026-04-27_00-26-47_494--T07-checkpoint-RELEASE_CANDIDATE_V2.json`

### 3) How to decode each part

Segments are separated by **`--`** (double hyphen).

- **`a11y-live-auto`** / **`a11y-checkpoint`**: scan mode that produced the artifact (live auto lifecycle vs checkpoint emission).
- **`<test-title-slug>`**: filesystem-safe form of the current **`it`** title — characters outside **`[a-zA-Z0-9._-]`** become underscores, runs of underscores collapse, leading/trailing underscores trimmed, then capped at **64** characters. If the title is missing or sanitizes to nothing, **`unknown-test`** is used. (Same value as **`testTitleForFilename`** / **`reportArtifact`** metadata in the JSON.)
- **`<timestamp>`**: local sortable timestamp in **`YYYY-MM-DD_HH-mm-ss_mmm`** format.
  - **`YYYY-MM-DD`**: local date.
  - **`HH-mm-ss`**: local 24-hour time.
  - **`mmm`**: milliseconds (3 digits).
- **`T<test-number>`**: test execution order within the **current suite block** when Cypress exposes it (zero-padded, e.g. **`T01`**, **`T07`**); otherwise a per-spec emission counter so names stay unique.
- **`-checkpoint-<LABEL>`**: checkpoint reports only — uppercase label in the filename (e.g. **`A`**, **`B`**, or your fixed string).
  - Resolved from **`cy.checkAccessibility(..., { checkpointLabel })`**, **`cy.checkAccessibility(..., { report: { checkpointLabel } })`**, **`cy.reportLiveA11yResults({ checkpointLabel })`**, or **`cy.setLiveA11yAutoReportOptions({ checkpointLabel })`**, **only when the active store is a checkpoint scan**.
  - **String** → fixed label; **omitted** (or **`true`** / **`"auto"`**) → sequential **`A`**, **`B`**, … per **`it`** title within the spec.

### 4) Important notes

- **`Txx`** complements the title slug: the slug identifies *which test*, the ordinal identifies *which position* in the suite when available.
- **`reportId`** mirrors the default base name (no **`.json`** / **`.html`**): same **`a11y-…--<test-title-slug>--<timestamp>--Txx`** parts and optional **`-checkpoint-<LABEL>`**.
- If you pass **`outputPath`** explicitly in **`cy.reportLiveA11yResults(...)`**, **`cy.checkAccessibility(..., { report: { outputPath } })`**, or **`cy.setLiveA11yAutoReportOptions(...)`**, that custom path/name is used instead of the default naming convention above.

## Terminal output (CI-friendly)

Whenever a report build runs — including after **`cy.checkAccessibility()`** (default **`emitReport`**) or explicit **`cy.reportLiveA11yResults(...)`** — the Node reporter task **`liveA11y:buildReport`** writes a plain-text accessibility summary to the terminal/CI logs.

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

<a id="changelog-100-beta4"></a>

### `1.0.0-beta.4`

- **Artifacts:** default report base names and **`reportId`** include a sanitized **test title** segment so CI/CD downloads match the **`it`** that emitted them (update glob patterns if you relied on the old shape).
- **Checkpoints:** **`checkpointLabel`** omitted → sequential **`A`**, **`B`**, … per test; optional label ignored when the store is a **live** report (naming follows **`scanType`** from the monitor).
- **`LIVE_A11Y_RUN` off:** skips **`cy.checkAccessibility`** (no checkpoint scan/report), same skip signal as the live monitor path.
- **Docs:** env / **`cy.visit`** behavior, Shared Option Types cross-links, **`SetupLiveA11yMonitorOptions`** field notes, HTML layout (**Technical metrics**, **Page visual overview**).

<a id="changelog-100-beta3"></a>

### `1.0.0-beta.3`

- **`cy.checkAccessibility`**: by default chains **`cy.reportLiveA11yResults`** after the checkpoint scan (`emitReport: true`), merges checkpoint-friendly validation and **`suppressEndOfTestAutoReport`** so the auto **`afterEach`** does not duplicate artifacts; supports **`checkpointLabel`** (and **`report`**) on the second argument; optional **`emitReport: false`** for scan-only / legacy flows.
- **`checkpointLabel`**: **`true`** / **`"auto"`** for sequential **`A`**, **`B`**, … labels; string for a fixed suffix.
- HTML report: DOM visual snapshot lightbox polish (modal contrast, close behavior, selector and page in the header), page overview highlight reliability on the first loaded page, and node-row layout (Help / fix / HTML / scans order with nested “Scans” styling).
- Monitor: microtask and animation-frame delay before initial page visual capture; when impact filters are configured, page-overview highlights use unfiltered axe output so dashed outlines match all detected nodes while stored results stay filtered.

<a id="changelog-100-beta2"></a>

### `1.0.0-beta.2`

- Replaces `Cypress.env()` usage with `cy.env()` and `Cypress.expose()` for more reliable env access in the Cypress chain.
- Improves how violations appear in the Cypress command log and cleans up related logging noise.
- Refactors the Node reporter and reorganizes project files with clearer inline documentation.

<a id="changelog-100-beta1"></a>

### `1.0.0-beta.1`

- Fixes first-test live monitor lifecycle reliability across navigation, improves checkpoint log clarity (A/B labeling), and reduces checkpoint-test noise by skipping redundant auto afterEach report logs while preserving strict end-of-suite failure reporting.

<a id="changelog-100-beta0"></a>

### `1.0.0-beta.0`

- First public beta release: continuous live + checkpoint accessibility scanning for Cypress, including violations, warnings and optional `incomplete` findings, with strict end-of-run validation, rich JSON/HTML reports, and CI-friendly terminal summaries.
