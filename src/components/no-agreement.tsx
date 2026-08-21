import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

/**
 * Visas innan hushållet har en gällande överenskommelse. Utan startvärden
 * finns ingenting att räkna på, och att visa nollor vore missvisande.
 */
export function NoAgreement({ loading }: { loading?: boolean }) {
  if (loading) {
    return (
      <div className="tile-surface p-10 text-center">
        <p className="text-sm text-muted-foreground">Hämtar underlaget …</p>
      </div>
    );
  }
  return (
    <div className="tile-surface p-10 text-center">
      <p className="text-sm font-medium">Ingen gällande överenskommelse än</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Startdag, startvärde och kapitalinsatser behöver fyllas i och godkännas av båda parter innan
        något kan beräknas.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link to="/overenskommelse">Till överenskommelsen</Link>
      </Button>
    </div>
  );
}
