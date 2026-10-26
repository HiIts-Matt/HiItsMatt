/**
 * Pages that are built but switched off. Off takes the page out of the stack,
 * the side nav, the router (its URL falls through to the 404) and the
 * overview's cards, and nothing requests its data; its code and its API stay
 * as they are, so turning it back on is this one line.
 */
export const CAREER_PAGE = false;

/**
 * The whole site replaced by the intro and a maintenance notice: every URL
 * renders it, there is no nav, and nothing requests data. The rest of the app
 * is unreachable from the client and dropped from the bundle while this is on.
 */
export const MAINTENANCE = true;
