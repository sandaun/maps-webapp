/**
 * SYNTHETIC MBS–KNX fixture — built by hand from the decompiled MAPS writers
 * (`InternalMbs.GetXMLProtocol` + `MbsObject.ToXml`, `ExternalKnx.GetXMLProtocol`
 * + `KnxComObject.ToXML`), NOT from a project saved by MAPS: no such file is
 * available yet (docs/reference/mbs-knx-analisi.md §9). Contains no secrets.
 */

interface SyntheticSignal {
  enabled: boolean;
  description: string;
  lenBits: number;
  format: number;
  bit: number;
  address: number;
  readWrite: number;
  mbsOperations?: string;
  dpt: number;
  ga: [number, string];
  listening?: Array<[number, string]>;
  flags: string;
  knxOperations?: string;
  fixed?: boolean;
}

const SIGNALS: SyntheticSignal[] = [
  // 0: read/write setpoint ×10 on the Modbus side (operation 0).
  { enabled: true, description: "Setpoint", lenBits: 16, format: 0, bit: 255, address: 0, readWrite: 2, mbsOperations: "0,0", dpt: 2305, ga: [2049, "1/0/1"], flags: "UTWR" },
  // 1: 32-bit float the BMS reads (mode "write": no R, no T).
  { enabled: true, description: "Room temperature", lenBits: 32, format: 3, bit: 255, address: 1, readWrite: 0, dpt: 2305, ga: [2050, "1/0/2"], flags: "UW" },
  // 2: BitFields bit 3, with an additional (listening) address.
  { enabled: true, description: "Alarm", lenBits: 16, format: 4, bit: 3, address: 10, readWrite: 0, dpt: 257, ga: [2051, "1/0/3"], listening: [[2052, "1/0/4"]], flags: "UW" },
  // 3: trigger (mode "read": no W, no U, no Ri).
  { enabled: true, description: "Reset", lenBits: 16, format: 0, bit: 255, address: 11, readWrite: 1, dpt: 257, ga: [2053, "1/0/5"], flags: "TR" },
  // 4: disabled row on an address an active row already uses.
  { enabled: false, description: "Spare", lenBits: 16, format: 0, bit: 255, address: 0, readWrite: 2, dpt: 2047, ga: [2054, "1/0/6"], flags: "UTWR" },
];

function bool(value: boolean): string {
  return value ? "True" : "False";
}

function mbsSignalLines(s: SyntheticSignal, id: number): string[] {
  return [
    `      <Signal ID="${id}">`,
    `        <isEnabled>${bool(s.enabled)}</isEnabled>`,
    `        <idxConfig>${id}</idxConfig>`,
    `        <idxExternal>${id}</idxExternal>`,
    `        <IdxOperations>${s.mbsOperations ?? ""}</IdxOperations>`,
    "        <IdxFilters></IdxFilters>",
    `        <Description>${s.description}</Description>`,
    `        <LenBits>${s.lenBits}</LenBits>`,
    `        <Format>${s.format}</Format>`,
    `        <Bit>${s.bit}</Bit>`,
    `        <Address>${s.address}</Address>`,
    `        <ReadWrite>${s.readWrite}</ReadWrite>`,
    "        <StringLength>-1</StringLength>",
    "        <SlaveIndex>-1</SlaveIndex>",
    "        <GatewayIndex>-1</GatewayIndex>",
    `        <Virtual Status="False" Fixed="${bool(s.fixed ?? false)}" General="False" />`,
    "        <ProtocolIndex>-1</ProtocolIndex>",
    "      </Signal>",
  ];
}

