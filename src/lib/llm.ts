import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

const MODEL = "claude-opus-5-5";

let client: Anthropic | undefined;

// Created lazily so importing this module never requires ANTHROPIC_API_KEY.
function getClient(): Anthropic {
  return (client ??= new Anthropic());
}

export type Effort = "low" | "medium" | "high";

export interface StructuredResult<T> {
  data: T | null;
  refused: boolean;
  stopReason: string | null;
  usage: { input: number; output: number };
}

// One structured Claude call validated against a zod schema. Sampling parameters are never
// sent (the API rejects them) and thinking is always on, so effort is the only quality knob.
// A null result is retried once; after that the caller decides what a missing answer means.
export async function structured<T>(args: {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  effort: Effort;
  maxTokens?: number;
  label?: string;
}): Promise<StructuredResult<T>> {
  const usage = { input: 0, output: 0 };
  let refused = false;
  let stopReason: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await getClient().beta.messages.parse({
        model: MODEL,
        max_tokens: args.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        output_config: { format: betaZodOutputFormat(args.schema), effort: args.effort },
      });
      usage.input += res.usage.input_tokens;
      usage.output += res.usage.output_tokens;
      stopReason = res.stop_reason;
      refused = res.stop_reason === "refusal";
      console.log(
        `[llm] ${args.label ?? "call"} attempt=${attempt} stop=${res.stop_reason} in=${res.usage.input_tokens} out=${res.usage.output_tokens}`,
      );
      const data = refused ? null : (res.parsed_output ?? null);
      if (data !== null) return { data, refused, stopReason, usage };
    } catch (err) {
      // API errors (auth, rate limits after SDK retries, bad requests) are real failures.
      if (err instanceof Anthropic.APIError) throw err;
      // Anything else is output that didn't validate against the schema: treat as no answer.
      console.warn(`[llm] ${args.label ?? "call"} attempt=${attempt} unparseable output:`, err instanceof Error ? err.message : err);
    }
  }
  return { data: null, refused, stopReason, usage };
}
