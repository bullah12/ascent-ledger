"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { disciplineLabels } from "@/lib/climbs/labels";
import type { Discipline } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LinkedRoute = {
  id: string;
  name: string;
  discipline: Discipline;
  gradeRaw: string | null;
  areaName: string | null;
};

function routeLabel(route: LinkedRoute): string {
  const parts = [route.name];
  if (route.gradeRaw) parts.push(route.gradeRaw);
  if (route.areaName) parts.push(route.areaName);
  return parts.join(" · ");
}

/**
 * Optional "link this climb to a Route" step: search-by-name against the
 * Route table. Renders a hidden routeId input for the form action; climbs
 * can stay unlinked (free-text only).
 */
export function RoutePicker({
  initialRoute,
  onSelect,
}: {
  initialRoute?: LinkedRoute | null;
  onSelect?: (route: LinkedRoute) => void;
}) {
  const [selected, setSelected] = useState<LinkedRoute | null>(
    initialRoute ?? null
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkedRoute[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // State resets live in the change handler (not the effect) so the effect
  // only schedules the debounced fetch — its callbacks may set state.
  function handleQueryChange(value: string) {
    setQuery(value);
    const active = value.trim().length >= 2;
    setSearching(active);
    if (!active) setResults([]);
  }

  useEffect(() => {
    abortRef.current?.abort();
    if (query.trim().length < 2) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/routes/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = (await res.json()) as { routes: LinkedRoute[] };
          setResults(data.routes);
        }
        setSearching(false);
      } catch {
        // Aborted by a newer keystroke — the next request reports instead.
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="grid gap-2">
      <Label htmlFor="route-search">
        Link to a route{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <input type="hidden" name="routeId" value={selected?.id ?? ""} />

      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span className="truncate">{routeLabel(selected)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Unlink route"
            onClick={() => setSelected(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id="route-search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search the route database by name…"
            autoComplete="off"
          />
          {query.trim().length >= 2 && (
            <div className="absolute top-full z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {searching ? "Searching…" : "No matching routes"}
                </p>
              ) : (
                <ul>
                  {results.map((route) => (
                    <li key={route.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setSelected(route);
                          setQuery("");
                          onSelect?.(route);
                        }}
                      >
                        <span className="truncate">{routeLabel(route)}</span>
                        <Badge variant="secondary" className="shrink-0">
                          {disciplineLabels[route.discipline]}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
