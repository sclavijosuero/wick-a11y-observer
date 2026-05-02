/**
 * Lightweight DOM + computed-style snapshots for HTML reports (no Cypress screenshots).
 * Runs in the AUT window alongside the live a11y monitor.
 */

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'LINK',
  'META',
  'TITLE',
  'HEAD',
  'SVG',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

/** Default whitelist of computed properties copied onto inline `style` for previews. */
export const DEFAULT_VISUAL_STYLE_PROPS = [
  'display',
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'border-collapse',
  'box-sizing',
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'vertical-align',
  'white-space',
  'opacity',
  'visibility',
  'overflow',
  'overflow-x',
  'overflow-y',
  'box-shadow',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'justify-items',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'list-style',
  'list-style-type',
  'cursor',
  'z-index',
  /** Needed so drawer/sheet open vs closed state matches the AUT; sanitized below when “off-canvas”. */
  'transform',
];

/** Lower rank = more severe (matches HTML / axe ordering). */
const IMPACT_RANK = Object.freeze({
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
  none: 4,
});

export function severityRank(impact) {
  const k = String(impact || 'none').toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMPACT_RANK, k) ? IMPACT_RANK[k] : 99;
}

export const DEFAULT_VISUAL_SNAPSHOT_OPTIONS = {
  enabled: true,
  maxNodesPerScan: 48,
  pageOverview: {
    enabled: true,
    maxDepth: 5,
    maxNodes: 450,
    maxTextChars: 72,
    rootSelector: 'body',
  },
  element: {
    enabled: true,
    maxDepth: 8,
    maxNodes: 160,
    maxTextChars: 120,
    /**
     * Prefer the nearest modal/drawer/popover/etc. via `Element.closest(...)`.
     * If none matches, walk up at most this many ancestors (keeps context tight).
     */
    preferSemanticContainer: true,
    maxFallbackAncestorDepth: 1,
    /** Extra selectors (comma-separated or array of strings) merged into container matching. */
    extraContainerSelectors: [],
    /** Full override for the `closest()` selector string when set. */
    containerSelector: '',
  },
  styleProps: DEFAULT_VISUAL_STYLE_PROPS,
};

/**
 * @param {Record<string, unknown> | null | undefined} user
 * @returns {typeof DEFAULT_VISUAL_SNAPSHOT_OPTIONS & { styleProps: string[] }}
 */
/** Selectors for immediate overlay surfaces (modal, drawer, popover, etc.). */
export const DEFAULT_VISUAL_SNAPSHOT_CONTAINER_SELECTOR_LIST = [
  'dialog[open]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[popover]',
  'details[open]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="tooltip"]',
];

export function buildVisualSnapshotContainerSelector(extra = []) {
  const extras = Array.isArray(extra) ? extra : [extra].filter(Boolean);
  return [...DEFAULT_VISUAL_SNAPSHOT_CONTAINER_SELECTOR_LIST, ...extras.map((s) => String(s).trim()).filter(Boolean)].join(',');
}

/**
 * Root element for a violation snapshot: nearest semantic container, else a shallow ancestor wrap.
 * @param {Element} focalEl
 * @param {Record<string, unknown>} branchOpts
 * @returns {Element}
 */
export function findVisualSnapshotContextRoot(focalEl, branchOpts = {}) {
  if (!focalEl || focalEl.nodeType !== 1) {
    return focalEl;
  }

  const prefer = branchOpts.preferSemanticContainer !== false;
  const extrasRaw = branchOpts.extraContainerSelectors;
  const extras = Array.isArray(extrasRaw)
    ? extrasRaw
    : typeof extrasRaw === 'string'
      ? extrasRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  const customFull =
    typeof branchOpts.containerSelector === 'string' && branchOpts.containerSelector.trim()
      ? branchOpts.containerSelector.trim()
      : '';

  const selStr = customFull || buildVisualSnapshotContainerSelector(extras);

  if (prefer && typeof focalEl.closest === 'function') {
    try {
      const hit = focalEl.closest(selStr);
      if (hit && hit.nodeType === 1 && typeof hit.contains === 'function' && hit.contains(focalEl)) {
        const tag = hit.tagName.toUpperCase();
        if (tag !== 'HTML' && tag !== 'BODY') {
          return hit;
        }
      }
    } catch {
      /* ignore invalid selector combinations */
    }
  }

  let maxFb = Number(branchOpts.maxFallbackAncestorDepth);
  if (!Number.isFinite(maxFb)) {
    const legacy = Number(branchOpts.contextAncestorDepth);
    maxFb = Number.isFinite(legacy) ? legacy : DEFAULT_VISUAL_SNAPSHOT_OPTIONS.element.maxFallbackAncestorDepth;
  }
  maxFb = Math.max(0, Math.floor(maxFb));

  let root = focalEl;
  for (let i = 0; i < maxFb; i++) {
    const p = root.parentElement;
    if (!p || p.nodeType !== 1) break;
    const tag = p.tagName.toUpperCase();
    if (tag === 'BODY' || tag === 'HTML') break;
    root = p;
  }
  return root;
}

