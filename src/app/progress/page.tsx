import { requireOnboardedUser } from "@/lib/auth";
import { getUserProgressAndSuggestions } from "@/lib/bmg/user-progress";
import { prisma } from "@/lib/prisma";
import { SiteNav } from "@/components/site-nav";
import { Card, CardTitle } from "@/components/ui/card";
import { ProgressContent } from "./progress-content";

export default async function ProgressPage() {
  const user = await requireOnboardedUser();
  const { hasRules, progress, hasUnverified, categorySuggestions } =
    await getUserProgressAndSuggestions(prisma, user);
  const overall = progress.length ? Math.round(progress.reduce((sum, category) => sum + category.percent, 0) / progress.length) : 0;

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 sm:px-6 lg:px-8">
      <SiteNav current="/progress" />
      <header className="mb-8 flex items-end justify-between gap-5">
        <div>
          <p className="instrument-label mb-2 text-primary">British Mountain Guide · prerequisites</p>
          <h1 className="page-title">Your progression</h1>
        </div>
        <div className="text-right"><p className="text-4xl font-extrabold text-primary sm:text-5xl">{overall}%</p><p className="instrument-label">Overall readiness</p></div>
      </header>

      {!hasRules ? (
        <Card className="border-dashed p-8 text-center"><CardTitle>No BMG rules loaded</CardTitle><p className="mt-2 text-sm text-muted-foreground">Load the prerequisite rules to calculate progress from your real logbook.</p></Card>
      ) : (
        <ProgressContent
          progress={progress}
          categorySuggestions={categorySuggestions}
          hasUnverified={hasUnverified}
        />
      )}
    </main>
  );
}
