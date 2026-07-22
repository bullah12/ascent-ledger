import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/routes", label: "Routes" },
  { href: "/my-trails", label: "My trails" },
  { href: "/map", label: "Map" },
  { href: "/logbook", label: "Log" },
  { href: "/progress", label: "Progress" },
  { href: "/for-you", label: "For you" },
] as const;

export function SiteNav({ current }: { current: string }) {
  return (
    <header className="relative left-1/2 z-30 mb-8 w-screen -translate-x-1/2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-[72px] w-full max-w-[1500px] items-stretch gap-5 px-4 sm:px-6 lg:px-8">
        <Link
          href="/dashboard"
          aria-label="Ascent Ledger dashboard"
          className="flex shrink-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="size-[17px] rotate-45 rounded-[3px] bg-primary" />
          <span className="hidden text-[17px] leading-[0.95] font-extrabold tracking-[-0.02em] sm:block">
            ASCENT<br /><span className="text-primary">LEDGER</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex h-full min-w-max items-stretch justify-start lg:justify-center">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex items-center px-3 font-mono text-[12px] uppercase tracking-[0.055em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  href === current
                    ? "font-semibold text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </Link>
            ))}
          </div>
        </nav>

        <form action="/routes" role="search" className="hidden items-center lg:flex">
          <label className="relative block">
            <span className="sr-only">Search routes</span>
            <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="q"
              placeholder="Search routes…"
              className="h-9 w-52 rounded-full border bg-card pr-3 pl-9 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </form>

        <Link
          href="/settings"
          aria-label="Open settings"
          className="my-auto hidden size-9 shrink-0 items-center justify-center rounded-full bg-clay text-xs font-bold text-clay-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
        >
          AL
        </Link>
      </div>
    </header>
  );
}
