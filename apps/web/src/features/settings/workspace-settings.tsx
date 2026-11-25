"use client";
import { useState } from "react";
import { z } from "zod";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Badge,
} from "@repo/ui";
import { Trash2 } from "lucide-react";
import {
  useOrganizations,
  useMembers,
  useCreateOrganization,
  useRenameOrganization,
  useInviteMember,
  useAcceptInvitation,
  useUpdateMember,
  useRemoveMember,
  useTransferOwnership,
} from "@repo/web/hooks/api/organizations";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
import {
  ActionForm,
  CreateDialog,
  Field,
  ChoiceSelect,
  CredentialDialog,
} from "@repo/web/components/shared/forms";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { ErrorAlert } from "@repo/web/components/shared/feedback";
const memberRoles = [
  { value: "developer", label: "Developer" },
  { value: "viewer", label: "Viewer" },
  { value: "admin", label: "Admin" },
];
export function WorkspaceSettings({ owner }: { owner: boolean }) {
  const organizations = useOrganizations();
  const members = useMembers();
  const rename = useRenameOrganization();
  const create = useCreateOrganization();
  const invite = useInviteMember();
  const accept = useAcceptInvitation();
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const transfer = useTransferOwnership();
  const [token, setToken] = useState("");
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  const setOrganization = useWorkspaceStore((state) => state.setOrganization);
  const current = organizations.data?.find(
    (organization) => organization.id === organizationId,
  );
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
          <CardDescription>
            A familiar name for the space where you build.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            key={current?.name}
            schema={z.object({ name: z.string().trim().min(1).max(100) })}
            pending={rename.isPending}
            submit="Rename workspace"
            onSubmit={async (input) => {
              await rename.mutateAsync(input);
            }}
          >
            <Field label="Workspace name">
              <Input name="name" defaultValue={current?.name} required />
            </Field>
          </ActionForm>
          <div className="mt-6 border-t pt-6">
            <CreateDialog
              title="Create workspace"
              description="Start a separate workspace with its own team and resources."
            >
              {(close) => (
                <ActionForm
                  schema={z.object({ name: z.string().trim().min(1).max(100) })}
                  pending={create.isPending}
                  submit="Create workspace"
                  onSubmit={async (input) => {
                    const organization = await create.mutateAsync(input);
                    setOrganization(organization.id);
                    close();
                  }}
                >
                  <Field label="Name">
                    <Input name="name" required />
                  </Field>
                </ActionForm>
              )}
            </CreateDialog>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Your team</CardTitle>
            <CreateDialog
              title="Invite a teammate"
              description="Create a private invitation token to share with your teammate."
              label="Invite teammate"
            >
              {(close) => (
                <ActionForm
                  schema={z.object({
                    email: z.email(),
                    role: z.enum(["admin", "developer", "viewer"]),
                  })}
                  pending={invite.isPending}
                  submit="Create invitation"
                  onSubmit={async (input) => {
                    const result = await invite.mutateAsync(input);
                    close();
                    setToken(result.token);
                  }}
                >
                  <Field label="Email">
                    <Input name="email" type="email" required />
                  </Field>
                  <Field label="Role">
                    <ChoiceSelect
                      name="role"
                      defaultValue="developer"
                      options={memberRoles}
                    />
                  </Field>
                </ActionForm>
              )}
            </CreateDialog>
          </div>
          <CardDescription>
            Owners and admins manage access. Developers build. Viewers observe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorAlert error={members.error} />
          {members.data?.map((member) => (
            <div
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              </div>
              {member.role === "owner" ? (
                <Badge variant="secondary">Owner</Badge>
              ) : (
                <div className="flex items-center gap-2">
                  <CreateDialog
                    title="Change member role"
                    description={`Choose the access level for ${member.name}.`}
                    label={member.role}
                  >
                    {(close) => (
                      <ActionForm
                        schema={z.object({
                          role: z.enum(["admin", "developer", "viewer"]),
                        })}
                        pending={update.isPending}
                        onSubmit={async (input) => {
                          await update.mutateAsync({
                            id: member.id,
                            role: input.role,
                          });
                          close();
                        }}
                      >
                        <Field label="Role">
                          <ChoiceSelect
                            name="role"
                            defaultValue={member.role}
                            options={memberRoles}
                          />
                        </Field>
                      </ActionForm>
                    )}
                  </CreateDialog>
                  <ConfirmAction
                    title={`Remove ${member.name}?`}
                    description="This member will lose access to the workspace."
                    action={() => remove.mutateAsync(member.id)}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${member.name}`}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </ConfirmAction>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Join another workspace</CardTitle>
          <CardDescription>
            Have an invitation? Use the token shared with you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            schema={z.object({
              token: z.string().min(20, "Enter a valid invitation token"),
            })}
            pending={accept.isPending}
            submit="Accept invitation"
            onSubmit={async (input, form) => {
              await accept.mutateAsync(input);
              form.reset();
            }}
          >
            <Field label="Invitation token">
              <Input name="token" type="password" required autoComplete="off" />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
      {owner && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Transfer ownership</CardTitle>
            <CardDescription>
              Hand over ownership to a current team member. You'll become an
              admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateDialog
              title="Transfer ownership"
              description="This changes who owns the workspace. Choose carefully."
            >
              {(close) => (
                <ActionForm
                  schema={z.object({
                    userId: z.string().uuid("Choose a team member"),
                  })}
                  pending={transfer.isPending}
                  submit="Transfer ownership"
                  onSubmit={async (input) => {
                    await transfer.mutateAsync(input);
                    close();
                  }}
                >
                  <Field label="New owner">
                    <ChoiceSelect
                      name="userId"
                      options={
                        members.data
                          ?.filter((member) => member.role !== "owner")
                          .map((member) => ({
                            value: member.userId,
                            label: `${member.name} (${member.email})`,
                          })) ?? []
                      }
                    />
                  </Field>
                </ActionForm>
              )}
            </CreateDialog>
          </CardContent>
        </Card>
      )}
      <CredentialDialog
        title="Private invitation token"
        value={token}
        onClose={() => setToken("")}
      />
    </div>
  );
}
