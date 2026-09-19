# Deploying

The site goes online as two artifacts behind one CloudFront distribution:

```
                            hiitsmatt.dev
                                |
                         CloudFront (TLS)
                    ____________|____________
                   |                         |
            default behaviour           /api/* behaviour
                   |                         |
          S3 (client/dist)          Lambda Function URL
          private, via OAC          RESPONSE_STREAM, via OAC
                                             |
                                        GitHub API
```

One distribution, so the browser sees a single origin: no CORS, no preflights,
`VITE_API_ORIGIN` stays unset. That is the same arrangement the Vite dev proxy
gives you locally, which is what keeps dev and production honest about each
other.

Infrastructure is created once, by hand, in the console. After that
`npm run deploy` pushes code and nothing else.

Running cost is roughly **$11/year** — the domain. Cloudflare Registrar sells
at cost and its DNS is free, and a portfolio's traffic disappears inside
CloudFront's and Lambda's free tiers.

---

## Before you start

- An AWS account you are happy to attach a personal domain to. If your CLI is
  currently pointed at a work account, make a separate one — `aws sts
  get-caller-identity` tells you which you are about to deploy into.
- The AWS CLI, logged in: `aws configure` or `AWS_PROFILE`.
- A GitHub personal access token. Classic with **no scopes** if every repo in
  `PROJECT_REPOS` is public; **fine-grained**, scoped to just those repos with
  `Contents: Read-only`, if any is private. See `server/.env.example` for why
  the classic `repo` scope is the wrong answer here.

Pick one region for the bucket and the function and use it throughout; this
guide writes `ap-southeast-2` (Sydney). CloudFront is global, and the
certificate is the one exception — see step 2.

---

## 1. The domain

`hiitsmatt.dev`, registered at **Cloudflare Registrar** — at cost, no renewal
markup, free WHOIS privacy. Registration there forces the zone onto Cloudflare
DNS, so every record in this guide is created at Cloudflare, not Route 53, and
the AWS side never needs a hosted zone.

Two consequences of `.dev` specifically:

- **The whole TLD is on the HSTS preload list.** Browsers refuse plain HTTP to
  it before a request is ever sent — there is no insecure fallback to
  misconfigure, but it also means nothing works until the certificate in step 2
  is issued and attached.
- Certificate validation and the site records both live at Cloudflare, and
  both must be **DNS only**. See the orange-cloud warning in step 7.

## 2. Request the certificate — in us-east-1

CloudFront can only attach a TLS certificate issued by **AWS Certificate
Manager (ACM)** in the **`us-east-1` (N. Virginia)** region. This is not a
preference and it is not configurable — a certificate created in
`ap-southeast-2` will simply not appear in the distribution's dropdown in step
6, with no explanation of why. The certificate is free and auto-renews.

### 2a. In the AWS console — request it

Open this exact URL (the `region=us-east-1` is the point):

```
https://us-east-1.console.aws.amazon.com/acm/home?region=us-east-1#/certificates/request
```

Before clicking anything, check the **region selector in the top-right of the
black navigation bar** reads **N. Virginia**. If it reads Sydney, the URL did
not take — switch it manually and reload.

1. *Certificate type* → **Request a public certificate** → **Next**.
2. *Fully qualified domain name* → `hiitsmatt.dev`.
3. **Add another name to this certificate** → `www.hiitsmatt.dev`.
4. *Validation method* → **DNS validation – recommended**.
5. *Key algorithm* → leave **RSA 2048**.
6. *Export* → **Disable export**. See below.
7. **Request**.

**Disable export, not enable.** CloudFront is an ACM-integrated service: it
uses the certificate internally and never hands you the private key, so export
buys nothing here. It is also not free — exportable certificates cost **$7 per
domain name at issuance and again at every renewal**, which for these two
names is $14/year, more than the domain itself. Export exists for terminating
TLS somewhere ACM cannot reach, such as an EC2 instance or on-prem hardware;
S3 and Lambda never see the certificate at all.

The choice is permanent — it cannot be changed after issuance. That is not a
reason to hedge: if an exportable certificate is ever genuinely needed, request
a second one then.

You land on the certificate's detail page with status **Pending validation**.
If you get bounced to the list instead, click the certificate ID to open it.

### 2b. On the detail page — find the CNAME values

Scroll to the **Domains** table. It has one row per domain, each with a
**CNAME name** and **CNAME value** column and a copy button beside each value.

> The row may need expanding before the columns appear. Ignore the **Create
> records in Route 53** button if it is shown — it is greyed out or useless
> here, because your DNS is at Cloudflare, not AWS.

**Expect one record per domain, not one shared record.** ACM issues a
separate token for `hiitsmatt.dev` and for `www.hiitsmatt.dev`, and the
certificate stays *Pending validation* until every row reads *Success*. Create
both.

