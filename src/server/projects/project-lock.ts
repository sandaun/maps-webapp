const queues = new Map<string, Promise<unknown>>();

/**
 * Serializes every write of one project, so two requests can never read the
 * same XML and overwrite each other. In-process only, like the local store
 * (see `persistence/index.ts`). Reads stay lock-free: writers store the XML
 * before the meta and readers load the meta before the XML, so a reader never
 * pairs a revision with an older XML.
 */
export async function withProjectLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  try {
    return await run;
  } finally {
    if (queues.get(key) === settled) queues.delete(key);
  }
}
