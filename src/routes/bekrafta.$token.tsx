import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home as HomeIcon } from "lucide-react";

import { confirmEmail } from "@/lib/auth/register.functions";

/**
 * Bekräftelselänken från mailet.
 *
 * Löser in länken och loggar in på samma gång: den som just bevisat att
 * adressen är hens ska inte mötas av ett inloggningsformulär.
 */
export const Route = createFileRoute("/bekrafta/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Bekräfta e-postadress – Mitt & Ditt" }] }),
  component: BekraftaPage,
});

function BekraftaPage() {
  const { token } = Route.useParams();

  const svar = useQuery({
    queryKey: ["confirm-email", token],
    queryFn: async () => {
      const resultat = await confirmEmail({ data: { token } });
      // Hård navigering så att sessionskakan följer med i nästa förfrågan.
      if (resultat.ok) window.location.href = "/";
      return resultat;
    },
    retry: false,
    staleTime: Infinity,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>
        <div className="tile-surface p-6">
          {svar.isPending || svar.data?.ok ? (
            <>
              <p className="eyebrow mb-2">Bekräftar</p>
              <p className="text-sm text-muted-foreground">Ett ögonblick …</p>
            </>
          ) : (
            <>
              <p className="eyebrow mb-2">Länken gäller inte</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Den här bekräftelselänken är använd, för gammal eller felaktig. Skapa kontot på nytt
                så skickas en ny länk – har du redan bekräftat kan du logga in direkt.
              </p>
              <p className="mt-4 flex gap-4 text-sm">
                <Link to="/registrera" className="text-primary underline underline-offset-4">
                  Skapa konto
                </Link>
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  Logga in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
