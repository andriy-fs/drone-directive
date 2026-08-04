/** UI dictionary shape — every locale (including this canonical English one) must satisfy it. */
export interface Dict {
  mainMenu: {
    title: string;
    intro: string;
    difficulty: string;
    opponents: string;
    opponentsHint: string;
    baseSetup: string;
    autoProduceProgram: string;
    help: string;
    controls: string;
    start: string;
    language: string;
    controlsTitle: string;
    close: string;
    ctrlA: string;
    esc: string;
    dblClick: string;
    dblClickBase: string;
    selectBase: string;
    setRally: string;
    clearRally: string;
    groupAssign: string;
    groupSelect: string;
    droneHeading: string;
    flyDrone: string;
    landRelease: string;
    fireWeapon: string;
    units: string;
    unitGuide: string;
  };
  difficulty: {
    easy: string;
    easyHint: string;
    normal: string;
    normalHint: string;
    hard: string;
    hardHint: string;
  };
  mapSize: {
    label: string;
    small: string;
    smallHint: string;
    medium: string;
    mediumHint: string;
    large: string;
    largeHint: string;
  };
  hud: {
    title: string;
    statusPrefix: string;
    command: string;
    bases: string;
    units: string;
    directive: string;
    drone: string;
    player: string;
    ai: string;
    ai1: string;
    ai2: string;
    ai3: string;
    opponent: string;
    piloting: string;
    observing: string;
    hint: string;
    paused: string;
    ownerNeutral: string;
    statusMenu: string;
    statusPlaying: string;
    statusWon: string;
    statusLost: string;
  };
  gameOver: {
    victory: string;
    defeat: string;
    victoryBody: string;
    defeatBody: string;
    mainMenu: string;
    playAgain: string;
  };
  baseSetup: {
    title: string;
    autoProduce: string;
    off: string;
    on: string;
    chassis: string;
    weapon: string;
    newRobotProgram: string;
    done: string;
  };
  buildRobot: {
    title: string;
    chassis: string;
    weapon: string;
    program: string;
    cost: string;
    available: string;
    cancel: string;
    setAutoBuild: string;
    buildOnce: string;
  };
  statusPanel: {
    resources: string;
    building: string;
    queued: string;
    idle: string;
    auto: string;
    stop: string;
    buildProgram: string;
    /** Label above the observer drone's hull bar. */
    drone: string;
    /** Label above the rebuild bar while the drone is shot down. */
    droneDown: string;
  };
  programming: {
    selectUnits: string;
    enemyUnit: string;
    robotsSelected: string;
    weapon: string;
    health: string;
    baseSelected: string;
    baseProgram: string;
    rallyPoint: string;
    rallyNone: string;
    rallyHint: string;
  };
  programs: {
    idle: string;
    guard: string;
    attackBase: string;
    attackRobots: string;
    scout: string;
    attackTarget: string;
    overwatch: string;
    none: string;
  };
  chassis: {
    tracks: string;
    wheels: string;
    legs: string;
    statsHp: string;
    statsSpeed: string;
    statsSight: string;
    tracksNote: string;
    wheelsNote: string;
    legsNote: string;
  };
  weapons: {
    none: string;
    cannon: string;
    missiles: string;
    bomb: string;
    radar: string;
    ew: string;
    statsRange: string;
    statsDamage: string;
    radarNote: string;
    ewNote: string;
    bombNote: string;
    cannonNote: string;
    missilesNote: string;
  };
  aria: {
    resume: string;
    pause: string;
    unmute: string;
    mute: string;
    volume: string;
    /** The HUD/menu button that opens the sound settings. */
    soundSettings: string;
  };
  /**
   * Sound settings — one dialog, reachable from the HUD and from the title
   * screen, because the two used to disagree about what a player could change.
   */
  sound: {
    title: string;
    /** The menu row's button label. */
    settings: string;
    effects: string;
    on: string;
    off: string;
    volume: string;
  };
  online: {
    multiplayer: string;
    online2p: string;
    title: string;
    connecting: string;
    shareCode: string;
    copyCode: string;
    codeCopied: string;
    waitingOpponent: string;
    /** Mid-match, the world stopped: the peer's input for this tick has not arrived. */
    waitingPeer: string;
    /** Mid-match, our own socket dropped and the session is reclaiming its seat. */
    reconnecting: string;
    matchEnded: string;
    hostGame: string;
    createRoom: string;
    joinGame: string;
    roomCodePlaceholder: string;
    joinRoom: string;
    cancel: string;
  };
  /**
   * Chat with the online opponent. Messages are identified by seat — there are no
   * nicknames in this game, so `you`/`opponent` is the whole vocabulary.
   */
  chat: {
    title: string;
    open: string;
    close: string;
    leave: string;
    placeholder: string;
    send: string;
    you: string;
    opponent: string;
    peerOnline: string;
    peerAway: string;
    connecting: string;
    empty: string;
    muteSound: string;
    unmuteSound: string;
  };
  unitsGuide: {
    title: string;
    intro: string;
    chassisHeading: string;
    weaponsHeading: string;
  };
}
