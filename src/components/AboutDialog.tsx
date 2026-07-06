import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import GitHub from '@mui/icons-material/GitHub';
import { BRAND, OUTLINE_BTN_SX } from '../theme';

const GITHUB_URL = 'https://github.com/kaelemc/flightmap';

/** "About" modal — shared by the app navbar and the read-only share viewer */
export default function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            component="img"
            src="/branding/flightmap-mark-white.svg"
            alt=""
            sx={{ height: 22, width: 'auto', display: 'block' }}
          />
          <Typography
            sx={{ fontFamily: BRAND, fontWeight: 600, fontSize: 21, lineHeight: 1, letterSpacing: '-0.01em' }}
          >
            flightmap
          </Typography>
        </Stack>
        <IconButton aria-label="Close" onClick={onClose} size="small">
          <CloseRounded fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 0.75 }}>
          A free and open-source flight log. Fully client-side.
        </DialogContentText>
        <DialogContentText sx={{ mb: 2 }}>
          By{' '}
          <Link href="https://ls.cd" target="_blank" rel="noreferrer" sx={{ color: 'primary.main' }}>
            Kaelem Chandra
          </Link>
          .
        </DialogContentText>
        <Button
          component="a"
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          startIcon={<GitHub />}
          sx={{ ...OUTLINE_BTN_SX, px: 1.5, py: 0.5, color: 'text.primary' }}
        >
          GitHub
        </Button>
      </DialogContent>
    </Dialog>
  );
}
