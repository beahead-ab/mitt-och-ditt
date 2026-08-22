import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Home as HomeIcon, LogOut, Menu } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHousehold } from "@/components/household-context";
import { SectionTabs } from "@/components/section-tabs";
import { useMyParty } from "@/hooks/use-my-party";
import { useMyTurn } from "@/hooks/use-my-turn";
import { signOut as endSession } from "@/lib/auth/auth.functions";
import { isDemo } from "@/lib/demo";

type NavItem = { to: string; label: string };

/**
 * De fem sektionerna som är parets arbete.
 *
 * Mitt konto och Systemadmin ligger inte här: de är inte något paret gör
 * tillsammans, och att blanda in dem gjorde navigationen till en lista över
 * allt som finns i stället för en över vad man kan göra. De når man genom
 * kontomenyn till höger.
 */
const NAV: NavItem[] = [
  { to: "/", label: "Översikt" },
  { to: "/transaktioner", label: "Transaktioner" },
  { to: "/overenskommelse", label: "Överenskommelse" },
  { to: "/simulator", label: "Simulator" },
  { to: "/forsaljning", label: "Försäljning" },
];

const KONTO: NavItem[] = [{ to: "/konto", label: "Mitt konto" }];
const ADMIN: NavItem[] = [{ to: "/system/anvandare", label: "Systemadmin" }];

export function AppShell({ children }: { children: ReactNode }) {
  const { household, isAdmin } = useHousehold();
  const navigate = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const { count: minTur } = useMyTurn();
  const myPartyId = useMyParty();

  // Förnamnet räcker och håller knappen smal. Utan part - innan hushållet
  // finns - står det neutralt "Mitt konto".
  const jag = household?.parties.find((party) => party.partyId === myPartyId)?.name;
  const förnamn = jag?.split(" ")[0];

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Under en pågående navigation pekar location på målet medan children
  // fortfarande är föregående sidas element. Rendera då ett neutralt tomt
  // lager i stället för att blanda ny header med gammalt innehåll.
  const resolvedPathname = useRouterState({
    select: (s) => s.resolvedLocation?.pathname ?? s.location.pathname,
  });
  const isTransitioning = resolvedPathname !== pathname;

  // Stäng lådan så fort routen ändras (även vid back/forward).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Förladda sektionernas kod. Nu när de syns hela tiden är det troligt att
  // någon av dem är nästa steg, oavsett om lådan öppnats.
  useEffect(() => {
    for (const item of [...NAV, ...KONTO]) {
      void router.preloadRoute({ to: item.to }).catch(() => {});
    }
  }, [router]);

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
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <HomeIcon className="size-4 text-primary" />
            <span className="font-serif text-base font-medium tracking-tight">Mitt &amp; Ditt</span>
          </Link>

          {/* Sektionerna syns direkt på skärmar med plats. Under 768 px finns
              de i lådan i stället - en rad med fem poster får inte plats där
              utan att bli för trång att träffa. */}
          <nav aria-label="Sektioner" className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                preload="intent"
                data-testid={`nav-${item.to}`}
                className="flex items-center gap-1.5 px-2.5 py-[18px] text-sm text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{
                  className: "font-medium text-foreground shadow-[inset_0_-2px_0_var(--copper)]",
                }}
                activeOptions={{ exact: item.to === "/" }}
              >
                {item.label}
                {item.to === "/transaktioner" && minTur > 0 && (
                  <span
                    data-testid="nav-min-tur"
                    className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                  >
                    {minTur}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {isDemo && (
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                Demoläge
              </span>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="konto-meny"
                  className="hidden h-8 gap-1 px-2.5 text-[13px] font-normal md:inline-flex"
                >
                  {förnamn ?? "Mitt konto"}
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {[...KONTO, ...(isAdmin ? ADMIN : [])].map((item) => (
                  <DropdownMenuItem key={item.to} asChild>
                    <Link to={item.to} preload="intent">
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="size-3.5" /> Logga ut
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="relative size-8 shrink-0 md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Meny"
            >
              <Menu className="size-4" />
              {minTur > 0 && (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
              )}
            </Button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-hairline bg-card md:hidden">
            <div className="mx-auto max-w-5xl px-4 py-3">
              <div className="grid gap-0.5">
                {[...NAV, ...KONTO, ...(isAdmin ? ADMIN : [])].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    preload="intent"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-secondary"
                    activeProps={{ className: "bg-secondary font-medium" }}
                    activeOptions={{ exact: item.to === "/" }}
                  >
                    {item.label}
                    {item.to === "/transaktioner" && minTur > 0 && (
                      <span className="tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                        {minTur}
                      </span>
                    )}
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
        {isTransitioning ? <div data-testid="route-transition" aria-hidden /> : children}
      </main>
    </div>
  );
}

/**
 * Sidhuvudet, med sektionens flikrad under rubriken.
 *
 * Flikarna låg tidigare ovanför rubriken, vilket gjorde att sidan började med
 * en rad val i stället för med vad sidan handlar om. Nu står rubriken först
 * och flikarna säger var i sektionen man är.
 */
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
    <>
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
      <SectionTabs />
    </>
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
