const { AXE_IMPACT_ORDER } = require("./a11y-shared-constants");

/** Default footnote lines for HTML reports; terminal/JSON emission reuse via exports. */
const A11Y_REPORT_DISCLAIMER_LINES = [
  "Note: Automated testing finds ~57% of WCAG issues. Analyzes visible DOM elements only.",
  "Axe-core® (github.com/dequelabs/axe-core) is a trademark of Deque Systems, Inc (deque.com).",
];

const A11Y_REPORT_DISCLAIMER = A11Y_REPORT_DISCLAIMER_LINES.join("\n");

/**
 * Single-file HTML renderer for live-a11y JSON payloads (Cypress reporter output).
 *
 * Rough layout (top → bottom of this file):
 *   Escaping & micro-UI bits → report identity helpers → severity/disposition styling helpers →
 *   node scan provenance → axe rule + failure-summary presentation → node rows / violation cards →
 *   metrics fallback & main template assembly (includes large embedded `<style>` so the HTML opens standalone).
 */

// --- Escaping & small presentation primitives (safe text + disclaimer links + option pills) ---
/** Escape text for HTML bodies so JSON/report strings cannot break markup or inject scripts. */
const escapeHtml = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

/** Safe JSON embedding inside `<script type="application/json">` (standalone HTML). */
const escapeJsonForInlineScript = (value) =>
  JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const renderVisualJsonScript = (domId, snapshotPayload) => {
  const safeId = escapeHtml(domId);
  const json = escapeJsonForInlineScript(snapshotPayload);
  return `<script type="application/json" id="${safeId}" data-a11y-visual="1">${json}</script>`;
};

/** Rule metadata for lightbox (DOM APIs apply escaping when built client-side). */
const renderRuleMetaJsonScript = (domId, violation) => {
  const vid = escapeHtml(domId);
  const meta = {
    id: violation?.id ? String(violation.id) : "",
    helpUrl: violation?.helpUrl ? String(violation.helpUrl) : "",
    help: violation?.help ? String(violation.help) : "",
    description: violation?.description ? String(violation.description) : "",
    tags: Array.isArray(violation?.tags) ? violation.tags.map((t) => String(t)) : [],
  };
  return `<script type="application/json" id="${vid}-rule-meta" data-a11y-rule-meta="1">${escapeJsonForInlineScript(
    meta
  )}</script>`;
};

const formatNodeTargetForLightboxContext = (target) => {
  if (target == null) return "";
  if (Array.isArray(target)) {
    return target.map((t) => String(t ?? "").trim()).filter(Boolean).join(" ");
  }
  return String(target).trim();
};

/** Selector + page URL for lightbox chrome (per violation row snapshot). */
const renderLightboxContextScript = (domId, node) => {
  const vid = escapeHtml(domId);
  const payload = {
    target: formatNodeTargetForLightboxContext(node?.target),
    pageUrl: node?.pageUrl ? String(node.pageUrl) : "",
  };
  return `<script type="application/json" id="${vid}-lightbox-context" data-a11y-lightbox-context="1">${escapeJsonForInlineScript(
    payload
  )}</script>`;
};

/**
 * Payload shape matches `a11y-visual-snapshot.js` (`r` = compact DOM tree).
 * @param {string} domId HTML id for JSON script + host lookup
 * @param {object} snapshotPayload
 */
const renderVisualSnapshotJsonAndHost = (domId, snapshotPayload) => {
  const safeId = escapeHtml(domId);
  return `${renderVisualJsonScript(domId, snapshotPayload)}
<div class="a11y-visual-host" data-a11y-visual-host="${safeId}" role="img" aria-label="Approximate DOM snapshot preview"></div>`;
};

/** Thumbnail + click-to-zoom for per-violation snapshots (script lives outside the button). */
const renderNodeVisualThumb = (domId, snapshotPayload, violationForLightbox = null, nodeDetail = null) => {
  const safeId = escapeHtml(domId);
  const metaBlock =
    violationForLightbox &&
    snapshotPayload &&
    snapshotPayload.r &&
    !snapshotPayload.err
      ? renderRuleMetaJsonScript(domId, violationForLightbox)
      : "";
  const contextBlock =
    nodeDetail &&
    violationForLightbox &&
    snapshotPayload &&
    snapshotPayload.r &&
    !snapshotPayload.err
      ? renderLightboxContextScript(domId, nodeDetail)
      : "";
  return `${renderVisualJsonScript(domId, snapshotPayload)}${metaBlock}${contextBlock}
<div class="a11y-visual-thumb-wrap">
<button type="button" class="a11y-visual-thumb-btn" data-a11y-zoom="${safeId}" aria-label="Enlarge DOM snapshot for this violation">
  <span class="a11y-visual-thumb-viewport">
    <span class="a11y-visual-host a11y-visual-host--thumb" data-a11y-visual-host="${safeId}" role="img" aria-hidden="true"></span>
  </span>
  <span class="a11y-visual-thumb-caption">Click to enlarge · full capture</span>
</button>
</div>`;
};

const renderVisualLightboxDialog = () => `<dialog id="a11y-visual-lightbox" class="a11y-visual-lightbox" aria-label="Full DOM snapshot and rule documentation">
  <div class="a11y-visual-lightbox-toolbar">
    <div class="a11y-visual-lightbox-context" id="a11y-visual-lightbox-context" hidden></div>
    <button type="button" class="a11y-visual-lightbox-close" data-a11y-lightbox-close="1" onclick="(function(){var d=document.getElementById('a11y-visual-lightbox');if(d)d.close();document.documentElement.style.overflow='';})();">Close</button>
  </div>
  <div class="a11y-visual-lightbox-scroll">
    <div class="a11y-visual-lightbox-host"></div>
  </div>
</dialog>`;

