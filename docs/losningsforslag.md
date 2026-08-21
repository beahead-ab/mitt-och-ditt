# Mitt & Ditt — lösningsförslag och feedback på scopet

**Status:** beslutsunderlag innan bygget startar · **Datum:** 2026-08-21 · **Underlag:** uppdragsbeskrivningen, Samboavtal/delägaravtal V8 (punkt 1–28 + bilaga 1–4), Avräkningsmodell V8 (alla tre flikar inkl. de dolda beräkningskolumnerna O–AS), Bilkollens kodbas.

Det här dokumentet beskriver lösningen som jag tycker att den ska byggas. Där jag avviker från eller kompletterar uppdragsbeskrivningen säger jag det uttryckligen och motiverar varför. Sist finns byggordning och de få frågor som behöver svar — med rekommenderade default-svar så att bygget inte blockeras.

---

## 1. Samlad bedömning

Scopet är ovanligt väl genomarbetat: avtalet, Excel-arket och uppdragsbeskrivningen hänger ihop och beräkningsreglerna är entydiga nog att implementera deterministiskt. Jag har verifierat uppdragsbeskrivningens formler mot arkets faktiska formler och mot avtalets punkter 7–15 — de stämmer överens, med några nyanser som beskrivs i avsnitt 4.

Mina viktigaste synpunkter i korthet:

1. **Beräkningsmotorn ska vara en exakt, versionerad och golden-testad implementation av avtalet** — inte en app-funktion bland andra. Den byggs först, fristående, och verifieras mot arkets exempel innan någon skärm byggs. (Avsnitt 2.)
2. **Kostnader utanför modellen (BRF-avgift, försäkring) saknar helt hantering i Excel-arket** — arket ignorerar dem. Uppdragsbeskrivningen kräver 50/50-visning och krona-för-krona-reglering, så appen blir första stället där detta faktiskt förs. Det är rätt, men det är ny funktionalitet, inte en portering. (Avsnitt 3.1.)
3. **Andelarna är preliminära i prognosläge — och det måste synas.** Eftersom värdet per andelsenhet beror på antaget slutvärde ändras även *historiska* enhetsöverföringar när antagandet ändras (avtal 6.4). Översikten får aldrig presentera andelarna som fastställda. (Avsnitt 2.4.)
4. **Vissa delar bör medvetet skjutas till v2**: dödsfallsflödet, notiser/e-post, native-app, komplett revisionsexport. (Avsnitt 3.9.)
5. **En infrastrukturfråga behöver svar före backend-bygget**: Lovable Cloud som Bilkollen, eller fristående Supabase. Motorn och UI:t byggs identiskt oavsett. (Avsnitt 7, fråga 1.)

---

## 2. Beräkningsmotorn — systemets kärna

### 2.1 Ren, deterministisk, versionerad

Motorn byggs som en fristående TypeScript-modul (`src/lib/engine/`) utan beroenden på databas, React eller nätverk:

```
EngineInput (snapshot)  →  beräkning  →  EngineResult (händelser + slutlägen + kontroller)
```

- **Input:** avtalsparametrar (startdag, startvärde, initialt lån, startenheter per part, totala enheter), slutpunkt (slutdag, slutvärde, läge `prognos`/`slutlig`), gällande kostnadsklassificeringar med giltighetsdatum, alla godkända transaktioner med betalningar/förmåner per part, lånesaldohändelser.
- **Output:** per betalningsdag — linjärt värde, använt lånesaldo, nettokapital, värde per enhet, dagens nettning, enhetsöverföring, ev. personlig fordran — samt slutliga enheter/andelar per part, 50/50-saldot utanför modellen, och automatiska kontroller (enhetssumma, andelssumma, positionssumma).
- **`ENGINE_VERSION`** exporteras och stämplas på varje sparad körning. Varje slutavräkning kan återskapas ur (avtalsversion, godkända transaktioner, lånesaldon, slutdag, slutvärde, motorversion) — precis som uppdragsbeskrivningen kräver.
- **Motorn räknar alltid om från början.** Ingen inkrementell state. Det gör avtalets omräkningskrav (10.5, 11.4 — "räkna om från ursprungliga betalningsdagen") trivialt: en korrigering ändrar bara inputen, och nästa körning blir automatiskt rätt.

