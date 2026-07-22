"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { disciplineLabels } from "@/lib/climbs/labels";
import type { Discipline } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LinkedRoute = {
  id: string;
  kind: "canonical" | "custom";
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
 * Optional link step over approved canonical routes plus the signed-in
 * owner's custom trails. Separate hidden IDs prevent the two namespaces from
 * being confused; climbs can also stay unlinked (free-text only).
 */
export function RoutePicker({
  initialRoute,
  onSelect,
  onClear,
}: {
  initialRoute?: LinkedRoute | null;
  onSelect?: (route: LinkedRoute) => void;
  onClear?: () => void;
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
      <input type="hidden" name="routeId" value={selected?.kind === "canonical" ? selected.id : ""} />
      <input type="hidden" name="customTrailId" value={selected?.kind === "custom" ? selected.id : ""} />

      {selected ? (
        <div className="flex items-center gap-4 rounded-xl border bg-background p-3 text-sm">
          <span aria-hidden className="topographic-placeholder size-12 shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold">{selected.name}{selected.kind === "custom" ? " · My trail" : ""}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {[selected.areaName, selected.gradeRaw, disciplineLabels[selected.discipline]].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Change linked route"
            onClick={() => { setSelected(null); onClear?.(); }}
          >
            <X className="size-4" />
            <span className="sr-only">Change</span>
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search aria-hidden className="absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="route-search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search the route database by name…"
            autoComplete="off"
            className="h-11 pl-9"
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
