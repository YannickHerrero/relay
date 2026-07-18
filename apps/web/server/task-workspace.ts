import {
  agentEvents,
  agentRuns,
  artifacts,
  deploymentSteps,
  deployments,
  messages,
  planComments,
  planVersions,
  projectConfigVersions,
  projects,
  requirementDrafts,
  reviewComments,
  reviewRequests,
  specificationVersions,
  taskAttachments,
  taskCommits,
  taskEvents,
  taskPhaseVisits,
  tasks,
  testRuns,
} from "@relay/db";
import {
  implementationPlanSchema,
  projectConfigSchema,
  refinedRequirementSchema,
  type TaskPhase,
} from "@relay/domain";
import { asc, desc, eq, inArray } from "drizzle-orm";

import { database } from "./database";

export function loadTaskWorkspace(taskId: string) {
  const { db } = database();
  const row = db
    .select({ task: tasks, project: projects })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get();
  if (!row) return undefined;

  const conversation = db
    .select()
    .from(messages)
    .where(eq(messages.taskId, taskId))
    .orderBy(asc(messages.createdAt))
    .all();
  const draft = db
    .select()
    .from(requirementDrafts)
    .where(eq(requirementDrafts.taskId, taskId))
    .get();
  const specifications = db
    .select()
    .from(specificationVersions)
    .where(eq(specificationVersions.taskId, taskId))
    .orderBy(desc(specificationVersions.version))
    .all();
  const plans = db
    .select()
    .from(planVersions)
    .where(eq(planVersions.taskId, taskId))
    .orderBy(desc(planVersions.version))
    .all();
  const comments = plans[0]
    ? db
        .select()
        .from(planComments)
        .where(eq(planComments.planVersionId, plans[0].id))
        .orderBy(asc(planComments.createdAt))
        .all()
    : [];
  const runs = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(asc(agentRuns.startedAt))
    .all();
  const runIds = runs.map((run) => run.id);
  const runEvents = runIds.length
    ? db
        .select()
        .from(agentEvents)
        .where(inArray(agentEvents.runId, runIds))
        .orderBy(asc(agentEvents.id))
        .all()
    : [];
  const commits = db
    .select()
    .from(taskCommits)
    .where(eq(taskCommits.taskId, taskId))
    .orderBy(asc(taskCommits.order))
    .all();
  const tests = db
    .select()
    .from(testRuns)
    .where(eq(testRuns.taskId, taskId))
    .orderBy(desc(testRuns.startedAt))
    .all();
  const taskArtifacts = db
    .select()
    .from(artifacts)
    .where(eq(artifacts.taskId, taskId))
    .orderBy(desc(artifacts.createdAt))
    .all();
  const taskDeployments = db
    .select()
    .from(deployments)
    .where(eq(deployments.taskId, taskId))
    .orderBy(desc(deployments.createdAt))
    .all();
  const deploymentIds = taskDeployments.map((deployment) => deployment.id);
  const taskDeploymentSteps = deploymentIds.length
    ? db
        .select()
        .from(deploymentSteps)
        .where(inArray(deploymentSteps.deploymentId, deploymentIds))
        .orderBy(asc(deploymentSteps.order))
        .all()
    : [];
  const projectConfigRow = db
    .select()
    .from(projectConfigVersions)
    .where(eq(projectConfigVersions.projectId, row.project.id))
    .orderBy(desc(projectConfigVersions.version))
    .get();
  const projectConfig = projectConfigSchema.safeParse(projectConfigRow?.content);
  const attachments = db
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(asc(taskAttachments.createdAt))
    .all();
  const history = db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.id))
    .limit(300)
    .all();
  const visits = db
    .select()
    .from(taskPhaseVisits)
    .where(eq(taskPhaseVisits.taskId, taskId))
    .orderBy(asc(taskPhaseVisits.firstStartedAt))
    .all();
  const reviews = db
    .select()
    .from(reviewRequests)
    .where(eq(reviewRequests.taskId, taskId))
    .orderBy(desc(reviewRequests.version))
    .all();
  const reviewIds = reviews.map((review) => review.id);
  const reviewFeedback = reviewIds.length
    ? db
        .select()
        .from(reviewComments)
        .where(inArray(reviewComments.reviewRequestId, reviewIds))
        .orderBy(asc(reviewComments.createdAt))
        .all()
    : [];
  const requirement = refinedRequirementSchema.safeParse(
    draft?.content ?? specifications[0]?.content,
  );
  const plan = implementationPlanSchema.safeParse(plans[0]?.content);

  return {
    task: row.task,
    project: row.project,
    phases: visits.map((visit) => visit.phase as TaskPhase),
    messages: conversation,
    requirement: requirement.success ? requirement.data : null,
    specificationVersions: specifications.map((version) => ({
      id: version.id,
      version: version.version,
      approvedAt: version.approvedAt,
      createdAt: version.createdAt,
    })),
    plan: plan.success ? plan.data : null,
    planVersions: plans.map((version) => ({
      id: version.id,
      version: version.version,
      approvedAt: version.approvedAt,
      createdAt: version.createdAt,
    })),
    planComments: comments,
    runs,
    agentEvents: runEvents,
    commits,
    tests,
    artifacts: taskArtifacts,
    attachments,
    deployments: taskDeployments,
    deploymentSteps: taskDeploymentSteps,
    deploymentRecipes: projectConfig.success ? projectConfig.data.deploymentRecipes : [],
    events: history,
    reviews,
    reviewComments: reviewFeedback,
  };
}

export type TaskWorkspace = NonNullable<ReturnType<typeof loadTaskWorkspace>>;
