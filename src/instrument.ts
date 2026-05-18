// src/instrument.ts
import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { config } from "./config";

let dsn: string | undefined;
if (config.env === "staging" || config.env === "production") {
  dsn = config.sentryDSN;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: config.env,
    tracesSampleRate: config.env === "production" ? 0.3 : 1.0,
    profileSessionSampleRate: 1.0,
    profileLifecycle: "trace",
    sendDefaultPii: true,
    enableLogs: true,
    integrations: [nodeProfilingIntegration()],
  });
}