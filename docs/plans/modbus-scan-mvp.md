# Add from Modbus scan

Implemented on `codex/modbus-scan`, based on `origin/staging`. Hardware validation precedes the user-requested checkpoint commit; it does not deploy the application automatically.

## Workflow

Open a KNX–Modbus Master project, then use **Devices → Add from scan**, beside **Add from template**. For RTU, connect to the gateway first and receive its project if local serial settings differ. Save any pending property edits and stop the diagnostics monitor before starting.

The wizard selects one connection and slave, and starts with FC01–04 at PDU addresses 0–255. A point is a function/address pair. Internal addresses always use base 0; the display can use base 1. Import explicitly converts PDU addresses to the device's configured base.

Default batch size is 256, total point limit 1024, maximum scan time 600 seconds. Bounds are 512 points per batch, 4096 total points and 1800 seconds. The batch must also fit the gateway's existing project capacity. The estimate includes two observations per point and RTU transfers; it is approximate and timeouts, original polling and firmware reconnects can extend it. Restoration is allowed to run beyond the scan time limit.

Results retain function, address, samples, raw value, exceptions, timeouts and changes. FC01/02 import as a bit; FC03/04 import as unsigned 16-bit raw. Signed values and four float32 word/byte orders are candidates only. Reading an address does not identify its meaning, units, scale, word boundaries or write permissions. Imported rows have Modbus writing disabled and conservative KNX flags. Existing function/address mappings are skipped.

Filters for constant zeros, changing values and FC04 matching FC03 affect presentation only. FC03 and FC04 always remain separate results. Results are added only to the local project, with its revision checked, after restoration has been verified.

## Transport and recovery

RTU uses the gateway's existing TCP control connection, LOGIN protocol, project transfers and raw RTU monitor. No arbitrary Modbus request console command is assumed. Each temporary project is derived from the live backup, preserves original signals, adds read-only probes and disables block polling. The original XBL must round-trip exactly with the verified KNX–MBM generator before any hardware write. Serial number/MAC and application identity are checked before writes and verification.

The scan takes ownership of the control session; reconnect in **Connection** afterward. Closing the modal or browser tab does not cancel the worker. **Cancel scan** finishes the current transfer and then restores. Transient login failures after a temporary upload are retried, following the live proof of concept.

Before the first temporary upload, a native complete-project backup and a journal with its SHA-256 are saved durably under `$MAPS_DATA_DIR/modbus-scans`, or `.local-data/modbus-scans` by default. Files use mode 600, directories mode 700. Login passwords are kept only in memory, never in the journal. Native project backups may contain the credentials already present in the gateway project.

A persistent lock blocks competing transfers, console commands and deployments to the same host. On server startup, interrupted jobs requiring restoration become **Backup restoration pending**. Reconnecting to the host resumes recovery; alternatively use **Restore backup** with credentials in the scan modal. The app-wide banner exposes active jobs and pending recovery even when another project is selected. The lock is released only after a fresh download matches the original SHA-256. An original already installed is verified without another upload. Identity mismatches or corrupt backups leave recovery pending.

Modbus TCP sends FC01–04 requests directly from the server to the configured slave IP/port. MBAP transaction, protocol, unit, length and response function are validated. Each request uses its own socket, so a delayed reply cannot satisfy a later request. The gateway configuration is unchanged.

Workers run in the existing Node server, using durable local storage and in-memory gateway sessions. This MVP requires one server process and persistent storage. A server/network/power failure cannot guarantee immediate restoration while the gateway is unavailable; it preserves a pending recovery and blocks deployment until verification succeeds.

## API

- `POST /api/modbus-scans`: start a job; returns 202 with the journal.
- `GET /api/modbus-scans`: list saved jobs (optional `projectId`).
- `GET /api/modbus-scans/:id`: status and results.
- `DELETE /api/modbus-scans/:id`: request cancellation and restoration.
- `POST /api/modbus-scans/:id/restore`: resume restoration with a connected session or password.
- `POST /api/modbus-scans/:id/import`: selected function/address keys and expected local project revision.

