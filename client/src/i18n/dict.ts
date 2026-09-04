/** UI dictionary shape — every locale (including this canonical English one) must satisfy it. */
export interface Dict {
  mainMenu: {
    title: string;
    difficulty: string;
    opponents: string;
    opponentsHint: string;
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
    /** Picking the observer drone with the pointer — the way that needs no keyboard. */
    selectDrone: string;
    /** And sending it somewhere: a right click with it selected. */
    sendDrone: string;
    landRelease: string;
    /** The same flight keys again, once the drone is riding a hull: throttle and turn. */
    steerHull: string;
    fireWeapon: string;
    /** The movement keys' resting job: everything that is not riding a hull. */
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
    /**
     * The rail's link to the game's Discord. A proper noun — every language
     * keeps it as "Discord"; the key exists so the entry goes through the same
     * dictionary as its neighbours rather than hard-coding a string in the rail.
     */
    discord: string;
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
    /** The Command section's "jump the camera to my drone" tile (see StatusPanel). */
    showDrone: string;
    /** What it does, for the tooltip. */
    showDroneHint: string;
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
    /**
     * The three legends the Command card's factory cell takes, in place of a fixed
     * caption — so the state costs no line of its own. Short: they sit in a third
     * of a 240px rail (see `.stat__label`).
     */
    queue: string;
    building: string;
    /** The queue has something in it but cannot pay for it yet, so nothing is moving. */
    waiting: string;
    auto: string;
    stop: string;
    /** The tile that opens the build dialog (whose own title is `buildRobot.title`). */
    buildProgram: string;
    /** The tile that opens the selection dialog (whose own strings are `selection`). */
    selection: string;
    /**
     * The toast over the canvas announcing that a replacement drone is up, and its
     * action. Shown until the player syncs the view back to it — the camera
     * deliberately does not move on its own (see GameApp.wireBus).
     */
    droneReadyToast: string;
    droneReadyAction: string;
    /** The energy-dome tile before the match's single charge has been used. */
    shield: string;
    /**
     * Its tooltip, on the tile in every state: the dome is one charge for the whole
     * match, and that is the only thing that ever greys the tile out.
     */
    shieldHint: string;
    /** Same tile, and the readout above it, while the dome is standing. */
    shieldUp: string;
    /** Same tile once the charge is gone: still there, permanently dead. */
    shieldSpent: string;
  };
  /** The selection dialog — every way of picking an army, behind one HUD tile. */
  selection: {
    title: string;
    /** Does what Ctrl+A does, for a player who has not learned Ctrl+A. */
    all: string;
    /**
     * Its opposite. Chiefly for a touchscreen, where a tap on open ground is the
     * move order rather than a way out of a selection.
     */
    clear: string;
    /**
     * Heading over the per-weapon buttons. Only the weapons the player actually
     * fields appear under it, so the group is absent from an empty army.
     */
    byWeapon: string;
    /** Heading over the observer drone's two buttons. */
    droneHeading: string;
    /**
     * "Take the eye in hand" — the selecting half of the pair, beside
     * `hud.showDrone`, which is still only a camera jump.
     */
    drone: string;
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
  /**
   * The screen between the title and the battlefield, while the world is built
   * and its sprites decoded. Held for a floor of `LOADING_MIN_MS` even when the
   * work finishes sooner, so it reads as a briefing rather than a flicker — which
   * is what the tips are for: they are the reason the floor is not an annoyance.
   */
  loading: {
    title: string;
    /** Heading over the side list. */
    sides: string;
    /** The three ways a row in that list can be labelled. */
    you: string;
    opponent: string;
    bot: string;
    /** Heading over the rotating tip. */
    tipLabel: string;
    /**
     * The tips themselves. Numbered keys rather than an array because `useT()`
     * resolves `dict[section][key]` to a string — one entry per tip keeps every
     * language checked key-for-key by `dictionaries.test.ts`. `LOADING_TIPS` in
     * `ui/screens/LoadingScreen.tsx` is the list that has to grow with them.
     */
    tip1: string;
    tip2: string;
    tip3: string;
    tip4: string;
    tip5: string;
    tip6: string;
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
  /**
   * The two things a screen can be wrong about (`ui/features/device/`). Kept
   * apart because they ask for different things: a turn, or a decision.
   */
  device: {
    /** Big enough, stood on its end. One motion fixes it, so this screen blocks. */
    rotateTitle: string;
    rotateBody: string;
    /**
     * Too small in any orientation — a phone, an iPad in Split View, a dragged-down
     * desktop window. Deliberately worded as a warning rather than a refusal: the
     * player is let through either way.
     */
    tooSmallTitle: string;
    tooSmallBody: string;
    /** Dismisses the warning above, and is remembered for next time. */
    playAnyway: string;
  };
}
