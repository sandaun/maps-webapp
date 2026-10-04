// Source: Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc, src/lib/ai/structured-modbus/normalize.ts.
import type {
  AIModbusSignal,
  DetectedAddressBase,
} from './signal-types';
import { countEnumStates } from './enum-states';
import type { RawModbusExtraction, RawModbusRow, RawModbusTable } from './schema';

type RegisterType = AIModbusSignal['registerType'];
type DataType = AIModbusSignal['dataType'];

export interface NormalizedModbusExtraction {
  signals: AIModbusSignal[];
  manufacturer: string | null;
  model: string | null;
  detectedAddressBase: DetectedAddressBase;
  warnings: string[];
  infos: string[];
}

interface TableExpansion {
  stride: number;
  indexRange: [number, number];
  indexVar: string;
}

interface ParsedAddress {
  printed: number;
  address: number;
  registerType: RegisterType;
  isPlc: boolean;
}

type AddressRadix = 'decimal' | 'hex';

interface AddressToken {
  value: string;
  radix: AddressRadix;
  forceDecimal?: boolean;
}

interface AddressParseOptions {
  allowCoilPlc?: boolean;
}

const FORMULA_NOTE_ADDRESS_WINDOW = 256;

export function normalizeRawModbusTables(
  raw: RawModbusExtraction,
): NormalizedModbusExtraction {
  const warnings: string[] = [];
  const infos: string[] = [];
  const signals: AIModbusSignal[] = [];
  let sawPlcAddress = false;
  let sawExplicitNormalizedAddress = false;
  let sawInferredOneBasedAddress = false;
  const allowCoilPlc = rawHasUnambiguousPlcAddresses(raw);

  const expansions = resolveTableExpansions(raw, warnings);

  for (const table of raw.tables) {
    const rows = groupAndSortBitfieldRows(
      collapseEnumValueRows(expandInlineBitCodedRows(table.rows)),
    );
    const addressRadix = inferTableAddressRadix(rows);
    const expansion = expansions.get(table) ?? null;
    if (expansion) {
      infos.push(
        `Detected table-level address formula +${expansion.stride}*${expansion.indexVar} on "${table.title ?? 'Modbus table'}" and represented affected rows as compact templates.`,
      );
    }

    for (const row of rows) {
      if (shouldSkipRow(row)) continue;
      if (shouldSkipBitMaskHeader(row, rows)) continue;

      const normalizedAddress = parseNormalizedAddress(row.normalizedAddress);
      const parsedAddresses = applyExplicitNormalizedAddress(
        parseAddressSeries(
          row.sourceAddress,
          row.registerTypeHint ?? table.registerTypeHint,
          addressRadix,
          { allowCoilPlc },
        ),
        normalizedAddress,
      );
      if (parsedAddresses.length === 0) {
        if (isEnumValueOnly(row)) continue;
        warnings.push(
          `Skipped "${row.name}" because the row has no parseable Modbus address.`,
        );
        continue;
      }

      parsedAddresses.forEach((parsed, seriesIndex) => {
        if (parsed.address < 0) {
          warnings.push(
            `Skipped "${row.name}" because source address ${parsed.printed} converts to a negative Modbus offset.`,
          );
          return;
        }

        sawPlcAddress ||= parsed.isPlc;
        sawExplicitNormalizedAddress ||= normalizedAddress !== null;
        sawInferredOneBasedAddress ||=
          row.normalizedAddressSource === 'inferred-1-based';
        const signal = rowToSignal(row, table, raw, parsed, expansion);
        if (parsedAddresses.length > 1 && !expansion) {
          signal.signalName = `${signal.signalName} (${seriesIndex})`;
        }
        signals.push(signal);
      });
    }
  }

  return {
    signals,
    manufacturer: raw.manufacturer ?? null,
    model: raw.model ?? null,
    detectedAddressBase: sawInferredOneBasedAddress
      ? '1-based'
      : sawExplicitNormalizedAddress
        ? '0-based'
        : sawPlcAddress
          ? 'plc'
          : 'unknown',
    warnings,
    infos,
  };
}

function groupAndSortBitfieldRows(rows: RawModbusRow[]): RawModbusRow[] {
  const bitRowsByAddress = new Map<string, RawModbusRow[]>();

  for (const row of rows) {
    const address = String(row.sourceAddress ?? '').trim();
    if (!address || parseBit(row.sourceBit) === null) continue;

    const siblings = bitRowsByAddress.get(address) ?? [];
    siblings.push(row);
    bitRowsByAddress.set(address, siblings);
  }

  const groupedAddresses = new Set(
    Array.from(bitRowsByAddress)
      .filter(([, siblings]) => siblings.length > 1)
      .map(([address]) => address),
  );
  const emittedAddresses = new Set<string>();
  const out: RawModbusRow[] = [];

  for (const row of rows) {
    const address = String(row.sourceAddress ?? '').trim();
    if (
      !groupedAddresses.has(address) ||
      parseBit(row.sourceBit) === null
    ) {
      out.push(row);
      continue;
    }

    if (emittedAddresses.has(address)) continue;
    emittedAddresses.add(address);
    out.push(
      ...bitRowsByAddress
        .get(address)!
        .sort((a, b) => parseBit(a.sourceBit)! - parseBit(b.sourceBit)!),
    );
  }

  return out;
}

