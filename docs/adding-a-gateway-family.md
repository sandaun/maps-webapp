# Adding a New Gateway Family — The Proven Playbook

This document describes, step by step, how to add support for a new Intesis
gateway family to this app. It is not theoretical: it is the exact process we
followed twice, with real hardware, ending in byte-exact verified XBL
generation and successful live deploys.

- **Case A — KNX ↔ Modbus Master** (`IN-KNX-MBM`, `IN701KNXxxx0000`, AppId 4):
  built from decompiled sources only (no hardware), verified later when a real
  unit arrived. Commits: `513dda1`…`756e6c4`.
- **Case B — Mitsubishi Electric AC ↔ Modbus Slave** (`IN770AIRxxxO000`,
  AppId 64): built hardware-first from a real fixture. Branch
  `feat/ac-me-modbus`, commits `2c7e46c`…`3370908`.

Follow the phases in order. Each phase ends with a verifiable gate; do not
skip gates. When in doubt, copy the patterns of the two existing families —
they are the reference implementation.

---

## 0. Terminology

- **Family**: one protocol combination a gateway runs (e.g. "KNX ↔ Modbus
  Master"). Lives in `src/gateway-families/<family-id>/`.
- **`.ibmaps`**: the project file — a UTF-8 XML document (BOM + CRLF).
- **XBL**: the compiled binary the gateway actually executes. The MAPS tool
  generates it from the XML.
- **"Complete" blob**: what travels between MAPS and the gateway:
  `[4B BE lenXBL][XBL][4B BE CRC32(zlib)][ZIP(.ibmaps)]`.
- **Fixture**: a real project captured from a real gateway (XML + official
  XBL). Never committed (may contain credentials) — lives in
  `.local-data/fixtures/` (gitignored).
- **Capability artefact**: `.local-data/capabilities.json`, written ONLY by
  `scripts/verify-xbl.ts` after a byte-exact match. Gates the deploy feature.

---

## 1. Materials checklist (Phase 0)

Before writing any code, secure these:

1. **Decompiled C# writers for the combination** — check
   `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/` for:
   - `IntesisBoxMAPS.Projects/IntesisProject<Combo>.cs` (and its `_RT` variant
     if the target is a 700 Air / cloud-managed unit),
   - the internal-protocol project dir (e.g. `Projects.Internal_KNX`,
     `Projects.Internal_MBS.RT_AIR`),
   - the external protocol dir (e.g. `Protocols.KNX.External`,
     `Protocols.ME`).
   If any is missing: **STOP** and get it. Everything else is guesswork.
2. **The family's MAPS user guide PDF** (for semantics the decompile doesn't
   explain: limits, defaults, UI meaning of fields).
3. **A real fixture**, ideally: configure a small real project on a physical
   gateway with the official MAPS tool, then download it (see §6). Without a
   fixture you can still build the domain (Case A did), but the XBL generator
   stays unverified and deploy stays disabled until one arrives.
4. **Hardware**, if available: any 700-series unit running the target app.
   Note its IP, AppId (from discovery) and password. All contact is
   **read-only** (discovery/connect/INFO?/RECVCMPLT) until the owner
   explicitly authorizes a deploy test.

