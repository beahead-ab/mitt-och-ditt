import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { PageHeader } from "@/components/app-shell";
import { useHousehold, usePartyName } from "@/components/household-context";
import { NoAgreement } from "@/components/no-agreement";
import { TransactionActions } from "@/components/transaction-actions";
import { useHouseholdData } from "@/hooks/use-household-data";
import { useMyParty } from "@/hooks/use-my-party";
import { useMyTurn } from "@/hooks/use-my-turn";
import { defaultEndpoint, pendingTransactions, run } from "@/lib/calculation";
import { isDemo } from "@/lib/demo";
import {
  toKronor,
  type AgreementParams,
  type CostCategoryRule,
  type Transaction,
} from "@/lib/engine";
import { fmtAndel, fmtDate, fmtKr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/transaktioner/vantar")({
  head: () => ({ meta: [{ title: "Väntar på godkännande – Mitt & Ditt" }] }),
  component: Pending,
});

function Pending() {
  const { household } = useHousehold();
  const partyName = usePartyName();
  const { agreement, rules, revisions, transactions, isLoading } = useHouseholdData();
  const myPartyId = useMyParty();
  const minTur = useMyTurn();
  const navigate = useNavigate();

  const väntande = pendingTransactions(transactions);

  if (!agreement) {
    return (
      <>
        <PageHeader eyebrow="Transaktioner" title="Väntar på godkännande" />
        <NoAgreement loading={isLoading} />
      </>
    );
  }

  // Posterna delas i två: de som väntar på mig, och de som väntar på motparten.
  // Tidigare visades samma post både som åtgärdskort och i listan nedanför -
  // en post, två gånger, vilket fick det att se ut som två poster.
  const mina = new Set(minTur.items.map((item) => item.transaction.id));
  const hosMotparten = väntande.filter((tx) => !mina.has(tx.id));

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title={minTur.count > 0 ? "Din tur" : "Väntar på godkännande"}
        description="Posterna påverkar inte andelarna förrän båda parter har godkänt dem."
      />

      {minTur.count === 0 && hosMotparten.length === 0 && (
        <div className="tile-surface p-10 text-center">
          <p className="text-sm font-medium">Inga poster väntar på godkännande</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Allt som registrerats är avgjort av er båda.
          </p>
        </div>
      )}

      {minTur.items.length > 0 && household && !isDemo && myPartyId && (
        <div className="grid gap-4">
          {minTur.items.map((item) => (
            <Beslut
              key={item.transaction.id}
              householdId={household.id}
              transaction={item.transaction}
              registeredByPartyId={item.registeredByPartyId}
              myPartyId={myPartyId}
              agreement={agreement}
              rules={rules}
              transactions={transactions}
              partyName={partyName}
              onCorrect={(reference) =>
                navigate({ to: "/transaktioner", search: { korrigerar: reference } })
              }
            />
          ))}
        </div>
      )}

      {hosMotparten.length > 0 && (
        <section className="mt-8">
          <p className="eyebrow mb-3">Väntar på motparten</p>
          <ul className="grid gap-2">
            {hosMotparten.map((tx) => {
              const total = agreement.parties.reduce(
                (sum, p) => sum + (tx.payments[p]?.gross ?? 0),
                0,
              );
              const versions = revisions.get(tx.id) ?? [];
              const registrator = versions[versions.length - 1]?.authorId;
              return (
                <li key={tx.id} className="tile-surface flex flex-wrap gap-2 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {tx.id} · {tx.category}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Betalningsdag {fmtDate(tx.paymentDate)}
                      {registrator ? ` · registrerad av ${partyName(registrator)}` : ""}
                    </p>
                  </div>
                  <p className="tabular font-serif text-lg font-medium">{fmtKr(toKronor(total))}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Ett beslut, med sin konsekvens.
 *
 * Vyn ska svara på frågan den ställer. Att godkänna en post flyttar
 * andelsenheter mellan parterna, och exakt hur mycket går att räkna fram i
 * förväg - genom samma motor som avräkningen använder. Motorn är ren och
 * deterministisk, så det är säkert att göra i klienten och talet blir samma
 * som det som sedan gäller.
 */
function Beslut({
  householdId,
  transaction,
  registeredByPartyId,
  myPartyId,
  agreement,
  rules,
  transactions,
  partyName,
  onCorrect,
}: {
  householdId: string;
  transaction: Transaction;
  registeredByPartyId: string;
  myPartyId: string;
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  transactions: Transaction[];
  partyName: (id: string) => string;
  onCorrect: (reference: string) => void;
}) {
  const jämförelse = useMemo(() => {
    const nuEndpoint = defaultEndpoint(agreement, rules, transactions);
    const nu = run(agreement, rules, transactions, nuEndpoint);

    const medPosten = transactions.map((tx) =>
      tx.id === transaction.id ? { ...tx, status: "approved" as const } : tx,
    );
    const efterEndpoint = defaultEndpoint(agreement, rules, medPosten);
    const efter = run(agreement, rules, medPosten, efterEndpoint);

    return { nu, efter };
  }, [agreement, rules, transactions, transaction.id]);

  const { nu, efter } = jämförelse;
  const total = agreement.parties.reduce(
    (sum, p) => sum + (transaction.payments[p]?.gross ?? 0),
    0,
  );
  const minaKronorFöre = nu.settlement.finalPosition[myPartyId] ?? 0;
  const minaKronorEfter = efter.settlement.finalPosition[myPartyId] ?? 0;
  const kronorDelta = minaKronorEfter - minaKronorFöre;

  // Händelsen posten skapar, för meningen om varför andelen ändras.
  const nyHändelse = efter.events.find(
    (händelse) =>
      händelse.transactionIds.includes(transaction.id) &&
      !nu.events.some((tidigare) => tidigare.date === händelse.date),
  );

  return (
    <section className="rounded-[var(--radius)] border border-primary bg-card p-5 sm:p-6">
      <p className="eyebrow text-primary">Din tur</p>
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-serif text-lg font-medium leading-snug">
            {transaction.category}
            {transaction.description ? ` · ${transaction.description}` : ""}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {transaction.id} · betalningsdag {fmtDate(transaction.paymentDate)} · registrerad av{" "}
            {partyName(registeredByPartyId)}
          </p>
        </div>
        <p className="tabular font-serif text-xl font-medium">{fmtKr(toKronor(total))}</p>
      </div>

      <div className="mt-4 rounded-md bg-secondary p-4">
        <p className="eyebrow mb-2">Godkänner du</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 font-normal">Andel</th>
              <th className="pb-1 text-right font-normal">Före</th>
              <th className="pb-1 text-right font-normal">Efter</th>
            </tr>
          </thead>
          <tbody>
            {agreement.parties.map((party) => (
              <tr key={party}>
                <td className="py-0.5">
                  {partyName(party)}
                  {party === myPartyId ? " (du)" : ""}
                </td>
                <td className="tabular py-0.5 text-right text-muted-foreground">
                  {fmtAndel(nu.finalShares[party])}
                </td>
                <td className="tabular py-0.5 text-right font-medium">
                  {fmtAndel(efter.finalShares[party])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 border-t border-hairline pt-3 text-sm leading-relaxed">
          För dig betyder det{" "}
          <span className="tabular font-medium">
            {kronorDelta >= 0 ? "+" : "−"}
            {fmtKr(toKronor(Math.abs(kronorDelta)))}
          </span>{" "}
          om ni avräknar på dagens antagande.
        </p>

        {nyHändelse?.overpayer && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {partyName(nyHändelse.overpayer)} betalade {fmtKr(toKronor(nyHändelse.overpayment))} mer
            än sin del och får{" "}
            {new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(
              nyHändelse.transferredUnits,
            )}{" "}
            andelsenheter för det
            {nyHändelse.unitValue !== null
              ? `, till dagens enhetsvärde ${new Intl.NumberFormat("sv-SE", {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4,
                }).format(nyHändelse.unitValue / 100)} kr`
              : ""}
            .
          </p>
        )}
      </div>

      <div className="mt-5">
        <TransactionActions
          layout="beslut"
          householdId={householdId}
          transaction={transaction}
          myPartyId={myPartyId}
          registeredByPartyId={registeredByPartyId}
          iHaveDecided={false}
          onCorrect={onCorrect}
        />
      </div>
    </section>
  );
}
