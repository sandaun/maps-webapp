// Regression suite from Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc. Only import paths changed.
import { describe, expect, it } from 'vitest';
import { expandModbusTemplates } from './expand-templates';
import { normalizeRawModbusTables } from './normalize';
import type { RawModbusExtraction } from './schema';

describe('normalizeRawModbusTables', () => {
  it('turns table-level per-unit footnotes into compact templates only for the affected table', () => {
    const raw: RawModbusExtraction = {
      manufacturer: 'Example',
      model: 'Heat pump controller',
      globalNotes: ['Maximum 16 heat pump water heaters can be connected.'],
      tables: [
        {
          title: 'Input registers - heat pump status',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [
            'This address is for address number 0. Plus 200 * N for the other heat pump water heaters.',
          ],
          rows: [
            row(30001, 'Operation status', 'Initial value: 65535'),
            row(30006, 'Reserved', null, null, true),
            row(
              30014,
              'Outdoor air temperature',
              '16bit signed integer',
              'Example: -10:-1.0C; Initial value: -32768',
            ),
            row(
              30015,
              'Tank sensor 1',
              '16bit signed integer',
              'Example: 350:35.0C; Initial value: -32768',
            ),
            row(
              30023,
              'Tank sensor 9',
              '16bit signed integer',
              'Example: 350:35.0C; Initial value: -32768',
            ),
            row(30024, 'Water pump rpm', '16bit unsigned integer', 'rpm'),
          ],
        },
        {
          title: 'Input registers - system info',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [row(39001, 'Number of connected units')],
        },
        {
          title: 'Holding registers',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(
              40010,
              'Heating set temperature setpoint',
              '16bit unsigned integer',
              '0:Stop; 1:Run; Initial value: 65535',
            ),
          ],
        },
      ],
    };

    const normalized = normalizeRawModbusTables(raw);
    expect(normalized.detectedAddressBase).toBe('plc');
    expect(normalized.warnings).toEqual([]);

    const operation = normalized.signals.find(
      (signal) => signal.signalName === 'Operation status',
    );
    expect(operation?.address).toBeNull();
    expect(operation?.addressTemplate).toMatchObject({
      base: 0,
      stride: 200,
      indexRange: [0, 15],
    });

    const tank1 = normalized.signals.find(
      (signal) => signal.signalName === 'Tank sensor 1',
    );
    const tank9 = normalized.signals.find(
      (signal) => signal.signalName === 'Tank sensor 9',
    );
    const rpm = normalized.signals.find(
      (signal) => signal.signalName === 'Water pump rpm',
    );

    expect(tank1?.addressTemplate?.base).toBe(14);
    expect(tank9?.addressTemplate?.base).toBe(22);
    expect(rpm?.addressTemplate?.base).toBe(23);
    expect(tank1?.dataType).toBe('Int16');
    expect(tank1?.factor).toBe(0.1);
    expect(rpm?.dataType).toBe('Uint16');

    const systemInfo = normalized.signals.find(
      (signal) => signal.signalName === 'Number of connected units',
    );
    expect(systemInfo?.address).toBe(9000);
    expect(systemInfo?.addressTemplate).toBeNull();

    const holding = normalized.signals.find(
      (signal) => signal.signalName === 'Heating set temperature setpoint',
    );
    expect(holding?.address).toBe(9);
    expect(holding?.registerType).toBe('HoldingRegister');
    expect(holding?.dataType).toBe('Uint16');
  });

  it('uses global formula notes only when their address examples match the table', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: [
        'Maximum 16 heat pump water heaters can be connected.',
        'Plus 200*N for other heat pump water heaters. Example: No.0=30009, No.1=30209, No.2=30409.',
      ],
      tables: [
        {
          title: 'Input registers - heat pump status',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [row(30009, 'Heating ON/OFF')],
        },
        {
          title: 'Holding registers',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [row(40009, 'Heating ON/OFF command')],
        },
      ],
    });

    const input = normalized.signals.find(
      (signal) => signal.signalName === 'Heating ON/OFF',
    );
    const holding = normalized.signals.find(
      (signal) => signal.signalName === 'Heating ON/OFF command',
    );

    expect(input?.addressTemplate).toMatchObject({
      base: 8,
      stride: 200,
      indexRange: [0, 15],
    });
    expect(holding?.address).toBe(8);
    expect(holding?.addressTemplate).toBeNull();
  });

  it('preserves model-specific table and row scopes for UI filtering', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'NIBE',
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Common registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row(1, 'Software version')],
        },
        {
          title: 'S1156 / S735 registers',
          applicableModels: ['S1156 / S735'],
          registerTypeHint: 'InputRegister',
          tableNotes: null,
          rows: [
            row(1046, 'Current compressor frequency'),
            {
              ...row(1047, 'Compressor model override'),
              applicableModels: ['S735'],
            },
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.applicableModels,
      ]),
    ).toEqual([
      ['Software version', null],
      ['Current compressor frequency', ['S1156', 'S735']],
      ['Compressor model override', ['S735']],
    ]);
  });

  it('lets row-level register type override a wrong table hint', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'NIBE',
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'NIBE S735',
          applicableModels: ['S735'],
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            {
              ...row(20, 'Extract air (BT21)', 's16 °C Factor 10'),
              registerTypeHint: 'InputRegister',
            },
          ],
        },
      ],
    });

    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Extract air (BT21)',
      registerType: 'InputRegister',
      address: 20,
      applicableModels: ['S735'],
    });
  });

  it('parses zero-padded hexadecimal register columns as hex within the same table', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO',
      globalNotes: null,
      tables: [
        {
          title: 'Standard mode holding registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            row('000E', 'Run'),
            row('0011', 'ON/OFF'),
            row('001A', 'Ventilation speed door closed (proportional)'),
            row('200A', 'External equipment alarm'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
      ]),
    ).toEqual([
      ['Run', 14],
      ['ON/OFF', 17],
      ['Ventilation speed door closed (proportional)', 26],
      ['External equipment alarm', 8202],
    ]);
  });

  it('prefers the decimal column when sourceAddress contains a hex and decimal pair', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO Legacy',
      globalNotes: null,
      tables: [
        {
          title: 'Lectura de registro único (Legacy)',
          applicableModels: null,
          registerTypeHint: 'InputRegister',
          tableNotes: null,
          rows: [
            row('300C 12300', 'Start/Stop device'),
            row('1016 4118', 'Fan speed'),
            row('F050 61520', 'Indoor temperature'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
      ]),
    ).toEqual([
      ['Start/Stop device', 12300],
      ['Fan speed', 4118],
      ['Indoor temperature', 61520],
    ]);
  });

  it('keeps zero-padded decimal addresses decimal when the table has no hex evidence', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row('0011', 'Decimal register 11')],
        },
      ],
    });

    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Decimal register 11',
      address: 11,
    });
  });

  it('does not treat raw decimal register addresses as PLC discrete inputs without a discrete-input table hint', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO Legacy',
      globalNotes: null,
      tables: [
        {
          title: 'Lectura de registro único (Legacy)',
          applicableModels: null,
          registerTypeHint: 'InputRegister',
          tableNotes: null,
          rows: [row(12300, 'Start/Stop device', null, 'ON = 0001; OFF = 0000')],
        },
      ],
    });

    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Start/Stop device',
      registerType: 'InputRegister',
      address: 12300,
    });
  });

  it('preserves raw coil bit addresses when there is no PLC-style evidence', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Gree',
      model: 'Versati',
      globalNotes: null,
      tables: [
        {
          title: 'State Variables (Bit 0-Bit 199)',
          applicableModels: null,
          registerTypeHint: 'Coil',
          tableNotes: null,
          rows: [
            row(18, 'Fast Hot Water'),
            row(19, 'Cool+Hot Water Priority'),
            row(36, 'Manual defrost'),
            row(88, 'Ambient Temp Sensor Error'),
            row(108, 'Flow Switch Protection'),
            row(160, 'Remote Room Temp Sensor Error'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.registerType,
        signal.address,
      ]),
    ).toEqual([
      ['Fast Hot Water', 'Coil', 18],
      ['Cool+Hot Water Priority', 'Coil', 19],
      ['Manual defrost', 'Coil', 36],
      ['Ambient Temp Sensor Error', 'Coil', 88],
      ['Flow Switch Protection', 'Coil', 108],
      ['Remote Room Temp Sensor Error', 'Coil', 160],
    ]);
  });

  it('converts explicit PLC-style coil addresses with leading zeroes', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Example',
      model: 'PLC coil map',
      globalNotes: null,
      tables: [
        {
          title: 'Coils',
          applicableModels: null,
          registerTypeHint: 'Coil',
          tableNotes: null,
          rows: [row('00018', 'Fast Hot Water')],
        },
      ],
    });

    expect(normalized.detectedAddressBase).toBe('plc');
    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Fast Hot Water',
      registerType: 'Coil',
      address: 17,
    });
  });

  it('converts low coil PLC addresses when unambiguous PLC ranges are present', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Example',
      model: 'Mixed PLC map',
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row(40001, 'Mode')],
        },
        {
          title: 'Coils',
          applicableModels: null,
          registerTypeHint: 'Coil',
          tableNotes: null,
          rows: [row(18, 'Fast Hot Water')],
        },
      ],
    });

    expect(normalized.detectedAddressBase).toBe('plc');
    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.registerType,
        signal.address,
      ]),
    ).toEqual([
      ['Mode', 'HoldingRegister', 0],
      ['Fast Hot Water', 'Coil', 17],
    ]);
  });

  it('keeps matching read and write table rows as separate directional signals', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO',
      globalNotes: null,
      tables: [
        {
          title: 'Read register table',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row('0011', 'ON/OFF', null, 'ON = 0001; OFF = 0000')],
        },
        {
          title: 'Write register table',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row('0011', 'ON/OFF', null, 'ON = 0001; OFF = 0000')],
        },
      ],
    });

    expect(normalized.signals).toHaveLength(2);
    expect(normalized.signals).toEqual([
      expect.objectContaining({
        signalName: 'ON/OFF',
        address: 11,
        mode: 'R',
        signalType: 'binary',
      }),
      expect.objectContaining({
        signalName: 'ON/OFF',
        address: 11,
        mode: 'W',
        signalType: 'binary',
      }),
    ]);
  });

  it('keeps status/control suffix variants as separate directional signals', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO',
      globalNotes: null,
      tables: [
        {
          title: 'Read register table',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row(15, 'Door Contact (status)')],
        },
        {
          title: 'Write register table',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row(15, 'Door Contact (control)')],
        },
      ],
    });

    expect(normalized.signals).toHaveLength(2);
    expect(normalized.signals).toEqual([
      expect.objectContaining({
        signalName: 'Door Contact (status)',
        address: 15,
        mode: 'R',
      }),
      expect.objectContaining({
        signalName: 'Door Contact (control)',
        address: 15,
        mode: 'W',
      }),
    ]);
  });

  it('does not absorb same-register write command aliases into the existing read signal', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO',
      globalNotes: null,
      tables: [
        {
          title: 'Read register table',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row(19, 'Current Fan Speed (stages)', null, '0..5')],
        },
        {
          title: 'Write register table',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row(19, 'Fan Speed Command (stages)', null, '0..5')],
        },
      ],
    });

    expect(normalized.signals).toHaveLength(2);
    expect(normalized.signals).toEqual([
      expect.objectContaining({
        signalName: 'Current Fan Speed (stages)',
        address: 19,
        mode: 'R',
      }),
      expect.objectContaining({
        signalName: 'Fan Speed Command (stages)',
        address: 19,
        mode: 'W',
      }),
    ]);
  });

  it('infers Spanish lectura/escritura table titles as read/write modes', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO',
      globalNotes: null,
      tables: [
        {
          title: 'Modo estándar - Tabla de registros lectura',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row('0011', 'ON/OFF')],
        },
        {
          title: 'Tabla de registros escritura',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [row('0011', 'ON/OFF')],
        },
      ],
    });

    expect(normalized.signals.map((signal) => signal.mode)).toEqual(['R', 'W']);
  });

  it('treats W/R source cells as read-write mode', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Haier',
      model: 'R290 ATW',
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            { ...row(40301, 'Data type'), modeText: 'W/R' },
            { ...row(40302, 'Query type'), modeText: 'W/R' },
          ],
        },
      ],
    });

    expect(normalized.signals).toEqual([
      expect.objectContaining({
        signalName: 'Data type',
        registerType: 'HoldingRegister',
        address: 300,
        mode: 'R/W',
      }),
      expect.objectContaining({
        signalName: 'Query type',
        registerType: 'HoldingRegister',
        address: 301,
        mode: 'R/W',
      }),
    ]);
  });

  it('does not let mixed Read/Write FC table titles override row access modes', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Gree',
      model: 'Versati',
      globalNotes: null,
      tables: [
        {
          title:
            'Holding Registers (16-bit Word) - Read FC 0x03, Write FC 0x10',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            { ...row(2, 'Mode'), modeText: 'R/W' },
            { ...row(118, 'T-outdoor'), modeText: 'R' },
          ],
        },
        {
          title: 'Coils (1-bit) - Read FC 0x01, Write FC 0x0F',
          applicableModels: null,
          registerTypeHint: 'Coil',
          tableNotes: null,
          rows: [
            { ...row(18, 'Fast Hot Water'), modeText: 'W/R' },
            { ...row(88, 'Ambient Temp Sensor Error'), modeText: 'R' },
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.registerType,
        signal.address,
        signal.mode,
      ]),
    ).toEqual([
      ['Mode', 'HoldingRegister', 2, 'R/W'],
      ['T-outdoor', 'HoldingRegister', 118, 'R'],
      ['Fast Hot Water', 'Coil', 18, 'R/W'],
      ['Ambient Temp Sensor Error', 'Coil', 88, 'R'],
    ]);
  });

  it('counts slash-separated Gree register states without counting 16-bit text', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Gree',
      model: 'Versati',
      globalNotes: null,
      tables: [
        {
          title:
            'Holding Registers (16-bit Word) - Read FC 0x03, Write FC 0x10',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            {
              ...row(
                2,
                'Mode',
                '16 Unsigned',
                '1:Heat / 2:Hot water / 3:Cool+Heat water / 4:Heat+Hot water / 5:Cool',
              ),
              modeText: 'R/W',
            },
          ],
        },
      ],
    });

    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Mode',
      signalType: 'enum',
      statesCount: 5,
      mode: 'R/W',
    });
  });

  it('lets explicit read/write table titles override ambiguous row mode text', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Airtecnics',
      model: 'Clever PRO Legacy',
      globalNotes: null,
      tables: [
        {
          title: 'Lectura de registro único (Legacy)',
          applicableModels: null,
          registerTypeHint: 'InputRegister',
          tableNotes: null,
          rows: [{ ...row(4118, 'Fan speed'), modeText: 'R/W' }],
        },
        {
          title: 'Tabla de registros escritura (Legacy)',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [{ ...row(12309, 'Fan speed'), modeText: 'R/W' }],
        },
      ],
    });

    expect(normalized.signals.map((signal) => signal.mode)).toEqual(['R', 'W']);
  });

  it('does not merge same-address rows with different names', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            row(200, 'External equipment alarm'),
            row(200, 'Communications alarm'),
          ],
        },
      ],
    });

    expect(normalized.signals.map((signal) => signal.signalName)).toEqual([
      'External equipment alarm',
      'Communications alarm',
    ]);
  });

  it('uses a conservative 16-unit range for clear table formulas with examples but no explicit count', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: [
        'Plus 200*N for other units. Example: No.0=30009, No.1=30209, No.2=30409.',
      ],
      tables: [
        {
          title: 'Input registers - unit status',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [row(30009, 'Heating ON/OFF')],
        },
      ],
    });

    expect(normalized.signals[0].addressTemplate).toMatchObject({
      base: 8,
      stride: 200,
      indexRange: [0, 15],
    });
  });

  it('applies a referenced Q-ton address footnote to nearby rows in the same address family', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'MHI',
      model: 'Q-ton',
      globalNotes: [
        '(*1) This address is for address number 0 of heat pump water heater. Plus 200 * N(address number) for the other heat pump water heater. Example: heat pump water heater No.0 = 30009, No.1 = 30209, No.2 = 30409',
      ],
      tables: [
        {
          title: 'Input registers - Address(*1)',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [
            row(30025, 'Compressor Hz', null, '65535:Initial value'),
            row(
              30026,
              'Gas cooler inlet water temperature',
              '16bit signed integer',
              'This value is multiplied by 10.',
            ),
            row(30040, 'Periodic check', null, '0:Normal 1:Periodic check1'),
          ],
        },
      ],
    });

    expect(normalized.signals).toHaveLength(3);
    expect(normalized.signals[0].addressTemplate).toMatchObject({
      base: 24,
      stride: 200,
      indexRange: [0, 15],
    });
    expect(normalized.signals[1].addressTemplate).toMatchObject({
      base: 25,
      stride: 200,
      indexRange: [0, 15],
    });
    expect(normalized.signals[2].addressTemplate).toMatchObject({
      base: 39,
      stride: 200,
      indexRange: [0, 15],
    });
  });

  it('does not use the fallback range when formula examples do not match the table', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: [
        'Plus 200*N for other units. Example: No.0=30009, No.1=30209, No.2=30409.',
      ],
      tables: [
        {
          title: 'Holding registers',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [row(40009, 'Heating ON/OFF command')],
        },
      ],
    });

    expect(normalized.signals[0].address).toBe(8);
    expect(normalized.signals[0].addressTemplate).toBeNull();
  });

  it('does not apply nearby matching to distant tables in the same address family', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: [
        'Plus 200*N for other units. Example: No.0=30009, No.1=30209, No.2=30409.',
      ],
      tables: [
        {
          title: 'Input registers - system info',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [row(39001, 'Number of connected units')],
        },
      ],
    });

    expect(normalized.signals[0].address).toBe(9000);
    expect(normalized.signals[0].addressTemplate).toBeNull();
  });

  it('expands collapsed consecutive source address ranges into flat rows', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Input registers - system info',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [],
          rows: [
            row(
              '39002, 39003, . 39017',
              'Heat pump water heater address No.',
            ),
          ],
        },
      ],
    });

    expect(normalized.signals).toHaveLength(16);
    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Heat pump water heater address No. (0)',
      address: 9001,
    });
    expect(normalized.signals[15]).toMatchObject({
      signalName: 'Heat pump water heater address No. (15)',
      address: 9016,
    });
  });

  it('expands compact table templates deterministically', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: ['Maximum 3 units.'],
      tables: [
        {
          title: 'Input registers',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: ['Plus 100*N for each unit.'],
          rows: [row(30002, 'Operation mode')],
        },
      ],
    });

    const expanded = expandModbusTemplates(normalized.signals);
    expect(expanded.signals.map((signal) => signal.address)).toEqual([
      1, 101, 201,
    ]);
    expect(expanded.signals.map((signal) => signal.signalName)).toEqual([
      'Operation mode (Unit 0)',
      'Operation mode (Unit 1)',
      'Operation mode (Unit 2)',
    ]);
  });

  it('skips placeholder rows for unnamed blank source cells before template expansion', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: ['Maximum 16 heat pump water heaters can be connected.'],
      tables: [
        {
          title: 'Input registers - heat pump status',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: [
            'Plus 200*N for the other heat pump water heaters. Example: No.0=30009, No.1=30209.',
          ],
          rows: [
            row(30010, 'Heating set temperature'),
            row(30011, '(unnamed - heating related temperature)'),
            row(30012, 'Error status'),
          ],
        },
      ],
    });

    expect(normalized.signals.map((signal) => signal.signalName)).toEqual([
      'Heating set temperature',
      'Error status',
    ]);
    expect(
      normalized.signals.map((signal) => signal.addressTemplate?.base),
    ).toEqual([9, 11]);
  });

  it('preserves BIT MASK bit positions and skips aggregate alarm headings', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers - alarms',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(950, 'Alarmas', 'BIT MASK'),
            bitRow(950, 0, 'Alta presión', 'BIT MASK'),
            bitRow(950, 1, 'Baja presión', 'BIT MASK'),
            bitRow(950, 4, 'Hielo', 'BIT MASK'),
            bitRow(950, 5, 'Falta flujo', 'BIT MASK'),
          ],
        },
      ],
    });

    expect(normalized.signals).toHaveLength(4);
    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
        signal.bit,
        signal.bitCount,
        signal.dataType,
      ]),
    ).toEqual([
      ['High pressure', 950, 0, 1, 'Boolean'],
      ['Low pressure', 950, 1, 1, 'Boolean'],
      ['Ice', 950, 4, 1, 'Boolean'],
      ['Flow fault', 950, 5, 1, 'Boolean'],
    ]);
  });

  it('expands inline bit-coded B labels emitted as one aggregate row', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Stiebel Eltron',
      model: 'ISG WEB WPM 3i',
      globalNotes: null,
      tables: [
        {
          title: 'System status (Read input register)',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(
              2501,
              'Operating status',
              '6 → Unsigned16',
              'bit-coded, WPM 3i; B0 = HC 1 PUMP, B1 = HC 2 PUMP, B11 = SILENT MODE 2 ACTIVE (HP OFF)',
            ),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
        signal.bit,
        signal.bitCount,
        signal.dataType,
      ]),
    ).toEqual([
      ['Operating status - HC 1 PUMP', 2501, 0, 1, 'Boolean'],
      ['Operating status - HC 2 PUMP', 2501, 1, 1, 'Boolean'],
      [
        'Operating status - SILENT MODE 2 ACTIVE (HP OFF)',
        2501,
        11,
        1,
        'Boolean',
      ],
    ]);
  });

  it('skips bit-coded aggregate rows when explicit bit children already exist', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Stiebel Eltron',
      model: 'ISG WEB WPM 3i',
      globalNotes: null,
      tables: [
        {
          title: 'System status (Read input register)',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(2501, 'Operating status', '6 → Unsigned16', 'bit-coded, WPM 3i'),
            bitRow(2501, 0, 'HC 1 PUMP', 'bit-coded'),
            bitRow(2501, 11, 'SILENT MODE 2 ACTIVE (HP OFF)', 'bit-coded'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
        signal.bit,
      ]),
    ).toEqual([
      ['HC 1 PUMP', 2501, 0],
      ['SILENT MODE 2 ACTIVE (HP OFF)', 2501, 11],
    ]);
  });

  it('groups and sorts explicit bit-coded children when extraction emits one late', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Stiebel Eltron',
      model: 'ISG WEB WPM 3i',
      globalNotes: null,
      tables: [
        {
          title: 'System status (Read input register)',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            bitRow(2501, 0, 'HC 1 PUMP', 'bit-coded'),
            bitRow(2501, 1, 'HC 2 PUMP', 'bit-coded'),
            bitRow(2501, 4, 'COMPRESSOR', 'bit-coded'),
            row(2502, 'Fault status', '6 → Unsigned16'),
            bitRow(2501, 3, 'NHZ STAGES RUNNING', 'bit-coded'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
        signal.bit,
      ]),
    ).toEqual([
      ['HC 1 PUMP', 2501, 0],
      ['HC 2 PUMP', 2501, 1],
      ['NHZ STAGES RUNNING', 2501, 3],
      ['COMPRESSOR', 2501, 4],
      ['Fault status', 2502, null],
    ]);
  });

  it('parses Stiebel Signed16 scaling and source units', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Stiebel Eltron',
      model: 'ISG WEB WPM 3i',
      globalNotes: null,
      tables: [
        {
          title: 'System values (Read input register)',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(501, 'Actual temperature FE7', '2 → Signed16, ×0,1', '°C'),
            row(520, 'Heating pressure', '7 → Signed16, ×0,01', 'bar'),
            row(518, 'Flow rate', '6 → Unsigned16', 'l/min'),
            row(1518, 'Flow temp hysteresis', '2 → Signed16, ×0,1', 'K'),
            row(3501, 'VD heating day', '6 → Unsigned16', 'kWh'),
            row(3517, 'VD heating', '6 → Unsigned16', 'h'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.address,
        signal.dataType,
        signal.factor,
        signal.units,
      ]),
    ).toEqual([
      [501, 'Int16', 0.1, '°C'],
      [520, 'Int16', 0.01, 'bar'],
      [518, 'Uint16', null, 'l/min'],
      [1518, 'Int16', 0.1, 'K'],
      [3501, 'Uint16', null, 'kWh'],
      [3517, 'Uint16', null, 'h'],
    ]);
  });

  it('preserves Haier bitfield source ranges', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: 'Haier',
      model: 'R290 ATW',
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            bitRow(40190, 0, 'System enable', 'BIT MASK'),
            bitRow(40190, 1, 'Heating enable', 'BIT MASK'),
            bitRow(40350, '0-15', 'Thermostat 0 status flags', 'BIT MASK'),
          ],
        },
      ],
    });

    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.address,
        signal.bit,
        signal.bitCount,
      ]),
    ).toEqual([
      ['System enable', 189, 0, 1],
      ['Heating enable', 189, 1, 1],
      ['Thermostat 0 status flags', 349, 0, 16],
    ]);
  });

  it('keeps bitfield group context in the final English signal name', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers - commands',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            bitRow(
              7201,
              0,
              'Activación escritura estado máquina desde remoto',
              'BIT MASK',
              'Ajustes máquina',
            ),
            bitRow(
              7202,
              0,
              'Segundo punto de consigna',
              'BIT MASK',
              'Punto Consigna',
            ),
          ],
        },
      ],
    });

    expect(normalized.signals.map((signal) => signal.signalName)).toEqual([
      'Machine settings - Remote machine state write activation',
      'Setpoint - Second Setpoint',
    ]);
    expect(normalized.signals[0].description).toContain(
      'Group: Ajustes máquina',
    );
  });

  it('does not warn for enum value rows without addresses', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(
              7200,
              'Estado máquina',
              'INT',
              '0=Stand by; 1=Frío; 2=Calefacción',
            ),
            row('', '(1) Frío'),
            row('', '(2) Calefacción'),
          ],
        },
      ],
    });

    expect(normalized.warnings).toEqual([]);
    expect(normalized.signals).toHaveLength(1);
    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Machine state',
      address: 7200,
      signalType: 'enum',
      statesCount: 3,
    });
  });

  it('collapses same-address enum value rows into one register signal', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(7200, '(0) Stand by', 'INT'),
            row(7200, '(1) Frío', 'INT'),
            row(7200, '(2) Calefacción', 'INT'),
            row(7200, '(4) Solo Sanitario', 'INT'),
          ],
        },
      ],
    });

    expect(normalized.warnings).toEqual([]);
    expect(normalized.signals).toHaveLength(1);
    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Register 7200 enum',
      address: 7200,
      signalType: 'enum',
      statesCount: 4,
    });
    expect(normalized.signals[0].description).toContain('0=Stand by');
    expect(normalized.signals[0].description).toContain('4=Solo Sanitario');
  });

  it('detects single-row parenthesized enum values as one register signal', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Machine settings',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            {
              ...row(
                7200,
                'Estado máquina',
                'INT',
                '(0) Stand by, (1) Frío, (2) Calefacción, (4) Solo Sanitario, (5) Frío + Sanitario, (6) Calefacción + Sanitario',
              ),
              modeText: 'W',
            },
          ],
        },
      ],
    });

    expect(normalized.warnings).toEqual([]);
    expect(normalized.signals).toHaveLength(1);
    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Machine state',
      address: 7200,
      signalType: 'enum',
      statesCount: 6,
      mode: 'W',
    });
  });

  it('collapses same-address enum labels even when numeric values were dropped', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Holding registers',
          applicableModels: null,
          registerTypeHint: 'HoldingRegister',
          tableNotes: null,
          rows: [
            row(7200, 'Stand by', 'INT'),
            row(7200, 'Frío', 'INT'),
            row(7200, 'Calefacción', 'INT'),
            row(7200, 'Solo Sanitario', 'INT'),
            row(7200, 'Frío + Sanitario', 'INT'),
            row(7200, 'Calefacción + Sanitario', 'INT'),
          ],
        },
      ],
    });

    expect(normalized.warnings).toEqual([]);
    expect(normalized.signals).toHaveLength(1);
    expect(normalized.signals[0]).toMatchObject({
      signalName: 'Register 7200 enum',
      address: 7200,
      signalType: 'enum',
      statesCount: 6,
    });
    expect(normalized.signals[0].description).toContain(
      'Enum values: Stand by; Frío; Calefacción',
    );
  });

  it('uses explicit normalized addresses without subtracting coils again', () => {
    const normalized = normalizeRawModbusTables({
      manufacturer: null,
      model: null,
      globalNotes: null,
      tables: [
        {
          title: 'Common factor table',
          applicableModels: null,
          registerTypeHint: null,
          tableNotes: null,
          rows: [
            {
              ...row(5, 'Confirm Modbus Changes'),
              normalizedAddress: 4,
              registerTypeHint: 'Coil',
            },
            {
              ...row(2, 'Reset Alarms by Modbus'),
              normalizedAddress: 1,
              registerTypeHint: 'Coil',
            },
            {
              ...row(60, 'Permission Compressor On/Off'),
              normalizedAddress: 59,
              registerTypeHint: 'Coil',
            },
            {
              ...row(61, 'On/Off Pump by BMS'),
              normalizedAddress: 60,
              registerTypeHint: 'HoldingRegister',
            },
          ],
        },
      ],
    });

    expect(normalized.detectedAddressBase).toBe('0-based');
    expect(
      normalized.signals.map((signal) => [
        signal.signalName,
        signal.registerType,
        signal.address,
      ]),
    ).toEqual([
      ['Confirm Modbus Changes', 'Coil', 4],
      ['Reset Alarms by Modbus', 'Coil', 1],
      ['Permission Compressor On/Off', 'Coil', 59],
      ['On/Off Pump by BMS', 'HoldingRegister', 60],
    ]);
  });

  it('rejects per-unit formulas that would overlap the table itself, document-wide', () => {
    // MHI ESP-FP-2532 Option 1 (unit direct): the cover prose "Section 6.2
    // ditto blocks are fully expanded (address = unit #01 address + 200 x N)"
    // describes a section that is not even in the PDF. Kimi copies it into
    // globalNotes (sometimes with address examples), which used to expand
    // both tables x16 (149 rows -> 2384 signals) and collide with real rows:
    // 6.4 spans 30001-32004, far beyond the 200-address stride.
    const raw: RawModbusExtraction = {
      manufacturer: 'MHI',
      model: 'MSV2',
      globalNotes: [
        'Section 6.2 ditto blocks are fully expanded (address = unit #01 address + 200 x N; unit #01 30001, 40001).',
      ],
      tables: [
        {
          title: '6.4 MSV2 Unit Consolidated Input Register Data',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(30001, 'CnTA-out assignment 1'),
            row(30201, 'CnTD-in assignment 1'),
            row(32004, 'unit heating operating time'),
          ],
        },
        {
          title: '6.5 MSV2 Unit Consolidated Holding Register Data',
          registerTypeHint: 'HoldingRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(40001, 'chilled water temperature setpoint'),
            row(40104, 'silent control input'),
          ],
        },
      ],
    };

    const result = normalizeRawModbusTables(raw);

    expect(result.signals).toHaveLength(5);
    expect(result.signals.every((signal) => signal.addressTemplate === null)).toBe(
      true,
    );
    expect(
      result.warnings.filter((warning) =>
        warning.includes('Ignored address formula'),
      ),
    ).toHaveLength(2);
    expect(result.infos).toHaveLength(0);
  });

  it('keeps reserved/spare rows that have a printed address', () => {
    // The MHI ESP-FP-2532 map allocates 13 "Spare (CnTD-…)" input registers
    // that the integrator selects on purpose; dropping them makes the
    // Coverage Gate fail (e.g. 136/149 matched).
    const raw: RawModbusExtraction = {
      manufacturer: 'MHI',
      model: 'MSV2',
      globalNotes: null,
      tables: [
        {
          title: 'MSV2 Unit Consolidated Input Register Data',
          registerTypeHint: 'InputRegister',
          applicableModels: null,
          tableNotes: null,
          rows: [
            row(31759, 'unit silent status', '0,1', '0:OFF 1:ON'),
            row(31760, 'Spare (CnTD-in assignment 24)', '0,1', '0:OFF 1:ON', true),
            row(31761, 'Reserved', null, null, true),
            row('', 'Reserved for future expansion of this table', null, null, true),
          ],
        },
      ],
    };

    const result = normalizeRawModbusTables(raw);

    expect(
      result.signals.map((signal) => [signal.signalName, signal.address]),
    ).toEqual([
      ['unit silent status', 1758],
      ['Spare (CnTD-in assignment 24)', 1759],
      ['Reserved', 1760],
    ]);
  });
});

function row(
  sourceAddress: number | string,
  name: string,
  dataText: string | null = null,
  descriptionText: string | null = null,
  isReserved: boolean | null = null,
) {
  return {
    sourceAddress,
    normalizedAddress: null,
    normalizedAddressSource: null,
    name,
    groupText: null,
    registerTypeHint: null,
    dataText,
    sourceBit: null,
    descriptionText,
    modeText: null,
    applicableModels: null,
    isReserved,
  };
}

function bitRow(
  sourceAddress: number | string,
  sourceBit: number | string,
  name: string,
  dataText: string | null = null,
  groupText: string | null = null,
) {
  return {
    sourceAddress,
    normalizedAddress: null,
    normalizedAddressSource: null,
    name,
    groupText,
    registerTypeHint: null,
    dataText,
    sourceBit,
    descriptionText: null,
    modeText: null,
    applicableModels: null,
    isReserved: null,
  };
}
