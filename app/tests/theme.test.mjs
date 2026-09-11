import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createThemeStore, THEME_KEY } from '../src/theme.js';

function environment({ saved = null, dark = false, blocked = false } = {}) {
  const values = new Map(saved ? [[THEME_KEY, saved]] : []);
  const browser = new EventTarget();
  const media = new EventTarget(); media.matches = dark;
  browser.matchMedia = () => media;
  browser.document = { documentElement: { dataset: {}, style: {} } };
  browser.localStorage = {
    getItem(key) { if (blocked) throw new Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage denied'); values.set(key, value); },
  };
  return { browser, media, values, root: browser.document.documentElement };
}

test('System follows appearance changes; an explicit choice stays fixed', () => {
  const { browser, media, root, values } = environment();
  const store = createThemeStore(browser);
  const unsubscribe = store.subscribe(() => {});
  assert.equal(root.dataset.theme, 'light');
  media.matches = true; media.dispatchEvent(new Event('change'));
  assert.equal(root.dataset.theme, 'dark');
  store.setPreference('light');
  assert.equal(values.get(THEME_KEY), 'light');
  media.dispatchEvent(new Event('change'));
  assert.equal(root.dataset.theme, 'light');
  store.setPreference('system');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.colorScheme, 'dark');
  unsubscribe();
});

test('Light and Dark survive a fresh store regardless of device appearance', () => {
  for (const preference of ['light', 'dark']) {
    const { browser, root } = environment({ dark: preference === 'light' });
    createThemeStore(browser).setPreference(preference);
    const restored = createThemeStore(browser);
    assert.equal(restored.getSnapshot(), preference);
    assert.equal(root.dataset.theme, preference);
  }
});

test('Other tabs synchronize the choice and reset to System when storage is cleared', () => {
  const { browser, root, values } = environment();
  const store = createThemeStore(browser);
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  values.set(THEME_KEY, 'dark');
  const event = new Event('storage'); event.key = THEME_KEY;
  browser.dispatchEvent(event);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(store.getSnapshot(), 'dark');
  assert.equal(changes, 1);
  values.clear();
  const clear = new Event('storage'); clear.key = null;
  browser.dispatchEvent(clear);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(store.getSnapshot(), 'system');
  unsubscribe();
});

test('Blocked storage still allows an immediate session theme and reports it was not saved', () => {
  const { browser, root } = environment({ blocked: true });
  const store = createThemeStore(browser);
  store.subscribe(() => {});
  assert.equal(store.setPreference('dark'), false);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(store.getSnapshot(), 'dark');
});

test('Subscriptions clean up and reconnect without duplicate notifications', () => {
  const { browser, media, root } = environment();
  const store = createThemeStore(browser);
  const stop = store.subscribe(() => {}); stop();
  media.matches = true; media.dispatchEvent(new Event('change'));
  assert.equal(root.dataset.theme, 'light');
  let changes = 0;
  const stopAgain = store.subscribe(() => changes++);
  assert.equal(root.dataset.theme, 'dark');
  store.setPreference('light');
  assert.equal(changes, 1);
  stopAgain();
});

test('The pre-paint bootstrap and app agree for all preferences, invalid data, and denied storage', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const saved of [null, 'light', 'dark', 'system', 'invalid']) {
    for (const dark of [true, false]) {
      for (const blocked of [true, false]) {
        const { browser, root } = environment({ saved, dark, blocked });
        runInNewContext(bootstrap, browser);
        const firstPaint = root.dataset.theme;
        const store = createThemeStore(browser);
        assert.equal(root.dataset.theme, firstPaint);
        assert.equal(store.getSnapshot(), blocked || !['light', 'dark'].includes(saved) ? 'system' : saved);
      }
    }
  }
});