const renderVisualBootScript = () => `<script>
(function () {
  var SEV_COLOR = {
    critical: "#f85149",
    serious: "#db6d28",
    moderate: "#e3b341",
    minor: "#79c0ff",
    none: "#8b949e",
    incomplete: "#c4b5fd",
  };
  function walk(n, doc) {
    if (!n) return null;
    if (Object.prototype.hasOwnProperty.call(n, "x") && n.x != null && !n.t) {
      return doc.createTextNode(String(n.x));
    }
    var el = doc.createElement(n.t || "div");
    var parts = [];
    if (n.s) parts.push(n.s);
    if (n.f) {
      var fc = SEV_COLOR[String(n.f).toLowerCase()] || "#8b949e";
      parts.push(
        "box-sizing:border-box;outline:2px dashed " +
          fc +
          ";outline-offset:2px;background-color:transparent"
      );
    }
    if (parts.length) el.setAttribute("style", parts.join(";"));
    if (n.f) el.setAttribute("data-a11y-focal", "1");
    if (n.a && typeof n.a === "object") {
      Object.keys(n.a).forEach(function (k) {
        el.setAttribute(k, n.a[k]);
      });
    }
    (n.c || []).forEach(function (ch) {
      var child = walk(ch, doc);
      if (child) el.appendChild(child);
    });
    return el;
  }
  function attachHighlights(inner, data) {
    if (!inner || !data.hl || !data.hl.length) return;
    inner.style.position = "relative";
    var overlay = document.createElement("div");
    overlay.className = "a11y-violation-highlight-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:absolute;left:0;top:0;width:100%;min-width:100%;min-height:100%;pointer-events:none;box-sizing:border-box;";
    data.hl.forEach(function (h) {
      var nx = Number(h.nx);
      var ny = Number(h.ny);
      var nw = Number(h.nw);
      var nh = Number(h.nh);
      if (![nx, ny, nw, nh].every(function (v) { return typeof v === "number" && isFinite(v); })) {
        return;
      }
      var box = document.createElement("div");
      var c = SEV_COLOR[h.i] || "#8b949e";
      box.style.cssText =
        "position:absolute;left:" +
        nx * 100 +
        "%;top:" +
        ny * 100 +
        "%;width:" +
        nw * 100 +
        "%;height:" +
        nh * 100 +
        "%;border:2px dashed " +
        c +
        ";box-sizing:border-box;background:transparent;";
      overlay.appendChild(box);
    });
    inner.appendChild(overlay);
    requestAnimationFrame(function () {
      try {
        overlay.style.height = inner.scrollHeight + "px";
      } catch (e2) {}
    });
  }
  function renderIntoHost(host, data) {
    host.innerHTML = "";
    var rootNode = data.r;
    if (!rootNode) {
      host.innerHTML = '<span class="subtle">No preview data</span>';
      return null;
    }
    var inner = document.createElement("div");
    inner.className = "a11y-visual-inner";
    inner.style.position = "relative";
    inner.style.boxSizing = "border-box";
    if (data.kind === "element" && data.contextLayout) {
      var cw = Number(data.contextLayout.w);
      var ch = Number(data.contextLayout.h);
      if (cw > 0) {
        inner.style.minWidth = cw + "px";
        inner.style.display = "block";
      }
      if (ch > 0) {
        inner.style.minHeight = ch + "px";
        inner.style.display = "block";
      }
    }
    var built = walk(rootNode, document);
    if (built) inner.appendChild(built);
    host.appendChild(inner);
    attachHighlights(inner, data);
    return inner;
  }
  function fitThumbViewport(vp) {
    var host = vp.querySelector(".a11y-visual-host");
    if (!host) return;
    var inner = host.querySelector(".a11y-visual-inner");
    if (!inner) return;
    inner.style.transform = "";
    inner.style.transformOrigin = "0 0";
    var pad = 10;
    var availW = Math.max(1, vp.clientWidth - pad * 2);
    var availH = Math.max(1, vp.clientHeight - pad * 2);
    var vpR = vp.getBoundingClientRect();
    var ir = inner.getBoundingClientRect();
    var focal = inner.querySelector("[data-a11y-focal]");
    if (focal && ir.width >= 1 && ir.height >= 1) {
      var fr = focal.getBoundingClientRect();
      var fx = fr.left - ir.left;
      var fy = fr.top - ir.top;
      var fw = Math.max(fr.width, focal.offsetWidth || 0, 8);
      var fh = Math.max(fr.height, focal.offsetHeight || 0, 8);
      var maxSide = Math.max(fw, fh);
      var sidePadFrac = maxSide < 56 ? 0.65 : 0.25;
      var boxW = Math.max(fw * (1 + 2 * sidePadFrac), 48);
      var boxH = Math.max(fh * (1 + 2 * sidePadFrac), 48);
      var cx = fx + fw / 2;
      var cy = fy + fh / 2;
      var s = Math.min(availW / boxW, availH / boxH);
      if (!(s > 0) || !isFinite(s)) s = 1;
      var vpCx = vpR.width / 2;
      var vpCy = vpR.height / 2;
      var innerLeftInVp = ir.left - vpR.left;
      var innerTopInVp = ir.top - vpR.top;
      var tx = vpCx - (innerLeftInVp + cx * s);
      var ty = vpCy - (innerTopInVp + cy * s);
      inner.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
    } else {
      var iw = Math.max(inner.scrollWidth, 1);
      var ih = Math.max(inner.scrollHeight, 1);
      var s2 = Math.min(availW / iw, availH / ih, 1);
      inner.style.transformOrigin = "center center";
      inner.style.transform = "scale(" + s2 + ")";
    }
  }
  function mount(scriptId) {
    var script = document.getElementById(scriptId);
    if (!script) return;
    var hosts = document.querySelectorAll('[data-a11y-visual-host="' + scriptId + '"]');
    if (!hosts.length) return;
    var data = {};
    try {
      data = JSON.parse(script.textContent || "{}");
    } catch (e) {
      hosts.forEach(function (host) {
        host.textContent = "Preview JSON parse error";
      });
      return;
    }
    if (!data.r) {
      hosts.forEach(function (host) {
        host.innerHTML = '<span class="subtle">No preview data</span>';
      });
      return;
    }
    hosts.forEach(function (host) {
      renderIntoHost(host, data);
      var vp = host.closest(".a11y-visual-thumb-viewport");
      if (vp) {
        requestAnimationFrame(function () {
          fitThumbViewport(vp);
          requestAnimationFrame(function () {
            fitThumbViewport(vp);
          });
        });
      }
    });
  }
  function buildLightboxRulePanel(meta) {
    var wrap = document.createElement("div");
    wrap.className = "a11y-visual-lightbox-rule";
    if (!meta || (!meta.id && !meta.help && !meta.helpUrl && !(meta.tags && meta.tags.length))) {
      return wrap;
    }
    var det = document.createElement("details");
    det.className = "a11y-lightbox-rule-details";
    var sum = document.createElement("summary");
    sum.className = "a11y-lightbox-rule-summary";
    var lab = document.createElement("span");
    lab.className = "a11y-lightbox-rule-summary-lead";
    lab.textContent = "Full rule info";
    sum.appendChild(lab);
    sum.appendChild(document.createTextNode(" "));
    var rid = document.createElement("code");
    rid.className = "a11y-lightbox-rule-id-inline";
    rid.textContent = meta.id || "—";
    sum.appendChild(rid);
    if (meta.help) {
      sum.appendChild(document.createTextNode(" · "));
      var peek = document.createElement("span");
      peek.className = "a11y-lightbox-rule-help-peek";
      var ht = String(meta.help);
      peek.textContent = ht.length > 100 ? ht.slice(0, 97) + "…" : ht;
      sum.appendChild(peek);
    }
    det.appendChild(sum);
    var body = document.createElement("div");
    body.className = "a11y-lightbox-rule-body";
    if (meta.helpUrl) {
      var pl = document.createElement("p");
      pl.className = "a11y-lb-doc-lead";
      var a = document.createElement("a");
      a.href = meta.helpUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "axe-doc-primary";
      a.textContent = "Deque University — full rule documentation →";
      pl.appendChild(a);
      body.appendChild(pl);
    }
    var pH = document.createElement("p");
    pH.className = "a11y-lb-line";
    var sH = document.createElement("strong");
    sH.textContent = "Help:";
    pH.appendChild(sH);
    pH.appendChild(document.createTextNode(" " + (meta.help || "—")));
    body.appendChild(pH);
    var pD = document.createElement("p");
    pD.className = "a11y-lb-line a11y-lb-desc";
    var sD = document.createElement("strong");
    sD.textContent = "Description:";
    pD.appendChild(sD);
    pD.appendChild(document.createTextNode(" " + (meta.description || "—")));
    body.appendChild(pD);
    if (meta.tags && meta.tags.length) {
      var pT = document.createElement("p");
      pT.className = "a11y-lb-tags";
      var sT = document.createElement("strong");
      sT.textContent = "Tags:";
      pT.appendChild(sT);
      pT.appendChild(document.createTextNode(" "));
      meta.tags.forEach(function (tg, i) {
        if (i) pT.appendChild(document.createTextNode(" "));
        var sp = document.createElement("span");
        sp.className = "tag";
        sp.textContent = tg;
        pT.appendChild(sp);
      });
      body.appendChild(pT);
    }
    det.appendChild(body);
    wrap.appendChild(det);
    return wrap;
  }
  function normalizeLightboxSnapshotLayout(host) {
    var inner = host.querySelector(".a11y-visual-inner");
    if (!inner) return;
    var root = inner.firstElementChild;
    while (root && root.classList && root.classList.contains("a11y-violation-highlight-overlay")) {
      root = root.nextElementSibling;
    }
    if (!root) return;
    var cs = window.getComputedStyle(root);
    var pos = cs.position;
    if (pos !== "absolute" && pos !== "fixed") return;
    var rr = root.getBoundingClientRect();
    if (rr.width < 8 || rr.height < 8) return;
    var iw = inner.scrollWidth || inner.offsetWidth;
    var pad = 16;
    if (iw <= rr.width + pad * 3) return;
    inner.style.minWidth = "0";
    inner.style.width = Math.ceil(rr.width + pad * 2) + "px";
    inner.style.minHeight = Math.ceil(rr.height + pad * 2) + "px";
    inner.style.marginLeft = "auto";
    inner.style.marginRight = "auto";
    inner.style.boxSizing = "border-box";
    root.style.position = "relative";
    root.style.top = "0";
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.left = "0";
    root.style.width = Math.ceil(rr.width) + "px";
    root.style.minHeight = Math.ceil(rr.height) + "px";
  }
  function openLightbox(scriptId) {
    var script = document.getElementById(scriptId);
    var dlg = document.getElementById("a11y-visual-lightbox");
    if (!script || !dlg) return;
    var scroll = dlg.querySelector(".a11y-visual-lightbox-scroll");
    var lbHost = dlg.querySelector(".a11y-visual-lightbox-host");
    if (!scroll || !lbHost) return;
    var prevRule = scroll.querySelector(".a11y-visual-lightbox-rule");
    if (prevRule) prevRule.remove();
    lbHost.innerHTML = "";

    var ctxBar = document.getElementById("a11y-visual-lightbox-context");
    if (ctxBar) {
      ctxBar.innerHTML = "";
      ctxBar.setAttribute("hidden", "hidden");
    }

    var metaScript = document.getElementById(scriptId + "-rule-meta");
    var meta = null;
    if (metaScript && metaScript.textContent) {
      try {
        meta = JSON.parse(metaScript.textContent);
      } catch (eMeta) {
        meta = null;
      }
    }
    if (meta && (meta.id || meta.help || meta.helpUrl || (meta.tags && meta.tags.length))) {
      scroll.insertBefore(buildLightboxRulePanel(meta), lbHost);
    }

    var ctxScript = document.getElementById(scriptId + "-lightbox-context");
    if (ctxBar && ctxScript && ctxScript.textContent) {
      try {
        var ctx = JSON.parse(ctxScript.textContent);
        var sel = ctx.target ? String(ctx.target) : "";
        var page = ctx.pageUrl ? String(ctx.pageUrl) : "";
        if (sel || page) {
          ctxBar.removeAttribute("hidden");
          if (sel) {
            var pSel = document.createElement("p");
            pSel.className = "a11y-lightbox-ctx-row a11y-lightbox-ctx-row--selector";
            var l1 = document.createElement("strong");
            l1.textContent = "Selector: ";
            pSel.appendChild(l1);
            var c1 = document.createElement("code");
            c1.className = "a11y-lightbox-ctx-code";
            c1.textContent = sel;
            pSel.appendChild(c1);
            ctxBar.appendChild(pSel);
          }
          if (page) {
            var pPg = document.createElement("p");
            pPg.className = "a11y-lightbox-ctx-row a11y-lightbox-ctx-row--page";
            var l2 = document.createElement("strong");
            l2.textContent = "Page: ";
            pPg.appendChild(l2);
            var a = document.createElement("a");
            a.href = page;
            a.target = "_blank";
            a.rel = "noreferrer noopener";
            a.className = "a11y-lightbox-ctx-link";
            a.textContent = page;
            pPg.appendChild(a);
            ctxBar.appendChild(pPg);
          }
        }
      } catch (eCtx) {}
    }

    var data = {};
    try {
      data = JSON.parse(script.textContent || "{}");
    } catch (e) {
      return;
    }
    var inner = renderIntoHost(lbHost, data);
    if (inner) {
      inner.style.transform = "none";
      inner.style.maxWidth = "none";
      inner.style.overflow = "visible";
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        normalizeLightboxSnapshotLayout(lbHost);
        var inner2 = lbHost.querySelector(".a11y-visual-inner");
        var overlay = inner2 && inner2.querySelector(".a11y-violation-highlight-overlay");
        if (overlay && inner2) {
          try {
            overlay.style.height = inner2.scrollHeight + "px";
          } catch (eOv) {}
        }
        var focal = lbHost.querySelector("[data-a11y-focal]");
        if (focal && typeof focal.scrollIntoView === "function") {
          try {
            focal.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
          } catch (eScroll) {
            try {
              focal.scrollIntoView(true);
            } catch (e2) {}
          }
        }
      });
    });
    document.documentElement.style.overflow = "hidden";
    dlg.showModal();
  }
  function restoreHtmlScrollAfterLightbox() {
    document.documentElement.style.overflow = "";
  }
  function wireLightboxChrome() {
    var dlg = document.getElementById("a11y-visual-lightbox");
    if (!dlg || dlg.getAttribute("data-a11y-lightbox-wired") === "1") return;
    dlg.setAttribute("data-a11y-lightbox-wired", "1");
    var btn = dlg.querySelector(".a11y-visual-lightbox-close");
    function closeLightbox(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      dlg.close();
      restoreHtmlScrollAfterLightbox();
    }
    if (btn) {
      btn.addEventListener("click", closeLightbox, true);
    }
    dlg.addEventListener("close", restoreHtmlScrollAfterLightbox);
    dlg.addEventListener("cancel", restoreHtmlScrollAfterLightbox);
  }
  document.body.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-a11y-zoom]");
    if (!btn) return;
    e.preventDefault();
    var sid = btn.getAttribute("data-a11y-zoom");
    if (sid) openLightbox(sid);
  });
  function boot() {
    document.querySelectorAll('script[type="application/json"][data-a11y-visual]').forEach(function (s) {
      if (s.id) mount(s.id);
    });
  }
  function bootAll() {
    boot();
    wireLightboxChrome();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootAll);
  } else {
    bootAll();
  }
})();
</script>`;

/** Maps machine snapshot error codes to short reader-facing text. */
const formatVisualSnapshotErr = (code) => {
  const c = String(code || "").trim();
  const labels = {
    "unresolved-cross-origin-or-sandboxed-iframe":
      "Unresolved (cross-origin or sandboxed iframe — node not reachable from the test window)",
    "unresolved-open-shadow-or-dynamic-target":
      "Unresolved (open shadow DOM or selector no longer matches — try timing or shadow-friendly selectors)",
    "unresolved-selector-inside-frame-or-shadow":
      "Unresolved (selector inside iframe/shadow did not match)",
    "unresolved-invalid-selector": "Unresolved (invalid CSS selector in axe target chain)",
    "unresolved-empty-selector-segment": "Unresolved (empty selector segment in axe target)",
    unresolved: "Unresolved (element not found for axe target)",
    "unresolved-transient-or-internal":
      "Unresolved (internal diagnostic — if this persists, file an issue with the axe target payload)",
    detached: "Detached (element left the DOM before capture)",
    "no-element": "No element",
  };
  return labels[c] || `Unresolved (${escapeHtml(c)})`;
};

/** Turn disclaimer plaintext into HTML with safe links for axe-core / Deque references. */
const renderDisclaimerLineHtml = (line) =>
  escapeHtml(line)
    .replace(
      "github.com/dequelabs/axe-core",
      '<a href="https://github.com/dequelabs/axe-core" target="_blank" rel="noopener noreferrer">github.com/dequelabs/axe-core</a>'
    )
    .replace(
      "deque.com",
      '<a href="https://deque.com" target="_blank" rel="noopener noreferrer">deque.com</a>'
    );

/** Render configured axe tags / impacts as compact pills in “Analysis options”. */
const renderOptionPills = (values = []) =>
  values
    .map((value) => `<span class="option-pill">${escapeHtml(value)}</span>`)
    .join(" ");

// --- Report artifact helpers (identity strings, timestamps, deduped option lists) ---
const uniqueStringValues = (...groups) => [
  ...new Set(
    groups
      .filter(Array.isArray)
      .flat()
      .map((value) => String(value))
      .filter(Boolean)
  ),
];

