export const FREE_LIMIT = 5;

function monthKey(token: string): string {
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${token}_month_${yyyymm}`;
}

export async function check(
  token: string,
  kv: KVNamespace,
  limit: number = FREE_LIMIT
): Promise<{ allowed: boolean; remaining: number }> {
  const key = monthKey(token);
  const raw = await kv.get(key);
  const used = raw ? parseInt(raw, 10) : 0;
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, remaining };
}

export async function increment(token: string, kv: KVNamespace): Promise<number> {
  const key = monthKey(token);
  const raw = await kv.get(key);
  const used = raw ? parseInt(raw, 10) : 0;
  const next = used + 1;
  // TTL: 31 days in seconds
  await kv.put(key, String(next), { expirationTtl: 2678400 });
  return next;
}