The tokens are random per certificate. In the shapes below `<TOKEN>` and
`<TARGET>` stand for **your** values — never copy the literals out of this
document, they belong to no certificate that exists:

```
hiitsmatt.dev
  CNAME name    <TOKEN_APEX>.hiitsmatt.dev.
  CNAME value   <TARGET_APEX>.<id>.acm-validations.aws.

www.hiitsmatt.dev
  CNAME name    <TOKEN_WWW>.www.hiitsmatt.dev.
  CNAME value   <TARGET_WWW>.<id>.acm-validations.aws.
```

Note the `www` row's name carries **two** labels before the zone. Only
`.hiitsmatt.dev.` comes off when you paste it into Cloudflare; the `.www`
stays.

### 2c. In Cloudflare — create both records

Go to <https://dash.cloudflare.com>, click **hiitsmatt.dev**, then **DNS** in
the left sidebar, then **Records**, then **Add record**. Do this twice, once
per ACM row:

| Field | Value |
| --- | --- |
| Type | **CNAME** |
| Name | ACM's `CNAME name` with **only** the trailing `.hiitsmatt.dev.` removed — so `<TOKEN_APEX>` for the apex row and `<TOKEN_WWW>.www` for the www row |
| Target | ACM's `CNAME value`, pasted whole |
| Proxy status | **DNS only** (click the orange cloud so it turns grey) |
| TTL | Auto |

**Save**, then repeat for the second row.

Three ways this goes wrong, all silent:

- **Stripping too much from the www row.** `.www` is part of the record name,
  not part of the zone. Removing it produces a record ACM never looks up.
- **Stripping too little.** Cloudflare appends the zone to whatever you type,
  so pasting the full name yields `<TOKEN>.hiitsmatt.dev.hiitsmatt.dev`. The
  dialog's headline previews the resulting name — read it before saving.
- **Copying an example value from a guide instead of from ACM.** Tokens are
  unique per certificate; a well-formed record carrying someone else's token
  validates nothing.
- **Leaving the cloud orange.** A proxied record answers with Cloudflare's own
  value instead of ACM's, and validation sits at *Pending* indefinitely.

### 2d. Confirm

```
nslookup -type=CNAME <TOKEN_APEX>.hiitsmatt.dev
nslookup -type=CNAME <TOKEN_WWW>.www.hiitsmatt.dev
```

Both should return an `acm-validations.aws` target. Then reload the ACM
certificate page: each row in the **Domains** table flips to **Success**, and
the certificate's own status reaches **Issued** only once *all* of them have.
Usually two or three minutes, occasionally thirty.

A single row stuck at *Pending validation* while the other says *Success*
means exactly one thing: that domain's record is missing, misnamed, or
proxied. The certificate is unusable until it clears.

**Leave both records in place permanently.** ACM re-reads them to auto-renew
the certificate every year; deleting them after issuance breaks renewal
silently.

## 3. Create the S3 bucket

Open, in **ap-southeast-2** this time:

```
https://ap-southeast-2.console.aws.amazon.com/s3/bucket/create?region=ap-southeast-2
```

Check the region selector reads **Sydney** before filling anything in. Then,
field by field down the form:

### Bucket type — **General purpose**

Not *Directory*. Directory buckets are S3 Express One Zone: a single
Availability Zone, roughly 7× the storage price, and an endpoint shape that
does not work as a standard CloudFront origin with OAC. They exist for compute
hammering S3 from inside one AZ. A CDN origin is the textbook general-purpose
case — CloudFront caches at the edge, so the bucket is only read on a miss and
its latency is invisible.

### Bucket name — `hiitsmatt-dev`

Globally unique across all of AWS, but never visible in a URL: CloudFront
addresses the bucket internally. It does **not** need to match the domain.
That convention only exists for S3 website hosting, which step 6 replaces.

### Copy settings from existing bucket — skip

Only useful once you have a bucket worth cloning.

### Object Ownership — **ACLs disabled (recommended)**

Not optional here. OAC works by granting the CloudFront service principal
access in the *bucket policy*; ACLs are the older per-object permission system
that predates it. Enabling them adds a second, object-level way to make a file
public that the bucket policy cannot override, which is exactly the ambiguity
this setup avoids.

### Block Public Access — **all four boxes ticked**

Leave "Block *all* public access" on, which ticks the four sub-options:

| Sub-option | Why it stays on |
| --- | --- |
| Block public access granted through *new* ACLs | ACLs are disabled anyway; defence in depth |
| Block public access granted through *any* ACLs | Same |
| Block public access granted through *new* public bucket or access point policies | The OAC policy is not public — it names one CloudFront distribution |
| Block public and cross-account access granted through *any* public bucket policies | Same |

