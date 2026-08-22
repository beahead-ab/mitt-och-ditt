import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Explain, TERMS } from "@/components/explain";
import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { useHouseholdData } from "@/hooks/use-household-data";
import { pendingAgreement } from "@/lib/agreement.functions";
import { isDemo } from "@/lib/demo";
import { fmtDate } from "@/lib/format";

/**
 * Uppstarten som lista.
 *
 * Så länge ingen överenskommelse gäller *är* översikten den här listan. Det
 * tomma kortet som stod här förut svarade inte på frågan paret faktiskt har -
 * vad är kvar, och vems tur är det - utan bara på att något saknades.
 *
 * Varje rad härleds ur data som redan finns. Ingen egen tillståndsmaskin och
 * ingen flagga att hålla synkroniserad: läget *är* summan av vad som gjorts.
 * Exakt en rad är aktiv, och det är alltid den första ogjorda.
 */

type Steg = {
  rubrik: string;
  klar: boolean;
  /** Visas när steget är gjort - vem, och när. */
  kvitto?: string;
  brödtext: string;
  åtgärd?: { to: string; label: string };
};

export function Uppstart({ loading }: { loading?: boolean }) {
  const { household } = useHousehold();
  const { transactions } = useHouseholdData();

  const utkast = useQuery({
    queryKey: ["pending-agreement", household?.id],
    queryFn: () => pendingAgreement({ data: { householdId: household!.id } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  if (loading) {
    return (
      <div className="tile-surface p-10 text-center">
        <p className="text-sm text-muted-foreground">Hämtar underlaget …</p>
      </div>
    );
  }

  const parter = household?.parties ?? [];
  const bådaKontona = parter.length === 2;
  const draft = utkast.data ?? null;
  const godkäntAv = draft?.approvedBy ?? [];
  const bådaGodkänt = bådaKontona && parter.every((p) => godkäntAv.includes(p.partyId));
  const förstaPosten = transactions.find((t) => t.status === "approved");

  const steg: Steg[] = [
    {
      rubrik: "Båda kontona är skapade",
      klar: bådaKontona,
      kvitto: bådaKontona ? parter.map((p) => p.name).join(" och ") : undefined,
      brödtext:
        "Tjänsten räknar mellan två personer och kan inte starta med en. Bjud in din motpart med en länk till hens e-postadress.",
      åtgärd: { to: "/overenskommelse/parter", label: "Bjud in din motpart" },
    },
    {
      rubrik: "Fyll i bostaden och köpet",
      klar: Boolean(draft),
      kvitto: draft
        ? `Utkast version ${draft.version}, startdag ${fmtDate(draft.startDate)}`
        : undefined,
      brödtext:
        "Adress, tillträdesdag, pris, lån och vad var och en la in kontant. Ta fram köpekontraktet och lånebeskedet – det tar fem minuter, och den som fyller i skapar bara ett utkast.",
      åtgärd: { to: "/overenskommelse", label: "Börja med bostaden" },
    },
    {
      rubrik: "Ni godkänner samma uppgifter var för sig",
      klar: bådaGodkänt,
      kvitto: bådaGodkänt ? "Båda har godkänt" : undefined,
      brödtext:
        godkäntAv.length === 1
          ? "En av er har godkänt. Ingen kan godkänna åt den andra, och rättas något faller båda godkännandena."
          : "Ingen kan godkänna åt den andra. Rättas något faller båda godkännandena och ni granskar en ny version.",
      åtgärd: { to: "/overenskommelse", label: "Granska uppgifterna" },
    },
    {
      rubrik: "Registrera er första betalning",
      klar: Boolean(förstaPosten),
      kvitto: förstaPosten
        ? `Första posten registrerad ${fmtDate(förstaPosten.paymentDate)}`
        : undefined,
      brödtext: "Med kvitto. Därefter sköter tjänsten räkningen.",
      åtgärd: { to: "/transaktioner", label: "Registrera en betalning" },
    },
  ];

  const aktivt = steg.findIndex((s) => !s.klar);
  const kvar = steg.filter((s) => !s.klar).length;

  return (
    <section data-testid="uppstart">
      <p className="eyebrow">
        Uppstart · steg {Math.min(aktivt + 1, steg.length)} av {steg.length}
      </p>
      <h2 className="mt-1 font-serif text-2xl font-medium tracking-tight">
        {kvar === 0
          ? "Allt är på plats"
          : kvar === 1
            ? "En sak kvar innan tjänsten kan räkna"
            : `${räkneord(kvar)} saker kvar innan tjänsten kan räkna`}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Beräkningen utgår från köpet. Utan startdag, startvärde och era insatser finns ingenting att
        räkna på.
      </p>

      <ol className="tile-surface mt-5 divide-y divide-hairline overflow-hidden">
        {steg.map((s, index) => (
          <Rad key={s.rubrik} steg={s} nummer={index + 1} aktiv={index === aktivt} />
        ))}
      </ol>

      <p className="mt-4 text-sm text-muted-foreground">
        Så länge listan är kvar visas den i stället för översikten.{" "}
        <Explain {...TERMS.andelsenhet} label="Vad räknar tjänsten egentligen?" />
      </p>
    </section>
  );
}

function Rad({ steg, nummer, aktiv }: { steg: Steg; nummer: number; aktiv: boolean }) {
  return (
    <li className={`flex gap-3 p-4 sm:p-5 ${aktiv ? "bg-[oklch(0.98_0.006_70)]" : ""}`}>
      <Markör klar={steg.klar} aktiv={aktiv} nummer={nummer} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${steg.klar || aktiv ? "" : "text-muted-foreground"}`}>
          {steg.rubrik}
        </p>
        {steg.klar ? (
          steg.kvitto && <p className="mt-0.5 text-sm text-muted-foreground">{steg.kvitto}</p>
        ) : (
          <p
            className={`mt-1 text-sm leading-relaxed ${aktiv ? "text-muted-foreground" : "text-muted-foreground/70"}`}
          >
            {steg.brödtext}
          </p>
        )}
        {aktiv && steg.åtgärd && (
          <Button asChild className="mt-3 h-10">
            <Link to={steg.åtgärd.to}>{steg.åtgärd.label}</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

function Markör({
  klar,
  aktiv,
  nummer,
}: {
  klar: boolean;
  aktiv: boolean;
  nummer: number;
}): ReactNode {
  if (klar) return <CircleCheck className="mt-0.5 size-5 shrink-0 text-[color:var(--positive)]" />;
  if (aktiv) {
    return (
      <span className="tabular mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
        {nummer}
      </span>
    );
  }
  return (
    <span className="tabular mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline text-[11px] text-muted-foreground">
      {nummer}
    </span>
  );
}

/** Små tal skrivs med bokstäver i löptext. */
function räkneord(n: number): string {
  return ["noll", "En", "Två", "Tre", "Fyra"][n] ?? String(n);
}
