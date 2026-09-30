# Templates de dispositius Modbus per a KNX i BACnet

Recerca: 2026-09-30. Referència visual: `temp/MAPS Web v16.html`.
Estat: investigat; importació i biblioteca encara sense implementar.

## Abast

«Add from template» afegeix un **dispositiu Modbus server** a un node RTU o
TCP d'un projecte existent, amb els registres i la correspondència amb
objectes KNX o BACnet. No és el flux de crear un projecte des d'una plantilla
de gateway.

El desktop té aquest flux a KNX–MBM i BACnet–MBM, tant legacy com RT.
També l'utilitzen les variants MBM NIBE, ATW i DAIKIN i les famílies MEB que
incorporen MBM. Hi ha una funcionalitat anàloga per a **M-Bus** (KNX,
BACnet i Modbus Slave), amb parser propi; no forma part d'aquest abast.
No s'ha trobat aquest flux de templates de dispositiu Modbus a ME–MBS ni
MBS–KNX.

Fonts: `frmExternalMBM.cs:1501-1599`, `frmExternalMbus.cs:611-638`,
`TemplateServer.cs:126-148`, dins
`temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`.

La webapp actual només registra `knx-mbm`, `me-mbs` i `mbs-knx`
(`src/server/projects/families.ts`). **BACnet–MBM encara no té família,
model, parser, pantalles ni generador XBL propis a la webapp.** Un motor
compartit de templates pot preparar aquesta destinació, però habilitar-la
requereix el suport de família. El BACnet de l'exemple v16 és BACnet–KNX,
no BACnet–MBM.

## Flux real de MAPS

1. Es tria un node RTU/TCP existent. El desktop comprova el límit de devices.
2. Browse obre un fitxer local; Download obre `frmTemplateExplorer`.
3. Es desxifra, valida i interpreta el template, amb preview dels dos costats.
4. Nom del device editable; comprovació de duplicats entre els devices del
   node. El desktop assigna el primer slave lliure des d'1 en aquest node.
5. La columna d'actiu es pot editar. **Import disabled objects** vol dir
   incloure també les files desactivades, preservant-ne l'estat. Si està
   desmarcat només s'importen les actives. No vol dir apagar totes les files.
6. Es crea el device habilitat i un parell de senyals virtuals/fixos d'error
   de comunicació, un a cada protocol. A KNX: DPT 1.001; a BACnet: BI.
7. Es fusionen conversions per contingut, reutilitzant les existents i
   reassignant referències a totes dues meitats. A BACnet es fa també amb
   taules binàries, multistat i MAP.
8. S'afegeixen els parells de senyals escollits, renumerant-ne índexs i
   assignant el port global i el device del node de destinació. Les files
   normals entren no fixes i no virtuals.
9. Es refresquen taula i estat de canvis del projecte.

Fonts: `frmMbmTemplates.cs:129-211,409-443`,
`Projects/IntesisProjectKnxMbm_RT.cs:1325-1400`,
`Projects/IntesisProjectBacnetMbm_RT.cs:2034-2190`.

**GA KNX:** en una importació KNX→KNX el desktop copia `SendingAddress`
del template; no inventa la seqüència `4/n/1` del prototip. L'AddTemplate
de KNX també passa listening buit en crear els objectes: no s'ha de confondre
preservar el contingut del template amb reproduir cegament aquesta pèrdua.
Cal concretar el comportament web; el parser ja modela listening.
Després es pot fer servir l'eina de numeració existent, explícitament.

## Fitxers i interoperabilitat

Extensions principals: `.knxmbm` i `.bacmbm`; Browse també contempla
`.knxmbr` al filtre KNX. La compatibilitat efectiva s'ha de decidir pel
payload i la família, no només per l'extensió.

Contenidor verificat: AES-128-CBC + PKCS7 amb les constants del desktop,
que conté GZip d'UTF-8 XML seguit d'HMAC. El lector actual de MAPS admet
SHA256 (32 bytes) i SHA1 legacy (20 bytes); l'exportador actual escriu SHA256.
Les constants han de quedar al servidor, no al model client.

Payload: `<Template Version MAPSVersion Author>` amb `InternalProtocol`,
`ExternalProtocol/Device`, `ExternalProtocol/Signals` i `Conversions`.
A BACnet hi pot haver `MultiStateTextTables`, `BinaryStateTextTables` i
`MAPConfiguration`. Alguns templates antics tenen `ProtocolType="Modbus
Server"` tot i ser templates de MBM; rebutjar aquest literal trencaria
fitxers oficials. `BaseRegister` i Manufacturer poden faltar: MAPS aplica
defaults i pot completar el fabricant amb el catàleg.

**Intercanvi de destinació BMS:** MAPS generalista admet templates BACnet
dins de KNX–MBM i KNX dins de BACnet–MBM. Manté la taula Modbus però genera
objectes per defecte del BMS de destinació i avisa de la conversió. No és
una còpia exacta del mapeig BMS original. Les variants restringides 29/30/31
no admeten aquesta adaptació. Fonts: `ModbusTemplate.cs:852-932`,
`InternalKnx.CreateDefaultKNXObjects`, `InternalBacNet.CreateDefaultBACnetObjects`.

