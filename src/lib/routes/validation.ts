import { z } from "zod";
import { Discipline, GradeSystem } from "@/generated/prisma/enums";
import { gradeSystemsByDiscipline } from "@/lib/grades";

const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined
        ? undefined
        : Number(value),
    schema.optional()
  );

export const routeInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Route name is required")
      .max(200, "Route name is too long"),
    discipline: z.enum(Discipline, { error: "Pick a discipline" }),
    gradeSystem: z.enum(GradeSystem, { error: "Pick a grade system" }),
    gradeRaw: z.string().trim().max(50, "Grade is too long").optional(),
    area: z.string().trim().max(120, "Area name is too long").optional(),
    lat: optionalNumber(
      z
        .number({ error: "Latitude must be a number" })
        .min(-90, "Latitude out of range")
        .max(90, "Latitude out of range")
    ),
    lng: optionalNumber(
      z
        .number({ error: "Longitude must be a number" })
        .min(-180, "Longitude out of range")
        .max(180, "Longitude out of range")
    ),
    lengthM: optionalNumber(z.number().int().nonnegative("Distance cannot be negative")),
    ascentM: optionalNumber(z.number().int().nonnegative("Ascent cannot be negative")),
    estimatedDurationMins: optionalNumber(z.number().int().positive("Duration must be positive")),
    description: z
      .string()
      .trim()
      .max(4000, "Description is too long")
      .optional(),
  })
  .refine((route) => (route.lat === undefined) === (route.lng === undefined), {
    error: "Provide both latitude and longitude, or neither",
    path: ["lng"],
  })
  .refine(
    (route) => gradeSystemsByDiscipline[route.discipline].includes(route.gradeSystem),
    { error: "Grade system does not match the discipline", path: ["gradeSystem"] }
  );

export type RouteInput = z.infer<typeof routeInputSchema>;
