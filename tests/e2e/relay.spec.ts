import { expect, test, type Page } from "@playwright/test";

const ownerPassword = "1234";

test.describe.serial("Relay owner workflow", () => {
  test("secures the first-run application", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: /Secure Relay/ })).toBeVisible();
    await page.getByLabel("Owner password").fill(ownerPassword);
    await page.getByRole("button", { name: "Create owner account" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole("heading", { name: "Workboard" })).toBeVisible();
  });

  test("registers a trusted Git project", async ({ page }) => {
    await signIn(page);
    await page.goto("/projects/new");
    await page.getByLabel("Project name").fill("Relay");
    await page.getByLabel("Repository path").fill(process.cwd());
    await page.getByLabel("Project type").selectOption("web");
    await page.getByLabel("Default branch").fill("main");
    await page.getByRole("button", { name: "Register project" }).click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
    await expect(page.getByRole("heading", { name: "Relay" })).toBeVisible();
    await expect(page.getByText("Command policy")).toBeVisible();
  });

  test("creates a vague request and preserves it on the board", async ({ page }) => {
    await signIn(page);
    await page.goto("/tasks/new");
    await page.getByLabel("Title").fill("Keep readers positioned during definitions");
    await page
      .getByLabel("Initial request")
      .fill("Definitions should feel faster and the reader must not lose their position.");
    await page.getByLabel("Priority").selectOption("high");
    await page.getByRole("button", { name: "Create and start refinement" }).click();
    await expect(page).toHaveURL(/\/tasks\/[a-f0-9-]+\?tab=conversation$/);
    await expect(
      page.getByRole("heading", { name: "Keep readers positioned during definitions" }),
    ).toBeVisible();
    await expect(page.getByText("Definitions should feel faster")).toBeVisible();

    await page.goto("/board");
    await expect(page.getByRole("link", { name: /Keep readers positioned/ })).toBeVisible();
  });

  test("keeps approvals and navigation usable on a phone", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Workboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Keep readers positioned/ })).toBeVisible();
    const bodyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(bodyOverflow).toBe(true);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
  });

  test("fits the complete responsive viewport matrix", async ({ page }, testInfo) => {
    await signIn(page);
    const viewports = [
      ["mobile-compact", 360, 800],
      ["mobile-standard", 390, 844],
      ["mobile-large", 430, 932],
      ["small-tablet", 600, 960],
      ["tablet-portrait", 820, 1180],
      ["tablet-landscape", 1024, 768],
      ["laptop", 1366, 768],
      ["desktop", 1440, 900],
      ["wide", 1920, 1080],
    ] as const;
    for (const [name, width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.goto("/board");
      await expect(page.getByRole("heading", { name: "Workboard" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} should not overflow the viewport`,
      ).toBe(true);
      if (["mobile-standard", "tablet-portrait", "desktop"].includes(name)) {
        await testInfo.attach(`board-${name}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
    }
  });
});

async function signIn(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/login")) {
    await page.getByLabel("Owner password").fill(ownerPassword);
    await page.getByRole("button", { name: "Sign in to Relay" }).click();
    await expect(page).toHaveURL(/\/board$/);
  }
}
