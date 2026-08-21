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
export SESSION_SECRET="$(openssl rand -base64 48)"
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

Bygget är det enda som tar i på en 2 GB-maskin. Har den ingen växlingsfil, lägg
in en först – annars kan bygget dödas av minnesbrist mitt i:

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

```sh
docker compose --profile tls up -d --build
```

Caddy hämtar certifikatet automatiskt. Efter någon minut svarar tjänsten på
https. Kontrollera:

```sh
curl -sI https://mittochditt.goodstuff.se/auth | head -1
docker compose ps
```

### 5.6 Sätt upp hushållet

```sh
docker compose exec app node .output/scripts/seed.mjs
```

Seed skapar hushållet, avtalsversionen som **utkast** med startvärdena ur
avtalets punkt 2, grundklassificeringen ur punkt 7, och skriver ut en
inbjudningslänk per part. Länkarna visas en enda gång och gäller i sju dagar.

Administratörskontot skapas utan lösenord, eftersom det inte kommer till genom
en inbjudan. Sätt det:

```sh
docker compose exec -it app node .output/scripts/set-password.mjs admin@example.se
```

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

```sh
cd /srv/mitt-och-ditt && git pull && docker compose --profile tls up -d --build
docker compose exec app node .output/scripts/migrate.mjs
```

Migreringarna körs i filnamnsordning, exakt en gång var.

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
