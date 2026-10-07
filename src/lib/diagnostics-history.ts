export const DIAGNOSTICS_WINDOW = 10_000;
export const DIAGNOSTICS_BATCH_MS = 100;

export interface DiagnosticEntry {
  seq: number;
  at: string;
  line: string;
}

export interface DiagnosticArchiveInfo {
  id: string;
  host: string;
  startedAt: string;
  closedAt?: string;
  count: number;
  bytes: number;
  dropped: number;
  error?: string;
}

export interface DiagnosticHistoryPage {
  entries: DiagnosticEntry[];
  hasMore: boolean;
  archive: DiagnosticArchiveInfo;
}
