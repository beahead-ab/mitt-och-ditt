import { Link, useRouterState } from "@tanstack/react-router";

type Tab = { to: string; label: string };
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
      { to: "/system/anvandare", label: "Användare" },
      { to: "/system/hushall", label: "Hushåll" },
      { to: "/system/inbjudningar", label: "Inbjudningar" },
      { to: "/system/mail", label: "Mailstatus" },
      { to: "/system/revision", label: "Revisionsunderlag" },
    ],
  },
];

export function sectionFor(pathname: string) {
  return SECTIONS.find((s) => pathname === s.match || pathname.startsWith(`${s.match}/`)) ?? null;
}

/** Fast, horisontellt scrollbar flikrad för aktuell sektion. */
export function SectionTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = sectionFor(pathname);
  if (!section) return null;

  return (
    <nav
      aria-label="Sektionsflikar"
      data-testid="section-tabs"
      className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="inline-flex min-w-full gap-1 rounded-lg border border-hairline bg-card p-1">
        {section.tabs.map((tab) => (
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