None of these obstruct CloudFront. A policy scoped to
`cloudfront.amazonaws.com` with a `SourceArn` condition is not a *public*
policy, so S3 permits it with the block fully on. If this feels wrong later,
it is the correct feeling: a static site bucket should never be readable
without going through the distribution.

### Bucket Versioning — **Disable**

The genuine trade-off on this page. Versioning would let you roll back an
overwritten object and survive an accidental `--prune`, at the cost of
retaining every superseded object forever unless you also write a lifecycle
rule.

It is not worth it here because the bucket holds no original data. Everything
in it is reproducible from git by `npm run deploy`, assets are content-hashed
so deploys write new keys rather than overwriting, and `index.html` is a few
hundred bytes you can regenerate in thirty seconds. Versioning protects
irreplaceable state; this is build output.

### Tags — optional

One is worth adding if this account will ever hold more than the portfolio:
`Project = hiitsmatt`. It makes Cost Explorer able to answer "what does the
site cost" without guesswork.

### Default encryption — **SSE-S3 (Amazon S3 managed keys)**

The default, and free. Do not pick SSE-KMS: it bills per request, and with OAC
it additionally requires granting `kms:Decrypt` to the CloudFront service
principal in the key policy — a step whose omission produces a 403 that looks
identical to a missing bucket policy. There is nothing confidential in
`client/dist`; it is served to the public internet by design.

**Bucket Key** — leave enabled. It only reduces KMS call volume, so with
SSE-S3 it does nothing either way.

### Advanced settings → Object Lock — **Disable**

Write-once-read-many retention for compliance. It requires versioning and
would make deploys fail once an object is locked.

### After creation — things not to turn on

The bucket's own tabs offer several features that would each undo part of this
design:

- **Static website hosting** (Properties). This is the one people enable by
  reflex. It serves the bucket directly over plain HTTP from a second,
  public endpoint, bypassing CloudFront, your certificate, and the SPA
  fallback. The distribution replaces it entirely.
- **Requester pays** — breaks CloudFront's reads.
- **Transfer acceleration** — pointless behind a CDN, and billed.
- **Event notifications / replication / lifecycle** — nothing here needs them.

## 4. Create the Lambda

Open:

```
https://ap-southeast-2.console.aws.amazon.com/lambda/home?region=ap-southeast-2#/create/function
```

Choose **Author from scratch**, then:

- Name: `hiitsmatt-api` (write it down — it goes in `.env.deploy`).
- Runtime: **Node.js 22.x**. Architecture `arm64` is cheaper and fine.
- Create, then set:

**Configuration → General configuration**
- Timeout: **60 seconds**. The default 3s is not enough for a cold start that
  also has to fan out to the GitHub API.
- Memory: **512 MB**. Lambda scales CPU with memory, so this is faster *and*
  usually cheaper than 128 MB for a request that parses markdown.

**Configuration → Environment variables**

| Key | Value |
| --- | --- |
| `GITHUB_USERNAME` | your GitHub login — the server refuses to boot without it |
| `GITHUB_TOKEN` | scopeless classic, or fine-grained if any listed repo is private |
| `PROJECT_REPOS` | the curated list, same syntax as `server/.env.example` |

`GITHUB_TOKEN` is not optional here the way it is locally. The in-process cache
lives in one execution environment, so every cold start refetches from GitHub —
and unauthenticated requests are limited to 60/hour *per IP*, on IPs Lambda
shares with other tenants. Without a token the site will intermittently 429 for
reasons that have nothing to do with your traffic.

`CORS_ORIGINS` is not needed: CloudFront makes the API same-origin.

**Code → Runtime settings → Edit**
- Handler: **`index.handler`**.

**Configuration → Function URL → Create function URL**
- Auth type: **AWS_IAM**.
- Invoke mode: **RESPONSE_STREAM**. This one is load-bearing:
  - Buffered responses are base64-encoded and capped at 6 MB, so ~4.4 MB of
    binary. `server/.env.example` advertises `.mp4`/`.webm` media up to 40 MB.
    Streaming raises the ceiling to 200 MB.
  - Buffered flattens the response into a JSON envelope, destroying the `206`
    and `Content-Range` that `routes/github.ts` passes through so video
    players can seek. Streaming forwards status and headers verbatim.
  - Exceeding the buffered cap is not graceful degradation — it is a 502 with
    no obvious cause, discovered whenever you next add a video.

  It does not cost more in practice. Streaming is billed at $0.008/GB **beyond
  the first 6 MB of each response**, with 100 GiB/month free on top; every
  response this API produces is under 6 MB, so the surcharge is zero. Even a
  40 MB asset is ~$0.0003 per uncached fetch.

  The real cost is bandwidth: Lambda throttles a stream to 2 MB/s after the
  first 6 MB. That is an argument for the media cache behaviour in step 6.
- Copy the URL. You need its hostname in step 6.

