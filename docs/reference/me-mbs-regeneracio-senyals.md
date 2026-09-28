# ME-MBS: regeneració de senyals a partir del model (anàlisi MAPS)

**Estat:** implementat per a adreces FIXED, amb un sol esclau Modbus o amb
esclaus múltiples (branques `feature/me-mbs-signal-regeneration` i
`feature/me-mbs-multiple-slaves`). **Objectiu:** que la webapp generi,
esborri i renumeri els senyals ME-MBS exactament com MAPS, perquè un projecte
desat des de la web sigui idèntic al que desaria MAPS.

Fonts:

- Descompilat: `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`
  (abreujat `P` = `IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs`,
  `F` = `IntesisBoxMAPS.Protocols.ME/frmExternalMe.cs`).
- Fitxers de referència desats amb MAPS (fora de Git): originals a
  `signal-ai/src/tmp/maps-ref/*.ibmaps`, còpia per a les proves a
  `.local-data/fixtures/me-mbs-maps-ref/`.

## 1. El problema

La webapp només canviava atributs de grups i controladors (`updateGroup`,
`updateController`, `updateMeScalars`, `updateMbsConfig`) i **no creava ni
esborrava senyals**. A MAPS, els senyals ME-MBS no els edita l'usuari
(`IsRemovableRow` → `false`, `P:748`): **es deriven del model**. Habilitar un
grup a la web, per exemple, no generava els seus registres Modbus, i el
projecte quedava incomplet.

## 2. Evidència dels fitxers de referència

**Els fitxers no són una seqüència acumulativa** (no són «l'anterior + un
canvi»). Comparant-ne el model i els senyals, cada fitxer té un pare clar;
la columna «Operacions» és la **derivació mínima compatible** amb el
contingut desat, no l'historial demostrat (els fitxers es van desar dins del
mateix minut).

| Fitxer | Pare | Canvis al model | Operacions de MAPS | Senyals (MBS = ME) |
|---|---|---|---|---|
| `base` | — | projecte buit | — | 0 |
| `grup-on` | `base` | C1: G1, G2, G3 habilitats (IC, 4 ventiladors) | `EnableGroup` ×3 | 132 = 30 + 34·3 |
| `grup-off` | `grup-on` | C1 G2 deshabilitat | `EnableGroup` (off) | 98 |
| `grup-tipus` | **`grup-on`** | C1 G3: IC → BU; ventiladors 4 → 0 (regla del formulari, §5.9) | 1 × `ModifyGroupUpdate` | 116 (G3 = 18) |
| `grup-fans` | `grup-tipus` | C1 G3: BU → LC; els ventiladors es queden a 0 | 1 × `ModifyGroupUpdate` | 112 (G3 = 14) |
| `ctrl-errors` | `grup-fans` | C1 G3: ventiladors 0 → 3; C1 amb «Individual error signals» | 1r `ModifyGroupUpdate`, 2n `ModifyController` | 213 (generals 30 + errors 100 al final del bloc) |
| `ctrl-2` | `ctrl-errors` | C2 G1 habilitat | `EnableGroup` | 277 |
| `consum` | `ctrl-2` | funció de consum activada | `UpdateConsumptionFunction` → `InitializeAndRestore` | 289 (+3 per grup) |
| `multi-base` | `base` | mode d'esclaus MULTIPLE, cap grup | `SlaveNumberChangedCallback` | 0 |
| `multi-grups` | `multi-base` | C1: G1 i G3 habilitats | `EnableGroup` ×2 | 98 (esclaus 1–3) |
| `multi-grups-mig` | `multi-grups` | C1 G2 habilitat | `EnableGroup` (+1 als esclaus de G3) | 132 (esclaus 1–4) |
| `multi-errors` | `multi-grups-mig` | C1 amb «Individual error signals» | `ModifyController` | 232 (esclau 5 per als errors) |
| `multi-ctrl-2` | `multi-errors` | C2 G1 habilitat | `EnableGroup` | 296 (esclaus 6–7) |