### 2.2 Precision och avrundning — ett beslut uppdragsbeskrivningen inte täcker

Arket räknar i flyttal och nöjer sig med toleranskontroller (`ABS(...)<0,01`). För ett bevisverktyg vill jag ha en uttalad policy:

- Belopp hanteras internt i **öre** (heltal) där det går; enheter och andelar som decimaltal med **6 decimalers dokumenterad precision** (enheter är per definition bråktal — bilaga 1 exempel 6 ger 6 666,67 enheter).
- **Ingen avrundning i mellansteg.** Avrundning sker endast vid presentation (kronor: 2 decimaler; andelar: 4 decimaler, som avtalets 86,9565 %) och i slutavräkningens utbetalningsrader (hela ören, dokumenterad halv-upp-regel).
- **Verifieringstolerans mot V8-arket: ±1 kr** per slutposition. Importflödet (avsnitt 5.7) visar avvikelser mot arkets siffror explicit i importrapporten.
- Dagräkning görs i **kalenderdagar** (`differenceInCalendarDays`), aldrig via timestamps — ekonomiska datum lagras som `date` och kan inte förskjutas av tidszoner.

### 2.3 Trogen avtalet, renare än arket

Arkets konstruktion "sista godkända raden på dagen bär hela dagens nettotransfer" är ett kalkylblads-trick. Motorn gör samma sak strukturerat: transaktioner grupperas per betalningsdag, varje posts över-/underbetalning beräknas med sin nyckel (ordinarie rekursiv nyckel eller särskild nyckel per post), dagens skillnader summeras, och **en** nettoöverföring görs per dag med lånesaldot efter dagens samtliga amorteringar (avtal 8.3, 9.2, 10.3). Registreringsordning kan aldrig påverka utfallet eftersom motorn sorterar på betalningsdag och nettar per dag.

Spärrarna implementeras exakt som avtalet och arket:

- Nettokapital ≤ 0 → ingen överföring, hela överbetalningen blir personlig fordran (9.4).
- Överföring begränsas till motpartens tillgängliga enheter; överskott blir fordran (10.4).
- Samma belopp kan aldrig bli både enheter och fordran (10.2) — motorn returnerar omvandlat belopp och fordransbelopp som separata, summakontrollerade fält.
- **Fordringar omvandlas aldrig retroaktivt.** En överbetalning som inte kunde omvandlas på sin betalningsdag förblir nominell fordran och regleras i kronor (löpande eller i slutavräkningen). Så fungerar både avtalet (14.5) och arket, och så bygger vi.

### 2.4 Prognosläge: preliminära andelar är en produktegenskap

I prognosläge beror värdet per enhet på antaget slutvärde och antagen slutdag — alltså ändras även redan gjorda överföringar när antagandet ändras. Det är avsiktligt (avtal 6.4) men kontraintuitivt. Därför:

- Översikten visar alltid vilken beräkningsgrund som gäller: **"Prognos (antaget slutvärde X, slutdag Y)"** eller **"Slutavräkning"**.
- Andelar i prognosläge etiketteras "preliminära" med en "Vad betyder detta?"-förklaring som visar samma siffror under två olika antaganden.
- **Standardantagande** (min rekommendation, se fråga 5): *"avräkning idag till startvärdet"* — slutdag = idag, slutvärde = startvärde. Det är det mest neutrala läget ("vad händer om vi avräknar nu utan värdeförändring?") och kräver inga gissningar om marknaden. Parterna kan spara egna scenarier i simulatorn och välja ett som översiktens standard.

### 2.5 Testning

