import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubSentryEvent } from "./lib/observability/scrub-sentry";

/** Edge runtime Sentry init (#511, #761) — middleware and edge route handlers. */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  beforeSend(event) {
    // scrubSentryEvent is pure with respect to its input, so the scrubbed
    // event is still an ErrorEvent for Sentry's purposes.
    return scrubSentryEvent(event) as ErrorEvent | null;
  },
});
