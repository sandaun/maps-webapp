import "server-only";
import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { ProjectServiceError } from "@/server/projects/errors";

export const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
export const MAX_TEMPLATE_XML_BYTES = 16 * 1024 * 1024;
// MAPS TemplateCryptoMatic: public format constants, never sent to the browser.
const KEY = Buffer.from([106,88,157,110,26,47,85,22,119,231,226,124,44,160,109,42]);
const IV = Buffer.from([180,212,213,66,200,32,232,45,184,41,21,87,59,236,173,46]);

export function decryptDeviceTemplate(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_TEMPLATE_BYTES)
    throw new ProjectServiceError(413, "Template must be between 1 byte and 8 MB.");
  try {
    const cipher = createDecipheriv("aes-128-cbc", KEY, IV);
    const compressed = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const payload = gunzipSync(compressed, { maxOutputLength: MAX_TEMPLATE_XML_BYTES + 32 });
    for (const [algorithm, length] of [["sha256", 32], ["sha1", 20]] as const) {
      if (payload.length <= length) continue;
      const xml = payload.subarray(0, -length);
      const digest = createHmac(algorithm, IV).update(xml).digest();
      if (timingSafeEqual(digest, payload.subarray(-length))) {
        return new TextDecoder("utf-8", { fatal: true }).decode(xml);
      }
    }
  } catch { /* Decode failures share one actionable message, without exposing the content. */ }
  throw new ProjectServiceError(422, "Invalid or damaged MAPS device template. Choose a .knxmbm, .knxmbr or .bacmbm file.");
}

export function encryptDeviceTemplate(xml: string): Uint8Array {
  const bytes = Buffer.from(xml, "utf8");
  if (bytes.length > MAX_TEMPLATE_XML_BYTES) throw new ProjectServiceError(413, "Template is too large.");
  const payload = Buffer.concat([bytes, createHmac("sha256", IV).update(bytes).digest()]);
  const cipher = createCipheriv("aes-128-cbc", KEY, IV);
  return Buffer.concat([cipher.update(gzipSync(payload)), cipher.final()]);
}
