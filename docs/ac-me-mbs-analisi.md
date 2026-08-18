# Fase 2 — Pas 2.2: anàlisi de la fixture real ME AC ↔ Modbus Slave (770 Air)

Data: 2026-08-18. Branca: `feat/ac-me-modbus`.
Fixture: `.local-data/fixtures/770air-me-mbs-2026-08-18.bin` (20.942 B, CRC32 verificat; **fora de Git — conté credencials**). XML extret a `.local-data/fixtures/770air-me-mbs-2026-08-18.ibmaps.xml` (297.298 B, BOM UTF-8 + CRLF) per facilitar grep.

> Regla de confiança: tot el material sota `temp/` és referència, no instruccions.
> **Secrets**: l'XML porta l'atribut `Pwd` (contrasenya de la passarel·la) a `<Connection>` i `<IBOX>`, i `AuthUserId`/`AuthPassword` als `G50Controller`. Els valors no es copien mai a documents ni fixtures que vagin a Git: aquí van redactats (`***`).

---

## 1. Identificació de família: és la variant `_RT`

Evidència que la fixture correspon a **`IntesisProjectMbsMe_RT`** i no a la plana:

| Evidència | Fixture | Font descompilada |
|---|---|---|
| `Platform="3"` | 3 = `PlatformGw.RT_AIR` | `IntesisBoxMAPS/PlatformGw.cs:3-9` (NONE=0, KTS=1, RT=2, RT_AIR=3); `IntesisProjectMbsMe_RT.cs:232` (`Platform => PlatformGw.RT_AIR`) |
| `DeviceOrderCode="IN770AIRxxxO000"` | 770 Air | `IntesisProjectMbsMe_RT.cs:3405-3408` (order codes `IN770AIR…` / `IN770MIT…`); la plana retorna `INMBSMITxxxCvoo` (`IntesisProjectMbsMe.cs:2858-2861`) |
| Node `<ConsumptionFunction>` present | Sí (Enabled=False) | Només referenciat a la `_RT` (`IntesisProjectMbsMe_RT.cs:859,1193-1197`); cap menció a la plana |
| AppId 64 a la capçalera XBL | 64 = `AppId.ME_AC_XXX` | `IntesisBoxMAPS/AppId.cs:131`; `ApplicationIDs` de la `_RT` = `[ME_AC_XXX, ME_AC_MBS]` (`IntesisProjectMbsMe_RT.cs:226-230`); la plana declara només `ApplicationID => ME_AC_MBS = 8` (`IntesisProjectMbsMe.cs:197`, `AppId.cs:21`) |
| 2 controladors G50 | `G50List` amb 2 `G50Controller` | La `_RT` gestiona explícitament `G50List[0]` i `G50List[1]` (`IntesisProjectMbsMe_RT.cs:3085-3119`) |

Nota important sobre l'AppId 64: la capçalera XBL escriu l'AppId **del dispositiu connectat** si n'hi ha (`IntesisBoxMAPS/IntesisXBL.cs:149`: `connectedDevice.IsConnected ? connectedDevice.AppId : project.ApplicationID`). La unitat 770 Air corre el firmware universal ME (`ME_AC_XXX=64`); la classe de projecte és `ME_AC_MBS=8`. El `Header` XML porta `CompatibilityID=8` — la identitat del *projecte* — mentre que l'XBL porta 64 — la identitat de la *unitat*. El harness de verificació del pas 2.4 haurà de parametritzar l'AppId (o llegir-lo d'INFO?).

### Claus de detecció per a un futur `detect.ts`

