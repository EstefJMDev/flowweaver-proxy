import { Env, SynthesisRequest } from "./types";
import { validate } from "./token_validator";
import { check, increment, FREE_LIMIT } from "./rate_limiter";
import * as cloudflareAi from "./providers/cloudflare_ai";
import * as claudeHaiku from "./providers/claude_haiku";

// Prompts imported at bundle time — text modules (see wrangler.toml rules)
import entretenimientoV1 from "./prompts/v1/entretenimiento.txt";
import cocinaV1 from "./prompts/v1/cocina.txt";
import noticiasV1 from "./prompts/v1/noticias.txt";
import tecnologiaV1 from "./prompts/v1/tecnologia.txt";

const PROMPTS: Record<string, Record<string, string>> = {
  v1: {
    entretenimiento: entretenimientoV1,
    cocina: cocinaV1,
    noticias: noticiasV1,
    tecnologia: tecnologiaV1,
  },
};

const VALID_TYPES = ["entretenimiento", "cocina", "noticias", "tecnologia"] as const;

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildPrompt(template: string, req: SynthesisRequest): string {
  // Validate arrays contain only strings to prevent prompt injection (R-3)
  const titles = req.titles
    .filter((t) => typeof t === "string")
    .map((t) => t.replace(/[`\\]/g, ""));
  const domains = req.domains
    .filter((d) => typeof d === "string")
    .map((d) => d.replace(/[`\\]/g, ""));

  return template
    .replace("{titles}", titles.join(", "))
    .replace("{domains}", domains.join(", "));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/synthesize") {
      return new Response("Not Found", { status: 404 });
    }

    // Auth
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const isValid = await validate(token, env.VALID_TOKENS_KV);
    if (!isValid) return jsonError(401, "INVALID_TOKEN");

    // Rate limit
    const { allowed, remaining } = await check(token, env.RATE_LIMITS_KV, FREE_LIMIT);
    if (!allowed) {
      return new Response(JSON.stringify({ error: "RATE_LIMIT_EXCEEDED" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "86400",
        },
      });
    }

    // Parse body
    let body: SynthesisRequest;
    try {
      body = await request.json<SynthesisRequest>();
    } catch {
      return jsonError(400, "INVALID_BODY");
    }

    // Validate synthesis_type
    if (!VALID_TYPES.includes(body.synthesis_type as typeof VALID_TYPES[number])) {
      return jsonError(400, "SYNTHESIS_TYPE_UNKNOWN");
    }

    // Guard: titles vacíos confunden al modelo con un prompt sin contenido
    if (!body.titles || body.titles.length === 0 || body.titles.every(t => !t || typeof t !== "string")) {
      return jsonError(400, "INVALID_BODY");
    }

    // Load prompt
    const version = body.prompt_version ?? "v1";
    const promptTemplate = PROMPTS[version]?.[body.synthesis_type];
    if (!promptTemplate) return jsonError(400, "SYNTHESIS_TYPE_UNKNOWN");

    const prompt = buildPrompt(promptTemplate, body);

    // Stream SSE
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const writeChunk = async (text: string) => {
      const line = `data: ${JSON.stringify({ chunk: text })}\n\n`;
      await writer.write(encoder.encode(line));
    };

    const writeDone = async () => {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    };

    const responseHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Synthesis-Remaining": String(remaining - 1),
    };

    // Run providers async — do NOT await here (stream response must start)
    (async () => {
      let success = false;
      try {
        await cloudflareAi.stream(prompt, env, writeChunk);
        success = true;
      } catch {
        // Cloudflare AI failed — try fallback
        try {
          await claudeHaiku.stream(prompt, env, writeChunk);
          success = true;
        } catch {
          // Both failed
        }
      }

      if (!success) {
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ error: "PROVIDER_UNAVAILABLE" })}\n\n`
          )
        );
        await writer.close();
        return;
      }

      await writeDone();
      await writer.close();

      // Increment counter only after successful stream — zero-retention (D25)
      await increment(token, env.RATE_LIMITS_KV);
    })();

    return new Response(readable, { headers: responseHeaders });
  },
};
