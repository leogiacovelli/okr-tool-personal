import { getProfile } from "@/lib/auth";
import AccountForm from "@/components/AccountForm";

export default async function AccountPage() {
  const profile = await getProfile();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {profile.email} · role:{" "}
          {profile.role === "manager"
            ? "Admin"
            : profile.role === "viewer"
              ? "Viewer"
              : "Team member"}
        </p>
      </div>
      <AccountForm userId={profile.id} initialName={profile.full_name} />
    </div>
  );
}
