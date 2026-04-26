const { defineConfig } = require("cypress");
const { registerLiveA11yReporterTasks } = require("./src/a11y-reporter");


module.exports = defineConfig({
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
      registerLiveA11yReporterTasks(on);

      return config;
    },

    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    baseUrl: 'https://sclavijosuero.github.io',
  },
});
