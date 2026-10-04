import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync, fsyncSync } from "node:fs";
import path from "node:path";

const globals = globalThis as unknown as { __mapsScanOwner?: AsyncLocalStorage<string> };
const owner = globals.__mapsScanOwner ??= new AsyncLocalStorage<string>();
export const scanRoot = () => path.join(process.env.MAPS_DATA_DIR ?? path.join(process.cwd(), ".local-data"), "modbus-scans");
const lockPath = (host: string) => path.join(scanRoot(), "locks", createHash("sha256").update(host.trim().toLowerCase()).digest("hex") + ".lock");
export class ScanError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function gatewayScanOwner(host: string): string | undefined {
  const file = lockPath(host); if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf8").trim(); // Corrupt locks also fail closed.
}
export function assertGatewayAvailable(host: string) {
  const id = gatewayScanOwner(host);
  if (id !== undefined && id !== owner.getStore()) throw new ScanError(409, "This gateway has an active scan or pending backup restoration. Open Add from scan to restore it first.");
}
export function claimGateway(host: string, id: string) {
  mkdirSync(path.dirname(lockPath(host)), { recursive: true, mode: 0o700 });
  let fd: number;
  try { fd = openSync(lockPath(host), "wx", 0o600); } catch { throw new ScanError(409, "This gateway is already reserved by a scan or backup restoration."); }
  try { writeFileSync(fd, id); fsyncSync(fd); } finally { closeSync(fd); }
}
export function releaseGateway(host: string, id: string) {
  if (gatewayScanOwner(host) === id) unlinkSync(lockPath(host));
}
export function withScanOwner<T>(id: string, work: () => T): T { return owner.run(id, work); }
