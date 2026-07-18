import { describe, expect, it } from "vitest";

import { implementationOutputSchema, parseStructuredOutput } from "./structured-output";

describe("agent structured output", () => {
  it("parses the Relay output envelope", () => {
    const parsed = parseStructuredOutput(
      `Completed.\n<relay-output>{"summary":"Implemented one commit","deviations":[],"manualChecks":["Check layout"]}</relay-output>`,
      implementationOutputSchema,
    );
    expect(parsed.summary).toBe("Implemented one commit");
  });

  it("rejects malformed output instead of guessing", () => {
    expect(() => parseStructuredOutput("looks good", implementationOutputSchema)).toThrow(
      /structured output/,
    );
  });
});
