import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { HouseholdProvider } from "@/components/household-context";
import { currentUser } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const user = await currentUser();
    if (!user) {
      throw redirect({ to: "/auth", search: { next: location.href } });
    }
    return { user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <HouseholdProvider userId={user.id} isAdmin={user.isAdmin} emailVerified={user.emailVerified}>
      <AppShell>
        <Outlet />
      </AppShell>
    </HouseholdProvider>
  );
}
