# Mitt & Ditt

Beräknings-, dokumentations- och bevisverktyg för två personer som köper och
äger en bostadsrätt tillsammans. Tjänsten följer ett separat undertecknat avtal
och ger ingen juridisk rådgivning – den räknar, dokumenterar och bevarar.

Tjänsten hjälper paret att:

- dokumentera vad de kommit överens om,
- registrera betalningar och underlag,
- godkänna varandras transaktioner,
- se hur överbetalningar påverkar deras interna ekonomiska andelar,
- simulera olika framtida bostadsvärden,
- genomföra en spårbar slutavräkning vid försäljning eller utköp.

Den interna ekonomiska andelen används bara i avräkningen mellan parterna. Den
ändrar aldrig den formella ägarandelen i bostadsrätten.

## Komma igång

```sh
npm install
cp .env.example .env    # VITE_DEMO=1 visar gränssnittet med exempeldata
npm run dev
```

| Kommando | Gör |
|---|---|
| `npm run dev` | Utvecklingsserver |
| `npm run lint` | ESLint och Prettier |
| `npm run typecheck` | TypeScript |
| `npm test` | Beräkningsmotorns testsvit |
| `npm run build` | Bygger till `.output` (Nitro node-server) |
| `npm run db:migrate` | Kör migreringarna |
| `npm run db:seed` | Skapar hushållet och skriver ut inbjudningslänkar |

Integrationstesterna för radnivåsäkerhet kräver en Postgres. Saknas den hoppas
de över lokalt, men aldrig i CI – säkerhetstester som tyst försvinner är
farligare än inga alls.
| `npm run preview` | Kör den byggda servern |

## Beräkningsmotorn

`src/lib/engine` är hjärtat: ren, deterministisk och utan beroenden till
databas, nätverk eller React. Den räknar alltid om från avtalets startdag, så en
rättelse behöver bara ändra indata.

Motorn implementerar avtalets punkt 7–15: linjärt beräknat bostadsvärde per
kalenderdag, nettokapital, värde per andelsenhet, nettokostnad efter faktisk
skatteeffekt, kronologisk nettning per betalningsdag med rekursiv kostnadsnyckel,
spärrarna vid negativt nettokapital och otillräckliga enheter, personliga
fordringar, kostnader utanför enhetsmodellen samt slutavräkning med
summakontroller.

Belopp räknas i heltal öre och avrundas symmetriskt bort från noll, så att båda
parter behandlas exakt likadant. Ekonomiska datum är kalenderdatum och kan inte
förskjutas av tidszoner.

`ENGINE_VERSION` stämplas på varje beräkning: en slutavräkning ska kunna räknas
om och ge samma resultat, och då måste det framgå vilken version som gav det
ursprungliga.

Testsviten täcker avtalets bilaga 1 (exempel 1–10), egenskaper som alltid måste
gälla – symmetri mellan parterna, oberoende av registreringsordning, konstant
antal andelsenheter, determinism – samt kantfall för godkännanden,
korrigeringar, klassificeringar och lånesaldon.

## Vad som är konfigurerbart

Avtalets **parametrar** är konfigurerbara: startdag, startvärde, kapitalinsatser,
startenheter, kostnadsslagens klassificering med giltighetsdatum, särskilda
kostnadsnycklar, formella ägarandelar och fristerna i separationsprocessen.

Avtalets **struktur** är det inte: den linjära formeln, att överbetalning blir
andelsenheter, den kronologiska nettningen och spärrarna. Avtalets punkt 25.1
kräver undertecknat tilläggsavtal för att ändra dem, så de får inte vara en
inställning i tjänsten. Se `docs/losningsforslag.md`.

## Listor som kalkylark

Poster visas i ett rutnät med kalkylarkskänsla, eftersom underlaget i dag är ett
Google-ark och den vanan är värd att behålla. Rutnätet har fast huvudrad,
radnummer och fryst ID-kolumn, och navigeras med tangentbordet: pilar flyttar
markören, Skift utökar urvalet, Tabb radbryter, Home och End går till radens
kanter och Ctrl lägger till hopp till rutnätets hörn. Ctrl+C kopierar urvalet
som tabbseparerad text, som klistras in direkt i Excel eller Google Sheets.

Vyn är läsande. Ekonomiska poster ändras aldrig genom att skriva i en cell, utan
genom en korrigeringspost som båda parter godkänner.

Celler som har ändrats får en hörnmarkör, och högerklick visar varje ändring med
värdet före och efter, vem som gjorde den och när den började gälla. På
historiksidan går det att välja en tidigare tidpunkt och se både posterna och
beräkningen som de såg ut då.

På telefon visas samma uppgifter som kort i stället – en bred matris går inte att
läsa på en liten skärm.

## Godkännandeflödet

Den som registrerar en post bekräftar den i samma steg – det är hens
godkännande. Motparten godkänner eller invänder separat. Först när båda har
godkänt påverkar posten andelarna.