Now push the code once, so the function is not empty when CloudFront starts
sending it traffic:

```
npm -w server run bundle
node scripts/smoke-lambda.js       # loads the real bundle, expects 200
```

The full `npm run deploy` in step 8 does both, plus the upload.

## 5. Create the SPA-fallback CloudFront Function

CloudFront is a global service, so its console has no region selector and its
URLs carry no region:

```
https://console.aws.amazon.com/cloudfront/v4/home#/functions/create
```

If that lands on the Functions list rather than the editor, use the
**Create function** button on it.

- Name: `spa-fallback`
- Runtime: **cloudfront-js-2.0**
- Paste the contents of `infra/cloudfront-spa-fallback.js`.
- **Save changes**, then **Publish**.

This rewrites extension-less paths to `/index.html` so that loading
`/projects/some-slug` directly reaches react-router instead of a missing S3
object.

Do not use the distribution's "Custom error responses" for this instead. Those
apply to *every* behaviour, so the API's genuine 404s — unknown repo, unknown
project slug — would come back as `index.html` with status `200`, and the
client would report a parse error instead of the server's message.

## 6. Create the distribution

Open:

```
https://console.aws.amazon.com/cloudfront/v4/home#/distributions/create
```

### Name and type

- **Distribution name**: `hiitsmatt-dev`. A console label only — not DNS, not
  an origin, not in any URL. It is what the Distributions list shows instead
  of the `E…` id, and it can be changed later.
- **Distribution type**: **Single website or app**.

The alternative is the multi-tenant / SaaS distribution: a template plus
per-tenant configurations, for serving hundreds of customer domains with
individual certificates from one setup. Choosing it would require defining a
tenant before anything serves traffic and would move origins into a
parameterised template, so the flat **Origins** and **Behaviors** tabs that
the rest of this step uses would not exist.

The console has reshuffled this wizard more than once. Recent versions split
it across *Get started → Enable security → Review*; older ones show every
panel on one long page. The panels below are named after their headings — if
one is missing from the wizard it moved to the distribution's settings tabs
after creation, and the note under it says where.

### Panel: Origin

The current wizard is the short form: it asks four things and derives the
rest. (An older long form asked for OAC and cache policies inline. If you see
those fields instead, the values are the same ones named below.)

**Origin** — **Browse S3** → pick `hiitsmatt-dev`. If a
`hiitsmatt-dev.s3-website-ap-southeast-2.amazonaws.com` entry also appears,
something enabled static website hosting on the bucket; turn it off before
continuing.

**Origin path** — leave **empty**. It prefixes every request with a folder,
so `/index.html` would become `/some-path/index.html`. Your build sits at the
bucket root.

**Allow private S3 bucket access to CloudFront** — **tick it (Recommended)**.

This single checkbox does both halves of what used to be manual: it creates
the Origin Access Control *and* writes the bucket policy for you, scoped to
this distribution only. It is why Block Public Access can stay fully on.

> Verify it actually landed. After the distribution is created, open
> `https://ap-southeast-2.console.aws.amazon.com/s3/buckets/hiitsmatt-dev?tab=permissions`
> → **Bucket policy**. There should be a statement with
> `"Service": "cloudfront.amazonaws.com"` and an `AWS:SourceArn` naming your
> distribution. If the box is empty, the console lacked `s3:PutBucketPolicy`
> — go to the distribution's **Origins** tab, edit the origin, and use the
> **Copy policy** button to paste it in by hand.

**Origin settings** — **Use recommended origin settings**.

Behind it: connection attempts 3, connection timeout 10s, response timeout
30s, keep-alive 5s, and Origin Shield off. All correct for S3. Origin Shield
in particular is an extra billed caching layer for origins under real load;
yours serves a handful of misses per deploy.

**Cache settings** — **Use recommended cache settings tailored to serving S3
content**.

This applies the `CachingOptimized` managed policy with compression on:
cache on URL alone, forward no headers, cookies or query strings, and honour
the origin's `Cache-Control`. That last part is what makes the deploy script's
headers work — `immutable` on hashed assets, `no-cache` on `index.html`.

Do **not** pick *Customize cache settings* here. The one thing this wizard
cannot do — attaching the `spa-fallback` function — is not on this screen
either way; it is set after creation, in the next section.

**The bucket is empty at this point, and that is correct.** CloudFront does
not inspect an origin when you create one — it records the hostname and
resolves objects per request. The ordering is forced: the distribution has to
exist before `.env.deploy` can name it, and the deploy script needs that id to
invalidate.

The consequence to expect is that the distribution returns `403 AccessDenied`
for everything until step 8. S3 answers 403 rather than 404 for a missing key
when the caller has no `s3:ListBucket` permission, which CloudFront
deliberately does not have — so an empty bucket and a missing bucket policy
look identical from outside. Do not treat a 403 as evidence of either until
after the first deploy.

