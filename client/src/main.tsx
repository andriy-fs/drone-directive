import { createRoot } from 'react-dom/client';
import './index.css';
import { loadDict } from './i18n/dictionaries';
import { Locale } from './i18n/locale';
import { useGameStore } from './store/gameStore';
import App from './ui/App.tsx';

// Locale dictionaries are code-split and `useT()` reads them synchronously, so the
// chosen language must be in memory before anything renders. That also keeps the
// first paint in the right language — no flash of English.
const locale = useGameStore.getState().locale;

loadDict(locale)
  .catch((error: unknown) => {
    // The chunk never arrived (offline, stale deploy). Fall back to English — load
    // first, then switch, so the store never names a locale that isn't in memory.
    // Not persisted: the player's saved choice survives for the next visit.
    console.error('[i18n] failed to load locale', locale, error);
    return loadDict(Locale.En).then((dict) => {
      useGameStore.setState({ locale: Locale.En });
      return dict;
    });
  })
  .then(() => {
    // Keep the app root free of React StrictMode. `GameApp` mounts Pixi + a ticker
    // in a side-effect, and StrictMode double-invokes effects in development, which
    // can race the async init / destroy cycle after a page refresh.
    createRoot(document.getElementById('root')!).render(<App />);
  })
  .catch((error: unknown) => console.error('[i18n] bootstrap failed', error));
