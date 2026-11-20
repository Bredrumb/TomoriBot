/**
 * STM category label → slug utilities.
 *
 * Both the STM update tool (parameter names) and the context renderer (value look-up)
 * must derive the same slug from a label. Keep both callers in sync through this module.
 */

/**
 * Converts a category label to a valid snake_case property name.
 *
 * Rules (applied in order):
 * 1. Lowercase the entire string
 * 2. Replace whitespace and non-word characters with `_`
 * 3. Strip any remaining characters outside `[a-z0-9_]`
 * 4. Collapse consecutive underscores
 * 5. Trim leading and trailing underscores
 * 6. Prepend `c_` when the result starts with a digit (identifiers must start with a letter)
 * 7. Cap at 48 characters
 *
 * @param label - The human-readable category label (e.g. "My Goals!")
 * @returns A safe snake_case slug (e.g. "my_goals")
 */
export function slugifyLabel(label: string): string {
  let slug = label.toLowerCase();
  slug = slug.replace(/[\s\W]+/g, "_");
  slug = slug.replace(/[^a-z0-9_]/g, "");
  slug = slug.replace(/_+/g, "_");
  slug = slug.replace(/^_+|_+$/g, "");
  if (slug && /^[0-9]/.test(slug)) slug = `c_${slug}`;
  return slug.slice(0, 48);
}

/**
 * Builds an ordered slug→label map from a list of category definitions.
 * Collisions are resolved deterministically by appending `_2`, `_3`, etc.
 *
 * @param categories - Ordered category definitions (label required)
 * @returns Map where each key is the derived slug and the value is the original label
 */
export function buildSlugMap(categories: ReadonlyArray<{ label: string }>): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();

  for (const cat of categories) {
    let slug = slugifyLabel(cat.label);
    if (!slug) slug = "field";

    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}_${n}`)) n++;
      slug = `${slug}_${n}`;
    }

    used.add(slug);
    map.set(slug, cat.label);
  }

  return map;
}
