"use client";
import { useCurrentUser } from "@repo/web/hooks/api/auth";
import { AuthScreen } from "@repo/web/features/auth/auth-screen";
import { Workspace } from "@repo/web/features/workspace/workspace";
import { ErrorAlert, LoadingCards } from "@repo/web/components/shared/feedback";
export default function Home() {
  const user = useCurrentUser();
  if (user.isPending)
    return (
      <main className="mx-auto max-w-6xl p-8">
        <LoadingCards />
      </main>
    );
  if (user.error)
    return (
      <main className="mx-auto max-w-xl p-8">
        <ErrorAlert error={user.error} retry={() => void user.refetch()} />
      </main>
    );
  return user.data ? <Workspace user={user.data} /> : <AuthScreen />;
}
