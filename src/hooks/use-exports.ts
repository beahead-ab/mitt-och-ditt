import { useCallback } from "react";

import { useHousehold } from "@/components/household-context";
import type { ExportChoice } from "@/components/export-menu";
import { auditTrail } from "@/lib/audit.functions";
import { toCsv, exportFilename } from "@/lib/export/csv";
import { agreementMarkdown, summaryMarkdown, type DocumentContext } from "@/lib/export/documents";
import { downloadText } from "@/lib/export/download";
import { downloadMarkdownAsPdf } from "@/lib/export/pdf";
import { dayEventCsvColumns, transactionCsvColumns } from "@/lib/export/transactions";
import type {
  AgreementParams,
  CostCategoryRule,
  EngineResult,
  Endpoint,
  Transaction,
} from "@/lib/engine";
import { fmtDateTime } from "@/lib/format";

/**
 * Exporterna samlade. Alla utgår från samma underlag som skärmen visar, så
 * det som exporteras är exakt det parterna ser.
 */
export function useExports(agreement: AgreementParams | null) {
  const { household } = useHousehold();

  const context = useCallback((): DocumentContext | null => {
    if (!agreement || !household) return null;
    return {
      householdName: household.name,
      propertyAddress: household.propertyAddress,
      agreement,
      names: Object.fromEntries(household.parties.map((p) => [p.partyId, p.name])),
      generatedAt: new Date().toISOString(),
      engineVersion: "",
    };
  }, [agreement, household]);

  const transactionExports = useCallback(
    (
      transactions: Transaction[],
      rules: CostCategoryRule[],
      result: EngineResult,
    ): ExportChoice[] => {
      const base = context();
      if (!base) return [];
      const stamp = base.generatedAt;

      return [
        {
          label: "Transaktionshistorik (CSV)",
          hint: "Öppnas direkt i Excel. En rad per post.",
          run: () =>
            downloadText(
              toCsv(transactionCsvColumns(agreement!, rules, base.names), transactions),
              exportFilename("transaktioner", "csv", stamp),
              "text/csv",
            ),
        },
        {
          label: "Dagsberäkning (CSV)",
          hint: "Varje betalningsdag steg för steg.",
          run: () =>
            downloadText(
              toCsv(dayEventCsvColumns(agreement!, base.names), result.events),
              exportFilename("dagsberakning", "csv", stamp),
              "text/csv",
            ),
        },
      ];
    },
    [agreement, context],
  );

  const summaryExports = useCallback(
    (result: EngineResult, endpoint: Endpoint): ExportChoice[] => {
      const base = context();
      if (!base) return [];
      const stamp = base.generatedAt;
      const markdown = () =>
        summaryMarkdown({ ...base, engineVersion: result.engineVersion }, result, endpoint);

      return [
        {
          label: "Sammanställning (PDF)",
          hint: "Läget nu, utfallet och kontrollerna.",
          run: () =>
            downloadMarkdownAsPdf(
              markdown(),
              "Sammanställning",
              exportFilename("sammanstallning", "pdf", stamp),
            ),
        },
        {
          label: "Sammanställning (Markdown)",
          hint: "Samma innehåll som text.",
          run: () =>
            downloadText(
              markdown(),
              exportFilename("sammanstallning", "md", stamp),
              "text/markdown",
            ),
        },
      ];
    },
    [context],
  );

  const agreementExports = useCallback((): ExportChoice[] => {
    const base = context();
    if (!base) return [];
    const stamp = base.generatedAt;
    const markdown = () => agreementMarkdown(base);

    return [
      {
        label: "Överenskommelse (PDF)",
        hint: "Grunduppgifter och låsta fält.",
        run: () =>
          downloadMarkdownAsPdf(
            markdown(),
            "Gällande överenskommelse",
            exportFilename("overenskommelse", "pdf", stamp),
          ),
      },
      {
        label: "Överenskommelse (Markdown)",
        run: () =>
          downloadText(markdown(), exportFilename("overenskommelse", "md", stamp), "text/markdown"),
      },
    ];
  }, [context]);

  const auditExport = useCallback((): ExportChoice[] => {
    if (!household) return [];
    const stamp = new Date().toISOString();

    return [
      {
        label: "Revisionsunderlag (CSV)",
        hint: "Hela aktivitetsloggen med hashkedjan.",
        run: async () => {
          const trail = await auditTrail({ data: { householdId: household.id } });
          if (!trail) throw new Error("Kunde inte hämta aktivitetsloggen.");
          if (!trail.verified) {
            throw new Error(
              `Hashkedjan är bruten vid rad ${trail.brokenLinks.join(", ")}. Exporten avbröts.`,
            );
          }
          downloadText(
            toCsv(
              [
                { header: "Nr", value: (e) => e.sequence },
                { header: "Tidpunkt", value: (e) => fmtDateTime(e.occurredAt) },
                { header: "Händelse", value: (e) => e.eventType },
                { header: "Objekt", value: (e) => e.entityType },
                { header: "Objekt-ID", value: (e) => e.entityId ?? "" },
                { header: "Av", value: (e) => e.actor ?? "" },
                { header: "Förevärde", value: (e) => e.previousValue ?? "" },
                { header: "Eftervärde", value: (e) => e.newValue ?? "" },
                { header: "Föregående hash", value: (e) => e.prevHash },
                { header: "Hash", value: (e) => e.hash },
              ],
              trail.events,
            ),
            exportFilename("revisionsunderlag", "csv", stamp),
            "text/csv",
          );
        },
      },
    ];
  }, [household]);

  return { transactionExports, summaryExports, agreementExports, auditExport };
}
