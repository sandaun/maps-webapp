import type { ConversionRwMode } from "@/core/signals/conversion-refs";
import { FORMATS, READ_WRITE, type MbsReadWrite } from "./types";

/**
 * Modbus Slave side of a signal row (`MbsObject`, MbsObject.cs), as the
 * webapp models it. Shared by every family whose BMS side is Modbus Slave;
 * a family may extend it with its own fields.
 */
export interface MbsEndpoint {
  address: number;
  /** 255 = no bit field. */
  bit: number;
  lenBits: number;
  /** MbmObjectType: 0 Unsigned, 1 Signed C2, 2 Signed C1, 3 Float, 4 BitFields, 5 String. */
  format: number;
  readWrite: MbsReadWrite;
  /** -1 = not a string. */
  stringLength: number;
  /** -1 in SINGLE slave mode. */
  slaveIndex: number;
}

export function defaultMbsEndpoint(): MbsEndpoint {
  return { address: 0, bit: 255, lenBits: 16, format: 0, readWrite: 2, stringLength: -1, slaveIndex: -1 };
}

/**
 * Port of `MbsObject.GetRwMode` (MbsObject.cs:489-497): the mode a Modbus
 * Slave object hands to the object on the other side, which fits its KNX
 * flags with it (`ExternalKnx.SetRwProject` / `UpdateFlagsValueFromRWObject`).
 * A register the BMS only reads is written into by the other side
 * ("write"); a trigger is read from it ("read"). NOT the conversion
 * direction: see `mbsConversionRwMode`.
 */
export function mbsObjectRwMode(readWrite: number): ConversionRwMode {
  if (readWrite === READ_WRITE.READ) return "write";
  if (readWrite === READ_WRITE.TRIGGER) return "read";
  return "readwrite";
}

/**
 * Conversion direction of a Modbus Slave object, as `frmSelectConversion`
 * sees it (`ConversionObject(MbsObject)`, ConversionObject.cs:83-100): Read →
 * "read", Trigger → "write", Read/Write → "readwrite". The opposite of
 * `mbsObjectRwMode` for Read and Trigger.
 */
export function mbsConversionRwMode(readWrite: number): ConversionRwMode {
  if (readWrite === READ_WRITE.READ) return "read";
  if (readWrite === READ_WRITE.TRIGGER) return "write";
  return "readwrite";
}

/**
 * The length, format and bit a Modbus Slave row keeps after an edit in MAPS:
 * every cell edit re-checks the row (`InternalMbs.CheckThisRow`,
 * InternalMbs.cs:1233-1283) and saves it back (`SaveThisRow`, :1104-1132).
 * BitFields forces 16 bits and, when the bit cell showed "-" (the row was not
 * BitFields), bit 0; any other format shows the bit as "-", which is saved as
 * -1. `loaded` is the row as MAPS loaded it; `patch` the edited fields.
 */
export function fitMbsRowEdit(
  loaded: Pick<MbsEndpoint, "lenBits" | "format" | "bit">,
  patch: Partial<Pick<MbsEndpoint, "lenBits" | "format" | "bit">>,
): Pick<MbsEndpoint, "lenBits" | "format" | "bit"> {
  const next = { ...loaded, ...patch };
  if (next.format !== FORMATS.BITFIELDS) return { ...next, bit: -1 };
  const bitShowedDash = loaded.format !== FORMATS.BITFIELDS;
  return {
    lenBits: 16,
    format: next.format,
    bit: patch.bit !== undefined ? patch.bit : bitShowedDash ? 0 : next.bit,
  };
}
