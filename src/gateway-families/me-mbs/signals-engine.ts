import {
  element,
  getAttr,
  getText,
  text,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from "@/core/project-format";
import {
  COMPATIBILITY_MODES,
  CONTROLLER_MODELS,
  GROUP_TYPES,
  TEMPERATURE_MODES,
  type MeControllerInfo,
  type MeGroupInfo,
} from "@/protocols/me";
import {
  ADDRESS_MODES,
  FORMATS,
  groupSignalOffset,
  SLAVE_ADDRESS_MODES,
} from "@/protocols/modbus/slave";
import { readMbsConfig, readMeConfig } from "./from-xml";

/**
 * ME-MBS signal regeneration, ported literally from the desktop tool
 * (`IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs`, abbreviated `P`).
 *
 * MAPS never lets the user add or remove ME-MBS signals (`IsRemovableRow` →
 * false, P:748): they derive from the model (controllers, groups, global
 * parameters). The engine holds the two row-aligned lists MAPS keeps in
 * memory — `mInternal.MbsObjects` (Modbus) and `mExternal.MeObjects` (ME) —
 * applies MAPS' handlers and primitives to them, and rewrites both
 * `<Signals>` sections the way MAPS saves them.
 *
 * The primitives are ported operation by operation, not "regenerate from the
 * model": the ME `idxExternal` depends on the history (for instance the 30
 * controller-general signals of a freshly created controller get
 * `idxExternal = idxConfig + 1`, and any later deletion renumbers them).
 *
 * Scope: FIXED address mode and SINGLE slave mode. The V4_COMP, CUSTOM and
 * MULTIPLE branches of the MAPS code are not ported; every handler rejects a
 * project that uses them (`UnsupportedRegenerationError`). MAPS'
 * `InitializeMbSlaves` (the derived `<MBSlavesArray>`) is out of scope too.
 */

// --- objects -------------------------------------------------------------------

/** `ConversionId`: one `index,inverted` entry of IdxOperations/IdxFilters. */
export interface ConversionRef {
  index: number;
  inverted: boolean;
}

/** `MbsObject` (IntesisBoxMAPS.Protocols.MB/MbsObject.cs). */
export interface MbsObject {
  configId: number;
  externalId: number;
  isEnabled: boolean;
  operations: ConversionRef[];
  filters: ConversionRef[];
  description: string;
  dataLength: number;
  format: number;
  bit: number;
  address: number;
  readWrite: number;
  stringLength: number;
  slaveIndex: number;
  gatewayIndex: number;
  isVirtual: boolean;
  isFixed: boolean;
  isGeneral: boolean;
  protocolIndex: number;
}

/** `MeObject` (IntesisBoxMAPS.Protocols.ME). */
export interface MeObject {
  configId: number;
  externalId: number;
  operations: ConversionRef[];
  filters: ConversionRef[];
  unitId: number;
  isIndoor: boolean;
  groupId: number;
  g50Id: number;
  isVirtual: boolean;
  isFixed: boolean;
  isStatus: boolean;
  signalIndex: number;
  signalSpecIndex: number;
}

/** `HvacObjectAddress` + `HvacCharacter`: one `<HvacAddresses><UserAddress>`. */
export interface HvacAddress {
  requiresCustom: boolean;
  enabled: boolean;
  address: string;
  addressExtra: string;
  addressFlags: string;
  /** UserAddressType: 0 = AC, 1 = DALI. */
  type: number;
  signal: number;
  hvacUnitIndex: number;
  port: number;
  ouIndex: number;
}

/** Model values the MAPS creation code reads (`mExternal` / `mInternal`). */
export interface EngineModel {
  controllers: MeControllerInfo[];
  temperatureMode: number;
  consumption: { enabled: boolean; signalMode: number; units: number };
  addressMode: number;
  slaveAddressMode: number;
}

/** A regeneration was requested on a project outside the ported scope. */
export class UnsupportedRegenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRegenerationError";
  }
}

/** MeterSignalMode.GENERAL_CONSUMPTION / MeterUnits.KWH. */
const GENERAL_CONSUMPTION = 0;
const KWH = 1;
/** UserAddressType.AC. */
const USER_ADDRESS_AC = 0;
/** Signals added by `CreateControllerSignals` / `CreateErrorSignals`. */
const CONTROLLER_SIGNALS = 30;
const ERROR_SIGNALS = 100;

const { IC, LC, FU, BU, WH, CEH, SYS_COMPONENT } = GROUP_TYPES;
const { EB_50GU, AE_200, AE_C400E } = CONTROLLER_MODELS;

// --- engine ----------------------------------------------------------------------

export class MeMbsSignalEngine {
  mbs: MbsObject[];
  me: MeObject[];
  readonly model: EngineModel;
  /** `base.AddressesStorer` (StoredHvacAddresses). */
  readonly addresses: HvacAddress[];

  constructor(model: EngineModel, mbs: MbsObject[], me: MeObject[], addresses: HvacAddress[] = []) {
    if (mbs.length !== me.length) {
      throw new Error(`ME-MBS signal lists are not row-aligned (${mbs.length} Modbus vs ${me.length} ME)`);
    }
    this.model = model;
    this.mbs = mbs;
    this.me = me;
    this.addresses = addresses;
  }

  static fromXml(doc: XmlDocument): MeMbsSignalEngine {
    const meConfig = readMeConfig(doc);
    const mbsConfig = readMbsConfig(doc);
    const consumption = doc.find(["ExternalProtocol", "ConsumptionFunction"]);
    const model: EngineModel = {
      controllers: meConfig.controllers,
      temperatureMode: meConfig.temperatureMode,
      consumption: {
        enabled: meConfig.consumptionEnabled,
        signalMode: Number(consumption ? getAttr(consumption, "SignalMode") ?? 0 : 0),
        units: Number(consumption ? getAttr(consumption, "Units") ?? 0 : 0),
      },
      addressMode: mbsConfig.addressMode,
      slaveAddressMode: mbsConfig.slaveAddressMode,
    };
    return new MeMbsSignalEngine(
      model,
      doc.findAll(["InternalProtocol", "Signals", "Signal"]).map(parseMbsObject),
      doc.findAll(["ExternalProtocol", "Signals", "Signal"]).map(parseMeObject),
      doc.findAll(["HvacAddresses", "UserAddress"]).map(parseHvacAddress),
    );
  }

  /** Rewrite both `<Signals>` sections as MAPS saves them. */
  writeTo(doc: XmlDocument): void {
    const internal = doc.find(["InternalProtocol", "Signals"]);
    const external = doc.find(["ExternalProtocol", "Signals"]);
    if (!internal || !external) throw new Error("Project has no <Signals> sections");
    replaceIndented(internal, this.mbs.map(mbsObjectXml), 3);
    replaceIndented(external, this.me.map(meObjectXml), 3);
    this.writeAddressesTo(doc);
  }

  /**
   * Rewrite `<HvacAddresses>` (StoredHvacAddresses.ToXML), which MAPS writes
   * only while it has entries, as the last child of `<Project>`
   * (IntesisProject.cs:2374).
   */
  writeAddressesTo(doc: XmlDocument): void {
    const stored = doc.find(["HvacAddresses"]);
    if (this.addresses.length === 0) {
      if (stored) removeWithIndent(stored);
      return;
    }
    const el = stored ?? appendRootChild(doc, element("HvacAddresses"));
    replaceIndented(el, this.addresses.map(hvacAddressXml), 2);
  }

