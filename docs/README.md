# Documentació del projecte

Dues categories, en carpetes separades:

- **`plans/`** — plans d'implementació i documents de seguiment d'iteracions.
  Es poden **esborrar** un cop implementats; no són font de veritat del codi.
- **`reference/`** — documentació tècnica **durable**: protocols, anàlisis de
  fixtures i receptes contrastades. No s'esborra encara que la funcionalitat
  estigui acabada; el codi hi fa referència des de comentaris.

## `plans/`

- `knx-mbm-mvp.md` — MVP KNX ↔ Modbus Master: decisions, riscos, mapa de fonts
  i seguiment per iteració.
- `cloud-connector-architecture.md` — proposta d'arquitectura cloud (Connector,
  backend, POC). Encara no implementada.

## `reference/`

- `console-protocol.md` — consola de diagnòstic ASCII de les passarel·les 700
  Series: catàleg de comandes validat en viu (RO i RW), formats de resposta i
  comportaments observats.
- `ac-me-mbs-analisi.md` — anàlisi de la fixture real ME AC ↔ Modbus Slave
  (770 Air): format del projecte, adreces, particularitats.
- `adding-a-gateway-family.md` — recepta pas a pas per afegir una nova família
  de passarel·la, contrastada dues vegades amb hardware real.

Nota: `temp/` conté el material d'investigació cru (captures, sondes, quadern
`temp/maps-cloud/PROTOCOL.md`) i està **gitignorat** — és referència de
laboratori, no documentació del producte.
