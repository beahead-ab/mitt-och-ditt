import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { HouseholdProvider } from "@/components/household-context";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_USER, isDemo } from "@/lib/demo";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (isDemo) {
      return { user: { id: DEMO_USER.id, email: DEMO_USER.email } };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { next: location.href } });
    }
    return { user: { id: data.user.id, email: data.user.email ?? null } };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <HouseholdProvider userId={user.id}>
      <AppShell>
        <Outlet />
      </AppShell>
    </HouseholdProvider>
  );
}
