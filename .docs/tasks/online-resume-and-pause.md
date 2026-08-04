# Online resume (грейс на переподключение) + пауза в сетевой игре — implementation plan

Design record, agreed but **not yet implemented**. Nothing in the repository has been changed for it.

## Context

Сегодня **любой** закрывшийся игровой сокет = конец матча. `Room.onClose` шлёт выжившему `OpponentLeft` и обнуляет оба места (`server/src/Room.ts:145`), а на клиенте `onClose` уходит прямо в `endOnline('Connection closed')` (`client/src/pixi/GameApp.ts:466`) — ни одной попытки восстановления, в отличие от чата (`chat/src/ChatSession.ts:14-23`). Пятисекундный провал Wi-Fi убивает получасовой матч.

Ключевое наблюдение, которое делает починку дешёвой: **при разрыве симуляция не уезжает вперёд**. `stepOnline` стоит на `!session.ready(tick)` (`client/src/pixi/GameApp.ts:340`), мир заморожен, детерминизм цел. Значит не нужны ни rollback, ни передача состояния, ни журнал с нулевого тика — нужно только (а) не убивать комнату сразу, (б) сохранить кадры, адресованные отвалившемуся, (в) переслать их при возврате. Игровой логики (`client/src/engine/**`) это не касается вообще.

Вторая проблема, видимая тем же кодом: **залипание никак не показано**. `stepOnline` молча делает `return` — лаг-спайк выглядит как зависшая игра, и нет верхней границы: свёрнутая вкладка соперника вешает матч навсегда.

Заодно закрывается давняя дыра — **паузы в сетевой игре нет** (`client/src/ui/hud/PauseButton.tsx:19`, `client/src/ui/hooks/usePauseHotkey.ts:16`, `client/src/pixi/GameApp.ts:342-345`). Под lockstep это один бит во входе тика, применяемый обоими клиентами на одном и том же тике; `GameEngine.tick` уже возвращается раньше при `paused` (`client/src/engine/game/engine.ts:68-71`), так что «стоящий мир» — это ровно существующее поведение. Обе фичи объединены в один заход, потому что делят **один бамп `PROTOCOL_VERSION`**, одну правку `messages.bare` + codegen, один шов `stepOnline` и один оверлей «мир сейчас не идёт, и вот почему».

**Результат:** кратковременный разрыв (≤ 20 с) переживается прозрачно; соперник это время видит «Переподключение…»; матч кончается только по истечении грейса, по жёсткому потолку залипания или по выходу игрока. Пауза работает онлайн.

## Принятые решения

- **Грейс — 20 с**, окно переподключения на стороне клиента укладывается в него с запасом по backoff.
- **Место аутентифицируется токеном.** Код комнаты — 4 символа (`ROOM_CODE_LENGTH`, `protocol/src/index.ts:18`), по нему пускать резюме нельзя: третий угонит живое место. Реле выдаёт per-seat `resumeToken` (hex 16 байт) в `StartMessage` — тот же приём, что уже используется для `chatId` (`server/src/Room.ts:113-122`), с одним следствием: два `start`-кадра перестают быть побайтово одинаковыми.
- **Буфер в `Room` — кольцевой, ограниченный** (~900 кадров ≈ 30 с при 30 Гц). Реле остаётся **content-blind**: буферизуются те же непрозрачные `Tick`-кадры, что и пересылаются, ни один не декодируется.
- **Грейс живёт на `setTimeout`, а не на DO alarm.** Уцелевший сокет держит объект в памяти, а если отвалились оба — уведомлять всё равно некого. Так `Room` остаётся без `storage` и без конструктора, как задокументировано.
- **Пауза — общий флаг**, переключаемый импульсом от любой стороны; снять может тоже любая. Импульс, а не абсолютное состояние — как уже сделано с `possess`/`fire` в `DroneControl`; два импульса на одном тике = два флипа = без изменения, одинаково на обоих клиентах при любом порядке применения.
- **Ввод во время паузы блокируется**: `captureLocalInput` отдаёт пустые команды и нулевой дрон. Это политика **отправителя** (каждый клиент решает про свой ввод), поэтому симметрии не требует и десинком быть не может.
- Авто-снятие паузы по таймеру **не делаем**: раз снять может любой, гриферство ограничено само собой.

