# Оружие направленной энергии (DEW) — implementation plan

**Реализовано.** Документ сохранён как запись о принятых решениях: цифры, границы
эффекта и причины именно такого разделения по системам. Расхождения с кодом — баг
документа.

## Context

В игре шесть типов вооружения (`types/src/enums.ts:39-46`), и все они работают по одной
схеме: снаряд наносит урон (`cannon`/`missiles`), либо юнит не вооружён вовсе
(`radar`/`ew` — поддержка через `sightMultiplier`/`jamRadius`). Третьего варианта —
«стреляет, но не убивает» — в движке нет: `combat.ts:30` буквально отсекает любое
оружие с `damage <= 0`, а `.claude/skills/dd-engine/SKILL.md:37` фиксирует это как
правило («damage-dealing paths key off `explosionRadius`/`range`, not the enum»).

Нужно **оружие направленной энергии** (directed-energy weapon, **DEW**) — наводит токи
высокого напряжения и выводит из строя электрическое и электронное оборудование цели.
Точечный выстрел, урона нет, попадание парализует вражеского робота на 8 с; перезарядка
5 с; дальность и стоимость — как у пушки; ставится на любое шасси (шасси и оружие в игре
и так ортогональны — см. `spawnRobot`, `client/src/engine/ecs/factory.ts:34-62`).

**Результат:** новая ось контроля вместо ещё одного ствола — DEW не убивает, а вырезает
юнит из боя на 8 с, и это первый в игре временный статус-эффект, влияющий на движение,
огонь, разведку и захват дроном.

## Принятые решения

- **Имя.** Enum-ключ `Dew`, значение `'dew'`, на проводе `DEW = 6`. Не путать с
  существующим `Ew` (`'ew'`, РЭБ) — это разные вещи: `ew` глушит обзор аурой, `dew`
  стреляет и парализует.
- **Полный паралич.** Обездвиженный робот не двигается, не стреляет, не перезаряжается,
  не разведывает (`sightRange` не учитывается), не глушит (если это РЭБ) и не может быть
  захвачен дроном. Приказ игрока **применяется** (скрипт меняется), но исполняется только
  после разморозки — это получается само собой, потому что `taskSystem` пропускает
  парализованного, а `commands.ts` его не трогает. Отдельной очереди приказов не нужно.
- **Точечно, снарядом.** Переиспользуется существующий пайплайн
  `spawnProjectile` → `stepProjectiles`: меняется только применение попадания. Никакого
  AOE-клона `detonateBomb`, никакой ауры.
- **Не ПВО.** `canHitAir: false` — `missiles` остаётся единственным средством против
  дрона-наблюдателя, комментарий `gameConfig.ts:96-98` сохраняет силу.
- **Новый компонент `disabled`, а не новое `RobotState`.** `RobotState` уходит в
  снапшоты и логику задач; статус-эффект — отдельный опциональный компонент, как
  `threat`. Прецедент тайминга — `threat.underFireLeft` (ставится в `combat.ts:150`,
  затухает в `task.ts:43-45`).
- **`disabled` входит в `worldHash`.** Это состояние симуляции: два пира, разошедшиеся
  по нему, разойдутся и по позициям через тик. Пропустить его — значит ослепить
  desync-пробу.
- **Разделение (separation) продолжает толкать парализованных.** Иначе замороженная
  толпа станет непроходимой стеной и спровоцирует anti-jam-отступления у живых.
- **Барьер `damage <= 0` заменяется явным `canEngage(w)`**, а не спецкейсом на
  `WeaponType.Dew` — правило «оружие пригодно к бою, если у него есть дальность и хоть
  какой-то эффект» остаётся duck-typed, как и было задумано в dd-engine.
- **DEW не бьёт по базам.** Снаряд с нулевым уроном не должен «съедаться» базой, а
  директива `AttackBase` для DEW бессмысленна — блокируется тем же механизмом, что и
  для радара (`isTaskBlockedForWeapon`), но точечно: `AttackRobots` остаётся разрешён.
- **Цифры:** `range 120`, `damage 0`, `cooldown 5`, `freezeDuration 8`, `cost 40`
  (всё как у пушки, кроме перезарядки и эффекта).
- **Подпись в UI — локальная аббревиатура** (`DEW` / `ОНЭ` / `ЗСЕ` / `DEW`), полное
  название по Википедии («Оружие направленной энергии» и т.д.) уходит в подсказку и
  в справочник юнитов.
