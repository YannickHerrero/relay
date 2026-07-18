import type { TaskPhase, TaskStage } from "./schemas";

export const taskPhases = ["refine", "plan", "build", "review", "deploy", "done"] as const;

export const taskPhaseLabels: Readonly<Record<TaskPhase, string>> = {
  refine: "Refine",
  plan: "Plan",
  build: "Build",
  review: "Review",
  deploy: "Deploy",
  done: "Done",
};

export function taskPhaseForStage(stage: TaskStage): TaskPhase {
  if (stage === "refinement") return "refine";
  if (stage === "planning") return "plan";
  if (stage === "implementation") return "build";
  if (stage === "review") return "review";
  if (stage === "done") return "done";
  return "deploy";
}

export function nextTaskPhase(phase: TaskPhase): TaskPhase | undefined {
  const index = taskPhases.indexOf(phase);
  return taskPhases[index + 1];
}

export const allowedTransitions: Readonly<Record<TaskStage, readonly TaskStage[]>> = {
  refinement: ["planning"],
  planning: ["refinement", "implementation"],
  implementation: ["review"],
  review: ["implementation", "ready_to_deploy"],
  ready_to_deploy: ["deploying", "implementation"],
  deploying: ["done", "implementation", "ready_to_deploy"],
  done: [],
};

export type TransitionActor = "user" | "agent" | "system";

const automaticTransitions = new Set(["deploying:done"]);

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStage,
    readonly to: TaskStage,
    message = `Task cannot transition from ${from} to ${to}`,
  ) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: TaskStage, to: TaskStage, actor: TransitionActor): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }

  if (actor !== "user" && !automaticTransitions.has(`${from}:${to}`)) {
    throw new InvalidTransitionError(from, to, `The ${from} to ${to} transition requires a user`);
  }

  if (actor === "agent" && from === "deploying" && to === "done") {
    throw new InvalidTransitionError(from, to, "Agents cannot complete deployments");
  }
}

export function canTransition(from: TaskStage, to: TaskStage, actor: TransitionActor): boolean {
  try {
    assertTransition(from, to, actor);
    return true;
  } catch {
    return false;
  }
}
