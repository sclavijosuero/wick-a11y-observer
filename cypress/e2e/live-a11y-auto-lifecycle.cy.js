import { registerLiveA11yAutoLifecycle } from '../../src/a11y-observer-commands.js';

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
const allWarnRunConfig = {
  iframes: true,
  includedImpacts: [],
  onlyWarnImpacts: ['critical', 'serious', 'moderate', 'minor'],
  runOnly: standardsTags,
};

const failWarnRunConfig = {
  iframes: true,
  includedImpacts: ['critical', 'serious'],
  onlyWarnImpacts: ['moderate', 'minor'],
  runOnly: standardsTags,
};

const allFailRunConfig = {
  iframes: true,
  includedImpacts: ['critical', 'serious', 'moderate'],
  onlyWarnImpacts: [],
  runOnly: standardsTags,
};


registerLiveA11yAutoLifecycle({
  setupOptions: {
    observerOptions: {
      fallbackFullPageScan: { enabled: false },
      maxQueueSize: 80,
    },
  },
  reportOptions: {
    validation: {
      failOnIncludedImpacts: true,
    },
  },
});

describe('live a11y auto lifecycle', () => {
  it('passes when all impacts are warning-only', () => {
    cy.setLiveA11yAutoSetupOptions({
      initialAxeOptions: allWarnRunConfig,
      liveAxeOptions: allWarnRunConfig,
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

  it('fails this test when failing impacts are present', () => {
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
    cy.setLiveA11yAutoSetupOptions({
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

  });

  it('fails this test when all four severities are included as failing impacts', () => {
    cy.setLiveA11yAutoSetupOptions({
      initialAxeOptions: allFailRunConfig,
      liveAxeOptions: allFailRunConfig,
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
});
