# Drift och infrastruktur

Så här körs Mitt & Ditt. Allt är container-paketerat och flyttbart: samma
`compose.yaml` fungerar på din laptop, på en DigitalOcean-droplet och hos vilken
annan leverantör som helst.

## 1. Valet av infrastruktur

Kraven var **billigt, bra och flyttbart**, utan koppling till Lovable.

**Vald lösning: en droplet med Docker Compose.** Två tjänster – appen och
Postgres – plus en valfri Caddy-container som sköter domän och certifikat. Ingen
molnleverantörs-specifik tjänst används någonstans, så en flytt är att kopiera
`compose.yaml`, en databasdump och en katalog med bilagor.

| Alternativ | Kostnad/mån | Flyttbart | Bedömning |
|---|---|---|---|
| **Droplet + Docker Compose** | ca 12 USD | Helt | **Valt.** Billigast, inga bindningar, allt i ett repo. |
| DigitalOcean App Platform + Managed Postgres | ca 25–30 USD | Delvis | Mindre drift men dubbla kostnaden, och databasen blir leverantörsbunden. |
| Managed Postgres till droppen | +15 USD | Delvis | Bra automatiska säkerhetskopior, men onödigt för två användare. Skriptet i `deploy/backup.sh` räcker. |
| Supabase (som Bilkollen) | 0–25 USD | Nej | Uteslutet: hela poängen var att slippa SaaS-bindningen. |

Rekommenderad storlek: **2 GB RAM / 1 vCPU** (Basic Regular, ca 12 USD/mån) i
regionen Frankfurt eller Amsterdam. Två användare belastar inget, men bygget
behöver minnet. Bygg hellre imagen i CI och hämta den färdig till servern, då
räcker 1 GB.

Räkna med cirka **12–18 USD i månaden** totalt, beroende på om du lägger
säkerhetskopiorna i DigitalOcean Spaces (5 USD/mån).

## 2. Teknikval i korthet

| Lager | Val | Varför |
|---|---|---|
| Ramverk | TanStack Start (React 19) | Samma som Bilkollen, så designsystem och kodmönster kan delas mellan systerprodukterna. Bygger till en vanlig Node-server. |
| Server | Nitro, preset `node-server` | En enda `node .output/server/index.mjs`. Ingen serverless-bindning. |
| Stil | Tailwind v4 med Bilkollens tokens | Identiskt visuellt uttryck. |
| Databas | Postgres 17 i container | Standard-SQL, dumpas och flyttas med `pg_dump`. |
| Inloggning | Egen sessionshantering, endast inbjudna | Ingen tredjepartsberoende för något så centralt. Byggs i etapp 2. |
| Bilagor | Volym på servern, aldrig publik | Enkelt och privat. Kan bytas mot S3-kompatibel lagring utan att koden ändras. |
| Tester | Vitest | Beräkningsmotorn är ren och testas utan webbläsare eller databas. |

## 3. Köra lokalt

```sh
npm install
cp .env.example .env      # sätt VITE_DEMO=1 för att se gränssnittet med exempeldata
npm run dev
```

Verifiera hela kedjan innan du pushar:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## 3b. Databasen

```sh
npm run db:migrate         # kör migreringarna i db/migrations
npm run db:seed            # skapar hushållet och skriver ut inbjudningslänkar
npm run admin:losenord -- admin@example.se   # sätter lösenord för ett konto
```

Skripten byggs också till `.output/scripts/*.mjs`, utan beroenden, så att de
kan köras i containern där varken källkod eller `node_modules` finns.

Migreringarna körs i filnamnsordning, exakt en gång var, och varje fil i sin egen
transaktion. Ett par användare behöver ingen migreringsmotor. De tål också att
köras samtidigt från flera containrar: applikationsrollen hör till hela
databasservern, så den skapas med ett fel som sväljs om någon annan hann före.

Seed-skriptet är idempotent. Det skapar hushållet, avtalsversionen som **utkast**
med startvärdena ur avtalets punkt 2 och grundklassificeringen ur punkt 7, samt en
inbjudningslänk per part. Länkarna visas en enda gång och är giltiga i sju dagar.