To test the plumbing before DNS exists, populate it by hand:

```
npm -w client run build
aws s3 cp client/dist s3://hiitsmatt-dev --recursive --region ap-southeast-2
```

Then load `https://<distribution-domain>.cloudfront.net` directly. That
exercises the OAC, the bucket policy and the SPA fallback without
`hiitsmatt.dev` resolving. Step 8 re-uploads everything with correct content
types and cache headers, so this copy is throwaway.

### Panel: Web Application Firewall (WAF)

**Do not enable security protections.**

AWS WAF is billed per web ACL per month plus per million requests, and the
"protections" are managed rule groups aimed at applications that take user
input. Yours is a read-only GET-only site in front of a cache. Enabling it
buys rules against injection attacks on forms you do not have.

### Panel: Settings

If the short-form wizard does not show these, they live on the finished
distribution under **General → Settings → Edit**. Either way the values are
the same, and the certificate and alternate domain names must be set before
step 7's DNS records point anything at it.

**Price class** — **Use all edge locations (best performance)**. The cheaper
classes exclude South America, **Australia and New Zealand**. You are in
Sydney and so is most of your likely audience; excluding Oceania would route
your own visitors through Singapore or Tokyo to save cents on a free-tier
workload.

**Alternate domain names (CNAME)** — add both: `hiitsmatt.dev` and
`www.hiitsmatt.dev`. Without these CloudFront rejects requests carrying that
`Host` header, regardless of DNS.

**Custom SSL certificate** — pick the ACM certificate from step 2. If the
dropdown is empty, it was issued outside `us-east-1` or is still *Pending
validation*.

**Legacy clients support** — **Off**. Dedicated IPs for pre-SNI clients, at
**$600/month**. Read the price before touching this one.

**Security policy** — **TLSv1.2_2021**, the default. Anything older exists
for legacy clients you do not have.

**Supported HTTP versions** — tick **HTTP/2** and **HTTP/3**. Both are free
and reduce round trips.

**Default root object** — **`index.html`**. Without it, `https://hiitsmatt.dev/`
asks S3 for the bucket root and gets a 403. The `spa-fallback` function also
rewrites `/`, so this is belt and braces — set it anyway; the function is
attached per-behaviour and this is not.

**Standard logging** — **Off**. Access logs to S3 that you then pay to store
and never read. CloudWatch metrics on the distribution cover "is it up".

**IPv6** — **On**, the default.

**Description** — optional free text.

Then **Create distribution**. Deployment takes a few minutes and the status
column shows *Deploying*. **Copy the distribution ID** (`E…`) and its
**Domain name** (`d111111abcdef8.cloudfront.net`) — you need the first for
`.env.deploy` and the second for DNS in step 7.

### Tab: Behaviors → edit `Default (*)`

The short-form wizard does not expose the default behaviour, so this is done
after the distribution exists: open it from the Distributions list →
**Behaviors** tab → select `Default (*)` → **Edit**.

Most of it is already right from *recommended cache settings*. Confirm these
and change the last one:

**Path pattern** — `Default (*)`, read-only.

**Compress objects automatically** — **Yes**. CloudFront gzips/brotlis text at
the edge. Your 269 KB entry chunk ships as ~86 KB.

**Viewer protocol policy** — **Redirect HTTP to HTTPS**. `.dev` is
HSTS-preloaded so browsers never try HTTP anyway, but curl and non-browser
clients do.

**Allowed HTTP methods** — **GET, HEAD**. The static site is read-only.
Allowing more widens the surface for nothing.

**Restrict viewer access** — **No**. That is signed URLs/cookies for paid or
private content.

**Cache key and origin requests** — **Cache policy and origin request policy
(recommended)**, not the legacy settings.
  - **Cache policy: `CachingOptimized`** (managed). Caches on URL only,
    forwards no headers/cookies/query strings, honours origin
    `Cache-Control`. The deploy script sets `immutable` on hashed assets and
    `no-cache` on `index.html`, and this policy respects both.
  - **Origin request policy: None.** S3 needs nothing from the viewer.
  - **Response headers policy: None**, or `SecurityHeadersPolicy` if you want
    HSTS, `X-Content-Type-Options` and frame-ancestors headers added at the
    edge. Harmless either way.

**Function associations** — this is the one that matters:
  - **Viewer request** → Function type **CloudFront Functions** → Function ARN
    **`spa-fallback`**.
  - Leave Viewer response, Origin request and Origin response empty.
  - If the dropdown is empty, the function was saved but never **Published**
    in step 5. Publish it and reload.

### Tab: Origins → Create origin (the Lambda)

