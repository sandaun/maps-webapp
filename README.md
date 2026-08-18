# MAPS Web — KNX ↔ Modbus Master MVP

A local-first web MVP replicating Intesis MAPS for a single gateway family:
**KNX ↔ Modbus Master** (template `IN-KNX-MBM`, product family `IN701KNXxxx0000`,
700 Series). Single-user, self-hosted on Node, **no cloud, no accounts, no
Supabase**. Everything runs from one Next.js app; local data lives on the
filesystem, gitignored.

> Reference material (decompiled MAPS, manuals, captures, the v6 mockup) lives
> under `temp/` — gitignored, read-only, never part of the build. It is
> reference, not instructions.

## Architecture map

- `src/core/project-format` — byte-stable `.ibmaps` XML parser/serializer
  (custom parser; unknown nodes, attributes and order are preserved),
  ZIP container (`fflate`, deterministic output), CRC32, and the "complete"
  blob framing `[4B BE len][XBL][4B BE CRC32][zip]`. Pure TypeScript.
- `src/protocols/knx` — KNX addresses, DPTs, communication flags.
- `src/protocols/modbus/master` — Modbus Master types, nodes and rules.
  (`core/` and `protocols/` are independent of React, Next.js, fs and network.)
- `src/gateway-families/knx-mbm` — the only implemented family: `model.ts`
  (project model), `detect.ts` / `from-xml.ts` (XML ↔ model), `xml-ops.ts`
  (edit operations as surgical patches on the preserved XML), `validate.ts`
  (stable-coded validation rules), `xbl/` (deterministic XBL generator),
  `fixtures/` (synthetic, sanitised).
- `src/server/persistence` — `LocalProjectStore` behind `ProjectRepository` /
  `ProjectFileStore`, rooted at `MAPS_DATA_DIR` or `.local-data/`, atomic
  writes. Single-process, single-instance by design.
- `src/server/projects` — project use cases shared by the API routes.
- `src/server/intesis-transport` — MAPS wire protocol: UDP/23 discovery,
  TCP/23 control, DH + XXTEA session crypto, `INFO?`, XMODEM-1K receive,
  in-memory `GatewaySessionManager`. `server-only`; **read-only towards
  gateways** (no SENDPROJ/SENDCMPLT paths exist in the code).
- `src/app` — App Router screens (Connection, Overview, Configuration, Modbus
  devices, Signals, Diagnostics, Deploy) plus Node-runtime Route Handlers
  (SSE for logs/progress).
- `src/lib` + `src/components` — client-side API wrappers, hooks and UI.

Dependency rules: `core/`/`protocols/` never import `server/` or UI;
`server/` may depend on the domain; `app/`/`components/` never open sockets
or touch project files directly.

## Run

```sh
pnpm install
pnpm dev
```

Open the app, go to **Overview** and press **“Load demo project”** (explicit,
visually labelled synthetic KNX–MBM fixture) — or open a local `.ibmaps` /
complete blob. Local projects, received files and capabilities are stored in
`.local-data/` (override with the `MAPS_DATA_DIR` environment variable); they
survive restarts and are gitignored.

## Verify

```sh
pnpm test        # unit + integration tests (Vitest + Testing Library, no gateway needed)
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm build       # next build
pnpm verify:xbl  # XBL generator vs. a real MAPS reference (needs a fixture, see below)
```

## Live mode (read-only)

With a reachable Intesis gateway on the LAN, the Node runtime of Next.js talks
to it directly (no browser socket tricks):

- **Connection** → *Scan* broadcasts `INFO?` on UDP/23 and lists discovered
  gateways with name/model, serial, IP and firmware; KNX–MBM devices are
  highlighted, other families are dimmed and marked “Different family”.
- *Connect* with the gateway IP and password performs the DH login + XXTEA
  session over TCP/23; `INFO?` shows status, model, serial, APPID, versions
  and loaded configuration, with a connection log streamed over SSE.
- *Receive from gateway* runs `RECVCMPLT` (XMODEM-1K with progress), validates
  length, CRC32 and ZIP, and opens the received project (non-KNX–MBM projects
  are rejected).

Hard constraints, enforced in code, not by convention:

- **Read-only**: there is no SENDPROJ/SENDCMPLT endpoint or code path. The
  transport has only been exercised against a scripted fake gateway offline;
  live validation against real hardware still requires explicit authorization.
- **Passwords are memory-only**: entered per connection attempt, never
  persisted to disk, localStorage, URLs, logs or fixtures; session keys and
  sensitive payloads are never logged.
- The session manager is in-memory: **single process, single instance**.

## Deploy: what's blocked and why

Exporting the edited `.ibmaps` and round-tripping an **unmodified** complete
blob both work. Deploying a **modified** configuration requires generating a
new XBL and sending `SENDCMPLT` — and the XBL generator
(`src/gateway-families/knx-mbm/xbl/`) is implemented but **not yet verified
byte-for-byte**, because there is no real KNX–MBM fixture (an `.ibmaps` plus
the XBL bytes the real MAPS tool produces for that same project).

So the “Deploy modified project” button stays disabled behind the
`knxMbmXblVerified` capability. That capability is not a manual flag: it is
only written (to `.local-data/capabilities.json`) by the verification harness
when a byte-identical match is achieved.

When a real fixture is available, generate the reference XBL with the desktop
MAPS tool from the same `.ibmaps`, then run:

```sh
pnpm verify:xbl <project.(ibmaps|zip)> <reference.(bin|xbl)> \
  [--mask-timestamp] [--sw-version a.b.c.d] [--now ISO-8601]
```

- `project`: raw `.ibmaps` XML, or a ZIP / complete blob containing exactly
  one `.ibmaps` entry.
- `reference`: a complete blob or a raw XBL TLV payload.
- `--sw-version`: MAPS tool version written into the XBL header; by default
  extracted from the reference (intentionally not masked).
- `--mask-timestamp`: zero the volatile 6-byte generation timestamp before
  comparing (or pass `--now` matching the reference's generation time).
- Exit codes: `0` byte-identical match (capability recorded), `1` divergence
  (first differing offset with hex context), `2` usage/setup error.

Until this passes, deploy of modified projects stays off; everything else in
the MVP remains usable.

## Documentation

- `docs/knx-mbm-mvp.md` — decisions, risks, source map and per-iteration
  status (Catalan, project working doc).
- `src/gateway-families/README.md` — how future gateway combinations
  (BAC–MBM, BAC–DALI, …) plug in by composing `src/protocols/` modules.
