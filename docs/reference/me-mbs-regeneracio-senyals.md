# ME-MBS: regeneració de senyals a partir del model (anàlisi MAPS)

**Estat:** anàlisi per revisar abans d'implementar. **Objectiu:** que la
webapp generi, esborri i renumeri els senyals ME-MBS exactament com MAPS,
perquè un projecte desat des de la web sigui idèntic al que desaria MAPS.

Fonts:

- Descompilat: `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`
  (abreujat `P` = `IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs`,
  `F` = `IntesisBoxMAPS.Protocols.ME/frmExternalMe.cs`).
- Fitxers de referència desats amb MAPS (fora de Git):
  `signal-ai/src/tmp/maps-ref/*.ibmaps`.

## 1. El problema

Avui la webapp només canvia atributs de grups i controladors (`updateGroup`,
`updateController`, `updateMeScalars`, `updateMbsConfig`). **No crea ni esborra
senyals.** A MAPS, els senyals ME-MBS no els edita l'usuari
(`IsRemovableRow` → `false`, `P:748`): **es deriven del model**. Habilitar un
grup a la web, per exemple, no genera els seus registres Modbus, i el projecte
queda incomplet.

## 2. Evidència dels fitxers de referència

La seqüència és acumulativa (cada fitxer = l'anterior + un canvi).

| Fitxer | Canvi | Senyals (MBS = ME) | Per (controlador, grup) |
|---|---|---|---|
| `base` | projecte buit | 0 | — |
| `grup-on` | habilitar C1 G1, G2, G3 (IC, 4 fans) | 132 | generals 30 · 34 per grup |
| `grup-off` | deshabilitar G2 | 98 | 30 · 34 · 34 |
| `grup-tipus` | G3 → tipus 3 (fans 0) | 116 | G3 = 18 |
| `grup-fans` | G3 → tipus 1 | 112 | G3 = 14 |
| `ctrl-errors` | «Individual error signals» a C1 (i G3 fans 3) | 213 | generals 130 (30 + 100 errors) · G3 = 15 |
| `ctrl-2` | habilitar C2 G1 | 277 | + C2: 30 · 34 |
| `consum` | funció de consum | 289 | +3 per grup |

Sempre es compleix `ID = idxConfig = posició` a les dues bandes. En canvi,
**`idxExternal` depèn de l'historial** (vegeu §5.1): els 30 senyals generals
d'un controlador acabat de crear tenen `idxExternal = idxConfig + 1`; després
de qualsevol supressió tornen a ser iguals. Per tant, no n'hi ha prou amb
«regenerar a partir del model»: cal **reproduir les operacions de MAPS**.

## 3. Model de MAPS

Dues llistes paral·leles, `mInternal.MbsObjects` (Modbus) i
`mExternal.MeObjects` (ME), alineades per posició, cadascuna amb `ConfigID` i
`ExternalID`. Primitives:

| Primitiva | Font | Què fa |
|---|---|---|
| `DeleteObject(i, isLast)` | `P:733` | treu la posició `i` de les dues llistes; a l'últim del lot, renumera `ConfigID = ExternalID = posició` (ja implementat a la webapp) |
| `IncrementIdxConfig(offset, n)` | `ExternalME.cs:848`, `InternalMbs.cs:1625` | desplaça `+n` els objectes de després d'`offset` i posa `ExternalID = ConfigID` |
| `CalculteIdToInsert(c, g)` | `P:1154` | posició d'inserció d'un grup: darrer `ConfigID` del controlador amb `GroupID < g` i `UnitID = -1`, +1 |
| `CalculteIdToInsert(c)` | `P:1161` | final del bloc del controlador (0 si no en té) |
| `CreateControllerSignals` | `P:1316` | si el controlador no té senyals: insereix els 30 generals (`CreateThisControllerSignals`, `P:1574`) |
| `CreateGroupSignals(c, idx, g+1)` | `P:1353` | si el tipus ≠ `SYS_COMPONENT`: insereix a `CalculteIdToInsert` els senyals del grup (`CreateSignalsWithParams`, `P:1718`; recompte a `GetSignalsToAdd`, `P:1372`) |
| `CreateErrorSignals` | `P:1342` | insereix 100 senyals d'error (50 interiors + 50 exteriors) al final del bloc (`P:2247`) |
| `DeleteGroupSignals` | `P:1548` | esborra els senyals del grup (en mode MULTIPLE, abans fa `SlaveIndex--` als posteriors) |
| `DeleteControllerSignals` | `P:1300` | si el controlador ja no té cap grup habilitat, n'esborra tots els senyals |
| `InitializeControllers` | `P:3165` | per cada controlador amb algun grup: esborra'n els senyals i els torna a crear (generals, grups, errors) |
| `InitializeMbSlaves` | `P:3102` | reconstrueix la llista d'esclaus Modbus a partir dels grups habilitats |
| `RestoreUserConfig` | `P:3146` | després de regenerar, recupera `isEnabled` (i l'adreça en mode CUSTOM) dels senyals equivalents |
| `HvacAddresses` | `StoredHvacAddresses.cs`, `P:721` | a l'XML: activat/adreça per senyal que l'usuari ha editat; es consulta en crear senyals (`GetActiveFromUnit`, `GetAddressFromSignal`) |

Cada senyal Modbus rep descripció (`GetSignalDescription`, `P:2287`), valors
permesos (`GetAllowedValues`, `P:2502`) i adreça (`GetAddressFromSignal`,
`P:2733`; mode V4 a `P:2822`). La webapp ja té part d'aquestes taules a
`src/protocols/me/signals.ts`.

## 4. Correspondència: acció de la webapp → MAPS

| Acció a la webapp | Handler de MAPS | Efecte sobre els senyals |
|---|---|---|
| Habilitar un grup (toggle, «Add groups») | `F:358` → `EnableGroup` `P:1108` | crea els generals del controlador si calia; crea els del grup; en mode MULTIPLE, `SlaveIndex++` als posteriors; si el controlador té errors activats i encara no n'hi ha, els crea |
| Deshabilitar un grup | `EnableGroup` (branca `else`) | `DeleteGroupSignals` + `DeleteControllerSignals` (si ja no queda cap grup) |
| Canviar tipus, fans, consigna doble o URC d'un grup | `F:541-591` → `ModifyGroupUpdate` `P:1181` | **només si el grup està habilitat**: esborra'n els senyals i els torna a crear |
| Canviar la descripció d'un grup | `F:527` → `ModifyGroupUpdate` | igual que l'anterior (regenera el grup) |
| Canviar la capacitat d'un grup | (no regenera) | cap |
| Canviar model o compatibilitat del controlador | `F:1363,1374` → `ModifyController` `P:1249` | si té algun grup: regenera tot el controlador (generals, grups, errors) |
| Activar/desactivar «Individual error signals» | `F:879` → `ModifyController` | igual que l'anterior |
| Canviar IP, descripció, tipus, usuari o contrasenya del controlador | `NoUpdate_Validated` → `ModifyControllerNoUpdate` `P:1172` | cap |
| Aplicar un «Scan groups» | `F:759` → `ModifyController` | regenera tot el controlador |
| Canviar la unitat de temperatura | `F:931` → `UpdateTemperatureMode` `P:1225` | esborra-ho tot, `InitializeControllers` + `RestoreUserConfig` |
| Activar/desactivar la funció de consum (o mode/unitats) | `F:891` → `UpdateConsumptionFunction` `P:1213` | si canvia Enabled/mode/unitats: `InitializeAndRestore` (`P:3086`) |
| Canviar el mode d'adreces (FIXED/CUSTOM/V4) | `AddressModeChanged` `P:1034` | FIXED/V4: buida `HvacAddresses` i `InitializeControllers`; també canvia `RegisterBase` |
| Canviar el format de consigna (x1/x10, V4) | `TempSetpointChanged` `P:1050` | igual que l'anterior |
| Canviar el número d'esclau / mode d'esclaus | `SlaveNumberChangedCallback` `P:1058` | desplaça les adreces dels esclaus; si cal, `InitializeControllers` + `RestoreUserConfig` |
| Editar una fila de senyals (activat, adreça) | `UpdateObjectsFromRowInfo` → `StoreUserAddress` `P:721` | desa l'entrada a `HvacAddresses` |

## 5. Particularitats que cal reproduir

1. **`idxExternal` en crear:** `CreateThisControllerSignals` crida
   `CreateMEObject(idx++, idx, …)`: C# avalua d'esquerra a dreta, així que
   `idxExternal = idxConfig + 1` als 30 generals. Grups (`(num, num)`) i errors
   (`(num, num++)`) queden iguals. Confirmat a tots els fitxers de referència.
2. **Ordre d'inserció:** els blocs s'insereixen per `ConfigID` (generals del
   controlador, grups per índex, errors al final) i després les llistes
   s'ordenen per `ConfigID`. El segon controlador va darrere del primer.
3. **`ModifyGroupUpdate` no fa res amb un grup deshabilitat** (surt a `P:1189-1193`);
   la supressió només passa per `EnableGroup`.
4. **`SYS_COMPONENT` no genera senyals de grup** (`P:1360`).
5. **Mode d'esclaus MULTIPLE:** les adreces són relatives a l'esclau i cada
   senyal porta `SlaveIndex`; habilitar/deshabilitar un grup desplaça el
   `SlaveIndex` dels posteriors.
6. **Mode V4_COMP:** especificacions i adreces diferents (47–51, `P:2822`) i
   `RegisterBase = 1`.
7. **Configuració de l'usuari:** es conserva via `HvacAddresses` (en crear) i
   `RestoreUserConfig` (en regeneracions completes).
8. **MAPS regenera tot en obrir projectes antics** (`NeedRecreateSignals`,
   `P:3061`: si la versió del projecte és anterior a la de l'eina,
   `RecreateSignals`).

## 6. Divergències actuals de la webapp (fora de la regeneració)

- **Llista d'esclaus editable:** a la webapp l'usuari afegeix, treu i edita
  esclaus a Configuration; a MAPS `MbSlavesArray` es **deriva** dels grups
  habilitats (`InitializeMbSlaves`, `P:3102`), amb noms «General Controller 1»,
  «C1G3», «Error Signals Controller 1».
- **`HvacAddresses` no s'escriu:** si l'usuari desactiva un senyal a la web i
  després MAPS regenera, el canvi es perd.
- **Controlador «Enabled»:** als fitxers de referència és `False` encara que
  tingui grups habilitats; MAPS només mira els grups. Cal revisar què fa el
  toggle de la web.

## 7. Proposta d'implementació

1. **Motor ME a la banda servidor** (`src/gateway-families/me-mbs/signals-engine.ts`):
   llegeix les dues llistes de senyals de l'XML a objectes, hi aplica les
   primitives de §3 portades literalment, i reescriu les dues seccions
   `<Signals>` amb el format de MAPS.
2. **Els patches existents criden el motor** segons la taula de §4 (per
   exemple, `updateGroup {enabled}` → `EnableGroup`; `updateGroup {type}` →
   `ModifyGroupUpdate`). El contracte de l'API no canvia.
3. **Proves de referència:** partir de `base.ibmaps`, aplicar els mateixos
   passos que es van fer a MAPS i comparar senyal per senyal amb cada fitxer
   de referència (totes les columnes, incloent `idxExternal`, descripcions,
   adreces i conversions), i també l'XBL generat.
4. **Abast per decidir:** proposo cobrir primer el mode d'adreces FIXED i
   esclau SINGLE (els dels fitxers de referència) i els modes V4 / MULTIPLE /
   CUSTOM en una segona passada, amb fitxers de referència propis.

## 8. Preguntes obertes

1. Confirmar la seqüència exacta de passos de cada fitxer de referència
   (quin grup/controlador i en quin ordre), per reproduir-la als tests.
2. Els modes V4_COMP, MULTIPLE i CUSTOM: ara o en una segona fase?
3. La llista d'esclaus editable de la web (§6): alinear-la amb MAPS (derivada
   i només lectura) dins d'aquesta feina o a part?
4. `HvacAddresses`: escriure'l des de l'edició de senyals de la web dins
   d'aquesta feina?
