import dotenv from "dotenv";

dotenv.config();

export const settings = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://jira:jira_password@localhost:5432/jira_mock",
  BASE_URL: process.env.BASE_URL ?? "http://localhost:8080",
  HOST: process.env.HOST ?? "0.0.0.0",
  PORT: parseInt(process.env.PORT ?? "8080", 10),
  SEED_DATA: (process.env.SEED_DATA ?? "true").toLowerCase() === "true",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
};

// Python-logging level names accepted by the previous deployment's .env, and
// any unknown value, must still start the server — pino throws on names
// outside its own set, where Python fell back to INFO.
const PINO_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
const PYTHON_LEVEL_ALIASES: Record<string, string> = {
  CRITICAL: "fatal",
  FATAL: "fatal",
  ERROR: "error",
  WARNING: "warn",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
  NOTSET: "trace",
};

export function resolveLogLevel(raw: string): string {
  const value = (raw ?? "").trim();
  if (PINO_LEVELS.includes(value.toLowerCase())) {
    return value.toLowerCase();
  }
  return PYTHON_LEVEL_ALIASES[value.toUpperCase()] ?? "info";
}
