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

## 5. Sätta upp på DigitalOcean

1. Skapa en droplet: Ubuntu 24.04 LTS, Basic Regular 2 GB, Frankfurt. Lägg in din
   SSH-nyckel. Slå på automatiska säkerhetsuppdateringar.
2. Installera Docker:
   ```sh
   curl -fsSL https://get.docker.com | sh
   ```
3. Peka domänen (till exempel `mittochditt.goodstuff.se`) mot dropletens IP med
   en A-post.
4. Hämta koden och starta:
   ```sh
   git clone https://github.com/beahead-ab/mitt-och-ditt /srv/mitt-och-ditt
   cd /srv/mitt-och-ditt
   cat > .env <<'ENV'
   POSTGRES_PASSWORD=...
   SESSION_SECRET=...
   APP_DOMAIN=mittochditt.goodstuff.se
   ENV
   docker compose --profile tls up -d --build
   ```
   Caddy hämtar certifikatet automatiskt. Efter någon minut svarar tjänsten på
   HTTPS.
5. Stäng brandväggen om allt annat:
   ```sh
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
   ```
6. Lägg in nattlig säkerhetskopiering:
   ```sh
   crontab -e
   # 0 3 * * * /srv/mitt-och-ditt/deploy/backup.sh >> /var/log/mittochditt-backup.log 2>&1
   ```

Uppdatera senare med:

```sh
cd /srv/mitt-och-ditt && git pull && docker compose up -d --build
```

## 6. Flytta tjänsten någon annanstans

1. `deploy/backup.sh` på den gamla servern.
2. Kopiera repot, `.env` och de två arkiven till den nya servern.
3. `docker compose up -d --build`, återställ dumpen med `psql` och packa upp
   bilagorna i `uploads`-volymen.

Inget i koden känner till vilken leverantör den körs hos.

## 7. Hemligheter

`POSTGRES_PASSWORD` och `SESSION_SECRET` sätts i `.env` på servern och checkas
aldrig in. `.env` är med i både `.gitignore` och `.dockerignore`. Databasporten
exponeras inte utåt – nå den via `docker compose exec db psql -U mittochditt`.

## 8. Vad som återstår

Etapp 2 lägger till Postgres-schemat med radnivåsäkerhet, inbjudningar och
inloggning. Fram till dess kör appen i demoläge med exempeldata, och
`db`-tjänsten i `compose.yaml` står redo men används inte.