function expandInlineBitCodedRows(rows: RawModbusRow[]): RawModbusRow[] {
  return rows.flatMap((row) => {
    if (parseBit(row.sourceBit) !== null || !isBitMaskRow(row)) return [row];

    const evidence = [
      row.dataText,
      row.descriptionText,
    ]
      .filter(Boolean)
      .join(' ');
    const bitMappings = parseInlineBitMappings(evidence);
    if (bitMappings.length === 0) return [row];

    return bitMappings.map(({ bit, name }) => ({
      ...row,
      name,
      groupText: row.groupText ?? row.name,
      sourceBit: bit,
    }));
  });
}

function parseInlineBitMappings(
  text: string,
): Array<{ bit: number; name: string }> {
  const matches = Array.from(
    text.matchAll(
      /\bB(?:IT)?\s*(\d{1,2})\s*=\s*(.+?)(?=\s*[,;]\s*B(?:IT)?\s*\d{1,2}\s*=|$)/gi,
    ),
  );

  return matches
    .map((match) => ({
      bit: Number(match[1]),
      name: match[2].trim(),
    }))
    .filter(
      ({ bit, name }) =>
        Number.isInteger(bit) && bit >= 0 && bit <= 31 && name.length > 0,
    );
}

function collapseEnumValueRows(rows: RawModbusRow[]): RawModbusRow[] {
  const out: RawModbusRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (parseBit(row.sourceBit) !== null || !canStartEnumGroup(row)) {
      out.push(row);
      continue;
    }

    const sourceAddress = String(row.sourceAddress ?? '').trim();
    if (!sourceAddress) {
      out.push(row);
      continue;
    }

    const group = [row];
    let j = i + 1;
    while (
      j < rows.length &&
      String(rows[j].sourceAddress ?? '').trim() === sourceAddress &&
      parseBit(rows[j].sourceBit) === null &&
      canJoinEnumGroup(rows[j])
    ) {
      group.push(rows[j++]);
    }

    if (!isCollapsibleEnumGroup(group)) {
      out.push(row);
    } else {
      out.push(buildCollapsedEnumRow(group));
      i = j - 1;
    }
  }

  return out;
}

function buildCollapsedEnumRow(group: RawModbusRow[]): RawModbusRow {
  const first = group[0];
  const sourceAddress = String(first.sourceAddress ?? '').trim();
  const options = group
    .map((row) => normalizeEnumOption(row.name))
    .filter((option): option is string => Boolean(option))
    .filter((option, index, all) => all.indexOf(option) === index);
  const hasExplicitValues = options.some((option) => /^\d+\s*=/.test(option));
  const enumText = hasExplicitValues
    ? options.join('; ')
    : `Enum values: ${options.join('; ')}`;

  return {
    ...first,
    name: `Register ${sourceAddress} enum`,
    groupText: null,
    dataText: [first.dataText, 'enum']
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' '),
    descriptionText: [enumText, first.descriptionText]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join('. '),
  };
}

function rowToSignal(
  row: RawModbusRow,
  table: RawModbusTable,
  raw: RawModbusExtraction,
  parsed: ParsedAddress,
  expansion: TableExpansion | null,
): AIModbusSignal {
  const evidence = [
    row.groupText,
    row.dataText,
    row.descriptionText,
    row.modeText,
    table.title,
  ]
    .filter(Boolean)
    .join(' ');
  const units = inferUnits(`${row.name} ${evidence}`);
  const bitSpan = parseBitSpan(row.sourceBit);
  const bit = bitSpan?.bit ?? null;
  const dataType = bit === null ? inferDataType(parsed.registerType, evidence) : 'Boolean';
  const signalType =
    bit === null ? inferSignalType(row.name, evidence, units) : 'binary';

  return {
    sourceRow: row,
    sourceTable: table,
    deviceId: buildDeviceId(raw),
    signalName: buildSignalName(row, bit),
    registerType: parsed.registerType,
    address: expansion ? null : parsed.address,
    dataType,
    units,
    description: buildDescription(row, table, parsed.printed),
    signalType,
    statesCount: signalType === 'enum' ? countEnumStates(evidence) : null,
    mode: inferMode(parsed.registerType, row.modeText, table.title),
    factor: inferFactor(evidence),
    bit,
    bitCount: bitSpan?.bitCount ?? null,
    confidence: row.sourceAddress && row.name ? 0.9 : 0.7,
    applicableModels: getApplicableModels(row, table),
    addressTemplate: expansion
      ? {
          base: parsed.address,
          stride: expansion.stride,
          indexVar: expansion.indexVar,
          indexRange: expansion.indexRange,
          nameTemplate: null,
        }
      : null,
    bitExpansion: null,
    needsVerification: null,
  };
}

function getApplicableModels(
  row: RawModbusRow,
  table: RawModbusTable,
): string[] | null {
  const rowModels = normalizeApplicableModels(row.applicableModels);
  if (rowModels) return rowModels;
  return normalizeApplicableModels(table.applicableModels);
}

function normalizeApplicableModels(
  models: string[] | null | undefined,
): string[] | null {
  if (!models || models.length === 0) return null;

  const normalized = models
    .flatMap(splitModelList)
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model) => !isCommonModelScope(model));

  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : null;
}

function splitModelList(model: string): string[] {
  return model
    .split(/\s*(?:\/|,|;|\band\b|\bor\b)\s*/i)
    .filter(Boolean);
}

function isCommonModelScope(model: string): boolean {
  return /^(all|common|general|shared|todos?|tots?|todas?)$/i.test(
    model.trim(),
  );
}