**Två databasroller används.** `mittochditt_owner` äger schemat och kör
migreringar. Applikationen använder `mittochditt_app`, som lyder under
radnivåsäkerheten och sätter `app.user_id` per transaktion. Utan den variabeln ser
rollen ingenting alls – ett glömt anrop ger tomt resultat i stället för någon
annans uppgifter.

Testerna för radnivåsäkerhet kör mot en riktig Postgres, både lokalt och i CI.
Sätt `TEST_DATABASE_URL` för att peka på en egen server.

## 4. Köra i container

```sh
# Demoläge, för att titta på gränssnittet
docker build --build-arg VITE_DEMO=1 -t mitt-och-ditt:demo .
docker run --rm -p 3000:3000 mitt-och-ditt:demo

# Skarpt läge med databas
export POSTGRES_PASSWORD="$(openssl rand -base64 32)"
docker compose up -d --build
```

Appen lyssnar på port 3000 i containern. `VITE_DEMO` måste sättas **vid bygget**,
eftersom `VITE_`-variabler bakas in i klientbunten.

## 5. Sätta upp tjänsten på mittochditt.goodstuff.se

Tjänsten körs på **https://mittochditt.goodstuff.se**. Stegen nedan är hela
uppsättningen från tom maskin till fungerande inloggning.

### 5.1 Maskinen

En droplet räcker: Ubuntu 24.04 LTS, Basic Regular **2 GB / 1 vCPU**, region
Frankfurt eller Amsterdam. Lägg in din SSH-nyckel vid skapandet och slå på
automatiska säkerhetsuppdateringar.

```sh
ssh root@<ip>
curl -fsSL https://get.docker.com | sh
```

### 5.2 Domänen

Peka `mittochditt.goodstuff.se` mot dropletens IP med en **A-post**. Kontrollera
att den slagit igenom innan Caddy startas, annars misslyckas certifikatet:

```sh
dig +short mittochditt.goodstuff.se
```

Svaret ska vara dropletens IP. Certifikatet hämtas över port 80, så den måste
vara öppen utåt.

### 5.3 Brandvägg

```sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Databasen exponeras aldrig utåt – den nås bara inifrån compose-nätverket.

### 5.4 Hämta koden och sätt hemligheterna

```sh
git clone https://github.com/beahead-ab/mitt-och-ditt /srv/mitt-och-ditt
cd /srv/mitt-och-ditt

