import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Home as HomeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completePasswordReset, resetTokenStatus } from "@/lib/auth/reset.functions";

export const Route = createFileRoute("/aterstall/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Nytt lösenord – Mitt & Ditt" }] }),
  component: AterstallPage,
});

/** Samma krav som när kontot skapas. */
const MINSTA_LANGD = 8;

function AterstallPage() {
  const { token } = Route.useParams();
  const [losenord, setLosenord] = useState("");
  const [upprepa, setUpprepa] = useState("");
  const [busy, setBusy] = useState(false);
  const [klar, setKlar] = useState(false);

  // Länken kontrolleras innan formuläret visas, så att den som följt en
  // förbrukad länk får veta det direkt i stället för efter att ha skrivit.
  const status = useQuery({
    queryKey: ["reset-token", token],
    queryFn: () => resetTokenStatus({ data: { token } }),
    retry: false,
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (losenord !== upprepa) {
      toast.error("Lösenorden är inte lika.");
      return;
    }
    setBusy(true);
    try {
      await completePasswordReset({ data: { token, password: losenord } });
      setKlar(true);
    } catch (fel) {
      toast.error(fel instanceof Error ? fel.message : "Det gick inte att byta lösenord.");
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
          {status.isPending ? (
            <p className="text-sm text-muted-foreground">Kontrollerar länken …</p>
          ) : klar ? (
            <>
              <h1 className="mb-1 font-serif text-lg font-medium">Lösenordet är bytt</h1>
              <p className="mb-5 text-sm text-muted-foreground">
                Alla andra inloggningar har avslutats. Logga in med det nya lösenordet.
              </p>
              <Button asChild className="w-full">
                <Link to="/auth">Logga in</Link>
              </Button>
            </>
          ) : !status.data?.valid ? (
            <>
              <h1 className="mb-1 font-serif text-lg font-medium">Länken gäller inte</h1>
              <p className="mb-5 text-sm text-muted-foreground">
                Den kan vara använd, ersatt av en nyare eller för gammal. Begär en ny så skickar vi
                en färsk.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/glomt">Begär en ny länk</Link>
              </Button>
            </>
          ) : (
            <>
              <h1 className="mb-1 font-serif text-lg font-medium">Välj ett nytt lösenord</h1>
              <p className="mb-5 text-sm text-muted-foreground">
                Minst {MINSTA_LANGD} tecken. Alla andra inloggningar avslutas när du sparar.
              </p>
              <form className="grid gap-4" onSubmit={submit}>
                <div className="grid gap-1.5">
                  <Label htmlFor="losenord">Nytt lösenord</Label>
                  <Input
                    id="losenord"
                    type="password"
                    autoComplete="new-password"
                    minLength={MINSTA_LANGD}
                    value={losenord}
                    onChange={(e) => setLosenord(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upprepa">Upprepa</Label>
                  <Input
                    id="upprepa"
                    type="password"
                    autoComplete="new-password"
                    minLength={MINSTA_LANGD}
                    value={upprepa}
                    onChange={(e) => setUpprepa(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={busy} className="mt-1">
                  {busy ? "Sparar …" : "Spara lösenordet"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