- `grup-tipus` també es podria obtenir des de `grup-off` (tornar a habilitar
  G2 i canviar el tipus) amb el mateix resultat; les proves fan servir el
  camí d'un sol pas.
- A `ctrl-errors`, l'ordre queda fixat per `idxExternal`: si el canvi de
  ventiladors hagués anat després de `ModifyController`, la supressió hauria
  renumerat els generals i el +1 hauria desaparegut.
- Sempre es compleix `ID = idxConfig = posició` a les dues llistes, i a la
  llista Modbus `idxExternal = idxConfig`.
- Els blocs que no canvien d'un fitxer al següent conserven el contingut
  camp per camp (amb FIXED, les adreces d'un grup no depenen dels altres),
  però **poden canviar d'identificadors** per la renumeració (`grup-off`: G3
  passa de 98–131 a 64–97).
- **`idxExternal` depèn de l'historial** (§5.1): no n'hi ha prou amb
  «regenerar a partir del model»; cal **reproduir les operacions de MAPS**.
- MAPS també reescriu `MBSlavesArray` a cada pas («General Controller 1»,
  «C1G1»…), **també amb un sol esclau** (§5.12).

## 3. Model de MAPS

Dues llistes paral·leles, `mInternal.MbsObjects` (Modbus) i
`mExternal.MeObjects` (ME), alineades per posició, cadascuna amb `ConfigID` i
`ExternalID`. Primitives (totes portades a `signals-engine.ts`):

| Primitiva | Font | Què fa |
|---|---|---|
| `DeleteObject(i, isLast)` | `P:733` | treu la posició `i` de les dues llistes; a l'últim del lot, renumera `ConfigID = ExternalID = posició` |
| `IncrementIdxConfig(offset, n)` | `ExternalME.cs:848`, `InternalMbs.cs:1625` | desplaça `+n` els objectes de després d'`offset` i posa `ExternalID = ConfigID` |
| `CalculteIdToInsert(c, g)` | `P:1154` | posició d'inserció d'un grup: darrer `ConfigID` del controlador amb `GroupID < g` i `UnitID = -1`, +1 |
| `CalculteIdToInsert(c)` | `P:1161` | final del bloc del controlador (0 si no en té) |
| `CreateControllerSignals` | `P:1316` | si el controlador no té senyals: insereix els 30 generals (`CreateThisControllerSignals`, `P:1574`) |
| `CreateGroupSignals(c, idx, g+1)` | `P:1353` | si el tipus ≠ `SYS_COMPONENT`: insereix a `CalculteIdToInsert` els senyals del grup (`CreateSignalsWithParams`, `P:1718`; recompte a `GetSignalsToAdd`, `P:1372`) |
| `CreateErrorSignals` | `P:1342` | insereix 100 senyals d'error (50 interiors + 50 exteriors) al final del bloc (`P:2247`) |
| `DeleteGroupSignals` | `P:1548` | esborra els senyals del grup |
| `DeleteControllerSignals` | `P:1300` | si el controlador ja no té cap grup habilitat, n'esborra tots els senyals |
| `InitializeControllers` | `P:3165` | per cada controlador amb algun grup: esborra'n els senyals i els torna a crear (generals, grups, errors) |
| `RestoreUserConfig` | `P:3146` | després de regenerar, recupera `isEnabled` del primer senyal antic amb la mateixa identitat ME (unitat inclosa) |
| `StoreUserAddress` | `P:721` | després de cada edició d'una fila: desa activat/adreça a `HvacAddresses` |
| `GetActiveFromUnit` | `StoredHvacAddresses.cs` | en crear un senyal, n'agafa l'activació de `HvacAddresses` |
| `InitializeMbSlaves` | `P:3102` | reconstrueix la llista d'esclaus Modbus (§5.12), a `slaves.ts` |
| `GetSlaveIndex` | `P:1652` | posició a la llista de l'esclau d'un grup, dels generals o dels errors d'un controlador (MULTIPLE), a `slaves.ts` |

