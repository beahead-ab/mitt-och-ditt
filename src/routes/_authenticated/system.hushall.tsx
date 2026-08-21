import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listHouseholdsAdmin, saveProperty, type AdminHousehold } from "@/lib/admin.functions";
import { isDemo } from "@/lib/demo";

export const Route = createFileRoute("/_authenticated/system/hushall")({
  head: () => ({ meta: [{ title: "Hushåll – Mitt & Ditt" }] }),
  component: HouseholdsPage,
});

function HouseholdsPage() {
  const query = useQuery({
    queryKey: ["admin-households"],
    queryFn: () => listHouseholdsAdmin(),
    enabled: !isDemo,
  });

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Hushåll"
        description="Bostadens uppgifter hör till uppsättningen. Ekonomin syns bara för parterna."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Hushåll finns i databasen." />
      ) : query.isLoading ? (
        <EmptyState title="Hämtar hushåll …" />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState title="Inga hushåll" hint="Kör seed-skriptet för att skapa det första." />
      ) : (
        <div className="grid gap-4">
          {(query.data ?? []).map((household) => (
            <HouseholdCard key={household.id} household={household} />
          ))}
        </div>
      )}
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

  return (
    <section className="tile-surface p-5">
      <p className="text-sm font-medium">{household.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {household.members.length === 0
          ? "Inga parter kopplade än"
          : household.members.map((m) => `${m.name} (${m.partyId})`).join(" · ")}
      </p>

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
