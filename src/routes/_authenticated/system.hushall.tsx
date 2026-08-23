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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createHousehold,
  deleteHousehold,
  listHouseholdsAdmin,
  saveProperty,
  type AdminHousehold,
} from "@/lib/admin.functions";
import { isDemo } from "@/lib/demo";

export const Route = createFileRoute("/_authenticated/system/hushall")({
  head: () => ({ meta: [{ title: "Hushåll – Mitt & Ditt" }] }),
  component: HouseholdsPage,
});

function HouseholdsPage() {
  const { isAdmin } = useHousehold();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const query = useQuery({
    queryKey: ["admin-households"],
    queryFn: () => listHouseholdsAdmin(),
    enabled: !isDemo,
  });

  const create = useMutation({
    mutationFn: () => createHousehold({ data: { name } }),
    onSuccess: () => {
      toast.success("Hushållet skapat");
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["admin-households"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte skapa hushållet."),
  });

  // Efter sidans hooks, annars bryts hook-reglerna.
  if (!isAdmin) return <KraverAdmin titel="Hushåll" />;

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Hushåll"
        description="Bostadens uppgifter hör till uppsättningen. Ekonomin syns bara för parterna."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Hushåll finns i databasen." />
      ) : (
        <section className="tile-surface mb-6 p-5">
          <p className="eyebrow mb-3">Lägg till hushåll</p>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="new-household-name">Namn</Label>
              <Input
                id="new-household-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Exempelvis Caesar & Felicia"
                required
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Skapa hushåll
            </Button>
          </form>
        </section>
      )}

      {!isDemo &&
        (query.isLoading ? (
          <EmptyState title="Hämtar hushåll …" />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState title="Inga hushåll" hint="Skapa det första hushållet ovan." />
        ) : (
          <div className="grid gap-4">
            {(query.data ?? []).map((household) => (
              <HouseholdCard key={household.id} household={household} />
            ))}
          </div>
        ))}

      <p className="mt-6 text-sm text-muted-foreground">
        Ett tomt hushåll kan tas bort permanent. Finns godkända avtal, ekonomiska poster eller
        revisionshistorik bevaras hushållet och raderingen stoppas.
      </p>
    </>
  );
}

function HouseholdCard({ household }: { household: AdminHousehold }) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState(household.address ?? "");
  const [association, setAssociation] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");

  const save = useMutation({
    mutationFn: () =>
      saveProperty({
        data: {
          householdId: household.id,
          address,
          association: association || undefined,
          apartmentNumber: apartmentNumber || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Bostadens uppgifter sparade");
      void queryClient.invalidateQueries({ queryKey: ["admin-households"] });
      void queryClient.invalidateQueries({ queryKey: ["households"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara."),
  });

  const remove = useMutation({
    mutationFn: () => deleteHousehold({ data: { householdId: household.id } }),
    onSuccess: () => {
      toast.success("Hushållet borttaget");
      void queryClient.invalidateQueries({ queryKey: ["admin-households"] });
      void queryClient.invalidateQueries({ queryKey: ["households"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte ta bort hushållet."),
  });

  return (
    <section className="tile-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{household.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {household.members.length === 0
              ? "Inga parter kopplade än"
              : household.members.map((m) => `${m.name} (${m.partyId})`).join(" · ")}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={remove.isPending}>
              Ta bort
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ta bort {household.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Ett tomt hushåll tas bort permanent. Om det finns skyddad historik stoppas
                raderingen automatiskt.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Avbryt</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => remove.mutate()}
              >
                Ta bort hushållet
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <form
        className="mt-4 grid gap-4 border-t border-hairline pt-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor={`address-${household.id}`}>Adress</Label>
          <Input
            id={`address-${household.id}`}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`association-${household.id}`}>Bostadsrättsförening</Label>
          <Input
            id={`association-${household.id}`}
            value={association}
            onChange={(event) => setAssociation(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`apartment-${household.id}`}>Lägenhetsnummer</Label>
          <Input
            id={`apartment-${household.id}`}
            value={apartmentNumber}
            onChange={(event) => setApartmentNumber(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            Spara bostadens uppgifter
          </Button>
        </div>
      </form>
    </section>
  );
}
