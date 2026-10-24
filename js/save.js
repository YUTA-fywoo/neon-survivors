// 本地存档：金币、永久强化、战绩、音效开关。只存在本机浏览器。
const Save = (() => {
  const KEY = 'neon_survivors_save_v1';
  const data = { coins: 0, meta: { hp: 0, dmg: 0, spd: 0 }, best: 0, wins: 0, runs: 0, muted: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      Object.assign(data, saved);
      data.meta = Object.assign({ hp: 0, dmg: 0, spd: 0 }, saved.meta);
    }
  } catch (e) { /* 隐私模式或存储被禁用时用默认值 */ }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
  }
  return { data, persist };
})();
