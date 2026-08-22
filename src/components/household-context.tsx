import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";

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
  isAdmin: boolean;
  isLoading: boolean;
};

const HouseholdContext = createContext<HouseholdContextValue>({
  household: null,
  households: [],
  isAdmin: false,
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
}: {
  userId: string;
  isAdmin: boolean;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["households"],
    queryFn: () => listHouseholds(),
    enabled: !isDemo,
    staleTime: 60_000,
  });

  const households = isDemo ? [DEMO] : (query.data ?? []);
  const value: HouseholdContextValue = {
    households,
    household: households[0] ?? null,
    isAdmin: isDemo ? true : isAdmin,
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
