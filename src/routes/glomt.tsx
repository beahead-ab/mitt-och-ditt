import { createFileRoute, Link } from "@tanstack/react-router";
import { Home as HomeIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth/reset.functions";

export const Route = createFileRoute("/glomt")({
  ssr: false,
  head: () => ({ meta: [{ title: "Glömt lösenordet – Mitt & Ditt" }] }),
  component: GlomtPage,
});

function GlomtPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [svar, setSvar] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const resultat = await requestPasswordReset({ data: { email } });
      setSvar(resultat.message);
    } catch {
      // Även ett oväntat fel besvaras likadant. Skillnader i svar är just det
      // som gör ett sådant här formulär till ett sätt att kartlägga konton.
      setSvar(
        "Om adressen har ett konto har vi skickat en länk dit. Kolla skräpposten om det dröjer.",
      );
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
          <h1 className="mb-1 font-serif text-lg font-medium">Glömt lösenordet</h1>
          <p className="mb-5 text-sm text-muted-foreground">
            Skriv din e-postadress så skickar vi en länk för att välja ett nytt.
          </p>

          {svar ? (
            <>
              <p className="rounded-md border border-[var(--hairline)] bg-muted/40 p-3 text-sm">
                {svar}
              </p>
              <p className="mt-4 text-sm">
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  Tillbaka till inloggningen
                </Link>
              </p>
            </>
          ) : (
            <form className="grid gap-4" onSubmit={submit}>
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
              <Button type="submit" disabled={busy} className="mt-1">
                {busy ? "Skickar …" : "Skicka länk"}
              </Button>
              <p className="text-sm">
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  Tillbaka till inloggningen
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
