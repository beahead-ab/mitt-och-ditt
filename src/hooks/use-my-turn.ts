import { useMemo } from "react";

import { useHouseholdData } from "@/hooks/use-household-data";
import { useMyParty } from "@/hooks/use-my-party";
import { pendingTransactions } from "@/lib/calculation";
import type { Transaction } from "@/lib/engine";

export type MyTurnItem = {
  transaction: Transaction;
  /** Vem som registrerade posten. Den som gjort det har redan godkänt den. */
  registeredByPartyId: string;
  iHaveDecided: boolean;
};

/**
 * Posterna som väntar på just mitt ställningstagande.
 *
 * En egen hook eftersom svaret behövs på tre ställen - notisen i navigationen,
 * kortet på översikten och sidan Väntar - och de tre måste räkna likadant. Ett
 * märke som säger 1 medan sidan visar 0 är värre än inget märke.
 *
 * Underlaget kommer ur samma cachade fråga som resten av appen, så det kostar
 * inget extra att fråga på varje sida.
 */
export function useMyTurn(): { items: MyTurnItem[]; count: number } {
  const { transactions, revisions } = useHouseholdData();
  const myPartyId = useMyParty();

  return useMemo(() => {
    if (!myPartyId) return { items: [], count: 0 };

    const items = pendingTransactions(transactions).flatMap((transaction) => {
      const versions = revisions.get(transaction.id) ?? [];
      const latest = versions[versions.length - 1];
      const registeredByPartyId = latest?.authorId ?? "";
      const iHaveDecided = Boolean(latest?.approvedBy?.[myPartyId]);

      // Den som registrerade posten har godkänt den i samma steg, och den som
      // redan tagit ställning väntar inte på sig själv.
      if (registeredByPartyId === myPartyId || iHaveDecided) return [];
      return [{ transaction, registeredByPartyId, iHaveDecided }];
    });

    return { items, count: items.length };
  }, [transactions, revisions, myPartyId]);
}
