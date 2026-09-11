import { useEffect, useState } from 'react';
import { api } from './lib.js';

export function useLocalActivity(enabled = true) {
  const [state, setState] = useState({ rows: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false, inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await api(`/analytics?days=30&timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`);
        if (!cancelled) setState({ rows: data.content, error: false });
      } catch { if (!cancelled) setState({ rows: null, error: true }); }
      finally { inFlight = false; }
    }
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enabled]);
  return state;
}
