import { useMemo } from "react";

import { MoneyField } from "@/components/money-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toKronor, type AgreementParams } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { AVTALSFALT, FALTNAMN, type Avtalsfalt } from "@/lib/tillaggsavtal";

/**
 * De strukturerade värden ett tilläggsavtal ändrar.
 *
 * Utan de här fälten kunde sammanfattningen påstå att ett belopp ändras medan
 * beräkningen fortsatte på det gamla - parterna godkände en text, och tjänsten
 * räknade på något annat.
 *
 * Varje rad visar gällande värde, föreslaget värde och vad ändringen innebär.
 * Ingen part ska behöva räkna själv för att förstå vad ett ja betyder.
 */

export type Tillaggsutkast = {
  /** Fälten som ändras. Bara dessa skickas till servern. */
  valda: Avtalsfalt[];
  startDate: string;
  startValueKr: number | null;
  initialLoanKr: number | null;
  totalUnits: number | null;
  startUnits: Record<string, number | null>;
  formalPercent: Record<string, number | null>;
};

export function tomtUtkast(agreement: AgreementParams): Tillaggsutkast {
  return {
    valda: [],
    startDate: agreement.startDate,
    startValueKr: toKronor(agreement.startValue),
    initialLoanKr: toKronor(agreement.initialLoan),
    totalUnits: agreement.totalUnits,
    startUnits: Object.fromEntries(agreement.parties.map((p) => [p, agreement.startUnits[p] ?? 0])),
    formalPercent: Object.fromEntries(
      agreement.parties.map((p) => [p, (agreement.formalOwnership?.[p] ?? 0) * 100]),
    ),
  };
}

/** Utkastet omsatt till serverfunktionens form. Bara valda fält följer med. */
export function tillServerform(utkast: Tillaggsutkast, agreement: AgreementParams) {
  const valt = (falt: Avtalsfalt) => utkast.valda.includes(falt);
  return {
    andrarFalt: utkast.valda,
    startDate: valt("startDate") ? utkast.startDate : undefined,
    startValueOre:
      valt("startValueOre") && utkast.startValueKr !== null
        ? String(Math.round(utkast.startValueKr * 100))
        : undefined,
    initialLoanOre:
      valt("initialLoanOre") && utkast.initialLoanKr !== null
        ? String(Math.round(utkast.initialLoanKr * 100))
        : undefined,
    totalUnits:
      valt("totalUnits") && utkast.totalUnits !== null ? String(utkast.totalUnits) : undefined,
    startUnits: valt("startUnits")
      ? Object.fromEntries(agreement.parties.map((p) => [p, utkast.startUnits[p] ?? 0]))
      : undefined,
    formalOwnership: valt("formalOwnership")
      ? Object.fromEntries(agreement.parties.map((p) => [p, (utkast.formalPercent[p] ?? 0) / 100]))
      : undefined,
  };
}

