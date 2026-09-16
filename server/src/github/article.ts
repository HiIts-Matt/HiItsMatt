import MarkdownIt from "markdown-it";

import type { ProjectMediaKind } from "./types.js";

/**
 * `.portfolio/article.md` — the long-form body of a project's own page —
 * rendered here rather than by GitHub's `/markdown` endpoint.
 *
 * Two reasons it is ours to render. The article is written for this site, so
 * GitHub's issue references and repo-relative link resolution are the wrong
 * context entirely; and a private repository's article would otherwise cost a
 * round trip to an API that renders it against a repo the visitor cannot see.
 * The only thing the source may address is its own `.portfolio/media`, and
 * resolving those paths is something only this server can do — they are served
 * through its proxy, not from raw.githubusercontent.com.
 *
 * `html: false` is the security boundary: raw HTML in the source is escaped
 * rather than passed through, so nothing the markdown contains can become
 * markup on the page. That is what makes the result safe to hand to
 * `dangerouslySetInnerHTML` without a sanitiser sitting behind it.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/** One asset the article is allowed to address, already proxied. */
export type ArticleAsset = { url: string; kind: ProjectMediaKind };

export type ArticleContext = {
  /**
   * Maps a path written in the article to a published asset, or `undefined`
   * when the repository does not contain it. This is the same allowlist the
   * media proxy authorises against, so an article can never address a file the
   * proxy would refuse to serve.
   */
  resolve: (src: string) => ArticleAsset | undefined;
};

/** Schemes a link may keep. Everything else is a path into the repository. */
const ABSOLUTE = /^(?:https?:|mailto:)/i;

/**
 * Images: published assets only.
 *
 * A relative path that names nothing, or an image hotlinked from another site,
 * degrades to its alt text. A broken frame in the middle of a case study is
 * worse than a sentence, and an off-site image would also hand a third party
 * the visitor's address on a page that otherwise makes no external requests.
 *
 * Videos are written the same way — `![Tour](media/tour.mp4)` — because the
 * author should not have to know which tag the extension implies.
 */
md.renderer.rules.image = (tokens, index, _options, env) => {
  const token = tokens[index];
  if (!token) return "";

  const alt = md.utils.escapeHtml(token.content);
  // `attrGet` is typed loosely — a numeric attribute value is possible in the
  // token stream even though a parsed `src` never is.
  const src = String(token.attrGet("src") ?? "");
  const asset = src && !ABSOLUTE.test(src) ? (env as ArticleContext).resolve(src) : undefined;

  if (!asset) return alt;

  const url = md.utils.escapeHtml(asset.url);

  if (asset.kind === "video") {
    // `preload="metadata"` so a page of clips costs a poster frame each rather
    // than the whole file; muted+playsinline keeps an inline tap-to-play
    // working on iOS.
    return `<video src="${url}" controls muted playsinline preload="metadata"${
      alt ? ` aria-label="${alt}"` : ""
    }></video>`;
  }

  return `<img src="${url}" alt="${alt}" loading="lazy" decoding="async">`;
};

/**
 * Links: absolute ones open away from the site, asset paths point at the
 * proxy, and anything else loses its `href`.
 *
 * That last case is a link into the repository's own tree — `src/main.ts`,
 * `../other-project` — which this site cannot serve. Resolved against a hash
 * route it would navigate the visitor to a page that does not exist, so the
 * text stays and the link does not.
 */
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (!token) return "";

  const href = String(token.attrGet("href") ?? "");
  const asset = ABSOLUTE.test(href) ? undefined : (env as ArticleContext).resolve(href);

  if (asset) {
    token.attrSet("href", asset.url);
  } else if (!ABSOLUTE.test(href)) {
    const at = token.attrIndex("href");
    if (at >= 0) token.attrs?.splice(at, 1);

    return self.renderToken(tokens, index, options);
  }

  token.attrSet("target", "_blank");
  token.attrSet("rel", "noreferrer noopener");

  return self.renderToken(tokens, index, options);
};

export function renderArticle(markdown: string, context: ArticleContext): string {
  return md.render(markdown, context);
}
