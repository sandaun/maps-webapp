# Consola de diagnòstic ASCII de les passarel·les Intesis (700 Series)

Document de referència **durable**: catàleg de comandes de la consola de diagnòstic
(la `frmDiagnosticConsole` del MAPS d'escriptori), extret del codi descompilat i
**validat en viu** contra una KNX–MBM real (COREVERSION 2.0.57.0, SDK 25.6.0.2).

- Font estàtica: `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/...` (file:line al
  quadern de laboratori, vegeu avall).
- Validació en viu: 2026-09-01 (RO) i 2026-09-02 (RW), gateway `192.168.2.167`,
  amb les sondes `temp/maps-cloud/prova_consola.py` i `prova_consola_rw.py`.
- Quadern de laboratori complet (experiments, logs, evidència file:line):
  `temp/maps-cloud/PROTOCOL.md` §13 — **fora de Git** (`temp/` està gitignorat).

## Model general

La consola és un canal ASCII sobre TCP port 23 (després del login DH+XXTEA) o USB
(en clar, sense login). El client envia **text lliure**; el firmware respon línies
acabades en CRLF. Convencions:

- **ACKs**: `SKTn - OK` (ACK de sessió genèric), `<prefix>:OK` per a comandes de
  protocol, `OK` nu per a algunes comandes de primer nivell (`DATETIME=`, `RESET!`).
- **Errors**: `PWD:ERR`, `<prefix>:Unknown signal`, o **silenci** — el firmware
  ignora en silenci les comandes desconegudes (provat: `HELP?`, `HELP`, `?`,
  `COMMANDS?` no reben resposta; **no hi ha verb d'ajuda**).
- **Blocs multilínia**: tanquen amb un terminador `<VERB>:END`.

## 1. Comandes de primer nivell (sense prefix)

| Comanda | Funció | Resposta | Efectes | Validada |
|---|---|---|---|---|
| `INFO?` | Info del dispositiu (també discovery per UDP :23 i keepalive) | bloc `INFO:KEY:VALUE` … `INFO:END` | RO | ✅ |
| `APPINFO?` | Info de l'aplicació/projecte carregat | bloc … `APPINFO:END` | RO | ✅ |
| `BLINFO?` | Info del bootloader | bloc … `BLINFO:END` | RO | ✅ |
| `HARDINFO?` | Info de hardware (~80 línies, PCB/MAC/KNX/CRCs) | bloc … `HARDINFO:END` | RO | ✅ |
| `CFGERRORS?` | Errors de configuració | **silenci si no n'hi ha** (`INFO:CFGERRORS:0`) | RO | ✅ |
| `STARTUPLOGS?` | Bolca els logs d'arrencada | text lliure; tanca ` *** End of STARTUPLOGS ***` | RO | ✅ |
| `DIAGS?` | Diagnòstics runtime (XMEM, XFLASH, TIMEOUTS, SEMAPHORES, GPIOS, CPUTIME) | bloc … `DIAGS:END` | RO | ✅ |
| `KEY?` | Challenge per al mode admin | `KEY=<32 hex>` | RO | ✅ |
| `PWD=<pwd>` | Entra en mode admin | `PWD:OK` / `PWD:ERR` (**contrasenya admin ≠ login**) | escalat | ✅ |
| `PWDOFF` | Surt del mode admin | `PWDOFF:OK` | sessió | ✅ |
| `PWDKEEPALIVE` | Keepalive de sessió admin (~120 s) | — | sessió | codi |
| `DATETIME=dd/MM/yyyy HH:mm:ss` | Posa en hora el RTC | `OK` | **RW** | ✅ |
| `RSTCPUTIM` | Reset comptadors de temps de CPU | — | RW | codi |
| `HWTEST?` / `HWTEST:START` / `HWTEST:<code>:START` | Auto-tests de hardware (variant `KLTEST`) | línies `OK;...` / `ERR;...` | **RW (actua I/O)** | codi |
| `RESET!` | **Reinicia el gateway** | `OK`; torna en ~12 s, config intacta | **RW (reboot)** | ✅ |

Nota `RESET!`: el MAPS d'escriptori primer envia `SPONS=0`, `COMMS=0`, `DEBUG=0` als
dos costats, espera 400 ms i després envia `RESET!` (frmMain.cs:3427).

## 2. Comandes de protocol — sintaxi `<costat><PREFIX>:<cmd>`

- Costat: `0`=intern, `1`=extern, `2`=extra (segon visor extern / dual RTU+TCP).
- Prefix per família: KNX–MBM → intern `KX` (KNX), extern `MM` (Modbus Master).

| Comanda | Funció | Resposta | Efectes | Validada |
|---|---|---|---|---|
| `SPONS=<0\|1>` | Notificacions espontànies de valor | `<prefix>:OK`; després frames `<prefix>:<id>=<valor>` push | RW sessió | ✅ |
| `COMMS=<0\|1>` | Log de trames del bus a la consola | `<prefix>:OK`; després p. ex. `1MM:RTUB [Tx] 01 03 00 01 00 01 D5 CA` | RW sessió | ✅ |
| `DEBUG=<n>` | Verbositat de debug del protocol | `<prefix>:OK`; p. ex. `1MM:RTUB Timeout!` | RW sessió | ✅ |
| Lectura senyal | `<costat><PREFIX>:<idHex>?` | `<mateix id>=<valor>;<flags>`; `f`/buit = invàlid | RO | ✅ |
| Escriptura senyal | `<costat><PREFIX>:<idHex>=<valor>[;]` | `<prefix>:OK` o `<prefix>:Unknown signal` | **RW, escriu al bus** | ✅ |
| `1MM:CMD:RESETCONSUM` | Reset comptadors d'energia | `1MM:CMD:OK` | RW | codi |

Formats d'ID de senyal (KNX–MBM):

- **KNX GET**: `0KX:<objIdx1based:hex4><GA:hex4>?` — p. ex. objecte config ID 1 amb
  GA 0/0/3 → `0KX:00020003?` → resposta `0KX:00020003=0.00;0`.
- **KNX SET**: `0KX:<objIdx1based:hex4><GA:hex4>=<valorDecimal>` (sense `;` final).
- **MBM GET**: `1MM:<extId:hex8>?` — p. ex. `1MM:00000001?` → `1MM:00000001=0;0`.
- **MBM SET**: `1MM:<extId:hex8>=<valor>;` (amb `;` final).
- `extId` MBM: index entre objectes habilitats (0-based) per a objectes reals;
  `0xF800` = virtual pur; `0x8000 + (port<<11) + (device<<3)` per a virtuals de node
  RTU (`IntesisMb.ConstructMBMExternalID`).

## 3. Sessió i transferència de fitxers (resum)

- Login (només TCP :23): `LOGIN0=admin;<b64 g>;<b64 p>;<b64 g^a>` →
  `LOGIN1=<b64 g^b>` → `LOGIN2=<b64 XXTEA(...)>` → `SKTn - OK`; la sessió queda
  xifrada (XXTEA-CBC + XOR stream). USB: en clar, sense login.
- Transferències XMODEM/XMODEM-1K amb handshake `<VERB>:READY` … `:OK`/`:ERR`.
  Escriptura de flash: `SENDPROJ`, `SENDCMPLT`, `SENDCFG`, `SENDFW`, `SENDFILE:*`,
  `SENDCALIST`, `XBLCALIST`/`XBLCLICERT`/`XBLCLIPRIKEY`, `PRG`. Descàrrega (RO):
  `RECVPROJ`, `RECVCMPLT`, `RECVCFG`.

## 4. Comportaments observats que cal respectar a la implementació

- El firmware **ignora en silenci** comandes desconegudes: el client ha de treballar
  amb timeouts, no amb espera d'error.
- `CFGERRORS?` pot no respondre res si no hi ha errors: no tractar el silenci com a
  fallada de connexió.
- Les lectures de senyal retornen el valor en text decimal (`0.00;0`) amb sufix
  `;<flags>`; valor `f` o buit = senyal invàlid/255.
- Sense dades al bus (KNX desconnectat / esclau Modbus mut) totes les lectures
  retornen `0` — distingir "0 real" de "sense bus" via `COMMS=1`/`DEBUG=1`
  (timeouts visibles) o `INFO:`/`DIAGS:TIMEOUTS`.
- `RESET!` talla la connexió: el client ha de reconnectar i verificar
  `INFO:UPTIME`/`STATUS:RUNNING`.

## 5. Limitacions conegudes

- El firmware podria acceptar més verbs de primer nivell que el MAPS mai no envia
  (consola de text lliure); les sondes bàsiques no n'han descobert cap.
- Comandes específiques d'altres protocols externs (p. ex. `CMD:BUSSCAN`) no
  aplican a KNX–MBM i no estan cobertes aquí.
