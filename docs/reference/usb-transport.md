# Connexió USB i discovery des de WSL

## Implementació (2026-10-03)

- `src/server/intesis-transport/serial.ts`: transport sèrie natiu (`serialport`)
  darrere de `Duplex`, 115200 8N1, DTR i RTS actius; bytes crus en ambdós sentits.
- `GatewaySession` en mode `usb`: envia CRLF i `INFO?`, omet LOGIN0/1/2 i
  xifrat. Reutilitza RECVCMPLT, SENDCMPLT, consola i monitor. El deploy conserva
  les comprovacions de família, plataforma i capability existents.
- `GET /api/gateway/serial-ports`: enumera ports del servidor sense obrir-los
  ni enviar comandes a dispositius desconeguts. Enumerar no identifica una
  passarel·la: es consulta INFO només al port escollit per l'usuari.
- `POST /api/gateway/sessions` accepta `{ transport: "usb", path: "COM3" }`
  (o un path Linux/macOS). Els clients IP existents segueixen funcionant.
- Connection → USB port: selecció amb el component Select compartit, refresh,
  errors i connexió sense contrasenya. Les instruccions de WSL són documentació
  de desenvolupament, no un avís dins del modal. El port USB host per a
  pendrives no és el port device/console.
- Connection → Direct IP (optional): envia INFO? unicast a una IP coneguda a
  més del broadcast. Valida els quatre octets abans de consultar-la.

## Fonts contrastades

Referències locals de només lectura:

- `temp/maps-cloud/maps-poc/decompiled/IntesisComm/IntesisComm/V6CommObject.cs`,
  `ConnectSerialPort` (~574–634): SerialPort a 115200 8N1, RTS/DTR actius,
  CRLF i INFO?, sense login TCP. Transferències USB seleccionen XModem amb
  `serialListener` (~2037, ~2423).
- `temp/maps-cloud/PROTOCOL.md`, §6: canal USB sense login ni xifrat i XMODEM.
- `docs/plans/knx-mbm-mvp.md`, pas 2.1: broadcast no arriba a la LAN des de
  WSL2 NAT; INFO? unicast provat en viu prèviament.
- [Node SerialPort](https://serialport.io/docs/guide-usage/): API nativa per
  enumeració, obertura i flux sèrie.
- [Microsoft: connectar dispositius USB a WSL](https://learn.microsoft.com/en-us/windows/wsl/connect-usb):
  ús de usbipd-win per exposar el dispositiu al Linux convidat.

## Límits de l'entorn

La interfície del servidor WSL actual és `172.31.56.34/20`, broadcast
`172.31.63.255`; la LAN de les proves anteriors és `192.168.2.x`. Obrir la UI
des de Windows no canvia l'origen dels sockets: el scan s'executa al servidor.
No és un sweep d'IPs; és discovery Intesis amb UDP/23.

Per USB, un servidor WSL només enumera dispositius visibles a Linux. Els COM
de Windows no es comparteixen automàticament: cal executar el servidor a
Windows o adjuntar el dispositiu a WSL. Un futur Connector natiu podrà portar
discovery LAN i ports locals a un servidor remot.

En Linux, l'usuari del servidor necessita permís d'accés al port. A Ubuntu,
`/dev/ttyUSB0` pertany a `root:dialout`: afegir l'usuari a `dialout` i reiniciar
el procés del servidor des d'una sessió nova perquè hereti el grup. No cal
executar MAPS Web com a root ni donar permisos d'escriptura a tothom.

El singleton de sessions té una versió de contracte: una recompilació amb un
gestor incompatible allibera les sessions anteriors i crea el nou gestor.
Això evita conservar el gestor antic que interpretava un path USB com un
host TCP. Les recompilacions amb el mateix contracte conserven les sessions.

## Pas a servidor remot

El transport actual és local al procés Node: desplegar-lo al cloud no permet
veure els ports USB del PC de l'usuari. Segons
`docs/plans/cloud-connector-architecture.md`, el Connector natiu al PC
enumerarà els ports i executarà les sessions TCP/USB; Connector i navegador
es connectaran al relay del servidor per WSS. La web mostrarà ports del
Connector seleccionat i un estat de disponibilitat d'aquest Connector.
L'adaptador SerialDuplex i el protocol de sessió es poden reutilitzar allí.
Aquest Connector i el relay no estan implementats en aquest canvi. WSL és un
detall del desplegament de desenvolupament, no un estat funcional del producte.

## Verificació

Tests offline cobreixen el bypass de login, INFO?, receive i send binari,
consola, activació/desactivació del monitor, factory sèrie separada de TCP,
neteja de sessió fallida, enumeració sense probes, bytes binaris, timeout de
lectura, port ocupat, error RTS, obertura tardana i desconnexió física simulada.
Tests UI cobreixen selecció de port amb el dropdown compartit, POST USB sense
password, ports buits, absència d'avisos de desenvolupament i scan
unicast. Tests del singleton cobreixen la substitució del gestor antic i la
conservació del gestor compatible després d'una recompilació.

**Prova real (2026-10-03):** passarel·la IN-KNX-MBM, sèrie `000R45700`,
connectada des de l'API de MAPS Web a `/dev/ttyUSB0` amb usbipd-win/WSL.
Connexió USB correcta, INFO? inicial i posterior amb estat RUNNING, AppId 4,
plataforma 700 Series i IP `192.168.2.167`. Desconnexió i reobertura del port
correctes; sessions de prova tancades en acabar. Aquesta prova no inclou
transferència real de projecte ni escriptura de configuració al dispositiu.
