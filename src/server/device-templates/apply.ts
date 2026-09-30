import "server-only";
import { appendChildIndented, element, getAttr, setAttr, XmlDocument, type XmlElement } from "@/core/project-format";
import { MAX_ACTIVE_SIGNALS, MAX_MODBUS_DEVICES, MAX_TOTAL_SIGNAL_ROWS } from "@/core/signals/model";
import { formatConversionIds, readHalfConversionRefs } from "@/core/signals/conversion-refs";
import { parseFloatLenient } from "@/core/xbl/conversions";
import { addSignal, projectFromXml, updateSignal } from "@/gateway-families/knx-mbm";
import { ProjectServiceError } from "@/server/projects/errors";
import type { ApplyDeviceTemplate } from "@/core/device-templates/types";
import type { ParsedDeviceTemplate } from "./read";
import { children, child, copy, write, value } from "./xml";

export function applyDeviceTemplate(doc: XmlDocument, template: ParsedDeviceTemplate, options: ApplyDeviceTemplate): void {
  const project = projectFromXml(doc);
  const nodes = options.locator.kind === "rtu"
    ? doc.findAll(["ExternalProtocol","RtuNodes","RtuNode"])
    : doc.findAll(["ExternalProtocol","TCPNodes","TCPNode"]);
  const node = nodes[options.locator.nodeIndex];
  if (!node) throw new ProjectServiceError(422, "Choose an existing Modbus node.");
  const devices = children(node, "Device");
  const name = options.name.trim();
  if (!name || name.length > 128) throw new ProjectServiceError(422, "Device name must contain 1–128 characters.");
  if (devices.some((d) => getAttr(d, "Name") === name)) throw new ProjectServiceError(422, "A device with this name already exists on this node.");
  const minimum = options.locator.kind === "rtu" ? 1 : 0, maximum = options.locator.kind === "rtu" ? 254 : 255;
  if (!Number.isInteger(options.slave) || options.slave < minimum || options.slave > maximum)
    throw new ProjectServiceError(422, `Slave must be between ${minimum} and ${maximum} on this node.`);
  if (devices.some((d) => Number(getAttr(d, "SlaveNum")) === options.slave)) throw new ProjectServiceError(422, "This slave number is already used on this node.");
  if ([...project.mbm.rtuNodes, ...project.mbm.tcpNodes].reduce((n, node) => n + node.devices.length, 0) >= MAX_MODBUS_DEVICES)
    throw new ProjectServiceError(422, "The project device limit has been reached.");
  const selected = new Set(options.enabled);
  if (selected.size !== options.enabled.length || [...selected].some((i) => !Number.isInteger(i) || i < 0 || i >= template.knx.length))
    throw new ProjectServiceError(422, "Invalid template object selection.");
  const included = template.knx.map((_, i) => i).filter((i) => options.includeDisabled || selected.has(i));
  if (!included.length) throw new ProjectServiceError(422, "Activate at least one template object or include disabled objects.");
  if (project.signals.length + included.length + 1 > MAX_TOTAL_SIGNAL_ROWS ||
      project.signals.filter((s) => s.active).length + selected.size + 1 > MAX_ACTIVE_SIGNALS)
    throw new ProjectServiceError(422, "This template exceeds the project signal capacity, including its communication-error signal.");
  const port = options.locator.kind === "rtu" ? options.locator.nodeIndex : project.mbm.rtuNodes.length + options.locator.nodeIndex;
  const device = copy(template.device);
  setAttr(device, "Index", String(devices.length)); setAttr(device, "Name", name);
  setAttr(device, "SlaveNum", String(options.slave)); setAttr(device, "Enabled", "True");
  appendChildIndented(node, device, 4);
  const maps = mergeConversions(doc, template.conversions);
  const comm = addSignal(doc);
  updateSignal(doc, comm, {
    active: true,
    description: `Comm Error ${options.locator.kind.toUpperCase()} ${options.locator.kind === "tcp" ? getAttr(node,"Description") ?? options.locator.nodeIndex + 1 : `Port ${getAttr(node,"PhysicalPort") === "0" ? "A" : "B"}`} - ${name}`,
    knx: { dpt: 257, groupAddress: 0, flags: { u: true, t: false, ri: false, w: true, r: false }, priority: 3 },
    modbus: { port, deviceIndex: devices.length, readFunc: -1, writeFunc: -1, lenBits: 1, format: 99, byteOrder: 255, bit: -1, numOfBits: 0, address: -1 },
  });
  const internal = doc.find(["InternalProtocol"])!, signals = doc.find(["ExternalProtocol","Signals"])!;
  for (const el of [children(internal, "KNXObject").at(-1)!, children(signals, "Signal").at(-1)!]) {
    setAttr(child(el,"Virtual"),"Status","True"); setAttr(child(el,"Virtual"),"Fixed","True");
  }
  let id = comm + 1;
  for (const i of included) {
    const k = copy(template.knx[i]), m = copy(template.modbus[i]);
    setAttr(k,"ID",String(id)); write(k,"IdxExternal",id); write(k,"IdxConfig",id);
    setAttr(m,"ID",String(id)); write(m,"idxExternal",id); write(m,"idxConfig",id);
    write(k,"Active",selected.has(i) ? "True" : "False");
    write(m,"Port",port); write(m,"DeviceIndex",devices.length);
    for (const el of [k,m]) {
      setAttr(child(el,"Virtual"),"Status","False"); setAttr(child(el,"Virtual"),"Fixed","False");
      setAttr(child(el,"Virtual"),"General","False");
      remapReferences(el, maps);
    }
    appendChildIndented(internal,k,2); appendChildIndented(signals,m,3);
    id++;
  }
}

