import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { Home as HomeIcon, LogOut, Menu } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useHousehold } from "@/components/household-context";
import { SectionTabs } from "@/components/section-tabs";
import { signOut as endSession } from "@/lib/auth/auth.functions";
import { isDemo } from "@/lib/demo";

type NavItem = { to: string; label: string; adminOnly?: boolean };

/** Exakt sju huvudval – inga underlänkar i menyn. */
const NAV: NavItem[] = [
  { to: "/", label: "Översikt" },
  { to: "/transaktioner", label: "Transaktioner" },
  { to: "/overenskommelse", label: "Överenskommelse" },
  { to: "/simulator", label: "Simulator" },
  { to: "/forsaljning", label: "Försäljning & utköp" },
  { to: "/konto", label: "Mitt konto" },
  { to: "/system/anvandare", label: "Systemadmin", adminOnly: true },
];

const CRUMBS: { match: string; label: string }[] = [
  { match: "/transaktioner/vantar", label: "Väntar på godkännande" },
  { match: "/transaktioner/historik", label: "Historik" },
  { match: "/transaktioner", label: "Registrera" },
  { match: "/overenskommelse/kostnadsslag", label: "Kostnadsslag" },
  { match: "/overenskommelse/versioner", label: "Avtalsversioner" },
  { match: "/overenskommelse/tillagg", label: "Tilläggsavtal" },
  { match: "/overenskommelse/parter", label: "Parter" },
  { match: "/overenskommelse", label: "Gällande överenskommelse" },
  { match: "/simulator", label: "Simulator" },
  { match: "/forsaljning/varderingar", label: "Värderingar" },
  { match: "/forsaljning/slutavrakning", label: "Slutavräkning" },
  { match: "/forsaljning", label: "Försäljning & utköp" },
  { match: "/konto", label: "Mitt konto" },
  { match: "/system/revision", label: "Revisionsunderlag" },
  { match: "/system", label: "Systemadmin" },
];

/** Sidor som är personliga eller globala – där visas ingen hushållsrad. */
function isPersonal(pathname: string) {
  return pathname.startsWith("/konto") || pathname.startsWith("/system");
}

export function AppShell({ children }: { children: ReactNode }) {
  const { household, isAdmin } = useHousehold();
  const navigate = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Under en pågående navigation pekar location på målet medan children
  // fortfarande är föregående sidas element. Rendera då ett neutralt tomt
  // lager i stället för att blanda ny header/flikrad med gammalt innehåll.
  const resolvedPathname = useRouterState({
    select: (s) => s.resolvedLocation?.pathname ?? s.location.pathname,
  });
  const isTransitioning = resolvedPathname !== pathname;

  // Stäng menyn så fort routen ändras (även vid back/forward).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Förladda menyroutes kod när menyn öppnas.
  useEffect(() => {
    if (!open) return;
    for (const item of NAV) {
      void router.preloadRoute({ to: item.to }).catch(() => {});
    }
  }, [open, router]);

  // Spacern ska alltid matcha den fixerade headerns höjd exakt.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  async function signOut() {
    if (!isDemo) await endSession();
    // Hård navigering så att den rensade sessionskakan slår igenom.
    window.location.href = "/auth";
  }

  return (
    <div className="min-h-screen bg-background">
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-40 border-b border-hairline bg-background/95 backdrop-blur"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <HomeIcon className="size-4 text-primary" />
            <span className="font-serif text-base font-medium tracking-tight">Mitt &amp; Ditt</span>
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {isDemo && (
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                Demoläge
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => setOpen((v) => !v)}
              aria-label="Meny"
            >
              <Menu className="size-4" />
            </Button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-hairline bg-card">
            <div className="mx-auto max-w-5xl px-4 py-3">
              <div className="grid gap-0.5">
                {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    preload="intent"
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2.5 text-sm hover:bg-secondary"
                    activeProps={{ className: "bg-secondary font-medium" }}
                    activeOptions={{ exact: item.to === "/" }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              <button
                onClick={signOut}
                className="mt-4 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary"
              >
                <LogOut className="size-3.5" /> Logga ut
              </button>
            </div>
          </nav>
        )}
      </header>

      <div aria-hidden style={{ height: headerHeight }} />

      <main data-testid="app-main" className="mx-auto max-w-5xl px-4 py-8">
        <ContextCrumb pathname={pathname} householdName={household?.name ?? null} />
        <SectionTabs />
        {isTransitioning ? <div data-testid="route-transition" aria-hidden /> : children}
      </main>
    </div>
  );
}

function ContextCrumb({
  pathname,
  householdName,
}: {
  pathname: string;
  householdName: string | null;
}) {
  if (pathname === "/") return null;
  const crumb = CRUMBS.find((c) => pathname === c.match || pathname.startsWith(`${c.match}/`));
  if (!crumb) return null;

  const parts = isPersonal(pathname)
    ? [crumb.label]
    : [householdName ?? "Inget hushåll", crumb.label];

  return (
    <p className="mb-3 text-xs text-muted-foreground" data-testid="context-crumb">
      {parts.join(" → ")}
    </p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  info,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  info?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <div className="flex items-center gap-1.5">
          <h1 className="truncate text-2xl font-medium tracking-tight sm:text-3xl">{title}</h1>
          {info}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="tile-surface p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