function shouldSkipRow(row: RawModbusRow): boolean {
  // Reserved/spare rows with a printed address are allocated registers the
  // source map lists on purpose: the extraction prompt asks for them and the
  // Coverage Gate counts them as source candidates, so dropping them here
  // guarantees a coverage mismatch. Only reserved rows without an address
  // (placeholder prose) are skipped.
  const hasPrintedAddress = String(row.sourceAddress ?? '').trim() !== '';
  if (isReservedRow(row)) return !hasPrintedAddress;
  const name = row.name.trim().toLowerCase();
  return (
    name === '' ||
    /(?:^|[\s(<-])unnamed\b/.test(name) ||
    /\bblank\s+in\s+source\b/.test(name) ||
    /\bno\s+name\b/.test(name)
  );
}

function isReservedRow(row: RawModbusRow): boolean {
  if (row.isReserved === true) return true;
  const name = row.name.trim().toLowerCase();
  return name === 'reserved' || /^<?\s*reserved\s*>?$/.test(name);
}

function shouldSkipBitMaskHeader(
  row: RawModbusRow,
  siblingRows: RawModbusRow[],
): boolean {
  if (!isBitMaskRow(row)) return false;
  if (parseBit(row.sourceBit) !== null) return false;

  const address = String(row.sourceAddress ?? '').trim();
  return siblingRows.some(
    (sibling) =>
      sibling !== row &&
      String(sibling.sourceAddress ?? '').trim() === address &&
      parseBit(sibling.sourceBit) !== null,
  );
}

function isBitMaskRow(row: RawModbusRow): boolean {
  return /bit\s*mask|bitfield|bit\s*field|bit\s*-?\s*coded/i.test(
    `${row.groupText ?? ''} ${row.dataText ?? ''} ${row.descriptionText ?? ''}`,
  );
}

function isEnumValueOnly(row: RawModbusRow): boolean {
  const name = row.name.trim();
  return (
    /^[-–]?\s*\(?\d+\)?\s*[:=]?\s+\S/.test(name) ||
    /^\d+\s*[:=]\s+\S/.test(name)
  );
}

function canStartEnumGroup(row: RawModbusRow): boolean {
  return isEnumValueOnly(row) || isShortEnumLabel(row);
}

function canJoinEnumGroup(row: RawModbusRow): boolean {
  return isEnumValueOnly(row) || isShortEnumLabel(row);
}

function isCollapsibleEnumGroup(group: RawModbusRow[]): boolean {
  if (group.length < 2) return false;
  if (group.some(isEnumValueOnly)) return true;
  if (group.length < 3) return false;

  const evidence = group
    .map((row) => `${row.dataText ?? ''} ${row.descriptionText ?? ''}`)
    .join(' ');
  if (!/\bint(?:eger)?\b|\benum(?:eration)?\b|value\s+list|valores?/i.test(evidence)) {
    return false;
  }

  return group.every(isShortEnumLabel);
}

function isShortEnumLabel(row: RawModbusRow): boolean {
  const name = row.name.trim();
  if (!name || name.length > 48) return false;
  if (/[.;:]/.test(name)) return false;
  if (/^(reserved|unnamed|blank|no name)$/i.test(name)) return false;
  if (/^(alarms?|alarmas?|warnings?|faults?|errors?)$/i.test(name)) return false;
  return /\p{L}/u.test(name);
}

function normalizeEnumOption(name: string): string | null {
  const trimmed = name.trim();
  const parenthesized = trimmed.match(/^\(?(\d+)\)?\s*[:=]?\s*(.+)$/);
  if (parenthesized) return `${parenthesized[1]}=${parenthesized[2].trim()}`;

  const plain = trimmed.match(/^(\d+)\s*[:=]\s*(.+)$/);
  if (plain) return `${plain[1]}=${plain[2].trim()}`;

  return trimmed || null;
}

function parseBit(sourceBit: RawModbusRow['sourceBit']): number | null {
  return parseBitSpan(sourceBit)?.bit ?? null;
}

function parseBitSpan(
  sourceBit: RawModbusRow['sourceBit'],
): { bit: number; bitCount: number } | null {
  if (sourceBit === null || sourceBit === undefined) return null;
  const text = String(sourceBit);
  const numbers = Array.from(text.matchAll(/\d{1,2}/g)).map((match) =>
    Number(match[0]),
  );
  const bit = numbers[0];
  if (!Number.isInteger(bit) || bit < 0 || bit > 31) return null;

  const end = numbers[1];
  const isRange =
    end !== undefined &&
    /(?:\d\s*(?:-|\.{2}|to|through|thru|~)\s*\d)|(?:bits?\s+\d+\s*(?:-|to|through|thru|~)\s*\d)/i.test(
      text,
    );
  if (isRange && Number.isInteger(end) && end >= bit && end <= 31) {
    return { bit, bitCount: end - bit + 1 };
  }

  return { bit, bitCount: 1 };
}

function parseAddress(
  sourceAddress: RawModbusRow['sourceAddress'],
  hint: RegisterType | null,
  addressRadix: AddressRadix = 'decimal',
  options: AddressParseOptions = {},
): ParsedAddress | null {
  if (sourceAddress === null || sourceAddress === undefined) return null;
  const text = String(sourceAddress).trim();
  const addressToken = extractAddressToken(text);
  if (!addressToken) return null;

  const printed =
    addressToken.radix === 'hex' ||
    (!addressToken.forceDecimal &&
      addressRadix === 'hex' &&
      isCompactHexAddress(addressToken.value))
      ? Number.parseInt(addressToken.value.replace(/^0x/i, ''), 16)
      : Number(addressToken.value);
  if (!Number.isFinite(printed)) return null;

  if (printed >= 30001 && printed <= 39999) {
    return {
      printed,
      address: printed - 30001,
      registerType: 'InputRegister',
      isPlc: true,
    };
  }
  if (printed >= 40001 && printed <= 49999) {
    return {
      printed,
      address: printed - 40001,
      registerType: 'HoldingRegister',
      isPlc: true,
    };
  }
  if (
    printed >= 10001 &&
    printed <= 19999 &&
    hint === 'DiscreteInput'
  ) {
    return {
      printed,
      address: printed - 10001,
      registerType: 'DiscreteInput',
      isPlc: true,
    };
  }
  if (
    printed >= 1 &&
    printed <= 9999 &&
    hint === 'Coil' &&
    (options.allowCoilPlc || isExplicitCoilPlcToken(addressToken))
  ) {
    return {
      printed,
      address: printed - 1,
      registerType: 'Coil',
      isPlc: true,
    };
  }

  return {
    printed,
    address: printed,
    registerType: hint ?? 'HoldingRegister',
    isPlc: false,
  };
}

function parseAddressSeries(
  sourceAddress: RawModbusRow['sourceAddress'],
  hint: RegisterType | null,
  addressRadix: AddressRadix = 'decimal',
  options: AddressParseOptions = {},
): ParsedAddress[] {
  const first = parseAddress(sourceAddress, hint, addressRadix, options);
  if (!first || sourceAddress === null || sourceAddress === undefined) {
    return first ? [first] : [];
  }

  const values = String(sourceAddress)
    .match(/\d{5,6}/g)
    ?.map(Number)
    .filter((value) => Number.isFinite(value));

  if (!values || values.length < 2) return [first];

  const start = values[0];
  const end = values[values.length - 1];
  if (end <= start || end - start > 256) return [first];

  const out: ParsedAddress[] = [];
  const seriesOptions = {
    ...options,
    allowCoilPlc: options.allowCoilPlc || first.isPlc,
  };
  for (let printed = start; printed <= end; printed++) {
    const parsed = parseAddress(printed, hint, 'decimal', seriesOptions);
    if (parsed) out.push(parsed);
  }
  return out.length > 0 ? out : [first];
}

function isExplicitCoilPlcToken(token: AddressToken): boolean {
  return token.radix === 'decimal' && /^0\d{4}$/.test(token.value);
}

function rawHasUnambiguousPlcAddresses(raw: RawModbusExtraction): boolean {
  return raw.tables.some((table) => {
    const rows = collapseEnumValueRows(table.rows);
    const addressRadix = inferTableAddressRadix(rows);
    return rows.some((row) => {
      const parsed = parseAddress(
        row.sourceAddress,
        row.registerTypeHint ?? table.registerTypeHint,
        addressRadix,
      );
      return parsed?.isPlc === true && parsed.registerType !== 'Coil';
    });
  });
}

function parseNormalizedAddress(
  normalizedAddress: RawModbusRow['normalizedAddress'],
): number | null {
  if (normalizedAddress === null || normalizedAddress === undefined) return null;
  const match = String(normalizedAddress).trim().match(/^-?\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isInteger(parsed) ? parsed : null;
}

function applyExplicitNormalizedAddress(
  parsedAddresses: ParsedAddress[],
  normalizedAddress: number | null,
): ParsedAddress[] {
  if (normalizedAddress === null || parsedAddresses.length !== 1) {
    return parsedAddresses;
  }

  return [
    {
      ...parsedAddresses[0],
      address: normalizedAddress,
      isPlc: false,
    },
  ];
}

function inferTableAddressRadix(rows: RawModbusRow[]): AddressRadix {
  return rows.some((row) => {
    const token = extractAddressToken(String(row.sourceAddress ?? ''));
    return token?.radix === 'hex';
  })
    ? 'hex'
    : 'decimal';
}

function extractAddressToken(text: string): AddressToken | null {
  const candidates =
    text.match(/\b(?:0x[0-9a-fA-F]+|[0-9a-fA-F]*\d[0-9a-fA-F]*)\b/g) ?? [];
  if (candidates.length === 0) return null;

  const isFormula = /[+*]|\b[MN]\b/i.test(text);
  const isRange = /\d\s*(?:-|\.{2}|to|~)\s*\d/i.test(text);
  const token =
    candidates.length > 1 && !isFormula && !isRange
      ? (candidates.findLast((candidate) => /^\d+$/.test(candidate)) ??
        candidates[0])
      : candidates[0];
  if (!token) return null;

  return {
    value: token,
    radix: /^0x/i.test(token) || /[a-f]/i.test(token) ? 'hex' : 'decimal',
    forceDecimal: candidates.length > 1 && /^\d+$/.test(token),
  };
}

function mergeComplementaryReadWriteSignals(
  signals: AIModbusSignal[],
): AIModbusSignal[] {
  const merged: AIModbusSignal[] = [];
  const byExactKey = new Map<string, number>();
  const byTechnicalKey = new Map<string, number>();

  for (const signal of signals) {
    const exactKey = readWriteMergeKey(signal, 'exact');
    const technicalKey = readWriteMergeKey(signal, 'technical');
    const existingIndex =
      (exactKey ? byExactKey.get(exactKey) : undefined) ??
      (technicalKey ? byTechnicalKey.get(technicalKey) : undefined);
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      if (existing && areComplementaryReadWrite(existing, signal)) {
        merged[existingIndex] = mergeReadWriteSignals(existing, signal);
        rememberReadWriteMergeCandidate(
          merged[existingIndex],
          existingIndex,
          byExactKey,
          byTechnicalKey,
        );
        continue;
      }
      if (existing?.mode === 'R/W' && isSingleDirection(signal.mode)) {
        continue;
      }
    }

    rememberReadWriteMergeCandidate(
      signal,
      merged.length,
      byExactKey,
      byTechnicalKey,
    );
    merged.push(signal);
  }

  return merged;
}

function rememberReadWriteMergeCandidate(
  signal: AIModbusSignal,
  index: number,
  byExactKey: Map<string, number>,
  byTechnicalKey: Map<string, number>,
): void {
  if (!isMergeCandidateMode(signal.mode)) return;

  const exactKey = readWriteMergeKey(signal, 'exact');
  const technicalKey = readWriteMergeKey(signal, 'technical');
  if (exactKey) byExactKey.set(exactKey, index);
  if (technicalKey) byTechnicalKey.set(technicalKey, index);
}

function readWriteMergeKey(
  signal: AIModbusSignal,
  scope: 'exact' | 'technical',
): string | null {
  if (!isMergeCandidateMode(signal.mode)) return null;

  return JSON.stringify({
    deviceId: signal.deviceId,
    signalName:
      scope === 'exact' ? normalizeReadWriteSignalName(signal.signalName) : null,
    registerType: signal.registerType,
    address: signal.address,
    addressTemplate: signal.addressTemplate,
    bit: signal.bit,
    bitCount: signal.bitCount,
    dataType: signal.dataType,
    units: scope === 'exact' ? signal.units : null,
    signalType: scope === 'exact' ? signal.signalType : null,
    factor: scope === 'exact' ? signal.factor : null,
    applicableModels: signal.applicableModels ?? null,
  });
}

function isMergeCandidateMode(
  mode: AIModbusSignal['mode'],
): mode is 'R' | 'W' | 'R/W' {
  return mode === 'R' || mode === 'W' || mode === 'R/W';
}

function isSingleDirection(mode: AIModbusSignal['mode']): mode is 'R' | 'W' {
  return mode === 'R' || mode === 'W';
}

function normalizeReadWriteSignalName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\((?:status|control|command)\)\s*$/i, '')
    .replace(/\s+(?:status|control|command)\s*$/i, '')
    .replace(/\s+/g, ' ');
}

