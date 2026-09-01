# MAPS Web al cloud: arquitectura del Connector, backend i pla de POC

Data de la investigació: 2026-09-01  
Estat: proposta d'arquitectura; encara no implementada.

## 1. Resum executiu

MAPS Web no pot conservar de manera fiable el model actual —el procés Next.js
obrint UDP/23 i TCP/23 directament contra la passarel·la— quan Next.js s'executa
al cloud. El servidor cloud no és dins de la LAN del tècnic i el navegador no
ofereix sockets TCP/UDP arbitraris a una web normal.

La recomanació és introduir un **MAPS Connector** petit al Windows o macOS del
tècnic. El Connector reutilitza el transport Intesis TypeScript existent,
accedeix a la LAN i inicia una única connexió sortint segura cap al cloud.

```text
Browser del tècnic
https://maps.intesis.com
          │
          │ HTTPS / WSS
          ▼
MAPS Cloud: autenticació, projectes i relay
          ▲
          │ WSS sortint; no cal obrir ports al router
          │
MAPS Connector — Windows/macOS
          │
          ├── UDP/23: discovery
          ├── TCP/23: INFO, diagnostics i sessions
          └── XMODEM: receive/deploy
                    │
                    ▼
             Passarel·la Intesis
```

Per al primer POC, la combinació recomanada és:

- **Render Free**: Next.js, API i relay WebSocket en un únic servei Node.
- **Neon Free**: PostgreSQL per a usuaris, projectes i historial.
- **Auth.js o Better Auth**: autenticació guardada al mateix PostgreSQL.
- **Fitxers petits dins de PostgreSQL** durant el POC; no cal object storage
  encara.
- **Connector Windows en Node.js/TypeScript** sense UI complexa, connectat per
  WSS al relay.

Supabase no és necessari. Pot ser una plataforma de producció vàlida, però no
resol per si sol l'accés a la LAN i el compte actual ja té ocupats els dos
projectes Free.

## 2. Situació actual del repositori

MAPS ja té les separacions adequades per evolucionar sense redissenyar el
protocol:

- `src/server/intesis-transport` conté discovery UDP/23, sessió TCP/23,
  login/xifrat, INFO, XMODEM, receive i deploy.
- `GatewaySessionManager` manté avui les sessions en memòria del procés Node.
- `src/server/persistence/types.ts` ja defineix `ProjectRepository`,
  `ProjectFileStore` i `ProjectHistoryStore`.
- `LocalProjectStore` és només un adaptador local darrere d'aquestes
  interfícies.
- La UI consumeix APIs i SSE; no obre sockets de gateway directament.

Això permet canviar dos adaptadors sense tocar el domini ni el format de
projecte:

```text
Avui                              Cloud
--------------------------------  --------------------------------------
LocalProjectStore                 PostgresProjectStore
GatewaySessionManager local       ConnectorGatewaySessions / relay client
TCP/UDP des del servidor Next     TCP/UDP des del MAPS Connector
SSE procés local                  WSS relay → SSE o WSS cap al browser
```

No s'ha de portar el protocol Intesis al navegador. S'ha d'executar el mateix
codi Node dins del Connector.

## 3. Per què el navegador directe a la LAN no és la base correcta

### 3.1 TCP i UDP

Una web normal no pot obrir sockets TCP o UDP arbitraris. La Direct Sockets API
de Chromium existeix per a **Isolated Web Apps**, no per a una pàgina normal
servida des de `maps.intesis.com`. Això impedeix implementar UDP/23 discovery i
el protocol TCP/23 Intesis directament al browser.

Per tant:

- `fetch()` només serveix si el dispositiu exposa HTTP.
- `WebSocket` només serveix si el dispositiu exposa un servidor WebSocket.
- La passarel·la actual parla UDP/TCP propi; el browser no el pot consumir.

### 3.2 Local Network Access i Private Network Access

Chrome ha substituït l'antic enfocament Private Network Access per un permís
de **Local Network Access**. Una web pública que accedeix a IPs privades o a
localhost pot provocar un diàleg de permís. Això ajuda amb HTTP local, però no
afegeix sockets TCP/UDP al navegador ni converteix el protocol Intesis en HTTP.

També és una dependència de navegador, versió, política empresarial i permís
de l'usuari. No és una base prou homogènia per suportar Chrome, Edge, Safari i
iPadOS.

### 3.3 HTTPS, localhost i WebSocket local

