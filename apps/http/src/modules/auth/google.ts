import { OAuth2Client } from "google-auth-library";
import { server_env as env } from "@repo/env";
import { HttpError } from "../../lib/errors";
import type { GoogleVerifier } from "./auth.service";

const google = new OAuth2Client();
export const verifyGoogle: GoogleVerifier = async (credential) => {
  if (!env.GOOGLE_CLIENT_ID)
    throw new HttpError(503, "GOOGLE_AUTH_NOT_CONFIGURED");
  try {
    const ticket = await google.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified)
      throw new Error("Unverified Google identity");
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name,
    };
  } catch {
    throw new HttpError(401, "INVALID_GOOGLE_CREDENTIAL");
  }
};
