export function slugifyLabel(label: string): string {
  let slug = label.toLowerCase();
  slug = slug.replace(/[\s\W]+/g, "_");
  slug = slug.replace(/[^a-z0-9_]/g, "");
  slug = slug.replace(/_+/g, "_");
  slug = slug.replace(/^_+|_+$/g, "");
  if (slug && /^[0-9]/.test(slug)) slug = `c_${slug}`;
  return slug.slice(0, 48);
}

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
