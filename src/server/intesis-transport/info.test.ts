import { describe, expect, it } from "vitest";
import { parseInfoLines, summarizeInfo } from "./info";

// Documented live response (PROTOCOL.md §8.5, unit IN-BAC-MBM-ATW).
const DOCUMENTED_RESPONSE = [
  "INFO:GWNAME:IN-BAC-MBM-ATW",
  "INFO:SN:000R42735",
  "INFO:BARCODE:00109260350233",
  "INFO:APPNAME:IN-xxx-MBM",
  "INFO:APPLIC:100",
  "INFO:LIC_LOAD_STATUS:0",
  "INFO:APPID:78",
  "INFO:APPVERSION:1.0.1.0",
  "INFO:PLATFORM:700 Series",
  "INFO:P0VERSION:BACnet Server:2.1.12.0",
  "INFO:P1VERSION:Modbus Master:2.0.14.0",
  "INFO:COREVERSION:2.0.57.0",
  "INFO:RSVERSION:2.1.18.0",
  "INFO:SDKVERSION:25.6.0.2",
  "INFO:CFGNAME:IN-BAC-MBM-ATW",
  "INFO:CFGFILEDATE:28/07/2026 17:03:25",
  "INFO:CFGFILEXCHG:N",
  "INFO:MID:1",
  "INFO:ETHMAC:CC:3F:1D:07:7F:F8",
  "INFO:NETIP:192.168.2.34",
  "INFO:NETMASK:255.255.255.0",
  "INFO:NETGW:192.168.2.1",
  "INFO:NETDNS1:8.8.8.8",
  "INFO:NETDNS2:",
  "INFO:NETDHCP:0",
  "INFO:UPTIME:2 days",
  "INFO:DATETIME:28/07/2026 17:05:00",
  "INFO:DSRVCS:0",
  "INFO:PCBID:109",
  "INFO:CFGERRORS:0",
  "INFO:COMPIDs:9",
  "INFO:HWIDs:2",
  "INFO:STATUS:RUNNING",
  "INFO:END",
].join("\r\n");

describe("parseInfoLines", () => {
  it("parses the documented INFO? response", () => {
    const info = parseInfoLines(DOCUMENTED_RESPONSE);
    expect(info.complete).toBe(true);
    expect(info.entries.length).toBe(33);
    expect(info.byKey["GWNAME"]).toBe("IN-BAC-MBM-ATW");
    expect(info.byKey["APPID"]).toBe("78");
    expect(info.byKey["NETDNS2"]).toBe(""); // empty value is kept
  });

  it("marks responses without INFO:END as incomplete", () => {
    const info = parseInfoLines("INFO:GWNAME:X\r\n");
    expect(info.complete).toBe(false);
  });

  it("ignores non-INFO lines (e.g. SKT ACKs mixed in the stream)", () => {
    const info = parseInfoLines("SKT1 - OK\r\nINFO:GWNAME:X\r\nINFO:END\r\n");
    expect(info.complete).toBe(true);
    expect(info.entries).toEqual([{ key: "GWNAME", value: "X" }]);
  });

  it("keeps values containing colons (P0VERSION)", () => {
    const info = parseInfoLines(DOCUMENTED_RESPONSE);
    expect(info.byKey["P0VERSION"]).toBe("BACnet Server:2.1.12.0");
  });
});

describe("summarizeInfo", () => {
  it("extracts the common typed fields", () => {
    const summary = summarizeInfo(parseInfoLines(DOCUMENTED_RESPONSE));
    expect(summary).toMatchObject({
      name: "IN-BAC-MBM-ATW",
      serial: "000R42735",
      appName: "IN-xxx-MBM",
      appId: 78,
      appVersion: "1.0.1.0",
      platform: "700 Series",
      mac: "CC:3F:1D:07:7F:F8",
      ip: "192.168.2.34",
      netmask: "255.255.255.0",
      gateway: "192.168.2.1",
      dhcp: false,
      status: "RUNNING",
      bootloader: false,
      noApp: false,
    });
  });

  it("detects bootloader and no-app units", () => {
    const bl = summarizeInfo(parseInfoLines("INFO:STATUS:BL\r\nINFO:END\r\n"));
    expect(bl.bootloader).toBe(true);
    const noApp = summarizeInfo(parseInfoLines("INFO:NOAPP\r\nINFO:END\r\n"));
    expect(noApp.noApp).toBe(true);
  });

  it("parses NETDHCP ON/OFF as sent by real 700 Series units", () => {
    // Observed on a live 770 Air (core 2.0.52.0): INFO:NETDHCP:ON.
    expect(summarizeInfo(parseInfoLines("INFO:NETDHCP:ON\r\nINFO:END\r\n")).dhcp).toBe(true);
    expect(summarizeInfo(parseInfoLines("INFO:NETDHCP:OFF\r\nINFO:END\r\n")).dhcp).toBe(false);
  });
});