Cada senyal Modbus rep descripció (`GetSignalDescription`, `P:2287`), valors
permesos (`GetAllowedValues`, `P:2502`) i adreça (`GetAddressFromSignal`,
`P:2733`), portats literalment (espais finals inclosos).

## 4. Correspondència: acció de la webapp → MAPS

Implementada a `src/gateway-families/me-mbs/regeneration.ts`; només es
regenera quan el valor canvia de debò (com `CheckGroupEqual` /
`CheckControllerEqual`).

| Patch de la webapp | Handler de MAPS | Efecte sobre els senyals |
|---|---|---|
| `updateGroup {enabled}` | `F:358` → `EnableGroup` `P:1108` | crea els generals del controlador si calia i els del grup (i els d'error si toca); o bé esborra el grup, i el controlador si ja no li queda cap grup |
| `updateGroup` tipus, ventiladors, consigna doble, URC o descripció | `F:527-591` → `ModifyGroupUpdate` `P:1181` | **només si el grup està habilitat**: esborra'n els senyals i els torna a crear |
| `updateGroup {capacity}` | — | cap |
| `updateController` model, compatibilitat, «Individual error signals» | `F:778`, `F:879` → `ModifyController` `P:1249` | si té algun grup: regenera tot el controlador |
| `updateController` descripció, IP, port, tipus | `NoUpdate_Validated` → `ModifyControllerNoUpdate` `P:1172` | cap |
| `updateController {enabled}` | (MAPS no en té) | cap: els senyals segueixen els grups |
| `updateMeScalars {temperatureMode}` | `F:929` → `UpdateTemperatureMode` `P:1225` | buida les llistes, `InitializeControllers` + `RestoreUserConfig` |
| `updateMeScalars {consumptionEnabled}` | `F:891` → `UpdateConsumptionFunction` `P:1213` | `InitializeAndRestore` (`P:3086`), igual que l'anterior |
| `updateMeScalars` polling, temps d'espera, ràfega | — | cap |
| `updateMbsConfig {addressMode}` | `AddressModeChanged` `P:1034` | posa `RegisterBase` (1 per a V4, 0 si no); FIXED: buida `HvacAddresses` + `InitializeControllers` **sense** `RestoreUserConfig`; CUSTOM: cap |
| `updateMbsConfig {slaveAddressMode}` | `frmInternalMBS.cs:452-471` → `SlaveNumberChangedCallback` `P:1058` | `InitializeControllers` + `RestoreUserConfig`, **sense** buidar abans les llistes; la webapp recalcula abans la llista d'esclaus (divergència, §6) |
| `updateMbsConfig {slaves}` | (la taula de MAPS és de només lectura) | **rebutjat** amb un 409: la llista es deriva dels grups |
| `updateRtuConfig {slaveNumber}` | `SlaveNumberChangedCallback` (sense regenerar) → `UpdateMBArrayNewSlaveNum` `P:1076` | cap als senyals; les adreces de la llista es desplacen la diferència |
| `updateSignal` | `UpdateObjectsFromRowInfo` → `StoreUserAddress` `P:698-731` | l'edició, i desa l'entrada a `HvacAddresses` |
| `addSignal`, `removeSignal` | (MAPS no ho permet) | **rebutjats** amb un 409 i un missatge clar |

Dins d'un lot, els `updateSignal` s'apliquen primer (els seus identificadors
es refereixen al document d'abans del lot) i després els canvis de model,
en l'ordre del lot. Si un canvi requereix un mode fora d'abast, el lot es
rebutja sencer amb un 422 i no es desa res.

## 5. Particularitats que es reprodueixen

1. **`idxExternal` en crear:** `CreateThisControllerSignals` crida
   `CreateMEObject(idx++, idx, …)`: C# avalua d'esquerra a dreta, així que
   `idxExternal = idxConfig + 1` als 30 generals. Grups (`(num, num)`) i errors
   (`(num, num++)`) queden iguals. Confirmat a tots els fitxers de referència.
2. **Senyal 46 («Dirty filter indication reset»):** MAPS hi passa
   `idxExternal = MeObjects.Count` (`P:2218`), diferent d'`idxConfig` quan el
   grup s'insereix davant d'un altre (habilitar G1 quan G2 ja té senyals).
3. **`IncrementIdxConfig` iguala `ExternalID = ConfigID`:** els generals d'un
   segon controlador desplaçats per la creació del primer perden el +1.
4. **Ordre d'inserció:** els blocs s'insereixen per `ConfigID` (generals del
   controlador, grups per índex, errors al final) i després les llistes
   s'ordenen per `ConfigID`. El segon controlador va darrere del primer
   (`configIDOffset = MeObjects.Count`); la família n'admet com a màxim dos.
5. **`ModifyGroupUpdate` no fa res amb un grup deshabilitat** (`P:1189-1193`);
   la supressió només passa per `EnableGroup`. `SYS_COMPONENT` no genera
   senyals de grup (`P:1360`).
6. **Dues regeneracions completes diferents:** `InitializeAndRestore` buida
   primer les llistes (tots els generals queden amb +1); `InitializeControllers`
   sol (canvi de mode d'adreces o d'esclaus) esborra i crea controlador a
   controlador, i en recrear el segon es renumeren els generals del primer.
7. **Configuració de l'usuari:** `HvacAddresses` (en crear un senyal,
   `GetActiveFromUnit`) i `RestoreUserConfig` (només en regeneracions
   completes). Una regeneració de grup o de controlador sense `HvacAddresses`
   perd les edicions, com a MAPS.
8. **Senyals d'error i `HvacAddresses`:** `StoreUserAddress` desa l'edició
   d'un senyal d'error amb `HvacUnitIndex = GroupID = -1` i `OUIndex = -1`,
   però la creació els busca per unitat. Per tant, **`HvacAddresses` no
   recupera mai l'edició d'un senyal d'error**, i la clau desada és la del
   senyal general 0 («Centralized controller communication error»), que és
   qui l'agafa en la regeneració següent. En canvi, **`RestoreUserConfig`
   sí que conserva l'activació dels senyals d'error** en una regeneració
   completa, perquè compara la identitat ME amb la unitat inclosa.
9. **Regles dels formularis que decideixen el model abans de regenerar**
   (portades al servidor; el client només en feia una part):
   - tipus BU/WH/CEH → 0 ventiladors (`F:822`, selector desactivat);
   - model AG-150 → compatibilitat antiga; qualsevol altre model → nova
     (`F:807`);
   - AG-150 → sense URC ni consigna doble als grups; compatibilitat antiga →
     sense consigna doble (`SaveThisController`, `F:656`). MAPS ho aplica en
     cada desat del controlador; la webapp, quan canvien el model o la
     compatibilitat, que és quan té efecte.
10. **`HvacAddresses` a l'XML:** darrer fill de `<Project>`, només mentre té
    entrades; `AddressExtra` i `AddressFlags` s'escriuen sempre, encara que
    siguin buits (`IntesisXML.SetAttributeWithDefault`).
11. **MAPS regenera tot en obrir projectes antics** (`NeedRecreateSignals`,
    `P:3061`): no portat (la webapp no regenera en obrir).
12. **Llista d'esclaus (`MBSlavesArray`):** `InitializeMbSlaves` la refà en
    tots dos modes a `EnableGroup`, `ModifyController` (si té grups) i les
    regeneracions completes (no a `ModifyGroupUpdate` ni en canviar el mode
    d'adreces). Per controlador amb grups: «General Controller N», `CNG<g>`
    per grup habilitat i «Error Signals Controller N» si té els senyals
    d'error; adreça = posició + número d'esclau de l'RTU. Només s'escriu
    mentre té entrades, entre `<SlaveAddressMode>` i `<Signals>`. MAPS
    rebutja el projecte si alguna adreça passa de 255 (`CheckParams`,
    `InternalMbs.cs:1599`): `MBS-SLAVE-ADDRESS-RANGE`.
13. **MULTIPLE:** cada senyal Modbus porta `SlaveIndex = GetSlaveIndex` i
    l'adreça és relativa a l'esclau (generals: el número de senyal; grups:
    només el desplaçament). `EnableGroup` suma 1 i `DeleteGroupSignals` resta
    1 al `SlaveIndex` dels senyals Modbus de darrere del grup (`P:1121`,
    `P:1557`). Confirmat a `multi-grups-mig`.
14. **Senyals d'error en MULTIPLE:** `CreateErrorSignalsWithParams` passa
    l'índex de l'esclau a la sobrecàrrega per unitat de `CreateMEMBSObject`,
    que en aquella posició espera la conversió (`P:2247`): els senyals queden
    amb `SlaveIndex = -1` i `IdxOperations = "<esclau>,0"`. Confirmat a
    `multi-errors` i `multi-ctrl-2` (`"4,0"`); es reprodueix tal qual.
15. **L'XBL no corregeix els índexs:** `MbsObject.GenerateXblItem` copia el
    `SlaveIndex` (`MbsObject.cs:272`) i `SetIndexFirstLast` hi busca els
    senyals de cada esclau; fora de la creació, a ME-MBS només l'escriuen el
    +1/−1 del punt 13.

## 6. Divergències i pendents

- **Modes V4_COMP i CUSTOM:** no portats. Qualsevol canvi que regeneri
  senyals en aquests modes (o que hi porti, com passar a V4) es rebutja amb
  un 422. Passar a CUSTOM s'accepta (MAPS no regenera). Caldran fitxers de
  referència propis.
- **Recalcular la llista en canviar el mode d'esclaus (divergència volguda):**
  MAPS reaprofita la llista que ja té; la webapp la torna a calcular abans,
  perquè fins ara s'hi podia editar a mà i un projecte desat des de la web
  pot no coincidir amb els grups. Amb una llista correcta el resultat és el
  mateix.
- **Índexs d'esclau desactualitzats (MULTIPLE), pendent de confirmar amb
  fitxers de MAPS:** deduïts del descompilat, cap fitxer de referència hi
  passa. (1) El +1/−1 del §5.13 també toca els senyals d'error: habilitar un
  grup del mateix controlador després d'activar-los els deixa amb
  `SlaveIndex = 0`, i la conversió continua apuntant a l'esclau antic.
  (2) `ModifyController` no toca l'altre controlador: activar els errors de
  C1 afegeix un esclau davant dels de C2, però els senyals de C2 conserven
  l'índex antic. Com que l'XBL els copia (§5.15), la passarel·la
  contestaria aquests senyals a l'esclau equivocat. La webapp els reprodueix
  com MAPS, però els detecta (`slaveIndexMismatches`, `slaves.ts`): error de
  validació `MBS-SLAVE-INDEX`, porta `project` del desplegament tancada i
  generador d'XBL que s'hi nega. Es refan canviant el mode d'esclaus a Single
  i tornant a Multiple. La mateixa comprovació avisa si la llista no
  coincideix amb els grups.
- **XBL en MULTIPLE:** verificat byte a byte amb l'XBL que genera la línia
  d'ordres de MAPS per a `multi-ctrl-2` (§8). La comparació va trobar que,
  amb la llista d'esclaus, MAPS no escriu el número d'esclau al node RTU
  (`CreateRTUConfigNode`, `InternalMbs.cs:737`); corregit al generador.
- **XBL amb la funció de consum:** el generador el continua rebutjant; els
  senyals de consum ja es regeneren com MAPS. Branca pròpia.
- **Assignació de comptadors:** en habilitar o deshabilitar un grup amb el
  consum activat, MAPS regenera l'assignació (`GenerateAssignmentsList`,
  `F:400`); la webapp no. Va amb el pendent d'assignació de comptadors.
- **Port del controlador:** MAPS té un sol camp `ip[:port]` que només mostra
  el port quan no és el del model (80, o 443 a l'AE-C400E; `F:455`), i
  `SaveThisController` posa el del model quan no n'hi ha. La webapp té IP i
  port separats: en canviar el model, un port per defecte passa al del model
  nou (servidor i esborrany de la UI) i un port propi es conserva. La UI
  envia sempre el port que mostra junt amb un canvi de model, perquè es desi
  el que veu l'usuari encara que coincideixi amb el desat. No afecta els
  senyals.
- **«Scan groups»:** MAPS fa un sol `ModifyController`; la webapp enviaria un
  patch per grup. Avui el botó està bloquejat.
- **Controlador «Enabled»:** als fitxers de referència és `False` encara que
  tingui grups habilitats; MAPS només mira els grups. La webapp el desa però
  no regenera res.

## 7. Implementació

- `src/gateway-families/me-mbs/signals-engine.ts`: les dues llistes en
  objectes, les primitives i els handlers de MAPS, `HvacAddresses` (lectura,
  `StoreUserAddress`, escriptura) i la reescriptura de les seccions
  `<Signals>` en format MAPS.
- `src/gateway-families/me-mbs/regeneration.ts`: cada patch de model →
  handler de MAPS, amb les regles dels formularis.
- `src/gateway-families/me-mbs/slaves.ts`: `InitializeMbSlaves`,
  `GetSlaveIndex` i la detecció d'índexs incoherents, compartits pel motor,
  la validació, el desplegament i el generador d'XBL.
- `src/server/projects/families.ts`: ordre dins del lot, rebuig
  d'`addSignal`/`removeSignal` i de la llista d'esclaus (409) i dels modes
  fora d'abast (422).

## 8. Validació

**Validat amb fitxers desats amb MAPS** (`signals-engine.test.ts`,
`regeneration.test.ts`; s'executen si hi ha `.local-data`):

- Els dotze passos del §2 (FIXED i MULTIPLE), cadascun des del seu pare i la
  cadena sencera: senyals idèntics camp per camp (`idxExternal` i
  `SlaveIndex` inclosos) i XML sencer idèntic llevat de `ProjectName`,
  `MBSlavesArray` inclòs. També a través dels patches reals de l'API.
- El nostre XBL de l'XML regenerat és idèntic byte a byte al que el nostre
  generador fa de l'XML de MAPS, en tots els passos llevat de `consum`.
- **XBL de MAPS en MULTIPLE:** `IntesisMAPS.exe -i <projecte> -o <sortida>
  -compID 64` (`CmdUtils.cs`, `Program.cs:98`) genera l'XBL sense
  passarel·la. Rebutja un projecte sense contrasenya de la passarel·la, així
  que es fa amb una còpia de `multi-ctrl-2` amb `Pwd="test1234"`; el fitxer
  que escriu és `[4 B longitud][XBL][4 B CRC32]`. El nostre XBL hi coincideix
  byte a byte (marca de temps a banda): `xbl/generate.test.ts`.
- Fixture real del 770 Air: reescriure-la i regenerar-la des del model la
  reprodueix byte a byte.

**Validat només amb el descompilat** (proves amb la fixture sintètica, que
s'executen sempre):

- Senyal 46 (§5.2), segon controlador (§5.3), `InitializeControllers` en
  canviar de mode (§5.6), −1 en deshabilitar un grup en MULTIPLE i els dos
  casos d'índexs desactualitzats (§6), desplaçament de la llista amb el
  número d'esclau, `HvacAddresses` (desar, recuperar, format XML),
  senyals d'error (§5.8), regles dels formularis (§5.9) llevat de la de BU,
  que sí que surt a `grup-tipus`.
- Tipus SYS_COMPONENT, URC, model AG-150 i compatibilitat antiga, unitats
  en ºF.

**Portat del descompilat però sense cap prova:** tipus FU, WH i CEH; consum
en kWh o per modes (fred/calor), que la webapp encara no deixa triar.

**Ajornat, no validat:** XBL amb consum, modes V4/CUSTOM, assignació de
comptadors, prova amb una passarel·la real.
