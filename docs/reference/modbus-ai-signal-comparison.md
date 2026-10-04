# Signal → MAPS: three-PDF comparison and live Controller 1 test

2026-10-04 · worktree `modbus-scan` · branch `codex/modbus-scan` · comparison recorded before commit and integration with staging.

The supplied **signal_list_controller1.pdf** produced **55 signals in both Signal and MAPS**, with identical addresses and 16-bit signed/unsigned formats. MAPS then read all **24 eligible signals** from RTU slave 1, collected **106 successful responses**, and restored the gateway's original configuration with an identical SHA-256. The 31 documented Trigger rows were retained in the document map and excluded from probing.

The two further PDFs selected by the user were also compared: **Baxi (5 pages)** and **Gree (2 pages)**. Their final maps match Signal's counts, functions, addresses, bits, types, scales, units and documented access. Baxi exposed two real conversion defects; these were corrected and verified by replaying the original paid responses, without another extraction. Review of this report remains required before committing. These short documents do not establish parity for every manufacturer or exercise the 40-page group boundary with paid AI.

## Reused implementation

Signal is read-only at commit `ad9d60c6619bfab7a9186e96938bd0b20a4403cc`.

- The complete `structured-modbus/normalize.ts`, raw prompt/schema, enum parser and template expansion code were brought into `src/core/modbus-ai/signal/`. Source paths and original SHA-256 hashes are recorded in `provenance.json`.
- Normalization decisions were preserved. Import paths were adapted, and `sourceRow` / `sourceTable` were added only to retain provenance through expansion.
- The extraction response contains Signal's raw row fields plus `sourcePages` / `sourceQuote`. Type, scale, unit, byte order, range and access are interpreted by code afterward. Signal's **Do NOT infer final signals** rule is retained.
- The complete original 41-case regression suite runs in MAPS. An additional 41-case test compares the complete normalization/expansion output against fixtures produced by executing the unchanged Signal source. A further 41-case test checks the final MAPS function, address, bit, encoding, scale, unit and access adaptation.
- Every original rule is retained in the normalization core. The adaptations below describe the final MAPS representation; no unported rule is hidden behind a shorter normalizer.
- Document review starts from Signal's shared review instructions and KNX/Modbus Master review prompt. MAPS adapts the output to reviewable findings/corrections and omits unavailable KNX configuration fields. Live diagnosis uses a separate prompt.

## Explicit MAPS adaptations

| Source result | MAPS behavior | Reason / evidence |
|---|---|---|
| `Boolean` coil or single register bit | `bit` | Existing CandidateSignal vocabulary; same function/address/bit. |
| Undocumented mode defaulted to R/W | `unknown`, warning, writes disabled | An absent access label cannot establish write capability. |
| `0: Read` / numbered Read labels | `R` | Literal MAPS PDF access label. The Signal fallback incorrectly returned R/W. |
| `1: Trigger` | `Trigger`, excluded by default | Literal PDF label; retained as an inactive native signal when explicitly included for import/export. |
| `W/R` | `R/W` | Preserves Signal's parsed access; regression covered. |
| Bits 0–15 as one aggregate bitfield | Raw `uint16`, no single-bit extraction, warning | Preserves the complete register, count and address rather than truncating it to one Boolean. Covered by the Haier fixture. |
| Partial multi-bit spans or bits above 15 | Explicit warning; raw row retained, no unsupported candidate | Current CandidateSignal cannot express the span. This remains a representation limitation; no such row occurs in this real PDF or the original 41 test cases. |
| Addressed reserved rows | Retained, disabled | Keeps document coverage, excludes reserved addresses from default validation/import. |
| Documented 32/64-bit scalar span | One atomic wider read; byte order required | Existing MAPS live reader/export capabilities. No physical 64-bit test was made in this run. |
| Six-digit PLC addresses | Explicit conversion to PDU offset | Existing MAPS extension; five-digit notation remains Signal's rule. |
| Unresolved formula / out-of-range PDU span | Warning, no invented candidate address | Raw source remains available for review. Original Signal formula/expansion rules are retained before this check. |
| Conditional limits | Envelope plus warning | One MAPS min/max cannot express operating-mode-specific limits. |
| `x100 hours` / `%100 hours` | Scale and engineering unit unresolved, warning | Avoid treating a compound duration counter as an inverse multiplier or percent. Manufacturer conversion is not specified by this signal list. |
| Generic `Bit 0 / Size 1 / Factor / Sign` scalar layout | Raw whole register, warning | Baxi's MAPS raw response copied the generic Bit column into `sourceBit`, unlike the Signal response. This layout is distinguished from a meaningful named flag before normalization; actual bit masks remain unchanged. The original raw response is retained. |
| One quoted address cell wrapping as `49\n5` | Candidate address 495, original source string/quote and warning retained | Both digits belong to the same Baxi cell, confirmed visually. A narrowly bounded preprocessing rule joins this final wrapped digit; lists, ranges and formulas are not joined. |

