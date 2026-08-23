import { Link, useRouterState } from "@tanstack/react-router";

import { useHousehold } from "@/components/household-context";

/**
 * `endastAdmin` märker flikar som hör till hela tjänsten och inte till
 * hushållet. Huvudmenyn gattar redan på `isAdmin`, men flikraden gjorde det
 * inte: en vanlig part som öppnade sitt eget revisionsunderlag - som ligger
 * under samma prefix - fick en rad med länkar till användarregistret,
 * inbjudningarna och mailkön. Sidorna själva visade ingenting, men menyn
 * skyltade med en förvaltning paret inte har med att göra.
 */
type Tab = { to: string; label: string; endastAdmin?: boolean };
type Section = { match: string; tabs: Tab[] };

/** Sektionernas undersidor. Huvudmenyn visar bara de sju sektionerna. */
export const SECTIONS: Section[] = [
  {
    match: "/transaktioner",
    tabs: [
      { to: "/transaktioner", label: "Registrera" },
      { to: "/transaktioner/vantar", label: "Väntar på godkännande" },
      { to: "/transaktioner/historik", label: "Historik" },
      { to: "/transaktioner/avstamning", label: "Avstämning" },
      { to: "/transaktioner/regress", label: "Regresskrav" },
    ],
  },
  {
    match: "/overenskommelse",
    tabs: [
      { to: "/overenskommelse", label: "Gällande överenskommelse" },
      { to: "/overenskommelse/kostnadsslag", label: "Kostnadsslag" },
      { to: "/overenskommelse/versioner", label: "Avtalsversioner" },
      { to: "/overenskommelse/tillagg", label: "Tilläggsavtal" },
      { to: "/overenskommelse/parter", label: "Parter" },
    ],
  },
  {
    match: "/forsaljning",
    tabs: [
      { to: "/forsaljning", label: "Process" },
      { to: "/forsaljning/varderingar", label: "Värderingar" },
      { to: "/forsaljning/slutavrakning", label: "Slutavräkning" },
    ],
  },
  {
    match: "/system",
    tabs: [
      { to: "/system/anvandare", label: "Användare", endastAdmin: true },
      { to: "/system/hushall", label: "Hushåll", endastAdmin: true },
      { to: "/system/inbjudningar", label: "Inbjudningar", endastAdmin: true },
      { to: "/system/rantor", label: "Referensränta", endastAdmin: true },
      { to: "/system/mail", label: "Mailstatus", endastAdmin: true },
      // Revisionsunderlaget är hushållets egen logg, inte förvaltning.
      { to: "/system/revision", label: "Revisionsunderlag" },
    ],
  },
];

/**
 * Vilka flikar en viss användare ska se i en sektion.
 *
 * Bruten ur komponenten för att kunna prövas: gränsen mellan hushållets egna
 * sidor och tjänstens förvaltning är en behörighetsregel, inte en detalj i
 * utseendet.
 */
export function synligaFlikar(section: Section, isAdmin: boolean): Tab[] {
  return section.tabs.filter((t) => !t.endastAdmin || isAdmin);
}

export function sectionFor(pathname: string) {
  return SECTIONS.find((s) => pathname === s.match || pathname.startsWith(`${s.match}/`)) ?? null;
}

/** Fast, horisontellt scrollbar flikrad för aktuell sektion. */
export function SectionTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin } = useHousehold();
  const section = sectionFor(pathname);
  if (!section) return null;

  const flikar = synligaFlikar(section, isAdmin);
  if (flikar.length === 0) return null;

  return (
    <nav
      aria-label="Sektionsflikar"
      data-testid="section-tabs"
      className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="inline-flex min-w-full gap-1 rounded-lg border border-hairline bg-card p-1">
        {flikar.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            preload="intent"
            className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
            activeProps={{ className: "bg-secondary font-medium text-foreground" }}
            activeOptions={{ exact: tab.to === section.match }}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
