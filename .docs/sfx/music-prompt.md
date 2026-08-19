# The menu music: generation brief

The brief `client/public/music/terminal-standby.ogg` was generated from, kept for
the same reason the cue descriptions in [`README.md`](README.md) are kept: it is
the **specification of what the track is supposed to be**, and it is the only
thing that survives the file being replaced by a better one.

Written for a text-to-music model (Suno / Udio / MusicGen and friends). Where the
target and the file disagree, the target wins — regenerate rather than talk
yourself into what came out.

Its siblings are [`main-soundtrack-prompt.md`](main-soundtrack-prompt.md) (the
match bed) and [`outcome-stingers-prompt.md`](outcome-stingers-prompt.md) (the
victory/defeat one-shots, which borrow this track's 4-note motif and resolve or
break it). Keep the four in the same idiom.

## The prompt

```
Ambient sci-fi military strategy theme for the main menu of a top-down RTS
about autonomous combat drones. Slow, patient, unresolved — the calm of a
hangar before deployment, not a battle.

Instrumentation: deep sustained synth pads with slow filter movement, a low
analog drone in the sub-bass, sparse metallic percussion (distant hammer taps,
muted industrial clanks) low in the mix, occasional soft radar-ping bell and
faint modem/telemetry blips as texture. One simple 4-note motif on a cold
pluck synth, repeated with slight variation — memorable but never demanding
attention.

Mood: cold, mechanical, tense but controlled. Restrained anticipation.
Tempo 72 BPM, minor key (A minor / D minor), no chord progression drama —
two chords at most, held long.

Production: wide stereo pads, dry center, tape-hiss and light vinyl noise
floor, plenty of headroom, no loud transients. Fully instrumental, no vocals,
no melody in the 2–5 kHz range. Seamless loop, 2–3 minutes.
```

Short form, for tools with a character limit:

```
dark ambient sci-fi RTS menu theme, 72 BPM, A minor, deep synth pads, sub
drone, sparse industrial metal percussion, cold pluck 4-note motif, radar
pings, hangar-before-deployment tension, instrumental, seamless loop
```

Negative prompt:

```
vocals, choir, epic orchestral brass, war drums, trailer hits, dubstep drops,
distorted guitars, fast arpeggios, bright lead melody, sudden dynamics,
applause, silence at start or end
```

## Why the constraints are the constraints

Most of the prompt above is not taste. Each line is there because of something
the menu actually does:

- **No melody in 2–5 kHz.** That band is where the Kenney interface pips live —
  `button-click`, `chat-message`, `unit-ready`. A lead sitting in it fights every
  cue the player needs to hear while they are clicking through the menu.
- **No loud transients, plenty of headroom.** The cues are transients peaking at
  −1 dBFS and the music is a continuous bed under them. A track that is itself
  percussive leaves nothing for them to cut through.
- **Instrumental.** Four languages ship (en/ru/uk/pl); a vocal is in one of them
  and wrong in the other three.
- **Two chords, held long, no drama.** The menu is not a scene with an arc — the
  player sits in it for fifteen seconds or for five minutes, and the track has
  no idea which. Anything that builds is wrong for one of those two.
- **Seamless loop.** `music.ts` sets `loop: true`. The fades cover entry and
  exit; nothing covers the wrap.

## Delivery requirements

These are what the shipped file has to satisfy, whatever generated it:

- **2–3 minutes, looping.** Long enough not to feel like a jingle, short enough
  that the model holds its idea together.
- **No attack on sample 0 and no tail at the end** — either one makes the loop
  seam audible.
- **Ogg Vorbis**, 44.1 kHz stereo, into `client/public/music/`. The whole audio
  pipeline is `.ogg` with no conversion step; Vorbis is gapless, so unlike MP3 it
  carries no encoder priming delay to smear the wrap.
- **Do not master it loud.** The mix balance is set in code, not in the file.

## After regenerating

Three steps, in order:

1. Encode: drop the master into `client/assets-src/`, add a row to
   `client/scripts/encode-music.mjs` and run it. (`-q:a 3` ≈ 112 kb/s,
   transparent for a bed at this level. The file that shipped before this brief
   arrived finished at 205 kb/s / 4.2 MB; re-encoding it through that row took it
   to 1.9 MB with no measurable change in loudness. A replacement should be
   encoded from its own master instead, so it is not a second-generation lossy
   file.)
2. Measure — the script prints the integrated loudness — and reset
   `musicDefs.menu.volume` in `client/src/config/sounds.ts` so the bed lands near
   **−27 LUFS** at the music slider's default 0.6. The current track is −12.9 LUFS
   integrated, hence 0.42.
3. Point `musicDefs.menu.src` at the new file and delete the old one — nothing
   else references it.

## Alternatives, if this direction stops working

| Direction | Prompt core |
| --- | --- |
| Warm retro briefing | `80s military simulation soundtrack, warm analog synth, slow sequenced bassline 90 BPM, CRT hum, mission-briefing calm` |
| Almost silence | `minimal generative ambient, single evolving drone, no percussion, occasional distant metal resonance, 3 minutes` |
| A hint of threat | `dark synth ostinato, 8-note repeating bass sequence, muted taiko in the distance, slowly rising tension that never resolves` |

The first makes the menu sound comfortable-technical; the third makes pressing
Start feel like sending someone to die. The current track is deliberately between
them.