`http://localhost` i `http://127.0.0.1` es consideren orígens potencialment
fiables en molts navegadors. Tot i això, una arquitectura
`https://maps.intesis.com → localhost` continua tenint fricció:

- permís de Local Network Access/loopback;
- CORS per a `fetch()`;
- validació estricta de l'header `Origin` al helper;
- diferències de mixed content entre navegadors;
- una pàgina HTTPS hauria d'utilitzar `wss://`, no `ws://`;
- `wss://localhost` obliga a gestionar un certificat que el navegador confiï;
- ports locals ocupats, antivirus i polítiques corporatives.

És possible construir-ho, però no és la via més transparent. La proposta evita
completament el problema: tant el browser com el Connector obren connexions
sortints a un `https://`/`wss://` públic amb certificat normal.

### 3.4 WebUSB

WebUSB té disponibilitat limitada, requereix HTTPS, gestos i permisos de
l'usuari, i no és una solució homogènia a Safari/iPadOS. Encara que en el futur
alguna gateway presenti una interfície USB compatible, WebUSB no ha de ser el
transport principal de MAPS.

El suport USB futur ha d'anar dins del Connector natiu de Windows/macOS. En
iPadOS requeriria una app nativa i un accessori/driver compatible.

## 4. Arquitectura recomanada

### 4.1 Separació de responsabilitats

**MAPS Web / backend**

- autenticació i organitzacions;
- CRUD de projectes i historial;
- autorització usuari ↔ projecte ↔ Connector;
- pairing i inventari de Connectors;
- relay de comandes, esdeveniments i diagnòstics;
- auditoria de les operacions de deploy;
- emmagatzematge de configuracions.

**MAPS Connector**

- discovery UDP a les interfícies locals;
- connexió TCP i protocol Intesis existent;
- contrasenya de gateway només en memòria;
- receive/deploy i progrés XMODEM;
- diagnostics/realtime;
- reconnexió automàtica amb el cloud;
- futur accés USB;
- cap lògica de negoci de projectes que ja pertanyi a MAPS Web.

**Gateway**

- no necessita canvis;
- no ha de tenir accés a Internet;
- continua escoltant el protocol local actual.

### 4.2 Connexió browser ↔ Connector

No es fa una connexió directa browser → localhost. Els dos extrems es troben
al relay:

```text
Browser ───── WSS ─────► Relay ◄───── WSS sortint ───── Connector
```

Flux normal:

1. L'usuari inicia sessió a MAPS Web.
2. El Connector arrenca amb Windows/macOS i es connecta al relay.
3. El relay marca el Connector com a `online` per a l'organització adequada.
4. MAPS Web mostra «Connector detectat».
5. L'usuari prem Scan; el relay envia `gateway.discovery.start`.
6. El Connector fa broadcast UDP/23 i retorna resultats progressivament.
7. L'usuari selecciona gateway i inicia la sessió.
8. INFO, logs, progrés, receive i deploy viatgen pel mateix canal.

Això permet exactament la UX desitjada:

```text
Obro MAPS Web
↓
Detecta automàticament el Connector online
↓
Escanejo i detecto les passarel·les de la LAN
↓
Connecto, diagnostico, rebo o desplego configuració
```

### 4.3 Protocol del relay

El protocol cloud ha de ser propi, petit i versionat; no ha d'exposar els
detalls del protocol Intesis al browser.

Exemple d'envelope:

```json
{
  "version": 1,
  "type": "gateway.discovery.start",
  "requestId": "uuid",
  "connectorId": "uuid",
  "payload": {
    "timeoutMs": 2500,
    "targets": []
  }
}
```

Missatges mínims:

- `connector.hello`, `connector.online`, `connector.heartbeat`;
- `gateway.discovery.start`, `gateway.discovery.result`;
- `gateway.session.connect`, `disconnect`, `status`;
- `gateway.info.request`, `gateway.info.result`;
- `gateway.receive.start`, `progress`, `complete`, `error`;
- `gateway.deploy.start`, `progress`, `complete`, `error`;
- `gateway.diagnostics.start`, `event`, `stop`;
- `operation.cancel`.

Cada operació ha de tenir `requestId`, timeout, ACK, estat terminal i errors
tipats. El Connector ha de serialitzar per sessió les operacions incompatibles,
igual que avui fa `runExclusive`.

Per al POC, els projectes petits poden viatjar en frames binaris WebSocket. En
producció és preferible:

