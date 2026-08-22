import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, Home as HomeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvite, inviteDetails } from "@/lib/auth/auth.functions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * Inbjudan.
 *
 * Sidan sa tidigare bara "Skapa ditt konto för nora@example.se" och visade tre
 * fält. Den som fått länken behöver veta tre saker innan hen fyller i något:
 * vem som bjudit in, till vad, och vad tjänsten gör respektive inte gör.
 */
export const Route = createFileRoute("/inbjudan/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Inbjudan – Mitt & Ditt" }] }),
  loader: ({ params }) => inviteDetails({ data: { token: params.token } }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const invite = Route.useLoaderData();
  const [name, setName] = useState(invite.valid ? invite.name : "");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      toast.error("Lösenorden är inte lika.");
      return;
    }
    setBusy(true);
    try {
      await acceptInvite({ data: { token, name, password } });
      window.location.href = "/";
    } catch {
      toast.error("Inbjudan kunde inte användas. Be om en ny länk.");
      setBusy(false);
    }
  }

  const längdOk = password.length >= MIN_PASSWORD_LENGTH;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>

        <div className="tile-surface p-6">
          {!invite.valid ? (
            <>
              <p className="eyebrow mb-2">Inbjudan</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Länken är inte längre giltig. Den kan ha använts, dragits tillbaka eller gått ut. Be
                om en ny inbjudan.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif text-[22px] font-medium leading-tight tracking-tight">
                {invite.inviter ? `${invite.inviter} har bjudit in dig` : "Du har blivit inbjuden"}{" "}
                till {invite.address ?? invite.household}
              </h1>

              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Här dokumenterar ni vad ni betalar för bostaden, godkänner varandras poster och ser
                hur det påverkar era interna andelar. Tjänsten räknar och bevarar – den ger ingen
                juridisk rådgivning och ändrar inte ert avtal.
              </p>

              <p className="mt-4 rounded-md bg-secondary p-3 text-sm leading-relaxed">
                Efter kontot: ni fyller i köpet tillsammans och godkänner samma uppgifter var för
                sig. Ingen kan starta ensam.
              </p>

              <form onSubmit={submit} className="mt-5 grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Kontot skapas för <span className="text-foreground">{invite.email}</span>
                </p>

                <div className="grid gap-1.5">
                  <Label htmlFor="name">Ditt namn</Label>
                  <Input
                    id="name"
                    className="h-10"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="password">Välj lösenord</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type="password"
                      className="h-10 pr-24"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    {password.length > 0 && (
                      <span
                        className={`absolute inset-y-0 right-3 flex items-center gap-1 text-xs ${
                          längdOk ? "text-[color:var(--positive)]" : "text-muted-foreground"
                        }`}
                      >
                        {password.length} tecken
                        {längdOk && <CircleCheck className="size-3.5" />}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Minst {MIN_PASSWORD_LENGTH} tecken. Du loggar in med e-posten ovan.
                  </p>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="repeat">Upprepa lösenordet</Label>
                  <Input
                    id="repeat"
                    type="password"
                    className="h-10"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    required
                  />
                </div>

                <Button type="submit" disabled={busy || !längdOk} className="mt-1 h-11">
                  {busy ? "Skapar kontot …" : "Skapa kontot"}
                </Button>
              </form>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Länken gäller en gång och för din e-postadress.{" "}
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
