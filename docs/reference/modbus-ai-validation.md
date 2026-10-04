# Mapa Modbus des de PDF i validació amb IA

Implementació a `codex/modbus-scan`, al worktree `maps-webapp-worktrees/modbus-scan`. Signal no es modifica ni és una dependència en execució. El punt d'entrada és **Devices → Add from PDF / scan**, al costat d'**Add from template**. L'assistent comença amb documentació; **Explore without a PDF** obre l'exploració secundària.

## Flux implementat

1. **Proveïdors i perfils**. OpenAI, Claude i Kimi amb un perfil separat per extracció, diagnosi i revisió, configurats a **Settings**. Les claus només es llegeixen al servidor. Els perfils es desen sense credencials.
2. **PDF → candidats**. PDF de fins a 20 MB i 200 pàgines. Grups inicials de 15 pàgines, amb streaming, checkpoints i represa descrits més avall. OpenAI i Claude reben PDF natiu i text de suport; Kimi rep el text extret, i rebutja seccions escanejades sense text. Es desen PDF original, SHA-256, pàgines i resposta estructurada abans de normalitzar el mapa. Una extracció interrompuda o truncada no deixa un mapa parcial importable.
3. **Revisió del mapa**. Nom, FC01–04, adreça PDU, tipus, ordre, bit, escala, offset, unitat, límits i accés documental. La base sempre és 0 internament; es conserva l'adreça impresa. Es mostren model aplicable, pàgines, cita i ambigüitats. Es poden afegir files manualment. L'usuari revisa i desa; això incrementa la revisió del mapa.
4. **Validació en viu**. Es llegeixen només les adreces seleccionades i llegibles. W i Trigger queden exclosos. Es conserven mostres amb hora, funció, adreça, quantitat i paraules de la mateixa resposta. Els valors de 32/64 bits es llegeixen en una petició de 2/4 registres; no es reconstrueixen ajuntant lectures independents. TCP connecta directament al node; RTU reutilitza el treballador amb configuracions temporals, backup durable i restauració verificada.
5. **Diagnosi i resultat**. Anàlisi manual o finestres automàtiques opcionals. Les proves guiades registren un canvi extern amb valors abans/després i hora real. L'informe separa adreça, plausibilitat del tipus, escala, significat i accés. Les correccions d'IA s'accepten individualment, incrementen la revisió i requereixen una nova revisió/validació. Exportació JSON, plantilla nativa `.knxmbm` i importació de les files revisades al projecte local.

La validació en viu és opcional: es pot importar el mapa revisat sense equip. La UI mostra **Not live-validated** quan no hi ha evidència suficient de la revisió actual; l'informe JSON conserva el detall de cada comprovació. **Has captures** als mapes recents només indica captures disponibles, sense validar tots els camps. El destí de la importació (connexió/slave) és visible sense entrar a la captura.

Els proveïdors i models es configuren a **Settings**, al menú lateral, en un bloc Application separat de Gateway workspace. El raonament queda dins d'**Advanced** i les claus continuen a `.env.local`. L'assistent només mostra el perfil d'extracció i un enllaç a Settings; es refresca quan la finestra recupera el focus.

La importació crea senyals amb escriptura Modbus desactivada. Les conversions d'escala/offset es generen amb les operacions natives de MAPS per al flux Modbus → KNX. El projecte no es desplega automàticament. La base del dispositiu es converteix explícitament en importar, i es comproven revisió del projecte, connexió, slave i configuració del node.

## Disseny v17, 2026-10-04

Referències: `temp/MAPS Web v17 - add Modbus device - standalone.html` i `temp/MAPS Webapp - AI.pdf`, al repositori principal. L'HTML anterior de **selection actions** no correspon a aquest assistent.

La implementació segueix l'assistent en un modal ampli amb els passos **Document → Map → Live check → Import**. La pantalla Map reprèn la taula i el panell lateral de **2a**: cita del PDF, edició de la fila i revisió. Els suggeriments d'IA queden sota la fila afectada. Live check usa **Signal · Raw · Value · Result** i el mateix panell lateral per a l'evidència i les proves guiades; les paraules raw sempre són decimals. La validació en viu es pot ometre explícitament.

Adaptacions a les funcions existents: no hi ha Stop per a l'extracció; tancar deixa el treball al servidor. Una extracció interrompuda mostra el progrés desat i Resume, però no habilita Map ni Import fins a completar-se. Els avisos documentals es llegeixen i les correccions es fan al panell de la fila. Un enum es mostra com a tipus natiu amb una etiqueta enum. Retry restore només apareix quan la restauració queda pendent.

