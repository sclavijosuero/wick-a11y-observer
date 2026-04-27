const standardsTags = {
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
};

const warnRunConfig = {
  iframes: true,
  includedImpacts: [],
  onlyWarnImpacts: ['critical', 'serious'],
  runOnly: standardsTags,
};

const failWarnRunConfig = {
  iframes: true,
  includedImpacts: ['critical', 'serious'],
  onlyWarnImpacts: ['moderate', 'minor'],
  runOnly: standardsTags,
};

const allWarnRunConfig = {
  iframes: true,
  includedImpacts: [],
  onlyWarnImpacts: ['critical', 'serious', 'moderate', 'minor'],
  runOnly: standardsTags,
};

const almostAllFailRunConfig = {
  iframes: true,
  includedImpacts: ['critical', 'serious', 'moderate'],
  onlyWarnImpacts: [],
  runOnly: standardsTags,
};

const goToSecondaryPageFromPrimaryButton = () => {
  cy.get('[data-cy=go-secondary-page]').should('be.visible').click();
  cy.get('[data-cy=second-page-title]').should('be.visible');
};

const runSharedSecondaryPageFlow = () => {
  cy.get('[data-cy=reveal-existing-issues]').click();
  cy.get('[data-cy=existing-issues-panel]').should('be.visible');
  cy.get('[data-cy=open-menu]').click();
  cy.get('[data-cy=main-menu]').should('be.visible');
  cy.get('[data-cy=menu-item-log-out]').click();
  cy.get('[data-cy=menu-selection-toast]').should('be.visible');
};

const runTest1SecondaryOnlyFlow = () => {
  cy.get('[data-cy=show-brief]').click();
  cy.get('[data-cy=brief-alert]').should('be.visible');
};

const runTest3SecondaryOnlyFlow = () => {
  cy.get('[data-cy=inject-secondary-extra-issues]').click();
  cy.get('[data-cy=secondary-extra-issues-panel]').should('be.visible');
};



