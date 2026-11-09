/** Short, bounded process-local single-flight cache; failures are never cached. */
export function createAsyncCache<T>(ttlMs: number, max = 500, now = Date.now) {
  const entries = new Map<string, { expires: number; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = entries.get(key);
    if (existing && existing.expires > now()) return existing.value;
    if (entries.size >= max) entries.delete(entries.keys().next().value!);
    const entry: { expires: number; value: Promise<T> } = { expires: Infinity, value: Promise.resolve(null as T) as Promise<T> };
    entry.value = Promise.resolve().then(load).then((value) => {
      entry.expires = now() + ttlMs;
      return value;
    }, (error: unknown) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }) as Promise<T>;
    entries.set(key, entry);
    return entry.value;
  };
}
