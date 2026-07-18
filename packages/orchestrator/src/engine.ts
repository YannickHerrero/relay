import { randomUUID } from "node:crypto";

import {
  agentEvents,
  agentRuns,
  messages,
  notifications,
  projects,
  requirementDrafts,
  taskEvents,
  tasks,
  type RelayDatabase,
} from "@relay/db";
import type { AgentAdapter, AgentEvent } from "@relay/agent";
import { parseStructuredOutput, refinementOutputSchema, systemPromptFor } from "@relay/agent";
import type { AgentRole } from "@relay/domain";
import { and, eq } from "drizzle-orm";

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

  private async runAgentTurn(
    taskId: string,
    role: AgentRole,
    cwd: string,
    prompt: string,
  ): Promise<string> {
    const { db } = this.options.database;
    const runId = randomUUID();
    const now = new Date().toISOString();
    db.insert(agentRuns)
      .values({ id: runId, taskId, role, status: "running", startedAt: now })
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
    try {
      for await (const event of this.options.agent.runTurn({ sessionId: session.id, prompt })) {
        this.recordAgentEvent(runId, taskId, event);
        if (event.type === "turn.completed") output = event.output;
      }
      db.update(agentRuns)
        .set({ status: "completed", completedAt: new Date().toISOString() })
        .where(eq(agentRuns.id, runId))
        .run();
      return output;
    } catch (error) {
      db.update(agentRuns)
        .set({ status: "failed", completedAt: new Date().toISOString() })
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
