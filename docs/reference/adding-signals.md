# Adding free signal rows

The Signals toolbar keeps a one-click **Add signal** action. Its adjacent menu
opens **Add multiple signals…**, with quantity, insertion position, device,
mapping type, enabled state and optional starting addresses. ME–MBS remains
generated from AC units and does not expose this action.

The original desktop sources are `IntesisProjectKnxMbm_RT.CreateNewRow` and
`CreateRows`, `IntesisProjectMBSKNX_RT.CreateNewRow`, and
`IntesisKnx.GetNextGA`, under the local decompiled MAPS reference. KNX–MBM
creates DPT 1.001 with FC03/FC06, a 16-bit unsigned register, bit 0/count 1
and zero deadband. The web default keeps these values, with U/T/W/R enabled
as in desktop batch creation, and assigns an enabled device. MBS–KNX keeps
DPT 7.x, a 16-bit unsigned read/write register and a disabled Modbus signal.

Intentional improvements over desktop:

- Sending and listening group addresses are reserved across all rows.
- Modbus allocation reserves complete register spans, including disabled
  rows, separately for each master device and register space.
- A 32-bit unsigned profile uses two registers and FC16 on the master side.
- A missing/ambiguous master device is requested before creating any row.
- Names are unique and nonempty. Existing mappings are not copied implicitly.
- Address exhaustion/collisions reject the entire batch; addresses never wrap.

`core/signals/add-signals.ts` supplies the same pure plan to the UI preview
and the server. The server recalculates it under the project revision lock,
then patches both preserved XML protocol sides. Insertion moves the appended
block and renumbers aligned IDs. Undo deletes the created IDs in one batch;
later operations that renumber IDs invalidate earlier undo/selection state.
The existing low-level `addSignal` builders stay available to imports and
fixtures, which populate their own mappings rather than using interactive
creation defaults.

Limits are 500 rows per creation request, 5000 total rows and 3000 active rows.
The single-create and bulk-create paths use the same server operation.