## Download: biblioteca HMS real

Verificat per HTTP el 2026-09-30, sense autenticació:

- `https://api-tools.intesis.com/v1/manufacturers`: 62 fabricants.
- `/templates?filters[internalProtocol]=knx&filters[externalProtocol]=modbus-mbm`:
  **112 templates** (100 + 12).
- Mateix filtre amb `internalProtocol=bacnet`: **95 templates**.
- Cada entrada aporta id, fabricant, model/version del model, versió del
  template, protocols, autor i URL `file` per baixar el binari.
- `Load` baixa el fitxer per preparar el preview; encara no modifica el
  projecte. `Export` a la biblioteca baixa el fitxer oficial a l'usuari.
- Exportar un device configurat com a template propi és una altra acció
  (`b_devExportTemplate`, `ModbusTemplate.GenerateTemplate`): selecciona
  senyals d'aquell device, exclou virtuals i inclou només les conversions
  i, a BACnet, taules utilitzades, amb índexs locals renumerats.

**Paginació:** l'API observada retorna `pagination.total=100` a la primera
pàgina KNX i `12` a la segona; no representa el total global. El criteri
`nextOffset < total` de `IntesisAPI.HasMorePages` atura la descàrrega als
primers 100. El connector web haurà de seguir fins a una pàgina incompleta
o buida, amb deduplicació per id i límit de pàgines.

Proposta: connector de servidor amb filtres de protocols, paginació,
cache limitada, validació d'URL de descàrrega, límit de mida i errors
recuperables. Tant fitxer local com fitxer de biblioteca passen pel mateix
lector/preview. La indisponibilitat de la biblioteca no impedeix Browse.
No és necessari deixar el catàleg com un futur indeterminat.

## Mostres reals verificades

A la fase de recerca es van descarregar, desxifrar i comprovar els HMAC.
La validació posterior de la implementació els aplica a projectes de prova
aïllats; no s'ha desplegat cap configuració a un equip.

| Template | Costat BMS | Files | Actives | Conversions | Particularitats |
|---|---|---:|---:|---:|---|
| DAIKIN EKMBDXA / INTERFACE DIII | KNX | 4417 | 2881 | 2 | Header MAPS 1.0.31.1; literal Modbus Server; sense BaseRegister |
| Belimo EPIV 6way | KNX | 60 | 37 | 3 | Header MAPS 1.2.31.0; timeout 100; GA existents |
| ABB ACH 550 DCU | BACnet | 609 | 138 | 3 | Manufacturer buit, SlaveNum 0; literal Modbus Server |
| Haier SUPER CLIMA B | BACnet | 117 | 107 | 2 | 1 taula multistat, 4 binàries i 1 MAP |

Les quatre mostres utilitzen **HMAC-SHA1**, inclosa una recent. Aquest
suport és necessari des del primer increment.
Fitxers i catàlegs: `.local-data/fixtures/modbus-templates-research/`, fora
de Git. Script exploratori: `temp/inspect-modbus-templates.py`.

## V16: què conservar i què corregir

Revisió del codi del prototip i visual al navegador: Modbus devices → Add
from template → Download from library → carregar ABB B23/B24 → preview.

Conservar: modal, metadades, preview amb dos costats, toggles de files,
incloure desactivats, nom, slave, connexió i recompte; biblioteca amb filtre
de fabricant/model, selecció, Load i Export.

Corregir o completar abans d'implementar:

- L'input accepta XML/JSON/XLSX/CSV; ha d'acceptar formats MAPS de template.
  `onFile` només dedueix un exemple pel nom: no llegeix el contingut.
- Catàleg de 21 exemples, Load i Export simulats; cal l'API real.
- El modal i el preview només estan dissenyats per KNX. Cal variant BACnet
  (tipus, nom, instància/unitats/estats rellevants), quan existeixi la família.
- Registres/adreces, longitud, format, byte order, bits, conversions i
  deadband han de venir del fitxer. El prototip força Unsigned/16 i amaga
  l'adreça del registre en el preview.
- Ports/nodes han de ser els del projecte, no dues entrades TCP inventades.
- Slave 1–247 al prototip no coincideix amb els rangs actuals de MAPS Web:
  RTU 1–254 i TCP 0–255; la disponibilitat és per node concret.
- El prototip no comprova nom duplicat i identifica la col·lisió TCP per
  tipus de connexió, sense distingir nodes. Falta aplicar límits de projecte.
- GA `4/n/1` inventades: conservar o oferir numeració explícita.
- El recompte final ha d'explicar el senyal virtual d'error que s'afegeix.
- Cal mostrar càrrega, error de fitxer/API, incompatibilitat, adaptació BMS,
  falta de capacitat i conflicte de revisió; no són operacions en viu.

## Integració amb la webapp

La infraestructura reutilitzable ja inclou model MBM de nodes/devices,
KNX endpoints, parser XML que preserva desconeguts, biblioteca de
conversions i referències per meitat, taula de senyals, exports i projecte
amb bloqueig, revisió i historial. `addDevice` actual només afegeix el
device: no és equivalent a `AddTemplate` de MAPS.

