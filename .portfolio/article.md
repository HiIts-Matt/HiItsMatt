## What it is

This site is its own data source. There is no CMS and no content directory: the
profile, the language split, the contribution calendar and every public
repository are read from GitHub at request time, and the curated half of the
site — the page you are on — is described by a `.portfolio` folder committed
inside each project's own repository.

Publishing a project is therefore a commit to that project, not to this one.

## The shape of it

A Hono API on Node holds every credential and every cache. The browser gets a
Vite + React bundle that knows only its own origin, and a typed RPC client
generated from the server's route definitions — renaming a route breaks the
front end at build time rather than at runtime.

Three things were worth building rather than importing:

- **An in-process cache with two clocks.** Metadata expires in five minutes and
  content in fifteen, which keeps a cold page load inside GitHub's rate limit
  without ever serving a stale repository list.
- **An asset proxy.** A private repository's screenshots cannot be hotlinked
  from `raw.githubusercontent.com` — those URLs need credentials. Every image
  and clip is streamed back through the API instead, addressed only by the paths
  the server itself discovered under `.portfolio/media`. That membership test is
  the whole authorization check, so nothing else in a private repo can be
  reached through it.
- **A pager instead of a scroll.** The landing page does not scroll; each page
  is its own scroller, and the handover between them is sequenced — one page
  leaves, the next expands out from under it. The gesture only becomes a page
  change once the page you are on has nothing left to give in that direction,
  which is the same rule for the wheel, the arrow keys and a swipe.

![The Personal Work grid](media/03-personal-work.webp)

## The parts that were harder than they look

The hero's chevron is not an image. The shader canvas is one screen plus a band,
an ink-coloured cover hides the band, and the chevron is a hole punched in that
cover by a path generated from a Gaussian noise field — so the edge is the
gradient itself showing through, on the same canvas and the same frame.

The transition between pages is two animations that must not disagree with the
input lock that spans them, so the durations live in one TypeScript constant and
are published to CSS as custom properties. The dim applied to the page held
underneath is on its *content*, never on the page: a filter over the whole layer
takes the page's own background with it, and a dimmed ink is a different colour
from the ink it sits on.

## Running it

```bash
npm install
npm run dev
```

`server/.env` needs a GitHub username; a token is optional unless you list
private repositories or want the contribution graph, which only exists in
GitHub's GraphQL API.
