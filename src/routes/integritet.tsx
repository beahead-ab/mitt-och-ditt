import { createFileRoute, Link } from "@tanstack/react-router";
import { Home as HomeIcon } from "lucide-react";

/**
 * Personuppgifter och integritet.
 *
 * Sidan är öppen utan inloggning med flit: den som ska ta ställning till om hen
 * vill använda tjänsten ska kunna läsa vad den sparar innan hen skapar ett
 * konto. Texten beskriver vad som faktiskt sker i koden - den juridiska
 * granskningen görs separat.
 */
export const Route = createFileRoute("/integritet")({
  head: () => ({ meta: [{ title: "Personuppgifter – Mitt & Ditt" }] }),
  component: IntegritetPage,
});

function Avsnitt({ rubrik, children }: { rubrik: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 font-serif text-lg font-medium">{rubrik}</h2>
      <div className="grid gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function IntegritetPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2">
          <HomeIcon className="size-5 text-primary" />
          <span className="font-serif text-xl font-medium tracking-tight">Mitt &amp; Ditt</span>
        </div>

        <h1 className="mb-2 font-serif text-2xl font-medium">Personuppgifter och integritet</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Tjänsten är ett dokumentations- och beräkningsverktyg för två personer som äger en bostad
          tillsammans. Den ger inga juridiska råd och ändrar inget formellt ägande.
        </p>

        <Avsnitt rubrik="Vad som sparas">
          <p>
            Namn och e-postadress för de konton som skapats, antingen genom en inbjudan eller genom
            registrering. Adressen bekräftas med en länk innan kontot kan användas till något.
            Uppgifterna om bostaden och överenskommelsen som parterna själva fyller i. Betalningar
            med belopp, datum, kategori och beskrivning. Underlag som parterna laddar upp, till
            exempel kvitton och fakturor. Vem som godkänt eller invänt mot vad, och när.
          </p>
          <p>
            Lösenord sparas aldrig i klartext utan bara som en beräkning som inte går att vända
            tillbaka. Inloggningar och inbjudningslänkar lagras enbart som hash.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Vem som kommer åt uppgifterna">
          <p>
            Bara hushållets två parter. Spärren ligger i databasen, inte i gränssnittet: en
            förfrågan utan inloggad identitet ser ingenting alls, och ingen kan se ett annat
            hushålls uppgifter.
          </p>
          <p>
            Administratören hanterar åtkomst - bjuder in, stänger av konton, sätter upp hushåll -
            men når inte transaktioner, avtal, underlag, slutavräkningar eller aktivitetslogg genom
            sin roll. Är samma person också part i ett hushåll når hen det hushållets innehåll i den
            egenskapen, vilket syns som ett medlemskap i avtalet och i loggen.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="E-post">
          <p>
            Tjänsten skickar inbjudningar, återställning av lösenord och besked om att något väntar
            på ett beslut. Mailen innehåller aldrig belopp, kvitton eller uppgifter om ekonomin - de
            säger vad som hänt och länkar till tjänsten.
          </p>
          <p>
            Mail passerar en mailleverantör som därmed ser avsändare, mottagare och ämnesrad.
            Beskedsmail om beslut går att stänga av under Konto; inbjudningar och säkerhetsmail är
            alltid på.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Vad som inte sker">
          <p>
            Ingen spårning, inga kakor för marknadsföring och ingen tredjepartsanalys. Den enda
            kakan som sätts är den som håller dig inloggad.
          </p>
          <p>
            Typsnitt och allt annat som sidan laddar kommer från tjänstens egen server. Inget
            externt anrop görs när du använder tjänsten, så ingen utomstående får veta när du är
            inne.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Hur länge uppgifterna sparas">
          <p>
            Underlaget är avsett att hålla så länge samägandet pågår och en tid därefter, eftersom
            det är det som gör en slutavräkning möjlig att kontrollera i efterhand.
          </p>
          <p>
            Ett underlag som tas bort raderas inte spårlöst: filen tas bort, men raden ligger kvar
            med storlek, kontrollsumma, vem som laddade upp den och när. Annars skulle
            aktivitetsloggens kedja brytas och underlaget sluta vara ett bevis. Det syns alltså att
            något tagits bort, men inte längre vad det innehöll.
          </p>
          <p>
            Godkännanden, gällande avtalsversioner och låsta slutavräkningar kan inte ändras eller
            raderas av någon - inte heller av den som administrerar tjänsten. Det är avsiktligt:
            hela poängen är att de ska gå att lita på i efterhand.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Att få ut sina uppgifter">
          <p>
            Under Transaktioner och Överenskommelse går allt att exportera som CSV, Markdown eller
            PDF. Aktivitetsloggen exporteras under Systemadmin, med en kontroll av att kedjan är
            obruten.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Var uppgifterna ligger">
          <p>
            På en server i Europa, tillsammans med säkerhetskopior. Kopior utanför servern är
            krypterade.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Ansvar">
          <p>
            Den som driver installationen ansvarar för uppgifterna. Frågor om rättelse eller
            radering tas med den personen. Den här texten beskriver hur tjänsten fungerar; den
            juridiska formuleringen granskas separat.
          </p>
        </Avsnitt>

        <p className="mt-10 text-sm">
          <Link to="/auth" className="text-primary underline underline-offset-4">
            Till inloggningen
          </Link>
        </p>
      </div>
    </div>
  );
}