export function normalizeVisualSnapshotOptions(user) {
  const u = user && typeof user === 'object' ? user : {};
  const page = {
    ...DEFAULT_VISUAL_SNAPSHOT_OPTIONS.pageOverview,
    ...(u.pageOverview && typeof u.pageOverview === 'object' ? u.pageOverview : {}),
  };
  const element = {
    ...DEFAULT_VISUAL_SNAPSHOT_OPTIONS.element,
    ...(u.element && typeof u.element === 'object' ? u.element : {}),
  };
  if (
    element.maxFallbackAncestorDepth == null &&
    element.contextAncestorDepth != null &&
    Number.isFinite(Number(element.contextAncestorDepth))
  ) {
    element.maxFallbackAncestorDepth = Number(element.contextAncestorDepth);
  }
  const styleProps = Array.isArray(u.styleProps) && u.styleProps.length > 0
    ? u.styleProps.map((s) => String(s))
    : [...DEFAULT_VISUAL_STYLE_PROPS];

  return {
    ...DEFAULT_VISUAL_SNAPSHOT_OPTIONS,
    ...u,
    pageOverview: page,
    element,
    styleProps,
  };
}

/**
 * Query within a subtree including open shadow roots (axe targets may land inside shadow DOM).
 * @param {ParentNode | null | undefined} root
 * @param {string} selector
 * @returns {Element | null}
 */
export function querySelectorIncludingOpenShadow(root, selector) {
  if (!root || !selector) return null;
  try {
    const direct = root.querySelector(selector);
    if (direct) return direct;
  } catch {
    return null;
  }

  const stack = [];
  if (root.nodeType === 9) {
    const de = /** @type {Document} */ (root).documentElement;
    if (de) stack.push(de);
  } else if (root.nodeType === 1) {
    stack.push(/** @type {Element} */ (root));
  }

  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;

    let sr = null;
    try {
      sr = el.shadowRoot;
    } catch {
      sr = null;
    }
    if (sr) {
      try {
        const hit = sr.querySelector(selector);
        if (hit) return hit;
      } catch {
        /* ignore */
      }
      try {
        stack.push(...sr.children);
      } catch {
        /* ignore */
      }
    }

    try {
      stack.push(...el.children);
    } catch {
      /* ignore */
    }
  }

  return null;
}

function getIframeDocument(iframeEl) {
  try {
    return iframeEl.contentDocument || iframeEl.contentWindow?.document || null;
  } catch {
    return null;
  }
}

/**
 * Flatten axe / reporter target chains: arrays of steps, plus legacy single strings using `>>>`.
 * @param {string[] | string | null | undefined} target
 * @returns {string[]}
 */
