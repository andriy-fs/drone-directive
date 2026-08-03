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

/** Canonical (English) UI dictionary. */
export const en: Dict = {
  mainMenu: {
    title: 'Drone Directive',
    intro: 'Build robots, program their orders, and be the last base standing.',
    difficulty: 'Difficulty',
    opponents: 'Opponents',
    opponentsHint: 'Every side fights every other',
    baseSetup: 'Base setup',
    autoProduceProgram: 'Auto-produce & program',
    help: 'Help',
    controls: 'Controls',
    start: 'Start',
    language: 'Language',
    controlsTitle: 'Controls',
    close: 'Close',
    ctrlA: 'Select all robots',
    esc: 'Pause game',
    dblClick: 'On a robot — select all with this weapon',
    dblClickBase: 'On your base — open Build & Program',
    selectBase: 'Select your base',
    setRally: 'With your base selected — set the rally point',
    clearRally: 'On your selected base — clear the rally point',
    groupAssign: 'Save the current selection as a group',
    groupSelect: 'Select a saved group',
    droneHeading: 'Observer drone',
    flyDrone: 'Fly the drone',
    landRelease: 'Land on / release an idle robot',
    fireWeapon: "Fire the possessed robot's weapon",
    units: 'Units',
    unitGuide: 'Unit Guide',
  },
  difficulty: {
    easy: 'Easy',
    easyHint: 'You start with one extra robot',
    normal: 'Normal',
    normalHint: 'Even start',
    hard: 'Hard',
    hardHint: 'Each AI starts with one extra robot',
  },
  mapSize: {
    label: 'Map size',
    small: 'Small',
    smallHint: '40×40 — fastest matches',
    medium: 'Medium',
    mediumHint: '60×60 — balanced (default)',
    large: 'Large',
    largeHint: '80×80 — longest, most tactical',
  },
  hud: {
    title: 'Drone Directive',
    statusPrefix: 'Status',
    command: 'Command',
    bases: 'Bases',
    units: 'Units',
    directive: 'Directive',
    drone: 'Drone',
    player: 'Player',
    ai: 'AI',
    ai1: 'AI 1',
    ai2: 'AI 2',
    ai3: 'AI 3',
    opponent: 'Opponent',
    piloting: 'Piloting a robot',
    observing: 'Observing',
    hint: 'Drag to box-select · click a robot to select · Shift+click/drag to add · Ctrl+A all · right-click to move · WASD/arrows fly the drone · F land/take off · E fire/detonate · Esc/Space to pause.',
    paused: 'Paused',
    ownerNeutral: 'neutral',
    statusMenu: 'menu',
    statusPlaying: 'playing',
    statusWon: 'won',
    statusLost: 'lost',
  },
  gameOver: {
    victory: 'Victory',
    defeat: 'Defeat',
    victoryBody: 'All enemy bases destroyed.',
    defeatBody: 'All your bases were destroyed.',
    mainMenu: 'Main Menu',
    playAgain: 'Play Again',
  },
  baseSetup: {
    title: 'Base Setup',
    autoProduce: 'Auto-produce robots',
    off: 'Off',
    on: 'On',
    chassis: 'Chassis',
    weapon: 'Weapon',
    newRobotProgram: 'New robot program',
    done: 'Done',
  },
  buildRobot: {
    title: 'Build & Program',
    chassis: 'Chassis',
    weapon: 'Weapon',
    program: 'Program',
    cost: 'Cost',
    available: 'Available',
    cancel: 'Cancel',
    setAutoBuild: 'Set Auto-Build',
    buildOnce: 'Build Once',
  },
  statusPanel: {
    resources: 'Resources',
    building: 'Building',
    queued: 'queued',
    idle: 'Nothing in queue',
    auto: 'Auto',
    stop: 'Stop',
    buildProgram: 'Build & Program',
    drone: 'Observer drone',
    droneDown: 'Drone lost · rebuilding',
  },
  programming: {
    selectUnits: 'Select unit(s) to program.',
    enemyUnit: 'Enemy unit — cannot program.',
    robotsSelected: 'robots selected',
    weapon: 'Weapon',
    health: 'Health',
    baseSelected: 'Base',
    baseProgram: 'New units',
    rallyPoint: 'Rally point',
    rallyNone: 'Not set',
    rallyHint: 'Right-click the map to set where new Idle and Guard units gather; right-click the base to clear it.',
  },
  programs: {
    idle: 'Idle',
    guard: 'Guard',
    attackBase: 'Attack Base',
    attackRobots: 'Attack Robots',
    scout: 'Search & Detect',
    attackTarget: 'Attack Target',
    overwatch: 'Overwatch',
    none: 'None',
  },
  chassis: {
    tracks: 'Tracks',
    wheels: 'Wheels',
    legs: 'Legs',
    statsHp: 'HP',
    statsSpeed: 'Speed',
    statsSight: 'Sight',
    tracksNote: 'Tough and steady — good for holding ground and soaking damage',
    wheelsNote: 'Fast but fragile — ideal for scouting and quick strikes',
    legsNote: 'Slow but the toughest chassis — built for prolonged fights',
  },
  weapons: {
    none: 'None',
    cannon: 'Cannon',
    missiles: 'Missiles',
    bomb: 'Bomb',
    radar: 'Radar',
    ew: 'EW',
    statsRange: 'Range',
    statsDamage: 'Damage',
    radarNote: 'No weapon — doubles sight radius',
    ewNote: 'No weapon — jams enemy sight within',
    bombNote: 'Self-destructs on impact, blast radius',
    cannonNote: 'Balanced rate of fire and range — a reliable all-rounder',
    missilesNote:
      'Longer range and heavier damage, at the cost of a slower reload. The only weapon that can shoot down an enemy observer drone',
  },
  aria: {
    resume: 'Resume',
    pause: 'Pause',
    unmute: 'Unmute',
    mute: 'Mute',
  },
  online: {
    multiplayer: 'Multiplayer',
    online2p: 'Online (2P)',
    title: 'Online 2-player',
    connecting: 'Connecting…',
    shareCode: 'Share this room code with your opponent:',
    copyCode: 'Copy room code',
    codeCopied: 'Copied!',
    waitingOpponent: 'Waiting for an opponent to join…',
    matchEnded: 'The match ended.',
    hostGame: 'Host a game',
    createRoom: 'Create room',
    joinGame: 'Join a game',
    roomCodePlaceholder: 'ROOM CODE',
    joinRoom: 'Join room',
    cancel: 'Cancel',
  },
  chat: {
    title: 'Chat',
    open: 'Chat with opponent',
    close: 'Minimise chat',
    leave: 'Leave this chat',
    placeholder: 'Message…',
    send: 'Send',
    you: 'You',
    opponent: 'Opponent',
    peerOnline: 'Opponent is here',
    peerAway: 'Opponent is away',
    connecting: 'Reconnecting…',
    empty: 'No messages yet.',
    muteSound: 'Mute new-message sound',
    unmuteSound: 'Unmute new-message sound',
  },
  unitsGuide: {
    title: 'Unit Guide',
    intro: 'Robots are assembled from a chassis (mobility) and a weapon (firepower).',
    chassisHeading: 'Chassis',
    weaponsHeading: 'Weapons',
  },
};
