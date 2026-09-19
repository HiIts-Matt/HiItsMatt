/**
 * Identifier of the running build, substituted at bundle time by
 * `server/scripts/bundle.js` from the release tag the deploy is creating.
 *
 * Declared rather than imported because it does not exist as a value anywhere:
 * esbuild's `define` replaces the identifier textually. `typeof` on an
 * undeclared binding is legal and yields "undefined", so running from source
 * under tsx — where nothing substitutes it — reports "dev" instead of throwing.
 */
declare const __RELEASE__: string | undefined;

export const release = typeof __RELEASE__ === "string" ? __RELEASE__ : "dev";
