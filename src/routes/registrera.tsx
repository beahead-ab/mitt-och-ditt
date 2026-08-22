import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home as HomeIcon, CircleCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register, registrationOpen } from "@/lib/auth/register.functions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * Skapa konto.
 *
 * Sidan finns även när registreringen är stängd, och säger då det rakt ut. Att
 * dölja den hade gjort läget otydligt för den som fått länken av någon annan.
 */
export const Route = createFileRoute("/registrera")({
  ssr: false,
  head: () => ({ meta: [{ title: "Skapa konto – Mitt & Ditt" }] }),
  component: RegistreraPage,
});

function RegistreraPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [skickat, setSkickat] = useState<string | null>(null);

  const öppen = useQuery({ queryKey: ["registration-open"], queryFn: () => registrationOpen() });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const svar = await register({ data: { email, name, password } });
      if (svar.slag === "stängd") {
        toast.error("Registreringen är inte öppen än.");
        void öppen.refetch();
      } else if (svar.slag === "spärrad") {
        toast.error("För många försök. Vänta en stund och försök igen.");
      } else {
        setSkickat(svar.text);
      }
    } catch {
      toast.error("Något gick fel. Försök igen.");
    } finally {
      setBusy(false);
    }
  }

  const längdOk = password.length >= MIN_PASSWORD_LENGTH;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>

        <div className="tile-surface p-6">
          {skickat ? (
            <>
              <p className="eyebrow mb-2">Kolla din e-post</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{skickat}</p>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Länken gäller ett dygn. Kolla skräpposten om det dröjer.
              </p>
            </>
          ) : öppen.data && !öppen.data.open ? (
            <>
              <p className="eyebrow mb-2">Inte öppet än</p>
              <h1 className="font-serif text-lg font-medium">Vi öppnar snart</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Tjänsten är byggd men ännu inte öppen för nya konton. Har du fått en inbjudningslänk
                fungerar den som vanligt.
              </p>
              <p className="mt-4 text-sm">
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  Till inloggningen
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow mb-1">Skapa konto</p>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                Ni är två som äger en bostad tillsammans. Du skapar kontot, sedan bjuder du in den
                andra – ingen av er kan komma igång ensam.
              </p>
              <form onSubmit={submit} className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Ditt namn</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="email">E-post</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
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
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {längdOk && <CircleCheck className="size-3.5 text-positive" />}
                    Minst {MIN_PASSWORD_LENGTH} tecken
                    {längdOk ? "" : ` – ${password.length} av ${MIN_PASSWORD_LENGTH}`}
                  </p>
                </div>
                <Button type="submit" disabled={busy || !längdOk} className="mt-1">
                  {busy ? "Skapar …" : "Skapa konto"}
                </Button>
              </form>

              <p className="mt-4 text-sm">
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  Har du redan ett konto?
                </Link>
              </p>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Tjänsten dokumenterar och räknar. Den ger inga juridiska råd och ändrar inget
                formellt ägande.{" "}
                <Link to="/integritet" className="underline underline-offset-2">
                  Så hanteras dina uppgifter
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