Els resultats de lectura no afirmen escala ni significat sense una prova guiada. Els estats de validació es conserven al mapa i a l'informe; no s'afegeixen camps a l'XML natiu ni es promet actualitzar després les senyals ja importades. La importació mostra el resum, el node i el slave, sense requerir hardware connectat.

## Què s'ha aprofitat de Signal

Referència revisada: Signal, commit `ad9d60c`.

| Peça de Signal | Adaptació dins de MAPS | Motiu |
| --- | --- | --- |
| `src/lib/ai/structured-modbus/schema.ts` | `src/core/modbus-ai/extraction.ts` | Contracte de taules crues abans de normalitzar; ampliat amb evidència, tipus, escala i accés. |
| `src/lib/ai/structured-modbus/prompt.ts` | `src/server/modbus-ai/prompt.ts` | Regles de columnes d'adreces, cel·les compartides, bits, enums, notes i models. |
| `src/lib/ai/structured-modbus/normalize.ts` | Normalització selectiva a `extraction.ts` | Patrons de tipus i conservació de l'adreça d'origen; base ambigua visible. |
| `src/lib/modbus-source-evidence/pdf-text.ts` | `src/server/modbus-ai/pdf-text.ts` | Text agrupat per pàgina/línia per contrastar cites. Adaptat a PDFJS 6 i al servidor Next. |
| `src/lib/ai/structured-modbus/incremental-raw-parser.ts` | `src/core/modbus-ai/incremental-raw-parser.ts` | Parser incremental adaptat al contracte ampliat de MAPS; només emet files completes i conformes a l'esquema. |
| Integracions de proveïdors | Adaptadors propis a `providers.ts` | Només JSON/PDF/text necessaris; models i paràmetres actualitzats, sense eines d'escriptura per a la IA. |

No s'importen la UI de Signal, el seu magatzem de dades, els exportadors ni l'execució completa d'agents. Les plantilles, l'XML, les conversions, els transports i la recuperació són els de MAPS.

## Evidència i límits

- **Resposta d'adreça**: una lectura reeixida confirma que aquella petició retorna dades. Un slave que respon zeros a qualsevol adreça no revela quines són senyals reals.
- **Tipus**: poder descodificar i complir límits documentats dona suport a la proposta. No prova signedness ni elimina altres codificacions compatibles.
- **Escala/significat**: una prova guiada vincula mostres abans i després al mateix mapa, captura i senyal. Es permet un marge de propagació de 30 s i no s'utilitzen mostres posteriors a una altra prova de la mateixa senyal. Una correlació no valida tot el mapa.
- **Accés**: l'accés ve del document. R/W i Trigger continuen sense provar; no es fan escriptures de comprovació.
- **Cobertura**: cites no trobades, bases desconegudes, duplicats i fórmules no resoltes es mostren com a avisos. No es pressuposa que el PDF s'hagi reconstruït completament. Les fórmules amb índexs no s'expandeixen inventant quantitats de dispositius; es poden resoldre manualment.
- **Ordre/precisió**: l'ordre dels valors multiregistre s'ha de resoldre abans d'importar. Enter de 64 bits fora de la precisió numèrica segura es mostra com a text exacte; escalar-lo es rebutja. Valors sentinel documentats no s'utilitzen per validar escala/significat.
- **Identificació**: aquesta funció valida un mapa documental contra l'equip. No descobreix un mapa arbitrari ni introdueix una via RTU per enviar FC43/14. Es conserva el diagnòstic anterior d'aquesta limitació.
- **KNX**: no s'ha validat la recepció final al bus KNX amb aquest flux nou.

## Cost i operació

Per defecte: extracció `gpt-6.1-sol/medium`, diagnosi `gpt-6-luna/none`, revisió `gpt-6.1-sol/medium`. La selecció de models és una llista explícita; l'accés real depèn del compte. Claude té PDF natiu: el contracte d'extracció amb molts camps nullable usa JSON guiat i validació al servidor; la diagnosi més petita usa sortida estructurada. Kimi K3 conserva els seus paràmetres de raonament; no s'hi aplica el mode thinking-disabled de K2.6.

La diagnosi automàtica està **desactivada per defecte**, s'executa només mentre l'assistent és obert i la captura funciona, i té un màxim de **3 intents per captura**, persistent també si hi ha errors o un reinici. No s'envia una segona anàlisi mentre n'hi ha una en curs. Els errors ambigus dels proveïdors no es reintenten automàticament. Un truncament explícit per tokens genera peticions per a grups més petits, sense repetir els grups complets. Una revisió o diagnosi manual fa una petició.

