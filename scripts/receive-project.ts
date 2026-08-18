/**
 * receive-project — downloads the gateway "complete" project blob from a live
 * Intesis gateway (read-only RECVCMPLT) and saves it to disk for analysis.
 *
 * Usage:
 *   GW_PASSWORD=... pnpm receive:project <host> <output.bin> [--port N]
 *
 * - The password is read from the GW_PASSWORD environment variable only —
 *   never from CLI args, and it is never logged.
 * - The transfer is strictly read-only: no SENDPROJ/SENDCMPLT, nothing is
 *   written to the device.
 * - The blob is validated (length + CRC32 + ZIP) before saving, and its
 *   SHA-256 is printed for traceability. Save fixtures under `.local-data/`
 *   (gitignored) — real projects may contain credentials.
 *
 * Exit codes: 0 = saved; 1 = transfer/validation error; 2 = usage error.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseCompleteBlob } from "../src/core/project-format";
import { GatewaySessionManager } from "../src/server/intesis-transport/manager";

function usage(): never {
  console.error("Usage: GW_PASSWORD=... pnpm receive:project <host> <output.bin> [--port N]");
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? Number(args.splice(portIdx, 2)[1]) : 23;
  const [host, output] = args;
  if (!host || !output || Number.isNaN(port)) usage();

  const password = process.env.GW_PASSWORD;
  if (!password) {
    console.error("GW_PASSWORD is not set; refusing to connect without a password.");
    process.exit(2);
  }

  const manager = new GatewaySessionManager();
  const status = await manager.connect({ host, port, password });
  const gw = status.gateway;
  console.error(
    `connected to ${host} (encrypted=${status.encrypted}): ${gw?.appName ?? "?"} ` +
      `${gw?.appVersion ?? ""} · ${gw?.platform ?? "?"} · SN ${gw?.serial ?? "?"}`,
  );

  manager.subscribe(status.id, (event) => {
    if (event.type === "progress") {
      process.stderr.write(`\rreceiving: ${event.receivedBytes}/${event.totalBytes} bytes`);
    } else if (event.type === "log") {
      console.error(`[gateway] ${event.line}`);
    }
  });

  try {
    const blob = await manager.receiveProject(status.id);
    process.stderr.write("\n");
    const parsed = parseCompleteBlob(blob); // throws on bad length/CRC/ZIP
    const sha256 = createHash("sha256").update(blob).digest("hex");
    const outPath = resolve(output);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, blob);
    console.log(
      `saved ${blob.length} bytes (xbl=${parsed.xbl.length}B, zip=${parsed.zip.length}B) to ${outPath}`,
    );
    console.log(`sha256: ${sha256}`);
  } finally {
    manager.disconnect(status.id);
  }
}

main().catch((error: unknown) => {
  console.error(`receive-project failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
