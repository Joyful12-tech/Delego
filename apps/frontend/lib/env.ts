import { z } from "zod";

const envSchema = z
  .object({
    NEXT_PUBLIC_API_URL: z
      .string()
      .url("NEXT_PUBLIC_API_URL must be a valid URL"),
    NEXT_PUBLIC_FEATURE_CLIENT_SIDE_SIGNING: z.string().optional(),
    NEXT_PUBLIC_FEATURE_DUAL_CONTROL_APPROVALS: z.string().optional(),
    // Idle-session keep-alive (#514). All optional — see lib/idleSession.ts
    // for how these resolve (disabled in dev unless explicitly opted in).
    NEXT_PUBLIC_IDLE_SESSION_ENABLED: z.string().optional(),
    NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES: z.string().optional(),
    NEXT_PUBLIC_IDLE_WARNING_SECONDS: z.string().optional(),
    NEXT_PUBLIC_CANONICAL_HOSTS: z.string().optional(),
    // Web Push VAPID public key (#web-push). Required to subscribe to push
    // notifications — leave unset to disable the feature entirely.
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  })
  .passthrough();

// Next.js inlines NEXT_PUBLIC_* values only where they are written as static
// `process.env.NEXT_PUBLIC_FOO` member expressions. Handing the whole
// `process.env` object to the schema reaches the browser as an empty object,
// so `envSchema.parse(process.env)` threw a ZodError on every client render
// and bounced the page into the global error boundary. Build the object from
// static reads so the values survive bundling.
const publicEnv = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_FEATURE_CLIENT_SIDE_SIGNING:
    process.env.NEXT_PUBLIC_FEATURE_CLIENT_SIDE_SIGNING,
  NEXT_PUBLIC_FEATURE_DUAL_CONTROL_APPROVALS:
    process.env.NEXT_PUBLIC_FEATURE_DUAL_CONTROL_APPROVALS,
  NEXT_PUBLIC_IDLE_SESSION_ENABLED:
    process.env.NEXT_PUBLIC_IDLE_SESSION_ENABLED,
  NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES:
    process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES,
  NEXT_PUBLIC_IDLE_WARNING_SECONDS:
    process.env.NEXT_PUBLIC_IDLE_WARNING_SECONDS,
  NEXT_PUBLIC_CANONICAL_HOSTS: process.env.NEXT_PUBLIC_CANONICAL_HOSTS,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
};

export const env = envSchema.parse(publicEnv);
