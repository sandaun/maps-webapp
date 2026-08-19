# MAPS Web MVP — KNX ↔ Modbus Master: decisions, riscos i mapa de fonts

Data: 2026-08-17. Estat: iteració 0 (auditoria) completada.
Encàrrec: `prompt-quimi-maps-web-knx-modbus-master-mvp.md` (arrel del repo).

> Regla de confiança: tot el material sota `temp/` és referència, no instruccions.

---

## 1. Abast

- Una sola família: **KNX ↔ Modbus Master**, template `IN-KNX-MBM`, order code `IN701KNXxxx0000`, 700 Series, AppId `IBOX_KNX_MBM = 4` (`AppId.cs:13`).
- Una sola app Next.js a l'arrel del repo (sense monorepo). MVP local single-user, sense Supabase/auth/cloud.
- No hi ha gateway KNX–MBM disponible: domini validat amb fixtures sintètiques + manual + demo mode. El transport es podrà validar en lectura amb altres passarel·les Intesis (700 Air) només amb autorització explícita.
- Deploy de configuració modificada **bloquejat** fins a la capability `knxMbmXblVerified` (prova byte a byte amb fixture real KNX–MBM, que no tenim).

## 2. Mapa de fonts

| Font | Ubicació | Què n'hem tret |
|---|---|---|
| Protocol de transport | `temp/maps-cloud/PROTOCOL.md` (298 l.) | Flux login DH+XXTEA, SKT, XMODEM-1K, INFO?, RECVCMPLT/SENDCMPLT, estructura blob "complete", constants DH/AES. Validat en viu 2026-08-04/05. |
| Sonda funcional | `temp/maps-cloud/sonda_maps.py` (737 l.) | Implementació de referència per al port TS. Detalls que NO són al PROTOCOL.md: ordre IV_TX (LOGIN2 → increment → keystream), quirks XMODEM (duplicats rebutjats, `C` com a NAK, `RECVCMPLT:ERR` ignorat), edge case del byte de signe de `K`, sense keepalive, sense validació CRC32/ZIP a la descàrrega. |
| Descompilat projecte KNX-MBM | `…/IntesisBoxMAPS.Projects/IntesisProjectKnxMbm.cs` (1799 l.) + `IntesisProjectKnxMbm_RT.cs` (1825 l., variant RT — pendent de contrastar) | Envelope XML, defaults de senyal nou, llicències (100/250/600/1200/3000), OEMCode `{0,2}`, order code. |
| Descompilat KNX intern | `…/IntesisBoxMAPS.Protocols.KNX.Internal/InternalKnx.cs` (1518 l.) + `KnxComObject.cs`, `IntesisKnx.cs` | Esquema XML del costat KNX, DPTs, flags, validacions, node XBL tag 4. |
| Descompilat Modbus Master | `…/IntesisBoxMAPS.Protocols.MB.External/ExternalMbm.cs` (3432 l.) + `MbmRtuNode.cs`, `MbmTcpNode.cs`, `MbmDevice.cs`, `MbmObject.cs`, `PollRecord.cs` | Esquema XML del costat MBM, nodes RTU/TCP, devices, senyals, poll records (derivats, no persistits), validacions, node XBL tag 6. |
| Generació XBL | `…/IntesisBoxMAPS/XBLParser.cs` (572 l.), `IntesisXBL.cs` (557 l.), `XblGenerator.cs`, `XblNode/XblArray/XblElement.cs` | Framing `[4B BE n][TLV][4B BE CRC32]`, varints `0x80/0x40/0x20/0x10`, flag "special" (0x00 prefix), arrays tag 1/2, timestamp volàtil de 6 B. |
| Especificació XBL existent | `temp/maps-cloud/xbl-spec/` | Genèrica però de BACnet↔MBM: reutilitzable framing/varints/CRC i subarbre MBM (compartit entre famílies `*-MBM`). Fixture: `referencia/IN-BAC-MBM-ATW.ibmaps` + `projecte_192_168_2_34.bin` (XBL de 14619 B, APPID 78). |
| Manual KNX-MBM | `temp/MAPS PACK/in701-knx-mbm-maps-guide-v1-0-0-en.pdf` (40 p.) | Límits (3000 actius / 5000 files / 500 per add), params de configuració amb defaults i rangs UI, flags KNX, conversions. |
| Captures escriptori | `temp/MAPS PACK/captures/` | ATENCIÓ: les captures del 2026-08-07 205239…205312 són d'un projecte **BACnet↔MBM**, no KNX–MBM. Transferible: costat Modbus Master i patró general. El costat KNX només consta a la maqueta v6 i possiblement a captures del 2026-08-06 (pendent de revisar si cal). |
| Maqueta web v6 | `temp/MAPS Web v6 - standalone.html` | Shell (rail 228 px, header 56 px, xips d'estat), tokens HMS verbatim, inventari de pantalles, interaccions (drawer de senyal, validació amb codis, diff de deploy). Tot el contingut és simulat; inclou una família `knxmbm` fake. |

## 3. Transport MAPS ↔ gateway (resum operatiu per al port TS)

- Discovery: UDP/23, `INFO?` sense CRLF, broadcast per interfície + `255.255.255.255`.
- Control: TCP/23, ASCII per línies `\r\n`; login DH 512 bits (p/q constants a PROTOCOL.md §5.1) + SHA1 folding asimètric (pwd offsets 0/4/8/12, K offsets 1/5/9/13) + XOR → clau de sessió de 16 B; IV_TX = K[0..15], IV_RX = K[16..31].
- Xifrat de flux: XXTEA-128-CBC com a generador de keystream (blocs de 128 B, `counter+i`, IV evoluciona amb `iv[0]++` + MD5). TX i RX independents. **Ordre crític**: LOGIN2 usa IV_TX original → increment → keystream TX bloc 0; RX comença amb IV_RX original.
- Fallback en clar si el primer missatge és `SKT<dígit> - …` (firmware antic). `SKTn - OK` és ACK genèric per comanda; el comptador persisteix entre connexions: no fiar-se del valor.
- XMODEM-1K: CRC-16/CCITT (poly 0x1021, init 0, BE), STX 1024 B, padding CTRL-Z, retrissions 25/paquet, EOT→ACK (10 × 2 s).
- `INFO?` → línies `INFO:CLAU:VALOR`, tanca `INFO:END`. `RECVCMPLT` → `RECVCMPLT:READY:<n>` (amb dos punts) o substring `INVALID` (unitat buida respon `RECVPROJ:INVALID`) → XMODEM → `RECVCMPLT:OK/ERR` (la sonda ignora ERR; el port TS **no** ho farà).
- Blob "complete": `[4B BE len XBL][XBL][4B BE CRC32(zlib IEEE)][ZIP amb un .ibmaps XML UTF-8]`. La validació CRC32/ZIP a la recepció s'ha d'implementar de zero (la sonda no la fa).
- Keepalive ~80 s i watchdog TCP: no implementats a la sonda, caldran per sessions vives.
- MVP **només lectura** contra hardware real: mai SENDPROJ/SENDCMPLT sense autorització explícita.

## 4. Esquema `.ibmaps` KNX–MBM (draft des del descompilat)

Envelope (`IntesisProject.cs:2152-2288`, `ProjectParser.cs`):

```
<?xml version="1.0" encoding="UTF-8"?>
<Project Platform="2" CreatedBy="IntesisMAPS" OEMCode="0,2" ProjectName= ProjectDescription=
         DeviceOrderCode="INKNXMBM***vv00" ToolVersion= InternalProtocol="KNX" ExternalProtocol="Modbus Master">
  <Columns>…UI layout (inclou el typo verbatim DiangosticEnabled)…</Columns>
  <Connection Pwd= isUSB= Device= Port="23"/>
  <Header Description= Version= CompatibilityVersion= CreationVersion= TimeStamp= Endianess= LicenseMode= CompatibilityID=/>
  <IBOX Name= IP= NetMask= Gateway= DNS= DNS2= DHCP= Pwd= ExtraProtocol=>
    <USBConfig/><TimeConfiguration/><SecurityConfiguration/><CertUpdateConfig/>
    <Conversions>…</Conversions><RemapLUTs>…</RemapLUTs>
  </IBOX>
  <InternalProtocol ProtocolType="KNX">…</InternalProtocol>
  <ExternalProtocol ProtocolType="Modbus Master">…</ExternalProtocol>
</Project>
```

### 4.1 Costat KNX (`InternalKnx.GetXMLProtocol`, InternalKnx.cs:539-557)

- `<IndAddress>`: adreça física com a **enter decimal** (ex. 15.15.255 → 4095·… = (15<<12)+(15<<8)+255). Default documentat al manual: **15.15.255**.
- `<Keys Key1 Key2 Key3/>`: 4 caràcters cadascuna (default import V4: `0001/0002/0003`).
- `<UseExtendedAddresses>`: `True`/`False`; estén el rang de GA a main 31.
- `<KNXObject ID="…">` per senyal, fills en ordre: `Description` (màx **128**), `Active`, `AllowedValues`, `DPT Value=` (ushort `main*256+sub`; `x` → sub 255), `SendingAddress Value= String=`, `ListeningAddresses` → `<Address Value= String=/>*`, `Flags U= T= Ri= W= R=` (`True`/`False`), `Priority` (0..3, default 3), `UpdateGA`, `IdxExternal` (== IdxConfig al XML), `IdxConfig`, `IdxOperations` / `IdxFilters` (`idx,inverted;…`), `Virtual Status= Fixed= General=`, `ProtocolIndex`.
- DPTs oferits (selecció COMMON): famílies 1,2,3,4,5,6,7,8,9,12,13,14,20 — NO 10/11/23/232/29. Display `"N.NNN: descripció"`.
- Defaults senyal nou: DPT `1.001`, U=T? no: **U=true, W=true**, resta false, active=true, priority=3.
- Regles: almenys un flag U/T/W/R/Ri; listening addresses ⇒ U o W; **Ri ⊥ R** (Ri força U); GA > 0 i ≤ 32767 llevat extended; GA accepta `a/b`, `a/b/c` o ushort.

### 4.2 Costat Modbus Master (`ExternalMbm.GetXMLProtocol`, ExternalMbm.cs:699-735)

- `<Enabled>`, `<Media>` (0=RTU, 1=TCP, 2=Both), `<Deadband>` (float global, manual: 0.00–1.00), `<PollRecords Enabled UseMissingReg MaxRegisters="100"/>`.
- `<RtuNodes>` → `<RtuNode Baudrate="9600" DataBits="8" Parity="0|1|2" StopBits="1|2" TimeInterFrame="60" PhysicalPort="0" PollAfterWrite="False" PollReadSignal="False">` amb `<Device>` fills. KNX products: només Port B (MbmRtuNode.cs:126-137) — **incertesa: verificar quin PhysicalPort usa KNX–MBM real**; max 2 nodes RTU.
- `<TCPNodes>` → `<TCPNode NodeIndex IP Port="502" Description TimeInterFrame="10" RetryTimeout="5000" ConnTimeout="10000" RxTimeout="5000" …>` amb `<Device>` fills; max 5 nodes TCP.
- `<Device Index Name Manufacturer SlaveNum BaseRegister="0|1" Timeout Enabled/>`: slave RTU 1–254, TCP 0–255, únic per node; timeout 100–30000 ms.
- `<Signals>` → `<Signal ID="…">` amb 15 fills en ordre fix: `idxConfig`, `idxExternal`, `IdxOperations`, `IdxFilters`, `Port` (RTU primer, després TCP; 255 = unset), `DeviceIndex` (-1 = broadcast), `IsBroadcast`, `ReadFunc` / `WriteFunc` (enum int: -1,1,2,3,4,5,6,15,16), `LenBits` (1/16/32/48/64), `Format` (0 Unsigned, 1 Signed C2, 2 Signed C1, 3 Float, 4 BitFields, 5 String, -1 none), `ByteOrder` (0 BE, 1 LE, 2 WordInv BE, 3 WordInv LE), `Bit` (-1 o 0–15), `NumOfBits`, `Address` (0–65535), `Deadband`, `Virtual Status= Fixed=`.
- **Poll records NO es guarden al XML**: es deriven dels senyals actius (ordenats Port→DeviceIndex→ReadFunc→Address) en build XBL. La UI els mostra derivats.

### 4.3 Conversions

- A `<IBOX><Conversions>`: `<Conversion Id= Description= Type= Param1..4=/>`; Type: 0 FILTER, 1 SCALE, 2 ARITH, 3 LOGICAL, 4 LUT_REMAP. Filtres primer, després operacions.
- `<RemapLUTs>`: `<RemapLUT Id= NumOfElements= Default= InvDefault=>` amb `<Element InValue= OutValue=/>`.
- Referència des de senyals: `IdxOperations`/`IdxFilters` (`idx,inverted;…`).

## 5. Validació (codis estables — draft)

Basada en `CheckProjectObjects` de KNX/MBM, `CheckMBMParams`, `CheckObjects` creuat i el manual:

| Codi | Severitat | Regla |
|---|---|---|
| `KNX-GA-FORMAT` | error | GA invàlida (format, rang, 0) |
| `KNX-GA-EXTENDED` | error | GA > 32767 sense UseExtendedAddresses |
| `KNX-PA-FORMAT` | error | physical address invàlida (area 0–15, line 0–15, dev 0–255, no 0.0.0) |
| `KNX-FLAGS-NONE` | error | cap flag U/T/W/R/Ri |
| `KNX-FLAGS-RI-R` | error | Ri i R alhora |
| `KNX-FLAGS-LISTEN` | error | listening addresses sense U ni W |
| `KNX-DPT-INVALID` | error | DPT fora de la selecció COMMON |
| `MB-FUNC-PAIR` | error | coils/discrete amb writes de registre i viceversa; read i write ambdós NO_FUNCTION |
| `MB-LEN-FORMAT` | error | LenBits vs Format/ByteOrder incompatibles (48+Float, 16+WordInv, 1+register funcs, FC6≠16 bits, BitFields>16…) |
| `MB-BIT-RANGE` | error | Bit/NumOfBits fora de LenBits |
| `MB-ADDRESS-BASE` | error | Address 0 amb device base 1 |
| `MB-SLAVE-RANGE` | error | slave fora de rang o duplicat al node |
| `MB-MEDIA` | error | senyal RTU amb Media=TCP i viceversa |
| `MB-BASE-CONFLICT` | error | mateix slave amb bases diferents |
| `MB-BROADCAST` | error | broadcast amb ReadFunc o BitFields |
| `SIG-LIMIT-ACTIVE` | error | > 3000 senyals actius |
| `SIG-LIMIT-TOTAL` | error | > 5000 files |
| `SIG-DEVICE-REF` | error | senyal apunta a device eliminat |
| `XFLAG-RT-READ` | warning | ReadFunc sense R ni T al costat KNX |
| `XFLAG-WU-WRITE` | warning | WriteFunc sense W ni U |

Nota: el descompilat **no** comprova solapaments de registres a MBM (els fusiona en poll records); el prompt demana detectar solapaments → `MB-REG-OVERLAP` com a **warning** informatiu, no error (decisió documentada; el firmware els tolera).

## 6. Format XBL i pla del generador

- Framing: `[4B BE n][n B TLV][4B BE CRC32(zlib)]`; dins del "complete", seguit del ZIP.
- Varint: thresholds 128/16384/2097152/2²⁸; prefix `0x80>>(n-1)`; flag special = byte `0x00` preposat (contenidors: len especial; arrays tag 1: tag especial). Arrays tag 2 suportats en lectura però mai emesos.
- Ordre top-level: header (tag 1: description, versions, **timestamp 6 B volàtil**, endianness, AppId) → IBOX (tag 2) → intern (KNX = **tag 4**) → extern (MBM = **tag 6**).
- Excepcions d'endianness: Deadband float **little-endian**; Address/ConfigID enformat 2B→1B shrunk; ExternalID forma 3B amb prefix 0x80 si link tables.
- El subarbre MBM és compartit amb BACnet–MBM → la fixture existent de 14619 B ja el cobreix parcialment.
- Port TS: primitives (varint/TLV/CRC/strings) → nodes genèrics → subarbre MBM → subarbre KNX → PreXBLActions (pairing, SortMBMArray, poll records) → framing. Comparació byte a byte emmascarant només els 6 B de timestamp i el CRC32 dependent.
- **Bloqueig**: no hi ha fixture KNX–MBM (`.ibmaps` + XBL de la mateixa passarel·la). Fins llavors, `knxMbmXblVerified=false` i deploy modificat desactivat. Camí per obtenir-la: RECVCMPLT d'un KNX–MBM configurat o CLI `XblGenerator` sobre un projecte KNX–MBM real.
- Pendent: contrastar `IntesisProjectKnxMbm_RT.cs` (variant RT 700) per si l'MVP l'ha de cobrir — de moment fora d'abast fins tenir evidència.

## 7. Decisions d'arquitectura de l'app

- **Estructura** (segons prompt actualitzat): `src/app`, `src/components`, `src/core/{project-format,signals,validation}`, `src/protocols/{knx,modbus/master}`, `src/gateway-families/knx-mbm`, `src/server/{intesis-transport,persistence}`. Regles de dependència del prompt: core/protocols purs; server → domini, mai al revés; app/components sense sockets ni fs.
- **XML**: `fast-xml-parser` (`preserveOrder: true`) es va avaluar a la iteració 2 i es va **descartar**: no distingeix `<tag />` de `<tag></tag>` i normalitza CRLF→LF, de manera que el round-trip byte-estable era impossible. Alternativa justificada i implementada: parser propi petit (`src/core/project-format/xml/parse.ts`) per al subconjunt XML machine-generated del format (sense comentaris/CDATA; falla en veu alta si n'apareixen), amb serialitzador estil .NET. Gate superat: la fixture real de referència (164 KB, BOM+CRLF) fa round-trip byte-idèntic, i els patches són quirúrgics.
- **ZIP**: `fflate` (petita, síncrona, pura). Confirmada: round-trip correcte i sortida determinista (mtime fixat). Nota: `strFromU8` menja el BOM UTF-8; `extractIbmaps` el restaura.
- **Persistència**: `.local-data/` (gitignored), escriptures atòmiques (tmp+rename), interfícies `ProjectRepository` + `ProjectFileStore`. Binaris al fs, mai a l'estat React ni al navegador.
- **Backend**: Route Handlers `runtime='nodejs'` + mòduls `server-only`; SSE per a logs/progrés; `GatewaySessionManager` en memòria darrere d'interfície (limitació single-process documentada); password només en memòria; cap SEND* exposat a l'MVP.
- **Demo mode**: projecte demo (fixture sintètica KNX–MBM marcada com a tal), etiqueta visual persistent, mai barrejat amb sessió live.
- **Tests**: Vitest + Testing Library + jsdom; `fast-check` només per varints/XBL. Fixtures de test sanejades (la fixture real conté `Pwd="admin"` → no es commiteja amb secrets).
- **Fonts tipogràfiques**: Saira/Lato via `next/font` si hi ha xarxa en instal·lar; si no, fallback de sistema documentat.

## 8. UI (del standalone v6 + manual)

- Tokens verbatim: `--hms-blue #043D5D`, accent `#1268B3`, pop `#1DC3EB`, fons `#F5F6F7` (v6 usa `#EFF0F1` com a muted; prompt diu `#F5F6F7` — s'adopten ambdós: fons app `#F5F6F7`, muted `#EFF0F1`), text `#333`, borders `#E2E5E7`, warning `#D9881B`, consola `#0B2233`.
- Densitat: body 12.5–13 px, grid 12 px, headers de columna mono 10.5 px uppercase.
- Pantalles: Connection (scan, llista amb compatibilitat, connect per IP, INFO?, log), Overview (stat cards, topologia, next steps reals), Configuration (General / Network & time* / KNX / Modbus Master / Conversions; *només si l'XML ho suporta — sí ho suporta via IBOX + TimeConfiguration), Modbus devices (arbre RTU/TCP + detall), Signals (taula densa + drawer + autoenum + comptador active/3000), Diagnostics (sessió, log, INFO?, XMODEM; monitors avançats només demo), Deploy (diff, export, round-trip sense canvis, deploy bloquejat).
- Interaccions a replicar: drawer de senyal amb prev/next i banner d'issues; validació first-class amb codis i deep links; autoenumeració; xips d'estat globals al header.

## 9. Riscos i incerteses documentades (no inventar, aïllar)

1. **Cap `.ibmaps` real KNX–MBM** → model derivat de descompilat; fixture sintètica marcada. La divergència real només es tancarà amb una descàrrega d'un gateway KNX–MBM.
2. **PhysicalPort RTU a KNX–MBM**: el codi diu "KNX products només Port B" — pendent de confirmar contra un projecte real; el model ho parametritza.
3. **Baud rates exactes del combo**: manual diu 1200–115200 (8 valors), confirmat p.28.
4. **Data Length (LenBits) valors UI**: descompilat diu 1/16/32/48/64; el manual no els llista.
5. **Rang d'adreces Modbus**: descompilat 0–65535; manual no el documenta.
6. **Solapaments de registre**: el firmware els tolera (poll records); warning informatiu, no bloquejant.
7. **Captures escriptori són BACnet↔MBM**: el costat KNX de la UI antiga no està capturat; referència = maqueta v6 + descompilat.
8. **Round-trip XML byte-estable**: pendent del gate de la iteració 2.
9. **Salutació `00 00` opcional** i quirks XMODEM de la sonda (duplicats, ERR): el port TS els gestiona explícitament (decisió: corregir ERR ignorat, re-ACK de duplicats, documentar-ho).
10. **Variant `_RT` del projecte KNX-MBM**: fora d'abast fins evidència.

## 10. Bloquejos per al deploy modificat

- Falta fixture KNX–MBM: `.ibmaps` + bytes XBL corresponents de la mateixa passarel·la.
- `knxMbmXblVerified` serà un artefacte generat per `scripts/verify-xbl.ts` quan la comparació byte a byte passi — mai una variable manual.

## 11. Estat d'iteracions

### Iteració 5 — Pantalles principals (feta)

- **Pantalles**: Overview (stat cards + accions: demo/open/export/switcher), Configuration (General / Gateway / KNX TP amb adreça física `area.line.device` i toggle d'adreces esteses), Modbus devices (seccions RTU ≤2 i TCP ≤5, formularis de node + taula de dispositius amb add/edit/remove, errors de límit 409 del servidor visibles), Signals (TanStack Table amb paginació de 100, cerca de text, filtre actiu/inactiu, comptador `active / total`, checkbox d'activació amb patch immediat i drawer d'edició de 372 px a la dreta segons la maqueta v6). Connection / Diagnostics / Deploy segueixen com a placeholders (iteració 7).
- **Patch ops noves** (`POST /api/projects/[id]/patch`, zod a la vora): `addRtuNode`, `addTcpNode` (límits 409: 2 RTU / 5 TCP), `removeNode`, `updateRtuNode`, `updateTcpNode`, `addDevice`, `updateDevice`, `removeDevice`, a més de les de senyals i configuració general/gateway/KNX.
- **Projecte actual**: `CurrentProjectProvider` (client) amb id persistit a `localStorage` llegit via `useSyncExternalStore` (snapshot servidor `null` → sense mismatch d'hidratació); 404 neteja a l'estat "sense projecte"; el demo mai es carrega automàticament. `usePatch()` aplica patches i substitueix la vista amb la resposta del servidor.
- **Validació a la UI**: panell global col·lapsable (AppShell) amb issues agrupades per severitat + llista inline per pantalla (`ScreenIssues` filtra per `ref.screen`).
- **Shell**: contingut full-width alineat a l'esquerra com la maqueta (s'ha eliminat el `mx-auto max-w-[1440px]`).
- **Tests nous (RTL)**: agrupació del panell de validació, taula de senyals (render, cerca, toggle actiu, drawer→`updateSignal` amb fetch mockejat), estat buit d'Overview. Suite: 81 tests verds; `lint`/`typecheck`/`build` verds.

### Iteració 6 — Transport Intesis (feta, offline)

- **Capa nova `src/server/intesis-transport/`** (tot `server-only`, desacoblada del domini; el domini només es toca via `parseCompleteBlob`/`openCompleteBlob` ja existents):
  - `crypto/`: CRC-16/CCITT (port de `Crc16.cs`, taula generada), XXTEA-128-CBC (port exacte de `XxTea.cs`, paraules BE, padding de zeros), DH amb p/q constants + derivació de clau de sessió (SHA1 folding asimètric pwd 0/4/8/12, K 1/5/9/13 + XOR) i keystreams TX/RX (blocs de 128 B, `iv[0]++`+MD5). CRC32: es **reutilitza** `src/core/project-format/crc32.ts` (no duplicat).
  - `xmodem/`: receptor XMODEM-1K com a màquina d'estats pura (CRC16, padding CTRL-Z, retrissions, CAN CAN, EOT→ACK) + helper d'encodatge només per a tests. Correccions documentades sobre la sonda: duplicats re-ACK en lloc de rebutjar-los, i `takePending()` retorna els bytes posteriors a l'EOT al canal de línies.
  - `session.ts`: màquina d'estats de sessió sobre una interfície `Duplex` (LOGIN0/1/2, detecció SKT → fallback en clar, keepalive només-event com el MAPS, `INFO?`, `RECVCMPLT` amb validació length/CRC32/ZIP via `parseCompleteBlob`; `RECVCMPLT:ERR` **no** s'ignora, a diferència de la sonda).
  - `transport.ts`: `TcpDuplex` (node:net, TCP/23, keepalive de socket).
  - `discovery.ts`: parser pur de datagrames + wrapper node:dgram (broadcast per interfície + 255.255.255.255, UDP/23, `INFO?` sense CRLF).
  - `manager.ts`: `GatewaySessionManager` en memòria darrere de `GatewaySessions` (limitació single-process documentada), contrasenya només en memòria, events log/progrés amb replay per a SSE, errors HTTP-shaped (`GatewayRequestError`).
  - `testing/fake-gateway.ts`: servidor fals scriptat (DH+XXTEA reals amb clau privada fixa) compartit pels tests.
- **API** (`runtime nodejs`, zod a la vora, `errorResponse` reutilitzat i generalitzat per errors amb `status`): `POST /api/gateway/discovery`, `POST|GET /api/gateway/sessions`, `GET|DELETE /api/gateway/sessions/[id]`, `POST .../info`, `POST .../receive` (→ `openCompleteBlob`, source `"gateway"`), `GET .../events` (SSE). **Cap endpoint d'escriptura** (SENDPROJ/SENDCMPLT no existen al codi).
- **Verificat offline** (67 tests nous, 148 totals): vectors de cada primitiva calculats amb `sonda_maps.py` (procedència documentada als tests; LOGIN0/1/2 end-to-end amb aleatorietat fixa), login xifrat + fallback en clar + rebuig d'autenticació contra el servidor fals, parser `INFO?` amb la resposta documentada de PROTOCOL.md §8.5, RECVCMPLT feliç + rebuig per CRC32 corromput / llargada anunciada errònia / unitat buida (`RECVPROJ:INVALID`), parser de discovery. `pnpm test`/`typecheck`/`lint`/`build` verds.
- **Pendent**: prova en viu contra el 700 Air de l'usuari — **només lectura** (connect, INFO?, RECVCMPLT) i només amb autorització explícita; validació del keepalive i dels bytes `00` intercalats en trànsit real.

### Iteració 7 — Pantalles de gateway: Connection, Diagnostics, Deploy (feta, offline)

- **Connection** (`/connection`): scan UDP/23 (`POST /api/gateway/discovery`) amb llista de gateways on els KNX–MBM (AppId 4 / `IN-KNX-MBM` / `IN701KNXMBM`) destaquen i la resta queden atenuades amb el distintiu “Different family”; connect manual per IP + contrasenya (enviada una sola vegada, mai persistida al client — es neteja l'estat després de l'intent); vista de sessió amb identitat + INFO? llegible, refresh d'INFO, desconnexió; **Receive** integrat a la mateixa pantalla: botó “Receive from gateway” (RECVCMPLT, només lectura) amb progrés XMODEM via SSE, el projecte rebut queda com a actual (source “gateway”) i el servidor rebutja projectes no KNX–MBM amb error clar. Estat buit honest: “No gateway on the network — you can keep working with the demo project” + enllaç a Overview.
- **Diagnostics** (`/diagnostics`): estat de sessió, snapshot INFO? amb refresh, log de transferència/connexió via SSE i barra de progrés XMODEM. Sense sessió: estat buit honest. Monitors avançats (tràfic de bus) fora d'abast — no s'han simulat.
- **Deploy** (`/deploy`): export `.ibmaps` (endpoint existent), indicador `hasCompleteBlob` amb explicació del round-trip, i el botó “Deploy modified project” **DESACTIVAT** amb l'explicació de la capability `knxMbmXblVerified` (verificació byte a byte contra fixture KNX–MBM real, encara no disponible). Cap camí ocult per disparar-lo.
- **Client nou**: `src/lib/gateway-api.ts` (wrappers fetch + miralls de tipus del server; `isKnxMbmGateway`), `src/lib/use-session-events.ts` (hook SSE amb replay, estat etiquetat per sessió), `src/components/gateway-info-table.tsx` i `src/components/session-log.tsx` (consola mono `#0B2233` + barra de progrés). Cap component client importa `src/server/**`.
- **Tests nous (RTL)**: scan amb llista de gateways i compatibilitat, estat buit de Connection, Deploy desactivat amb explicació, estat buit de Diagnostics. Suite: 154 tests verds; `lint`/`typecheck`/`build` verds.
- **Capacitat live (només lectura)**: scan, connect, INFO?, RECVCMPLT i log SSE funcionen contra la API de la iteració 6; pendent la prova en viu amb autorització explícita. Cap SENDPROJ/SENDCMPLT.

### Iteració 8 — Generador XBL (feta, NO verificada)

- **Mòdul nou `src/gateway-families/knx-mbm/xbl/`** (pur, determinista, sense fs/net; exportat des de `src/gateway-families/knx-mbm/index.ts`). Port fidel dels writers XBL descompilats (`XBLParser.cs`, `IntesisXBL.cs`, `IntesisProjectKnxMbm.cs`, `InternalKnx.cs`, `IntesisKnx.cs`, `KnxComObject.cs`, `ExternalMbm.cs`, `MbmObject.cs`, `PollRecord.cs`, helpers `IntesisBinaryOps`/`SecurityConfig`/`TimeConfiguration`/`IntesisLicense`/`IntesisOem`), amb la procedència citada a la capçalera de cada fitxer:
  - `tlv.ts`: varint 1–4B BE (prefixos 0x80/0x40/0x20/0x10, flag *special* amb 0x00; contenidors = length especial, arrays tag 1 = tag especial), `serializeElements` (reescriptura bottom-up de `generate_aux`, bytes idèntics), helpers escalars (`u16be/u32be/u32le/f32le`, `shrunkU16be`, `externalIdBytes`, `nullTerminatedUtf8`, `ipv4Bytes`).
  - `decode.ts`: lector TLV invers (nodes, contenidors, arrays tag 1) per als tests i per al harness — permet localizar camps estructuralment (p. ex. el timestamp) en lloc de hardcodar offsets.
  - `pipeline.ts`: parseig de l'XML + port complet de `PreXBLActions`: split enabled/error, `isEnabledDevice`, `CreateEnabledDevicesList` (RTU→TCP, reindexació compacta, ports TCP desplaçats pels ports RTU omés), `SortMBMArray` (lectura primer, després escriptura; port→deviceIndex, estable), relink KNX↔MBM, error externalIds (`constructMBMExternalId`), cadena de conversions (filtres→operacions→filtres invertits, transforms d'inversió, dedup, índex 255 si no n'hi ha) i `GeneratePollRecordsV2` verbatim.
  - `nodes-common.ts`: header tag 1 (desc ≤32B+NUL, SW version 4B parametritzada — **no** surt de l'XML; default 1.2.31.0 observat a la referència BACnet real, CompatibilityVersion, timestamp volàtil 6B injectat per opcions, endianess, AppId 4) i IBOX tag 2 (xarxa, pwd, nom, conversions 17B, USB tags 10/11 sempre emesos, placeholders timezone 12 / NTP 13, DNS 14, seguretat 15 i ports 17/18 condicionals; mai link-tables 8 ni remap 9 per KNX–MBM).
  - `nodes-knx.ts`: node KNX tag 4 amb fills **posicionals** 6,7,8,9,11,10,12 (11 abans de 10); `getTypeFromDpt` amb la taula completa; adreces de grup deduplicades i ordenades; associacions [addrIdx+1][objIdx+1]; array de config per objecte amb externalId relinkat (shrunk) i conversionId.
  - `nodes-mbm.ts`: node MBM tag 6 (null si res enabled): resolució de media, deadband float LE només si ≠0, forma single-RTU (tags 2+3) vs multi (array tag 9), array TCP tag 5, senyals tag 6 (`GenerateXBLItem`, adreces/externalId/configId shrunk, conversionId només si readFunc≠-1 i ≠255), poll records tag 7 (índexos de senyal, no adreces), device count tag 11. PhysicalPort RTU: l'índex del node guanya sobre l'atribut XML (object initializer del C#).
  - `generate.ts`: `generateKnxMbmXbl(projectXml, { now?, swVersion? }) → Uint8Array` — payload TLV cru (els bytes `n`); el framing `[4B len][XBL][4B CRC32]` el fa `buildCompleteBlob` existent. Rebutja projectes no KNX–MBM i comptatges de senyals KNX/MBM desiguals.
- **NO VERIFICADA**: no hi ha fixture real KNX–MBM; la pantalla Deploy segueix desactivada i **res no llegeix encara** l'artefacte de capability. Marques UNVERIFIED documentades al codi: port broadcast TCP sense offset RTU (verbatim), comparació de port de l'error-object contra el nou índex RTU, PhysicalPort=índex (l'XML s'ignora), parseig lax d'Endianess, versions parcials ("1.0" → padding amb 0), refs de conversió amb segments buits tolerats (C# llençaria), forma legacy sense `RtuNodes` no suportada, i SW version per defecte no derivable del projecte.
- **Harness `scripts/verify-xbl.ts`** (script `pnpm verify:xbl`): `pnpm verify:xbl <projecte.(ibmaps|zip|blob)> <referència.(bin|xbl)> [--mask-timestamp] [--sw-version a.b.c.d] [--now ISO]`. La referència pot ser blob complet (valida CRC32 via `parseCompleteBlob`) o XBL cru; la SW version s'extreu per defecte del header de la referència (tag 1 → fill 2, **no** es maska — una diferència de versió és una divergència real a investigar); `--mask-timestamp` posa a zero els 6 bytes volàtils (localitzats estructuralment en ambdós buffers) abans de comparar. Sortides: 0 = match byte a byte (escriu `.local-data/capabilities.json` atòmicament, clau `knxMbmXblVerified` amb `verifiedAt`, sha256 de projecte i referència, `xblLength`, `maskedTimestamp`, `swVersion`), 1 = divergència (primer offset amb context hex ±16B), 2 = error d'ús/setup. Quan arribi una fixture real: generar l'XBL de referència amb el MAPS d'escriptori des del mateix `.ibmaps` i executar el harness; si passa, la iteració següent pot habilitar el deploy llegint la capability.
- **Tests nous (44)**: `tlv.test.ts` (vectors varint calculats a mà 0/127/128/16383/16384/2097151/2097152, serialització node/contenidor/array, helpers; propietats fast-check: round-trip varint sobre tot el rang i round-trip serialize→decode d'arbres aleatoris) i `generate.test.ts` (determinisme amb `now` fix, diff només als 6 bytes del timestamp, estructura completa header/IBOX/KNX/MBM amb bytes exactes derivats del C#, ordre posicional dels fills KNX, ordenació lectura-primer dels senyals, poll records, errors: no-KNX–MBM i comptatges desiguals). Autotest del harness contra referència sintètica auto-generada: match (blob i cru), divergència amb offset, errors d'ús.

### Iteració 9 — Tancament del primer lliurament (feta)

- **README d'arrel nou** (`README.md`, anglès): què és l'MVP, mapa d'arquitectura per mòduls, com executar (`pnpm install` / `pnpm dev`, demo explícit des d'Overview, dades a `.local-data/` o `MAPS_DATA_DIR`), com verificar (`pnpm test` / `typecheck` / `lint` / `build` / `verify:xbl`), live mode només-lectura amb contrasenyes només en memòria, i el bloqueig del deploy modificat amb l'ús exacte del harness `verify-xbl` documentat des del propi script.
- **Revisió de `src/gateway-families/README.md`**: afegits `xbl/` i `index.ts` a la llista de continguts d'una família (existien des de les iteracions 0 i 8 però no constaven); la resta segueix sent exacta.
- **Verificació final**: `pnpm test` (suite completa verda), `pnpm typecheck`, `pnpm lint` i `pnpm build` verds després dels canvis de documentació.

#### Criteris d'acceptació del primer lliurament (del prompt d'encàrrec)

1. **`pnpm dev` arrenca app + runtime backend en dev** — FET. Ordre única documentada al README; el backend viu als Route Handlers Node de la mateixa app.
2. **Una sola app i un sol paquet pnpm, sense workspace/`apps/`/`packages/`/Turborepo/Nx** — FET. El `pnpm-workspace.yaml` de l'arrel només porta settings de pnpm 11 (sense clau `packages:`); comentari al fitxer.
3. **Arrenca sense compte, login, Supabase ni variables cloud** — FET. Mode local single-user; cap dependència d'autenticació.
4. **Projectes locals sobreviuen reinicis, fora de Git, via adaptadors locals** — FET. `LocalProjectStore` a `.local-data/` (o `MAPS_DATA_DIR`), escriptures atòmiques tmp+rename, gitignored.
5. **`pnpm test` sense passarel·la física** — FET. Suite verda (unitaris + integració; transport provat contra fake gateway scriptat amb DH+XXTEA reals).
6. **UI només KNX ↔ Modbus Master i en anglès** — FET. Cap altra família implementada ni visible; textos UI en anglès.
7. **Flux demo complet i clarament etiquetat** — FET. "Load demo project" explícit a Overview, fixture sintètica marcada, mai barrejada amb sessió live ni auto-carregada.
8. **Live mode: discovery, connect, INFO?, receive** — PARCIAL. Implementat i provat offline contra fake gateway; pendent la prova en viu contra hardware real (només lectura i només amb autorització explícita; no hi ha cap KNX–MBM disponible).
9. **Obrir, editar, validar i desar `.ibmaps` KNX–MBM sense perdre nodes/camps desconeguts** — FET. Parser propi amb patches quirúrgics; la fixture real de referència (164 KB, BOM+CRLF) fa round-trip byte-idèntic.
10. **Round-trip estable XML/ZIP del projecte sense canvis** — FET. Byte-estable als dos nivells (XML i ZIP determinista amb mtime fixat), cobert per tests.
11. **Cap secret als logs ni al frontend persistent** — FET. Contrasenya només en memòria (netejada després de l'intent de connexió), sense persistència ni logs de claus/payloads; fixtures sanejades.
12. **Deploy de canvis impossible d'activar accidentalment sense `knxMbmXblVerified` obtingut de proves** — FET. No hi ha cap endpoint SENDPROJ/SENDCMPLT; el botó està desactivat i la capability només l'escriu `scripts/verify-xbl.ts` després d'un match byte a byte (res no la llegeix encara, així que el deploy romans apagat de forma incondicional).
13. **README amb arquitectura, execució, proves, live mode i fixture pendent** — FET. Aquesta iteració.

Nota d'entrega: les **captures de les pantalles clau** que demana el prompt queden PENDENTS — no s'han fet captures visuals en aquesta iteració.

#### Bloquejos reals (sense canvis respecte a la iteració 8)

- **No hi ha passarel·la KNX–MBM disponible** → el transport live resta sense validar contra hardware real; la prova en viu (només lectura) requereix autorització explícita de l'usuari.
- **No hi ha fixture real KNX–MBM (`.ibmaps` + XBL de la mateixa passarel·la)** → el generador XBL no està verificat byte a byte → `knxMbmXblVerified` mai s'escrit → deploy de configuracions modificades desactivat. Camí de desbloqueig: obtenir la fixture, generar la referència amb el MAPS d'escriptori i executar `pnpm verify:xbl <projecte> <referència> [--mask-timestamp]`.
- **Variant `_RT` del projecte KNX–MBM**: fora d'abast fins tenir evidència (decisió de la iteració 0 mantinguda).

### Post-lliurament — primera prova en viu (2026-08-18, 770 Air Daikin a 192.168.2.130)

- **Discovery unicast afegit**: el broadcast UDP/23 no surt de WSL2/NAT (l'app corre a 172.31.x, la LAN és 192.168.2.x), així que el scan no trobava res. `POST /api/gateway/discovery` ara accepta `targets: string[]` (IPs unicast, màx 64) que es consulten a més del broadcast; la pantalla Connection té un camp "Direct IP (optional)" amb validació client.
- **Prova en viu només-lectura (autoritzada)**: la 770 Air (APPNAME Daikin, APPID 67, platform 700 Series, core 2.0.52.0) respon a `INFO?` unicast i el parser extreu tots els camps via l'API de l'app. El broadcast segueix sense funcionar des de WSL2 — limitació de xarxa, no del codi.
- **Correcció derivada de la prova real**: `NETDHCP` ve com `ON`/`OFF` (no `1`/`0`); `summarizeInfo` ho accepta ara (`/^(1|true|on|yes)$/i`) amb test nou.
- **Connect + INFO? provats en viu (2026-08-18, autorització explícita, només lectura)**: login encriptat (DH + derivació de clau + XXTEA + LOGIN0/1/2) completat contra la 770 Air real amb la contrasenya de fàbrica; sessió `encrypted: true`; `INFO?` per TCP parsejat correctament; receive respon netament "The gateway has no project stored" (la unitat està verge, CFGNAME=NO CONFIG) — el camí RECVCMPLT complet quedarà provat quan la unitat tingui configuració. Sessió tancada després de la prova.
- Pendent: receive complet contra la 770 Air (requereix que tingui projecte) i, si s'implementa la família Daikin, verificació XBL amb fixture real.

### Fase 2 (branca `feat/ac-me-modbus`) — pas 2.1: primera fixture real rebuda

- Eina nova `scripts/receive-project.ts` (`pnpm receive:project`): RECVCMPLT read-only contra una passarel·la viva, valida blob (len/CRC32/ZIP) i desa a disc amb sha256. Contrasenya només via `GW_PASSWORD`.
- **Primera fixture real capturada** (2026-08-18, 770 Air a 192.168.2.130): `IN770AIRxxxO000` Mitsubishi Electric AC ↔ Modbus **Slave**, XML de 297 KB + XBL oficial de 8.205 B, CRC32 verificat. Desada a `.local-data/fixtures/` (fora de Git — pot contenir credencials).
- El camí de transferència complet (login encriptat + XMODEM + validació) queda així validat contra hardware real.

### Fase 2 — pas 2.3: domini de la família ME AC ↔ Modbus Slave (fet, 2026-08-18)

Segona família implementada seguint la recepta KNX–MBM, a partir de l'anàlisi de `docs/ac-me-mbs-analisi.md`:

- **`src/protocols/modbus/slave/`**: `MbsConfig` (media, byteOrder, updateCOV, addressMode, tempSetpoint, commErrorTout, registerBase, RTU/TCP, slaveAddressMode, MBSlave[]), enums (`MbsReadWrite` amb TRIGGER, `MbsAddressMode` FIXED/CUSTOM/V4_COMP, `SlaveAddressMode`, `MbsTempSetpoint`) i el **mapa d'adreces FIXED/V4_COMP portat de `IntesisProjectMbsMe_RT.GetAddressFromSignal`** (`addresses.ts`). CUSTOM retorna `null` llevat que se li passi l'adreça persistida. Tests del mapa amb els valors documentats (col·lisions intencionades d'specs incloses).
- **`src/protocols/me/`**: enums ME (MEGroupType, ControllerModel, CompatibilityMode, METemperatureMode), model `MeController`/`MeGroup`/`MeConfig` (sense `AuthUserId`/`AuthPassword`), constants `SIGNAL_*` d'`IntesisMe.cs` i la **taula de specs** (`GROUP_SPECS` 0–60 + `GENERAL_SPECS` 0–29: spec ↔ signalIndex ↔ descripció/valors permesos ↔ tipat intern per defecte), extreta de `CreateSignalsWithParams`/`GetSignalDescription`/`GetAllowedValues` i verificada contra la fixture real pels specs presents (36 distints). Specs no exercitats per la fixture marcats `UNVERIFIED`.
- **`src/gateway-families/me-mbs/`**: `model.ts` (sense `Pwd` ni credencials G50), `detect.ts` (InternalProtocol="Modbus Slave" + ExternalProtocol="Mitsubishi Electric" + Platform="3"), `from-xml.ts`, `xml-ops.ts` (general/gateway, config MBS, escalars ME, controller/group, signal add/remove/update — els dos costats alineats per ID), `validate.ts` amb codis estables (`MBS-READWRITE`, `MBS-ADDRESS-RANGE`, `MBS-ADDRESS-DUP`, `MBS-LEN-FORMAT`, `MBS-STRING-LEN`, `MBS-SLAVE-RANGE`, `MBS-SLAVE-DUP`, `MBS-COMMERR-RANGE`, `ME-CONTROLLER-LIMIT`, `ME-GROUP-LIMIT`, `ME-CTRL-DISABLED` (warning), `ME-GROUP-REF`, `ME-SPEC-UNKNOWN`, `ME-SPEC-ADDRESS` + els límits `SIG-LIMIT-*`).
- **Tests**: 44 nous (sintètics + mapa d'adreces + bateria de validació, un test per regla). Els tests de fixture real (skip si absent) passen sobre els 297 KB reals: **222+222 senyals, idxConfig 1:1, 222/222 adreces reproduïdes pel mapa FIXED, round-trip byte-idèntic, validació sense errors** (només el warning ME-CTRL-DISABLED del controlador 0 deshabilitat amb grups habilitats, com diu l'anàlisi §8c.3).
- Divergència respecte a l'anàlisi: cap de substància. El model omet el detall de `ConsumptionFunction`/`EnergyMeter` (deshabilitada a la fixture; es preserva intacta a l'XML perquè els edits són pedaços sobre el document).
- Pendent per a 2.4/2.5: writers XBL (`xbl/nodes-mbs.ts` + `nodes-me.ts`, AppId parametritzable, PreXBLActions) i wiring API/UI.

### Fase 2 — pas 2.4: generador XBL ME–MBS verificat byte a byte (fet, 2026-08-19)

- **Refactor previ**: la maquinària XBL compartida (`tlv.ts`, `decode.ts`, `nodes-common.ts` — header/IBOX amb AppId i LUTs parametritzats —, `conversions.ts`, `ibox-xml.ts`) s'ha mogut de `knx-mbm/xbl/` a **`src/core/xbl/`**; el KNX–MBM només hi adapta imports. La capçalera XBL ara rep l'AppId com a paràmetre: és l'AppId **del dispositiu connectat** (`IntesisXBL.cs:149`) — 64 `ME_AC_XXX` a la 770 Air — mentre que el projecte declara `CompatibilityID=8` (`ME_AC_MBS`).
- **Mòdul nou `src/gateway-families/me-mbs/xbl/`** (pur, determinista, sense fs/net; exportat des de l'`index.ts` de la família):
  - `pipeline.ts`: parseig XML + port de `IntesisProjectMbsMe_RT.PreXBLActions` (`_RT.cs:321-441`): split enabled 1:1 MBS↔ME, ordenació estable per (Address, Bit), `indexFirst/Last` dels MBSlave, relink d'externalIds ME cap a les posicions MBS ordenades, taula de conversions (MBS primer, després ME; `ActiveMappings` = **totes** les LUTs del projecte, `_RT.cs:446`), `UpdateG50CommError` (ExternalME.cs:648-665) i reescriptura final dels externalIds MBS via `IntesisMe.ConstructMEExternalID` (IntesisMe.cs:143-174: g50≪14 | grup≪8 | cmd≪7 | senyal; +64 a senyals d'unitat; branca virtual sense grup).
  - `nodes-mbs.ts`: node intern **tag 9** (`InternalMbs.CreateInternalXBLNode`, InternalMbs.cs:646-769) amb fills **posicionals** 1,2,3,7,4,5,6 — el tag 7 (`CommErrorTout×1000` u32 BE) s'emet entre el 3 i el 4. Item de senyal: tags 1 LenBits, 2 Format, 3 Bit (si ≠-1), 4 Address (shrunk u16 BE, −1 si RegisterBase=1), 5 ReadWrite+1, 6 ExternalID shrunk, 7 ConfigID shrunk, 8 ConversionID (si ≠255), 9 StringLength (només STRING), 11 SlaveIndex (si ≠-1). Tag 8 d'slaves només en mode MULTIPLE (la fixture és SINGLE i no l'emet).
  - `nodes-me.ts`: node extern **tag 8** (`ExternalME.CreateExternalXBLNode`, ExternalME.cs:158-484): tags 1–5 (PollPeriod u16 BE, AnsTimeout, ControllerTout, ReadCyclesPerAlarm, WriteMaxBurst), tag 6 = array de controladors G50 **amb almenys un grup habilitat** (el flag `Enabled` del controlador s'ignora — la fixture el té a False amb 6 grups actius i l'emet igualment). Per controlador: IP 4B, port u16 BE, type, model, `!Compatibility`, `indexCommErr` shrunk, setpoint05, tag 8 = array de grups habilitats (exclosos els SYS_COMPONENT) amb tags 1 idx+1, 2 type, 3 fanSpeeds, 4 dualSetPoint, 5 urc, **t6** = contenidor d'externalIds indexats per `signalIndex+1` (només senyals IsStatus, dedup primer-guanya, fallback node 1 = 65535 si buit) i **t7** = contenidor de conversions amb la mateixa clau (fallback node 1 = 255). Tags 9/10 (unitats IU/OU) i 11–14 (auth AE-C400E) portats verbatim però marcats UNVERIFIED.
  - `generate.ts`: `generateMeMbsXbl(projectXml, { now?, swVersion?, appId? }) → Uint8Array` amb `appId` per defecte **64**. Ordre top-level verificat: 1 (header), 2 (IBOX), 9 (MBS), 8 (ME). IBOX sense tags USB 10/11 (RT_AIR no té USB host).
- **VERIFICAT BYTE A BYTE contra la fixture real** (`.local-data/fixtures/770air-me-mbs-2026-08-18.bin`, XBL oficial de 8.205 B): `pnpm verify:xbl --family me-mbs <blob> <blob> --mask-timestamp` → **MATCH — 8205 bytes identical to reference**, a la primera execució, sense cap ronda de divergències (l'anàlisi del pas 2.2 ja havia resolt 222/222 adreces i l'estructura TLV). Sense màscara, els únics bytes divergents són 4 dels 6 del timestamp (offsets 52,55,56,57 — dia/hores/minuts/segons; mes i any coincideixen), cosa que confirma que el timestamp és l'únic camp volàtil. Capability `meMbsXblVerified` escrita a `.local-data/capabilities.json`.
- **Semàtiques descobertes/confirmades empíricament**: (1) l'AppId de la capçalera és 64 (unitat), no 8 (projecte); (2) el controlador G50 s'emet tot i tenir `Enabled=False` — el filtre és "té algun grup habilitat"; (3) els contenidors t6/t7 dels grups s'indexen per `signalIndex+1` i només inclouen senyals IsStatus; (4) els senyals virtuals (tota la fixture) fan servir la branca curta de `ConstructMEExternalID` (cmd≪7 | signalIndex); (5) `ActiveMappings` porta les 21 LUTs del projecte, no només les referenciades; (6) la numeració dels contenidors t6/t7 queda tancada: t6 = externalIds, t7 = conversions (pendent de l'anàlisi §8c.5).
- **Marques UNVERIFIED** (sense mostra real): item MBSlave del mode MULTIPLE (tag 8 intern), nodes d'unitats IU/OU (tags 9/10 del G50 — inclou dos quirks del C# portats verbatim: el tag d'unitat usa `list[num].UnitID+1` amb l'índex corrent, i el contenidor de conversions es construeix de tota la llista del controlador), tags 11–14 d'auth de l'AE-C400E, Fahrenheit (tag 7 del node ME), i qualsevol projecte amb `ConsumptionFunction` habilitada (el generador el **rebutja** en lloc de generar un XBL possiblement erroni).
- **Harness generalitzat**: `scripts/verify-xbl.ts` accepta `--family knx-mbm|me-mbs` (defecte `knx-mbm`, comportament previ intacte) i `--app-id N`; la clau de capability és per família (`knxMbmXblVerified` / `meMbsXblVerified`).
- **Tests nous (16)** a `xbl/generate.test.ts`: determinisme, volatilitat només-timestamp, ordre top-level, header amb AppId 64 (i opcions), IBOX amb conversions/LUTs i sense USB, node MBS (ordre posicional 1,2,3,7,4,5,6; CommErrorTout ×1000; RTU/TCP; senyals ordenats amb externalIds/conversions relinkats; RegisterBase=1 → adreça −1), node ME (G50 amb grups habilitats, t6/t7 indexats i deduplicats), errors (família errònia, comptatges desiguals, consumption habilitada) i **gate byte-exact sobre la fixture real (skip si absent)** amb timestamp maskat estructuralment. La fixture sintètica compartida no declara les conversions/LUTs que la taula de specs referencia ("0,1", "17,0"); el test enriqueix l'XML en memòria amb el bloc de conversions de la fixture real (modificant el fixture compartit trencaria tests del pas 2.3 que compten conversions).
- Pendent per a 2.5: wiring de la família a API/UI (selector de família a Connection/Deploy, pantalles MBS/ME, lectures de `meMbsXblVerified`).

### Fase 2 — pas 2.5: wiring de la família ME–MBS a l'API REST i a la UI (fet, 2026-08-19)

- **Registre de famílies** (`src/server/projects/families.ts`, nou): un array `FAMILIES` amb una entrada per família — `id`, `displayName`, `detect`, `fromXml`, `validate`, `accepts(patch)` i `applyPatch(doc, patch)` — de manera que el servei de projectes ja no coneix cap família en concret. `detectFamily(doc)` prova les entrades en ordre; `familyById` i `supportedFamiliesText()` alimenten els missatges d'error. Els tipus de patch són una unió discriminant per `type` (`ProjectPatch = KnxMbmPatch | MeMbsPatch`) i `accepts()` rebutja també un `updateSignal` amb endpoint de l'altra família (`knx` vs `me`). Errors amb status HTTP via `ProjectServiceError` (`errors.ts`, nou), renderitzat per `http.ts`.
- **Servei** (`src/server/projects/service.ts`): `ProjectMeta.family` persistit (`persistence/types.ts`); les metes antigues sense `family` es **backfillen per detecció** i es re-persisteixen (`withFamily`, fallback `knx-mbm` perquè era l'única família possible). `openIbmaps`/`openCompleteBlob` detecten la família i rebutgen fitxers no suportats amb **422** i la llista de famílies suportades. `applyPatches` re-detecta la família del document, valida cada pedaç amb `accepts()` (**409** amb missatge clar si és de l'altra família) i retorna la vista actualitzada. `ProjectView` és una unió discriminada per `family` amb el model tipat de cada família.
- **Ruta de patch** (`src/app/api/projects/[id]/patch/route.ts`): unió zod de tots els pedaços de les dues famílies; l'endpoint `modbus` admet les dues formes (master KNX ↔ slave MBS) via `z.union`, i els pedaços ME–MBS nous (`updateMbsConfig`, `updateRtuConfig`, `updateTcpConfig`, `updateMeScalars`, `updateController`, `updateGroup`) tenen schemas estrictes propis.
- **Client**: `src/lib/project-types.ts` duplica els tipus purs del servidor (`FamilyId`, `FAMILY_LABELS`, `ProjectView` en unió, `ProjectPatchInput` — el client mai importa `src/server/**`); `gateway-api.ts` propaga `family` a les metes.
- **Pantalles** (dispatch per `view.family` amb components `MeMbs*` separats):
  - **Overview**: badge de família (`FAMILY_LABELS`) i targeta de continguts per família (`MeMbsCounts`: controladors/grups/senyals/esclaus; `KnxMbmCounts`: nodes/dispositius).
  - **Signals** (`signals-screen-me-mbs.tsx`): columnes pròpies — descripció, **AC parameter** (resolt de la taula de specs amb `describeSpec`), **Controller / group** (`Controller-wide` o `C1 · G1 — Office`), registre, accés (Read / Trigger / Read–write) i format. Drawer (`signal-drawer-me-mbs.tsx`) editant exactament el que `xml-ops` suporta: descripció, endpoint ME (controlador, grup, spec amb els valors permesos com a hint, status/comanda) i endpoint MBS (adreça, longitud, format, accés), més remove amb confirmació.
  - **Devices** (`devices-screen-me-mbs.tsx`): **read-only i etiquetat com a tal** — el costat Modbus Slave no té nodes/dispositius (el gateway és el servidor), així que mostra el resum MBS (media, byte order, address mode, RTU/TCP, esclaus virtuals) i l'arbre controlador → grups habilitats. Els pedaços `updateController`/`updateGroup` existeixen a l'API però no estan wirejats a aquesta pantalla.
  - **Configuration**: general + gateway comuns a les dues famílies; per a me-mbs, targeta **Modbus Slave** (media/byte order/register base/comm-error timeout + RTU + TCP) i targeta d'**escalars ME** (pollPeriod, timeouts, writeMaxBurst); per a knx-mbm es conserva la targeta KNX.
  - **Connection/Diagnostics/Deploy**: family-aware; el Deploy continua deshabilitat (sense escriptura al gateway) i `meMbsXblVerified` **no** es llegeix a la UI. El panell de validació és genèric (code + message + ref path) i renderitza els refs ME–MBS sense canvis.
- **Tests nous**: +8 a `service.test.ts` (describe "me-mbs family": open + family, patch i persistència, 409 en les dues direccions, backfill de `family`, i **fixture real 770 Air skip-if-absent**: open → patch → validació) i +2 a `signals-screen.test.tsx` (describe "me-mbs": columnes/specs/scope, drawer amb edició de descripció + endpoint); overview/deploy/local-store adaptats. Total: **268 tests verds (32 fitxers)**, `typecheck`, `lint` i `build` verds.
- **Smoke test amb la fixture real** (dev server a :3103): `POST /api/projects/open` amb `770air-me-mbs-2026-08-18.ibmaps.xml` → `family: "me-mbs"`, **222 senyals**, 2 controladors, 1 sol warning (`ME-CTRL-DISABLED`, esperat) i **cap `Pwd` al payload**; patch de descripció d'un senyal → persisteix en re-llegir la vista; pedaç knx-mbm sobre el projecte me-mbs → 409 amb missatge clar. El projecte de smoke s'ha esborrat del store local després.
- Divergències respecte al pla: la pantalla Devices de me-mbs queda read-only (decisió conscient: el patch API ja suporta controller/group, falta wirejar-ho a la UI); la resta del pas, sense desviacions.

### Fase 2 — pas 2.6: camí d'escriptura (SENDCMPLT) amb deploy gated per a ME–MBS (fet, 2026-08-19)

Autorització explícita de l'usuari per implementar el camí d'escriptura **només** per a la família me-mbs; el deploy de knx-mbm continua desactivat (generador XBL no verificat). La prova en viu queda fora d'aquest pas (la fa l'usuari).

- **Transmissor XMODEM-1K** (`src/server/intesis-transport/xmodem/sender.ts`, nou): màquina d'estats pura simètrica al receptor (`push()`/`onTimeout()` → bytes a escriure). Port d'`xmodem_transmit` de la sonda (XModem.cs `XmodemTransmit`, PROTOCOL.md §4/§10.5): espera de sincronisme `C` (CRC16) o NAK (checksum, per firmware antic), paquets `STX+n+~n+1024 B farcits CTRL-Z+CRC16 BE`, màx. 25 retransmissions per paquet, doble CAN del receptor → cancel·lat (respost amb ACK), EOT retransmès fins a 10 cops esperant ACK. Mode SOH/128 B disponible via `use1k: false`. Dades buides → directe a EOT (com la sonda).
- **Comandes d'escriptura a la sessió** (`session.ts`): `sendComplete(blob, {name?, comments?, now?})` i `sendProject(zip, ...)` comparteixen un helper `sendFile` que replica `mode_puja`/`mode_pujaproy` de la sonda:
  1. Pre-comandes `0:SPONS=0`, `1:SPONS=0`, `0:COMMS=0`, `1:COMMS=0`, `0:DEBUG=0`, `1:DEBUG=0` (PROTOCOL.md §10.1), cadascuna esperant ` - OK`/`ERR` (5 s).
  2. `SENDCMPLT,<nom>,<dd/MM/yyyy HH:mm:ss>,<comentaris>,<zipLen>` — **zipLen = només la llargada del ZIP** (§10.2), no del blob sencer; `nom`/`comentaris` sanejats (comes/CRLF eliminats, truncats a 63/255 — el MAPS els UrlEncoda, equivalent per als valors ASCII que genera l'app).
  3. Espera `CMPLTFILE:READY` (20 s, §10.3); `ERR`/`INVALID` → error `transfer`.
  4. XMODEM-1K amb el transmissor nou; progrés via l'event SSE existent (`progress`).
  5. Validació del dispositiu fins a 60 s: línies `CMPLTFILE:RX:...`/`SAVING` al log, èxit amb `CMPLTFILE:OK` (o `CONFIGFILE:OK`, com la sonda), `ERR`/`INVALID` → error.
  - `SENDPROJ` queda implementat (`PROJFILE:READY/OK`) però **no** s'usa per al deploy: el firmware no recompila des del ZIP (experiment §10).
  - El blob es valida (`parseCompleteBlob`) abans de tocar el cable (`invalid-blob`). Cap secret als logs: només línies de traça i línies de progrés generades pel gateway.
- **Fake gateway amb mode rep-un-projecte** (`testing/fake-gateway.ts`): `sendScript` amb `refuseCommand` (SEND → `<PREFIX>:ERR`), `nakPacketOnce` (NAK un cop al paquet N → força retransmissió), `canAtPacket` (CAN CAN al paquet N), `rejectAfterTransfer` (`CMPLTFILE:ERR` després d'una transferència completa). El costat receptor usa el `XmodemReceiver` real; introspecció via `getSendCommands()`/`getReceivedUploads()`.
- **Servei de deploy** (`src/server/deploy/`, nou):
  - `capabilities.ts`: llegeix `.local-data/capabilities.json` (fitxer que **només escriu** `scripts/verify-xbl.ts`) i valida que l'entrada `meMbsXblVerified` és genuïna (ISO `verifiedAt`, SHA-256 de 64 hex projecte == referència, `xblLength` > 0). Mai es confia en cap flag del client.
  - `service.ts`: `getDeployStatus(projectId, sessionId)` (sense efectes, alimenta la UI) i `deployProject(projectId, sessionId)` amb les tres gates en ordre — `family` (només me-mbs; 422), `capability` (artefacte genuïn; 403), `session-appid` (sessió connectada i `INFO:APPID` = 64, AppId de la unitat ME; 409) — amb `DeployGateError` tipat per gate. Superades les gates: **regenera l'XBL** amb `generateMeMbsXbl(xml, { appId })` (mai reutilitza l'XBL original — els edits de l'usuari han d'entrar en vigor), reutilitzant la `swVersion` de la capçalera del blob original quan existeix (mateixa convenció que verify-xbl) i `DEFAULT_SW_VERSION` (1.2.31.0, la de la fixture verificada) altrament; reconstrueix el blob `[len][XBL][CRC32][ZIP]` i crida `manager.sendComplete`. Retorna resum (bytes, xbl/zip, appId, swVersion).
- **Manager/API**: `GatewaySessions.sendComplete(id, blob, options)` (exclusiu via `runExclusive`); rutes noves `POST /api/gateway/sessions/[id]/deploy` (body `{ projectId }` → gates + deploy) i `GET .../deploy?projectId=` (estat de les gates per a la UI). No hi ha cap altre endpoint d'escriptura.
- **Pantalla Deploy** (`deploy-screen.tsx`): per a me-mbs, targeta amb l'estat de cada gate ( servidor), botó "Deploy to gateway" habilitat **només** si totes passen i hi ha sessió connectada; pas de confirmació explícit ("This writes configuration to the gateway at <ip>", Confirm/Cancel), barra de progrés via SSE, resum del resultat i consell de fer Receive després per verificar. Per a knx-mmb es conserva intacta l'explicació de bloqueig (`knxMbmXblVerified`). Client: `getDeployStatus`/`deployGatewayProject` a `lib/gateway-api.ts` (miralls purs dels tipus del servidor).
- **Tests nous (30)**: 10 al transmissor XMODEM (round-trip sender→receiver, NAK→retransmissió idèntica, CAN CAN→cancel·lat, límits de retransmissions/EOT/sincronisme, mode checksum, mode SOH) + 9 a la sessió contra el fake gateway (happy path SENDCMPLT amb args sanejats i zipLen correcte, SENDPROJ, blob malformat rebutjat abans del cable, NAK retry, CAN, `CMPLTFILE:ERR`, comanda refusada, sessió en clar) + 8 al servei de deploy (happy path amb XBL regenerat — comparat amb timestamp maskat —, reús de la swVersion del blob original, cada gate bloquejant: família 422, capability 403 incloent entrades falsificades, appId 409, sessió desconeguda) + 6 a la pantalla (knx-mbm bloquejat, me-mbs sense sessió, gates OK → confirmació → cancel·lar, gate fallida, confirm → POST → resum amb consell de Receive). Total: **298 tests verds (34 fitxers)**, `typecheck` i `lint` verds.
- **Pendent (prova en viu, fora d'aquest pas)**: deploy real contra la 770 Air (192.168.2.130) amb autorització de l'usuari: connectar → pantalla Deploy → confirmar → verificar amb Receive que el gateway executa la nova configuració. Risc conegut: la capçalera XBL porta el timestamp de generació actual (camp volàtil documentat); la `swVersion` surt del blob original quan el projecte es va rebre del gateway.
