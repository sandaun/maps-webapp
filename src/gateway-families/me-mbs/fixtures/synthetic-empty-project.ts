/**
 * SYNTHETIC empty ME–MBS project: two AE-200 controllers with 50 disabled IC
 * groups each (4 fan speeds, dual setpoint) and no signals, shaped like a new
 * project saved by MAPS. Built by hand, NOT from a real gateway; contains no
 * secrets. Starting point for the signal-engine tests that must run without
 * the local reference files (.local-data/, gitignored).
 */

function controllerLines(id: number): string[] {
  return [
    "      <G50Controller>",
    `        <ID>${id}</ID>`,
    "        <Description></Description>",
    "        <Enabled>False</Enabled>",
    "        <IP>192.168.1.1</IP>",
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
    ...Array.from(
      { length: 50 },
      (_, i) =>
        `          <Group Index="${i}" Enabled="False" Description="" Controller="${id}" Type="0" NumOfFanSpeeds="4" DualSetPoint="True" URC="False" Capacity="-1" />`,
    ),
    "        </GroupList>",
    "      </G50Controller>",
  ];
}

const LINES = [
  "﻿<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<Project xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" Platform=\"3\" CreatedBy=\"IntesisMAPS\" OEMCode=\"0\" ProjectName=\"synthetic-empty-me-mbs.ibmaps\" ProjectDescription=\"Synthetic empty ME-MBS test project\" DeviceOrderCode=\"IN770AIRxxxO000\" ToolVersion=\"5.0.1217.9763\" InternalProtocol=\"Modbus Slave\" ExternalProtocol=\"Mitsubishi Electric\">",
  "  <Connection Pwd=\"\" isUSB=\"False\" Device=\"\" Port=\"23\" />",
  "  <Header Description=\"Synthetic empty ME-MBS test project\" Version=\"1.2.34.0\" CompatibilityVersion=\"0.0.0.0\" CreationVersion=\"1.2.34.0\" TimeStamp=\"01/01/2026 00:00:00\" Endianess=\"False\" LicenseMode=\"0\" CompatibilityID=\"8\" />",
  "  <IBOX Name=\"SYNTH-ME-MBS\" IP=\"192.168.1.60\" NetMask=\"255.255.255.0\" Gateway=\"\" DNS=\"\" DNS2=\"\" DHCP=\"True\" Pwd=\"\" ExtraProtocol=\"0\" />",
  "  <InternalProtocol ProtocolType=\"Modbus Slave\">",
  "    <Media>0</Media>",
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
  "    <Signals />",
  "  </InternalProtocol>",
  "  <ExternalProtocol ProtocolType=\"Mitsubishi Electric\">",
  "    <PollPeriod>200</PollPeriod>",
  "    <AnsTimeout>30</AnsTimeout>",
  "    <ControllerTout>30</ControllerTout>",
  "    <ReadCyclesPerAlarm>1</ReadCyclesPerAlarm>",
  "    <WriteMaxBurst>5</WriteMaxBurst>",
  "    <TemperatureMode>0</TemperatureMode>",
  "    <ConsumptionFunction Enabled=\"False\" InputMode=\"0\" SignalMode=\"0\" Units=\"0\" EnableRestartConsumption=\"False\" ConsumptionCapacity=\"1\" />",
  "    <G50List>",
  ...controllerLines(0),
  ...controllerLines(1),
  "    </G50List>",
  "    <Signals />",
  "  </ExternalProtocol>",
  "</Project>",
  "",
];

export const SYNTHETIC_ME_MBS_EMPTY_XML = LINES.join("\r\n");