Duplicate addresses and model applicability are preserved and flagged for review. The comparison covers Signal's structured normalizer and template expansion, not every later Signal UI/export postprocessor.

## PDF extraction comparison

Input: **signal_list_controller1.pdf**, 2 pages, 55 printed rows.

SHA-256: `0fb98bcd1c0e12e4` is the artifact-directory prefix; the complete hash is in the real-PDF fixture and comparison JSON.

| Measurement | Actual Signal extractor | Actual MAPS service |
|---|---:|---:|
| Signals | 55 | 55 |
| Same raw Signal response through MAPS | — | 55 |
| Same raw MAPS response through Signal | 55 | — |
| Signals missing / extra | 0 | 0 |
| Function/address/bit differences | 0 | 0 |
| Signed/unsigned format differences | 0 | 0 |

Both extractions used **OpenAI · gpt-6.1-sol**. Signal's model selection was overridden in the comparison harness in memory, with retries disabled; Signal files were not edited. Its installed SDK warned that it did not recognize reasoning-effort support for that model. MAPS sent the configured medium effort. Therefore this is a same-provider/model comparison, not a claim that the old Signal SDK sent an identical reasoning configuration.

The adapted MAPS map has **8 R**, **16 R/W** and **31 Trigger** rows. Signal's baseline has R/W for all 55 rows, including its fallback for Read and Trigger labels. Those 39 access differences are explained above. Reads have not verified either R/W or Trigger behavior.

The nine rows whose source says `x10ºC` retain factor **0.1**. The two hours-counter rows differ deliberately: at 107, Signal's factor 0.01 and unit h become unresolved; at 108, Signal's percent unit becomes unresolved. No further type/scale/unit discrepancy was found for this PDF.

Addresses are `0–29`, `100–116`, `121–126`, `136–137`, including the printed nonsequential order `18, 28, 29, 19`. No gaps were filled with invented signals. The source does not identify the manufacturer/model or explicitly specify FC03 or the address-base convention; those remain source warnings. Live FC03 readability is recorded separately.

## Additional manufacturer PDFs — 2026-10-04

Both supplied PDFs were run through the actual unchanged Signal structured extractor and actual MAPS extraction service using **OpenAI · gpt-6.1-sol**. The same SDK-effort caveat described above applies. Exactly **four new paid requests** were made: one extraction per system per PDF. All subsequent corrections, comparison, fixtures and tests used the saved responses and made no AI requests. No gateway connection or deployment was made in this follow-up.

| PDF | Pages | Signal occurrences | Final MAPS occurrences | Missing/extra | Final function/address/bit/type/scale/unit/access differences |
|---|---:|---:|---:|---:|---:|
| BDR Thermea Baxi — Platinum BC (P.Mod.RTU) | 5 | 19 | 19 | 0 | 0 |
| Gree — Versati Modbus RTU (VM), Signal Ready | 2 | 50 | 50 | 0 | 0 |

### Baxi: initial failure, corrected by deterministic replay

Source SHA-256: `b08cc2c3ddcfd080334f0cafb3241bc4f8a1fa86eae32250c9f1fa51d44295c8`.

The initial MAPS result had the correct **19-row count**, but was not correct:

- All **12 holding-register occurrences** were incorrectly represented as bit 0 / Boolean because the AI copied the generic `Bit=0` layout column into `sourceBit`. The Signal response kept that column as raw `dataText` and returned whole registers.
- The last printed index is **495**, wrapped as `49` and `5` in the same cell. MAPS preserved `49\n5` in the raw response, but Signal's numeric-token parser then selected the final digit, producing address **5**. Signal's separate paid response correctly returned 495.

MAPS now distinguishes this explicit scalar-layout pattern from actual bit-coded rows, and joins the narrowly identified wrapped address. Both transformations happen before the unchanged copied normalization core; original raw JSON, source address and quote are retained, with visible review warnings. The extraction instructions also clarify both cases. A fresh paid extraction with the clarified prompt was deliberately **not** repeated; the repaired pipeline was tested against the exact original problematic response.

