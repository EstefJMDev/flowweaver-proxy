import { Env } from "../types";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2500;
const TIMEOUT_MS = 10000;

export async function stream(
  prompt: string,
  env: Env,
  onChunk: (chunk: string) => void
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta") {
            const chunk = parsed.delta?.text ?? "";
            if (chunk) onChunk(chunk);
          } else if (parsed.type === "message_stop") {
            return;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