- Arrel: `InternalProtocol="Modbus Slave"` + `ExternalProtocol="Mitsubishi Electric"` (noms verbatim, amb aquestes majúscules).
- `DeviceOrderCode` amb patró `IN770AIR…`/`IN770MIT…` (o `INMBSMIT…` per a la variant plana, fora d'abast).
- `Platform="3"` (RT_AIR).
- XBL: node intern = **tag 9** (MBS), node extern = **tag 8** (ME); AppId ∈ {8, 64}.
- Template intern: `IBOX Name="IN-ME-AC-MBS"`.

## 2. Estructura top-level de l'XML

Envelope idèntic al KNX–MBM (mateix parser, mateixes convencions; cf. `docs/knx-mbm-mvp.md` §4):

```
<?xml version="1.0" encoding="UTF-8"?>           (BOM + CRLF)
<Project Platform="3" CreatedBy="IntesisMAPS" OEMCode="0" ProjectName="intesis.ibmaps"
         ProjectDescription="Intesis Mitsubishi Electric AC to Modbus Slave Gateway"
         DeviceOrderCode="IN770AIRxxxO000" ToolVersion="5.0.1217.9763"
         InternalProtocol="Modbus Slave" ExternalProtocol="Mitsubishi Electric">
  <Columns>                (InternalColumns 9, ExternalColumns 3, ExtraColumns 2; typo "DiangosticEnabled" verbatim)
  <Connection Pwd="***" isUSB="True" Device="" Port="23"/>
  <Header Description=… Version="1.2.31.0" CompatibilityVersion="0.0.0.0" CreationVersion="1.2.23.0"
          TimeStamp="7/22/2025 2:40:25 PM" Endianess="False" LicenseMode="0" CompatibilityID="8"/>
  <IBOX Name="IN-ME-AC-MBS" IP="192.168.2.130" NetMask=… Gateway=… DNS= DNS2= DHCP="False" Pwd="***" ExtraProtocol="0">
    <USBConfig/> <TimeConfiguration/> <SecurityConfiguration/> <CertUpdateConfig/>
    <Conversions>     25 × <Conversion>
    <RemapLUTs>       21 × <RemapLUT>
  </IBOX>
  <InternalProtocol ProtocolType="Modbus Slave">…</InternalProtocol>
  <ExternalProtocol ProtocolType="Mitsubishi Electric">…</ExternalProtocol>
</Project>
```

Comptatges: **222 senyals interns + 222 externs** (relació 1:1 per `idxConfig`), 25 conversions, 21 LUTs, 7 MBSlave, 2 controladors G50 (100 grups declarats, 6 habilitats).

### 2.1 `InternalProtocol` (Modbus Slave)

Fills en ordre fix (font: `InternalMbs.GetXMLProtocol`, `IntesisBoxMAPS.Protocols.MB.Internal/InternalMbs.cs:1006-1064`):

| Node | Valor fixture | Significat |
|---|---|---|
| `Media` | 2 | 0=RTU, 1=TCP, 2=Both (mateix enum que MBM) |
| `ByteOrder` | 0 | 0=BE |
| `UpdateCOV` | True | |
| `AddressMode` | 0 | `MbsAddressMode.FIXED` (0=FIXED, 1=CUSTOM, 2=V4_COMP — `IntesisBoxMAPS.Protocols.MB/MbsAddressMode.cs:3-8`) |
| `TempSetpoint` | 0 | |
| `FormatExtra` | 0 | |
| `CommErrorTout` | 180 | s (a l'XBL va ×1000 ms, u32 BE — `InternalMbs.cs:658-663`) |
| `RegisterBase` | 0 | base 0 |
| `RTUConfig` | ConnectionType=1 Baudrate=9600 DataBits=8 Parity=0 StopBits=1 SlaveNumber=3 | slave id RTU = 3 |
| `TCPConfig` | Port=502 KeepAlive=10 | |
| `TemperatureSensor` | Enabled=False | |
| `SlaveAddressMode` | 0 | `SlaveAddressMode.SINGLE` (0=SINGLE, 1=MULTIPLE — `SlaveAddressMode.cs:3-7`) |
| `MBSlavesArray` | 7 × `<MBSlave Address=… Description=…/>` | adreces 3 ("General Controller 1") i 4–9 ("C1G1"…"C1G7", salta G3 perquè el grup 2 està deshabilitat). En mode SINGLE els senyals no els referencien (`SlaveIndex=-1`), però l'array es persisteix igualment |
| `Signals` | 222 × `<Signal>` | vegeu §3 |

### 2.2 `ExternalProtocol` (Mitsubishi Electric)

Fills (font: `ExternalME.GetXMLProtocol`, `IntesisBoxMAPS.Protocols.ME/ExternalME.cs:667-705`):

- `PollPeriod=100` (ms), `AnsTimeout=30`, `ControllerTout=30`, `ReadCyclesPerAlarm=1`, `WriteMaxBurst=5`.
- `TemperatureMode=0` (`METemperatureMode.CELSIUS` — `METemperatureMode.cs`).
- `ConsumptionFunction Enabled=False InputMode=0 SignalMode=0 Units=1 …` amb `Assignments` (3 × `Assignment Line OUIndex MeterIndex IUIndexes UnitIdxs`) i `Meters` (3 × `EnergyMeter Enabled=False … IPAddress Port SlaveNumber Register ReadFunction …`). Tot deshabilitat.
- `G50List`: 2 × `G50Controller` (esquema a §4).
- `Signals`: 222 × `<Signal>`.

## 3. Model de senyal

### 3.1 Senyal interna (costat Modbus Slave)

`<Signal ID="n">` amb **16 fills en ordre fix** (font: `MbsObject.ToXml`, `IntesisBoxMAPS.Protocols.MB/MbsObject.cs:132-206`; camps a `MbsObject.cs:17-55`):

`isEnabled`, `idxConfig`, `idxExternal`, `IdxOperations`, `IdxFilters`, `Description`, `LenBits`, `Format`, `Bit`, `Address`, `ReadWrite`, `StringLength`, `SlaveIndex`, `GatewayIndex`, `Virtual Status= Fixed= General=`, `ProtocolIndex`.

Valors observats a la fixture (222 senyals):

- `LenBits=16` sempre; `Format`: 0=Unsigned (168) / 1=Signed C2 (54) (`MbmObjectType.cs` — mateix enum que MBM); `Bit=255` sempre (cap BitFields); `StringLength=-1`; `SlaveIndex=-1`, `GatewayIndex=-1`, `ProtocolIndex=-1` sempre; `isEnabled=True` sempre.
- `ReadWrite` (`MbsReadWrite.cs:3-9`): **0=READ (61), 1=TRIGGER (41), 2=READWRITE (120)**. Aquest tercer estat TRIGGER (escriptura d'acció puntual: "reset errors", "set all On"…) no existeix al model MBM.
- `IdxOperations`/`IdxFilters`: format `idx,inverted` igual que KNX–MBM. Observats: `0,1` (conversió 0 ARITH ×10 invertida — setpoints i restriccions), `17,0` (LUT 17 — remap ventilador 4 velocitats), `2,0`…`9,0` (LUTs 2–9 — remap de valor constant N per als triggers broadcast).

### 3.2 Senyal externa (costat ME)

`<Signal ID="n">` amb **12 fills en ordre fix** (font: `ExternalME.cs:707-765`; camps a `MeObject.cs:10-38`):

`idxConfig`, `idxExternal`, `IdxOperations`, `IdxFilters`, `UnitId`, `IsIndoorSignal`, `GroupIndex`, `G50Index`, `Virtual Status= Fixed=`, `IsStatus`, `SignalIndex`, `SignalSpecIndex`.

Valors observats:

- `G50Index=0` sempre (només el controlador 0 en ús); `UnitId=-1` i `IsIndoorSignal=False` sempre (cap senyal per unitat interior/exterior — tot és per grup o general).
- `GroupIndex`: -1 (30 senyals generals de controlador) + 0,1,3,4,5,6 (32 per grup habilitat; 30+6×32=222 ✓).
- `IsStatus`: True (181) / False (41) — distingeix estat llegit del bus vs comanda.
- `SignalIndex` = constant `IntesisMe.SIGNAL_*` (`IntesisMe.cs:10-108+`: 0 DRIVE, 1 MODE, 2 FANSPEED, 3 AIRDIRECTION, 4 SETTEMP, 5 INLETTEMP, 6 VENTILATION, 8 FANTIME, 9 ERRORSIGN, 10 ALARMCODE, 11 ERRORSIGN_TRIGGER, 12 MODEL, 13–19 prohibicions, 20 SETBACK, 21–26 restriccions, 32 ROOMHUMIDTY, 33 BRIGHTNESS, 34 OCCUPANCY, 36 FILTERSIGN, 37 FILTERSIGN_TRIGGER, 41 MODE_IC, 42 MODE_LOSSNAY, 44 FANSPEED_IC, 45 FANSPEED_LOSSNAY, 48 FANTIME_DIGITS…). 36 valors distints observats.
- `SignalSpecIndex` = índex d'"espec" per tipus de grup (mutuament excloents per tipus: 1/2/3 = mode IC/LC/BU…, 4/5 = fan IC/LC…). És la clau del mapa d'adreces (§5).
- No hi ha DPT ni tipat per senyal: el tipat viu al costat intern (`Format`) + conversió.

### 3.3 Comparació amb el model KNX–MBM (`src/gateway-families/knx-mbm/model.ts`)

Compartit (mateixa estructura d'enllaç): `id`/`idxConfig`, `active`, `description`, `idxOperations`/`idxFilters` en brut, `virtual`. Diferent:

- `KnxEndpoint` (dpt, groupAddress, additionalAddresses, flags, priority) → **`MeEndpoint`** nou: `g50Index`, `groupIndex`, `unitId`, `isIndoor`, `isStatus`, `signalIndex`, `signalSpecIndex`.
- `MbmEndpoint` (port, deviceIndex, isBroadcast, readFunc/writeFunc, lenBits, format, byteOrder, bit, numOfBits, address, deadband) → **`MbsEndpoint`** molt més simple: `address`, `bit`, `lenBits`, `format`, `readWrite` (enum de 3 valors, no parell de function codes), `stringLength`, `slaveIndex`. Sense nodes/devices/poll records: és la banda servidora.

## 4. Costat Mitsubishi Electric AC

### 4.1 Controladors i grups

`G50Controller` (font: `MeController.ToXml`, `IntesisBoxMAPS.Protocols.ME/MeController.cs:92-144`): fills-text `ID, Description, Enabled, IP, Port(80), Type, Model, Compatibility, Setpoint05Support, AddErrorSignals, AuthUserId, AuthPassword, CertDownloadPort(8008), PersistentConnection` + `GroupList` amb **50 `<Group>`** cadascun.

Fixture: controlador 0 "VRF" IP 192.168.1.129 (Enabled=False al XML però amb 6 grups Enabled=True — la UI evidently manté la config encara que el flag estigui a False; a investigar al pas 2.3 com afecta el build), controlador 1 buit. `Model=2` = `ControllerModel.AE_200` (`ControllerModel.cs`), `Compatibility=0` = `CompatibilityMode.NEW_MODEL`.

`Group` (font: `MeGroup.cs:60-73`): atributs `Index, Enabled, Description, Controller, Type, NumOfFanSpeeds(4), DualSetPoint, URC, Capacity`. `Type=0` = `MEGroupType.IC` (unitats interiors; enum a `MEGroupType.cs`: IC, LC, FU, BU, WH, CEH, SYS_COMPONENT). Grups habilitats: índexs 0,1,3,4,5,6 amb descripcions reals (Kantoortuin 2, Kantine, Printer/opslag, Kantoor Tim, Receptie, Gang/overloop) i `Capacity` (5–13). `URC=True` als habilitats → per això tenen els senyals d'humitat/brillantor/ocupació (spec 41–43).

### 4.2 Paràmetres AC presents (bloc de 32 senyals per grup IC amb URC)

Offsets dins del bloc de 100 registres del grup (verificat 222/222 contra `GetAddressFromSignal` de la `_RT`, `IntesisProjectMbsMe_RT.cs:2713-2799` — vegeu §5): On/Off, Mode IC (Auto/Heat/Dry/Fan/Cool/AutoH/AutoC/Setback), Fan IC, Vane, Setpoint ×10 °C (fmt Signed C2 + conversió ×10), Ambient ×10, estat Lossnay/OA, temps d'operació (×100 h i %100 h), error status/code/reset, model de grup, 7 × "Allow … from local panel", Setback control, 6 × restriccions de setpoint (mín/màx cool/heat/auto, ×10), i amb URC: Room Humidity, Brightness, Occupancy, Filter status/reset. Els 30 senyals generals (adreces 0–29) són triggers broadcast (On/Off/Mode/Fan/Vane/Setpoint "all the groups") més l'error de comunicació del controlador i el reset global d'errors.

## 5. Costat Modbus Slave: mapa de registres

A diferència del MBM (client: function codes per senyal, nodes/devices, poll records derivats), el MBS és **servidor**: tot són holding registers de 16 bits; no hi ha function codes ni dispositius al XML. L'assignació d'adreces (AddressMode FIXED, verificada contra la fixture — **222/222 coincidències**):

- Senyal general del controlador `g`: `addr = g×30 + specIndex` (`IntesisProjectMbsMe_RT.cs:2723-2732`).
- Senyal de grup: `addr = (g×50 + (groupIdx+1))×100 + f(specIndex)`, on `f` és el switch de `IntesisProjectMbsMe_RT.cs:2735-2794` (mapa spec→offset amb col·lisions intencionades entre specs mutuament excloents: 1/2/3→1, 4/5→2, 7/8→4, 31/32→27, 33/34→28, 35/36→29, 37/38→30, 39/40→31).
- Senyals per unitat (no presents a la fixture): `(g+1)×1000 + 20000 + unitIdx`.
- Modes CUSTOM (adreces lliures persistides via `AddressesStorer`) i V4_COMP (mapa legacy `GetAddressFromSignalV4`, `_RT:2802+`): no exercitats per aquesta fixture.

Mapa real de la fixture: 0–29 generals; grup i → finestra `(i+1)×100` (100–137, 200–237, 400–437, 500–537, 600–637, 700–737; els forats 127–131/135 corresponen a specs no generades per a grup IC amb 4 velocitats + URC). Adreça màxima 737.

Slave id: RTU `SlaveNumber=3` (base de l'array d'slaves virtuals); TCP port 502. `SlaveAddressMode=SINGLE`: un sol slave lògic; l'`MBSlavesArray` (3 + un per grup habilitat, descriptions "C1Gn") només cobra sentit en mode MULTIPLE (`GetSlaveIndex`, `_RT:1632-1696`).

## 6. Round-trip XML

`XmlDocument.parse` + `serialize()` sobre els 297.298 bytes reals: **byte-idèntic** (297.298 in → 297.298 out, `out === xml`). El parser propi (`src/core/project-format/xml/`) aguanta aquesta família sense cap canvi — inclou BOM, CRLF, `<tag />` vs `<tag></tag>`, ordre d'atributs. Cap mismatch.

## 7. XBL: cop d'ull ràpid (pas 2.4 en farà la feina fina)

Decodificat amb el lector TLV existent (`src/gateway-families/knx-mbm/xbl/decode.ts`) — **el framing, varints i flags "special" són idèntics** al que escriu el generador KNX–MBM:

- Top-level: tag 1 (header), tag 2 (IBOX), **tag 9 (intern MBS)**, **tag 8 (extern ME)** — mateixa envolvent que KNX–MBM però amb nodes de protocol diferents (KNX=4, MBM=6).
- Header tag 1: desc "Intesis Mitsubishi Electric AC t\0" (32 B + NUL ✓), version 1.2.31.0, compat 0.0.0.0, timestamp 6 B volàtil `[dia,mes,yy,h,m,s]` = 18/08/26 18:58:50 (hora de descàrrega), endianess 0, **AppId 64** (de la unitat connectada, `IntesisXBL.cs:149`).
- IBOX tag 2: IP/màscara/gateway 4 B, DHCP, pwd NUL-terminated (valor redactat), nom "IN-ME-AC-MBS\0", conversions (221 B), LUTs (841 B), contenidors 12/13 (timezone/NTP placeholders), DNS tag 14 — mateixa forma que `nodes-common.ts`.
- Intern tag 9 (`InternalMbs.CreateInternalXBLNode`, `InternalMbs.cs:646-694`): tag1 media=2, tag2 byteOrder, tag3 updateCOV, **tag7 = CommErrorTout×1000 u32 BE** (180 → 0x0002BF20 ✓), tag4 RTUConfig (baudrate u32 BE 9600, databits 8, parity, stopbits, slave 3, conntype 1), tag5 TCPConfig (port u16 BE 502, keepalive 10), tag6 array de **222 senyals**; sense tag8 d'slaves (mode SINGLE ✓, `InternalMbs.cs:696-711`). Item de senyal (`MbsObject.GenerateXblItem`, `MbsObject.cs:209-249+`): tags 1 LenBits, 2 Format, 3 Bit (si ≠-1; la fixture emet 255), 4 Address (u16 BE "shrunk"), 5 ReadWrite+1, 6 ExternalID, 7 ConfigID (shrunk), 8 ConversionID (condicional).
- Extern tag 8 (`ExternalME.CreateExternalXBLNode`, `ExternalME.cs:163-266`): tags 1–5 (PollPeriod u16 BE 100, AnsTimeout 30, ControllerTout 30, ReadCyclesPerAlarm 1, WriteMaxBurst 5), sense tag 7 (consumption deshabilitada ✓), tag6 array de controladors G50 presents: item amb IP 4B, port u16 BE 80, flags, i tag8 contenidor amb l'array de **6 grups habilitats** (`ExternalME.cs:380-484`): per grup tags 1 idx+1, 2 type, 3 fanSpeeds, 4 dualSetPoint, 5 urc, t6 contenidor de senyals (externalIds indexats per `IntesisMe.GetSignalNodeNumber`), t7 contenidor de conversions. La numeració exacta de t6/t7 queda per al pas 2.4.

## 8. Reusable tal qual / nou / riscos

### (a) Reusable tal qual

- `src/core/project-format/` complet: blob complet, ZIP, CRC32, parser/serialitzador XML (round-trip verificat sobre 297 KB reals, §6).
- `src/gateway-families/knx-mbm/xbl/tlv.ts` + `decode.ts` (varints, framing, helpers escalars, lector) — el format XBL és compartit; els nodes header (tag 1) i IBOX (tag 2) de `nodes-common.ts` semblen directament reutilitzables (pendent de confirmar byte a byte al 2.4).
- `src/server/intesis-transport/` sencer (ja validat en viu amb aquesta mateixa unitat).
- Model de conversions + LUTs (`Conversion`, `RemapLUT`) i el format `idx,inverted`.
- Convencions de família (`src/gateway-families/README.md`), harness `scripts/verify-xbl.ts` (amb la salvedat de l'AppId, §1).

### (b) Nou (pas 2.3)

- `src/protocols/modbus/slave/`: model `MbsConfig` (media, byteOrder, updateCOV, addressMode, tempSetpoint, commErrorTout, registerBase, RTU/TCP config, slaveAddressMode, MBSlave[]) + enums (`MbsReadWrite` amb TRIGGER, `MbsAddressMode`, `SlaveAddressMode`) + assignació d'adreces FIXED/CUSTOM/V4_COMP.
- `src/protocols/me/`: `MeController`, `MeGroup` (50/controlador, 2 controladors), `MeObject`, enums (`MEGroupType`, `ControllerModel`, `CompatibilityMode`, `METemperatureMode`), taula de specs de senyal (spec ↔ `SIGNAL_*` ↔ descripció/allowed-values ↔ tipat intern per defecte) — la font de veritat és `CreateSignalsWithParams` (`_RT:1698-1884`) + `GetSignalDescription`/`GetAllowedValues` (`_RT:2267+`).
- `src/gateway-families/me-mbs/` (o `ac-me-mbs`): `model.ts`, `from-xml.ts`, `xml-ops.ts`, `detect.ts` (claus de §1), validacions, i al 2.4 `xbl/nodes-mbs.ts` + `xbl/nodes-me.ts` + pipeline amb els `PreXBLActions` propis (`IntesisProjectMbsMe_RT.cs:274+`: split enabled, ordenació per Bit/Address, reindexació d'externalIds, cadena de conversions).
- UI: pantalles de configuració MBS i ME (controladors/grups), taula de senyals amb columnes d'aquesta família (les 9 internes + Group/Controller externes).

### (c) Preguntes obertes / riscos per a 2.3–2.4

1. **AppId a la capçalera XBL** depèn del dispositiu connectat (64) vs del projecte (8) — `IntesisXBL.cs:149`. El verify haurà d'acceptar `--app-id` o extreure'l de la referència; si no, mismatch garantit al byte del tag 6.
2. **Cobertura d'una sola fixture**: només grups IC, un controlador, mode SINGLE, Celsius, consumption off, `AddErrorSignals=False`. LC/FU/BU/WH/CEH, senyals per unitat (`UnitId`, adreces 20000+), 2 controladors actius, MULTIPLE slave mode, Fahrenheit i error-signals no tenen mostra real — el model s'haurà de derivar del descompilat amb marques UNVERIFIED.
3. **`Enabled=False` del G50Controller 0 amb grups Enabled=True**: com afecta al build XBL (a la fixture l'array G50 XBL conté 1 item amb 6 grups — el flag de controlador no els elimina). S'ha de contrastar amb `IsEnabledDevice`/`PreXBLActions` al 2.4.
4. **Ordre d'slaves a `MBSlavesArray`**: salta el grup deshabilitat (C1G3 absent) → la numeració "C1Gn" és l'índex de grup 1-based, no la posició a l'array; l'adreça s'assigna per `GetSlaveIndex` (`_RT:1632-1696`).
5. **Numeració de senyals dins dels contenidors t6/t7 dels grups XBL** (`IntesisMe.GetSignalNodeNumber`): no derivada encara; pas 2.4.
6. **Timestamp XBL**: volàtil (hora de generació, no la del `Header` XML) — el verify ja ho mascara (`--mask-timestamp`).
7. **Secrets**: mai commitejar la fixture ni copsar `Pwd`/`AuthPassword` a fixtures de test; els tests de round-trip hauran d'usar una còpia sanejada.
8. **Versió de l'eina**: la fixture diu `ToolVersion=5.0.1217.9763`; el descompilat pot ser d'una versió diferent. L'assignació d'adreces quadra 222/222, però qualsevol altra divergència byte a byte al 2.4 s'ha de documentar abans de "corregir-la" a cegues.
