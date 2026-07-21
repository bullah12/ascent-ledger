import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GradeSystem } from "@/generated/prisma/enums";
import type { CategoryProgress } from "@/lib/bmg/engine";
import type { CategorySuggestions } from "@/lib/recommender";
import { ProgressContent } from "./progress-content";

const progress: CategoryProgress[] = [
  {
    id: "category-1",
    key: "rock",
    label: "Rock climbing",
    description: "Build breadth on mountain rock routes.",
    percent: 40,
    metRules: 1,
    totalRules: 2,
    ungradedCount: 2,
    rules: [
      {
        id: "rule-complete",
        description: "Complete ten multi-pitch mountain routes",
        minCount: 10,
        actualCount: 12,
        stillNeeded: 0,
        met: true,
        percent: 100,
        thresholdLabel: "VS",
        gradeSystem: GradeSystem.uk_trad,
        verified: true,
        notes: [],
      },
      {
        id: "rule-gap",
        description: "Climb in three distinct mountain areas",
        minCount: 3,
        actualCount: 2,
        stillNeeded: 1,
        met: false,
        percent: 67,
        thresholdLabel: null,
        gradeSystem: null,
        verified: false,
        notes: ["2 of 3 required distinct areas", '"remote terrain" not yet checkable'],
      },
    ],
  },
];

const categorySuggestions: CategorySuggestions[] = [
  {
    categoryKey: "rock",
    rules: [
      {
        ruleId: "rule-complete",
        suggestions: [],
      },
      {
        ruleId: "rule-gap",
        suggestions: [
          {
            routeId: "route-1",
            name: "Pinnacle Ridge",
            gradeRaw: "V.Diff",
            areaName: "Glen Coe",
            externalUrl: null,
            lat: 56.6,
            lng: -5,
            score: 0.9,
            why: "new area for you (Glen Coe)",
          },
        ],
      },
    ],
  },
];

describe("ProgressContent", () => {
  it("renders category summaries and every configured rule", () => {
    const html = renderToStaticMarkup(
      <ProgressContent
        progress={progress}
        categorySuggestions={categorySuggestions}
        hasUnverified
      />,
    );

    expect(html).toContain("Build breadth on mountain rock routes.");
    expect(html).toContain("1 of 2 requirements met");
    expect(html).toContain("2 climbs with an unrecognised grade");
    expect(html).toContain("Complete ten multi-pitch mountain routes");
    expect(html).toContain("Grade threshold: VS+ · UK trad");
    expect(html).toContain("Climb in three distinct mountain areas");
    expect(html).toContain("Count-based requirement · no grade threshold");
    expect(html).toContain("Unverified rule");
    expect(html).toContain("2 of 3 required distinct areas");
    expect(html).toContain("1 more needed");
  });

  it("keeps route suggestions attached to their exact rule", () => {
    const html = renderToStaticMarkup(
      <ProgressContent
        progress={progress}
        categorySuggestions={categorySuggestions}
        hasUnverified
      />,
    );
    const completedRule = html.match(
      /data-rule-id="rule-complete"([\s\S]*?)data-rule-id="rule-gap"/,
    )?.[1];
    const gapRule = html.match(/data-rule-id="rule-gap"([\s\S]*?)<\/section>/)?.[1];

    expect(completedRule).not.toContain("Pinnacle Ridge");
    expect(gapRule).toContain('href="/routes/route-1"');
    expect(gapRule).toContain("Pinnacle Ridge");
    expect(gapRule).toContain("V.Diff · Glen Coe");
    expect(gapRule).toContain("new area for you (Glen Coe)");
  });

  it("explains calculation, grades, verification, constraints, and suggestions", () => {
    const html = renderToStaticMarkup(
      <ProgressContent
        progress={progress}
        categorySuggestions={categorySuggestions}
        hasUnverified
      />,
    );

    expect(html).toContain("What these numbers mean");
    expect(html).toContain("configured prerequisites");
    expect(html).toContain("UK trad");
    expect(html).toContain('href="/help/grades"');
    expect(html).toContain("A grade that cannot be recognised");
    expect(html).toContain("At least one loaded rule is unverified.");
    expect(html).toContain("Terrain type, access method, and consecutive overnight stays");
    expect(html).toContain("displayed only beneath that exact requirement");
  });
});
