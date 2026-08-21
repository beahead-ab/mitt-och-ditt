import { useQuery } from "@tanstack/react-query";

import { useHousehold } from "@/components/household-context";
import { currentUserFn } from "@/lib/auth";
import { DEMO_USER, isDemo } from "@/lib/demo";

/**
 * Vilken part den inloggade företräder i det aktiva hushållet. Styr vad som
 * går att godkänna – men den bindande spärren ligger i databasen.
 */
export function useMyParty(): string | null {
  const { household } = useHousehold();
  const user = useQuery({
    queryKey: ["current-user"],
    queryFn: () => currentUserFn(),
    enabled: !isDemo,
    staleTime: 5 * 60_000,
  });

  if (isDemo) return DEMO_USER.partyId;
  const userId = user.data?.id;
  if (!userId || !household) return null;
  return household.parties.find((p) => p.userId === userId)?.partyId ?? null;
}
