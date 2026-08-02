import { createRoot } from 'react-dom/client';
import './index.css';
import App from './ui/App.tsx';

// Keep the app root free of React StrictMode. `GameApp` mounts Pixi + a ticker
// in a side-effect, and StrictMode double-invokes effects in development, which
// can race the async init / destroy cycle after a page refresh.
createRoot(document.getElementById('root')!).render(<App />);
