/** UI dictionary shape — every locale (including this canonical English one) must satisfy it. */
export interface Dict {
  mainMenu: {
    title: string;
    intro: string;
    difficulty: string;
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
    groupAssign: string;
    groupSelect: string;
    droneHeading: string;
    flyDrone: string;
    landRelease: string;
    fireWeapon: string;
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
    piloting: string;
    observing: string;
    autoBuildPaused: string;
    hint: string;
    paused: string;
    ownerPlayer: string;
    ownerAi: string;
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
    ai: string;
    building: string;
    queued: string;
    auto: string;
    stop: string;
    buildProgram: string;
  };
  programming: {
    selectUnits: string;
    enemyUnit: string;
    robotsSelected: string;
    directive: string;
    weapon: string;
    health: string;
  };
  programs: {
    idle: string;
    guard: string;
    attackBase: string;
    attackRobots: string;
    scout: string;
    attackTarget: string;
    none: string;
  };
  chassis: {
    tracks: string;
    wheels: string;
    legs: string;
    statsHp: string;
    statsSpeed: string;
    statsSight: string;
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
  };
  aria: {
    resume: string;
    pause: string;
    unmute: string;
    mute: string;
  };
}

/** Canonical (English) UI dictionary. */
export const en: Dict = {
  mainMenu: {
    title: 'Drone Directive',
    intro: 'Build robots, program their orders, and destroy the enemy base before it destroys yours.',
    difficulty: 'Difficulty',
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
    dblClick: 'Select all robots with this weapon',
    groupAssign: 'Save the current selection as a group',
    groupSelect: 'Select a saved group',
    droneHeading: 'Observer drone',
    flyDrone: 'Fly the drone',
    landRelease: 'Land on / release an idle robot',
    fireWeapon: "Fire the possessed robot's weapon",
  },
  difficulty: {
    easy: 'Easy',
    easyHint: 'You start with one extra robot',
    normal: 'Normal',
    normalHint: 'Even start',
    hard: 'Hard',
    hardHint: 'The AI starts with one extra robot',
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
    piloting: 'Piloting a robot',
    observing: 'Observing',
    autoBuildPaused: 'auto-build paused (drone away)',
    hint: 'Drag to box-select · click a robot to select · Shift+click/drag to add · Ctrl+A all · right-click to move · WASD/arrows fly the drone · F land/take off · E fire/detonate · Esc/Space to pause.',
    paused: 'Paused',
    ownerPlayer: 'player',
    ownerAi: 'ai',
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
    ai: 'AI',
    building: 'Building',
    queued: 'queued',
    auto: 'Auto',
    stop: 'Stop',
    buildProgram: 'Build & Program',
  },
  programming: {
    selectUnits: 'Select unit(s) to program.',
    enemyUnit: 'Enemy unit — cannot program.',
    robotsSelected: 'robots selected',
    directive: 'Directive',
    weapon: 'Weapon',
    health: 'Health',
  },
  programs: {
    idle: 'Idle',
    guard: 'Guard',
    attackBase: 'Attack Base',
    attackRobots: 'Attack Robots',
    scout: 'Search & Detect',
    attackTarget: 'Attack Target',
    none: 'None',
  },
  chassis: {
    tracks: 'Tracks',
    wheels: 'Wheels',
    legs: 'Legs',
    statsHp: 'HP',
    statsSpeed: 'Speed',
    statsSight: 'Sight',
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
  },
  aria: {
    resume: 'Resume',
    pause: 'Pause',
    unmute: 'Unmute',
    mute: 'Mute',
  },
};
