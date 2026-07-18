import { z } from "zod";

export const taskStageSchema = z.enum([
  "refinement",
  "planning",
  "implementation",
  "review",
  "ready_to_deploy",
  "deploying",
  "done",
]);

export const taskRuntimeStatusSchema = z.enum([
  "idle",
  "agent_running",
  "waiting_for_user",
  "blocked",
  "failed",
  "stopped",
]);

export const taskTypeSchema = z.enum([
  "feature",
  "bug",
  "refactor",
  "maintenance",
  "investigation",
]);

export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const projectTypeSchema = z.enum(["web", "ios", "expo", "rust", "custom"]);
export const agentRoleSchema = z.enum([
  "product-refiner",
  "technical-planner",
  "implementer",
  "deployment-diagnostician",
]);

const commandGroupsSchema = z.object({
  setup: z.array(z.string().min(1)).optional(),
  lint: z.array(z.string().min(1)).optional(),
  typecheck: z.array(z.string().min(1)).optional(),
  unitTests: z.array(z.string().min(1)).optional(),
  integrationTests: z.array(z.string().min(1)).optional(),
  build: z.array(z.string().min(1)).optional(),
  finalValidation: z.array(z.string().min(1)).optional(),
});

export const deploymentRecipeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    kind: z.enum(["command", "git_push"]).default("command"),
    commands: z.array(z.string().min(1)).max(20).default([]),
    environment: z.string().max(80).default("default"),
    requiresConfirmation: z.boolean().default(true),
    resultUrlPattern: z.string().url().optional(),
  })
  .superRefine((recipe, context) => {
    if (recipe.kind === "command" && recipe.commands.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["commands"],
        message: "Command deployment recipes require at least one command",
      });
    }
  });

export const projectConfigSchema = z.object({
  commands: commandGroupsSchema.default({}),
  preview: z
    .object({
      startCommand: z.string().min(1),
      healthcheckUrl: z.string().url().optional(),
    })
    .optional(),
  deploymentRecipes: z.array(deploymentRecipeSchema).default([]),
});

const attachmentSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "video", "log", "file"]),
  path: z.string(),
});

export const refinedRequirementSchema = z.object({
  title: z.string().min(1),
  problem: z.string(),
  objective: z.string(),
  currentBehavior: z.string().optional(),
  expectedBehavior: z.array(z.string()),
  userFlows: z.array(z.object({ name: z.string(), steps: z.array(z.string()) })),
  acceptanceCriteria: z.array(z.string()),
  edgeCases: z.array(z.string()),
  constraints: z.array(z.string()),
  outOfScope: z.array(z.string()),
  unresolvedQuestions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      blocking: z.boolean(),
      status: z.enum(["open", "resolved"]),
    }),
  ),
  attachments: z.array(attachmentSchema),
});

const planCommitSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  title: z.string().min(1),
  goal: z.string(),
  files: z.array(z.string()),
  implementationSteps: z.array(z.string()),
  tests: z.array(z.string()),
  dependencies: z.array(z.string()),
});

export const implementationPlanSchema = z.object({
  understanding: z.string().min(1),
  assumptions: z.array(z.string()),
  affectedAreas: z.array(z.string()),
  commits: z.array(planCommitSchema).min(1),
  finalValidation: z.array(z.string()),
  deploymentImpact: z.array(z.string()),
  migrations: z.array(z.string()),
  newDependencies: z.array(z.string()),
  configurationChanges: z.array(z.string()),
  risks: z.array(z.string()),
  outOfScope: z.array(z.string()),
});

export type TaskStage = z.infer<typeof taskStageSchema>;
export type TaskRuntimeStatus = z.infer<typeof taskRuntimeStatusSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type ProjectType = z.infer<typeof projectTypeSchema>;
export type AgentRole = z.infer<typeof agentRoleSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type DeploymentRecipe = z.infer<typeof deploymentRecipeSchema>;
export type RefinedRequirement = z.infer<typeof refinedRequirementSchema>;
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
