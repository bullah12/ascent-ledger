import { Check, X } from "lucide-react";
import { resolveSuggestion } from "./actions";
import { Button } from "@/components/ui/button";

export type SuggestionRow = {
  id: string;
  climbName: string;
  climbDate: string;
  routeName: string;
  routeGrade: string | null;
  routeArea: string | null;
  routeUrl: string | null;
};

// Pending fuzzy climb→route matches from the import sync. Server-rendered;
// accept/reject are plain form posts to the resolveSuggestion action.
export function LinkSuggestions({ suggestions }: { suggestions: SuggestionRow[] }) {
  if (suggestions.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border bg-muted/30 p-4">
      <h2 className="font-semibold">Link suggestions</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        These logbook entries look like routes in the database. Linking puts
        them on the map — nothing is linked without your say-so.
      </p>
      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <li
            key={suggestion.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{suggestion.climbName}</span>{" "}
              <span className="text-muted-foreground">
                ({suggestion.climbDate})
              </span>{" "}
              →{" "}
              {suggestion.routeUrl ? (
                <a
                  href={suggestion.routeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {suggestion.routeName}
                </a>
              ) : (
                suggestion.routeName
              )}
              <span className="text-muted-foreground">
                {suggestion.routeGrade ? ` · ${suggestion.routeGrade}` : ""}
                {suggestion.routeArea ? ` · ${suggestion.routeArea}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 gap-1">
              <form action={resolveSuggestion}>
                <input type="hidden" name="suggestionId" value={suggestion.id} />
                <input type="hidden" name="decision" value="accept" />
                <Button type="submit" size="sm" variant="outline">
                  <Check className="size-4" /> Link
                </Button>
              </form>
              <form action={resolveSuggestion}>
                <input type="hidden" name="suggestionId" value={suggestion.id} />
                <input type="hidden" name="decision" value="reject" />
                <Button type="submit" size="sm" variant="ghost" aria-label="Reject suggestion">
                  <X className="size-4" />
                </Button>
              </form>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