Calen lector de contenidor/payload, DTO de preview, connector de biblioteca
i operació **applyDeviceTemplate** que afegeixi device, comunicació d'error,
parells de senyals i conversions en un sol canvi de projecte. La revisió
usada pel preview s'ha de comprovar en aplicar; un error no ha de deixar
cap part importada. Historial i desfer han de tractar-ho com una acció.

Una sola implementació d'UI/servidor ha d'alimentar dispositius, senyals,
conversions, overview, validacions, historial, export `.ibmaps`/XLSX i XBL.
No s'ha d'escriure el projecte complet des del DTO: cal preservar l'XML
existent i transformar només el contingut afegit.

Limitació prèvia de KNX–MBM: el deadband per senyal es modela però el tag 15
RT encara no es compila a XBL. Importar-lo no resol aquest gap; cal advertir
o delimitar aquest suport abans de presentar la característica com completa.

Validació pendent abans d'afirmar compatibilitat final: aplicar mostres a
RTU/TCP amb MAPS, comparar `.ibmaps` i XBL, reimportar/exportar template,
conversions repetides/reassignades, files apagades, error virtual, noms
duplicats, nodes diferents, límits, historial i revisió concurrent. La
recerca del contenidor no substitueix aquests contrastos amb MAPS.

## Implementació KNX–MBM — 2026-09-30

Treball en una branca `codex/modbus-device-templates` derivada de `staging`,
en un worktree separat del checkout en ús. El PR inclou fitxer local,
biblioteca real, preview, aplicació, desfer i export per dispositiu.

- Lector de servidor: AES-128-CBC, GZip i HMAC-SHA256/SHA1; màxim 8 MB de
  fitxer i 16 MB d'XML, profunditat limitada, sense entitats externes.
  Valida estructura, parells de files, valors numèrics, protocols i referències.
  Manté els valors originals, inclosos errors semàntics de mostres oficials,
  amb avís i posterior validació del projecte. Normalitza decimals locals del
  deadband a text invariant per al lector del projecte.
- El preview retornat al navegador conté només el model de mapping i un token.
  L'XML es manté al servidor en una cache de 16 previews, de 30 minuts.
  El token està vinculat al projecte i revisió; s'ha de recarregar si canvien.
- `applyDeviceTemplate` és un patch únic sota el bloqueig de projecte: afegeix
  un device, comunicació d'error i les files seleccionades/desactivades.
  Compten el senyal d'error, 3.000 actius, 5.000 totals i 254 devices.
  Les referències de conversions es basen en posicions per llista; els Id
  repetits dels templates oficials no alteren les referències existents.
- Conserva GA d'enviament i escolta de templates KNX, sense numeració
  automàtica. En un bacmbm, infereix DPT/flags KNX segons els casos del desktop;
  no trasllada mappings ni taules BACnet a KNX. El preview ho explica.
- El connector consulta `/v1/templates/` amb protocols KNX/Modbus MBM.
  Continua fins a una pàgina incompleta, deduplica ids i detecta pàgines
  repetides; cache cinc minuts. Accepta redireccions només dins l'API oficial.
  Els fabricants del filtre són els que tenen templates compatibles.
- Export d'un device: exclou virtuals de qualsevol costat, renumera files,
  port/device i conversions, i xifra amb HMAC-SHA256. La descàrrega de biblioteca
  retorna el binari oficial sense transformar-lo.
- Desfer restaura l'XML exacte anterior amb una revisió nova, només si no hi
  ha hagut altres canvis des de la importació. Historial disponible també
  quan caduca el token o es reinicia el servidor.

Proves automatitzades: contenidors actuals/legacy i fitxers alterats; valors
reals; adaptació BACnet; deduplicació/inversió de conversions; RTU/TCP i índexs;
files desactivades; error virtual; límits amb el senyal extra; nodes/seleccions
incorrectes; noms/slaves repetits; revisió concurrent, token d'un altre projecte,
caducitat, persistència/historial i desfer; XML desconegut; pàgines 100+12,
redireccions i errors API; selecció/aplicació/download des de la UI.
Una prova XBL comprova el slave, adreça 17, 32 bits i byte order 2 del registre
importat. Les quatre mostres locals s'apliquen i es tornen a exportar/llegir.

Contrast HTTP i navegador: catàleg complet de 112 entrades; carregar Belimo
EPIV, aplicar 37 objectes actius més comunicació d'error, exportar/recarregar
37 objectes sense virtuals i desfer. La descàrrega HTTP oficial coincideix byte
per byte amb la mostra prèvia. No s'ha contrastat amb una execució del desktop
ni amb desplegament a un equip.

Límits de suport: el gap de deadband per senyal a XBL continua advertit al
preview. Les conversions LUT referenciades es rebutgen en import/export perquè
el format de template del desktop no inclou les dades de lookup necessàries;
no es poden vincular cegament a les LUT d'un altre projecte. La família
BACnet–MBM i l'aplicació de les seves taules d'estats/MAP queden per al seu port.
