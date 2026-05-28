import { v5, validate } from "uuid";
import dotenv from "dotenv";
dotenv.config();

// Fallback is the "DNS namespace" UUID defined in RFC 4122; any stable string
// works as a namespace, so this is just a safe default when the env var is absent.
const CLERK_UUID_NAMESPACE =
  process.env.CLERK_UUID_NAMESPACE || "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// Clerk user IDs look like "user_2abc..." — not valid UUIDs — so they can't be
// stored directly in UUID columns. We deterministically convert them with v5
// (name-based SHA-1), which always produces the same UUID for the same Clerk ID.
// Anonymous device IDs are already random UUIDs, so we pass those through as-is.
const safeFormatToUuid = (id: string): string => {
  if (validate(id)) {
    return id;
  }
  return v5(id, CLERK_UUID_NAMESPACE);
};

export { safeFormatToUuid };
