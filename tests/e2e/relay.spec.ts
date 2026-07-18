import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  agentEvents,
  agentRuns,
  createDatabase,
  orchestrationJobs,
  requirementDrafts,
  tasks,
} from "@relay/db";
import { and, eq, inArray } from "drizzle-orm";

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

  test("creates a streamlined task without client JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await page.getByLabel("Owner password").fill(ownerPassword);
      await page.getByRole("button", { name: "Sign in to Relay" }).click();
      await page.goto("/tasks/new");
      await expect(page.getByLabel("Project")).toBeVisible();
      await page.getByLabel("Project").selectOption({ label: "relay-fixture" });
      const projectId = await page.getByLabel("Project").inputValue();
      const creationKey = await page.locator('input[name="creationKey"]').inputValue();
      const taskRequest =
        "Keep readers positioned during definitions\n\nDefinitions should feel faster and the reader must not lose their position.";
      await page.getByLabel("Task request").fill(taskRequest);
      await page.getByLabel("Add files").setInputFiles({
        name: "evidence.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Reader position evidence"),
      });
      await page.getByRole("button", { name: "Start task" }).click();
      await expect(page).toHaveURL(/\/board\?task=[a-f0-9-]+&phase=refine$/);
      const taskDialog = page.getByRole("dialog", {
        name: "Keep readers positioned during definitions",
      });
      await expect(
        taskDialog.getByRole("heading", { name: "Keep readers positioned during definitions" }),
      ).toBeVisible();
      await expect(taskDialog.getByText("Definitions should feel faster")).toBeVisible();
      await expect(taskDialog.getByRole("heading", { name: "Activity & status" })).toBeVisible();
      await expect(taskDialog.getByRole("button", { name: "Plan" })).toBeDisabled();

      const taskId = new URL(page.url()).searchParams.get("task");
      expect(taskId).toBeTruthy();
      const duplicate = await context.request.post("/api/tasks", {
        headers: {
          accept: "application/json",
          origin: new URL(page.url()).origin,
        },
        multipart: { creationKey, projectId, request: taskRequest },
      });
      expect(duplicate.status()).toBe(201);
      expect((await duplicate.json()).id).toBe(taskId);
      await expect(page.getByRole("link", { name: "evidence.txt" })).toBeVisible();

      await page.goto("/tasks/new");
      await expect(page.getByLabel("Project").locator("option:checked")).toHaveText(
        "relay-fixture",
      );

      await page.goto("/board");
      await expect(page.getByRole("link", { name: /Keep readers positioned/ })).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("moves a ready card to only its next phase", async ({ page }, testInfo) => {
    await signIn(page);
    const relayDatabase = createDatabase(join(process.cwd(), ".relay-e2e-data", "relay.db"));
    const task = relayDatabase.db.select().from(tasks).get();
    expect(task).toBeTruthy();
    const now = new Date().toISOString();
    relayDatabase.db
      .update(orchestrationJobs)
      .set({ status: "completed", updatedAt: now })
      .where(eq(orchestrationJobs.taskId, task!.id))
      .run();
    relayDatabase.db
      .update(tasks)
      .set({ runtimeStatus: "idle", updatedAt: now, lastActivityAt: now })
      .where(eq(tasks.id, task!.id))
      .run();
    relayDatabase.db
      .insert(requirementDrafts)
      .values({
        taskId: task!.id,
        updatedAt: now,
        content: {
          title: task!.title,
          problem: "Reader position is lost",
          objective: "Keep the reader positioned",
          expectedBehavior: ["Preserve reader position"],
          userFlows: [{ name: "Open definition", steps: ["Open a definition"] }],
          acceptanceCriteria: ["Reader position remains stable"],
          edgeCases: [],
          constraints: [],
          outOfScope: [],
          unresolvedQuestions: [],
          attachments: [],
        },
      })
      .run();

    await page.goto("/board");
    const handle = page.getByRole("button", { name: /Move Keep readers positioned.*to Plan/ });
    const destination = page.locator('section[aria-labelledby="column-plan"]');
    await expect(handle).toBeEnabled();
    const sourceBox = await handle.boundingBox();
    const destinationBox = await destination.boundingBox();
    expect(sourceBox).toBeTruthy();
    expect(destinationBox).toBeTruthy();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + 90, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(page.getByRole("heading", { name: "Approve & start planning?" })).toBeVisible();
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Approve & start planning" }).click();
    await expect(destination.getByRole("link", { name: /Keep readers positioned/ })).toBeVisible();
    expect(relayDatabase.db.select().from(tasks).where(eq(tasks.id, task!.id)).get()?.stage).toBe(
      "planning",
    );

    const runId = randomUUID();
    relayDatabase.db
      .insert(agentRuns)
      .values({
        id: runId,
        taskId: task!.id,
        role: "technical-planner",
        status: "running",
        startedAt: now,
      })
      .run();
    relayDatabase.db
      .insert(agentEvents)
      .values([
        {
          runId,
          taskId: task!.id,
          type: "progress",
          payload: { type: "progress", text: "Inspecting repository context" },
          createdAt: now,
        },
        {
          runId,
          taskId: task!.id,
          type: "command.started",
          payload: { type: "command.started", command: "git status --short" },
          createdAt: now,
        },
      ])
      .run();
    await destination.getByRole("link", { name: /Keep readers positioned/ }).click();
    await expect(page.getByText("Inspecting repository context")).toBeVisible();
    await expect(page.getByText("git status --short")).toBeVisible();
    await testInfo.attach("live-agent-dialog-desktop", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.goBack();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole("dialog", { name: task!.title })).toHaveCount(0);
    relayDatabase.sqlite.close();
  });

  test("retries and safely deletes a failed task", async ({ page }, testInfo) => {
    await signIn(page);
    const relayDatabase = createDatabase(join(process.cwd(), ".relay-e2e-data", "relay.db"));
    const existingTask = relayDatabase.db.select().from(tasks).get();
    expect(existingTask).toBeTruthy();
    const response = await page.request.post("/api/tasks", {
      headers: { accept: "application/json", origin: new URL(page.url()).origin },
      multipart: {
        creationKey: randomUUID(),
        projectId: existingTask!.projectId,
        request: "Disposable failed task",
      },
    });
    expect(response.status()).toBe(201);
    const taskId = (await response.json()).id as string;
    const now = new Date().toISOString();
    relayDatabase.db
      .update(orchestrationJobs)
      .set({ status: "failed", error: "Fixture failure", finishedAt: now })
      .where(eq(orchestrationJobs.taskId, taskId))
      .run();
    relayDatabase.db
      .update(tasks)
      .set({ runtimeStatus: "failed", blockedReason: "Fixture failure", updatedAt: now })
      .where(eq(tasks.id, taskId))
      .run();

    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByRole("button", { name: "Retry task" })).toBeVisible();
    await testInfo.attach("failed-task-desktop", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.waitForTimeout(100);
    const retryResponse = page.waitForResponse((candidate) =>
      candidate.url().endsWith(`/api/tasks/${taskId}/retry`),
    );
    await page.getByRole("button", { name: "Retry task" }).click();
    expect((await retryResponse).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/board\\?task=${taskId}&phase=refine$`));
    expect(
      relayDatabase.db
        .select()
        .from(orchestrationJobs)
        .where(eq(orchestrationJobs.taskId, taskId))
        .all()
        .filter((job) => job.status === "queued"),
    ).toHaveLength(1);

    relayDatabase.db
      .update(orchestrationJobs)
      .set({ status: "failed", error: "Fixture failure", finishedAt: now })
      .where(
        and(
          eq(orchestrationJobs.taskId, taskId),
          inArray(orchestrationJobs.status, ["queued", "running"]),
        ),
      )
      .run();
    relayDatabase.db
      .update(tasks)
      .set({ runtimeStatus: "failed", blockedReason: "Fixture failure", updatedAt: now })
      .where(eq(tasks.id, taskId))
      .run();
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Delete this task?" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await testInfo.attach("delete-task-phone", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "Delete task" }).click();
    await expect(page).toHaveURL(/\/board$/);
    expect(relayDatabase.db.select().from(tasks).where(eq(tasks.id, taskId)).get()).toBeUndefined();
    relayDatabase.sqlite.close();
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

  test("keeps the streamlined task composer responsive", async ({ page }, testInfo) => {
    await signIn(page);
    for (const [name, width, height] of [
      ["phone", 390, 844],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/tasks/new");
      await expect(page.getByRole("heading", { name: "What should Relay work on?" })).toBeVisible();
      await expect(page.getByLabel("Project")).toBeVisible();
      await expect(page.getByLabel("Task request")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} task composer should not overflow`,
      ).toBe(true);
      await testInfo.attach(`new-task-${name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
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
