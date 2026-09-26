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
  .partial()
  .strict();

const knxPatchSchema = z
  .object({
    dpt: z.number().int().min(0).max(65535),
    groupAddress: z.number().int().min(0).max(65535),
    additionalAddresses: z.array(z.number().int().min(0).max(65535)),
    flags: flagsSchema,
    priority: z.number().int().min(0).max(3),
  })
  .partial()
  .strict();

// KNX–MBM Modbus Master endpoint patch.
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
  .partial()
  .strict();

// ME–MBS Modbus Slave endpoint patch (same `modbus` key, different shape).
const mbsPatchSchema = z
  .object({
    address: z.number().int().min(0).max(65535),
    bit: z.number().int(),
    lenBits: z.number().int(),
    format: z.number().int(),
    readWrite: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    stringLength: z.number().int(),
    slaveIndex: z.number().int().min(-1),
  })
  .partial()
  .strict();

// ME–MBS Mitsubishi Electric endpoint patch.
const conversionIndexSchema = z.number().int().min(0).max(32767);

/** `frmSelectConversion`: two filter slots, up to two operations and the defined flow. */
const conversionSelectionSchema = z
  .object({
    internalFilter: conversionIndexSchema.nullable(),
    operations: z.array(conversionIndexSchema).max(2),
    externalFilter: conversionIndexSchema.nullable(),
    master: z.enum(["internal", "external"]),
  })
  .strict();

// Conversion library: numbers are validated against the MAPS rules by the family (`conversionErrors`).
const conversionParamSchema = z.number().finite();
const conversionLocatorShape = {
  list: z.enum(["filters", "operations"]),
  index: z.number().int().min(0).max(32767),
};
const conversionPatchSchema = z
  .object({
    description: z.string().max(255),
    type: z.union([z.literal(1), z.literal(2)]),
    param1: conversionParamSchema,
    param2: conversionParamSchema,
    param3: conversionParamSchema,
    param4: conversionParamSchema,
  })
  .partial()
  .strict();

// Stored refs of one half; the family checks the positions against the project.
const conversionRefListSchema = z
  .array(z.object({ index: conversionIndexSchema, inverted: z.boolean() }).strict())
  .max(8);
const halfConversionRefsSchema = z
  .object({ filters: conversionRefListSchema, operations: conversionRefListSchema })
  .strict();

const mePatchSchema = z
  .object({
    g50Index: z.number().int().min(0).max(1),
    groupIndex: z.number().int().min(-1).max(49),
    unitId: z.number().int().min(-1),
    isIndoor: z.boolean(),
    isStatus: z.boolean(),
    signalIndex: z.number().int().min(-1),
    signalSpecIndex: z.number().int().min(-1),
  })
  .partial()
  .strict();

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

