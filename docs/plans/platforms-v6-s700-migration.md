# Plataformes KTS/V6, RT/S700 i RT_AIR: compatibilitat i conversió

Data de la investigació: 2026-09-29.
Estat (2026-09-30): Fases A i B implementades per a la sèrie 700 (§11). La
Fase C (conversió V6 → S700), l'editor i el deploy V6 queden fora d'abast i
pendents. No s'han executat conversions amb MAPS ni comparat parelles reals
del mateix projecte abans i després de l'actualització.

Relacionat: [gaps per família](gaps-families-v11.md),
[guia per afegir famílies](../reference/adding-a-gateway-family.md) i
[regeneració ME-MBS](../reference/me-mbs-regeneracio-senyals.md).

## 1. Resum i límits de l'evidència

MAPS distingeix la **família de protocols**, la **plataforma del projecte** i
la **compatibilitat amb el dispositiu**. No són conceptes intercanviables.
Dues classes de projecte poden compartir protocols i AppId però correspondre
a plataformes diferents. La comprovació d'AppId, tota sola, no és suficient.

La conversió legacy existeix al codi disponible. No és un convertidor únic
independent: MAPS reobre el fitxer seleccionant la classe de destinació, aplica
els seus lectors i ajustos de càrrega i el torna a desar. Portar-la al webapp
requereix reproduir aquestes transformacions, no només canviar `Platform`.

Llegenda utilitzada en aquest document:

- **Verificat al codi:** hi ha una implementació local que suporta l'afirmació.
- **Pendent de validació:** falta executar casos de referència o comprovar
  equivalència amb MAPS/gateway. Llegir el codi no demostra equivalència binària.
- **Proposta:** comportament recomanat per al webapp, encara no implementat
  com a part d'aquest treball.

Les fonts de MAPS enllaçades són còpies locals sota
`temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`. Poden no estar disponibles
en un clon net. Els símbols i regles es descriuen també en text per poder-los
localitzar en una altra còpia. Les línies corresponen a la còpia investigada.
Els documents de SharePoint aportats durant la discussió no s'han revalidat
en aquesta investigació; les conclusions següents es basen en codi local.

## 2. Identitat: què significa cada camp

L'enum [PlatformGw](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/PlatformGw.cs)
declara:

| Valor XML | Enum | Interpretació |
|---|---|---|
| `0` | `NONE` | Sense plataforma explícita; no és sinònim de RT |
| `1` | `KTS` | Projecte per a hardware legacy V6 |
| `2` | `RT` | Projecte RT, associat als productes S700 corresponents |
| `3` | `RT_AIR` | Variant RT_AIR, com el projecte ME-MBS de 770 Air |

KTS és el nom de plataforma al codi, no necessàriament una extensió de fitxer
diferent. El contenidor de projecte pot continuar sent `.ibmaps`.

