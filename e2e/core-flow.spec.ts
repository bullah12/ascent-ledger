import { test, expect, type Page } from "@playwright/test";

// Core-flow e2e (PLAN.md §7 Phase 7): sign up → log climbs across
// disciplines → dashboard progress → see a recommendation → see it on the
// map. Auth runs against the mock GoTrue server; data hits real Postgres,
// which must have BMG rules seeded and the Scottish winter example routes
// imported (see playwright.config.ts header).

const email = `e2e-${Date.now()}@example.com`;

type NewClimb = {
  name: string;
  discipline: "rock" | "winter" | "alpine" | "ski_touring";
  date: string;
  grade: string;
  area: string;
};

const climbs: NewClimb[] = [
  { name: "E2E Trad Test Route", discipline: "rock", date: "2024-06-01", grade: "E1 5b", area: "Stanage" },
  { name: "E2E Winter Gully", discipline: "winter", date: "2025-02-01", grade: "IV,5", area: "Ben Nevis" },
  { name: "E2E Alpine Ridge", discipline: "alpine", date: "2024-08-15", grade: "AD+", area: "Chamonix" },
  { name: "E2E Ski Tour", discipline: "ski_touring", date: "2025-03-10", grade: "WS", area: "Silvretta" },
];

async function logClimb(page: Page, climb: NewClimb) {
  await page.goto("/logbook/new");
  await page.fill("#routeName", climb.name);
  await page.selectOption("#discipline", climb.discipline);
  await page.fill("#date", climb.date);
  await page.fill("#gradeRaw", climb.grade);
  await page.fill("#area", climb.area);
  await page.getByRole("button", { name: "Log climb" }).click();
  await page.waitForURL("**/logbook");
}

test("sign up, log climbs, see progress, recommendation and map", async ({ page }) => {
  // --- sign up (mock auth auto-confirms, so we land signed in) ---
  await page.goto("/sign-up");
  await page.fill("#email", email);
  await page.fill("#password", "e2e-password-1");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL("**/dashboard");

  // --- log climbs across all four disciplines ---
  for (const climb of climbs) {
    await logClimb(page, climb);
  }
  await expect(page.getByText("4 climbs logged.")).toBeVisible();
  // Scope to the table — the stacked mobile cards render the same names
  // but are display:none at the desktop viewport.
  for (const climb of climbs) {
    await expect(page.locator("table").getByText(climb.name)).toBeVisible();
  }

  // --- dashboard: category cards with progress ---
  await page.goto("/dashboard");
  for (const label of ["Rock Climbing", "Winter Climbing", "Alpine Mountaineering", "Ski Touring"]) {
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
  }

  // Expand the winter card: sub-rules with progress and gaps.
  const winterCard = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: "Winter Climbing" }) });
  await winterCard.locator("summary").click();
  await expect(winterCard.getByText(/more needed/).first()).toBeVisible();

  // --- recommendation: the seeded Scottish classics fit the logged IV,5 ---
  await expect(winterCard.getByText("Suggested routes").first()).toBeVisible();
  await expect(winterCard.getByText("Point Five Gully").first()).toBeVisible();
  await expect(
    winterCard.getByText(/one grade step up from your current IV max/).first()
  ).toBeVisible();

  // --- map: suggested routes render as a toggleable layer ---
  await page.goto("/map");
  await expect(page.getByText("Suggested routes:")).toBeVisible();
  const winterToggle = page.getByRole("checkbox").and(
    page.locator("label:has-text('Winter') input")
  );
  await expect(winterToggle).toBeChecked();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  // Toggling a category off/on exercises the layer filter without error.
  await winterToggle.uncheck();
  await winterToggle.check();
});
