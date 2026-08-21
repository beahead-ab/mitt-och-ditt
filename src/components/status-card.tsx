import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "neutral" | "attention" | "positive";

const TONE: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  attention: "text-[color:var(--data-gold)]",
  positive: "text-[color:var(--positive)]",
};

/**
 * Tydligt statuskort i samma anda som Bilkollens stafettpinne: en siffra, vad
 * den betyder, och en väg vidare.
 */
export function StatusCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  to?: string;
}) {
  const body = (
    <div className="tile-surface flex h-full flex-col gap-1 p-4">
      <div className="flex items-center gap-1.5">
        <Icon className={`size-3.5 ${TONE[tone]}`} />
        <p className="eyebrow">{label}</p>
      </div>
      <p className="tabular font-serif text-2xl font-medium leading-tight">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  if (!to) return body;
  return (
    <Link to={to} preload="intent" className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  );
}