  /**
   * `StoreUserAddress` (P:721), run by `UpdateObjectsFromRowInfo` after every
   * edit of a signal row: remembers the row's activation and address so a
   * later regeneration recreates it the same way (`GetActiveFromUnit`). The
   * key is the ME spec, group and controller; for alarm codes that key is
   * the one of general spec 0 (see `createMeMbsUnitObject`).
   */
  storeUserAddress(index: number): void {
    const me = this.me[index];
    const mbs = this.mbs[index];
    if (!me || !mbs) throw new Error(`Signal row ${index} not found`);
    this.addItem(
      { signal: me.signalSpecIndex, hvacUnitIndex: me.groupId, ouIndex: -1, port: me.g50Id },
      String(mbs.address),
      mbs.isEnabled,
      this.model.addressMode === ADDRESS_MODES.CUSTOM,
    );
  }

  // --- handlers (what the MAPS forms call) --------------------------------------

  /** `EnableGroup` (P:1108), run after the group's `Enabled` flag changed. */
  enableGroup(controller: number, group: number): void {
    this.assertSupported();
    const g50 = this.controller(controller);
    if (g50.groups[group].enabled) {
      this.createControllerSignals(g50, controller !== 0 ? this.me.length : 0);
      this.createGroupSignals(g50, controller, group + 1);
      if (
        g50.addErrorSignals &&
        this.me.filter((x) => x.g50Id === g50.index && x.unitId !== -1).length === 0
      ) {
        this.createErrorSignals(g50, controller);
      }
    } else {
      this.deleteGroupSignals(g50, group + 1);
      this.deleteControllerSignals(g50);
    }
  }

  /**
   * `ModifyGroupUpdate` (P:1181): type, fan speeds, dual setpoint, URC or
   * description changed. Does nothing for a disabled group.
   */
  modifyGroupUpdate(controller: number, group: number): void {
    if (!this.controller(controller).groups[group].enabled) return;
    this.assertSupported();
    this.deleteDescending(this.me.filter((x) => x.g50Id === controller && x.groupId === group));
    this.createGroupSignals(this.model.controllers[controller], controller, group + 1);
  }

  /**
   * `ModifyController` (P:1249): model, compatibility or "Individual error
   * signals" changed. Does nothing when the controller has no enabled group.
   */
  modifyController(controller: number): void {
    const g50 = this.controller(controller);
    if (!g50.groups.some((g) => g.enabled)) return;
    this.assertSupported();
    this.deleteDescending(this.me.filter((x) => x.g50Id === controller));
    this.createControllerSignals(g50, controller !== 0 ? this.me.length : 0);
    for (let num = 0; num < g50.groups.length; num++) {
      if (g50.groups[num].enabled) this.createGroupSignals(g50, controller, num + 1);
    }
    if (g50.addErrorSignals) this.createErrorSignals(g50, controller);
  }

  /**
   * `InitializeAndRestore` (P:3086), used by `UpdateConsumptionFunction`
   * (P:1213) when Enabled, SignalMode or Units changed, and by
   * `UpdateTemperatureMode` (P:1225), which runs the same sequence.
   */
  initializeAndRestore(): void {
    this.assertSupported();
    const userMbs = this.mbs.slice();
    const userMe = this.me.slice();
    this.mbs = [];
    this.me = [];
    this.initializeControllers();
    this.restoreUserConfig(userMbs, userMe);
  }

  /**
   * `AddressModeChanged` (P:1034) → `UpdateSignalsWithReadMode` (P:1086),
   * run after `<AddressMode>` changed: FIXED and V4 drop the stored user
   * addresses and reinitialize the controllers (no RestoreUserConfig);
   * CUSTOM keeps the signals as they are.
   */
  addressModeChanged(): void {
    if (this.model.addressMode === ADDRESS_MODES.CUSTOM) return;
    this.assertSupported();
    this.addresses.length = 0;
    this.initializeControllers();
  }

  /**
   * `SlaveNumberChangedCallback` with its flag set (P:1058), what the single
   * / multiple slave radio buttons send. Unlike `initializeAndRestore`, the
   * lists are not cleared first, so `InitializeControllers` deletes and
   * recreates controller by controller.
   */
  slaveAddressModeChanged(): void {
    this.assertSupported();
    const userMbs = this.mbs.slice();
    const userMe = this.me.slice();
    this.initializeControllers();
    this.restoreUserConfig(userMbs, userMe);
  }

  // --- MAPS primitives -----------------------------------------------------------

  private assertSupported(): void {
    if (this.model.addressMode !== ADDRESS_MODES.FIXED) {
      const mode = this.model.addressMode === ADDRESS_MODES.CUSTOM ? "CUSTOM" : "V4 compatibility";
      throw new UnsupportedRegenerationError(
        `ME-MBS signal regeneration supports only the FIXED address mode; this project uses the ${mode} mode`,
      );
    }
    if (this.model.slaveAddressMode !== SLAVE_ADDRESS_MODES.SINGLE) {
      throw new UnsupportedRegenerationError(
        "ME-MBS signal regeneration supports only the single Modbus slave mode; this project uses multiple slaves",
      );
    }
  }

  private controller(position: number): MeControllerInfo {
    const g50 = this.model.controllers[position];
    if (!g50) throw new Error(`G50 controller ${position} not found`);
    return g50;
  }

  /** `DeleteObject` (P:733): the last deletion of a batch renumbers both lists. */
  private deleteObject(index: number, isLastObject: boolean): void {
    this.mbs.splice(index, 1);
    this.me.splice(index, 1);
    if (isLastObject) {
      this.mbs.forEach((x, i) => {
        x.configId = i;
        x.externalId = i;
      });
      // ExternalME.ReorderIdxConfigs
      this.me.forEach((x, i) => {
        x.configId = i;
        x.externalId = i;
      });
    }
  }

  /** The recurring MAPS loop: delete by ConfigID, descending, last one renumbers. */
  private deleteDescending(objects: MeObject[]): void {
    const source = objects.slice().sort((a, b) => b.configId - a.configId);
    while (source.length > 0) {
      this.deleteObject(source[0].configId, source.length === 1);
      source.shift();
    }
  }

  /** `IncrementIdxConfig` (InternalMbs.cs:1625, ExternalME.cs:848), both lists. */
  private incrementIdxConfig(offset: number, increment: number): void {
    for (const list of [this.mbs, this.me]) {
      for (let i = offset + 1; i < list.length; i++) {
        const num = list[i].configId + increment;
        list[i].configId = num;
        list[i].externalId = num;
      }
    }
  }

  private sortByConfigId(): void {
    // LINQ OrderBy is stable, like Array.prototype.sort.
    this.mbs.sort((a, b) => a.configId - b.configId);
    this.me.sort((a, b) => a.configId - b.configId);
  }

  /**
   * `CalculteIdToInsert` (P:1154 / P:1161). With a group: after the last
   * general or group signal of the controller whose group comes before it.
   * Without: after the controller's last signal (0 if it has none).
   */
  private calculateIdToInsert(controller: number, group?: number): number {
    if (group === undefined) {
      const own = this.me.filter((x) => x.g50Id === controller);
      if (own.length === 0) return 0;
      return Math.max(...own.map((x) => x.configId)) + 1;
    }
    const before = this.me.filter((x) => x.g50Id === controller && x.groupId < group && x.unitId === -1);
    // LINQ First() on an empty sequence throws.
    if (before.length === 0) throw new Error(`Controller ${controller} has no signals before group ${group}`);
    return Math.max(...before.map((x) => x.configId)) + 1;
  }

  /** `CreateControllerSignals` (P:1316): only if the controller has no signals yet. */
  private createControllerSignals(g50: MeControllerInfo, configIdOffset: number): void {
    if (this.me.filter((x) => x.g50Id === g50.index).length === 0) {
      this.incrementIdxConfig(configIdOffset - 1, CONTROLLER_SIGNALS);
      this.createThisControllerSignals(g50, configIdOffset);
      this.sortByConfigId();
    }
  }

