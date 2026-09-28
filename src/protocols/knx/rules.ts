import { isValidGroupAddress } from "./address";
import { isValidDpt } from "./dpt";
import { hasAnyFlag } from "./flags";
import type { KnxEndpoint } from "./model";

/**
 * Pure checks of one KNX object (`InternalKnx.CheckProjectObjects` /
 * `ExternalKnx.CheckProjectObjects`, plus the DPT and Ri/R rules of the
 * signals grid). The family validator maps codes to messages and refs, in
 * the order returned here.
 */
export type KnxRuleCode =
  | "KNX-GA-FORMAT"
  | "KNX-GA-EXTENDED"
  | "KNX-DPT-INVALID"
  | "KNX-FLAGS-NONE"
  | "KNX-FLAGS-RI-R"
  | "KNX-FLAGS-LISTEN";

export function checkKnxEndpoint(knx: KnxEndpoint, options: { extended: boolean }): KnxRuleCode[] {
  const violations: KnxRuleCode[] = [];
  if (!isValidGroupAddress(knx.groupAddress, { extended: options.extended })) {
    violations.push(knx.groupAddress > 32767 && !options.extended ? "KNX-GA-EXTENDED" : "KNX-GA-FORMAT");
  }
  if (!isValidDpt(knx.dpt)) violations.push("KNX-DPT-INVALID");
  if (!hasAnyFlag(knx.flags)) violations.push("KNX-FLAGS-NONE");
  if (knx.flags.ri && knx.flags.r) violations.push("KNX-FLAGS-RI-R");
  if (knx.additionalAddresses.length > 0 && !knx.flags.u && !knx.flags.w) {
    violations.push("KNX-FLAGS-LISTEN");
  }
  return violations;
}
