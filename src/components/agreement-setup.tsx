import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CircleCheck } from "lucide-react";
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
import { fmtAndel, fmtEnheter, fmtKr } from "@/lib/format";
import { Explain, TERMS } from "@/components/explain";

/** Tomt fält är inte noll. Se lib/belopp.ts. */
function asNumber(value: string): number {
  return tolkaBelopp(value) ?? Number.NaN;
}

/** Gemensam uppstart: parterna fyller själva i alla bostads- och startvärden. */
export function AgreementSetup() {
  const { household } = useHousehold();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [stegNr, setStegNr] = useState(0);
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

  const motpart = parties.find((party) => party.partyId !== draft?.myPartyId) ?? parties[1];
  const kontantdel = netEquity;
  const skillnad = capitalTotal - kontantdel;
  const enheterTotalt = capitalTotal;

  const steg: Steg[] = [
    {
      rubrik: "Bostaden",
      eyebrow: "Var ni bor",
      klar: address.trim().length > 0,
      hinder: "Adressen behövs.",
    },
    {
      rubrik: "Köpet och lånet",
      eyebrow: "Vad bostaden kostade",
      klar: startDate.length > 0 && Number.isFinite(values.startValue) && kontantdel > 0,
      hinder:
        startDate.length === 0
          ? "Tillträdesdagen behövs."
          : "Startvärdet måste vara större än bolånet.",
    },
    {
      rubrik: "Vad var och en la in",
      eyebrow: "Kontantinsatsen",
      klar: financingMatches && ownershipMatches,
      hinder: !financingMatches
        ? "Insatserna måste tillsammans motsvara kontantdelen."
        : "De formella ägarandelarna måste bli 100 %.",
    },
  ];

  const aktivt = steg[stegNr];

  return (
    <section className="tile-surface mt-4 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {stegNr > 0 ? (
          <button
            type="button"
            onClick={() => setStegNr((n) => n - 1)}
            className="flex items-center gap-1 text-sm text-primary underline underline-offset-4"
          >
            <ArrowLeft className="size-3.5" />
            {steg[stegNr - 1].rubrik}
          </button>
        ) : (
          <span className="text-sm text-muted-foreground">
            {draft ? `Korrigerar version ${draft.version}` : "Gemensam uppstart"}
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          Uppstart · {stegNr + 1} av {steg.length}
        </span>
      </div>

      <p className="eyebrow">{aktivt.eyebrow}</p>
      <h2 className="mt-1 font-serif text-2xl font-medium tracking-tight">
        {stegNr === 0
          ? "Bostaden ni äger tillsammans"
          : stegNr === 1
            ? "Köpet och lånet"
            : "Kontantinsatsen, krona för krona"}
      </h2>

      {draft && stegNr === 0 && (
        <p className="mt-3 rounded-md bg-secondary p-3 text-sm leading-relaxed">
          Det här skapar version {draft.version + 1}. Version {draft.version} ligger kvar i
          historiken men kan inte längre godkännas.
        </p>
      )}

      <form
        className="mt-5 grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (stegNr < steg.length - 1) {
            setStegNr((n) => n + 1);
            return;
          }
          save.mutate();
        }}
      >
        {stegNr === 0 && (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <Field label="Adress" id="setup-address" wide>
              <Input
                id="setup-address"
                className="h-10"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                required
              />
            </Field>
            <Field label="Bostadsrättsförening" id="setup-association">
              <Input
                id="setup-association"
                className="h-10"
                value={association}
                onChange={(event) => setAssociation(event.target.value)}
              />
            </Field>
            <Field label="Lägenhetsnummer" id="setup-apartment">
              <Input
                id="setup-apartment"
                className="h-10"
                value={apartmentNumber}
                onChange={(event) => setApartmentNumber(event.target.value)}
              />
            </Field>
          </fieldset>
        )}

        {stegNr === 1 && (
          <>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              Ta fram köpekontraktet och lånebeskedet. Skillnaden mellan pris och lån är den
              kontantdel ni själva la in – den fördelar ni i nästa steg.
            </p>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <Field label="Tillträdesdag" id="setup-date">
                <Input
                  id="setup-date"
                  type="date"
                  className="h-10"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                />
              </Field>
              <Field label="Pris (kr)" id="setup-value">
                <MoneyInput id="setup-value" value={startValue} setValue={setStartValue} />
              </Field>
              <Field label="Bolån på tillträdesdagen (kr)" id="setup-loan">
                <MoneyInput id="setup-loan" value={initialLoan} setValue={setInitialLoan} />
              </Field>
            </fieldset>
            <Uppstallning
              pris={values.startValue}
              lan={values.initialLoan}
              kontantdel={kontantdel}
            />
          </>
        )}

        {stegNr === 2 && (
          <>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              Bara styrkt eget kapital vid köpet. Det ni betalar senare registrerar ni som poster –
              kapitalinsatser får aldrig bli transaktioner.
            </p>

            <fieldset className="grid gap-3">
              {parties.map((party) => (
                <div
                  key={party.partyId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline p-3"
                >
                  <Label htmlFor={`setup-capital-${party.partyId}`} className="font-normal">
                    {party.name}
                  </Label>
                  <MoneyInput
                    id={`setup-capital-${party.partyId}`}
                    value={capital[party.partyId] ?? ""}
                    setValue={(next) => setCapital((f) => ({ ...f, [party.partyId]: next }))}
                  />
                </div>
              ))}
            </fieldset>

            <Uppstallning
              pris={values.startValue}
              lan={values.initialLoan}
              kontantdel={kontantdel}
              insatser={capitalTotal}
              skillnad={skillnad}
              stammer={financingMatches}
            />

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="eyebrow mb-2 sm:col-span-2">Formell ägarandel</legend>
              {parties.map((party) => (
                <Field
                  key={party.partyId}
                  label={`${party.name} (%)`}
                  id={`setup-formal-${party.partyId}`}
                >
                  <PercentInput
                    id={`setup-formal-${party.partyId}`}
                    value={formal[party.partyId] ?? ""}
                    setValue={(next) => setFormal((f) => ({ ...f, [party.partyId]: next }))}
                  />
                </Field>
              ))}
              <p
                className={`text-sm sm:col-span-2 ${ownershipMatches ? "text-muted-foreground" : "text-destructive"}`}
              >
                Ska tillsammans bli 100 %. Följer köpehandlingen och hålls helt åtskild från de
                interna ekonomiska andelarna.
              </p>
            </fieldset>

            {financingMatches && enheterTotalt > 0 && (
              <DetHarGerEr
                parties={parties}
                capital={values.capitalKrByParty}
                totalt={enheterTotalt}
              />
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <Button type="submit" className="h-11" disabled={save.isPending || !aktivt.klar}>
            {stegNr < steg.length - 1
              ? `Vidare till ${steg[stegNr + 1].rubrik.toLowerCase()}`
              : motpart
                ? `Spara utkast och be ${motpart.name} granska`
                : "Spara som avtalsutkast"}
          </Button>
          {stegNr > 0 && (
            <Button type="button" variant="ghost" onClick={() => setStegNr((n) => n - 1)}>
              Tillbaka
            </Button>
          )}
          {!aktivt.klar && <p className="text-sm text-muted-foreground">{aktivt.hinder}</p>}
        </div>
      </form>
    </section>
  );
}

type Steg = { rubrik: string; eyebrow: string; klar: boolean; hinder: string };

/**
 * Uppställningen som alltid syns.
 *
 * Skillnaden räknas medan man skriver, i kronor: "det fattas 50 000 kr" går
 * att åtgärda, medan "summorna ska vara lika" bara konstaterar att något är
 * fel utan att säga hur mycket.
 */
function Uppstallning({
  pris,
  lan,
  kontantdel,
  insatser,
  skillnad,
  stammer,
}: {
  pris: number;
  lan: number;
  kontantdel: number;
  insatser?: number;
  skillnad?: number;
  stammer?: boolean;
}) {
  const tal = (v: number) => (Number.isFinite(v) ? fmtKr(v) : "–");

  return (
    <div className="rounded-md border border-hairline p-4 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">
          Pris {tal(pris)} − lån {tal(lan)}
        </span>
        <span className="tabular font-medium">{tal(kontantdel)}</span>
      </div>
      {insatser !== undefined && (
        <div className="mt-1.5 flex justify-between gap-3 border-t border-hairline pt-1.5">
          <span className="text-muted-foreground">Era insatser</span>
          <span className="tabular font-medium">{tal(insatser)}</span>
        </div>
      )}
      {skillnad !== undefined && (
        <p
          className={`mt-2 flex items-center gap-1.5 ${stammer ? "text-[color:var(--positive)]" : "text-destructive"}`}
        >
          {stammer ? (
            <>
              <CircleCheck className="size-4" />
              Det stämmer. Insatserna täcker precis kontantdelen.
            </>
          ) : !Number.isFinite(skillnad) ? (
            "Fyll i båda insatserna."
          ) : skillnad < 0 ? (
            `Det fattas ${fmtKr(Math.abs(skillnad))}.`
          ) : (
            `Det är ${fmtKr(skillnad)} för mycket.`
          )}
        </p>
      )}
    </div>
  );
}

/** Vad uppgifterna ger, innan man sparar dem. Först här introduceras ordet. */
function DetHarGerEr({
  parties,
  capital,
  totalt,
}: {
  parties: { partyId: string; name: string }[];
  capital: Record<string, number>;
  totalt: number;
}) {
  return (
    <div className="rounded-md bg-secondary p-4">
      <p className="eyebrow mb-3">Det här ger er</p>
      <div className="grid gap-2">
        {parties.map((party) => (
          <div key={party.partyId} className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{party.name}</span>
            <span className="tabular font-serif text-xl font-medium">
              {fmtAndel((capital[party.partyId] ?? 0) / totalt)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[oklch(0.86_0.06_45)]">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${((capital[parties[0]?.partyId] ?? 0) / totalt) * 100}%` }}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {parties.map((p) => fmtEnheter(capital[p.partyId] ?? 0)).join(" respektive ")} andelsenheter
        – en enhet per krona. Andelen är intern och ändrar inte vem som formellt äger bostaden.{" "}
        <Explain {...TERMS.andelsenhet} label="Vad är en andelsenhet?" />
      </p>
    </div>
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
