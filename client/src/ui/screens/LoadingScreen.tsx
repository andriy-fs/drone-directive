import { useState } from 'react';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/dict';
import { useGameStore } from '../../store/gameStore';
import { GameStatus } from '../../store/enums';
import { selectLocalSide, selectMatchBrief, selectStatus } from '../../store/selectors';
import { BotIcon, UserIcon, UsersIcon } from '../common/icons';

/**
 * The tips this screen rotates through, as dictionary keys. Its own list rather
 * than something derived from the dictionary: `Dict['loading']` also holds the
 * headings, and a `startsWith('tip')` filter over its keys would be a rule the
 * next person adding a heading has to know about. Adding a tip means adding a key
 * here and in `dict.ts` — which is also what keeps every language checked for it.
 */
const LOADING_TIPS = ['tip1', 'tip2', 'tip3', 'tip4', 'tip5', 'tip6'] as const satisfies readonly (keyof Dict['loading'])[];

/**
 * The screen between the title and the battlefield.
 *
 * It covers two waits that used to look identical from the player's side and were
 * both silent: building the world (a fraction of a second) and decoding the sprite
 * atlas the first time a match is asked for (a network fetch, on a cold cache the
 * longer of the two by far — see `GameApp.requestAssets`). Neither showed anything
 * at all, so pressing Start read as a button that had not worked.
 *
 * `GameApp` owns the timing, including the floor that keeps a fast build from
 * flashing this up and away again; all this component does is render whatever
 * briefing the bridge left in the store while `status` says `Loading`.
 *
 * The spinner turns on `transform`, and that is not decoration: a composited
 * transform animation keeps running on the compositor thread while the main
 * thread is blocked building the world. A spinner animated any other way would
 * freeze for exactly the interval it exists to cover.
 */
export function LoadingScreen() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const brief = useGameStore(selectMatchBrief);
  const localSide = useGameStore(selectLocalSide);
  // Picked once per mount, so a re-render (a snapshot landing behind the screen,
  // the locale changing) does not swap the tip out from under someone reading it.
  const [tip] = useState(() => LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]);

  if (status !== GameStatus.Loading) return null;

  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen__panel">
        <div className="loading-screen__spinner" aria-hidden="true" />
        <h2 className="loading-screen__title">{t('loading', 'title')}</h2>

        {brief && (
          <>
            <p className="loading-screen__map">
              {t('mapSize', 'label')}: <strong>{t('mapSize', brief.mapSize)}</strong>
            </p>
            <h3 className="loading-screen__heading">{t('loading', 'sides')}</h3>
            <ul className="loading-screen__sides">
              {brief.sides.map((side) => {
                // Three labels, in the order they can be told apart: the seat this
                // client plays first (which is `AI` for an online guest, so it has
                // to be checked before "is it a bot"), then the other human, then
                // everything the machine is flying.
                const you = side.owner === localSide;
                const Icon = you ? UserIcon : side.bot ? BotIcon : UsersIcon;
                const label = you ? 'you' : side.bot ? 'bot' : 'opponent';
                return (
                  <li
                    key={side.owner}
                    className={`loading-screen__side ${you ? 'loading-screen__side--you' : ''}`.trim()}
                  >
                    <Icon size={16} />
                    <span>{t('loading', label)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="loading-screen__tip">
          <span className="loading-screen__tip-label">{t('loading', 'tipLabel')}</span>
          <p className="loading-screen__tip-text">{t('loading', tip)}</p>
        </div>
      </div>
    </div>
  );
}
