"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Separator,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/ui";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { useOrganizations } from "@repo/web/hooks/api/organizations";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
import type { User } from "@repo/web/lib/schemas";
import { AppSidebar } from "@repo/web/components/layout/app-sidebar";
import { pageInfo } from "@repo/web/components/layout/navigation";
import { ErrorAlert, LoadingCards } from "@repo/web/components/shared/feedback";
import { OverviewView } from "@repo/web/features/overview/overview-view";
import { SandboxesView } from "@repo/web/features/sandboxes/sandboxes-view";
import { RunsView } from "@repo/web/features/runs/runs-view";
import { SessionsView } from "@repo/web/features/sessions/sessions-view";
import { ExecutionsView } from "@repo/web/features/executions/executions-view";
import { BrowsersView } from "@repo/web/features/browsers/browsers-view";
import { ArtifactsView } from "@repo/web/features/artifacts/artifacts-view";
import { ProvidersView } from "@repo/web/features/providers/providers-view";
import { KeysView } from "@repo/web/features/keys/keys-view";
import {
  ApprovalsView,
  UsageView,
  AuditView,
  ActivityView,
} from "@repo/web/features/governance/governance-view";
import { SettingsView } from "@repo/web/features/settings/settings-view";
import { McpView } from "@repo/web/features/mcp/mcp-view";
import { WorkspaceOnboarding } from "./workspace-onboarding";
export function Workspace({ user }: { user: User }) {
  const organizations = useOrganizations();
  const queries = useQueryClient();
  const organizationId = useWorkspaceStore((state) => state.organizationId);
  const setOrganization = useWorkspaceStore((state) => state.setOrganization);
  const section = useWorkspaceStore((state) => state.section);
  const navigate = useWorkspaceStore((state) => state.navigate);
  const sidebarOpen = useWorkspaceStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkspaceStore((state) => state.setSidebarOpen);
  const mutationError = useWorkspaceStore((state) => state.mutationError);
  const setMutationError = useWorkspaceStore((state) => state.setMutationError);
  const current = organizations.data?.find(
    (organization) => organization.id === organizationId,
  );
  const admin = current?.role === "owner" || current?.role === "admin";
  const writable = !!current && current.role !== "viewer";
  useEffect(() => {
    if (organizations.data?.length && !current)
      setOrganization(organizations.data[0]!.id);
  }, [organizations.data, current, setOrganization]);
  useEffect(() => {
    if (
      current &&
      !admin &&
      ["keys", "mcp", "audit", "settings"].includes(section)
    )
      navigate("overview");
  }, [current, admin, section, navigate]);
  if (organizations.error)
    return (
      <main className="mx-auto max-w-xl p-8">
        <ErrorAlert
          error={organizations.error}
          retry={() => void organizations.refetch()}
        />
      </main>
    );
  if (organizations.data && !organizations.data.length)
    return <WorkspaceOnboarding />;
  const info = pageInfo[section];
  const content = (() => {
    switch (section) {
      case "sandboxes":
        return <SandboxesView writable={writable} />;
      case "runs":
        return <RunsView writable={writable} />;
      case "sessions":
        return <SessionsView writable={writable} />;
      case "executions":
        return <ExecutionsView writable={writable} />;
      case "browsers":
        return <BrowsersView writable={writable} />;
      case "artifacts":
        return <ArtifactsView writable={writable} />;
      case "providers":
        return <ProvidersView admin={admin} />;
      case "keys":
        return admin ? <KeysView /> : null;
      case "approvals":
        return <ApprovalsView admin={admin} />;
      case "usage":
        return <UsageView />;
      case "settings":
        return admin ? (
          <SettingsView owner={current?.role === "owner"} />
        ) : null;
      case "audit":
        return admin ? <AuditView /> : null;
      case "activity":
        return <ActivityView />;
      case "mcp":
        return admin ? <McpView /> : null;
      default:
        return <OverviewView writable={writable} />;
    }
  })();
  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar user={user} admin={admin} />
      <SidebarInset className="min-w-0 bg-background">
        <header className="workspace-topbar">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden sm:block">
                  Workspace
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {section === "overview" ? "Overview" : info.title}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="hidden capitalize sm:inline-flex"
            >
              {current?.role ?? "Workspace"}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh workspace"
              onClick={() =>
                void queries.invalidateQueries({
                  queryKey: ["workspace", organizationId],
                })
              }
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </header>
        <main key={organizationId} className="workspace-main">
          <div className="mb-8">
            <p className="eyebrow mb-3">
              {section === "overview"
                ? "WELCOME TO YOUR LITTLE CORNER"
                : (current?.name ?? "WORKSPACE")}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {info.title}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              {info.description}
            </p>
          </div>
          {mutationError && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle />
              <AlertTitle>Action needs your attention</AlertTitle>
              <AlertDescription>
                {mutationError}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setMutationError(null)}
                >
                  <X className="size-3" />
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!current ? <LoadingCards /> : content}
          <footer className="workspace-footer">
            <span>One little pixel at a time.</span>
            <span>ZLAYER WORKSPACE</span>
          </footer>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
