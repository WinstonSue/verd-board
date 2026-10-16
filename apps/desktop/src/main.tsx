import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import './styles.scss';
import '@sue/verd-board-ui/style.css';

import App from './app/app';

// Stylesheets in the document head block this module until fonts.googleapis.com
// responds. Attach them after startup so the local bundle can paint first.
const fontStylesheets = [
  'https://fonts.googleapis.com/css2?family=Assistant:wght@200;300;400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100;300;400;500;700;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;300;400;500;600;700;900&display=swap',
];
for (const href of fontStylesheets) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
