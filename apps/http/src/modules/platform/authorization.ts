import type { FastifyRequest } from "fastify";
import {
  and,
  db,
  eq,
  membership,
  apiKey,
  can,
  tokenDigest,
  gt,
  isNull,
  or,
} from "@repo/db";
import type { AuthService } from "../auth/auth.service";
import { getToken } from "../auth/auth.routes";
import { HttpError } from "../../lib/errors";

declare module "fastify" {
  interface FastifyRequest {
    platformRole: string;
    apiScopes?: string[];
  }
}
export function authorize(request: FastifyRequest, permission: string) {
  if (
    !can(request.platformRole, permission) ||
    (request.apiScopes && !request.apiScopes.includes(permission))
  )
    throw new HttpError(403, "PERMISSION_DENIED");
}
export function platformAuthentication(auth: AuthService) {
  return async (request: FastifyRequest) => {
    const token = getToken(request);
    if (token?.startsWith("zk_")) {
      const [key] = await db
        .select()
        .from(apiKey)
        .where(
          and(
            eq(apiKey.keyHash, tokenDigest(token)),
            isNull(apiKey.revokedAt),
            or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, new Date())),
          ),
        )
        .limit(1);
      if (!key) throw new HttpError(401, "UNAUTHORIZED");
      request.user = {
        id: key.id,
        organizationId: key.organizationId,
        name: key.name,
        email: "",
      };
      request.platformRole = "developer";
      request.apiScopes = key.scopes;
      return;
    }
    request.user = await auth.authenticate(token);
    if (
      ["/v1/organizations", "/v1/invitations/accept"].includes(
        request.routeOptions.url ?? "",
      )
    ) {
      request.platformRole = "viewer";
      return;
    }
    const org = request.headers["x-organization-id"];
    if (org && typeof org !== "string")
      throw new HttpError(400, "INVALID_ORGANIZATION");
    const organizationId = org || request.user.organizationId;
    const [member] = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userId, request.user.id),
          eq(membership.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!member) throw new HttpError(403, "ORGANIZATION_ACCESS_DENIED");
    request.user = { ...request.user, organizationId };
    request.platformRole = member.role;
  };
}