  /** `DeleteControllerSignals` (P:1300): only once no group is enabled. */
  private deleteControllerSignals(g50: MeControllerInfo): void {
    if (g50.groups.every((g) => !g.enabled)) {
      // DeleteThisControllerSignals (P:1329)
      this.deleteDescending(this.me.filter((x) => x.g50Id === g50.index));
    }
  }

  /** `CreateErrorSignals` (P:1342): 100 alarm-code signals at the end of the controller block. */
  private createErrorSignals(g50: MeControllerInfo, controller: number): void {
    const num = this.calculateIdToInsert(controller);
    this.incrementIdxConfig(num - 1, ERROR_SIGNALS);
    this.createErrorSignalsWithParams(g50, num);
    this.sortByConfigId();
  }

  /** `CreateGroupSignals` (P:1353); `enabledIndex` is the group index + 1. */
  private createGroupSignals(g50: MeControllerInfo, controller: number, enabledIndex: number): void {
    if (enabledIndex === 0) return;
    const num = enabledIndex - 1;
    if (g50.groups[num].type !== SYS_COMPONENT) {
      const num2 = this.calculateIdToInsert(controller, num);
      const signalsToAdd = this.getSignalsToAdd(this.model.controllers[controller], num);
      this.incrementIdxConfig(num2 - 1, signalsToAdd);
      this.createSignalsWithParams(g50.index, g50.model, g50.compatibility, g50.groups[num], num2);
      this.sortByConfigId();
    }
  }

  /** `DeleteGroupSignals` (P:1548). */
  private deleteGroupSignals(g50: MeControllerInfo, enabledIndex: number): void {
    if (enabledIndex === 0) return;
    const groupIndex = enabledIndex - 1;
    this.deleteDescending(this.me.filter((x) => x.groupId === groupIndex && x.g50Id === g50.index));
  }

  /** `InitializeControllers` (P:3165). */
  private initializeControllers(): void {
    this.model.controllers.forEach((g50, i) => {
      if (!g50.groups.some((g) => g.enabled)) return;
      this.deleteDescending(this.me.filter((x) => x.g50Id === i));
      this.createControllerSignals(g50, i !== 0 ? this.me.length : 0);
      for (let num = 0; num < g50.groups.length; num++) {
        if (g50.groups[num].enabled) this.createGroupSignals(g50, i, num + 1);
      }
      if (g50.addErrorSignals) this.createErrorSignals(g50, i);
    });
  }

  /**
   * `RestoreUserConfig` (P:3146): each regenerated signal takes `isEnabled`
   * from the first old signal with the same ME identity. (The CUSTOM-mode
   * address restore is out of scope.)
   */
  private restoreUserConfig(userMbs: MbsObject[], userMe: MeObject[]): void {
    for (let i = 0; i < userMbs.length; i++) {
      const u = userMe[i];
      const num = this.me.findIndex(
        (x) =>
          x.groupId === u.groupId &&
          x.unitId === u.unitId &&
          x.isIndoor === u.isIndoor &&
          x.signalIndex === u.signalIndex &&
          x.signalSpecIndex === u.signalSpecIndex &&
          x.g50Id === u.g50Id,
      );
      if (num !== -1) this.mbs[num] = { ...this.mbs[num], isEnabled: userMbs[i].isEnabled };
    }
  }

  /** `GetSignalsToAdd` (P:1372), non-V4 branches. Must match `createSignalsWithParams`. */
  private getSignalsToAdd(meG50: MeControllerInfo, selectedGroup: number): number {
    const { type, urc, dualSetPoint, fanSpeeds: fanSpeed } = meG50.groups[selectedGroup];
    const model = meG50.model;
    const newModel = meG50.compatibility === COMPATIBILITY_MODES.NEW_MODEL;
    const bigModel = model === AE_200 || model === EB_50GU || model === AE_C400E;
    const icFu = type === IC || type === FU;
    const buWhCeh = type === BU || type === WH || type === CEH;
    let num = 0;
    num++;
    if (icFu || type === LC || buWhCeh) num++;
    if (fanSpeed >= 2 && fanSpeed <= 4 && (icFu || type === LC)) num++;
    if (type === IC) num++;
    if (icFu) num++;
    // MAPS also tests IC here; unreachable after the IC/FU branch.
    else if (buWhCeh) num++;
    if (type !== LC) num++;
    if (type === IC) num++;
    num += 8;
    if (type !== LC) num++;
    if (type === IC || type === LC || type === FU) num++;
    if (bigModel && newModel) {
      if (type === IC) num++;
      if (type === IC || type === FU || type === LC) num++;
      if (icFu) num++;
    }
    if (icFu) {
      if (bigModel) num++;
      num += 6;
    }
    if (icFu && bigModel && newModel && dualSetPoint) num++;
    else if (buWhCeh && bigModel && dualSetPoint) num++;
    if (icFu && bigModel && newModel && dualSetPoint) num++;
    else if (buWhCeh && bigModel && dualSetPoint) num++;
    for (let i = 0; i < 3; i++) {
      if (icFu && bigModel && dualSetPoint) num++;
      else if (buWhCeh && bigModel && dualSetPoint) num++;
    }
    if (icFu && bigModel && urc) num += 3;
    if ((model === AE_200 || model === AE_C400E) && type === CEH) num++;
    if (type === IC || type === LC || type === FU) num += 2;
    if (this.model.consumption.enabled) {
      num = this.model.consumption.signalMode !== GENERAL_CONSUMPTION ? num + 6 : num + 3;
    }
    return num;
  }

  // --- object creation -----------------------------------------------------------

  /** `CreateThisControllerSignals` (P:1574): the 30 controller-general signals. */
  private createThisControllerSignals(g50: MeControllerInfo, configId: number): void {
    let idx = configId !== -1 ? configId : this.mbs.length;
    const slaveIndex = -1;
    // [signalSpecIndex, readWrite, conversionID]
    const internal: Array<[number, number, number]> = [
      [0, 0, -1], [1, 1, -1], [2, 1, 3], [3, 1, 2], [4, 1, 2], [5, 1, 3], [6, 1, 4],
      [7, 1, 5], [8, 1, 6], [9, 1, 9], [10, 1, 2], [11, 1, 3], [12, 1, 4], [13, 1, 2],
      [14, 1, 3], [15, 1, 5], [16, 1, 4], [17, 1, 6], [18, 1, 3], [28, 1, 5], [29, 1, 4],
      [19, 1, 6], [20, 1, 2], [21, 1, 3], [22, 1, 4], [23, 1, 5], [24, 1, 6], [25, 1, 7],
      [26, 1, 8],
    ];
    for (const [spec, readWrite, conversionId] of internal) {
      this.createMeMbsObject(g50.index, -1, spec, idx++, 16, 0, 255, readWrite, true, true, slaveIndex, conversionId);
    }
    // The last one does not post-increment; conversion 0 inverted outside V4 x1 mode.
    this.createMeMbsObject(g50.index, -1, 27, idx, 16, 0, 255, 1, true, true, slaveIndex, 0, true);

    // mExternal.CreateMEObject(idxConfigOffset++, idxConfigOffset, …): C#
    // evaluates left to right, so idxExternal = idxConfig + 1.
    idx = configId !== -1 ? configId : this.me.length;
    // [signalGeneralIndex, signalSpecIndex]
    const external: Array<[number, number]> = [
      [9, 0], [11, 1], [0, 2], [0, 3], [41, 4], [41, 5], [41, 6], [41, 7], [41, 8], [41, 9],
      [42, 10], [42, 11], [42, 12], [44, 13], [44, 14], [44, 15], [44, 16], [44, 17],
      [45, 18], [45, 28], [45, 29], [45, 19], [3, 20], [3, 21], [3, 22], [3, 23], [3, 24],
      [3, 25], [3, 26], [4, 27],
    ];
    external.forEach(([signalIndex, spec], i) => {
      const idxConfig = idx++;
      this.createMeObject(idxConfig, idx, -1, g50.index, -1, false, true, true, i === 0, signalIndex, spec);
    });
  }

