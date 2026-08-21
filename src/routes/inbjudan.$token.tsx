import { createFileRoute } from "@tanstack/react-router";
import { Home as HomeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvite, inviteDetails } from "@/lib/auth/auth.functions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>
        <div className="tile-surface p-6">
          {!invite.valid ? (
            <>
              <p className="eyebrow mb-2">Inbjudan</p>
              <p className="text-sm text-muted-foreground">
                Länken är inte längre giltig. Den kan ha använts, dragits tillbaka eller gått ut. Be
                om en ny inbjudan.
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow mb-1">Inbjudan till {invite.household}</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Skapa ditt konto för {invite.email}.
              </p>
              <form onSubmit={submit} className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Namn</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="password">Lösenord</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Minst {MIN_PASSWORD_LENGTH} tecken.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="repeat">Upprepa lösenordet</Label>
                  <Input
                    id="repeat"
                    type="password"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={busy} className="mt-1">
                  {busy ? "Skapar kontot …" : "Skapa konto"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