type IndexMaps = { filters: number[]; operations: number[] };
/** MAPS compares type and numeric params, not description or Id. Preserve existing XML entries. */
function equal(a: XmlElement,b: XmlElement) {
  return ["Type","Param1","Param2","Param3","Param4"].every((key) => parseFloatLenient(getAttr(a,key) ?? "") === parseFloatLenient(getAttr(b,key) ?? ""));
}
export function mergeConversions(doc: XmlDocument, incoming: XmlElement[]): IndexMaps {
  const result: IndexMaps = { filters: [], operations: [] };
  let container = doc.find(["IBOX","Conversions"]);
  if (!container) {
    container = element("Conversions");
    appendChildIndented(doc.find(["IBOX"])!, container, 2);
  }
  for (const list of ["filters","operations"] as const) {
    const isList = (c: XmlElement) => (Number(getAttr(c,"Type")) === 0) === (list === "filters");
    const existing = children(container,"Conversion").filter(isList);
    for (const source of incoming.filter(isList)) {
      let index = existing.findIndex((c) => equal(c,source));
      if (index < 0) {
        index = existing.length;
        const added = copy(source); setAttr(added,"Id",String(index));
        // Filters must precede operations, with no changes to existing entry contents.
        const firstOperation = children(container,"Conversion").find((c) => Number(getAttr(c,"Type")) !== 0);
        if (list === "filters" && firstOperation) {
          const pos = container.children.indexOf(firstOperation);
          const before = container.children[pos - 1];
          added.parent = container;
          container.children.splice(pos,0,added,...(before?.kind === "text" ? [{ ...before }] : []));
        } else appendChildIndented(container,added,3);
        existing.push(added);
      }
      result[list].push(index);
    }
  }
  return result;
}

export function remapReferences(obj: XmlElement, maps: IndexMaps): void {
  const refs = readHalfConversionRefs(value(obj,"IdxFilters"),value(obj,"IdxOperations"));
  for (const list of ["filters","operations"] as const) {
    const mapped = refs[list].map((r) => {
      const index = maps[list][r.index];
      if (index === undefined) throw new ProjectServiceError(422,"Missing conversion reference.");
      return { ...r, index };
    });
    write(obj,list === "filters" ? "IdxFilters" : "IdxOperations",formatConversionIds(mapped));
  }
}
