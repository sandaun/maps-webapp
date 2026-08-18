import { GROUP_SPECS, GENERAL_SPECS, describeSpec } from "@/protocols/me";

/**
 * SYNTHETIC ME–MBS fixture — built from the decompiled MAPS writers
 * (MbsObject.ToXml / ExternalME signal shapes and the FIXED address map),
 * NOT from a real gateway. Contains no secrets. The real 770 Air fixture
 * lives in .local-data/fixtures/ (gitignored) and is exercised by
 * project.test.ts only when present.
 */

interface SyntheticSignal {
  general?: boolean;
  spec: number;
  groupIndex?: number;
}

const SIGNALS: SyntheticSignal[] = [
  { general: true, spec: 0 }, // controller communication error
  { general: true, spec: 2 }, // On (all the groups)
  { spec: 0, groupIndex: 0 }, // On/Off
  { spec: 1, groupIndex: 0 }, // Operation Mode IC
  { spec: 4, groupIndex: 0 }, // Fan Speed IC (LUT 17 remap)
  { spec: 7, groupIndex: 0 }, // Temperature Setpoint ×10 (ARITH ×10 inverted)
  { spec: 9, groupIndex: 0 }, // Ambient Temperature ×10
  { spec: 15, groupIndex: 0 }, // Group error reset (trigger)
  { spec: 41, groupIndex: 0 }, // Room Humidity (URC)
];

function boolText(value: boolean): string {
  return value ? "True" : "False";
}

/** FIXED-mode address for this fixture's single controller. */
function addressOf(s: SyntheticSignal): number {
  if (s.general) return s.spec;
  const offsets: Record<number, number> = { 0: 0, 1: 1, 4: 2, 7: 4, 9: 5, 15: 11, 41: 32 };
  return ((s.groupIndex ?? 0) + 1) * 100 + offsets[s.spec];
}

function descriptionOf(s: SyntheticSignal): string {
  const info = describeSpec(s.spec, { general: s.general ?? false, fanSpeeds: 4 });
  return info ? `${info.description}  ${info.allowedValues}` : "";
}

function internalSignalXml(id: number, s: SyntheticSignal): string[] {
  const info = (s.general ? GENERAL_SPECS : GROUP_SPECS)[s.spec];
  const lines = [
    `      <Signal ID="${id}">`,
    `        <isEnabled>True</isEnabled>`,
    `        <idxConfig>${id}</idxConfig>`,
    `        <idxExternal>${id}</idxExternal>`,
    `        <IdxOperations>${info?.operations ?? ""}</IdxOperations>`,
    `        <IdxFilters></IdxFilters>`,
    `        <Description>${descriptionOf(s)}</Description>`,
    `        <LenBits>16</LenBits>`,
    `        <Format>${info?.format ?? 0}</Format>`,
    `        <Bit>255</Bit>`,
    `        <Address>${addressOf(s)}</Address>`,
    `        <ReadWrite>${info?.readWrite ?? 2}</ReadWrite>`,
    `        <StringLength>-1</StringLength>`,
    `        <SlaveIndex>-1</SlaveIndex>`,
    `        <GatewayIndex>-1</GatewayIndex>`,
    `        <Virtual Status="True" Fixed="True" General="${boolText(s.general ?? false)}" />`,
    `        <ProtocolIndex>-1</ProtocolIndex>`,
    `      </Signal>`,
  ];
  return lines;
}

function externalSignalXml(id: number, s: SyntheticSignal): string[] {
  const info = (s.general ? GENERAL_SPECS : GROUP_SPECS)[s.spec];
  const general = s.general ?? false;
  return [
    `      <Signal ID="${id}">`,
    `        <idxConfig>${id}</idxConfig>`,
    `        <idxExternal>${id}</idxExternal>`,
    `        <IdxOperations>${info?.operations ?? ""}</IdxOperations>`,
    `        <IdxFilters></IdxFilters>`,
    `        <UnitId>-1</UnitId>`,
    `        <IsIndoorSignal>False</IsIndoorSignal>`,
    `        <GroupIndex>${general ? -1 : (s.groupIndex ?? 0)}</GroupIndex>`,
    `        <G50Index>0</G50Index>`,
    `        <Virtual Status="True" Fixed="True" />`,
    `        <IsStatus>${boolText(info?.readWrite !== 1)}</IsStatus>`,
    `        <SignalIndex>${info?.signalIndex ?? -1}</SignalIndex>`,
    `        <SignalSpecIndex>${s.spec}</SignalSpecIndex>`,
    `      </Signal>`,
  ];
}

