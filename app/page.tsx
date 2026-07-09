import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getProfile();
  redirect(profile.role === "member" ? "/dashboard" : "/team");
}