L'anàlisi és asíncrona per finestres de fins a 200 observacions recents. El treballador conserva fins a 10.000 observacions i indica si s'ha retallat l'historial. La latència del model no bloqueja les lectures. Aquest és un flux de diagnosi per finestres, sense garantia de temps real per trama.

Claus: `.env.local`, gitignorat; exemple sense credencials a `.env.example`. Dades durables a `.local-data/modbus-ai` i `.local-data/modbus-scans`, o sota `MAPS_DATA_DIR`. Requereix un únic procés de servidor i emmagatzematge persistent. Tancar l'assistent no cancel·la la captura ni l'extracció; la cancel·lació de captura passa a restauració. Per RTU s'apliquen les condicions de recuperació descrites a [modbus-scan-mvp.md](../plans/modbus-scan-mvp.md).

## Recuperació, streaming i TCP

Cada grup complet es desa atòmicament abans de marcar-lo complet al journal. **Resume saved extraction** reutilitza els grups desats, també després d'un reinici, sense repetir les peticions reeixides. Si el proveïdor confirma truncament per límit de tokens, el grup es divideix per la meitat, fins a pàgines individuals. Una pàgina truncada queda com a error recuperable. Altres errors no es reintenten automàticament. Els 14 grups inicials d'un PDF de 200 pàgines poden generar peticions addicionals per subdivisió; la UI ho explica.

L'extracció activa SSE als adaptadors OpenAI Responses, Claude Messages i Kimi Chat Completions. Només el text de sortida entra al parser. Es requereix completitud del proveïdor i JSON vàlid abans d'acceptar un grup. Les files completes es desen periòdicament i en acabar/fallar cada grup, en fitxers per grup i intent amb `provisional: true`. La UI mostra les últimes 30 files com a previsualització. Un grup interromput conserva les files, però es torna a consultar en reprendre: aquestes files no formen un mapa importable.

