import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isDemo } from "@/lib/demo";
import { useHouseholdData } from "@/hooks/use-household-data";
import { fmtAndel, fmtDateTime } from "@/lib/format";
import {
  createPartnerInvite,
  listPartnerInvites,
  revokePartnerInvite,
} from "@/lib/household.functions";

export const Route = createFileRoute("/_authenticated/overenskommelse/parter")({
  head: () => ({ meta: [{ title: "Parter – Mitt & Ditt" }] }),
  component: Pageoverenskommelseparter,
});

function Pageoverenskommelseparter() {
  const queryClient = useQueryClient();
  const { household } = useHousehold();
  const { agreement } = useHouseholdData();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [link, setLink] = useState<string | null>(null);

  // Frågan är om en plats står tom, inte vilken roll som saknas. Rollen
  // bestäms på servern ur hushållets egna två - klienten ska inte kunna välja
  // den, och kan inte heller veta vad de heter.
  //
  // Den gamla kontrollen letade efter rollnamnen 'caesar' och 'felicia'. I ett
  // hushåll med andra roller hittades ingen av dem, så formuläret visades även
  // när båda parter redan fanns - och servern avvisade med ett fel som såg ut
  // att komma från ingenstans.
  const platsLedig = (household?.parties.length ?? 0) < 2;

  const invites = useQuery({
    queryKey: ["partner-invites", household?.id],
    queryFn: () => listPartnerInvites({ data: { householdId: household!.id } }),
    enabled: !isDemo && Boolean(household),
  });

  const create = useMutation({
    mutationFn: () =>
      createPartnerInvite({
        data: { householdId: household!.id, email, displayName },
      }),
    onSuccess: (result) => {
      setLink(`${window.location.origin}/inbjudan/${result.token}`);
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["partner-invites", household?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte skapa inbjudan."),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokePartnerInvite({ data: { inviteId } }),
    onSuccess: () => {
      toast.success("Inbjudan återkallad");
      setLink(null);
      void queryClient.invalidateQueries({ queryKey: ["partner-invites", household?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte återkalla inbjudan."),
  });

  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Parter"
        description="Vilka som ingår i hushållet och hur den saknade motparten bjuds in."
      />

      {!household ? (
        <EmptyState title="Inget hushåll" hint="Administratören behöver först skapa hushållet." />
      ) : (
        <div className="grid gap-6">
          <section className="tile-surface p-5">
            <p className="eyebrow mb-3">Anslutna parter</p>
            <ul className="grid gap-2">
              {household.parties.map((party) => (
                <li
                  key={party.partyId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{party.name}</p>
                    <p className="text-xs text-muted-foreground">Partsroll {party.partyId}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Formell ägarandel hör till parten, inte till bostaden -
                        därför står den här och inte på översikten, där den tog
                        halva bredden för att visa två tankstreck. */}
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Formell ägarandel</p>
                      <p className="tabular text-sm font-medium">
                        {agreement?.formalOwnership?.[party.partyId] === undefined
                          ? "–"
                          : fmtAndel(agreement.formalOwnership[party.partyId])}
                      </p>
                    </div>
                    <Badge variant="secondary">Ansluten</Badge>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                Den formella ägarandelen följer köpehandlingen och föreningens uppgifter. Den är
                låst av avtalet och ändras bara genom giltig överlåtelse – den hålls helt åtskild
                från de interna ekonomiska andelarna. Saknas den fylls den i med startuppgifterna.
              </span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Ingen kan godkänna för den andra. Personnummer lagras inte i tjänsten.
            </p>
          </section>

          {!isDemo && platsLedig && (
            <section className="tile-surface p-5">
              <p className="eyebrow mb-1">Bjud in motparten</p>
              <h2 className="text-lg font-medium">Bjud in den andra parten</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Du kan bara bjuda in den saknade motparten till det här hushållet. Länken gäller i
                sju dagar.
              </p>

              <form
                className="mt-4 grid gap-3 sm:max-w-md"
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate();
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="partner-email">E-post</Label>
                  <Input
                    id="partner-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="partner-name">Namn</Label>
                  <Input
                    id="partner-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={create.isPending}>
                  Skapa inbjudningslänk
                </Button>
              </form>

              {link && (
                <div className="mt-4 rounded-md border border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10 p-3">
                  <p className="eyebrow">Inbjudningslänk</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Länken visas bara nu. Skicka den direkt till mottagaren.
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
          )}

          {!isDemo && (invites.data ?? []).length > 0 && (
            <section>
              <p className="eyebrow mb-3">Tidigare inbjudningar</p>
              <ul className="grid gap-2">
                {(invites.data ?? []).map((invite) => {
                  const expired = new Date(invite.expiresAt) <= new Date();
                  const open = !invite.acceptedAt && !invite.revokedAt && !expired;
                  const status = invite.acceptedAt
                    ? "Använd"
                    : invite.revokedAt
                      ? "Återkallad"
                      : expired
                        ? "Utgången"
                        : "Öppen";
                  return (
                    <li key={invite.id} className="tile-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{invite.displayName}</p>
                            <Badge variant={open ? "secondary" : "outline"}>{status}</Badge>
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">{invite.email}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Partsroll {invite.partyId} · giltig till {fmtDateTime(invite.expiresAt)}
                          </p>
                        </div>
                        {open && invite.createdByMe && (
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
            </section>
          )}
        </div>
      )}
    </>
  );
}