  /** `CreateSignalsWithParams` (P:1718), non-V4 branches. */
  private createSignalsWithParams(
    g50Index: number,
    controllerModel: number,
    compatibility: number,
    group: MeGroupInfo,
    configId: number,
  ): void {
    const t = group.type;
    const icFu = t === IC || t === FU;
    const buWhCeh = t === BU || t === WH || t === CEH;
    const bigModel = controllerModel === EB_50GU || controllerModel === AE_200 || controllerModel === AE_C400E;
    const newModel = compatibility === COMPATIBILITY_MODES.NEW_MODEL;
    const g = group.index;
    const slaveIndex = -1;

    // --- Modbus side
    let num = configId !== -1 ? configId : this.mbs.length;
    const mbs = (spec: number, format: number, readWrite: number, conversionId = -1, inverted = false) =>
      this.createMeMbsObject(g50Index, g, spec, num++, 16, format, 255, readWrite, true, false, slaveIndex, conversionId, inverted);

    mbs(0, 0, 2);
    if (icFu) mbs(1, 0, 2);
    else if (t === LC) mbs(2, 0, 2);
    else if (buWhCeh) mbs(3, 0, 2);
    if (group.fanSpeeds === 4) {
      if (icFu) mbs(4, 0, 2, 17);
      else if (t === LC) mbs(5, 0, 2, 20);
    } else if (group.fanSpeeds === 3) {
      if (icFu) mbs(4, 0, 2, 18);
      else if (t === LC) mbs(5, 0, 2, 21);
    } else if (group.fanSpeeds === 2) {
      if (icFu) mbs(4, 0, 2, 19);
      else if (t === LC) mbs(5, 0, 2, 22);
    }
    if (t === IC) mbs(6, 0, 2);
    if (icFu) mbs(7, 1, 2, 0, true);
    // MAPS also tests IC here; unreachable after the IC/FU branch.
    else if (buWhCeh) mbs(8, 1, 2, 0, true);
    if (t !== LC) mbs(9, 1, 0);
    if (t === IC) mbs(10, 0, 2);
    mbs(11, 0, 0);
    mbs(12, 0, 0);
    mbs(13, 0, 0);
    mbs(14, 1, 0);
    mbs(15, 0, 1);
    mbs(16, 0, 0);
    mbs(17, 0, 2);
    mbs(18, 0, 2);
    if (t !== LC) mbs(19, 0, 2);
    if (t === IC || t === LC || t === FU) mbs(20, 0, 2);
    if (bigModel && newModel) {
      if (t === IC) mbs(21, 0, 2);
      if (t === IC || t === FU || t === LC) mbs(22, 0, 2);
      if (icFu) mbs(23, 0, 2);
    }
    if (icFu) {
      if (bigModel) mbs(24, 0, 2);
      for (const spec of [25, 26, 27, 28, 29, 30]) mbs(spec, 1, 2, 0, true);
    }
    const dual = (icFuSpec: number, buSpec: number, needsNewModel: boolean) => {
      if (icFu && bigModel && (!needsNewModel || newModel) && group.dualSetPoint) mbs(icFuSpec, 1, 2, 0, true);
      else if (buWhCeh && bigModel && group.dualSetPoint) mbs(buSpec, 1, 2, 0, true);
    };
    dual(31, 32, true);
    dual(33, 34, true);
    dual(35, 36, false);
    dual(37, 38, false);
    dual(39, 40, false);
    if (icFu && bigModel && group.urc) {
      mbs(41, 0, 0);
      mbs(42, 0, 0);
      mbs(43, 0, 0);
    }
    if ((controllerModel === AE_200 || controllerModel === AE_C400E) && t === CEH) mbs(44, 1, 0);
    if (t === IC || t === LC || t === FU) {
      mbs(45, 0, 0);
      mbs(46, 0, 1);
    }
    const consumptionConversion = this.model.consumption.units === KWH ? 23 : -1;
    const consumptionSpecs =
      this.model.consumption.signalMode === GENERAL_CONSUMPTION ? [52, 53, 54] : [55, 56, 57, 58, 59, 60];
    if (this.model.consumption.enabled) {
      for (const spec of consumptionSpecs) {
        this.createMeMbsObject(g50Index, g, spec, num++, 32, 0, 255, 0, true, false, slaveIndex, consumptionConversion);
      }
    }

    // --- ME side: CreateMEObject(num, num, …), except spec 46 (see below)
    num = configId !== -1 ? configId : this.me.length;
    const me = (isStatus: boolean, signalIndex: number, spec: number, conversionId = -1, inverted = false) =>
      this.createMeObject(num, num++, g, g50Index, -1, false, false, true, isStatus, signalIndex, spec, conversionId, inverted);

    me(true, 0, 0);
    if (icFu) me(true, 1, 1);
    else if (t === LC) me(true, 1, 2);
    else if (buWhCeh) me(true, 1, 3);
    if (group.fanSpeeds > 0) {
      if (group.fanSpeeds === 4) {
        if (icFu) me(true, 2, 4, 17, true);
        else if (t === LC) me(true, 2, 5, 20, true);
      } else if (group.fanSpeeds === 3) {
        if (icFu) me(true, 2, 4, 18, true);
        else if (t === LC) me(true, 2, 5, 21, true);
      } else if (group.fanSpeeds === 2) {
        if (icFu) me(true, 2, 4, 19, true);
        else if (t === LC) me(true, 2, 5, 22, true);
      }
    }
    if (t === IC) me(true, 3, 6);
    if (icFu) me(true, 4, 7, 0);
    // MAPS also tests IC here; unreachable after the IC/FU branch.
    else if (buWhCeh) me(true, 4, 8, 0);
    if (t !== LC) me(true, 5, 9, 0);
    if (t === IC) me(true, 6, 10);
    me(true, 8, 11, 1);
    me(true, 48, 12);
    me(true, 9, 13);
    me(true, 10, 14);
    me(false, 11, 15);
    me(true, 12, 16);
    me(true, 13, 17);
    me(true, 14, 18);
    if (t !== LC) me(true, 15, 19);
    if (t === IC || t === LC || t === FU) me(true, 16, 20);
    if (bigModel && newModel) {
      if (t === IC) me(true, 17, 21);
      if (t === IC || t === FU || t === LC) me(true, 18, 22);
      if (icFu) me(true, 19, 23);
    }
    if (icFu) {
      if (bigModel) me(true, 20, 24);
      me(true, 21, 25, 0);
      me(true, 22, 26, 0);
      me(true, 23, 27, 0);
      me(true, 24, 28, 0);
      me(true, 25, 29, 0);
      me(true, 26, 30, 0);
    }
    const meDual = (signalIndex: number, icFuSpec: number, buSpec: number, needsNewModel: boolean) => {
      if (icFu && bigModel && (!needsNewModel || newModel) && group.dualSetPoint) me(true, signalIndex, icFuSpec, 0);
      else if (buWhCeh && bigModel && group.dualSetPoint) me(true, signalIndex, buSpec, 0);
    };
    meDual(27, 31, 32, true);
    meDual(28, 33, 34, true);
    meDual(29, 35, 36, false);
    meDual(30, 37, 38, false);
    meDual(31, 39, 40, false);
    if (icFu && bigModel && group.urc) {
      me(true, 32, 41);
      me(true, 33, 42);
      me(true, 34, 43);
    }
    if ((controllerModel === AE_200 || controllerModel === AE_C400E) && t === CEH) me(true, 35, 44, 0);
    if (t === IC || t === LC || t === FU) {
      me(true, 36, 45);
      // P:2218 passes mExternal.MeObjects.Count as idxExternal here: it
      // differs from idxConfig when the group is inserted before others.
      this.createMeObject(num, this.me.length, g, g50Index, -1, false, false, true, false, 37, 46);
      num++;
    }
    if (this.model.consumption.enabled) {
      // [signalGeneralIndex, signalSpecIndex]
      const consumption: Array<[number, number]> =
        this.model.consumption.signalMode === GENERAL_CONSUMPTION
          ? [[54, 52], [51, 53], [57, 54]]
          : [[52, 55], [49, 56], [55, 57], [53, 58], [50, 59], [56, 60]];
      for (const [signalIndex, spec] of consumption) me(true, signalIndex, spec, consumptionConversion, true);
    }
  }