const HEADER_LINES = [
  "\uFEFF<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<Project xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" Platform=\"3\" CreatedBy=\"IntesisMAPS\" OEMCode=\"0\" ProjectName=\"synthetic-me-mbs.ibmaps\" ProjectDescription=\"Synthetic ME-MBS test project\" DeviceOrderCode=\"IN770AIRxxxO000\" ToolVersion=\"5.0.1217.9763\" InternalProtocol=\"Modbus Slave\" ExternalProtocol=\"Mitsubishi Electric\">",
  "  <Columns>",
  "    <InternalColumns>",
  "      <Column Name=\"#\" SignalsEnabled=\"True\" DiangosticEnabled=\"True\" Width=\"55\" />",
  "    </InternalColumns>",
  "  </Columns>",
  "  <Connection Pwd=\"\" isUSB=\"False\" Device=\"\" Port=\"23\" />",
  "  <Header Description=\"Synthetic ME-MBS test project\" Version=\"1.2.31.0\" CompatibilityVersion=\"0.0.0.0\" CreationVersion=\"1.2.23.0\" TimeStamp=\"01/01/2026 00:00:00\" Endianess=\"False\" LicenseMode=\"0\" CompatibilityID=\"8\" />",
  "  <IBOX Name=\"SYNTH-ME-MBS\" IP=\"192.168.1.60\" NetMask=\"255.255.255.0\" Gateway=\"192.168.1.1\" DNS=\"\" DNS2=\"\" DHCP=\"False\" Pwd=\"\" ExtraProtocol=\"0\">",
  "    <Conversions>",
  "      <Conversion Id=\"0\" Description=\"\" Type=\"2\" Param1=\"1\" Param2=\"1\" Param3=\"0\" Param4=\"0\" />",
  "    </Conversions>",
  "  </IBOX>",
  "  <InternalProtocol ProtocolType=\"Modbus Slave\">",
  "    <Media>2</Media>",
  "    <ByteOrder>0</ByteOrder>",
  "    <UpdateCOV>True</UpdateCOV>",
  "    <AddressMode>0</AddressMode>",
  "    <TempSetpoint>0</TempSetpoint>",
  "    <FormatExtra>0</FormatExtra>",
  "    <CommErrorTout>180</CommErrorTout>",
  "    <RegisterBase>0</RegisterBase>",
  "    <RTUConfig ConnectionType=\"1\" Baudrate=\"9600\" DataBits=\"8\" Parity=\"0\" StopBits=\"1\" SlaveNumber=\"3\" />",
  "    <TCPConfig Port=\"502\" KeepAlive=\"10\" />",
  "    <TemperatureSensor Enabled=\"False\" />",
  "    <SlaveAddressMode>0</SlaveAddressMode>",
  "    <MBSlavesArray>",
  "      <MBSlave Address=\"3\" Description=\"General Controller 1\" />",
  "      <MBSlave Address=\"4\" Description=\"C1G1\" />",
  "    </MBSlavesArray>",
  "    <Signals>",
];

const MIDDLE_LINES = [
  "    </Signals>",
  "  </InternalProtocol>",
  "  <ExternalProtocol ProtocolType=\"Mitsubishi Electric\">",
  "    <PollPeriod>100</PollPeriod>",
  "    <AnsTimeout>30</AnsTimeout>",
  "    <ControllerTout>30</ControllerTout>",
  "    <ReadCyclesPerAlarm>1</ReadCyclesPerAlarm>",
  "    <WriteMaxBurst>5</WriteMaxBurst>",
  "    <TemperatureMode>0</TemperatureMode>",
  "    <ConsumptionFunction Enabled=\"False\" InputMode=\"0\" SignalMode=\"0\" Units=\"1\" EnableRestartConsumption=\"False\" ConsumptionCapacity=\"1\">",
  "      <Assignments>",
  "        <Assignment Line=\"0\" OUIndex=\"-1\" MeterIndex=\"0\" IUIndexes=\"\" UnitIdxs=\"\" />",
  "      </Assignments>",
  "      <Meters>",
  "        <EnergyMeter Enabled=\"False\" Description=\"Energy Meter 1\" IPAddress=\"192.168.1.132\" Port=\"502\" SlaveNumber=\"1\" Register=\"0\" ReadFunction=\"0\" Units=\"0\" DataLength=\"0\" Format=\"0\" ByteOrder=\"0\" PulseMesurement=\"1\" TriggerEdgeMode=\"0\" AcRefreshCons=\"1\" PulseWidth=\"200\" />",
  "      </Meters>",
  "    </ConsumptionFunction>",
  "    <G50List>",
  "      <G50Controller>",
  "        <ID>0</ID>",
  "        <Description>VRF</Description>",
  "        <Enabled>False</Enabled>",
  "        <IP>192.168.1.129</IP>",
  "        <Port>80</Port>",
  "        <Type>0</Type>",
  "        <Model>2</Model>",
  "        <Compatibility>0</Compatibility>",
  "        <Setpoint05Support>1</Setpoint05Support>",
  "        <AddErrorSignals>False</AddErrorSignals>",
  "        <AuthUserId></AuthUserId>",
  "        <AuthPassword></AuthPassword>",
  "        <CertDownloadPort>8008</CertDownloadPort>",
  "        <PersistentConnection>False</PersistentConnection>",
  "        <GroupList>",
  "          <Group Index=\"0\" Enabled=\"True\" Description=\"Office\" Controller=\"0\" Type=\"0\" NumOfFanSpeeds=\"4\" DualSetPoint=\"False\" URC=\"True\" Capacity=\"6\" />",
  "          <Group Index=\"1\" Enabled=\"False\" Description=\"\" Controller=\"0\" Type=\"0\" NumOfFanSpeeds=\"4\" DualSetPoint=\"False\" URC=\"False\" Capacity=\"-1\" />",
  "        </GroupList>",
  "      </G50Controller>",
  "    </G50List>",
  "    <Signals>",
];

const FOOTER_LINES = ["    </Signals>", "  </ExternalProtocol>", "</Project>", ""];

const LINES = [
  ...HEADER_LINES,
  ...SIGNALS.flatMap((s, id) => internalSignalXml(id, s)),
  ...MIDDLE_LINES,
  ...SIGNALS.flatMap((s, id) => externalSignalXml(id, s)),
  ...FOOTER_LINES,
];

export const SYNTHETIC_ME_MBS_XML = LINES.join("\r\n");