function knxObjectLines(s: SyntheticSignal, id: number): string[] {
  const listening = s.listening ?? [];
  return [
    `    <KNXObject ID="${id}">`,
    "      <Description></Description>",
    "      <Active>True</Active>",
    "      <AllowedValues></AllowedValues>",
    `      <DPT Value="${s.dpt}" />`,
    `      <SendingAddress Value="${s.ga[0]}" String="${s.ga[1]}" />`,
    ...(listening.length === 0
      ? ["      <ListeningAddresses />"]
      : [
          "      <ListeningAddresses>",
          ...listening.map(([value, text]) => `        <Address Value="${value}" String="${text}" />`),
          "      </ListeningAddresses>",
        ]),
    `      <Flags U="${bool(s.flags.includes("U"))}" T="${bool(s.flags.includes("T"))}" Ri="${bool(s.flags.includes("I"))}" W="${bool(s.flags.includes("W"))}" R="${bool(s.flags.includes("R"))}" />`,
    "      <Priority>3</Priority>",
    "      <UpdateGA>0</UpdateGA>",
    `      <IdxExternal>${id}</IdxExternal>`,
    `      <IdxConfig>${id}</IdxConfig>`,
    `      <IdxOperations>${s.knxOperations ?? ""}</IdxOperations>`,
    "      <IdxFilters></IdxFilters>",
    `      <Virtual Status="False" Fixed="${bool(s.fixed ?? false)}" General="False" />`,
    "      <ProtocolIndex>-1</ProtocolIndex>",
    "    </KNXObject>",
  ];
}

function projectLines(signals: SyntheticSignal[]): string[] {
  return [
    "﻿<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Project xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" Platform=\"2\" CreatedBy=\"IntesisMAPS\" OEMCode=\"0\" ProjectName=\"synthetic-mbs-knx.ibmaps\" ProjectDescription=\"Synthetic MBS-KNX test project\" DeviceOrderCode=\"IN701KNXxxx0000\" ToolVersion=\"5.0.1217.9763\" InternalProtocol=\"Modbus Slave\" ExternalProtocol=\"KNX\">",
    "  <Connection Pwd=\"\" isUSB=\"False\" Device=\"\" Port=\"23\" />",
    "  <Header Description=\"Synthetic MBS-KNX test project\" Version=\"1.2.34.0\" CompatibilityVersion=\"0.0.0.0\" CreationVersion=\"1.2.34.0\" TimeStamp=\"01/01/2026 00:00:00\" Endianess=\"False\" LicenseMode=\"0\" CompatibilityID=\"7\" />",
    "  <IBOX Name=\"SYNTH-MBS-KNX\" IP=\"192.168.1.70\" NetMask=\"255.255.255.0\" Gateway=\"\" DNS=\"\" DNS2=\"\" DHCP=\"True\" Pwd=\"\" ExtraProtocol=\"0\">",
    "    <Conversions>",
    "      <Conversion Id=\"0\" Description=\"x 10\" Type=\"2\" Param1=\"1\" Param2=\"1\" Param3=\"0\" Param4=\"0\" />",
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
    "    <RTUConfig ConnectionType=\"1\" Baudrate=\"9600\" DataBits=\"8\" Parity=\"0\" StopBits=\"1\" SlaveNumber=\"1\" />",
    "    <TCPConfig Port=\"502\" KeepAlive=\"10\" />",
    "    <TemperatureSensor Enabled=\"False\" />",
    "    <SlaveAddressMode>0</SlaveAddressMode>",
    ...(signals.length === 0
      ? ["    <Signals />"]
      : ["    <Signals>", ...signals.flatMap(mbsSignalLines), "    </Signals>"]),
    "  </InternalProtocol>",
    "  <ExternalProtocol ProtocolType=\"KNX\">",
    "    <IndAddress>65535</IndAddress>",
    "    <Keys Key1=\"0001\" Key2=\"0002\" Key3=\"0003\" />",
    "    <UseExtendedAddresses>False</UseExtendedAddresses>",
    ...signals.flatMap(knxObjectLines),
    "  </ExternalProtocol>",
    "</Project>",
    "",
  ];
}

export const SYNTHETIC_MBS_KNX_XML = projectLines(SIGNALS).join("\r\n");

/** The same project with no signals (a freshly created one has the template's). */
export const SYNTHETIC_EMPTY_MBS_KNX_XML = projectLines([]).join("\r\n");