- **Golden tests** som återskapar avtalets bilaga 1, exempel 1–10, med exakta förväntade tal (8 000 enheter för tvättmaskinen, 5 600 kr ränteöverbetalning, 6 666,67 enheter vid sen betalning, 4 900 000 kr linjärt mellanvärde, osv.).
- **Egenskapstester:** symmetri (byt parternas roller → speglat resultat), ordningsoberoende (blanda registreringsordning → identiskt resultat), enhetskonservering (summan alltid = totala startenheter), summakontroller (slutpositioner = försäljningsnetto, andelar = 100 %).
- **Kantfall:** betalningsdag före startdag/efter slutdag (avvisas respektive flaggas, som arkets KONTROLLERA-kolumn), slutdag = startdag, negativt försäljningsnetto, negativ nettokostnad, blandade särskilda nycklar samma dag, amortering och annan kostnad samma dag.
- Testfixturer checkas in som JSON härledda ur arket — själva V8-filen (privat dokument) checkas inte in i repot.

---

## 3. Feedback på scopet — vad jag föreslår ändras, förtydligas eller skjuts upp

### 3.1 Kostnader utanför modellen behöver en egen, enkel liggare

Excel-arket **ignorerar** poster vars kostnadsslag är "Ingår inte" — de blir inaktiva rader utan någon beräkning alls. Uppdragsbeskrivningen kräver mer: 50/50-visning och krona-för-krona-reglering när någon betalat mer än sin del. Jag föreslår:

- Samma transaktionsregistrering och godkännandeflöde används för alla kostnader; kostnadsslagets klassificering på betalningsdagen avgör om posten går in i enhetsmodellen eller i **50/50-liggaren** (eller annan avtalad fördelning per kostnadsslag).
- Liggaren är en löpande saldovy i kronor ("Felicia ligger ute med 1 240 kr utanför modellen") utan värdeuppräkning, med möjlighet att markera "reglerad" när man swishat — båda bekräftar.
- Saldot tas med som post i slutavräkningen om det inte reglerats löpande.

Detta är ny funktionalitet som inte kan verifieras mot arket — den verifieras mot avtalets punkt 7.2 i stället.

### 3.2 Korrigeringar: ersättningssemantik, inte deltasemantik

Uppdragsbeskrivningen kräver länkade korrigeringsposter men definierar inte vad korrigeringen *är*. Jag föreslår **ersättningssemantik**: en korrigeringspost är en komplett ny version av posten (alla fält), som när båda godkänt den ersätter originalet i beräkningen. Originalet behålls synligt, märkt "ersatt av K-0007". Alternativet (deltaposter som justerar belopp) är svårare att granska och lätt att göra fel. Sena händelser som hör till en befintlig post — försäkringsersättning, slutligt skattebesked — registreras som korrigering av originalposten, inte som egen post, så att nettokostnaden (avtal 7.5) alltid ligger samlad på rätt betalningsdag.

### 3.3 Registrering räknas som registratorns godkännande

"Båda parters godkännande" bör i praktiken betyda: den som registrerar bekräftar posten i samma flöde (explicit knapp, loggas som godkännande), motparten godkänner separat. Att kräva att registratorn ska gå tillbaka och godkänna sin egen post i ett separat steg ger bara friktion utan bevisvärde. Spärren som betyder något — **ingen kan godkänna för den andra** — tvingas i databasen (RLS: godkännanderaden måste ha `user_id = auth.uid()`), inte bara i UI:t.

### 3.4 Motparten måste kunna invända, inte bara godkänna

Avtalet (14.2) förutsätter att en tvistig post ligger utanför beräkningen tills den lösts. Uppdragsbeskrivningen nämner bara godkännande. Transaktionsflödet får därför tre utfall: **godkänn**, **invänd** (med motivering — posten blir "tvistig" och utesluts ur beräkningen) och **väntar**. Tvistiga poster syns på översikten tills de lösts via korrigering eller tillbakadragande.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Utkast
    Utkast --> VäntarPåMotpart : registrator bekräftar
    VäntarPåMotpart --> Godkänd : motpart godkänner
    VäntarPåMotpart --> Tvistig : motpart invänder
    Tvistig --> VäntarPåMotpart : korrigering registreras
    Godkänd --> Ersatt : korrigering godkänd av båda
