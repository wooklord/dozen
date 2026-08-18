// Single source of truth for the BUILD marker.
// BUMP THIS ON EVERY CHANGE that ships anything to the browser.
// The marker renders in the page header; it is how a deploy gets confirmed
// without dev tools. A change without a bump is an incomplete change.
export const BUILD = 31;
export const BUILD_LABEL = `BUILD 0.1.${BUILD}`;
