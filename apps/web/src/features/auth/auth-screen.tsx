"use client";
import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import {
  Alert,
  AlertDescription,
  Button,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Separator,
} from "@repo/ui";
import { ArrowRight, Boxes, ShieldCheck, Sparkles } from "lucide-react";
import { web_env } from "@repo/web/lib/env";
import {
  useSignIn,
  useGoogleSignIn,
  registerSchema,
  signInSchema,
} from "@repo/web/hooks/api/auth";
import { ActionForm, Field } from "@repo/web/components/shared/forms";
import { ErrorAlert, PixelCard } from "@repo/web/components/shared/feedback";
export function AuthScreen() {
  const [registering, setRegistering] = useState(false);
  const [googleError, setGoogleError] = useState(false);
  const signIn = useSignIn();
  const google = useGoogleSignIn();
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand-lockup" href="/">
          <span className="brand-emblem">z</span>zlayer
        </a>
        <div className="auth-story-copy">
          <span className="eyebrow">A LITTLE SPACE. A LOT OF POSSIBILITY.</span>
          <h1>
            Big ideas.
            <br />
            Small pixels.
            <br />
            <span className="text-forest">Endless possibilities.</span>
          </h1>
          <p>
            The workspace for agents that do things. Build, run, and explore in
            a space that's yours.
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="pixel-building tall">
              <Boxes />
            </div>
            <div className="pixel-building short">
              <Sparkles />
            </div>
            <div className="pixel-building medium">
              <ShieldCheck />
            </div>
            <div className="pixel-ground" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          YOUR AGENTS. YOUR WORKSPACE.
        </p>
      </section>
      <section className="auth-form-area">
        <PixelCard className="w-full max-w-md">
          <CardHeader>
            <p className="eyebrow">LET'S MAKE SOMETHING</p>
            <CardTitle className="mt-2 text-3xl tracking-tight">
              {registering ? "Your next chapter starts here." : "Welcome back."}
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              {registering
                ? "Create your workspace and bring your ideas to life."
                : "Sign in and pick up where you left off."}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <ErrorAlert error={signIn.error ?? google.error} />
            {googleError && (
              <Alert variant="destructive">
                <AlertDescription>
                  Google sign-in didn't finish. Please try again.
                </AlertDescription>
              </Alert>
            )}
            <ActionForm
              key={registering ? "register" : "login"}
              schema={registering ? registerSchema : signInSchema}
              pending={signIn.isPending}
              submit={registering ? "Create your workspace" : "Sign in"}
              onSubmit={async (input) => {
                await signIn.mutateAsync(input);
              }}
            >
              {registering && (
                <Field label="Your name">
                  <Input
                    name="name"
                    autoComplete="name"
                    required
                    placeholder="Alex Morgan"
                  />
                </Field>
              )}
              <Field label="Email">
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                />
              </Field>
              <Field
                label="Password"
                hint={
                  registering
                    ? "At least 12 characters. Make it a good one."
                    : undefined
                }
              >
                <Input
                  name="password"
                  type="password"
                  autoComplete={
                    registering ? "new-password" : "current-password"
                  }
                  minLength={registering ? 12 : 1}
                  required
                  placeholder="Enter your password"
                />
              </Field>
            </ActionForm>
            {web_env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <>
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    or continue with
                  </span>
                  <Separator className="flex-1" />
                </div>
                <div className="flex justify-center">
                  <GoogleLogin
                    onSuccess={(value) => {
                      if (value.credential) google.mutate(value.credential);
                    }}
                    onError={() => setGoogleError(true)}
                    theme="outline"
                    shape="rectangular"
                  />
                </div>
              </>
            )}
            <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
              {registering ? "Already have a workspace?" : "New around here?"}
              <Button
                variant="link"
                className="h-auto px-1 text-forest"
                onClick={() => {
                  setRegistering(!registering);
                  signIn.reset();
                  google.reset();
                }}
              >
                {registering ? "Sign in" : "Create an account"}
                <ArrowRight className="size-3" />
              </Button>
            </p>
          </CardContent>
        </PixelCard>
      </section>
    </main>
  );
}
