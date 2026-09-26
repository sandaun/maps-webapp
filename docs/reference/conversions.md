# Conversions — què tenim, com ho fa el desktop i què falta

Data: 2026-09-03, actualitzat el 2026-09-26. Fonts: el nostre codi (`src/`), el descompilat
(`temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`) i la fixture real 770 Air
(analitzada a `ac-me-mbs-analisi.md`).

Una conversió transforma el valor brut d'un senyal entre el costat device i el
costat BMS (escala, aritmètica, lògica, taula de correspondències, filtre de
pas). Al projecte hi ha **dos mecanismes diferents** que sovint es barregen:

1. **La llista de conversions del projecte** (`<Conversions>` a IBOX) — la
   "config": quines conversions existeixen.
2. **L'assignació per senyal** (`IdxOperations` / `IdxFilters` de cada senyal) —
   quines conversions s'apliquen a cada senyal, **en quin ordre i en quina
   direcció**.

---

## 1. Què tenim (estat actual)

### 1.1 Model i parsing

- `Conversion` a `src/gateway-families/knx-mbm/model.ts` i
  `src/gateway-families/me-mbs/model.ts` (duplicada):
  `{ id, description, type, params: [string×4] }`. Tipus: **0 FILTER, 1 SCALE,
  2 ARITH, 3 LOGICAL, 4 LUT_REMAP** — coincideix amb `ConversionType` del
  desktop (`IntesisBoxMAPS.Enums/ConversionType.cs:3-10`). `id` és l'atribut
  `Id` de l'XML, que MAPS només fa servir com a metadada: les refs dels senyals
  són **posicions** dins la llista de filtres o d'operacions
  (`IntesisConversion.cs:233-247`).
- Els params es guarden com a **strings** al model UI; el pipeline XBL els
  re-parseja a float (`src/core/xbl/conversions.ts:85-106`).
- Assignació per senyal (2026-09-26, **només KNX-MBM**): `signal.conversions`
  guarda les refs **de cada meitat** ja parsejades, com els `FilterIDs` /
  `OperationIDs` de MAPS: `internal` = objecte KNX, `external` = senyal Modbus
  (`src/core/signals/conversion-refs.ts`, `knx-mbm/from-xml.ts`). Abans hi
  havia `idxOperations` / `idxFilters`, un sol text que només llegia la meitat
  KNX (l'etiqueta buida feia que el `??` no arribés mai a la Modbus).
- "Conv. Id" es calcula de `signal.conversions` amb el port de
  `CreateStringFromConversions` (`src/core/signals/conversion-code.ts`), i
  `parseConversionCode` fa el camí invers (`ConvertStringToConversion`).
- Les refs s'escriuen sempre sense `;` final (`formatConversionIds`, port de
  `GetConversionIDsXMLString`, `IntesisXML.cs:310-323`): el parser de MAPS
  fallaria amb un `;` final. Les fixtures sintètiques en tenen (`0,0;`), però
  només es fan servir per llegir.

### 1.1b ME-MBS no té conversions editables (com MAPS)

`IntesisProjectMbsMe_RT.ConversionsEnabled()` retorna `false`
(`IntesisProjectMbsMe_RT.cs:3010`; per defecte és `true`,
`IntesisProject.cs:1780`). Conseqüències a MAPS:
- el grid de senyals no afegeix les columnes "Conv. Id" / "Conversions"
  (`frmMain.cs:5293`, `IntesisProjectMbsMe_RT.cs:598`, `:2912`);
- el panell de conversions de la configuració del gateway s'amaga
  (`p_conversions.Visible = project.ConversionsEnabled()`, `frmGateway.cs:283`);
- l'Excel només bolca les columnes del grid, així que **no porta conversions**;
- les conversions (ARITH i LUT_REMAP) i les refs de cada senyal les genera el
  codi RT en regenerar els senyals (`signals-engine.ts:529-650`).

A la webapp (2026-09-26): ME-MBS no té columna "Conv. Id" ni secció
Conversions a Configuration ni el comptador d'Overview. Les refs de l'XML es
continuen preservant i arriben a l'XBL tal com són.

### 1.2 UI

- Configuration → Conversions: master-detail **read-only** amb detall llegible
  per tipus (`conversionDetail`, `configuration-screen.tsx`): filter
  (tipus/comparació/valors; "Less than" fa servir el Param4, com
  `IntesisMath.ApplyFilter`), scale (rangs), arith (`y = x·B·(10^A)+C`),
  logical (OR→AND→XOR), LUT (taula + flag inversa). Els textos de
  comportament surten del simulador de MAPS (`IntesisMath.cs:9-230`).
- Signals: columna **"Conv. Id"** (2026-09-25) a la banda GATEWAY, **només a
  KNX-MBM**, de només lectura i amagada per defecte com a MAPS
  (`defaultHidden`), p.ex. `DIRECTION[>/<]:INDEXES[-;0;1;-]`. A ME-MBS no hi és
  (§1.1b).
