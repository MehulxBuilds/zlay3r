"use client";
// Adapted from the official shadcn sidebar-07 block. Primitives stay in @repo/ui.
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  Separator,
} from "@repo/ui";
import type { User } from "@repo/web/lib/schemas";
import { TeamSwitcher } from "./team-switcher";
import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
export function AppSidebar({ user, admin }: { user: User; admin: boolean }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="brand-lockup px-2 py-5 group-data-[collapsible=icon]:justify-center">
          <span className="brand-emblem">z</span>
          <span className="group-data-[collapsible=icon]:hidden">
            zlayer
            <span className="ml-2 text-[10px] font-medium tracking-wider text-muted-foreground">
              WORKSPACE
            </span>
          </span>
        </div>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain admin={admin} />
      </SidebarContent>
      <SidebarFooter>
        <Separator />
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
