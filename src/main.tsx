import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import '@fontsource/handjet/400.css';
import '@fontsource/handjet/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import 'leaflet/dist/leaflet.css';
import './index.css';

import theme from './theme';
import App from './App';
import ShareView from './ShareView';
import { parseShareLocation } from './lib/share';

// #/share/<version>/<token> opens a standalone read-only viewer; anything else
// is the app. The token rides in the hash (never sent to the server), so a
// large log won't 431 and no SPA rewrite is needed. The viewer never mounts
// App, so it can't touch the owner's saved log.
const share = parseShareLocation();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {share ? <ShareView version={share.version} token={share.token} /> : <App />}
    </ThemeProvider>
  </React.StrictMode>
);