  /** `CreateErrorSignalsWithParams` (P:2247): 50 indoor + 50 outdoor alarm codes. */
  private createErrorSignalsWithParams(g50: MeControllerInfo, configId: number): void {
    let num = configId !== -1 ? configId : this.mbs.length;
    for (let i = 1; i <= 50; i++) this.createMeMbsUnitObject(g50.index, i, num++, true);
    for (let j = 51; j <= 100; j++) this.createMeMbsUnitObject(g50.index, j, num++, false);
    num = configId !== -1 ? configId : this.me.length;
    for (let k = 0; k < 100; k++) {
      this.createMeObject(num, num++, -1, g50.index, k, k < 50, false, true, true, 0, 0);
    }
  }

  /**
   * `CreateMEMBSObject` for a unit (alarm code) signal (P:2274).
   *
   * MAPS quirk, reproduced as is: this lookup keys HvacAddresses by unit
   * (indoor 1–50 as HvacUnitIndex, outdoor 51–100 as OuIndex), but
   * `StoreUserAddress` (P:721) stores an edited alarm-code row under
   * HvacUnitIndex = GroupID = -1 and OuIndex = -1. So an edit never comes
   * back through HvacAddresses when the error signals are recreated, and
   * the stored key is the one of general spec 0 ("Centralized controller
   * communication error"), which picks it up instead. A full regeneration
   * does keep the alarm-code activation: `RestoreUserConfig` matches by the
   * ME identity, unit included.
   */
  private createMeMbsUnitObject(g50Index: number, unitIdx: number, idxConfig: number, isIndoor: boolean): void {
    const signalIdx = 0;
    const active = this.getActiveFromUnit(true, signalIdx, isIndoor ? unitIdx : -1, isIndoor ? -1 : unitIdx, g50Index);
    this.createMbsObject({
      configId: idxConfig,
      description: `${this.getSignalDescription(signalIdx, false, unitIdx, isIndoor)} ${this.getAllowedValues(g50Index, signalIdx, unitIdx, unitIdx)}`,
      isEnabled: active,
      dataLength: 16,
      format: 1,
      address: this.getAddressFromSignal(g50Index, -1, signalIdx, unitIdx),
      bit: 255,
      readWrite: 0,
      isFixed: true,
      isVirtual: false,
      isGeneral: false,
      conversionId: -1,
      inverted: false,
      slaveIndex: -1,
    });
  }

  /** `CreateMEMBSObject` for a general or group signal (P:2280). */
  private createMeMbsObject(
    g50Index: number,
    groupIdx: number,
    signalIdx: number,
    idxConfig: number,
    lenBits: number,
    format: number,
    bit: number,
    readWrite: number,
    isFixed: boolean,
    isVirtual: boolean,
    slaveIndex: number,
    conversionId = -1,
    inverted = false,
  ): void {
    const active = this.getActiveFromUnit(true, signalIdx, groupIdx, -1, g50Index);
    this.createMbsObject({
      configId: idxConfig,
      description: `${this.getSignalDescription(signalIdx, groupIdx === -1)} ${this.getAllowedValues(g50Index, signalIdx, groupIdx)}`,
      isEnabled: active,
      dataLength: lenBits,
      format,
      address: this.getAddressFromSignal(g50Index, groupIdx, signalIdx, -1, slaveIndex),
      bit,
      readWrite,
      isFixed,
      isVirtual,
      isGeneral: groupIdx === -1,
      conversionId,
      inverted,
      slaveIndex,
    });
  }

  /** `InternalMbs.CreateMBSObject` (InternalMbs.cs:803), without protocolIndex. */
  private createMbsObject(p: {
    configId: number;
    description: string;
    isEnabled: boolean;
    dataLength: number;
    format: number;
    address: number;
    bit: number;
    readWrite: number;
    isFixed: boolean;
    isVirtual: boolean;
    isGeneral: boolean;
    conversionId: number;
    inverted: boolean;
    slaveIndex: number;
  }): void {
    this.mbs.push({
      configId: p.configId,
      externalId: p.configId,
      isEnabled: p.isEnabled,
      operations: p.conversionId !== -1 ? [{ index: p.conversionId, inverted: p.inverted }] : [],
      filters: [],
      description: p.description,
      dataLength: p.dataLength,
      format: p.format,
      bit: p.bit,
      address: p.address,
      readWrite: p.readWrite,
      stringLength: -1,
      slaveIndex: p.slaveIndex,
      gatewayIndex: -1,
      isVirtual: p.isVirtual,
      isFixed: p.isFixed,
      isGeneral: p.isGeneral,
      protocolIndex: -1,
    });
  }

  /** `ExternalME.CreateMEObject` (ExternalME.cs:773). */
  private createMeObject(
    idxConfig: number,
    idxExternal: number,
    groupIndex: number,
    g50Index: number,
    unitIndex: number,
    isIndoor: boolean,
    isVirtual: boolean,
    isFixed: boolean,
    isStatus: boolean,
    signalGeneralIndex: number,
    signalSpecIndex: number,
    conversionId = -1,
    inverted = false,
  ): void {
    this.me.push({
      configId: idxConfig,
      externalId: idxExternal,
      operations: conversionId !== -1 ? [{ index: conversionId, inverted }] : [],
      filters: [],
      unitId: unitIndex,
      isIndoor,
      groupId: groupIndex,
      g50Id: g50Index,
      isVirtual,
      isFixed,
      isStatus,
      signalIndex: signalGeneralIndex,
      signalSpecIndex,
    });
  }

  /**
   * `StoredHvacAddresses.AddItem` (AC overload): an entry with the same
   * HvacCharacter (`Equals`: signal, unit, OU and port) is updated in place.
   */
  private addItem(
    prop: Pick<HvacAddress, "signal" | "hvacUnitIndex" | "ouIndex" | "port">,
    address: string,
    enabled: boolean,
    requiresCustom: boolean,
  ): void {
    if (prop.signal === -1) return;
    const existing = this.addresses.find(
      (x) =>
        x.signal === prop.signal &&
        x.hvacUnitIndex === prop.hvacUnitIndex &&
        x.ouIndex === prop.ouIndex &&
        x.port === prop.port,
    );
    if (existing) {
      Object.assign(existing, { address, enabled, addressExtra: "", addressFlags: "", requiresCustom });
      return;
    }
    this.addresses.push({
      requiresCustom,
      enabled,
      address,
      addressExtra: "",
      addressFlags: "",
      type: USER_ADDRESS_AC,
      ...prop,
    });
  }

