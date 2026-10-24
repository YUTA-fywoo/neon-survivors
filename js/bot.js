// 自动试玩 bot：用“躲最近的威胁 + 安全时去捡经验”的简单策略连打几局，给数值改动做回归对比。
// 默认不看广告、不复活；“全看广告”模式下每个广告位都看（广告直接算看完），用来检查广告奖励加上威胁度以后强了多少。
// 它的局打 cheat 标记，不进玩家漏斗；跑完把存档（金币、强化、战绩）原样还原。
const Bot = (() => {
  const KEY = 'neon_survivors_bot_v1';
  const PRIO = ['bolt', 'orbit', 'chain', 'missile', 'laser', 'cluster', 'pulse', 'power', 'haste', 'maxhp', 'volatile', 'magnet', 'speed', 'regen', 'heal', 'gold'];
  const SAFE_R = 110;   // 这个距离内没有敌人和子弹时，bot 才去捡经验
  let results = [];
  try { results = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { results = []; }

  // Boss 战按真人的打法：贴近 Boss 打（近身武器也打得到），开护盾时直奔最近的发生器，冲撞预警时往通道外侧闪，只顺手捡身边的经验。
  // 黑洞范围里顶着吸力往外跑，陨石准星亮起来就躲开
  function decide(S) {
    const p = S.p, boss = S.boss;
    let fx = 0, fy = 0, danger = false, pyl = null;
    if (boss && boss.shield) {
      let bd = Infinity;
      for (const e of S.enemies) {
        if (e.type !== 'pylon' || e.dead) continue;
        const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d2 < bd) { bd = d2; pyl = e; }
      }
    }
    for (const e of S.enemies) {
      const dx = p.x - e.x, dy = p.y - e.y, d2 = dx * dx + dy * dy, safe = SAFE_R + e.r;
      if (e.type === 'boss') {
        const d = Math.sqrt(d2) || 1, want = e.shield ? 0 : 115, close = e.shield ? 100 : want * 0.75;
        const k = want && d > want ? -0.02 - 0.00005 * (d - want) : d < close ? 0.02 : 0;   // 离得越远拉得越狠，不然会被躲子弹推得越来越远
        fx += (dx / d) * k;
        fy += (dy / d) * k;
        if (e.ai.mode === 'windup' || e.ai.mode === 'dash') {
          const along = dx * e.ai.dx + dy * e.ai.dy, side = dx * -e.ai.dy + dy * e.ai.dx;
          if (along > -e.r && Math.abs(side) < e.r + 50) { const sg = side < 0 ? -1 : 1; fx += -e.ai.dy * sg * 0.05; fy += e.ai.dx * sg * 0.05; danger = true; }
        }
        if (d2 < safe * safe) danger = true;
        continue;
      }
      if (e.type === 'pylon') {
        if (e === pyl && d2 > 70 * 70) { const d = Math.sqrt(d2), k = 0.025 + 0.00005 * (d - 70); fx -= (dx / d) * k; fy -= (dy / d) * k; }
        continue;
      }
      if (d2 > 260 * 260) continue;
      const w = (e.type === 'boss' ? 4 : 1) / (d2 + 1);
      fx += dx * w;
      fy += dy * w;
      if (d2 < safe * safe) danger = true;
    }
    for (const b of S.ebullets) {
      const dx = p.x - b.x, dy = p.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 > 140 * 140) continue;
      danger = true;
      fx += (dx * 3) / (d2 + 1);
      fy += (dy * 3) / (d2 + 1);
    }
    const HR = CONFIG.hole.radius, M = CONFIG.meteor;
    for (const h of S.holes) {
      const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1;
      if (d > HR) continue;
      danger = true;
      fx += (dx / d) * (0.004 + 0.03 * (1 - d / HR));
      fy += (dy / d) * (0.004 + 0.03 * (1 - d / HR));
    }
    for (const m of S.meteors) {
      if (m.t < M.warn * 0.3) continue;
      const dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (d > M.radius + 30) continue;
      danger = true;
      fx += (dx / d) * 0.03;
      fy += (dy / d) * 0.03;
    }
    if (!danger) {
      let target = null, best = (boss ? 130 : 400) ** 2;
      for (const q of S.gems.concat(S.pickups)) {
        const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d2 < best) { best = d2; target = q; }
      }
      if (target) { fx = target.x - p.x; fy = target.y - p.y; }
    }
    const m = Math.hypot(fx, fy);
    return m > 1e-7 ? { x: fx / m, y: fy / m } : null;
  }

  const yieldFrame = () => new Promise(r => setTimeout(r, 0));

  async function runOnce(maxT, ads) {
    Game.start({ boost: ads });
    Game.cheat('bot');
    const S = Game.run;
    let minHp = 1;
    for (let frames = 0, n = 0; frames < maxT * 60; n++) {
      if (n % 150 === 149) await yieldFrame();   // 隔一阵让出主线程，页面不会卡死
      const st = Game.state;
      if (st === 'levelup') {
        if (ads && !S.boostPick && S.takeAlls < CONFIG.ads.takeAllLimit) { Game.takeAll(); continue; }
        Game.pick([...S.choices].sort((a, b) => PRIO.indexOf(a) - PRIO.indexOf(b))[0]);
        continue;
      }
      if (st === 'chest') { if (ads) Game.chestMore(); Game.chestTake(); continue; }
      if (st === 'revive') { if (ads) Game.reviveWithAd(); else Game.giveUp(); }
      if (ads && st === 'play' && S.drop) Game.claimDrop();
      if (st === 'paused') Game.resume();   // 页面切到后台会自动暂停，bot 直接继续
      if (Game.state === 'result') break;
      // 有主动技能时，身边敌人多或血量低就放掉
      if (S.skill && (S.p.hp < S.st.maxHp * 0.35 || S.enemies.filter(e => !e.dead && (e.x - S.p.x) ** 2 + (e.y - S.p.y) ** 2 < 160 * 160).length >= 8)) Game.useSkill();
      Game.setAutoMove(decide(S));
      Game.step(6);   // 每 0.1 秒做一次决定
      frames += 6;
      if (S.st) minHp = Math.min(minHp, Math.max(0, S.p.hp / S.st.maxHp));
    }
    Game.setAutoMove(null);
    const win = S.ended && !S.boss && S.bossSpawned;
    const timeout = !S.ended;   // 打满 maxT 还没结束
    return { ver: VERSION, ads: !!ads, ts: Date.now(), t: Math.round(S.t), lv: S.level, kills: S.kills, wave: S.wave + 1, win, timeout,
             killer: win || timeout ? null : S.lastHit, bossLeft: S.boss ? Math.round((S.boss.hp / S.boss.maxHp) * 100) : null,
             threat: Math.round(S.threat * 100) / 100, minHp: Math.round(minHp * 100) / 100, revives: S.revives };
  }

  let busy = false;
  async function run(n = 5, onProgress, opts = {}) {
    if (busy) return [];
    busy = true;
    const realShow = Ads.show;
    if (opts.ads) Ads.show = (placement, props, done) => done(true);   // 广告直接算看完
    const snapshot = JSON.stringify(Save.data);
    Save.data.meta = { hp: 0, dmg: 0, spd: 0 };   // 按没有永久强化的新玩家来测
    Save.data.muted = true;
    const out = [];
    try {
      for (let i = 0; i < n; i++) {
        out.push(await runOnce(420, !!opts.ads));
        if (onProgress) onProgress(i + 1, n);
      }
    } finally {
      Ads.show = realShow;
      Game.setAutoMove(null);
      Object.assign(Save.data, JSON.parse(snapshot));
      Save.persist();
      Game.home();
      busy = false;
    }
    results = results.concat(out).slice(-200);
    try { localStorage.setItem(KEY, JSON.stringify(results)); } catch (e) { /* 忽略 */ }
    return out;
  }

  // 按版本（和是否看广告）汇总，方便对比改数值前后
  function summary() {
    const by = {};
    for (const r of results) { const k = r.ver + (r.ads ? '|ads' : ''); (by[k] = by[k] || []).push(r); }
    return Object.entries(by).map(([k, rs]) => ({
      ver: rs[0].ver,
      ads: !!rs[0].ads,
      n: rs.length,
      minHp: rs.some(r => r.minHp != null) ? rs.reduce((s, r) => s + (r.minHp || 0), 0) / rs.length : null,
      avgT: rs.reduce((s, r) => s + r.t, 0) / rs.length,
      avgLv: rs.reduce((s, r) => s + r.lv, 0) / rs.length,
      boss: rs.filter(r => r.wave > CONFIG.run.waves).length,
      wins: rs.filter(r => r.win).length,
    }));
  }

  function clear() {
    results = [];
    try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
  }

  return { run, summary, clear, results: () => results, isBusy: () => busy };
})();