## Validation

Automated coverage includes recovery after interrupted uploads/restarts, durable backup ordering, corruption and changed-identity refusal, cancellation, host ownership, control connection handover, transient reconnects, CRC and request/response correlation, packed bits, exception/timeout handling, TCP fragmentation, base conversion, duplicate import and UI selection/recovery.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`. Hardware validation uses small editable ranges across all four functions, at least two batches, and compares the downloaded final project with the original backup. The ignored integration script and hardware artifacts are under `temp/rtu-unit1-check/`.

Live validation on 2026-10-02 completed against KNX–MBM at `192.168.2.167`, RTU slave 1, 9600 8N1. Eight points ran in two batches and each received two successful observations:

| Function | PDU addresses | Raw values |
| --- | --- | --- |
| FC01 | 0, 1 | 1, 0 |
| FC02 | 0, 1 | 1, 0 |
| FC03 | 109, 110 | 1, 65535 |
| FC04 | 109, 110 | 1, 65535 |

Backup and restored download matched SHA-256 `3c644daac76c92891912bcf89969dc498e5c21e9f653266124eec9d85663e763`. API import added FC01/PDU 1 and FC03/PDU 110; browser UI import subsequently added FC02/PDU 1. All three rows are local only with Modbus writing disabled. Artifacts: `app-scan-validation.json` and `app-scan-ui.jpg`. The slave has no Mitsubishi equipment attached, so these readings demonstrate discovery and transport rather than semantic identification.

A second live job uploaded a 64-point batch, was cancelled when monitoring started, and restored the same backup hash without changing the local project's revision or rows. A competing reconnect while the job owned the gateway returned HTTP 409. Evidence is saved in `app-scan-cancel-validation.json`.

Further live diagnostics confirmed that this master firmware rejects configured `ReadFunc=43` and, in a separate test, `ReadFunc=17`, reporting `MBM_Signals_ReadFunc value is not valid`. Exploratory console commands also returned errors without transmitting identification frames. The RTU slave's support for FC43/14 remains untested: no valid request reached it. Both temporary configurations were restored byte-exactly, followed by CRC-valid slave replies and `INFO:CFGERRORS:0`. Local evidence: `FC43_DIAGNOSTIC.md`, `fc43-config-result.json`, `fc17-config-result.json` and `fc43-postflight-result.json` under the ignored artifact directory.

With a Mitsubishi simulator subsequently active, a 576-point scan (FC03/04 at 0–255, FC01/02 at 0–31) completed in two batches. FC03 and FC04 each had 15 nonzero addresses. A second job repeatedly sampled 77 FC03 points with an additional 60-second observation window. The user's confirmed G01 setpoint change from 23 to 25 °C coincided with FC03/PDU 104 changing from raw 230 to 250, while the other monitored values stayed constant. This is strong guided evidence for the signal and ×10 scale, using one controlled step; it does not establish application signedness or write access. PDU 105 stayed at 236, a temperature candidate whose name and scale require reference evidence. Both jobs restored the original configuration with the same SHA-256 above; all captured frames had valid CRCs and no Modbus writes were observed. Local evidence: `simulator-findings.md`, `simulator-scan-result.json`, `simulator-analysis.json` and `simulator-timeseries.csv`.

These experiments validate a starting point for documentation-derived maps and guided checks against live equipment. The AI/documentation workflow and guided validation UI are not implemented in this checkpoint.

The initial complete automated run covered 1145 tests; one existing ME-MBS derivation test exceeded its 5-second timeout under parallel load and passed when rerun alone (41/41 in that file). Typecheck, lint and production build passed.

Template matching, model discovery via FC43/14, guided correlation while changing equipment settings, block reads with subdivision and automatic semantic names are later extensions. The scan MVP uses no AI.
