/**
 * Single source of truth for the landing page's snap targets: the side nav, the
 * scroll observer and the section elements all read this list, so adding a
 * section is one entry plus one component.
 */
export const SECTIONS = [
  { id: "intro", label: "Intro" },
  { id: "overview", label: "Overview", note: "Github Plug" },
  { id: "career", label: "Career", note: "On the clock" },
  { id: "projects", label: "Personal Work", note: "In my own time" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((section) => section.id);

/** A page's own URL: the intro is the site root, every other page its id. */
export function pagePath(id: string): string {
  return id === "intro" ? "/" : `/${id}`;
}

/** A project's own page, dealt over the projects page. */
export function projectPath(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}`;
}

export type SectionMeta = {
  readonly id: SectionId;
  readonly label: string;
  /** Zero-padded position: the "02" in "02 — Straight from GitHub". */
  readonly number: string;
  /** The mono line above the display heading; absent on the intro. */
  readonly note?: string;
};

/**
 * Position is derived from the list order rather than written down twice, so the
 * rail's index and the section's own heading can never disagree.
 */
export const SECTION_META: Readonly<Record<SectionId, SectionMeta>> = Object.fromEntries(
  SECTIONS.map((section, index) => [
    section.id,
    { ...section, number: String(index + 1).padStart(2, "0") },
  ]),
) as Record<SectionId, SectionMeta>;
