import { getProfile } from "@/lib/auth";
import AccountForm from "@/components/AccountForm";

export default async function AccountPage() {
  const profile = await getProfile();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Il tuo account</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {profile.email} · ruolo: {profile.role === "manager" ? "Manager" : "Membro del team"}
        </p>
      </div>
      <AccountForm userId={profile.id} initialName={profile.full_name} />
    </div>
  );
}
