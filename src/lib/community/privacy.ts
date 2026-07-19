import type { AscentStyle } from "@/generated/prisma/enums";

type PublicTickSource = {
  visibility: "private" | "public";
  user: { displayName: string | null };
  route: { name: string } | null;
  freeTextRouteName: string;
  date: Date;
  gradeRaw: string;
  ascentStyle: AscentStyle;
};

export type PublicTick = {
  displayName: string;
  routeName: string;
  date: string;
  grade: string;
  ascentStyle: AscentStyle;
};

export function safeDisplayName(displayName: string | null | undefined): string {
  return displayName?.trim() || "Ascent Ledger member";
}

/** This is the only app DTO for a public climb. Extra source properties are
 * deliberately ignored, so sensitive logbook/user fields cannot pass through. */
export function projectPublicTick(source: PublicTickSource): PublicTick {
  return {
    displayName: safeDisplayName(source.user.displayName),
    routeName: source.route?.name ?? source.freeTextRouteName,
    date: source.date.toISOString().slice(0, 10),
    grade: source.gradeRaw,
    ascentStyle: source.ascentStyle,
  };
}

export function projectPublicTicks(sources: PublicTickSource[]): PublicTick[] {
  return sources
    .filter((source) => source.visibility === "public" && source.route !== null)
    .map(projectPublicTick);
}
