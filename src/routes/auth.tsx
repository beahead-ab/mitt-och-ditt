import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Home as HomeIcon } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { isDemo } from "@/lib/demo";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({ meta: [{ title: "Logga in – Mitt & Ditt" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>
        <div className="tile-surface p-6">
          <p className="eyebrow mb-3">Logga in</p>
          <p className="text-sm text-muted-foreground">
            Tjänsten är endast för inbjudna. Inloggning med konto kopplas in när databasen är på
            plats.
          </p>
          {isDemo ? (
            <Button className="mt-5 w-full" onClick={() => navigate({ to: next ?? "/" })}>
              Fortsätt i demoläge
            </Button>
          ) : (
            <p className="mt-5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
              Starta med <code className="font-mono">VITE_DEMO=1</code> för att se gränssnittet med
              exempeldata.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