describe('live a11y auto lifecycle', () => {
  // before(() => {
  //   // Overrides setup options if wanted for what ever reason
  //   cy.setLiveA11yAutoSetupOptions({
  //     observerOptions: {
  //       fallbackFullPageScan: { enabled: false },
  //       maxQueueSize: 100,
  //     },
  //   });
  //   // Overrides report options if wanted for what ever reason
  //   cy.setLiveA11yAutoReportOptions({
  //     validation: {
  //       // failOnIncludedImpacts=false if you want the issues findings are still reported, but they won't fail validation by that specific rule.
  //       failOnIncludedImpacts: false,
  //     },
  //   });
  // });

  it('passes when all impacts are warning-only', () => {
    // If you want to set thew analysis configuration specific for one test that is not the default one
    // (rules, includedImpacts, onlyWarnImpacts, runOnly, etc.)
    cy.setLiveA11yAutoSetupOptions({
      initialAxeOptions: warnRunConfig,
      liveAxeOptions: warnRunConfig,
    });


    cy.visit('/live-axe-monitor-playground.html');

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

    // Navigate to secondary page through primary-page button and interact there.
    goToSecondaryPageFromPrimaryButton();
    runSharedSecondaryPageFlow();
    runTest1SecondaryOnlyFlow();

  });

  it('fails this test when failing impacts are present', () => {
    // If you want to set thew analysis configuration specific for one test that is not the default one
    // (rules, includedImpacts, onlyWarnImpacts, runOnly, etc.)
    cy.setLiveA11yAutoSetupOptions({
      initialAxeOptions: failWarnRunConfig,
      liveAxeOptions: failWarnRunConfig,
    });


    cy.visit('/live-axe-monitor-playground.html');
    cy.get('[data-cy=monitor-page-title]').should('be.visible');

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

    // Align primary-page timing with test #1 before navigating away.
    cy.get('[data-cy=show-toast]').click();
    cy.get('[data-cy="standard-toast"]').should('be.visible');

    cy.get('[data-cy=add-hidden-then-show]').click();
    cy.get('[data-cy="late-form-title"]').should('be.visible');

    // Reveal heavy pre-rendered issues so this flow also spans all severities.
    cy.get('[data-cy=reveal-existing-issues]').click();
    cy.get('[data-cy=existing-issues-panel]').should('be.visible');

    // Add a few more dynamic states so this test consistently exceeds test #1.
    cy.get('[data-cy=show-toast]').click();
    cy.get('[data-cy="standard-toast"]').should('be.visible');

    cy.get('[data-cy=add-hidden-then-show]').click();
    cy.get('[data-cy="late-form-title"]').should('be.visible');

    cy.get('[data-cy="menu-item-log-out"]').click();
    cy.get('[data-cy="menu-selection-toast"]', { timeout: 1000 })
      .should('be.visible')
      .and('contain.text', 'Log out');

    cy.get('[data-cy=open-drawer]').click();
    cy.get('[data-cy="drawer"][data-state="open"]').should('be.visible');
    cy.get('[data-cy="drawer-save"]').click();
    cy.get('[data-cy="drawer"]').should('have.attr', 'data-state', 'closed');

    cy.get('[data-cy=open-dialog]').click();
    cy.get('[data-cy="dialog-backdrop"]', { timeout: 2000 })
      .should('have.attr', 'data-state', 'open');
    cy.get('[data-cy="dialog-input"]', { timeout: 2000 }).should('exist');

  });

  it('still runs after the previous test fails', () => {
    // If you want to set thew analysis configuration specific for one test that is not the default one
    // (rules, includedImpacts, onlyWarnImpacts, runOnly, etc.)
    cy.setLiveA11yAutoSetupOptions({
      runAccessibility: false,
      initialAxeOptions: allWarnRunConfig,
      liveAxeOptions: allWarnRunConfig,
    });


    cy.visit('/live-axe-monitor-playground.html');
    cy.get('[data-cy=monitor-page-title]').should('be.visible');

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

    // Navigate to secondary page through primary-page button.
    // Reuse some violating interactions from test #1 plus unique ones.
    goToSecondaryPageFromPrimaryButton();
    runSharedSecondaryPageFlow();
    runTest3SecondaryOnlyFlow();

  });

  it('fails this test when all four severities are included as failing impacts', () => {
    // If you want to set thew analysis configuration specific for one test that is not the default one
    // (rules, includedImpacts, onlyWarnImpacts, runOnly, etc.)
    cy.setLiveA11yAutoSetupOptions({
      initialAxeOptions: almostAllFailRunConfig,
      liveAxeOptions: almostAllFailRunConfig,
    });


    cy.visit('/live-axe-monitor-playground.html');
    cy.get('[data-cy=monitor-page-title]').should('be.visible');

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

  it('one-time manual scan after UI stabilizes', () => {
    cy.visit('/live-axe-monitor-playground.html');
    cy.get('[data-cy=monitor-page-title]').should('be.visible');

    // Ensure known violations are visible at scan time.
    cy.get('[data-cy=reveal-existing-issues]').click();
    cy.get('[data-cy=existing-issues-panel]').should('be.visible');

    // One-time manual checkpoint scan.
    cy.checkAccessibility();
  });

  it.only('one-time manual scan with custom axe options', () => {
    cy.visit('/live-axe-monitor-playground.html');
    cy.get('[data-cy=monitor-page-title]').should('be.visible');

    // Expose additional violations before the one-time scan.
    cy.get('[data-cy=inject-second-only-issues]').click();
    cy.get('[data-cy=second-only-issues-panel]').should('be.visible');
    cy.get('[data-cy=reveal-existing-issues]').click();
    cy.get('[data-cy=existing-issues-panel]').should('be.visible');

    cy.checkAccessibility({
      iframes: true,
      includedImpacts: ['critical', 'serious'],
      onlyWarnImpacts: ['moderate', 'minor'],
      runOnly: standardsTags,
      rules: {
        // Example rule override for this one-time run.
        'color-contrast': { enabled: false },
      },
    });


  });
});
