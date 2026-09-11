import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * One shared Server-Sent Events connection for the whole app. Every open
 * screen subscribes to the event types it cares about and refetches; if the
 * stream drops, the browser reconnects, and a 30-second poll covers the gap.
 */
let source = null;
const listeners = new Set();
let connected = false;
const connectionListeners = new Set();

function ensureStream() {
  if (source) return;
  source = new EventSource('/api/events', { withCredentials: true });
  const handler = (type) => (ev) => {
    let data = null;
    try { data = JSON.parse(ev.data); } catch { data = null; }
    for (const l of listeners) l({ type, ...(data || {}) });
  };
  for (const type of ['order', 'alert', 'call', 'menu', 'customer', 'settings']) source.addEventListener(type, handler(type));
  // On every (re)connection, every screen refetches: events sent while the
  // connection was down (a sleeping tablet, a network blip) are not lost.
  source.addEventListener('hello', () => {
    const wasDown = !connected;
    connected = true;
    for (const l of connectionListeners) l(true);
    if (wasDown) for (const l of listeners) l({ type: 'reconnect' });
  });
  source.onerror = () => { connected = false; for (const l of connectionListeners) l(false); };
}

export function useLiveConnection() {
  const [live, setLive] = useState(connected);
  useEffect(() => { ensureStream(); connectionListeners.add(setLive); return () => { connectionListeners.delete(setLive); }; }, []);
  return live;
}

/** Fetches `url` and refetches on any live event whose type is in `types`. */
export function useLiveQuery(url, types, pick = (d) => d, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [lastEvent, setLastEvent] = useState(null);
  const timer = useRef(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const load = useCallback(async () => {
    try { setData(pickRef.current(await api.get(url))); setError(''); }
    catch (e) { setError(e.message); setData((d) => d ?? pickRef.current({})); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    ensureStream();
    const listener = (e) => {
      if (e.type !== 'reconnect' && !types.includes(e.type)) return;
      setLastEvent(e);
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 200);
    };
    listeners.add(listener);
    const poll = setInterval(load, 30000);
    return () => { listeners.delete(listener); clearInterval(poll); clearTimeout(timer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, types.join(',')]);

  return { data, error, lastEvent, reload: load };
}
