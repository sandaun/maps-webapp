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

### 1.0 Regeneració de senyals a partir del model — [fet] (FIXED + un sol esclau)

Els patches de model regeneren els senyals ME-MBS com MAPS (habilitar un
grup, canviar-ne el tipus, activar els senyals d'error, la unitat de
temperatura, el consum, el mode d'adreces o d'esclaus), i les edicions de
senyal es conserven via `HvacAddresses`. Anàlisi, correspondència i nivells
de validació a `docs/reference/me-mbs-regeneracio-senyals.md`; fitxers de
referència desats amb MAPS a `.local-data/fixtures/me-mbs-maps-ref/` (fora de
Git).

| Pendent | Estat | Notes |
|---|---|---|
| Modes V4_COMP, CUSTOM i MULTIPLE | [falta] | avui es rebutgen amb un 422 els canvis que regeneren senyals; cal portar-los amb fitxers de referència propis |
| Llista d'esclaus derivada dels grups (`InitializeMbSlaves`) | [falta] | a la webapp continua sent editable |
| Assignació de comptadors en habilitar grups amb consum | [falta] | MAPS crida `GenerateAssignmentsList`; va amb l'assignació de meters (1.1) |
| Port 80/443 automàtic en desar un controlador | [falta] | `SaveThisController`; no afecta els senyals |
| «Scan groups» → un sol `ModifyController` | [blocat] | la webapp enviaria un patch per grup; el botó està bloquejat (1.2) |

### 1.1 Configuration

| Punt | Estat | Notes |
|---|---|---|
| General (nom, descripció, template RO) | [fet] | |
| Global parameters ME (temperature units, polling, timeouts, consumption, write burst) | [fet] | V11: targeta única + "Manage controllers →" |
| BMS · Modbus server: media, byte order, COV, commErrorTout, register base | [fet] | |
| BMS: address mode Fixed/Custom | [fet] | `updateMbsConfig` estès; falta l'editor de registres Custom (vegeu 1.4). En mode Custom, els canvis que regeneren senyals es rebutgen fins que es porti aquest mode (1.0) |
| BMS: slave addressing Single/Multiple + llista de slaves editable | [fet] | backend + UI + test de servei. Passar a Multiple regenera senyals a MAPS i ara es rebutja fins que es porti aquest mode (1.0) |
| BMS: RTU connection type | [fet] | read-only ("una sola EIA-485") |
| DNS / NTP / timezone (`<TimeConfiguration>`, atributs `DNS`/`DNS2`) | [decidir] | ni es parseja al model; pendent de decisió de producte |
| Security (password, certs) | [decidir] | `Pwd` exclòs del model a propòsit; V11 hi té secció |
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
| Login data del controlador | [fet] | read-only per decisió (mai editable des de la web) |

### 1.3 Issues de validació

| Punt | Estat | Notes |
|---|---|---|
| `ME-CTRL-DISABLED`, `ME-CONTROLLER-LIMIT`, `ME-GROUP-LIMIT` apunten a `devices` | [fet] | |
| Banner d'issues amb acció "anar al camp" (estil V11) | [falta] | `ScreenIssues` pinta llista simple; el V11 té targetes amb botó d'acció que navega |
| Issues del V11 sense suport al model: "meter assignment", "custom addresses", "no description" | [falta] | generar-los a `validate.ts` quan el model ho suporti |

### 1.4 Signals

| Punt | Estat | Notes |
|---|---|---|
| Conversions per senyal bidireccionals | [apart] | vegeu `docs/reference/conversions.md` |
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
| Poll now / estat online / mètriques per device | [blocat] | V11 ho dissenya; cal API en viu |
| Edit poll records | [falta] | desktop: `frmPollRecords.cs`; els poll records es generen dels senyals, el desktop permet retoc manual. Decidir si hi donem suport o sempre es regeneren dels senyals |
| **Projecte des de template real** (New project) | [falta] | avui: 2 entrades hardcoded i còpia de la fixture sintètica pre-poblada. V11: 26 templates, variants de capacitat/llicència, order code. Cal catàleg real i projecte net |
| Auto-enumeració d'adreces de grup KNX | [falta] | documentada a `docs/plans/knx-mbm-mvp.md:144`; no és al V11 |
| Edició de conversions + RemapLUTs | [apart] | vegeu `docs/reference/conversions.md` |
| Import ESF (ETS) | [decidir] | export ESF [fet]; import no existeix ni al V11 |
| Senyals virtuals / AllowedValues / Deadband per senyal | [falta] | fora del model editable (es preserven a l'XML) |

---

## 3. Transversals (afecten totes les famílies presents i futures)

- **API de gateway en viu** (sessió persistent per a scans, reads i mètriques):
  desbloqueja Scan groups (ME), Poll now / estats (KNX-MBM), live values,
  comptadors d'errors. És el blocant grosso de mig V11.
- **DNS/NTP/Security**: decisió de producte única (parsejar `TimeConfiguration`,
  `SecurityConfiguration`, `DNS`/`DNS2` al model compartit IBOX).
- **Banner d'issues amb accions** (V11): generalitzar `ScreenIssues` amb
  navegació al camp/secció afectada.
- **Pre-comandes de pujada sense prefix** [falta]: `SEND_PRE_COMMANDS` envia
  `0:SPONS=0`…; el MAPS les envia amb prefix (`frmSendSingle.cs:303`,
  `0KX:SPONS=0`) i el firmware ignora la variant sense prefix en silenci
  (validat en viu 2026-09-25). Cada pre-comanda espera fins a 5 s i no atura res.
- **Pushes dins la resposta d'una comanda** [falta]: mentre una comanda de
  consola espera el seu silenci, el col·lector s'empassa les línies espontànies
  (`0KX:00020003=1.00;1`, `0KX:[Tx] BC …`, `DB_MSG`) i surten a la consola en
  lloc del monitor. El MAPS encamina cada línia rebuda pel seu tipus
  (`ManageConsoleViewers`, frmMain.cs:3274), no per comanda.
- **COMMS/DEBUG sempre actius** [decisió]: el MAPS només activa `SPONS` per
  defecte; `COMMS` i `DEBUG` depenen de les caselles del visor (frmMain.cs:2159).
  Nosaltres activem tot: `DEBUG=1` al costat KNX omple el log de `DB_MSG`/`DB_AL`
  i al Modbus cada petició surt dues vegades (`[Tx] 01 03 …` de COMMS i
  `[Tx] Slv:1 Func:3 …` de DEBUG).
