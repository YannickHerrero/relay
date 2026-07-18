import { describe, expect, it } from "vitest";

import { assertTransition, canTransition, nextTaskPhase, taskPhaseForStage } from "./state-machine";

describe("task state machine", () => {
  it("allows user-controlled approval transitions", () => {
    expect(canTransition("refinement", "planning", "user")).toBe(true);
    expect(canTransition("review", "ready_to_deploy", "user")).toBe(true);
  });

  it("requires an owner to move implementation to review", () => {
    expect(canTransition("implementation", "review", "user")).toBe(true);
    expect(canTransition("implementation", "review", "agent")).toBe(false);
    expect(canTransition("review", "ready_to_deploy", "agent")).toBe(false);
    expect(() => assertTransition("refinement", "planning", "agent")).toThrow(/requires a user/);
  });

  it("maps internal deployment states into one visual phase", () => {
    expect(taskPhaseForStage("ready_to_deploy")).toBe("deploy");
    expect(taskPhaseForStage("deploying")).toBe("deploy");
    expect(nextTaskPhase("review")).toBe("deploy");
    expect(nextTaskPhase("done")).toBeUndefined();
  });

  it("rejects transitions out of done", () => {
    expect(canTransition("done", "implementation", "user")).toBe(false);
  });

  it("allows the system to complete a successful deployment", () => {
    expect(canTransition("deploying", "done", "system")).toBe(true);
    expect(canTransition("deploying", "done", "agent")).toBe(false);
  });
});
