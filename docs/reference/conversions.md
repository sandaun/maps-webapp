# Conversions — què tenim, com ho fa el desktop i què falta

Data: 2026-09-03. Fonts: el nostre codi (`src/`), el descompilat
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

- `Conversion` a `src/gateway-families/knx-mbm/model.ts:67-73` i
  `src/gateway-families/me-mbs/model.ts:66-72` (duplicada):
  `{ id, description, type, params: [string×4] }`. Tipus: **0 FILTER, 1 SCALE,
  2 ARITH, 3 LOGICAL, 4 LUT_REMAP** — coincideix amb `ConversionType` del
  desktop (`IntesisConversion.cs:402-413`).
- Els params es guarden com a **strings** al model UI; el pipeline XBL els
  re-parseja a float (`src/core/xbl/conversions.ts:85-106`).
- Assignació per senyal: `idxOperations`/`idxFilters` es llegeixen
  (`knx-mbm/from-xml.ts:157-158`) però es guarden com a **string cru**
  (`"0,0;"`), sense parseig ni validació semàntica (zod: `string.max(1024)`,
  `patch/route.ts:244`).
- **[bug, 2026-09-25] Aquests dos camps només llegeixen una meitat del senyal.**
  Cada senyal té dues meitats a l'XML (KNX + MBM, o MBS + ME) i cadascuna porta
  les seves refs. El codi fa `textOf(intern) ?? textOf(extern)`, però l'etiqueta
  interna sempre hi és (encara que buida, `""`), així que el `??` no cau mai a
  l'externa. A KNX-MBM només es llegeix la meitat KNX. A la 770 Air, 12
  senyals tenen conversions només a la meitat ME i per a `idxOperations` no en
  tenen cap. Vegeu §5.
- `conversionCode` (2026-09-25, **només KNX-MBM**): camp de només lectura
  calculat a `from-xml.ts` amb **les dues meitats**, port de
  `CreateStringFromConversions` (`src/core/signals/conversion-code.ts`). És el
  que mostra la columna "Conv. Id".

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
  per tipus (`conversionDetail`, `configuration-screen.tsx:1074-1114`): filter
  (tipus/comparació/valors), scale (rangs), arith (`y = x·B·(10^A)+C`), logical
  (OR→AND→XOR), LUT (taula + flag inversa).
- Signals: columna **"Conv. Id"** (2026-09-25) a la banda GATEWAY, **només a
  KNX-MBM**, de només lectura i amagada per defecte com a MAPS
  (`defaultHidden`). Mostra `conversionCode`, p.ex.
  `DIRECTION[>/<]:INDEXES[-;0;1;-]`. A ME-MBS no hi és (§1.1b).
- Configuration → Conversions i el comptador d'Overview: només KNX-MBM (§1.1b).
- **Cap UI escriu conversions ni assignacions**: ni alta/edició/eliminació de
  conversions, ni assignació per senyal. L'única via d'entrada és la
  importació XLSX (columna "Operations", `xlsx-signals.ts:102`).

### 1.3 XBL (això sí que està complet i verificat)

- Taula global de conversions actives amb dedup (`nodes-common.ts:147-171`),
  cadena per costat de cada senyal (`createConversionList`,
  `conversions.ts:175-218`), i **inversió precomputada** (`transformConversion`,
  `conversions.ts:136-156`): SCALE intercanvia rangs, ARITH marca Param4=1,
  LUT_REMAP activa el bit 0x8 (taula inversa), LOGICAL/FILTER es clonen.
- RemapLUTs: es parsejen (`parseRemapLuts`, `conversions.ts:112-126`) i es
  propaguen a l'XBL **només a me-mbs** (`me-mbs/xbl/pipeline.ts:276`).

## 2. Com ho fa el desktop (la referència)

- **Conversions Manager** (`frmConversions.cs`, 1299 línies): llistes de
  filters i operations amb add/edit/delete i validació de rangs. **LUT_REMAP i
  LOGICAL no surten a la llista** (`frmConversions.cs:218`) — ni el desktop les
  edita; les LUT dels projectes ME són fixes, generades pel codi RT
  (`IntesisConversion.CreateRemapping`, `IntesisConversion.cs:196-220`).
- **Assignació per senyal** (`frmSelectConversion.cs`): diàleg per senyal amb
  dibuix del flux (filtre→op1→op2→filtre per costat). Punts clau:
  - `ApplyOperationsRestrictions` (:356-379): segons la direcció del senyal
    (`ConvReadWrite`: READ/WRITE/READWRITE) **desactiva el costat no
    aplicable**.
  - `SaveOperations` (:488-542): el costat intern (BMS) guarda les ops **no
    invertides**; el costat extern (device) guarda **les mateixes en ordre
    invers i marcades invertides** (`idx,1`). Filtres: simètric
    (`SaveFilters` :544-573).
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
  (`IntesisExcel.cs:152-170`), així que les conversions hi van com el text de
  "Conv. Id", amb les dues meitats. En importar, `CheckConversionIntegrity`
  (`ExcelParser.cs:232`) valida aquesta columna i `ConvertStringToConversion`
  (`IntesisConversion.cs:800-830`) en treu les refs de cada meitat.
