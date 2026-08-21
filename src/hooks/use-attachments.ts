import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHousehold } from "@/components/household-context";
import { listAttachmentsFn } from "@/lib/attachments.functions";
import { isDemo } from "@/lib/demo";

/**
 * Vilka poster som faktiskt har ett underlag. Används för att räkna saknade
 * underlag på översikten – en beskrivning är inget underlag.
 */
export function useAttachmentReferences(): ReadonlySet<string> {
  const { household } = useHousehold();
  const query = useQuery({
    queryKey: ["attachments", household?.id],
    queryFn: () => listAttachmentsFn({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
    staleTime: 30_000,
  });

  return useMemo(() => {
    const references = new Set<string>();
    for (const file of query.data ?? []) {
      if (file.redactedAt) continue;
      if (file.transactionReference) references.add(file.transactionReference);
    }
    return references;
  }, [query.data]);
}
