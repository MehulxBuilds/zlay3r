"use client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import type { ReactNode } from "react";
import { web_env as env } from "@repo/web/lib/env";

export function AppProviders({ children }: { children: ReactNode }) {
  return env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
    <GoogleOAuthProvider clientId={env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}>
      {children}
    </GoogleOAuthProvider>
  ) : (
    children
  );
}
