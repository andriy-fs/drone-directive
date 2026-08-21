import * as bare from "@bare-ts/lib"

export type f32 = number
export type f64 = number
export type u8 = number
export type u32 = number
export type u64 = bigint
export type uint = bigint

/**
 * f64, never f32: the two peers simulate independently and compare world hashes,
 * so a coordinate that survives the wire with less precision than it had is a
 * desync waiting to happen.
 */
export type Vec2 = {
    readonly x: f64
    readonly y: f64
}

export function readVec2(bc: bare.ByteCursor): Vec2 {
    return {
        x: bare.readF64(bc),
        y: bare.readF64(bc),
    }
}

export function writeVec2(bc: bare.ByteCursor, x: Vec2): void {
    bare.writeF64(bc, x.x)
    bare.writeF64(bc, x.y)
}

export enum ChassisType {
    Tracks = "Tracks",
    Wheels = "Wheels",
    Legs = "Legs",
}

export function readChassisType(bc: bare.ByteCursor): ChassisType {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return ChassisType.Tracks
        case 1:
            return ChassisType.Wheels
        case 2:
            return ChassisType.Legs
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeChassisType(bc: bare.ByteCursor, x: ChassisType): void {
    switch (x) {
        case ChassisType.Tracks: {
            bare.writeU8(bc, 0)
            break
        }
        case ChassisType.Wheels: {
            bare.writeU8(bc, 1)
            break
        }
        case ChassisType.Legs: {
            bare.writeU8(bc, 2)
            break
        }
    }
}

export enum WeaponType {
    None = "None",
    Cannon = "Cannon",
    Missiles = "Missiles",
    Bomb = "Bomb",
    Radar = "Radar",
    Ew = "Ew",
    Dew = "Dew",
    Fpv = "Fpv",
}

export function readWeaponType(bc: bare.ByteCursor): WeaponType {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return WeaponType.None
        case 1:
            return WeaponType.Cannon
        case 2:
            return WeaponType.Missiles
        case 3:
            return WeaponType.Bomb
        case 4:
            return WeaponType.Radar
        case 5:
            return WeaponType.Ew
        case 6:
            return WeaponType.Dew
        case 7:
            return WeaponType.Fpv
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeWeaponType(bc: bare.ByteCursor, x: WeaponType): void {
    switch (x) {
        case WeaponType.None: {
            bare.writeU8(bc, 0)
            break
        }
        case WeaponType.Cannon: {
            bare.writeU8(bc, 1)
            break
        }
        case WeaponType.Missiles: {
            bare.writeU8(bc, 2)
            break
        }
        case WeaponType.Bomb: {
            bare.writeU8(bc, 3)
            break
        }
        case WeaponType.Radar: {
            bare.writeU8(bc, 4)
            break
        }
        case WeaponType.Ew: {
            bare.writeU8(bc, 5)
            break
        }
        case WeaponType.Dew: {
            bare.writeU8(bc, 6)
            break
        }
        case WeaponType.Fpv: {
            bare.writeU8(bc, 7)
            break
        }
    }
}

export enum TaskType {
    Idle = "Idle",
    Guard = "Guard",
    AttackBase = "AttackBase",
    AttackRobots = "AttackRobots",
    Scout = "Scout",
    AttackTarget = "AttackTarget",
    Overwatch = "Overwatch",
    DefendBase = "DefendBase",
    GroupAttack = "GroupAttack",
}

export function readTaskType(bc: bare.ByteCursor): TaskType {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return TaskType.Idle
        case 1:
            return TaskType.Guard
        case 2:
            return TaskType.AttackBase
        case 3:
            return TaskType.AttackRobots
        case 4:
            return TaskType.Scout
        case 5:
            return TaskType.AttackTarget
        case 6:
            return TaskType.Overwatch
        case 7:
            return TaskType.DefendBase
        case 8:
            return TaskType.GroupAttack
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeTaskType(bc: bare.ByteCursor, x: TaskType): void {
    switch (x) {
        case TaskType.Idle: {
            bare.writeU8(bc, 0)
            break
        }
        case TaskType.Guard: {
            bare.writeU8(bc, 1)
            break
        }
        case TaskType.AttackBase: {
            bare.writeU8(bc, 2)
            break
        }
        case TaskType.AttackRobots: {
            bare.writeU8(bc, 3)
            break
        }
        case TaskType.Scout: {
            bare.writeU8(bc, 4)
            break
        }
        case TaskType.AttackTarget: {
            bare.writeU8(bc, 5)
            break
        }
        case TaskType.Overwatch: {
            bare.writeU8(bc, 6)
            break
        }
        case TaskType.DefendBase: {
            bare.writeU8(bc, 7)
            break
        }
        case TaskType.GroupAttack: {
            bare.writeU8(bc, 8)
            break
        }
    }
}

/**
 * A build order's task is tri-state in the domain (`task?: TaskType | null`):
 * absent means "fall back to the base's default", null means "explicitly no
 * program". Flattened into one enum here so the wire states which of the three it
 * means outright, instead of nesting an optional inside an optional.
 */
export enum BuildTask {
    Unspecified = "Unspecified",
    None = "None",
    Idle = "Idle",
    Guard = "Guard",
    AttackBase = "AttackBase",
    AttackRobots = "AttackRobots",
    Scout = "Scout",
    AttackTarget = "AttackTarget",
    Overwatch = "Overwatch",
    DefendBase = "DefendBase",
    GroupAttack = "GroupAttack",
}

export function readBuildTask(bc: bare.ByteCursor): BuildTask {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return BuildTask.Unspecified
        case 1:
            return BuildTask.None
        case 2:
            return BuildTask.Idle
        case 3:
            return BuildTask.Guard
        case 4:
            return BuildTask.AttackBase
        case 5:
            return BuildTask.AttackRobots
        case 6:
            return BuildTask.Scout
        case 7:
            return BuildTask.AttackTarget
        case 8:
            return BuildTask.Overwatch
        case 9:
            return BuildTask.DefendBase
        case 10:
            return BuildTask.GroupAttack
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeBuildTask(bc: bare.ByteCursor, x: BuildTask): void {
    switch (x) {
        case BuildTask.Unspecified: {
            bare.writeU8(bc, 0)
            break
        }
        case BuildTask.None: {
            bare.writeU8(bc, 1)
            break
        }
        case BuildTask.Idle: {
            bare.writeU8(bc, 2)
            break
        }
        case BuildTask.Guard: {
            bare.writeU8(bc, 3)
            break
        }
        case BuildTask.AttackBase: {
            bare.writeU8(bc, 4)
            break
        }
        case BuildTask.AttackRobots: {
            bare.writeU8(bc, 5)
            break
        }
        case BuildTask.Scout: {
            bare.writeU8(bc, 6)
            break
        }
        case BuildTask.AttackTarget: {
            bare.writeU8(bc, 7)
            break
        }
        case BuildTask.Overwatch: {
            bare.writeU8(bc, 8)
            break
        }
        case BuildTask.DefendBase: {
            bare.writeU8(bc, 9)
            break
        }
        case BuildTask.GroupAttack: {
            bare.writeU8(bc, 10)
            break
        }
    }
}

export type BuildOrder = {
    readonly chassis: ChassisType
    readonly weapon: WeaponType
    readonly task: BuildTask
}

export function readBuildOrder(bc: bare.ByteCursor): BuildOrder {
    return {
        chassis: readChassisType(bc),
        weapon: readWeaponType(bc),
        task: readBuildTask(bc),
    }
}

export function writeBuildOrder(bc: bare.ByteCursor, x: BuildOrder): void {
    writeChassisType(bc, x.chassis)
    writeWeaponType(bc, x.weapon)
    writeBuildTask(bc, x.task)
}

/**
 * The shape a group of robots holds. Where each robot stands inside the shape is
 * never on the wire: both peers derive it from the units' weapons, identically.
 */
export enum Formation {
    Line = "Line",
    Box = "Box",
    Spread = "Spread",
}

export function readFormation(bc: bare.ByteCursor): Formation {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return Formation.Line
        case 1:
            return Formation.Box
        case 2:
            return Formation.Spread
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeFormation(bc: bare.ByteCursor, x: Formation): void {
    switch (x) {
        case Formation.Line: {
            bare.writeU8(bc, 0)
            break
        }
        case Formation.Box: {
            bare.writeU8(bc, 1)
            break
        }
        case Formation.Spread: {
            bare.writeU8(bc, 2)
            break
        }
    }
}

export type AssignTask = {
    readonly tag: "AssignTask"
    readonly robotId: string
    readonly task: TaskType
}

export function readAssignTask(bc: bare.ByteCursor): AssignTask {
    return {
        tag: "AssignTask",
        robotId: bare.readString(bc),
        task: readTaskType(bc),
    }
}

export function writeAssignTask(bc: bare.ByteCursor, x: AssignTask): void {
    bare.writeString(bc, x.robotId)
    writeTaskType(bc, x.task)
}

export type BuildRobot = {
    readonly tag: "BuildRobot"
    readonly baseId: string
    readonly order: BuildOrder
}

export function readBuildRobot(bc: bare.ByteCursor): BuildRobot {
    return {
        tag: "BuildRobot",
        baseId: bare.readString(bc),
        order: readBuildOrder(bc),
    }
}

export function writeBuildRobot(bc: bare.ByteCursor, x: BuildRobot): void {
    bare.writeString(bc, x.baseId)
    writeBuildOrder(bc, x.order)
}

function read0(bc: bare.ByteCursor): BuildOrder | null {
    return bare.readBool(bc) ? readBuildOrder(bc) : null
}

function write0(bc: bare.ByteCursor, x: BuildOrder | null): void {
    bare.writeBool(bc, x != null)
    if (x != null) {
        writeBuildOrder(bc, x)
    }
}

export type SetAutoBuild = {
    readonly tag: "SetAutoBuild"
    readonly baseId: string
    readonly order: BuildOrder | null
}

export function readSetAutoBuild(bc: bare.ByteCursor): SetAutoBuild {
    return {
        tag: "SetAutoBuild",
        baseId: bare.readString(bc),
        order: read0(bc),
    }
}

export function writeSetAutoBuild(bc: bare.ByteCursor, x: SetAutoBuild): void {
    bare.writeString(bc, x.baseId)
    write0(bc, x.order)
}

function read1(bc: bare.ByteCursor): readonly string[] {
    const len = bare.readUintSafe(bc)
    if (len === 0) {
        return []
    }
    const result = [bare.readString(bc)]
    for (let i = 1; i < len; i++) {
        result[i] = bare.readString(bc)
    }
    return result
}

function write1(bc: bare.ByteCursor, x: readonly string[]): void {
    bare.writeUintSafe(bc, x.length)
    for (let i = 0; i < x.length; i++) {
        bare.writeString(bc, x[i])
    }
}

export type MoveRobots = {
    readonly tag: "MoveRobots"
    readonly robotIds: readonly string[]
    readonly point: Vec2
}

export function readMoveRobots(bc: bare.ByteCursor): MoveRobots {
    return {
        tag: "MoveRobots",
        robotIds: read1(bc),
        point: readVec2(bc),
    }
}

export function writeMoveRobots(bc: bare.ByteCursor, x: MoveRobots): void {
    write1(bc, x.robotIds)
    writeVec2(bc, x.point)
}

export type AttackTarget = {
    readonly tag: "AttackTarget"
    readonly robotIds: readonly string[]
    readonly targetId: string
}

export function readAttackTarget(bc: bare.ByteCursor): AttackTarget {
    return {
        tag: "AttackTarget",
        robotIds: read1(bc),
        targetId: bare.readString(bc),
    }
}

export function writeAttackTarget(bc: bare.ByteCursor, x: AttackTarget): void {
    write1(bc, x.robotIds)
    bare.writeString(bc, x.targetId)
}

function read2(bc: bare.ByteCursor): Vec2 | null {
    return bare.readBool(bc) ? readVec2(bc) : null
}

function write2(bc: bare.ByteCursor, x: Vec2 | null): void {
    bare.writeBool(bc, x != null)
    if (x != null) {
        writeVec2(bc, x)
    }
}

/**
 * A base's gathering point for the robots it produces; absent = none.
 */
export type SetRallyPoint = {
    readonly tag: "SetRallyPoint"
    readonly baseId: string
    readonly point: Vec2 | null
}

export function readSetRallyPoint(bc: bare.ByteCursor): SetRallyPoint {
    return {
        tag: "SetRallyPoint",
        baseId: bare.readString(bc),
        point: read2(bc),
    }
}

export function writeSetRallyPoint(bc: bare.ByteCursor, x: SetRallyPoint): void {
    bare.writeString(bc, x.baseId)
    write2(bc, x.point)
}

/**
 * Raise a base's one-shot energy dome. No payload: activation is free, and the
 * engine checks only that the base is alive with its charge unspent.
 */
export type ActivateShield = {
    readonly tag: "ActivateShield"
    readonly baseId: string
}

export function readActivateShield(bc: bare.ByteCursor): ActivateShield {
    return {
        tag: "ActivateShield",
        baseId: bare.readString(bc),
    }
}

export function writeActivateShield(bc: bare.ByteCursor, x: ActivateShield): void {
    bare.writeString(bc, x.baseId)
}

function read3(bc: bare.ByteCursor): TaskType | null {
    return bare.readBool(bc) ? readTaskType(bc) : null
}

function write3(bc: bare.ByteCursor, x: TaskType | null): void {
    bare.writeBool(bc, x != null)
    if (x != null) {
        writeTaskType(bc, x)
    }
}

/**
 * The program a base stamps on the robots it produces; absent = none (Idle).
 * `optional<TaskType>` rather than the flattened `BuildTask` above: a build order
 * has a third state ("take the base's default"), a base default has nothing to
 * defer to, so two states is all it can mean.
 */
export type SetDefaultTask = {
    readonly tag: "SetDefaultTask"
    readonly baseId: string
    readonly task: TaskType | null
}

export function readSetDefaultTask(bc: bare.ByteCursor): SetDefaultTask {
    return {
        tag: "SetDefaultTask",
        baseId: bare.readString(bc),
        task: read3(bc),
    }
}

export function writeSetDefaultTask(bc: bare.ByteCursor, x: SetDefaultTask): void {
    bare.writeString(bc, x.baseId)
    write3(bc, x.task)
}

function read4(bc: bare.ByteCursor): Formation | null {
    return bare.readBool(bc) ? readFormation(bc) : null
}

function write4(bc: bare.ByteCursor, x: Formation | null): void {
    bare.writeBool(bc, x != null)
    if (x != null) {
        writeFormation(bc, x)
    }
}

/**
 * The shape the named robots hold from now on; absent = fall out of formation.
 * Two states, like `SetDefaultTask` and unlike a build order's tri-state task:
 * a selection either holds a shape or holds none, with nothing to defer to.
 */
export type SetFormation = {
    readonly tag: "SetFormation"
    readonly robotIds: readonly string[]
    readonly formation: Formation | null
}

export function readSetFormation(bc: bare.ByteCursor): SetFormation {
    return {
        tag: "SetFormation",
        robotIds: read1(bc),
        formation: read4(bc),
    }
}

export function writeSetFormation(bc: bare.ByteCursor, x: SetFormation): void {
    write1(bc, x.robotIds)
    write4(bc, x.formation)
}

/**
 * Union order *is* the tag numbering, so a new command is appended last and the
 * ones already out there keep the tags they had. That is a courtesy to whoever
 * reads a packet dump, not compatibility: PROTOCOL_VERSION is bumped regardless.
 */
export type Command =
    | AssignTask
    | BuildRobot
    | SetAutoBuild
    | MoveRobots
    | AttackTarget
    | SetRallyPoint
    | ActivateShield
    | SetDefaultTask
    | SetFormation

export function readCommand(bc: bare.ByteCursor): Command {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return readAssignTask(bc)
        case 1:
            return readBuildRobot(bc)
        case 2:
            return readSetAutoBuild(bc)
        case 3:
            return readMoveRobots(bc)
        case 4:
            return readAttackTarget(bc)
        case 5:
            return readSetRallyPoint(bc)
        case 6:
            return readActivateShield(bc)
        case 7:
            return readSetDefaultTask(bc)
        case 8:
            return readSetFormation(bc)
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeCommand(bc: bare.ByteCursor, x: Command): void {
    switch (x.tag) {
        case "AssignTask": {
            bare.writeU8(bc, 0)
            writeAssignTask(bc, x)
            break
        }
        case "BuildRobot": {
            bare.writeU8(bc, 1)
            writeBuildRobot(bc, x)
            break
        }
        case "SetAutoBuild": {
            bare.writeU8(bc, 2)
            writeSetAutoBuild(bc, x)
            break
        }
        case "MoveRobots": {
            bare.writeU8(bc, 3)
            writeMoveRobots(bc, x)
            break
        }
        case "AttackTarget": {
            bare.writeU8(bc, 4)
            writeAttackTarget(bc, x)
            break
        }
        case "SetRallyPoint": {
            bare.writeU8(bc, 5)
            writeSetRallyPoint(bc, x)
            break
        }
        case "ActivateShield": {
            bare.writeU8(bc, 6)
            writeActivateShield(bc, x)
            break
        }
        case "SetDefaultTask": {
            bare.writeU8(bc, 7)
            writeSetDefaultTask(bc, x)
            break
        }
        case "SetFormation": {
            bare.writeU8(bc, 8)
            writeSetFormation(bc, x)
            break
        }
    }
}

/**
 * The observer drone's input for one tick: a continuous flight direction plus two
 * one-shot pulses.
 */
export type DroneControl = {
    readonly dir: Vec2
    readonly possess: boolean
    readonly fire: boolean
}

export function readDroneControl(bc: bare.ByteCursor): DroneControl {
    return {
        dir: readVec2(bc),
        possess: bare.readBool(bc),
        fire: bare.readBool(bc),
    }
}

export function writeDroneControl(bc: bare.ByteCursor, x: DroneControl): void {
    writeVec2(bc, x.dir)
    bare.writeBool(bc, x.possess)
    bare.writeBool(bc, x.fire)
}

/**
 * "My world looked like this at tick N" — the desync probe. Both fields are u32
 * rather than uint so the generated code stays on `number` and never reaches for
 * bigint; a match will not run for four billion ticks.
 */
export type WorldCheck = {
    readonly tick: u32
    readonly hash: u32
}

export function readWorldCheck(bc: bare.ByteCursor): WorldCheck {
    return {
        tick: bare.readU32(bc),
        hash: bare.readU32(bc),
    }
}

export function writeWorldCheck(bc: bare.ByteCursor, x: WorldCheck): void {
    bare.writeU32(bc, x.tick)
    bare.writeU32(bc, x.hash)
}

function read5(bc: bare.ByteCursor): readonly Command[] {
    const len = bare.readUintSafe(bc)
    if (len === 0) {
        return []
    }
    const result = [readCommand(bc)]
    for (let i = 1; i < len; i++) {
        result[i] = readCommand(bc)
    }
    return result
}

function write5(bc: bare.ByteCursor, x: readonly Command[]): void {
    bare.writeUintSafe(bc, x.length)
    for (let i = 0; i < x.length; i++) {
        writeCommand(bc, x[i])
    }
}

function read6(bc: bare.ByteCursor): WorldCheck | null {
    return bare.readBool(bc) ? readWorldCheck(bc) : null
}

function write6(bc: bare.ByteCursor, x: WorldCheck | null): void {
    bare.writeBool(bc, x != null)
    if (x != null) {
        writeWorldCheck(bc, x)
    }
}

/**
 * `pauseToggle` is a *pulse*, not the pause state: "flip the shared pause at this
 * tick", in the same spirit as the drone's `possess`/`fire`. Either side may flip
 * it and either side may flip it back, and two pulses landing on the same tick are
 * two flips — which is the whole reason it is a pulse. An absolute flag would need
 * a rule for whose value wins; a pair of flips composes to the same world on both
 * peers no matter which order they are applied in.
 */
export type TickMessage = {
    readonly tick: u32
    readonly commands: readonly Command[]
    readonly drone: DroneControl
    readonly check: WorldCheck | null
    readonly pauseToggle: boolean
}

export function readTickMessage(bc: bare.ByteCursor): TickMessage {
    return {
        tick: bare.readU32(bc),
        commands: read5(bc),
        drone: readDroneControl(bc),
        check: read6(bc),
        pauseToggle: bare.readBool(bc),
    }
}

export function writeTickMessage(bc: bare.ByteCursor, x: TickMessage): void {
    bare.writeU32(bc, x.tick)
    write5(bc, x.commands)
    writeDroneControl(bc, x.drone)
    write6(bc, x.check)
    bare.writeBool(bc, x.pauseToggle)
}

export function encodeTickMessage(x: TickMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeTickMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeTickMessage(bytes: Uint8Array): TickMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readTickMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

/**
 * Mirrors the client's MapSize union; the wire carries the tag, not the string.
 */
export enum MapSize {
    Small = "Small",
    Medium = "Medium",
    Large = "Large",
}

export function readMapSize(bc: bare.ByteCursor): MapSize {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return MapSize.Small
        case 1:
            return MapSize.Medium
        case 2:
            return MapSize.Large
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeMapSize(bc: bare.ByteCursor, x: MapSize): void {
    switch (x) {
        case MapSize.Small: {
            bare.writeU8(bc, 0)
            break
        }
        case MapSize.Medium: {
            bare.writeU8(bc, 1)
            break
        }
        case MapSize.Large: {
            bare.writeU8(bc, 2)
            break
        }
    }
}

export enum ErrorCode {
    RoomNotFound = "RoomNotFound",
    RoomFull = "RoomFull",
    RoomTaken = "RoomTaken",
    VersionMismatch = "VersionMismatch",
    BadMessage = "BadMessage",
    /**
     * A `resume` handshake the relay would not honour: unknown token, the grace
     * period already elapsed, or so much was missed that the buffered ticks no
     * longer reach back to where the client stopped.
     */
    ResumeRejected = "ResumeRejected",
}

export function readErrorCode(bc: bare.ByteCursor): ErrorCode {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return ErrorCode.RoomNotFound
        case 1:
            return ErrorCode.RoomFull
        case 2:
            return ErrorCode.RoomTaken
        case 3:
            return ErrorCode.VersionMismatch
        case 4:
            return ErrorCode.BadMessage
        case 5:
            return ErrorCode.ResumeRejected
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeErrorCode(bc: bare.ByteCursor, x: ErrorCode): void {
    switch (x) {
        case ErrorCode.RoomNotFound: {
            bare.writeU8(bc, 0)
            break
        }
        case ErrorCode.RoomFull: {
            bare.writeU8(bc, 1)
            break
        }
        case ErrorCode.RoomTaken: {
            bare.writeU8(bc, 2)
            break
        }
        case ErrorCode.VersionMismatch: {
            bare.writeU8(bc, 3)
            break
        }
        case ErrorCode.BadMessage: {
            bare.writeU8(bc, 4)
            break
        }
        case ErrorCode.ResumeRejected: {
            bare.writeU8(bc, 5)
            break
        }
    }
}

/**
 * Host acknowledgement: the room is open and waiting for a guest.
 */
export type CreatedMessage = {
    readonly roomCode: string
}

export function readCreatedMessage(bc: bare.ByteCursor): CreatedMessage {
    return {
        roomCode: bare.readString(bc),
    }
}

export function writeCreatedMessage(bc: bare.ByteCursor, x: CreatedMessage): void {
    bare.writeString(bc, x.roomCode)
}

export function encodeCreatedMessage(x: CreatedMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeCreatedMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeCreatedMessage(bytes: Uint8Array): CreatedMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readCreatedMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

/**
 * `resumeToken` is the one field the two peers are told *different* values of, so
 * the two `start` frames are no longer byte-identical: it names the seat rather
 * than the match. A dropped client presents it to reclaim its own seat, and a room
 * code — four characters, client-generated — is far too guessable to stand in for
 * it: reconnecting by code alone would let a stranger walk into a live match.
 */
export type StartMessage = {
    readonly seed: u32
    readonly mapSize: MapSize
    readonly aiCount: u8
    readonly chatId: string
    readonly resumeToken: string
}

export function readStartMessage(bc: bare.ByteCursor): StartMessage {
    return {
        seed: bare.readU32(bc),
        mapSize: readMapSize(bc),
        aiCount: bare.readU8(bc),
        chatId: bare.readString(bc),
        resumeToken: bare.readString(bc),
    }
}

export function writeStartMessage(bc: bare.ByteCursor, x: StartMessage): void {
    bare.writeU32(bc, x.seed)
    writeMapSize(bc, x.mapSize)
    bare.writeU8(bc, x.aiCount)
    bare.writeString(bc, x.chatId)
    bare.writeString(bc, x.resumeToken)
}

export function encodeStartMessage(x: StartMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeStartMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeStartMessage(bytes: Uint8Array): StartMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readStartMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

export type ErrorMessage = {
    readonly code: ErrorCode
    readonly message: string
}

export function readErrorMessage(bc: bare.ByteCursor): ErrorMessage {
    return {
        code: readErrorCode(bc),
        message: bare.readString(bc),
    }
}

export function writeErrorMessage(bc: bare.ByteCursor, x: ErrorMessage): void {
    writeErrorCode(bc, x.code)
    bare.writeString(bc, x.message)
}

export function encodeErrorMessage(x: ErrorMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeErrorMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeErrorMessage(bytes: Uint8Array): ErrorMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readErrorMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

export enum ChatSeat {
    Host = "Host",
    Guest = "Guest",
}

export function readChatSeat(bc: bare.ByteCursor): ChatSeat {
    const offset = bc.offset
    const tag = bare.readU8(bc)
    switch (tag) {
        case 0:
            return ChatSeat.Host
        case 1:
            return ChatSeat.Guest
        default: {
            bc.offset = offset
            throw new bare.BareError(offset, "invalid tag")
        }
    }
}

export function writeChatSeat(bc: bare.ByteCursor, x: ChatSeat): void {
    switch (x) {
        case ChatSeat.Host: {
            bare.writeU8(bc, 0)
            break
        }
        case ChatSeat.Guest: {
            bare.writeU8(bc, 1)
            break
        }
    }
}

/**
 * One stored message. `seq` is assigned by the server and is what both orders the
 * log and tells a reconnecting client which messages it still needs.
 */
export type ChatEntry = {
    readonly seq: u32
    readonly from: ChatSeat
    readonly text: string
    /**
     * Unix seconds. u32, never uint/u64 — the generated code would reach for
     * bigint, and this protocol keeps every number a `number`.
     */
    readonly sentAt: u32
}

export function readChatEntry(bc: bare.ByteCursor): ChatEntry {
    return {
        seq: bare.readU32(bc),
        from: readChatSeat(bc),
        text: bare.readString(bc),
        sentAt: bare.readU32(bc),
    }
}

export function writeChatEntry(bc: bare.ByteCursor, x: ChatEntry): void {
    bare.writeU32(bc, x.seq)
    writeChatSeat(bc, x.from)
    bare.writeString(bc, x.text)
    bare.writeU32(bc, x.sentAt)
}

/**
 * client -> Chat DO. The server sanitizes, rate-limits and numbers it.
 */
export type ChatSendMessage = {
    readonly text: string
}

export function readChatSendMessage(bc: bare.ByteCursor): ChatSendMessage {
    return {
        text: bare.readString(bc),
    }
}

export function writeChatSendMessage(bc: bare.ByteCursor, x: ChatSendMessage): void {
    bare.writeString(bc, x.text)
}

export function encodeChatSendMessage(x: ChatSendMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeChatSendMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeChatSendMessage(bytes: Uint8Array): ChatSendMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readChatSendMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

function read7(bc: bare.ByteCursor): readonly ChatEntry[] {
    const len = bare.readUintSafe(bc)
    if (len === 0) {
        return []
    }
    const result = [readChatEntry(bc)]
    for (let i = 1; i < len; i++) {
        result[i] = readChatEntry(bc)
    }
    return result
}

function write7(bc: bare.ByteCursor, x: readonly ChatEntry[]): void {
    bare.writeUintSafe(bc, x.length)
    for (let i = 0; i < x.length; i++) {
        writeChatEntry(bc, x[i])
    }
}

/**
 * Chat DO -> client, on connect: everything after the `since` the client asked
 * for, plus whether the other seat is attached right now.
 */
export type ChatHistoryMessage = {
    readonly entries: readonly ChatEntry[]
    readonly peerOnline: boolean
}

export function readChatHistoryMessage(bc: bare.ByteCursor): ChatHistoryMessage {
    return {
        entries: read7(bc),
        peerOnline: bare.readBool(bc),
    }
}

export function writeChatHistoryMessage(bc: bare.ByteCursor, x: ChatHistoryMessage): void {
    write7(bc, x.entries)
    bare.writeBool(bc, x.peerOnline)
}

export function encodeChatHistoryMessage(x: ChatHistoryMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeChatHistoryMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeChatHistoryMessage(bytes: Uint8Array): ChatHistoryMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readChatHistoryMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

/**
 * Chat DO -> both clients. The sender's own echo is what confirms its `seq`.
 */
export type ChatPostedMessage = {
    readonly entry: ChatEntry
}

export function readChatPostedMessage(bc: bare.ByteCursor): ChatPostedMessage {
    return {
        entry: readChatEntry(bc),
    }
}

export function writeChatPostedMessage(bc: bare.ByteCursor, x: ChatPostedMessage): void {
    writeChatEntry(bc, x.entry)
}

export function encodeChatPostedMessage(x: ChatPostedMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeChatPostedMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeChatPostedMessage(bytes: Uint8Array): ChatPostedMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readChatPostedMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}

/**
 * Chat DO -> client: the other seat attached or dropped.
 */
export type ChatPresenceMessage = {
    readonly peerOnline: boolean
}

export function readChatPresenceMessage(bc: bare.ByteCursor): ChatPresenceMessage {
    return {
        peerOnline: bare.readBool(bc),
    }
}

export function writeChatPresenceMessage(bc: bare.ByteCursor, x: ChatPresenceMessage): void {
    bare.writeBool(bc, x.peerOnline)
}

export function encodeChatPresenceMessage(x: ChatPresenceMessage, config?: Partial<bare.Config>): Uint8Array {
    const fullConfig = config != null ? bare.Config(config) : bare.DEFAULT_CONFIG
    const bc = new bare.ByteCursor(
        new Uint8Array(fullConfig.initialBufferLength),
        fullConfig
    )
    writeChatPresenceMessage(bc, x)
    return new Uint8Array(bc.view.buffer, bc.view.byteOffset, bc.offset)
}

export function decodeChatPresenceMessage(bytes: Uint8Array): ChatPresenceMessage {
    const bc = new bare.ByteCursor(bytes, bare.DEFAULT_CONFIG)
    const result = readChatPresenceMessage(bc)
    if (bc.offset < bc.view.byteLength) {
        throw new bare.BareError(bc.offset, "remaining bytes")
    }
    return result
}
