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
