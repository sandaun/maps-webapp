import {
  DEVICE_TIMEOUT_RANGE,
  MEDIA,
  PARITY,
  type Media,
} from "./types";

/**
 * Modbus Master topology: RTU nodes (serial ports) and TCP nodes (IP:port),
 * each holding devices. Mirrors MbmRtuNode / MbmTcpNode / MbmDevice and the
 * ExternalMbm defaults.
 */

export interface MbmDevice {
  /** Position within the node (`Index` attribute). */
  index: number;
  name: string;
  manufacturer: string;
  /** Slave/unit id: 1–254 RTU, 0–255 TCP; unique per node. */
  slave: number;
  /** Register base: 0 = 0-based, 1 = 1-based. */
  baseRegister: 0 | 1;
  /** Response timeout ms, 100–30000. */
  timeout: number;
  enabled: boolean;
}

export interface MbmRtuNode {
  baudrate: number;
  dataBits: number;
  parity: 0 | 1 | 2;
  stopBits: 1 | 2;
  timeInterFrame: number;
  /** Physical port: 0 = A, 1 = B. KNX products use Port B only. */
  physicalPort: 0 | 1;
  pollAfterWrite: boolean;
  pollReadSignal: boolean;
  devices: MbmDevice[];
}

export interface MbmTcpNode {
  nodeIndex: number;
  ip: string;
  port: number;
  description: string;
  /** Inter-frame within node, ms. */
  timeInterFrame: number;
  retryTimeout: number;
  connTimeout: number;
  rxTimeout: number;
  /** Inter-frame on slave change, ms (min 100). */
  timeInterFrameSlaveChange: number;
  devices: MbmDevice[];
}

export interface MbmConfig {
  enabled: boolean;
  media: Media;
  /** Global deadband towards the internal system (0.00–1.00). */
  deadband: number;
  pollRecords: { enabled: boolean; useMissingReg: boolean; maxRegisters: number };
  rtuNodes: MbmRtuNode[];
  tcpNodes: MbmTcpNode[];
}

export function defaultDevice(index: number): MbmDevice {
  return {
    index,
    name: `Device ${index}`,
    manufacturer: "",
    slave: 1,
    baseRegister: 0,
    timeout: DEVICE_TIMEOUT_RANGE.default,
    enabled: true,
  };
}

export function defaultRtuNode(): MbmRtuNode {
  return {
    baudrate: 9600,
    dataBits: 8,
    parity: PARITY.NONE,
    stopBits: 1,
    timeInterFrame: 60,
    physicalPort: 1, // KNX products: Port B
    pollAfterWrite: false,
    pollReadSignal: false,
    devices: [],
  };
}

export function defaultTcpNode(nodeIndex: number): MbmTcpNode {
  return {
    nodeIndex,
    ip: "192.168.100.10",
    port: 502,
    description: `Node ${nodeIndex}`,
    timeInterFrame: 10,
    retryTimeout: 5000,
    connTimeout: 10000,
    rxTimeout: 5000,
    timeInterFrameSlaveChange: 100,
    devices: [],
  };
}

export function defaultMbmConfig(): MbmConfig {
  return {
    enabled: true,
    media: MEDIA.RTU,
    deadband: 0,
    pollRecords: { enabled: false, useMissingReg: false, maxRegisters: 100 },
    rtuNodes: [],
    tcpNodes: [],
  };
}

/**
 * Signal `Port` addressing: RTU nodes first (0..n-1), then TCP nodes
 * (n..n+m-1). 255 in XML means unset.
 */
export function portForTcpNode(config: MbmConfig, tcpIndex: number): number {
  return config.rtuNodes.length + tcpIndex;
}

export interface NodeRef {
  kind: "rtu" | "tcp";
  node: MbmRtuNode | MbmTcpNode;
}

export function nodeForPort(config: MbmConfig, port: number): NodeRef | undefined {
  if (port < 0) return undefined;
  if (port < config.rtuNodes.length) return { kind: "rtu", node: config.rtuNodes[port] };
  const tcpIndex = port - config.rtuNodes.length;
  if (tcpIndex < config.tcpNodes.length) return { kind: "tcp", node: config.tcpNodes[tcpIndex] };
  return undefined;
}
