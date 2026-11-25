"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { WorkspaceSettings } from "./workspace-settings";
import { PolicySettings } from "./policy-settings";
import { SecretsSettings } from "./secrets-settings";
export function SettingsView({ owner }: { owner: boolean }) {
  return (
    <Tabs defaultValue="workspace">
      <TabsList className="mb-6 flex h-auto flex-wrap justify-start">
        <TabsTrigger value="workspace">Workspace & team</TabsTrigger>
        <TabsTrigger value="policy">Execution policy</TabsTrigger>
        <TabsTrigger value="secrets">Secrets & quotas</TabsTrigger>
      </TabsList>
      <TabsContent value="workspace">
        <WorkspaceSettings owner={owner} />
      </TabsContent>
      <TabsContent value="policy">
        <PolicySettings />
      </TabsContent>
      <TabsContent value="secrets">
        <SecretsSettings />
      </TabsContent>
    </Tabs>
  );
}
