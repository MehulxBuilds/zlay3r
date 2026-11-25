# Local MCP

Run the platform HTTP API. Put `MCP_API_KEY` in the ignored
`env/.env.development.local` file, or supply it through the MCP client's process
environment. The key needs `mcp.execute` and each desired operation's scopes.
Set `MCP_API_BASE` if the platform API is not at `http://localhost:3001`.

Configure an MCP client to launch Node with the repository's `tsx` loader:

```json
{
  "mcpServers": {
    "zlayer": {
      "command": "node",
      "args": ["--import", "tsx", "packages/local-mcp/src/index.ts"],
      "cwd": "/absolute/path/to/zlayer",
      "env": { "MCP_API_KEY": "<platform-api-key>" }
    }
  }
}
```

Alternatively run `bun run --cwd packages/local-mcp start` from the repository.
The official SDK v2 stdio transport reserves stdout for protocol traffic. Local
and remote servers share the same catalog and authenticated API boundary.
Credentials and tenant IDs are never tool arguments. No host shell tools are
registered, and no local Docker access is needed.
