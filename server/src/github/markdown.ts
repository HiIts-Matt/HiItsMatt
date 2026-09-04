// A linked badge is an image wrapped in a link; both forms must go before the
// generic link flattening runs, otherwise a badge row looks like a sentence.
const LINKED_IMAGE = /\[\s*!\[[^\]]*\]\([^)]*\)\s*\]\([^)]*\)/g;
const INLINE_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const REFERENCE_IMAGE = /!\[[^\]]*\]\[[^\]]*\]/g;
const BADGE_HOSTS = /shields\.io|badge\.fury\.io|badgen\.net|forthebadge\.com|badge\.svg/;

/**
 * Reduces a README to one line of plain prose for the project carousel.
 * Order matters: fenced code and HTML go first so their contents never leak
 * into the excerpt, badge rows are removed while image syntax is still intact,
 * and marker stripping runs last on text that is already plain. The result is
 * the first paragraph that still reads as prose, not the whole document.
 */
export function readmeExcerpt(markdown: string, maxChars = 240): string | null {
  let text = markdown;

  // Fenced code blocks. A terminated block and a dangling opening fence need
  // separate passes: with the `m` flag `$` matches the end of the *opening*
  // line, so one combined pattern would strip only the fence itself.
  text = text.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1+[ \t]*$/gm, "\n");
  text = text.replace(/^[ \t]*(?:```|~~~)[\s\S]*/m, "\n");

  // HTML comments, then tags (READMEs commonly open with a centred <div>/<img>).
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, " ");

  // Drop lines that hold nothing but badges/images, and any line hosting a
  // shield, but keep lines where prose merely sits next to an image.
  text = text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        return true;
      }

      if (BADGE_HOSTS.test(trimmed)) {
        return false;
      }

      const withoutImages = trimmed
        .replace(LINKED_IMAGE, "")
        .replace(INLINE_IMAGE, "")
        .replace(REFERENCE_IMAGE, "")
        .replace(/[\s|*_-]+/g, "");

      return withoutImages.length > 0;
    })
    .join("\n");

  // Surviving images go; links collapse to their label text.
  text = text.replace(LINKED_IMAGE, " ").replace(INLINE_IMAGE, " ").replace(REFERENCE_IMAGE, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Heading markers, blockquote markers, list bullets, horizontal rules.
  text = text.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, " ");
  text = text.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "");

  // Emphasis and inline-code markers.
  text = text.replace(/`+/g, "");
  // Underscores only strip at word edges so snake_case identifiers survive.
  text = text.replace(/\*\*|~~|\*|(?<!\w)__?|__?(?!\w)/g, "");

  // Paragraphs, not the whole document: the first real prose block is the
  // description, while what precedes it is usually the title and badges.
  const blocks = text
    .split(/\n[ \t]*\n/)
    .map((block) => block.replace(/&nbsp;|&#8203;/g, " ").replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0);

  // Prose-like means multi-word and either long enough or a finished sentence;
  // that rejects titles ("my-project"), nav headings ("Table of Contents") and
  // leftover badge captions without discarding a genuine one-line summary.
  const prose = blocks.find(
    (block) => /\S\s\S/.test(block) && (block.length >= 20 || /[.!?][")'\]]?$/.test(block)),
  );

  if (!prose) {
    return null;
  }

  if (prose.length <= maxChars) {
    return prose;
  }

  // Prefer ending on a sentence boundary; fall back to a word boundary.
  const window = prose.slice(0, maxChars + 1);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );

  if (sentenceEnd > maxChars * 0.4) {
    return window.slice(0, sentenceEnd + 1);
  }

  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? window.slice(0, lastSpace) : prose.slice(0, maxChars);

  return `${cut.replace(/[,;:.\s]+$/, "")}\u2026`;
}
