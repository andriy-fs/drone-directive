# The outcome stingers: generation brief

The briefs `client/public/music/victory-sting.ogg` and `defeat-sting.ogg` were
generated from — kept for the same reason as the two bed briefs beside them
([`music-prompt.md`](music-prompt.md), [`main-soundtrack-prompt.md`](main-soundtrack-prompt.md))
and the cue descriptions in [`README.md`](README.md): they are the
**specification of what the tracks are supposed to be**, and they are the only
thing that survives a file being replaced by a better one.

Written for a text-to-music model (Suno / Udio / MusicGen and friends). Where the
target and the file disagree, the target wins — regenerate rather than talk
yourself into what came out.

## What these are, and how they differ from the beds

Two **one-shot** tracks, 12–18 s, one per match outcome, played behind the
game-over modal (whose art is briefed in `.docs/sprites/game-over.md`). They are
music, not cues — they ride the music switch and the music slider and live in
`musicDefs` — but unlike `menu` and `match` they do not loop, are not held for
the life of a screen, and end themselves.

They share the beds' instrumentation, tempo and key on purpose, with **one
deliberate inversion**: the beds are forbidden an arc, because a bed has no idea
whether the scene lasts fifteen seconds or twenty minutes. A stinger is nothing
*but* an arc. It knows exactly how long it lasts and exactly what just happened.

The victory motif is the menu theme's cold 4-note pluck finally resolving; the
defeat one is the same figure coming apart. That is what makes them sound like
this game rather than like two stock stings.

## The prompts

### Victory

```
Short one-shot victory cue for a top-down RTS about autonomous combat drones —
the moment the last enemy machine stops. Not a fanfare and not a celebration:
a cold system confirming that the task is complete.

Structure, 15 seconds total: a low sub-bass swell and a single deep metallic
strike on beat 1; a cold pluck synth states a simple 4-note motif and, for the
first time, resolves it upward onto the tonic; wide sustained synth pads open
underneath and hold; a slow decay into a soft radar-ping bell and tape hiss.
Ends in near-silence with a long pad tail.

Instrumentation: deep sustained synth pads, analog sub-bass drone, one cold
pluck synth carrying the motif, sparse industrial metal percussion (a single
hammer strike, distant machinery settling), soft telemetry blips as texture.

Mood: cold relief. Mechanical satisfaction, restrained, slightly melancholy —
the machines won and nothing about them is happy about it. 72 BPM, A minor
resolving to its relative major only at the very end.

Production: wide stereo pads, dry centre, tape hiss and a light noise floor,
generous headroom, one transient at the top and nothing loud after it. Fully
instrumental, no vocals, no melody in the 2-5 kHz range. Does NOT loop:
starts on sample 0 and decays to silence.
```

Short form, for tools with a character limit:

```
cold sci-fi RTS victory sting, 15 seconds, 72 BPM, A minor resolving, deep
synth pads, sub drone, single metal strike, cold pluck 4-note motif, radar
ping, mechanical relief, instrumental, one-shot, decays to silence
```

### Defeat

```
Short one-shot defeat cue for a top-down RTS about autonomous combat drones —
the moment the player's own base goes down. Not tragic and not dramatic: a
system losing power.

Structure, 15 seconds total: a low collapsing impact on beat 1, sub-bass
dropping in pitch; the cold pluck synth tries the same 4-note motif and fails
it — the last note lands a semitone flat and hangs unresolved; sustained pads
sag downward in pitch as if the power rail is drooping; a descending filter
sweep, one dying servo whine, a final relay click; then only tape hiss, fading
to nothing.

Instrumentation: deep sustained synth pads with downward pitch drift, analog
sub-bass drone falling in pitch, one cold detuned pluck synth, sparse
industrial metal (a heavy collapsing impact, distant debris settling), a
single mechanical relay click near the end.

Mood: cold defeat. Mechanical, hollow, powering down — an unresolved minor
that never lands. 72 BPM, A minor / D minor, no resolution anywhere.

Production: wide stereo pads, dry centre, tape hiss and a light noise floor,
generous headroom, one transient at the top and nothing loud after it. Fully
instrumental, no vocals, no melody in the 2-5 kHz range. Does NOT loop:
starts on sample 0 and decays to silence.
```

Short form:

```
cold sci-fi RTS defeat sting, 15 seconds, 72 BPM, A minor unresolved, sagging
detuned synth pads, falling sub drone, collapsing metal impact, dying servo,
relay click, power-down, instrumental, one-shot, fades to nothing
```

