import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "attention" | "positive";

const TONE: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  attention: "text-[color:var(--data-gold)]",
  positive: "text-[color:var(--positive)]",
};

/**
 * Ett läge, vad det betyder, och en väg vidare.
 *
 * Rubriken är ett ord om läget - "Åtgärda", "Preliminärt" - inte bara en
 * nyans på en ikon. Färg ensam duger inte: den som inte skiljer guld från
 * grått ser fyra likadana kort, och den som gör det vet ändå inte vad guld
 * betyder förrän någon säger det.
 *
 * Vägen vidare är en synlig länk med ett mål som svarar mot siffran, inte hela
 * kortet klickbart mot en ofiltrerad lista. "Visa de fem posterna" ska landa i
 * just de fem.
 */
export function StatusCard({
  icon: Icon,
  state,
  tone = "neutral",
  children,
  action,
}: {
  icon: LucideIcon;
  /** Ordet som säger vad läget kräver. */
  state: string;
  tone?: Tone;
  children: ReactNode;
  action?: { to: string; search?: Record<string, unknown>; label: string };
}) {
  return (
    <div className="tile-surface flex h-full flex-col gap-1.5 p-4">
      <div className="flex items-center gap-1.5">
        <Icon className={`size-3.5 ${TONE[tone]}`} />
        <p className="eyebrow">{state}</p>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      {action && (
        <p className="mt-auto pt-1 text-sm">
          <Link
            to={action.to}
            search={action.search}
            preload="intent"
            className="text-primary underline underline-offset-4"
          >
            {action.label}
          </Link>
        </p>
      )}
    </div>
  );
}

/** Siffran i en kortmening. Tabulär och lite större, men inte en hjältesiffra. */
export function Räknare({ children }: { children: ReactNode }) {
  return <span className="tabular font-serif text-lg font-medium text-foreground">{children}</span>;
}
