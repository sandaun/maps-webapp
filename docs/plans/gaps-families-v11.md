# Gaps per família — ME–MBS (770 Air) i KNX–MBM

Data: 2026-09-03. Branca: `feature/configuration-v10`.
Estat de referència: disseny V11 (`temp/MAPS Web v11 - standalone.html`) aplicat
a Configuration + AC units; codi descompilat a
`temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`.

Aquest document llista el que **falta** respecte al desktop MAPS i/o al disseny
V11, per família, amb la decisió presa o pendent per a cada punt. És un document
de treball: es va ratllant a mida que es tanquen punts.

Llegenda: **[fet]** · **[falta]** · **[blocat]** (depèn d'API de gateway en viu)
· **[apart]** (capítol propi pactat) · **[decidir]**.

---

## 1. Mitsubishi Electric AC ↔ Modbus Slave (770 Air, `me-mbs`)

### 1.0 Regeneració de senyals a partir del model — [fet] (FIXED, un o diversos esclaus)

Els patches de model regeneren els senyals ME-MBS com MAPS (habilitar un
grup, canviar-ne el tipus, activar els senyals d'error, la unitat de
temperatura, el consum, el mode d'adreces o d'esclaus), i les edicions de
senyal es conserven via `HvacAddresses`. Anàlisi, correspondència i nivells
de validació a `docs/reference/me-mbs-regeneracio-senyals.md`; fitxers de
referència desats amb MAPS a `.local-data/fixtures/me-mbs-maps-ref/` (fora de
Git).

| Pendent | Estat | Notes |
|---|---|---|
| Mode d'esclaus MULTIPLE | [fet 2026-09-28] | validat amb els fitxers `multi-*`; els índexs d'esclau que MAPS deixa desactualitzats es reprodueixen però bloquegen el desplegament (`MBS-SLAVE-INDEX`). XBL verificat byte a byte amb el de MAPS (`multi-ctrl-2`). Els dos casos d'índexs desactualitzats, confirmats amb `multi-stale-errors` i `multi-stale-ctrl2` (`me-mbs-regeneracio-senyals.md` §6) |
| Llista d'esclaus derivada dels grups (`InitializeMbSlaves`) | [fet 2026-09-28] | de només lectura a la UI i rebutjada a l'API (409); es desplaça amb el número d'esclau; `MBS-SLAVE-ADDRESS-RANGE` si passa de 255 |
| Modes V4_COMP i CUSTOM | [falta] | avui es rebutgen amb un 422 els canvis que regeneren senyals; cal portar-los amb fitxers de referència propis (V4: `v4-grup-on`, `v4-setpoint-x1`; CUSTOM va amb l'editor de registres, 1.4) |
| Assignació de comptadors en habilitar grups amb consum | [falta] | MAPS crida `GenerateAssignmentsList`; va amb l'assignació de meters (1.1) |
| Port 80/443 automàtic en desar un controlador | [fet 2026-09-28] | `SaveThisController`: en canviar el model, un port per defecte (80, o 443 a l'AE-C400E) passa al del model nou; un port propi es conserva. Servidor + esborrany de la UI. No afecta els senyals |
| «Scan groups» → un sol `ModifyController` | [blocat] | la webapp enviaria un patch per grup; el botó està bloquejat (1.2) |

### 1.1 Configuration

| Punt | Estat | Notes |
|---|---|---|
| General (nom, descripció, template RO) | [fet] | |
| Global parameters ME (temperature units, polling, timeouts, consumption, write burst) | [fet] | V11: targeta única + "Manage controllers →" |
| BMS · Modbus server: media, byte order, COV, commErrorTout, register base | [fet] | |
| BMS: address mode Fixed/Custom | [fet] | `updateMbsConfig` estès; falta l'editor de registres Custom (vegeu 1.4). En mode Custom, els canvis que regeneren senyals es rebutgen fins que es porti aquest mode (1.0) |
| BMS: slave addressing Single/Multiple + llista de slaves | [fet] | backend + UI + test de servei. Passar a Multiple regenera els senyals com MAPS (1.0); la llista es deriva dels grups i es mostra de només lectura, amb «Slave starting address» com a MAPS |
| BMS: RTU connection type | [fet] | read-only ("una sola EIA-485") |
| DNS / NTP / timezone (`<TimeConfiguration>`, atributs `DNS`/`DNS2`) | [decidir] | ni es parseja al model; pendent de decisió de producte |
| Security (password, certs) | [parcial] | Contrasenya només d'escriptura i bloqueig abans de desplegar [fet], vegeu §4. Certificats pendents. `Pwd` continua exclòs del model |
| Consumption function: assignació de meters | [falta] | només tenim el toggle `Enabled`; el desktop/V11 tenen "meter assignment" (issue `ME-*` del V11 ho referencia) |

### 1.2 AC units (pantalla de dispositius)

| Punt | Estat | Notes |
|---|---|---|
| Arbre controladors/grups amb toggles (enabled/integrated) | [fet] | |
| Edició de controlador (enabled, desc, IP, port, model, compatibility, error signals) | [fet] | |
| Edició de grup (desc, unit type, fan speeds, setpoint, URC, capacity condicional) | [fet] | |
| Add groups (graella M-NET 1–50) | [fet] | modal propi |
| **Scan groups** (descobrir unitats del bus M-NET) | [blocat] | modal dissenyat al V11; requereix sessió de gateway en viu (no existeix API). Botó desactivat amb hint |
| **Controller type** (Direct Connection / Expansion 1–3) | [falta] | al model és `type: number` (`src/protocols/me/model.ts:43`) sense enums ni edició; cal afegir-lo a xml-ops + zod + UI |
| Live values / Read group / Read status | [blocat] | sense API en viu; targetes amb "—" |
| Status (last response, errors 24h, groups in error) | [blocat] | idem |
| HTTPS del controlador segons el model | [falta] | la fitxa decideix HTTPS/HTTP pel port (`port === 443`), però el port sol no determina el protocol. Cal verificar al descompilat la regla del model (AE-C400E) abans de corregir-ho |
| Login data del controlador | [fet] | read-only per decisió (mai editable des de la web) |

### 1.3 Issues de validació

| Punt | Estat | Notes |
|---|---|---|
| `ME-CTRL-DISABLED`, `ME-CONTROLLER-LIMIT`, `ME-GROUP-LIMIT` apunten a `devices` | [fet] | |
| Banner d'issues amb acció "anar al camp" (estil V11) | [falta] | `ScreenIssues` pinta llista simple; el V11 té targetes amb botó d'acció que navega |
| Issues del V11 sense suport al model: "meter assignment", "custom addresses", "no description" | [falta] | generar-los a `validate.ts` quan el model ho suporti |
| `ME-SPEC-ADDRESS` fals als senyals d'error | [fet 2026-09-28] | l'adreça esperada usava l'`UnitId` ME (0–99), però MAPS numera les unitats Modbus 1–100 (`CreateErrorSignalsWithParams`, `P:2247`), i sortia 1 menys: 100 errors falsos en qualsevol projecte amb «Individual error signals». Ara es compara amb `UnitId + 1`; els fitxers de MAPS `ctrl-errors`, `ctrl-2`, `consum`, `multi-errors` i `multi-ctrl-2` validen sense errors |

### 1.4 Signals

| Punt | Estat | Notes |
|---|---|---|
| Conversions per senyal bidireccionals | [apart] | vegeu `docs/reference/conversions.md` |
| Conversions a la UI (columna, secció de Configuration, Overview) | [fet 2026-09-26] | **no n'hi ha, com MAPS**: `ConversionsEnabled()` retorna `false` a ME-MBS (`IntesisProjectMbsMe_RT.cs:3010`). Les genera el codi en regenerar els senyals. Detall a `docs/reference/conversions.md` §1.1b |
| L'API de patch accepta refs de conversió a ME-MBS | [fet 2026-09-26] | l'API rebutja editar conversions amb un 409, com MAPS, que no les deixa editar. `docs/reference/conversions.md` §5 |
| Editor de registres en mode Custom | [falta] | el mode es pot triar; editar les adreces custom per senyal cal revisar-ho a la taula de senyals |
| `addSignal` / `removeSignal` a l'API per a ME-MBS | [fet] | MAPS no permet afegir ni esborrar senyals ME-MBS (`IsRemovableRow` → false): es deriven del model. L'API els rebutja amb un 409 i un missatge clar |
| XBL amb la funció de consum activada | [falta] | el generador el rebutja a propòsit (sense mostra de referència). Els senyals de consum ja es regeneren com MAPS (fitxer de referència `consum`); falta un XBL de MAPS per validar-ne la compilació. Branca pròpia |

---

## 2. KNX ↔ Modbus Master (`knx-mbm`)

### 2.1 Add from Template — **ESSENCIAL** [falta]

Funcionalitat del desktop per afegir un **dispositiu Modbus amb tota la seva
taula de senyals ja mapejada** d'un sol cop. Sense això, cada device s'ha de
mapear senyal a senyal a mà — inviable amb comptadors/chillers repetitius.

Què sabem del descompilat (`Protocols.MB.External/`):

- `frmExternalMBM.cs`: botons `b_templateRTU` / `b_templateTCP` (Add from
  template per node) i `b_devExportTemplate` (Export template).
- `frmMbmTemplates.cs` (655 línies): diàleg amb catàleg + **Browse** (fitxer
  local) + **Download** (web HMS), preview dels senyals en taula, reanomenar el
  device, checkbox **"import disabled"** (els senyals entren desactivats),
  validació de nom duplicat.
- `ModbusTemplate.cs` (1188 línies): format del fitxer — XML `<Template
  Version MAPSVersion Author>` amb `<ExternalProtocol>` (device MBM + senyals),
  `<InternalProtocol>` (objectes KNX o BACnet) i `<Conversions>` (filters +
  operations; en BACnet també binary/multi-state i MAP table). Capçalera a
  `ParseTemplateHeader` (:836-848). `GenerateTemplate()` exporta un device del
  projecte com a template reutilitzable.
- `InternalTemplateCodes.cs`: templates interns `BAC` / `KNX` — joc de senyals
  per defecte del costat BMS.
- `ModbusTemplateError.cs`: errors de càrrega (format, versió, xifratge).

### Format del fitxer — RESOLT (2026-09-03)

Les extensions són **`.knxmbm`** (BMS = KNX) i **`.bacmbm`** (BMS = BACnet),
seleccionades per `Internal_Protocol` (`frmMbmTemplates.cs:129-134`). El
contenidor està descrit per sencer a
`IntesisBoxMAPS/TemplateCryptoMatic.cs` (159 línies, amb claus hardcoded):

- **Xifratge**: AES-128-CBC + PKCS7, clau `__K` i IV `__IV` de 16 bytes
  **hardcoded al binari** (`TemplateCryptoMatic.cs:18-28`) — per tant podem
  desxifrar qualsevol template d'HMS i xifrar-ne de propis, compatibles amb el
  desktop.
- **Contingut xifrat**: GZip de `UTF8(templateXML) ‖ HMAC` — HMAC-SHA256(32 B)
  amb l'IV com a clau; en lectura també accepta HMAC-SHA1 (20 B) legacy
  (`TryValidateHmac`, :43-73).
- **Payload**: l'XML del template descrit a dalt.

Conseqüència: les dues preguntes bloquejants (format i xifratge) estan
resoltes. Podem **importar templates d'HMS i exportar/importar templates
propis** amb total compatibilitat.

Pendents (abans de disseny):

1. **Implementar `template-crypto` + parser de template** a
   `src/server/` (AES-CBC + GZip + HMAC amb `node:crypto`, parser del
   `<Template>` al model MBM/KNX existent). Test amb un template real.
2. **Catàleg**: el desktop llegeix fitxers locals (Browse) i en baixa de la web
   HMS (Download). Nosaltres: upload de fitxer + (futur) catàleg propi.
3. **Àmbit d'aplicació**: aplicar template crea device + senyals externes +
   senyals internes (KNX) + conversions. Cal op de servidor `applyTemplate`
   atòmica (o seqüència de patches existents en una transacció).
4. **UI V12**: modal/pantalla amb preview de senyals, rename, import-disabled.
   Passar a disseny quan 1–3 estiguin clars.

### 2.2 Resta de gaps

| Punt | Estat | Notes |
|---|---|---|
| Configuration: General / Network / BMS · KNX / Modbus Master / Conversions | [fet] | nivell V11 o superior |
| NTP / timezone ("Network & time") | [decidir] | `<TimeConfiguration>` ni es parseja (mateix capítol que ME) |
| Security | [decidir] | idem |
| KNX Keys (Key1–3) | [falta] | parsejades, sense edició; el V11 no les mostra — prioritat baixa |
| Devices: add/remove nodes i devices, edició inline | [fet] | més complet que el V11 |
| Devices: camps i valors per defecte com MAPS | [fet 2026-09-25] | el timeout només surt a RTU (MAPS l'amaga a TCP, `p_devAdvanced`, i no l'envia al binari); un device nou neix deshabilitat, amb el primer slave lliure des de 1 i nom `Device <slave>` (`CreateRTUSlave`/`CreateTCPSlave`, `GetFirstFreeAddress`, `GetFirstFreeDeviceName`) |
| Devices: afegir N devices de cop | [falta] | desktop: `nb_RTUdevToAdd` + `b_addRTUDevice_Click` (`frmExternalMBM.cs:1061`), respecta `GetMaxDevicesPerNode` |
| Devices: clonar un device | [falta] | desktop: `b_devClone_Click` (`frmExternalMBM.cs:1599`) + `frmCloneCount` (quantes còpies) i `GetFirstFreeClonedName` |
| Devices: esborrar-ne diversos alhora | [falta] | desktop: `p_devDeleteMultiple` / `b_deviceDeleteMultiple` (devices marcats a l'arbre) |
| Poll now / estat online / mètriques per device | [blocat] | V11 ho dissenya; cal API en viu |
| Edit poll records | [falta] | desktop: `frmPollRecords.cs`; els poll records es generen dels senyals, el desktop permet retoc manual. Decidir si hi donem suport o sempre es regeneren dels senyals |
| **Projecte des de template real** (New project) | [falta] | avui: 2 entrades hardcoded i còpia de la fixture sintètica pre-poblada. V11: 26 templates, variants de capacitat/llicència, order code. Cal catàleg real i projecte net |
| Auto-enumeració d'adreces de grup KNX | [fet 2026-09-29] | eina compartida; vegeu el §4, punt 4 |
| Adreces addicionals (listening) a la taula | [falta] | següent PR; vegeu el §4, punt 5 |
| Edició de conversions + RemapLUTs | [apart] | pendent de disseny (prompt local a `temp/prompt-claude-design-conversions.md`); l'API d'assignació per senyal ja hi és. Vegeu `docs/reference/conversions.md` §4 |
| Columna "Conv. Id" al grid de senyals | [fet 2026-09-25] | només lectura i amagada per defecte com a MAPS (`GetColumnHeaders`); llegeix les dues meitats del senyal |
| Refs de conversió d'una sola meitat al model, export/import XLSX i patch | [fet 2026-09-26] | model amb les dues meitats; export i import amb "Conv. Id" i el full "Conversions" com MAPS (import més estricte en els casos perillosos); patch com `SaveObjectsConfiguration`. Detall a `docs/reference/conversions.md` §5 |
| Import ESF (ETS) | [decidir] | export ESF [fet]; import no existeix ni al V11 |
| Senyals virtuals / AllowedValues / Deadband per senyal | [falta] | fora del model editable (es preserven a l'XML) |

---

## 3. Transversals (afecten totes les famílies presents i futures)

- **Plataformes KTS/V6, RT/S700 i RT_AIR** [falta; conversió: decidir,
  investigat 2026-09-29]: protocols i AppId no distingeixen totes les variants.
  KNX-MBM encara no filtra plataforma en detectar; MBS-KNX i ME-MBS sí, però
  el desplegament compartit no compara la plataforma del projecte amb la del
  gateway. Cal delimitar el suport actual, completar el deadband per senyal
  KNX-MBM RT i decidir la conversió legacy explícita. Flux real de MAPS,
  diferències per família, firmware, abast i proves pendents a
  [Plataformes i conversió V6 a S700](platforms-v6-s700-migration.md).
- **API de gateway en viu** (sessió persistent per a scans, reads i mètriques):
  desbloqueja Scan groups (ME), Poll now / estats (KNX-MBM), live values,
  comptadors d'errors. És el blocant grosso de mig V11.
- **DNS/NTP/Security**: decisió de producte única (parsejar `TimeConfiguration`,
  `SecurityConfiguration`, `DNS`/`DNS2` al model compartit IBOX).
- **Configuration en pantalles estretes** [falta, branca pròpia; detectat
  2026-09-26]: amb finestra estreta o zoom, el menú lateral de seccions
  (236 px) i les files de camp (`FieldRow`, etiqueta fixa de 210 px) retallen
  els camps. Proposta: selector de secció a dalt en lloc del menú lateral i
  etiquetes damunt dels camps quan no hi ha amplada, mantenint el disseny en
  pantalles amples. Conversions ja s'adapta (branca de l'editor de
  conversions); la resta de seccions, no.
- **Banner d'issues amb accions** (V11): generalitzar `ScreenIssues` amb
  navegació al camp/secció afectada.
- **Esborrar projectes** [fet 2026-09-29]: no es podia fer des de la webapp
  (2026-09-28). El magatzem ja té `deleteProject`
  (`src/server/persistence/local-store.ts`). S'ha afegit `DELETE` a
  l'API, botó i confirmació a `/projects`, associació entre sessió i projecte,
  i bloqueig si el projecte està obert en una sessió o en una pujada.
  L'associació la comunica el navegador: si dues pestanyes seleccionen
  projectes diferents sobre la mateixa sessió, preval l'última escriptura.
  Tancar una pestanya no allibera l'associació; cal canviar de projecte o
  desconnectar la sessió. La protecció de les pujades és independent i
  es conserva a `globalThis` durant les recompilacions de Next.js.
- **Afegir elements a un XML compacte esborra els germans** [fet 2026-09-29]:
  `appendChildIndented` de `knx-mbm/xml-ops.ts` i `me-mbs/xml-ops.ts`
  substitueix tots els fills quan el pare no acaba en espai en blanc (XML
  sense indentació). Reproduït el 2026-09-28: `addSignal` en un KNX–MBM
  compacte passa de 2 senyals a 1 i perd `IndAddress`. Els fitxers de MAPS
  sempre van indentats, però un fitxer reformatat es malmetria. `mbs-knx` ja
  en porta la correcció (afegeix sense indentació), i també les operacions
  de la biblioteca de conversions, que des del 2026-09-28 són a
  `core/conversions/library-xml.ts` i les fan servir totes les famílies.
  Corregit amb `core/project-format/xml/append-indented.ts`, compartit per
  KNX–MBM, ME–MBS, MBS–KNX i la biblioteca de conversions. Regressions amb
  XML compacte i amb el format MAPS (dos espais i CRLF) a
  `gateway-families/compact-xml.test.ts` i
  `core/project-format/xml/append-indented.test.ts`. Format contrastat amb
  `IntesisBoxMAPS/IntesisXML.cs:353-359`.
- **Pre-comandes de pujada sense prefix** [fet i validat en viu 2026-09-25: re-pujada del mateix blob, pre-comandes en 0,03 s, projecte idèntic]: `SEND_PRE_COMMANDS` envia
  `0:SPONS=0`…; el MAPS les envia amb prefix (`frmSendSingle.cs:303`,
  `0KX:SPONS=0`) i el firmware ignora la variant sense prefix en silenci
  (validat en viu 2026-09-25). Cada pre-comanda espera fins a 5 s i no atura res.
- **Pushes dins la resposta d'una comanda** [fet 2026-09-25, `isCommandAnswer`]: mentre una comanda de
  consola espera el seu silenci, el col·lector s'empassa les línies espontànies
  (`0KX:00020003=1.00;1`, `0KX:[Tx] BC …`, `DB_MSG`) i surten a la consola en
  lloc del monitor. El MAPS encamina cada línia rebuda pel seu tipus
  (`ManageConsoleViewers`, frmMain.cs:3274), no per comanda.
- **COMMS/DEBUG sempre actius** [fet 2026-09-25: DEBUG opcional, botó "Debug" apagat per defecte]: el MAPS només activa `SPONS` per
  defecte; `COMMS` i `DEBUG` depenen de les caselles del visor (frmMain.cs:2159).
  Nosaltres activem tot: `DEBUG=1` al costat KNX omple el log de `DB_MSG`/`DB_AL`
  i al Modbus cada petició surt dues vegades (`[Tx] 01 03 …` de COMMS i
  `[Tx] Slv:1 Func:3 …` de DEBUG).

---

## 4. Pendents després de MBS–KNX (un PR per punt, en aquest ordre)

MBS–KNX es va fusionar amb el PR #20 (`docs/reference/mbs-knx-analisi.md`).
El que queda és compartit entre famílies. Abans de cada PR, cal revisar què
ja existeix i què es pot compartir.

1. **Contrasenya abans de desplegar** (totes les famílies) — **[fet]**.
   - **MAPS:** no envia si la contrasenya del projecte no és vàlida.
     `frmMain.cs:7413`: `PasswordNeeded && !TypeUtils.CheckPasswordIntegrity(ConfigPwd)`.
     Mostra «Please, set a valid Password for the Project» i obre el diàleg
     de canvi (`frmGateway.b_changePwd_Click` → `frmProtectProject`).
     `CheckPasswordIntegrity` (`TypeUtils.cs:712`) rebutja una contrasenya
     buida o no ASCII. `PasswordNeeded` és true per defecte; se sobreescriu
     en poques classes (MBSIR, MBSPAAHU, BacnetIr).
   - **Nosaltres:** la contrasenya és `IBOX Pwd`. El model no la llegeix, per
     disseny, i no ha d'arribar mai al navegador. L'XBL la hi escriu
     (`core/xbl/ibox-xml.ts`).
   - **Què va passar:** la plantilla de MBS–KNX la porta buida, i el deploy
     de la prova en viu va deixar la unitat sense contrasenya.
   - **Implementat:** porta `password` al deploy i editor compartit a
     Configuration → Security, només d'escriptura, amb confirmació.
     El diàleg de MAPS limita l'entrada a 8 caràcters ASCII imprimibles;
     el control d'enviament només comprova no buida + ASCII. Es mantenen
     les dues regles. Recerca i verificacions a
     `docs/reference/project-password.md`.
2. **Integritat de l'XML compacte** (KNX–MBM, ME–MBS) — **[fet]**. Vegeu el
   punt del §3. Helper compartit i regressions per als fills existents,
   contenidors buits i format MAPS.
3. **Esborrar projectes** — **[fet 2026-09-29]**. Vegeu el punt del §3.
4. **Numeració automàtica** d'adreces Modbus i GA KNX (eina de taula
   compartida) — **[fet 2026-09-29]**.
   - **MAPS:**
     - Modbus: `ExternalMbm.AutoEnumRegisters` (`ExternalMbm.cs:2416`;
       0–65.535) i `InternalMbs.AutoEnumRegisters` (`InternalMbs.cs:1755`;
       màxim 20.000 al diàleg dels registres MBS). Les files seleccionades es
       processen per ordre de taula amb adreça inicial + increment.
     - KNX: `ExternalKnx.AutoEnumGroupAddresses` (`ExternalKnx.cs:816`) i
       `InternalKnx.AutoEnumGroupAddresses` (`InternalKnx.cs:1110`). Només
       canvia l'adreça d'enviament; el diàleg `frmAutoEnumKNX.cs` permet
       format d'1, 2 o 3 nivells, adreça inicial i increment.
     - `ExternalMbm` i `ExternalKnx` salten els objectes virtuals sense avançar
       el comptador. El diàleg KNX comprova `inici + i`, però no
       `inici + i·increment`: és un error de MAPS que no hem de reproduir.
     - ME–MBS també enllaça `AutoEnumRegister` i desa les adreces amb
       `StoreUserAddress` (`IntesisProjectMbsMe_RT.cs:2949-2970`).
   - **Nosaltres:** acció compartida a la barra de selecció de KNX–MBM,
     MBS–KNX i ME–MBS (només en mode Custom). Mostra una previsualització,
     valida tota la seqüència, salta els objectes virtuals, a MBS–KNX avisa de
     les col·lisions de registres noves i aplica un sol lot amb un sol desfer.
     El nivell del GA (1, 2 o 3) es llegeix de l'atribut `String`, es mostra a
     la taula i a l'export de graella, i l'edició manual desa el nivell escrit,
     com MAPS (`ExternalKnx.cs:1147-1153`). `Value` continua sent numèric.
5. **Adreces addicionals (listening) a KNX–MBM** — **[fet 2026-09-29]**.
   - **MAPS:** `InternalKnx` té la columna `COL_LISTENING`
     (`InternalKnx.cs:29`), la desa amb `ExtractGroupAddress`
     (`InternalKnx.cs:808-812`) i exigeix U o W si n'hi ha
     (`InternalKnx.cs:1092`).
   - **Nosaltres:** KNX–MBM mostra i edita la columna com MBS–KNX, amb
     validació i desfer. La regla U o W ja era compartida.
   - A les dues famílies, el model conserva el nivell de cada adreça i l'XML,
     la graella i l'XLSX escriuen els formats d'1, 2 o 3 nivells.
6. **Reordenar files** — **[implementat 2026-09-29; validació visual pendent]**.
   - **MAPS:** Move Up/Down (`ModifyObjectsPosition` → `MoveRowByOne` a
     `InternalMbs.cs:1013` i `ExternalKnx.cs:768`). Intercanvia les dues
     files als dos costats i en renumera `ConfigID`/`ExternalID`.
   - **Nosaltres:** op `moveSignal` atòmica, en una petició independent,
     amb renumeració de les dues meitats i preservació de l'XML.
     Contracte `{ id, count, toIndex }`: `count` opcional, per defecte 1;
     `toIndex` és la posició final de la primera fila del bloc. Els rangs
     invàlids retornen 422; la mateixa posició no altera XML, revisió ni historial.
     Com MAPS (`b_moveUp`/`b_moveDown`), *Move up* / *Move down* són a la barra
     de selecció i mouen la selecció, amb un sol desfer. La selecció ha de ser
     contigua, com `CheckObjectsSorted` de MAPS (`frmMain.cs:8873-8892`); la UI
     rebutja seleccions discontínues sense enviar cap patch. Als límits, els
     botons queden desactivats. Poden travessar el límit de pàgina; la selecció
     segueix les files mogudes, també en desfer.
   - **Extensió:** cada fila té una maneta per arrossegar-la a qualsevol posició
     de la pàgina. L'arrossegament és individual (`count: 1`), encara que hi hagi
     diverses files seleccionades. Sense drecera de teclat: els botons ja són
     accessibles.
   - Desactivat amb cerca, filtres o senyals deshabilitats ocults, i mentre
     hi ha edicions pendents. No es barregen moviments amb altres patches;
     la revisió del projecte protegeix dels canvis d'altres sessions.
   - Infraestructura reutilitzable: helper XML `core/signals/move-signal.ts`
     hook `useSignalReorder`, maneta opcional de `SignalsGrid` i botons de `SignalsWorkspace`. Cada família habilita l'operació
     al registre i aporta la seva renumeració; no s'activa automàticament.
   - Afecta KNX–MBM i MBS–KNX. A ME–MBS no, perquè els senyals es deriven del
     model.
7. **XLSX a MBS–KNX.**
   - **Nosaltres:** KNX–MBM i ME–MBS ja el tenen (`server/exports/xlsx-signals.ts`,
     `server/imports/xlsx-signals.ts`). MBS–KNX respon amb un 422
     (`server/projects/service.ts`).
   - **MAPS:** `IntesisProjectMBSKNX_RT.AddObjectsFromExcel` /
     `CheckExcelRowIntegrity` (`:868-930`).
8. **ETS/ESF** per a les famílies amb KNX.
   - **Export:** existeix per a KNX–MBM (`server/exports/esf-knx.ts`). Falta
     per a MBS–KNX, on el KNX és el costat extern.
   - **Import:** no existeix. MAPS: `KnxProjectParser` / `EsfProjectParser`
     (`Protocols.KNX.External/`) i `PopulateProjectFromKNXDataGridView`
     (`IntesisProjectMBSKNX_RT.cs:932`).

**Correcció petita independent.** El camí de traducció de la visió general
(`overview-screen.tsx`, `.overflow-x-auto`) fa 666 px en un espai de 661 a
1440 px d'ample, i hi apareix una barra horitzontal. Passa igual a totes les
famílies.
