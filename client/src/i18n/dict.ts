/** UI dictionary shape — every locale (including this canonical English one) must satisfy it. */
export interface Dict {
  mainMenu: {
    title: string;
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
    /** The same flight keys once the view has been unpinned from the drone. */
    panView: string;
    units: string;
    unitGuide: string;
    /** The title screen's navigation rail: the active mode, and the panel it opens. */
    singleplayer: string;
    matchSetup: string;
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
    command: string;
    units: string;
    directive: string;
    paused: string;
    /** The Command section's view-sync tile, in its two states (see StatusPanel). */
    viewDrone: string;
    viewFree: string;
    /** What the toggle does, for the tooltip. */
    viewSyncHint: string;
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
    /** The title screen's switch — the dialog only labels the model behind it. */
    autoProduce: string;
    chassis: string;
    weapon: string;
    newRobotProgram: string;
    /** Commits the dialog's draft; also what turns auto-production on. */
    apply: string;
    cancel: string;
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
    /** The tile that opens the build dialog (whose own title is `buildRobot.title`). */
    buildProgram: string;
    /** The tile that does what Ctrl+A does, for a player who doesn't know Ctrl+A. */
    selectAll: string;
    /**
     * The toast over the canvas announcing that a replacement drone is up, and its
     * action. Shown until the player syncs the view back to it — the camera
     * deliberately does not move on its own (see GameApp.wireBus).
     */
    droneReadyToast: string;
    droneReadyAction: string;
    /** The energy-dome tile before the match's single charge has been used. */
    shield: string;
    /** Same tile, and the readout above it, while the dome is standing. */
    shieldUp: string;
    /** Same tile once the charge is gone: still there, permanently dead. */
    shieldSpent: string;
  };
  programming: {
    selectUnits: string;
    enemyUnit: string;
    robotsSelected: string;
    weapon: string;
    baseSelected: string;
    baseProgram: string;
    rallyPoint: string;
    rallyNone: string;
    rallyHint: string;
    /** Sub-headings above the two tile grids in the Directive card. */
    directiveHeading: string;
    formationHeading: string;
  };
  /**
   * Formation shapes. `none` is a tile like the others — "fall out" is a choice
   * the player makes, not a missing value — so it carries a note of its own.
   */
  formations: {
    line: string;
    box: string;
    spread: string;
    none: string;
    lineNote: string;
    boxNote: string;
    spreadNote: string;
    noneNote: string;
  };
  programs: {
    idle: string;
    guard: string;
    attackBase: string;
    attackRobots: string;
    scout: string;
    attackTarget: string;
    overwatch: string;
    defendBase: string;
    groupAttack: string;
    none: string;
    /** Opening line of the directives reference modal. */
    intro: string;
    /** What each assignable directive makes a unit do — listed in that modal. */
    guardNote: string;
    defendBaseNote: string;
    attackBaseNote: string;
    attackRobotsNote: string;
    scoutNote: string;
    overwatchNote: string;
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
    dew: string;
    fpv: string;
    statsRange: string;
    statsDamage: string;
    statsReload: string;
    /** "Salvo" — how many strike drones one launch releases (fpv). */
    statsSalvo: string;
    /** "Flight" — seconds a launched drone stays airborne before it falls (fpv). */
    statsFlight: string;
    radarNote: string;
    ewNote: string;
    bombNote: string;
    cannonNote: string;
    missilesNote: string;
    dewNote: string;
    fpvNote: string;
  };
  aria: {
    resume: string;
    pause: string;
    unmute: string;
    mute: string;
    volume: string;
    musicVolume: string;
    /** The HUD/menu button that opens the sound settings. */
    soundSettings: string;
    /** The Directives card's header button, which opens the directives reference. */
    directivesHelp: string;
    /** The title screen's globe button, which opens the language menu. */
    language: string;
    /** A modal's corner [X] — the label the button's icon can't provide. */
    close: string;
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
    /** Effects volume. Music has its own pair below — the two are separate buses. */
    volume: string;
    music: string;
    musicVolume: string;
  };
  graphics: {
    title: string;
    /** The settings bar button's label. */
    settings: string;
    /** Label above the three quality chips. */
    quality: string;
    high: string;
    medium: string;
    low: string;
    /** What the levels actually trade — shown under the chips. */
    hint: string;
    /** Shown only once a pick has changed something that needs the page reloaded. */
    reload: string;
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
    baseHeading: string;
    baseNote: string;
  };
}