export function TillaggsVarden({
  agreement,
  utkast,
  setUtkast,
  partyName,
  gallerFran,
}: {
  agreement: AgreementParams;
  utkast: Tillaggsutkast;
  setUtkast: (nasta: Tillaggsutkast) => void;
  partyName: (id: string) => string;
  gallerFran: string;
}) {
  const valt = (falt: Avtalsfalt) => utkast.valda.includes(falt);

  function vaxla(falt: Avtalsfalt, pa: boolean) {
    setUtkast({
      ...utkast,
      valda: pa ? [...utkast.valda, falt] : utkast.valda.filter((f) => f !== falt),
    });
  }

  // Nettokapitalet vid start är det tal som avgör vad en andelsenhet är värd.
  const foreNetto = agreement.startValue - agreement.initialLoan;
  const efterNetto = useMemo(() => {
    const varde = valt("startValueOre")
      ? Math.round((utkast.startValueKr ?? 0) * 100)
      : agreement.startValue;
    const lan = valt("initialLoanOre")
      ? Math.round((utkast.initialLoanKr ?? 0) * 100)
      : agreement.initialLoan;
    return varde - lan;
  }, [utkast, agreement, utkast.valda]);

  const foreTotal = agreement.totalUnits;
  const efterTotal = valt("totalUnits") ? (utkast.totalUnits ?? 0) : agreement.totalUnits;

  return (
    <section className="grid gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Kryssa för de uppgifter tillägget ändrar och fyll i de nya värdena. Servern kontrollerar att
        tillägget ändrar precis det du kryssat – varken mer eller mindre – så sammanfattningen och
        beräkningen kan inte säga olika saker.
      </p>

      <Rad
        falt="startDate"
        valt={valt("startDate")}
        vaxla={vaxla}
        fore={fmtDate(agreement.startDate)}
        innebord="Tidslinjens origo för hela den linjära beräkningen. Ändras bara när tillägget rättar tillträdesdagen – tilläggets giltighetsdag är något annat."
      >
        <Input
          type="date"
          className="h-9"
          value={utkast.startDate}
          onChange={(e) => setUtkast({ ...utkast, startDate: e.target.value })}
        />
      </Rad>

      <Rad
        falt="startValueOre"
        valt={valt("startValueOre")}
        vaxla={vaxla}
        fore={fmtKr(toKronor(agreement.startValue))}
        innebord={`Nettokapitalet vid start går från ${fmtKr(toKronor(foreNetto))} till ${fmtKr(toKronor(efterNetto))}.`}
      >
        <MoneyField
          className="h-9 w-40"
          value={utkast.startValueKr}
          onChange={(v) => setUtkast({ ...utkast, startValueKr: v })}
        />
      </Rad>

      <Rad
        falt="initialLoanOre"
        valt={valt("initialLoanOre")}
        vaxla={vaxla}
        fore={fmtKr(toKronor(agreement.initialLoan))}
        innebord={`Nettokapitalet vid start går från ${fmtKr(toKronor(foreNetto))} till ${fmtKr(toKronor(efterNetto))}.`}
      >
        <MoneyField
          className="h-9 w-40"
          value={utkast.initialLoanKr}
          onChange={(v) => setUtkast({ ...utkast, initialLoanKr: v })}
        />
      </Rad>

      <Rad
        falt="totalUnits"
        valt={valt("totalUnits")}
        vaxla={vaxla}
        fore={fmtEnheter(agreement.totalUnits)}
        innebord="Nämnaren i varje andel. Ändras den utan att startenheterna ändras förskjuts båda parters andel."
      >
        <MoneyField
          className="h-9 w-40"
          suffix="st"
          value={utkast.totalUnits}
          onChange={(v) => setUtkast({ ...utkast, totalUnits: v })}
        />
      </Rad>

      <Rad
        falt="startUnits"
        valt={valt("startUnits")}
        vaxla={vaxla}
        fore={agreement.parties
          .map((p) => `${partyName(p)} ${fmtEnheter(agreement.startUnits[p] ?? 0)}`)
          .join(" · ")}
        innebord={agreement.parties
          .map((p) => {
            const fore = (agreement.startUnits[p] ?? 0) / foreTotal;
            const efter = efterTotal > 0 ? (utkast.startUnits[p] ?? 0) / efterTotal : 0;
            return `${partyName(p)} ${fmtAndel(fore)} → ${fmtAndel(efter)}`;
          })
          .join(" · ")}
      >
        <div className="grid gap-2">
          {agreement.parties.map((party) => (
            <div key={party} className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">{partyName(party)}</span>
              <MoneyField
                className="h-9 w-36"
                suffix="st"
                value={utkast.startUnits[party] ?? null}
                onChange={(v) =>
                  setUtkast({ ...utkast, startUnits: { ...utkast.startUnits, [party]: v } })
                }
              />
            </div>
          ))}
        </div>
      </Rad>

      <Rad
        falt="formalOwnership"
        valt={valt("formalOwnership")}
        vaxla={vaxla}
        fore={agreement.parties
          .map((p) => `${partyName(p)} ${fmtAndel(agreement.formalOwnership?.[p] ?? 0)}`)
          .join(" · ")}
        innebord="Följer köpehandlingen. Påverkar inte beräkningen – den interna andelen är en annan sak."
      >
        <div className="grid gap-2">
          {agreement.parties.map((party) => (
            <div key={party} className="flex items-center justify-end gap-2">
              <span className="text-sm text-muted-foreground">{partyName(party)}</span>
              <MoneyField
                className="h-9 w-24"
                suffix="%"
                value={utkast.formalPercent[party] ?? null}
                onChange={(v) =>
                  setUtkast({ ...utkast, formalPercent: { ...utkast.formalPercent, [party]: v } })
                }
              />
            </div>
          ))}
        </div>
      </Rad>

      {utkast.valda.length > 0 && (
        <p className="rounded-md bg-secondary p-3 text-sm leading-relaxed">
          Tillägget ändrar {utkast.valda.map((f) => FALTNAMN[f].toLowerCase()).join(", ")} från och
          med {fmtDate(gallerFran)}. Båda parter ser samma före- och eftervärden innan de bekräftar,
          och beräkningen görs om från avtalets startdag.
        </p>
      )}
    </section>
  );
}

function Rad({
  falt,
  valt,
  vaxla,
  fore,
  innebord,
  children,
}: {
  falt: Avtalsfalt;
  valt: boolean;
  vaxla: (falt: Avtalsfalt, pa: boolean) => void;
  fore: string;
  innebord: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${valt ? "border-primary bg-card" : "border-hairline"}`}
      data-testid={`tillaggsfalt-${falt}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-2">
          <Checkbox
            checked={valt}
            onCheckedChange={(v) => vaxla(falt, v === true)}
            aria-label={`Ändra ${FALTNAMN[falt].toLowerCase()}`}
          />
          <span>
            <span className="text-sm font-medium">{FALTNAMN[falt]}</span>
            <span className="tabular mt-0.5 block text-sm text-muted-foreground">
              Gäller nu: {fore}
            </span>
          </span>
        </label>
        <div className={valt ? "" : "pointer-events-none opacity-40"}>{children}</div>
      </div>
      {valt && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{innebord}</p>}
    </div>
  );
}

export { AVTALSFALT };
