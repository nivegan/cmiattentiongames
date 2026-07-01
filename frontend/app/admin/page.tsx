import { redirect } from "next/navigation";
import { isAdmin } from "@/utils/requireAdmin";

const AdminPage = async () => {
  // Server-side gate: only Clerk users with privateMetadata.role === "admin"
  // may view this page. Everyone else (anonymous or non-admin) is redirected
  // home. isAdmin() fails closed, so any auth/lookup error also redirects.
  if (!(await isAdmin())) redirect("/");

  return <div>Admin Page</div>;
};

export default AdminPage;
