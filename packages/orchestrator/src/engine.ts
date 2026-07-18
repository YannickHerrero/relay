import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  agentEvents,
  agentRuns,
  artifacts,
  commandRuns,
  deploymentSteps,
  deployments,
  messages,
  notifications,
  planComments,
  planVersions,
  projectConfigVersions,
  projects,
  requirementDrafts,
  reviewComments,
  reviewRequests,
  specificationVersions,
  taskCommits,
  taskEvents,
  taskPhaseVisits,
  tasks,
  testRuns,
  type RelayDatabase,
} from "@relay/db";
import type { AgentAdapter, AgentEvent } from "@relay/agent";
import {
  diagnosisOutputSchema,
  implementationOutputSchema,
  parseStructuredOutput,
  planningOutputSchema,
  refinementOutputSchema,
  systemPromptFor,
} from "@relay/agent";
import {
  assertTransition,
  deploymentRecipeSchema,
  implementationPlanSchema,
  refinedRequirementSchema,
  type AgentRole,
  type DeploymentRecipe,
  type ImplementationPlan,
  type ProjectConfig,
} from "@relay/domain";
import { createTaskWorktree, GitRepository, taskBranchName } from "@relay/git";
import { runCommand } from "@relay/process";
import { loadProjectConfig } from "@relay/project-config";
import { and, desc, eq } from "drizzle-orm";

import type { OrchestrationJob } from "./queue";

export type WorkflowEngineOptions = {
  database: RelayDatabase;
  agent: AgentAdapter;
  dataDir: string;
};

export class WorkflowEngine {
  constructor(private readonly options: WorkflowEngineOptions) {}

  async handle(job: OrchestrationJob): Promise<void> {
    if (!job.taskId) throw new Error(`Job ${job.id} requires a task`);
    if (job.type === "refinement.start" || job.type === "refinement.message") {
      await this.runRefinement(job.taskId);
      return;
    }
    if (job.type === "planning.start" || job.type === "planning.revise") {
      await this.runPlanning(job.taskId);
      return;
    }
    if (
      job.type === "implementation.start" ||
      job.type === "implementation.resume" ||
      job.type === "implementation.instruction"
    ) {
      if (job.type === "implementation.instruction") {
        const now = new Date().toISOString();
        this.options.database.db
          .update(tasks)
          .set({
            runtimeStatus: "agent_running",
            blockedReason: null,
            updatedAt: now,
            lastActivityAt: now,
          })
          .where(eq(tasks.id, job.taskId))
          .run();
      }
      try {
        await this.runImplementation(
          job.taskId,
          typeof job.payload.instruction === "string" ? job.payload.instruction : undefined,
        );
      } catch (error) {
        if (!(error instanceof AgentStoppedError)) throw error;
      }
      return;
    }
    if (job.type === "implementation.review_changes") {
      await this.runReviewChanges(job.taskId);
      return;
    }
    if (job.type === "tests.rerun") {
      await this.rerunValidation(job.taskId);
      return;
    }
    if (job.type === "deployment.run") {
      const deploymentId = job.payload.deploymentId;
      if (typeof deploymentId !== "string")
        throw new Error("Deployment job is missing its deployment id");
      await this.runDeployment(job.taskId, deploymentId);
      return;
    }
    throw new Error(`Unsupported orchestration job: ${job.type}`);
  }

