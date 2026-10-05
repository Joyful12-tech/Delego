"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, FormField } from "@delegolabs/ui";
import { sanitizeRedirectUrl } from "../../lib/redirect";

/**
 * Cookie the auth middleware reads at the edge (`AUTH_TOKEN_COOKIE` in
 * middleware.ts). The SDK keeps its token in localStorage, which the edge
 * runtime cannot see — this cookie is the bridge, as the middleware's own
 * doc comment describes.
 */
const AUTH_TOKEN_COOKIE = "delego_auth_token";

/**
 * Sign-in page for the routes middleware.ts protects.
 *
 * Every protected path redirects here with `?returnTo=<path>`, so this route
 * has to exist for `/delegations`, `/orders`, `/wallet`, and `/settings` to
 * render at all. `returnTo` is caller-controlled and is therefore sanitised
 * before it is ever navigated to (see lib/redirect.ts, #760).
 *
 * TODO: replace the token field with the real sign-in endpoint once the
 * auth routes are implemented in @delegolabs/sdk — until then this page
 * establishes the session cookie the middleware expects.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const returnTo = sanitizeRedirectUrl(searchParams.get("returnTo"));

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = token.trim();
      if (!trimmed) {
        setError("Enter the session token from your wallet connection.");
        return;
      }

      // SameSite=Lax keeps the cookie off cross-site requests while still
      // being sent on the top-level navigation the middleware redirects with.
      document.cookie = `${AUTH_TOKEN_COOKIE}=${encodeURIComponent(
        trimmed
      )}; path=/; SameSite=Lax; max-age=86400`;
      router.replace(returnTo);
    },
    [token, returnTo, router]
  );

  return (
    <Card title="Sign in" ariaLabel="Sign in">
      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Session token"
          hint="Paste the access token issued by the Delego gateway."
          error={error ?? undefined}
          inputProps={{
            type: "password",
            name: "token",
            autoComplete: "current-password",
            value: token,
            onChange: (e) => setToken(e.target.value),
          }}
        />
        <Button type="submit">Sign in</Button>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="settings-page">
      <header className="header">
        <h1>Sign in</h1>
        <p>Connect your wallet to continue</p>
      </header>
      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}