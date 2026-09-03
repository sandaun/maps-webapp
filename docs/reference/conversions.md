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

### 1.2 UI

- Configuration → Conversions: master-detail **read-only** amb detall llegible
  per tipus (`conversionDetail`, `configuration-screen.tsx:1074-1114`): filter
  (tipus/comparació/valors), scale (rangs), arith (`y = x·B·(10^A)+C`), logical
  (OR→AND→XOR), LUT (taula + flag inversa).
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
escriu **el mateix string als dos costats** (`knx-mbm/xml-ops.ts:146-153`,
`me-mbs/xml-ops.ts:228-231`), un senyal read-write amb conversió aplica la
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
  restricció per direcció del senyal (read/write/readwrite). Disseny pendent
  (capítol V12 amb Claude design).

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
