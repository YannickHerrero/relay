import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const ownerPassword = "1234";

test.describe.serial("Relay owner workflow", () => {
  test("secures the first-run application without client JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByRole("heading", { name: /Secure Relay/ })).toBeVisible();
      await writeFile(
        join(process.cwd(), ".relay-e2e-data", "worker-heartbeat.json"),
        JSON.stringify({ workerId: "relay-e2e-worker", at: new Date().toISOString() }),
      );
      await page.getByLabel("Owner password").fill(ownerPassword);
      await page.getByRole("button", { name: "Create owner account" }).click();
      await expect(page).toHaveURL(/\/board$/);
      expect(page.url()).not.toContain("password=");
      await expect(page.getByRole("heading", { name: "Workboard" })).toBeVisible();
      await expect(page.getByText("online · 0 queued")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("signs in without client JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await page.getByLabel("Owner password").fill(ownerPassword);
      await page.getByRole("button", { name: "Sign in to Relay" }).click();
      await expect(page).toHaveURL(/\/board$/);
      expect(page.url()).not.toContain("password=");
    } finally {
      await context.close();
    }
  });

  test("discovers and registers a trusted Git project", async ({ page }) => {
    await signIn(page);
    await page.goto("/projects");
    const repository = page.locator("article").filter({ hasText: "relay-fixture" });
    await expect(repository.getByText("main")).toBeVisible();
    await repository.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
    await expect(page.getByRole("heading", { name: "relay-fixture" })).toBeVisible();
    await expect(page.getByText("Command policy")).toBeVisible();
  });

  test("creates a Git project without client JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await page.getByLabel("Owner password").fill(ownerPassword);
      await page.getByRole("button", { name: "Sign in to Relay" }).click();
      await page.goto("/projects/new");
      await page.getByLabel("Project name").fill("Created by Relay");
      await page.getByLabel("Folder name").fill("created-by-relay");
      await page.getByLabel("Project type").selectOption("custom");
      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
      await expect(page.getByRole("heading", { name: "Created by Relay" })).toBeVisible();
      expect(page.url()).not.toContain("name=");
    } finally {
      await context.close();
    }
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

  test("keeps project discovery and creation responsive", async ({ page }, testInfo) => {
    await signIn(page);
    for (const [name, width, height] of [
      ["phone", 390, 844],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/projects");
      await expect(page.getByRole("heading", { name: "Discovered folders" })).toBeVisible();
      const discoveryLayout = await page.evaluate(() => ({
        fits: document.documentElement.scrollWidth <= window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        offenders: Array.from(document.querySelectorAll("body *"))
          .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 8)
          .map((element) => ({
            element: `${element.tagName.toLowerCase()}.${element.className}`,
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
          })),
      }));
      expect(discoveryLayout.fits, JSON.stringify(discoveryLayout)).toBe(true);
      await testInfo.attach(`projects-${name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });

      await page.goto("/projects/new");
      await expect(page.getByRole("heading", { name: "Create a project" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} project creation should not overflow`,
      ).toBe(true);
    }
  });

  test("rate limits repeated owner login failures", async ({ page }) => {
    await page.goto("/login");
    const result = await page.evaluate(async (password) => {
      const login = async (candidate: string) => {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: candidate }),
        });
        return {
          status: response.status,
          retryAfter: response.headers.get("Retry-After"),
        };
      };

      const failedBeforeSuccess = await login("0000");
      const successfulLogin = await login(password);
      await fetch("/api/auth/logout", { method: "POST" });

      const failedStatuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        failedStatuses.push((await login("0000")).status);
      }
      const blockedLogin = await login(password);
      return { failedBeforeSuccess, successfulLogin, failedStatuses, blockedLogin };
    }, ownerPassword);

    expect(result.failedBeforeSuccess.status).toBe(401);
    expect(result.successfulLogin.status).toBe(200);
    expect(result.failedStatuses).toEqual([401, 401, 401, 401, 401]);
    expect(result.blockedLogin.status).toBe(429);
    expect(Number(result.blockedLogin.retryAfter)).toBeGreaterThan(0);
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