Record what you found (and what's missing) in `docs/` before proceeding.

---

## 2. What you get for free vs. what you must write

Already built and shared — **reuse, do not rewrite**:

| Module | Path | Provides |
|---|---|---|
| Project format | `src/core/project-format/` | Byte-stable XML parser/serializer (unknown nodes/attrs/order preserved), deterministic ZIP, CRC32, complete-blob framing |
| XBL machinery | `src/core/xbl/` | TLV varints, element serializer, decoder, header (tag 1) + IBOX (tag 2) writers, conversion writers |
| Transport | `src/server/intesis-transport/` | Discovery (UDP/23, incl. unicast), login (DH+XXTEA), INFO?, XMODEM-1K RX+TX, RECVCMPLT, SENDPROJ/SENDCMPLT, session manager, SSE |
| Persistence | `src/server/persistence/` | Atomic local project store (`.local-data/`) |
| Family registry | `src/server/projects/families.ts` | Where families plug into the API |
| Deploy gates | `src/server/deploy/` | Capability-gated deploy service |
| Harnesses | `scripts/receive-project.ts`, `scripts/verify-xbl.ts` | Fixture capture + byte-exact XBL verification |
| UI shell | `src/components/` + `src/app/` | Screens, table, drawer, validation panel — family-aware |

New per family (all pure TypeScript, no fs/net):

- `src/protocols/<proto>/` — one module per protocol side you don't already
  have (e.g. `modbus/slave`, `me`).
- `src/gateway-families/<family-id>/` — the family itself.
- Family wiring: registry entry, deploy descriptor, screen adaptations.

**Dependency rule** (see `src/gateway-families/README.md`): families depend
on `core/` and `protocols/`, never on each other, never on `server/`.

---

## 3. Phase 1 — Domain layer

Order matters. Each file below exists in both reference families — open them
and mirror the structure.

### 3.1 Protocol modules

For each protocol side not yet implemented, create `src/protocols/<proto>/`:

- `types.ts` — enums and constants exactly as the decompiled code defines
  them (numeric values matter: they are serialized into XML and XBL).
- Model/config interfaces and protocol rules (`rules.ts`,
  `addresses.ts`…) — pure functions.
- Port the **address-assignment logic** if the family has one (e.g. Modbus
  Slave FIXED mode: `IntesisProjectMbsMe_RT.cs:2713-2799`). Test it against
  the real fixture when available (we reproduced 222/222 addresses).

### 3.2 Family module — `src/gateway-families/<family-id>/`

1. `model.ts` — the project model. **Never include credentials** (`Pwd`,
   auth users/passwords). Document exclusions in the header comment.
2. `detect.ts` — family detection from the XML root attributes
   (`InternalProtocol` + `ExternalProtocol` + `Platform`; check the decompiled
   project class for the exact strings, and confirm against the real XML).
3. `from-xml.ts` — `XmlDocument` → model. The parser preserves everything;
   the model only maps what you understand.
4. `xml-ops.ts` — typed patch ops (the ONLY way edits happen — surgical
   patches on the preserved document, never regenerate the XML). Start with:
   general info, gateway info, signal add/remove/update. Only model what the
   decompiled writers support.
5. `validate.ts` — validation catalog with **stable codes**
   (`FAMILY-RULE-NAME`), severity error/warning, and a `ref` pointing at
   screen/entity/field for the UI. One test per rule.
6. `fixtures/synthetic-project.ts` — a small, committed, clearly-labelled
   synthetic project (no secrets). Real fixtures stay in `.local-data/`.
7. `index.ts` — re-exports.

### 3.3 Tests (mandatory patterns)

- Synthetic fixture: parse → model; edit → patch → reparse identical;
  validation battery.
- **Real fixture tests**: skip-if-absent (`describe.skipIf(existsSync(...))`,
  reading from `.local-data/fixtures/`). Assert headline invariants: signal
  counts, mappings, and — the killer test — **byte-identical XML round-trip**
  (`XmlDocument.parse(xml).serialize() === xml`).

### 3.4 Gate

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all green. Document
the phase in `docs/knx-mbm-mvp.md` (or a family doc) — decisions, unknowns,
`UNVERIFIED:` marks.

---

## 4. Phase 2 — API + UI wiring

1. **Registry**: add the family to `FAMILIES` in
   `src/server/projects/families.ts` (`{ id, displayName, detect, fromXml,
   validate, accepts, applyPatch }`). Patch types join the `ProjectPatch`
   union; add zod schemas in `src/app/api/projects/[id]/patch/route.ts`.
   Wrong-family patches must fail with 409; unsupported files with 422.
2. **Client types**: mirror the family model in `src/lib/project-types.ts`
   (type-only imports).
3. **Screens**: Overview (family badge + counts), Signals (per-family
   columns + drawer), Devices, Configuration. Read-only sections are
   acceptable if honestly labelled; signal editing must work end-to-end.
   Follow the existing screens — they match the v6 design reference
   (`temp/MAPS Web v6 - standalone.html`; left-aligned, full-width, 372 px
   drawer, mono for addresses — do NOT auto-center content).
4. Gate: same checks + a smoke test with the real fixture through the API
   (open → view → patch → re-fetch).

---

## 5. Phase 3 — XBL generator

`src/gateway-families/<family-id>/xbl/`:

1. Reuse `src/core/xbl/` for TLV, header (tag 1), IBOX (tag 2), conversions.
2. Port the family writers from the decompiled `GenerateXBL*` methods —
   strict positional order, exact varint semantics. Mark anything ambiguous
   `// UNVERIFIED:` with the reasoning.
3. `generate<Family>Xbl(projectXml, { now?, swVersion?, appId? })` — pure,
   deterministic, no fs/net.

**Known gotchas (both cost us real debugging):**

- **Header AppId vs project CompatibilityID are different numbers.** The
  header carries the DEVICE app id (ME–MBS: 64; KNX–MBM: 4 — from the unit's
  `INFO:APPID`), not the project-class id. Take `appId` as a parameter.
- **`swVersion`** in the header is the MAPS tool version, not derivable from
  the XML. Extract it from a reference blob's header when available.
- The only genuinely **volatile field** observed is the 6-byte generation
  timestamp (header tag 4). Everything else must match byte for byte.

---

## 6. Phase 4 — Byte-exact verification (THE gate)

With a real fixture:

```bash
pnpm verify:xbl --family <family-id> \
  .local-data/fixtures/<fixture>.bin .local-data/fixtures/<fixture>.bin \
  --mask-timestamp
```

- Exit 0 + `MATCH` → the script writes `<family>XblVerified` into
  `.local-data/capabilities.json`. This artefact is the ONLY thing that can
  ever enable deploy.
- Divergence → the harness prints the first offset with hex context. Decode
  both TLV trees with `src/core/xbl/decode.ts`, find the semantic difference,
  fix the writer, repeat. Both families matched on the first run — but only
  because the analysis was done thoroughly first.
- Use `--mask-timestamp` ONLY after proving (by running without it) that the
  timestamp is the sole divergent field.
- **Never fake a match. Never hand-write the capability file.**

No fixture yet? The generator ships unverified, deploy stays disabled, and
this stays at the top of the family's open-issues list.

---

## 7. Phase 5 — Deploy enablement + live test

Deploy writes to a physical device. Every layer is gated:

1. Family has a deploy descriptor (`src/server/deploy/service.ts`,
   `DEPLOY_FAMILIES`) → else 422.
2. Genuine capability artefact (shape-checked) → else 403.
3. Active session whose gateway `INFO:APPID` matches the family's expected
   AppId → else 409.
4. Explicit user confirmation in the UI.

Deploy regenerates the XBL from the current XML (never reuses the original)
and sends `[len][XBL][CRC32][ZIP]` via SENDCMPLT + XMODEM-1K.

**Live test protocol** (requires the owner's explicit authorization, each
time):

1. Receive the project from the device through the app (stores the complete
   blob).
2. Patch ONE harmless field (a signal description + a marker string).
3. Check gates via `GET /api/gateway/sessions/[id]/deploy?projectId=…`.
4. Deploy via `POST …/deploy`.
5. **Receive again and confirm the marker is on the device.** (Note: the unit
   closes the session after a deploy and needs ~20 s before it accepts
   connections — retry, don't panic.)
6. **Restore**: patch back to the original value, deploy again, receive a
   final time and confirm the device is exactly as found.
7. Record the whole run (dates, sizes, results) in `docs/`.

---

## 8. Working with real hardware — operational notes

- **Discovery**: `INFO?` over UDP/23. Broadcast does NOT escape WSL2/NAT —
  use the unicast path (the Connection screen has a "Direct IP" field; the API
  accepts `{"targets": ["<ip>"]}`).
- **Capture a fixture**: `GW_PASSWORD=... pnpm receive:project <ip>
  .local-data/fixtures/<name>.bin` (password via env only, never logged).
  Validates length/CRC32/ZIP and prints the SHA-256.
- A factory-fresh unit has **no project** (`CFGNAME: NO CONFIG`) — receive
  will fail until the owner loads a config with the official MAPS tool. This
  is expected; it is step 0 of getting a fixture.
- Passwords are memory-only everywhere: never in URLs, files, logs,
  localStorage, fixtures, or error messages.
- Read-only discipline: no SENDPROJ/SENDCMPLT until Phase 5 is reached AND
  the owner authorizes the specific test.

---

## 9. Rules that always apply

- `temp/` is read-only reference material, never imported into the build.
- Real fixtures live in `.local-data/` (gitignored) and are never committed.
- Tests using real fixtures must skip gracefully when absent.
- The XML round-trip byte-identity test is sacred — if it fails, fix the
  parser, not the test.
- Commits: conventional, one line, no co-author, only when asked. Never push
  without explicit instruction.
- Verify before claiming: `pnpm test && pnpm typecheck && pnpm lint &&
  pnpm build` green, and look at real output instead of assuming.
- Update `docs/` after every phase — this playbook included.

---

## 10. Copy-paste checklist for the next family

```
[ ] 0. Decompiled writers for the combo located (project + internal + external)
[ ] 0. Family guide PDF read; open domain questions listed
[ ] 0. Real fixture captured (or explicitly deferred)
[ ] 1. protocols/<proto>/ modules (enums, rules, address mapping + tests)
[ ] 1. gateway-families/<id>/: model, detect, from-xml, xml-ops, validate,
       synthetic fixture, index
[ ] 1. Tests: synthetic + real-fixture (skip-if-absent) + XML round-trip
[ ] 2. Registry entry + patch zod + client types + screens (signals editable)
[ ] 3. xbl/ writers + generate<Family>Xbl (appId param! swVersion!)
[ ] 4. pnpm verify:xbl --family <id> → MATCH → capability written
[ ] 5. Deploy descriptor + gates + UI card
[ ] 5. Authorized live test: mark → deploy → verify → restore → documented
[ ] Docs updated at every phase; all four checks green at every gate
```
