// 霓虹幸存者 · 界面：HUD、主菜单与永久强化、升级三选一、宝箱、复活、结算、暂停、横幅与提示，以及各处的广告入口
const UI = (() => {
  const $ = id => document.getElementById(id);
  const MODALS = ['scr-menu', 'scr-levelup', 'scr-chest', 'scr-revive', 'scr-result', 'scr-pause'];
  const mmss = s => {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const TOUCH = matchMedia('(pointer: coarse)').matches;
  // bot 连打时界面动画不等，直接往下走
  const wait = (ms, fn) => (typeof Bot !== 'undefined' && Bot.isBusy() ? fn() : setTimeout(fn, ms));
  // 重新触发一次性的 CSS 动画
  function kick(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // 单色线条图标，24×24，描边跟随文字颜色
  const ICONS = {
    bolt: '<path d="M14 6l6 6-6 6-6-6z"/><path d="M2 12h5M4 8h3M4 16h3"/>',
    orbit: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5l2 2-2 2-2-2zM12 17.5l2 2-2 2-2-2z"/><circle cx="12" cy="12" r="1.5"/>',
    pulse: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6"/><path d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5M3.5 12A8.5 8.5 0 0 1 12 3.5"/>',
    chain: '<path d="M13 2L6 13h5l-2 9 8-12h-5z"/>',
    missile: '<path d="M20 4l-2.5 8.5L11 19l-6-6 6.5-6.5z"/><path d="M8 16l-4 4M7 10l-3 .5M14 17l-.5 3"/><circle cx="15" cy="9" r="1.5"/>',
    cluster: '<circle cx="10" cy="14" r="6"/><path d="M14.5 9.5l3-3M18 3v2M21 6h-2M20 10l1.5 1M12 2.5l.5 2"/>',
    laser: '<path d="M3 9h5v6H3z"/><path d="M8 12h13M13 8.5l2-2M13 15.5l2 2M18 8.5l2-2M18 15.5l2 2"/>',
    volatile: '<path d="M12 3l1.8 4.2L18 5l-1.5 4.5L21 12l-4.5 1.5L18 19l-4.2-2.2L12 21l-1.8-4.2L6 19l1.5-5.5L3 12l4.5-2.5L6 5l4.2 2.2z"/>',
    nova: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M19 5l-2.8 2.8M7.8 16.2L5 19"/>',
    strike: '<path d="M12 2v12"/><path d="M8 2h8"/><circle cx="12" cy="18" r="3"/><path d="M5 18h2M17 18h2M12 22v-1"/>',
    stasis: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    maxhp: '<path d="M4 4h16v16H4z"/><path d="M12 8v8M8 12h8"/>',
    speed: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>',
    magnet: '<path d="M6 3v9a6 6 0 0 0 12 0V3"/><path d="M6 7h3M15 7h3"/>',
    power: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/>',
    haste: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20 3.5v4h-4"/><path d="M12 8v4l3 2"/>',
    regen: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
    heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    gold: '<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8l4 4-4 4-4-4z"/>',
    cards: '<path d="M3 8h9v13H3z"/><path d="M7 8V5h9v13h-4"/><path d="M11 5V2h9v13h-4"/>',
    boost: '<path d="M12 2c3.5 2.5 5 6 5 10l-2.5 4h-5L7 12c0-4 1.5-7.5 5-10z"/><circle cx="12" cy="9" r="1.8"/><path d="M9.5 16l-2 5 3-2M14.5 16l2 5-3-2"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    pause: '<path d="M7 4v16M17 4v16"/>',
    close: '<path d="M5 5l14 14M19 5L5 19"/>',
    chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.gold}</svg>`;
  // 广告按钮统一写法：图标 + 奖励 + 附加说明 + “广告 · 演示”标签
  const adLabel = (text, extra, ico) => `<span class="adi">${icon(ico || 'play')}</span><span class="adt">${text}</span>`
    + `${extra ? `<em class="adx">${extra}</em>` : ''}<em class="adtag">广告 · 演示</em>`;

  // ---------- 界面粒子：从某个元素中心喷出火花或金币，动画跑完自己删掉 ----------
  const fxl = $('fxl');
  function burst(el, n, kind = 'spark', spread = 120) {
    if (!el || (typeof Bot !== 'undefined' && Bot.isBusy())) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = spread * (0.35 + Math.random() * 0.8);
      p.className = 'fx ' + kind;
      p.style.cssText = `left:${cx}px;top:${cy}px;--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d - (kind === 'coin' ? 50 : 0)).toFixed(1)}px;`
        + `--rot:${(Math.random() * 720 - 360) | 0}deg;animation-delay:${(Math.random() * 140) | 0}ms`;
      fxl.appendChild(p);
      setTimeout(() => p.remove(), 1400);
    }
  }
  function floatText(el, text, tone = '') {
    const r = el.getBoundingClientRect(), p = document.createElement('i');
    p.className = 'fx ftxt ' + tone;
    p.textContent = text;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top}px`;
    fxl.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
  // 数字滚动到目标值；tick 每跳一次回调一下（放金币声）
  function countUp(el, from, to, ms, fmt, tick) {
    const t0 = performance.now();
    let last = from;
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      el.textContent = fmt(v);
      if (tick && v !== last) tick();
      last = v;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function only(id) {
    for (const m of MODALS) $(m).hidden = m !== id;
    if (id !== 'scr-chest') clearGacha();
    if (id !== 'scr-result') stopMulti();
  }
  function hideModals() { only(null); }
  function showHud(on) { $('hud').hidden = !on; }
  function bossBar(on) { $('boss-bar').hidden = !on; }

  // ---------- HUD：每帧调用，只在数值变化时写 DOM ----------
  const cache = {};
  const els = {};
  for (const id of ['hp', 'hp-fill', 'hp-ghost', 'hp-text', 'xp-fill', 'lv', 'lv-text', 'timer', 'wave-text', 'phase-text', 'wave-fill', 'kill-text',
    'boss-fill', 'boss-bar', 'boss-k', 'combo', 'combo-n', 'fever', 'fever-fill', 'buff', 'buff-t', 'btn-drop', 'drop-fill']) els[id] = $(id);
  function put(id, v, fn) {
    if (cache[id] === v) return;
    cache[id] = v;
    fn(els[id], v);
  }
  const setText = (el, v) => { el.textContent = v; };
  const setBar = (el, v) => { el.style.transform = `scaleX(${v})`; };
  const setClip = (el, v) => { el.style.clipPath = `inset(0 ${(100 - v * 100).toFixed(1)}% 0 0)`; };
  const PHASE = { build: ['蓄力', ''], peak: ['高峰', 'peak'], relax: ['喘息', 'relax'], boss: ['BOSS', 'peak'] };
  let lastHp = 0, hitAt = 0;

  function hud(S) {
    const hp = Math.max(0, S.p.hp / S.st.maxHp);
    put('hp-fill', hp.toFixed(3), setClip);
    put('hp-ghost', hp.toFixed(3), setClip);   // 残影条带延迟过渡：掉血时白色残影慢半拍追上
    put('hp-low', hp < 0.3, (el, v) => els.hp.classList.toggle('low', v));
    const now = performance.now();
    if (S.p.hp < lastHp - 0.5 && now - hitAt > 140) { hitAt = now; kick(els.hp, 'hit'); }
    lastHp = S.p.hp;
    put('hp-text', String(Math.ceil(S.p.hp)), setText);
    put('xp-fill', Math.min(1, S.xp / S.xpNeed).toFixed(3), setBar);
    put('lv-text', String(S.level), (el, v) => { el.textContent = v; kick(els.lv, 'pop'); });
    put('timer', mmss(S.t), setText);
    put('wave-text', S.wave >= CONFIG.run.waves ? '最终战' : `第 ${S.wave + 1}/${CONFIG.run.waves} 波`, setText);
    put('phase-text', S.phase, (el, v) => { el.textContent = PHASE[v][0]; el.className = 'ph ' + PHASE[v][1]; kick(el, 'swap'); });
    put('wave-fill', Math.min(1, S.waveFrac).toFixed(3), setBar);
    put('kill-text', String(S.kills), setText);
    put('combo-n', S.combo >= 5 ? '×' + S.combo : '', (el, v) => { el.textContent = v; els.combo.classList.toggle('on', !!v); });
    const F = CONFIG.fever;
    put('fever-fill', Math.min(1, S.feverT > 0 ? S.feverT / F.dur : S.fever / (F.need + F.grow * S.feverN)).toFixed(3), setBar);
    put('fever', S.feverT > 0, (el, v) => el.classList.toggle('on', v));
    put('buff', S.buffT > 0 ? Math.ceil(S.buffT) : 0, (el, v) => { el.hidden = !v; els['buff-t'].textContent = v + 's'; });
    const left = S.drop ? Math.max(0, (S.drop.until - S.t) / CONFIG.ads.dropWindow) : 0;
    put('drop-fill', left.toFixed(3), setBar);
    put('drop-hurry', S.drop && left < 0.35, (el, v) => els['btn-drop'].classList.toggle('hurry', !!v));
    if (S.boss) {   // Boss 血条：右上角写当前阶段，开护盾时换成“护盾 · 剩 N 座”，血条变成流动的紫色斜纹
      const b = S.boss;
      put('boss-fill', Math.max(0, b.hp / b.maxHp).toFixed(3), setBar);
      put('boss-k', b.shield ? `护盾 · 剩 ${b.ai.pylons} 座` : `阶段 ${b.ai.stage + 1}/3`, (el, v) => { el.textContent = v; kick(el, 'swap'); });
      put('boss-sh', !!b.shield, (el, v) => { els['boss-bar'].classList.toggle('shield', v); kick(els['boss-bar'], 'hit'); });
    }
  }

  function comboBurst(n, tier) {
    const el = els.combo;
    el.className = `combo on t${Math.min(tier, 3)}`;
    void el.offsetWidth;   // 重新触发动画
    el.classList.add('pop');
    banner(`×${n} 连杀`, '', tier >= 2 ? 'hot' : 'me', true);
  }

  // 威胁度：每靠广告拿一次永久强化，敌军升一级，HUD 上一直挂着（具体倍率见 CONFIG.threat）
  function threat(n, bump) {
    const el = $('threat');
    el.hidden = n <= 0;
    $('threat-text').textContent = 'Lv ' + n;
    if (bump && !el.hidden) {
      kick(el, 'bump');
      floatText(el, '敌军增强', 'danger');
    }
  }

  // ---------- 波间广告空投：屏幕左下角的限时入口 ----------
  let dropHide = 0;
  function dropOffer(kind, win, claimed) {
    const b = els['btn-drop'];
    clearTimeout(dropHide);
    if (!kind) {
      if (b.hidden) return;
      b.classList.add(claimed ? 'claimed' : 'gone');
      if (claimed) burst(b, 18, 'spark', 150);
      dropHide = setTimeout(() => { b.hidden = true; b.className = 'drop-card'; }, 450);
      return;
    }
    const D = Ads.DROPS[kind];
    $('drop-ico').innerHTML = icon(D.icon);
    $('drop-name').textContent = D.name;
    $('drop-desc').textContent = D.desc;
    $('drop-go').innerHTML = `${icon('play')}<span>领取</span>${TOUCH ? '' : '<kbd>F</kbd>'}<em>演示</em>`;
    b.className = 'drop-card';
    b.hidden = false;
    kick(b, 'in');
  }

  // ---------- 主动技能按钮：常驻右下角，空着时是技能槽 ----------
  const SKB = $('btn-skill');
  SKB.classList.toggle('touch', TOUCH);
  let skillId = null, urge = false;
  function skill(id) {
    if (id === skillId) return;
    skillId = id;
    urge = false;
    SKB.classList.remove('urge');
    if (!id) {
      SKB.classList.add('empty');
      $('skill-ico').innerHTML = '';
      $('skill-name').textContent = '技能槽';
      $('skill-hint').textContent = '击落补给飞船获得';
      return;
    }
    $('skill-ico').innerHTML = icon(id);
    $('skill-name').textContent = CONFIG.skills[id].name;
    $('skill-hint').textContent = TOUCH ? '点我释放' : '空格释放';
    SKB.classList.remove('empty');
    kick(SKB, 'got');
    burst(SKB.querySelector('.sk-orb'), 16, 'spark', 100);
  }
  function skillUsed() {
    skill(null);
    kick(SKB, 'fire');
    burst(SKB.querySelector('.sk-orb'), 20, 'spark', 140);
  }
  function skillUrge(v) {
    v = !!v && !!skillId;
    if (v === urge) return;
    urge = v;
    SKB.classList.toggle('urge', v);
  }

  function syncMute() {
    const html = Save.data.muted ? `${icon('mute')}音效 关` : `${icon('sound')}音效 开`;
    $('btn-mute').innerHTML = html;
    $('btn-mute-menu').innerHTML = html;
  }
  function toggleMute() {
    Save.data.muted = !Save.data.muted;
    Save.persist();
    syncMute();
  }

  // ---------- 主菜单 ----------
  let menuCoins = null;
  function showMenu(rerender) {
    showHud(false);
    bossBar(false);
    $('howto').textContent = (TOUCH ? '拖动屏幕移动' : 'WASD / 方向键移动') + '，武器自动开火。撑过 6 波，击败虚空核心。';
    const d = Save.data, coinEl = $('coin-text');
    if (!rerender && menuCoins !== null && d.coins > menuCoins) countUp(coinEl, menuCoins, d.coins, 900, v => '◈ ' + v);   // 带着金币回来时数字滚上去
    else coinEl.textContent = '◈ ' + d.coins;
    menuCoins = d.coins;
    $('menu-stats').textContent = d.runs
      ? `已玩 ${d.runs} 局 · 最佳存活 ${mmss(d.best)} · 通关 ${d.wins} 次`
      : '第一次玩：先撑过第 1 波，精英会掉宝箱';
    const list = $('shop-list');
    list.innerHTML = '';
    const max = CONFIG.shopCosts.length;
    for (const it of CONFIG.shop) {
      const lv = d.meta[it.id] || 0, cost = CONFIG.shopCosts[lv];
      const row = document.createElement('div');
      row.className = 'shop-item';
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      row.innerHTML = `<div class="si-name"><b>${it.name}</b><span class="pips">${pips}</span></div><small>${it.desc}</small>`;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      if (cost === undefined) {
        btn.textContent = '满级';
        btn.disabled = true;
      } else {
        btn.textContent = '◈ ' + cost;
        btn.disabled = d.coins < cost;
        btn.onclick = () => {
          if (!Game.buy(it.id)) return;
          showMenu(true);
          const pip = list.children[CONFIG.shop.indexOf(it)].querySelectorAll('.pips i')[lv];
          if (pip) { pip.classList.add('new'); burst(pip, 10, 'spark', 60); }
        };
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
    $('btn-boost').innerHTML = adLabel('看广告开局', '史诗强化三选一', 'boost');
    syncMute();
    only('scr-menu');
    if (!rerender && !(typeof Bot !== 'undefined' && Bot.isBusy())) Ads.offer('start_boost', {});
  }

  // ---------- 升级三选一 ----------
  // 稀有度颜色：普通灰、稀有蓝、史诗紫、传说金，卡片边框、图标、标签都跟着变
  const RAR = CONFIG.rarity.tiers;
  function cardHtml(d, key) {
    return `<span class="ico">${icon(d.id)}</span>`
      + `<span class="nm">${d.name}<span class="rar-chip">${d.rarName}</span><span class="tag${d.isNew ? ' new' : ''}">${d.tag}</span>${key ? `<kbd>${key}</kbd>` : ''}</span>`
      + `<span class="ds">${d.desc}${d.hint ? `<em>${d.hint}</em>` : ''}</span>`;
  }

  let lockTimer = null;
  function showLevelUp(descs, info) {
    const boost = !!info.boost;
    $('lu-sub').textContent = boost ? '广告奖励' : `LV ${String(info.level).padStart(2, '0')}`;
    $('lu-title').textContent = boost ? '开局增益 · 史诗三选一' : '选择 1 项强化';
    $('scr-levelup').classList.toggle('boost', boost);
    const box = $('lu-cards');
    box.className = 'cards';
    box.innerHTML = '';
    descs.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = `card r${d.rar}`;
      b.style.setProperty('--rc', RAR[d.rar].color);
      b.style.setProperty('--i', i);
      b.innerHTML = cardHtml(d, i + 1);
      b.onclick = () => choose(b, d.id);
      box.appendChild(b);
    });
    // 弹出后短暂锁定，防止拖动中的手指误点
    box.classList.add('lock');
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => box.classList.remove('lock'), 350);
    const ta = $('btn-takeall');
    ta.hidden = !(info.takeAllLeft > 0);
    ta.disabled = false;
    ta.innerHTML = adLabel('三项全拿', `剩 ${info.takeAllLeft} 次`, 'cards');
    const rb = $('btn-reroll');
    rb.hidden = !(info.rerollsLeft > 0);
    rb.innerHTML = adLabel('换一批', `剩 ${info.rerollsLeft} 次`);
    only('scr-levelup');
  }
  // 选中的卡亮一下、其余的退下去，再回到战斗
  function choose(b, id) {
    const box = $('lu-cards');
    if (box.classList.contains('picking') || box.classList.contains('lock')) return;
    box.classList.add('picking');
    b.classList.add('chosen');
    burst(b.querySelector('.ico'), 10, 'spark', 80);
    Sfx.play('swish');
    wait(260, () => Game.pick(id));
  }
  function levelUpTakeAll(done) {
    const box = $('lu-cards');
    box.classList.add('picking', 'all');
    $('btn-takeall').disabled = true;
    [...box.children].forEach((c, i) => setTimeout(() => {
      c.classList.add('chosen');
      burst(c.querySelector('.ico'), 12, 'spark', 90);
      Sfx.play('swish');
    }, i * 120));
    wait(620, done);
  }

  // ---------- 宝箱抽卡（仿 CS2 开箱）----------
  // 每一项一条横向物品带，先高速滚过、再慢慢减速，停在中间的金线上。
  // 物品底边的颜色就是稀有度；停点旁边常常故意放一格传说，制造“差一点就出金”。
  // 多项时几条一起滚、依次停下；全停以后收起滚轴，摊开结果卡片。点任意处直接停到结果。
  const TILES = 44, WIN_AT = 37, FILL = [0.56, 0.27, 0.13, 0.04];   // 物品带格数、中奖格位置、陪衬格的稀有度分布
  let gTimers = [], gItems = [], gReels = [], gRaf = 0, gPool = { up: [], evo: [] }, gDone = true;
  const later = (fn, ms) => gTimers.push(setTimeout(fn, ms));
  function clearGacha() { gTimers.forEach(clearTimeout); gTimers = []; cancelAnimationFrame(gRaf); gRaf = 0; gReels = []; }

  function filler(rar) {
    const list = rar >= 3 && gPool.evo.length ? gPool.evo : gPool.up;
    const it = list[(Math.random() * list.length) | 0] || { id: 'gold', name: '金币袋' };
    return { id: it.id, name: it.name, rar };
  }
  function fillerRar() {
    let x = Math.random(), r = 0;
    while (r < 3 && x >= FILL[r]) { x -= FILL[r]; r++; }
    return r;
  }
  const tileHtml = d => `<div class="rtile r${d.rar}" style="--rc:${RAR[d.rar].color}"><span class="ico">${icon(d.id)}</span><b>${d.name}</b></div>`;

  function buildReel(d, i) {
    const tiles = Array.from({ length: TILES }, () => filler(fillerRar()));
    tiles[WIN_AT] = d;
    if (d.rar < 3 && Math.random() < 0.6) tiles[WIN_AT + (Math.random() < 0.5 ? 1 : -1)] = filler(3);
    if (Math.random() < 0.5) tiles[WIN_AT + 2] = filler(2);
    const el = document.createElement('div');
    el.className = 'reel';
    el.style.setProperty('--rc', RAR[d.rar].color);
    el.innerHTML = `<div class="strip">${tiles.map(tileHtml).join('')}</div><i class="mark"></i>`;
    $('ch-reels').appendChild(el);
    const strip = el.firstChild, t0 = strip.children[0], step = strip.children[1].offsetLeft - t0.offsetLeft, tw = t0.offsetWidth;
    const center = el.clientWidth / 2, xF = center - (WIN_AT * step + tw / 2);
    return {
      d, el, strip, step, center, xF,
      x0: center - (2 * step + tw / 2) - Math.random() * step,
      x1: xF + (Math.random() * 2 - 1) * tw * 0.38,   // 停在中奖格里的随机位置，有时压着边
      dur: 2500 + i * 480 + (d.rar >= 3 ? 1000 : 0),
      t0: performance.now(), idx: -1, done: false,
    };
  }

  function landReel(r, quiet) {
    r.done = true;
    r.strip.style.transform = `translate3d(${r.x1}px,0,0)`;
    void r.strip.offsetWidth;
    r.strip.classList.add('settle');   // 停下后轻轻吸到格子正中
    r.strip.style.transform = `translate3d(${r.xF}px,0,0)`;
    r.strip.children[WIN_AT].classList.add('win');
    r.el.classList.add('landed', 'r' + r.d.rar);
    if (r.d.rar >= 3) $('ch-panel').classList.add('legend');
    if (!quiet) Sfx.play('flip', r.d.rar);
  }

  function spinFrame(now) {
    let live = false, ticked = false;
    for (const r of gReels) {
      if (r.done) continue;
      const t = Math.min(1, (now - r.t0) / r.dur);
      if (t >= 1) { landReel(r); continue; }
      const x = r.x0 + (r.x1 - r.x0) * (1 - Math.pow(1 - t, 4));   // 先快后慢
      r.strip.style.transform = `translate3d(${x}px,0,0)`;
      const idx = Math.floor((r.center - x) / r.step);
      if (idx !== r.idx) { r.idx = idx; ticked = true; }
      live = true;
    }
    if (ticked) Sfx.play('tick');
    if (live) gRaf = requestAnimationFrame(spinFrame);
    else { gRaf = 0; later(reveal, 800); }
  }

  function spin(items) {
    gDone = false;
    $('ch-reels').innerHTML = '';
    $('ch-reels').className = 'reels';
    $('ch-items').innerHTML = '';
    $('ch-panel').classList.remove('legend');
    $('ch-tip').hidden = false;
    $('btn-chest-ok').textContent = '跳过';
    $('btn-chest-ad').hidden = true;
    gReels = items.map(buildReel);
    gItems = gItems.concat(items);
    Sfx.play('chest');
    gRaf = requestAnimationFrame(spinFrame);
  }

  // 滚轴收起，结果卡片发出来并依次翻开
  function reveal() {
    if (gDone) return;
    gDone = true;
    $('ch-reels').classList.add('fold');
    later(() => {
      $('ch-reels').classList.add('gone');
      const box = $('ch-items');
      box.innerHTML = '';
      gItems.forEach((d, i) => {
        const el = gcard(d);
        el.style.animationDelay = `${i * 70}ms`;
        box.appendChild(el);
        later(() => { el.classList.add('open'); if (d.rar >= 2) burst(el, d.rar >= 3 ? 26 : 12, d.rar >= 3 ? 'coin' : 'spark', 130); }, 120 + i * 90);
      });
    }, 200);
    const evo = gItems.some(d => d.evo), top = Math.max(...gItems.map(d => d.rar));
    $('ch-title').textContent = evo ? '武器进化' : `抽到 ${gItems.length} 项`;
    $('ch-sub').textContent = top > 0 ? `最高 · ${RAR[top].name}` : '';
    $('ch-tip').hidden = true;
    $('btn-chest-ok').textContent = '收下';
    $('btn-chest-ad').hidden = !gCanAd;
  }

  function gcard(d) {
    const el = document.createElement('div');
    el.className = `gcard r${d.rar}`;
    el.style.setProperty('--rc', RAR[d.rar].color);
    el.innerHTML = `<div class="gc-in"><div class="gc-back"><i></i></div><div class="gc-front">`
      + `<span class="rar">${d.rarName}</span><span class="ico">${icon(d.id)}</span><b>${d.name}</b>`
      + `<span class="tag">${d.tag}</span><span class="ds">${d.desc}</span></div></div>`;
    return el;
  }

  let gCanAd = false;
  function showChest(items, info) {
    clearGacha();
    gItems = [];
    gPool = info.pool || gPool;
    gCanAd = !!info.canAd;
    $('ch-title').textContent = info.epic ? '史诗补给箱' : '补给舱开启中';
    $('ch-sub').textContent = info.epic ? '保底史诗' : '';
    const ad = $('btn-chest-ad');
    ad.disabled = false;
    ad.innerHTML = adLabel('再抽一次', '保底史诗', 'gold');
    only('scr-chest');   // 先显示出来，滚轴才量得到宽度
    spin(items);
  }
  function addChestItems(items) {
    clearGacha();
    gCanAd = true;
    const ad = $('btn-chest-ad');
    ad.disabled = true;
    ad.innerHTML = adLabel('已再抽一次', '', 'gold');
    $('ch-title').textContent = '再抽一次 · 保底史诗';
    $('ch-sub').textContent = '';
    spin(items);
  }
  function chestSkip() {
    if (gDone) return;
    const rest = gReels.filter(r => !r.done);
    clearGacha();
    rest.forEach(r => landReel(r, true));
    if (rest.length) Sfx.play('flip', Math.max(...rest.map(r => r.d.rar)));
    reveal();
  }
  const chestReady = () => gDone;

  // 电脑上开局时在屏幕下方亮几秒按键提示
  function keyHint() {
    const el = $('keyhint');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------- 复活：写明复活拿到什么，并提醒离通关还差多少 ----------
  let rvTimer = null;
  function showRevive(info) {
    const total = CONFIG.ads.reviveWait, ring = $('rv-ring'), len = 2 * Math.PI * 44;
    let left = total, lastTs = performance.now();
    $('rv-info').textContent = `存活 ${mmss(info.t)} · ${info.wave} · LV ${info.lv}`;
    const boss = info.w >= info.waves;
    const frac = boss ? (info.waves + 1 - (info.bossLeft || 0)) / (info.waves + 1) : (info.w + 0.5) / (info.waves + 1);
    $('rv-near').innerHTML = boss ? `Boss 只剩 <b>${Math.round((info.bossLeft || 0) * 100)}%</b> 血` : `离 Boss 只差 <b>${info.waves - info.w}</b> 波`;
    const bar = $('rv-prog');
    bar.style.transform = 'scaleX(0)';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transform = `scaleX(${frac.toFixed(3)})`; }));
    $('rv-perks').innerHTML = [['heal', '满血'], ['shield', `${CONFIG.ads.reviveInv} 秒无敌`], ['nova', '立刻狂热']]
      .map(([ic, t], i) => `<li style="--i:${i}">${icon(ic)}<span>${t}</span></li>`).join('');
    $('rv-count').textContent = total;
    $('btn-revive').innerHTML = adLabel('看广告满血复活');
    ring.style.strokeDasharray = len;
    ring.style.strokeDashoffset = 0;
    showHud(false);
    only('scr-revive');
    clearInterval(rvTimer);
    let shown = total;
    rvTimer = setInterval(() => {
      const now = performance.now(), dt = (now - lastTs) / 1000;
      lastTs = now;
      if (Ads.isActive()) return;   // 看广告期间倒计时暂停
      left -= dt;
      ring.style.strokeDashoffset = (len * (1 - Math.max(0, left / total))).toFixed(1);
      const n = Math.max(0, Math.ceil(left));
      if (n !== shown) { shown = n; $('rv-count').textContent = n; kick($('rv-count'), 'beat'); }
      if (left <= 0) { clearInterval(rvTimer); Game.giveUp(); }
    }, 100);
  }
  function stopRevive() { clearInterval(rvTimer); }

  // ---------- 结算：数字滚动 + 金币倍率条 ----------
  const MUL = CONFIG.ads.multi, MW = CONFIG.ads.multiW;
  let mRaf = 0, mFrozen = false, mCur = -1, mCoins = 0;
  function multiAt(x) {
    let acc = 0;
    for (let i = 0; i < MUL.length; i++) { acc += MW[i]; if (x <= acc) return i; }
    return MUL.length - 1;
  }
  function stopMulti() { cancelAnimationFrame(mRaf); mRaf = 0; }
  // 指针在倍率条上来回摆（两端慢、中间快，所以 ×5 最难停中）；按钮上的倍数和金币数跟着指针实时变
  function startMulti(coins) {
    const bar = $('mbar'), btn = $('btn-double'), box = $('multi');
    bar.innerHTML = MUL.map((m, i) => `<span class="m${m}" style="flex:${MW[i]}">×${m}</span>`).join('');
    box.className = 'multi';
    mFrozen = false;
    mCur = -1;
    mCoins = coins;
    stopMulti();
    const t0 = performance.now();
    const loop = now => {
      if (!mFrozen) {
        const x = 0.5 - 0.5 * Math.cos(((now - t0) / 1000) * 3.4);
        $('mptr').style.left = (x * 100).toFixed(2) + '%';
        const i = multiAt(x);
        if (i !== mCur) {
          mCur = i;
          [...bar.children].forEach((c, j) => c.classList.toggle('on', j === i));
          btn.innerHTML = adLabel(`看广告领取 ×${MUL[i]}`, `◈ ${coins * MUL[i]}`, 'gold');
        }
      }
      mRaf = requestAnimationFrame(loop);
    };
    mRaf = requestAnimationFrame(loop);
  }

  function showResult(r) {
    const title = $('rs-title');
    title.textContent = r.win ? '通关' : '本局结束';
    title.classList.toggle('win', r.win);
    $('rs-sub').innerHTML = r.win ? '<span>虚空核心已击破</span>' : '<span>信号丢失</span>';
    // [名称, 最终文字, 数字, 格式]：有数字的行从 0 滚上去
    const rows = [
      ['存活时间', mmss(r.t), Math.floor(r.t), mmss], ['到达', r.wave], ['等级', 'LV ' + r.lv, r.lv, v => 'LV ' + v],
      ['击杀', String(r.kills), r.kills, String], ['最高连杀', '×' + r.maxCombo, r.maxCombo, v => '×' + v],
      ['进化', r.evos.length ? r.evos.join('、') : '—'], ['金币', '◈ ' + r.coins, r.coins, v => '◈ ' + v],
    ];
    const led = $('rs-ledger');
    led.innerHTML = rows.map(([k, v], i) => `<div style="--i:${i}"${k === '金币' ? ' class="coins"' : ''}><dt>${k}</dt><dd${k === '金币' ? ' id="rs-coins"' : ''}>${v}</dd></div>`).join('');
    rows.forEach(([, , n, fmt], i) => {
      if (n === undefined || !n) return;
      const dd = led.children[i].querySelector('dd');
      dd.textContent = fmt(0);
      setTimeout(() => countUp(dd, 0, n, 700, fmt, i === 6 ? () => Sfx.play('coin') : null), 160 + i * 90);
    });
    const b = $('btn-double');
    b.hidden = r.coins <= 0;
    $('multi').hidden = r.coins <= 0;
    b.disabled = false;
    showHud(false);
    bossBar(false);
    only('scr-result');
    if (r.coins > 0) startMulti(r.coins);
  }
  function resultMultiplied(base, m) {
    stopMulti();
    $('multi').classList.add('won');
    const coins = $('rs-coins');
    countUp(coins, base, base * m, 1100, v => '◈ ' + v, () => Sfx.play('coin'));
    kick(coins.parentNode, 'flash');
    burst(coins, 28, 'coin', 160);
    const b = $('btn-double');
    b.disabled = true;
    b.innerHTML = adLabel(`已领取 ×${m}`, `◈ ${base * m}`, 'gold');
  }
  function resultMultiFail() {
    mFrozen = false;
    $('multi').classList.remove('lock');
  }

  function showPause(list) {
    $('ps-build').innerHTML = list.length
      ? list.map((u, i) => `<li class="${u.evo ? 'evo' : ''}" style="--i:${i}"><span class="ico">${icon(u.id)}</span><b>${u.name}</b>`
        + `<span class="lvl"><i style="--k:${(u.lv / u.max).toFixed(2)}"></i>LV ${u.lv}/${u.max}</span>${u.note ? `<em>${u.note}</em>` : ''}</li>`).join('')
      : '<li class="note">还没有强化</li>';
    syncMute();
    only('scr-pause');
  }

  // 横幅：两侧光线向中间收拢，标题从宽字距收紧
  function banner(title, sub, tone = 'me', small = false) {
    const el = $('banner');
    el.className = '';
    el.innerHTML = `<i class="bl"></i><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}<i class="br"></i>`;
    void el.offsetWidth;   // 重新触发动画
    el.className = `show ${tone}${small ? ' small' : ''}`;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    kick(el, 'show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
  [...document.querySelector('.menu-inner').children].forEach((c, i) => c.style.setProperty('--i', i));   // 主菜单逐项入场
  $('ver').textContent = VERSION;
  const wb = document.querySelector('.wavebar');
  wb.style.setProperty('--m1', (CONFIG.run.peakAt / CONFIG.run.waveDuration) * 100 + '%');
  wb.style.setProperty('--m2', (CONFIG.run.relaxAt / CONFIG.run.waveDuration) * 100 + '%');

  $('btn-start').onclick = () => Game.start();
  $('btn-boost').onclick = () => Ads.show('start_boost', {}, ok => { if (ok) Game.start({ boost: true }); });
  $('btn-pause').onclick = () => Game.pause();
  $('btn-resume').onclick = () => Game.resume();
  $('btn-restart').onclick = () => Game.restart();
  $('btn-quit').onclick = () => Game.quitToMenu();
  $('btn-takeall').onclick = () => { if (!$('lu-cards').classList.contains('picking')) Game.takeAll(); };
  $('btn-reroll').onclick = () => { if (!$('lu-cards').classList.contains('picking')) Game.reroll(); };
  $('btn-chest-ad').onclick = () => Game.chestMore();
  $('btn-chest-ok').onclick = () => (chestReady() ? Game.chestTake() : chestSkip());
  $('ch-panel').addEventListener('click', e => { if (!chestReady() && !e.target.closest('.btn')) chestSkip(); });
  SKB.onclick = () => Game.useSkill();
  els['btn-drop'].onclick = () => Game.claimDrop();
  $('btn-revive').onclick = () => Game.reviveWithAd();
  $('btn-giveup').onclick = () => Game.giveUp();
  $('btn-double').onclick = () => {
    if (mFrozen || mCur < 0) return;
    mFrozen = true;
    $('multi').classList.add('lock');
    Game.multiplyCoins(MUL[mCur]);
  };
  $('btn-again').onclick = () => Game.start();
  $('btn-home').onclick = () => Game.home();
  $('btn-mute').onclick = toggleMute;
  $('btn-mute-menu').onclick = toggleMute;
  document.addEventListener('click', e => { if (e.target.closest('.btn, .card')) Sfx.play('click'); });
  document.addEventListener('keydown', e => {
    const focused = document.activeElement && document.activeElement.closest('button, select, input');
    if (e.code === 'Enter' && !focused && Game.state === 'menu' && !$('scr-menu').hidden) Game.start();
  });

  return {
    hud, comboBurst, threat, dropOffer, showHud, bossBar, hideModals, showMenu, showLevelUp, levelUpTakeAll, showChest, addChestItems, chestReady, chestSkip,
    skill, skillUsed, skillUrge, keyHint, showRevive, stopRevive, showResult, resultMultiplied, resultMultiFail, showPause, banner, toast,
  };
})();
