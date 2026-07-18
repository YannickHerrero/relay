import { describe, expect, it } from "vitest";

import { deploymentRecipeSchema } from "./schemas";

describe("deployment recipe contract", () => {
  it("rejects a command recipe that would deploy nothing", () => {
    expect(() =>
      deploymentRecipeSchema.parse({ id: "empty", label: "Empty", kind: "command" }),
    ).toThrow(/at least one command/);
  });

  it("allows a protected Git push recipe without custom commands", () => {
    expect(
      deploymentRecipeSchema.parse({ id: "git-push", label: "Push", kind: "git_push" }).kind,
    ).toBe("git_push");
  });
});
