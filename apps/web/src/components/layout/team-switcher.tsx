"use client";
import { Box, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  Skeleton,
} from "@repo/ui";
import { useOrganizations } from "@repo/web/hooks/api/organizations";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
export function TeamSwitcher() {
  const { data, isPending } = useOrganizations();
  const selected = useWorkspaceStore((state) => state.organizationId);
  const setOrganization = useWorkspaceStore((state) => state.setOrganization);
  const { isMobile } = useSidebar();
  const active = data?.find((organization) => organization.id === selected);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="border border-sidebar-border"
              >
                <div className="grid size-8 shrink-0 place-items-center bg-primary">
                  <Box className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">
                    {active?.name ?? "Choose workspace"}
                  </span>
                  <span className="mt-1 text-xs capitalize text-muted-foreground">
                    {active?.role ?? "Workspace"}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? "bottom" : "right"}
              align="start"
              className="w-64"
            >
              <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {data?.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onSelect={() => setOrganization(organization.id)}
                >
                  <Box className="size-4" />
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === selected && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
