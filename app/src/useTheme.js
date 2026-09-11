import { useSyncExternalStore } from 'react';
import { createThemeStore } from './theme.js';

const theme = createThemeStore(window);

export function useTheme() {
  const preference = useSyncExternalStore(theme.subscribe, theme.getSnapshot);
  return [preference, theme.setPreference];
}
