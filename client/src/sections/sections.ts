/**
 * Single source of truth for the landing page's snap targets: the side nav, the
 * scroll observer and the section elements all read this list, so adding a
 * section is one entry plus one component.
 */
export const SECTIONS = [
  { id: "intro", label: "Intro" },
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((section) => section.id);
