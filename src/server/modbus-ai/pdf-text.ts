// Adapted from Signal modbus-source-evidence/pdf-text.ts (ad9d60c).
import "server-only";
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { EvidencePage as SourceEvidencePage } from "@/core/modbus-ai/model";

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

type PdfJsWorkerModule = {
  WorkerMessageHandler: unknown;
};

type PdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (params: {
    data: Uint8Array;
    disableFontFace: boolean;
    standardFontDataUrl: string;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageIndex: number) => Promise<{
        getTextContent: () => Promise<{ items: PdfTextItem[] }>; cleanup: () => void;
      }>;
    }>;
    destroy: () => Promise<void>;
  };
};

type PdfJsGlobal = typeof globalThis & {
  pdfjsWorker?: PdfJsWorkerModule;
};

const require = createRequire(import.meta.url);
let registerPdfWorkerPromise: Promise<void> | null = null;

function resolvePdfWorkerSrc(): string {
  return resolvePdfJsPackageFile('pdf.worker.mjs');
}

function resolvePdfJsPackageFile(fileName: 'pdf.mjs' | 'pdf.worker.mjs'): string {
  const packagePath = ['pdfjs-dist', 'legacy', 'build', fileName].join('/');
  const resolve = Reflect.get(require, 'resolve') as (id: string) => string;
  return pathToFileURL(resolve(packagePath)).href;
}

function importPdfJsModule(): Promise<PdfJsModule> {
  return import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJsModule>;
}

function importWorkerModule(): Promise<PdfJsWorkerModule> {
  return import('pdfjs-dist/legacy/build/pdf.worker.mjs');
}

function registerPdfWorker(): Promise<void> {
  const global = globalThis as PdfJsGlobal;
  if (global.pdfjsWorker?.WorkerMessageHandler) {
    return Promise.resolve();
  }

  registerPdfWorkerPromise ??= importWorkerModule().then(
    (worker) => {
      global.pdfjsWorker = worker;
    },
  );

  return registerPdfWorkerPromise;
}

export async function extractPdfEvidencePages(
  file: { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<SourceEvidencePage[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await registerPdfWorker();

  const pdfjs = await importPdfJsModule();
  pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();

  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    standardFontDataUrl: path.join(require.resolve('pdfjs-dist/package.json'), '..', 'standard_fonts') + path.sep,
  });
  const document = await task.promise;
  const pages: SourceEvidencePage[] = [];

  try {
  if (document.numPages > 200) throw new Error("PDF exceeds 200 pages. Supply a relevant section.");
  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex++) {
    const page = await document.getPage(pageIndex);
    const content = await page.getTextContent();
    const lines = groupTextItemsIntoLines(content.items as PdfTextItem[]);

    page.cleanup();
    pages.push({
      page: pageIndex,
      lines,
      text: lines.join('\n'),
    });
  }

  return pages;
  } finally { await task.destroy(); }
}

function groupTextItemsIntoLines(items: PdfTextItem[]): string[] {
  const positioned = items
    .map((item) => ({
      text: item.str?.trim() ?? '',
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));

  const lines: Array<{ y: number; parts: typeof positioned }> = [];
  for (const item of positioned) {
    const current = lines.at(-1);
    if (!current || Math.abs(current.y - item.y) > 2.5) {
      lines.push({ y: item.y, parts: [item] });
    } else {
      current.parts.push(item);
      current.y = (current.y + item.y) / 2;
    }
  }

  return lines
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}