  markJobFailure(job: OrchestrationJob, error: unknown): void {
    if (!job.taskId || job.attempts < job.maxAttempts) return;
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    const { db, sqlite } = this.options.database;
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          runtimeStatus: "failed",
          blockedReason: message,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, job.taskId!))
        .run();
      db.insert(taskEvents)
        .values({
          taskId: job.taskId!,
          type: "agent.failed",
          actor: "system",
          payload: { jobType: job.type, message },
          createdAt: now,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId: job.taskId!,
          type: "task.failed",
          title: "Agent run failed",
          body: message,
          createdAt: now,
        })
        .run();
    })();
  }

  private async runRefinement(taskId: string): Promise<void> {
    const { db, sqlite } = this.options.database;
    const row = db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(tasks.stage, "refinement")))
      .get();
    if (!row) throw new Error("Refinement task is missing or no longer in refinement");
    const conversation = db
      .select()
      .from(messages)
      .where(eq(messages.taskId, taskId))
      .orderBy(messages.createdAt)
      .all();
    const currentDraft = db
      .select()
      .from(requirementDrafts)
      .where(eq(requirementDrafts.taskId, taskId))
      .get();
    const prompt = buildRefinementPrompt(row.task.title, conversation, currentDraft?.content);
    const output = await this.runAgentTurn(
      taskId,
      "product-refiner",
      row.project.repositoryPath,
      prompt,
    );
    const refined = parseStructuredOutput(output, refinementOutputSchema);
    const now = new Date().toISOString();

    sqlite.transaction(() => {
      db.insert(messages)
        .values({
          id: randomUUID(),
          taskId,
          role: "agent",
          phase: "refine",
          content: refined.message,
          attachments: [],
          createdAt: now,
        })
        .run();
      db.insert(requirementDrafts)
        .values({ taskId, content: refined.specification, updatedAt: now })
        .onConflictDoUpdate({
          target: requirementDrafts.taskId,
          set: { content: refined.specification, updatedAt: now },
        })
        .run();
      db.update(tasks)
        .set({
          runtimeStatus: refined.waitingForUser ? "waiting_for_user" : "idle",
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: refined.waitingForUser ? "refinement.question" : "refinement.updated",
          actor: "agent",
          payload: { unresolvedQuestions: refined.specification.unresolvedQuestions.length },
          createdAt: now,
        })
        .run();
      if (refined.waitingForUser) {
        db.insert(notifications)
          .values({
            id: randomUUID(),
            taskId,
            type: "refinement.answer_needed",
            title: "Refinement needs your answer",
            body: row.task.title,
            createdAt: now,
          })
          .run();
      }
    })();
  }

  private async runPlanning(taskId: string): Promise<void> {
    const { db, sqlite } = this.options.database;
    const row = db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(tasks.stage, "planning")))
      .get();
    if (!row) throw new Error("Planning task is missing or no longer in planning");
    const specification = db
      .select()
      .from(specificationVersions)
      .where(eq(specificationVersions.taskId, taskId))
      .orderBy(desc(specificationVersions.version))
      .get();
    if (!specification?.approvedAt) throw new Error("Planning requires an approved specification");
    const previous = db
      .select()
      .from(planVersions)
      .where(eq(planVersions.taskId, taskId))
      .orderBy(desc(planVersions.version))
      .get();
    const comments = previous
      ? db
          .select()
          .from(planComments)
          .where(eq(planComments.planVersionId, previous.id))
          .orderBy(planComments.createdAt)
          .all()
      : [];
    const prompt = buildPlanningPrompt(specification.content, previous?.content, comments);
    const output = await this.runAgentTurn(
      taskId,
      "technical-planner",
      row.project.repositoryPath,
      prompt,
    );
    const planned = parseStructuredOutput(output, planningOutputSchema);
    const now = new Date().toISOString();
    const versionId = randomUUID();

    sqlite.transaction(() => {
      db.insert(planVersions)
        .values({
          id: versionId,
          taskId,
          version: (previous?.version ?? 0) + 1,
          parentVersionId: previous?.id ?? null,
          content: planned.plan,
          createdAt: now,
        })
        .run();
      if (previous) {
        db.update(planComments)
          .set({ resolvedAt: now })
          .where(eq(planComments.planVersionId, previous.id))
          .run();
      }
      db.update(tasks)
        .set({
          runtimeStatus: "waiting_for_user",
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(messages)
        .values({
          id: randomUUID(),
          taskId,
          role: "agent",
          phase: "plan",
          content: planned.message,
          attachments: [],
          createdAt: now,
        })
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "plan.ready",
          actor: "agent",
          payload: {
            version: (previous?.version ?? 0) + 1,
            commits: planned.plan.commits.length,
          },
          createdAt: now,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId,
          type: "plan.ready",
          title: "Plan ready for approval",
          body: row.task.title,
          createdAt: now,
        })
        .run();
    })();
  }

  private async runImplementation(taskId: string, instruction?: string): Promise<void> {
    const { db, sqlite } = this.options.database;
    const row = db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(tasks.stage, "implementation")))
      .get();
    if (!row) throw new Error("Implementation task is missing or no longer in implementation");
    const planRow = db
      .select()
      .from(planVersions)
      .where(eq(planVersions.id, row.task.activePlanVersionId ?? ""))
      .get();
    if (!planRow?.approvedAt) throw new Error("Implementation requires an approved plan");
    const plan = implementationPlanSchema.parse(planRow.content);
    const specificationRow = db
      .select()
      .from(specificationVersions)
      .where(eq(specificationVersions.id, row.task.activeSpecificationVersionId ?? ""))
      .get();
    const specification = refinedRequirementSchema.parse(specificationRow?.content);
    const config = await this.currentProjectConfig(row.project.id, row.project.repositoryPath);
    const worktree = await this.ensureWorktree(row.task, row.project.repositoryPath);

    if (
      row.task.currentPlanCommit === 0 &&
      !db.select().from(taskCommits).where(eq(taskCommits.taskId, taskId)).get()
    ) {
      const setupPassed = await this.runValidationCommands(
        taskId,
        worktree.root,
        config.commands.setup ?? [],
        "setup",
      );
      if (!setupPassed) {
        this.blockTask(taskId, "Project setup failed. Inspect the test evidence before resuming.");
        return;
      }
    }

    for (const plannedCommit of plan.commits.sort((left, right) => left.order - right.order)) {
      const currentTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
      if (!currentTask || currentTask.runtimeStatus === "stopped") return;
      if (plannedCommit.order <= currentTask.currentPlanCommit) continue;
      const resumedChanges = await worktree.status();
      const startingHead = await worktree.head();
      const output = await this.runAgentTurn(
        taskId,
        "implementer",
        worktree.root,
        buildImplementationPrompt(
          specification,
          plan,
          plannedCommit,
          resumedChanges.length > 0,
          instruction,
        ),
        config,
      );
      const summary = parseStructuredOutput(output, implementationOutputSchema);
      if ((await worktree.head()) !== startingHead) {
        this.blockTask(taskId, "The agent created a Git commit outside Relay's commit boundary.");
        return;
      }
      const changed = await worktree.status();
      if (!changed.length) {
        this.blockTask(taskId, `Planned commit ${plannedCommit.order} produced no file changes.`);
        return;
      }
      await worktree.diffCheck();
      const testsPassed = await this.runValidationCommands(
        taskId,
        worktree.root,
        plannedCommit.tests,
        `commit-${plannedCommit.order}`,
      );
      if (!testsPassed) {
        this.blockTask(taskId, `Validation failed for planned commit ${plannedCommit.order}.`);
        return;
      }
      if ((await worktree.head()) !== startingHead) {
        this.blockTask(
          taskId,
          "A validation command changed Git HEAD outside Relay's commit boundary.",
        );
        return;
      }
      const sha = await worktree.createCommit(plannedCommit.title);
      const now = new Date().toISOString();
      sqlite.transaction(() => {
        db.insert(taskCommits)
          .values({
            id: randomUUID(),
            taskId,
            planCommitId: plannedCommit.id,
            sha,
            message: plannedCommit.title,
            order: plannedCommit.order,
            summary: summary.summary,
            createdAt: now,
          })
          .run();
        db.update(tasks)
          .set({
            currentPlanCommit: plannedCommit.order,
            runtimeStatus: "agent_running",
            blockedReason: null,
            updatedAt: now,
            lastActivityAt: now,
          })
          .where(eq(tasks.id, taskId))
          .run();
        db.insert(taskEvents)
          .values({
            taskId,
            type: "implementation.commit_created",
            actor: "system",
            payload: {
              order: plannedCommit.order,
              total: plan.commits.length,
              sha,
              deviations: summary.deviations,
            },
            createdAt: now,
          })
          .run();
      })();
    }

    const finalCommands = config.commands.finalValidation?.length
      ? config.commands.finalValidation
      : [
          ...(config.commands.lint ?? []),
          ...(config.commands.typecheck ?? []),
          ...(config.commands.unitTests ?? []),
          ...(config.commands.integrationTests ?? []),
          ...(config.commands.build ?? []),
        ];
    if (
      !(await this.runValidationCommands(taskId, worktree.root, finalCommands, "final-validation"))
    ) {
      this.blockTask(taskId, "Final validation failed.");
      return;
    }
    await worktree.assertClean();
    await this.writeDeliveryArtifacts(taskId, worktree, row.task.baseBranch, plan);
    const completedAt = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          runtimeStatus: "waiting_for_user",
          blockedReason: null,
          version: row.task.version + 1,
          updatedAt: completedAt,
          lastActivityAt: completedAt,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "implementation.ready_for_review",
          actor: "agent",
          payload: { commits: plan.commits.length },
          createdAt: completedAt,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId,
          type: "implementation.complete",
          title: "Implementation ready for review",
          body: row.task.title,
          createdAt: completedAt,
        })
        .run();
    })();
  }

  private async runReviewChanges(taskId: string): Promise<void> {
    const { db } = this.options.database;
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task || task.stage !== "implementation" || !task.worktreePath) {
      throw new Error("Review changes require an implementation worktree");
    }
    const review = db
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.taskId, taskId))
      .orderBy(desc(reviewRequests.version))
      .get();
    if (!review) throw new Error("No review request is available");
    const comments = db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.reviewRequestId, review.id))
      .orderBy(reviewComments.createdAt)
      .all();
    const worktree = new GitRepository(task.worktreePath);
    const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
    if (!project) throw new Error("Project not found");
    const config = await this.currentProjectConfig(project.id, project.repositoryPath);
    let order =
      db
        .select()
        .from(taskCommits)
        .where(eq(taskCommits.taskId, taskId))
        .orderBy(desc(taskCommits.order))
        .get()?.order ?? 0;

    for (const comment of comments) {
      await worktree.assertClean();
      const startingHead = await worktree.head();
      const output = await this.runAgentTurn(
        taskId,
        "implementer",
        worktree.root,
        buildReviewChangePrompt(comment),
        config,
      );
      const summary = parseStructuredOutput(output, implementationOutputSchema);
      if ((await worktree.head()) !== startingHead || !(await worktree.status()).length) {
        this.blockTask(taskId, "Review correction did not leave a valid uncommitted change.");
        return;
      }
      const commands = [
        ...(config.commands.lint ?? []),
        ...(config.commands.typecheck ?? []),
        ...(config.commands.unitTests ?? []),
      ];
      if (
        !(await this.runValidationCommands(
          taskId,
          worktree.root,
          commands,
          `review-${review.version}`,
        ))
      ) {
        this.blockTask(taskId, "Review correction validation failed.");
        return;
      }
      order += 1;
      const message = `fix: address review feedback ${review.version}.${order}`;
      const sha = await worktree.createCommit(message);
      db.insert(taskCommits)
        .values({
          id: randomUUID(),
          taskId,
          planCommitId: `review-${review.id}-${comment.id}`,
          sha,
          message,
          order,
          summary: summary.summary,
          createdAt: new Date().toISOString(),
        })
        .run();
    }
    db.update(reviewRequests)
      .set({ status: "completed", completedAt: new Date().toISOString() })
      .where(eq(reviewRequests.id, review.id))
      .run();
    await this.finishReviewChanges(taskId);
  }

  private async finishReviewChanges(taskId: string): Promise<void> {
    const { db, sqlite } = this.options.database;
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task?.worktreePath) throw new Error("Task worktree is missing");
    const worktree = new GitRepository(task.worktreePath);
    await worktree.assertClean();
    const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
    if (!project) throw new Error("Project not found");
    const config = await this.currentProjectConfig(project.id, project.repositoryPath);
    if (
      !(await this.runValidationCommands(
        taskId,
        worktree.root,
        config.commands.finalValidation ?? [],
        "review-final",
      ))
    ) {
      this.blockTask(taskId, "Final review-change validation failed.");
      return;
    }
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          runtimeStatus: "waiting_for_user",
          blockedReason: null,
          version: task.version + 1,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "review.changes_ready_for_review",
          actor: "agent",
          payload: {},
          createdAt: now,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId,
          type: "review.changes_complete",
          title: "Requested changes are ready",
          body: task.title,
          createdAt: now,
        })
        .run();
    })();
  }

  private async rerunValidation(taskId: string): Promise<void> {
    const { db } = this.options.database;
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task?.worktreePath) throw new Error("Task worktree is missing");
    const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
    if (!project) throw new Error("Project not found");
    const config = await this.currentProjectConfig(project.id, project.repositoryPath);
    const commands = config.commands.finalValidation ?? [
      ...(config.commands.lint ?? []),
      ...(config.commands.typecheck ?? []),
      ...(config.commands.unitTests ?? []),
      ...(config.commands.build ?? []),
    ];
    const passed = await this.runValidationCommands(
      taskId,
      task.worktreePath,
      commands,
      "manual-rerun",
    );
    const now = new Date().toISOString();
    db.update(tasks)
      .set({
        runtimeStatus: passed ? "idle" : "blocked",
        blockedReason: passed ? null : "Manual test rerun failed",
        updatedAt: now,
        lastActivityAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();
    db.insert(taskEvents)
      .values({
        taskId,
        type: passed ? "tests.rerun_passed" : "tests.rerun_failed",
        actor: "system",
        payload: {},
        createdAt: now,
      })
      .run();
  }

  private async runDeployment(taskId: string, deploymentId: string): Promise<void> {
    const { db, sqlite } = this.options.database;
    const deployment = db.select().from(deployments).where(eq(deployments.id, deploymentId)).get();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!deployment || !task || task.stage !== "deploying" || !task.worktreePath) {
      throw new Error("Deployment is missing or is not ready to run");
    }
    const recipe = deploymentRecipeSchema.parse(deployment.recipeSnapshot);
    const worktree = new GitRepository(task.worktreePath);
    await worktree.assertClean();
    if ((await worktree.head()) !== deployment.commitSha) {
      throw new Error("Worktree HEAD no longer matches the confirmed deployment SHA");
    }
    if (recipe.kind === "git_push" && !task.taskBranch) {
      throw new Error("Git push requires a task branch");
    }
    const commands =
      recipe.kind === "git_push"
        ? [`git push --set-upstream origin ${task.taskBranch}`]
        : recipe.commands;
    const now = new Date().toISOString();
    const steps = [
      {
        id: randomUUID(),
        deploymentId,
        order: 1,
        label: "Repository validation",
        command: null,
        status: "succeeded",
      },
      ...commands.map((command, index) => ({
        id: randomUUID(),
        deploymentId,
        order: index + 2,
        label: deploymentStepLabel(command, index),
        command,
        status: "pending",
      })),
    ];
    sqlite.transaction(() => {
      db.delete(deploymentSteps).where(eq(deploymentSteps.deploymentId, deploymentId)).run();
      db.insert(deploymentSteps)
        .values(
          steps.map((step) => ({
            ...step,
            startedAt: step.order === 1 ? now : null,
            completedAt: step.order === 1 ? now : null,
          })),
        )
        .run();
      db.update(deployments)
        .set({ status: "running", startedAt: now, completedAt: null, diagnosis: null })
        .where(eq(deployments.id, deploymentId))
        .run();
      db.update(tasks)
        .set({
          runtimeStatus: "agent_running",
          blockedReason: null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "deployment.started",
          actor: "system",
          payload: { deploymentId, recipeId: recipe.id, commitSha: deployment.commitSha },
          createdAt: now,
        })
        .run();
    })();

    let failureOutput = "";
    for (const step of steps.filter((step) => step.command)) {
      const result = await this.runDeploymentCommand(
        taskId,
        deploymentId,
        step.id,
        step.command!,
        task.worktreePath,
      );
      if (!result.passed) {
        failureOutput = result.output;
        break;
      }
    }
    if (failureOutput) {
      await this.failDeployment(task, deploymentId, recipe, failureOutput);
      return;
    }

    assertTransition("deploying", "done", "system");
    const completedAt = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(deployments)
        .set({ status: "succeeded", resultUrl: recipe.resultUrlPattern ?? null, completedAt })
        .where(eq(deployments.id, deploymentId))
        .run();
      db.update(tasks)
        .set({
          stage: "done",
          runtimeStatus: "idle",
          version: task.version + 1,
          updatedAt: completedAt,
          lastActivityAt: completedAt,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskPhaseVisits)
        .values({
          taskId,
          phase: "done",
          firstStartedAt: completedAt,
          lastStartedAt: completedAt,
        })
        .onConflictDoUpdate({
          target: [taskPhaseVisits.taskId, taskPhaseVisits.phase],
          set: { lastStartedAt: completedAt },
        })
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "deployment.succeeded",
          actor: "system",
          payload: { deploymentId, resultUrl: recipe.resultUrlPattern },
          createdAt: completedAt,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId,
          type: "deployment.succeeded",
          title: "Deployment succeeded",
          body: task.title,
          createdAt: completedAt,
        })
        .run();
    })();
  }

  private async runDeploymentCommand(
    taskId: string,
    deploymentId: string,
    stepId: string,
    command: string,
    cwd: string,
  ): Promise<{ passed: boolean; output: string }> {
    const { db } = this.options.database;
    const commandId = randomUUID();
    const startedAt = new Date().toISOString();
    db.update(deploymentSteps)
      .set({ status: "running", startedAt })
      .where(eq(deploymentSteps.id, stepId))
      .run();
    db.insert(commandRuns)
      .values({ id: commandId, taskId, deploymentId, command, cwd, status: "running", startedAt })
      .run();
    let result;
    try {
      result = await runCommand({
        command,
        cwd,
        timeoutMs: Number(process.env.RELAY_DEPLOYMENT_TIMEOUT_MS ?? 3_600_000),
        onStart: (pid) => {
          db.update(commandRuns).set({ pid }).where(eq(commandRuns.id, commandId)).run();
        },
      });
    } catch (error) {
      result = {
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? (error.stack ?? error.message) : String(error),
        durationMs: 0,
        timedOut: false,
        aborted: false,
      };
    }
    const passed = result.exitCode === 0 && !result.timedOut && !result.aborted;
    const completedAt = new Date().toISOString();
    const logDir = join(this.options.dataDir, "artifacts", taskId, "deployments", deploymentId);
    const logPath = join(logDir, `${stepId}.log`);
    await mkdir(logDir, { recursive: true });
    const output = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
    await writeFile(logPath, output, { mode: 0o600 });
    db.update(commandRuns)
      .set({ status: passed ? "passed" : "failed", exitCode: result.exitCode, completedAt })
      .where(eq(commandRuns.id, commandId))
      .run();
    db.update(deploymentSteps)
      .set({ status: passed ? "succeeded" : "failed", completedAt })
      .where(eq(deploymentSteps.id, stepId))
      .run();
    db.insert(artifacts)
      .values({
        id: randomUUID(),
        taskId,
        runId: deploymentId,
        type: "log",
        path: logPath,
        mimeType: "text/plain",
        metadata: { command, deploymentId },
        createdAt: completedAt,
      })
      .run();
    return { passed, output };
  }

  private async failDeployment(
    task: typeof tasks.$inferSelect,
    deploymentId: string,
    recipe: DeploymentRecipe,
    output: string,
  ): Promise<void> {
    const { db, sqlite } = this.options.database;
    let diagnosis = "Deployment command failed. Inspect the captured log before retrying.";
    try {
      const result = await this.runAgentTurn(
        task.id,
        "deployment-diagnostician",
        task.worktreePath!,
        `Analyze this failed ${recipe.label} deployment. Do not modify files or rerun commands.\n\n${output.slice(-20_000)}\n\nReturn likelyCause, evidence, and suggestedActions as JSON.`,
      );
      diagnosis = parseStructuredOutput(result, diagnosisOutputSchema).likelyCause;
    } catch {
      // The original deployment failure remains authoritative when diagnosis is unavailable.
    }
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(deployments)
        .set({ status: "failed", diagnosis, completedAt: now })
        .where(eq(deployments.id, deploymentId))
        .run();
      db.update(tasks)
        .set({
          runtimeStatus: "failed",
          blockedReason: diagnosis,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, task.id))
        .run();
      db.insert(taskEvents)
        .values({
          taskId: task.id,
          type: "deployment.failed",
          actor: "system",
          payload: { deploymentId, diagnosis },
          createdAt: now,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId: task.id,
          type: "deployment.failed",
          title: "Deployment failed",
          body: diagnosis,
          createdAt: now,
        })
        .run();
    })();
  }

  private async ensureWorktree(
    task: typeof tasks.$inferSelect,
    repositoryPath: string,
  ): Promise<GitRepository> {
    if (task.worktreePath) return new GitRepository(task.worktreePath);
    const worktreePath = join(this.options.dataDir, "worktrees", task.projectId, task.id);
    const branch = task.taskBranch ?? taskBranchName(task.id, task.title);
    let worktree: GitRepository;
    try {
      await access(worktreePath);
      worktree = new GitRepository(worktreePath);
      await worktree.head();
    } catch {
      worktree = await createTaskWorktree({
        repositoryPath,
        worktreePath,
        branch,
        baseBranch: task.baseBranch,
      });
    }
    const now = new Date().toISOString();
    this.options.database.db
      .update(tasks)
      .set({ taskBranch: branch, worktreePath, updatedAt: now, lastActivityAt: now })
      .where(eq(tasks.id, task.id))
      .run();
    this.options.database.db
      .insert(taskEvents)
      .values({
        taskId: task.id,
        type: "implementation.worktree_ready",
        actor: "system",
        payload: { branch, worktreePath },
        createdAt: now,
      })
      .run();
    return worktree;
  }

  private async currentProjectConfig(
    projectId: string,
    repositoryPath: string,
  ): Promise<ProjectConfig> {
    const loaded = await loadProjectConfig(repositoryPath);
    const { db } = this.options.database;
    const latest = db
      .select()
      .from(projectConfigVersions)
      .where(eq(projectConfigVersions.projectId, projectId))
      .orderBy(desc(projectConfigVersions.version))
      .get();
    if (latest?.hash !== loaded.hash) {
      db.insert(projectConfigVersions)
        .values({
          id: randomUUID(),
          projectId,
          version: (latest?.version ?? 0) + 1,
          source: loaded.source,
          hash: loaded.hash,
          content: loaded.config,
          createdAt: new Date().toISOString(),
        })
        .run();
    }
    return loaded.config;
  }

  private async runValidationCommands(
    taskId: string,
    cwd: string,
    commands: string[],
    category: string,
  ): Promise<boolean> {
    for (const command of commands) {
      const commandId = randomUUID();
      const testId = randomUUID();
      const now = new Date().toISOString();
      const logDir = join(this.options.dataDir, "artifacts", taskId, "commands");
      const logPath = join(logDir, `${commandId}.log`);
      await mkdir(logDir, { recursive: true });
      this.options.database.db
        .insert(commandRuns)
        .values({ id: commandId, taskId, command, cwd, status: "running", startedAt: now })
        .run();
      this.options.database.db
        .insert(testRuns)
        .values({
          id: testId,
          taskId,
          commandRunId: commandId,
          command,
          category,
          status: "running",
          environment: process.platform,
          startedAt: now,
        })
        .run();
      this.options.database.db
        .insert(taskEvents)
        .values({
          taskId,
          type: "tests.started",
          actor: "system",
          payload: { command, category },
          createdAt: now,
        })
        .run();
      let result;
      try {
        result = await runCommand({
          command,
          cwd,
          timeoutMs: Number(process.env.RELAY_COMMAND_TIMEOUT_MS ?? 1_800_000),
          onStart: (pid) => {
            this.options.database.db
              .update(commandRuns)
              .set({ pid })
              .where(eq(commandRuns.id, commandId))
              .run();
          },
        });
      } catch (error) {
        result = {
          exitCode: null,
          stdout: "",
          stderr: error instanceof Error ? (error.stack ?? error.message) : String(error),
          durationMs: 0,
          timedOut: false,
          aborted: false,
        };
      }
      await writeFile(
        logPath,
        `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`,
        { mode: 0o600 },
      );
      const passed = result.exitCode === 0 && !result.timedOut && !result.aborted;
      const completedAt = new Date().toISOString();
      this.options.database.db
        .update(commandRuns)
        .set({ status: passed ? "passed" : "failed", exitCode: result.exitCode, completedAt })
        .where(eq(commandRuns.id, commandId))
        .run();
      this.options.database.db
        .update(testRuns)
        .set({ status: passed ? "passed" : "failed", durationMs: result.durationMs, completedAt })
        .where(eq(testRuns.id, testId))
        .run();
      this.options.database.db
        .insert(artifacts)
        .values({
          id: randomUUID(),
          taskId,
          runId: commandId,
          type: "log",
          path: logPath,
          mimeType: "text/plain",
          metadata: { command, category },
          createdAt: completedAt,
        })
        .run();
      this.options.database.db
        .insert(taskEvents)
        .values({
          taskId,
          type: passed ? "tests.passed" : "tests.failed",
          actor: "system",
          payload: { command, category, durationMs: result.durationMs },
          createdAt: completedAt,
        })
        .run();
      if (!passed) return false;
    }
    return true;
  }

  private async writeDeliveryArtifacts(
    taskId: string,
    worktree: GitRepository,
    baseBranch: string,
    plan: ImplementationPlan,
  ): Promise<void> {
    const directory = join(this.options.dataDir, "artifacts", taskId, "delivery");
    await mkdir(directory, { recursive: true });
    const diffPath = join(directory, "total.diff");
    const reportPath = join(directory, "delivery-report.json");
    const diff = await worktree.diff(`${baseBranch}...HEAD`);
    const commits = await worktree.commits(baseBranch);
    const report = {
      generatedAt: new Date().toISOString(),
      implemented: plan.commits.map((commit) => commit.goal),
      commits,
      manualChecks: plan.finalValidation,
      risks: plan.risks,
    };
    await writeFile(diffPath, diff, { mode: 0o600 });
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    const now = new Date().toISOString();
    this.options.database.db
      .insert(artifacts)
      .values([
        {
          id: randomUUID(),
          taskId,
          type: "diff",
          path: diffPath,
          mimeType: "text/x-diff",
          metadata: { baseBranch },
          createdAt: now,
        },
        {
          id: randomUUID(),
          taskId,
          type: "report",
          path: reportPath,
          mimeType: "application/json",
          metadata: {},
          createdAt: now,
        },
      ])
      .run();
  }

  private blockTask(taskId: string, reason: string): void {
    const now = new Date().toISOString();
    const { db, sqlite } = this.options.database;
    sqlite.transaction(() => {
      db.update(tasks)
        .set({
          runtimeStatus: "blocked",
          blockedReason: reason,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();
      db.insert(taskEvents)
        .values({
          taskId,
          type: "implementation.blocked",
          actor: "system",
          payload: { reason },
          createdAt: now,
        })
        .run();
      db.insert(notifications)
        .values({
          id: randomUUID(),
          taskId,
          type: "task.blocked",
          title: "Implementation blocked",
          body: reason,
          createdAt: now,
        })
        .run();
    })();
  }

  private async runAgentTurn(
    taskId: string,
    role: AgentRole,
    cwd: string,
    prompt: string,
    configSnapshot?: ProjectConfig,
  ): Promise<string> {
    const { db } = this.options.database;
    const runId = randomUUID();
    const now = new Date().toISOString();
    db.insert(agentRuns)
      .values({
        id: runId,
        taskId,
        role,
        status: "running",
        configSnapshot: configSnapshot ?? null,
        startedAt: now,
      })
      .run();
    const session = await this.options.agent.createSession({
      role,
      cwd,
      systemPrompt: systemPromptFor(role),
      sandbox: role === "implementer" ? "danger-full-access" : "read-only",
      approvalPolicy: "never",
    });
    db.update(agentRuns).set({ sessionId: session.id }).where(eq(agentRuns.id, runId)).run();

    let output = "";
    let lastAgentError: string | undefined;
    try {
      for await (const event of this.options.agent.runTurn({ sessionId: session.id, prompt })) {
        this.recordAgentEvent(runId, taskId, event);
        if (event.type === "error") {
          lastAgentError = event.message;
          if (isAuthenticationError(event.message))
            throw new NonRetryableJobError(codexLoginMessage());
        }
        if (role === "implementer") {
          const runtimeStatus = db
            .select({ status: tasks.runtimeStatus })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .get()?.status;
          if (runtimeStatus === "stopped") {
            await this.options.agent.interrupt(session.id);
            throw new AgentStoppedError();
          }
        }
        if (event.type === "turn.completed") output = event.output;
      }
      if (!output.trim()) {
        throw new Error(
          lastAgentError
            ? `Agent turn failed: ${lastAgentError}`
            : "Agent completed without output",
        );
      }
      db.update(agentRuns)
        .set({ status: "completed", completedAt: new Date().toISOString() })
        .where(eq(agentRuns.id, runId))
        .run();
      return output;
    } catch (error) {
      db.update(agentRuns)
        .set({
          status: error instanceof AgentStoppedError ? "stopped" : "failed",
          completedAt: new Date().toISOString(),
        })
        .where(eq(agentRuns.id, runId))
        .run();
      throw error;
    }
  }

  private recordAgentEvent(runId: string, taskId: string, event: AgentEvent): void {
    this.options.database.db
      .insert(agentEvents)
      .values({
        runId,
        taskId,
        type: event.type,
        payload: event,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
}

function deploymentStepLabel(command: string, index: number): string {
  const executable = command.trim().split(/\s+/)[0] ?? "command";
  return `${index + 1}. Run ${executable}`;
}

export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

function isAuthenticationError(message: string): boolean {
  return /\b401\b|unauthorized|missing bearer|not logged in|authentication/i.test(message);
}

function codexLoginMessage(): string {
  return "Codex is not authenticated. Run 'pnpm --filter @relay/agent exec codex login --device-auth', then retry the task.";
}

class AgentStoppedError extends Error {
  constructor() {
    super("Agent stopped by user");
    this.name = "AgentStoppedError";
  }
}

function buildImplementationPrompt(
  specification: unknown,
  plan: ImplementationPlan,
  commit: ImplementationPlan["commits"][number],
  resuming: boolean,
  instruction?: string,
): string {
  return `${resuming ? "Resume the interrupted work already present in the worktree. Inspect it before editing.\n" : ""}Implement only approved commit ${commit.order} of ${plan.commits.length}.
Do not start work belonging to later commits. Do not create a Git commit; Relay owns the commit boundary.

Approved specification:
${JSON.stringify(specification, null, 2)}

Approved plan item:
${JSON.stringify(commit, null, 2)}

${instruction ? `Additional user instruction classified as a minor correction:\n${instruction}\n` : ""}
Run the checks relevant to this item while working. Relay will independently run the approved test commands.
Return JSON with exactly: summary (string), deviations (string array), manualChecks (string array).`;
}

function buildReviewChangePrompt(comment: typeof reviewComments.$inferSelect): string {
  return `Address only this approved human review comment. Do not create a Git commit and do not alter unrelated behavior.
Target: ${comment.targetType}${comment.targetId ? ` ${comment.targetId}` : ""}
Comment: ${comment.content}
Run relevant checks and return JSON with exactly: summary (string), deviations (string array), manualChecks (string array).`;
}

function buildPlanningPrompt(
  specification: unknown,
  previousPlan: unknown,
  comments: Array<{ targetType: string; targetId: string | null; content: string }>,
): string {
  return `Create or revise the technical implementation plan for this approved Relay requirement.
Repository access is read-only. Do not modify files.

Approved specification:
${JSON.stringify(specification, null, 2)}

Previous plan:
${previousPlan ? JSON.stringify(previousPlan, null, 2) : "No previous plan."}

User feedback:
${
  comments.length
    ? comments
        .map(
          (comment) =>
            `- ${comment.targetType}${comment.targetId ? ` ${comment.targetId}` : ""}: ${comment.content}`,
        )
        .join("\n")
    : "No feedback."
}

Return JSON with exactly:
- message: concise summary of the proposed plan or revision
- plan: the complete ImplementationPlan object
Every commit must have an id, order, title ready for Git, one goal, expected files, implementationSteps, tests, and dependencies.
Keep commits small, ordered, atomic, and independently reviewable.`;
}

function buildRefinementPrompt(
  title: string,
  conversation: Array<{ role: string; content: string }>,
  draft: unknown,
): string {
  return `Refine this Relay task. Do not discuss file-level implementation yet.

Task title: ${title}
Conversation:
${conversation.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n")}

Current structured draft:
${draft ? JSON.stringify(draft, null, 2) : "No draft yet."}

Return JSON with exactly these top-level fields:
- message: your concise response or focused questions to the user
- specification: the complete RefinedRequirement object, including all lists even when empty
- waitingForUser: true only when a user answer would materially improve or unblock the requirement
Keep previous resolved decisions in the specification.`;
}
