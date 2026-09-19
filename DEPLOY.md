# Deploying

The site goes online as two artifacts behind one CloudFront distribution:

```
                          your-domain.com
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

Running cost is roughly **$1/month**: a Route 53 hosted zone is $0.50, and a
portfolio's traffic disappears inside CloudFront's and Lambda's free tiers.

---

## Before you start

- An AWS account you are happy to attach a personal domain to. If your CLI is
  currently pointed at a work account, make a separate one — `aws sts
  get-caller-identity` tells you which you are about to deploy into.
- The AWS CLI, logged in: `aws configure` or `AWS_PROFILE`.
- A GitHub personal access token, classic, **no scopes ticked**. See
  `server/.env.example` for why it matters more in production than locally.

Pick one region for the bucket and the function and use it throughout; this
guide writes `eu-west-2`. CloudFront is global, and the certificate is the one
exception — see step 2.

---

## 1. Buy the domain

Two registrars worth using:

| Registrar | .com / year | Trade-off |
| --- | --- | --- |
| **Cloudflare Registrar** | ~$10.44 | At cost, no renewal markup, free WHOIS privacy. Your DNS lives at Cloudflare, so step 7 is a CNAME. |
| **Route 53** | ~$14 + $0.50/mo zone | Everything in one account. ALIAS records to CloudFront, and certificate validation is one button. |

Either works. Route 53 costs a few dollars more a year and removes two
context switches; the rest of this guide assumes it, and step 7 covers both.

**Route 53 → Registered domains → Register domains.** Registration takes a few
minutes to an hour, and creates the hosted zone for you.

## 2. Request the certificate — in us-east-1

**Certificate Manager, region `us-east-1`.** Not your chosen region.
CloudFront reads certificates from `us-east-1` only, and there is no way to
change that; a certificate in the wrong region simply will not appear in the
distribution's dropdown later.

- Request a public certificate.
- Domain names: `your-domain.com` **and** `www.your-domain.com`.
- Validation: DNS.
- On the certificate page, **Create records in Route 53** (or copy the CNAMEs
  to your registrar's DNS). Status reaches *Issued* within minutes.

## 3. Create the S3 bucket

**S3 → Create bucket.**

- Name: anything unique — it is never in a URL. `hiitsmatt-site` is fine.
- Region: your chosen region.
- **Block all public access: ON.** Leave it on. CloudFront reaches the bucket
  through an Origin Access Control, which is why this can stay locked down.
- Do **not** enable "Static website hosting". That feature exists to serve a
  bucket directly over HTTP; you are not doing that, and turning it on would
  create a second, public way into your files.

## 4. Create the Lambda

**Lambda → Create function → Author from scratch.**

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
| `GITHUB_TOKEN` | the scopeless token |
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
- Invoke mode: **RESPONSE_STREAM**. This one is load-bearing. Buffered
  responses cap at 6 MB after base64 inflation, and project media goes up to
  40 MB; streaming raises that to 200 MB and preserves the `206` +
  `Content-Range` that a video player's range requests depend on.
- Copy the URL. You need its hostname in step 6.

Now push the code once, so the function is not empty when CloudFront starts
sending it traffic:

```
npm -w server run bundle
node scripts/smoke-lambda.js       # loads the real bundle, expects 200
```

The full `npm run deploy` in step 8 does both, plus the upload.

## 5. Create the SPA-fallback CloudFront Function

**CloudFront → Functions → Create function.**

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

**CloudFront → Create distribution.**

### Origin 1 — the bucket

- Origin domain: your bucket (pick the S3 entry, not the website endpoint).
- Origin access: **Origin access control settings** → *Create new OAC* → accept
  the defaults → Create.
- CloudFront then shows a bucket policy to copy. **Copy policy**, then paste it
  into S3 → your bucket → Permissions → Bucket policy. Nothing works until you
  do; this is the step everyone skips.

### Default cache behaviour

- Viewer protocol policy: **Redirect HTTP to HTTPS**
- Allowed methods: **GET, HEAD**
- Compress objects automatically: **Yes**
- Cache policy: **CachingOptimized**
- Function associations → **Viewer request**: CloudFront Functions →
  `spa-fallback`

### Settings

- Alternate domain names (CNAMEs): `your-domain.com`, `www.your-domain.com`
- Custom SSL certificate: the one from step 2
- Default root object: **`index.html`**

Create the distribution. Deployment takes a few minutes. **Copy the
distribution ID** (`E…`) and the ARN.

### Origin 2 — the Lambda

**Origins → Create origin.**

- Origin domain: the Function URL's **hostname only** — `abc123.lambda-url.eu-west-2.on.aws`,
  with no `https://` and no trailing slash.
