import axe from 'axe-core';
import { installLiveA11yMonitor } from './a11y-monitor';

export function createLiveA11yStore() {
  return {
    initial: null,
    initialPageVisual: null,
    initialPageVisuals: [],
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

export function installLiveA11yMonitorOnWindow(win, store, monitorOptions = {}) {
  // axe.source may reference CommonJS globals (exports/module) depending on bundle internals.
  // Provide a temporary shim so injection works consistently in the AUT window.
  const previousModule = win.module;
  const previousExports = win.exports;

  win.module = { exports: {} };
  win.exports = win.module.exports;
  win.__liveAxeSource = axe.source;

  win.eval(axe.source);

  if (!win.axe && win.module?.exports) {
    win.axe = win.module.exports;
  }

  win.module = previousModule;
  win.exports = previousExports;
  win.__liveA11yMonitor?.stop?.();

  installLiveA11yMonitor(win, {
    sharedStore: store,
    autoArm: false,
    minVisibleMs: 250,
    stableFrames: 3,
    maxSettleMs: 2000,
    maxQueueSize: 80,
    useConventionRoots: false,
    liveAxeOptions: {
      resultTypes: ['violations', 'incomplete'],
    },
    ...monitorOptions,
  });
}

export function attachLiveA11yMonitor(store, monitorOptions = {}) {
  // Register for the next AUT load only, so listeners do not accumulate across tests.
  Cypress.once('window:before:load', (win) => {
    installLiveA11yMonitorOnWindow(win, store, monitorOptions);
  });
}