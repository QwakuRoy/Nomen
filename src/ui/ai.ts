// Claude call for semantic naming. Runs in the plugin UI iframe with the user's own API key.

import Anthropic from "@anthropic-ai/sdk";
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, validateAiResponse, type AiRequest, type AiSuggestion } from "../shared/aiContract";

const MODEL = "claude-opus-5-5";
const CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 90_000;

export class NamingError extends Error {
  constructor(
    message: string,
    /** Whether retrying the same request could plausibly succeed. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function explain(error: unknown): NamingError {
  if (error instanceof NamingError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new NamingError("Analysis cancelled.", true);
  if (error instanceof Anthropic.AuthenticationError) return new NamingError("Your Anthropic API key was rejected. Check it in Settings.", false);
  if (error instanceof Anthropic.PermissionDeniedError) return new NamingError("This API key doesn't have access to the model.", false);
  if (error instanceof Anthropic.RateLimitError) return new NamingError("Rate limited by the Anthropic API. Wait a moment and retry.", true);
  if (error instanceof Anthropic.BadRequestError) return new NamingError(`The API rejected the request: ${error.message}`, false);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new NamingError("The naming request timed out.", true);
  if (error instanceof Anthropic.APIConnectionError) return new NamingError("Couldn't reach the Anthropic API. Check your connection.", true);
  if (error instanceof Anthropic.APIError) return new NamingError(`Anthropic API error (${error.status ?? "unknown"}).`, true);
  return new NamingError(error instanceof Error ? error.message : String(error), true);
}

async function runOne(client: Anthropic, request: AiRequest, signal: AbortSignal): Promise<Map<string, AiSuggestion>> {
  const response = await client.beta.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      // Naming is closer to classification than open-ended reasoning: keep latency low.
      output_config: { effort: "low", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      // If a safety classifier declines, let the API retry on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: request.userPrompt }],
    },
    { signal, timeout: REQUEST_TIMEOUT_MS },
  );

  if (response.stop_reason === "refusal") throw new NamingError("The model declined to name these layers.", false);
  if (response.stop_reason === "max_tokens") throw new NamingError("The naming response was cut off. Try a smaller selection.", false);

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new NamingError("The model returned no suggestions.", true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NamingError("The model returned invalid JSON. Nothing was renamed.", true);
  }
  const result = validateAiResponse(parsed, request.candidateIds);
  if (!result.ok) throw new NamingError(`The model's response failed validation (${result.reason}) Nothing was renamed.`, true);
  return result.suggestions;
}

/**
 * Run every request (at most CONCURRENCY at a time) and merge the results.
 * Any failure rejects the whole analysis: partial AI output is never mixed in silently.
 */
export async function nameWithClaude(
  apiKey: string,
  requests: AiRequest[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, AiSuggestion>> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const merged = new Map<string, AiSuggestion>();
  // One failure cancels the requests still in flight.
  const inner = new AbortController();
  const forwardAbort = () => inner.abort();
  signal.addEventListener("abort", forwardAbort);
  let next = 0;
  let done = 0;
  onProgress(0, requests.length);

  const worker = async () => {
    while (next < requests.length && !inner.signal.aborted) {
      const request = requests[next++];
      const result = await runOne(client, request, inner.signal);
      result.forEach((v, k) => merged.set(k, v));
      onProgress(++done, requests.length);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, requests.length) }, worker));
  } catch (e) {
    inner.abort();
    throw explain(e);
  } finally {
    signal.removeEventListener("abort", forwardAbort);
  }
  return merged;
}
