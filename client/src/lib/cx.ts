/** Joins the truthy class names. Small enough not to warrant a dependency. */
export function cx(...names: Array<string | false | null | undefined>): string {
  let out = "";
  for (const name of names) {
    if (!name) continue;
    if (out) out += " ";
    out += name;
  }
  return out;
}
