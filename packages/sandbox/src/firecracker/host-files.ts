import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/** Validate configured paths as well as symlink targets before privileged use. */
export async function assertTrustedPath(target: string) {
  for (const candidate of new Set([
    path.resolve(target),
    await realpath(target),
  ])) {
    let current = candidate;
    while (true) {
      const info = await lstat(current);
      if (info.uid !== 0 || (!info.isSymbolicLink() && info.mode & 0o022)) {
        throw new Error(
          `Firecracker path must be root-owned and not group/world writable: ${current}`,
        );
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}