[ProjectParser.GetProject](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/ProjectParser.cs#L911)
selecciona primer per plataforma i després per noms de protocol. En aquest
selector, `NONE` comparteix branca amb KTS i RT comparteix branca amb RT_AIR.
Això **no** fa equivalents RT i RT_AIR: la classe escollida declara la seva
plataforma final. Tampoc justifica acceptar un XML de plataforma desconeguda
com a RT al webapp.

Exemples verificats de classes que comparteixen AppId de projecte:

| Família | Classe legacy / destinació | AppId |
|---|---|---|
| KNX-MBM | `IntesisProjectKnxMbm` / `IntesisProjectKnxMbm_RT` | `IBOX_KNX_MBM` (4) |
| MBS-KNX | `IntesisProjectMBSKNX` / `IntesisProjectMBSKNX_RT` | `IBOX_MBS_KNX` (7) |
| BACnet-KNX | `IntesisProjectBacNetKnx` / `IntesisProjectBacNetKnx_RT` | `IBOX_BAC_KNX` |
| BACnet-MBM | `IntesisProjectBacnetMbm` / `IntesisProjectBacnetMbm_RT` | `IBOX_BAC_MBM` |
| ME-MBS | `IntesisProjectMbsMe` / `IntesisProjectMbsMe_RT` | `ME_AC_MBS` (8) |

En ME-MBS, la classe RT també declara `ME_AC_XXX` (64) a `ApplicationIDs`.
Cal distingir l'AppId de la classe de projecte del conjunt d'aplicacions de
gateway compatibles. No s'ha d'imposar universalment la regla d'un únic AppId
igual al del projecte.

## 3. Flux real d'actualització de MAPS

### 3.1 Disponibilitat i entrada

`IntesisProject.HasS700ProjectAvailable` retorna `false` per defecte. Les
classes legacy compatibles el sobreescriuen; les tres famílies actuals del
webapp tenen una classe legacy que el retorna a `true`.

La disponibilitat no és universal: per exemple,
[IntesisProjectBACnetMD.HasS700ProjectAvailable](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectBACnetMD.cs#L87)
exclou la variant `MideaDivergences.ACA`.

[ts_updateProject_Click](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/frmMain.cs#L11185)
valida el control actiu i consulta `CanConvertProjectDirectly()`. La
implementació base retorna `true`; BACnet-M-Bus i Modbus-M-Bus poden demanar
selecció addicional. També es pot proposar convertir en intentar connectar
un KTS a un gateway identificat com a `700 Series`, després de comprovacions
de compatibilitat. Vegeu
[ButtonConnect](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/frmMain.cs#L3870).

### 3.2 Còpia, càrrega i desament

[ConvertV6ProjectToS700](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/frmMain.cs#L11209):

1. Si hi ha ruta de projecte, pregunta si es vol crear una còpia. El missatge
   avisa que el procés no és reversible; la proposta de nom acaba en `_V6`.
   Es pot continuar sense còpia o cancel·lar.
2. Si no hi ha ruta, demana desar el projecte abans de continuar.
3. Desconnecta el gateway si hi ha una connexió activa.
4. Executa `OpenProject(saveProjectPath, PlatformGw.RT, extraInfo)`; `extraInfo`
   només es passa quan hi ha una selecció addicional.
5. Desa la configuració resultant i refresca la descoberta.

No és una conversió en memòria garantidament no destructiva: el flux treballa
amb la ruta del projecte i ofereix la còpia com a opció. **La proposta per al
webapp és conservar sempre l'original i generar un projecte nou.**

[ProjectParser.InitializeProject](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/ProjectParser.cs#L821)
prioritza la plataforma forçada per sobre de la del XML. Després carrega
capçaleres, dispositius i protocols. En el camí de protocol extern simple,
[InitializeProject_loadxmmlnodes_extprotocol](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/ProjectParser.cs#L670)
crida `ParseExternalProtocol` i `DoNecessaryChangesForUpgrade`.

La càrrega completa també passa per
[InitializeSignalsStructure](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/frmMain.cs#L5214):
pot cridar `NeedRecreateSignals` i `RecreateSignals` segons la versió. Per tant,
no n'hi ha prou amb portar el selector de classes i el parser XML.

Finalment,
[IntesisProject.SaveConfiguration](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProject.cs#L2241)
serialitza `Platform` des de la classe resultant i els protocols des dels seus
models. Per a ME-MBS el resultat és `RT_AIR` (3), malgrat que la crida genèrica
de conversió forci `RT` (2).

## 4. Transformacions per família

### 4.1 KNX-MBM: deadband global i per senyal

[IntesisProjectKnxMbm_RT](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectKnxMbm_RT.cs#L28)
crea `ExternalMbm` amb `isRT: true` i activa `DeadbandEnabled`. En aquest
context, aquest flag habilita el tractament **per senyal**, no el global.

[ExternalMbm.ParseProtocolXML](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB.External/ExternalMbm.cs#L666)
llegeix el global i els senyals, i després executa
`MigrateGlobalDeadbandToSignals`:

- No fa res si no està habilitat el mode per senyal o el global és zero.
- Copia el global només als objectes que no són fixos ni virtuals i tenen
  `DeadBand == 0`.
- Conserva els valors individuals que ja són diferents de zero.
- No filtra per activació del senyal en aquesta rutina.
- Posa el global a zero després de la migració.

Exemple de prova: global `2.5`; senyal ordinari amb zero passa a `2.5`, senyal
amb `1.25` es conserva, i un fix o virtual amb zero continua a zero.

Serialització verificada:

| Sortida | KTS / mode global | KNX-MBM RT / mode per senyal |
|---|---|---|
| XML del protocol | Escriu `Deadband` global | Omet el global en desar |
| XBL global | Tag 8 si el global no és zero | No emet aquest tag global |
| XBL del senyal | No activa el deadband individual | Tag 15 amb float de 4 bytes, little-endian, si no és zero |

Fonts:
[ExternalMbm.CreateExternalXBLNode](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB.External/ExternalMbm.cs#L450),
[ExternalMbm.GetXMLProtocol](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB.External/ExternalMbm.cs#L760)
i [MbmObject.GenerateXBLItem](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB/MbmObject.cs#L179).

La migració també pot aplicar-se en obrir un XML que ja declara RT però encara
conté un global no nul: depèn del lector i del seu flag, no exclusivament del
botó d'actualització V6. Cal separar aquesta normalització RT de l'autorització
per convertir un projecte KTS.

**No generalitzar a totes les famílies Modbus:** la cerca del flag en aquesta
còpia ha localitzat l'activació explícita a KNX-MBM RT. No s'ha demostrat la
mateixa política per a BACnet-MBM.

### 4.2 MBS-KNX: mateixos lectors, destinació diferent

La comparació de
[IntesisProjectMBSKNX](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectMBSKNX.cs)
amb
[IntesisProjectMBSKNX_RT](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectMBSKNX_RT.cs)
mostra els mateixos lectors `InternalMbs` i `ExternalKnx`. Les diferències
principals són la plataforma RT, `Serie700Allowed()` i els order codes
disponibles: del patró legacy `INMBSKNX...` als models `IN701KNX...`.

És el candidat aparentment més senzill per a una primera conversió. Això no
prova que el projecte complet només necessiti canviar `Platform`: encara s'han
de contrastar capçaleres, model/llicència, configuració comuna i resultat XBL.
La llista de models disponibles tampoc demostra per si sola com queda
seleccionat el model després de cada actualització.

### 4.3 ME-MBS: RT_AIR i regeneració de senyals

[IntesisProjectMbsMe_RT](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs#L224)
declara plataforma 3, AppId de projecte 8 i acceptació dels AppId 8 i 64.
Comparteix els lectors bàsics Modbus/ME amb legacy, però té comportaments
addicionals, incloent consum i protocols auxiliars.

[NeedRecreateSignals / RecreateSignals](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs#L3061)
regeneren si la versió és zero o anterior a la versió actual de MAPS:

1. Inicialitzen conversions i conserven les llistes antigues temporalment.
2. Reconstrueixen esclaus Modbus a partir de controladors i grups.
3. Reconstrueixen senyals amb `InitializeControllers()`.
4. Executen `RestoreUserConfig` sobre les coincidències.

La coincidència de `RestoreUserConfig` usa controlador, grup, unitat, indicador
de senyal interior, `SignalIndex` i `SignalSpecIndex`. Aquesta rutina copia
`IsEnabled` i, en mode CUSTOM, l'adreça. **No és una còpia indiscriminada de
totes les propietats antigues.** No se'n pot deduir tampoc, sense seguir els
altres mecanismes de preservació, que qualsevol altre camp es perdi sempre.

El webapp ja té treball de regeneració i preservació amb `HvacAddresses`:
cal reutilitzar i contrastar la
[implementació documentada](../reference/me-mbs-regeneracio-senyals.md), no
introduir un segon regenerador independent. Els casos RT ja verificats no
demostren automàticament la conversió de projectes legacy.

### 4.4 M-Bus: selecció de variant i canvis estructurals

[BACnet-M-Bus.CanConvertProjectDirectly](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectBacnetMbus.cs#L2796)
i
[Modbus-M-Bus.CanConvertProjectDirectly](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectMbsMbus.cs#L1642)
permeten conversió directa si hi ha connexió o, sense connexió, quan:

- el projecte és variant `_isLow`; o
- `CreationVersion >= 1.2.24.0`; o
- és anterior a aquesta creació però `HeaderVersion >= 1.2.27.0`.

En els altres casos el menú demana `frmMeteringUpgrade`. La selecció es passa
com a `extraInfo` al selector de destinació; pot determinar variants IP/TCP.
Aquestes són versions de projecte/eina, **no** versions mínimes de firmware.

Les rutines `DoNecessaryChangesForUpgrade` de
[BACnet-MEB RT](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects.Internal_BAC.RT/IntesisProjectBACnetMEB_RT.cs#L3082)
i
[MBS-MEB RT](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects.Internal_MBS.RT/IntesisProjectMbsMeb_RT.cs#L2978)
detecten l'absència de timestamp general i adapten les llistes:

- Assignen índex de protocol M-Bus als objectes existents.
- Afegeixen timestamp de gateway i, per dispositiu, timestamp i número de sèrie.
- Substitueixen l'objecte antic d'estat per diagnòstics d'aplicació, bateria,
  errors permanents/temporals i fabricant, amb operacions associades.
- Reordenen els índexs de configuració a les dues bandes.
- En variants multiprotocol, afegeixen objectes auxiliars quan falten.

Hi ha també una rutina específica KNX-MEB RT. No s'ha fet una comparació
exhaustiva de totes les variants M-Bus ni de totes les famílies que ofereixen
actualització. Aquests exemples demostren per què no podem prometre una
conversió universal basada només en protocols i plataforma.

## 5. Compatibilitat amb el gateway i firmware

MAPS diferencia les connexions segons plataforma i avalua altres factors
com aplicació, compatibilitat, llicència i firmware. Que un projecte s'hagi
convertit no garanteix que es pugui enviar a qualsevol producte S700.

KNX-MBM RT declara `MinFwVersionForPerSignalDeadband = 2.0.2.0`.
[CheckDeadbandFwCompatibility](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProject.cs#L2148)
compara `ConnectedDevice.AppVersion`; no inspecciona si hi ha valors no nuls.
Si no hi ha dispositiu o no pot parsejar la versió, aquesta rutina retorna
sense advertència.

En
[frmMain.CheckProject](../../temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/frmMain.cs#L7580),
MAPS mostra un avís; en enviar, **permet continuar amb confirmació**. No és un
bloqueig absolut. Una política més estricta del webapp seria una decisió
explícita, no una reproducció literal del desktop.

**Pendent:** determinar una font fiable de plataforma/capacitats del gateway
en les dades que rep el webapp. L'etiqueta de descoberta `700 Series` no
distingeix per si sola les classes de projecte RT i RT_AIR. Cal mapar identitat
de dispositiu i aplicació a plataformes compatibles, no comparar cegament un
text amb el número XML ni deduir la plataforma només d'AppId.

## 6. Gaps observats al webapp

Estat observat el 2026-09-29. Tots sis estan resolts des del 2026-09-30 (§11):

| Superfície | Observació | Conseqüència |
|---|---|---|
| [Detecció KNX-MBM](../../src/gateway-families/knx-mbm/detect.ts) | Reconeix protocols sense exigir plataforma | Un KTS pot entrar al camí de família RT |
| [Detecció MBS-KNX](../../src/gateway-families/mbs-knx/detect.ts) | Exigeix plataforma 2 | Ja exclou KTS en aquest detector |
| [Detecció ME-MBS](../../src/gateway-families/me-mbs/detect.ts) | Exigeix plataforma 3 | Ja restringeix la família a RT_AIR |
| [Servei de desplegament](../../src/server/deploy/service.ts) | `runGates` compara l'AppId esperat, no plataforma de projecte contra dispositiu | Mancança transversal a les tres famílies |
| [Fixture KNX-MBM](../../src/gateway-families/knx-mbm/fixtures/synthetic-project.ts) | Declara plataforma 2 però inclou global legacy | No representa el desament canònic RT del lector investigat |
| [XBL Modbus KNX-MBM](../../src/gateway-families/knx-mbm/xbl/nodes-mbm.ts) | Emet el global com a tag 8 si no és zero | No reprodueix el tractament per senyal RT |

Un XML RT amb global no és necessàriament il·legible per MAPS: el seu lector
el normalitza. El problema és tractar-lo com a representació RT ja correcta
sense executar aquesta normalització ni generar els camps individuals.

La verificació byte a byte amb un projecte RT de deadband zero continua sent
vàlida per a aquell cas. No cobreix ni el tag individual no nul ni la conversió
de global a senyals, i no valida plataformes diferents.

## 7. Proposta d'implementació, per fases

### Fase A: delimitar el suport actual

- Fer explícita la plataforma al model de projecte compartit, conservant-ne
  el valor original; absència o valor desconegut no han de convertir-se en RT.
- Declarar per família les plataformes que es poden identificar, editar,
  generar i convertir. Identificar un KTS per donar un error útil no implica
  suportar-ne l'edició.
- Mantenir KNX-MBM i MBS-KNX limitats a RT, i ME-MBS a RT_AIR, fins que hi
  hagi una conversió verificada. Protegir també l'entrada directa al generador.
- Afegir comprovacions de plataforma compatible i AppId al desplegament,
  amb informació fiable del dispositiu. Si no es pot establir compatibilitat,
  rebutjar l'enviament amb una causa clara.
- Validar el mateix XML que es generarà i enviarà, evitant que una edició
  posterior substitueixi un projecte ja comprovat.

### Fase B: completar KNX-MBM RT

- Representar i preservar el deadband per senyal en model, edició i XML.
- Normalitzar el global antic segons les regles exactes del lector RT.
- Corregir fixture i XBL: absència del global, tag 15 individual no nul.
- Definir la política de firmware antic/desconegut, distingint l'avís de MAPS
  de possibles bloquejos de la webapp. No oferir equivalència silenciosa.

### Fase C: conversió optativa i explícita

- Operació específica d'actualització que produeixi un projecte nou,
  conservi l'original i no desplegui automàticament.
- Selecció de destinació i transformacions per família; no un reemplaçament
  global de `Platform=1` per `Platform=2`.
- Validació del resultat, resum dels canvis i avisos sobre dades no
  preservables o variants no suportades. Error sense resultats parcials.
- Reutilització dels lectors, normalitzadors i regeneradors existents quan
  coincideixin amb la regla de MAPS. No requereix un editor V6 complet.
- Disponibilitat només per conversions verificades amb casos de referència.

Ordre recomanat: A i B primer; després C per MBS-KNX i KNX-MBM, i ME-MBS quan
la preservació/regeneració estigui contrastada. M-Bus com a treball separat.
Això és una proposta de prioritat, no una decisió de suport legacy ja presa.

## 8. Proves i criteris d'acceptació

| Àmbit | Casos mínims | Criteri |
|---|---|---|
| Identitat | Mateixos protocols/AppId, plataformes 1/2/3; absent, 0 i valor desconegut | Cap entrada implícita al camí RT |
| Generació | Invocació directa amb plataforma no suportada | Rebuig encara que s'ometi la UI o la detecció inicial |
| Deploy | AppId correcte i plataforma incompatible; invers; dades desconegudes | Cap enviament; motiu específic |
| Deadband | Global no nul; individual preexistent; fix, virtual i desactivat; zeros | Migració exacta de la secció 4.1 |
| XBL RT | Valor individual no nul i combinació de diversos senyals | Tag 15 i float correctes; absència del tag global 8 |
| Firmware | Anterior, igual i posterior a 2.0.2.0; desconegut | Política acordada explícita; no confondre-la amb la de MAPS |
| Conversió | Cancel·lació, error de parseig, família/variant no admesa | Original intacte, sense projecte nou parcial ni desplegament |
| Repetició | Normalitzar RT dues vegades; sol·licitar conversió d'un RT | Normalització idempotent; cap segona migració legacy accidental |
| ME-MBS | Versions antigues; activació; adreces CUSTOM; grups/error signals | Coincidència i preservació contrastades amb MAPS |
| M-Bus futur | Versions antigues/noves; variant; diagnòstics i índexs | Mateixa estructura i correspondència de senyals que MAPS |

Per certificar una conversió cal obtenir, per família, el projecte V6
d'entrada, el projecte desat després d'actualitzar-lo amb MAPS i l'XBL de
referència de destinació. Cal anotar versions de MAPS i firmware, model i
llicència, i incloure valors no trivials. Comparar XML semànticament i XBL
byte a byte, fixant o explicant camps variables com timestamps i versions.

Separar tres nivells d'evidència: coincidència de regles al codi, coincidència
amb artefactes de MAPS i funcionament en gateway real. Cap nivell substitueix
automàticament els altres. Les mostres RT existents poden reutilitzar-se, però
no són parelles de conversió legacy per defecte.

## 9. Cost relatiu i decisions pendents

| Treball | Cost orientatiu | Principal incertesa |
|---|---|---|
| Documentació i declaració de suport | Baix | Mantenir la matriu actualitzada |
| Proteccions end-to-end de plataforma | Baix-mitjà | Identitat fiable del gateway i contractes compartits |
| Deadband RT complet | Mitjà, localitzat | Model/UI/XML/XBL i mostra no nul·la amb firmware conegut |
| Conversió MBS-KNX / KNX-MBM | Mitjà, acotat | Preservació del projecte complet i parelles MAPS |
| Conversió ME-MBS | Mitjà amb més validació | Regeneració, versions, adreces i funcions auxiliars |
| Conversió general, inclòs M-Bus | Alt | Variants, canvis estructurals i cobertura per família |

No són estimacions en dies ni compromisos de lliurament. La disponibilitat de
projectes de referència és una dependència important. Cal decidir si es vol
suport legacy/conversió i la política davant firmware incompatible abans de
donar aquests fluxos per admesos.

## 10. Checklist per a futures famílies

Cada incorporació hauria de registrar aquesta matriu, encara que la resposta
sigui «no suportat» o «pendent de verificar»:

- Protocols, plataforma XML i classe MAPS de cada variant.
- AppId de projecte i AppId de gateway acceptats per variant.
- Font de plataforma/capacitats del dispositiu i restriccions de firmware,
  model i llicència conegudes.
- Detecció separada del permís d'edició, generació i desplegament.
- Diferències de camps, valors per defecte, XML i XBL entre plataformes.
- `HasS700ProjectAvailable`, `CanConvertProjectDirectly`, lectors i hooks
  d'actualització/regeneració que afecten aquella família.
- Camps preservats, reconstruïts, descartats o que requereixen selecció.
- Casos reals abans/després, proves no nul·les i nivell d'evidència assolit.

Una família no hereta compatibilitat de plataforma, conversió o capacitats
de firmware perquè comparteixi nom de protocol o AppId amb una altra variant.

## 11. Estat de la implementació (2026-09-30)

Abast acordat: la sèrie 700 (RT i RT_AIR), tot com MAPS. Fases A i B fetes;
la Fase C i el suport V6 queden fora.

### 11.1 Fet — Fase A (compatibilitat S700)

- **Plataforma del projecte** (`src/core/project-format/platform.ts`): llegida
  com `InitializeProject_getPlatform` (absent, no enter o desconegut → KTS).
- **Detecció**: KNX–MBM, MBS–KNX i ME–MBS obren Platform 2 i 3, com
  `GetProject` (una sola branca RT/RT_AIR), i rebutgen 0, 1 i desconeguts.
  Abans MBS–KNX només acceptava 2, ME–MBS només 3 i KNX–MBM no mirava la
  plataforma. `fromXml` i els generadors d'XBL fan servir la mateixa detecció.
- **Projectes V6**: s'identifiquen i es rebutgen amb un missatge que els anomena
  (422, `unsupportedProjectMessage`) i remet a *Project → Updated to S700
  Project* de MAPS; també si ja eren desats (lectura, edició, deploy).
- **Normalització en carregar** (`normalizeProject`): la plataforma de la
  classe (2 KNX–MBM i MBS–KNX, 3 ME–MBS), com `SaveConfiguration`. S'aplica en
  obrir, llegir, editar, importar, exportar i desplegar; el text no canvia si
  no hi ha res a normalitzar.
- **Gateway al deploy** (`src/server/deploy/gateway-compat.ts`), com
  `ButtonConnect` + `EvaluateConnectionWithGw` + `CheckDeviceAppId`:
  bootloader/sense aplicació → `message_noApp`; sense plataforma →
  `message_v6projectNecessary`; altra plataforma → rebuig; 700 Series amb
  l'AppId dins `ApplicationIDs` → acceptat (ME–MBS 64 i 8); firmware en blanc
  (63 / 61) o una altra aplicació → rebuig explicant el canvi de firmware que
  MAPS faria. Les tres classes no tenen `AllowedCompIds` ni llicència de
  projecte, així que compId i llicència no rebutgen mai.
- **Plataforma del gateway** (`summarizeInfo`): `PLATFORM`, o "700 Series"
  quan el gateway envia `APPID`, com `DiscoveredDevice`.
- **Mateix XML validat i enviat** (`getProjectSnapshot`).

### 11.2 Fet — Fase B (deadband per senyal KNX–MBM RT)

- **Càrrega** (`normalizeRtDeadband`): `MigrateGlobalDeadbandToSignals` exacte
  (global ≠ 0 → senyals no fixos ni virtuals amb 0, actius o no; global a 0),
  i el desament RT: sense `<Deadband>` global i un per senyal després
  d'`<Address>`. Idempotent. El model ja no té deadband global.
- **XBL**: tag 15 per senyal (float LE) quan no és zero; mai el tag 8 global.
  El generador normalitza abans de compilar.
- **Floats** (`src/core/project-format/single.ts`): lectura com
  `GetInnerTextWithDefault` (coma acceptada) i escriptura com
  `float.ToString()` de .NET 10 (MAPS 1.2.34), el text més curt.
- **Edició**: columna "Deadband" a la graella, amagada per defecte com
  `ch_deadband`, rang 0–100 amb el missatge de MAPS, de només lectura a les
  files virtuals ("-") i als senyals Modbus fixos (el valor), també a l'API
  (422) i a l'edició en bloc (se'ls salta). El camp global de Configuration
  s'ha tret (`SetGlobalDeadbandVisible(!DeadbandEnabled)`) i l'API el rebutja.
- **XLSX**: l'export llegeix el deadband normalitzat del senyal; ja no el
  recalcula (abans no excloïa els senyals fixos, a diferència de MAPS).
- **Firmware**: avís `message_deadbandFwTooOld` si el gateway connectat té un
  `APPVERSION` anterior a 2.0.2.0 (comparat com `System.Version`), sense mirar
  els valors dels senyals i en silenci si la versió no es pot llegir. El deploy
  el mostra i demana confirmació ("Do you want to continue?"); el servidor
  retorna 409 si no s'ha confirmat.
- **Fixture sintètica**: ara té la forma RT de MAPS (sense global, un
  `<Deadband>` per senyal).

### 11.3 Pendent, no resolt

- **Editor i deploy V6 (KTS)**: fora d'abast; els projectes V6 només
  s'identifiquen.
- **Fase C, conversió V6 → S700**: fora d'abast. Cal parelles de referència de
  MAPS (V6, projecte actualitzat i XBL) per família (§8).
- **Canvi de firmware** (`NEED_SWAP`, `FW_NOT_AVAILABLE`): MAPS Web no té el
  catàleg ni baixa firmwares; es rebutja amb el motiu.
- **Correcció de llicència** (`LICENSE_FIX_REQUIRED`): depèn de la llista de
  números de sèrie incorporada a MAPS (`LicenseFixManager`); no es comprova.
- **Deadband per sota de 0,0001 a l'XLSX** (limitació compartida amb MAPS, no
  es corregeix): l'export l'escriu com `float.ToString()` ("1E-05") i la
  importació, com `CheckFloatFormat`, només accepta dígits, comes i punts, així
  que aquest valor no fa l'anada i tornada per Excel. La graella també rebutja
  exponents, com la cel·la de MAPS.
- **Comprovació en viu**: el tag 15 i l'avís de firmware només estan provats
  amb tests i les regles del codi; falta un XBL de MAPS amb deadbands no nuls
  i un gateway amb firmware anterior a 2.0.2.0.