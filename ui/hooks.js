import {createContext, useContext, useEffect, useRef, useState} from 'react';

export const AppContext = createContext({paused: false, tick: 0, limits: null, api: null});

// Polls fn with an in-flight guard; stops while hidden unless hiddenInterval is set; honours the global pause.
export function usePoll(fn, {interval = 2000, hiddenInterval = null, enabled = true, deps = []} = {}) {
  const {paused, tick} = useContext(AppContext);
  const [result, setResult] = useState({data: null, error: null, state: 'loading', receivedAt: null});
  const [manual, setManual] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const hasData = useRef(false);
  useEffect(() => {
    if (!enabled || (paused && hasData.current)) return undefined;
    let dead = false, timer, busy = false;
    const schedule = () => {
      clearTimeout(timer);
      if (dead || paused) return;
      const ms = document.visibilityState === 'hidden' ? hiddenInterval : interval;
      if (ms) timer = setTimeout(run, ms);
    };
    async function run() {
      if (busy || dead) return;
      busy = true;
      try {
        const data = await fnRef.current();
        hasData.current = true;
        if (!dead) setResult({data, error: null, state: 'ready', receivedAt: Date.now()});
      } catch (error) {
        if (!dead) setResult(previous => ({...previous, error: error?.message || 'Request failed', state: 'error'}));
      }
      busy = false;
      schedule();
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); run(); } else schedule(); };
    document.addEventListener('visibilitychange', onVisibility);
    run();
    return () => { dead = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled, paused, tick, manual, interval, hiddenInterval, ...deps]);
  return {...result, refresh: () => setManual(n => n + 1)};
}

export function expectSchema(payload, schema) {
  if (!payload || payload.schema !== schema) throw new Error('Unsupported data from the HELIX engine');
  return payload;
}
