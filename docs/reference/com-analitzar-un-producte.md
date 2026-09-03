# Com analitzar un producte i implementar-ne les característiques

Procés contrastat per descobrir què té cada producte (KNX–MBM, 770 Air, DALI,
BACnet⇄KNX…) i com portar-ho a la webapp. Complementa
`adding-a-gateway-family.md` (que cobreix afegir una família sencera de zero);
aquest document és la recepta **de recerca i de característica individual**,
vàlida tant per a famílies noves com per a funcionalitats que falten en
famílies existents.

---

## 1. On és cada cosa (mapa de fonts)

| Font | Ubicació | Què hi trobaràs |
|---|---|---|
| Codi descompilat del desktop | `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/` | La veritat funcional: forms de configuració, models, runtime |
| Guies HMS | `temp/HMS Communication Guide.pdf`, guies per producte | Semàntica que el descompilat no explica (límits, defaults, significat de camps) |
| Fixtures reals | `.local-data/fixtures/` (**mai a Git**: credencials) | XML real per contrastar parsing i XBL |
| Captures / dissenys | `temp/*.png`, `temp/MAPS Web vXX - standalone.html` | Referència visual acordada |
| Anàlisis prèvies | `docs/reference/` (p.ex. `ac-me-mbs-analisi.md`) | Patró a imitar per documentar |
| El nostre codi | `src/gateway-families/<fam>/`, `src/protocols/<proto>/` | model / from-xml / xml-ops / validate / xbl |

> `temp/` està gitignorat: és laboratori. Les conclusions que importen s'han
> de destil·lar a `docs/` (aquesta és la regla de confiança del projecte).

## 2. Com llegir el descompilat per inventariar característiques

L'estructura de l'assembly `IntesisBoxMAPS` és regular; amb quatre patrons de
cobres tot un producte:

1. **Les pantalles de configuració són forms `frm*`**. Cada protocol té el seu:
   - `Protocols.<XX>.External/frmExternal<XX>.cs` → la pestanya de
     configuració del costat "device" (p.ex. `frmExternalMBM` = Modbus Master,
     `frmExternalMe` = Mitsubishi Electric).
   - `Protocols.<YY>.Internal/frmInternal<YY>.cs` → el costat BMS.
   - Forms auxiliars: `frmDiscover<XX>` (scan del bus), `frmMbmTemplates`
     (templates de device), `frmPollRecords`…
   - **Truc**: els noms de control (`b_*` botó, `cb_*` combo, `nb_*` numèric,
     `tb_*` text, `p_*` panell) et donen l'inventari de funcions sense llegir
     la lògica. Els textos visibles són a
     `IntesisBoxMAPS.Properties/Resources.cs` (grep del nom del control).
2. **La classe de projecte**: `Projects/IntesisProject<Int>_<Ext>.cs` i la
   variant `_RT` (unitats 700 Air / cloud). Aquí viuen GetXML/SetXML
   (↔ el nostre `from-xml`/`xml-ops`), la generació d'XBL, els límits i les
   validacions. Si la plana i la `_RT` difereixen, la nostra família segueix la
   `_RT` (vegeu l'§1 de `ac-me-mbs-analisi.md` per com discriminar-les:
   `Platform`, `DeviceOrderCode`, `AppId`).
3. **El model del protocol**: `Protocols.<XX>.External/<XX>.cs` i
   `Internal<YY>.cs` defineixen les entitats (nodes, devices, grups, senyals)
   amb els seus atributs XML literals.
4. **El runtime (`_RT`)**: tot el que sigui *live* (scan, polling, read/write,
   mètriques) només existeix al firmware; a la webapp queda **blocat** fins
   tenir API de gateway en viu. No el dissenyis com si el tinguéssim.

