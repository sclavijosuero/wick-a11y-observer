
describe('live accessibility monitor with reusable commands', () => {
  const fullStandardsRunConfig = {
    iframes: true,
    includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
    runOnly: {
      type: 'tag',
      values: [
        'wcag2a',
        'wcag2aa',
        'wcag2aaa',
        'wcag21a',
        'wcag21aa',
        'wcag21aaa',
        'wcag22a',
        'wcag22aa',
        'wcag22aaa',
        'best-practice',
      ],
    },
  };

  const setupMonitorAndOpenPlayground = (monitorOptions = {}) => {
    cy.setupStandardLiveA11yMonitor({
      maxQueueSize: 80,
      fallbackFullPageScan: { enabled: false },
      ...monitorOptions,
    });

    cy.visit('/live-axe-monitor-playground.html');

    cy.get('body').should('be.visible');
    cy.get('[data-cy="monitor-page-title"]').should('be.visible');

    cy.runInitialLiveA11yScan(undefined, {
      armAfter: true,
      armOptions: { scanCurrent: false },
    });
  };

  afterEach(() => {
    cy.waitForLiveA11yIdle({
      quietMs: 500,
      timeoutMs: 8000,
    });

    cy.reportLiveA11yResults();

    cy.stopLiveA11yMonitor();
  });

  it('captures a11y issues from UI that appears after the page is ready', () => {
    const firstTestAxe = {
      runOptions: {
        shared: fullStandardsRunConfig,
      },
    };

    setupMonitorAndOpenPlayground(firstTestAxe);

    cy.visit('/live-axe-secondary.html');
    cy.get('[data-cy=second-page-title]')
      .should('be.visible')
      .and('contain.text', 'Live Axe secondary page');

    // New document after navigation: re-attach the monitor, then return to the playground.
    setupMonitorAndOpenPlayground(firstTestAxe);

    // Trigger a live region update (toast) after initial scan.
    cy.get('[data-cy=show-toast]').click();
    cy.get('[data-cy="standard-toast"]').should('be.visible');

    // Add a hidden form dynamically, then wait for it to become visible.
    cy.get('[data-cy=add-hidden-then-show]').click();
    cy.get('[data-cy="late-form-title"]').should('be.visible');

    // Reveal pre-existing disclosure content.
    cy.get('[data-cy=toggle-details]').click();
    cy.get('[data-cy="faq-details"]').should('have.prop', 'open', true);

    // Create a short-lived alert element.
    cy.get('[data-cy=show-brief]').click();
    cy.get('[data-cy="brief-alert"]').should('be.visible');

    // Open menu, select "Log out", then assert the transient selection toast content.
    cy.get('[data-cy=open-menu]').click();
    cy.get('[data-cy="main-menu"]').should('be.visible');
    cy.get('[data-cy="menu-item-log-out"]').click();
    cy.get('[data-cy="menu-selection-toast"]', { timeout: 1000 })
      .should('be.visible')
      .and('contain.text', 'Log out');

    // Reveal accessibility issues from DOM that already existed but was hidden.
    cy.get('[data-cy=reveal-existing-issues]').click();
    cy.get('[data-cy=existing-issues-panel]').should('be.visible');

    // Open and close drawer near the end because it can cover right-side controls.
    cy.get('[data-cy=open-drawer]').click();
    cy.get('[data-cy="drawer"][data-state="open"]').should('be.visible');
    cy.get('[data-cy="drawer-save"]').click();

    // Keep dialog last because it intentionally creates a fullscreen backdrop.
    cy.get('[data-cy=open-dialog]').click();
    cy.get('[data-cy="dialog-backdrop"][data-state="open"]').should('be.visible');
    cy.get('[data-cy="dialog-input"]').type('Hello');
    cy.get('[data-cy="dialog-continue"]').click();




  });

  it('captures live a11y issues from a partial flow in different order', () => {
    setupMonitorAndOpenPlayground();

    // Trigger native popover flow (assert existence for browser compatibility).
    cy.get('[data-cy=open-popover]').click();
    cy.get('[data-cy="help-popover"]').should('exist');

    // Create a short-lived alert before opening overlay elements.
    cy.get('[data-cy=show-brief]').click();
    cy.get('[data-cy="brief-alert"]').should('be.visible');

    // Inject second-test-only issues (one critical + one serious) not used in first test.
    cy.get('[data-cy=inject-second-only-issues]').click();
    cy.get('[data-cy="second-only-issues-panel"]').should('be.visible');

    // Open menu to exercise popup-widget style live scans.
    cy.get('[data-cy=open-menu]').click();
    cy.get('[data-cy="main-menu"]').should('be.visible');

    // Reveal pre-existing disclosure content.
    cy.get('[data-cy=toggle-details]').click();
    cy.get('[data-cy="faq-details"]').should('have.prop', 'open', true);

    // Reveal heavy pre-rendered issues so this flow also spans all severities.
    cy.get('[data-cy=reveal-existing-issues]').click();
    cy.get('[data-cy=existing-issues-panel]').should('be.visible');
  });

});