import "server-only";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import { formatDpt, formatGroupAddress } from "@/protocols/knx";

/**
 * Inverse of `EsfProjectParser.CreateESFExtractionRow`: ETS-style TSV
 * `Main.Middle.Sub \t name \t DPT`.
 */
export function buildKnxEsf(project: KnxMbmProject): string {
  const lines: string[] = [];
  for (const signal of project.signals) {
    if (signal.knx.groupAddress <= 0) continue;
    const ga = formatGroupAddress(signal.knx.groupAddress).replaceAll("/", ".");
    lines.push(`${ga}\t${signal.description}\t${formatDpt(signal.knx.dpt)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}