- comandes, logs i progrés pel relay;
- fitxers per URL signada d'object storage;
- checksum, mida i identificador immutable a la comanda;
- retry/reprendre sense repetir tota la sessió WebSocket.

### 4.4 Seguretat

- Tot el trànsit d'Internet per TLS (`https`/`wss`).
- Cap port entrant al PC del tècnic ni al router del client.
- Pairing del Connector amb un codi curt d'un sol ús o device-code flow.
- Després del pairing, credencial de dispositiu revocable guardada al keychain
  del sistema: Windows Credential Manager / macOS Keychain.
- Tokens curts per a cada sessió de commissioning.
- Autorització server-side de l'organització, usuari, projecte i Connector.
- El relay valida l'`Origin` del browser i no confia només en l'ID enviat pel
  client.
- La contrasenya de gateway no es persisteix ni es registra.
- Logs sense payloads, claus, passwords ni blobs.
- Límit de mida, rate limit i timeout per missatge/operació.
- Signatura de binaris i actualitzacions del Connector.
- Auditoria explícita de receive i sobretot deploy.

Per a una V1 comercial, convé xifrar també a nivell de missatge les dades
sensibles browser ↔ Connector amb claus efímeres de la sessió. Així el relay
encamina la informació però no pot llegir la contrasenya de la gateway.

## 5. Windows i macOS

### 5.1 Implementació mínima

El POC ha de reutilitzar TypeScript:

```text
maps-connector
├── protocol Intesis compartit
├── discovery UDP
├── sessions TCP/XMODEM
├── client WebSocket cloud
├── pairing/token store
└── logs locals mínims
```

Primera forma d'execució:

- procés Node de consola en Windows;
- configuració per variables o fitxer local;
- reconnexió exponencial i heartbeat;
- tancament net i recuperació després de reinici del relay.

No cal Electron per al POC.

### 5.2 Empaquetat V1

Per aprofitar el protocol TypeScript sense enviar una aplicació pesada:

- executable standalone de Node;
- instal·lador MSI/EXE a Windows;
- `.pkg`/`.dmg` signat i notaritzat a macOS;
- autoarrencada per usuari;
- icona de tray/menu bar amb estat, versió, Connector ID, reconnect i exit;
- actualitzacions signades.

Un servei Windows o daemon de sistema només és necessari si MAPS ha de
funcionar sense cap sessió d'usuari oberta. Per tècnics amb portàtil, una app
per usuari que arrenca amb el login és més fàcil d'instal·lar i depurar.

Alternatives:

- **Electron**: màxima reutilització de TS, però massa gran per a un helper.
- **Tauri**: bona UI petita, però afegeix shell Rust/sidecar i no aporta gaire
  al primer POC.
- **Go/Rust natiu**: binari excel·lent, però obliga a portar el protocol; només
  ho faria més endavant si hi ha una raó de producte.
- **Service/daemon pur**: robust per site connectors, menys transparent per al
  portàtil del tècnic.

### 5.3 Firewall i xarxes corporatives

El Connector necessita:

- UDP broadcast/unicast 23 cap a la LAN;
- TCP 23 cap a les gateways;
- TCP 443 sortint cap al relay.

L'instal·lador només ha de crear les regles locals estrictament necessàries.
No cal una regla d'entrada pública. En xarxes que bloquegin broadcast, la UI ha
de permetre introduir una IP concreta i fer discovery unicast, capacitat que
el projecte ja contempla.

## 6. iPad

### 6.1 Opció recomanada

L'iPad obre MAPS Web normalment, però utilitza un Connector que ja és a la
mateixa LAN que les gateways:

```text
iPad/Safari ── Internet ── MAPS Cloud ── WSS ── Site Connector ── Gateway
```

El Connector pot ser:

- el portàtil Windows/macOS d'un tècnic;
- un petit PC/NUC;
- un appliance Linux/industrial;
- excepcionalment un NAS amb contenidors si és al mateix site.

Aquesta és l'única via que manté la mateixa web i evita una segona
implementació del protocol.

### 6.2 App nativa iPadOS

Una app nativa pot demanar permís de Local Network i utilitzar APIs de xarxa
natives per UDP/TCP. És viable, però implica:

- portar o embolcallar el protocol per iOS;
- permisos i UX de xarxa local;
- distribució App Store/MDM;
- cicle de releases separat;
- limitacions d'execució en background;
- una solució nativa específica si es vol USB.

Només té sentit si l'iPad sense cap Connector extern es converteix en un
requisit comercial important.

