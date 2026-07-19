import { z } from "zod";
import { AscentStyle, Discipline, GradeSystem } from "@/generated/prisma/enums";
import { gradeSystemsByDiscipline } from "@/lib/grades";

export const climbInputSchema = z.object({
  routeName: z
    .string()
    .trim()
    .min(1, "Route name is required")
    .max(200, "Route name is too long"),
  discipline: z.enum(Discipline, { error: "Pick a discipline" }),
  date: z.iso.date({ error: "Pick a date" }),
  gradeSystem: z.enum(GradeSystem, { error: "Pick a grade system" }),
  gradeRaw: z
    .string()
    .trim()
    .min(1, "Grade is required")
    .max(50, "Grade is too long"),
  ascentStyle: z.enum(AscentStyle, { error: "Pick an ascent style" }),
  area: z.string().trim().max(120, "Area name is too long").optional(),
  notes: z.string().trim().max(2000, "Notes are too long").optional(),
  // Optional link to a canonical Route (Phase 3); climbs may stay free-text.
  routeId: z.uuid({ error: "Invalid route" }).optional(),
}).refine(
  (climb) => gradeSystemsByDiscipline[climb.discipline].includes(climb.gradeSystem),
  { error: "Grade system does not match the discipline", path: ["gradeSystem"] }
);

export type ClimbInput = z.infer<typeof climbInputSchema>;
