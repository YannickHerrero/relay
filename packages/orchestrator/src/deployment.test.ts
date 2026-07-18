import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { FakeAgentAdapter } from "@relay/agent/testing";
import { createDatabase, deployments, deploymentSteps, projects, tasks } from "@relay/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { WorkflowEngine } from "./engine";

const exec = promisify(execFile);

describe("deployment workflow", () => {
  it("runs only the snapshotted recipe and archives a successful task", async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), "relay-deploy-repo-"));
    const dataDir = await mkdtemp(join(tmpdir(), "relay-deploy-data-"));
    await exec("git", ["init", "-b", "main", repositoryPath]);
    await exec("git", ["-C", repositoryPath, "config", "user.email", "relay@example.test"]);
    await exec("git", ["-C", repositoryPath, "config", "user.name", "Relay Test"]);
    await writeFile(join(repositoryPath, "README.md"), "deploy fixture\n");
    await exec("git", ["-C", repositoryPath, "add", "."]);
    await exec("git", ["-C", repositoryPath, "commit", "-m", "feat: reviewed delivery"]);
    const { stdout } = await exec("git", ["-C", repositoryPath, "rev-parse", "HEAD"]);
    const sha = stdout.trim();

    const database = createDatabase(":memory:");
    const now = new Date().toISOString();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const deploymentId = randomUUID();
    const recipe = {
      id: "local-check",
      label: "Local delivery check",
      kind: "command" as const,
      commands: ["test -f README.md"],
      environment: "test",
      requiresConfirmation: true,
    };
    database.db
      .insert(projects)
      .values({
        id: projectId,
        name: "Fixture",
        repositoryPath,
        defaultBranch: "main",
        projectType: "web",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(tasks)
      .values({
        id: taskId,
        projectId,
        title: "Deploy safely",
        initialRequest: "Explicit only",
        type: "feature",
        priority: "high",
        stage: "deploying",
        runtimeStatus: "agent_running",
        baseBranch: "main",
        taskBranch: "relay/task-fixture",
        worktreePath: repositoryPath,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(deployments)
      .values({
        id: deploymentId,
        taskId,
        recipeId: recipe.id,
        recipeSnapshot: recipe,
        status: "pending",
        commitSha: sha,
        createdAt: now,
      })
      .run();

    const agent = new FakeAgentAdapter();
    const engine = new WorkflowEngine({ database, agent, dataDir });
    await engine.handle({
      id: randomUUID(),
      taskId,
      type: "deployment.run",
      payload: { deploymentId },
      attempts: 1,
      maxAttempts: 1,
    });

    expect(
      database.db.select().from(deployments).where(eq(deployments.id, deploymentId)).get()?.status,
    ).toBe("succeeded");
    expect(database.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.stage).toBe("done");
    expect(
      database.db
        .select()
        .from(deploymentSteps)
        .where(eq(deploymentSteps.deploymentId, deploymentId))
        .all(),
    ).toHaveLength(2);
    await agent.close();
    database.sqlite.close();
  });
});