/** Derive `T01`-style suffix from `reportId` or numeric test index for titles / labels. */
const reportSuffixFromArtifact = (artifact = {}) => {
  const reportIdMatch = String(artifact.reportId || "").match(/--(T\d+)(?:-|$)/i);
  if (reportIdMatch) {
    return reportIdMatch[1].toUpperCase();
  }
  if (artifact.testNumberInSpec == null) {
    return "";
  }
  return `T${String(artifact.testNumberInSpec).padStart(2, "0")}`;
};

/** Human-friendly local datetime for identity rows (“generated at”). */
const formatIsoLocal = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "medium",
    });
  } catch {
    return String(iso);
  }
};

// --- Severity & disposition → CSS classes and human labels (matches reporter impact policy semantics) ---
const severityClass = (impact) => {
  const s = String(impact || "").toLowerCase();
  if (s === "critical") return "sev-critical";
  if (s === "serious") return "sev-serious";
  if (s === "moderate") return "sev-moderate";
  if (s === "minor") return "sev-minor";
  return "sev-unknown";
};

const dispositionClass = (disposition) =>
  String(disposition || "").toLowerCase() === "warn"
    ? "disp-warn"
    : String(disposition || "").toLowerCase() === "incomplete"
      ? "disp-incomplete"
      : "disp-fail";

const dispositionLabel = (disposition) =>
  String(disposition || "").toLowerCase() === "warn"
    ? "DOES NOT FAIL TEST"
    : String(disposition || "").toLowerCase() === "incomplete"
      ? "MANUAL REVIEW RECOMMENDED"
      : "FAILS TEST";

const severitySectionPolicyOutcomeLabel = (disposition) =>
  String(disposition || "").toLowerCase() === "warn"
    ? "Checked as warnings - DOES NOT FAIL TEST"
    : "Checked as violations - FAILS TEST";

const isSeverityWarningOnlyByPolicy = (severity, impactPolicy = {}) => {
  const normalizedSeverity = String(severity || "").toLowerCase();
  const included = new Set(
    Array.isArray(impactPolicy?.included)
      ? impactPolicy.included.map((level) => String(level).toLowerCase())
      : []
  );
  const warn = new Set(
    Array.isArray(impactPolicy?.warn)
      ? impactPolicy.warn.map((level) => String(level).toLowerCase())
      : []
  );
  return warn.has(normalizedSeverity) && !included.has(normalizedSeverity);
};

const severitySectionTypeLabel = (severity, groupedBySeverityDisposition = {}, impactPolicy = {}) => {
  const entry = groupedBySeverityDisposition?.[severity];
  if (entry?.sectionType === "incomplete") return "INCOMPLETE";
  if (entry?.sectionType === "warning") return "WARNINGS";
  if (entry?.sectionType === "violation") return "VIOLATIONS";
  if (Number(entry?.incomplete || 0) > 0 && Number(entry?.warn || 0) === 0 && Number(entry?.fail || 0) === 0) {
    return "INCOMPLETE";
  }
  if (Number(entry?.warn || 0) > 0 && Number(entry?.fail || 0) === 0) return "WARNINGS";
  const normalizedSeverity = String(severity || "").toLowerCase();
  const included = new Set(
    Array.isArray(impactPolicy?.included)
      ? impactPolicy.included.map((level) => String(level).toLowerCase())
      : []
  );
  const warn = new Set(
    Array.isArray(impactPolicy?.warn)
      ? impactPolicy.warn.map((level) => String(level).toLowerCase())
      : []
  );
  if (warn.has(normalizedSeverity) && !included.has(normalizedSeverity)) return "WARNINGS";
  return "VIOLATIONS";
};

// --- Per-node “initial vs live” scan breakdown (mirrors JSON source labels / per-source counts) ---
const INITIAL_SOURCE = "full-page";

/** Pairs counts with the same human labels used in the JSON (`source` + `sourceLabel`). */
const renderNodeSourceAndCounts = (node) => {
  const inits = Number(node.initialDetections) || 0;
  const liveN = Number(node.liveDetections) || 0;
  const sources = node.sources || [];
  const labels = (node.sourceLabels && node.sourceLabels.length === sources.length
    ? node.sourceLabels
    : sources.map((s) => s));
  const sourceOccurrenceCounts = node.sourceOccurrenceCounts && typeof node.sourceOccurrenceCounts === "object"
    ? node.sourceOccurrenceCounts
    : {};

  const initialIdx = sources.findIndex((s) => s === INITIAL_SOURCE);
  const initialLabel = initialIdx >= 0 ? labels[initialIdx] : "Initial scan (full page)";

  const liveEntries = sources
    .map((s, i) => ({ s, label: labels[i] || s }))
    .filter((entry) => entry.s !== INITIAL_SOURCE);
  const seenLiveLabels = new Set();
  const uniqueLiveLabelEntries = liveEntries.reduce((acc, entry) => {
    const key = String(entry.label || "unknown");
    if (seenLiveLabels.has(key)) {
      return acc;
    }
    seenLiveLabels.add(key);
    acc.push({
      label: key,
      count: Number(sourceOccurrenceCounts[key] || 1),
    });
    return acc;
  }, []);

  const initialBlock =
    inits > 0
      ? `<div class="sc-line"><span class="sc-what">${escapeHtml(initialLabel)}</span> <span class="sc-x">× ${inits}</span></div>`
      : "";

  let liveBlock = "";
  if (liveN > 0) {
    const list =
      liveEntries.length > 0
        ? `<ul class="sc-live-parts">${uniqueLiveLabelEntries
          .map((e) => `<li>${escapeHtml(e.label)} <span class="sc-live-count">× ${e.count}</span></li>`)
          .join("")}</ul>`
        : `<p class="subtle sc-live-fallback">Live detections: ${liveN} (source details not split in this row)</p>`;
    // Same heading style as initial: label + sc-x count; list below lists per-root source labels.
    liveBlock = `<div class="sc-line sc-live-block"><div class="sc-live-head"><span class="sc-what">Live detections (by scan root)</span> <span class="sc-x">× ${liveN}</span></div>${list}</div>`;
  }

  if (!initialBlock && !liveBlock) {
    return "<span class=\"subtle\">—</span>";
  }
  return `<div class="source-counts">${initialBlock}${liveBlock}</div>`;
};

/** One-line rule-level summary of which scan roots contributed (for cards / meta). */
const formatRuleSourceSummary = (v) => {
  const sources = v.sources || [];
  const labels = (v.sourceLabels && v.sourceLabels.length === sources.length
    ? v.sourceLabels
    : null);
  if (!labels) return (sources || []).join(" — ");
  return sources.map((s, i) => labels[i] || s).join(" — ");
};

// --- Axe documentation block + failure-summary UX (Deque links, expandable axe messages) ---
/**
 * Rule-level context from grouped violation (Deque link, help, description, tags).
 * @param {object} v
 * @returns {string}
 */
const renderA11yRuleReference = (v, extraClass = "", ariaLabelSuffix = "") => {
  const helpUrl = v.helpUrl ? String(v.helpUrl) : "";
  const primaryLink = helpUrl
    ? `<p class="axe-doc-lead">
  <a class="axe-doc-primary" href="${escapeHtml(helpUrl)}" target="_blank" rel="noopener noreferrer">Deque University — full rule documentation →</a>
</p>`
    : `<p class="subtle">No <code>helpUrl</code> in this result.</p>`;
  const tags = (v.tags || []).length
    ? `<p class="axe-tags">Tags: ${(v.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")}</p>`
    : "";
  const cls = `axe-rule-ref${extraClass ? ` ${extraClass}` : ""}`;
  const ariaSuffix = ariaLabelSuffix ? ` — ${escapeHtml(ariaLabelSuffix)}` : "";
  return `<section class="${cls}" aria-label="Accessibility rule ${escapeHtml(v.id || "")}${ariaSuffix}">
  ${primaryLink}
  <p class="axe-help-title"><strong>Help:</strong> ${escapeHtml(v.help || "—")}</p>
  <p class="axe-desc"><strong>Description:</strong> ${escapeHtml(v.description || "—")}</p>
  ${tags}
</section>`;
};

/**
 * Per-node row: compact summary line (like “Show HTML”); expanded body has full rule/group docs.
 * @param {object} v grouped violation
 * @param {string} ariaLabelSuffix
 */
const renderNodeRuleHelpExpandable = (v, ariaLabelSuffix = "") => {
  const ariaSuffix = ariaLabelSuffix ? ` — ${escapeHtml(ariaLabelSuffix)}` : "";
  return `<details class="html-snippet node-rule-expand" aria-label="Rule documentation for this finding${ariaSuffix}">
  <summary class="html-snippet-summary">Help: ${escapeHtml(v.help || "—")}</summary>
  <div class="node-rule-expand-body">
    ${renderA11yRuleReference(v, "axe-rule-ref--node-expand", ariaLabelSuffix)}
  </div>
</details>`;
};

/**
 * axe-core `failureSummary` often starts with “Fix any of the following:” — use that line as the
 * `<summary>` and tuck the remainder in an expandable `<details>` so long hints stay scannable.
 */
const renderFailureSummaryBlock = (text) => {
  const raw = text == null ? "" : String(text).replace(/\r\n/g, "\n");
  if (!raw.trim()) {
    return "<p class=\"failure-empty subtle\">—</p>";
  }
  const t = raw.trim();
  if (/^fix any of the following:/i.test(t)) {
    const after = t.replace(/^fix any of the following:\s*/i, "").trim() || "—";
    return `<details class="failure-details">
  <summary class="failure-summary">Fix any of the following:</summary>
  <div class="failure failure-body">${escapeHtml(after)}</div>
</details>`;
  }
  return `<details class="failure-details">
  <summary class="failure-summary">Failure details</summary>
  <div class="failure failure-body">${escapeHtml(t)}</div>
</details>`;
};

// --- Table rows for affected nodes (target, page URL, recurrence, scans, HTML snippet) ---
/**
 * @param {object[]} nodeDetails
 * @param {object} violation Grouped rule card (same fields as renderViolationCard header / axe block).
 * @returns {string}
 */
