import {
  Activity,
  Bot,
  Box,
  Braces,
  Files,
  Globe,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  Wallet,
  ScrollText,
} from "lucide-react";
import type { Section } from "@repo/web/stores/workspace-store";
export const navigation = [
  {
    title: "Workspace",
    items: [
      { section: "overview", label: "Overview", icon: LayoutDashboard },
      { section: "sandboxes", label: "Sandboxes", icon: Box },
      { section: "runs", label: "Agent runs", icon: Bot },
      { section: "sessions", label: "Sessions", icon: MessagesSquare },
      { section: "executions", label: "Commands", icon: SquareTerminal },
      { section: "browsers", label: "Browsers", icon: Globe },
      { section: "artifacts", label: "Artifacts", icon: Files },
    ],
  },
  {
    title: "Manage",
    items: [
      { section: "providers", label: "Model providers", icon: Braces },
      { section: "approvals", label: "Approvals", icon: ShieldCheck },
      { section: "usage", label: "Usage", icon: Wallet },
      { section: "activity", label: "Activity", icon: Activity },
      { section: "keys", label: "API keys", icon: KeyRound, admin: true },
      { section: "mcp", label: "MCP connections", icon: Plug, admin: true },
      { section: "audit", label: "Audit log", icon: ScrollText, admin: true },
      { section: "settings", label: "Settings", icon: Settings2, admin: true },
    ],
  },
] satisfies {
  title: string;
  items: {
    section: Section;
    label: string;
    icon: typeof Box;
    admin?: boolean;
  }[];
}[];
export const pageInfo: Record<Section, { title: string; description: string }> =
  {
    overview: {
      title: "Your workspace, at a glance.",
      description: "A little space to build something big.",
    },
    sandboxes: {
      title: "Sandboxes",
      description: "Isolated workspaces for your next big idea.",
    },
    runs: {
      title: "Agent runs",
      description: "Give an agent a task. Follow every step.",
    },
    sessions: {
      title: "Sessions",
      description: "Keep the context. Pick up where you left off.",
    },
    executions: {
      title: "Commands",
      description: "Run commands and see exactly what happened.",
    },
    browsers: {
      title: "Browsers",
      description: "Explore the web inside an isolated workspace.",
    },
    artifacts: {
      title: "Artifacts",
      description: "The files your agents make, all in one place.",
    },
    providers: {
      title: "Model providers",
      description: "Bring your models. Build on your terms.",
    },
    keys: {
      title: "API keys",
      description: "Give your applications exactly the access they need.",
    },
    approvals: {
      title: "Approvals",
      description: "You're in control of the actions that matter.",
    },
    usage: {
      title: "Usage",
      description: "Understand what your workspace is using.",
    },
    settings: {
      title: "Workspace settings",
      description: "Your team, your rules, your workspace.",
    },
    audit: {
      title: "Audit log",
      description: "A clear record of who changed what.",
    },
    activity: {
      title: "Activity",
      description: "Sandbox and artifact activity across your workspace.",
    },
    mcp: {
      title: "MCP connections",
      description: "Connect the tools your agents need.",
    },
  };