- **RemapLUTs**: sense editor enlloc; són dades fixes del firmware RT.

## 3. La bidireccionalitat, explicada de veritat

El firmware aplica la cadena de conversions de cada objecte **sempre en la
direcció "cap al centre del gateway"**. No hi ha inversa en runtime ni al
pipeline XBL: la bidireccionalitat s'assoleix perquè **a l'XML els dos costats
del senyal porten refs diferents** — el costat device porta `idx,1` (invertida
i en ordre invers) i el costat BMS `idx,0`. El generador XBL precomputa la
conversió inversa com a entrada separada de la taula activa.

La nostra maquinària XBL **ja ho suporta tot** (transformConversion + refs per
costat). El problema actual: com que no hi ha UI d'assignació i el patch
escriu **el mateix string als dos costats** (`knx-mbm/xml-ops.ts:168-174`,
`me-mbs/xml-ops.ts:250-256`), un senyal read-write amb conversió aplica la
mateixa cadena no invertida en ambdues direccions → **doble conversió en el
mateix sentit en escriptura**. És el bug de bidireccionalitat que ja havíem
detectat.

## 4. Què falta (proposta de capítols)

### 4.1 Assignació per senyal amb direcció — el capítol important

- Model: parsejar `idxOperations`/`idxFilters` a refs `{ index, inverted }`
  (ja existeix el tipus `ConversionIdRef` a `conversions.ts:22-25`).
- Op de patch que rebi la llista d'operacions/filtres **d'un sol costat** i
  escrigui les refs simètriques als dos costats (intern no invertit, extern
  invertit i en ordre invers) — replicant `SaveOperations`/`SaveFilters`.
- UI: a la taula/drawer de senyals, selector de pipeline per senyal amb la
  restricció per direcció del senyal (read/write/readwrite). A MAPS s'hi entra
  pel botó de la columna "Conversions" (§2). Disseny pendent amb Claude design.

### 4.2 Gestió de la llista (config)

- Add/edit/delete de filters i operations (tipus FILTER/SCALE/ARITH/LOGICAL
  editables, com el desktop; LUT_REMAP fora d'edició perquè el desktop tampoc
  l'ofereix). Validacions de rangs del desktop (`ValidateInScalingValues`).
- Ops: `addConversion`, `updateConversion`, `removeConversion` (amb issue de
  validació si una conversió en ús s'intenta esborrar).

### 4.3 RemapLUTs

- [decidir] Portar-les al model (read-only) per transparència, o deixar-les
  read-through com ara. **No** cal editor (ni el desktop en té). Pendent també:
  propagar-les a l'XBL de knx-mbm si algun projecte KNX les usa (avui només
  me-mbs les passa).

### 4.4 Neteja menor

- Unificar la interfície `Conversion` duplicada de les dues famílies en un sol
  mòdul (p.ex. `src/protocols/conversions.ts`).
- Params com a numbers al model en lloc de strings.

## 5. Divergències amb MAPS pendents (detectades 2026-09-25)

Trobades en fer la columna "Conv. Id". Són anteriors a aquesta feina i van en
una branca pròpia. Cal fer-les bé perquè afecten el que arriba al gateway i el
que s'intercanvia amb MAPS. Afecten KNX-MBM; a ME-MBS les conversions no són
editables (§1.1b) i només cal que l'API no les deixi editar.

1. **Model d'una sola meitat.** `idxOperations` / `idxFilters`
   (`knx-mbm/from-xml.ts:157-158`, `me-mbs/from-xml.ts:197-200`) només tenen la
   meitat interna (§1.1). MAPS guarda les refs de cada meitat per separat
   (`FilterIDs` / `OperationIDs` de l'objecte intern i de l'extern). Cal que el
   model tingui les dues meitats, i que tot el que ara fa servir aquests camps
   (export, import, patch) passi a fer-les servir.
2. **Export XLSX.** KNX-MBM escriu "Filters" / "Operations" amb el text cru
   d'una sola meitat (`maps-grid-values.ts:278-279`). MAPS escriu la columna
   "Conv. Id" amb les dues meitats (§2). Conseqüència: un Excel nostre no porta
   bé les conversions a MAPS. (ME-MBS no n'escriu cap, i és correcte: MAPS
   tampoc, §1.1b.)
3. **Import XLSX.** KNX-MBM llegeix "Filters" / "Operations"
   (`imports/xlsx-signals.ts:101-102`) i aplica el mateix text a les dues
   meitats. Hauria de llegir "Conv. Id" i repartir-lo per meitats com
   `ConvertStringToConversion`. (ME-MBS no les llegeix, i és correcte.)
4. **Patch.** Escriu el mateix text a les dues meitats (§3): cal fer-ho com
   `SaveOperations` / `SaveFilters` (extern en ordre invers i invertit). Avui
   cap pantalla el fa servir, però l'API l'accepta. A ME-MBS l'API les hauria
   de rebutjar.
5. **Botó "Conversions" del grid.** Falta (§4.1).

