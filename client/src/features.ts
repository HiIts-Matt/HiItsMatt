/**
 * Pages that are built but switched off. Off takes the page out of the stack,
 * the side nav, the router (its URL falls through to the 404) and the
 * overview's cards, and nothing requests its data; its code and its API stay
 * as they are, so turning it back on is this one line.
 */
export const CAREER_PAGE = false;
