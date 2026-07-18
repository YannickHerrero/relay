import { implementationPlanSchema, refinedRequirementSchema } from "@relay/domain";
import { z } from "zod";

export const refinementOutputSchema = z.object({
  message: z.string(),
  specification: refinedRequirementSchema,
  waitingForUser: z.boolean(),
});

export const planningOutputSchema = z.object({
  message: z.string(),
  plan: implementationPlanSchema,
});

export const implementationOutputSchema = z.object({
  summary: z.string(),
  deviations: z.array(z.string()),
  manualChecks: z.array(z.string()),
});

export const diagnosisOutputSchema = z.object({
  likelyCause: z.string(),
  evidence: z.array(z.string()),
  suggestedActions: z.array(z.string()),
});

export function parseStructuredOutput<T>(output: string, schema: z.ZodType<T>): T {
  const tagged = output.match(/<relay-output>\s*([\s\S]*?)\s*<\/relay-output>/i)?.[1];
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = tagged ?? fenced ?? output;
  try {
    return schema.parse(JSON.parse(candidate));
  } catch (error) {
    throw new Error("Agent did not return valid Relay structured output", { cause: error });
  }
}
