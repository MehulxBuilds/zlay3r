"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AgentPlatformClient, PlatformError } from "@repo/sdk";
import { toast } from "@repo/ui";
import { web_env } from "@repo/web/lib/env";
import { errorMessage } from "@repo/web/lib/format";
import { userSchema } from "@repo/web/lib/schemas";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
const client = new AgentPlatformClient({
  baseUrl: web_env.NEXT_PUBLIC_API_BASE,
});
export const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Enter your password"),
});
export const registerSchema = signInSchema.extend({
  name: z.string().trim().min(1, "Enter your name"),
  password: z.string().min(12, "Use at least 12 characters"),
});
export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth"],
    queryFn: async ({ signal }) => {
      try {
        return userSchema.parse((await client.withSignal(signal).me()).user);
      } catch (error) {
        if (error instanceof PlatformError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
}
export function useSignIn() {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: z.infer<typeof signInSchema> & { name?: string },
    ) => {
      const session = input.name
        ? await client.register(registerSchema.parse(input))
        : await client.login(input.email, input.password);
      return userSchema.parse(session.user);
    },
    onSuccess: (user) => {
      queries.setQueryData(["auth"], user);
      toast.success("Welcome to your workspace");
    },
  });
}
export function useGoogleSignIn() {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async (credential: string) =>
      userSchema.parse(
        (await client.google(z.string().min(1).parse(credential))).user,
      ),
    onSuccess: (user) => {
      queries.setQueryData(["auth"], user);
      toast.success("Welcome to your workspace");
    },
  });
}
export function useSignOut() {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: () => client.logout(),
    onError: (error) =>
      useWorkspaceStore.getState().setMutationError(errorMessage(error)),
    onSuccess: () => {
      queries.clear();
      useWorkspaceStore.getState().reset();
      queries.setQueryData(["auth"], null);
      toast.success("Signed out");
    },
  });
}
