export interface SynthesisRequest {
  category: string;
  titles: string[];
  domains: string[];
  synthesis_type: "entretenimiento" | "cocina" | "noticias" | "tecnologia";
  language: string;
  prompt_version?: string;
}

export interface SynthesisError {
  error:
    | "INVALID_TOKEN"
    | "RATE_LIMIT_EXCEEDED"
    | "SYNTHESIS_TYPE_UNKNOWN"
    | "INVALID_BODY"
    | "PROVIDER_UNAVAILABLE";
}

export interface Env {
  VALID_TOKENS_KV: KVNamespace;
  RATE_LIMITS_KV: KVNamespace;
  ANTHROPIC_API_KEY: string;
  CLOUDFLARE_AI_ACCOUNT_ID: string;
  AI: Ai;
}
