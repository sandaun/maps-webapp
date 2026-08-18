import { describe, expect, it } from "vitest";
import { computeBroadcastAddress, parseDiscoveryResponse } from "./discovery";

// Discovery datagram shape per PROTOCOL.md §2.1: banner line + INFO lines.
const DATAGRAM =
  "IntesisBox\r\n" +
  "INFO:GWNAME:IN-KNX-MBM-TEST\r\n" +
  "INFO:SN:000R12345\r\n" +
  "INFO:APPNAME:IN-KNX-MBM\r\n" +
  "INFO:APPID:4\r\n" +
  "INFO:ETHMAC:CC:3F:1D:07:7F:F8\r\n" +
  "INFO:NETIP:192.168.1.50\r\n" +
  "INFO:NETMASK:255.255.255.0\r\n" +
  "INFO:NETDHCP:0\r\n" +
  "INFO:END\r\n";

describe("parseDiscoveryResponse", () => {
  it("parses a banner + INFO datagram", () => {
    const parsed = parseDiscoveryResponse(new TextEncoder().encode(DATAGRAM));
    expect(parsed).toBeDefined();
    expect(parsed!.info).toMatchObject({
      name: "IN-KNX-MBM-TEST",
      serial: "000R12345",
      appId: 4,
      mac: "CC:3F:1D:07:7F:F8",
      ip: "192.168.1.50",
      dhcp: false,
    });
    expect(parsed!.raw["NETMASK"]).toBe("255.255.255.0");
  });

  it("accepts payloads without the banner (INFO lines only)", () => {
    const parsed = parseDiscoveryResponse("INFO:GWNAME:X\r\nINFO:END\r\n");
    expect(parsed?.info.name).toBe("X");
  });

  it("rejects unrelated datagrams", () => {
    expect(parseDiscoveryResponse("hello world")).toBeUndefined();
    expect(parseDiscoveryResponse(new Uint8Array(0))).toBeUndefined();
  });
});

describe("computeBroadcastAddress", () => {
  it("computes ip | ~mask", () => {
    expect(computeBroadcastAddress("192.168.1.10", "255.255.255.0")).toBe("192.168.1.255");
    expect(computeBroadcastAddress("10.0.1.2", "255.255.0.0")).toBe("10.0.255.255");
    expect(computeBroadcastAddress("172.16.4.9", "255.255.255.128")).toBe("172.16.4.127");
  });
});