  /** `StoredHvacAddresses.GetActiveFromUnit` (StoredHvacAddresses.cs). */
  private getActiveFromUnit(
    defaultActive: boolean,
    signalIndex: number,
    unitIdx: number,
    ouIndex: number,
    portIndex: number,
  ): boolean {
    const match = this.addresses.find(
      (x) =>
        x.type === USER_ADDRESS_AC &&
        !x.requiresCustom &&
        x.signal === signalIndex &&
        x.hvacUnitIndex === unitIdx &&
        x.ouIndex === ouIndex &&
        x.port === portIndex,
    );
    return match ? match.enabled : defaultActive;
  }

  /** `GetAddressFromSignal` (P:2733), FIXED mode. */
  private getAddressFromSignal(
    g50Idx: number,
    groupIdx: number,
    signalSpecIndex: number,
    unitIdx = -1,
    slaveIndex = -1,
  ): number {
    if (groupIdx === -1) {
      if (unitIdx === -1) {
        return slaveIndex === -1 ? g50Idx * 30 + signalSpecIndex : signalSpecIndex;
      }
      return (g50Idx + 1) * 1000 + 20000 + unitIdx;
    }
    const num = groupSignalOffset(ADDRESS_MODES.FIXED, signalSpecIndex);
    return slaveIndex === -1 ? (g50Idx * 50 + (groupIdx + 1)) * 100 + num : num;
  }

  /** `GetSignalDescription` (P:2287), outside V4 x1 mode. Trailing spaces are MAPS'. */
  private getSignalDescription(spec: number, isGeneralSignal = false, unitSignal = -1, isIndoor = false): string {
    const t = this.model.temperatureMode === TEMPERATURE_MODES.CELSIUS ? "ºC" : "ºF";
    if (isGeneralSignal) {
      if (spec === 27) return `Individual Temperature Setpoint (x10${t}) (all the groups) `;
      return GENERAL_DESCRIPTIONS[spec] ?? "";
    }
    if (unitSignal !== -1) {
      return isIndoor ? `AlarmCode Indoor unit ${unitSignal}` : `AlarmCode Outdoor unit ${unitSignal - 50}`;
    }
    if (spec === 7 || spec === 8) return `Temperature Setpoint (x10${t}) `;
    const described = GROUP_DESCRIPTIONS[spec];
    return described === undefined ? "" : described.replace("{t}", t);
  }

  /** `GetAllowedValues` (P:2502). */
  private getAllowedValues(g50id: number, spec: number, groupId: number, unitSignal = -1): string {
    const celsius = this.model.temperatureMode === TEMPERATURE_MODES.CELSIUS;
    if (groupId === -1) {
      if (spec === 27) return celsius ? "[5..90 ºC]" : "[41..194 ºF]";
      return GENERAL_ALLOWED_VALUES[spec] ?? "";
    }
    if (unitSignal !== -1) return "[0..9999]";
    const meGroup = this.model.controllers[g50id].groups[groupId];
    switch (spec) {
      case 4:
        if (meGroup.fanSpeeds === 2) return "[0-Auto, 1-Mid2, 2-High]";
        if (meGroup.fanSpeeds === 3) return "[0-Auto, 1-Mid2, 2-Mid1, 3-High]";
        return "[0-Auto, 1-Low, 2-Mid2, 3-Mid1, 4-High]";
      case 5:
        if (meGroup.fanSpeeds === 2) return "[1-Mid2, 2-High]";
        if (meGroup.fanSpeeds === 3) return "[1-Mid2, 2-Mid1, 3-High]";
        return "[1-Low, 2-Mid2, 3-Mid1, 4-High]";
      case 7:
        return celsius
          ? "[Cool or dry:19..30 ºC; Heat or Auto:17..28 ºC]"
          : "[Cool or dry:66,2..86 ºF; Heat or Auto:62,6..82,4 ºF]";
      case 8:
        return celsius ? "[5..90 ºC]" : "[41..194 ºF]";
      case 9:
        return celsius ? "[0,0..99,9 ºC]" : "[32..211,82 ºF]";
      case 25:
      case 26:
      case 27:
      case 28:
      case 29:
      case 30:
        return celsius ? "[4,5..35 ºC]" : "[40,1..95 ºF]";
      case 31:
      case 32:
      case 33:
      case 34:
      case 35:
      case 36:
      case 37:
      case 38:
      case 39:
      case 40:
        return celsius ? "[4,5..90 ºC]" : "[40,1..194 ºF]";
      case 44:
        return celsius ? "[0.0..99.9 ºC]" : "[32..211,82 ºF]";
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
      case 58:
      case 59:
      case 60:
        return this.model.consumption.units === KWH ? "[kWh]" : "[Wh]";
      default:
        return GROUP_ALLOWED_VALUES[spec] ?? "";
    }
  }
}

// --- MAPS text tables (P:2287-2731) ------------------------------------------------

const GENERAL_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: "Centralized controller communication error ",
  1: "Reset errors for all the groups ",
  2: "On (all the groups) ",
  3: "Off (all the groups) ",
  4: "Operation Mode Auto (all the IC groups) ",
  5: "Operation Mode Heat (all the IC groups) ",
  6: "Operation Mode Dry (all the IC groups) ",
  7: "Operation Mode Fan (all the IC groups) ",
  8: "Operation Mode Cool (all the IC groups) ",
  9: "Operation Mode Setback (all the IC groups) ",
  10: "Operation Mode LC_Auto (all the LOSSNAY groups) ",
  11: "Operation Mode Heat Recovery (all the LOSSNAY groups) ",
  12: "Operation Mode Bypass (all the LOSSNAY groups) ",
  13: "Fan Speed (all the IC groups) ",
  14: "Fan Speed (all the IC groups) ",
  15: "Fan Speed (all the IC groups) ",
  16: "Fan Speed (all the IC groups) ",
  17: "Fan Speed (all the IC groups) ",
  18: "Fan Speed (all the LOSSNAY groups) ",
  28: "Fan Speed (all the LOSSNAY groups) ",
  29: "Fan Speed (all the LOSSNAY groups) ",
  19: "Fan Speed (all the LOSSNAY groups) ",
  20: "Vane position (all the IC groups) ",
  21: "Vane position (all the IC groups) ",
  22: "Vane position (all the IC groups) ",
  23: "Vane position (all the IC groups) ",
  24: "Vane position (all the IC groups) ",
  25: "Vane position (all the IC groups) ",
  26: "Vane position (all the IC groups) ",
};

const GENERAL_ALLOWED_VALUES: Readonly<Record<number, string>> = {
  0: "[0-Ok, 1-Communication error]",
  1: "[1-Reset the errors]",
  2: "[1-Set the groups On]",
  3: "[1-Set the groups Off]",
  4: "[1-Set Auto Mode]",
  5: "[1-Set Heat Mode]",
  6: "[1-Set Dry Mode]",
  7: "[1-Set Fan Mode]",
  8: "[1-Set Cool Mode]",
  9: "[1-Set Setback Mode]",
  10: "[1-Set LC_Auto Mode]",
  11: "[1-Set Heat Recovery Mode]",
  12: "[1-Set Bypass Mode]",
  13: "[1-Set Fan Speed Auto]",
  14: "[1-Set Fan Speed Low]",
  15: "[1-Set Fan Speed Mid-1]",
  16: "[1-Set Fan Speed Mid-2]",
  17: "[1-Set Fan Speed High]",
  18: "[1-Set Fan Speed Low]",
  28: "[1-Set Fan Speed Mid-1]",
  29: "[1-Set Fan Speed Mid-2]",
  19: "[1-Set Fan Speed High]",
  20: "[1-Set Vanes Auto]",
  21: "[1-Set Vanes Horizontal]",
  22: "[1-Set Vanes Position-2]",
  23: "[1-Set Vanes Position-3]",
  24: "[1-Set Vanes Position-4]",
  25: "[1-Set Vanes Vertical]",
  26: "[1-Set Vanes Swing]",
};

