// 本地埋点：事件只写进本机 localStorage，不上传任何服务器。
// 每条事件带 e（事件名）、ts（时间戳）、sid（本次打开页面）、ver（数值版本），其余字段按事件不同。
const Analytics = (() => {
  const KEY = 'neon_survivors_events_v1';
  const MAX = 6000;
  const listeners = [];
  const sessionId = Math.random().toString(36).slice(2, 10);
  let events = [];
  let saveTimer = null;

  try { events = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { events = []; }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(events)); } catch (e) { /* 存储满或被禁用 */ }
  }

  function track(name, props) {
    const ev = Object.assign({ e: name, ts: Date.now(), sid: sessionId, ver: VERSION }, props);
    events.push(ev);
    if (events.length > MAX) events.splice(0, events.length - MAX);
    if (!saveTimer) saveTimer = setTimeout(save, 400);
    for (const fn of listeners) fn(ev);
    return ev;
  }

  function count(name) {
    let n = 0;
    for (const ev of events) if (ev.e === name) n++;
    return n;
  }

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  return {
    track,
    count,
    all: () => events,
    onEvent: fn => listeners.push(fn),
    clear() { events = []; save(); },
  };
})();
