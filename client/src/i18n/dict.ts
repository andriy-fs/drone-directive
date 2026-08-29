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
    /** The same flight keys again, once the drone is riding a hull: throttle and turn. */
    steerHull: string;
    fireWeapon: string;
    /** The same flight keys once the view has been unpinned from the drone. */
    panView: string;
    units: string;
    unitGuide: string;
    /** The title screen's navigation rail: the active mode, and the panel it opens. */
    singleplayer: string;
    matchSetup: string;
    /**
     * The rail's link out to the desktop build's releases. Short on purpose — it
     * sits in a fixed-width rail beside `unitGuide`, and a second line there
     * breaks the alignment of the whole tertiary block.
     */
    desktopApp: string;
    /** Its mirror, shown only under the desktop shell: this one ends the process. */
    quit: string;
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
  /** The HUD titlebar's exit button asks first, because abandoning is final. */
  confirmExit: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
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
    /** The way out. Nothing here is committed on close — every button beside it commits its own thing. */
    close: string;
    /**
     * The two halves of auto-build: put this model on repeat, and take it off
     * again. Two buttons rather than a toggle, because the dialog is also where
     * the model is chosen — "start" always means *this* configuration, and a
     * toggle would have to mean two different things depending on what is running.
     */
    startAutoBuild: string;
    stopAutoBuild: string;
    /** Alt text for the turning model beside the pickers. */
    preview: string;
    /**
     * The two ways to order one machine: onto the back of the queue, or in front
     * of everything waiting. Neither is gated on the wallet — the price is taken
     * when the order reaches the head of the queue.
     */
    queueBack: string;
    queueBackHint: string;
    queueFront: string;
    queueFrontHint: string;
    /** Why both of those are dead: the per-side robot cap, the only thing that refuses an order. */
    atCap: string;
    /** The list of what the factory has been told to build, and the label on each row's x. */
    queueHeading: string;
    cancelQueued: string;
  };
  statusPanel: {
    resources: string;
    building: string;
    /** The queue has something in it but cannot pay for it yet, so nothing is moving. */
    waiting: string;
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
    /** The title screen's palette button, which opens the UI-scheme menu. */
    theme: string;
    /** A modal's corner [X] — the label the button's icon can't provide. */
    close: string;
    /** The HUD titlebar's fullscreen toggle, in its two states. */
    enterFullscreen: string;
    exitFullscreen: string;
    /** The HUD titlebar's way back to the title screen. */
    exitToMenu: string;
  };
  /**
   * The UI schemes (`theme/`). Names, not descriptions — they sit in a dropdown
   * beside the language codes.
   */
  theme: {
    command: string;
    field: string;
    crt: string;
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
    /** Shown in place of the lobby form when the relay has moved past this client. */
    outdatedTitle: string;
    outdatedBody: string;
  };
  /**
   * The client has fallen behind the deploy. Two levels, one vocabulary: an update
   * is merely available, or the wire protocol moved and online play is off until
   * the player acts (see `store/enums.ts` → `ClientVersion`).
   */
  update: {
    available: string;
    /** Browser: a reload is the whole update, since `index.html` is never cached long. */
    reload: string;
    /** Desktop: reloading the page would change nothing — a new installer is the update. */
    download: string;
    later: string;
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
