import { describe, expect, it } from "vitest";
import type { GatewayInfoSummary } from "../intesis-transport";
import { evaluateGatewayCompatibility, type ProjectClassIdentity } from "./gateway-compat";

const KNX_MBM: ProjectClassIdentity = {
  displayName: "KNX ↔ Modbus Master",
  unitLabel: "KNX–MBM unit",
  applicationIds: [4],
  blankAppId: 63,
};
const ME_MBS: ProjectClassIdentity = {
  displayName: "Mitsubishi Electric AC ↔ Modbus Slave",
  unitLabel: "ME unit",
  applicationIds: [64, 8],
  blankAppId: 61,
};

function gateway(info: Partial<GatewayInfoSummary>): GatewayInfoSummary {
  return { platform: "700 Series", bootloader: false, noApp: false, ...info };
}

describe("evaluateGatewayCompatibility (EvaluateConnectionWithGw)", () => {
  it("accepts a 700 Series gateway running one of the class ApplicationIDs", () => {
    expect(evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 4 }))).toEqual({
      ok: true,
      detail: "Gateway reports AppId 4 (KNX–MBM unit)",
    });
    expect(evaluateGatewayCompatibility(ME_MBS, gateway({ appId: 64 })).ok).toBe(true);
    expect(evaluateGatewayCompatibility(ME_MBS, gateway({ appId: 8 })).ok).toBe(true);
  });

  it("rejects a gateway without a platform with the MAPS legacy-gateway message", () => {
    const result = evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 4, platform: undefined }));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/^Current 700 Series project is not compatible with legacy gateways/);
    expect(evaluateGatewayCompatibility(KNX_MBM, undefined).ok).toBe(false);
  });

  it("rejects another platform, a unit in bootloader and a unit without application", () => {
    expect(evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 4, platform: "V6" })).detail).toMatch(/platform "V6"/);
    expect(evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 4, bootloader: true })).detail).toMatch(/Bootloader Mode/);
    expect(evaluateGatewayCompatibility(KNX_MBM, gateway({ noApp: true })).detail).toMatch(/Bootloader Mode/);
  });

  it("rejects the blank firmware MAPS would load the family firmware onto", () => {
    const result = evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 63 }));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no application firmware \(AppId 63\).*cannot change the gateway firmware/);
    // XX_AC_XXX is the blank firmware of the AC classes, not of KNX–MBM.
    expect(evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 61 })).detail).toBe(
      "Gateway AppId 61 is not compatible with a KNX ↔ Modbus Master project (AppId 4).",
    );
    expect(evaluateGatewayCompatibility(ME_MBS, gateway({ appId: 61 })).detail).toMatch(/no application firmware/);
  });

  it("rejects another application, naming the firmware change MAPS would offer", () => {
    const result = evaluateGatewayCompatibility(KNX_MBM, gateway({ appId: 7 }));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/^Gateway AppId 7 is not compatible with a KNX ↔ Modbus Master project \(AppId 4\)\. MAPS offers/);
    expect(evaluateGatewayCompatibility(ME_MBS, gateway({})).detail).toBe(
      "Gateway AppId unknown is not compatible with a Mitsubishi Electric AC ↔ Modbus Slave project (AppId 64 or 8).",
    );
  });
});
