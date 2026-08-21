import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listUsers, setUserDisabled } from "@/lib/admin.functions";
import { isDemo } from "@/lib/demo";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/system/anvandare")({
  head: () => ({ meta: [{ title: "Användare – Mitt & Ditt" }] }),
  component: UsersPage,
});

function UsersPage() {
  const queryClient = useQueryClient();
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

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Användare"
        description="Administratören hanterar åtkomst, aldrig parternas ekonomi."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Konton finns i databasen." />
      ) : query.isLoading ? (
        <EmptyState title="Hämtar konton …" />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState title="Inga konton" hint="Bjud in någon under Inbjudningar." />
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
                <Button
                  size="sm"
                  variant={user.disabledAt ? "default" : "outline"}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ userId: user.id, disabled: !user.disabledAt })}
                >
                  {user.disabledAt ? "Öppna kontot" : "Stäng av"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        Att stänga av ett konto avslutar också dess pågående sessioner. En avstängd användares
        registrerade poster ligger kvar oförändrade – ingenting i underlaget påverkas.
      </p>
    </>
  );
}