---

## Фаза 1 — `protocol/` (единственный бамп версии)

**`protocol/schema/messages.bare`**

- `TickMessage` += `pauseToggle: bool` — импульс «переключить общую паузу на этом тике».
- `StartMessage` += `resumeToken: str` — per-seat, поэтому два `start` теперь различаются (записать это прямо в комментарии к типу, рядом с уже объяснённым там `chatId`).
- `ErrorCode` += `RESUME_REJECTED = 5` — неверный токен, истёкший грейс, комнаты нет.

**`protocol/src/index.ts`** (остаётся dependency-free — он на горячем пути Worker'а)

- `QueryParam.Resume: 'resume'` — токен и есть идентификатор места, отдельный `seat` не нужен.
- `RESUME_GRACE_MS = 20_000`, `RESUME_BUFFER_FRAMES = 900`, `RESUME_TOKEN_LENGTH = 32`.
- `PROTOCOL_VERSION` 6 → **7**; обновить комментарий-контракт handshake (строки 21-31) новой формой URL: `?room=<CODE>&v=7&resume=<TOKEN>`.

`npm run codegen -w protocol`, сгенерированное **закоммитить** (`protocol/src/generated/messages.ts`).

## Фаза 2 — `net/` (транспорт: переподключение + бит паузы)

**`net/src/lockstep/types.ts`**

- `TickInput` += `pauseToggle: boolean`.
- `LockstepHandlers` += `onLinkDown?()` / `onLinkUp?()`; уточнить доктренинг `onClose` — теперь это «сдались окончательно», а не «сокет закрылся».
- `onStart` сигнатуру **не** трогаем: `resumeToken` остаётся внутри сессии, хост-приложению он не нужен (тот же принцип, по которому `chatId` наружу отдаётся, а это — нет).

**`net/src/wire/codec/frames.ts`** — `encodeTick` принимает `pauseToggle`, `DecodedMessage.tick` его несёт, `start` несёт `resumeToken`.

**`net/src/lockstep/input.ts`** — `emptyInput()` += `pauseToggle: false`; `screen()` пропускает бит без изменений (валидировать в `wire/validation` нечего — это bool).

**`net/src/lockstep/LockstepSession.ts`** — основная работа:

- Запомнить `roomCode` и `resumeToken` (из `start`), чтобы уметь построить resume-URL; `connectUrl` (`net/src/config.ts:28`) получает опцию `resume`.
- **Outbox**: `scheduleLocal` кладёт кадр в `Map<tick, frame>` и шлёт, если сокет открыт. Сейчас `send()` тихо роняет кадр при закрытом сокете (`net/src/lockstep/LockstepSession.ts:152`) — именно эти кадры и теряются навсегда. Чистка outbox по тому же принципу, что уже применён к `localHashes` (строки 118-121).
- **Переподключение**: `close` при `started && resumeToken` → `onLinkDown()`, backoff `[500, 1000, 2000, 4000, 4000]` в пределах `RESUME_GRACE_MS`; по открытию — переслать outbox по возрастанию тика, затем `onLinkUp()`. Исчерпали бюджет / пришёл `RESUME_REJECTED` → `onClose()` (нынешнее поведение). Отмена таймера в `disconnect()` — как в `ChatSession.disconnect` (`chat/src/ChatSession.ts:163-172`).
- **Чистка `peerBuffer`**: `take()` удаляет только свой тик, поэтому повторно присланный старый тик осядет навсегда — добавить отбрасывание `msg.tick < currentTick` (сессия и так знает потолок по `take`).
- Приём дубликата безопасен: `peerBuffer.set` идемпотентен.

## Фаза 3 — `server/src/Room.ts`

- В `start()` сгенерировать два токена (переиспользовать локальный `hex()`, строка 30) и разослать **разные** `start`-кадры.
- `onClose(ws)` → если матч начат и место имеет токен: пометить место `pendingResume`, снять слушатели, **включить буферизацию** кадров, адресованных ему, и `setTimeout(RESUME_GRACE_MS)`. Уцелевший сокет не трогать — он просто залипает, как сейчас.
- `relay()` — если адресат в `pendingResume`, класть кадр в кольцевой буфер вместо `peer?.send`; переполнение выталкивает старейший (тогда резюме уже невозможно — при возврате сразу `RESUME_REJECTED`).
- `fetch()` — ветка `?resume=<token>`: токен совпал с ожидающим местом → усыновить сокет, `wire()`, слить буфер по порядку, отменить таймер. Иначе `reject(ErrorCode.ResumeRejected)`. Проверка версии остаётся первой.
- По таймеру — нынешнее поведение `onClose` (`OpponentLeft` + `close` + обнуление).
- Обновить доктренинг класса (строки 41-50): «a disconnect ends the match (no reconnection)» больше не верно.

## Фаза 4 — клиент

**`client/src/pixi/GameApp.ts`**

- `stepOnline`: держать `onlinePaused` и применять оба импульса (XOR), затем `this.engine.setPaused(this.onlinePaused)` вместо безусловного `setPaused(false)` (строки 342-345). Остальное тело не меняется: `take` → enqueue → `tick` (сам no-op при паузе) → `scheduleLocal` → `netTick++`. Хартбит идёт и в паузе — иначе снять её будет нечем.
- `captureLocalInput`: при паузе — пустые команды и нулевой дрон, но импульс паузы из стора всегда.
- **Индикация залипания**: отметка времени при `!ready`; > ~600 мс → `online.link = 'stalled'`; > `ONLINE_STALL_TIMEOUT_MS` (60 с) → `endOnline`. Пауза под потолок не попадает — в ней `ready` истинно.
- Хендлеры: `onLinkDown` → `online.link = 'reconnecting'`, `onLinkUp` → `'ok'`; `onClose` остаётся `endOnline`.

**`client/src/store/gameStore.ts`** — `online.link: 'ok' | 'stalled' | 'reconnecting'`; `onlinePaused: boolean` (зеркало из моста); одноразовый `pauseTogglePending`, который мост забирает, как уже сделано с `clearDroneRequests` (`client/src/pixi/GameApp.ts:405-413`). `togglePause()` в сетевом матче ставит импульс вместо флипа `paused`. Селекторы — в `client/src/store/selectors.ts`.

**UI** — снять запреты в `client/src/ui/hud/PauseButton.tsx:19` и `client/src/ui/hooks/usePauseHotkey.ts:16`; оверлей в `client/src/ui/App.tsx:136` учит показывать три состояния (пауза / ожидание соперника / переподключение, N с). Ключи i18n — во **все четыре** локали (`en`, `pl`, `ru`, `uk`).

## Фаза 5 — тесты и документация

- `net/src/wire/codec.test.ts` — round-trip `pauseToggle` и `resumeToken`; юнит на чистку outbox/`peerBuffer`.
- `server/scripts/relay-e2e.mjs` — два новых сценария: (1) гость рвёт сокет, хост продолжает слать, гость возвращается с токеном и получает пропущенное по порядку; (2) грейс истёк → хост получает `OpponentLeft`. Плюс негативный: чужой/пустой токен → `RESUME_REJECTED`.
- Документация: `.docs/multiplayer.md:144` (таблица сообщений и «no reconnection»), `.docs/server-relay.md` (грейс, буфер, токены), `net/README.md`, `protocol/README.md` (handshake + версия), `.claude/skills/dd-net/SKILL.md`.

## Проверка

1. `npm run codegen -w protocol` — диффа после повторного прогона быть не должно.
2. `npm run build`, `npm test`, `npm run lint`, `npm run type-check` — всё чисто (последний обязателен: затронуты `protocol`/`net`/`server`).
3. `npm run e2e -w server` — включая новые сценарии.
4. Живьём: `npm run dev` + `npm run dev:relay`, две вкладки, матч.
   - **Пауза**: Space в одной вкладке → обе встают на одном тике; вторая жмёт Space → обе идут. Приказы в паузе не проходят. После снятия десинка нет (в консоли нет `[desync]`).
   - **Разрыв**: DevTools → Network → Offline на 5 с в одной вкладке. Ожидание: у второй «Переподключение…», у первой то же, обе стоят; после возврата онлайна матч продолжается с того же тика, `[desync]` не появляется.
   - **Истечение грейса**: offline > 20 с → у оставшегося обычный «Opponent left the match».
   - **Потолок залипания**: свернуть/заморозить одну вкладку > 60 с → матч закрывается, а не висит вечно.
