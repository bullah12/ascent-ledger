import type { TagKind } from "@/generated/prisma/enums";

export type TagCountRow = {
  slug: string;
  label: string;
  kind: TagKind;
  _count: { routeTags: number };
};

export type TagChip = { slug: string; label: string; kind: TagKind; count: number };

export function tagChipsFromCounts(rows: TagCountRow[]): TagChip[] {
  return rows
    .filter((row) => row._count.routeTags > 0)
    .map((row) => ({
      slug: row.slug,
      label: row.label,
      kind: row.kind,
      count: row._count.routeTags,
    }));
}
