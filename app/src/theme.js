export const THEME_KEY = 'replay.appearance';
const normalize = value => ['light', 'system', 'dark'].includes(value) ? value : 'system';

// One preference for the whole workspace, including dialogs and other tabs.
export function createThemeStore(browser) {
  const media = browser.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  let preference = read();

  function read() {
    try { return normalize(browser.localStorage.getItem(THEME_KEY)); }
    catch { return 'system'; }
  }
  function apply() {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    browser.document.documentElement.dataset.theme = theme;
    browser.document.documentElement.style.colorScheme = theme;
  }
  function sync() { preference = read(); apply(); listeners.forEach(listener => listener()); }
  function storageChanged(event) {
    if (event.key === THEME_KEY || event.key === null) sync();
  }
  apply();

  return {
    getSnapshot: () => preference,
    subscribe(listener) {
      if (!listeners.size) {
        media.addEventListener('change', apply);
        browser.addEventListener('storage', storageChanged);
        sync();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          media.removeEventListener('change', apply);
          browser.removeEventListener('storage', storageChanged);
        }
      };
    },
    setPreference(value) {
      preference = normalize(value);
      let persisted = true;
      try { browser.localStorage.setItem(THEME_KEY, preference); }
      catch { persisted = false; }
      apply(); listeners.forEach(listener => listener());
      return persisted;
    },
  };
}
