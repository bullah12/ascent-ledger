import Link from "next/link";
import type { GradeSystem } from "@/generated/prisma/enums";
import { gradeLadder, gradeSystemLabels } from "@/lib/grades";

export function GradeHint({ system }: { system: GradeSystem }) {
  const ladder = gradeLadder(system);
  const labels = ladder.entries.map((entry) => entry.label).join(" · ");

  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <span
        tabIndex={0}
        role="img"
        aria-label={`About ${gradeSystemLabels[system]} grades`}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-72 -translate-x-1/2 rounded-md border bg-popover p-3 text-left text-xs font-normal text-popover-foreground shadow-md group-hover:block group-focus-within:block">
        <strong>{gradeSystemLabels[system]}</strong>
        <span className="mt-1 block text-muted-foreground">
          {ladder._note ?? "Grades are ordinal within this system only."}
        </span>
        {labels && <span className="mt-1 block">{labels}</span>}
        <Link href="/help/grades" className="pointer-events-auto mt-2 block underline">
          See all grade ladders
        </Link>
      </span>
    </span>
  );
}
