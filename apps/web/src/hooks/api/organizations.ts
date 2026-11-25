"use client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  organizationSchema,
  memberSchema,
  credentialSchema,
} from "@repo/web/lib/schemas";
import {
  useApiClient,
  useApiQuery,
  useApiAction,
  noContentSchema,
  post,
  remove,
} from "./core";
export function useOrganizations() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["organizations"],
    queryFn: async ({ signal }) =>
      z
        .array(organizationSchema)
        .parse(
          await client.request<unknown>("/v1/organizations", {}, { signal }),
        ),
  });
}
export const useMembers = () =>
  useApiQuery("members", "/v1/memberships", z.array(memberSchema));
export const useCreateOrganization = () =>
  useApiAction(
    "organization",
    (client, input: { name: string }) =>
      post(client, "/v1/organizations", input),
    organizationSchema,
    "Workspace created",
  );
export const useRenameOrganization = () =>
  useApiAction(
    "organization",
    (client, input: { name: string }) =>
      client.request("/v1/organizations/current", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    organizationSchema.omit({ role: true }),
    "Workspace renamed",
  );
export const useInviteMember = () =>
  useApiAction(
    "members",
    (client, input: { email: string; role: string }) =>
      post(client, "/v1/invitations", input),
    credentialSchema,
    "Invitation created",
  );
export const useAcceptInvitation = () =>
  useApiAction(
    "members",
    (client, input: { token: string }) =>
      post(client, "/v1/invitations/accept", input),
    z.object({ organizationId: z.string() }),
    "Invitation accepted",
  );
export const useUpdateMember = () =>
  useApiAction(
    "members",
    (client, input: { id: string; role: string }) =>
      client.request(`/v1/memberships/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: input.role }),
      }),
    memberSchema.pick({ id: true, userId: true, role: true }),
    "Member role updated",
  );
export const useRemoveMember = () =>
  useApiAction(
    "members",
    (client, id: string) => remove(client, `/v1/memberships/${id}`),
    noContentSchema,
    "Member removed",
  );
export const useTransferOwnership = () =>
  useApiAction(
    "members",
    (client, input: { userId: string }) =>
      post(client, "/v1/organizations/current/transfer-owner", input),
    z.object({ transferred: z.literal(true) }),
    "Ownership transferred",
  );