const renderNodeRows = (nodeDetails, violation) => {
  if (!Array.isArray(nodeDetails) || nodeDetails.length === 0) {
    return "<p class=\"nodata\">No node details.</p>";
  }
  const ruleId = violation?.id;
  const safe = String(ruleId || "rule").replace(/[^a-zA-Z0-9_-]/g, "_");
  const prioritizedNodeDetails = [...nodeDetails].sort((a, b) => {
    const aRepeated = Boolean(a?.repeatedFromEarlierReport);
    const bRepeated = Boolean(b?.repeatedFromEarlierReport);
    return Number(aRepeated) - Number(bRepeated);
  });

  return prioritizedNodeDetails
    .map(
      (node, index) => {
        const rowId = `node-${safe}-${index}`;
        const visDomId = `a11y-vis-${safe}-${index}`;
        const pageLine = node.pageUrl
          ? `<p class="node-page subtle" title="Page when this node was reported">Page: <a href="${escapeHtml(
            node.pageUrl
          )}" rel="noreferrer" target="_blank">${escapeHtml(node.pageUrl)}</a></p>`
          : "";
        const rowRecurrence = Boolean(node.repeatedFromEarlierReport);
        const firstReportIdLine = rowRecurrence
          ? `<p class="node-recurrence-body">First identified in report: <code class="node-recurrence-rid">${escapeHtml(
            node.firstReportId || "unknown-report"
          )}</code></p>`
          : "";
        const recurrenceBanner = rowRecurrence
          ? `<aside class="node-recurrence" role="note" aria-label="Cross-test recurrence">
  <span class="node-recurrence-title">Same finding in an earlier report (this spec) — lower triage priority</span>
</aside>`
          : "";
        const trClass = `node-group${rowRecurrence ? " node-group--recurrence" : ""}`;
        const rowAriaSuffix = `Row ${index + 1} of ${prioritizedNodeDetails.length}`;
        const rowRuleExpand = renderNodeRuleHelpExpandable(violation, rowAriaSuffix);
        const recurrenceCompactBlock = rowRecurrence
          ? `<details class="node-recurrence-compact">
  <summary class="node-recurrence-compact-summary">Show recurring finding details</summary>
  <div class="node-recurrence-compact-body">
    ${firstReportIdLine}
    <div class="node-fix-html-column" role="group" aria-label="Fix guidance and source HTML">
      <div class="node-section node-section-axe node-section-bleed node-detail-block">
        ${renderFailureSummaryBlock(node.failureSummary)}
      </div>
      ${node.html
            ? `<div class="node-section node-section-html node-section-bleed node-detail-block">
        <details class="html-snippet">
          <summary class="html-snippet-summary">Show HTML</summary>
          <pre class="code code-block-bleed">${escapeHtml(
              node.html.length > 2000 ? `${node.html.slice(0, 2000)}…` : node.html
            )}</pre>
        </details>
      </div>`
            : ""
          }
    </div>
    <div class="node-section node-section-counts node-detail-block">
      <div class="node-section-eyebrow">Scans</div>
      <div class="node-scans-nested">${renderNodeSourceAndCounts(node)}</div>
    </div>
  </div>
</details>`
          : "";
        const standardBlock = !rowRecurrence
          ? `${rowRuleExpand}
          <div class="node-fix-html-column" role="group" aria-label="Fix guidance and source HTML">
            <div class="node-section node-section-axe node-section-bleed node-detail-block">
              ${renderFailureSummaryBlock(node.failureSummary)}
            </div>
            ${node.html
            ? `<div class="node-section node-section-html node-section-bleed node-detail-block">
              <details class="html-snippet">
                <summary class="html-snippet-summary">Show HTML</summary>
                <pre class="code code-block-bleed">${escapeHtml(
              node.html.length > 2000 ? `${node.html.slice(0, 2000)}…` : node.html
            )}</pre>
              </details>
            </div>`
            : ""
          }
          </div>
          <div class="node-section node-section-counts node-detail-block">
            <div class="node-section-eyebrow">Scans</div>
            <div class="node-scans-nested">${renderNodeSourceAndCounts(node)}</div>
          </div>`
          : "";

        let visualCell = "";
        if (rowRecurrence) {
          visualCell = `<td class="col-visual" valign="top"><span class="subtle visual-omit">Omitted (repeated finding)</span></td>`;
        } else if (node.visualSnapshot?.r) {
          visualCell = `<td class="col-visual" valign="top">${renderNodeVisualThumb(
            visDomId,
            node.visualSnapshot,
            violation,
            node
          )}</td>`;
        } else if (node.visualSnapshot?.err) {
          visualCell = `<td class="col-visual" valign="top"><span class="subtle visual-snapshot-err" title="${escapeHtml(
            node.visualSnapshot.err
          )}">${formatVisualSnapshotErr(node.visualSnapshot.err)}</span></td>`;
        } else {
          visualCell = `<td class="col-visual" valign="top"><span class="subtle">—</span></td>`;
        }

        return `
    <tr class="${trClass}" id="${rowId}">
      <th class="col-target" scope="row" valign="top">
        <div class="node-target-label">Selector / target</div>
        <p class="node-priority-chip-wrap">
          <span class="node-priority-chip ${rowRecurrence ? "node-priority-repeated" : "node-priority-new"}">
            ${rowRecurrence ? "Repeated" : "New"}
          </span>
        </p>
        <code class="node-target-code" title="${escapeHtml(node.target)}">${escapeHtml(node.target)}</code>
        ${pageLine}
      </th>
      ${visualCell}
      <td class="col-node-rollup" valign="top">
        <div class="node-rollup" role="group" aria-label="Details for this row’s target">
          ${recurrenceBanner}
          ${rowRecurrence ? rowRuleExpand : ""}
          ${standardBlock}
          ${recurrenceCompactBlock}
        </div>
      </td>
    </tr>`;
      }
    )
    .join("");
};

/** One grouped rule card: header, axe reference, stats, node table. */
const renderViolationCard = (v) => {
  const findingType = String(v.findingType || "violation").toLowerCase();
  const findingTypeBadge = findingType === "incomplete"
    ? `<span class="finding-type-badge finding-type-incomplete">INCOMPLETE - MANUAL REVIEW</span>`
    : "";
  const manualReviewNote = findingType === "incomplete"
    ? `<p class="meta incomplete-note">This finding was reported by axe-core as <strong>incomplete</strong> and should be reviewed manually.</p>`
    : "";
  return `
  <article class="violation" id="rule-${escapeHtml(v.id)}">
    <header>
      <span class="badge ${severityClass(v.impact)}">${escapeHtml(v.impact || "n/a")}</span>
      ${findingTypeBadge}
      <h3><code class="violation-rule-id">${escapeHtml(v.id)}</code></h3>
    </header>
    ${manualReviewNote}
    ${renderA11yRuleReference(v)}
    <p class="meta violation-stats">
      <strong>${Number(v.uniqueNodeCount || 0)}</strong> unique node(s)
    </p>
    <table class="nodes">
      <thead><tr><th>Selector / target</th><th>Visual snapshot</th><th>Help, fix guidance, HTML, and scans</th></tr></thead>
      <tbody>
        ${renderNodeRows(v.nodeDetails, v)}
      </tbody>
    </table>
  </article>`;
};

/** Subsection inside a severity block (violations vs incomplete/manual-review). */
const renderSeverityBucket = (title, cards = [], kind = "issues") => {
  if (!Array.isArray(cards) || cards.length === 0) return "";
  const cssClass = kind === "incomplete" ? "sev-subsection sev-subsection-incomplete" : "sev-subsection";
  return `<section class="${cssClass}">
    <h3 class="sev-subsection-title">${escapeHtml(title)}</h3>
    ${cards.map(renderViolationCard).join("\n")}
  </section>`;
};

/** Lay out technical metric keys in a fixed-width grid (N cells per table row). */
const chunkIntoRows = (items = [], rowSize = 3) => {
  const rows = [];
  for (let i = 0; i < items.length; i += rowSize) {
    rows.push(items.slice(i, i + rowSize));
  }
  return rows;
};

/**
 * When summary JSON lacks duplicate counters, derive approximate counts from `repeatedFromEarlierReport`
 * so technical metrics still explain cross-report noise.
 */
const buildFallbackDuplicateStats = (groupedViolations = []) => {
  const duplicateGroupedViolationKeys = new Set();
  const duplicateNodeKeys = new Set();

  (Array.isArray(groupedViolations) ? groupedViolations : []).forEach((violation) => {
    const ruleId = String(violation?.id || "<unknown-rule>");
    (Array.isArray(violation?.nodeDetails) ? violation.nodeDetails : []).forEach((node) => {
      if (!node?.repeatedFromEarlierReport) {
        return;
      }
      const page = String(node?.pageUrl || "");
      const target = String(node?.rawTarget || node?.target || "<unknown>");
      duplicateNodeKeys.add(`${target}@@${page}`);
      duplicateGroupedViolationKeys.add(`${ruleId}@@${page}`);
    });
  });

  return {
    duplicatedViolationsFromEarlierReports: duplicateGroupedViolationKeys.size,
    duplicatedNodesFromEarlierReports: duplicateNodeKeys.size,
  };
};

// --- Main template: assemble identity, analysis options, metrics, severity navigation, findings, footer ---
/**
 * Build the full standalone HTML document string for one report object.
 * @param {object} report
 */
