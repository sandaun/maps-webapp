# Anàlisi MBS–KNX (KNX ↔ Modbus Slave, IN701KNX)

Data: 2026-09-28. Branca: `feature/mbs-knx`.
Fonts: descompilat de MAPS a `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`
(rutes relatives a aquest directori), guia HMS
`temp/MAPS PACK/in701-mbs-knx-maps-guide-v1-0-0-en.pdf` (v1.0.2) i la
plantilla `Templates.IN-MBS-KNX-Template.tmpl`.

> L'anàlisi es va fer amb el codi i la guia, abans de tenir projectes desats
> per MAPS. Els punts marcats **[confirmat, §10]** s'han contrastat després
> amb aquests projectes (§10).

---

## 1. Identificació

| Què | Valor | Font |
|---|---|---|
| Classe de projecte | `IntesisProjectMBSKNX_RT` | `IntesisBoxMAPS.Projects/IntesisProjectMBSKNX_RT.cs` |
| AppId | `IBOX_MBS_KNX = 7` | `IntesisBoxMAPS/AppId.cs:19`; `_RT.cs:32` |
| Plataforma | `PlatformGw.RT` = **2** | `_RT.cs:34`; `IntesisBoxMAPS/PlatformGw.cs` |
| Order codes | `IN701KNX1000000`, `…2500000`, `…6000000`, `…1K20000`, `…3K00000` | `_RT.cs:1248-1251` |
| Llicències | 100 / 250 / 600 / 1200 / 3000 punts | `_RT.cs:1243-1246` |
| Protocols | intern `InternalMbs`, extern `ExternalKnx` | `_RT.cs:62-73` |

La classe plana `IntesisProjectMBSKNX` només difereix en la plataforma i l'order
code (`INMBSKNX***vv00`, sèrie antiga). **Seguim la `_RT`.**

**És el mateix maquinari que KNX–MBM** (IN701KNX), però amb una altra
aplicació de firmware. Quan es connecta un projecte MBS–KNX a una unitat que
corre KNX–MBM, MAPS detecta que l'AppId no coincideix però que el maquinari és
compatible (`CompIds`), respon `NEED_SWAP` i ofereix un **canvi de firmware**
(`IntesisProject.cs:1493-1515`, `frmMain.cs` `ResultNeedSwap` →
`FirmwareSwap` / `RecieveProjectAndSwap`). La webapp no fa canvis de firmware:
aquest pas es fa amb MAPS (vegeu l'§9).

Estat de la unitat de proves (INFO? per UDP, només lectura, 2026-09-28):
`192.168.2.167`, `APPID:4` (KNX–MBM), `APPVERSION:2.0.2.0`, `APPLIC:3000`,
`CFGNAME:roundtrip-test`, `COMPIDs:1`, `PCBID:109`.

### Claus de detecció

- Arrel: `InternalProtocol="Modbus Slave"` + `ExternalProtocol="KNX"`.
- `Platform="2"` **[confirmat, §10]**: la plantilla és d'estil LinkBox i no porta
  l'atribut; MAPS l'escriu en desar.
- Node XML intern `ProtocolType="ModBus Slave"` (amb majúscules
  diferents a la plantilla) **[confirmat, §10]** què escriu MAPS en desar.
- `Header CompatibilityID="7"`.

## 2. Estructura de l'XML

L'envelope (`Columns`, `Connection`, `Header`, `IBOX` amb `Conversions` i
`RemapLUTs`) és el comú de totes les famílies. Els dos costats:

### 2.1 `InternalProtocol` — Modbus Slave (`InternalMbs.GetXMLProtocol`, `InternalMbs.cs:1033-1091`)

