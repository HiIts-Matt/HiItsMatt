You are reading this on the thing it describes. The page you are on is a file
called `article.md`, committed in this site's own repository, fetched from
GitHub a moment ago and rendered on the way through.

## No CMS, on purpose

A portfolio has two halves that rot at different speeds. The automatic half —
who I am, what I have pushed lately, which languages the repos actually consist
of — is already maintained on GitHub, and copying it anywhere else just means
maintaining it twice. The curated half is real writing, and writing about a
project belongs next to that project, not in a content folder on a site the
project has never heard of.

So neither half lives here. The profile, the language split, the contribution
calendar and every public repository are read from GitHub's REST and GraphQL
APIs at request time. The case studies are read out of the project
repositories themselves. Publishing a project is a commit to *that* project.

## What a project has to commit

One folder, and every part of it optional:

```
.portfolio/
  project.json      title, tagline, summary, year, status, tags, links, cover
  article.md        the body of the project's page — this file
  media/            images and clips, shown in filename order
    01-hero.webp
    02-tour.webm
```

A repository on the list with no `.portfolio` at all still gets a card: the
title falls back to the repo name, the copy to GitHub's own description, and
failing that to the first paragraph of the README that still reads as prose.
That fallback chain is what lets something be published before it has been
written up.

Which repositories appear is one environment variable, read at boot:

```
PROJECT_REPOS=HiItsMatt,MattBoard,[Raspberry Pi: pi-stack, pi-homelab, pc-remote]
```

Order is display order, and the bracket form collapses several repos into one
card that opens into its members. A typo in that list is the failure mode worth
designing for, because a misspelled repo looks exactly like a private repo the
token cannot see — both are simply absent. So the parser refuses to start the
server instead, and names the entry it could not read.

## Two processes, one type

A Hono API on Node holds every credential and every cache. The browser gets a
Vite and React bundle that knows only its own origin, plus a typed RPC client
built from the server's route definitions. The client imports the server's
`AppType` as a type only — no server code reaches the bundle — which means
renaming a route or changing a response shape breaks the front end at build
time rather than at runtime.

## Showing a private repository without leaking it

Three of the projects on this site are private repositories. Their screenshots
cannot be hotlinked: `raw.githubusercontent.com` wants credentials for those,
and the one place a credential must never go is the browser.

Every asset is therefore streamed back through the API, and the interesting
part is the authorization check, which is a set-membership test and nothing
else. The server walks `.portfolio/media` itself, keeps only the paths whose
extension is in a fixed allowlist, and publishes those. When a request arrives
for `media/01-hero.webp`, the answer is not "is this path safe?" — parsing
paths for safety is how directory traversal keeps happening — it is "is this
one of the paths I published?" Nothing else in the repository has a name that
can be spelled.

The rest is plumbing with the sharp edges filed off: the browser's `Range`
header is forwarded so a clip can be scrubbed, the content type comes from the
server's own extension table rather than from anything upstream said,
`X-Content-Type-Options: nosniff` and a `sandbox` CSP ride along so an SVG
opened directly can still not execute, and anything over 40 MB is refused on
the grounds that it belongs on a CDN.

## Two clocks

Unauthenticated GitHub allows 60 requests an hour per IP, and a cold page load
costs one request per repository twice over — once for the README excerpt, once
for the language breakdown. Caching is not an optimisation here, it is the
difference between the site working and the site being rate limited.

| Cached                                    | For     | Why |
| ----------------------------------------- | ------- | --- |
| Profile, repo list, contributions          | 5 min   | Stars and push dates should look current |
| READMEs, languages, manifests, articles    | 15 min  | Content changes on the scale of commits, not requests |

Concurrent misses on the same key share one upstream request, so three sections
mounting at once cost one fetch, not three. Rejections are never cached — a
failure should not be served for fifteen minutes. And the fan-out is bounded at
24 repositories per enrichment pass, because a paging bug should cost a slow
page, not the whole hourly budget.

## The chevron is a hole

![The Personal Work grid](media/03-personal-work.webp)

The hero's edge is not an image, and it is not a second gradient. The shader
canvas is sized to one screen *plus a band* below it, so there is real,
still-animating gradient underneath the fold. An ink-coloured rectangle covers
that band, and the chevron is a hole punched in the cover — so what shows
through is the same canvas on the same frame, not a copy of it.

The hole's outline is a full-width V with every point displaced along the
curve's *normal* by a smooth Gaussian process: 256 standard-normal samples on a
fixed lattice, interpolated across two octaves. Along the normal rather than
the tangent, because sliding a point sideways along a curve moves it to where
the curve already goes and changes nothing you can see. Two details took the
longest. The apex is softened, because a true `abs()` has infinite curvature at
its point and the normals either side of it disagree hard enough to tear the
edge across a single sample. And the noise tapers to zero at both corners,
where the hole meets the band's own edges — an excursion there either pushes
the boundary out through the top of the ink or leaves a notch hanging off the
side.

None of it animates. The path is computed once per resize and never touched on
a frame; the transition is the intro page sliding up and carrying it away,
which uncovers the band that was clipped.

## A page is not a scroll position

The document does not scroll. Each page is its own scroller and moving between
them is a handover: one page slides off, then the next expands out from under
it. That is two animations in sequence, and a scroll offset can only ever
express one number, so it could not have been done with scroll snapping.

What that buys is that a page's own overflow stays completely native — reading
down this article is a plain scroll with plain momentum. The pager only takes
the gesture once the page has nothing left to give in that direction, and the
rule for when that counts is the same for all three inputs: the gesture must
have *started* after the page ran out.

That last clause is the whole thing. Trackpad momentum after a flick arrives as
an unbroken stream of wheel events, so a flick that happens to coast into the
bottom of a page must not page — the stream has no gap in it. A held arrow key
is one press repeated. A swipe that began while the page could still scroll is
one swipe. Without that rule every long scroll ends one page further down than
you asked for. The threshold is 140 ms of quiet; stopping and pushing again is
a second gesture and does page.

The durations live in one TypeScript constant and are published to CSS as
custom properties, because the animation and the input lock that spans it must
not be able to disagree — a lock outlasting its own animation is a page that
ignores you for no visible reason. Going back up, the second beat starts 160 ms
early: downward the big movement comes first and reads as continuous, upward it
comes second and the gap in front of it is dead air.

## Running it

```bash
npm install
npm run dev
```

`npm run dev` is a small TUI rather than two `concurrently` panes, for one
Windows-shaped reason: `tsx watch` and Vite both spawn children that survive a
plain Ctrl-C, so shutdown has to kill the process tree or the next run finds
both ports occupied. It preflights the failures that otherwise surface as
confusing runtime errors instead of startup ones — no `GITHUB_USERNAME`,
workspaces not installed, a stale server already on 5173 or 3000.

`server/.env` needs a GitHub username. A token is optional: without one the
site runs on the 60-requests-an-hour budget and the contribution graph is
missing, because GitHub only exposes the calendar through GraphQL and GraphQL
rejects anonymous requests outright. With a `repo`-scoped token, private
projects appear too.

## Still open

The loader waits for the shader to paint 20 stable frames before lifting,
which is honest but means the first visit is gated on WebGL. There is no
deployment yet — it runs locally, and the token in my `.env` is the GitHub
CLI's own session token, which rotates. The next real piece of work is putting
it somewhere with a hostname.
