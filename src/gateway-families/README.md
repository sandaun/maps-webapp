# Gateway families

Each folder implements one Intesis gateway combination (e.g. `knx-mbm` =
KNX ↔ Modbus Master) by **composing** the generic protocol modules under
`src/protocols/` — never by duplicating protocol logic.

A family module contains only what is specific to the combination:

- `model.ts` — the project model (composed endpoints, family config).
- `detect.ts` — how to recognise the family from an `.ibmaps` document.
- `from-xml.ts` — XML → model mapping.
- `xml-ops.ts` — edit operations as patches on the preserved XML document.
- `validate.ts` — family validation rules with stable codes.
- `xbl/` — the deterministic XBL binary generator (present in `knx-mbm` and
  `me-mbs`; both verified byte-exact against real device captures and tested
  with a live deploy).
- `fixtures/` — synthetic test fixtures (marked as synthetic; no secrets).
- `index.ts` — the family's small public API (deep imports stay out of bounds).

Rules:

- Families depend on `src/core/` and `src/protocols/`; never on `src/server/`
  or the UI.
- Future combinations (BAC–MBM, BAC–DALI, Modbus–DALI, M-Bus–Modbus…) get
  their own folder here when they are actually implemented. Do not create
  empty folders or speculative skeletons for them.
- Implemented families:
  - `knx-mbm` — KNX ↔ Modbus Master (IN701KNX; XBL verified, live deploy tested).
  - `me-mbs` — Mitsubishi Electric AC ↔ Modbus Slave (770 Air,
    `IntesisProjectMbsMe_RT`; XBL verified, live deploy tested).

To add a new family, follow the step-by-step playbook at
`docs/adding-a-gateway-family.md`.
