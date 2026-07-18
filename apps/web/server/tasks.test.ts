import { describe, expect, it } from "vitest";

import { deriveTaskTitle, taskValuesFromRequest } from "./tasks";

const projectId = "00000000-0000-4000-8000-000000000001";

describe("streamlined task requests", () => {
  it("derives the title from the first non-empty request line", () => {
    expect(deriveTaskTitle("\n  ## Keep readers positioned\n\nDo not move the viewport.")).toBe(
      "Keep readers positioned",
    );
  });

  it("caps generated titles and applies task defaults", () => {
    const request = "A".repeat(200);
    expect(taskValuesFromRequest({ projectId, request }, "trunk")).toEqual({
      projectId,
      title: "A".repeat(160),
      initialRequest: request,
      type: "feature",
      priority: "medium",
      baseBranch: "trunk",
    });
  });
});