function areComplementaryReadWrite(
  a: AIModbusSignal,
  b: AIModbusSignal,
): boolean {
  return (
    (a.mode === 'R' && b.mode === 'W') ||
    (a.mode === 'W' && b.mode === 'R')
  );
}

function mergeReadWriteSignals(
  a: AIModbusSignal,
  b: AIModbusSignal,
): AIModbusSignal {
  return {
    ...a,
    signalName: mergedReadWriteSignalName(a.signalName, b.signalName),
    mode: 'R/W',
    units: a.units ?? b.units,
    signalType: a.signalType ?? b.signalType,
    factor: a.factor ?? b.factor,
    description: joinUniqueDescriptions(a.description, b.description),
    confidence: Math.max(a.confidence, b.confidence),
    needsVerification: a.needsVerification || b.needsVerification || null,
  };
}

function mergedReadWriteSignalName(a: string, b: string): string {
  const normalizedA = normalizeReadWriteSignalName(a);
  const normalizedB = normalizeReadWriteSignalName(b);
  if (normalizedA === normalizedB) return stripReadWriteRole(a);
  if (isCommandLikeName(a) && !isCommandLikeName(b)) return stripReadWriteRole(b);
  return stripReadWriteRole(a);
}

function stripReadWriteRole(name: string): string {
  return name
    .trim()
    .replace(/\s*\((?:status|control|command)\)\s*$/i, '')
    .replace(/\s+(?:status|control|command)\s*$/i, '');
}

