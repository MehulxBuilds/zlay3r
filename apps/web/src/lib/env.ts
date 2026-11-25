// Public browser configuration deliberately stays outside @repo/env.
export const web_env = {
  NEXT_PUBLIC_API_BASE:
    process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "",
};
