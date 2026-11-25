export class AgentPlatformClient {
  constructor(
    private readonly options: { baseUrl: string; apiKey: string }
  ) { }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${await response.text()}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  createSandbox(input: { name?: string; memoryMb?: number; cpu?: number }) {
    return this.request("/v1/sandboxes", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  listSandboxes() {
    return this.request("/v1/sandboxes");
  }

  execute(sandboxId: string, command: string) {
    return this.request(`/v1/sandboxes/${sandboxId}/exec`, {
      method: "POST",
      body: JSON.stringify({ command })
    });
  }

  createRun(input: { sandboxId: string; task: string }) {
    return this.request("/v1/runs", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  getRun(runId: string) {
    return this.request(`/v1/runs/${runId}`);
  }

  destroySandbox(sandboxId: string) {
    return this.request(`/v1/sandboxes/${sandboxId}`, {
      method: "DELETE"
    });
  }
}
