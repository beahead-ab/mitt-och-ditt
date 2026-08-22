import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, FileText, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMyParty } from "@/hooks/use-my-party";
import {
  confirmAddendum,
  createAddendum,
  listAddenda,
  type Tillagg,
} from "@/lib/agreement.functions";
import { isDemo } from "@/lib/demo";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/overenskommelse/tillagg")({
  head: () => ({ meta: [{ title: "Tilläggsavtal – Mitt & Ditt" }] }),
  component: TillaggPage,
});

/** Fälten som ett tillägg typiskt rör. Fri text går också bra. */
const VANLIGA_FALT = [
  "Startvärde",
  "Ursprungligt lån",
  "Startenheter",
  "Formell ägarandel",
  "Kostnadsfördelning",
];

function TillaggPage() {
  const { household } = useHousehold();
  const minPartsroll = useMyParty();
  const klient = useQueryClient();

  const query = useQuery({
    queryKey: ["addenda", household?.id],
    queryFn: () => listAddenda({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const bekrafta = useMutation({
    mutationFn: (args: { addendumId: string; sha256: string }) =>
      confirmAddendum({
        data: {
          householdId: household?.id as string,
          addendumId: args.addendumId,
          sha256: args.sha256,
        },
      }),
    onSuccess: () => {
      toast.success("Din bekräftelse är registrerad.");
      void klient.invalidateQueries();
    },
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte bekräfta tilläggsavtalet."),
  });

  const tillagg = query.data ?? [];
  const namn = Object.fromEntries((household?.parties ?? []).map((p) => [p.partyId, p.name]));

  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Tilläggsavtal"
        description="Ett tilläggsavtal skrivs under av er två utanför tjänsten. Här registrerar ni att det ska tillämpas, vad det ändrar och från när."
      />

      <p className="tile-surface mb-6 p-4 text-sm text-muted-foreground">
        Er bekräftelse här registrerar att handlingen ska tillämpas i tjänsten. Den{" "}
        <strong className="font-medium text-foreground">ersätter inte</strong> era underskrifter på
        själva tilläggsavtalet. Den nya avtalsversionen börjar gälla först när ni båda bekräftat
        samma handling.
      </p>

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Tilläggsavtal kräver databas." />
      ) : (
        <>
          {household && <NyttTillagg householdId={household.id} />}

          {tillagg.length === 0 ? (
            <EmptyState
              title="Inga tilläggsavtal än"
              hint="Har ni skrivit under ett tillägg registrerar ni det ovan."
            />
          ) : (
            <ul className="mt-6 grid gap-4">
              {tillagg.map((t) => (
                <TillaggKort
                  key={t.id}
                  tillagg={t}
                  namn={namn}
                  minPartsroll={minPartsroll}
                  arbetar={bekrafta.isPending}
                  onBekrafta={() =>
                    bekrafta.mutate({ addendumId: t.id, sha256: t.documentSha256 ?? "" })
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function NyttTillagg({ householdId }: { householdId: string }) {
  const klient = useQueryClient();
  const [titel, setTitel] = useState("");
  const [undertecknat, setUndertecknat] = useState("");
  const [gallerFran, setGallerFran] = useState("");
  const [sammanfattning, setSammanfattning] = useState("");
  const [berorda, setBerorda] = useState<string[]>([]);
  const [fil, setFil] = useState<File | null>(null);
  const [arbetar, setArbetar] = useState(false);

  async function skicka(event: React.FormEvent) {
    event.preventDefault();
    if (!fil) {
      toast.error("Bifoga den undertecknade handlingen.");
      return;
    }
    setArbetar(true);
    try {
      // Filen laddas upp först. Servern hashar den, och det är den hashen
      // parterna sedan bekräftar - aldrig något klienten räknat fram.
      const form = new FormData();
      form.append("file", fil);
      form.append("householdId", householdId);
      form.append("reference", `Tilläggsavtal: ${titel}`);
      const svar = await fetch("/api/bilaga", { method: "POST", body: form });
      if (!svar.ok) throw new Error((await svar.json()).error ?? "Uppladdningen misslyckades.");
      const { id } = (await svar.json()) as { id: string };

      await createAddendum({
        data: {
          householdId,
          title: titel,
          signedOn: undertecknat,
          appliesFrom: gallerFran,
          summary: sammanfattning,
          affected: berorda,
          attachmentId: id,
        },
      });

      toast.success("Tilläggsavtalet är registrerat. Nu ska ni båda bekräfta det.");
      setTitel("");
      setUndertecknat("");
      setGallerFran("");
      setSammanfattning("");
      setBerorda([]);
      setFil(null);
      void klient.invalidateQueries();
    } catch (fel) {
      toast.error(fel instanceof Error ? fel.message : "Kunde inte registrera tilläggsavtalet.");
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section className="tile-surface p-5">
      <p className="eyebrow mb-3">Registrera ett undertecknat tilläggsavtal</p>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={skicka}>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="titel">Vad tillägget heter</Label>
          <Input
            id="titel"
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
            maxLength={160}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="undertecknat">Undertecknat den</Label>
          <Input
            id="undertecknat"
            type="date"
            value={undertecknat}
            onChange={(e) => setUndertecknat(e.target.value)}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="galler">Gäller från</Label>
          <Input
            id="galler"
            type="date"
            value={gallerFran}
            onChange={(e) => setGallerFran(e.target.value)}
            required
          />
        </div>

        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="sammanfattning">Vad tillägget ändrar</Label>
          <Textarea
            id="sammanfattning"
            value={sammanfattning}
            onChange={(e) => setSammanfattning(e.target.value)}
            maxLength={2000}
            rows={3}
            required
          />
          <p className="text-xs text-muted-foreground">
            Skriv så att den andra parten förstår vad hen bekräftar utan att först öppna handlingen.
          </p>
        </div>

        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Berörda fält eller regler</Label>
          <div className="flex flex-wrap gap-2">
            {VANLIGA_FALT.map((falt) => {
              const vald = berorda.includes(falt);
              return (
                <Button
                  key={falt}
                  type="button"
                  size="sm"
                  variant={vald ? "default" : "outline"}
                  onClick={() =>
                    setBerorda((f) => (vald ? f.filter((x) => x !== falt) : [...f, falt]))
                  }
                >
                  {falt}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="fil">Den undertecknade handlingen (PDF)</Label>
          <Input
            id="fil"
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setFil(e.target.files?.[0] ?? null)}
            required
          />
        </div>

        <div className="sm:col-span-2">
          <Button type="submit" disabled={arbetar}>
            {arbetar ? "Registrerar …" : "Registrera tilläggsavtalet"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function TillaggKort({
  tillagg,
  namn,
  minPartsroll,
  arbetar,
  onBekrafta,
}: {
  tillagg: Tillagg;
  namn: Record<string, string>;
  minPartsroll: string | null;
  arbetar: boolean;
  onBekrafta: () => void;
}) {
  const jagHarBekraftat = minPartsroll ? tillagg.approvedBy.includes(minPartsroll) : false;
  const kanBekrafta = !tillagg.effectiveAt && Boolean(minPartsroll) && !jagHarBekraftat;
  const vantarPa = Object.keys(namn).filter((p) => !tillagg.approvedBy.includes(p));

  return (
    <li className="tile-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-serif text-base font-medium">{tillagg.title}</p>
            {tillagg.effectiveAt ? (
              <Badge>
                <Lock className="mr-1 size-3" />
                Gäller
              </Badge>
            ) : (
              <Badge variant="secondary">Väntar på bekräftelse</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Undertecknat {fmtDate(tillagg.signedOn)}
            {tillagg.appliesFrom && ` · gäller från ${fmtDate(tillagg.appliesFrom)}`} · registrerat
            av {tillagg.createdBy} {fmtDateTime(tillagg.createdAt)}
          </p>
        </div>

        {kanBekrafta && (
          <Button size="sm" disabled={arbetar} onClick={onBekrafta}>
            <Check className="mr-1.5 size-4" />
            Bekräfta
          </Button>
        )}
      </div>

      {tillagg.summary && <p className="mt-3 text-sm">{tillagg.summary}</p>}

      {tillagg.affected.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">Berör: {tillagg.affected.join(", ")}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {tillagg.attachmentId && (
          <a
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
            href={`/api/bilaga/${tillagg.attachmentId}`}
            target="_blank"
            rel="noreferrer"
          >
            <FileText className="size-3.5" />
            Läs handlingen
          </a>
        )}
        <span>
          Bekräftat av:{" "}
          {tillagg.approvedBy.length === 0
            ? "ingen ännu"
            : tillagg.approvedBy.map((p) => namn[p] ?? p).join(", ")}
        </span>
        {!tillagg.effectiveAt && vantarPa.length > 0 && (
          <span>Väntar på: {vantarPa.map((p) => namn[p] ?? p).join(", ")}</span>
        )}
        {tillagg.versionNumber !== null && (
          <span>
            Leder till avtalsversion {tillagg.versionNumber}
            {tillagg.effectiveAt ? " som nu gäller" : " när båda bekräftat"}
          </span>
        )}
      </div>

      {tillagg.documentSha256 && (
        <p className="mt-2 break-all font-mono text-[0.7rem] text-muted-foreground">
          Handlingens kontrollsumma {tillagg.documentSha256}
        </p>
      )}
    </li>
  );
}
