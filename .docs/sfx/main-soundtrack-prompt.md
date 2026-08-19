# Промт: основной (внутриматчевый) саундтрек «Drone Directive»

> Скопировать блок из раздела [Промт](#промт) в text-to-music модель (Suno / Udio / MusicGen).
> Всё остальное — объяснение, почему ограничения именно такие, и что делать с результатом.

## Статус: сделано

Промт ниже дал `client/assets-src/game_music.mp3`, который
`client/scripts/encode-music.mjs` переводит в
`client/public/music/standing-orders.ogg` (2:58, Ogg Vorbis `-q:a 3`, 2.2 МБ,
−13.0 LUFS integrated). Микс: `musicDefs.match.volume = 0.24` в
`client/src/config/sounds.ts` — при дефолтном ползунке музыки 0.6 это ≈ −30 LUFS,
на 3 дБ ниже меню, как и требовал бриф. Остальное — спецификация, по которой трек
переделывать, если этот перестанет устраивать.

Это бриф **боевого** трека — того, что играет под матчем. Тему главного меню он не заменяет:
она уже есть, это `client/public/music/terminal-standby.ogg`, и её бриф лежит в
[`.docs/sfx/music-prompt.md`](../sfx/music-prompt.md). Два трека должны звучать как одна
вселенная, но решать разные задачи: меню — ожидание, матч — работа машин под огнём.

С этого трека **уходят** два коротких стингера исхода (победа / поражение) —
[`outcome-stingers-prompt.md`](outcome-stingers-prompt.md). Они гасят боевой бед
кроссфейдом за 600 мс, поэтому темп и тональность у них те же; менять их здесь
нельзя в одиночку.

## Что не так с исходной «Dark Cinematic» наработкой

Направление верное (мрачно, сыро, кинематографично), но она написана как **линейная пьеса для
трейлера**, а не как игровой слой. Четыре конкретных конфликта:

- **Арка intro → build-up → climax → outro.** Матч длится от полутора минут до двадцати, и трек
  не знает, на какой он минуте. Кульминация случится под расстановку заводов или под добивание
  последней базы — одинаково случайно. Игровая музыка должна быть **плато с дыханием**, а не
  драматургией.
- **Кульминация «стена плача, басы заполняют всё пространство».** Ровно в этот момент игрок
  должен слышать `shield-break` и `explosion`. Трек, который сам занимает весь спектр, съедает
  весь звуковой дизайн.
- **Расстроенное пианино с большим ревером в среднем/высоком регистре.** Это 2–5 кГц — полоса,
  где живут интерфейсные пипы Kenney (`button-click`, `chat-message`, `unit-ready`). Тот же
  запрет уже действует для меню, и по той же причине.
- **50–65 BPM и «очень много пустого пространства».** Это темп горя, а не темп производственной
  линии. Игра про машины, выполняющие директиву: нужен медленный, но **непрерывный** механический
  пульс — что-то, что не останавливается, пока игрок думает.

Что из наработки сохранено: сырые смычковые с трением, саб-бас как физическое давление,
плёночный шум, отказ от стандартной ударной установки, отсутствие вокала.

## Промт

```
Dark industrial ambient score for the in-match layer of a top-down RTS about
autonomous combat drones. Not a battle theme and not a lament: the sound of
machines executing standing orders while something goes wrong off-screen.
Patient, mechanical, unresolved. Loopable bed, no arc, no climax.

Instrumentation: low bowed cello and viola drones, raw and close-mic'd, bow
friction and rosin audible, no vibrato, no soaring lines. Sub-bass sine drone
holding one note, felt more than heard. A slow mechanical pulse instead of
drums: muted metal taps, distant press strokes, a factory floor two rooms
away, roughly one hit per 1.5 seconds, always the same, never a fill. Cold
analog synth pad with slow filter movement underneath. Sparse detuned piano
notes in the LOW register only, heavily damped, no reverb tail. Faint
telemetry blips and tape hiss as texture.

Mood: cold, industrial, quietly threatening. Attrition, not tragedy.
Tempo 76 BPM, D minor or A minor, one held chord with a second appearing and
receding. No progression, no resolution, no key change.

Production: wide low end, dry center, generous headroom, everything above
2 kHz kept dark and quiet. No loud transients, no swells, no impacts, no risers.
Dynamic range within 6 dB from start to finish. Fully instrumental, no vocals.
Seamless loop, 3-4 minutes.
```

Короткая форма (для инструментов с лимитом символов):

```
dark industrial ambient RTS combat bed, 76 BPM, D minor, raw bowed cello
drones, sub-bass, slow factory metal pulse, cold analog pad, damped low piano,
tape hiss, flat dynamics, no climax, instrumental, seamless loop
```

Негативный промт:

```
vocals, choir, epic orchestral brass, war drums, taiko, trailer hits, risers,
braams, dubstep, distorted guitars, fast arpeggios, bright piano melody,
high reverb tails, crescendo, build-up, dramatic ending, silence at start or
end, applause
```

## Почему ограничения именно такие

Каждая строка выше стоит там из-за того, что игра делает со звуком:

- **Ничего выше 2 кГц.** Полоса интерфейсных пипов и лазерных выстрелов
  (`shot-cannon`, `chat-message`). Всё, что туда попадёт, конкурирует с информацией.
- **Плоская динамика в пределах 6 дБ.** Микс балансируется в коде, а не в файле, одной
  константой громкости. Трек с ходом −20 → −8 LUFS невозможно выставить: тихая часть утонет,
  громкая перекроет `explosion`.
- **Пульс вместо ударных, но пульс обязателен.** Это единственное, что отличает боевой слой от
  меню, где допустимо почти безвременье. Матч идёт в фиксированные 30 Гц; ровный медленный
  метроном на заднем плане читается как «производство работает».
- **Один аккорд.** Гармоническое движение подразумевает, что что-то происходит. В матче
  «происходящее» — это события игрока, и музыка не должна их комментировать.
- **Никаких импактов и подъёмов.** Каждый импакт будет ложным событием: игрок обернётся на
  звук, которого в симуляции не было.
- **Инструментал.** Игра поставляется на четырёх языках (en/ru/uk/pl).
- **Бесшовный луп.** Проигрыватель ставит `loop: true`; фейды закрывают вход и выход, шов не
  закрывает ничто.

## Требования к файлу

- **3–4 минуты.** Длиннее темы меню: этот трек слушают весь матч, а не пятнадцать секунд.
- **Без атаки на нулевом сэмпле и без хвоста в конце** — иначе шов лупа слышен.
- **Ogg Vorbis, 44.1 кГц, стерео**, в `client/public/music/`. Весь аудиопайплайн — `.ogg` без
  шага конверсии; Vorbis gapless, в отличие от MP3 не несёт priming delay, который размазал бы
  склейку.
- **Не мастерить громко.** Баланс задаётся в коде.

## После генерации

1. Кодировать: `ffmpeg -i new.wav -c:a libvorbis -q:a 3 -ar 44100 -ac 2 client/public/music/<name>.ogg`
   (`-q:a 3` ≈ 112 кб/с — прозрачно для подложки на таком уровне).
2. Измерить: `ffmpeg -i <file> -af ebur128 -f null -`. Боевой слой должен садиться **ниже**
   меню — целевые **−30 LUFS** после применённой громкости (меню стоит на −27), потому что
   поверх него звучат все тринадцать боевых кью, а не только клики.
3. Проверить на слух под залпом: запустить матч, выделить группу из восьми роботов и дать
   приказ на атаку. Если `shield-break` не читается как «кто-то что-то потерял» — громкость
   трека всё ещё завышена.
4. Проверить переход меню → матч: два трека не должны звучать одновременно, и пауза между ними
   не должна быть слышимой дырой.

## Альтернативные направления

| Направление | Ядро промта |
| --- | --- |
| Ближе к исходной наработке | `dark cinematic ambient, droning raw cello, detuned low piano, sub-bass pressure, film-grain noise, 60 BPM, no percussion at all` |
| Ритмический, «конвейер» | `industrial minimal techno bed, 92 BPM, muted metal loop, no kick, filtered analog bass sequence, machinery groove, hypnotic` |
| Почти тишина | `generative drone, single evolving low string, distant metal resonance once per minute, no pulse, 4 minutes` |

Первое — исходная задумка, очищенная от арки: годится, если пульс окажется навязчивым.
Второе делает матч похожим на работу цеха и лучше держит долгие партии, но рискует спорить с
темпом стрельбы. Третье безопаснее всего для микса и скучнее всего через десять минут.