export function normalizeAxeTargetChain(target) {
  if (target == null) return [];
  const raw = Array.isArray(target) ? target : [target];
  const out = [];
  for (const item of raw) {
    const s = String(item ?? '').trim();
    if (!s) continue;
    if (/\s*>>>\s*/.test(s)) {
      for (const part of s.split(/\s*>>>\s*/)) {
        const p = part.trim();
        if (p) out.push(p);
      }
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Best-effort reason when `resolveTargetToElement` fails (cross-origin iframe, closed shadow, invalid selector).
 * @param {Document} doc
 * @param {string[]} target
 */
export function inferUnresolvedSnapshotReason(doc, target) {
  const chain = normalizeAxeTargetChain(target);
  if (!doc || chain.length === 0) return 'unresolved';

  let cur = null;

  for (let i = 0; i < chain.length; i++) {
    const sel = String(chain[i] || '').trim();
    if (!sel) return 'unresolved-empty-selector-segment';

    try {
      if (i === 0) {
        cur = doc.querySelector(sel) || querySelectorIncludingOpenShadow(doc.documentElement, sel);
      } else if (cur && cur.tagName === 'IFRAME') {
        const fd = getIframeDocument(cur);
        if (!fd) return 'unresolved-cross-origin-or-sandboxed-iframe';
        cur =
          fd.querySelector(sel) || querySelectorIncludingOpenShadow(fd.documentElement, sel);
      } else if (cur) {
        cur = cur.querySelector(sel) || querySelectorIncludingOpenShadow(cur, sel);
      } else {
        return 'unresolved';
      }
    } catch {
      return 'unresolved-invalid-selector';
    }

    if (!cur) {
      return i === 0
        ? 'unresolved-open-shadow-or-dynamic-target'
        : 'unresolved-selector-inside-frame-or-shadow';
    }
  }

  return 'unresolved-transient-or-internal';
}

/**
 * Resolve axe node.target (selector chain) to an element; supports iframe hops for same-origin frames
 * and open shadow roots.
 * @param {Window} win
 * @param {Document} doc
 * @param {string[]} target
 * @returns {Element | null}
 */
export function resolveTargetToElement(win, doc, target) {
  const chain = normalizeAxeTargetChain(target);
  if (chain.length === 0) return null;

  let current = null;

  for (let i = 0; i < chain.length; i++) {
    const sel = String(chain[i] || '').trim();
    if (!sel) return null;

    let next = null;
    try {
      if (i === 0) {
        next = doc.querySelector(sel) || querySelectorIncludingOpenShadow(doc.documentElement, sel);
      } else if (current && current.tagName === 'IFRAME') {
        const frameDoc = getIframeDocument(current);
        if (!frameDoc) return null;
        next =
          frameDoc.querySelector(sel) ||
          querySelectorIncludingOpenShadow(frameDoc.documentElement, sel);
      } else if (current) {
        next =
          current.querySelector(sel) || querySelectorIncludingOpenShadow(current, sel);
      } else {
        next = null;
      }
    } catch {
      return null;
    }

    if (!next) return null;
    current = next;
  }

  return current && current.nodeType === 1 ? current : null;
}

/**
 * Normalize computed-style string so previews cannot escape their panel (fixed/sticky popovers, stacking).
 * @param {string} styleStr
 */
function shouldNeutralizeOffCanvasTransform(transformValue) {
  const v = String(transformValue || '').trim().toLowerCase();
  if (!v || v === 'none') return false;
  // drawers/sheets slid fully off-screen — preview hosts use contain:paint and tiny boxes → solid black
  if (/translatex\s*\(\s*-?100%\s*\)/.test(v)) return true;
  if (/\btranslate\s*\(\s*-?100%/.test(v)) return true;
  if (/translate3d\s*\(\s*-?100%/.test(v)) return true;
  if (/translate3d\s*\(\s*[^,]+,\s*-?100%/.test(v)) return true;
  if (/translatex\s*\(\s*-?100vw\s*\)/.test(v)) return true;
  return false;
}

export function sanitizePreviewStyles(styleStr) {
  if (!styleStr) return '';
  let s = String(styleStr);
  s = s.replace(/position\s*:\s*fixed\b/gi, 'position:absolute');
  s = s.replace(/position\s*:\s*sticky\b/gi, 'position:relative');
  s = s.replace(/z-index\s*:\s*[^;]+/gi, 'z-index:auto');
  s = s.replace(/\btransform\s*:\s*[^;]+/gi, (full) => {
    const val = full.replace(/transform\s*:\s*/i, '').trim();
    if (shouldNeutralizeOffCanvasTransform(val)) return 'transform:none';
    return full;
  });
  return s;
}

/**
 * Worst impact per element for overlay boxes on the page overview.
 * @param {Window} win
 * @param {Document} doc
 * @param {object} results axe-shaped { violations, incomplete }
 * @param {Element} overviewRoot
 * @returns {{ i: string, nx: number, ny: number, nw: number, nh: number }[]}
 */
export function buildNormalizedViolationHighlights(win, doc, results, overviewRoot) {
  if (!results || !overviewRoot || overviewRoot.nodeType !== 1) return [];

  let rr = null;
  try {
    rr = overviewRoot.getBoundingClientRect();
  } catch {
    return [];
  }
  /** Full scrollable canvas of the overview root — NOT viewport-visible rr.height (fixes below-fold / tall pages). */
  let rw = 1;
  let rh = 1;
  try {
    rw = Math.max(1, overviewRoot.scrollWidth || rr.width || 1);
    rh = Math.max(1, overviewRoot.scrollHeight || rr.height || 1);
  } catch {
    rw = Math.max(1, rr.width || 1);
    rh = Math.max(1, rr.height || 1);
  }

  const worst = new Map();
  const lists = [results.violations, results.incomplete];

  for (const items of lists) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const impact = item?.impact || 'minor';
      for (const node of item?.nodes || []) {
        const el = resolveTargetToElement(win, doc, node.target);
        if (!el || !el.isConnected) continue;
        const prev = worst.get(el);
        if (prev == null || severityRank(impact) < severityRank(prev)) {
          worst.set(el, String(impact).toLowerCase());
        }
      }
    }
  }

  const hl = [];
  for (const [el, impact] of worst) {
    try {
      const er = el.getBoundingClientRect();
      if (!er.width && !er.height) continue;
      hl.push({
        i: impact,
        nx: (er.left - rr.left) / rw,
        ny: (er.top - rr.top) / rh,
        nw: er.width / rw,
        nh: er.height / rh,
      });
    } catch {
      /* ignore */
    }
  }

  hl.sort((a, b) => severityRank(b.i) - severityRank(a.i));
  return hl;
}

function truncateAttr(name, value, maxLen) {
  const n = String(name || '').toLowerCase();
  const s = String(value ?? '');
  if (n === 'href' || n === 'src' || n.startsWith('data-')) {
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  }
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/**
 * @param {Element} el
 * @returns {Record<string, string>}
 */
function pickAllowedAttributes(el) {
  const out = {};
  const allowed = new Set([
    'id',
    'class',
    'href',
    'src',
    'alt',
    'title',
    'role',
    'type',
    'name',
    'value',
    'placeholder',
    'for',
    'colspan',
    'rowspan',
    'scope',
    'disabled',
    'readonly',
    'checked',
    'selected',
  ]);
  const maxLen = 96;

  for (const attr of el.attributes || []) {
    const name = attr.name;
    if (allowed.has(name) || name.startsWith('data-')) {
      out[name] = truncateAttr(name, attr.value, maxLen);
    }
  }
  return out;
}

/**
 * @param {CSSStyleDeclaration} cs
 * @param {string[]} props
 */
function styleObjectFromComputed(cs, props) {
  const parts = [];
  for (const p of props) {
    try {
      const v = cs.getPropertyValue(p);
      if (v && String(v).trim()) {
        parts.push(`${p}:${v.trim()}`);
      }
    } catch {
      // ignore
    }
  }
  return parts.join(';');
}

/**
 * @param {Window} win
 * @param {Node} node
 * @param {object} opts
 * @param {number} depth
 * @param {{ n: number }} counter
 * @returns {object | null}
 */
function serializeNode(win, node, opts, depth, counter, focalRef, focalImpact) {
  if (!node) return null;
  if (counter.n >= opts.maxNodes) {
    return { truncated: true };
  }

  if (node.nodeType === 3) {
    const raw = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    counter.n += 1;
    const t = raw.length > opts.maxTextChars ? `${raw.slice(0, opts.maxTextChars)}…` : raw;
    return { x: t };
  }

  if (node.nodeType !== 1) return null;

  const el = /** @type {Element} */ (node);
  const tag = el.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) {
    return null;
  }

  if (tag === 'IFRAME') {
    counter.n += 1;
    return {
      t: 'div',
      s: 'border:1px dashed #79c0ff;padding:4px 6px;font-size:11px;color:#8fd1ff;background:rgba(48,74,110,.35)',
      c: [{ x: '[ iframe — preview unavailable in snapshot ]' }],
    };
  }

  if (depth > opts.maxDepth) {
    counter.n += 1;
    return {
      t: 'span',
      s: 'opacity:.65;font-size:10px',
      c: [{ x: `[ … deep subtree omitted (${tag}) ]` }],
    };
  }

  counter.n += 1;

  let styleStr = '';
  try {
    if (el.isConnected && win.getComputedStyle) {
      const cs = win.getComputedStyle(el);
      styleStr = sanitizePreviewStyles(styleObjectFromComputed(cs, opts.styleProps));
    }
  } catch {
    styleStr = '';
  }

  const attrs = pickAllowedAttributes(el);
  const childrenOut = [];

  const childNodes = el.childNodes;
  for (let i = 0; i < childNodes.length; i++) {
    if (counter.n >= opts.maxNodes) break;
    const serialized = serializeNode(win, childNodes[i], opts, depth + 1, counter, focalRef, focalImpact);
    if (serialized) {
      if (serialized.truncated) {
        childrenOut.push({
          t: 'span',
          s: 'font-size:10px;opacity:.7',
          c: [{ x: '[ … ]' }],
        });
        break;
      }
      if (serialized.x != null) {
        childrenOut.push(serialized);
      } else if (serialized.t) {
        childrenOut.push(serialized);
      }
    }
  }

  const out = {
    t: el.tagName.toLowerCase(),
    ...(styleStr ? { s: styleStr } : {}),
    ...(Object.keys(attrs).length ? { a: attrs } : {}),
    ...(childrenOut.length ? { c: childrenOut } : {}),
  };
  if (focalRef && el === focalRef && focalImpact) {
    out.f = String(focalImpact).toLowerCase();
  }
  return out;
}

/**
 * @param {Window} win
 * @param {Element} root
 * @param {object} branchOpts
 */
export function captureElementSubtreeSnapshot(win, focalEl, branchOpts) {
  const opts = {
    maxDepth: Number(branchOpts.maxDepth) || 8,
    maxNodes: Number(branchOpts.maxNodes) || 120,
    maxTextChars: Number(branchOpts.maxTextChars) || 100,
    styleProps: Array.isArray(branchOpts.styleProps) ? branchOpts.styleProps : DEFAULT_VISUAL_STYLE_PROPS,
  };

  if (!focalEl || focalEl.nodeType !== 1) {
    return { v: 1, err: 'no-element' };
  }

  try {
    if (!focalEl.isConnected) {
      return { v: 1, err: 'detached' };
    }
  } catch {
    return { v: 1, err: 'detached' };
  }

  const root = findVisualSnapshotContextRoot(focalEl, branchOpts);

  const focalImpact = branchOpts.focalImpact ? String(branchOpts.focalImpact).toLowerCase() : '';

  const counter = { n: 0 };
  let rect = null;
  try {
    const r = focalEl.getBoundingClientRect();
    rect = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  } catch {
    rect = null;
  }

  let visibleHint = true;
  try {
    const cs = win.getComputedStyle(focalEl);
    visibleHint =
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      Number(cs.opacity) !== 0;
  } catch {
    visibleHint = false;
  }

  const node = serializeNode(win, root, opts, 0, counter, focalEl, focalImpact);
  const truncated = counter.n >= opts.maxNodes || Boolean(node?.truncated);

  /** Preview hosts use `contain: paint`; roots that are only position:absolute/fixed children collapse to 0×0 and clip everything. */
  let contextLayout = null;
  try {
    const br = root.getBoundingClientRect();
    let w = Math.round(br.width) || 0;
    let h = Math.round(br.height) || 0;
    if (w < 2) w = Math.max(1, Math.round(root.scrollWidth || 0));
    if (h < 2) h = Math.max(1, Math.round(root.scrollHeight || 0));
    const CAP = 3600;
    contextLayout = {
      w: Math.min(CAP, Math.max(1, w)),
      h: Math.min(CAP, Math.max(1, h)),
    };
  } catch {
    contextLayout = null;
  }

  let r = null;
  if (!node) {
    r = null;
  } else if (node.truncated) {
    r = {
      t: 'div',
      s: 'padding:6px;border:1px dashed #888;font-size:11px;color:#666',
      c: [{ x: '[ subtree truncated for size ]' }],
    };
  } else {
    r = node;
  }

  return {
    v: 1,
    kind: 'element',
    rect,
    contextLayout,
    visibleHint,
    truncated,
    r,
  };
}

/**
 * Shallow structural view of the page (typically `body`).
 * @param {Window} win
 * @param {Document} doc
 * @param {object} pageOpts
 */
export function capturePageOverview(win, doc, pageOpts, axeResults = null) {
  const opts = normalizeVisualSnapshotOptions({ pageOverview: pageOpts }).pageOverview;
  const sel = String(opts.rootSelector || 'body');
  let root = null;
  try {
    root = doc.querySelector(sel) || doc.body || doc.documentElement;
  } catch {
    root = doc.body || doc.documentElement;
  }

  if (!root) {
    return { v: 1, kind: 'page', err: 'no-root' };
  }

  const branch = {
    maxDepth: opts.maxDepth,
    maxNodes: opts.maxNodes,
    maxTextChars: opts.maxTextChars,
    styleProps: pageOpts.styleProps || DEFAULT_VISUAL_STYLE_PROPS,
  };

  const snap = captureElementSubtreeSnapshot(win, root, branch);
  let hl = [];
  if (axeResults && !snap.err) {
    try {
      hl = buildNormalizedViolationHighlights(win, doc, axeResults, root);
    } catch {
      hl = [];
    }
  }

  let vw = 0;
  let vh = 0;
  try {
    vw = Math.round(win.innerWidth);
    vh = Math.round(win.innerHeight);
  } catch {
    // ignore
  }

  return {
    v: 1,
    kind: 'page',
    url: String(win.location?.href || ''),
    capturedAt: Date.now(),
    viewport: { w: vw, h: vh },
    rect: snap.rect,
    visibleHint: snap.visibleHint,
    truncated: snap.truncated,
    err: snap.err,
    r: snap.r,
    hl,
  };
}

/**
 * Attach `visualSnapshot` to each axe node on violations/incomplete lists.
 * @param {Window} win
 * @param {Document} doc
 * @param {object} results axe-shaped { violations, incomplete }
 * @param {ReturnType<typeof normalizeVisualSnapshotOptions>} vsOpts
 */
export function enrichA11yResultsWithElementSnapshots(win, doc, results, vsOpts) {
  if (!vsOpts.enabled || !vsOpts.element?.enabled || !results) return;

  let budget = Math.max(0, Number(vsOpts.maxNodesPerScan) || 0);
  const lists = [results.violations, results.incomplete];

  for (const items of lists) {
    if (!Array.isArray(items) || budget <= 0) continue;

    for (const item of items) {
      const nodes = item?.nodes;
      if (!Array.isArray(nodes)) continue;

      for (const node of nodes) {
        if (budget <= 0) break;
        if (node.visualSnapshot) {
          continue;
        }

        const el = resolveTargetToElement(win, doc, node.target);
        if (!el) {
          node.visualSnapshot = {
            v: 1,
            err: inferUnresolvedSnapshotReason(doc, node.target),
          };
          budget -= 1;
          continue;
        }

        node.visualSnapshot = captureElementSubtreeSnapshot(win, el, {
          ...vsOpts.element,
          styleProps: vsOpts.styleProps,
          focalImpact: item?.impact || 'none',
        });
        budget -= 1;
      }
    }
  }
}

/**
 * @param {Window} win
 * @param {Document} doc
 * @param {object} store-like { initial }
 * @param {ReturnType<typeof normalizeVisualSnapshotOptions>} vsOpts
 */
export function captureInitialPageVisualForStore(win, doc, store, vsOpts, axeResults = null) {
  if (!Array.isArray(store.initialPageVisuals)) {
    store.initialPageVisuals = [];
  }

  if (!vsOpts.enabled || !vsOpts.pageOverview?.enabled) {
    store.initialPageVisual = null;
    store.initialPageVisuals.length = 0;
    return;
  }

  const pageUrl = String(win.location.href);

  try {
    const snap = capturePageOverview(
      win,
      doc,
      {
        ...vsOpts.pageOverview,
        styleProps: vsOpts.styleProps,
      },
      axeResults
    );
    const entry = {
      pageUrl,
      scanOrdinal: store.initialPageVisuals.length + 1,
      ...snap,
    };
    store.initialPageVisuals.push(entry);
    store.initialPageVisual = entry;
  } catch {
    const fail = {
      v: 1,
      kind: 'page',
      err: 'capture-failed',
      pageUrl,
      scanOrdinal: store.initialPageVisuals.length + 1,
    };
    store.initialPageVisuals.push(fail);
    store.initialPageVisual = fail;
  }
}
