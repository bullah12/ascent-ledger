"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type DashboardTab = "progress" | "info";

export function DashboardTabs({
  progress,
  info,
}: {
  progress: ReactNode;
  info: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("progress");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="mb-6 flex gap-1 border-b"
      >
        {([
          ["progress", "Progress"],
          ["info", "Info"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            id={`dashboard-${value}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            aria-controls={`dashboard-${value}-panel`}
            tabIndex={activeTab === value ? 0 : -1}
            onClick={() => setActiveTab(value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:rounded-t-md focus-visible:ring-2 focus-visible:ring-ring",
              activeTab === value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <section
        id="dashboard-progress-panel"
        role="tabpanel"
        aria-labelledby="dashboard-progress-tab"
        hidden={activeTab !== "progress"}
      >
        {progress}
      </section>
      <section
        id="dashboard-info-panel"
        role="tabpanel"
        aria-labelledby="dashboard-info-tab"
        hidden={activeTab !== "info"}
      >
        {info}
      </section>
    </div>
  );
}
