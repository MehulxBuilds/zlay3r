import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { server_env as env } from "@repo/env";
export type Role = "owner" | "admin" | "developer" | "viewer";
export function can(role: string, permission: string) {
  if (role === "developer" && permission === "secrets.use") return true;
  if (role === "owner") return true;
  if (role === "admin")
    return (
      permission !== "organization.delete" && permission !== "owner.manage"
    );
  if (role === "viewer") return permission.endsWith(".read");
  return (
    role === "developer" &&
    [
      "sandbox",
      "execution",
      "files",
      "artifacts",
      "runs",
      "sessions",
      "browser",
      "tools",
      "models",
      "events",
      "mcp",
    ].includes(permission.split(".")[0]!) &&
    !permission.endsWith(".admin")
  );
}
export const tokenDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function encrypt(value: string, organizationId: string) {
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY_NOT_CONFIGURED");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(organizationId));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string, organizationId: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data)
    throw new Error("INVALID_ENCRYPTED_SECRET");
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY_NOT_CONFIGURED");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(organizationId));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64url")),
    cipher.final(),
  ]).toString();
}
