"use client";
import { z } from "zod";
import { CardContent, CardHeader, CardTitle, Input } from "@repo/ui";
import {
  useCreateOrganization,
  useAcceptInvitation,
} from "@repo/web/hooks/api/organizations";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
import { ActionForm, Field } from "@repo/web/components/shared/forms";
import { PixelCard } from "@repo/web/components/shared/feedback";
export function WorkspaceOnboarding() {
  const create = useCreateOrganization();
  const accept = useAcceptInvitation();
  const select = useWorkspaceStore((state) => state.setOrganization);
  return (
    <main className="mx-auto grid min-h-svh max-w-xl content-center gap-6 p-6">
      <PixelCard>
        <CardHeader>
          <CardTitle className="text-2xl">
            Make yourself a little space.
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            schema={z.object({ name: z.string().trim().min(1).max(100) })}
            pending={create.isPending}
            submit="Create workspace"
            onSubmit={async (input) => {
              const organization = await create.mutateAsync(input);
              select(organization.id);
            }}
          >
            <Field label="Workspace name">
              <Input name="name" required placeholder="My workspace" />
            </Field>
          </ActionForm>
          <div className="mt-8 border-t pt-6">
            <ActionForm
              schema={z.object({ token: z.string().min(20) })}
              pending={accept.isPending}
              submit="Accept invitation"
              onSubmit={async (input) => {
                await accept.mutateAsync(input);
              }}
            >
              <Field label="Or join with an invitation">
                <Input name="token" type="password" autoComplete="off" />
              </Field>
            </ActionForm>
          </div>
        </CardContent>
      </PixelCard>
    </main>
  );
}