Mateix esquema que a ME–MBS: `Media`, `ByteOrder`, `UpdateCOV`, `AddressMode`,
`TempSetpoint`, `FormatExtra`, `CommErrorTout`, `RegisterBase`,
`RTUConfig` (`ConnectionType Baudrate DataBits Parity StopBits SlaveNumber`),
`TCPConfig` (`Port KeepAlive`), `TemperatureSensor`, `SlaveAddressMode`,
`MBSlavesArray` (només si n'hi ha) i `Signals`.

Cada `<Signal ID>` (`MbsObject.ToXml`, `MbsObject.cs:136-209`), en aquest ordre:
`isEnabled`, `idxConfig`, `idxExternal` (= `ConfigID`), `IdxOperations`,
`IdxFilters`, `Description`, `LenBits`, `Format`, `Bit`, `Address`,
`ReadWrite`, `StringLength`, `SlaveIndex`, `GatewayIndex`,
`Virtual Status Fixed General`, `ProtocolIndex`.

En llegir (`MbsObject(XmlNode)`, `:91-134`): `LenBits=1` → 16 + `UNSIGNED`;
`LenBits=-1` → 16; `Format=255` → `NO_FORMAT (-1)`. La plantilla porta
precisament `LenBits=1`/`Format=255`, per això un projecte desat per MAPS no
serà igual que la plantilla.

### 2.2 `ExternalProtocol` — KNX (`ExternalKnx.GetXMLProtocol`, `ExternalKnx.cs:613-631`)

`IndAddress` (enter), `Keys Key1 Key2 Key3`, `UseExtendedAddresses` i un
`<KNXObject ID>` per senyal serialitzat amb **`KnxComObject.ToXML`**
(`KnxComObject.cs:134-209`). És el **mateix esquema que el KNX intern de
KNX–MBM**: `Description`, `Active`, `AllowedValues`, `DPT Value`,
`SendingAddress Value String`, `ListeningAddresses/Address*`,
`Flags U T Ri W R`, `Priority`, `UpdateGA`, `IdxExternal`, `IdxConfig`,
`IdxOperations`, `IdxFilters`, `Virtual`, `ProtocolIndex`.

Diferències respecte al KNX intern:

- No hi ha `DefaultGA` (només el llegeix `InternalKnx`).
- `ExternalKnx.CreateObjectNode` (amb un atribut `Flags Ce`) és **codi mort**:
  `GetXMLProtocol` no el crida. La plantilla sí que porta `Ce="True"`; el
  parser l'ignora.
- El KNX `Active` sempre es desa `True`: `CreateKNXObject` i `SaveThisRow`
  forcen `Enabled = true` (`ExternalKnx.cs:715-755, 913-940`).

## 3. Senyals

- **Files lliures**, com a KNX–MBM i a diferència de ME–MBS: s'afegeixen,
  s'esborren i es mouen. Un senyal no es pot esborrar si és `IsFixed`
  (`_RT.cs:598-605`). Els dos costats van aparellats per posició
  (`MbsObjects[i]` ↔ `KnxObjects[i]`); `DeleteObject` els treu alhora.
- **L'estat actiu és el del costat Modbus** (`isEnabled`). El KNX `Active` és
  sempre `True`. `PreXBLActions` filtra només per `MbsObjects[i].IsEnabled`;
  `GetActiveSignals` i `CheckLicense` comproven tots dos, però el KNX és
  sempre cert.
- **Senyal nou** (`CreateNewRow` / `CreateRows`, `_RT.cs:537-585`):
  - MBS: descripció `""`, **desactivat**, 16 bits, format 0, adreça 0,
    bit 255, `ReadWrite = 2` (R/W).
  - KNX: DPT `7.x` (2-byte unsigned), flags **U, T, W, R** (Ri no), prioritat 3,
    `UpdateGA 0`, GA d'enviament = `IntesisKnx.GetNextGA` (la següent lliure) en
    format de 3 nivells.
  - Inserir al mig renumera els `ConfigID` posteriors (`IncrementIdxConfig`).
- Límits: 3.000 actius, 5.000 files, 500 per addició (guia §10).
- Columnes Modbus: `LenBits` ∈ {16, 32, 64} (`IntesisMb.PopulateDataLengthComboBox`,
  `isInternal`). La guia només parla de 16/32, però el codi també ofereix 64.
  Els formats són 0 Unsigned, 1 Signed C2, 2 Signed C1, 3 Float i 4 BitFields;
  **no hi ha String** (`stringFormatAvailable = false`, columna
  `StringLength` amagada: `GetInternalIdxToHide → {8}`). `ReadWrite`: 0 Read,
  1 Trigger, 2 Read/Write.
- Acoblaments de fila (`InternalMbs.CheckThisRow`, `:1233-1283`): BitFields
  força `LenBits=16` i habilita `Bit` (0 si abans mostrava `-`); la resta de
  formats mostren `Bit` com a `-`. Cada edició desa la fila sencera
  (`SaveThisRow`, `:1104-1132`), i `-` es desa com a `Bit = -1`. Per tant,
  **un senyal no BitFields que s'edita passa de bit 255 a -1**, i això canvia
  l'XBL: el tag 3 només s'emet si el bit és diferent de -1. Portat a
  `fitMbsRowEdit`.
- Adreça màxima: 20.000 (`maxAddress` per defecte d'`InternalMbs`; ME–MBS en
  passa 82.500). L'autoenumeració d'adreces Modbus i de GA KNX existeix a MAPS
  (`AutoEnumModbusAddress`, `AutoEnumGroupAddresses`).

### 3.1 El R/W del Modbus condiciona els flags KNX

Cada edició de fila crida `ExternalKnx.CheckThisRow` →
`IntesisKnx.UpdateFlagsValue(…, RW_PROJECT)` i després
`CheckThisRowSpecific` → `IntesisKnx.UpdateFlagsValueFromRWObject`
(`_RT.cs:349-377`; `IntesisKnx.cs`). El mode surt de `MbsObject.GetRwMode`
(`MbsObject.cs:489-497`):

| MBS `ReadWrite` | `GetRwMode` | Sempre | Si s'ha canviat la columna R/W |
|---|---|---|---|
| 0 Read | `WRITE` | treu R i T | posa W i U |
| 1 Trigger | `READ` | treu W, U i Ri | posa R i T |
| 2 Read/Write | `READWRITE` | — | posa W, U, R i T |

Aquest mode **no** és la direcció de les conversions. `frmSelectConversion`
fa servir `ConversionObject(MbsObject)` (`ConversionObject.cs:83-100`), que
fa just el contrari per a Read i Trigger:

| MBS `ReadWrite` | Conversió |
|---|---|
| 0 Read | `READ` |
| 1 Trigger | `WRITE` |
| 2 Read/Write | `READWRITE` |

És el que diu la guia (§9.1.3.1): d'esquerra a dreta (Modbus → KNX) per als
objectes d'escriptura i de lectura/escriptura, i de dreta a esquerra per als
que el BMS només llegeix. Està portat a `mbsConversionRwMode`; el mode dels
flags és `mbsObjectRwMode`.

Interlocks de `UpdateFlagsValue`: treure U treu Ri; **tocar Ri** (sigui per
activar-lo o desactivar-lo) treu R i posa U, llevat que el mode sigui `READ`;
posar R treu Ri. El nostre `applyFlagChange` (`src/protocols/knx/flags.ts`)
només ho aplica quan Ri queda activat: és una divergència menor de KNX–MBM que
no toquem aquí.

## 4. Configuració

**Modbus Slave** (formulari `frmInternalMBS`, compartit amb ME): MBS–KNX
amaga el mode d'adreces, el timeout de comunicació i el mode d'esclaus
(`frmInternalMBS.cs:200-258`, `_RT.cs:670-676`). Queden visibles:

- `Media`: 0 RTU, 1 TCP, 2 RTU+TCP;
- byte order (4 opcions);
- notificació en escriptura Modbus (`UpdateCOV`: Always / On change of value);
- base de registres (0/1);
- RTU: connexió 485/232 (`ConnectionType`), baud (1200…115200), data type
  (8N1, 8E1, 8O1, 8N2) i número d'esclau (1–255);
- TCP: port (1–65535) i keep alive (0–1440 min). La guia també hi posa un
  número d'esclau, però l'XML només en té un (`RTUConfig SlaveNumber`)
  **[confirmat, §10]** que és el mateix camp.

`CommErrorTout` no es veu, però **sí que va a l'XBL** (tag 7) si no val -1. Si
l'XML no el porta, en llegir val 180 (`InternalMbs.cs:936`) **[confirmat, §10]** el
valor que desa MAPS.

**KNX**: adreça física (per defecte 15.15.255 = 65535) i adreces esteses
(`LoadExternalConfigOptions`, `_RT.cs:1087-1092`). Les claus `Keys` no tenen UI
(es preserven).

**General**: nom (32), descripció (255), xarxa, conversions, USB host, temps i
seguretat, com a la resta de famílies.

## 5. Validació (`CheckProject`, `_RT.cs:633-662`)

Ordre de MAPS; s'atura al primer error:

1. Almenys un senyal MBS actiu (`CheckMinimumObjectEnabled`) → `NO_SIGNALS`.
2. `CheckMBSParams` (constant `true`).
3. Llicència (`CheckLicense`, `_RT.cs:714-739`): senyals actius ≤
   `MaxObjects` MBS; GA úniques ≤ `MaxGAddress`; associacions ≤
   `MaxAssociations` (`ExternalKnx.CheckLicense`). Taula
   `UpdateProjectLicense` (`_RT.cs:228-285`):

   | Llicència | MBS objects | KNX GA | KNX assoc. | KNX objects |
   |---|---|---|---|---|
   | 100 | 100 | 100 | 200 | **250** |
   | 250 | 250 | 250 | 500 | 250 |
   | 600 / 1200 / 3000 | n | n | 2n | n |
   | -1 / no numèric | 3000 | 3000 | 6000 | 3000 |

   El 250 de la llicència 100 és literal de MAPS. Sense unitat connectada:
   `GetMaxSignalsDisconnected = 3000`.
4. Per senyal actiu (`CheckObjects`, `_RT.cs:680-712`):
   - `DataLength == -1` → error de longitud.
   - `InternalMbs.CheckProjectObjects` (`InternalMbs.cs:1528-1597`):
     - format `NO_FORMAT`;
     - adreça repetida (16 bits);
     - adreça o adreça+1 ocupada (32/64 bits);
     - bit repetit (BitFields);
     - adreça > 20.000;
     - adreça 0 amb base 1.

     Peculiaritats del codi, que no s'han de corregir sense contrastar-les amb
     MAPS:
     - El cas de 16 bits compara amb el `format` de l'objecte actual, no amb
       el de l'altre, i per això també xoca amb un BitFields a la mateixa
       adreça. En canvi, exclou els de 32 bits (`x.DataLength != 32`) però no
       els de 64.
     - Els de 32 i 64 bits només miren `address` i `address + 1`. Un de 64
       bits no detecta res a `address + 2` ni a `address + 3`, i cap cas mira
       enrere: el solapament d'un objecte anterior de 32 o 64 bits només es
       detecta quan el bucle arriba a aquell objecte.

     La detecció de solapaments no es dona per resolta fins que no s'hagi
     contrastat amb MAPS (Check table) en un fitxer de referència amb aquests
     casos.
   - `ExternalKnx.CheckProjectObjects` (`ExternalKnx.cs:942-978`): cap flag;
     GA d'escolta sense U ni W; GA d'enviament ≤ 0 o > 32767 sense extended;
     **i també** GA d'escolta = 0 o > 32767 sense extended. Aquesta última
     comprovació no la fa el KNX intern.
5. Després de l'XBL (`CheckProjectAfterXblActions`): recomptes contra
   `MaxObjects` / `MaxAssociations` / `MaxGAddress`.

## 6. XBL

Nodes de primer nivell, en ordre: capçalera (tag 1, AppId 7), IBOX (tag 2),
**MBS (tag 9)** i **KNX (tag 4)**.

- IBOX: `USBHostAvailable(IBOX_MBS_KNX, RT)` = **true**. `ActiveMappings` es
  crea buit a `CreateConversionsTable` (`_RT.cs:199-211`): les LUT no
  s'emeten, igual que a KNX–MBM i al revés que a ME–MBS.
  `TimeZoneAvailable(RT)` = true: és el mateix cas marcat `UNVERIFIED` a
  `src/core/xbl/nodes-common.ts`.
- Node MBS: `InternalMbs.CreateInternalXBLNode` (`InternalMbs.cs:669-797`),
  l'escriptor que ja tenim portat i verificat a `me-mbs/xbl/nodes-mbs.ts`.
- Node KNX: `ExternalKnx.CreateExternalXBLNode` (`ExternalKnx.cs:1221-1255`),
  **idèntic** a `InternalKnx.CreateInternalXBLNode`. He comparat mètode a mètode
  els escriptors d'objectes d'interfície, GA, associacions i config:
  `knx-mbm/xbl/nodes-knx.ts` ja és l'escriptor correcte.
- `PreXBLActions` (`_RT.cs:158-197`):
  1. Recorre les files. Per cada MBS `IsEnabled`, en fa una còpia amb
     `ExternalID` = posició a la llista d'actius i afegeix el KNX de la mateixa
     posició.
  2. Ordena els MBS actius per `Bit` i després per `Address` (tots dos
     estables, per tant equival a ordenar per `(Address, Bit)`).
  3. Re-enllaç: cada KNX actiu rep com a `ExternalID` la posició del seu MBS a
     la llista ordenada.
  4. Conversions: primer MBS (en ordre ordenat), després KNX (en ordre de
     files actives).

  No hi ha reconstrucció d'IDs com a ME ni poll records com a MBM.

## 7. Què es comparteix i què és de la família

La composició és la prevista a `src/gateway-families/README.md`: cal extreure
cap a `src/protocols/` el que avui viu dins de cada família **sense canviar-ne
el comportament** (els tests d'XBL existents han de donar els mateixos bytes).

| Peça | Avui | Destí |
|---|---|---|
| Parser de `KNXObject` per a l'XBL + tipus `KnxObjectParsed`/`EnabledKnxObject` | `knx-mbm/xbl/pipeline.ts` | `protocols/knx` |
| Escriptor XBL KNX (`buildKnxNode`, `getTypeFromDpt`…) | `knx-mbm/xbl/nodes-knx.ts` | `protocols/knx` |
| Lectura del `KNXObject` per al model (`readKnxEndpoint`) i edició | `knx-mbm/from-xml.ts`, `xml-ops.ts` | `protocols/knx` (la part per objecte) |
| Regles de `CheckProjectObjects` KNX | `knx-mbm/validate.ts` | `protocols/knx` (amb l'opció de validar les GA d'escolta) |
| Parser de config i senyals MBS per a l'XBL + tipus | `me-mbs/xbl/pipeline.ts` | `protocols/modbus/slave` |
| Escriptor XBL MBS (`buildMbsNode`…) | `me-mbs/xbl/nodes-mbs.ts` | `protocols/modbus/slave` |
| Lectura de `MbsConfig` / `MbsEndpoint` | `me-mbs/from-xml.ts` | `protocols/modbus/slave` |
| `checkMbsSignal` / col·lisions | `protocols/modbus/slave/rules.ts` | ja hi és, però està fet a mida de ME (només formats 0/1, sense BitFields ni 64 bits). Per a MBS–KNX cal el port literal de `CheckProjectObjects`; les regles de ME no s'han de canviar |
| `PreXBLActions`, llicències, detecció, valors per defecte de fila nova, acoblament R/W ↔ flags, UI | — | `gateway-families/mbs-knx` |

**Estat (2026-09-28, fase 2 feta).** Tot el que depèn de l'XML va en
entrades pròpies, perquè `@/protocols/knx` i `@/protocols/modbus/slave` els
importa la UI i `project-format` arrossega `fflate`:

- `@/protocols/knx/xbl`: `parseKnxObjects`, `parseKnxXblSettings`,
  `buildKnxNode`.
- `@/protocols/knx/xml`: `readKnxConfig`, `readKnxEndpoint`,
  `patchKnxEndpoint`, `setKnxPhysicalAddress`, `setKnxExtendedAddresses`.
  Reben l'element del protocol, i la família decideix si és
  `InternalProtocol` o `ExternalProtocol`.
- `@/protocols/knx`: `KnxEndpoint`, `KnxConfig`, `defaultKnxEndpoint`,
  `checkKnxEndpoint`.
- `@/protocols/modbus/slave/xbl`: `parseMbsXblSettings`, `parseMbsSignals`,
  `buildMbsNode`.
- `@/protocols/modbus/slave/xml`: `readMbsConfig`, `readMbsEndpoint`,
  `patchMbsConfig`, `patchMbsRtuConfig`, `patchMbsTcpConfig`,
  `patchMbsEndpoint`, `buildMbsSignal`.
- `@/protocols/modbus/slave`: `MbsEndpoint`, `defaultMbsEndpoint`. ME–MBS
  l'amplia amb `operations`.

Sense canvis de comportament. Els 134 projectes reals de `.local-data`
(KNX–MBM i ME–MBS, inclosos els fitxers de referència de MAPS) donen el
mateix XBL byte a byte, i el mateix model i la mateixa validació, abans i
després de l'extracció. Queden per a la fase de la família: el port literal
de `InternalMbs.CheckProjectObjects` i la validació de les GA d'escolta de
`ExternalKnx`.

**Conversions (fase 3.2).** La biblioteca de conversions (afegir, editar,
esborrar, `setConversions`) i les comprovacions de rang d'una selecció o
d'una restauració són a `core/conversions/library-xml.ts` i
`core/conversions/selection.ts`. Cada família hi aporta tres coses:

- les files dels dos costats, perquè en esborrar una entrada s'ajustin les
  refs de totes, també les desactivades;
- el senyal objectiu i el rebuig dels virtuals (a KNX–MBM, el costat KNX; a
  MBS–KNX, el Modbus);
- la direcció: a KNX–MBM, els flags KNX; a MBS–KNX, `mbsConversionRwMode`
  amb el R/W resultant de l'edició.

Verificat sobre els 100 projectes KNX–MBM de `.local-data`: la mateixa
seqüència d'altes, edicions, seleccions, restauracions i esborrats dona el
mateix XML i els mateixos errors abans i després.

## 8. UI (inventari per pantalla)

- **Configuration**: General / Network (comú); BMS · Modbus Slave amb els camps
  de l'§4 (subconjunt del de ME–MBS, sense mode d'adreces ni d'esclaus); KNX
  (adreça física + extended); Conversions (comú).
- **Devices**: no n'hi ha; el costat KNX són adreces de grup.
- **Signals**: taula editable amb columnes MBS (actiu, descripció, bits,
  format, adreça, bit, R/W) i KNX (DPT, GA, GA addicionals, U/T/Ri/W/R,
  prioritat), conversions. Afegir i esborrar files.
  Moure files i import/export XLSX s'hi han afegit després
  (`docs/plans/gaps-families-v11.md` punts 6 i 7). Queda fora: autoenumeració,
  export ESF i import ETS/ESF.
- **Diagnostics / Deploy**: comuns, amb l'AppId esperat = 7.

## 9. Fitxers de referència i verificació

Com a ME–MBS, calen projectes **desats per MAPS** a
`.local-data/fixtures/mbs-knx-maps-ref/` (fora de Git):

1. `base.ibmaps`: plantilla IN-MBS-KNX tal qual, desada. Dona l'XML real que
   escriu MAPS (atributs d'arrel, `Platform`, `CommErrorTout`, normalització
   de `LenBits`/`Format`) i serveix de projecte nou.
2. `variat.ibmaps`: una desena de senyals que cobreixin 16/32/64 bits, els
   cinc formats (amb un BitFields), Read/Trigger/RW, un senyal desactivat, GA
   addicionals, Ri, prioritat ≠ 3 i una conversió a cada costat. Config:
   RTU+TCP, byte order word-inverted, base 1, notificació Always.

L'XBL de referència es genera sense passarel·la amb la CLI de MAPS
(`IntesisMAPS.exe -i <.ibmaps> -o <.xbl> -compID 7`).

Els dos fitxers són l'inici, no tota la verificació. Després caldran casos
petits que aïllin cada comportament, fets a partir de còpies editades:

- ordenació per adreça i bit;
- BitFields;
- senyals desactivats enmig;
- conversions a cada costat;
- els solapaments de l'§5.

Així, si `variat` divergeix, la causa es troba de seguida.

**Prova en viu**: és una fase a part, amb autorització explícita, i abans cal
confirmar que MAPS disposa del firmware MBS–KNX compatible amb la unitat
(`DownloadFirmwareFromBackOffice`; si no el troba, `warning_noFwInLocal`).

1. Guardar el projecte actual de la unitat (tenim
   `.local-data/gateway-backups/192.168.2.167-000R45700-2026-09-24.*`, però el
   `CFGNAME` actual és `roundtrip-test` del 28/09: cal una còpia nova).
2. Canviar el firmware a MBS–KNX amb MAPS.
3. Fer la prova de deploy amb la webapp.
4. Tornar el firmware a KNX–MBM i restaurar el projecte, també amb MAPS.

## 10. Verificació XBL (2026-09-29)

Fitxers desats per MAPS a `.local-data/fixtures/mbs-knx-ref/` (fora de Git):
`basembsknx.ibmaps` (plantilla sense canvis) i `basembsknx-variat.ibmaps`
(plantilla + senyals importats d'ETS i dues conversions al costat KNX).
Confirmen:

- `Platform="2"`, `ProtocolType="Modbus Slave"` i `CommErrorTout` = 180.
- Només hi ha un número d'esclau (`RTUConfig SlaveNumber`): el TCP fa servir
  el mateix.
- MAPS desa els senyals de la plantilla normalitzats (16 bits, bit -1).
- La webapp els llegeix i els torna a escriure byte a byte idèntics.

`generateMbsKnxXbl` reprodueix byte a byte (amb la data de la capçalera
emmascarada, l'únic camp volàtil) l'XBL que genera la CLI de MAPS
(`IntesisMAPS.exe -i -o -compID 7`) per a 8 projectes:

- els dos de MAPS;
- sis variants fetes amb les edicions de la webapp:
  - TCP i base 1;
  - RTU + TCP amb EIA-232;
  - senyals desactivats i adreces invertides amb BitFields;
  - conversions amb filtres als dos costats;
  - Ri, prioritats, GA esteses i 64 bits;
  - senyals afegits amb `addSignal` i un d'esborrat.

Les referències són al mateix directori (`*.maps.xbl`, amb la còpia
`*-pwd.ibmaps` que porta la contrasenya de prova que la CLI demana), i
`xbl/generate.test.ts` les comprova quan hi són.

La plantilla de projecte nou és ara `basembsknx.ibmaps` sense contrasenyes
(`fixtures/maps-template.ts`).

## 11. Prova en viu (2026-09-29)

Unitat 192.168.2.167 (IN701KNX, S/N 000R45700), passada a MBS–KNX amb MAPS
(`APPID:7`, `APPVERSION:2.0.1.0`). Abans es va desar una còpia del projecte
KNX–MBM `roundtrip-test` a
`.local-data/gateway-backups/192.168.2.167-000R45700-2026-09-29-roundtrip-test.complete.bin`.

1. **Capability `mbsKnxXblVerified`.** Es registra amb `verify:xbl` sobre un
   blob complet muntat amb l'XBL que la CLI de MAPS genera per a
   `basembsknx` (la CLI no inclou el ZIP del projecte). Resultat: MATCH.
2. **Projecte de prova.** Es crea des de la plantilla de MAPS i es marca la
   descripció del projecte i la del senyal 0.
3. **Deploy des de la webapp.** Les quatre portes passen i s'envien 4102 B
   (XBL de 1373 B). La unitat reinicia i reporta `CFGNAME` = el projecte de
   prova, `CFGERRORS:0` i `STATUS:RUNNING`.
4. **Recepció de tornada.**
   - L'XML és byte a byte idèntic al que s'havia enviat, i les dues marques hi
     són.
   - L'XBL guardat a la unitat és idèntic, amb la data emmascarada, al que
     genera la webapp.

Observacions:

- **Contrasenya.** El canvi de firmware torna la contrasenya al valor de
  fàbrica (`admin`). Després del deploy, la unitat queda **sense
  contrasenya**, perquè la plantilla de MAPS porta `IBOX Pwd=""` i l'XBL la
  hi escriu.
- Resolt després de la prova: el deploy bloqueja contrasenyes buides o no
  ASCII com MAPS; Configuration → Security permet fixar-ne una sense exposar
  l'actual. Vegeu `project-password.md`.

## 12. Obert

- La unitat es queda amb MBS–KNX per continuar provant. Si cal tornar-la a
  KNX–MBM: canviar el firmware amb MAPS i desplegar la còpia de
  `roundtrip-test`.
- Contrasenya buida en desplegar (§11): resolt amb validació comuna abans
  d'enviar i configuració només d'escriptura. Vegeu `project-password.md`.
