import SignupForm from "@/components/SignupForm";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <SignupForm />
    </main>
  );
}
