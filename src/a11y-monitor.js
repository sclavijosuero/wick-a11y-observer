/**
 * Live accessibility monitor for the AUT window: discovers “scan roots” (dialogs,
 * live regions, interactive clusters), waits for UI to settle, runs axe serially,
 * and accumulates results in a shared store for Cypress/reporting. Severity filters
 * (included/warn impacts) are applied after axe runs so behavior stays deterministic.
 */
import { AXE_IMPACT_ORDER } from './a11y-shared-constants.js';

/* ---------------------------------------------------------------------------
 * Default CSS selector groups used to find semantic overlays (dialogs, popovers,
 * aria-live), open/state-driven surfaces, and interactive elements. Tunable via
 * installLiveA11yMonitor options so apps can extend roots without editing core.
 * --------------------------------------------------------------------------- */
export const DEFAULT_SEMANTIC_ROOT_SELECTOR = [
  '[popover]',
  'dialog[open]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tree"]',
  '[role="grid"]',
  '[role="tooltip"]',
  '[role="alert"]',
  '[role="status"]',
  '[role="log"]',
  '[aria-live]',
  'details[open]',
  '[aria-modal="true"]',
].join(',');

export const DEFAULT_CONVENTION_ROOT_SELECTOR = '';

export const DEFAULT_STATE_ROOT_SELECTOR = [
  '[open]',
  '[aria-expanded="true"]',
  '[aria-hidden="false"]',
  '[aria-modal="true"]',
  '[data-state="open"]',
  '[data-open="true"]',
].join(',');

export const DEFAULT_INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'details',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[role]',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

/* ---------------------------------------------------------------------------
 * Store factory and axe-option normalization. Reads plugin-level fields
 * (includedImpacts, impactLevels, onlyWarnImpacts, runOnly) that axe-core does
 * not interpret the same way; we strip them from run options and filter results
 * in JS so pass/fail and reporting stay consistent across runs.
 * --------------------------------------------------------------------------- */
function createDefaultStore() {
  return {
    initial: null,
    live: [],
    errors: [],
    meta: {
      started: 0,
      finished: 0,
      dropped: 0,
      rescans: 0,
    },
  };
}

function getConfiguredImpactsFromA11yOptions(axeOptions) {
  if (axeOptions && Object.prototype.hasOwnProperty.call(axeOptions, 'includedImpacts')) {
    return axeOptions.includedImpacts;
  }
  if (axeOptions && Object.prototype.hasOwnProperty.call(axeOptions, 'impactLevels')) {
    return axeOptions.impactLevels;
  }
  return undefined;
}

function normalizeImpactLevelsFromA11yOptions(axeOptions) {
  const configured = getConfiguredImpactsFromA11yOptions(axeOptions);
  if (configured === undefined) {
    return [...AXE_IMPACT_ORDER];
  }
  if (!Array.isArray(configured) || configured.length === 0) {
    return [];
  }

  const allowed = new Set(AXE_IMPACT_ORDER);
  return [...new Set(configured.map((level) => String(level).toLowerCase()))].filter((level) =>
    allowed.has(level)
  );
}

function normalizeWarnImpactLevelsFromA11yOptions(axeOptions) {
  if (!axeOptions || !Object.prototype.hasOwnProperty.call(axeOptions, 'onlyWarnImpacts')) {
    return [];
  }
  const configured = axeOptions.onlyWarnImpacts;
  if (!Array.isArray(configured) || configured.length === 0) {
    return [];
  }

  const allowed = new Set(AXE_IMPACT_ORDER);
  return [...new Set(configured.map((level) => String(level).toLowerCase()))].filter((level) =>
    allowed.has(level)
  );
}

