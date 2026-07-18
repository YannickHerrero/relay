import type { TaskStage } from "./schemas";

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
