import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Home as HomeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: next ?? "/" });
    } catch {
      toast.error("Fel e-post eller lösenord");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>
        <div className="tile-surface p-6">
          <p className="eyebrow mb-4">Logga in</p>
          <form onSubmit={signIn} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="email">E-post</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Lösenord</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={busy} className="mt-1">
              {busy ? "Loggar in …" : "Logga in"}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Tjänsten är endast för inbjudna. Kontakta administratören om du saknar konto.
          </p>
          {isDemo && (
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => navigate({ to: next ?? "/" })}
            >
              Fortsätt i demoläge
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