/** Group descriptions; `{t}` is the temperature unit (ºC/ºF). Specs 7/8 are handled apart. */
const GROUP_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: "On/Off ",
  1: "Operation Mode IC ",
  2: "Operation Mode LOSSNAY ",
  3: "Operation Mode ATW & HWHP ",
  47: "Operation Mode IC",
  48: "Operation Mode LC & LOSSNAY",
  49: "Operation Mode ATW & HWHP",
  4: "Fan Speed IC ",
  5: "Fan Speed LOSSNAY ",
  50: "Fan Speed IC & LOSSNAY ",
  6: "Vane position ",
  51: "Vane position ",
  9: "Ambient Temperature (x10{t}) ",
  10: "Operational Status for Lossnay or OA ",
  11: "Group operation time (x100 hours) ",
  12: "Group operation time (%100 hours) ",
  13: "Group error status ",
  14: "Group error code ",
  15: "Group error reset ",
  16: "Group model ",
  17: "Allow ON/OFF control from the local panel ",
  18: "Allow operation mode control from the local panel ",
  19: "Allow set point control from the local panel ",
  20: "Allow filter reset control from the local panel ",
  21: "Allow air direction control from the local panel ",
  22: "Allow fan speed control from the local panel ",
  23: "Allow timer control from the local panel ",
  24: "Setback control ",
  25: "Minimum cool setpoint restriction (x10{t}) ",
  26: "Maximum cool setpoint restriction (x10{t}) ",
  27: "Minimum heat setpoint restriction (x10{t}) ",
  28: "Maximum heat setpoint restriction (x10{t}) ",
  29: "Minimum auto setpoint restriction (x10{t}) ",
  30: "Maximum auto setpoint restriction (x10{t}) ",
  31: "Cool/dry/auto(upper) dual temperature setpoint (x10{t}) ",
  32: "Heating ATW & HWHP temperature setpoint (x10{t}) ",
  33: "Heat/auto(lower) dual temperature setpoint (x10{t}) ",
  34: "Heating ECO ATW temperature setpoint (x10{t}) ",
  35: "Auto single temperature setpoint (x10{t}) ",
  36: "Hot water ATW & HWHP temperature setpoint (x10{t}) ",
  37: "Setback upper temperature setpoint (x10{t}) ",
  38: "Anti-Freeze ATW temperature setpoint (x10{t}) ",
  39: "Setback lower temperature setpoint (x10{t}) ",
  40: "Cooling ATW temperature setpoint (x10{t}) ",
  41: "Room Humidity ",
  42: "Brightness status ",
  43: "Occupancy ",
  44: "Outdoor temperature ",
  45: "Filter status ",
  46: "Dirty filter indication reset ",
  52: "Consumption Yesterday",
  53: "Consumption Today",
  54: "Consumption Total",
  55: "Consumption Yesterday Heat",
  56: "Consumption Today Heat",
  57: "Consumption Total Heat",
  58: "Consumption Yesterday Cool",
  59: "Consumption Today Cool",
  60: "Consumption Total Cool",
};

/** Group allowed values that do not depend on the model (see `getAllowedValues`). */
const GROUP_ALLOWED_VALUES: Readonly<Record<number, string>> = {
  0: "[0-Off, 1-On]",
  1: "[0-Auto, 1-Heat, 2-Dry, 3-Fan, 4-Cool, 5-Auto Heat, 6-Auto Cool, 7-Setback, 8-Setbackheat, 9-Setbackcool]",
  2: "[0-LC_Auto, 1-Heat Recovery, 2-Bypass]",
  3: "[0-Hot_Water, 1-Heating, 2-Heating_Eco, 3-Anti_Freeze, 4-Cooling]",
  47: "[0-Cool,1-Dry,2-Fan,3-Heat,4-Auto,5-AutoHeat,6-AutoCool,7-SetBack,8-SetbackHeat,9-SetbackCool]",
  48: "[7-HeatRecovery, 8-LcAuto, 9-Bypass]",
  49: "[0-Cooling,1-AntiFreeze,2-HeatingEco,3-Heating,4-HotWater]",
  50: "[0-Low, 1-MedL, 2-MedH, 3-High, 4-Auto]",
  6: "[0-Auto, 1-Horizontal, 2-Position-2, 3-Position-3, 4-Position-4, 5-Vertical, 6-Swing]",
  51: "[0-Horizontal, 1-Mid1, 2-Mid2, 3-Vertical, 4-Swing, 5-Auto, 6-Mid3]",
  10: "[0-Off, 1-Low, 2-High]",
  11: "[0..9999]",
  12: "[0..99]",
  13: "[0-No error; 1-Group error]",
  14: "[Number of the error code (XXXX)]",
  15: "[1-Reset the error]",
  16: "[Model of units connected to group ]",
  17: "[0-Allow, 1-Not allow]",
  18: "[0-Allow, 1-Not allow]",
  19: "[0-Allow, 1-Not allow]",
  20: "[0-Allow, 1-Not allow]",
  21: "[0-Allow, 1-Not allow]",
  22: "[0-Allow, 1-Not allow]",
  23: "[0-Allow, 1-Not allow]",
  24: "[0-Disable, 1-Enable]",
  41: "[0..100%]",
  42: "[0: Dark, 1: Bright]",
  43: "[0: Absence, 1:Occupancy]",
  45: "[0-Ok, 1-Dirty]",
  46: "[1: Reset the filter]",
};

// --- XML (MbsObject.ToXml, ExternalME.CreateObjectNode, parsers) --------------------

const LINE_ENDING = "\r\n";
const INDENT_UNIT = "  ";

function parseMbsObject(el: XmlElement): MbsObject {
  const virtual = childOpt(el, "Virtual");
  let dataLength = int(childText(el, "LenBits"));
  // IntesisMb.GetFormatFromIndex: 255 → -1.
  let format = int(childText(el, "Format"));
  if (format === 255) format = -1;
  if (dataLength === 1) {
    dataLength = 16;
    format = FORMATS.UNSIGNED;
  }
  if (dataLength === -1) dataLength = 16;
  return {
    configId: int(childText(el, "idxConfig")),
    externalId: int(childText(el, "idxExternal")),
    isEnabled: bool(childText(el, "isEnabled")),
    operations: parseConversionIds(childText(el, "IdxOperations")),
    filters: parseConversionIds(childText(el, "IdxFilters")),
    description: childText(el, "Description"),
    dataLength,
    format,
    bit: int(childText(el, "Bit")),
    address: int(childText(el, "Address")),
    readWrite: int(childText(el, "ReadWrite")),
    stringLength: intOr(el, "StringLength", -1),
    slaveIndex: intOr(el, "SlaveIndex", -1),
    gatewayIndex: intOr(el, "GatewayIndex", -1),
    isVirtual: virtual ? bool(getAttr(virtual, "Status") ?? "") : false,
    isFixed: virtual ? bool(getAttr(virtual, "Fixed") ?? "") : false,
    isGeneral: virtual && getAttr(virtual, "General") !== undefined ? bool(getAttr(virtual, "General") ?? "") : false,
    protocolIndex: intOr(el, "ProtocolIndex", 0),
  };
}