The distribution now exists, so the rest of step 6 is edits to it rather than
wizard fields. Open it from the Distributions list. You land on **General**;
the tabs across the top are General, Security, Origins, Behaviors,
Error pages, Geographic restrictions, Invalidations, Tags.

**Origins** tab → **Create origin**.

**Create origin, not Edit.** The tab opens with the S3 origin selected, and
the adjacent **Edit** button repoints *that* origin instead of adding a new
one — which silently removes the bucket from the distribution while the
default behaviour still routes to it, so the whole site starts hitting
Lambda. You are finished with this section when the tab reads **Origins (2)**:
one S3, one Lambda function URL, each with its own OAC.

If you have already done it, the repair is to **Edit** that origin back to the
bucket (Browse S3, empty path, the existing S3-type OAC), save, and then use
**Create origin** for the Lambda. Nothing downstream breaks — no behaviour
references the Lambda origin yet.

**Origin domain** — type the Function URL's **hostname only**, by hand:
`abc123xyz.lambda-url.ap-southeast-2.on.aws`. No `https://`, no trailing
slash, no `/api`.

**Fill this field before touching Origin access.** The OAC dialog's *Origin
type* is derived from whatever is in Origin domain, and it is read-only. Open
the dialog first and the dropdown is locked to **S3** with the message "The
origin type must be the same type as origin domain" — cancel, set the domain,
reopen. CloudFront recognises a Lambda origin purely by the literal
`.lambda-url.<region>.on.aws` suffix, so a stray scheme, slash, path or wrong
region leaves it classified as a generic custom origin and keeps the dropdown
locked.

**Protocol** — **HTTPS only**. Function URLs do not serve plain HTTP.

**Origin path** — empty. The Hono app already owns the `/api` prefix via
`basePath("/api")`, so adding it here would produce `/api/api/health`.

**Name** — auto-fills. Note which one it is; the behaviour below selects it
by this name.

**Origin access** — **Origin access control settings** → **Create new OAC**.
This is a *second* OAC; the S3-type one created for the bucket cannot be
reused, because an OAC is bound to exactly one origin type.

| Dialog field | Value |
| --- | --- |
| Name | `hiitsmatt-api-oac` |
| Description | skip |
| Signing behavior | **Sign requests (recommended)** |
| Do not override authorization header | **unchecked** |
| Origin type | **Lambda** (read-only; unlocks once Origin domain is set) |

Leave the authorization checkbox off deliberately. Ticking it tells CloudFront
*not* to sign when the viewer already sent an `Authorization` header — and
since `/api/*` uses `AllViewerExceptHostHeader`, viewer headers are forwarded,
so any scanner sending one would reach the Function URL unsigned and be
rejected by `AWS_IAM` with a 403. Nothing in the API reads `Authorization`.

**Enable Origin Shield** — **No**.

**Additional settings**:
  - **Response timeout: 60** seconds, matching the Lambda's own timeout. Left
    at 30, CloudFront gives up on a cold start that is still working and
    returns a 504.
  - Connection attempts **3**, Connection timeout **10s**, Keep-alive **5s**.

### Tab: Behaviors → Create behavior (`/api/*`)

**Behaviors** tab → **Create behavior**.

**Path pattern** — **`/api/*`**.

**Origin and origin groups** — the Lambda origin from above.

**Compress objects automatically** — **Yes**. JSON compresses well; the
`Content-Encoding` is negotiated per request.

**Viewer protocol policy** — **Redirect HTTP to HTTPS**.

**Allowed HTTP methods** — **GET, HEAD, OPTIONS**. The API declares
`allowMethods: ["GET", "OPTIONS"]` in `server/src/app.ts` and has no mutating
routes.

**Restrict viewer access** — **No**.

**Cache key and origin requests** — **Cache policy and origin request policy
(recommended)**:
  - **Cache policy: `CachingDisabled`** (managed). Correctness first — the
    API's own TTL cache already absorbs repeat GitHub calls, and caching at
    the edge here would serve stale profile and repo data. The optional media
    behaviour below is where edge caching actually pays.
  - **Origin request policy: `AllViewerExceptHostHeader`** (managed).
  - **Response headers policy: None.**

**Function associations** — all four **empty**. Attaching `spa-fallback`
here would rewrite `/api/github/profile` to `/index.html`.

Create it, then check the **Precedence** column on the Behaviors tab:
`/api/*` must sit **above** `Default (*)`. CloudFront evaluates in precedence
order and stops at the first match, so a `/api/*` below the default never
runs.

**Why `AllViewerExceptHostHeader` is mandatory, not a preference.** OAC signs
each request with SigV4 computed over the origin's own hostname. If CloudFront
forwarded the viewer's `Host` (`hiitsmatt.dev`), the signature would cover a
different host than the one Lambda validates, and every API call would return
403. The managed policy forwards everything *except* Host, which is exactly
the shape OAC requires — and it also forwards `Range`, which the media route
needs.

