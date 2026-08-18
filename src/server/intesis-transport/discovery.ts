import "server-only";
import { networkInterfaces } from "node:os";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { parseInfoLines, summarizeInfo, type GatewayInfoSummary } from "./info";

/**
 * UDP/23 discovery (PROTOCOL.md §2.1): the MAPS sends the 5 ASCII bytes
 * `INFO?` (no CRLF) to the broadcast address of each active interface and to
 * 255.255.255.255; gateways answer with a UDP datagram starting with
 * `IntesisBox` and carrying `INFO:KEY:VALUE` lines closed by `INFO:END`.
 *
 * The parser is pure and unit-tested; `discoverGateways` is a thin node:dgram
 * wrapper used only by the API route (never from unit tests).
 */

export const DISCOVERY_PORT = 23;
export const DISCOVERY_QUERY = "INFO?";

export interface DiscoveredGateway {
  /** Sender address of the datagram. */
  address: string;
  info: GatewayInfoSummary;
  raw: Record<string, string>;
}

/**
 * Parses a discovery datagram payload. Returns undefined when it does not
 * look like an Intesis response (must carry INFO lines or the banner).
 */
export function parseDiscoveryResponse(payload: Uint8Array | string): Omit<DiscoveredGateway, "address"> | undefined {
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  const info = parseInfoLines(text);
  if (info.entries.length === 0 && !text.includes("IntesisBox")) return undefined;
  return { info: summarizeInfo(info), raw: info.byKey };
}

/** Broadcast address = ip | ~mask (both dotted-quad IPv4). */
export function computeBroadcastAddress(ip: string, netmask: string): string {
  const toInt = (s: string) => s.split(".").reduce((acc, oct) => (acc << 8) | (Number(oct) & 0xff), 0) >>> 0;
  const toQuad = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 0xff).join(".");
  return toQuad((toInt(ip) | (~toInt(netmask) >>> 0)) >>> 0);
}

/** Broadcast targets: per active IPv4 interface + the limited broadcast. */
export function listBroadcastTargets(): string[] {
  const targets = new Set<string>();
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal && addr.netmask) {
        targets.add(computeBroadcastAddress(addr.address, addr.netmask));
      }
    }
  }
  targets.add("255.255.255.255");
  return [...targets];
}

export interface DiscoveryOptions {
  /** Listen window for responses (default 1500 ms). */
  timeoutMs?: number;
  /** Test hook / DI: broadcast targets override. */
  targets?: string[];
}

/** Sends `INFO?` per UDP/23 to all broadcast targets and collects responses. */
export function discoverGateways(options: DiscoveryOptions = {}): Promise<DiscoveredGateway[]> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const targets = options.targets ?? listBroadcastTargets();
  return new Promise((resolve, reject) => {
    const socket: Socket = createSocket("udp4");
    const found = new Map<string, DiscoveredGateway>();
    const finish = () => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("error", (err) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(err);
    });
    socket.on("message", (msg: Buffer, rinfo: RemoteInfo) => {
      const parsed = parseDiscoveryResponse(new Uint8Array(msg));
      if (parsed && !found.has(rinfo.address)) {
        found.set(rinfo.address, { address: rinfo.address, ...parsed });
      }
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      const query = new TextEncoder().encode(DISCOVERY_QUERY);
      for (const target of targets) {
        socket.send(query, DISCOVERY_PORT, target, (err) => {
          // Unreachable interfaces should not abort the scan.
          if (err) socket.emit("log", err);
        });
      }
    });
  });
}
