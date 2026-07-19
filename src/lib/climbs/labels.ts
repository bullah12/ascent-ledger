import type { AscentStyle, Discipline } from "@/generated/prisma/enums";

export const disciplineLabels: Record<Discipline, string> = {
  rock: "Rock",
  winter: "Winter",
  alpine: "Alpine",
  ski_touring: "Ski touring",
  hiking: "Hiking",
};

export const ascentStyleLabels: Record<AscentStyle, string> = {
  led: "Led",
  alternate_lead: "Alternate lead",
  seconded: "Seconded",
  solo: "Solo",
  roped_solo: "Roped solo",
};