function parseMeObject(el: XmlElement): MeObject {
  const virtual = childOpt(el, "Virtual");
  const indoor = childOpt(el, "IsIndoorSignal");
  return {
    configId: int(childText(el, "idxConfig")),
    externalId: int(childText(el, "idxExternal")),
    operations: parseConversionIds(childText(el, "IdxOperations")),
    filters: parseConversionIds(childText(el, "IdxFilters")),
    unitId: intOr(el, "UnitId", -1),
    isIndoor: indoor ? bool(getText(indoor)) : true,
    groupId: int(childText(el, "GroupIndex")),
    g50Id: int(childText(el, "G50Index")),
    isVirtual: virtual ? bool(getAttr(virtual, "Status") ?? "") : false,
    isFixed: virtual ? bool(getAttr(virtual, "Fixed") ?? "") : false,
    isStatus: bool(childText(el, "IsStatus")),
    signalIndex: int(childText(el, "SignalIndex")),
    signalSpecIndex: int(childText(el, "SignalSpecIndex")),
  };
}

/** `HvacObjectAddress(XmlNode)` + `HvacCharacter(XmlNode)` defaults. */
function parseHvacAddress(el: XmlElement): HvacAddress {
  const attr = (name: string, fallback: string) => getAttr(el, name) ?? fallback;
  return {
    requiresCustom: bool(attr("RequiresCustom", "True")),
    enabled: bool(attr("Enabled", "True")),
    address: attr("Address", "-1"),
    addressExtra: attr("AddressExtra", ""),
    addressFlags: attr("AddressFlags", ""),
    type: int(attr("Type", "0")),
    signal: int(attr("SignalIndex", "-1")),
    hvacUnitIndex: int(attr("HvacUnitIndex", "-1")),
    port: int(attr("Port", "-1")),
    ouIndex: int(attr("OUIndex", "-1")),
  };
}

/**
 * `HvacObjectAddress.ToXML` + `HvacCharacter.ToXML`. AddressExtra and
 * AddressFlags go through `IntesisXML.SetAttributeWithDefault`, which writes
 * them even when empty.
 */
function hvacAddressXml(a: HvacAddress): XmlElement {
  return element("UserAddress", [
    ["RequiresCustom", boolText(a.requiresCustom)],
    ["Enabled", boolText(a.enabled)],
    ["Address", a.address],
    ["AddressExtra", a.addressExtra],
    ["AddressFlags", a.addressFlags],
    ["Type", String(a.type)],
    ["SignalIndex", String(a.signal)],
    ["HvacUnitIndex", String(a.hvacUnitIndex)],
    ["Port", String(a.port)],
    ["OUIndex", String(a.ouIndex)],
  ]);
}

/** Append an element as the last child of `<Project>`, indented one level. */
function appendRootChild(doc: XmlDocument, el: XmlElement): XmlElement {
  const root = doc.root;
  const last = root.children[root.children.length - 1];
  const closing = last && last.kind === "text" && /^\s*$/.test(last.text) ? root.children.length - 1 : root.children.length;
  el.parent = root;
  root.children.splice(closing, 0, text(`${LINE_ENDING}${INDENT_UNIT}`), el);
  if (closing === root.children.length - 2) root.children.push(text(LINE_ENDING));
  return el;
}

/** `MbsObject.ToXml` (MbsObject.cs): note idxExternal is written as ConfigID. */
function mbsObjectXml(o: MbsObject): XmlElement {
  return signalXml(o.configId, [
    leaf("isEnabled", boolText(o.isEnabled)),
    leaf("idxConfig", String(o.configId)),
    leaf("idxExternal", String(o.configId)),
    leaf("IdxOperations", conversionIdsText(o.operations)),
    leaf("IdxFilters", conversionIdsText(o.filters)),
    leaf("Description", o.description),
    leaf("LenBits", String(o.dataLength)),
    leaf("Format", String(o.format)),
    leaf("Bit", String(o.bit)),
    leaf("Address", String(o.address)),
    leaf("ReadWrite", String(o.readWrite)),
    leaf("StringLength", String(o.stringLength)),
    leaf("SlaveIndex", String(o.slaveIndex)),
    leaf("GatewayIndex", String(o.gatewayIndex)),
    element("Virtual", [
      ["Status", boolText(o.isVirtual)],
      ["Fixed", boolText(o.isFixed)],
      ["General", boolText(o.isGeneral)],
    ]),
    leaf("ProtocolIndex", String(o.protocolIndex)),
  ]);
}

/** `ExternalME.CreateObjectNode` (ExternalME.cs:709). */
function meObjectXml(o: MeObject): XmlElement {
  return signalXml(o.configId, [
    leaf("idxConfig", String(o.configId)),
    leaf("idxExternal", String(o.externalId)),
    leaf("IdxOperations", conversionIdsText(o.operations)),
    leaf("IdxFilters", conversionIdsText(o.filters)),
    leaf("UnitId", String(o.unitId)),
    leaf("IsIndoorSignal", boolText(o.isIndoor)),
    leaf("GroupIndex", String(o.groupId)),
    leaf("G50Index", String(o.g50Id)),
    element("Virtual", [
      ["Status", boolText(o.isVirtual)],
      ["Fixed", boolText(o.isFixed)],
    ]),
    leaf("IsStatus", boolText(o.isStatus)),
    leaf("SignalIndex", String(o.signalIndex)),
    leaf("SignalSpecIndex", String(o.signalSpecIndex)),
  ]);
}

function signalXml(id: number, fields: XmlElement[]): XmlElement {
  const signal = element("Signal", [["ID", String(id)]]);
  replaceIndented(signal, fields, 4);
  return signal;
}

/** Replace `parent`'s children, indented as the .NET XmlWriter writes them. */
function replaceIndented(parent: XmlElement, children: XmlElement[], childLevel: number): void {
  if (children.length === 0) {
    parent.children = [];
    parent.emptyForm = "self";
    return;
  }
  const nodes: XmlNode[] = [];
  for (const child of children) {
    child.parent = parent;
    nodes.push(text(`${LINE_ENDING}${INDENT_UNIT.repeat(childLevel)}`), child);
  }
  nodes.push(text(`${LINE_ENDING}${INDENT_UNIT.repeat(childLevel - 1)}`));
  parent.children = nodes;
}

/** Remove an element together with the indentation text before it. */
function removeWithIndent(el: XmlElement): void {
  const parent = el.parent;
  if (!parent) return;
  const index = parent.children.indexOf(el);
  const before = parent.children[index - 1];
  const start = before && before.kind === "text" && /^\s*$/.test(before.text) ? index - 1 : index;
  parent.children.splice(start, index - start + 1);
  el.parent = undefined;
}

/** Text element; an empty value is written `<tag></tag>`, like .NET. */
function leaf(tag: string, value: string): XmlElement {
  return element(tag, [], [text(value)]);
}

/** `IntesisConversion.ParseConversionIDs`. */
function parseConversionIds(value: string): ConversionRef[] {
  if (value === "") return [];
  return value.split(";").map((entry) => {
    const [index, inverted] = entry.split(",");
    return { index: int(index), inverted: int(inverted) === 1 };
  });
}

function conversionIdsText(ids: ConversionRef[]): string {
  return ids.map((c) => `${c.index},${c.inverted ? 1 : 0}`).join(";");
}

function boolText(value: boolean): string {
  return value ? "True" : "False";
}

/** `Convert.ToBoolean`: case-insensitive "True"/"False", anything else throws. */
function bool(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`Not a boolean: "${value}"`);
}

function int(value: string | undefined): number {
  const n = Number((value ?? "").trim());
  if (!Number.isInteger(n) || (value ?? "").trim() === "") throw new Error(`Not an integer: "${value}"`);
  return n;
}

function childOpt(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function childText(el: XmlElement, tag: string): string {
  const child = childOpt(el, tag);
  if (!child) throw new Error(`<${el.tag}> has no <${tag}> child`);
  return getText(child);
}

/** `IntesisXML.GetInnerTextWithDefault` for integers. */
function intOr(el: XmlElement, tag: string, fallback: number): number {
  const child = childOpt(el, tag);
  return child ? int(getText(child)) : fallback;
}
