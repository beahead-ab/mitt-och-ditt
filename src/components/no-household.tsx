import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOwnHousehold } from "@/lib/auth/register.functions";

/**
 * Första steget för den som skapat ett konto själv.
 *
 * Den som lägger upp hushållet blir dess första part. Motparten kommer in
 * genom en inbjudan - aldrig genom att någon lägger till hen - och ingenting
 * kan börja gälla förrän båda har godkänt samma uppgifter. Det är samma
 * ordning som när en administratör lade upp hushållet; skillnaden är bara att
 * ingen administratör behövs.
 */
export function NoHousehold({ emailVerified }: { emailVerified: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const skapa = useMutation({
    mutationFn: () => createOwnHousehold({ data: { name } }),
    onSuccess: () => {
      toast.success("Hushållet är skapat");
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte skapa hushållet."),
  });

  if (!emailVerified) {
    return (
      <section className="tile-surface p-6">
        <p className="eyebrow">Ett steg kvar</p>
        <h2 className="mt-1 font-serif text-lg font-medium">Bekräfta din e-postadress</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Vi har skickat en länk till din adress. Tills den är bekräftad går det inte att skapa ett
          hushåll – det är den spärren som gör att ingen kan lägga beslag på någon annans adress.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Kolla skräpposten om det dröjer.</p>
      </section>
    );
  }

  return (
    <section className="tile-surface p-6">
      <p className="eyebrow">Uppstart · steg 1 av 4</p>
      <h2 className="mt-1 font-serif text-lg font-medium">Lägg upp ert hushåll</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Ge det ett namn ni båda känner igen – era förnamn, eller adressen. Sedan bjuder du in den
        andra parten, och ni fyller i bostaden och köpet tillsammans.
      </p>

      <form
        className="mt-5 grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          skapa.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="household-name">Namn på hushållet</Label>
          <Input
            id="household-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nora & Idris"
            required
          />
        </div>
        <Button type="submit" disabled={skapa.isPending || name.trim().length === 0}>
          {skapa.isPending ? "Skapar …" : "Skapa hushållet"}
        </Button>
      </form>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Du blir hushållets första part. Ingenting börjar gälla förrän båda har godkänt samma
        uppgifter – varken du eller den andra kan göra det ensam.
      </p>
    </section>
  );
}