### 6.3 Capacitor

Un wrapper Capacitor per si sol no dona TCP/UDP al JavaScript web. Necessitaria
un plugin natiu propi que implementés discovery i el transport. Per tant,
Capacitor pot reutilitzar la UI, però no elimina el treball natiu del protocol.

### 6.4 Site Connector persistent

Sí, té sentit. És la millor solució per instal·lacions on es vulgui entrar amb
un iPad o donar suport remot posterior:

- instal·lat una vegada al site;
- sempre connectat sortint al cloud;
- associat a una organització/site;
- visible només per usuaris autoritzats;
- pot oferir commissioning local i suport remot auditat.

Ha de ser opcional. El flux principal de tècnic continuarà sent el Connector
al seu portàtil.

## 7. Backend i autenticació

### 7.1 Dades mínimes

Esquema conceptual:

```text
users
organizations
organization_members
projects
project_revisions
project_files                 (POC: bytea/text; futur: object key)
connectors
connector_pairing_codes
connector_presence            (efímer)
gateway_operation_audit
```

Cada consulta de projecte ha de comprovar organització i membership. No n'hi
ha prou amb saber que l'usuari està autenticat.

### 7.2 POC: Render + Neon

**Render Free**

- un únic servei Node amb Next.js i relay WebSocket;
- certificat TLS i URL pública;
- WebSockets sense timeout fix imposat per Render;
- s'adorm després de 15 minuts sense HTTP ni missatges WebSocket;
- un heartbeat del Connector manté el servei actiu mentre hi ha commissioning;
- el free pot reiniciar-se i no és producció.

**Neon Free**

- PostgreSQL estàndard;
- 0,5 GB per projecte, suficient per al POC indicat;
- scale-to-zero;
- usuaris/projectes/revisions al mateix esquema;
- Auth.js/Better Auth per no dependre d'una API d'auth propietària.

Com que els projectes ocupen poc, per al POC és raonable guardar XML i complete
blob a PostgreSQL (`text`/`bytea`). Això elimina un tercer proveïdor. Si el
volum creix, es crea un `ObjectProjectFileStore` compatible amb S3 i es migren
els blobs a Cloudflare R2, AWS S3 o MinIO.

### 7.3 Per què no Vercel com a relay principal

Vercel és molt còmode per Next.js i ja disposa de WebSockets, però les
connexions queden lligades a la durada màxima de la Function. Al pla Hobby amb
Fluid Compute són 300 segons. Una reconnexió cada cinc minuts pot demostrar el
flux, però és una variable artificial durant diagnostics i transferències.

Vercel pot allotjar la web, però per validar el Connector és millor un servei
Node convencional a Render.

### 7.4 Alternatives

| Plataforma | Ús possible | Free | Decisió |
|---|---|---:|---|
| Render + Neon | Next/API/relay + PostgreSQL | Sí, POC | Recomanada ara |
| Vercel + Neon | Next/API + PostgreSQL | Sí, amb límits | Web bona; relay no preferit |
| Cloudflare Workers + Durable Objects + Neon/R2 | Relay hibernable i edge | Sí | Molt bona, més lock-in |
| Azure Static Web Apps + Web PubSub | Web i relay gestionat | Sí, limitat | Bona si HMS prioritza Azure |
| AWS IoT Core + Cognito + S3 | MQTT/WSS, identitat i fitxers | Crèdits/12 mesos | Excel·lent a escala, POC complex |
| Supabase | Postgres/Auth/Storage/Realtime | 2 projectes actius Free | Vàlid, però no necessari |
| Firebase | Auth/Firestore/Storage | Sí | Més lock-in/NoSQL; no resol LAN |
| Appwrite | BaaS complet | Sí, 2 projectes | Mateix límit pràctic i menys portable |

**Cloudflare** és especialment adequat per un relay amb moltes connexions
intermitents: Durable Objects suporta WebSocket Hibernation. A canvi, el relay
queda modelat sobre Durable Objects i el Next.js actual pot necessitar
adaptació a Workers.

**Azure Web PubSub Free** permet 20 connexions simultànies i 20.000 missatges
diaris. És suficient per un POC petit, però diagnostics molt granulars poden
consumir els missatges ràpidament. Azure és una candidata seriosa si HMS ja té
Entra ID i governança Azure.

**AWS IoT Core** és una molt bona arquitectura futura per Connectors: MQTT/TLS,
identitats de dispositiu i escala massiva. No és la ruta més ràpida per validar
ara el producte.

