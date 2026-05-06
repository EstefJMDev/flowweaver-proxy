export async function validate(token: string, kv: KVNamespace): Promise<boolean> {
  if (!token) return false;
  const value = await kv.get(token);
  return value !== null;
}
