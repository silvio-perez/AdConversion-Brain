// Claude via AWS Bedrock. Credentials come from the AWS default chain (on the
// server: the instance's IAM role). No keys in code or config.
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import type { Meeting } from "./grain.ts";
import type { Model } from "./model.ts";

/** Pull the JSON object out of a model reply that may include prose or fences. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ConverseFn = (input: ConverseCommandInput) => Promise<{
  output?:
    | { message?: { content?: { text?: string | undefined }[] | undefined } | undefined }
    | undefined;
  usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;
}>;

export class BedrockModel implements Model {
  readonly vendor = "anthropic";
  readonly name: string;
  readonly #converse: ConverseFn;
  /** Token usage, for measuring cost per meeting during the pilot. */
  readonly usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(opts: { modelId: string; region?: string; converse?: ConverseFn }) {
    // The vendor policy is only honest if this really is an Anthropic model.
    if (!/(^|\.)anthropic\./.test(opts.modelId))
      throw new Error(`BedrockModel only supports Anthropic models; got "${opts.modelId}"`);
    this.name = opts.modelId;
    if (opts.converse) this.#converse = opts.converse;
    else {
      const client = new BedrockRuntimeClient(opts.region ? { region: opts.region } : {});
      this.#converse = (input) => client.send(new ConverseCommand(input));
    }
  }

  async extract({
    prompt,
  }: {
    prompt: string;
    meeting: Meeting;
    clientContext: string;
  }): Promise<unknown> {
    const res = await this.#converse({
      modelId: this.name,
      system: [{ text: "You return only a single JSON object. No prose, no code fences." }],
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 2000, temperature: 0 },
    });
    this.usage.calls += 1;
    this.usage.inputTokens += res.usage?.inputTokens ?? 0;
    this.usage.outputTokens += res.usage?.outputTokens ?? 0;
    const text = (res.output?.message?.content ?? []).map((c) => c.text ?? "").join("");
    return extractJson(text);
  }
}
