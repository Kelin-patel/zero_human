import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = "claude-opus-5-5";

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
  usage: TokenUsage;
  attempts?: number;
  models?: string[];
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
}

export interface StructuredArgs<T> {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  effort: Effort;
  maxTokens?: number;
  label?: string;
}

// Supplying an SDK client lets tests exercise the actual SDK parser with a fake HTTP transport.
export function createStructuredCaller(sdk: Anthropic) {
  return <T>(args: StructuredArgs<T>) => callStructured(sdk, args);
}

export function structured<T>(args: StructuredArgs<T>): Promise<StructuredResult<T>> {
  return callStructured(getClient(), args);
}

async function callStructured<T>(sdk: Anthropic, args: StructuredArgs<T>): Promise<StructuredResult<T>> {
  const usage: TokenUsage = { input: 0, output: 0 };
  let refused = false;
  let stopReason: string | null = null;
  const models = new Set<string>();
  const format = betaZodOutputFormat(args.schema);

  // Keep malformed/refusal text from throwing inside the SDK parser: the response still
  // contains billable usage. Configuration, transport and authentication errors still throw.
  const nullableFormat = {
    ...format,
    parse(text: string): T | null {
      let value: unknown;
      try { value = JSON.parse(text); }
      catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
      const parsed = args.schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await sdk.beta.messages.parse({
      model: MODEL,
      max_tokens: args.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      output_config: { format: nullableFormat, effort: args.effort },
    });
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    const cache = res.usage.cache_creation;
    const write1h = cache?.ephemeral_1h_input_tokens ?? 0;
    const write5m = cache?.ephemeral_5m_input_tokens ?? Math.max(0, (res.usage.cache_creation_input_tokens ?? 0) - write1h);
    usage.cacheRead = (usage.cacheRead ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
    usage.cacheWrite5m = (usage.cacheWrite5m ?? 0) + write5m;
    usage.cacheWrite1h = (usage.cacheWrite1h ?? 0) + write1h;
    models.add(res.model);
    for (const block of res.content) {
      if (block.type === "fallback") models.add(block.to.model);
    }
    stopReason = res.stop_reason;
    refused = res.stop_reason === "refusal";
    console.log(
      `[llm] ${args.label ?? "call"} attempt=${attempt} stop=${res.stop_reason} in=${res.usage.input_tokens} out=${res.usage.output_tokens}`,
    );
    // Truncated JSON must never become an authoritative decision, even if it happens to parse.
    const data = res.stop_reason === "end_turn" ? (res.parsed_output ?? null) : null;
    if (data !== null) return { data, refused, stopReason, usage, attempts: attempt, models: [...models] };
  }
  return { data: null, refused, stopReason, usage, attempts: 2, models: [...models] };
}
