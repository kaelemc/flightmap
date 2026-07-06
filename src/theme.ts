import { createTheme } from '@mui/material/styles';

/*
 * Flightmap is a subpage of kaelem.blog and wears its design language
 * (see ~/blog/src/mui-theme.ts + global.css): one accent — Nokia blue,
 * hovers derived from it, never a second hue — pure black surfaces,
 * sharp corners, JetBrains Mono body, Handjet pixel display type.
 * Dark only, by prior decision.
 */

export const PIXEL = '"Handjet", "JetBrains Mono", monospace';
export const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
export const SANS = '"Inter", system-ui, -apple-system, "Helvetica Neue", sans-serif';
/** brand wordmark typeface (the flightmap lockup) */
export const BRAND = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';

const NOKIA = '#005aff';
// the blog's --accent-hover: color-mix(in srgb, accent 70%, #fff)
const NOKIA_BRIGHT = '#4d8cff';

/** square-outlined icon button, matching the blog's chrome */
export const OUTLINE_BTN_SX = {
  borderRadius: 0,
  border: '1px solid #3f3f3f',
  p: '0.4rem',
  '&:hover': { borderColor: 'text.secondary', bgcolor: 'transparent' },
} as const;

export const MAP_COLORS = {
  surface: '#000000',
  routeDim: 'rgba(163, 163, 163, 0.45)',
  routeSelected: NOKIA_BRIGHT,
  airport: NOKIA_BRIGHT,
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#000000', paper: '#0a0a0a' },
    primary: { main: NOKIA, contrastText: '#ffffff' },
    info: { main: NOKIA_BRIGHT },
    success: { main: '#64d2ff' },
    warning: { main: '#ffb454' },
    error: { main: '#ff5c5c' },
    divider: '#262626',
    text: { primary: '#f5f5f5', secondary: '#a3a3a3' },
    action: { hover: 'rgba(0, 90, 255, 0.14)' },
  },
  shape: { borderRadius: 0 },
  typography: {
    // sans for prose and labels; mono stays for data, buttons and codes
    fontFamily: SANS,
    fontSize: 13,
    button: {
      fontFamily: MONO,
      fontWeight: 500,
      fontSize: '0.78rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: { defaultProps: { disableElevation: true } },
    // compact inputs everywhere — the editor form is dense, and the rest of
    // the app already asked for size="small" explicitly
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          backgroundImage: 'none',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { border: '1px solid #3f3f3f' },
      },
    },
    MuiFab: { styleOverrides: { root: { borderRadius: 0 } } },
    MuiAutocomplete: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        paper: {
          backgroundColor: '#0a0a0a',
          border: '1px solid #3f3f3f',
        },
        listbox: {
          maxHeight: 320,
          // keep wheel events inside the list instead of scrolling the page
          overscrollBehavior: 'contain',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: '#0a0a0a',
          border: '1px solid #3f3f3f',
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        track: { borderRadius: 0 },
        thumb: { borderRadius: 0, boxShadow: 'none' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#0a0a0a',
          border: '1px solid #3f3f3f',
          borderRadius: 0,
          fontFamily: MONO,
          fontSize: 11,
        },
      },
    },
    MuiChip: { styleOverrides: { label: { fontFamily: MONO } } },
  },
});

export default theme;
