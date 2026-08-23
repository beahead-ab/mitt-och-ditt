import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { lasSparatVal, sparaVal, valjAktivt } from "@/lib/aktivt-hushall";
import { DEMO_HOUSEHOLD, isDemo } from "@/lib/demo";
import { listHouseholds } from "@/lib/household.functions";

export type Household = {
  id: string;
  name: string;
  propertyAddress: string | null;
  propertyAssociation: string | null;
  apartmentNumber: string | null;
  parties: { partyId: string; userId: string; name: string }[];
};

type HouseholdContextValue = {
  household: Household | null;
  households: Household[];
  /** Byter aktivt hushåll. Valet överlever sidbyte och omladdning. */
  valjHushall: (id: string) => void;
  /** Väljaren visas bara när det finns mer än ett hushåll att välja mellan. */
  visaValjare: boolean;
  isAdmin: boolean;
  /** Bekräftad adress krävs för att skapa ett hushåll eller bli part i ett. */
  emailVerified: boolean;
  isLoading: boolean;
};

const HouseholdContext = createContext<HouseholdContextValue>({
  household: null,
  households: [],
  valjHushall: () => {},
  visaValjare: false,
  isAdmin: false,
  emailVerified: false,
  isLoading: false,
});

const DEMO: Household = {
  id: DEMO_HOUSEHOLD.id,
  name: DEMO_HOUSEHOLD.name,
  propertyAddress: DEMO_HOUSEHOLD.propertyAddress,
  propertyAssociation: null,
  apartmentNumber: null,
  parties: [
    { partyId: "caesar", userId: "demo-caesar", name: "Caesar" },
    { partyId: "felicia", userId: "demo-felicia", name: "Felicia" },
  ],
};

/**
 * Hushållskontexten motsvarar Bilkollens bilkontext. Ett konto har normalt
 * exakt ett hushåll; väljaren i toppfältet visas först när fler finns.
 */
export function HouseholdProvider({
  children,
  isAdmin,
  emailVerified,
}: {
  userId: string;
  isAdmin: boolean;
  emailVerified: boolean;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["households"],
    queryFn: () => listHouseholds(),
    enabled: !isDemo,
    staleTime: 60_000,
  });

  const households = isDemo ? [DEMO] : (query.data ?? []);

  // Det sparade valet läses en gång och hålls i tillstånd, så att ett byte
  // slår igenom direkt i alla frågor - cache-nycklarna innehåller hushållets
  // id och byts därmed automatiskt.
  const [sparatId, setSparatId] = useState<string | null>(() => lasSparatVal());
  const val = valjAktivt(households, sparatId);

  // Ett hushåll som tagits bort eller inte längre går att nå får aldrig ligga
  // kvar som aktivt. Utan den här raden visas ett tomt läge som ser ut som ett
  // fel i tjänsten.
  useEffect(() => {
    if (val.rensaSparat) {
      sparaVal(null);
      setSparatId(null);
    }
  }, [val.rensaSparat]);

  const valjHushall = useCallback((id: string) => {
    sparaVal(id);
    setSparatId(id);
  }, []);

  const value: HouseholdContextValue = {
    households,
    household: val.aktivt,
    valjHushall,
    visaValjare: val.visaValjare,
    isAdmin: isDemo ? true : isAdmin,
    emailVerified: isDemo ? true : emailVerified,
    isLoading: !isDemo && query.isLoading,
  };

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  return useContext(HouseholdContext);
}

/**
 * Vad parterna heter.
 *
 * Namnet står på medlemskapet i hushållet; koden ska aldrig veta vad någon
 * heter. Faller tillbaka på partsnyckeln, som alltid finns - hellre "b" än en
 * tom lucka där ett namn skulle stått.
 */
export function usePartyName(): (partyId: string) => string {
  const { household } = useHousehold();
  return useCallback(
    (partyId: string) =>
      household?.parties.find((party) => party.partyId === partyId)?.name ?? partyId,
    [household],
  );
}