- Configuration → Conversions i el comptador d'Overview: només KNX-MBM (§1.1b).
- **Cap pantalla escriu encara conversions ni assignacions.** Les vies
  d'escriptura són l'import XLSX (§2, §5) i l'API de patch (`conversions`,
  §4.1). L'editor està pendent de disseny (§4).

### 1.3 XBL (això sí que està complet i verificat)

- Taula global de conversions actives amb dedup (`nodes-common.ts:147-171`),
  cadena per costat de cada senyal (`createConversionList`,
  `conversions.ts:175-218`), i **inversió precomputada** (`transformConversion`,
  `conversions.ts:136-156`): SCALE intercanvia rangs, ARITH marca Param4=1,
  LUT_REMAP activa el bit 0x8 (taula inversa), LOGICAL/FILTER es clonen.
- RemapLUTs: es parsejen (`parseRemapLuts`, `conversions.ts:112-126`) i es
  propaguen a l'XBL **només a me-mbs** (`me-mbs/xbl/pipeline.ts:276`).

## 2. Com ho fa el desktop (la referència)

- **Conversions Manager** (`frmConversions.cs`, 1299 línies; s'obre des de
  `frmGateway.cs:576-599`): llistes de filters i operations amb add/edit/delete.
  Només s'editen **FILTER, SCALE i ARITH**. LUT_REMAP i LOGICAL no hi arriben:
  el qui l'obre les treu abans i les torna a posar **al davant** de les
  operacions en desar (`frmGateway.cs:579-592`; `frmConversions.cs:218` és una
  segona xarxa). Les LUT dels projectes ME són fixes, generades pel codi RT
  (`IntesisConversion.CreateRemapping`, `IntesisConversion.cs:196-220`).
  - Validacions (totes amb el mateix missatge modal "Please, set a valid
    range"): `minIn ≤ maxIn` i `minOut ≤ maxOut` a SCALE, i `P3 ≤ P4` als
    filtres In range / Out of range (`frmConversions.cs:726-766`). Valors dels
    filtres: ±100000.
  - **Esborrar no renumera les refs**: els senyals que apuntaven a les
    conversions posteriors passen a apuntar a la següent sense avisar, i
    `UpdateConversionIndexes` només treu les que queden fora de rang
    (`frmConversions.cs:546-575`, `ExternalMbm.cs:1544-1564`). No hi ha avís
    de conversió en ús.
- **Assignació per senyal** (`frmSelectConversion.cs`): diàleg per senyal amb
  dibuix del flux (filtre→op1→op2→filtre per costat). Punts clau:
  - `ApplyOperationsRestrictions` (:356-379): segons la direcció del senyal
    (`ConvReadWrite`: READ/WRITE/READWRITE) **desactiva el costat no
    aplicable**.
  - La direcció surt **només dels flags KNX** (`ConversionObject.cs:110-128`):
    `(R||T) && (U||W)` → lectura i escriptura; `R||T` → només lectura; la resta
    → només escriptura.
  - `SaveObjectsConfiguration` / `SaveOperations` / `SaveFilters`
    (:476-573): la meitat del flux desactivat queda buida; en lectura i
    escriptura, la meitat del flux definit ("master", per defecte l'intern)
    guarda les ops **no invertides** i l'altra **en ordre invers i invertides**.
    Cada meitat porta primer el seu filtre i després el de l'altre costat
    marcat com a invertit (s'aplica després de les ops).
- Format del string d'assignació: `idx,inverted;` (`IntesisXML.cs:310-323`).
- **Columnes del grid de senyals** (`IntesisConversion.GetColumnHeaders`,
  `IntesisConversion.cs:415-440`), les dues amb `Visible = false` per defecte:
  - **"Conv. Id"** (`column_conversionsCode`): text de només lectura
    `DIRECTION[x]:INDEXES[f;op1;op2;f]` fet amb les dues meitats
    (`CreateStringFromConversions`, `:698-762`). Direccions: `>` només intern,
    `<` només extern, `>/<` / `</>` tots dos (segons si l'intern té alguna op
    no invertida).
  - **"Conversions"** (`column_conversions`): botó "Enabled" / "-" que obre
    `frmSelectConversion` (`IntesisProjectKnxMbm_RT.cs:641-705`,
    `IntesisProjectMbsMe_RT.cs:624-690`).
- **Excel**: el full "Signals" bolca **totes les columnes del grid**
  (`IntesisExcel.cs:120-170`), així que hi van "Conv. Id" (les dues meitats) i
  "Conversions" ("Enabled" / "-"). El full "Conversions" només s'escriu si el
  projecte té conversions activades, amb "Idx" = posició dins la seva llista
  (`IntesisExcel.cs:266-321`).
- **Import d'Excel** (`frmImport.cs:464-530`, `:690-720`): el full
  "Conversions" **substitueix** la llista del projecte
  (`AddConversionsToProject`), i "Conv. Id" es reparteix per meitats
  (`ConvertStringToConversion`). Un format incorrecte bloqueja l'import; una
  ref a una conversió inexistent només pinta la fila de vermell. Si falta el
  full, mostra un error i **buida** la llista.
- **RemapLUTs**: sense editor enlloc; són dades fixes del firmware RT.

## 3. La bidireccionalitat, explicada de veritat

El firmware aplica la cadena de conversions de cada objecte **sempre en la
direcció "cap al centre del gateway"**. No hi ha inversa en runtime ni al
pipeline XBL: la bidireccionalitat s'assoleix perquè **a l'XML els dos costats
del senyal porten refs diferents** — el costat device porta `idx,1` (invertida
i en ordre invers) i el costat BMS `idx,0`. El generador XBL precomputa la
conversió inversa com a entrada separada de la taula activa.

La nostra maquinària XBL **ja ho suporta tot** (transformConversion + refs per
costat). Fins al 2026-09-26, el patch i l'import escrivien **el mateix text als
dos costats**, i un senyal de lectura i escriptura amb conversió aplicava la
mateixa cadena no invertida en ambdues direccions (**doble conversió en el
mateix sentit en escriptura**). Ara totes dues vies escriuen cada meitat com
MAPS (§5).

## 4. Què falta (proposta de capítols)

### 4.1 Assignació per senyal amb direcció — el capítol important

- [fet 2026-09-26] Model amb les refs de cada meitat (§1.1).
- [fet 2026-09-26] API: `updateSignal` accepta `conversions` =
  `{ internalFilter, operations (≤2), externalFilter, master }`, el que edita
  `frmSelectConversion`, i el servidor escriu les dues meitats amb
  `refsFromSelection` (port de `SaveObjectsConfiguration`) i la direcció dels
  flags KNX (`knxConversionRwMode`). Rebutja conversions inexistents i senyals
  virtuals (MAPS no deixa editar-los la cel·la). Ja no accepta refs en text cru.
- UI: pendent de disseny. El prompt per a Claude design és local a
  `temp/prompt-claude-design-conversions.md` (biblioteca a Configuration →
  Conversions, assignació per senyal amb modal des d'una columna del grid,
  assignació massiva i issues de validació).

### 4.2 Gestió de la llista (config)

- Add/edit/delete de filters i operations: FILTER, SCALE i ARITH editables,
  com el desktop; LUT_REMAP i LOGICAL de només lectura (§2). Validacions del
  desktop (§2).
- Ops: `addConversion`, `updateConversion`, `removeConversion`. **Divergència
  volguda**: en esborrar, renumerar les refs dels senyals i treure les de la
  conversió esborrada, i ensenyar abans quants senyals l'usen. MAPS les deixa
  apuntant a una altra conversió (§2).

### 4.3 RemapLUTs

- [decidir] Portar-les al model (read-only) per transparència, o deixar-les
  read-through com ara. **No** cal editor (ni el desktop en té). Pendent també:
  propagar-les a l'XBL de knx-mbm si algun projecte KNX les usa (avui només
  me-mbs les passa).

### 4.4 Neteja menor

- Unificar la interfície `Conversion` duplicada de les dues famílies en un sol
  mòdul (p.ex. `src/protocols/conversions.ts`).
- Params com a numbers al model en lloc de strings.

## 5. Divergències amb MAPS (detectades 2026-09-25, resoltes 2026-09-26)

Trobades en fer la columna "Conv. Id". Afecten KNX-MBM; a ME-MBS les
conversions no són editables (§1.1b).

1. **[fet] Model d'una sola meitat.** Ara hi ha `signal.conversions` amb les
   dues meitats (§1.1).
2. **[fet] Export XLSX.** Escriu "Conv. Id" i "Conversions" en lloc de
   "Filters" / "Operations", i el full "Conversions" només per a KNX-MBM i amb
   "Idx" = posició (abans hi posàvem l'atribut `Id`, que pot estar repetit: a
   la 770 Air hi ha dos `Id="0"`).
3. **[fet] Import XLSX.** Llegeix el full "Conversions" i "Conv. Id" com MAPS
   (`src/server/imports/xlsx-conversions.ts`), però **més estricte** en els
   casos que MAPS resol malament. Rebutja l'import, sense tocar res, si:
   - la llista de l'Excel és diferent de la del projecte i el projecte ja té
     senyals amb conversions (MAPS els faria apuntar a altres conversions);
   - hi ha "Conv. Id" però falta el full "Conversions" (MAPS buidaria la
     llista);
   - un "Conv. Id" té format incorrecte o apunta a una conversió que no és al
     full (MAPS importa aquest segon cas igualment);
   - una fila del full té tipus o paràmetres incorrectes, o un "Idx" que no és
     la seva posició (MAPS salta la fila).

   Sense columna "Conv. Id", les files s'importen sense conversions i la llista
   no es toca. Com a MAPS, "Conv. Id" de tipus `>/<` només porta la meitat
   interna i l'externa es deriva invertida.
4. **[fet] Patch.** Escriu cada meitat com `SaveObjectsConfiguration` (§4.1).
   A ME-MBS l'API rebutja editar conversions.
5. **[falta] Editor** (biblioteca i assignació per senyal): pendent de disseny
   (§4.1, §4.2).