```

### 3.5 Lånesaldo: härlett med explicita avstämningspunkter

Arket låter användaren skriva in saldot per rad och bär senaste värdet framåt. Jag föreslår att appen i stället **härleder** saldot: initialt lån − summan av godkända amorteringar, med möjlighet till explicita saldoavstämningar (`loan_balance_snapshots`) som korrigerar härledningen vid omläggningar eller avvikelser. Översikten varnar när härlett saldo och senaste avstämning glider isär. Det ger färre manuella fel än arkets fria textfält och behåller spårbarheten.

### 3.6 Lagra inga personnummer alls

Uppdragsbeskrivningen säger "inte i flera tabeller". Jag föreslår **noll tabeller**: personnumren finns i det undertecknade pappersavtalet och behövs inte för någon funktion i appen. Namn + e-post + användar-ID räcker. Då försvinner hela riskklassen (loggar, exporter, backuper).

### 3.7 Fastighetsmäklarvärderingar och skatt: dokumentation, inte beräkning

Utköpsflödet implementerar värderingsregeln mekaniskt (två värderingar → 10 %-regeln → ev. tredje → median) och visar beräkningen öppet. Men **kapitalvinstskatt beräknas inte av appen** — den visas som separata, manuellt ifyllda upplysningsfält per part i slutavräkningen, med avtalets brasklapp (15.6). Att bygga skattelogik vore både fel scope och en falsk trygghet.

### 3.8 Pedagogiska exempel drivs av riktiga motorn

Bilaga 1-exemplen läggs in som **körbara fixturer genom samma beräkningsmotor** och renderas i "Vad betyder detta?"-dialoger. Då kan exemplen aldrig glida isär från verklig beräkning, och "Caesar överbetalar"-exemplet är bokstavligen samma fixture med parterna spegelvända — vilket dessutom är ett permanent symmetritest i UI:t.

### 3.9 Skjuts medvetet till v2

| Skjuts upp | Motivering |
|---|---|
| Dödsfallsflödet (avtal 22) | Datamodellen förbereds (exitprocess-typ `dödsfall`), men UI och tidsfrister byggs inte i v1. Känsligt flöde som förtjänar egen omgång. |
| Notiser, e-post, push | Två användare som ses varje dag behöver inte push för "väntar på godkännande" i v1 — översiktens statuskort räcker. Bilkollens notisinfrastruktur kan porteras senare. |
| Native-app (Capacitor) | Webb räcker för v1; mobilanpassad design från dag ett. |
| Komplett revisionsexport (zip) | Slutavräkningsprotokoll, transaktionsexport och avtalsexport byggs i v1; komplett zip-paket i v1.1. |
| Nyttjandeersättning efter processdag (avtal 21) | Visas som checklista/påminnelse i exitprocessen, men beräknas inte. |
| Regressfordringar med dröjsmålsränta (avtal 12.3) | Kan registreras som manuell personlig fordran med anteckning; ränteberäkning enligt räntelagen byggs inte i v1. |
| Fler hushåll i samma installation | Datamodellen är multi-hushåll från dag ett (RLS kräver det ändå), men onboarding/administration för nya par poleras senare. |

Inget av detta blockerar Caesar och Felicias användning.

---

## 4. Fynd i avtalet och arket som uppdragsbeskrivningen inte täcker

Dessa ska in i bygget (eller åtminstone i backloggen) även om prompten inte nämner dem:

1. **14-dagarsfristen (17.1):** den som vill överta bostaden ska meddela det senast 14 dagar efter processdagen. Exitprocessens tidslinje får alltså **två** frister, inte bara tremånadersregeln.
2. **Kostnadsklassificeringar har giltighetsdatum (25.2):** vid flera godkända klassificeringar av samma kostnadsslag gäller den med senaste giltighetsdag *som inte ligger efter betalningsdagen*. Arket implementerar exakt detta (LOOKUP på datum). Datamodellen behöver alltså en temporal regeltabell — en klassificering är aldrig en enkel boolean på kategorin.
3. **Initialt kapital får inte dubbelregistreras (7.1):** insatserna hanteras uteslutande via startenheterna. Appen varnar om någon försöker registrera en transaktion som ser ut som en kapitalinsats på startdagen.
4. **Kvartalsavstämning (14.4):** parterna ska minst kvartalsvis kontrollera att allt är registrerat. Billig funktion: "senast avstämd"-datum + diskret påminnelse på översikten.
5. **Arkets valideringar** (kolumn AQ): negativa belopp, nyckel utanför 0–1, betalningsdag utanför start–slut, osorterade rader, godkänd post utan gällande klassificering. Alla blir registrerings-valideringar respektive motor-kontroller i appen.
6. **Preliminär skatteeffekt-status** (arkets kolumn AR, avtal 11.4): posten flaggas PRELIMINÄR tills slutskattebesked finns; översikten visar antal preliminära poster. Korrigeringsflödet (3.2) hanterar slutjusteringen.
7. **Mäklarval med lottning (20.1)** och övriga dödlägesregler: dokumenteras i exitprocessens checklista (ingen automation).
8. **Avtalets kontrollsamband** (arkets J-kolumn): startkapital = startvärde − initialt lån (1 380 000 = 4 495 000 − 3 115 000), start- och ägarandelar summerar till 100 %. Blir valideringar i överenskommelse-vyn.

---

## 5. Lösningen

### 5.1 Stack och repo: spegla Bilkollen

Nytt fristående repo (`beahead-ab/mitt-och-ditt`, redan skapat). Samma stack som Bilkollen — TanStack Start + React 19, TanStack Router/Query, Tailwind v4 med Bilkollens tokenfil som bas, Radix/shadcn-komponenter, Supabase (auth, Postgres med RLS, privat storage), Zod, Vitest, Recharts, jspdf för PDF. Bilkollen röres inte. Kodmönster som återanvänds rakt av: serverfunktioner med auth-middleware, `PageHeader`/`EmptyState`/`SectionTabs`/app-shell-strukturen, avtalsdokument med md5-checksumma + acceptanstabell, adminbehörighetsmönstret.

### 5.2 Informationsarkitektur

Sju huvudval, samma skal som Bilkollen (fast toppfält med backdrop-blur, hamburgermeny, sektionsflikar, `max-w-5xl`, `px-4`):

| Sektion | Flikar | Bilkollen-motsvarighet |
|---|---|---|
| **Översikt** `/` | — | Bilens hero → bostadens "Läget nu" |
| **Transaktioner** `/transaktioner` | Registrera · Väntar på godkännande · Historik | Ekonomisidorna |
| **Överenskommelse** `/overenskommelse` | Gällande · Kostnadsslag · Avtalsversioner · Tilläggsavtal · Parter | Perioder & avtal |
| **Simulator** `/simulator` | — | Milprognosen |
| **Försäljning & utköp** `/forsaljning` | Process · Värderingar · Slutavräkning | — (nytt) |
| **Mitt konto** `/konto` | Profil (· Notiser i v2) | Mitt konto |
| **Systemadmin** `/system` | Användare · Hushåll · Inbjudningar | Systemadmin |

Bostadsväljaren (motsvarigheten till bilväljaren) finns i toppfältet men är osynlig så länge kontot bara har ett hushåll — vilket är fallet för Caesar och Felicia.

**Översikten** visar, uppifrån och ned: adress + beräkningsläge (Prognos/Slutavräkning) · nettokapital som `hero-number` med startvärde/antaget slutvärde/bolån som stödrader · interna andelar för båda parter med den obligatoriska texten ("Den interna ekonomiska andelen används bara i avräkningen mellan parterna. Den ändrar inte den formella ägarandelen i bostadsrätten.") · formella ägarandelar i tydligt separat ruta · statuskort i stafettpinne-stil för väntande godkännanden, tvistiga poster, saknade underlag (poster ≥ 1 000 kr utan bilaga), preliminära skatteposter och ej omvandlade fordringar · senaste transaktioner.

**Simulatorn** har fält för slutdag, slutvärde, kvarvarande lån och försäljningskostnader, plus ±scenario i procent (som arkets B10). Diagram i Recharts: den linjära värdelinjen med varje godkänd transaktion utprickad på sin betalningsdag (värde per enhet i tooltip), samt andelsutvecklingen över tid. Under diagrammen: slutliga andelar, utbetalning per part, och känslighetsraden ("vid −10 %: …"). Disclaimern ur uppdragsbeskrivningen visas alltid, liksom avtalets 8.4 vid värdelinjen ("mellanvärden är en avtalad fördelningsregel, inte historiska marknadsvärden"). Scenarier kan sparas och ett kan väljas som översiktens standardantagande. Simulatorn skriver aldrig till avtal, transaktioner eller andelar.

### 5.3 Designsystem

Bilkollens `styles.css` tas över i sin helhet: `bone`/`ink`/`copper`/`hairline`, `data-blue`/`data-gold`/`positive` för diagram, Space Grotesk/DM Sans, radie 0,5 rem, `eyebrow`, `hero-number`, `tile-surface`, tabulära siffror. Enda medvetna avvikelsen: ikonen i toppfältet (hus i stället för bil) och ordbruket. Allt gränssnittsspråk är enkel svenska; varje modellbegrepp (andelsenhet, nettokapital, kostnadsnyckel, personlig fordran, linjärt värde) har en "Vad betyder detta?"-knapp med motordrivna exempel (3.8).

### 5.4 Datamodell — justeringar mot uppdragsbeskrivningens lista

Uppdragsbeskrivningens 26 tabeller är i allt väsentligt rätt. Jag föreslår följande justeringar:

**Förenklas bort (härledd eller sammanslagen data):**
- `transaction_corrections` → kolumnen `corrects_transaction_id` på `transactions` räcker (ersättningssemantik, 3.2).
- `tax_effects` → skatteeffekt är fält på `transaction_payments` (belopp + `preliminary`-flagga). Slutligt utfall hanteras via korrigeringspost.
- `unit_balances` och `calculation_events` → motorns output, lagras som JSONB i `calculation_runs` (indata-hash, motorversion, läge, resultat). Att materialisera härledd data som egna sanningstabeller skapar bara risk att de glider isär från motorn.
- `personal_claims` → delas i två: motor-beräknade fordringar bor i körningsresultatet; **manuellt registrerade** fordringar (regress, löpande regleringar) får en egen liten tabell med bådas godkännande.

**Läggs till:**
- `invites` (invite-only-flödet, mönster från Bilkollen).
- `simulator_scenarios` (sparade antaganden; ett kan markeras som översiktens standard).

**Preciseras:**
- `transactions` bär huvudet (betalningsdag som `date`, kostnadsslag, beskrivning, särskild nyckel 0–1 eller null, status, korrigeringsreferens, registrerad av); `transaction_payments` bär per part: betalat brutto, rabatt/återbetalning/ersättning, skatteeffekt (+ preliminär-flagga). Båda parter kan alltså betala delar av samma post — precis som arkets kolumner E–H.
- `cost_category_rules` är temporal (2 i avsnitt 4): kostnadsslag, `effective_from`, ingår/ingår inte, fördelning utanför modellen, bådas godkännande, status.
- `agreement_versions` bär både dokumentet (markdown + md5-checksumma, som Bilkollen) och de maskinläsbara parametrarna (startdag, startvärde, insatser, startenheter, totala enheter). `agreement_addenda` kräver uppladdad undertecknad handling + bådas bekräftelse, och är enda vägen att ändra 25.1-fälten (samboavtalsdel, formella ägarandelar, startvärde, startdag, formeln, slutavräknings- och tremånadersregeln) — appen låser dessa fält utan tillägg.
- `settlements` fryser hela motor-inputen + resultatet + protokoll-markdown (bilaga 3-strukturen) och låses när `settlement_acceptances` har båda parter. "Verifiera igen"-knappen kör om motorn på frysta indata och visar att resultatet är identiskt.
- `audit_events` är append-only med **hash-kedja** (varje rad checksummar föregående) — billigt att bygga, gör loggen manipulationsevident, vilket passar ett bevisverktyg. Inga UPDATE/DELETE-rättigheter ens för ägaren; ekonomiska poster mjukraderas aldrig utan ersätts (3.2).

### 5.5 Behörighet och säkerhet

- Invite-only: konton skapas endast via inbjudan (Systemadmin). Ingen öppen registrering.
- RLS på allt: `is_household_member(household_id)`-mönstret; alla tabeller bär `household_id`. Bilagor i privat bucket med sökvägen `household_id/…` och tidsbegränsade signerade URL:er för export.
- Godkännanderegeln tvingas i databasen: acceptans-/godkännanderader kan bara skrivas med `user_id = auth.uid()`, statusövergångar räknas fram av databasfunktioner (security definer) — aldrig av klienten.
- Service role endast i serverfunktioner; publishable key i klienten (Bilkollens mönster).
- Tidsstämplar i UTC (`timestamptz`), ekonomiska datum som `date`, presentation i svensk tid.
- Inga personnummer (3.6); juridiska dokument endast i privat bucket, aldrig i loggar.

### 5.6 Överenskommelse-sektionens tre lager

1. **Det undertecknade huvudavtalet** (V8-dokumentet): laddas upp som referens med checksumma. Appen är underordnad det — det ska synas.
2. **Den digitala gällande överenskommelsen** (`agreement_versions`): parametrarna + genererat dokument, aktiveras med bådas acceptans (Bilkollens aktiverings-/acceptansflöde återanvänds). Startvärden för Caesar och Felicia läggs in som redigerbara utkastvärden enligt uppdragsbeskrivningen (4 495 000 / 1 200 000 / 180 000 / 3 115 000 / 1 380 000; andelar 86,9565 % / 13,0435 %). Formella ägarandelar är egna fält, förifylls inte.
3. **Kostnadsklassificeringarna** (`cost_category_rules`): får ändras löpande i appen med bådas godkännande och giltighetsdatum (25.2) — grundklassificeringen från avsnitt 6 i uppdragsbeskrivningen seedas med startdagen som giltighetsdatum. Nya/oklara kostnadsslag hamnar automatiskt utanför modellen tills båda godkänt klassificeringen.

### 5.7 Import och export

**Import** (V8-arket, uppladdad `.xlsx`/`.csv`): läser Transaktioner-flikens kolumner A–N exakt (samma rubriker), validerar (obligatoriska kolumner, datumordning, belopp, kända kostnadsslag), kontrollerar dubbletter (ID samt datum+belopp+typ), förhandsgranskar allt, sparar inget före uttryckligt godkännande, importerar **alla** rader som utkast (EX-prefixade exempelrader märks särskilt), skapar en importrapport — inklusive jämförelse av arkets startuppgifter mot appens gällande överenskommelse (avvikelser flaggas, skrivs aldrig över tyst) och motorns beräkning mot arkets slutsiffror (±1 kr-toleransen från 2.2). Därefter godkänner båda parter posterna i vanliga flödet innan de påverkar något.

**Export i v1:** transaktionshistorik (CSV/XLSX), aktuell sammanställning (PDF), slutavräkningsprotokoll enligt bilaga 3 (PDF + Markdown), avtal/tillägg (Markdown + PDF, jspdf-mönstret från Bilkollen). Komplett revisionszip i v1.1 (3.9).

### 5.8 Försäljning & utköp

- **Starta process:** endera parten registrerar processdag (skriftligt besked bekräftas av den andra eller dokumenteras med bilaga). Tidslinjen visar automatiskt: dag 14 (besked om övertagande, 17.1), tre månader (utköp klart eller bostaden utlagd, 17.2). Påminnelser visas i appen; inga externa åtgärder utförs.
- **Värderingar:** en per part, med dokument; 10 %-regeln beräknas öppet; vid behov tredje värdering → median. Fastställt värde blir slutvärde med värderingsdagen som slutdag.
- **Slutavräkning:** motorn körs i läge `slutlig` med verkliga siffror; extern försäljning drar faktiska försäljningskostnader, utköp drar inga hypotetiska arvoden (18.4). Negativt netto fördelas med samma andelar. Fordringar läggs till/dras av, 50/50-saldot regleras, summakontrollen visas grönt. Protokollet genereras, båda godkänner, allt låses. Utköpets checklista (överlåtelsehandling, betalning, föreningshandlingar, låntagarbefrielse) måste bockas av innan processen får markeras genomförd (19.3).

---

## 6. Byggordning

Varje etapp är körbar och granskningsbar innan nästa börjar.

| Etapp | Innehåll | Klart när |
|---|---|---|
| **0. Grund** | Beslut om infrastruktur (fråga 1). Scaffold: TanStack Start, tokens, lint/typecheck/Vitest, CI. | `npm run dev` visar app-skalet med Mitt & Ditt-toppfält. |
| **1. Motorn** | `src/lib/engine/` + golden tests + egenskapstester. Byggs helt utan backend. | Alla bilaga 1-exempel gröna; symmetri/ordningsoberoende/konservering gröna. |
| **2. Backend-grund** | Supabase-schema + RLS + auth + invites + seed (Caesar/Felicia, grundklassificeringar, startvärden som utkast). | RLS-tester gröna; två testkonton ser bara sitt hushåll. |
| **3. Överenskommelse + Transaktioner** | Sektionerna med registrering, godkännande/invändning, korrigeringar, bilagor, klassificeringar. | En post kan registreras, godkännas av båda och synas i historiken med full logg. |
| **4. Översikt + Simulator** | Motorn kopplas till UI; prognosläge, scenarier, diagram, "Vad betyder detta?". | Översikten visar korrekt läge för seedade data; simulatorn matchar arkets exempel. |
| **5. Import/export** | V8-importflödet med rapport; exporterna i 5.7. | Riktiga arket importeras med korrekt förhandsgranskning och ±1 kr-avstämning. |
| **6. Försäljning & utköp** | Processer, värderingar, slutavräkning med låsning och protokoll. | En komplett simulerad exit går att genomföra och verifiera om. |
| **7. Finish** | Systemadmin, kvartalsavstämning, tomma tillstånd, mobilpolish, pedagogiska exempel överallt. | Genomgång mot uppdragsbeskrivningens alla skall-krav. |

---

## 7. Frågor före bygget — med rekommenderade svar

Bygget kan starta på etapp 0–1 oavsett; frågorna behöver svar före etapp 2 respektive nämnd etapp.

1. **Infrastruktur:** Lovable Cloud (som Bilkollen — men då skapas projektet normalt från Lovable, vilket kan kräva att koden flyttas in där) eller fristående Supabase-projekt + valfri hosting (repot förblir källan)? *Rekommendation: fristående Supabase — repot är redan skapat utanför Lovable, stacken är identisk ändå, och inget i lösningen kräver Lovable-tjänsterna.*
2. **Domän/namn:** appnamnet är Mitt & Ditt — ska tjänsten ligga på t.ex. `mittochditt.goodstuff.se`? *(Påverkar bara auth-konfiguration; kan avgöras senare.)*
3. **Korrigeringssemantik:** ersättningspost enligt 3.2? *Rekommendation: ja.*
4. **Registratorns godkännande** i registreringsflödet enligt 3.3? *Rekommendation: ja.*
5. **Prognosens standardantagande:** "avräkning idag till startvärdet" enligt 2.4? *Rekommendation: ja, med sparade scenarier som valbar standard.*
6. **50/50-liggaren** i v1 enligt 3.1? *Rekommendation: ja — utan den saknar BRF-avgift och försäkring hemvist i appen.*

---

*Nästa steg när du gett klartecken: etapp 0 och 1 — scaffold plus beräkningsmotorn med hela testsviten — levereras som första PR i det här repot.*
