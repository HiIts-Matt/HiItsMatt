// CloudFront Function (runtime: cloudfront-js-2.0), event type: viewer request.
//
// Attach this to the DEFAULT cache behaviour only — the one pointing at the S3
// origin. Never to /api/*, and never reach for the distribution's "custom error
// responses" to do the same job: those apply to every behaviour, so a genuine
// 404 from the API (unknown repo, unknown project slug) would come back as
// index.html with status 200, and the client's unwrap() would report a parse
// failure instead of the server's own error message.
//
// react-router owns paths like /projects/:slug. A direct hit on one asks S3 for
// an object that does not exist, so rewrite every extension-less path to the
// SPA shell and let the router resolve it in the browser.

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Everything after the final slash. "/projects/foo" -> "foo",
  // "/assets/index-a1b2c3.js" -> "index-a1b2c3.js", "/" -> "".
  var leaf = uri.substring(uri.lastIndexOf("/") + 1);

  // A dot means a real file was requested; anything else is a route.
  if (leaf.indexOf(".") === -1) {
    request.uri = "/index.html";
  }

  return request;
}
