import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml as knxMbmFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { projectFromXml as mbsKnxFromXml } from "@/gateway-families/mbs-knx/from-xml";
import { knxMbmColumns, toKnxRow } from "./columns-knx-mbm";
import { mbsKnxColumns, toMbsKnxRow } from "./columns-mbs-knx";

describe("group address level in the signal tables", () => {
  const knxMbm = knxMbmFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
  const mbsKnx = mbsKnxFromXml(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML));
  const families = [
    {
      name: "KNX–MBM",
      column: knxMbmColumns(knxMbm).find((c) => c.id === "groupAddress")!,
      row: (level?: 1 | 2 | 3) => {
        const signal = knxMbm.signals[0];
        return toKnxRow(knxMbm.mbm, { ...signal, knx: { ...signal.knx, groupAddress: 2563, groupAddressLevel: level } });
      },
    },
    {
      name: "MBS–KNX",
      column: mbsKnxColumns(mbsKnx).find((c) => c.id === "groupAddress")!,
      row: (level?: 1 | 2 | 3) => {
        const signal = mbsKnx.signals[0];
        return toMbsKnxRow({ ...signal, knx: { ...signal.knx, groupAddress: 2563, groupAddressLevel: level } });
      },
    },
  ];

  for (const { name, column, row } of families) {
    it(`${name}: shows the stored level`, () => {
      expect(column.getText!(row() as never)).toBe("1/2/3");
      expect(column.getText!(row(2) as never)).toBe("1/515");
      expect(column.getText!(row(1) as never)).toBe("2563");
    });

    it(`${name}: keeps the level the user typed`, () => {
      expect(column.parse!(row() as never, "1/515")).toEqual({
        patch: { knx: { groupAddress: 2563, groupAddressLevel: 2 } },
      });
      expect(column.parse!(row() as never, "2563")).toEqual({
        patch: { knx: { groupAddress: 2563, groupAddressLevel: 1 } },
      });
      expect(column.parse!(row(2) as never, "1/2/3")).toEqual({
        patch: { knx: { groupAddress: 2563, groupAddressLevel: 3 } },
      });
    });

    it(`${name}: undo restores the previous level`, () => {
      expect(column.inverseFromText!(row(2) as never)).toEqual({
        knx: { groupAddress: 2563, groupAddressLevel: 2 },
      });
      expect(column.inverseFromText!(row() as never)).toEqual({
        knx: { groupAddress: 2563, groupAddressLevel: 3 },
      });
    });
  }
});
