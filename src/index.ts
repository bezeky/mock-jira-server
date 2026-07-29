/**
 * Application entrypoint for the Mock Jira Server (Server / Data Center
 * flavor).
 *
 * Connects to PostgreSQL (with a retry loop, since the DB container may
 * still be coming up), creates tables, assigns the store singleton, seeds
 * initial data when the store is empty, and starts the Fastify server.
 */

import { buildApp } from "./app";
import { resolveLogLevel, settings } from "./config";
import { PostgresStore, getDb, setDb } from "./store";
import { loadSeedData } from "./seed";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(): Promise<void> {
  const maxRetries = 10;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let db: PostgresStore | null = null;
    try {
      db = new PostgresStore(settings.DATABASE_URL);
      await db.initTables();
      setDb(db);
      return;
    } catch (err) {
      lastError = err;
      if (db) {
        try {
          await db.close();
        } catch {
          // Ignore teardown errors on a failed attempt.
        }
      }
      if (attempt < maxRetries) {
        await sleep(2000);
      }
    }
  }
  throw new Error(
    `Could not connect to database after ${maxRetries} attempts: ${lastError}`
  );
}

async function main(): Promise<void> {
  const app = await buildApp({
    logger: { level: resolveLogLevel(settings.LOG_LEVEL) },
  });

  await connectWithRetry();

  const db = getDb();
  if (settings.SEED_DATA && (await db.listProjects()).length === 0) {
    await loadSeedData(db);
  }

  await app.listen({ host: settings.HOST, port: settings.PORT });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
