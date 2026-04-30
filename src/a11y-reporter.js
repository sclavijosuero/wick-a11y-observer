/**
 * Live accessibility reporter: public entry re-exports pure transforms and Cypress task registration.
 */

const core = require("./a11y-reporter-core");
const { registerLiveA11yReporterTasks } = require("./a11y-reporter-io");

module.exports = {
  registerLiveA11yReporterTasks,
  normalizePageUrlKey: core.normalizePageUrlKey,
  sameNodeIdentity: core.sameNodeIdentity,
  buildNodeRepeatKey: core.buildNodeRepeatKey,
  enrichNodesWithCrossReportRepeat: core.enrichNodesWithCrossReportRepeat,
  SEVERITY_ORDER: core.SEVERITY_ORDER,
};