### 7.5 Supabase en producció

Supabase no és només per prototips i podria quedar-se en un producte final.
Tanmateix:

- continua fent falta un relay/Connector;
- el Free només permet dos projectes actius;
- els projectes Free poden pausar-se per inactivitat;
- l'arquitectura no ha de dependre de triggers, Edge Functions o APIs
  exclusives de Supabase si la portabilitat és prioritària.

Neon resol el bloqueig actual perquè el seu Free permet molts projectes, però
Neon tampoc substitueix el relay ni l'object storage.

## 8. Migració del POC a producció

No hi hauria d'haver problemes rellevants si es respecten aquestes regles des
del primer commit cloud:

1. **Dockeritzar el servei Node**. Render executa el mateix artefacte que
   després pot anar a Azure Container Apps, AWS ECS/App Runner, Railway,
   Kubernetes o una VM.
2. **PostgreSQL estàndard**. Migracions SQL versionades i cap extensió Neon
   imprescindible.
3. **Una única `DATABASE_URL`** i pool de connexions configurable.
4. **Auth darrere d'un adaptador**. Auth.js/Better Auth guarda users/sessions
   al PostgreSQL; si es migra la DB, migra també la identitat.
5. **No escriure al disc de Render**. El filesystem és efímer. Tot projecte ha
   d'anar a PostgreSQL o object storage.
6. **`ProjectRepository`/`ProjectFileStore`** continuen sent la frontera. El
   domini no importa Neon, Render ni S3 directament.
7. **Protocol Connector versionat i independent del host**. La URL del relay
   és configuració; canviar de cloud no obliga a actualitzar el protocol
   Intesis.
8. **Cap URL hardcoded**. Web origin, relay, OAuth callbacks i storage per
   configuració.
9. **Sessions recuperables**. El Connector sempre reconnecta i torna a
   anunciar presència; no es confia en memòria del servidor per dades
   durables.
10. **Prova de portabilitat en CI**. Aixecar periòdicament el backend Docker
    contra PostgreSQL local i executar el flux amb `fake-gateway`.

Migració típica:

```text
Render                    → Azure Container Apps / AWS / Railway
Neon PostgreSQL           → es pot mantenir o pg_dump → altre PostgreSQL
Project files a Postgres  → es poden mantenir o copiar a S3/R2
Auth.js/Better Auth       → viatja amb les taules PostgreSQL
relay URL                 → canvi de configuració/DNS
MAPS Connector            → mateix protocol; potser només nova URL/certificat
```

Els punts que sí crearien problemes són guardar dades al disc efímer de Render,
utilitzar autenticació exclusiva del proveïdor sense adapter, posar lògica de
negoci en funcions propietàries o fer que el Connector conegui detalls interns
de Neon/Render.

## 9. Synology DS224+

El DS224+ té CPU Intel x86-64, 2 GB de RAM ampliables i pot executar Container
Manager. Tècnicament podria executar un contenidor Node/relay.

**Decisió pràctica: no utilitzar-lo com a backend públic del POC.**

Per fer-ho correctament caldria mantenir:

- exposició pública o Cloudflare Tunnel/Tailscale equivalent;
- domini i TLS;
- actualitzacions de DSM, contenidors i dependències;
- còpies, monitoratge i reinicis;
- disponibilitat elèctrica i de la connexió de casa/oficina;
- hardening d'un NAS que conté dades personals;
- resolució de CGNAT/firewall si no s'usa túnel.

Això aporta feina i risc sense validar millor el producte que Render.

Ús acceptable del Synology:

- laboratori intern;
- còpia de backups/exportacions;
- provar que el contenidor és portable;
- futur **Site Connector** només si el NAS és físicament a la mateixa LAN que
  les gateways. El Connector faria una connexió WSS sortint i no exposaria el
  NAS a Internet.

El NAS de casa/oficina no ajuda un tècnic que està fent commissioning en una
altra instal·lació.

## 10. Pla de POC immediat

### Objectiu

Validar que un MAPS Web desplegat pot executar discovery, connectar, mostrar
INFO/progrés i transferir una configuració mitjançant un Connector Windows,
sense accés directe del browser a la LAN.

### Abast