| Läge | Vad som gäller |
|---|---|
| Utkast | Bara registratorn ser posten. Kan ändras, skickas in eller raderas. |
| Väntar | Motparten godkänner eller invänder. Registratorn kan dra tillbaka. |
| Tvistig | En invändning tar posten ur beräkningen tills den lösts med en korrigering. |
| Godkänd | Posten räknas. Den kan bara korrigeras eller makuleras, aldrig ändras. |

Övergången till "gäller" sker i databasen och drivs av godkännanderaderna.
Klienten kan alltså inte sätta en post i kraft genom att skriva rätt fält – den
kan bara avge sitt eget godkännande. Otillgängliga åtgärder döljs inte i
gränssnittet utan visas med sitt skäl, så att det syns *varför* något inte går.

Samma regel gäller avtalsversioner och ändrade kostnadsslag: båda parter måste
godkänna innan de börjar gälla.

## Underlag

Kvitton och bankunderlag laddas upp som bild eller PDF. Filerna ligger utanför
webbroten och nås bara genom en behörighetskontrollerad nedladdning – en gissad
adress ger 404, oavsett om bilagan finns. Varje fil hashas med sha256 vid
uppladdningen.

En bilaga raderas inte utan **maskeras**: filen tas bort, men raden ligger kvar
med hash, storlek, uppladdare och tidpunkt. Aktivitetsloggens kedja förblir
obruten och det syns att något har tagits bort. Det är så rätten till radering
går att förena med ett oföränderligt underlag.

Översikten räknar saknade underlag mot faktiska bilagor. En beskrivning är inget
underlag.

## Ingenting raderas

| Läge | Vad som händer |
|---|---|
| Utkast, bara registratorn har sett det | Får raderas. Raderingen noteras i aktivitetsloggen. |
| Väntar på godkännande | Kan återkallas. Posten ligger kvar, märkt som återkallad. |
| Godkänd | Makuleras med en ny, länkad post som båda godkänner. Originalet ligger kvar synligt. |
| Kostnadsklassificering | Upphävs från ett datum, aldrig retroaktivt. |

Korrigering och makulering är samma mekanism: en korrigering ersätter posten med
nya värden, en makulering ersätter den med ingenting. Båda kräver båda parters
godkännande och lämnar originalet orört och länkat. Kravet kommer från avtalets
punkt 14.3.

## Säkerhet

Tjänsten är endast för inbjudna – det finns ingen öppen registrering. Lösenord
hashas med scrypt, och sessions- och inbjudningstoken lagras bara som hash, så en
läckt databasdump ger ingen tillgång.

All dataåtkomst går genom Postgres radnivåsäkerhet. Applikationen använder en
egen databasroll och sätter den inloggades identitet per transaktion; utan den
ser rollen ingenting. Spärrarna ligger alltså i databasen, inte i gränssnittet:

- ingen kan godkänna åt den andra parten, och inte heller i eget namn men med
  motpartens partsroll,
- en gällande version kan inte ändras eller raderas av någon roll, inte ens
  ägaren,
- ett avgivet godkännande kan inte tas tillbaka i efterhand,
- aktivitetsloggen kan bara läggas till i, och varje rad hashar föregående rad så
  att en ändring i efterhand bryter kedjan och går att upptäcka.

Personnummer lagras inte någonstans. De finns i det undertecknade avtalet och
behövs inte för någon funktion här.

Allt detta är testat mot en riktig Postgres, inte bara läst i SQL-filerna.

## Exporter

| Vad | Format | Var |
|---|---|---|
| Transaktionshistorik | CSV | Historik |
| Dagsberäkning | CSV | Historik |
| Sammanställning | PDF och Markdown | Översikt |
| Överenskommelse | PDF och Markdown | Överenskommelse |
| Revisionsunderlag | CSV | Systemadmin |

CSV-filerna öppnas direkt i svenska Excel: semikolon som avgränsare,
decimalkomma och byte order mark, så att å, ä och ö inte blir kråkfötter.

PDF:erna genereras ur samma Markdown som textversionen, så pappersversionen och
textversionen kan aldrig säga olika saker.

Revisionsunderlaget exporteras bara om hashkedjan är obruten. Är den bruten
avbryts exporten och raden pekas ut i stället – ett underlag med en bruten kedja
vore värre än inget.

## Drift

Se [`docs/drift.md`](docs/drift.md) för containerbygge, DigitalOcean och
säkerhetskopiering.

## Design

Gränssnittet delar designsystem med systerprodukten
[Bilkollen](https://bilkollen.goodstuff.se): varm benvit bakgrund, koppar som
primärfärg, Space Grotesk och DM Sans, vita kort med tunna kanter och tabulära
siffror. Språket i tjänsten är enkel svenska, och varje modellbegrepp går att
öppna med "Vad betyder detta?" och få förklarat med ett konkret exempel.
