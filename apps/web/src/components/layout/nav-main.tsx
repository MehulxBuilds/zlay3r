"use client";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui";
import { navigation } from "./navigation";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
export function NavMain({ admin }: { admin: boolean }) {
  const section = useWorkspaceStore((state) => state.section);
  const navigate = useWorkspaceStore((state) => state.navigate);
  const { isMobile, setOpenMobile } = useSidebar();
  return navigation.map((group) => (
    <SidebarGroup key={group.title}>
      <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
      <SidebarMenu>
        {group.items
          .filter((item) => !("admin" in item) || admin)
          .map((item) => (
            <SidebarMenuItem key={item.section}>
              <SidebarMenuButton
                isActive={section === item.section}
                tooltip={item.label}
                onClick={() => {
                  navigate(item.section);
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
      </SidebarMenu>
    </SidebarGroup>
  ));
}
