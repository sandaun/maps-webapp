import { NextResponse } from "next/server";
import { z } from "zod";
import { applyPatches, type ProjectPatch } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const flagsSchema = z
  .object({
    u: z.boolean(),
    t: z.boolean(),
    ri: z.boolean(),
    w: z.boolean(),
    r: z.boolean(),
  })
  .partial();

const knxPatchSchema = z
  .object({
    dpt: z.number().int().min(0).max(65535),
    groupAddress: z.number().int().min(0).max(65535),
    additionalAddresses: z.array(z.number().int().min(0).max(65535)),
    flags: flagsSchema,
    priority: z.number().int().min(0).max(3),
  })
  .partial();

const modbusPatchSchema = z
  .object({
    port: z.number().int().min(-1),
    deviceIndex: z.number().int().min(-1),
    isBroadcast: z.boolean(),
    readFunc: z.number().int(),
    writeFunc: z.number().int(),
    lenBits: z.number().int(),
    format: z.number().int(),
    byteOrder: z.number().int(),
    bit: z.number().int(),
    numOfBits: z.number().int(),
    address: z.number().int().min(0).max(65535),
  })
  .partial();

const nodeLocatorSchema = z.object({
  kind: z.enum(["rtu", "tcp"]),
  nodeIndex: z.number().int().min(0),
});

const rtuNodePatchSchema = z
  .object({
    baudrate: z.number().int().min(1200).max(115200),
    dataBits: z.number().int().min(5).max(8),
    parity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    stopBits: z.union([z.literal(1), z.literal(2)]),
    timeInterFrame: z.number().int().min(0),
    physicalPort: z.union([z.literal(0), z.literal(1)]),
    pollAfterWrite: z.boolean(),
    pollReadSignal: z.boolean(),
  })
  .partial();

const tcpNodePatchSchema = z
  .object({
    nodeIndex: z.number().int().min(0),
    ip: z.string().max(45),
    port: z.number().int().min(1).max(65535),
    description: z.string().max(128),
    timeInterFrame: z.number().int().min(0),
    retryTimeout: z.number().int().min(0),
    connTimeout: z.number().int().min(0),
    rxTimeout: z.number().int().min(0),
    timeInterFrameSlaveChange: z.number().int().min(100),
  })
  .partial();

const devicePatchSchema = z
  .object({
    name: z.string().max(128),
    manufacturer: z.string().max(128),
    slave: z.number().int().min(0).max(255),
    baseRegister: z.union([z.literal(0), z.literal(1)]),
    timeout: z.number().int().min(100).max(30000),
    enabled: z.boolean(),
  })
  .partial();

const patchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setGeneralInfo"),
    name: z.string().max(255).optional(),
    description: z.string().max(255).optional(),
  }),
  z.object({
    type: z.literal("setGatewayInfo"),
    name: z.string().max(32).optional(),
    ip: z.string().max(15).optional(),
    netmask: z.string().max(15).optional(),
    gateway: z.string().max(15).optional(),
    dhcp: z.boolean().optional(),
  }),
  z.object({ type: z.literal("setKnxPhysicalAddress"), address: z.number().int().min(1).max(65535) }),
  z.object({ type: z.literal("setKnxExtendedAddresses"), enabled: z.boolean() }),
  z.object({ type: z.literal("addSignal") }),
  z.object({ type: z.literal("removeSignal"), id: z.number().int().min(0) }),
  z.object({
    type: z.literal("updateSignal"),
    id: z.number().int().min(0),
    patch: z.object({
      active: z.boolean().optional(),
      description: z.string().max(128).optional(),
      knx: knxPatchSchema.optional(),
      modbus: modbusPatchSchema.optional(),
      idxOperations: z.string().max(1024).optional(),
      idxFilters: z.string().max(1024).optional(),
    }),
  }),
  z.object({ type: z.literal("addRtuNode") }),
  z.object({ type: z.literal("addTcpNode") }),
  z.object({ type: z.literal("removeNode"), locator: nodeLocatorSchema }),
  z.object({
    type: z.literal("updateRtuNode"),
    nodeIndex: z.number().int().min(0),
    patch: rtuNodePatchSchema,
  }),
  z.object({
    type: z.literal("updateTcpNode"),
    nodeIndex: z.number().int().min(0),
    patch: tcpNodePatchSchema,
  }),
  z.object({ type: z.literal("addDevice"), locator: nodeLocatorSchema }),
  z.object({
    type: z.literal("updateDevice"),
    locator: nodeLocatorSchema,
    deviceIndex: z.number().int().min(0),
    patch: devicePatchSchema,
  }),
  z.object({
    type: z.literal("removeDevice"),
    locator: nodeLocatorSchema,
    deviceIndex: z.number().int().min(0),
  }),
]);

const bodySchema = z.object({ patches: z.array(patchSchema).min(1).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid patch payload", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const view = await applyPatches(id, parsed.data.patches as ProjectPatch[]);
    return NextResponse.json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