function isCommandLikeName(name: string): boolean {
  return /\b(?:status|control|command)\b/i.test(name);
}

function joinUniqueDescriptions(
  a: string | null,
  b: string | null,
): string | null {
  const descriptions = [a, b].filter((value): value is string =>
    Boolean(value && value.trim()),
  );
  const unique = Array.from(new Set(descriptions));
  return unique.length > 0 ? unique.join('. ') : null;
}

function isCompactHexAddress(value: string): boolean {
  const token = value.replace(/^0x/i, '');
  return /^[0-9a-fA-F]{1,4}$/.test(token);
}

interface DetectedTableExpansion extends TableExpansion {
  formulaKey: string;
}

/**
 * Detect per-unit address expansions for every table, then reject formulas
 * that are provably misapplied: when a table's own printed-address span is
 * at least the stride, the per-unit copies would overlap the table's own
 * rows, so the matched text is document prose (e.g. a cover note describing
 * another section), not a real expansion rule. A formula rejected on one
 * table is untrusted for every table that matched the same note.
 */
function resolveTableExpansions(
  raw: RawModbusExtraction,
  warnings: string[],
): Map<RawModbusTable, TableExpansion> {
  const detected = new Map<RawModbusTable, DetectedTableExpansion>();
  const invalidFormulaKeys = new Set<string>();

  for (const table of raw.tables) {
    const expansion = detectTableExpansion(table, raw.globalNotes ?? []);
    if (!expansion) continue;
    detected.set(table, expansion);

    const span = tablePrintedAddressSpan(table);
    if (span >= expansion.stride) {
      invalidFormulaKeys.add(expansion.formulaKey);
      warnings.push(
        `Ignored address formula +${expansion.stride}*${expansion.indexVar} on "${table.title ?? 'Modbus table'}": the table itself spans ${span + 1} addresses, so per-unit copies would overlap its own rows.`,
      );
    }
  }

  const expansions = new Map<RawModbusTable, TableExpansion>();
  for (const [table, expansion] of detected) {
    if (invalidFormulaKeys.has(expansion.formulaKey)) {
      if (tablePrintedAddressSpan(table) < expansion.stride) {
        warnings.push(
          `Ignored address formula +${expansion.stride}*${expansion.indexVar} on "${table.title ?? 'Modbus table'}": the same source note was rejected on another table of this document.`,
        );
      }
      continue;
    }
    expansions.set(table, expansion);
  }
  return expansions;
}

