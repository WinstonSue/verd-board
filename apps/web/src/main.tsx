import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import '@sue/verd-board-ui/style.css';

import App from './app/app';
import { initializeAppearance } from '@sue/verd-board-ui';

initializeAppearance();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