- Windows primer.
- Un usuari i un Connector aparellat; esquema preparat per multiusuari.
- Render Free + Neon Free.
- Projectes petits dins de PostgreSQL.
- WSS estàndard; JSON per control i frames binaris per blobs.
- `fake-gateway` per automatització i una gateway real només amb autorització.
- Sense USB, iPad natiu, auto-update ni alta disponibilitat.

### Passos tècnics

1. Extreure el transport Intesis a un mòdul compartit que pugui consumir tant
   l'app actual com l'executable Connector, sense duplicar-lo.
2. Crear `maps-connector` CLI per Windows amb discovery, connect, INFO,
   receive/deploy i client WSS.
3. Crear el relay amb pairing, presència, request IDs, heartbeat i routing
   browser ↔ Connector.
4. Implementar `PostgresProjectStore` sobre les interfícies existents.
5. Afegir Auth.js/Better Auth i ownership/organization a projectes.
6. Fer que les APIs de gateway utilitzin el Connector seleccionat en lloc del
   `GatewaySessionManager` del procés cloud.
7. Desplegar un únic servei Node a Render i una DB a Neon.
8. Provar reconnexió després de tallar WSS i reiniciar el servei.
9. Executar una prova de portabilitat local amb Docker + PostgreSQL.

### Criteris d'acceptació

- La web mostra Connector online/offline sense refrescar.
- Discovery retorna les mateixes gateways que l'execució local actual.
- Connect i INFO funcionen sense obrir ports entrants.
- Logs i progress arriben en realtime.
- Receive guarda el projecte sota l'usuari correcte.
- Deploy conserva tots els gates de família/capability actuals.
- Una caiguda del relay no deixa el Connector bloquejat; reconnecta.
- La contrasenya no apareix a DB, fitxers, missatges persistits ni logs.
- Un segon usuari no pot veure ni comandar el Connector/projectes del primer.
- El mateix contenidor funciona fora de Render contra PostgreSQL local.

## 11. V1 i evolució futura

### V1

- servei Render de pagament petit o contenidor corporatiu;
- PostgreSQL gestionat, Neon o corporatiu;
- Connector signat per Windows i macOS amb autoarrencada;
- pairing per organització;
- multiusuari i rols;
- operacions idempotents, cancel·lació, reconnect i auditoria;
- object storage amb URL signada si els fitxers deixen de ser petits;
- observabilitat i alertes;
- iPad via browser + Site Connector/portàtil a la LAN.

### Futur

- relay a Azure Web PubSub, AWS IoT Core o arquitectura pròpia escalada;
- Site Connector persistent/appliance;
- suport USB dins del Connector;
- app iPadOS nativa només si cal operar sense cap Connector extern;
- suport remot controlat i auditat;
- alta disponibilitat i routing de connectors entre múltiples instàncies.

## 12. Decisió final

Implementar ara **Render + Neon + Connector Windows outbound WSS**.

No utilitzar el Synology com a backend públic. No dependre de connexions del
navegador a localhost ni de permisos de LAN. No adoptar AWS/Azure/Cloudflare
abans de validar el flux complet amb el protocol actual.

La portabilitat es garanteix amb Docker, PostgreSQL estàndard, Auth.js/Better
Auth, les interfícies de persistence existents i un protocol WSS propi i
versionat.

## 13. Fonts externes

### Navegadors i xarxa local

- [Chrome: Local Network Access permission](https://developer.chrome.com/blog/local-network-access)
- [MDN: Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)
- [Chrome: Direct Sockets per a Isolated Web Apps](https://developer.chrome.com/docs/iwa/direct-sockets)
- [MDN: Secure contexts i localhost](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)
- [MDN: WebSocket client security](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)
- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [MDN: WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API)
- [Apple: permís de xarxa local a iPhone/iPad](https://support.apple.com/en-ie/102229)

### Backend, realtime i storage

- [Render Free](https://render.com/docs/free)
- [Render WebSockets](https://render.com/docs/websocket)
- [Neon pricing](https://neon.com/pricing)
- [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Azure Web PubSub pricing](https://azure.microsoft.com/en-us/pricing/details/web-pubsub/)
- [Azure Static Web Apps plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans)
- [AWS IoT Core pricing](https://aws.amazon.com/iot-core/pricing/)
- [Vercel WebSockets](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

### Synology

- [Synology DS224+](https://www.synology.com/en-ca/products/DS224%2B)
- [DS224+ datasheet](https://global.download.synology.com/download/Document/Hardware/DataSheet/DiskStation/24-year/DS224%2B/enu/DS224%2B_Data_Sheet_enu.pdf)