// KNX–MBM global Modbus Master config patch (media, deadband, poll records).
const mbmConfigPatchSchema = z
  .object({
    media: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    deadband: z.number().min(0).max(1),
    pollRecords: z
      .object({
        enabled: z.boolean(),
        useMissingReg: z.boolean(),
        maxRegisters: z.number().int().min(1).max(255),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

// --- ME–MBS config patches -----------------------------------------------------

const mbsConfigPatchSchema = z
  .object({
    media: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    byteOrder: z.number().int().min(0).max(3),
    updateCOV: z.boolean(),
    addressMode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    slaveAddressMode: z.union([z.literal(0), z.literal(1)]),
    commErrorTout: z.number().int().min(0).max(3600),
    registerBase: z.union([z.literal(0), z.literal(1)]),
    slaves: z.array(
      z.object({
        address: z.number().int().min(1).max(247),
        description: z.string().max(128),
      }),
    ),
  })
  .partial()
  .strict();

const mbsRtuConfigPatchSchema = z
  .object({
    connectionType: z.number().int().min(0),
    baudrate: z.number().int().min(1200).max(115200),
    dataBits: z.number().int().min(5).max(8),
    parity: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    stopBits: z.union([z.literal(1), z.literal(2)]),
    slaveNumber: z.number().int().min(1).max(247),
  })
  .partial()
  .strict();

const mbsTcpConfigPatchSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    keepAlive: z.number().int().min(0),
  })
  .partial()
  .strict();

const meScalarsPatchSchema = z
  .object({
    pollPeriod: z.number().int().min(0),
    ansTimeout: z.number().int().min(0),
    controllerTout: z.number().int().min(0),
    writeMaxBurst: z.number().int().min(0),
    temperatureMode: z.union([z.literal(0), z.literal(1)]),
    consumptionEnabled: z.boolean(),
  })
  .partial()
  .strict();

const meControllerPatchSchema = z
  .object({
    description: z.string().max(128),
    enabled: z.boolean(),
    ip: z.string().max(45),
    port: z.number().int().min(1).max(65535),
    type: z.number().int().min(0).max(3),
    model: z.number().int().min(0).max(3),
    compatibility: z.union([z.literal(0), z.literal(1)]),
    addErrorSignals: z.boolean(),
  })
  .partial()
  .strict();

const meGroupPatchSchema = z
  .object({
    enabled: z.boolean(),
    description: z.string().max(128),
    type: z.number().int().min(0).max(6),
    fanSpeeds: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)]),
    dualSetPoint: z.boolean(),
    urc: z.boolean(),
    capacity: z.number().int().min(-1),
  })
  .partial()
  .strict();

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
  z.object({ type: z.literal("updateMbmConfig"), patch: mbmConfigPatchSchema }),
  z.object({ type: z.literal("addSignal") }),
  z.object({ type: z.literal("removeSignal"), id: z.number().int().min(0) }),
  z.object({
    type: z.literal("updateSignal"),
    id: z.number().int().min(0),
    patch: z
      .object({
        active: z.boolean().optional(),
        description: z.string().max(128).optional(),
        knx: knxPatchSchema.optional(),
        modbus: z.union([modbusPatchSchema, mbsPatchSchema]).optional(),
        me: mePatchSchema.optional(),
        conversions: conversionSelectionSchema.optional(),
      })
      .strict(),
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
    signals: z.enum(["delete", "unassign"]),
  }),
  z.object({
    type: z.literal("addConversion"),
    conversionType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    values: z
      .object({
        description: z.string().max(255),
        params: z.tuple([conversionParamSchema, conversionParamSchema, conversionParamSchema, conversionParamSchema]),
      })
      .strict()
      .optional(),
  }),
  z.object({ type: z.literal("updateConversion"), ...conversionLocatorShape, patch: conversionPatchSchema }),
  z.object({ type: z.literal("removeConversion"), ...conversionLocatorShape }),
  z.object({
    type: z.literal("restoreSignalConversions"),
    id: z.number().int().min(0),
    refs: z.object({ internal: halfConversionRefsSchema, external: halfConversionRefsSchema }).strict(),
  }),
  z.object({ type: z.literal("updateMbsConfig"), patch: mbsConfigPatchSchema }),
  z.object({ type: z.literal("updateRtuConfig"), patch: mbsRtuConfigPatchSchema }),
  z.object({ type: z.literal("updateTcpConfig"), patch: mbsTcpConfigPatchSchema }),
  z.object({ type: z.literal("updateMeScalars"), patch: meScalarsPatchSchema }),
  z.object({
    type: z.literal("updateController"),
    controllerIndex: z.number().int().min(0).max(1),
    patch: meControllerPatchSchema,
  }),
  z.object({
    type: z.literal("updateGroup"),
    controllerIndex: z.number().int().min(0).max(1),
    groupIndex: z.number().int().min(0).max(49),
    patch: meGroupPatchSchema,
  }),
]);

const bodySchema = z.object({ patches: z.array(patchSchema).min(1).max(1000) });

/**
 * Optional optimistic-concurrency guard: `If-Match: "<revision>"` (the
 * `meta.revision` the client last read). Returns undefined when absent and
 * null when present but malformed.
 */
function expectedRevision(request: Request): number | undefined | null {
  const header = request.headers.get("if-match");
  if (header === null) return undefined;
  const match = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(header);
  return match ? Number(match[1]) : null;
}

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
    const revision = expectedRevision(request);
    if (revision === null) {
      return NextResponse.json({ error: "Invalid If-Match header: expected a project revision" }, { status: 400 });
    }
    const view = await applyPatches(id, parsed.data.patches as ProjectPatch[], {
      expectedRevision: revision,
    });
    return NextResponse.json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
