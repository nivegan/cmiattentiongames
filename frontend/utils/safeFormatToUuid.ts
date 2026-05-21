import { v5, validate } from "uuid";
import dotenv from "dotenv";
dotenv.config();

const CLERK_UUID_NAMESPACE =
  process.env.CLERK_UUID_NAMESPACE || "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const safeFormatToUuid = (id: string): string => {
  if (validate(id)) {
    return id;
  }
  return v5(id, CLERK_UUID_NAMESPACE);
};

export { safeFormatToUuid };
