import Link from "next/link";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/logbook", label: "Logbook" },
  { href: "/routes", label: "Routes" },
  { href: "/map", label: "Map" },
] as const;

export function SiteNav({ current }: { current: (typeof links)[number]["href"] }) {
  return (
    <nav className="mb-6 flex gap-1 border-b pb-2 text-sm">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "rounded-md px-3 py-1.5 hover:bg-muted",
            href === current
              ? "font-semibold text-foreground"
              : "text-muted-foreground"
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
