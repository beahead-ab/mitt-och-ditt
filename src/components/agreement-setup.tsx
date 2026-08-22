import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyField } from "@/components/money-field";
import { tolkaBelopp } from "@/lib/belopp";
import { Label } from "@/components/ui/label";
import { createInitialAgreementDraft, pendingAgreement } from "@/lib/agreement.functions";
import { toKronor } from "@/lib/engine";
import { fmtKr } from "@/lib/format";

/** Tomt fält är inte noll. Se lib/belopp.ts. */
function asNumber(value: string): number {
  return tolkaBelopp(value) ?? Number.NaN;
}

/** Gemensam uppstart: parterna fyller själva i alla bostads- och startvärden. */
export function AgreementSetup() {
  const { household } = useHousehold();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [association, setAssociation] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startValue, setStartValue] = useState("");
  const [initialLoan, setInitialLoan] = useState("");
  // Nycklade på partsroll, inte på namn: hushållets två roller kan heta vad
  // som helst, och gör det för alla par utom det första.
  const [capital, setCapital] = useState<Record<string, string>>({});
  const [formal, setFormal] = useState<Record<string, string>>({});

  // Sorterad så ordningen i formuläret blir densamma vid varje rendering.
  const parties = useMemo(
    () => [...(household?.parties ?? [])].sort((x, y) => x.partyId.localeCompare(y.partyId)),
    [household],
  );

  const draftQuery = useQuery({
    queryKey: ["pending-agreement", household?.id],
    queryFn: () => pendingAgreement({ data: { householdId: household!.id } }),
    enabled: Boolean(household),
  });
  const draft = draftQuery.data;

  useEffect(() => {
    if (!household) return;
    setAddress(household.propertyAddress ?? "");
    setAssociation(household.propertyAssociation ?? "");
    setApartmentNumber(household.apartmentNumber ?? "");
  }, [household]);

  useEffect(() => {
    if (!draftQuery.isFetched) return;
    if (!draft) {
      setEditing(true);
      return;
    }
    setStartDate(draft.startDate);
    setStartValue(String(toKronor(draft.startValue)));
    setInitialLoan(String(toKronor(draft.initialLoan)));
    setCapital(
      Object.fromEntries(
        parties.map((party) => [party.partyId, String(draft.startUnits[party.partyId] ?? "")]),
      ),
    );
    setFormal(
      Object.fromEntries(
        parties.map((party) => {
          const andel = draft.formalOwnership?.[party.partyId];
          return [party.partyId, andel === undefined ? "" : String(andel * 100)];
        }),
      ),
    );
  }, [draft, draftQuery.isFetched, parties]);

  const values = useMemo(() => {
    const tal = (karta: Record<string, string>) =>
      Object.fromEntries(
        parties.map((party) => [party.partyId, asNumber(karta[party.partyId] ?? "")]),
      );
    return {
      startValue: asNumber(startValue),
      initialLoan: asNumber(initialLoan),
      capitalKrByParty: tal(capital),
      formalPercentByParty: tal(formal),
    };
  }, [startValue, initialLoan, capital, formal, parties]);

  const netEquity = values.startValue - values.initialLoan;
  const capitalBelopp = Object.values(values.capitalKrByParty);
  const formalTal = Object.values(values.formalPercentByParty);
  const capitalTotal = capitalBelopp.reduce((a, b) => a + b, 0);
  const financingMatches =
    capitalBelopp.every(Number.isFinite) &&
    Number.isFinite(netEquity) &&
    netEquity > 0 &&
    netEquity === capitalTotal;
  const ownershipMatches =
    formalTal.every(Number.isFinite) &&
    Math.abs(formalTal.reduce((a, b) => a + b, 0) - 100) < 0.000001;

  const save = useMutation({
    mutationFn: () =>
      createInitialAgreementDraft({
        data: {
          householdId: household!.id,
          address,
          association: association || undefined,
          apartmentNumber: apartmentNumber || undefined,
          startDate,
          startValueKr: values.startValue,
          initialLoanKr: values.initialLoan,
          capitalKrByParty: values.capitalKrByParty,
          formalPercentByParty: values.formalPercentByParty,
        },
      }),
    onSuccess: (result) => {
      toast.success(`Avtalsutkast version ${result.version} sparat`);
      setEditing(false);
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara uppgifterna."),
  });

  if (!household) return null;
  // Två anslutna parter, vilka de än är. Motorn räknar på exakt två.
  const hasBothParties = parties.length === 2;

  if (!hasBothParties) {
    return (
      <section className="tile-surface p-5">
        <p className="eyebrow">Nästa steg</p>
        <h2 className="mt-1 text-lg font-medium">Bjud in motparten först</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Startuppgifterna öppnas när båda parter har skapat sina konton. Ingen av er kan ensam göra
          ett avtalsutkast gällande.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/overenskommelse/parter">Gå till Parter</Link>
        </Button>
      </section>
    );
  }

  if (draft && !editing) {
    return (
      <section className="tile-surface mt-4 p-5">
        <p className="eyebrow">Behöver något rättas?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Skapa en korrigerad version innan avtalet börjar gälla. Tidigare godkännanden följer inte
          med; båda måste granska den nya versionen på nytt.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(true)}>
          Ändra startuppgifterna
        </Button>
      </section>
    );
  }

  return (
    <section className="tile-surface mt-4 p-5">
      <p className="eyebrow">{draft ? "Korrigerat utkast" : "Gemensam uppstart"}</p>
      <h2 className="mt-1 text-lg font-medium">Fyll i bostaden och startvärdena</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Den som fyller i skapar bara ett utkast. Ingenting börjar gälla förrän båda parter har
        kontrollerat och godkänt samma version.
      </p>

      {draft && (
        <p className="mt-3 rounded-md bg-secondary p-3 text-sm">
          Det här skapar version {draft.version + 1}. Version {draft.version} ligger kvar i
          historiken men kan inte längre godkännas som den senaste versionen.
        </p>
      )}

      <form
        className="mt-5 grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="eyebrow mb-3 sm:col-span-2">Bostaden</legend>
          <Field label="Adress" id="setup-address" wide>
            <Input
              id="setup-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
            />
          </Field>
          <Field label="Bostadsrättsförening" id="setup-association">
            <Input
              id="setup-association"
              value={association}
              onChange={(event) => setAssociation(event.target.value)}
            />
          </Field>
          <Field label="Lägenhetsnummer" id="setup-apartment">
            <Input
              id="setup-apartment"
              value={apartmentNumber}
              onChange={(event) => setApartmentNumber(event.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="eyebrow mb-3 sm:col-span-2">Köp och finansiering</legend>
          <Field label="Startdag/tillträdesdag" id="setup-date">
            <Input
              id="setup-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Bostadens startvärde (kr)" id="setup-value">
            <MoneyInput id="setup-value" value={startValue} setValue={setStartValue} />
          </Field>
          <Field label="Bolån på startdagen (kr)" id="setup-loan">
            <MoneyInput id="setup-loan" value={initialLoan} setValue={setInitialLoan} />
          </Field>
          <div className="rounded-md border border-hairline p-3 text-sm">
            <p className="text-xs text-muted-foreground">Nettokapital vid start</p>
            <p className="tabular mt-0.5 font-medium">
              {Number.isFinite(netEquity) ? fmtKr(netEquity) : "–"}
            </p>
          </div>
          {parties.map((party) => (
            <Field
              key={party.partyId}
              label={`Kapitalinsats \u00b7 ${party.name} (kr)`}
              id={`setup-capital-${party.partyId}`}
            >
              <MoneyInput
                id={`setup-capital-${party.partyId}`}
                value={capital[party.partyId] ?? ""}
                setValue={(next) => setCapital((före) => ({ ...före, [party.partyId]: next }))}
              />
            </Field>
          ))}
          <p
            className={`sm:col-span-2 text-sm ${financingMatches ? "text-muted-foreground" : "text-destructive"}`}
          >
            Kapitalinsatserna är {Number.isFinite(capitalTotal) ? fmtKr(capitalTotal) : "–"} och ska
            tillsammans vara lika med nettokapitalet{" "}
            {Number.isFinite(netEquity) ? fmtKr(netEquity) : "–"}.
          </p>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="eyebrow mb-3 sm:col-span-2">Formell ägarandel</legend>
          {parties.map((party) => (
            <Field
              key={party.partyId}
              label={`${party.name} (%)`}
              id={`setup-formal-${party.partyId}`}
            >
              <PercentInput
                id={`setup-formal-${party.partyId}`}
                value={formal[party.partyId] ?? ""}
                setValue={(next) => setFormal((före) => ({ ...före, [party.partyId]: next }))}
              />
            </Field>
          ))}
          <p
            className={`sm:col-span-2 text-sm ${ownershipMatches ? "text-muted-foreground" : "text-destructive"}`}
          >
            De formella ägarandelarna ska tillsammans vara 100 %. De hålls helt åtskilda från de
            interna ekonomiska andelarna.
          </p>
        </fieldset>

        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <Button type="submit" disabled={save.isPending || !financingMatches || !ownershipMatches}>
            Spara som avtalsutkast
          </Button>
          {draft && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Avbryt
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  id,
  wide,
  children,
}: {
  label: string;
  id: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  setValue,
}: {
  id: string;
  value: string;
  setValue: (value: string) => void;
}) {
  // Omslag mot det delade fältet så länge formuläret bär sina värden som
  // text. Skillnaden mot förut är att tomt fält inte längre blir noll: det
  // gjorde att villkorsmeningen "insatserna ska motsvara nettokapitalet"
  // plötsligt stämde när man rensat ett fält för att skriva om det.
  return (
    <MoneyField
      id={id}
      className="h-9 w-full"
      suffix={null}
      value={tolkaBelopp(value)}
      onChange={(tal) => setValue(tal === null ? "" : String(tal))}
    />
  );
}

function PercentInput({
  id,
  value,
  setValue,
}: {
  id: string;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        inputMode="decimal"
        className="tabular h-9 text-right"
        value={value}
        placeholder="0"
        onChange={(event) => setValue(event.target.value)}
      />
      <span className="text-xs text-muted-foreground">%</span>
    </div>
  );
}
