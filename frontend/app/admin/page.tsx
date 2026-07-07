import { redirect } from "next/navigation";
import { isAdmin } from "@/utils/requireAdmin";
import { AdminDashboard } from "./AdminDashboard";

const AdminPage = async () => {
  // Server-side gate: only Clerk users with privateMetadata.role === "admin"
  // may view this page. Everyone else (anonymous or non-admin) is redirected
  // home. isAdmin() fails closed, so any auth/lookup error also redirects.
  // The dashboard's data comes from /api/admin, which re-checks isAdmin()
  // itself (second checkpoint).
  if (!(await isAdmin())) redirect("/");

  return <AdminDashboard />;
};

export default AdminPage;
