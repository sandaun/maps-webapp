# Diagnostics: trànsit, visor i captura

## Fonts contrastades amb MAPS

Codi descompilat a `temp/maps-cloud/maps-poc/decompiled/` (fora de Git):

- `IntesisComm/IntesisComm/V6CommObject.cs`, `MonitorKeepAlive`: avís cada 80 s.
- `IntesisMAPS/IntesisBoxMAPS/frmMain.cs`, `SendSponsStatus`:
  renova `SPONS=1` amb el prefix de cada port, inclòs el tercer quan existeix.
- `IntesisMAPS/IntesisBoxMAPS.Forms.Controls/DiagnosticListBox.cs`: finestra
  de 10.000 elements i preservació de `TopIndex` quan es llegeix l'històric.
- `IntesisMAPS/IntesisBoxMAPS/frmDiagnosticExternal.cs`: cua de recepció
  separada del pintat, actualitzacions per lots amb `BeginUpdate`/`EndUpdate`.
- `IntesisMAPS/IntesisBoxMAPS/IntesisCommLog.cs`: escriptura en segon pla
  i rotació dels fitxers a 20 MB.

## Comportament de la web

El keepalive envia `SPONS` cada 80 s als ports de la família. Quan el monitor
està desactivat envia `SPONS=0`, per mantenir l'estat demanat per l'usuari.
Respecta el bloqueig de consola i transferències XMODEM: si estan ocupades,
espera el següent interval. Els toggles comproven l'ACK del protocol.

El lector cedeix el torn cada 256 línies. TCP i USB apliquen pausa de lectura
a partir d'1 MiB pendent i reprenen per sota de 512 KiB. Els errors de transport
es conserven al log i la desconnexió actualitza l'estat del monitor.

La captura escriu directament al servidor, independentment de l'SSE i React.
L'SSE agrupa esdeveniments cada 100 ms i té una cua limitada. Un navegador lent
pot perdre línies de la previsualització: mostra un comptador explícit i pot
descarregar la captura. Desconnectar un consumidor SSE no tanca la passarel·la.

El navegador conserva una finestra de 10.000 línies amb buffers circulars.
TanStack Virtual munta només les files visibles i un petit marge. La resolució
de senyals és incremental; els últims valors es mantenen encara que la línia
surti de la finestra. La nova línia rep un ressaltat breu de fons, sense animar
l'alçada o la posició; es respecta `prefers-reduced-motion`.
El càlcul del ritme utilitza comptadors per segon, amb granularitat d'1 s,
independents del límit de files; mesura les línies rebudes pel visor, no comandes
Modbus úniques (TX i RX poden correspondre a una mateixa consulta).

AutoScroll segueix la seqüència de l'última línia, encara que el nombre de files
ja no creixi. Desactivar-lo, posar Pause o desplaçar-se manualment congela la
finestra de lectura. El comptador de noves entrades utilitza seqüències;
`Jump to latest` recupera la finestra actual i torna al final. `Load older`
consulta pàgines de 1.000 línies al disc i manté una finestra limitada.

## Fitxers i gravació

Obrir Diagnostics inicia la captura del trànsit rebut i dels esdeveniments de
sessió. Sortir de la pantalla atura el monitor, llevat que s'hagi activat
`Record in background`. `Stop background recording` restaura aquest comportament;
mentre la pantalla continuï oberta, el monitor i la captura continuen actius.
`Clear` buida només el visor. No elimina la captura.

Els fitxers són a `${MAPS_DATA_DIR}/diagnostics/<session-uuid>/`, o a
`.local-data/diagnostics/<session-uuid>/` si no s'ha definit `MAPS_DATA_DIR`:

- `traffic-00000.jsonl`, etc.: entrades ordenades `{seq, at, line}`, rotació a
  20 MiB; un lot excepcionalment gran pot superar aquesta mida.
- `index.json`: metadades i índexs de blocs, publicats amb rename atòmic.
- `Download log`: exportació de text per streaming, fins al checkpoint del
  moment de començar la descàrrega; `Saved logs` permet recuperar captures
  després de desconnectar o reiniciar el servidor.

El buffer d'escriptura té un màxim de 8 MiB. Si el disc falla o no segueix el
ritme, la captura marca l'error i les línies perdudes; no afirma estar completa.
Els logs no s'esborren automàticament. La rotació limita cada part, no l'espai
total: cal gestionar la retenció del directori al servidor. El servidor ha de
continuar executant-se per gravar en segon pla. Un tancament abrupte pot perdre
el lot pendent, habitualment dels últims 200 ms.

## Validació i límits

Tests: 30.000 línies xifrades amb ordre intacte i captura independent d'un visor
que falla; exportació completa, rotació i paginació; SSE lent, cancel·lació i
replay; finestra de 10.000 línies amb menys de 100 files DOM; congelació de
lectura i retorn al final després de canviar AutoScroll; keepalive i exclusió
amb operacions de consola; propagació d'errors de transport.

QA al navegador amb una passarel·la TCP simulada i xifrada, a 1.500 línies/s:
1.230.300 línies de trànsit capturades durant prop de 15 minuts, sense salts,
zero línies perdudes, vuit fitxers rotats i unes 28 files
DOM amb la finestra plena; AutoScroll desactivat i reactivat i lectura per
teclat. Descàrrega verificada de 587.861 entrades, amb zero salts entre les
587.850 línies de trànsit simulat i la resta d'esdeveniments de sessió.

El volum RTU observat depèn del polling de la configuració: lectures individuals
de molts senyals i `DEBUG=1` poden augmentar les línies. Aquest canvi no altera
la configuració desplegada ni agrupa registres sense validar els dispositius.
Les proves simulades no demostren que s'hagi resolt la desconnexió del hardware
observada per l'usuari: cal repetir aquella càrrega amb la passarel·la física i
consultar el nou motiu de tancament i la captura.
