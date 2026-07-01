"use server";
// requireAdmin.ts
// Server-side admin gate. Admin status is stored in Clerk `privateMetadata`
// ({ "role": "admin" }, set manually in the Clerk Dashboard) — never in the DB
// and never exposed to the browser. Read it only on the server.
//
// - isAdmin()      -> boolean; fails closed (false) for anonymous users or on any
//                     lookup error.
// - requireAdmin() -> throws if the caller is not an admin. Use at the top of
//                     admin-only server actions so each action re-checks
//                     server-side (never trust a page-level guard alone — a
//                     server action is directly callable).

import { auth, clerkClient } from "@clerk/nextjs/server";

const isAdmin = async (): Promise<boolean> => {
  try {
    const { userId } = await auth();
    // Anonymous / signed-out users can never be admins.
    if (!userId) return false;

    // clerkClient is an async factory in @clerk/nextjs v7.
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user.privateMetadata?.role === "admin";
  } catch (error) {
    // Fail closed: a lookup error must not grant access.
    console.error("isAdmin check error:", error);
    return false;
  }
};

const requireAdmin = async (): Promise<void> => {
  if (!(await isAdmin())) {
    throw new Error("FORBIDDEN: admin access required");
  }
};

export { isAdmin, requireAdmin };
