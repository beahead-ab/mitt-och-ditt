import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { KraverAdmin } from "@/components/kraver-admin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUser, deleteUser, listUsers, setUserDisabled } from "@/lib/admin.functions";
import { isDemo } from "@/lib/demo";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/system/anvandare")({
  head: () => ({ meta: [{ title: "Användare – Mitt & Ditt" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { isAdmin } = useHousehold();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const query = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listUsers(),
    enabled: !isDemo,
  });

  const toggle = useMutation({
    mutationFn: (payload: { userId: string; disabled: boolean }) =>
      setUserDisabled({ data: payload }),
    onSuccess: (_result, payload) => {
      toast.success(payload.disabled ? "Kontot avstängt" : "Kontot öppnat");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte ändra kontot."),
  });

  const create = useMutation({
    mutationFn: () => createUser({ data: { name, email } }),
    onSuccess: () => {
      toast.success("Kontot skapat. En aktiveringslänk har köats till adressen.");
      setName("");
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte skapa kontot."),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => deleteUser({ data: { userId } }),
    onSuccess: () => {
      toast.success("Kontot borttaget");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-households"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte ta bort kontot."),
  });

  // Efter sidans hooks, annars bryts hook-reglerna.
  if (!isAdmin) return <KraverAdmin titel="Användare" />;

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Användare"
        description="Administratören hanterar åtkomst, aldrig parternas ekonomi."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Konton finns i databasen." />
      ) : (
        <section className="tile-surface mb-6 p-5">
          <p className="eyebrow mb-3">Lägg till användare</p>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="new-user-name">Namn</Label>
              <Input
                id="new-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-user-email">E-post</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">
                Kontot skapas utan lösenord. Personen får en aktiveringslänk på mail och väljer sitt
                lösenord själv – du ska aldrig känna till någon annans. Anslut kontot till ett
                hushåll via Inbjudningar.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>
                Skapa konto
              </Button>
            </div>
          </form>
        </section>
      )}

      {!isDemo &&
        (query.isLoading ? (
          <EmptyState title="Hämtar konton …" />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState title="Inga konton" />
        ) : (
          <ul className="grid gap-2">
            {(query.data ?? []).map((user) => (
              <li key={user.id} className="tile-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{user.name}</p>
                      {user.isAdmin && (
                        <Badge variant="secondary" className="text-[0.7rem]">
                          Administratör
                        </Badge>
                      )}
                      {user.disabledAt && (
                        <Badge variant="destructive" className="text-[0.7rem]">
                          Avstängd
                        </Badge>
                      )}
                      {!user.hasPassword && (
                        <Badge variant="outline" className="text-[0.7rem]">
                          Har inte skapat lösenord
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{user.email}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Konto sedan {fmtDate(user.createdAt)}
                      {user.households.length > 0 ? ` · ${user.households.join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={user.disabledAt ? "default" : "outline"}
                      disabled={toggle.isPending || (user.isSelf && !user.disabledAt)}
                      onClick={() => toggle.mutate({ userId: user.id, disabled: !user.disabledAt })}
                    >
                      {user.disabledAt ? "Öppna kontot" : "Stäng av"}
                    </Button>
                    {user.isSelf ? (
                      <Button size="sm" variant="outline" disabled>
                        Ditt adminkonto
                      </Button>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive" disabled={remove.isPending}>
                            Ta bort
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Ta bort {user.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Kontot tas bort permanent. Om det har avtals- eller ekonomihistorik
                              stoppas raderingen och kontot behöver stängas av i stället.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Avbryt</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => remove.mutate(user.id)}
                            >
                              Ta bort kontot
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ))}

      <p className="mt-6 text-sm text-muted-foreground">
        Ditt eget administratörskonto kan aldrig stängas av eller tas bort här. Att stänga av ett
        annat konto avslutar dess pågående sessioner men bevarar allt underlag.
      </p>
    </>
  );
}
