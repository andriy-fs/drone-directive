import { create } from 'zustand';
import { radioConfig } from '../config/radio';
import { loadDict } from '../i18n/dictionaries';
import { saveLocale, type Locale } from '../i18n/locale';
import { Owner } from '@drone-directive/types/enums';
import { OnlineLink, OnlineRequest, OnlineStatus } from './enums';
import { initialState } from './initialState';
import type { GameState } from './types';

/**
 * The one store: the actions that move it, over the starting values in
 * `./initialState`. What the state *is* lives next door too — `./types` for the
 * shapes, `./enums` for the enum-like values — because half the HUD reads the
 * contract while nobody but this file cares how it is driven.
 *
 * The engine lives outside React entirely; the app bridge (GameApp) pushes
 * throttled snapshots in and reads flags and commands back out.
 */
/** Last language the player asked for — guards `setLocale` against out-of-order loads. */
let requestedLocale: Locale = initialState.locale;

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,
  setStatus: (status) => set({ status }),
  setOutcomePhase: (outcomePhase) => set({ outcomePhase }),
  setBases: (bases) => set({ bases }),
  setRobots: (robots) => set({ robots }),
  setSides: (sides) => set({ sides }),
  setResources: (resources) => set({ resources }),
  // Robots and a base are mutually exclusive selections, and that is enforced
  // here rather than at the call sites: marquee, robot click, select-all and
  // control groups all write selection, and every one of them gets it for free.
  selectRobots: (ids) => set({ selectedRobotIds: ids, selectedBaseId: null }),
  toggleRobot: (id) =>
    set((s) => ({
      selectedRobotIds: s.selectedRobotIds.includes(id)
        ? s.selectedRobotIds.filter((x) => x !== id)
        : [...s.selectedRobotIds, id],
      selectedBaseId: null,
    })),
  selectBase: (id) => set({ selectedBaseId: id, selectedRobotIds: [] }),
  clearSelection: () => set({ selectedRobotIds: [], selectedBaseId: null }),
  enqueueCommand: (command) => set((s) => ({ commands: [...s.commands, command] })),
  drainCommands: () => {
    const { commands } = get();
    if (commands.length > 0) set({ commands: [] });
    return commands;
  },
  updateSettings: (patch) =>
    set((s) => ({
      settings: {
        match: { ...s.settings.match, ...patch.match },
        base: { ...s.settings.base, ...patch.base },
      },
    })),
  requestRestart: () => set({ restartRequested: true }),
  requestMenu: () => set({ menuRequested: true }),
  clearRequests: () => set({ restartRequested: false, menuRequested: false }),
  togglePause: () =>
    set((s) =>
      // Online the pause is a shared thing scheduled a few ticks ahead, so this
      // only raises the request; `paused` is set by the bridge when the two
      // simulations actually stop, which is the only moment they agree on.
      s.online.status === OnlineStatus.InMatch ? { pauseTogglePending: true } : { paused: !s.paused },
    ),
  setPaused: (value) => set({ paused: value }),
  consumePauseToggle: () => {
    const { pauseTogglePending } = get();
    if (pauseTogglePending) set({ pauseTogglePending: false });
    return pauseTogglePending;
  },
  setDroneInput: (dir) => set({ droneInput: dir }),
  requestDronePossess: () => set({ dronePossessRequested: true }),
  requestDroneFire: () => set({ droneFireRequested: true }),
  clearDroneRequests: () => set({ dronePossessRequested: false, droneFireRequested: false }),
  setDroneStatus: (status) => set({ droneStatus: status }),
  setViewSync: (on) =>
    set((s) => ({
      viewSyncedToDrone: on,
      // Looking at the drone again is what the notice was asking for.
      droneReadyNotice: on ? 0 : s.droneReadyNotice,
      // Cutting the view loose stops forwarding flight input, so a possessed
      // robot would sit there with its target cleared every tick and nobody
      // steering it. Bail out of the hull on the way out (one pulse = release).
      dronePossessRequested:
        !on && s.droneStatus.possessedRobotId !== null ? true : s.dronePossessRequested,
    })),
  clearDroneReadyNotice: () => set({ droneReadyNotice: 0 }),
  noteDroneReady: () => set((s) => ({ droneReadyNotice: s.droneReadyNotice + 1 })),
  setBuildDialogOpen: (open) => set({ buildDialogOpen: open }),
  // Dictionaries are code-split, so switching language is "load, then switch":
  // the store never holds a locale whose dictionary is missing (see i18n/dictionaries.ts).
  setLocale: (locale) => {
    requestedLocale = locale;
    void loadDict(locale)
      .then(() => {
        if (requestedLocale !== locale) return; // a newer pick already won
        saveLocale(locale); // only persist a language the player actually got
        set({ locale });
      })
      .catch((error: unknown) => console.error('[i18n] failed to load locale', locale, error));
  },
  hostMatch: (mapSize, aiOpponents) =>
    set({
      localSide: Owner.Player,
      pendingOnline: { kind: OnlineRequest.Host, mapSize, aiOpponents },
      online: { status: OnlineStatus.Connecting, roomCode: null },
    }),
  joinMatch: (roomCode) => {
    const code = roomCode.toUpperCase();
    set({
      localSide: Owner.AI,
      pendingOnline: { kind: OnlineRequest.Join, roomCode: code },
      online: { status: OnlineStatus.Connecting, roomCode: code },
    });
  },
  leaveOnline: () =>
    set({
      localSide: Owner.Player,
      pendingOnline: { kind: OnlineRequest.Leave },
      online: { status: OnlineStatus.Offline },
    }),
  consumePendingOnline: () => {
    const { pendingOnline } = get();
    if (pendingOnline) set({ pendingOnline: null });
    return pendingOnline;
  },
  setOnlineHosting: (roomCode) => set({ online: { status: OnlineStatus.Hosting, roomCode } }),
  setOnlineInMatch: () => set({ online: { status: OnlineStatus.InMatch, link: OnlineLink.Ok } }),
  // A no-op off the match, and a no-op when nothing changed: the stall watchdog
  // calls this every tick it runs, and a fresh object each time would wake every
  // subscriber to `online` for no news.
  setOnlineLink: (link) =>
    set((s) => (s.online.status !== OnlineStatus.InMatch || s.online.link === link ? {} : { online: { status: OnlineStatus.InMatch, link } })),
  setOnlineFinished: (error, isError) => set({ online: { status: isError ? OnlineStatus.Error : OnlineStatus.Ended, error } }),
  setOnlineOffline: () => set({ online: { status: OnlineStatus.Offline } }),
  setChat: (patch) => set((s) => ({ chat: { ...s.chat, ...patch } })),
  mergeChatHistory: (entries) =>
    set((s) => {
      if (entries.length === 0) return {};
      // A reconnect asks for the gap, but a message can cross the request in
      // flight, so a replay may repeat something already on screen. `seq` is the
      // server's identity for a message, which makes the merge exact.
      const bySeq = new Map(s.chat.messages.map((m) => [m.seq, m]));
      for (const entry of entries) bySeq.set(entry.seq, entry);
      const messages = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      return { chat: { ...s.chat, messages } };
    }),
  appendChatMessage: (entry) =>
    set((s) => {
      if (s.chat.messages.some((m) => m.seq === entry.seq)) return {};
      const fromPeer = entry.from !== s.chat.seat;
      return {
        chat: {
          ...s.chat,
          messages: [...s.chat.messages, entry],
          unread: fromPeer && !s.chat.open ? s.chat.unread + 1 : s.chat.unread,
        },
      };
    }),
  markChatRead: () => set((s) => (s.chat.unread === 0 ? {} : { chat: { ...s.chat, unread: 0 } })),
  // Trimmed here rather than in the feed so the array can never grow past what is
  // drawn: the director keeps talking whether or not anyone is looking at it.
  pushRadioLine: (line) => set((s) => ({ radio: [...s.radio, line].slice(-radioConfig.maxLines) })),
  // Called once a second by the feed. Returning `{}` when nothing aged out matters
  // here more than anywhere else in this file — a fresh array every second would
  // re-render the log (and restart its typewriter) for no news at all.
  pruneRadio: (now) =>
    set((s) => {
      const kept = s.radio.filter((l) => now - l.at < radioConfig.lineTtlMs);
      return kept.length === s.radio.length ? {} : { radio: kept };
    }),
  clearRadio: () => set((s) => (s.radio.length === 0 ? {} : { radio: [] })),
}));

/** Non-reactive handle for the app bridge (outside React). */
export const gameStore = useGameStore;
