/**
 * XML → field-struct parsing for the family-independent XBL nodes: the
 * project `<Header>` and `<IBOX>` elements (incl. USB and security config).
 * Shared by every family's XBL pipeline; moved out of the KNX–MBM pipeline in
 * step 2.4.
 *
 * Provenance: `IntesisProject` header/IBOX parsing (ProjectParser.cs) and the
 * `UsbConfig(XmlNode)` / `SecurityConfig(XmlNode)` constructors.
 */

import { getAttr, XmlDocument, type XmlElement } from "@/core/project-format";
import type { XblHeaderFields, XblIboxFields } from "./nodes-common";

function parseBoolText(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function parseBoolAttr(el: XmlElement | undefined, name: string, fallback: boolean): boolean {
  return parseBoolText(el ? getAttr(el, name) : undefined, fallback);
}

function parseNumberAttr(el: XmlElement | undefined, name: string, fallback: number): number {
  const v = el ? getAttr(el, name) : undefined;
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseXblHeader(doc: XmlDocument): XblHeaderFields {
  return {
    description: doc.getAttr(["Header"], "Description") ?? "",
    compVersion: doc.getAttr(["Header"], "CompatibilityVersion") ?? "0.0.0.0",
    // C# uses Convert.ToBoolean ("True"/"False"); tolerate "1"/"0" too.
    endianess: ["true", "1"].includes(
      (doc.getAttr(["Header"], "Endianess") ?? "").toLowerCase(),
    ),
  };
}

export function parseXblIbox(doc: XmlDocument): XblIboxFields {
  const usbEl = doc.find(["IBOX", "USBConfig"]);
  const secEl = doc.find(["IBOX", "SecurityConfiguration"]);
  return {
    ip: doc.getAttr(["IBOX"], "IP") ?? "",
    netmask: doc.getAttr(["IBOX"], "NetMask") ?? "",
    gateway: doc.getAttr(["IBOX"], "Gateway") ?? "",
    dhcp: parseBoolText(doc.getAttr(["IBOX"], "DHCP"), false),
    // The gateway password is part of the compiled XBL (IBOX tag 5). The
    // generator reads it straight from the XML — never from the UI model.
    pwd: doc.getAttr(["IBOX"], "Pwd") ?? "",
    name: doc.getAttr(["IBOX"], "Name") ?? "",
    dns: doc.getAttr(["IBOX"], "DNS") ?? "",
    dns2: doc.getAttr(["IBOX"], "DNS2") ?? "",
    // UsbConfig(XmlNode) defaults: all flags true, levels 1.
    usb: {
      getLogs: parseBoolAttr(usbEl, "GetLogs", true),
      getProject: parseBoolAttr(usbEl, "GetProject", true),
      saveProject: parseBoolAttr(usbEl, "SaveProject", true),
      saveFirm: parseBoolAttr(usbEl, "SaveFirm", true),
      spons: parseBoolAttr(usbEl, "SponsEnabled", true),
      comms: parseBoolAttr(usbEl, "CommsEnabled", true),
      debugLevel: parseNumberAttr(usbEl, "DebugLevel", 1),
      verboseLevel: parseNumberAttr(usbEl, "VerboseLevel", 1),
    },
    // SecurityConfig(XmlNode) defaults: all false, port 23. IsLow is a
    // runtime-only property (IntesisLicense.IsLowProject) — false for the
    // families exercised so far.
    security: {
      tcpDisabled: parseBoolAttr(secEl, "TCPDisabled", false),
      udpDisabled: parseBoolAttr(secEl, "UDPDisabled", false),
      customPort: parseBoolAttr(secEl, "CustomPort", false),
      port: parseNumberAttr(secEl, "Port", 23),
    },
  };
}
