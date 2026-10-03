# Mapa Modbus des de PDF i validació amb IA

Implementació a `codex/modbus-scan`, al worktree `maps-webapp-worktrees/modbus-scan`. Signal no es modifica ni és una dependència en execució. El punt d'entrada és **Devices → Add from PDF / AI**, al costat d'**Add from template** i **Add from scan**.

## Flux implementat

1. **Proveïdors i perfils**. OpenAI, Claude i Kimi amb un perfil separat per extracció, diagnosi i revisió. Les claus només es llegeixen al servidor. La UI mostra disponibilitat, model i nivell de raonament. Els perfils es desen sense credencials.
2. **PDF → candidats**. PDF de fins a 20 MB i 200 pàgines. Extracció en grups de 15 pàgines; una petició d'IA per grup. OpenAI i Claude reben PDF natiu i text de suport; Kimi rep el text extret, i rebutja seccions escanejades sense text. Es desen PDF original, SHA-256, pàgines i resposta estructurada abans de normalitzar el mapa. Una extracció interrompuda o truncada no deixa un mapa parcial importable.
3. **Revisió del mapa**. Nom, FC01–04, adreça PDU, tipus, ordre, bit, escala, offset, unitat, límits i accés documental. La base sempre és 0 internament; es conserva l'adreça impresa. Es mostren model aplicable, pàgines, cita i ambigüitats. Es poden afegir files manualment. L'usuari revisa i desa; això incrementa la revisió del mapa.
4. **Validació en viu**. Es llegeixen només les adreces seleccionades i llegibles. W i Trigger queden exclosos. Es conserven mostres amb hora, funció, adreça, quantitat i paraules de la mateixa resposta. Els valors de 32/64 bits es llegeixen en una petició de 2/4 registres; no es reconstrueixen ajuntant lectures independents. TCP connecta directament al node; RTU reutilitza el treballador amb configuracions temporals, backup durable i restauració verificada.
5. **Diagnosi i resultat**. Anàlisi manual o finestres automàtiques opcionals. Les proves guiades registren un canvi extern amb valors abans/després i hora real. L'informe separa adreça, plausibilitat del tipus, escala, significat i accés. Les correccions d'IA s'accepten individualment, incrementen la revisió i requereixen una nova revisió/validació. Exportació JSON, plantilla nativa `.knxmbm` i importació de les files revisades al projecte local.

La importació crea senyals amb escriptura Modbus desactivada. Les conversions d'escala/offset es generen amb les operacions natives de MAPS per al flux Modbus → KNX. El projecte no es desplega automàticament. La base del dispositiu es converteix explícitament en importar, i es comproven revisió del projecte, connexió, slave i configuració del node.

## Què s'ha aprofitat de Signal

Referència revisada: Signal, commit `ad9d60c`.

| Peça de Signal | Adaptació dins de MAPS | Motiu |
| --- | --- | --- |
| `src/lib/ai/structured-modbus/schema.ts` | `src/core/modbus-ai/extraction.ts` | Contracte de taules crues abans de normalitzar; ampliat amb evidència, tipus, escala i accés. |
| `src/lib/ai/structured-modbus/prompt.ts` | `src/server/modbus-ai/prompt.ts` | Regles de columnes d'adreces, cel·les compartides, bits, enums, notes i models. |
| `src/lib/ai/structured-modbus/normalize.ts` | Normalització selectiva a `extraction.ts` | Patrons de tipus i conservació de l'adreça d'origen; base ambigua visible. |
| `src/lib/modbus-source-evidence/pdf-text.ts` | `src/server/modbus-ai/pdf-text.ts` | Text agrupat per pàgina/línia per contrastar cites. Adaptat a PDFJS 6 i al servidor Next. |
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

La diagnosi automàtica està **desactivada per defecte**, s'executa només mentre l'assistent és obert i la captura funciona, i té un màxim de **3 intents per captura**, persistent també si hi ha errors o un reinici. No s'envia una segona anàlisi mentre n'hi ha una en curs. No es reintenten automàticament les peticions als proveïdors; un error ambigu podria haver consumit tokens. Extracció de 200 pàgines pot fer fins a 14 peticions: la UI ho explica abans de començar. Una revisió o diagnosi manual fa una petició.

L'anàlisi és asíncrona per finestres de fins a 200 observacions recents. El treballador conserva fins a 10.000 observacions i indica si s'ha retallat l'historial. La latència del model no bloqueja les lectures. Aquest és un flux de diagnosi per finestres, sense garantia de temps real per trama.

Claus: `.env.local`, gitignorat; exemple sense credencials a `.env.example`. Dades durables a `.local-data/modbus-ai` i `.local-data/modbus-scans`, o sota `MAPS_DATA_DIR`. Requereix un únic procés de servidor i emmagatzematge persistent. Tancar l'assistent no cancel·la la captura ni l'extracció; la cancel·lació de captura passa a restauració. Per RTU s'apliquen les condicions de recuperació descrites a [modbus-scan-mvp.md](../plans/modbus-scan-mvp.md).

## Verificació del 2026-10-03

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
