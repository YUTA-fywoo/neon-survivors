// 埋点面板：把本机事件汇总成关卡漏斗、死亡点、广告漏斗和原始事件流。
// 打开方式：主菜单 / 暂停 / 结算里的「埋点面板」按钮，或键盘 ` / F2。
const Debug = (() => {
  const $ = id => document.getElementById(id);
  const panel = $('debug'), body = $('dbg-body'), verSel = $('dbg-ver');
  const WAVES = CONFIG.run.waves;
  const PLACEMENTS = ['start_boost', 'take_all', 'reroll', 'chest_more', 'wave_drop', 'revive', 'double_coins'];
  let open = false;
  let ver = 'all';
  let pending = null;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const mmss = s => {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const waveName = w => (w > WAVES ? 'Boss 战' : `第 ${w} 波`);
  const enemyName = k => (CONFIG.enemies[k] || CONFIG.hazards[k] || { name: k }).name;

  function summarize(all) {
    const evs = ver === 'all' ? all : all.filter(e => e.ver === ver);
    const runs = new Map();
    const getRun = id => {
      let r = runs.get(id);
      if (!r) { r = { started: false, wave: 0, boss: false, win: false, end: null, cheat: false, revived: 0 }; runs.set(id, r); }
      return r;
    };
    const deaths = [];
    const ads = {};
    for (const p of PLACEMENTS) ads[p] = { ad_offer: 0, ad_click: 0, ad_no_fill: 0, ad_play: 0, ad_complete: 0, ad_close_early: 0, ad_reward: 0 };
    for (const e of evs) {
      if (!e.run) continue;
      const r = getRun(e.run);
      if (e.e === 'game_start') r.started = true;
      else if (e.e === 'wave_reach') r.wave = Math.max(r.wave, e.wave);
      else if (e.e === 'boss_spawn') r.boss = true;
      else if (e.e === 'game_win') r.win = true;
      else if (e.e === 'game_end') r.end = e;
      else if (e.e === 'cheat') r.cheat = true;
      else if (e.e === 'revive') r.revived++;
      else if (e.e === 'player_death') deaths.push(e);
    }
    const valid = new Map([...runs].filter(([, r]) => r.started && !r.cheat));
    const vr = [...valid.values()];
    const cheatRuns = [...runs.values()].filter(r => r.started && r.cheat).length;
    for (const e of evs) {   // 广告事件同样只算有效局；开局增益发生在开局之前，没有局 id，单独算
      if (e.e.startsWith('ad_') && ads[e.placement] && (valid.has(e.run) || (!e.run && e.placement === 'start_boost'))) ads[e.placement][e.e]++;
    }

    const steps = [{ label: '开局', n: vr.length }];
    for (let w = 2; w <= WAVES; w++) steps.push({ label: `第 ${w} 波`, n: vr.filter(r => r.wave >= w).length });
    steps.push({ label: 'Boss 战', n: vr.filter(r => r.boss).length });
    steps.push({ label: '通关', n: vr.filter(r => r.win).length });

    const finished = vr.filter(r => r.end && r.end.result !== 'quit');
    const avgT = finished.length ? finished.reduce((s, r) => s + r.end.t, 0) / finished.length : 0;
    const vDeaths = deaths.filter(d => valid.has(d.run));
    const byWave = Array(WAVES + 2).fill(0);
    const killers = {};
    for (const d of vDeaths) {
      byWave[Math.min(d.wave, WAVES + 1)]++;
      killers[d.killer] = (killers[d.killer] || 0) + 1;
    }
    const rewards = PLACEMENTS.reduce((s, p) => s + ads[p].ad_reward, 0);
    const revives = vr.reduce((s, r) => s + r.revived, 0);
    return {
      runs: vr.length, cheatRuns, steps, finished: finished.length, wins: vr.filter(r => r.win).length, avgT,
      deaths: vDeaths, byWave, killers, ads, rewards, revives,
      avgDeathLv: vDeaths.length ? vDeaths.reduce((s, d) => s + d.lv, 0) / vDeaths.length : 0,
      avgDeathT: vDeaths.length ? vDeaths.reduce((s, d) => s + d.t, 0) / vDeaths.length : 0,
    };
  }

  const empty = msg => `<p class="note">${msg || '还没有数据，先玩一局。'}</p>`;
  const barRow = (label, frac, val, title) =>
    `<div class="frow" title="${esc(title)}"><span class="lab">${label}</span>`
    + `<div class="bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><span class="val">${val}</span></div>`;

  function tilesHtml(s) {
    const tile = (v, k) => `<div class="tile"><b>${v}</b><span>${k}</span></div>`;
    return `<div class="tiles">${[
      tile(s.runs, '有效局数'),
      tile(s.finished ? pct(s.wins, s.finished) + '%' : '–', '通关率'),
      tile(s.finished ? mmss(s.avgT) : '–', '平均每局时长'),
      tile(s.runs ? (s.rewards / s.runs).toFixed(1) : '–', '局均看完广告'),
    ].join('')}</div>`
      + (s.cheatRuns ? `<p class="note">另有 ${s.cheatRuns} 局用过调试工具，已排除在漏斗和死亡统计之外。</p>` : '');
  }

  function funnelHtml(s) {
    const base = s.steps[0].n;
    if (!base) return `<h3>关卡进度漏斗</h3>${empty()}`;
    let worst = -1, worstDrop = 0;
    for (let i = 1; i < s.steps.length; i++) {
      const prev = s.steps[i - 1].n;
      const drop = prev ? 1 - s.steps[i].n / prev : 0;
      if (drop > worstDrop) { worstDrop = drop; worst = i; }
    }
    const rows = s.steps.map((st, i) => {
      const prev = i ? s.steps[i - 1].n : st.n;
      const conv = pct(st.n, prev);
      const row = barRow(st.label, st.n / base, `${st.n} <em>· ${pct(st.n, base)}%</em>`,
        `${st.label}：${st.n} 局，占开局 ${pct(st.n, base)}%，较上一步 ${conv}%`);
      const flag = i === worst ? `<p class="drop">↑ 流失最多的一步：从上一步到这里只剩 ${conv}%</p>` : '';
      return row + flag;
    });
    return `<h3>关卡进度漏斗 <small>按局去重，复活后继续算同一局</small></h3>${rows.join('')}`;
  }

  function deathsHtml(s) {
    if (!s.deaths.length) return `<h3>死亡点</h3>${empty('还没有死亡记录。')}`;
    const max = Math.max(1, ...s.byWave.slice(1));
    let rows = '';
    for (let w = 1; w <= WAVES + 1; w++) {
      const n = s.byWave[w];
      rows += barRow(waveName(w), n / max, `${n} <em>次</em>`, `${waveName(w)}死亡 ${n} 次，占 ${pct(n, s.deaths.length)}%`);
    }
    const kl = Object.entries(s.killers).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `<tr><td>${esc(enemyName(k))}</td><td>${n}</td><td>${pct(n, s.deaths.length)}%</td></tr>`).join('');
    return `<h3>死亡点 <small>共 ${s.deaths.length} 次 · 平均 ${mmss(s.avgDeathT)} · 平均 Lv ${s.avgDeathLv.toFixed(1)}</small></h3>${rows}`
      + `<table class="tbl"><thead><tr><th>最后一击来自</th><th>次数</th><th>占比</th></tr></thead><tbody>${kl}</tbody></table>`;
  }

  function adsHtml(s) {
    const A = s.ads;
    const counts = PLACEMENTS.map(p => {
      const a = A[p];
      return `<tr><td>${Ads.NAMES[p]}</td><td>${a.ad_offer}</td><td>${a.ad_click}</td><td>${a.ad_play}</td><td>${a.ad_reward}</td></tr>`;
    }).join('');
    const rates = PLACEMENTS.map(p => {
      const a = A[p];
      const r = (x, y) => (y ? pct(x, y) + '%' : '–');
      return `<tr><td>${Ads.NAMES[p]}</td><td>${r(a.ad_click, a.ad_offer)}</td><td>${r(a.ad_play, a.ad_click)}</td><td>${r(a.ad_reward, a.ad_play)}</td></tr>`;
    }).join('');
    const noFill = PLACEMENTS.reduce((n, p) => n + A[p].ad_no_fill, 0);
    const early = PLACEMENTS.reduce((n, p) => n + A[p].ad_close_early, 0);
    return `<h3>激励视频漏斗 <small>模拟广告</small></h3>`
      + `<table class="tbl"><thead><tr><th>广告位</th><th>入口曝光</th><th>点击</th><th>播放</th><th>发奖</th></tr></thead><tbody>${counts}</tbody></table>`
      + `<table class="tbl"><thead><tr><th>广告位</th><th>点击率</th><th>填充率</th><th>看完率</th></tr></thead><tbody>${rates}</tbody></table>`
      + `<p class="note">无填充 ${noFill} 次 · 中途放弃 ${early} 次 · 复活 ${s.revives} 次。点击率 = 点击 / 入口曝光；填充率 = 播放 / 点击；看完率 = 发奖 / 播放。</p>`;
  }

  function botHtml() {
    const rows = Bot.summary();
    if (!rows.length) return `<h3>Bot 回归 <small>按版本</small></h3>${empty('还没跑过，点下方「Bot 自动试玩 5 局」。')}`;
    const body = rows.map(r => `<tr><td>v${esc(r.ver)}${r.ads ? ' 看广告' : ''}</td><td>${r.n}</td><td>${mmss(r.avgT)}</td><td>${r.avgLv.toFixed(1)}</td>`
      + `<td>${pct(r.boss, r.n)}%</td><td>${pct(r.wins, r.n)}%</td><td>${r.minHp == null ? '–' : Math.round(r.minHp * 100) + '%'}</td></tr>`).join('');
    const recent = Bot.results().slice(-5).reverse().map(r =>
      `v${r.ver}${r.ads ? ' 看广告' : ''} ${mmss(r.t)} Lv${r.lv} ${r.win ? '通关' : r.timeout ? `${waveName(r.wave)} 超时` : `${waveName(r.wave)} 死于${enemyName(r.killer)}`}${r.bossLeft != null ? `（Boss 剩 ${r.bossLeft}%）` : ''}`);
    return `<h3>Bot 回归 <small>按版本，新玩家无永久强化；“看广告”= 每个广告位都看</small></h3>`
      + `<table class="tbl"><thead><tr><th>版本</th><th>局数</th><th>平均存活</th><th>平均等级</th><th>到 Boss</th><th>通关</th><th>最低血量</th></tr></thead><tbody>${body}</tbody></table>`
      + `<pre class="log">${esc(recent.join('\n'))}</pre>`;
  }

  function logHtml(all) {
    const skip = new Set(['e', 'ts', 'sid', 'ver', 'run']);
    const lines = all.slice(-40).reverse().map(e => {
      const t = new Date(e.ts).toTimeString().slice(0, 8);
      const props = Object.entries(e).filter(([k]) => !skip.has(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
      return `${t}  ${e.e}  ${props}`;
    });
    return `<h3>最近事件 <small>共 ${all.length} 条，显示最近 40 条</small></h3><pre class="log">${esc(lines.join('\n')) || '（空）'}</pre>`;
  }

  function render() {
    pending = null;
    const all = Analytics.all();
    const vers = [...new Set(all.map(e => e.ver))].sort();
    if (ver !== 'all' && !vers.includes(ver)) ver = 'all';
    verSel.innerHTML = `<option value="all">全部版本</option>`
      + vers.map(v => `<option value="${esc(v)}"${v === ver ? ' selected' : ''}>v${esc(v)}</option>`).join('');
    const s = summarize(all);
    body.innerHTML = tilesHtml(s) + funnelHtml(s) + deathsHtml(s) + adsHtml(s) + botHtml() + logHtml(all);
    $('dbg-fill').value = String(Ads.settings.fillRate);
    $('dbg-dur').value = String(Ads.settings.duration);
    $('dbg-god').checked = Game.godMode;
  }

  function toggle(force) {
    open = force === undefined ? !open : !!force;
    panel.hidden = !open;
    if (open) {
      if (Game.state === 'play') Game.pause();
      render();
    }
  }

  Analytics.onEvent(() => {
    if (open && !pending) pending = setTimeout(render, 300);
  });

  verSel.addEventListener('change', () => { ver = verSel.value; render(); });
  $('dbg-close').onclick = () => toggle(false);
  $('dbg-fill').onchange = e => Ads.set('fillRate', Number(e.target.value));
  $('dbg-dur').onchange = e => Ads.set('duration', Number(e.target.value));
  $('dbg-god').onchange = e => Game.cheat('god', e.target.checked);
  $('dbg-boss').onclick = () => { Game.cheat('boss'); toggle(false); Game.resume(); };
  $('dbg-lv').onclick = () => { Game.cheat('level'); toggle(false); Game.resume(); };
  $('dbg-bot').onclick = async () => {
    if (Bot.isBusy()) return;
    UI.toast('Bot 试玩中 0/5…');
    await Bot.run(5, (i, n) => UI.toast(`Bot 试玩中 ${i}/${n}…`));
    UI.toast('Bot 试玩完成');
    toggle(true);
  };
  $('dbg-bot-ads').onclick = async () => {
    if (Bot.isBusy()) return;
    UI.toast('Bot 试玩中（全看广告）0/5…');
    await Bot.run(5, (i, n) => UI.toast(`Bot 试玩中（全看广告）${i}/${n}…`), { ads: true });
    UI.toast('Bot 试玩完成');
    toggle(true);
  };
  $('dbg-bot-clear').onclick = () => { Bot.clear(); render(); };
  $('dbg-export').onclick = () => {
    const blob = new Blob([JSON.stringify(Analytics.all(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `neon-survivors-events-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('dbg-clear').onclick = () => {
    if (confirm('清空本机所有埋点事件？（存档和金币不受影响）')) { Analytics.clear(); render(); }
  };
  document.addEventListener('click', e => { if (e.target.closest('[data-open-debug]')) toggle(true); });

  return { toggle, isOpen: () => open };
})();
