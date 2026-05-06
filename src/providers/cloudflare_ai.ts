import { Env } from "../types";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const TIMEOUT_MS = 8000;

export async function stream(
  prompt: string,
  env: Env,
  onChunk: (chunk: string) => void
): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("CF AI timeout")), TIMEOUT_MS)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiCall = (env.AI as any).run(MODEL, {
    messages: [{ role: "user", content: prompt }],
    stream: true,
  }) as Promise<ReadableStream>;

  const response = await Promise.race([aiCall, timeout]);

  const reader = response.getReader();
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
        const chunk = parsed?.response ?? "";
        if (chunk) onChunk(chunk);
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}