El servidor continua independentment de la pestanya. La UI mostra el progrés de streaming durable amb el polling existent. Referències: [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Kimi Chat Completions](https://platform.kimi.ai/docs/api/chat).

TCP manté un socket per captura, amb transaccions consecutives. Un timeout o cancel·lació descarta el socket per impedir que una resposta tardana es pugui atribuir a una altra lectura. El socket es tanca en acabar la captura.

## Estat de la revisió posterior

El punt de partida PDF/IA està desat al commit `ddaa568`. L'assistent unificat, Settings, recuperació per grups, streaming, reutilització TCP i format formen la revisió posterior. La previsualització s'ha recompilat i reiniciat a **http://127.0.0.1:3002/devices**. Settings s'obre dins de la mateixa app, sense pestanyes noves ni accions de desplegament a la seva capçalera. Les comprovacions locals autoritzades estan completades; no s'han fet noves peticions de pagament ni proves amb la passarel·la durant aquesta revisió.

La revisió visual ha comprovat Document, Map amb editor lateral, Live check amb evidència pendent i prova guiada, i Import amb el pas de validació omès. S'ha reutilitzat el mapa sintètic desat de quatre files, sense executar extraccions, captures, anàlisis ni una nova importació. Queda pendent la validació del flux complet amb PDF i equip reals.

## Correcció del lector PDF en producció, 2026-10-04

Una extracció real va fallar abans de contactar el proveïdor: Turbopack substituïa `require.resolve("pdfjs-dist/package.json")` pel número de mòdul `92471`, i `path.join` rebutjava aquest valor. La resolució dels recursos PDF.js ara passa pel resolver natiu de Node, igual que la del worker, sense conversions del bundler. La càrrega del document també queda dins del bloc que allibera el lector en cas d'error.

Comprovació autoritzada sense consum: `scripts/verify-pdf-runtime.mjs` invoca les rutes del build real en un projecte sintètic i un directori temporal, amb `fetch` i les connexions de socket bloquejats i credencials fictícies. Reprodueix exactament l'error amb el build anterior. Amb el build corregit, el PDF BDR Thermea Baxi pujat per l'usuari es processa amb **5 pàgines, totes amb text**, i l'operació s'atura deliberadament abans d'enviar cap petició al proveïdor. El document i la feina originals es conserven sense modificar.

Resultat: 11 tests del servei aprovats, lint dels dos fitxers afectats aprovat, build i tipus aprovats. Port 3002 reiniciat amb la correcció. L'extracció amb IA no s'ha reintentat durant aquestes comprovacions; reprendre-la continua sent una acció explícita de l'usuari.

```sh
pnpm build
node scripts/verify-pdf-runtime.mjs /path/to/manual.pdf
```

## Verificació de la revisió, 2026-10-04

La revisió posterior del 4 d'octubre tanca els ajustos de l'assistent v17 i la recuperació:

- TCP manté el socket i reconnecta una sola vegada si una connexió reutilitzada es tanca abans de rebre bytes de resposta, sense ampliar el timeout. Les respostes parcials o invàlides no es reintenten. Es descarten els bytes sobrants i les dades rebudes sense petició pendent.
- Resume conserva els grups completats i el perfil original per defecte. L'usuari pot triar **Use current settings**; cada grup registra el perfil utilitzat. Un grup amb timeout o massa files es divideix en reprendre. Una pàgina truncada o massa gran requereix un perfil diferent o una secció documental menor. Un timeout d'una sola pàgina admet un únic reintent manual amb el mateix perfil.
- Streaming processa un últim esdeveniment sense separador final; es continua exigint finalització explícita del proveïdor i JSON vàlid.
- Settings mostra OpenAI, Anthropic (Claude) i Moonshot (Kimi), amb etiquetes de disponibilitat i la tasca **Review with AI**. El camp d'ordre queda per als valors multiregistre. L'avís d'escriptura desactivada apareix una vegada a Import. TCP directe continua sense exigir passarel·la.

**100 tests focalitzats aprovats**, inclosa la ruta Resume, els tancaments TCP, bytes sobrants, truncaments, timeouts i canvi de perfil. Suite completa: **1.185 tests aprovats, 46 saltats, 111 fitxers aprovats**. Lint complet, tipus i build de producció aprovats. Aquestes comprovacions no fan peticions d'IA ni accedeixen a hardware.

## Verificació del punt de partida, 2026-10-03

**Només dues peticions reals a OpenAI** amb un PDF sintètic i dades sintètiques, sense hardware LAN:

- Sol 6.1: extracció de les quatre files esperades, incloses temperatura int16 ×0,1, potència float32 i Trigger. Uns 24,7 s.
- Luna: anàlisi de raw 230 → 250 amb canvi guiat 23 → 25 °C. Uns 9,4 s. Va mantenir com a pendents la resta del mapa, l'escriptura i la validació KNX.

Artefactes locals a `temp/modbus-ai-validation/`. La clau no forma part dels artefactes. Aquests temps són observacions d'una prova, no estimacions garantides. Claude i Kimi s'han verificat amb respostes simulades; falten proves amb els seus comptes reals.

Les comprovacions locals cobreixen PDF real amb proveïdor simulat, persistència, revisions, exclusions W/Trigger, ordre/precisió, límits d'anàlisi, concurrència, importació i plantilla nativa. Una prova usa un servidor TCP local real per llegir 230 → 250 i un float32 en dues paraules, i comprova correlació i persistència. El transport RTU simulat comprova configuracions de 32/64 bits i restauració exacta. Les proves de restauració prèvies continuen cobrint cancel·lació, reinici, backup corrupte i canvi d'identitat.

Resultat: 58 tests focalitzats aprovats; tipus, lint i build de producció aprovats. La suite completa anterior al darrer enduriment va aprovar 1.133 tests, amb 46 saltats. La comprovació de navegador va revisar i importar tres senyals al projecte sintètic: totes amb `writeFunc=-1`, i la fila Trigger exclosa. Plantilla nativa exportada (864 bytes), informe d'importació i captura `map-import.jpg` desats als artefactes locals. Aquestes comprovacions no fan peticions d'IA addicionals.

La prova amb OpenAI no valida aquest flux nou contra la passarel·la física. La base RTU ja tenia proves físiques anteriors, però queda pendent validar aquest assistent amb un PDF real i un equip real, després de revisar el codi. No s'ha fet cap desplegament físic nou durant aquesta implementació.

Comprovacions sense consum d'API:

```sh
pnpm exec vitest run src/core/modbus-ai src/server/modbus-ai src/server/modbus-scan --maxWorkers=2
pnpm typecheck
pnpm lint
pnpm build
```

`scripts/verify-modbus-ai.ts` és una comprovació manual de pagament, fora de la suite de tests. No cal tornar-la a executar per comprovar els canvis locals.
