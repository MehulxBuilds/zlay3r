"use client";
import { z } from "zod";
import { sessionSchema } from "@repo/web/lib/schemas";
import {
  useApiPages,
  useApiQuery,
  useApiAction,
  noContentSchema,
} from "./core";
export const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  approvalType: z.enum(["APPROVE_FOR_ME", "ASK_FOR_APPROVAL"]),
});
export const useSessions = () =>
  useApiPages("sessions", "/v1/sessions", sessionSchema);
export const useSession = (id: string) =>
  useApiQuery("sessions", `/v1/sessions/${id}`, sessionSchema, !!id);
export const useCreateSession = () =>
  useApiAction(
    "sessions",
    (client, input: z.infer<typeof createSessionSchema>) =>
      client.createSession(input.title, input.approvalType),
    sessionSchema,
    "Session created",
  );
export const useDeleteSession = () =>
  useApiAction(
    "sessions",
    (client, id: string) => client.deleteSession(id),
    noContentSchema,
    "Session deleted",
  );

export const useUpdateSession = () =>
  useApiAction(
    "sessions",
    (client, input: z.infer<typeof createSessionSchema> & { id: string }) =>
      client.updateSession(input.id, {
        title: input.title,
        approvalType: input.approvalType,
      }),
    sessionSchema,
    "Session updated",
  );
