# flowweaver-proxy

Cloudflare Worker que actúa como proxy stateless para la síntesis de contenido de FlowWeaver. Recibe un payload con categoría y recursos del usuario, llama a un LLM (Cloudflare AI primario, Claude Haiku fallback) y devuelve el resultado como SSE.

**Zero-log, zero-retention.** No se almacena ningún contenido del payload.

---

## Requisitos

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cuenta en Cloudflare (gratuita)

---

## Setup local

```bash
npm install
wrangler dev
```

El Worker arranca en `http://localhost:8787`.

---

## Configurar secretos

Los API keys NUNCA van en código. Configurar con:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put CLOUDFLARE_AI_ACCOUNT_ID
```

Para desarrollo local, crear `.dev.vars` (excluido de git):

```
ANTHROPIC_API_KEY=sk-ant-...
CLOUDFLARE_AI_ACCOUNT_ID=...
```

---

## Crear KV namespaces

```bash
wrangler kv:namespace create VALID_TOKENS_KV
wrangler kv:namespace create RATE_LIMITS_KV
```

Copiar los IDs generados y reemplazar los placeholders en `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "VALID_TOKENS_KV"
id = "ID_REAL_AQUI"

[[kv_namespaces]]
binding = "RATE_LIMITS_KV"
id = "ID_REAL_AQUI"
```

---

## Añadir token de beta tester

Cada install_token es un UUID v4 generado por el PO:

```bash
wrangler kv:key put --binding VALID_TOKENS_KV "uuid-del-usuario" "active"
```

---

## Desplegar

```bash
wrangler deploy
```

El Worker queda disponible en `https://flowweaver-proxy.<tu-subdominio>.workers.dev`.

---

## Verificar ACs con curl

**AC-1 — SSE con token válido (tipo entretenimiento):**
```bash
curl -X POST http://localhost:8787/synthesize \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"cine","titles":["Inception"],"domains":["imdb.com"],"synthesis_type":"entretenimiento","language":"es"}' \
  --no-buffer
```

**AC-2 — Sin Authorization → 401:**
```bash
curl -X POST http://localhost:8787/synthesize \
  -H "Content-Type: application/json" \
  -d '{"category":"test","titles":[],"domains":[],"synthesis_type":"cocina","language":"es"}'
```

**AC-3 — Rate limit → 429:**
Insertar contador al límite en KV:
```bash
wrangler kv:key put --binding RATE_LIMITS_KV "TU_TOKEN_month_$(date +%Y%m)" "5"
```
Luego repetir curl de AC-1.

**AC-4 — synthesis_type inválido → 400:**
```bash
curl -X POST http://localhost:8787/synthesize \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"test","titles":[],"domains":[],"synthesis_type":"invalido","language":"es"}'
```

**AC-7 — Grep de API keys en código:**
```bash
grep -r "sk-ant\|Bearer " src/
```
Resultado esperado: vacío.

---

## Verificación manual (requiere deploy)

- **AC-8**: `wrangler deploy` exitoso → URL de producción responde.
- **AC-11**: Cloudflare Workers Dashboard → Logs → verificar que no aparecen títulos ni dominios del payload.

---

## Contrato del endpoint

```
POST /synthesize
Authorization: Bearer {install_token}
Content-Type: application/json

{
  "category": "string",
  "titles": ["string"],
  "domains": ["string"],
  "synthesis_type": "entretenimiento" | "cocina" | "noticias" | "tecnologia",
  "language": "es",
  "prompt_version": "v1"  // opcional, default "v1"
}
```

Respuesta exitosa: `text/event-stream` con `X-Synthesis-Remaining: N`.
