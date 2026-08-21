import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword, myAccount, updateName } from "@/lib/account.functions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { isDemo } from "@/lib/demo";

export const Route = createFileRoute("/_authenticated/konto/")({
  head: () => ({ meta: [{ title: "Mitt konto – Mitt & Ditt" }] }),
  component: AccountPage,
});

function AccountPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["my-account"],
    queryFn: () => myAccount(),
    enabled: !isDemo,
  });

  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");

  useEffect(() => {
    if (query.data?.name) setName(query.data.name);
  }, [query.data?.name]);

  const saveName = useMutation({
    mutationFn: () => updateName({ data: { name } }),
    onSuccess: () => {
      toast.success("Namnet sparat");
      void queryClient.invalidateQueries();
    },
    onError: () => toast.error("Kunde inte spara namnet."),
  });

  const savePassword = useMutation({
    mutationFn: () => changePassword({ data: { current, next } }),
    onSuccess: () => {
      toast.success("Lösenordet bytt. Andra enheter är utloggade.");
      setCurrent("");
      setNext("");
      setRepeat("");
      void queryClient.invalidateQueries({ queryKey: ["my-account"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte byta lösenord."),
  });

  if (isDemo) {
    return (
      <>
        <PageHeader eyebrow="Konto" title="Mitt konto" />
        <EmptyState title="Demoläge" hint="Kontouppgifter finns i databasen." />
      </>
    );
  }

  const account = query.data;

  return (
    <>
      <PageHeader
        eyebrow="Konto"
        title="Mitt konto"
        description="Dina uppgifter och ditt lösenord."
      />

      {!account ? (
        <EmptyState title="Hämtar kontot …" />
      ) : (
        <div className="grid gap-4">
          <section className="tile-surface p-5">
            <p className="eyebrow mb-3">Uppgifter</p>
            <dl className="grid gap-2 text-sm">
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-muted-foreground">E-post</dt>
                <dd>{account.email}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-muted-foreground">Hushåll</dt>
                <dd className="text-right">
                  {account.households.length === 0
                    ? "Inget"
                    : account.households.map((h) => `${h.name} (${h.partyId})`).join(", ")}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-muted-foreground">Inloggade enheter</dt>
                <dd className="tabular">{account.sessions}</dd>
              </div>
              {account.isAdmin && (
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-muted-foreground">Behörighet</dt>
                  <dd>
                    <Badge variant="secondary" className="text-[0.7rem]">
                      Administratör
                    </Badge>
                  </dd>
                </div>
              )}
            </dl>

            <form
              className="mt-4 grid gap-3 border-t border-hairline pt-4 sm:max-w-sm"
              onSubmit={(event) => {
                event.preventDefault();
                saveName.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="name">Namn</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Visas för din motpart och i underlagen.
                </p>
              </div>
              <Button type="submit" size="sm" disabled={saveName.isPending}>
                Spara namnet
              </Button>
            </form>
          </section>

          <section className="tile-surface p-5">
            <p className="eyebrow mb-3">Byt lösenord</p>
            <form
              className="grid gap-3 sm:max-w-sm"
              onSubmit={(event) => {
                event.preventDefault();
                if (next !== repeat) {
                  toast.error("De nya lösenorden är inte lika.");
                  return;
                }
                savePassword.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="current">Nuvarande lösenord</Label>
                <Input
                  id="current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="next">Nytt lösenord</Label>
                <Input
                  id="next"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Minst {MIN_PASSWORD_LENGTH} tecken.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="repeat">Upprepa det nya</Label>
                <Input
                  id="repeat"
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" size="sm" disabled={savePassword.isPending}>
                Byt lösenord
              </Button>
              <p className="text-xs text-muted-foreground">
                Alla andra inloggade enheter loggas ut. Den här förblir inloggad.
              </p>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
