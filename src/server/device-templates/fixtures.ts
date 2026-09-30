/** Synthetic template: mixed widths, flags, disabled objects and positional conversion IDs. */
export const TEMPLATE_XML = `<Template Version="1.0.0.0" MAPSVersion="1.2.34.0" Author="0">
<Conversions>
  <Conversion Id="0" Description="Filter" Type="0" Param1="1" Param2="0" Param3="0" Param4="0"/>
  <Conversion Id="0" Description="Existing scale under another description" Type="1" Param1="0" Param2="1000" Param3="0" Param4="100"/>
  <Conversion Id="0" Description="New scale" Type="1" Param1="0" Param2="500" Param3="0" Param4="50"/>
</Conversions>
<InternalProtocol ProtocolType="KNX">
  <KNXObject ID="0"><Description>Temperature &amp; demand</Description><Active>True</Active>
  <DPT Value="2305"/><SendingAddress Value="102" String="0/0/102"/><ListeningAddresses><Address Value="300" String="0/1/44"/></ListeningAddresses>
  <Flags U="True" T="True" Ri="False" W="True" R="True"/><Priority>2</Priority><UpdateGA>0</UpdateGA><IdxConfig>0</IdxConfig><IdxExternal>0</IdxExternal>
  <IdxFilters>0,1</IdxFilters><IdxOperations>0,0;1,1;</IdxOperations><Virtual Status="False" Fixed="False"/><VendorExtension>keep me</VendorExtension></KNXObject>
  <KNXObject ID="1"><Description>Disabled counter</Description><Active>False</Active>
  <DPT Value="3585"/><SendingAddress Value="0" String="0/0/0"/><ListeningAddresses/>
  <Flags U="False" T="True" Ri="False" W="False" R="True"/><Priority>3</Priority><UpdateGA>0</UpdateGA><IdxConfig>1</IdxConfig><IdxExternal>1</IdxExternal>
  <IdxFilters/><IdxOperations/><Virtual Status="False" Fixed="False"/></KNXObject>
</InternalProtocol>
<ExternalProtocol ProtocolType="Modbus Server">
  <Device Index="0" Name="Synthetic AHU" Manufacturer="" SlaveNum="0" Timeout="750" Enabled="False" VendorAttr="retained"/>
  <Signals>
    <Signal ID="0"><idxConfig>0</idxConfig><idxExternal>0</idxExternal><Port>0</Port><DeviceIndex>0</DeviceIndex><IsBroadcast>False</IsBroadcast>
    <ReadFunc>3</ReadFunc><WriteFunc>16</WriteFunc><LenBits>32</LenBits><Format>3</Format><ByteOrder>2</ByteOrder><Bit>-1</Bit><NumOfBits>-1</NumOfBits><Address>17</Address><Deadband>0,25</Deadband>
    <IdxFilters>0,0</IdxFilters><IdxOperations>1,0;0,1</IdxOperations><Virtual Status="False" Fixed="False"/></Signal>
    <Signal ID="1"><idxConfig>1</idxConfig><idxExternal>1</idxExternal><Port>0</Port><DeviceIndex>0</DeviceIndex><IsBroadcast>False</IsBroadcast>
    <ReadFunc>4</ReadFunc><WriteFunc>255</WriteFunc><LenBits>64</LenBits><Format>0</Format><ByteOrder>3</ByteOrder><Bit>-1</Bit><NumOfBits>-1</NumOfBits><Address>500</Address>
    <IdxFilters/><IdxOperations/><Virtual Status="False" Fixed="False"/></Signal>
  </Signals>
</ExternalProtocol></Template>`;