After the correction, all 19 occurrences match the reference on function, address, bit, type, scale, unit and access. There are **14 distinct function/address pairs**: the other five occurrences repeat rows in cold/hot/start-up instructions. Repeated addresses are retained and flagged for review, rather than advertised as 19 distinct device points.

This excerpt is not a complete device map. HR200 is mentioned only in prose and has no addressed table row; neither extractor invented a row for it. The source uses both Coil61 and HR61 for pump control; both are preserved as printed. `Real` at HR201 does not specify a confirmed wire width/order, and both reference maps retain a raw UINT16 candidate. These document ambiguities still require manufacturer clarification or live review; matching Signal does not prove their engineering interpretation.

### Gree: no correction required

Source SHA-256: `6f60914031d4615eab32f91b6d7f682bd3dc5126d467609d76d8b467a9eb0eb6`.

The initial and final results match: **22 holding registers + 28 coils**, including the coil table continuing from page 1 to page 2. All addresses remain in the explicit zero-based convention. `W/R` is retained as R/W: **23 R/W** and **27 R** signals. All 13 temperature-unit rows retain °C, and running frequency retains Hz. There is no documented multiplier requiring a scale conversion in this PDF.

The source explicitly says Unsigned while giving negative ranges for some temperatures. Both systems preserve the stated unsigned representation. Neither extraction proves how negative temperatures are encoded; do not treat extraction parity as a hardware validation.

### Saved evidence and regression coverage

- Unmodified paid responses, initial comparison snapshots, final `comparison.json` and per-row CSVs remain local/ignored under `.local-data/signal-comparison/b08cc2c3ddcfd080/` and `6f60914031d4615e/`.
- `fixtures/manufacturer-real-pdfs.json` contains both paid raw responses per PDF, complete source-page text, source hashes, model profile, Signal commit and outputs produced by the actual unchanged Signal normalizer.
- `manufacturer-real-pdfs.test.ts` replays both responses through both normalization representations. It checks every final function/address/bit/type/scale/unit/access tuple, repeated Baxi rows, the 495 wrap, preservation of genuine register bits, inherited table hints, and Gree's page continuation/W/R labels.
- The initial defective Baxi output is kept separately as `comparison-initial.json`; the two comparison maps are isolated projects. Only Baxi's candidate revision was updated by offline renormalization. No existing project or real gateway configuration was changed.

## Document grouping and context

MAPS uses up to **40 native PDF pages per OpenAI request**, and an entire supported Claude document up to the conservative **100-page** ceiling. Larger documents are split; complete groups remain durable and Resume does not pay for them again. Resume uses the current Settings profile by default and preserves the profiles/results of completed groups.

An important correction to the earlier feedback: Signal's generic OpenAI file importer has a 40-page setting, but its structured Modbus streaming extractor used for this comparison submits the whole PDF. The agreed MAPS 40-page grouping is therefore an explicit implementation choice, not an exact copy of that path. This two-page PDF fits both paths in one request.

Document-wide addressing/unit-count notes and neighbouring-page text are carried with each group. Local tests specifically cover a page-3 one-based-address note reaching page 41 and a table continuing across page 40/41. They verify request context and preserved normalization provenance. They do not replace a paid comparison on a long manual; that remains pending.