function tablePrintedAddressSpan(table: RawModbusTable): number {
  const printed = table.rows
    .map((row) => parseAddress(row.sourceAddress, table.registerTypeHint))
    .filter((address): address is ParsedAddress => address !== null)
    .map((address) => address.printed);
  if (printed.length < 2) return 0;
  return Math.max(...printed) - Math.min(...printed);
}

function detectTableExpansion(
  table: RawModbusTable,
  globalNotes: string[],
): DetectedTableExpansion | null {
  const tableText = (table.tableNotes ?? []).join(' ');
  const tableHasFormula = hasPerUnitFormula(tableText);
  const globalFormula = tableHasFormula
    ? null
    : globalNotes.find(
        (note) => hasPerUnitFormula(note) && tableMatchesFormulaNote(table, note),
      );
  const formulaText = tableHasFormula ? tableText : (globalFormula ?? '');
  if (!formulaText) return null;

  const stride = extractStride(formulaText);
  if (!stride) return null;

  const formulaKey = formulaText.toLowerCase().replace(/\s+/g, ' ').trim();
  const allNotes = `${formulaText} ${globalNotes.join(' ')}`;
  const explicitRange = extractIndexRange(allNotes);
  if (explicitRange) {
    return { stride, indexRange: explicitRange, indexVar: 'N', formulaKey };
  }

  const count = extractUnitCount(allNotes);
  if (count && count > 1) {
    return { stride, indexRange: [0, count - 1], indexVar: 'N', formulaKey };
  }

  if (
    hasFormulaAddressExamples(formulaText) ||
    (globalFormula && hasFormulaAddressExample(formulaText))
  ) {
    return { stride, indexRange: [0, 15], indexVar: 'N', formulaKey };
  }

  return null;
}

function tableMatchesFormulaNote(table: RawModbusTable, note: string): boolean {
  const examples =
    note
      .match(/\b[34]\d{4}\b/g)
      ?.map(Number)
      .filter((value) => Number.isFinite(value)) ?? [];
  if (examples.length === 0) return false;

  const rowAddresses = table.rows
    .map((row) => parseAddress(row.sourceAddress, table.registerTypeHint))
    .filter((address): address is ParsedAddress => address !== null)
    .map((address) => address.printed);
  const exactAddresses = new Set(rowAddresses);
  if (examples.some((example) => exactAddresses.has(example))) return true;

  return examples.some((example) =>
    rowAddresses.some(
      (rowAddress) =>
        sameModbusAddressFamily(rowAddress, example) &&
        Math.abs(rowAddress - example) <= FORMULA_NOTE_ADDRESS_WINDOW,
    ),
  );
}

function sameModbusAddressFamily(a: number, b: number): boolean {
  const familyA = modbusAddressFamily(a);
  const familyB = modbusAddressFamily(b);
  return familyA !== null && familyA === familyB;
}

function modbusAddressFamily(value: number): RegisterType | null {
  if (value >= 30001 && value <= 39999) return 'InputRegister';
  if (value >= 40001 && value <= 49999) return 'HoldingRegister';
  if (value >= 10001 && value <= 19999) return 'DiscreteInput';
  if (value >= 1 && value <= 9999) return 'Coil';
  return null;
}

function hasFormulaAddressExamples(text: string): boolean {
  const examples = text.match(/\b[34]\d{4}\b/g) ?? [];
  return examples.length >= 2;
}

function hasFormulaAddressExample(text: string): boolean {
  return /\b[34]\d{4}\b/.test(text);
}

function hasPerUnitFormula(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(?:plus|\+)\s*\d+\s*(?:\*|x)?\s*[a-z]/i.test(text) &&
    /(other|each|per|unit|slave|device|address|controller)/.test(lower)
  );
}

