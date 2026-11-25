"use client";
import { useState, type ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, TooltipProvider } from "@repo/ui";
import { web_env as env } from "@repo/web/lib/env";
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 20000, retry: 1, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  const app = (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster theme="light" richColors closeButton position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
    <GoogleOAuthProvider clientId={env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}>
      {app}
    </GoogleOAuthProvider>
  ) : (
    app
  );
}
