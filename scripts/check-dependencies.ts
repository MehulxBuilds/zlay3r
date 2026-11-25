import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const lock = JSON.parse(
  readFileSync(new URL("../bun.lock", import.meta.url), "utf8").replace(
    /,(\s*[}\]])/g,
    "$1",
  ),
) as {
  packages: Record<string, [string, ...unknown[]]>;
};
const versions = new Map<string, Set<string>>();
for (const [resolved] of Object.values(lock.packages)) {
  if (resolved.includes("@workspace:")) continue;
  const separator = resolved.lastIndexOf("@");
  if (separator < 1) continue;
  const name = resolved.slice(0, separator);
  const version = resolved.slice(separator + 1);
  if (version.startsWith("workspace:")) continue;
  const entries = versions.get(name) ?? new Set<string>();
  entries.add(version);
  versions.set(name, entries);
}
const declarations = new Map<string, Set<string>>();
const manifests = [
  "package.json",
  ...["apps", "packages"].flatMap((dir) =>
    readdirSync(dir)
      .map((name) => join(dir, name, "package.json"))
      .filter(existsSync),
  ),
];
for (const file of manifests) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, version] of Object.entries(pkg[field] ?? {}) as [
      string,
      string,
    ][]) {
      if (
        !version.startsWith("workspace:") &&
        !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)
      ) {
        console.error(
          `Dependency must use an exact version: ${file}: ${name}@${version}`,
        );
        process.exitCode = 1;
      }
      const entries = declarations.get(name) ?? new Set<string>();
      entries.add(version);
      declarations.set(name, entries);
    }
  }
}
const duplicates = [...versions].filter(([, entries]) => entries.size > 1);
const mismatches = [...declarations].filter(([, entries]) => entries.size > 1);
for (const [name, entries] of duplicates)
  console.error(
    `Multiple resolved versions: ${name}: ${[...entries].join(", ")}`,
  );
for (const [name, entries] of mismatches)
  console.error(`Mismatched declarations: ${name}: ${[...entries].join(", ")}`);
if (duplicates.length || mismatches.length) process.exitCode = 1;
else
  console.log(
    `Verified ${versions.size} packages: one resolved version per package; workspace declarations agree.`,
  );