### Negative prompt (both)

```
vocals, choir, epic orchestral brass, trailer hits, war drums, dubstep,
distorted guitars, fast arpeggios, bright lead melody, applause, cheering,
fanfare, victory chorus, silence at the start, abrupt cut at the end, looping
```

## Why the constraints are the constraints

Most of the above is not taste. Each line is there because of something the
game actually does:

- **12–18 s, ending in decay.** The player can press *Play Again* at any moment,
  and the track is cut off by a 600 ms fade whenever they do. A piece that puts
  its point at second 25 mostly never gets heard; one that ends on a hard cut
  sounds broken on the occasions it does finish.
- **No leading silence — the transient is on sample 0.** This is the *opposite*
  of the rule the beds follow. There an attack at the top is banned because it
  would expose the loop seam; here the modal appears on that exact frame, and a
  stinger that starts 400 ms late reads as a bug. The bed's 600 ms cross-fade out
  covers the overlap.
- **No melody in 2–5 kHz, one transient and nothing loud after it.** Same reason
  as the beds: the Kenney interface pips (`button-click` above all) live in that
  band, and the player is clicking *Play Again* / *Main menu* over this track.
- **Instrumental.** Four languages ship (en/ru/uk/pl); a vocal is right in one of
  them and wrong in the other three.
- **Not a fanfare.** The whole audio identity of this game is cold and mechanical
  — see the two bed briefs. A triumphant brass sting would be the one moment in
  the game that sounds like a different product.
- **Same tempo, key and instrumentation as the beds.** The match bed cross-fades
  directly into this over 600 ms, so a different tempo or key collides audibly
  for that whole overlap.
- **Do not master it loud.** As with the beds, the mix balance is set in code
  (`musicDefs`), not in the file.

## Delivery requirements

> **What actually shipped:** 1:15 (victory) and 1:48 (defeat), not 12–18 s. Kept
> whole rather than trimmed, because both satisfy the two requirements the length
> was a proxy for — a transient in the first 100 ms and a composed decay to
> silence at the end — and a cut would have removed the second one. Everything
> past ~20 s is tail the player rarely reaches; `music.playOnce` is faded out in
> 600 ms the moment they leave the screen. They are encoded at `-q:a 2` instead of
> the beds' 3 to keep that tail affordable (1.9 MB for the pair). A regeneration
> at the briefed length should go back to `-q:a 3`.

- **12–18 s**, one-shot, **no loop**.
- **Attack on sample 0, decay to silence at the end.** Both halves matter: the
  first is why it lands with the modal, the second is why being cut off does not
  sound broken.
- **Ogg Vorbis**, 44.1 kHz stereo, into `client/public/music/`. The whole audio
  pipeline is `.ogg` with no conversion step at runtime.
- Peaks with headroom, integrated loudness in the −13 LUFS region like the beds —
  the code scales it down from there.

## After regenerating

Three steps, in order — the same as for a bed:

1. Encode: drop the master into `client/assets-src/`, add or update its row in
   `client/scripts/encode-music.mjs`, and run
   `node scripts/encode-music.mjs victory defeat` from `client/`. (`-q:a 3`
   ≈ 112 kb/s, transparent at this level; ~250 KB for 15 s.)
2. Measure — the script prints the integrated loudness — and reset
   `musicDefs.victory.volume` / `.defeat.volume` in `client/src/config/sounds.ts`
   so the track lands near **−24 LUFS** at the music slider's default 0.6. The
   arithmetic is `volume = 10^((−24 − LUFS) / 20) / 0.6`; both shipped files
   measure −13.7 LUFS, hence 0.51. That is
   3 dB *above* the menu bed and 6 dB above the match bed: those two play under
   the whole game, this plays alone, and it is an event rather than a bed.
3. Point the `src` at the new file and delete the old one — nothing else
   references it.

## Alternatives, if this direction stops working

| Direction | Prompt core |
| --- | --- |
| Pure diegetic | `no music at all: a shutdown sequence — cooling fans spinning down, relays clicking out in order, one last telemetry ping, room tone` |
| Single held chord | `one wide minor chord on deep synth pads, struck once and left to decay for 15 seconds, sub-bass under it, nothing else` |
| The bed, ending | `the match bed's own ostinato playing one final bar and stopping dead, tape hiss continuing alone` |

The first makes the outcome feel like the machines simply stopping; the second is
the safest and the least memorable. The prompts above are deliberately between
them: a motif, but a cold one.