### Let CloudFront invoke the function

The OAC signs requests, but the function still has to allow the distribution.
The Lambda console cannot express this — AWS documents the CLI as the only
supported route. The CloudFront console offers the exact commands behind a
**Copy CLI command** button on the origin; they are reproduced here.

**Two statements are required, not one.** `InvokeFunctionUrl` authorises the
function-URL IAM check; `InvokeFunction` authorises the streaming invoke that
`RESPONSE_STREAM` uses. Omit the second and `/api/*` returns 403 even though
the OAC, the origin request policy and the first statement are all correct.

**Check which account you are pointed at first.** The distribution ARN below
names the account that owns it; if `aws sts get-caller-identity` reports a
different one, these commands target a different Lambda — or none:

```
aws sts get-caller-identity
```

Then, substituting `<ACCOUNT_ID>` and `<DISTRIBUTION_ID>` (the `E…` string
from the distributions list):

```
aws lambda add-permission \
  --function-name hiitsmatt-api \
  --statement-id "AllowCloudFrontServicePrincipal" \
  --action "lambda:InvokeFunctionUrl" \
  --principal "cloudfront.amazonaws.com" \
  --source-arn "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>" \
  --region ap-southeast-2

aws lambda add-permission \
  --function-name hiitsmatt-api \
  --statement-id "AllowCloudFrontServicePrincipalInvokeFunction" \
  --action "lambda:InvokeFunction" \
  --principal "cloudfront.amazonaws.com" \
  --source-arn "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>" \
  --region ap-southeast-2
```

