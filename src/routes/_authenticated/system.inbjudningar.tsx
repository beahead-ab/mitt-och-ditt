import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInvite,
  listHouseholdsAdmin,
  listInvites,
  revokeInvite,
} from "@/lib/admin.functions";
import { isDemo } from "@/lib/demo";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/system/inbjudningar")({
  head: () => ({ meta: [{ title: "Inbjudningar – Mitt & Ditt" }] }),
  component: InvitesPage,
});

function InvitesPage() {
  const queryClient = useQueryClient();
  const [householdId, setHouseholdId] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [partyId, setPartyId] = useState("");
  /** Länken visas en enda gång; bara hashen sparas. */
  const [link, setLink] = useState<string | null>(null);

  const households = useQuery({
    queryKey: ["admin-households"],
    queryFn: () => listHouseholdsAdmin(),
    enabled: !isDemo,
  });
  const invites = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => listInvites(),
    enabled: !isDemo,
  });

  const create = useMutation({
    mutationFn: () => createInvite({ data: { householdId, email, displayName, partyId } }),
    onSuccess: (result) => {
      setLink(`${window.location.origin}/inbjudan/${result.token}`);
      setEmail("");
      setDisplayName("");
      setPartyId("");
      void queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte skapa inbjudan."),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite({ data: { inviteId } }),
    onSuccess: () => {
      toast.success("Inbjudan återkallad");
      void queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: () => toast.error("Kunde inte återkalla inbjudan."),
  });

  function statusOf(invite: {
    acceptedAt: string | null;
    revokedAt: string | null;
    expiresAt: string;
  }) {
    if (invite.acceptedAt) return { label: "Använd", variant: "default" as const };
    if (invite.revokedAt) return { label: "Återkallad", variant: "outline" as const };
    if (new Date(invite.expiresAt) <= new Date())
      return { label: "Utgången", variant: "outline" as const };
    return { label: "Öppen", variant: "secondary" as const };
  }

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Inbjudningar"
        description="Tjänsten är endast för inbjudna. Ingen öppen registrering finns."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Inbjudningar kräver databas." />
      ) : (
        <>
          <section className="tile-surface mb-6 p-5">
            <p className="eyebrow mb-3">Ny inbjudan</p>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="household">Hushåll</Label>
                <Select value={householdId} onValueChange={setHouseholdId}>
                  <SelectTrigger id="household">
                    <SelectValue placeholder="Välj hushåll" />
                  </SelectTrigger>
                  <SelectContent>
                    {(households.data ?? []).map((household) => (
                      <SelectItem key={household.id} value={household.id}>
                        {household.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">E-post</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="displayName">Namn</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="partyId">Partsroll</Label>
                <Input
                  id="partyId"
                  value={partyId}
                  onChange={(event) => setPartyId(event.target.value.toLowerCase())}
                  placeholder="caesar"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Stabilt ID som beräkningen använder. Ändras aldrig efteråt.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!householdId || create.isPending}>
                  Skapa inbjudan
                </Button>
              </div>
            </form>

            {link && (
              <div className="mt-4 rounded-md border border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10 p-3">
                <p className="eyebrow">Inbjudningslänk</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Länken visas en enda gång. Bara dess hash sparas, så den går inte att hämta fram
                  igen. Skicka den till mottagaren nu.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-secondary px-2 py-1 text-xs">
                    {link}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        toast.success("Länken kopierad");
                      } catch {
                        toast.error("Kunde inte kopiera.");
                      }
                    }}
                  >
                    <Copy className="mr-1.5 size-3.5" /> Kopiera
                  </Button>
                </div>
              </div>
            )}
          </section>

          <p className="eyebrow mb-3">Inbjudningar</p>
          {(invites.data ?? []).length === 0 ? (
            <EmptyState title="Inga inbjudningar än" />
          ) : (
            <ul className="grid gap-2">
              {(invites.data ?? []).map((invite) => {
                const status = statusOf(invite);
                const open = status.label === "Öppen";
                return (
                  <li key={invite.id} className="tile-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{invite.displayName}</p>
                          <Badge variant={status.variant} className="text-[0.7rem]">
                            {status.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{invite.email}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {invite.household} · partsroll {invite.partyId} · giltig till{" "}
                          {fmtDateTime(invite.expiresAt)}
                        </p>
                      </div>
                      {open && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(invite.id)}
                        >
                          Återkalla
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