- **ИИ строит DEW** — добавляется шаг в `AiAssault`, и боты не переназначают задачи
  парализованным юнитам.
- **Протокол ломается** (`WeaponType` — не расширяемый enum): `PROTOCOL_VERSION` 7 → 8.

---

## Фаза 1 — `types/`

**`types/src/enums.ts:39-46`**

- В `WeaponType` добавить `Dew: 'dew'` с однострочным комментарием, отличающим его от `Ew`.

## Фаза 2 — `protocol/`

**`protocol/schema/messages.bare:37-44`**

- В `enum WeaponType` добавить `DEW = 6`.

**`protocol/src/index.ts:15`**

- `PROTOCOL_VERSION` 7 → 8 (шапка схемы, строки 13-17, прямо требует бампа на любое
  изменение).

**Кодоген**

- `npm run codegen -w protocol`, полученный `protocol/src/generated/messages.ts`
  закоммитить.

## Фаза 3 — `net/`

**`net/src/wire/codec/enums.ts:17-24`**

- Строка `[WeaponType.Dew]: wire.WeaponType.DEW` в `WEAPON_TO_WIRE`. Обратная таблица
  выводится через `invert()` (строка 65) — править не нужно.

Валидация (`net/src/wire/validation/schemas.ts:47-51`) строится из
`Object.values(WeaponType)` и подхватит новое значение сама. Тест
`net/src/wire/codec.test.ts:74-86` прогоняет round-trip по всем членам обоих enum —
он и упадёт, если таблицу забыть.

`server/` контент-слеп для `Tick` и меняться не должен; версия рукопожатия приедет
из `protocol`.

## Фаза 4 — конфиг игры

**`client/src/config/gameConfig.ts`**

- В **каждую** из шести записей `weapons` (100-161) добавить `freezeDuration: 0` —
  объект индексируется по `WeaponType`, поле должно быть у всех.
- Новая запись:
  ```ts
  /** Directed-energy weapon: урона не наносит, попадание выводит цель из строя на `freezeDuration` секунд. */
  dew: {
    range: 120, damage: 0, cooldown: 5, explosionRadius: 0,
    sightMultiplier: 1, jamRadius: 0, canHitAir: false, freezeDuration: 8,
  },
  ```
- Обновить доккоммент 90-99: описать `freezeDuration`.
- `weaponCost` (256): `dew: 40`.

## Фаза 5 — ECS и статус-эффект

**`client/src/engine/ecs/entity.ts`**

- В `WeaponComp` (29-41): `freezeDuration: number` — «секунды паралича, накладываемого
  попаданием; 0 = обычное оружие».
- Новый интерфейс рядом с `Threat` (69-74):
  ```ts
  /** Временный вывод из строя (DEW): пока left > 0 юнит не действует. */
  export interface Disabled { left: number }
  ```
- В `Entity`, в блок поведения (~строка 130): `disabled?: Disabled;`

**`client/src/engine/ecs/factory.ts:34-62`**

- В литерал `weapon:` внутри `spawnRobot` добавить `freezeDuration: w.freezeDuration`.

**Новый `client/src/engine/systems/status.ts`** — маленький модуль, чтобы гарды не
разъехались по семи файлам:

```ts
export function isDisabled(e: Entity): boolean;             // (e.disabled?.left ?? 0) > 0
export function applyDisable(e: Entity, s: number): void;   // left = Math.max(left, s)
export function decayDisabled(e: Entity, dt: number): void; // вычитает, снимает компонент
```

`applyDisable` берёт максимум, а не сумму — повторное попадание продлевает до полных
8 с, но не копит бесконечный стан.

## Фаза 6 — системы движка

Порядок пайплайна (`game/scenes/gameScene.ts:83-112`) не меняется.

**`client/src/engine/systems/task.ts:41-48`** — здесь же живёт затухание
`underFireLeft`, туда же ложится и наше:

```ts
for (const e of ctx.world.with('robot','position','script','movement')) {
  decayDisabled(e, dt);
  if (isDisabled(e)) continue;      // программа не выполняется
  ...существующее затухание threat + runProgram(ctx, e)
}
```

Затухание идёт **до** гарда, поэтому в тик разморозки робот сразу оживает — и делает
это одинаково у обоих пиров.

