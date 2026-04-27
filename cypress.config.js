const { defineConfig } = require("cypress");
const { registerLiveA11yReporterTasks } = require("./src/a11y-reporter");


module.exports = defineConfig({
  // // Accessibility results folder override (if not specified, the default is "cypress/accessibility")
  // accessibilityFolder: "cypress/a11y",

  viewportWidth: 1920,
  viewportHeight: 1080,
  watchForFileChanges: false,

  retries: {
    runMode: 1,
    openMode: 0,
  },

  e2e: {
    setupNodeEvents(on, config) {
      // addAcmeTasks(on);
      registerLiveA11yReporterTasks(on, config);

      return config;
    },

    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    baseUrl: 'https://sclavijosuero.github.io',
  },
});
