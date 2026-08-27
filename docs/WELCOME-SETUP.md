# Oppsettguide: Event Welcome

Denne guiden klargjør den nye velkomstflyten med RFID-tagger. Løsningen er avgrenset fra den tidligere Digi-Coffee-flyten: den bruker egne `welcome_*`-tabeller og funksjonen `welcome-rfid-relay`.

> **Personvern:** Konfigurasjonssiden inneholder navn og selskapsnavn. Den er foreløpig åpen på samme måte som kildeprosjektet. Legg den bak tilgangskontroll eller distribuer den bare til arrangementsansvarlige før reell produksjonsbruk.

## 1. Legg inn datamigrasjonen

Supabase-prosjektet er allerede klargjort med disse migrasjonene i rekkefølge:

```text
supabase/migrations/20260810_welcome_bootstrap.sql
supabase/migrations/20260813_welcome_events.sql
```

Den første migrasjonen importerer 300 fysiske EPC-tagger fra prosjektets katalog. Den andre oppretter arrangements-, tagg-, gjeste- og skannetabeller, i tillegg til funksjonene som konfigurasjonssiden og RFID-endepunktet bruker.

| Funksjon | Brukes av | Formål |
|---|---|---|
| `create_welcome_event` | Konfigurasjon | Reserverer en batch og en sammenhengende ID-serie. |
| `assign_welcome_guest` | Konfigurasjon | Kobler navn og selskap til én ledig ID-tagg. |
| `record_welcome_scan` | RFID-endepunkt | Validerer lesningen og skriver en idempotent velkomstskann. |
| `close_welcome_event` | Konfigurasjon | Frigir aldri-tildelte tagger etter arrangementet. |

## 2. Distribuer RFID-endepunktet

Kjør fra repositoryets rot etter at Supabase CLI er koblet til korrekt prosjekt:

```bash
supabase functions deploy welcome-rfid-relay --project-ref vvqpbvicvhwqbjezifst --no-verify-jwt
```

Angi en sterk `RFID_EVENT_KEY` som funksjonshemmelighet. Leseren må sende samme verdi i `X-Event-Key`.

`RFID_EVENT_KEY` er allerede opprettet som funksjonshemmelighet i produksjonsprosjektet. Hent den fra den sikre leveransen når Keonn-leseren skal konfigureres; ikke legg nøkkelen inn i Git-repositoryet.

Endepunktet er:

```text
https://vvqpbvicvhwqbjezifst.supabase.co/functions/v1/welcome-rfid-relay
```

## 3. Konfigurer Keonn AdvanReader

Bruk en unik leseridentifikator per fysisk RFID-sone, for eksempel `stand-b12-reader`. Den samme identifikatoren må stå i arrangementsoppsettet på `konfigurasjon.html`.

| Felt i SimpleHTTPService | Verdi |
|---|---|
| Aktivert | På |
| Metode | `POST` |
| Endepunkt | `https://vvqpbvicvhwqbjezifst.supabase.co/functions/v1/welcome-rfid-relay` |
| Content-Type | `application/json` |
| Forventet status | `200` |
| Tagg-TTL ved test | `5` sekunder |
| Tagg-TTL i drift | `60` sekunder |

Legg inn tilpasset HTTP-header i leseren:

```json
{"customHeaders":[{"header":"X-Event-Key: DIN_RFID_EVENT_KEY"}]}
```

Leseren kan sende enkelt-EPC-er, `tags`, `reads` eller `epc_list`. Et typisk AdvanNet-format er:

```json
{
  "devid": "stand-b12-reader",
  "reads": [
    {"epc": "3415AFBC0C000000000007EB", "rssi": "-60"}
  ]
}
```

## 4. Opprett og klargjør arrangementet

Åpne `https://westersnik.github.io/gs1-nordic-welcome/konfigurasjon.html` og opprett arrangementet. Velg lokasjon, leser, taggbatch og synlig nummerserie, eksempelvis ID `1–100`.

Deretter velger du arrangementet i kortet **Registrer gjest** og registrerer følgende for hver tagg:

| Felt | Eksempel |
|---|---|
| ID-nummer på tagg | `42` |
| Navn | `Ada Lovelace` |
| Selskapsnavn | `Acme AS` |

Systemet vil avvise ID-nummer som ikke ligger i den aktive serien eller allerede er tildelt til en annen gjest.

## 5. Åpne storskjermen

I arrangementslisten velger du **Åpne storskjerm**. Lenken har denne formen:

```text
https://westersnik.github.io/gs1-nordic-welcome/storskjerm.html?event={EVENT_ID}
```

Storskjermen lytter på `welcome_scans` via Supabase Realtime. Når en gyldig, tildelt tagg leses, vises:

> **Velkommen til vår stand!**
>
> **Ada Lovelace**
>
> Acme AS

Visningen går tilbake til «Klar for neste gjest» etter ni sekunder. Etter en velkomst plasserer systemet taggen i **60 minutters presentasjonskarantene**. Gjentatte lesninger i denne perioden blir registrert som sett, men lager ingen ny post i `welcome_scans` og når derfor ikke storskjermen. Etter 60 minutter kan samme gjest ønskes velkommen igjen.

## 6. Verifiser hele kjeden før dørene åpner

Gjennomfør denne kontrollen i rekkefølge:

1. Opprett et testarrangement med en liten, ubrukt serie.
2. Tildel en fysisk tagg til et testnavn i konfigurasjonssiden.
3. Åpne arrangementets storskjerm i et eget vindu.
4. Send en testlesning fra leseren eller med `curl`.
5. Kontroller at navnet og selskapet vises én gang på storskjermen.
6. Test en ukjent EPC og en uregistrert, men tildelt tagg. Begge skal avvises og registreres i `welcome_feedback`.

Eksempel med `curl`:

```bash
curl -sS -X POST \
  'https://vvqpbvicvhwqbjezifst.supabase.co/functions/v1/welcome-rfid-relay' \
  -H 'Content-Type: application/json' \
  -H 'X-Event-Key: DIN_RFID_EVENT_KEY' \
  -d '{"devid":"stand-b12-reader","reads":[{"epc":"3415AFBC0C000000000007EB"}]}'
```

Forventet resultat ved første vellykkede lesning er `recorded: 1`. En ny lesning av samme tagg innen 60 minutter gir `cooldowns: 1`; dette er forventet og skal ikke gi en ny velkomst på storskjermen.

## Session 2 på RFID-leseren

Konfigurer EPC Gen2-inventariet på leseren med **Session 2** og **Single Target** før arrangementet åpner. Session 2 får taggen til å skifte inventarflagg etter lesning, slik at leseren ikke kontinuerlig rapporterer samme tagg når den blir stående i sonen. Dette reduserer støy ved kilden, mens systemets 60-minutters karantene er den endelige sikkerheten på serversiden.

| Leserparameter | Anbefalt verdi |
|---|---|
| EPC Gen2 inventory session | `S2` / `2` |
| Search mode | `Single Target` |
| Programvarebeskyttelse | 60 minutter i `welcome-rfid-relay` |

Keonn oppgir at flere AdvanReader-modeller kan styres gjennom blant annet REST API, TCP, MQTT og HTTP, men den eksakte kommandoen for Session 2 avhenger av modell, fastvare og den lokale Reader Server-konfigurasjonen. Denne GitHub Pages-løsningen kan ikke skrive direkte til en leser på lokalt nettverk. Reléet returnerer likevel den anbefalte Session 2-profilen til en kompatibel leseragent. Se [Keonns oversikt over lesere](https://keonn.com/components-category/readers/) og [GS1s EPC Gen2-standard](https://www.gs1.org/standards/rfid/uhf-air-interface-protocol) for den underliggende teknologien.

## Avslutte arrangementet

Velg **Avslutt arrangement** på konfigurasjonssiden etter at arrangementet er ferdig. Systemet frigir bare tagger med status `available`. Tagger som er tildelt eller allerede har utløst en velkomst beholdes i historikken og kan ikke uforvarende gjenbrukes i et nytt arrangement.
