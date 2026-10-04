/** Offline comparison against the actual, read-only Signal checkout. Not imported by the app. */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type { RawModbusExtraction } from "../src/core/modbus-ai/signal/schema";
import type { NormalizedModbusExtraction } from "../src/core/modbus-ai/signal/normalize";
import type { AIModbusSignal } from "../src/core/modbus-ai/signal/signal-types";

export function signalReference(root: string, model?: string, effort?: string) {
  const nativeRequire = createRequire(path.join(root, "package.json"));
  const cache = new Map<string, Record<string, unknown>>();
  const load = (file: string): Record<string, unknown> => {
    const absolute = path.resolve(root, file);
    const saved = cache.get(absolute);
    if (saved) return saved;
    const referenceModule = { exports: {} as Record<string, unknown> };
    cache.set(absolute, referenceModule.exports);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText;
    const require = (specifier: string) => {
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) {
        const dependency = nativeRequire(specifier);
        if (specifier === "ai" && model)
          return {
            ...dependency,
            streamText: (input: Record<string, unknown>) =>
              dependency.streamText({
                ...input,
                maxRetries: 0,
                abortSignal: AbortSignal.timeout(300000),
                providerOptions: {
                  openai: { reasoningEffort: effort ?? "medium" },
                },
              }),
          };
        return dependency;
      }
      const destination = specifier.startsWith("@/")
        ? path.join(root, "src", specifier.slice(2))
        : path.resolve(path.dirname(absolute), specifier);
      return load(
        destination.endsWith(".ts") ? destination : destination + ".ts",
      );
    };
    vm.runInNewContext(
      code,
      {
        exports: referenceModule.exports,
        module: referenceModule,
        require,
        Buffer,
        process,
        fetch,
        File,
        Blob,
        URL,
        TextDecoder,
        TextEncoder,
        AbortSignal,
        setTimeout,
        clearTimeout,
        console,
      },
      { filename: absolute, timeout: 10000 },
    );
    if (model && absolute.endsWith("/src/lib/ai/config.ts")) {
      const original = referenceModule.exports.getAIModel as (
        provider: string,
        selected?: string,
      ) => unknown;
      referenceModule.exports.getAIModel = (provider: string) =>
        original(provider, model);
    }
    return referenceModule.exports;
  };
  return {
    load,
    normalize: load("src/lib/ai/structured-modbus/normalize.ts")
      .normalizeRawModbusTables as (
      raw: RawModbusExtraction,
    ) => NormalizedModbusExtraction,
    expand: load("src/lib/ai/expansion/expand-templates.ts")
      .expandModbusTemplates as (signals: AIModbusSignal[]) => {
      signals: AIModbusSignal[];
    },
  };
}