**`client/src/engine/systems/movement.ts:40-57`** — в начале цикла:

```ts
if (isDisabled(e)) {
  m.prevX = e.position!.x; m.prevY = e.position!.y;   // иначе после разморозки anti-jam
  m.stuckTime = 0; m.retreatTime = 0;                 // примет стоянку за затор
  m.state = RobotState.Idle;
  continue;
}
```

**`client/src/engine/systems/combat.ts`**

- Новый экспортируемый хелпер (заменяет условие строки 30):
  ```ts
  /** Оружие пригодно к бою: есть дальность и хоть какой-то эффект (урон или паралич). */
  export function canEngage(w: WeaponComp): boolean {
    return w.range > 0 && (w.damage > 0 || w.freezeDuration > 0);
  }
  ```
- Цикл `combatSystem` (26-46): `if (isDisabled(e)) continue;` **до** декремента
  `cooldownLeft` (28) — паралич останавливает и перезарядку; далее
  `if (!canEngage(w) || w.cooldownLeft > 0) continue;`.
- Попадание по роботу (143-154):
  ```ts
  const fx = gameConfig.robots.weapons[p.weaponType!];
  r.hp = (r.hp ?? 0) - (p.damage ?? 0);
  if (fx.freezeDuration > 0) applyDisable(r, fx.freezeDuration);
  ```
  `threat` ставится как и раньше — цель должна помнить, кто её ударил.
- Проверка попадания по базе (155-164): пропускать снаряды с `(p.damage ?? 0) <= 0`,
  чтобы DEW-разряд не поглощался базой впустую.
- Обновить доккоммент 10-22 (описать DEW рядом с bomb/radar).

**`client/src/engine/systems/vision.ts`**

- `isMine` (30): добавить `&& !isDisabled(e)` — парализованный не разведывает.
- `jammers` (39-41): добавить `&& !isDisabled(e)` — парализованный РЭБ не глушит.
- Обновить доккоммент 8-22.

**`client/src/engine/systems/drone.ts`**

- `tryPossess` (61-76): в фильтр добавить `&& !isDisabled(r)`.
- `drivePossessed` (79-104): если `isDisabled(robot)` — не двигать и не стрелять
  (дрон продолжает «сидеть» на роботе, позиция синхронизируется как обычно).
- `fireManual` (125-144): гард `if (isDisabled(robot)) return;` и замена условия 132 на
  `if (!canEngage(w) || w.cooldownLeft > 0) return;`.

**`client/src/engine/systems/ai.ts`**

- `assignIdleUnits` (110-159) и `mobilizeDefense` (~252-261): исключить парализованных
  из выборки `aiRobots`, чтобы бот не переписывал им программу каждый тик.

**`client/src/engine/worldHash.ts:24`**

- Добавить в отпечаток остаток паралича, квантованный так же, как позиции:
  `:${Math.round((e.disabled?.left ?? 0) * 1000)}`. Обновить доккоммент.

**`client/src/engine/tasks/taskDefinitions.ts:5-16`**

- Обобщить `FORBIDDEN_FOR_RADAR` в таблицу по оружию, поведение радара сохранить один
  в один:
  ```ts
  const FORBIDDEN_TASKS: Partial<Record<WeaponType, ReadonlySet<TaskType>>> = {
    [WeaponType.Radar]: new Set([TaskType.AttackBase, TaskType.AttackRobots]),
    [WeaponType.Dew]:   new Set([TaskType.AttackBase]),   // по строениям бесполезен
  };
  export function isTaskBlockedForWeapon(w, task) {
    return w !== undefined && (FORBIDDEN_TASKS[w]?.has(task) ?? false);
  }
  ```
  `TaskPicker.tsx:21` и `commands.ts` уже ходят через эту функцию — правок не нужно.

**`client/src/config/buildPresets.ts:60-75`**

- В `AiAssault` заменить 5-й шаг на `{ chassis: Wheels, weapon: WeaponType.Dew }`
  (дешёвое быстрое шасси под поддержку; длина последовательности и «каждый 10-й —
  камикадзе» сохраняются). Обновить доккоммент 52-59.

## Фаза 7 — рендер и звук

**`client/src/config/palette.ts`**