cat > .env <<ENV
POSTGRES_PASSWORD=$(openssl rand -base64 32)
APP_DOMAIN=mittochditt.goodstuff.se
APP_URL=https://mittochditt.goodstuff.se
SEED_ADMIN_EMAIL=din@adress.se
SEED_CAESAR_EMAIL=caesars@adress.se
SEED_FELICIA_EMAIL=felicias@adress.se
ENV
chmod 600 .env
```

Sätt de tre e-postadresserna till riktiga innan seed körs. De blir kontonas
identitet, och adressen är det man loggar in med. Att byta dem efteråt går, men
är onödigt pillande.

`APP_URL` används både i inbjudningslänkarna och i csrf-kontrollen. Bakom
proxyn ser appen sin interna adress, så utan den skulle kontrollen jämföra mot
fel värde.

### 5.5 Starta

Starta i tre steg i stället för ett. Skälet är Let's Encrypt: de tillåter fem
misslyckade valideringar per timme och värdnamn. Görs bygget, starten och
certifikathämtningen i ett svep kan ett dödat bygge eller en app som inte går
igång leda till att Caddy ändå försöker – och då är försöken slut innan felet
ens är hittat. Uppdelningen kostar två extra kommandon och håller de tre felen
isär.

**Steg 1 – bygg imagen, starta ingenting.**

Bygget är det enda som tar i på en liten maskin; toppen ligger strax över en
gigabyte. Har maskinen ingen växlingsfil, lägg in en först, annars kan bygget
dödas av minnesbrist mitt i:

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

```sh
docker compose build
```

På en maskin med 1 GB swappar bygget och tar flera minuter. Dödas det ändå
finns tre vägar, i stigande ordning av besvär:

1. Större växlingsfil – 4 GB i stället för 2.
2. Bygg någon annanstans och flytta den färdiga imagen:
   `docker save mitt-och-ditt:latest | ssh root@<ip> docker load`.
3. Skala tillfälligt upp maskinen, bygg, och skala tillbaka. Hos DigitalOcean
   är ändring av **enbart processor och minne** reversibel; det är ändring av
   disken som inte går att ångra.

Att sänka Nodes heap-tak vore ett fjärde alternativ, men det kräver en ändring
i `Dockerfile`: en miljövariabel satt på värden följer inte med in i bygget.

Det är bara bygget som är trångt. I drift ligger appen på omkring 150 MB,
databasen på 100 och Caddy på 20.

**Steg 2 – provstarta utan HTTPS.**

```sh
docker compose up -d
curl -sI http://127.0.0.1:3000/auth | head -1
docker compose ps
```

Utan `--profile tls` startar bara appen och databasen. Svaret ska vara
`HTTP/1.1 200 OK`. Anropet fungerar bara från maskinen själv, eftersom porten
är bunden till loopback – det är avsiktligt, se `compose.yaml`.

Går det inte igång, felsök här. Ingenting av det rör certifikat, och inga
försök förbrukas.

**Steg 3 – släpp fram Caddy.**

Kontrollera domänen en sista gång innan, både utifrån och från maskinen:

```sh
dig +short mittochditt.goodstuff.se @1.1.1.1
dig +short mittochditt.goodstuff.se
```

Båda ska svara med maskinens IP, och ingenting annat. Ligger domänen bakom en
proxy som Cloudflare måste den stå i genomsläppsläge – *DNS only*, grå
molnikon. Med proxyn på träffar utmaningen proxyn i stället för maskinen, och
är "Always Use HTTPS" påslaget skickas den vidare till https innan Caddy har
något certifikat att svara med. Kontrollera också att ingen AAAA-post finns:
finns den föredras IPv6, och svarar inte maskinen där misslyckas valideringen.

```sh
docker compose --profile tls up -d
```

Caddy hämtar certifikatet automatiskt. Efter någon minut svarar tjänsten på
https:

```sh
curl -sI https://mittochditt.goodstuff.se/auth | head -1
docker compose ps
```

### 5.6 Sätt upp hushållet

Seed läser `SEED_`-värdena ur containerns miljö, och den sätts när containern
skapas - inte när `.env` ändras. Har du redigerat `.env` efter att appen
startade måste containern återskapas först, annars kör seed med de gamla
värdena:

```sh
docker compose --profile tls up -d
docker compose exec app env | grep SEED_
```

Utskriften ska visa dina adresser. Syns ingenting kör inte seed - då når
värdena inte in, och skriptet skulle tyst falla tillbaka på exempeladresserna.

```sh
docker compose exec app node .output/scripts/seed.mjs
```

Seed skapar hushållet, avtalsversionen som **utkast** med startvärdena ur
avtalets punkt 2, grundklassificeringen ur punkt 7, och skriver ut en
inbjudningslänk per part. Länkarna visas en enda gång och gäller i sju dagar.

Administratörskontot skapas utan lösenord, eftersom det inte kommer till genom
en inbjudan. Sätt det:

```sh
docker compose exec -it app node .output/scripts/set-password.mjs din@adress.se
```

Adressen är den du satte som `SEED_ADMIN_EMAIL`.

### 5.7 Innan Caesar och Felicia godkänner avtalet

Avtalets `[●]`-fält måste fyllas i med verkliga siffror. Kontrollera särskilt:

- **startdagen** – tillträdesdagen för det gemensamma förvärvet,
- **startvärdet** – den faktiska köpeskillingen,
- **kapitalinsatserna** – styrkta belopp, inte planerade,
- **bostadens adress** – sätts under Systemadmin → Hushåll.

Startenheterna följer av kapitalinsatserna: en enhet per krona. Avtalsversionen
börjar gälla först när båda parter godkänt den, och först då räknar tjänsten
något.

### 5.8 Uppdatera senare

Samma uppdelning som vid uppsättningen, av samma skäl: bygget ska få misslyckas
utan att ta tjänsten med sig. Kör inte om bygget i samma kommando som starten –
`up -d --build` river den gamla containern, så ett bygge som dödas av
minnesbrist lämnar tjänsten nere i stället för att lämna den orörd.

**Steg 1 – ta en kopia innan något rörs.**

```sh
/srv/mitt-och-ditt/deploy/backup.sh
```

Migreringarna är framåtriktade och har ingen väg tillbaka: det finns inget
kommando som ångrar en genomförd migrering. Går uppdateringen fel är kopian
skillnaden mellan en halvtimmes återställning och ett förlorat underlag. Den tar
några sekunder för två användare, och avbryter av sig själv om någon av filerna
blev tom.

Att koden går att rulla tillbaka med `git checkout` hjälper inte här - schemat
följer inte med bakåt.

**Steg 2 – hämta koden och bygg. Tjänsten fortsätter köra på den gamla imagen.**

```sh
cd /srv/mitt-och-ditt && git pull
docker compose build
```

Går bygget inte igenom står den gamla versionen kvar och svarar som förut.
Rätta felet och bygg om; ingenting är sönder under tiden.

**Steg 3 – kör migreringarna, fortfarande på den gamla koden.**

```sh
docker compose run --rm app node .output/scripts/migrate.mjs
```

`run --rm` startar en engångscontainer ur den nyss byggda imagen, kör
migreringarna och försvinner. Den som betjänar användarna rörs inte.

Ordningen är avsiktlig. Migreringarna ska ligga före bytet av kod, inte efter:
ny kod förutsätter alltid det nya schemat, medan gammal kod nästan alltid tål
att en kolumn eller tabell tillkommit. Görs det tvärtom finns ett glapp där den
nya koden möter det gamla schemat.

Migreringarna körs i filnamnsordning, exakt en gång var.

**Steg 4 – byt in den nya versionen och kontrollera.**

```sh
docker compose --profile tls up -d
docker compose ps
curl -sI https://mittochditt.goodstuff.se/auth | head -1
```

Inget `--build` här – imagen är redan byggd i steg 2. Certifikatet ligger kvar
i `caddy_data` och hämtas inte om.

### 5.9 Säkerhetskopiering

```sh
crontab -e
# 0 3 * * * /srv/mitt-och-ditt/deploy/backup.sh >> /var/log/mittochditt-backup.log 2>&1
```

Skriptet dumpar databasen och packar bilagorna, och rensar kopior äldre än
30 dagar. Testa en återställning innan ni börjar registrera på riktigt.

## 6. Flytta tjänsten någon annanstans

1. `deploy/backup.sh` på den gamla servern.
2. Kopiera repot, `.env` och de två arkiven till den nya servern.
3. `docker compose up -d --build`, återställ dumpen med `psql` och packa upp
   bilagorna i `uploads`-volymen.

Inget i koden känner till vilken leverantör den körs hos.

## 7. Hemligheter

`POSTGRES_PASSWORD` sätts i `.env` på servern och checkas aldrig in. `.env` är
med i både `.gitignore` och `.dockerignore`. Databasporten exponeras inte utåt –
nå den via `docker compose exec db psql -U mittochditt`.

Någon signeringsnyckel för sessioner behövs inte. Sessionstoken slumpas per
inloggning och lagras bara som hash i databasen, så det finns ingen hemlighet
att läcka och inget att rotera. Samma sak gäller inbjudningslänkarna.

## 8. Vad som återstår

Hela byggordningen är genomförd: registrering, godkännanden, korrigeringar och
makuleringar, bilagor, exporter, försäljning och utköp samt administration.

Medvetet uppskjutet till en senare version, enligt lösningsförslaget: flödet vid
dödsfall och arv, notifieringar och e-post, en komplett revisionszip,
kompensation för nyttjande efter processdagen, dröjsmålsränta på regresskrav och
sparade scenarier i simulatorn.