Per una característica concreta, l'ordre de lectura eficient és:
form (què veu l'usuari) → classe de projecte (com es persisteix/valida) →
model de protocol (noms XML literals) → fixture real (valors reals).

## 3. De la característica al codi: la cadena completa

Tota característica travessa les mateixes capes. Si en saltes alguna, la UI
mentirà o el patch es perdrà:

1. **Model** — `src/protocols/<proto>/` (compartit) o
   `src/gateway-families/<fam>/model.ts` (específic). Tipus + defaults.
2. **Parsing** — `from-xml.ts`: llegeix l'element/atribut amb el **nom literal
   de l'XML del desktop** (case-sensitive; el desktop té typos que cal
   respectar, p.ex. `DiangosticEnabled`).
3. **Escriptura** — `xml-ops.ts`: una funció `updateX(doc, patch)` per bloc.
   Mai reescriptures completes: el parser preserva nodes desconeguts, i això és
   el que ens permet no modelar el 100% de l'XML.
4. **Registre d'ops** — `src/server/projects/families.ts`: tipus del patch,
   `accepts`, dispatch.
5. **Validació d'entrada** — schema zod a
   `src/app/api/projects/[id]/patch/route.ts` (rang i forma; la semàntica va a
   `validate.ts`).
6. **Mirall client** — `src/lib/project-types.ts`.
7. **UI** — pantalla de `src/components/screens/`, estil de la versió de
   disseny vigent (V10/V11: building blocks `GroupCard`/`FieldRow`/
   `TextControl`/`SelectControl`/`ToggleControl`, save per secció amb
   `useSave`; toggles immediats amb `usePatch`).
8. **Validació de projecte** — `validate.ts` de la família: codi
   `FAM-XXX-YYY`, severitat, i `ref` a la pantalla on es resol.
9. **XBL** — si la característica es compila al binari, estendre
   `xbl/` i **verificar byte a byte** amb `scripts/verify-xbl.ts` contra una
   fixture real. Sense això, deploy bloquejat.
10. **Tests** — test de servei amb persistència (`service.test.ts`) + tests de
    from-xml/xml-ops amb la fixture sintètica de la família.

## 4. Regles que ens hem donat (no negociables)

- **Secrets fora del model**: `Pwd`, `AuthUserId`/`AuthPassword` ni es llegeixen
  (comentari obligatori al `from-xml`). Fixtures reals mai a Git.
- **El que no es modela es preserva**: no cal parsejar tot l'XML; el que no
  toquis ha de sobreviure un cicle load→save byte a byte (hi ha test).
- **Una casa per a cada cosa**: settings de gateway/protocol a Configuration;
  inventari i edició per-dispositiu a la pantalla de dispositius de la família
  (AC units, DALI devices, Modbus devices); monitoratge live a Diagnostics.
  Res duplicat entre pantalles.
- **El disseny viu a `temp/MAPS Web vXX - standalone.html`** i és la referència
  visual, però les dades manen: si el disseny mostra un camp que el model no
  té, primer s'estén el model (cadena de l'§3), mai maquillar la UI.
- **Documenta el que trobis a `docs/`**: anàlisi de fixtures i receptes a
  `reference/` (durable), plans i llistes de gaps a `plans/` (esborrables un
  cop implementats).

## 5. Checklist per a un producte nou (resum operatiu)

1. [ ] Localitzar form + classe de projecte (+ `_RT`) al descompilat. Si falten: STOP.
2. [ ] Conseguir guia HMS del producte i, si es pot, fixture real via
       `scripts/receive-project.ts` (contacte read-only fins autorització).
3. [ ] Document d'anàlisi a `docs/reference/` seguint `ac-me-mbs-analisi.md`:
       identificació de variant, estructura XML, adreces, particularitats,
       secrets redactats.
4. [ ] Inventari de característiques per pantalla (Configuration / Devices /
       Signals / Diagnostics / Deploy) amb estat [fet]/[falta]/[blocat] —
       format de `docs/plans/gaps-families-v11.md`.
5. [ ] Implementar seguint la cadena de l'§3, característica a
       característica, amb la verificació completa (`typecheck`, `lint`,
       `test`, `build`) abans de cada commit.