Backslash continuations are POSIX shell syntax. In PowerShell or `cmd`, put
each command on one line, or swap `\` for PowerShell's backtick.

Verify both landed:

```
aws lambda get-policy --function-name hiitsmatt-api --region ap-southeast-2
```

Two statements, each carrying an `AWS:SourceArn` condition naming your
distribution. That condition is what prevents any other CloudFront
distribution, in any account, from invoking the function.

AWS documents this as something to do *before* attaching the OAC to the
origin. Doing it after is not a problem — the policy lives on the Lambda, not
in the distribution, so it takes effect immediately with no redeployment.
Requests simply 403 in the window between the two.

### Optional: cache project media

Media is the expensive path — every uncached byte is a Lambda invocation
streaming from GitHub, and Lambda throttles to 2 MB/s after the first 6 MB of a
response. A dedicated behaviour fixes that:

- **Cache policy** — left sidebar of the CloudFront console → **Policies** →
  *Cache* tab → **Create cache policy**: name `api-media`, TTLs min 0 /
  default 86400 / max 2592000, headers **None**, query strings **None**,
  cookies **None**.
- **Origin request policy** — same page, *Origin request* tab → **Create
  origin request policy**: name `api-media-origin`, headers **None**, query
  strings **None**, cookies **None**.
- **Behavior** → Create: path pattern `/api/github/projects/*`, the Lambda
  origin, the two policies above, precedence above `/api/*`.

Forwarding nothing is deliberate: with no `Range` header reaching the origin,
Lambda always returns the whole object once, CloudFront caches it, and
CloudFront serves the byte ranges itself out of the edge cache.

## 7. Point the domain at CloudFront

In the CloudFront console's **Distributions** list, the **Domain name** column
holds a value like `d111111abcdef8.cloudfront.net`. Copy it.

Then go to <https://dash.cloudflare.com> → **hiitsmatt.dev** → **DNS** →
**Records** → **Add record**, twice:

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| CNAME | `@` | `d111111abcdef8.cloudfront.net` | **DNS only** |
| CNAME | `www` | `d111111abcdef8.cloudfront.net` | **DNS only** |

A CNAME at the apex is illegal in DNS, but Cloudflare flattens root CNAMEs by
default — it answers with the A records it resolves from the target. This is
the feature that removes the need for Route 53 ALIAS records.

**Leave both grey-clouded.** Switching the proxy on (orange) puts Cloudflare's
CDN in front of CloudFront, which buys nothing and costs several things:

- Two caches to invalidate instead of one, so `npm run deploy` stops being
  sufficient to publish a change.
- Cloudflare terminates TLS with its own certificate, making the ACM
  certificate from step 2 dead weight — and unless the zone's SSL mode is
  **Full (strict)**, the hop to CloudFront is validated loosely.
- CloudFront sees Cloudflare's IPs on every request, so any per-IP reasoning
  at the origin sees one client.

Propagation is usually seconds. `nslookup hiitsmatt.dev` should return
CloudFront addresses, not `104.x` Cloudflare ones — a `104.x` answer means the
record is still proxied.

## 8. Deploy

```
copy .env.deploy.example .env.deploy
```

Fill in the four ids you wrote down, then:

```
npm run deploy
```

Which does, in order: refuse to run on a dirty working tree, check
credentials, build the client, bundle the Lambda with the release identifier
compiled in, upload `client/dist` to S3 with correct content types and cache
headers, smoke the bundle locally, publish it, invalidate the shell, and
record the release.

```
npm run deploy -- --web          # static site only
npm run deploy -- --api          # lambda only
npm run deploy -- --skip-build   # reuse existing build output
npm run deploy -- --prune        # also delete objects this build no longer emits
npm run deploy -- --no-tag       # deploy without recording a release
npm run deploy -- --allow-dirty  # ship uncommitted work (implies --no-tag)
```

`--prune` is off by default on purpose. The intro lazy-loads a 1.1 MB three.js
chunk, so deleting the previous build's hashed assets breaks any tab that is
open mid-deploy and has not fetched that chunk yet. Run it occasionally, not
every time.

### Releases

Every full deploy is recorded three ways, all naming the same commit:

| Where | What |
| --- | --- |
| `release-<date>-<n>` | Annotated git tag on the deployed commit — the immutable snapshot |
| `release` branch | Moved to that commit, so `git diff release main` is the unreleased work |
| `/release.json` and `GET /api/health` | The identifier, live, queryable without AWS access |

Tags rather than a branch per release: a branch is a moving pointer that says
"work continues here", while a tag is exactly "this is the state that shipped".
Release *branches* earn their keep when an old release needs patching while
`main` advances, which does not happen with one environment.

The tag is created **after** a successful deploy, never before — a tag naming
a release that failed to upload is worse than no tag. Partial deploys
(`--web`, `--api`) are never tagged, because the two halves would be on
different commits and the result is not one state of the repository.

A dirty working tree is refused outright. Deploying uncommitted work means no
commit describes what is live, which defeats the point of all three records.

**Rolling back:**

```
git checkout release-2026-09-18-1
npm run deploy
```

This deploys the old tree and tags it as a new release — history stays
append-only, and `/api/health` immediately tells you which build is answering.
`git checkout main` afterwards to resume work.

**Confirming what is live:**

```
curl -s https://hiitsmatt.dev/release.json
curl -s https://hiitsmatt.dev/api/health
```

The first is the static site's build, the second is the Lambda's. They should
agree; disagreement means one half of a deploy failed.

## 9. Check it

```
curl -i https://hiitsmatt.dev/api/health
curl -i -o /dev/null -w '%{http_code}\n' https://hiitsmatt.dev/projects/anything
```

- `/api/health` → `200 {"ok":true,...}`. A `403` here means the Lambda resource
  policy or the origin request policy is wrong.
- A deep route → `200` with the HTML shell, not `403`/`404`. A failure here
  means the viewer-request function is missing from the default behaviour.
- Open the site and check the network panel: `assets/*` should be
  `cache-control: public, max-age=31536000, immutable`, `index.html` should be
  `no-cache`.

---

## Things that will bite

**`403` on every API call.** Either the `/api/*` behaviour is not using
`AllViewerExceptHostHeader`, or `lambda add-permission` was never run, or the
`--source-arn` does not match the distribution.

**`403` on the site itself.** The bucket policy CloudFront generated was never
pasted into S3.

**`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`, or CloudFront's "not configured for
this domain".** The distribution has no alternate domain name for
`hiitsmatt.dev`, or the certificate was issued outside `us-east-1`. Because
`.dev` is HSTS-preloaded there is no plain-HTTP fallback to test against —
a TLS failure is the only symptom you get.

**ACM stuck at *Pending validation*.** The validation CNAME at Cloudflare is
orange-clouded, or its name was pasted whole and became
`_x.hiitsmatt.dev.hiitsmatt.dev`. Expand the domain in ACM and compare its
`CNAME name` against what `dig` returns.

**A deploy publishes but the live site does not change.** The DNS records got
proxied at some point, so Cloudflare is caching in front of CloudFront and the
invalidation only cleared one of the two. Grey-cloud them.

**Media stalls or truncates.** The Function URL is still `BUFFERED`. Switch it
to `RESPONSE_STREAM`; the 6 MB buffered ceiling cannot be raised.

**A stale page after deploying.** `index.html` is cached by the browser, not
CloudFront — check it went up with `no-cache`, which the deploy script sets
explicitly.

**Every `.js` served as `text/plain`.** Only if you upload by hand: the AWS CLI
guesses content types from the Windows registry. The deploy script sets them
explicitly for exactly this reason.

**Intermittent 429s from GitHub.** `GITHUB_TOKEN` is missing from the Lambda's
environment, or was set but the function was never redeployed.

**First request of the day is slow.** A cold start plus an empty cache. Real,
and not worth fixing with provisioned concurrency for a portfolio; caching
`/api/github/projects/*` at CloudFront takes the worst of it away.