function extractStride(text: string): number | null {
  const patterns = [
    /(?:plus|\+)\s*(\d+)\s*(?:\*|x)?\s*[a-z]/i,
    /base\s*\+\s*(\d+)\s*(?:\*|x)?\s*[a-z]/i,
    /(\d+)\s*(?:\*|x)\s*[a-z]/i,
  ];
  for (const pattern of patterns) {
    const value = Number(text.match(pattern)?.[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function extractIndexRange(text: string): [number, number] | null {
  const direct =
    text.match(/[a-z]\s*=\s*(\d+)\s*(?:\.\.|-|to|~)\s*(\d+)/i) ??
    text.match(/address(?:\s+number)?\s*(\d+)\s*(?:\.\.|-|to|~)\s*(\d+)/i);
  if (!direct) return null;
  const min = Number(direct[1]);
  const max = Number(direct[2]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    return null;
  }
  return [min, max];
}

function extractUnitCount(text: string): number | null {
  const count =
    text.match(/(?:max(?:imum)?\.?\s*)?(\d+)\s+(?:heat\s+pump\s+)?(?:water\s+heater\s+)?(?:units|unit|slaves|devices)/i) ??
    text.match(/(?:max(?:imum)?\.?\s*)?(\d+)\s+(?:heat\s+pump\s+)?water\s+heaters?/i) ??
    text.match(/(?:units|slaves|devices)\s*[:=]?\s*(\d+)/i);
  const value = Number(count?.[1]);
  return Number.isInteger(value) && value > 1 ? value : null;
}

function inferDataType(registerType: RegisterType, text: string): DataType {
  if (registerType === 'Coil' || registerType === 'DiscreteInput') {
    return 'Boolean';
  }

  if (
    /\bsigned\b/i.test(text) ||
    /\bsigned\s*16\b/i.test(text) ||
    /\bint16\b/i.test(text) ||
    /16\s*bit\s*signed/i.test(text) ||
    /\bc2\b/i.test(text) ||
    /-32768/.test(text) ||
    /(?:^|[\s(:,])-\d+(?:\.\d+)?\s*[:=]/.test(text)
  ) {
    return 'Int16';
  }

  return 'Uint16';
}

function inferUnits(text: string): string | null {
  if (/[º°]\s*C|\bdeg(?:ree)?s?\s*C\b|\bcelsius\b/i.test(text)) return '°C';
  if (/\bkwh\b/i.test(text)) return 'kWh';
  if (/\bl\s*\/\s*min\b/i.test(text)) return 'l/min';
  if (/\bbar\b/i.test(text)) return 'bar';
  if (/\brpm\b/i.test(text)) return 'rpm';
  if (/%/.test(text)) return '%';
  if (/\bhz\b/i.test(text)) return 'Hz';
  if (/\bhours?\b|\bhrs?\b|\bh\b/i.test(text)) return 'h';
  if (/\bK\b/.test(text)) return 'K';
  if (/\b0\.01\s*A\b|\bamp(?:ere)?s?\b|\bA\b/.test(text)) return 'A';
  return null;
}

function inferSignalType(
  name: string,
  text: string,
  units: string | null,
): AIModbusSignal['signalType'] {
  if (units === '°C' || /temperature|temp\.?/i.test(name)) return 'temperature';
  if (/\b0\s*[:=-]\s*(?:off|stop|normal)\b/i.test(text) && /\b1\s*[:=-]\s*(?:on|run|alarm|error)\b/i.test(text)) {
    return 'binary';
  }
  if (/\bon\/off\b/i.test(`${name} ${text}`)) return 'binary';
  if (/\benum(?:eration)?\b|enum values\s*:/i.test(text)) return 'enum';
  return (countEnumStates(text) ?? 0) >= 2 ? 'enum' : null;
}

function inferMode(
  registerType: RegisterType,
  modeText: string | null,
  tableTitle: string | null,
): AIModbusSignal['mode'] {
  const title = tableTitle ?? '';
  const titleMode = inferSingleDirectionTableMode(title);
  const rowMode = parseModeText(modeText);

  if (titleMode && (!rowMode || rowMode === 'R/W')) return titleMode;
  if (rowMode) return rowMode;

  const titleReadWrite = parseModeText(title);
  if (titleReadWrite === 'R/W') return 'R/W';
  return registerType === 'InputRegister' || registerType === 'DiscreteInput'
    ? 'R'
    : 'R/W';
}

function parseModeText(text: string | null | undefined): AIModbusSignal['mode'] {
  const value = text?.trim();
  if (!value) return null;

  if (
    /\b(?:R\s*\/\s*W|W\s*\/\s*R)\b|\b(?:read|write)\s*(?:\/|-|\band\b)\s*(?:write|read)\b|\blectura\s*\/\s*escritura\b/i.test(
      value,
    )
  ) {
    return 'R/W';
  }
  if (/\b(?:read\s*only|only\s*read|readonly|solo\s+lectura)\b/i.test(value)) {
    return 'R';
  }
  if (/\b(?:write\s*only|only\s*write|writeonly|solo\s+escritura)\b/i.test(value)) {
    return 'W';
  }
  if (/^\s*R\s*$/i.test(value)) return 'R';
  if (/^\s*W\s*$/i.test(value)) return 'W';
  return null;
}

function inferSingleDirectionTableMode(
  title: string,
): AIModbusSignal['mode'] {
  if (!title.trim()) return null;
  if (mentionsReadAndWrite(title)) return null;
  if (isExplicitWriteTableTitle(title)) return 'W';
  if (isExplicitReadTableTitle(title)) return 'R';
  return null;
}

function mentionsReadAndWrite(text: string): boolean {
  return hasReadToken(text) && hasWriteToken(text);
}

function isExplicitWriteTableTitle(title: string): boolean {
  return (
    !/\bread\s*\/\s*write\b|\blectura\s*\/\s*escritura\b/i.test(title) &&
    hasWriteToken(title)
  );
}

function isExplicitReadTableTitle(title: string): boolean {
  return (
    !/\bread\s*\/\s*write\b|\blectura\s*\/\s*escritura\b/i.test(title) &&
    hasReadToken(title)
  );
}

function hasReadToken(text: string): boolean {
  return /\b(?:read|reading|lectura|leer)\b/i.test(text);
}

function hasWriteToken(text: string): boolean {
  return /\b(?:write|writing|command|escritura|escribir)\b/i.test(text);
}

function inferFactor(text: string): number | null {
  const examples = text.matchAll(
    /(-?\d+(?:\.\d+)?)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g,
  );
  for (const example of examples) {
    const raw = Number(example[1]);
    const displayed = Number(example[2]);
    if (raw !== 0 && Number.isFinite(raw) && Number.isFinite(displayed)) {
      const factor = displayed / raw;
      if (factor > 0 && factor <= 1000 && factor !== 1) {
        return roundFactor(factor);
      }
    }
  }

  const multiplied = text.match(/multipl(?:ied|y)\s+by\s+(\d+(?:\.\d+)?)/i);
  if (multiplied) {
    const divisor = Number(multiplied[1]);
    return divisor > 0 ? roundFactor(1 / divisor) : null;
  }

  const directScale =
    text.match(/×\s*(\d+(?:[.,]\d+)?)/) ??
    text.match(/\bx\s*(0[.,]\d+)\b/i);
  if (directScale) {
    const factor = Number(directScale[1].replace(',', '.'));
    if (factor > 0 && factor <= 1000 && factor !== 1) {
      return roundFactor(factor);
    }
  }

  const xScale = text.match(/\bx\s*(10|100|1000)\b/i);
  if (xScale) {
    return roundFactor(1 / Number(xScale[1]));
  }

  const slashScale = text.match(/\/\s*(10|100|1000)\b/i);
  if (slashScale) {
    return roundFactor(1 / Number(slashScale[1]));
  }

  return null;
}

function roundFactor(value: number): number {
  return Number(value.toPrecision(8));
}

function buildDeviceId(raw: RawModbusExtraction): string {
  const seed = raw.model ?? raw.manufacturer ?? 'COMMON';
  const cleaned = seed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 32) || 'COMMON';
}

function buildDescription(
  row: RawModbusRow,
  table: RawModbusTable,
  printedAddress: number,
): string {
  const parts = [
    table.title,
    `Source address ${printedAddress}`,
    row.groupText ? `Group: ${row.groupText}` : null,
    row.dataText,
    row.descriptionText,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.join('. ');
}

function buildSignalName(row: RawModbusRow, bit: number | null): string {
  const baseName =
    cleanName(row.name) || (row.isReserved === true ? 'Reserved' : '');
  const group = cleanName(row.groupText ?? '');
  const contextualName =
    bit === null || !group || includesSameWords(baseName, group)
      ? baseName
      : `${group} - ${baseName}`;

  return translateCommonSignalName(contextualName);
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function includesSameWords(name: string, context: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const normalizedName = normalize(name);
  const normalizedContext = normalize(context);
  return (
    normalizedContext.length > 0 &&
    (` ${normalizedName} `).includes(` ${normalizedContext} `)
  );
}

const COMMON_SIGNAL_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bActivaci[oó]n\s+escritura\s+estado\s+m[aá]quina\s+desde\s+remoto\b/gi, 'Remote machine state write activation'],
  [/\bActivaci[oó]n\s+pasaje\s+a\s+segundo\s+punto\s+de\s+consigna\b/gi, 'Second setpoint activation'],
  [/\bActivaci[oó]n\s+escritura\s+llamada\s+sanitaria\s+desde\s+remoto\b/gi, 'Remote DHW call write activation'],
  [/\bCiclo\s+anti-?legionella\s+en\s+curso\b/gi, 'Anti-legionella cycle active'],
  [/\bCiclo\s+anti-?legionella\s+fallido\s+o\s+interrumpido\b/gi, 'Anti-legionella cycle failed or interrupted'],
  [/\bAnti-?legionella\s+ejecutada\s+correctamente\b/gi, 'Anti-legionella completed successfully'],
  [/\bAnti-?legionella\s+fallido\s+o\s+interrumpido\b/gi, 'Anti-legionella failed or interrupted'],
  [/\bInversor\s+de\s+alta\s+presi[oó]n\b/gi, 'High pressure inverter'],
  [/\bError\s+del\s+motor\s+del\s+ventilador\b/gi, 'Fan motor error'],
  [/\bSobrecalentamiento\s+del\s+m[oó]dulo\s+inversor\b/gi, 'Inverter module overheating'],
  [/\bError\s+de\s+tensi[oó]n\s+del\s+bus\s+del\s+inversor\b/gi, 'Inverter bus voltage error'],
  [/\bAjustes\s+m[aá]quina\b/gi, 'Machine settings'],
  [/\bEstado\s+m[aá]quina\b/gi, 'Machine state'],
  [/\bPunto\s+(?:de\s+)?consigna\b/gi, 'Setpoint'],
  [/\bSegundo\b/gi, 'Second'],
  [/\bLlamada\s+sanitaria\b/gi, 'DHW call'],
  [/\bSolo\s+Sanitario\b/gi, 'DHW only'],
  [/\bSanitario\b/gi, 'DHW'],
  [/\bAlta\s+presi[oó]n\b/gi, 'High pressure'],
  [/\bBaja\s+presi[oó]n\b/gi, 'Low pressure'],
  [/\bFalta\s+flujo\b/gi, 'Flow fault'],
  [/\bHielo\b/gi, 'Ice'],
  [/\bFr[ií]o\b/gi, 'Cooling'],
  [/\bCalefacci[oó]n\b/gi, 'Heating'],
  [/\bTemperatura\b/gi, 'Temperature'],
  [/\bPresi[oó]n\b/gi, 'Pressure'],
  [/\bPotenza\b/gi, 'Power'],
  [/\bAlarmas?\b/gi, 'Alarms'],
];

function translateCommonSignalName(name: string): string {
  let translated = name;
  for (const [pattern, replacement] of COMMON_SIGNAL_TRANSLATIONS) {
    translated = translated.replace(pattern, replacement);
  }
  return cleanName(
    translated
      .replace(/\s+-\s+/g, ' - ')
      .replace(/\s+\+/g, ' +')
      .replace(/\+\s+/g, '+ '),
  );
}
