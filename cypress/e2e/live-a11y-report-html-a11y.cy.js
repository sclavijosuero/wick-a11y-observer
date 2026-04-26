import axeCore from 'axe-core';

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

const runAxeOnCurrentDocument = (runOnly = standardsTags) =>
  cy.window({ log: false }).then((win) => {
    if (!win.axe) {
      win.eval(axeCore.source);
    }
    return win.axe.run(win.document, { runOnly });
  });

describe('generated live a11y report HTML', () => {
  it('passes automated accessibility checks', () => {
    cy.setupLiveA11yMonitor({
      observerOptions: {
        fallbackFullPageScan: { enabled: false },
      },
    });

    cy.visit('/live-axe-monitor-playground.html');
    cy.runInitialLiveA11yScan(undefined, {
      armAfter: true,
      armOptions: { scanCurrent: false },
    });

    cy.get('[data-cy=show-toast]').click();
    cy.get('[data-cy=standard-toast]').should('be.visible');
    cy.get('[data-cy=add-hidden-then-show]').click();
    cy.get('[data-cy=late-form-title]').should('be.visible');
    cy.get('[data-cy=reveal-existing-issues]').click();
    cy.get('[data-cy=existing-issues-panel]').should('be.visible');

    cy.waitForLiveA11yIdle({ quietMs: 500, timeoutMs: 10000 });

    cy.reportLiveA11yResults({
      throwOnValidationFailure: false,
    }).then((report) => {
      expect(report?.savedHtmlTo, 'generated report HTML absolute path').to.be.a('string').and.not.be.empty;

      cy.readFile(report.savedHtmlTo, 'utf8').then((htmlContent) => {
        cy.document({ log: false }).then((doc) => {
          doc.open();
          doc.write(htmlContent);
          doc.close();
        });
        runAxeOnCurrentDocument().then((results) => {
          const violations = Array.isArray(results?.violations) ? results.violations : [];
          const violationSummary = violations
            .map((violation) => {
              const targets = (violation.nodes || [])
                .flatMap((node) => node?.target || [])
                .filter(Boolean)
                .join(', ');
              return `${violation.id}: ${violation.help}${targets ? ` | targets: ${targets}` : ''}`;
            })
            .join('\n');
          expect(violations, `report HTML should have no axe violations.\n${violationSummary}`).to.have.length(0);
        });
      });
    });
  });
});
