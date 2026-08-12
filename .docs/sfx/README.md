# Sound effects

Every cue in the game is a file from the sound library in
`client/public/sounds/`, played through `@pixi/sound`. The table that binds an
alias to a file and to its place in the mix is `client/src/config/sounds.ts`;
the player is `client/src/pixi/audio/sfx.ts`.

Keep this document in sync when a cue is added or a file is replaced — it is the
**specification of what each sound is supposed to be**, and it is the only thing
that survives a file being swapped for a better one.

## Where the files came from

Three [Kenney](https://kenney.nl/assets) packs — `digital`, `interface`,
`sci-fi` — all **CC0**, so no attribution file is required. All 235 files sit in
`client/public/sounds/` exactly as downloaded, and `config/sounds.ts` points
straight at the thirteen it uses. There is no copy step and no curated output
directory: a cue is a *reference* into the library.

Two consequences worth holding on to:

- **`public/sounds/` is load-bearing.** Renaming, reorganising or pruning
  anything in it silently kills whichever cue points at it. Adding a cue is one
  row in the table; changing one is one path.
- **The whole library ships.** `client/public/` is copied into `dist/` wholesale,
  so all 7.6 MB of it goes to GitHub Pages on a site that would otherwise be
  ~6.3 MB. That is a deliberate trade for keeping the source material at hand
  and never duplicating a file.

**Format is `.ogg`, straight from the pack — no conversion step anywhere.** Ogg
Vorbis is gapless, so unlike MP3 and AAC it carries no encoder priming delay
that would smear a percussive attack. Safari's Ogg support in `decodeAudioData`
is unreliable, which is the one thing this costs; **Safari is explicitly not a
target**. Nothing re-encodes, so nothing degrades.

The Kenney sources already satisfy what a hand-cut cue would have needed: peaks
at −0.5…−1.5 dBFS and no leading silence, so the transient is on sample 0.

## The cues

Paths are relative to `client/public/sounds/`.

| Alias | File | Length | What it is |
| --- | --- | --- | --- |
| `select-base` | `sci-fi/doorOpen_001` | 0.53 s | The factory acknowledging an order. A press coming down, the plate ringing, a conveyor spooling up behind it — a plant answering, not a UI beep. |
| `select-tracks` | `sci-fi/impactMetal_003` | 0.78 s | Heavy and low: a diesel growl under link clanks, on a bed of gravel. |
| `select-wheels` | `digital/phaserUp5` | 0.31 s | An electric drive spinning up — a smooth glide with no impact anywhere in it. |
| `select-legs` | `interface/switch_003` | 0.50 s | Two discrete servo steps. The **rhythm** is the identity here, not the pitch — it is the cue that survives being buried under gunfire. |
| `select-group` | `digital/lowThreeTone` | 1.02 s | The column rolling out: three low tones, so it reads as *several* machines rather than one. Played at `speed 0.85` for eight robots or more, which drops the pitch and stretches it further. |
| `unit-ready` | `interface/confirmation_001` | 0.29 s | A robot rolled off the line. Fires unattended all match, so it must be a pip the player stops consciously hearing. Must not be confusable with `chat-message`. |
| `shot-cannon` | `sci-fi/laserSmall_000` | 0.24 s | Short: robots fire constantly. |
| `shot-missile` | `sci-fi/laserLarge_000` | 0.68 s | Heavier and longer than the cannon. |
| `shot-dew` | `digital/phaserUp3` | 0.52 s | The directed-energy weapon. A rising electrical whine rather than a report — a knock-out shot must be audibly *not* a kill, even off-screen. |
| `shot-fpv` | `digital/spaceTrash2` | 1.47 s | An FPV carrier releasing its salvo. Deliberately outside the laser/phaser family the three guns above share: this is not a shot, it is five machines taking off, so it is a clattering rattle of small motors. The longest weapon cue by far, which its nine-second reload affords — no launcher can overlap itself. |
| `shield-up` | `sci-fi/forceField_000` | 0.95 s | The base's one-shot energy dome coming up. A generator catching and a field settling — the longest cue in the game after the group order, because it is announcing twenty seconds of changed rules. Fires at most once per base per match. |
| `shield-break` | `sci-fi/lowFrequency_explosion_001` | 1.00 s | That dome beaten to zero. Deliberately **not** a force field and deliberately not `explosion`: it must be unmistakable both from the dome simply timing out and from any unit dying. Deep and collapsing — the loudest of the three, because it is the one that means someone lost something. |
| `shield-down` | `sci-fi/forceField_002` | 0.96 s | The dome powering down on schedule. Same family as `shield-up` on purpose (the field letting go rather than failing), and the quietest of the three: nothing broke, the clock simply ran out. **The pair that must never be confused is this one and `shield-break`** — the player has to know by ear whether they were beaten or ran out. |
| `explosion` | `sci-fi/explosionCrunch_000` | 0.78 s | The shortest of the pack's five explosions on purpose — a reap sends them in bursts. |
| `chat-message` | `interface/glass_001` | 0.28 s | An arriving message. Roughly a fifth of the volume of anything the game itself makes: noticeable while the player watches the battle, forgettable while they do not. |
| `chat-send` | `interface/pluck_001` | 0.10 s | Our own message going out — the other half of the pair, and it must not be mistaken for the arriving one. |
| `button-click` | `interface/click_001` | 0.10 s | Any button in the HUD or the menus, and the only cue the interface makes. |

A dialog opening is **deliberately silent**. There used to be a `modal-open` cue
(`interface/open_002`) on the false→true edge in `ui/common/Dialog`, but a modal
is always the consequence of a button the player just pressed, and `Button` has
already clicked for it — two cues on one action read as a stutter rather than as
feedback. Do not add it back without also removing the click.

Two files sit outside the −1 dBFS norm and are compensated in the `volume`
column of `config/sounds.ts` rather than by re-normalizing the file:
`shot-cannon` peaks 4.8 dB low (hence 0.38 instead of 0.22) and `chat-send`
peaks at full scale.

`select-group` is the longest cue at 1.02 s, and 1.2 s once the big-group
`speed 0.85` is applied. That is long for something a marquee drag fires; if it
starts to drag, the shorter sibling `digital/threeTone2` (0.87 s) keeps the
three-event character, and `digital/spaceTrash3` (1.54 s) is the most literally
chaotic option in the packs if length stops mattering.

## The music

One track, and only on the title screen: `client/public/music/terminal-standby.ogg`
(2:53, Ogg Vorbis ~256 kb/s, 4.2 MB). It is **not** in `public/sounds/` and not a
`SoundName` — that directory is the Kenney packs as downloaded, and everything in
the table above is a one-shot the player never gets a handle on.

| | Cue | Music |
| --- | --- | --- |
| Table | `soundDefs` in `config/sounds.ts` | `menuMusic` in the same file |
| Player | `pixi/audio/sfx.ts` | `pixi/audio/music.ts` |
| Fetch | by `SoundTier`, with the rest of its wave | its own lazy `Assets.load`, at idle |
| Lifetime | fire and forget | one looping instance, held and faded |
| Driven by | the EventBus, `selectionAudio`, `ui/common/` | `MainMenu`'s mount/unmount |

Three things about it are load-bearing:

- **It starts on the first gesture, not on Start.** Autoplay policy keeps the
  AudioContext suspended, and the first thing a player touches is usually a
  difficulty chip — so `music.ts` arms a one-shot `pointerdown`/`keydown`
  listener and retries there. Hanging it off `sfx.resume()` in Start would mean
  the music only ever began as the menu was leaving.
- **Mute and master volume are not re-implemented for it.** `sound.muteAll()`
  and `sound.volumeAll` act on the shared `WebAudioContext`; the music instance
  is downstream of it, so the existing Sound settings already govern it. The
  consequence worth knowing: the settings dialog labels that switch *Effects*,
  and it now silences the music too.
- **`menuMusic.volume` (0.25) is the only mix number.** The track masters at
  −12.9 LUFS with peaks at 0 dBFS, where the cues are transients peaking at −1 —
  at 1.0 it buries all of them. 0.25 puts the bed near −27 LUFS, under a
  `button-click` at 0.15. Swap the file → re-measure
  (`ffmpeg -i file -af ebur128 -f null -`) and reset this.

The brief it was generated from — the prompt, the negative prompt, why each
constraint is there, and what to re-measure after regenerating — is
[`music-prompt.md`](music-prompt.md). Same role as the cue descriptions above:
it is what the track is *supposed* to be, and it outlives the file.

The track is a linear piece rather than a composed loop, so `loop: true` repeats
it over an audible seam. A 1.2 s fade-in and a 0.6 s fade-out cover the entry and
the exit; nothing covers the wrap, and at 2:53 few players will still be on the
menu to hear it.

Its 4.2 MB is roughly a third of what the deployed site weighs, and it buys
nothing over the 192 kb/s MP3 it was transcoded from — re-encoding at `-q:a 3`
(~112 kb/s, ~2.4 MB) is transparent for a bed at this level if that ever matters.

## Rules for a replacement file

If you swap a cue, the replacement must hold to these — they are what separate a
sound from an indistinct click, and the first synthesized version of these cues
broke all of them:

- **No leading silence.** The transient belongs on sample 0, within ±1 ms.
  There is no scheduling delay in `PlayOptions`, so any pre-roll becomes latency
  the game cannot compensate for.
- **A 2 ms fade-in, baked in.** A waveform that jumps from zero to full
  amplitude in one sample is a broadband click, and it masks whatever follows.
- **A ≥5 ms fade to true zero**, ending on a zero crossing, no DC offset:
  `AudioBufferSourceNode` has no release of its own.
- **≥120 ms** for anything carrying pitch. Shorter reads as a click regardless
  of content, and pitch needs several cycles of the waveform to register — at
  70 Hz that is 70 ms before it is a note at all.
- **Peak-normalize to about −1 dBFS** and set the balance in `config/sounds.ts`.
  Balancing by re-normalizing files means every later mix tweak needs a re-export.
- 44.1 kHz. Mono is preferred — there is no panning in the game — but four of the
  current cues are stereo straight from the pack, and re-encoding them to mono
  would cost more quality than the bytes are worth.

## Known limitations of the current set

- **The palette is synthesized sci-fi/UI, not industrial documentary.** The
  Kenney packs contain no real track clank and no factory floor; `impactMetal`
  and `doorOpen` are the closest approximations. For a game about drones and
  robots this reads as coherent, but the original brief — "the sound a plant
  producing robots would make" — is met by approximation. Real field recordings
  (e.g. the Sonniss GDC bundle) would be the upgrade path.
- **There is no shared room.** The cues come from three different packs, so the
  "one impulse response across every file" rule cannot be met, and the
  synthesized version's convolution reverb is gone. The set is dry on purpose:
  ten tails from ten different rooms would sound worse than none.
- The cues run long for things fired by a click: `select-tracks` and `explosion`
  at 0.78 s, `select-group` at 1.02 s. Trimming means re-encoding, which an
  `.ogg`-only pipeline cannot do losslessly — so prefer swapping in a shorter
  file from the packs over cutting one down.

## What the synthesized version sounded like

Kept as a design record: before the migration these cues were built from
oscillators, and the recipes are the most precise statement of intent that
exists. Any future re-recording can aim at them.

- **base** — a sine dropping 150 → 52 Hz over 0.22 s (the press), an inharmonic
  metal hit at 390 Hz (the plate), then a sawtooth at 96 Hz through a lowpass
  sweeping 260 → 1500 Hz at Q 6 (the conveyor; the *resonant sweep* is what reads
  as "machine starting" rather than "rising tone"), and a bandpass noise burst
  2100 → 900 Hz for the air release.
- **tracks** — sawtooth 58 Hz through a lowpass 240 → 130 Hz at Q 3, a second saw
  at 87 Hz, two inharmonic metal hits at 310 and 280 Hz spaced 110 ms apart, and
  bandpass noise at 850 Hz for gravel.
- **wheels** — triangle gliding 210 → 540 Hz behind a lowpass 900 → 2400 Hz at
  Q 3, a quiet sawtooth an octave up for shimmer, and rising bandpass noise
  1100 → 2200 Hz. No impacts at all.
- **legs** — two steps 150 ms apart: triangle 300 → 150 Hz then 390 → 190 Hz,
  each behind a lowpass collapsing 1400 → 400 Hz at Q 4, each with a 70 ms
  bandpass noise tick at 2600 Hz (foot contact), over a steady 165 → 195 Hz servo
  whir.
- **group** — sawtooth 95 → 58 Hz under a lowpass 220 → 110 Hz plus bandpass
  noise 420 → 240 Hz, longer for eight robots or more, then one *half-volume*
  chassis voice per distinct chassis staggered 70 ms apart.
- **unit-ready** — a 40 ms bandpass noise tick at 3200 Hz (the clamp letting go)
  and a small inharmonic bell at 1046 Hz. The inharmonic partials are what kept
  it from being mistaken for the chat cue's pure sines.
- **chat-message** — two soft rising sines, G5 (784 Hz) then C6 (1046.5 Hz) 70 ms
  later, both with a 12 ms attack.
- **cannon** — square 760 → 420 Hz over 70 ms behind a 2800 Hz lowpass.
  **missile** — sawtooth 320 → 90 Hz over 180 ms plus a lowpassed noise whoosh.
  **explosion** — a 300 ms lowpassed noise burst.
