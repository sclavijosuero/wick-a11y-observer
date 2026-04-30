/**
 * Shared defaults for accessibility artifacts and axe-core impact ordering.
 * Used by the Cypress reporter (Node), observer commands (bundler), monitor, and HTML template.
 */

/** Default folder under the project root for accessibility JSON/HTML artifacts. */
const DEFAULT_ACCESSIBILITY_RESULTS_FOLDER = "cypress/accessibility";

/** Default JSON filename inside {@link DEFAULT_ACCESSIBILITY_RESULTS_FOLDER}. */
const DEFAULT_ACCESSIBILITY_REPORT_FILE_NAME = "accessibility-results.json";

/** axe-core impact levels in severity order (critical → minor). */
const AXE_IMPACT_ORDER = Object.freeze(["critical", "serious", "moderate", "minor"]);

module.exports = {
  DEFAULT_ACCESSIBILITY_RESULTS_FOLDER,
  DEFAULT_ACCESSIBILITY_REPORT_FILE_NAME,
  AXE_IMPACT_ORDER,
};
