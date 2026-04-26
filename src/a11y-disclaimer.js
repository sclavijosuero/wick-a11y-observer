const A11Y_REPORT_DISCLAIMER_LINES = [
  "Note: Automated testing finds ~57% of WCAG issues. Analyzes visible DOM elements only.",
  "Axe-core® (github.com/dequelabs/axe-core) is a trademark of Deque Systems, Inc (deque.com).",
];

const A11Y_REPORT_DISCLAIMER = A11Y_REPORT_DISCLAIMER_LINES.join("\n");

module.exports = {
  A11Y_REPORT_DISCLAIMER,
  A11Y_REPORT_DISCLAIMER_LINES,
};
