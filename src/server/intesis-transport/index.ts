import "server-only";

export {
  computeBroadcastAddress,
  DISCOVERY_PORT,
  DISCOVERY_QUERY,
  discoverGateways,
  listBroadcastTargets,
  parseDiscoveryResponse,
  type DiscoveredGateway,
  type DiscoveryOptions,
} from "./discovery";
export {
  parseInfoLines,
  summarizeInfo,
  type GatewayInfo,
  type GatewayInfoSummary,
} from "./info";
export {
  GatewayError,
  GatewaySession,
  type ConnectResult,
  type GatewayErrorCode,
  type GatewaySessionOptions,
  type SendFileOptions,
  type SessionEvents,
} from "./session";
export {
  GatewayRequestError,
  GatewaySessionManager,
  getGatewaySessionManager,
  resetGatewaySessionManagerForTests,
  toGatewayRequestError,
  type ConnectOptions,
  type GatewaySessions,
  type GatewaySessionStatus,
  type SessionEvent,
  type SessionEventListener,
} from "./manager";
export { TcpDuplex, type Duplex } from "./transport";