The conservative Claude ceiling comes from its [official PDF support documentation](https://platform.claude.com/docs/en/build-with-claude/pdf-support); the application does not explicitly request a 1M context for every model. OpenAI PDF handling follows its [official file-input documentation](https://developers.openai.com/api/docs/guides/file-inputs). MAPS also retains its own 20 MB / 200-page upload limit.

## Live RTU result

Gateway: **192.168.2.167**, **IN-KNX-MBM**, series 700, app 2.0.2.0. RTU: **9600 baud, 8N1, slave 1**, using the node/settings received from the gateway. The original XBL generator was verified byte-for-byte before uploading any temporary configuration.

Capture: `63e38a4f-7ee3-42d4-97f8-3cf6c1e811fb`.

- 24 targeted one-register FC03 reads; at least 4 samples per point, 106 successful responses in total.
- 0 recorded Modbus exceptions and 0 timeouts.
- 31 documented Trigger rows were never probed. No Modbus writes were issued.
- Original master configuration backed up durably before the temporary configuration was sent.
- Automatic restoration completed; `needsRestore=false`.

Backup and restored SHA-256, both:

`3c644daac76c92891912bcf89969dc498e5c21e9f653266124eec9d85663e763`

| PDU address | Document candidate | Raw word | Decoded candidate |
|---:|---|---:|---:|
| 100 | On/Off | 1 | 1 |
| 101 | Operation Mode IC | 4 | 4 |
| 104 | Temperature Setpoint | 250 | 25 °C |
| 105 | Ambient Temperature | 236 | 23.6 °C |
| 121 | Minimum cool setpoint restriction | 180 | 18 °C |
| 122 | Maximum cool setpoint restriction | 320 | 32 °C |
| 123 | Minimum heat setpoint restriction | 160 | 16 °C |
| 124 | Maximum heat setpoint restriction | 280 | 28 °C |
| 125 | Minimum auto setpoint restriction | 160 | 16 °C |
| 126 | Maximum auto setpoint restriction | 320 | 32 °C |

The table records decoded candidates, not independently proven semantics. No external before/after change was performed in this run: **scale and meaning remain Pending**, encoding is **Plausible**, and access remains **Untested**. The interface was checked with these actual saved results.

One **gpt-6-luna** diagnosis completed in **17.7 s**, returning 12 evidence-based findings and no proposed corrections. It correctly distinguished document claims and plausible temperatures from independent live validation. No findings were automatically applied.

## Native template / workflow verification

A separate draft-copy export produced `controller1-comparison-draft.knxmbm` and reopened through the native MAPS reader:

- 55 signals; 24 active and 31 inactive Trigger rows.
- All Modbus write functions disabled; KNX write flags disabled.
- Same address list after encryption/export/reopen.
- No live-validation metadata, PDF provenance or AI confidence written into MAPS XML.
- The received project was not modified. The saved document map was not automatically marked reviewed.

The app at port **3002** contains project **Controller 1 — PDF validation**. In Devices → Add from PDF / scan → recent maps, **signal_list_controller1.pdf** shows **55 signals · Has captures**. Live check displays the real values, AI evidence and pending scale/meaning checks.

## Cost / artifacts / remaining acceptance

Exactly **7 paid requests in total** were made across the validation: the original Controller 1 Signal extraction, MAPS extraction and Luna diagnosis, followed by four manufacturer-PDF extraction requests. Local tests, normalizer replay, PDF rendering and template checks made no paid requests. Each PDF comparison keeps a durable two-extraction-request journal; replay after completion made **zero** additional requests.

Local, ignored artifacts are under `.local-data/signal-comparison/0fb98bcd1c0e12e4/`: both raw responses, `comparison.json`, the initial comparison snapshot, live report, diagnosis, the draft native template, the template round-trip receipt and verification logs. The gateway backup remains local and ignored.

`row-comparison.csv` records function/address, format, scale, unit, access and live samples for all 55 Controller 1 rows; each manufacturer directory has its own per-occurrence field comparison CSV. Final local verification: **1,336 tests passed, 46 skipped, 116 test files passed**; standalone type checking, lint and production build passed. This includes 14 new manufacturer regression tests. The first broad run alongside the build hit the existing 5-second Undo UI test timeout; rerunning with four workers passed without another code change. One existing asynchronous Signals UI test had previously been corrected to wait for the Undo button rather than only the request invocation; production behavior was unchanged.

Port **3002** was restarted with the final build. The isolated Baxi and Gree comparison projects retain the saved maps for review. Signal's tracked working tree remains unchanged, and MAPS HEAD remains `b78526e` with these changes uncommitted.

Remaining review and coverage:

1. Review this comparison, especially the deliberate access/compound-hours differences and the Baxi scalar-layout/wrapped-address corrections, before committing.
2. The requested two additional selected PDFs are complete. A long document crossing the 40-page grouping boundary remains untested with paid AI; the existing local context tests cover that request construction only.
3. Run a guided external before/after change if independent scale/meaning validation is required. Static plausible values are insufficient.
4. Physical 64-bit RTU support remains untested because this supplied device map contains only 16-bit registers.

No changes were made to Signal. Validation was recorded before committing or merging this worktree.

## Follow-up: ambiguous address requires explicit confirmation

After review, the quoted digit-wrap rule was changed from automatic correction to a proposal. Baxi's wrapped `49\n5` is now shown as **Possible address: 495**, with `addressNeedsConfirmation=true`, and is excluded from capture and import until the user confirms the PDU address in the Map editor. Existing saved maps containing the previous automatic-wrap warning are moved to the same pending state when loaded by the service. Bulk review cannot confirm the address. The source quote remains unchanged; Signal is untouched.

No tests, build or visual checks were run for this follow-up, as explicitly requested. The successful verification counts above describe the preceding revision.