function normalizeRunOnlyValuesFromA11yOptions(axeOptions) {
  const values = axeOptions?.runOnly?.values;
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

function getExplicitImpactFilterFromA11yOptions(axeOptions) {
  const configuredIncluded = getConfiguredImpactsFromA11yOptions(axeOptions);
  const configuredWarn =
    axeOptions && Object.prototype.hasOwnProperty.call(axeOptions, 'onlyWarnImpacts')
      ? axeOptions.onlyWarnImpacts
      : undefined;
  if (configuredIncluded === undefined && configuredWarn === undefined) {
    return null;
  }

  const allowed = new Set(AXE_IMPACT_ORDER);
  const normalizedIncluded = Array.isArray(configuredIncluded)
    ? [...new Set(configuredIncluded.map((level) => String(level).toLowerCase()))].filter((level) =>
      allowed.has(level)
    )
    : [];
  const normalizedWarn = Array.isArray(configuredWarn)
    ? [...new Set(configuredWarn.map((level) => String(level).toLowerCase()))].filter((level) =>
      allowed.has(level)
    )
    : [];
  const normalized = [...new Set([...normalizedIncluded, ...normalizedWarn])].filter((level) =>
    allowed.has(level)
  );
  return normalized;
}

function normalizeA11yRunOptions(axeOptions = {}) {
  const normalized = { ...axeOptions };
  // Severity filtering is handled by plugin-level post-processing for determinism.
  delete normalized.includedImpacts;
  delete normalized.impactLevels;
  delete normalized.onlyWarnImpacts;
  return normalized;
}

/* ---------------------------------------------------------------------------
 * Axe result shaping: empty template, merge partial runs, prefix iframe node
 * targets for attribution, and filter violations/incomplete by configured impact.
 * Passes/inapplicable are left unfiltered when filtering by impact (plugin policy).
 * --------------------------------------------------------------------------- */
function createEmptyA11yResults() {
  return {
    violations: [],
    incomplete: [],
    passes: [],
    inapplicable: [],
  };
}

function mergeA11yResults(baseResults = createEmptyA11yResults(), extraResults = createEmptyA11yResults()) {
  return {
    violations: [...(baseResults.violations || []), ...(extraResults.violations || [])],
    incomplete: [...(baseResults.incomplete || []), ...(extraResults.incomplete || [])],
    passes: [...(baseResults.passes || []), ...(extraResults.passes || [])],
    inapplicable: [...(baseResults.inapplicable || []), ...(extraResults.inapplicable || [])],
  };
}

function addFramePrefixToResults(results, framePrefix) {
  const mapNodes = (nodes = []) =>
    nodes.map((node) => {
      const target = Array.isArray(node?.target) ? node.target : [];
      const prefixedTarget =
        target.length > 0
          ? target.map((selector) => `${framePrefix} >>> ${selector}`)
          : [framePrefix];
      return {
        ...node,
        target: prefixedTarget,
      };
    });

  const mapItems = (items = []) =>
    items.map((item) => ({
      ...item,
      nodes: mapNodes(item?.nodes || []),
    }));

  return {
    ...(results || createEmptyA11yResults()),
    violations: mapItems(results?.violations || []),
    incomplete: mapItems(results?.incomplete || []),
    passes: mapItems(results?.passes || []),
    inapplicable: mapItems(results?.inapplicable || []),
  };
}

function filterA11yResultsByImpact(results, axeOptions = {}) {
  const impactFilter = getExplicitImpactFilterFromA11yOptions(axeOptions);
  if (!impactFilter) return results;

  const allowed = new Set(impactFilter);
  const filterByImpact = (items = []) =>
    items.filter((item) => allowed.has(String(item?.impact || '').toLowerCase()));

  return {
    ...(results || {}),
    violations: filterByImpact(results?.violations || []),
    incomplete: filterByImpact(results?.incomplete || []),
    passes: results?.passes || [],
    inapplicable: results?.inapplicable || [],
  };
}

/* ---------------------------------------------------------------------------
 * installLiveA11yMonitor — main entry: wires MutationObserver, animation/resize
 * hooks, optional pre-navigation full-page flush, and a serial axe queue. Returns
 * an API (arm/disarm/stop/waitForIdle/…) and attaches win.__liveA11yMonitor.
 * --------------------------------------------------------------------------- */
export function installLiveA11yMonitor(win, userOptions = {}) {
  if (!win?.axe || typeof win.axe.run !== 'function') {
    throw new Error(
      'axe-core must be injected into the AUT window before installing the live a11y monitor'
    );
  }

  const doc = win.document;

  /* Defaults merged with userOptions; timing/throttling tuned to balance coverage vs noise. */
  const options = {
    root: doc.documentElement,
    autoArm: false,

    minVisibleMs: 250,
    stableFrames: 3,
    maxSettleMs: 2000,

    quietMs: 400,
    waitForIdleTimeoutMs: 10000,
    maxQueueSize: 80,

    treatOpacityZeroAsHidden: true,

    semanticRootSelector: DEFAULT_SEMANTIC_ROOT_SELECTOR,
    stateRootSelector: DEFAULT_STATE_ROOT_SELECTOR,
    conventionRootSelector: DEFAULT_CONVENTION_ROOT_SELECTOR,
    useConventionRoots: false,
    interactiveSelector: DEFAULT_INTERACTIVE_SELECTOR,
    ignoreSelector:
      'html, body, script, style, link, meta, title, head, template, noscript',

    rootIdAttribute: 'data-live-axe-root-id',
    htmlSnippetMax: 1500,
    mutationAncestorDepth: 5,
    fallbackFullPageScan: {
      enabled: true,
      throttleMs: 1500,
    },
    preNavigationFlush: {
      enabled: false,
      minIntervalMs: 300,
      triggerOnClick: true,
      triggerOnSubmit: true,
      triggerOnPageHide: true,
    },

    initialAxeOptions: {
      resultTypes: ['violations', 'incomplete'],
    },
    liveAxeOptions: {
      resultTypes: ['violations', 'incomplete'],
    },

    sharedStore: null,

    ...userOptions,
    // Deep-merge preNavigationFlush so caller can override single flags without losing defaults.
    preNavigationFlush: {
      enabled: false,
      minIntervalMs: 300,
      triggerOnClick: true,
      triggerOnSubmit: true,
      triggerOnPageHide: true,
      ...(userOptions.preNavigationFlush || {}),
    },
  };

  /* Snapshot of configured severity/rule filters for reporters and tests. */
  const store = options.sharedStore || createDefaultStore();

  if (!store.meta) {
    store.meta = {
      started: 0,
      finished: 0,
      dropped: 0,
      rescans: 0,
    };
  }

  const configuredIncludedImpactLevels = [
    ...new Set([
      ...normalizeImpactLevelsFromA11yOptions(options.initialAxeOptions),
      ...normalizeImpactLevelsFromA11yOptions(options.liveAxeOptions),
    ]),
  ];
  const configuredWarnImpactLevels = [
    ...new Set([
      ...normalizeWarnImpactLevelsFromA11yOptions(options.initialAxeOptions),
      ...normalizeWarnImpactLevelsFromA11yOptions(options.liveAxeOptions),
    ]),
  ].filter((level) => !configuredIncludedImpactLevels.includes(level));
  const configuredEffectiveImpactLevels = [
    ...new Set([...configuredIncludedImpactLevels, ...configuredWarnImpactLevels]),
  ];
  const configuredRunOnlyTags = [
    ...new Set([
      ...normalizeRunOnlyValuesFromA11yOptions(options.initialAxeOptions),
      ...normalizeRunOnlyValuesFromA11yOptions(options.liveAxeOptions),
    ]),
  ];
  store.meta.analysis = {
    configuredImpactLevels: configuredEffectiveImpactLevels,
    configuredIncludedImpactLevels,
    configuredWarnImpactLevels,
    initialImpactLevels: normalizeImpactLevelsFromA11yOptions(options.initialAxeOptions),
    liveImpactLevels: normalizeImpactLevelsFromA11yOptions(options.liveAxeOptions),
    initialWarnImpactLevels: normalizeWarnImpactLevelsFromA11yOptions(options.initialAxeOptions),
    liveWarnImpactLevels: normalizeWarnImpactLevelsFromA11yOptions(options.liveAxeOptions),
    configuredRunOnlyTags,
    initialRunOnlyTags: normalizeRunOnlyValuesFromA11yOptions(options.initialAxeOptions),
    liveRunOnlyTags: normalizeRunOnlyValuesFromA11yOptions(options.liveAxeOptions),
  };

  /* Per-root WeakMap state, FIFO-ish queue Map, throttling flags, and serial axe chain. */
  const rootState = new WeakMap();
  const knownRoots = new Set();
  const queue = new Map();

  let stopped = false;
  let armed = Boolean(options.autoArm);
  let fullRescanScheduled = false;
  let queueRunnerActive = false;
  let mutationRescanScheduled = false;
  let lastActivity = win.performance.now();
  let activeSettles = 0;
  let activeScans = 0;
  let enqueueOrder = 0;
  let nextRootId = 1;
  let fallbackRunning = false;
  let lastFallbackScanAt = 0;
  let preNavigationFlushRunning = false;
  let lastPreNavigationFlushAt = 0;
  const pendingMutationCandidates = new Set();
  let axeRunChain = Promise.resolve();

  /* Activity timestamp + rAF helper for idle detection and settle loops. */
  function touch() {
    lastActivity = win.performance.now();
  }

  function nextFrame() {
    return new Promise((resolve) => win.requestAnimationFrame(resolve));
  }

  /* Shadow-aware tree walking: composed parent and closest match across shadow boundaries. */
  function isElement(node) {
    return node && node.nodeType === 1;
  }

  function composedParent(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    if (node.assignedSlot) return node.assignedSlot;

    if (node.getRootNode) {
      const root = node.getRootNode();
      if (root instanceof win.ShadowRoot) {
        return root.host;
      }
    }

    return null;
  }

  function closestComposed(start, selector) {
    let cur = start;
    while (cur && isElement(cur)) {
      if (cur.matches(selector)) return cur;
      cur = composedParent(cur);
    }
    return null;
  }

  /* Lazily created per-root machine state: visibility cycle, tokens for stale work, queue flags. */
  function getRootState(root) {
    let state = rootState.get(root);

    if (!state) {
      state = {
        token: 0,
        cycle: 0,
        pending: false,
        queued: false,
        scanning: false,
        scannedCycle: -1,
        visible: false,
      };
      rootState.set(root, state);
    }

    return state;
  }

  function ensureRootId(root) {
    let id = root.getAttribute(options.rootIdAttribute);
    if (!id) {
      id = String(nextRootId++);
      root.setAttribute(options.rootIdAttribute, id);
    }
    return id;
  }

  /* Visibility walks composed ancestors (hidden, inert, display, opacity policy). */
  function isCssVisible(el) {
    if (!isElement(el) || !el.isConnected) return false;

    let cur = el;
    while (cur && isElement(cur)) {
      const cs = win.getComputedStyle(cur);

      if (cur.hasAttribute('hidden')) return false;
      if (cur.inert) return false;
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (cs.contentVisibility === 'hidden') return false;

      if (options.treatOpacityZeroAsHidden && Number(cs.opacity) === 0) {
        return false;
      }

      cur = composedParent(cur);
    }

    return el.getClientRects().length > 0;
  }

  function hasInteractiveContent(root) {
    if (!root || !isElement(root)) return false;

    return (
      root.matches(options.interactiveSelector) ||
      Boolean(root.querySelector(options.interactiveSelector))
    );
  }

  /* Labels root for reporting priority and metadata (dialog vs tooltip vs generic). */
  function classifyRoot(root) {
    if (!root || !isElement(root)) return 'unknown';

    if (root.matches('[role="alert"], [role="status"], [role="log"], [aria-live]')) {
      return 'live-region';
    }
    if (root.matches('[popover]')) return 'popover';
    if (
      root.matches(
        'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
      )
    ) {
      return 'dialog';
    }
    if (root.matches('[role="menu"], [role="listbox"], [role="tree"], [role="grid"]')) {
      return 'popup-widget';
    }
    if (root.matches('[role="tooltip"]')) return 'tooltip';
    if (root.matches('details[open]')) return 'disclosure';
    if (root.matches(options.stateRootSelector)) return 'state-root';
    if (
      options.useConventionRoots &&
      options.conventionRootSelector &&
      root.matches(options.conventionRootSelector)
    ) {
      return 'app-convention';
    }
    if (root.matches(options.interactiveSelector)) return 'interactive';

    return 'generic';
  }

  /* Higher priority roots dequeue first when the live scan queue is constrained. */
  function rootPriority(root) {
    switch (classifyRoot(root)) {
      case 'dialog':
        return 100;
      case 'popover':
        return 95;
      case 'live-region':
        return 90;
      case 'popup-widget':
        return 80;
      case 'tooltip':
        return 70;
      case 'disclosure':
        return 60;
      case 'app-convention':
        return 50;
      case 'state-root':
        return 45;
      case 'interactive':
        return 40;
      default:
        return 10;
    }
  }

  /* Resolve which subtree to scan: semantic/state/convention roots, forms, then interactive. */
  function findScanRoot(el) {
    return findScanRootWithStrategy(el).root;
  }

  /* Limited ancestor walk from mutation target when semantic selectors miss (dynamic islands). */
  function findMutationDrivenRoot(el) {
    if (!isElement(el)) return null;

    let cur = el;
    let depth = 0;
    while (cur && isElement(cur) && depth <= options.mutationAncestorDepth) {
      if (!cur.matches(options.ignoreSelector)) {
        const stateRoot = closestComposed(cur, options.stateRootSelector);
        if (stateRoot && !stateRoot.matches(options.ignoreSelector)) {
          return stateRoot;
        }

        if (hasInteractiveContent(cur)) {
          return cur;
        }
      }

      cur = composedParent(cur);
      depth += 1;
    }

    return null;
  }

  /* Ordered resolution with named strategy for telemetry; optional mutation fallback path. */
  function findScanRootWithStrategy(el, { allowMutationFallback = false } = {}) {
    if (!isElement(el)) return { root: null, strategy: null };
    if (el.matches(options.ignoreSelector)) return { root: null, strategy: null };

    const semanticRoot = closestComposed(el, options.semanticRootSelector);
    if (semanticRoot && !semanticRoot.matches(options.ignoreSelector)) {
      return { root: semanticRoot, strategy: 'semantic' };
    }

    const stateRoot = closestComposed(el, options.stateRootSelector);
    if (stateRoot && !stateRoot.matches(options.ignoreSelector)) {
      return { root: stateRoot, strategy: 'state' };
    }

    if (options.useConventionRoots) {
      const conventionRoot = closestComposed(el, options.conventionRootSelector);
      if (conventionRoot && !conventionRoot.matches(options.ignoreSelector)) {
        return { root: conventionRoot, strategy: 'convention' };
      }
    }

    const formRoot = closestComposed(el, 'form, [role="form"]');
    if (formRoot && hasInteractiveContent(formRoot)) {
      return { root: formRoot, strategy: 'form' };
    }

    if (el.matches(options.interactiveSelector)) {
      return { root: el, strategy: 'interactive-self' };
    }

    const interactiveAncestor = closestComposed(el, options.interactiveSelector);
    if (interactiveAncestor) {
      return { root: interactiveAncestor, strategy: 'interactive-ancestor' };
    }

    if (allowMutationFallback) {
      const mutationRoot = findMutationDrivenRoot(el);
      if (mutationRoot && !mutationRoot.matches(options.ignoreSelector)) {
        return { root: mutationRoot, strategy: 'mutation-fallback' };
      }
    }

    return { root: null, strategy: null };
  }

  /* Gate: connected, visible, not ignored, and eligible semantic/state/interactive root. */
  function shouldQueueForA11y(root) {
    if (!root || !isElement(root)) return false;
    if (root.matches(options.ignoreSelector)) return false;
    if (!root.isConnected || !isCssVisible(root)) return false;

    const state = getRootState(root);
    if (state.scanning || state.queued || state.scannedCycle === state.cycle) {
      return false;
    }

    if (root.matches(options.semanticRootSelector) || root.matches(options.stateRootSelector)) {
      return true;
    }

    if (options.useConventionRoots && root.matches(options.conventionRootSelector)) {
      return true;
    }

    return hasInteractiveContent(root);
  }

  /* Cheap layout/style fingerprint so waitUntilStable can detect steady frames. */
  function signature(root) {
    const rect = root.getBoundingClientRect();
    const cs = win.getComputedStyle(root);

    return [
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
      cs.display,
      cs.visibility,
      cs.opacity,
    ].join('|');
  }

  /* Drop queued work and bump cycle/token when root hides or disconnects. */
  function invalidateRoot(root) {
    const state = getRootState(root);

    if (state.visible) {
      state.cycle += 1;
    }

    state.visible = false;
    state.token += 1;
    state.pending = false;
    state.scanning = false;

    if (queue.has(root)) {
      queue.delete(root);
      state.queued = false;
      store.meta.dropped += 1;
    }

    touch();
  }

  /* Wait until root stays visible and geometry/style unchanged for N frames or max time. */
  async function waitUntilStable(root, token) {
    const startedAt = win.performance.now();
    let firstVisibleAt = null;
    let previousSignature = null;
    let equalFrames = 0;

    while (!stopped && armed) {
      const state = getRootState(root);

      if (state.token !== token) return false;
      if (!root.isConnected || !isCssVisible(root)) return false;

      const now = win.performance.now();
      if (firstVisibleAt == null) {
        firstVisibleAt = now;
      }

      const currentSignature = signature(root);
      equalFrames = currentSignature === previousSignature ? equalFrames + 1 : 1;
      previousSignature = currentSignature;

      const visibleLongEnough = now - firstVisibleAt >= options.minVisibleMs;
      const stableLongEnough = equalFrames >= options.stableFrames;

      if (visibleLongEnough && stableLongEnough) {
        return true;
      }

      if (now - startedAt >= options.maxSettleMs) {
        return true;
      }

      await nextFrame();
    }

    return false;
  }

  /* Ordered queue view: priority desc, then enqueue order for fairness. */
  function queueSnapshot() {
    return [...queue.values()].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.order - b.order;
    });
  }

  /* Cap queue length under load; lowest-priority pending roots drop first (meta.dropped). */
  function shrinkQueueIfNeeded() {
    if (queue.size <= options.maxQueueSize) return;

    const keep = new Set(
      queueSnapshot()
        .slice(0, options.maxQueueSize)
        .map((item) => item.root)
    );

    for (const [root] of queue) {
      if (!keep.has(root)) {
        queue.delete(root);
        getRootState(root).queued = false;
        store.meta.dropped += 1;
      }
    }
  }

  /* Persist only what live reporting needs (violations + incomplete). */
  function compactA11yResults(results) {
    return {
      violations: results?.violations || [],
      incomplete: results?.incomplete || [],
    };
  }

  /* Human-readable iframe discriminator for prefixed axe node targets in reports. */
  function iframeLocator(iframeEl) {
    const id = iframeEl.getAttribute('id');
    if (id) return `iframe#${id}`;
    const title = iframeEl.getAttribute('title');
    if (title) return `iframe[title="${title}"]`;
    const name = iframeEl.getAttribute('name');
    if (name) return `iframe[name="${name}"]`;
    return 'iframe';
  }

  function candidateIframesFromTarget(target) {
    if (!target) return [];
    if (target instanceof win.Document) {
      return [...target.querySelectorAll('iframe')];
    }
    if (target instanceof win.Element) {
      if (target.tagName === 'IFRAME') return [target];
      return [...target.querySelectorAll('iframe')];
    }
    return [];
  }

  /* Same-origin iframes: eval cached axe source into frame, run separately, merge with prefix. */
  function ensureA11yInFrame(frameWin) {
    if (frameWin?.axe && typeof frameWin.axe.run === 'function') {
      return true;
    }

    const source = win.__liveAxeSource;
    if (!source || !frameWin) return false;

    const previousModule = frameWin.module;
    const previousExports = frameWin.exports;

    try {
      frameWin.module = { exports: {} };
      frameWin.exports = frameWin.module.exports;
      frameWin.eval(source);
      if (!frameWin.axe && frameWin.module?.exports) {
        frameWin.axe = frameWin.module.exports;
      }
      return Boolean(frameWin.axe && typeof frameWin.axe.run === 'function');
    } catch {
      return false;
    } finally {
      frameWin.module = previousModule;
      frameWin.exports = previousExports;
    }
  }

  async function runSameOriginIframesA11y(target, axeOptions) {
    if (!axeOptions?.iframes) {
      return createEmptyA11yResults();
    }

    let merged = createEmptyA11yResults();
    const iframes = candidateIframesFromTarget(target);
    if (iframes.length === 0) return merged;

    for (const iframeEl of iframes) {
      try {
        const frameWin = iframeEl.contentWindow;
        const frameDoc = iframeEl.contentDocument;
        if (!frameWin || !frameDoc) continue;
        if (!ensureA11yInFrame(frameWin)) continue;

        const frameOptions = normalizeA11yRunOptions({
          ...axeOptions,
          iframes: false,
        });
        const frameRawResults = await frameWin.axe.run(frameDoc, frameOptions);
        const frameResults = filterA11yResultsByImpact(frameRawResults, axeOptions);
        const prefixed = addFramePrefixToResults(frameResults, iframeLocator(iframeEl));
        merged = mergeA11yResults(merged, prefixed);
      } catch {
        // Ignore non-accessible or failed iframe scans; parent scan still recorded.
      }
    }

    return merged;
  }

  /* Serialize axe.run across targets so concurrent DOM scans don’t fight or duplicate work. */
  async function runA11ySerial(target, axeOptions) {
    const run = axeRunChain.then(async () => {
      const rawResults = await win.axe.run(target, normalizeA11yRunOptions(axeOptions));
      const filtered = filterA11yResultsByImpact(rawResults, axeOptions);
      const iframeResults = await runSameOriginIframesA11y(target, axeOptions);
      return mergeA11yResults(filtered, iframeResults);
    });
    // Keep chain progressing after rejected runs.
    axeRunChain = run.catch(() => undefined);
    return run;
  }

  /* Add root to live queue with priority; pumpQueue drains asynchronously. */
  function enqueueRoot(root, reason, token) {
    const state = getRootState(root);

    if (!shouldQueueForA11y(root)) return;
    if (state.queued || state.scanning) return;

    state.queued = true;

    queue.set(root, {
      root,
      token,
      cycle: state.cycle,
      reason,
      priority: rootPriority(root),
      order: ++enqueueOrder,
    });

    shrinkQueueIfNeeded();
    touch();
    pumpQueue();
  }

  /* Single active runner: dequeue, settle guards, run axe, append store.live or store.errors. */
  async function pumpQueue() {
    if (queueRunnerActive || stopped || !armed) return;

    queueRunnerActive = true;

    try {
      while (!stopped && armed && queue.size > 0) {
        const next = queueSnapshot()[0];
        if (!next) break;

        queue.delete(next.root);

        const state = getRootState(next.root);
        state.queued = false;

        if (state.token !== next.token || state.cycle !== next.cycle) {
          continue;
        }

        if (!shouldQueueForA11y(next.root)) {
          continue;
        }

        state.scanning = true;
        state.visible = true;
        activeScans += 1;
        store.meta.started += 1;
        touch();

        try {
          const rootId = ensureRootId(next.root);
          const results = await runA11ySerial(next.root, options.liveAxeOptions);

          state.scannedCycle = state.cycle;

          store.live.push({
            rootId,
            rootType: classifyRoot(next.root),
            rootHtmlId: next.root.id ? String(next.root.id) : null,
            reason: next.reason,
            url: win.location.href,
            timestamp: Date.now(),
            rootRect: {
              x: Math.round(next.root.getBoundingClientRect().x),
              y: Math.round(next.root.getBoundingClientRect().y),
              width: Math.round(next.root.getBoundingClientRect().width),
              height: Math.round(next.root.getBoundingClientRect().height),
            },
            htmlSnippet: next.root.outerHTML.slice(0, options.htmlSnippetMax),
            results: compactA11yResults(results),
          });
        } catch (error) {
          store.errors.push({
            url: win.location.href,
            timestamp: Date.now(),
            phase: 'live-scan',
            reason: next.reason,
            message: error?.message || String(error),
          });
        } finally {
          state.scanning = false;
          activeScans -= 1;
          store.meta.finished += 1;
          touch();
        }
      }
    } finally {
      queueRunnerActive = false;
    }
  }

  /* After DOM churn: wait for stable visible root, then enqueue if still eligible. */
  function settleAndMaybeQueue(root, reason) {
    const state = getRootState(root);

    if (
      state.pending ||
      state.queued ||
      state.scanning ||
      state.scannedCycle === state.cycle
    ) {
      return;
    }

    state.pending = true;
    state.visible = true;
    state.token += 1;

    const token = state.token;

    activeSettles += 1;
    touch();

    waitUntilStable(root, token)
      .then((ok) => {
        const latest = getRootState(root);

        // Always release settle bookkeeping for this attempt.
        if (latest.pending && latest.token === token) {
          latest.pending = false;
        }
        activeSettles = Math.max(0, activeSettles - 1);
        touch();

        if (latest.token !== token) return;

        if (!ok || !shouldQueueForA11y(root)) {
          return;
        }

        enqueueRoot(root, reason, token);
      })
      .catch((error) => {
        const latest = getRootState(root);
        latest.pending = false;
        activeSettles = Math.max(0, activeSettles - 1);

        store.errors.push({
          url: win.location.href,
          timestamp: Date.now(),
          phase: 'settle',
          reason,
          message: error?.message || String(error),
        });

        touch();
      });
  }

  /* Scan DOM for candidates and dedupe resolved scan roots (used by rescan). */
  function collectCurrentRoots() {
    const roots = new Map();
    const selector = [
      options.semanticRootSelector,
      options.stateRootSelector,
      options.useConventionRoots ? options.conventionRootSelector : null,
      options.interactiveSelector,
    ]
      .filter(Boolean)
      .join(',');

    doc.querySelectorAll(selector).forEach((candidate) => {
      const { root, strategy } = findScanRootWithStrategy(candidate);
      if (root && !roots.has(root)) {
        roots.set(root, strategy || 'unknown');
      }
    });

    return roots;
  }

  /* Reconcile knownRoots with DOM; optionally full-page axe when nothing actionable queued. */
  function rescan(reason = 'mutation') {
    if (stopped || !armed) return;

    store.meta.rescans += 1;
    touch();

    for (const root of [...knownRoots]) {
      if (!root.isConnected) {
        invalidateRoot(root);
        knownRoots.delete(root);
        continue;
      }

      if (!isCssVisible(root)) {
        invalidateRoot(root);
      }
    }

    const currentRoots = collectCurrentRoots();
    let queuedRoots = 0;

    for (const [root, strategy] of currentRoots) {
      knownRoots.add(root);

      if (!isCssVisible(root)) {
        invalidateRoot(root);
        continue;
      }

      const state = getRootState(root);
      state.visible = true;

      if (shouldQueueForA11y(root)) {
        settleAndMaybeQueue(root, `${reason}:${strategy || 'unknown'}`);
        queuedRoots += 1;
      }
    }

    if (
      queuedRoots === 0 &&
      currentRoots.size === 0 &&
      activeSettles === 0 &&
      activeScans === 0 &&
      queue.size === 0 &&
      options.fallbackFullPageScan?.enabled &&
      reason !== 'arm'
    ) {
      maybeRunFallbackFullPageScan(reason);
    }
  }

  /* Safety net when targeted roots miss dynamic content; throttled document-level scan. */
  async function maybeRunFallbackFullPageScan(reason) {
    if (stopped || !armed || fallbackRunning) return;
    const now = win.performance.now();
    const throttleMs = options.fallbackFullPageScan?.throttleMs || 1500;
    if (now - lastFallbackScanAt < throttleMs) return;

    fallbackRunning = true;
    lastFallbackScanAt = now;
    activeScans += 1;
    store.meta.started += 1;
    touch();

    try {
      const results = await runA11ySerial(doc, options.liveAxeOptions);
      store.live.push({
        rootId: 'document',
        rootType: 'full-page-fallback',
        rootHtmlId: null,
        reason: `${reason}:fallback`,
        url: win.location.href,
        timestamp: Date.now(),
        htmlSnippet: doc.documentElement.outerHTML.slice(0, options.htmlSnippetMax),
        results: compactA11yResults(results),
      });
    } catch (error) {
      store.errors.push({
        url: win.location.href,
        timestamp: Date.now(),
        phase: 'live-scan',
        reason: `${reason}:fallback`,
        message: error?.message || String(error),
      });
    } finally {
      fallbackRunning = false;
      activeScans = Math.max(0, activeScans - 1);
      store.meta.finished += 1;
      touch();
    }
  }

  /* Capture a11y state on likely navigation (click link/submit, pagehide) before unload. */
  function queuePreNavigationFlush(reason = 'navigation') {
    if (stopped || !armed || !options.preNavigationFlush?.enabled) return;
    if (preNavigationFlushRunning) return;

    const now = win.performance.now();
    const minIntervalMs = Number(options.preNavigationFlush?.minIntervalMs || 300);
    if (now - lastPreNavigationFlushAt < minIntervalMs) return;
    lastPreNavigationFlushAt = now;
    preNavigationFlushRunning = true;

    activeScans += 1;
    store.meta.started += 1;
    touch();

    runA11ySerial(doc, options.liveAxeOptions)
      .then((results) => {
        store.live.push({
          rootId: 'document',
          rootType: 'pre-navigation-full-page',
          rootHtmlId: null,
          reason: `${reason}:pre-navigation`,
          url: win.location.href,
          timestamp: Date.now(),
          htmlSnippet: doc.documentElement.outerHTML.slice(0, options.htmlSnippetMax),
          results: compactA11yResults(results),
        });
      })
      .catch((error) => {
        store.errors.push({
          url: win.location.href,
          timestamp: Date.now(),
          phase: 'live-scan',
          reason: `${reason}:pre-navigation`,
          message: error?.message || String(error),
        });
      })
      .finally(() => {
        preNavigationFlushRunning = false;
        activeScans = Math.max(0, activeScans - 1);
        store.meta.finished += 1;
        touch();
      });
  }

  /* Heuristic to avoid flushing on every click; focuses on real navigations. */
  function isLikelyNavigationClickTarget(target) {
    if (!target) return false;
    const base = isElement(target) ? target : target.parentElement;
    if (!base || typeof base.closest !== 'function') return false;
    const clickable = base.closest('a[href], button, input[type="submit"], input[type="image"], [role="link"]');
    if (!clickable) return false;

    if (clickable.matches('a[href]')) {
      const href = String(clickable.getAttribute('href') || '').trim().toLowerCase();
      return href !== '' && !href.startsWith('#') && !href.startsWith('javascript:');
    }

    if (clickable.matches('[role="link"], input[type="submit"], input[type="image"]')) {
      return true;
    }

    if (clickable.matches('button')) {
      if (clickable.form) return true;
      const onclick = String(clickable.getAttribute('onclick') || '').toLowerCase();
      if (
        onclick.includes('location') ||
        onclick.includes('href') ||
        onclick.includes('assign(') ||
        onclick.includes('replace(')
      ) {
        return true;
      }
      const hint = `${clickable.id || ''} ${clickable.getAttribute('data-cy') || ''} ${clickable.getAttribute('data-testid') || ''}`.toLowerCase();
      return /(navigate|nav|redirect|go-|to-page|page-)/.test(hint);
    }

    return false;
  }

  /* Collect mutation targets for a single rAF batch (elements or text parent). */
  function queueMutationCandidate(node) {
    if (!node) return;
    if (isElement(node)) {
      pendingMutationCandidates.add(node);
      return;
    }
    if (node.nodeType === 3 && isElement(node.parentElement)) {
      pendingMutationCandidates.add(node.parentElement);
    }
  }

  /* Debounce mutation-driven root discovery to one animation frame. */
  function scheduleMutationRescan() {
    if (stopped || !armed || mutationRescanScheduled) return;
    mutationRescanScheduled = true;

    win.requestAnimationFrame(() => {
      mutationRescanScheduled = false;
      processMutationCandidates();
    });
  }

  /* Narrow mutation-driven work: find scan roots with mutation fallback, queue or fallback scan. */
  function processMutationCandidates() {
    if (stopped || !armed) {
      pendingMutationCandidates.clear();
      return;
    }

    let queuedRoots = 0;

    for (const candidate of [...pendingMutationCandidates]) {
      pendingMutationCandidates.delete(candidate);
      const { root, strategy } = findScanRootWithStrategy(candidate, {
        allowMutationFallback: true,
      });

      if (!root || root.matches(options.ignoreSelector)) continue;
      knownRoots.add(root);

      if (!isCssVisible(root)) {
        invalidateRoot(root);
        continue;
      }

      const state = getRootState(root);
      state.visible = true;

      if (shouldQueueForA11y(root)) {
        settleAndMaybeQueue(root, `mutation-driven:${strategy || 'unknown'}`);
        queuedRoots += 1;
      }
    }

    if (
      queuedRoots === 0 &&
      activeSettles === 0 &&
      activeScans === 0 &&
      queue.size === 0 &&
      options.fallbackFullPageScan?.enabled
    ) {
      maybeRunFallbackFullPageScan('mutation-driven');
    }
  }

  /* Coalesce full-tree rescans to one frame (pairs with MutationObserver batching). */
  function scheduleRescan(reason = 'mutation') {
    if (stopped || !armed || fullRescanScheduled) return;

    fullRescanScheduled = true;

    win.requestAnimationFrame(() => {
      fullRescanScheduled = false;
      rescan(reason);
    });
  }

  /* DOM mutations → candidate queue + full rescan schedule (when armed). */
  const mutationObserver = new win.MutationObserver((records) => {
    if (!armed) return;

    for (const record of records) {
      queueMutationCandidate(record.target);
      if (record.type === 'childList') {
        for (const node of record.addedNodes || []) {
          queueMutationCandidate(node);
        }
      }
    }

    scheduleMutationRescan();
    scheduleRescan('mutation');
  });

  mutationObserver.observe(options.root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  /* Transitions, animations, resize, bfcache restore — reschedule root discovery. */
  const eventHandlers = [
    ['transitionrun', () => scheduleRescan('transitionrun')],
    ['transitionend', () => scheduleRescan('transitionend')],
    ['animationstart', () => scheduleRescan('animationstart')],
    ['animationend', () => scheduleRescan('animationend')],
    ['resize', () => scheduleRescan('resize')],
    ['orientationchange', () => scheduleRescan('orientationchange')],
    ['pageshow', () => scheduleRescan('pageshow')],
  ];

  eventHandlers.forEach(([name, handler]) => {
    win.addEventListener(name, handler, true);
  });

  /* Optional full-document flush around navigation intents (feature-flagged). */
  const preNavigationHandlers = [
    [
      'click',
      (event) => {
        if (!options.preNavigationFlush?.triggerOnClick) return;
        if (!isLikelyNavigationClickTarget(event?.target)) return;
        queuePreNavigationFlush('click-navigation-intent');
      },
    ],
    [
      'submit',
      () => {
        if (!options.preNavigationFlush?.triggerOnSubmit) return;
        queuePreNavigationFlush('submit-navigation-intent');
      },
    ],
    [
      'pagehide',
      () => {
        if (!options.preNavigationFlush?.triggerOnPageHide) return;
        queuePreNavigationFlush('pagehide');
      },
    ],
  ];

  if (options.preNavigationFlush?.enabled) {
    preNavigationHandlers.forEach(([name, handler]) => {
      win.addEventListener(name, handler, true);
    });
  }

  /* Captures lazy-loaded subtree changes (images, iframes, etc.). */
  const loadHandler = () => scheduleRescan('resource-load');
  doc.addEventListener('load', loadHandler, true);

  /* Baseline snapshot for diffing live findings; stored separately from live array. */
  async function runInitialFullPageScan(initialAxeOptions = options.initialAxeOptions) {
    const rawResults = await win.axe.run(doc, normalizeA11yRunOptions(initialAxeOptions));
    const filtered = filterA11yResultsByImpact(rawResults, initialAxeOptions);
    const iframeResults = await runSameOriginIframesA11y(doc, initialAxeOptions);
    const results = mergeA11yResults(filtered, iframeResults);
    store.initial = results;
    store.initialPageUrl = String(win.location.href);
    touch();
    return results;
  }

  /* Enable observers/queue processing; optionally triggers immediate rescan of current DOM. */
  function arm({ scanCurrent = true } = {}) {
    armed = true;
    touch();

    if (scanCurrent) {
      scheduleRescan('arm');
    }
  }

  function disarm() {
    armed = false;

    for (const [root] of queue) {
      getRootState(root).queued = false;
    }

    queue.clear();
    touch();
  }

  /* Cypress-friendly barrier: resolves when queue/settles quiet for quietMs or timeout. */
  async function waitForIdle({
    quietMs = options.quietMs,
    timeoutMs = options.waitForIdleTimeoutMs,
  } = {}) {
    const startedAt = win.performance.now();

    while (!stopped) {
      const now = win.performance.now();

      const idle =
        activeSettles === 0 &&
        activeScans === 0 &&
        queue.size === 0 &&
        now - lastActivity >= quietMs;

      if (idle) {
        return store;
      }

      if (now - startedAt >= timeoutMs) {
        return store;
      }

      await nextFrame();
    }

    return store;
  }

  /* Tear down listeners and observer; stop all future scans. */
  function stop() {
    stopped = true;
    disarm();
    mutationObserver.disconnect();
    doc.removeEventListener('load', loadHandler, true);

    eventHandlers.forEach(([name, handler]) => {
      win.removeEventListener(name, handler, true);
    });
    preNavigationHandlers.forEach(([name, handler]) => {
      win.removeEventListener(name, handler, true);
    });
  }

  /* Public surface for Cypress bridge and debugging. */
  const api = {
    store,
    arm,
    disarm,
    stop,
    rescan,
    waitForIdle,
    runInitialFullPageScan,
    findScanRoot,
    shouldQueueForA11y,
    isCssVisible,
  };

  win.__liveA11yMonitor = api;
  return api;
}