const renderLiveA11yReportHtml = (report) => {
  // Pull normalized slices off the JSON payload (counts, grouped violations, monitor analysis mirrors).
  const counts = report.counts || {};
  const artifact = report.reportArtifact || {};
  const includeIncompleteInReport = report?.reportOptions?.includeIncompleteInReport === true;
  const bySevDisposition = counts.groupedBySeverityDisposition || {};
  const bySevIssues = counts.groupedBySeverityIssues || {};
  const bySevIncomplete = counts.groupedBySeverityIncomplete || {};
  const sevOrder = report.severityOrder || AXE_IMPACT_ORDER;
  const violations = report.groupedViolations || [];
  const monitorMeta = report.meta || {};
  const analysisMeta = monitorMeta.analysis || {};
  const configuredRunOnlyTags = uniqueStringValues(
    analysisMeta.configuredRunOnlyTags,
    analysisMeta.initialRunOnlyTags,
    analysisMeta.liveRunOnlyTags
  );
  const configuredImpactLevels = uniqueStringValues(
    analysisMeta.configuredImpactLevels,
    analysisMeta.initialImpactLevels,
    analysisMeta.liveImpactLevels
  );
  const configuredIncludedImpactLevels = uniqueStringValues(
    analysisMeta.configuredIncludedImpactLevels,
    analysisMeta.initialImpactLevels,
    analysisMeta.liveImpactLevels
  );
  const configuredWarnImpactLevels = uniqueStringValues(
    analysisMeta.configuredWarnImpactLevels,
    analysisMeta.initialWarnImpactLevels,
    analysisMeta.liveWarnImpactLevels
  ).filter((level) => !configuredIncludedImpactLevels.includes(level));
  const severityTotalsOrder = configuredImpactLevels.length > 0 ? configuredImpactLevels : sevOrder;
  const testInSuiteLabel = artifact.testOrdinalLabel || (artifact.testOrdinalInSuite
    ? `Test ${artifact.testOrdinalInSuite} of ${artifact.testCountInSuite} in current suite`
    : "—");
  const reportSuffix = reportSuffixFromArtifact(artifact);
  const checkpointLabel = String(artifact.checkpointLabel || "").trim();
  const checkpointSuffix = checkpointLabel
    ? ` · Checkpoint ${checkpointLabel.toUpperCase()}`
    : "";
  const testAndReportLabel = reportSuffix
    ? `${testInSuiteLabel} (${reportSuffix})${checkpointSuffix}`
    : `${testInSuiteLabel}${checkpointSuffix}`;
  const duplicateStats = buildFallbackDuplicateStats(violations);
  const reportEmissionInSpec = Number(artifact.reportEmissionInSpec || 0);

  const pageVisualEntriesRaw = Array.isArray(report.initialPageVisuals) ? report.initialPageVisuals : [];
  const pageVisualEntries = pageVisualEntriesRaw.filter((e) => e && e.r && !e.err);
  const legacySingleOverview =
    report.initialPageVisual &&
    report.initialPageVisual.r &&
    !report.initialPageVisual.err &&
    pageVisualEntries.length === 0
      ? [
        {
          pageUrl: report.initialPageUrl || report.initialPageVisual.url || "",
          ...report.initialPageVisual,
        },
      ]
      : [];
  const pageVisualSectionsList = pageVisualEntries.length > 0 ? pageVisualEntries : legacySingleOverview;

  const pagePreviewOk = pageVisualSectionsList.length > 0;
  const anyRenderableNodePreview = violations.some((v) =>
    (v.nodeDetails || []).some((n) => !n.repeatedFromEarlierReport && n.visualSnapshot?.r)
  );
  const includeVisualBoot = pagePreviewOk || anyRenderableNodePreview;

  const pageVisualOverviewJumpNav = pagePreviewOk
    ? `<nav class="page-visual-between-metrics-nav" aria-label="Page visual overview">
      <a class="page-visual-jump" href="#page-visual-full">Go to page visual overview (at end of report)</a>
    </nav>`
    : "";

  const pageVisualFullSection = pagePreviewOk
    ? `${pageVisualSectionsList
      .map((entry, idx) => {
        const scriptId = `a11y-page-overview-data-${idx}`;
        const anchorId = idx === 0 ? "page-visual-full" : `page-visual-full-${idx}`;
        const total = pageVisualSectionsList.length;
        const titleSuffix = total > 1 ? ` (${idx + 1} of ${total})` : "";
        const urlRaw = String(entry.pageUrl || entry.url || "").trim();
        const urlEsc = escapeHtml(urlRaw);
        const urlLine = urlRaw
          ? `<p class="page-visual-url-line"><strong>Initial scan URL:</strong> <a href="${urlEsc}" target="_blank" rel="noreferrer">${urlEsc}</a></p>`
          : `<p class="page-visual-url-line subtle"><strong>Initial scan URL:</strong> —</p>`;
        const vw = entry.viewport && Number(entry.viewport.w) > 0 ? Number(entry.viewport.w) : 0;
        const pageHostSizer =
          vw > 0 ? ` style="width:min(100%,${vw}px);max-width:100%;box-sizing:border-box;"` : "";
        return `<section class="page-visual-full" id="${escapeHtml(anchorId)}" aria-label="Page visual overview ${idx + 1}">
        <h2>Page visual overview${escapeHtml(titleSuffix)}</h2>
        ${urlLine}
        <p class="subtle">Serialized DOM for this page’s initial full-page scan — not a Cypress screenshot. Dashed outlines show affected elements (most severe drawn on top). One section is recorded each time the monitor runs an initial full-page scan (for example after each navigation). Checkpoint reports only include page overviews from that checkpoint scan.</p>
        ${renderVisualJsonScript(scriptId, entry)}
        <div class="page-visual-full-shell">
          <div class="a11y-visual-host"${pageHostSizer} data-a11y-visual-host="${escapeHtml(scriptId)}" role="img" aria-label="Page overview"></div>
        </div>
      </section>`;
      })
      .join("\n")}
    <p class="page-visual-back-top"><a href="#top">Back to top</a></p>`
    : "";

  // If Node reporter did not attach `report.summary`, synthesize identity + technical metrics + tooltips.
  const fallbackSummary = {
    identity: {
      reportId: artifact.reportId || "—",
      specFile: artifact.specFile || "—",
      cypressTest: artifact.testTitle || "—",
      testInSuite: testAndReportLabel,
      generatedLocal: formatIsoLocal(report.generatedAt),
      reportFileJson: artifact.fileName || "—",
    },
    technicalOrder: [
      "initialViolationsRaw",
      "liveDistinctViolationInstancesExcludingInitial",
      "totalViolationsInitialPlusLiveDistinct",
      "initialDistinctNodesWithIssues",
      "liveDistinctNodesWithIssuesExcludingInitial",
      "totalNodesInitialPlusLiveDistinct",
      "liveScansCaptured",
      "monitorDroppedScans",
      "monitorErrors",
      "duplicatedViolationsFromEarlierReports",
      "duplicatedNodesFromEarlierReports",
      "previousReportsInSpec",
    ],
    technicalMetrics: {
      initialViolationsRaw: Number(counts.initialViolations ?? 0),
      liveDistinctViolationInstancesExcludingInitial: Number(
        counts.liveDistinctViolationInstancesExcludingInitial ?? 0
      ),
      totalViolationsInitialPlusLiveDistinct: Number(
        counts.totalViolationsInitialPlusLiveDistinct ?? (
          Number(counts.initialViolations ?? 0) +
          Number(counts.liveDistinctViolationInstancesExcludingInitial ?? 0)
        )
      ),
      initialDistinctNodesWithIssues: Number(counts.initialNodesWithViolations ?? 0),
      liveDistinctNodesWithIssuesExcludingInitial: Number(
        counts.liveDistinctNodesWithIssuesExcludingInitial ?? 0
      ),
      totalNodesInitialPlusLiveDistinct: Number(
        counts.totalNodesInitialPlusLiveDistinct ?? (
          Number(counts.initialNodesWithViolations ?? 0) +
          Number(counts.liveDistinctNodesWithIssuesExcludingInitial ?? 0)
        )
      ),
      liveScansCaptured: Number(counts.liveScans ?? 0),
      monitorDroppedScans: Number(monitorMeta.dropped ?? 0),
      monitorErrors: Number((report.errors || []).length ?? 0),
      duplicatedViolationsFromEarlierReports: Number(
        duplicateStats.duplicatedViolationsFromEarlierReports ?? 0
      ),
      duplicatedNodesFromEarlierReports: Number(
        duplicateStats.duplicatedNodesFromEarlierReports ?? 0
      ),
      previousReportsInSpec: Math.max(0, reportEmissionInSpec > 0 ? reportEmissionInSpec - 1 : 0),
    },
    metricHelp: {
      initialViolationsRaw: {
        label: "Initial full-page violations (raw rule groups)",
        description: "How many violation rule groups axe found in the first full-page scan.",
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
      initialDistinctNodesWithIssues: {
        label: "Initial distinct nodes with issues",
        description: "How many unique elements had issues in the initial full-page scan.",
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
      liveScansCaptured: {
        label: "Live scans",
        description:
          "How many live/delta scans were actually executed while monitoring dynamic changes.",
        related: ["monitorDroppedScans", "monitorErrors"],
      },
      monitorDroppedScans: {
        label: "Dropped scans",
        description: "How many queued live scan attempts were dropped by the monitor queue logic.",
        related: ["liveScansCaptured", "monitorErrors"],
      },
      monitorErrors: {
        label: "Monitor errors",
        description: "Internal monitor runtime errors (engine/scan pipeline issues), not accessibility violations.",
        related: ["liveScansCaptured", "monitorDroppedScans"],
      },
      duplicatedViolationsFromEarlierReports: {
        label: "Duplicated grouped violations from earlier reports",
        description:
          "How many grouped violations (rule + page) in this report were already detected in earlier reports in the same spec file.",
        related: ["duplicatedNodesFromEarlierReports", "previousReportsInSpec"],
      },
      duplicatedNodesFromEarlierReports: {
        label: "Duplicated nodes from earlier reports",
        description:
          "How many node+page targets in this report were already seen in earlier reports in the same spec file.",
        related: ["duplicatedViolationsFromEarlierReports", "previousReportsInSpec"],
      },
      previousReportsInSpec: {
        label: "Previous reports in this spec",
        description:
          "How many reports were already emitted in this spec before this one. First report is 0.",
        related: ["duplicatedViolationsFromEarlierReports", "duplicatedNodesFromEarlierReports"],
      },
    },
  };

  const summary = report.summary || fallbackSummary;

  // Validation badge + “Report identity” table (spec, test, filenames, timestamp).
  const validationStatusRaw = String(
    summary.identity?.validationStatus || report?.validation?.status || "—"
  ).toUpperCase();
  const validationStatusClass = validationStatusRaw === "FAIL"
    ? "validation-fail"
    : validationStatusRaw === "PASS"
      ? "validation-pass"
      : "validation-unknown";
  const validationStatusBadge = `<span class="validation-badge ${validationStatusClass}">${escapeHtml(validationStatusRaw)}</span>`;
  const identityRows = [
    ["Report ID", escapeHtml(summary.identity?.reportId || "—")],
    ["Spec file", escapeHtml(summary.identity?.specFile || "—")],
    ["Cypress test", escapeHtml(summary.identity?.cypressTest || "—")],
    ["Test in suite", escapeHtml(summary.identity?.testInSuite || "—")],
    ["Local time (browser would vary)", escapeHtml(summary.identity?.generatedLocal || "—")],
    ["Report file (JSON)", escapeHtml(summary.identity?.reportFileJson || "—")],
  ];
  const identityTable = identityRows
    .map(
      ([k, val]) => {
        const renderedValue = val && typeof val === "object" && Object.prototype.hasOwnProperty.call(val, "html")
          ? val.html
          : val;
        return `
    <tr><th scope="row">${k}</th><td>${renderedValue}</td></tr>`;
      }
    )
    .join("");

  // Technical metrics as a 3-column grid; first rows visible, remainder behind `<details>`.
  const technicalOrder = Array.isArray(summary.technicalOrder) && summary.technicalOrder.length > 0
    ? summary.technicalOrder
    : fallbackSummary.technicalOrder;
  const technicalRowHtml = chunkIntoRows(technicalOrder, 3)
    .map((row) => {
      const cells = row.map((metricKey) => {
        const metricHelp = summary.metricHelp?.[metricKey] || {};
        const metricLabel = escapeHtml(metricHelp.label || metricKey);
        const metricValue = escapeHtml(summary.technicalMetrics?.[metricKey] ?? "—");
        const metricDescription = escapeHtml(metricHelp.description || "No description available.");
        const related = Array.isArray(metricHelp.related) ? metricHelp.related : [];
        const relatedLabels = related
          .map((relatedKey) => summary.metricHelp?.[relatedKey]?.label || relatedKey)
          .join(", ");
        const relatedHtml = relatedLabels
          ? `<p class="tech-related subtle"><strong>Related:</strong> ${escapeHtml(relatedLabels)}</p>`
          : "";
        return `<td class="tech-cell">
  <details class="tech-metric">
    <summary>
      <span class="tech-metric-label">${metricLabel}</span>
      <span class="tech-metric-value">${metricValue}</span>
    </summary>
    <div class="tech-metric-help">
      <p>${metricDescription}</p>
      ${relatedHtml}
    </div>
  </details>
</td>`;
      }).join("");
      const padCount = 3 - row.length;
      const pads = padCount > 0 ? "<td class=\"tech-cell tech-cell-empty\"></td>".repeat(padCount) : "";
      return `<tr>${cells}${pads}</tr>`;
    });
  const technicalPreviewRowCount = 2;
  const technicalRowsPreview = technicalRowHtml.slice(0, technicalPreviewRowCount).join("");
  const technicalRowsExpandedRemainder = technicalRowHtml.slice(technicalPreviewRowCount).join("");
  const technicalTotalRows = technicalRowHtml.length;

  // Top-of-page severity pills: deep-link into each severity section with issue/incomplete counts.
  const sevPills = severityTotalsOrder
    .map((s) => {
      const sevEntry = bySevDisposition?.[s] || {};
      const failCount = Number(sevEntry.fail || 0);
      const warnCount = Number(sevEntry.warn || 0);
      const issuesCount = failCount + warnCount || Number(bySevIssues?.[s] || 0);
      const incompleteCount = Number(sevEntry.incomplete || 0) || Number(bySevIncomplete?.[s] || 0);
      const warningOnlyByPolicy = isSeverityWarningOnlyByPolicy(s, report.impactPolicy || {});
      const sectionType = issuesCount > 0
        ? (failCount > 0 ? "VIOLATIONS" : warningOnlyByPolicy ? "WARNINGS" : "VIOLATIONS")
        : incompleteCount > 0
          ? "INCOMPLETE"
          : severitySectionTypeLabel(s, bySevDisposition, report.impactPolicy || {});
      const breakdownLabel = includeIncompleteInReport
        ? `ISSUES ${issuesCount} | INCOMPLETE ${incompleteCount}`
        : `ISSUES ${issuesCount}`;
      return `<a class="sev-pill ${severityClass(s)}" href="#sev-${escapeHtml(s)}">${sectionType} - ${escapeHtml(s)}: ${breakdownLabel}</a>`;
    })
    .join(" ");

  // Static recap of how axe was configured for this run (tags, fail vs warn impacts, incomplete flag).
  const analysisOptions = `
      <h2>Analysis Options</h2>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Scan mode</span>
        <span class="analysis-option-values">${escapeHtml(String(artifact.scanType || "live").toUpperCase())}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Rule tags used</span>
        <span class="analysis-option-values">${renderOptionPills(configuredRunOnlyTags) || "All configured axe-core rules"}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Impacts that fail</span>
        <span class="analysis-option-values">${renderOptionPills(configuredIncludedImpactLevels) || '<span class="subtle">None</span>'}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Impacts that warn only</span>
        <span class="analysis-option-values">${renderOptionPills(configuredWarnImpactLevels) || '<span class="subtle">None</span>'}</span>
      </div>
      <div class="analysis-option-row">
        <span class="analysis-option-label">Include incomplete findings</span>
        <span class="analysis-option-values">${report?.reportOptions?.includeIncompleteInReport ? "Yes" : "No (default)"}</span>
      </div>`;

  // Main findings body: one block per axe severity, splitting violation vs incomplete cards when enabled.
  const bySeveritySections = sevOrder
    .map((sev) => {
      const list = violations.filter((v) => String(v.impact || "").toLowerCase() === sev);
      if (list.length === 0) return "";
      const issueCards = list.filter((v) => String(v?.disposition || "").toLowerCase() !== "incomplete");
      const incompleteCards = list.filter((v) => String(v?.disposition || "").toLowerCase() === "incomplete");
      const sectionCounts = bySevDisposition?.[sev] || {};
      const failCount = Number(sectionCounts.fail || 0);
      const warnCount = Number(sectionCounts.warn || 0);
      const incompleteCount = Number(sectionCounts.incomplete || 0) || Number(bySevIncomplete?.[sev] || 0);
      const normalizedSeverity = String(sev || "").toLowerCase();
      const included = new Set(
        Array.isArray(report?.impactPolicy?.included)
          ? report.impactPolicy.included.map((level) => String(level).toLowerCase())
          : []
      );
      const warn = new Set(
        Array.isArray(report?.impactPolicy?.warn)
          ? report.impactPolicy.warn.map((level) => String(level).toLowerCase())
          : []
      );
      const checkedAsWarnings = warn.has(normalizedSeverity) && !included.has(normalizedSeverity);
      const sectionDisposition = checkedAsWarnings ? "warn" : "fail";
      const issueCount = failCount + warnCount || Number(bySevIssues?.[sev] || 0);
      const issueBucketTitle = checkedAsWarnings
        ? "Warning issues (does not fail test)"
        : "Violation issues (fails test)";
      const issueSummaryLabel = checkedAsWarnings
        ? "WARNING ISSUES"
        : "VIOLATION ISSUES";
      const sectionBody = [
        renderSeverityBucket(issueBucketTitle, issueCards, "issues"),
        includeIncompleteInReport
          ? renderSeverityBucket("Incomplete (manual review)", incompleteCards, "incomplete")
          : "",
      ].filter(Boolean).join("\n");
      const breakdownSummary = includeIncompleteInReport
        ? `${issueSummaryLabel}: ${issueCount} · INCOMPLETE: ${incompleteCount}`
        : `${issueSummaryLabel}: ${issueCount}`;
      return `
  <section class="sev-block ${severityClass(sev)}-section" id="sev-${escapeHtml(sev)}" aria-labelledby="sev-${escapeHtml(sev)}-heading">
    <header class="sev-block-header">
      <div>
        <h2 class="sev-block-title" id="sev-${escapeHtml(sev)}-heading">
          <span class="sev-block-title-label">Severity section</span>
          <span class="badge ${severityClass(sev)}">${escapeHtml(sev)}</span>
        </h2>
        <p class="sev-policy-line">
          <span class="outcome-badge ${dispositionClass(sectionDisposition)}">${escapeHtml(
        severitySectionPolicyOutcomeLabel(sectionDisposition)
      )}</span>
        </p>
        <p class="sev-breakdown subtle">${breakdownSummary}</p>
      </div>
      <a class="sev-block-top-link" href="#top">Back to summary</a>
    </header>
    <div class="sev-block-body">
      ${sectionBody}
    </div>
    <div class="sev-block-end" aria-hidden="true">End of ${String(sev).toUpperCase()} severity section (${escapeHtml(
        dispositionLabel(sectionDisposition).toLowerCase()
      )})</div>
  </section>`;
    })
    .join("");

  // Monitor pipeline errors (not axe violations) + disclaimer footnote lines from JSON or package default.
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const footnoteLines = Array.isArray(report.footnote?.lines)
    ? report.footnote.lines
    : A11Y_REPORT_DISCLAIMER_LINES;
  const footnoteHtml = footnoteLines.map(renderDisclaimerLineHtml).join("<br />");
  const errorsBlock =
    errors.length === 0
      ? ""
      : `<section class="errors"><h2>Monitor / runtime errors (${errors.length})</h2><ul>${errors
        .map(
          (e) =>
            `<li><code>${escapeHtml(e.message || e.reason || JSON.stringify(e))}</code></li>`
        )
        .join("")}</ul></section>`;

  // Full document shell. Styles are inlined so the file is portable (email, file://, CI artifacts).
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>wick-a11y-observer report — ${escapeHtml(artifact.reportId || artifact.specStem || "run")}</title>
  <style>
    :root {
      --bg: #0d131b;
      --card: #172130;
      --text: #f2f7ff;
      --muted: #d2deed;
      --border: #617891;
      --link: #8fd1ff;
      --focus: #ffd166;
    }
    * { box-sizing: border-box; }
    html { font-size: 16px; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      margin: 0;
      padding: 1.5rem 1.25rem 3rem;
    }
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 0;
      z-index: 10000;
      padding: 0.55rem 0.75rem;
      border-radius: 8px;
      background: #fff8d6;
      color: #101418;
      border: 2px solid #101418;
      font-weight: 700;
    }
    .skip-link:focus,
    .skip-link:focus-visible {
      left: 1rem;
      top: 1rem;
    }
    .wrap { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
    h2 { font-size: 1.1rem; margin: 0; font-weight: 600; }
    h3 { font-size: 1rem; margin: 0; display: inline; font-weight: 600; }
    a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
    a:hover { color: #b4e0ff; }
    :where(a, button, summary, [role="button"], [tabindex]):focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
      border-radius: 4px;
    }
    .subtle { color: var(--muted); font-size: 1rem; }
    .summary {
      width: 100%;
      border-collapse: collapse;
      background: var(--card);
      border-radius: 8px;
      overflow: hidden;
      margin: 0.5rem 0 1rem;
    }
    .summary th, .summary td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
    .summary th { width: 42%; color: var(--muted); font-weight: 500; }
    .validation-status-row th,
    .validation-status-row td {
      font-weight: 700;
    }
    .validation-status-row.validation-pass th,
    .validation-status-row.validation-pass td {
      background: #0f2a1f;
      border-bottom-color: #296b47;
    }
    .validation-status-row.validation-fail th,
    .validation-status-row.validation-fail td {
      background: #361414;
      border-bottom-color: #7a2d2d;
    }
    .validation-status-row.validation-unknown th,
    .validation-status-row.validation-unknown td {
      background: #212a34;
      border-bottom-color: #3b4f66;
    }
    .validation-badge {
      display: inline-block;
      font-weight: 800;
      letter-spacing: 0.02em;
      font-size: 0.95rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      border: 2px solid currentColor;
    }
    .validation-badge.validation-pass {
      color: #9ce8b8;
      background: #123121;
    }
    .validation-badge.validation-fail {
      color: #ffb3b3;
      background: #4a1d1d;
    }
    .validation-badge.validation-unknown {
      color: #c8d5e3;
      background: #2a3948;
    }
    .summary-groups {
      display: grid;
      grid-template-columns: minmax(18rem, 1fr);
      gap: 1rem;
      margin: 1rem 0 1.25rem;
    }
    .summary-group {
      background: #111821;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.7rem 0.75rem 0.15rem;
    }
    .summary-group h2 {
      font-size: 1.25rem;
      margin: 0.15rem 0 0.35rem;
    }
    .summary-group .subtle {
      margin: 0;
    }
    .validation-callout {
      margin: 0.45rem 0 0.6rem;
      font-size: 1rem;
      font-weight: 700;
    }
    .tech-grid {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0.5rem;
      margin: 0.35rem 0 0.65rem;
    }
    .tech-grid-preview {
      margin: 0.35rem 0 0.35rem;
    }
    .tech-expand {
      margin: 0.2rem 0 0.65rem;
    }
    .page-visual-between-metrics-nav {
      margin: 0.35rem 0 1.15rem;
      padding: 0.55rem 0 0.85rem;
      border-bottom: 1px dashed var(--border);
    }
    .node-rule-expand { margin: 0 0 0.55rem; }
    .node-rule-expand-body {
      margin-top: 0.45rem;
      padding-top: 0.35rem;
      border-top: 1px dashed var(--border);
    }
    .node-rule-expand-body .axe-rule-ref--node-expand {
      margin: 0;
    }
    .page-visual-jump {
      display: inline-block;
      font-size: 0.92rem;
      font-weight: 600;
      color: var(--link);
      text-decoration: none;
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(56, 139, 253, 0.1);
    }
    .page-visual-jump:hover {
      text-decoration: underline;
      border-color: var(--link);
    }
    .page-visual-jump:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .tech-expand > summary {
      cursor: pointer;
      list-style: none;
      color: var(--link);
      font-size: 0.88rem;
      font-weight: 600;
      outline: none;
      padding: 0.1rem 0;
    }
    .tech-expand > summary::-webkit-details-marker { display: none; }
    .tech-expand > summary::before {
      content: "▶ ";
      font-size: 0.72rem;
      color: var(--muted);
    }
    .tech-expand[open] > summary::before { content: "▼ "; }
    .tech-expand-hint {
      display: inline-block;
      margin-left: 0.25rem;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 500;
    }
    .tech-grid-expanded {
      margin-top: 0.25rem;
    }
    .tech-cell {
      width: 33.33%;
      vertical-align: top;
      background: #161b22;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.4rem 0.5rem;
    }
    .tech-cell-empty {
      background: transparent;
      border-style: dashed;
      border-color: #232a34;
    }
    .tech-metric summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.22rem;
      outline: none;
    }
    .tech-metric summary::-webkit-details-marker { display: none; }
    .tech-metric summary::before {
      content: "▶";
      font-size: 0.65rem;
      color: var(--muted);
      margin-right: 0.32rem;
      display: inline-block;
      vertical-align: middle;
    }
    .tech-metric[open] summary::before { content: "▼"; }
    .tech-metric-label {
      color: var(--muted);
      font-size: 0.88rem;
      font-weight: 600;
      line-height: 1.25;
    }
    .tech-metric-value {
      color: var(--text);
      font-size: 1.1rem;
      font-weight: 700;
      line-height: 1.1;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      margin-left: 0.98rem;
    }
    .tech-metric-help {
      margin-top: 0.45rem;
      border-top: 1px dashed var(--border);
      padding-top: 0.45rem;
      font-size: 0.84rem;
      color: #c9d1d9;
      line-height: 1.45;
    }
    .tech-metric-help p {
      margin: 0.25rem 0;
    }
    .analysis-option-row {
      display: grid;
      grid-template-columns: minmax(9rem, 13rem) 1fr;
      gap: 0.75rem;
      align-items: baseline;
      margin: 0.45rem 0;
    }
    .analysis-option-label { color: var(--muted); font-size: 0.95rem; font-weight: 700; }
    .analysis-option-values { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .option-pill {
      display: inline-block;
      background: #21262d;
      border: 1px solid var(--border);
      border-radius: 999px;
      color: #c9d1d9;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 0.9rem;
      padding: 0.12rem 0.45rem;
    }
    .severity-entry-title {
      margin: 2rem 0 0.75rem;
      padding-top: 1.4rem;
      border-top: 3px solid var(--border);
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: #eaf2ff;
    }
    .sev-pills { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0 1rem; }
    .sev-pill { text-decoration: none; padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.95rem; font-weight: 700; }
    .sev-critical { background: #5f0000; color: #fff0ee; }
    .sev-serious { background: #5b2b00; color: #fff2df; }
    .sev-moderate { background: #3d3518; color: #f3d35a; }
    .sev-minor { background: #1c2a3d; color: #79c0ff; }
    .sev-unknown { background: #2d2d2d; color: #aaa; }
    .sev-block {
      margin: 2.25rem 0 3rem;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #111821;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
      overflow: hidden;
    }
    .sev-block-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.1rem;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(90deg, rgba(88, 166, 255, 0.12), rgba(88, 166, 255, 0.02));
    }
    .sev-critical-section { border-color: rgba(248, 81, 73, 0.55); }
    .sev-critical-section .sev-block-header { background: linear-gradient(90deg, rgba(248, 81, 73, 0.22), rgba(248, 81, 73, 0.04)); }
    .sev-serious-section { border-color: rgba(255, 166, 87, 0.55); }
    .sev-serious-section .sev-block-header { background: linear-gradient(90deg, rgba(255, 166, 87, 0.24), rgba(255, 166, 87, 0.05)); }
    .sev-moderate-section { border-color: rgba(243, 211, 90, 0.55); }
    .sev-moderate-section .sev-block-header { background: linear-gradient(90deg, rgba(243, 211, 90, 0.22), rgba(243, 211, 90, 0.05)); }
    .sev-minor-section { border-color: rgba(121, 192, 255, 0.5); }
    .sev-minor-section .sev-block-header { background: linear-gradient(90deg, rgba(121, 192, 255, 0.2), rgba(121, 192, 255, 0.04)); }
    .sev-block-eyebrow {
      margin: 0 0 0.35rem;
      color: var(--muted);
      font-size: 0.86rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .sev-block-title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .sev-block-title-label {
      color: var(--muted);
      font-size: 0.86rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .sev-block-top-link {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 0.92rem;
      text-decoration: none;
      padding: 0.2rem 0.45rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(13, 17, 23, 0.4);
    }
    .sev-block-top-link:hover { color: var(--link); border-color: var(--link); }
    .sev-block-body {
      padding: 1rem 1rem 0.15rem;
    }
    .sev-subsection {
      margin-bottom: 1rem;
    }
    .sev-subsection-title {
      margin: 0.15rem 0 0.6rem;
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      line-height: 2.5;
    }
    .sev-subsection-incomplete .sev-subsection-title {
      color: #c4b5fd;
    }
    .sev-block-end {
      margin: 0.25rem 1rem 1rem;
      padding-top: 0.75rem;
      border-top: 1px dashed var(--border);
      color: var(--muted);
      font-size: 0.88rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    .violation {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1rem 0.5rem;
      margin-bottom: 1rem;
    }
    .violation-rule-id { font-size: 0.95rem; font-weight: 600; }
    .axe-rule-ref {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
      margin: 0.6rem 0 0.75rem;
    }
    .axe-doc-lead { margin: 0 0 0.35rem; }
    .axe-doc-primary {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--link);
      text-decoration: none;
    }
    .axe-doc-primary:hover { text-decoration: underline; }
    .axe-help-title, .axe-desc { font-size: 0.9rem; margin: 0.4rem 0; line-height: 1.45; }
    .axe-tags { margin: 0.45rem 0 0.15rem; font-size: 0.85rem; }
    .violation-stats { margin: 0.4rem 0; }
    .violation header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .badge { font-size: 0.7rem; text-transform: uppercase; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; }
    .outcome-badge {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-weight: 700;
    }
    .disp-fail {
      background: rgba(248, 81, 73, 0.15);
      color: #f85149;
      border-color: rgba(248, 81, 73, 0.45);
    }
    .disp-warn {
      background: rgba(227, 179, 65, 0.16);
      color: #e3b341;
      border-color: rgba(227, 179, 65, 0.45);
    }
    .disp-incomplete {
      background: rgba(123, 92, 255, 0.16);
      color: #c4b5fd;
      border-color: rgba(123, 92, 255, 0.5);
    }
    .finding-type-badge {
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-weight: 700;
    }
    .finding-type-incomplete {
      background: rgba(123, 92, 255, 0.16);
      color: #c4b5fd;
      border-color: rgba(123, 92, 255, 0.5);
    }
    .incomplete-note {
      margin: 0.35rem 0 0.55rem;
      color: #c4b5fd;
    }
    .sev-policy-line {
      margin: 0.35rem 0 0;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem;
    }
    .sev-policy-chip {
      display: inline-block;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
      background: rgba(13, 17, 23, 0.45);
      font-weight: 700;
    }
    .sev-breakdown { margin: 0.45rem 0 0; font-size: 0.88rem; }
    .help { margin: 0.5rem 0; }
    .meta { font-size: 0.9rem; color: var(--muted); }
    .tag { display: inline-block; background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.88rem; margin: 0.1rem; }
    .ext { font-size: 1rem; }
    .nodes { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 0.88rem; margin: 0.75rem 0; }
    .nodes th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--border); padding: 0.4rem; }
    .nodes th:first-child { width: 22%; }
    .nodes th:nth-child(2) { width: 20%; }
    .nodes th:last-child { width: 58%; }
    .nodes td, .nodes th.col-target {
      vertical-align: top;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid var(--border);
    }
    .nodes th.col-target {
      text-align: left;
      font-weight: 400;
    }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .node-group { border-left: 3px solid #30363d; }
    .node-group--recurrence { border-left: 4px solid #c9d1d9; }
    .node-group td { background: #161b22; }
    .node-group--recurrence td {
      background: #222b36;
      color: #e6edf3;
    }
    .node-group--recurrence td,
    .node-group--recurrence th.col-target {
      padding: 0.28rem 0.3rem;
    }
    .node-group--recurrence .node-target-label {
      font-size: 0.76rem;
      margin-bottom: 0.12rem;
    }
    .node-group--recurrence .node-target-code {
      font-size: 0.74rem;
      line-height: 1.3;
    }
    .node-group--recurrence .node-page {
      margin-top: 0.25rem;
      font-size: 0.84rem;
      line-height: 1.35;
    }
    .node-repeat-pill { margin: 0.4rem 0 0; font-size: 0.76rem; color: #d0d7de; }
    .node-repeat-pill-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.68rem; }
    .node-repeat-pill code { background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.75rem; color: #e6edf3; }
    .node-recurrence {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      margin: 0 0 0.4rem;
      padding: 0.38rem 0.52rem;
      background: #2a3441;
      border: 1px solid #7d8590;
      border-radius: 6px;
    }
    .node-recurrence-title { display: block; font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; margin-bottom: 0.2rem; }
    .node-recurrence-body { margin: 0; font-size: 0.84rem; color: #c9d1d9; line-height: 1.4; }
    .node-recurrence-rid { font-size: 0.8rem; background: #0d1117; padding: 0.15rem 0.4rem; border-radius: 4px; }
    .node-recurrence-compact { margin-top: 0.3rem; }
    .node-recurrence-compact-summary {
      cursor: pointer;
      color: var(--link);
      font-size: 0.85rem;
      list-style: none;
      padding: 0;
    }
    .node-recurrence-compact .node-recurrence-compact-summary::-webkit-details-marker { display: none; }
    .node-recurrence-compact-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .node-recurrence-compact[open] .node-recurrence-compact-summary::before { content: "▼ "; }
    .node-recurrence-compact-body { margin-top: 0.4rem; }
    .node-target-label { font-size: 0.86rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.3rem; }
    .node-priority-chip-wrap { margin: 0 0 0.3rem; }
    .node-priority-chip {
      display: inline-block;
      border-radius: 999px;
      padding: 0.08rem 0.45rem;
      font-size: 0.66rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid var(--border);
    }
    .node-priority-new {
      background: rgba(58, 166, 85, 0.16);
      color: #56d364;
      border-color: rgba(86, 211, 100, 0.45);
    }
    .node-priority-repeated {
      background: #3a4553;
      color: #ffffff;
      border-color: #c9d1d9;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
      padding: 0.06rem 0.4rem;
      font-size: 0.62rem;
    }
    .node-group--recurrence .node-fix-html-column {
      margin-top: 0.2rem;
      padding-top: 0.08rem;
      padding-left: 0.7rem;
    }
    .node-group--recurrence .node-section-counts .node-scans-nested {
      padding-left: 0.7rem;
    }
    .node-group--recurrence .node-section-eyebrow {
      font-size: 0.74rem;
      margin-bottom: 0.22rem;
    }
    .node-target-code { display: block; font-size: 0.8rem; word-break: break-all; }
    .node-page { margin: 0.4rem 0 0; font-size: 0.92rem; word-break: break-all; }
    .node-page a { color: var(--link); }
    .node-rollup { padding: 0; text-align: left; width: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: stretch; }
    .node-detail-block { width: 100%; max-width: 100%; align-self: stretch; }
    .node-section { margin-top: 0.55rem; }
    .node-section-counts { margin-top: 0.1rem; }
    .node-section-counts .node-scans-nested {
      margin-top: 0.2rem;
      padding: 0.35rem 0 0.15rem 1.1rem;
      border-left: 2px solid #30363d;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
    }
    .node-section-eyebrow { font-size: 0.8rem; font-weight: 600; color: var(--muted); margin: 0 0 0.35rem; }
    .node-section-bleed { text-align: left; width: 100%; max-width: 100%; }
    .node-section-axe { margin-top: 0.6rem; }
    .node-section-html { margin-top: 0.5rem; }
    .source-counts { font-size: 0.88rem; }
    .sc-line { margin: 0.3rem 0; }
    .sc-what { font-weight: 600; }
    .sc-x { font-weight: 700; color: #58a6ff; margin-left: 0.2rem; }
    .sc-live-block { margin-top: 0.4rem; padding-top: 0.35rem; border-top: 1px solid var(--border); }
    .sc-live-head { margin-bottom: 0.2rem; }
    .sc-live-parts { list-style: disc; margin: 0.2rem 0 0.15rem; padding: 0 0 0 1.4rem; text-align: left; }
    .sc-live-parts li { margin: 0.2rem 0; padding: 0 0 0 0.2rem; }
    .sc-live-count { color: var(--muted); font-size: 0.8rem; font-weight: 600; }
    .sc-live-fallback { margin: 0.2rem 0 0 0.75rem; }
    .node-fix-html-column {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      margin-top: 0.5rem;
      padding: 0.4rem 0 0.15rem 1.1rem;
      border-left: 2px solid #30363d;
    }
    .node-fix-html-column .node-section-axe,
    .node-fix-html-column .node-section-html { margin-top: 0.45rem; }
    .node-fix-html-column .node-section-axe:first-child { margin-top: 0; }
    .node-fix-html-column .failure-details,
    .node-fix-html-column .html-snippet { width: 100%; max-width: 100%; box-sizing: border-box; }
    .node-fix-html-column .failure-body,
    .node-fix-html-column .code-block-bleed { width: 100%; box-sizing: border-box; }
    .sc-rule-src { display: inline; }
    .pill { display: inline-block; background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; margin-right: 0.25rem; font-size: 0.9rem; }
    .pill.subtle { background: transparent; color: var(--muted); }
    .node-section-bleed .failure-details, .node-section-bleed .html-snippet { width: 100%; max-width: 100%; text-align: left; }
    .failure-details { margin: 0.1rem 0 0.4rem; }
    .failure-summary { cursor: pointer; color: var(--link); font-size: 1rem; list-style: none; text-align: left; padding: 0; }
    .failure-details .failure-summary::-webkit-details-marker { display: none; }
    .failure-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .failure-details[open] .failure-summary::before { content: "▼ "; }
    .failure { white-space: pre-wrap; font-size: 1rem; color: #dce6f5; text-align: left; }
    .failure-body { margin: 0.35rem 0 0.15rem; padding: 0.6rem 0.65rem; background: #0d1117; border-radius: 6px; border: 1px solid var(--border); width: 100%; max-width: 100%; box-sizing: border-box; }
    .failure-empty { margin: 0.25rem 0; }
    .html-snippet { margin: 0; width: 100%; max-width: 100%; }
    .html-snippet-summary { cursor: pointer; color: var(--link); font-size: 1rem; text-align: left; list-style: none; padding: 0; }
    .html-snippet .html-snippet-summary::-webkit-details-marker { display: none; }
    .html-snippet .html-snippet-summary::before { content: "▶ "; font-size: 0.7rem; color: var(--muted); }
    .html-snippet[open] .html-snippet-summary::before { content: "▼ "; }
    .code, .code-block-bleed { background: #0d1117; padding: 0.6rem 0.65rem; border-radius: 6px; overflow: auto; max-height: 280px; font-size: 0.9rem; text-align: left; width: 100%; max-width: 100%; box-sizing: border-box; }
    .errors { margin-top: 2rem; }
    .errors ul { color: #f85149; }
    .nodata { color: var(--muted); }
    footer { margin-top: 2rem; font-size: 0.95rem; color: var(--muted); }
    .report-footnote { margin-top: 0.75rem; }
    .page-visual-url-line {
      margin: 0.35rem 0 0.75rem;
      font-size: 0.92rem;
      word-break: break-all;
    }
    .page-visual-url-line a { color: var(--link); }
    .page-visual-back-top { margin: 1rem 0 0; font-size: 0.92rem; }
    .page-visual-full {
      margin: 2rem 0 1rem;
      padding: 1rem 0 0;
      border-top: 1px solid var(--border);
    }
    .page-visual-full-shell {
      max-height: 78vh;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: #0d1117;
      margin-top: 0.5rem;
      transform: translateZ(0);
      isolation: isolate;
      contain: layout paint;
    }
    .a11y-visual-host {
      display: block;
      min-height: 20px;
      font-size: 12px;
      line-height: 1.35;
      color: var(--text);
      transform: translateZ(0);
      isolation: isolate;
      contain: layout paint;
      position: relative;
      overflow: auto;
      max-width: 100%;
    }
    .a11y-visual-inner {
      display: inline-block;
      max-width: 100%;
      vertical-align: top;
      position: relative;
    }
    .a11y-visual-thumb-wrap { max-width: 260px; }
    .a11y-visual-thumb-btn {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      width: 100%;
      padding: 8px;
      margin: 0;
      cursor: zoom-in;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      color: var(--muted);
      font: inherit;
      text-align: center;
    }
    .a11y-visual-thumb-btn:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .a11y-visual-thumb-viewport {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 168px;
      overflow: hidden;
      border-radius: 6px;
      background: #010409;
      box-sizing: border-box;
      padding: 10px;
      transform: translateZ(0);
      isolation: isolate;
      /* Avoid contain:size — it can zero-size the thumb host so previews paint as empty/black. */
      contain: layout paint;
    }
    .a11y-visual-host--thumb {
      flex: 0 0 auto;
      font-size: 11px;
      line-height: 1.35;
      overflow: hidden !important;
      max-width: none;
      max-height: none;
      contain: layout paint;
      isolation: isolate;
      transform: translateZ(0);
    }
    .a11y-visual-thumb-caption { font-size: 0.72rem; color: var(--muted); line-height: 1.3; }
    /* Closed <dialog> must stay hidden; plain display:flex overrides UA dialog:not([open]) rules. */
    .a11y-visual-lightbox:not([open]) {
      display: none !important;
    }
    .a11y-visual-lightbox[open] {
      display: flex;
      flex-direction: column;
      max-width: min(96vw, 1100px);
      width: min(96vw, 1100px);
      max-height: 90vh;
      margin: auto;
      border: 2px solid #f78166;
      border-radius: 12px;
      background: #161b22;
      color: var(--text);
      padding: 0;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.12),
        0 8px 28px rgba(0, 0, 0, 0.45),
        0 28px 90px rgba(0, 0, 0, 0.72);
      overflow: hidden;
    }
    .a11y-visual-lightbox::backdrop {
      background: rgba(5, 8, 14, 0.88);
      backdrop-filter: blur(3px);
    }
    .a11y-visual-lightbox-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-shrink: 0;
      padding: 10px 12px;
      margin: 0;
      border-bottom: 1px solid rgba(248, 129, 102, 0.45);
      background: linear-gradient(180deg, #0d1117 0%, #0b0f14 100%);
    }
    .a11y-visual-lightbox-context {
      flex: 1;
      min-width: 0;
      text-align: left;
      font-size: 0.78rem;
      line-height: 1.45;
      color: var(--muted);
    }
    .a11y-visual-lightbox-context[hidden] {
      display: none !important;
    }
    .a11y-lightbox-ctx-row {
      margin: 0 0 0.28rem;
    }
    .a11y-lightbox-ctx-row:last-child {
      margin-bottom: 0;
    }
    .a11y-lightbox-ctx-row--selector .a11y-lightbox-ctx-code {
      font-size: 1rem;
      line-height: 1.45;
    }
    .a11y-lightbox-ctx-row--selector strong {
      font-size: 0.85rem;
    }
    .a11y-lightbox-ctx-row--page {
      font-size: 0.78rem;
    }
    .a11y-lightbox-ctx-row--page strong {
      font-size: 0.78rem;
    }
    .a11y-lightbox-ctx-code {
      font-size: 0.76rem;
      word-break: break-word;
      color: var(--text);
    }
    .a11y-lightbox-ctx-link {
      color: var(--link);
      text-decoration: none;
      word-break: break-all;
    }
    .a11y-lightbox-ctx-link:hover {
      text-decoration: underline;
    }
    .a11y-visual-lightbox-close {
      cursor: pointer;
      font: inherit;
      padding: 0.35rem 0.85rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      flex-shrink: 0;
      align-self: flex-start;
    }
    .a11y-visual-lightbox-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: auto;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 14px;
      box-sizing: border-box;
      -webkit-overflow-scrolling: touch;
      background: linear-gradient(180deg, rgba(13, 17, 23, 0.98) 0%, rgba(22, 27, 34, 0.99) 100%);
      border-top: 1px solid rgba(248, 129, 102, 0.35);
    }
    .a11y-visual-lightbox-rule {
      margin: 0 0 12px;
    }
    .a11y-lightbox-rule-details {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #0d1117;
      padding: 0;
      overflow: hidden;
    }
    .a11y-lightbox-rule-summary {
      cursor: pointer;
      list-style: none;
      padding: 8px 12px;
      font-size: 0.82rem;
      line-height: 1.4;
      color: var(--text);
      background: rgba(22, 27, 34, 0.95);
    }
    .a11y-lightbox-rule-summary::-webkit-details-marker { display: none; }
    .a11y-lightbox-rule-summary::before {
      content: "▶ ";
      font-size: 0.7rem;
      color: var(--muted);
    }
    .a11y-lightbox-rule-details[open] > .a11y-lightbox-rule-summary::before {
      content: "▼ ";
    }
    .a11y-lightbox-rule-summary-lead {
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 0.68rem;
      letter-spacing: 0.06em;
      margin-right: 0.25rem;
    }
    .a11y-lightbox-rule-id-inline {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--link);
    }
    .a11y-lightbox-rule-help-peek {
      color: var(--muted);
      font-weight: 400;
    }
    .a11y-lightbox-rule-body {
      padding: 8px 12px 10px;
      border-top: 1px solid var(--border);
      font-size: 0.84rem;
      line-height: 1.45;
    }
    .a11y-lightbox-rule-body .a11y-lb-doc-lead {
      margin: 0 0 0.5rem;
    }
    .a11y-lightbox-rule-body .a11y-lb-line {
      margin: 0.35rem 0;
    }
    .a11y-lightbox-rule-body .a11y-lb-tags {
      margin: 0.45rem 0 0.1rem;
      font-size: 0.8rem;
    }
    .a11y-visual-lightbox-host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      width: 100%;
      min-height: 40px;
      overflow: visible;
      transform: none;
      isolation: auto;
      contain: none;
    }
    .a11y-visual-lightbox-host .a11y-visual-inner {
      flex-shrink: 0;
      transform: none !important;
      max-width: none !important;
      overflow: visible !important;
    }
    .visual-omit { font-size: 0.82rem; }
    .visual-snapshot-err { font-size: 0.82rem; line-height: 1.35; display: inline-block; max-width: 100%; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to report content</a>
  <main class="wrap" id="main-content">
    <h1 id="top">wick-a11y-observer accessibility report</h1>
    <p class="subtle">Readable summary of axe-core findings (violations and optional incomplete/manual-review items).</p>
    <div class="summary-groups" aria-label="Top summary sections">
      <section class="summary-group summary-group-identity" aria-label="Report identity">
        <h2>Report Identity</h2>
        <p class="validation-callout">Validation status: ${validationStatusBadge}</p>
        <table class="summary" role="table" aria-label="Report identity summary">
          <tbody>${identityTable}</tbody>
        </table>
      </section>
      <section class="summary-group summary-group-analysis" aria-label="Analysis options">
        ${analysisOptions}
      </section>
      <section class="summary-group summary-group-technical" aria-label="Technical metrics">
        <h2>Technical Metrics</h2>
        <p class="subtle">Click any metric card to see plain-language meaning and how it relates to others.</p>
        <table class="tech-grid tech-grid-preview" role="table" aria-label="Technical metrics preview (first row)">
          <tbody>${technicalRowsPreview}</tbody>
        </table>
        <details class="tech-expand">
          <summary>
            Show more technical metrics
            <span class="tech-expand-hint">(${Math.max(technicalTotalRows - technicalPreviewRowCount, 0)} more row(s) available)</span>
          </summary>
          <table class="tech-grid tech-grid-expanded" role="table" aria-label="Technical metrics additional rows">
            <tbody>${technicalRowsExpandedRemainder || '<tr><td class="tech-cell tech-cell-empty" colspan="3">No additional rows.</td></tr>'}</tbody>
          </table>
        </details>
      </section>
    </div>
    ${pageVisualOverviewJumpNav}
    <h2 class="severity-entry-title">By severity (rules grouped findings)</h2>
    <div class="sev-pills">${sevPills || "<span class=\"subtle\">No grouped findings in output.</span>"}</div>
    ${errorsBlock}
    ${bySeveritySections || "<p class=\"subtle\">No grouped findings to show.</p>"}
    ${pageVisualFullSection}
    <footer>
      <p>Generated for interactive review — keep JSON for machine use.</p>
      <p class="report-footnote">${footnoteHtml}</p>
    </footer>
  </main>
  ${includeVisualBoot ? renderVisualLightboxDialog() : ""}
  ${includeVisualBoot ? renderVisualBootScript() : ""}
</body>
</html>`;
};

// --- Public API (reporter task + tests may reuse `escapeHtml`) ---
module.exports = {
  A11Y_REPORT_DISCLAIMER,
  A11Y_REPORT_DISCLAIMER_LINES,
  renderLiveA11yReportHtml,
  escapeHtml,
};