- Origin type / protocol: HTTPS only.
- Origin access: **Origin access control settings** → *Create new OAC* →
  **Origin type: Lambda** → Signing behavior: **Sign requests** → Create.
- Response timeout: **60** seconds, to match the function.

### Behaviour for `/api/*`

**Behaviors → Create behavior.**

- Path pattern: **`/api/*`**
- Origin: the Lambda origin
- Viewer protocol policy: **Redirect HTTP to HTTPS**
- Allowed methods: **GET, HEAD, OPTIONS**
- Cache policy: **CachingDisabled**
- Origin request policy: **AllViewerExceptHostHeader**

That origin request policy is mandatory, not a preference. OAC signs the
request with SigV4 over the origin's own hostname; if CloudFront forwarded the
viewer's `Host` header the signature would not match and every API call would
return 403.

Check the precedence list afterwards: `/api/*` must sit **above** `Default (*)`.

### Let CloudFront invoke the function

The OAC signs requests, but the function still has to allow the distribution.
The console's resource-policy editor does not offer this combination cleanly;
the CLI does:

```
aws lambda add-permission \
  --function-name hiitsmatt-api \
  --statement-id cloudfront-oac \
  --action lambda:InvokeFunctionUrl \
  --principal cloudfront.amazonaws.com \
  --source-arn arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID> \
  --function-url-auth-type AWS_IAM \
  --region eu-west-2
```

### Optional: cache project media

Media is the expensive path — every uncached byte is a Lambda invocation
streaming from GitHub, and Lambda throttles to 2 MB/s after the first 6 MB of a
response. A dedicated behaviour fixes that:

- **Cache policy** → Create: name `api-media`, TTLs min 0 / default 86400 /
  max 2592000, headers **None**, query strings **None**, cookies **None**.
- **Origin request policy** → Create: name `api-media-origin`, headers
  **None**, query strings **None**, cookies **None**.
- **Behavior** → Create: path pattern `/api/github/projects/*`, the Lambda
  origin, the two policies above, precedence above `/api/*`.

Forwarding nothing is deliberate: with no `Range` header reaching the origin,
Lambda always returns the whole object once, CloudFront caches it, and
CloudFront serves the byte ranges itself out of the edge cache.

## 7. Point the domain at CloudFront

**Route 53** → your hosted zone → Create record:

- `your-domain.com` → type **A** → **Alias** → Alias to CloudFront distribution
  → pick yours.
- Repeat for `www.your-domain.com`.

Alias records, not CNAMEs: a zone apex cannot hold a CNAME, and aliases are
free to query.

**On another registrar's DNS**, the apex needs whatever flattening they offer
(Cloudflare: a proxied/flattened CNAME to the distribution domain), and `www`
is a plain CNAME to `d111111abcdef8.cloudfront.net`.

## 8. Deploy

```
cp .env.deploy.example .env.deploy
```

Fill in the four ids you wrote down, then:

```
npm run deploy
```

Which does, in order: check credentials, build the client, bundle the Lambda,
upload `client/dist` to S3 with correct content types and cache headers, smoke
the bundle locally, publish it, and invalidate the shell.

```
npm run deploy -- --web          # static site only
npm run deploy -- --api          # lambda only
npm run deploy -- --skip-build   # reuse existing build output
npm run deploy -- --prune        # also delete objects this build no longer emits
```

`--prune` is off by default on purpose. The intro lazy-loads a 1.1 MB three.js
chunk, so deleting the previous build's hashed assets breaks any tab that is
open mid-deploy and has not fetched that chunk yet. Run it occasionally, not
every time.

## 9. Check it

```
curl -i https://your-domain.com/api/health
curl -i -o /dev/null -w '%{http_code}\n' https://your-domain.com/projects/anything
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
