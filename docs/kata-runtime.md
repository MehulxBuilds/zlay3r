# Kata sandbox runtime

Zlayer defaults to `SANDBOX_RUNTIME=kata` in the single root `.env`.
The Docker provider requires a Linux Docker Engine 28+ with that registered
runtime. Missing runtimes fail before networks or containers are allocated;
creation never retries with runc. Existing sandboxes must be recreated before
agents can use the newly configured runtime.

## Host installation required

### This Windows workstation

Kata is registered on **Ubuntu WSL's native Docker Engine**, which is separate
from Docker Desktop. The native runtime uses
`/opt/kata/bin/containerd-shim-kata-qemu-v2` and the existing Kata QEMU guest
configuration. Linux Bun 1.3.5 and Node 22 are installed under
`/opt/zlayer-tools`, with executables linked in `/usr/local/bin`. The normal
Ubuntu user has Docker socket access.

Keep `SANDBOX_RUNTIME=kata`, `SANDBOX_IMAGE=zlayer-sandbox:local` and
`DOCKER_SOCKET=/var/run/docker.sock` in the single root `.env`.
Run these commands in separate Windows terminals from the repository root:

```powershell
bun run dev:backend:wsl
bun run --cwd apps/web dev
```

The backend launcher runs API and worker with Linux Node, using the source files
and root `.env` in this checkout. It checks Docker before starting either service.
Ctrl+C stops both backend services. Do not also run `bun run dev`, which would
start a second API/worker on Windows against Docker Desktop. PostgreSQL and Redis
must already be running; this launcher does not start or initialize databases.

The sandbox image was transferred into Ubuntu Docker without rebuilding. Check
the actual engine and run the agent smoke test from PowerShell:

```powershell
wsl -d Ubuntu --exec docker info --format '{{.ID}} {{.OperatingSystem}}'
wsl -d Ubuntu --exec env ESBUILD_BINARY_PATH=/opt/zlayer-tools/esbuild-0.25.12 node --import tsx apps/worker/src/smoke-sandbox-agent.ts
wsl -d Ubuntu --exec env ESBUILD_BINARY_PATH=/opt/zlayer-tools/esbuild-0.25.12 node --import tsx apps/worker/src/smoke-sandbox-image.ts
```

Docker daemon configuration was backed up before updating its runtime entry.
No separate containerd endpoint or nerdctl provider is used by Zlayer.
The launcher selects the installed Linux esbuild binary for tsx; the Windows
esbuild binary and workspace dependency versions are preserved.

### Other Linux hosts

Install Kata Containers on the **Linux host running Docker**, including its
containerd shim, guest kernel/image, and a supported hypervisor. The host must
provide usable `/dev/kvm`; a VM host needs nested virtualization enabled.
Installing an npm package or installing Kata on the Windows API client is
insufficient. Follow the installation instructions for your host distribution:

- [Kata installation](https://github.com/kata-containers/kata-containers/tree/main/docs/install)
- [Docker alternative runtimes](https://docs.docker.com/engine/daemon/alternative-runtimes/)

Merge this runtime entry into `/etc/docker/daemon.json`, preserving existing
settings. The shim must be on the Docker daemon's PATH; otherwise use its absolute
installed path as `runtimeType`.

```json
{
  "runtimes": {
    "kata": { "runtimeType": "io.containerd.kata.v2" }
  }
}
```

Restarting Docker can interrupt existing workloads. After installation and a
planned daemon restart, verify on that host:

```sh
docker info --format '{{json .Runtimes}}'
docker run --rm --runtime=kata alpine uname -r
```

These commands require a working Docker daemon; the second pulls Alpine if
missing. Registration alone does not prove KVM or guest boot works.

Then build the Zlayer image and run its agent smoke test from the repository:

```sh
bun run sandbox:build
bun run sandbox:smoke-agent
```

Restart API and worker after changing the root `.env`, and create a fresh sandbox.
Keep provider credentials on the worker; Kata does not change the private agent
supervision protocol.

## Scope and acceptance

The main sandbox explicitly selects Kata. The platform's egress proxy retains the
Docker daemon's default runtime and its existing 128 MB limit. Set the daemon's
default to runc when following this setup; do not make Kata the daemon default
without separately sizing and validating proxy VMs.

The private bridge and approved-host proxy are unchanged. Before production,
validate approved and denied egress, DNS, browser execution, exec streaming,
agent cancellation, filesystem operations, and memory/CPU enforcement on the
actual host. Existing seccomp, tmpfs and resource limits are retained and need
runtime-specific validation. The agent smoke test covers agent supervision,
shell/files, approval/resume and cancellation, not this entire acceptance list.

Kata introduces a guest kernel boundary but Docker and the worker remain trusted
host services. VM overhead must be included in host capacity planning.

The API and creation form require at least 512 MB for Kata sandboxes.
File operations execute the Python filesystem helper's bounded JSON-line stdin
protocol directly. MCP and Playwright load only when their features are used.
The provider assumes fresh sandboxes use the rebuilt image; there is no old-image
compatibility adapter. The image declares its protocol in the
`zlayer.filesystem-protocol=json-line-v1` label for inspection.
Rebuild the image and create fresh sandboxes after this protocol change. On this
Windows workstation, `bun run sandbox:build:wsl` builds directly into the native
Ubuntu Docker engine used by the backend.