- Добавить `status: { disabled: 0x7dd3fc }` (бледно-голубой «электрический») рядом с
  `blast`/`vision`.

**`client/src/pixi/render/RobotView.ts`**

- `drawWeapon` (179-211): ветка `case WeaponType.Dew` — излучатель: две разомкнутые
  концентрические дуги + короткий зигзаг, тем же `0x0b0e13`, что и остальные маркеры
  (визуально отличается от «креста» РЭБ).
- Новый `private readonly stunned: Graphics` — дуга/кольцо цвета `palette.status.disabled`
  над корпусом, создаётся в конструкторе рядом с `spotted` (84-86).
- `update()` (123-130): `const off = (robot.disabled?.left ?? 0) > 0;`
  `this.stunned.visible = off; this.body.alpha = off ? 0.55 : 1;` — «свет погас»
  читается и по своим, и по чужим юнитам.

**`client/src/pixi/render/ProjectileView.ts:25-42`**

- Третья ветка для `WeaponType.Dew`: бледно-голубое ядро без трассера + короткие
  ломаные разряды, перерисовываемые каждый тик (тот же приём, что `drawFlame`, 52-60 —
  обобщить поле `flame` в «перерисовываемый спрайт» либо завести соседнее `spark`).
- Обновить доккоммент 7-12.

**`client/src/config/sprites.ts:117-138`**

- После генерации PNG (см. `.docs/sprites/weapons.md`) добавить
  `dew: { src: '/weapon-dew-player.png', targetSize: WEAPON_TARGET }` и AI-аналог. Карта
  `Partial`, поэтому до появления файлов игра просто рисует Graphics-маркер — шаг
  необязателен для зелёной сборки.

**`client/src/config/sounds.ts`**

- В `SoundName` добавить `'shot-dew'`; в `soundDefs`:
  `'shot-dew': { src: src('digital/phaserUp3'), volume: 0.35 }`.

**`client/src/pixi/audio/sfx.ts`**

- `dewShot()` рядом с `cannonShot()` (105-107) / `missileShot()` (109-111).

**`client/src/pixi/GameApp.ts:247-251`**

- Заменить `if/else` на явное сопоставление (switch или `Record<WeaponType, SoundName>`
  с дефолтом), чтобы следующее оружие не унаследовало звук пушки молча.

## Фаза 8 — UI и i18n

**`client/src/ui/hud/WeaponPicker.tsx:6-12`** — `WeaponType.Dew` в `OPTIONS`.
**`client/src/ui/screens/UnitsGuideModal.tsx:9-15`** — `WeaponType.Dew` в `WEAPON_OPTIONS`.

**`client/src/ui/hud/unitHints.ts:19-36`** — ветка:

```ts
case WeaponType.Dew:
  return `${t('weapons','statsRange')}: ${stats.range} · ${t('weapons','statsReload')}: ${stats.cooldown} — ${t('weapons','dewNote')} ${stats.freezeDuration}`;
```

(у DEW «Урон: 0» дезинформирует — вместо него показываются дальность, перезарядка и
длительность паралича; полное название оружия несёт `dewNote`).

**`client/src/i18n/dict.ts:149-163`** — добавить в типизированную секцию `weapons`
ключи `dew`, `dewNote`, `statsReload`; затем все четыре локали
(`locales/{en,ru,uk,pl}.ts:149-164`):

| ключ | en | ru | uk | pl |
|---|---|---|---|---|
| `dew` | `DEW` | `ОНЭ` | `ЗСЕ` | `DEW` |
| `statsReload` | `Reload` | `Перезарядка` | `Перезарядка` | `Przeładowanie` |
| `dewNote` | `Directed-energy weapon: no damage — disables the target for, s:` | `Оружие направленной энергии: без урона — выводит цель из строя на, с:` | `Зброя спрямованої енергії: без шкоди — виводить ціль з ладу на, с:` | `Broń energii skierowanej: bez obrażeń — unieruchamia cel na, s:` |

Тест `client/src/i18n/dictionaries.test.ts:55-61` сам поймает забытую локаль.

## Постфактум — «замороженного никто не добивает»

Найдено после реализации, при проверке в игре. Симптом: попадание DEW словно
**защищало** цель — по ней переставали стрелять. Причина не в новом коде, а в
столкновении с семантикой `Idle` (`config/programs.ts`): idle-юнит стреляет
только в того, кто стреляет в него (`underFire` → `attackAttacker`). Заморозка
как раз и заставляет цель замолчать, поэтому окно `underFireDuration` (1.2 с)
истекает и огонь прекращается. Замеры урона по замороженному врагу в 60 px за 4 с:

| программа | было (в бою → заморозка) | было (холодный старт) |
| --- | --- | --- |
| `idle` | 12 | 0 |
| `guard` / `attackRobots` / `attackBase` / `scout` | 48–60 | 60 |

Правится в терминах словаря директив, а не спецкейсом: новое условие
`disabledEnemyWithin` + действие `finishDisabled` (`types/src/tasks.ts`,
реализация в `systems/task.ts`), добавленные **только** в `Idle` — остальные
программы уже работали. Действие даёт **только fire-intent**, поэтому правило
«idle не преследует» сохраняется. `disabledInRange` требует `damage > 0`: у DEW
нет причин тратить пятисекундную перезарядку на повторную заморозку.

## Фаза 9 — спрайты

Промты на два модуля (`weapon-dew-player.png`, `weapon-dew-ai.png`) лежат в
`.docs/sprites/weapons.md`, секция **DEW — directed-energy emitter module**. После
генерации PNG кладутся в `client/public/` и подключаются через `sprites.ts` (Фаза 7).

## Фаза 10 — тесты и документация

Тесты (рядом с системами, `client/src/engine/systems/*.test.ts`):

- `combat.test.ts` — DEW стреляет при `damage: 0`; попадание ставит `disabled.left === 8`;
  повторное попадание продлевает, а не суммирует; DEW-снаряд не поглощается базой и не
  снимает ей ХП; парализованный стрелок не стреляет и не перезаряжается.
- `movement.test.ts` — парализованный не смещается и не копит `stuckTime`; после
  разморозки не уходит в anti-jam-отступление.
- `task.test.ts` — программа парализованного не выполняется; счётчик затухает и через
  8 с компонент снимается.
- `vision.test.ts` — парализованный разведчик никого не видит; парализованный РЭБ не глушит.
- `drone.test.ts` — дрон не может захватить парализованного робота.
- `net/src/wire/codec.test.ts` — правок не требует (перебирает enum сам).

Документация:

- `.docs/multiplayer.md` — `PROTOCOL_VERSION` 8 + абзац про статус-эффект в
  детерминизме/хеше.
- `.docs/engine-ecs.md` — компонент `disabled` и его место в пайплайне.
- `.claude/skills/dd-engine/SKILL.md:37` — «add a weapon» теперь включает `freezeDuration`
  и `canEngage`.
- `.docs/sfx/README.md` — описание кью `shot-dew`.
- `protocol/README.md` / `.claude/skills/dd-net/SKILL.md` — если там зафиксирован номер
  версии, поднять.

---

## Проверка

1. `npm run codegen -w protocol` — сгенерированный файл закоммичен.
2. `npm run build` — чисто.
3. `npm test` — `net`, `chat`, движок; новые тесты зелёные.
4. `npm run lint` — чисто.
5. `npm run type-check` — обязательно (менялись `types`, `protocol`, `net`).
6. `npm run dev:relay` + `npm run e2e -w server` — рукопожатие на версии 8.

**Живьём** (`npm run dev`):

- В окне постройки появляется «ОНЭ»; стоимость юнита = стоимость шасси + 40; подсказка
  показывает полное название, дальность 120, перезарядку 5 с и 8 с вывода из строя.
- DEW ставится на все три шасси; «Атака базы» для него недоступна, «Атака роботов» — да.
- DEW-юнит подъезжает к вражескому роботу, стреляет голубым разрядом: у цели гаснет
  корпус и появляется дуга, она стоит, не стреляет и не видит. Ровно через 8 с оживает
  и продолжает прежний приказ; DEW стреляет снова через 5 с.
- Приказ, отданный парализованному своему юниту, исполняется сразу после разморозки.
- Дрон не садится на парализованного робота; захваченный робот, попав под DEW, перестаёт
  слушаться руля и огня, дрон остаётся на нём.
- Вражеский ИИ строит DEW (пятый шаг серии) и применяет его.
- Онлайн-матч: два клиента, DEW с обеих сторон — desync-предупреждений в консоли нет
  (это и проверяет добавление `disabled` в `worldHash`).
