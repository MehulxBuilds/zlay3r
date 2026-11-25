import { create } from "zustand";
import { z } from "zod";

export const sectionSchema = z.enum([
  "overview",
  "sandboxes",
  "runs",
  "sessions",
  "executions",
  "browsers",
  "artifacts",
  "providers",
  "keys",
  "approvals",
  "usage",
  "settings",
  "audit",
  "activity",
  "mcp",
]);
export type Section = z.infer<typeof sectionSchema>;
interface WorkspaceState {
  organizationId: string;
  section: Section;
  sidebarOpen: boolean;
  mutationError: string | null;
  setOrganization(id: string): void;
  navigate(section: Section): void;
  setSidebarOpen(open: boolean): void;
  setMutationError(error: string | null): void;
  reset(): void;
}
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  organizationId: "",
  section: "overview",
  sidebarOpen: true,
  mutationError: null,
  setOrganization: (organizationId) =>
    set({ organizationId, section: "overview", mutationError: null }),
  navigate: (section) => set({ section, mutationError: null }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMutationError: (mutationError) => set({ mutationError }),
  reset: () =>
    set({ organizationId: "", section: "overview", mutationError: null }),
}));
