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

På telefon visas samma uppgifter som kort i stället – en bred matris går inte att
läsa på en liten skärm.

## Drift

Se [`docs/drift.md`](docs/drift.md) för containerbygge, DigitalOcean och
säkerhetskopiering.

## Design

Gränssnittet delar designsystem med systerprodukten
[Bilkollen](https://bilkollen.goodstuff.se): varm benvit bakgrund, koppar som
primärfärg, Space Grotesk och DM Sans, vita kort med tunna kanter och tabulära
siffror. Språket i tjänsten är enkel svenska, och varje modellbegrepp går att
öppna med "Vad betyder detta?" och få förklarat med ett konkret exempel.
