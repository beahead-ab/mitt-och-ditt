import { createContext, useContext, type ReactNode } from "react";

import { DEMO_HOUSEHOLD, isDemo } from "@/lib/demo";

export type Household = {
  id: string;
  name: string;
  propertyAddress: string | null;
};

type HouseholdContextValue = {
  household: Household | null;
  isAdmin: boolean;
};

const HouseholdContext = createContext<HouseholdContextValue>({ household: null, isAdmin: false });

/**
 * Hushållskontexten motsvarar Bilkollens bilkontext. Ett konto har normalt
 * exakt ett hushåll; väljaren i toppfältet visas först när fler finns.
 * Riktig datahämtning kopplas in i etapp 2.
 */
export function HouseholdProvider({ children }: { userId: string; children: ReactNode }) {
  const value: HouseholdContextValue = isDemo
    ? {
        household: {
          id: DEMO_HOUSEHOLD.id,
          name: DEMO_HOUSEHOLD.name,
          propertyAddress: DEMO_HOUSEHOLD.propertyAddress,
        },
        isAdmin: true,
      }
    : { household: null, isAdmin: false };

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  return useContext(HouseholdContext);
}
