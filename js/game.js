// 霓虹幸存者 · 核心循环
// 输入 → 波次与事件 → 刷怪 → 武器 → 碰撞 → 掉落/升级/宝箱 → 渲染。
// 数值来自 config.js，界面在 ui.js，埋点在 analytics.js。
const Game = (() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const trail = document.createElement('canvas');   // 半分辨率的磷光拖影层，叠回主画面时顺带有辉光
  const tctx = trail.getContext('2d');
  const TAU = Math.PI * 2;
  const R = CONFIG.run;
  const COL = CONFIG.color;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const round1 = v => Math.round(v * 10) / 10;
  const panAt = x => (x - S.p.x) / 600;   // 音效的左右声像：按离主角的横向距离，大约半屏到最左或最右

  let W = 0, H = 0, DPR = 1, ZOOM = 1, zoomMul = 1, zoomEff = 1;
  let camX = 0, camY = 0;
  let state = 'menu';   // menu | play | levelup | chest | paused | dying | revive | outro | result
  let S = null;         // 当前这一局
  let uid = 0;
  let godMode = false;
  let autoMove = null;  // 自动试玩 bot 直接给移动方向
  let last = 0;
  const impulses = [];  // 让背景网格弯曲的冲击
  let menuRippleT = 0;

  // ---------- 升级池 ----------
  const WP = CONFIG.weapons, PS = CONFIG.passives, EVO = CONFIG.evolutions;
  const pc = v => Math.round(v * 100) + '%';
  const UPGRADES = {
    bolt:  { kind: 'weapon', name: '能量弹', max: 6, desc: ['自动射向最近的敌人', '弹数 +1', '伤害 +30%', '穿透 +1', '射速 +25%', '弹数 +1'] },
    orbit: { kind: 'weapon', name: '环绕刃', max: 5, desc: [`${WP.orbit.count} 片光刃绕身旋转`, '光刃 +1', '伤害 +40%', '光刃 +1，半径变大', '转速 +30%，伤害 +30%'] },
    pulse: { kind: 'weapon', name: '脉冲波', max: 5, desc: [`每 ${WP.pulse.cd} 秒释放冲击波，击退周围敌人`, '范围 +25%', '伤害 +50%', '冷却 -25%', '伤害 +50%，范围 +20%'] },
    chain: { kind: 'weapon', name: '闪电链', max: 5, desc: [`每 ${WP.chain.cd} 秒电击敌人并弹射 ${WP.chain.jumps} 次`, '弹射 +2', '伤害 +40%', '冷却 -25%', '弹射 +3'] },
    missile: { kind: 'weapon', name: '追踪导弹', max: 5, desc: [`每 ${WP.missile.cd} 秒发射 ${WP.missile.count} 枚追踪导弹，爆炸波及周围`, '导弹 +1', '伤害 +40%', '爆炸范围 +30%', '导弹 +2，冷却 -20%'] },
    cluster: { kind: 'weapon', name: '集束炸弹', max: 5, desc: [`每 ${WP.cluster.cd} 秒朝敌群最密处投弹，炸开后再散出 ${WP.cluster.bomblets} 枚子弹`, '子弹 +2', '伤害 +40%', '爆炸范围 +25%', '一次投 2 枚，冷却 -20%'] },
    laser: { kind: 'weapon', name: '激光扫射', max: 5, desc: [`每 ${WP.laser.cd} 秒放出光束绕身扫一圈`, '光束 +1', '伤害 +40%', '长度 +30%', '光束 +1，冷却 -25%'] },
    maxhp: { kind: 'passive', name: '强化外壳', max: 5, desc: `最大生命 +${PS.maxhp}，并回复 ${PS.maxhp}` },
    speed: { kind: 'passive', name: '推进器', max: 5, desc: `移动速度 +${pc(PS.speed)}` },
    magnet: { kind: 'passive', name: '磁力场', max: 5, desc: `拾取范围 +${pc(PS.magnet)}` },
    power: { kind: 'passive', name: '超载核心', max: 5, desc: `全部伤害 +${pc(PS.power)}` },
    haste: { kind: 'passive', name: '冷却回路', max: 5, desc: `武器冷却 -${pc(PS.haste)}` },
    regen: { kind: 'passive', name: '纳米修复', max: 5, desc: `每秒回复 ${PS.regen} 生命` },
    volatile: { kind: 'passive', name: '殉爆', max: 5, desc: `击杀时爆炸的概率 +${pc(PS.volatile)}，炸死的敌人还会接着炸` },
  };
  // 升级池抽空后的保底选项，数量随稀有度涨
  const EXTRA = {
    heal: { name: '应急维修', tag: '回复', amounts: [30, 60, 100], desc: n => `立即回复 ${n} 生命` },
    gold: { name: '金币袋', tag: '奖励', amounts: [10, 25, 50], desc: n => `本局结算 +${n} 金币` },
  };
  const RAR = CONFIG.rarity.tiers;

  function boltStats(lv, evo) {
    const b = WP.bolt;
    const s = { count: 1 + (lv >= 2) + (lv >= 6), dmg: b.dmg * (lv >= 3 ? 1.3 : 1), pierce: lv >= 4 ? 1 : 0,
                cd: b.cd * (lv >= 5 ? 0.8 : 1), speed: b.speed, range: b.range };
    if (evo) { s.count += 2; s.pierce += 2; s.dmg *= 1.5; s.cd *= 0.8; }
    return s;
  }
  function orbitStats(lv, evo) {
    const o = WP.orbit;
    const s = { count: o.count + (lv >= 2) + (lv >= 4), dmg: o.dmg * (lv >= 3 ? 1.4 : 1) * (lv >= 5 ? 1.3 : 1),
                radius: o.radius + (lv >= 4 ? 18 : 0), spin: o.spin * (lv >= 5 ? 1.3 : 1), hitCd: o.hitCd, hitR: 10 };
    if (evo) { s.count = 6; s.radius = 100; s.dmg *= 1.6; s.spin = 4.2; s.hitR = 17; }
    return s;
  }
  function pulseStats(lv, evo) {
    const p = WP.pulse;
    const s = { radius: p.radius * (lv >= 2 ? 1.25 : 1) * (lv >= 5 ? 1.2 : 1), dmg: p.dmg * (lv >= 3 ? 1.5 : 1) * (lv >= 5 ? 1.5 : 1),
                cd: p.cd * (lv >= 4 ? 0.75 : 1), knock: p.knock, slow: 0 };
    if (evo) { s.cd *= 0.5; s.radius *= 1.3; s.dmg *= 1.4; s.slow = 1.5; }
    return s;
  }
  function chainStats(lv, evo) {
    const c = WP.chain;
    const s = { jumps: c.jumps + (lv >= 2 ? 2 : 0) + (lv >= 5 ? 3 : 0), dmg: c.dmg * (lv >= 3 ? 1.4 : 1),
                cd: c.cd * (lv >= 4 ? 0.75 : 1), range: c.range, jumpRange: c.jumpRange, bolts: 1 };
    if (evo) { s.jumps = 9; s.bolts = 2; s.dmg *= 1.3; s.cd *= 0.6; }
    return s;
  }
  function missileStats(lv, evo) {
    const m = WP.missile;
    const s = { count: m.count + (lv >= 2) + (lv >= 5 ? 2 : 0), dmg: m.dmg * (lv >= 3 ? 1.4 : 1), radius: m.radius * (lv >= 4 ? 1.3 : 1),
                cd: m.cd * (lv >= 5 ? 0.8 : 1), speed: m.speed, turn: m.turn, life: m.life, well: false };
    if (evo) { s.count += 2; s.dmg *= 1.3; s.well = true; }
    return s;
  }
  function clusterStats(lv, evo) {
    const c = WP.cluster;
    const s = { count: 1 + (lv >= 5), bomblets: c.bomblets + (lv >= 2 ? 2 : 0), dmg: c.dmg * (lv >= 3 ? 1.4 : 1), radius: c.radius * (lv >= 4 ? 1.25 : 1),
                small: c.bombletDmg * (lv >= 3 ? 1.4 : 1), smallR: c.bombletR, cd: c.cd * (lv >= 5 ? 0.8 : 1), range: c.range, carpet: 0 };
    if (evo) { s.carpet = 8; s.dmg *= 1.3; }
    return s;
  }
  function laserStats(lv, evo) {
    const l = WP.laser;
    const s = { beams: 1 + (lv >= 2) + (lv >= 5), dmg: l.dmg * (lv >= 3 ? 1.4 : 1), len: l.len * (lv >= 4 ? 1.3 : 1), cd: l.cd * (lv >= 5 ? 0.75 : 1),
                sweep: l.sweep, width: l.width, always: false };
    if (evo) { s.beams = 3; s.len *= 1.25; s.width *= 1.6; s.dmg *= 1.2; s.always = true; }
    return s;
  }

  const xpFor = level => CONFIG.xp.base + CONFIG.xp.step * (level - 1);

  function computeStats() {
    const m = Save.data.meta, L = S.lv, P = CONFIG.player;
    const step = id => CONFIG.shop.find(s => s.id === id).step;
    S.st = {
      maxHp: P.hp + m.hp * step('hp') + L.maxhp * PS.maxhp,
      speed: P.speed * (1 + m.spd * step('spd') + L.speed * PS.speed),
      pickup: P.pickup * (1 + L.magnet * PS.magnet),
      dmg: 1 + m.dmg * step('dmg') + L.power * PS.power,
      cd: Math.max(0.4, 1 - L.haste * PS.haste),
      regen: L.regen * PS.regen,
    };
  }

  // ---------- 精灵：舰船、晶体、环绕刃在 art.js 里画；这里只画拾取物和敌方子弹 ----------
  let spriteScale = 0;
  let sprites = {};
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function shapePath(g, shape, r) {
    g.beginPath();
    switch (shape) {
      case 'circle': g.arc(0, 0, r, 0, TAU); break;
      case 'plus': {
        const a = r * 0.34;
        g.moveTo(-a, -r); g.lineTo(a, -r); g.lineTo(a, -a); g.lineTo(r, -a); g.lineTo(r, a); g.lineTo(a, a);
        g.lineTo(a, r); g.lineTo(-a, r); g.lineTo(-a, a); g.lineTo(-r, a); g.lineTo(-r, -a); g.lineTo(-a, -a); g.closePath();
        break;
      }
      case 'chest': g.rect(-r, -r * 0.7, r * 2, r * 1.4); g.moveTo(-r, -r * 0.15); g.lineTo(r, -r * 0.15); g.moveTo(0, -r * 0.15); g.lineTo(0, r * 0.25); break;
      case 'magnet': g.moveTo(-r * 0.7, -r * 0.8); g.lineTo(-r * 0.7, 0.1 * r); g.arc(0, 0.1 * r, r * 0.7, Math.PI, 0, true); g.lineTo(r * 0.7, -r * 0.8); break;
    }
  }
  function makeSprite(shape, color, r, opt = {}) {
    const half = r * 1.35 + 10;
    const px = Math.ceil(half * 2 * spriteScale);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.setTransform(spriteScale, 0, 0, spriteScale, px / 2, px / 2);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.shadowColor = color;
    g.shadowBlur = (opt.blur ?? 5) * spriteScale;
    g.strokeStyle = color;
    g.lineWidth = opt.line ?? 1.7;
    if (opt.fill) { shapePath(g, shape, r); g.fillStyle = hexA(color, opt.fill); g.fill(); }
    shapePath(g, shape, r);
    g.stroke();
    if (opt.inner) { g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, r * 0.4, 0, TAU); g.stroke(); }
    if (opt.double) { g.lineWidth = 1; shapePath(g, shape, r + 4.5); g.stroke(); }
    return { c, half };
  }
  function buildSprites() {
    sprites = Art.build(spriteScale);
    sprites.ebullet = makeSprite('circle', COL.danger, 4.5, { blur: 6, fill: 0.5 });
    sprites.bbullet = makeSprite('circle', COL.danger, 6.5, { blur: 8, fill: 0.5, inner: true });
    sprites.heart = makeSprite('plus', COL.hot, 8, { blur: 8, fill: 0.2 });
    sprites.chest = makeSprite('chest', COL.foe, 11, { blur: 10, double: true, line: 2, fill: 0.2 });
    sprites.magnet = makeSprite('magnet', COL.me, 9, { blur: 8, line: 2 });
  }
  // 光晕贴图（art.js 里画的径向渐变），特效都靠它叠出辉光
  const GLOW = { me: Art.glow(COL.me), foe: Art.glow(COL.foe), danger: Art.glow(COL.danger), hot: Art.glow(COL.hot), gold: Art.glow('#ffd25a'), void: Art.glow(COL.void) };

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    trail.width = Math.ceil(canvas.width / 2);
    trail.height = Math.ceil(canvas.height / 2);
    ZOOM = clamp(Math.sqrt(W * H) / CONFIG.view.refSize, 0.55, 1.8);
    zoomEff = ZOOM * zoomMul;
    const sc = clamp(DPR * ZOOM, 1, 3);
    if (Math.abs(sc - spriteScale) > 0.05) { spriteScale = sc; buildSprites(); }
    if (!STAR_LAYERS[0].tile || STAR_LAYERS[0].tile.width !== Math.round(640 * DPR)) buildStars();
  }

  // ---------- 空间网格：碰撞只查附近的格子 ----------
  const CELL = 64;
  const grid = new Map();
  const cellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
  function buildGrid() {
    grid.clear();
    for (const e of S.enemies) {
      if (e.dead) continue;
      const k = cellKey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let b = grid.get(k);
      if (!b) { b = []; grid.set(k, b); }
      b.push(e);
    }
  }
  function near(x, y, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = grid.get(cellKey(cx, cy));
        if (b) for (const e of b) fn(e);
      }
    }
  }
  function nearestEnemy(x, y, range, exclude) {
    let best = null, bd = range * range;
    for (const e of S.enemies) {
      if (e.dead || e.shield || (exclude && exclude.includes(e.id))) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function randomEnemyNear(x, y, range) {
    const list = [];
    for (const e of S.enemies) if (!e.dead && !e.shield && (e.x - x) ** 2 + (e.y - y) ** 2 < range * range) list.push(e);
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  }
  function sweep(a) {
    let j = 0;
    for (let i = 0; i < a.length; i++) if (!a[i].dead) a[j++] = a[i];
    a.length = j;
  }

  // ---------- 输入：拖动任意位置出浮动摇杆；电脑用 WASD / 方向键 ----------
  // 先按物理键位（e.code）认；个别浏览器开着中文输入法时 code 为空，再按 key 和 keyCode 兜底
  const KEYMAP = { KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  const KEYMAP_KEY = { w: 'u', W: 'u', s: 'd', S: 'd', a: 'l', A: 'l', d: 'r', D: 'r' };
  const KEYMAP_CODE = { 87: 'u', 38: 'u', 83: 'd', 40: 'd', 65: 'l', 37: 'l', 68: 'r', 39: 'r' };
  const dirKey = e => KEYMAP[e.code] || KEYMAP_KEY[e.key] || KEYMAP_CODE[e.keyCode];
  const TOUCH = matchMedia('(pointer: coarse)').matches;
  const STICK = 56;
  const keys = new Set();
  let touch = null;

  window.addEventListener('keydown', e => {
    const k = dirKey(e);
    if (k) { keys.add(k); if (state === 'play') e.preventDefault(); return; }
    if ((e.code === 'Space' || e.code === 'KeyE') && state === 'play') { e.preventDefault(); useSkill(); return; }
    if (e.code === 'KeyF' && state === 'play') { claimDrop(); return; }
    if (e.code === 'Backquote' || e.code === 'F2') { e.preventDefault(); Debug.toggle(); return; }
    if (e.code === 'Escape' && Debug.isOpen()) { Debug.toggle(false); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
    if (state === 'levelup' && /^Digit[1-3]$/.test(e.code)) {
      const id = S.choices[Number(e.code.slice(5)) - 1];
      if (id) pick(id);
    }
    if (state === 'chest' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); if (UI.chestReady()) chestTake(); else UI.chestSkip(); }
  });
  window.addEventListener('keyup', e => { const k = dirKey(e); if (k) keys.delete(k); });
  window.addEventListener('blur', () => { keys.clear(); touch = null; });

  canvas.addEventListener('pointerdown', e => {
    if (state !== 'play') return;
    touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 部分浏览器不支持 */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!touch || e.pointerId !== touch.id) return;
    touch.x = e.clientX;
    touch.y = e.clientY;
    const dx = touch.x - touch.ox, dy = touch.y - touch.oy, d = Math.hypot(dx, dy);
    if (d > STICK) { touch.ox = touch.x - (dx / d) * STICK; touch.oy = touch.y - (dy / d) * STICK; }   // 摇杆跟着手指走
  });
  const endTouch = e => { if (touch && e.pointerId === touch.id) touch = null; };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function moveVec() {
    if (autoMove) return autoMove;
    if (touch) {
      const dx = touch.x - touch.ox, dy = touch.y - touch.oy, d = Math.hypot(dx, dy);
      if (d < 5) return { x: 0, y: 0 };
      const m = Math.min(1, d / 36);
      return { x: (dx / d) * m, y: (dy / d) * m };
    }
    let x = 0, y = 0;
    if (keys.has('l')) x -= 1;
    if (keys.has('r')) x += 1;
    if (keys.has('u')) y -= 1;
    if (keys.has('d')) y += 1;
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    return { x, y };
  }

  // ---------- 开局 / 结束 ----------
  function newRun() {
    return {
      runId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      t: 0, wave: 0, waveStart: 0, phase: 'build', waveFrac: 0, cleared: false, vacuumAt: 0, intensity: 0,
      kills: 0, level: 1, xp: 0, xpNeed: xpFor(1),
      p: { x: 0, y: 0, r: CONFIG.player.radius, hp: 0, inv: 0, face: -Math.PI / 2, vface: -Math.PI / 2, roll: 0, firing: 0, aim: 0, recoil: 0, thrust: 0, squash: 0,
           tier: 0, tierFx: null, morph: 0, morphOn: false, flash: 0, hist: [], histT: 0, conT: 0 },
      enemies: [], bullets: [], ebullets: [], gems: [], pickups: [], parts: [], texts: [], rings: [], zaps: [], events: [], warns: [],
      flares: [], chunks: [], booms: [], missiles: [], wells: [], holes: [], meteors: [], strikes: [], bombs: [], decals: [], portals: [], debris: [],
      lv: { bolt: 1, orbit: 0, pulse: 0, chain: 0, missile: 0, cluster: 0, laser: 0, maxhp: 0, speed: 0, magnet: 0, power: 0, haste: 0, regen: 0, volatile: 0 },
      evo: { bolt: false, orbit: false, pulse: false, chain: false, missile: false, cluster: false, laser: false },
      cd: { bolt: 0.3, pulse: 1.5, chain: 1, missile: 0.8, cluster: 1.2, laser: 1.5 }, orbitA: 0, beam: { on: false, t: 0, a: 0 },
      fever: 0, feverN: 0, feverT: 0, beatT: 0, burstT0: 0, burstN: 0, slowmo: 0, slowCd: 0, gemT: 0, gemStep: 0,
      choiceRar: {}, skill: null, stasisT: 0, shieldT: 0, supplyAt: 0, meteorEnd: 0, meteorT: 0,
      spawnT: 0, topupT: 0, boss: null, bossSpawned: false, bossRage: false,
      pending: [], choices: [], chestItems: [], revives: 0, rerolls: 0, chestAds: 0, takeAlls: 0, boostPick: false, deaths: 0, bonusCoins: 0,
      threat: 0, threatN: 0, drop: null, buffT: 0, xpBoostUntil: 0, urgeT: 0,
      combo: 0, comboT: 0, maxCombo: 0,
      shake: 0, hurtFlash: 0, flash: 0, flashCol: COL.hot, hitstop: 0, punch: 0, trailT: 0, transT: 0, lastHit: 'grunt',
      ended: false, coins: 0, multi: 0, evoBanner: null, st: null,
    };
  }

  function start(opts = {}) {
    trackQuit();
    Sfx.init();
    S = newRun();
    computeStats();
    S.p.hp = S.st.maxHp;
    camX = 0; camY = 0; touch = null; zoomMul = 1;
    impulses.length = 0;
    Analytics.track('game_start', { run: S.runId, attempt: Save.data.runs + 1, meta: Object.assign({}, Save.data.meta) });
    if (godMode) Analytics.track('cheat', { run: S.runId, kind: 'god' });
    Analytics.track('wave_reach', { run: S.runId, wave: 1, t: 0 });
    Save.data.runs++;
    Save.persist();
    scheduleEvents();
    state = 'play';
    UI.hideModals();
    UI.showHud(true);
    UI.bossBar(false);
    UI.skill(null);
    UI.banner('第 1 波', TOUCH ? '拖动屏幕移动 · 武器自动攻击' : 'WASD / 方向键移动 · 武器自动攻击', 'me');
    if (!TOUCH) UI.keyHint();
    if (waveDef().supply) S.supplyAt = rand(...CONFIG.supply.at);
    UI.threat(0);
    UI.dropOffer(null);
    if (opts.boost) S.pending.push('boost');   // 看过开局广告：第一帧弹出史诗强化三选一
  }

  const waveNum = () => S.wave + 1;   // 7 = Boss 战
  const waveLabel = () => (S.wave >= R.waves ? 'Boss 战' : `第 ${S.wave + 1} 波`);
  const waveDef = () => CONFIG.waves[Math.min(S.wave, CONFIG.waves.length - 1)];

  function trackQuit() {
    if (!S || S.ended) return;
    S.ended = true;
    Analytics.track('game_end', { run: S.runId, result: 'quit', t: round1(S.t), wave: waveNum(), lv: S.level, kills: S.kills, coins: 0, revives: S.revives, maxCombo: S.maxCombo });
  }

  function endRun(win) {
    if (S.ended) return;
    S.ended = true;
    const C = CONFIG.coins;
    const reached = win ? R.waves + 1 : waveNum();
    S.coins = Math.floor(S.kills * C.perKill + reached * C.perWave + (win ? C.win : 0) + S.bonusCoins);
    const d = Save.data;
    d.coins += S.coins;
    d.best = Math.max(d.best, S.t);
    if (win) d.wins++;
    Save.persist();
    if (win) Analytics.track('game_win', { run: S.runId, t: round1(S.t) });
    Analytics.track('game_end', { run: S.runId, result: win ? 'win' : 'lose', t: round1(S.t), wave: waveNum(), lv: S.level, kills: S.kills, coins: S.coins, revives: S.revives, maxCombo: S.maxCombo });
    state = 'result';
    UI.showResult({ win, t: S.t, kills: S.kills, lv: S.level, wave: win ? '通关' : waveLabel(), coins: S.coins, maxCombo: S.maxCombo, evos: Object.keys(S.evo).filter(k => S.evo[k]).map(k => EVO[k].name) });
    if (S.coins > 0) Ads.offer('double_coins', { run: S.runId });
  }

  function onDeath() {
    S.deaths++;
    Analytics.track('player_death', { run: S.runId, t: round1(S.t), wave: waveNum(), lv: S.level, killer: S.lastHit, kills: S.kills, n: S.deaths });
    shards(S.p.x, S.p.y, COL.me, 40, 280);
    impulse(S.p.x, S.p.y, 70, 260);
    S.shake = 16;
    S.flash = 0.5;
    S.flashCol = COL.danger;
    S.transT = 0.9;
    touch = null;
    state = 'dying';
    Sfx.play('death');
  }

  function afterDeath() {
    if (S.revives < CONFIG.ads.reviveLimit) {
      state = 'revive';
      UI.showRevive({ t: S.t, wave: waveLabel(), lv: S.level, w: S.wave, waves: R.waves, bossLeft: S.boss ? S.boss.hp / S.boss.maxHp : null });
      Ads.offer('revive', { run: S.runId });
    } else {
      endRun(false);
    }
  }

  function reviveWithAd() {
    if (state !== 'revive') return;
    Ads.show('revive', { run: S.runId }, ok => { if (ok && state === 'revive') revive(); });
  }

  function revive() {
    UI.stopRevive();
    S.revives++;
    const p = S.p;
    p.hp = Math.round(S.st.maxHp * CONFIG.ads.reviveHp);
    p.inv = CONFIG.ads.reviveInv;
    for (const e of S.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < 240 && e.type !== 'boss' && e.type !== 'pylon' && !e.elite) { e.dead = true; shards(e.x, e.y, COL.foe, 4); }
      else if (d < 480) { e.kx += (dx / d) * 500; e.ky += (dy / d) * 500; }
    }
    S.ebullets.length = 0;
    S.rings.push({ x: p.x, y: p.y, r: 10, max: 260, dmg: 0, knock: 0, id: ++uid, dur: 0.45, t: 0, col: COL.me });
    impulse(p.x, p.y, 80, 320);
    Analytics.track('revive', { run: S.runId, t: round1(S.t) });
    state = 'play';
    UI.hideModals();
    UI.showHud(true);
    startFever();
    addThreat('revive');
    UI.banner('满血复活', `${CONFIG.ads.reviveInv} 秒无敌 · 立刻狂热`, 'gold');
    Sfx.play('reward');
  }

  function giveUp() {
    if (state !== 'revive') return;
    UI.stopRevive();
    endRun(false);
  }

  // 结算金币倍率（广告）：倍率条上的指针停在哪格就拿几倍
  function multiplyCoins(m) {
    if (!S || S.multi || state !== 'result' || S.coins <= 0) return;
    if (!CONFIG.ads.multi.includes(m)) m = CONFIG.ads.multi[0];
    Ads.show('double_coins', { run: S.runId, multi: m }, ok => {
      if (!ok || S.multi) { UI.resultMultiFail(); return; }
      S.multi = m;
      Save.data.coins += S.coins * (m - 1);
      Save.persist();
      UI.resultMultiplied(S.coins, m);
      Sfx.play('reward');
    });
  }

  function pause() {
    if (state !== 'play') return;
    state = 'paused';
    touch = null;
    UI.showPause(owned());
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'play';
    UI.hideModals();
    if (S.pending.length) openNext();
  }
  function togglePause() {
    if (state === 'play') pause();
    else if (state === 'paused') resume();
  }
  function restart() { trackQuit(); start(); }
  function quitToMenu() { trackQuit(); home(); }
  function home() {
    UI.stopRevive();
    S = null;
    state = 'menu';
    zoomMul = 1;
    UI.showMenu();
  }

  function buy(id) {
    const d = Save.data, lv = d.meta[id] || 0, cost = CONFIG.shopCosts[lv];
    if (cost === undefined || d.coins < cost) return false;
    d.coins -= cost;
    d.meta[id] = lv + 1;
    Save.persist();
    Analytics.track('shop_buy', { id, lv: lv + 1, cost });
    Sfx.init();
    Sfx.play('reward');
    return true;
  }

  // ---------- 升级三选一、宝箱、进化 ----------
  function evoPartner(passive) {
    for (const w in EVO) if (EVO[w].needs === passive) return w;
    return null;
  }
  const evoReady = w => !S.evo[w] && S.lv[w] >= UPGRADES[w].max && S.lv[EVO[w].needs] > 0;

  // 稀有度：按表抽一档；这项强化剩下的级数放不下时往下降，传说只给进化
  function rollRarity(id, table) {
    let r = 0, x = Math.random();
    while (r < table.length - 1 && x >= table[r]) { x -= table[r]; r++; }
    const room = UPGRADES[id] ? UPGRADES[id].max - S.lv[id] : 3;
    while (r > 0 && RAR[r].levels > room) r--;
    return r;
  }

  function rollChoices(exclude = [], n = 3) {
    let pool = [];
    for (const id in UPGRADES) {
      const u = UPGRADES[id], lv = S.lv[id];
      if (lv >= u.max) continue;
      pool.push({ id, w: u.kind === 'weapon' ? (lv ? 1.3 : 1.1) : 1 });
    }
    const fresh = pool.filter(o => !exclude.includes(o.id));
    if (fresh.length >= n) pool = fresh;
    const out = [];
    while (out.length < n && pool.length) {
      let sum = 0;
      for (const o of pool) sum += o.w;
      let r = Math.random() * sum, i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
      out.push(pool[i].id);
      pool.splice(i, 1);
    }
    for (const extra of ['heal', 'gold']) if (out.length < n) out.push(extra);
    return out;
  }

  function describe(id, rar = 0) {
    const R = RAR[rar];
    if (EXTRA[id]) {
      const x = EXTRA[id];
      return { id, rar, rarName: R.name, name: x.name, tag: x.tag, kind: 'extra', isNew: false, hint: '', desc: x.desc(x.amounts[rar]) };
    }
    const u = UPGRADES[id], lv = S.lv[id], to = lv + R.levels;
    const isNew = u.kind === 'weapon' && lv === 0;
    let hint = '';
    if (u.kind === 'passive') {
      const w = evoPartner(id);
      if (w && S.lv[w] > 0 && !S.evo[w]) hint = `可让「${UPGRADES[w].name}」进化`;
    } else if (EVO[id] && !S.evo[id]) {
      hint = `满级后配「${UPGRADES[EVO[id].needs].name}」可进化`;
    }
    // 一次升多级时，把每一级的效果连起来写
    const desc = u.kind === 'weapon'
      ? u.desc.slice(lv, to).join('；')
      : R.levels > 1 ? `${u.desc}（×${R.levels}）` : u.desc;
    return { id, rar, rarName: R.name, name: u.name, kind: u.kind, isNew, hint, desc,
             tag: isNew ? (to > 1 ? `新武器 · 直升 Lv ${to}` : '新武器') : `Lv ${lv} → ${to}` };
  }

  function owned() {
    const list = [];
    for (const id in UPGRADES) {
      if (!S.lv[id]) continue;
      const u = UPGRADES[id];
      let note = '';
      if (S.evo[id]) note = `已进化 · ${EVO[id].name}`;
      else if (EVO[id] && S.lv[id] >= u.max) note = `需「${UPGRADES[EVO[id].needs].name}」+ 宝箱进化`;
      list.push({ id, name: u.name, lv: S.lv[id], max: u.max, evo: !!S.evo[id], note });
    }
    return list;
  }

  function applyUpgrade(id, rar = 0) {
    if (id === 'heal') S.p.hp = Math.min(S.st.maxHp, S.p.hp + EXTRA.heal.amounts[rar]);
    else if (id === 'gold') S.bonusCoins += EXTRA.gold.amounts[rar];
    else {
      const n = Math.min(RAR[rar].levels, UPGRADES[id].max - S.lv[id]);
      S.lv[id] += n;
      computeStats();
      if (id === 'maxhp') S.p.hp = Math.min(S.st.maxHp, S.p.hp + PS.maxhp * n);
    }
  }

  function openNext() {
    touch = null;
    const k = S.pending[0];
    if (k === 'chest' || k === 'epicchest') openChest(k === 'epicchest' ? CONFIG.ads.chestMoreRar : 0);
    else if (k === 'boost') openBoost();
    else openLevelUp();
  }

  const EPIC = [0, 0, 1];   // 稀有度表：必出史诗（剩余级数放不下时照样往下降）
  function setChoices(exclude, table = CONFIG.rarity.level) {
    S.choices = rollChoices(exclude);
    S.choiceRar = {};
    for (const id of S.choices) S.choiceRar[id] = rollRarity(id, table);
  }
  function openLevelUp() {
    S.boostPick = false;
    setChoices();
    state = 'levelup';
    showLevelUpUI(false);
    Sfx.play('level');
  }
  // 开局增益（广告）：史诗强化三选一，不能换、不能全拿
  function openBoost() {
    S.boostPick = true;
    setChoices([], EPIC);
    state = 'levelup';
    showLevelUpUI(false);
    Sfx.play('level');
  }
  function showLevelUpUI(afterReroll) {
    const boost = S.boostPick;
    const left = boost ? 0 : CONFIG.ads.rerollLimit - S.rerolls;
    const allLeft = boost ? 0 : CONFIG.ads.takeAllLimit - S.takeAlls;
    UI.showLevelUp(S.choices.map(id => describe(id, S.choiceRar[id])), { level: S.level, rerollsLeft: left, takeAllLeft: allLeft, boost });
    if (left > 0 && !afterReroll) Ads.offer('reroll', { run: S.runId });
    if (allLeft > 0 && !afterReroll) Ads.offer('take_all', { run: S.runId });
  }

  function pick(id) {
    if (state !== 'levelup' || !S.choices.includes(id)) return;
    const rar = S.choiceRar[id] || 0;
    applyUpgrade(id, rar);
    Analytics.track('upgrade_pick', { run: S.runId, id, rar, lv: S.lv[id] || 0, src: S.boostPick ? 'boost' : 'level', t: round1(S.t) });
    if (S.boostPick) { S.boostPick = false; addThreat('boost'); }
    S.pending.shift();
    next();
  }

  // 三项全拿（广告）：这次升级的三张卡全部生效。卡片先飞进机体，再回到战斗
  function takeAll() {
    if (state !== 'levelup' || S.boostPick || S.takeAlls >= CONFIG.ads.takeAllLimit) return;
    Ads.show('take_all', { run: S.runId }, ok => {
      if (!ok || state !== 'levelup') return;
      S.takeAlls++;
      UI.levelUpTakeAll(() => {
        if (state !== 'levelup') return;
        for (const id of S.choices) {
          const rar = S.choiceRar[id] || 0;
          applyUpgrade(id, rar);
          Analytics.track('upgrade_pick', { run: S.runId, id, rar, lv: S.lv[id] || 0, src: 'take_all', t: round1(S.t) });
        }
        addThreat('takeAll');
        S.pending.shift();
        next();
        Sfx.play('reward');
      });
    });
  }

  // 处理完一个升级或宝箱：还有就继续弹，没有就回到战斗并放一圈冲击波腾出空间
  function next() {
    if (S.pending.length) { openNext(); return; }
    state = 'play';
    UI.hideModals();
    shockwave(S.p.x, S.p.y, 170, 300);
    S.rings.push({ x: S.p.x, y: S.p.y, r: 10, max: 180, dmg: 12 + S.level * 1.5, knock: 0, id: ++uid, dur: 0.3, t: 0, col: COL.hot });   // 升级震波顺带伤人
    const tier = tierFor(S.level);
    if (tier > S.p.tier && !S.p.tierFx) { S.p.tierFx = { t: 0, to: tier, done: false }; Sfx.play('rise'); }
    if (S.evoBanner) {
      UI.banner(`进化 · ${EVO[S.evoBanner].name}`, EVO[S.evoBanner].desc, 'hot');
      S.evoBanner = null;
      S.hitstop = 0.25;
      S.flash = 0.6;
      S.flashCol = COL.hot;
      S.punch = 0.07;
      impulse(S.p.x, S.p.y, 90, 380);
      Sfx.play('evo');
    }
  }

  function reroll() {
    if (state !== 'levelup' || S.boostPick || S.rerolls >= CONFIG.ads.rerollLimit) return;
    Ads.show('reroll', { run: S.runId }, ok => {
      if (!ok || state !== 'levelup') return;
      S.rerolls++;
      Analytics.track('upgrade_reroll', { run: S.runId, n: S.rerolls });
      setChoices(S.choices);
      showLevelUpUI(true);
      Sfx.play('reward');
    });
  }

  // 宝箱（抽卡）：能进化就必出进化（传说）；否则随机 1 项，4 成概率 3 项，每项按宝箱的稀有度表抽。
  // minRar = 2 是广告保底：每项都是史诗，并尽量挑还能连升 3 级的强化
  function chestRoll(allowTriple, minRar = 0) {
    const evo = Object.keys(EVO).find(evoReady);
    if (evo) { applyEvo(evo); return [{ id: evo, evo: true, rar: 3, rarName: RAR[3].name, name: EVO[evo].name, desc: EVO[evo].desc, tag: '武器进化' }]; }
    const n = allowTriple && Math.random() < CONFIG.chest.tripleChance ? 3 : 1;
    const tight = minRar ? Object.keys(UPGRADES).filter(id => UPGRADES[id].max - S.lv[id] < RAR[minRar].levels) : [];
    return rollChoices(tight, n).map(id => {
      const rar = rollRarity(id, minRar ? EPIC : CONFIG.rarity.chest), d = describe(id, rar);
      applyUpgrade(id, rar);
      return d;
    });
  }

  function openChest(minRar = 0) {
    const items = chestRoll(true, minRar);
    S.chestItems = items;
    state = 'chest';
    S.chestAdNow = false;   // 每个宝箱最多再抽一次
    const canAd = S.chestAds < CONFIG.ads.chestLimit;
    // 滚轴上陪跑的格子：普通到史诗用升级名，传说用进化名
    const pool = { up: Object.keys(UPGRADES).map(id => ({ id, name: UPGRADES[id].name })), evo: Object.keys(EVO).map(id => ({ id, name: EVO[id].name })) };
    UI.showChest(items, { canAd, pool, epic: minRar > 0 });
    if (canAd) Ads.offer('chest_more', { run: S.runId });
    Analytics.track('chest_open', { run: S.runId, n: items.length, evo: items[0].evo ? items[0].id : null, top: Math.max(...items.map(d => d.rar)), t: round1(S.t) });
  }

  function chestMore() {
    if (state !== 'chest' || S.chestAdNow || S.chestAds >= CONFIG.ads.chestLimit) return;
    Ads.show('chest_more', { run: S.runId }, ok => {
      if (!ok || state !== 'chest' || S.chestAdNow) return;
      S.chestAds++;
      S.chestAdNow = true;
      const items = chestRoll(false, CONFIG.ads.chestMoreRar);
      addThreat('chestMore');
      S.chestItems = S.chestItems.concat(items);
      UI.addChestItems(items);
    });
  }

  function chestTake() {
    if (state !== 'chest') return;
    S.pending.shift();
    next();
  }

  // 进化在抽卡动画里揭晓；闪屏、顿帧和横幅留到关掉弹窗、回到战斗那一刻再放
  function applyEvo(id) {
    S.evo[id] = true;
    Analytics.track('evolve', { run: S.runId, id, t: round1(S.t) });
    S.evoBanner = id;
  }

  function gainXp(v) {
    if (S.t < S.xpBoostUntil) v *= CONFIG.ads.xpWave;
    S.xp += v;
    while (S.xp >= S.xpNeed) {
      S.xp -= S.xpNeed;
      S.level++;
      S.xpNeed = xpFor(S.level);
      S.pending.push('level');
      Analytics.track('level_up', { run: S.runId, lv: S.level, t: round1(S.t) });
    }
  }

  // ---------- 波次：蓄力 → 高峰事件 → 喘息 ----------
  function viewHalf() { return { hw: W / zoomEff / 2, hh: H / zoomEff / 2 }; }

  function spawnPos(margin = 50) {
    // 在屏幕外一圈的矩形边上随机取点
    const v = viewHalf(), hw = v.hw + margin, hh = v.hh + margin;
    let p = Math.random() * 4 * (hw + hh), x, y;
    if (p < 2 * hw) { x = -hw + p; y = -hh; }
    else if ((p -= 2 * hw) < 2 * hw) { x = -hw + p; y = hh; }
    else if ((p -= 2 * hw) < 2 * hh) { x = -hw; y = -hh + p; }
    else { p -= 2 * hh; x = hw; y = -hh + p; }
    return { x: S.p.x + x, y: S.p.y + y };
  }

  function spawnEnemy(type, x, y, opt = {}) {
    const d = CONFIG.enemies[type], E = CONFIG.elite, elite = !!opt.elite;
    const boss = type === 'boss', bossy = boss || type === 'pylon';   // 护盾发生器和 Boss 一样，生命不随时间涨
    const T = CONFIG.threat, th = S.threat, tm = 1 + th * T.dmg;   // 威胁度：看广告拿了永久强化后，新刷的敌人跟着变强
    const hpMul = bossy ? 1 + th * T.boss : (1 + (S.t / 60) * CONFIG.hpGrowthPerMin) * (elite ? E.hpMul : 1) * (1 + th * T.hp);
    const dmgMul = (bossy ? 1 : (1 + (S.t / 60) * CONFIG.dmgGrowthPerMin) * (elite ? 1.5 : 1)) * tm;
    const hp = d.hp * hpMul, rot = Math.atan2(S.p.y - y, S.p.x - x);
    const e = {
      id: ++uid, type, elite, ev: opt.ev || null, x, y, kx: 0, ky: 0, vx: opt.vx || 0, vy: opt.vy || 0, life: opt.life || 0,
      cx: opt.cx || 0, cy: opt.cy || 0, ring: opt.ring || 0, ri: opt.ri || 0, rn: opt.rn || 0, dead: false,
      r: d.r * (elite ? E.sizeMul : 1), hp, maxHp: hp,
      speed: d.speed * (elite ? 0.8 : rand(0.9, 1.1)), dmg: d.dmg * dmgMul, tm,
      xp: elite ? E.xp : d.xp / (1 + th * T.crowd), flash: 0,   // 威胁度带来的增援不额外给经验，免得越打越肥
      pop: 0, rot, spin: boss ? 0.25 : rand(-2, 2), slowT: 0,
      fire: rand(0.5, 1) * (d.fireEvery || 1), orbitHit: 0, pulseId: 0, ai: null,
      born: S.t, lx: x, ly: y, lrot: rot, mvx: 0, mvy: 0, bank: 0, tilt: 0, kick: 0, ph: Math.random() * TAU,
    };
    S.enemies.push(e);
    return e;
  }

  function pickWeighted(mix) {
    let sum = 0;
    for (const k in mix) sum += mix[k];
    let r = Math.random() * sum;
    for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
    return Object.keys(mix)[0];
  }

  function scheduleEvents() {
    const EV = CONFIG.events;
    S.events = (waveDef().events || []).map((ev, i) => ({ ev, at: S.waveStart + R.peakAt + i * EV.gap, warned: false, done: false, data: null }));
  }

  function warnEvent(kind, at) {
    const v = viewHalf(), p = S.p;
    let data;
    if (kind === 'swarm') {
      const a = Math.random() * TAU, dist = Math.hypot(v.hw, v.hh) + 80;
      data = { a, cx: p.x, cy: p.y, dist };
      UI.banner('警告 · 蜂群横穿', '离开红色通道', 'danger');
    } else if (kind === 'ring') {
      data = { cx: p.x, cy: p.y, r: Math.min(v.hw, v.hh) * 0.92 };
      UI.banner('警告 · 包围圈', '冲出红圈，或者打穿它', 'danger');
    } else if (kind === 'hole') {
      const a = Math.random() * TAU, d = rand(170, 240);
      data = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      UI.banner('警告 · 黑洞', '别被吸进去，把敌人引过去', 'danger');
    } else if (kind === 'meteor') {
      data = {};
      UI.banner('警告 · 陨石雨', '躲开红圈，敌人也会被砸', 'danger');
    } else {
      data = spawnPos(-70);   // 落在屏幕边内侧，玩家能看到传送门打开
      UI.banner('精英出现', '击败它得到宝箱', 'danger');
    }
    S.warns.push(Object.assign({ kind, until: at }, data));
    Sfx.play('warn');
    return data;
  }

  function fireEvent(kind, d) {
    const EV = CONFIG.events;
    Analytics.track('map_event', { run: S.runId, kind, wave: waveNum(), t: round1(S.t) });
    if (kind === 'swarm') {
      const dx = Math.cos(d.a), dy = Math.sin(d.a), nx = -dy, ny = dx;
      const n = EV.swarmCount, sp = CONFIG.enemies.dart.speed;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * EV.swarmSpacing, back = (i % 2) * 18;
        spawnEnemy('dart', d.cx - dx * (d.dist + back) + nx * off, d.cy - dy * (d.dist + back) + ny * off,
          { ev: 'swarm', vx: dx * sp, vy: dy * sp, life: (d.dist * 2 + 60) / sp });
      }
    } else if (kind === 'ring') {
      const n = Math.round((TAU * d.r) / EV.ringSpacing), ring = ++uid;   // 记下每颗雷在圈里的序号，相邻两颗之间画能量链
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        spawnEnemy('wall', d.cx + Math.cos(a) * d.r, d.cy + Math.sin(a) * d.r, { ev: 'ring', cx: d.cx, cy: d.cy, ring, ri: i, rn: n });
      }
      impulse(d.cx, d.cy, -30, d.r);
      S.shake += 4;
    } else if (kind === 'hole') {
      S.holes.push({ x: d.x, y: d.y, t: 0, warpT: 0, dead: false });
      impulse(d.x, d.y, -60, CONFIG.hole.radius);
      flare(d.x, d.y, 260, 0.45, 'void', 0.15);   // 一团紫光往里塌进去
      flare(d.x, d.y, 90, 0.25, 'hot', 0.2);
      S.shake += 3;
      Sfx.play('hole');
    } else if (kind === 'meteor') {
      S.meteorEnd = S.t + CONFIG.meteor.dur;
      S.meteorT = 0;
    } else {
      const type = S.wave >= 3 && Math.random() < 0.35 ? 'shooter' : Math.random() < 0.5 ? 'tank' : 'grunt';
      spawnEnemy(type, d.x, d.y, { elite: true });
      S.portals.push({ x: d.x, y: d.y, t: 0, dead: false });   // 传送门：精英从里面钻出来
      flare(d.x, d.y, 120, 0.3, 'danger', 1.5);
      impulse(d.x, d.y, 40, 180);
    }
  }

  function updateWave() {
    const w = Math.min(R.waves, Math.floor(S.t / R.waveDuration));
    if (w !== S.wave) {
      S.wave = w;
      S.waveStart = w * R.waveDuration;
      S.cleared = false;
      if (w < R.waves) {
        Analytics.track('wave_reach', { run: S.runId, wave: w + 1, t: round1(S.t) });
        UI.banner(`第 ${w + 1} 波`, w === R.waves - 1 ? '最后一波，Boss 快来了' : '', 'me');
        scheduleEvents();
        S.supplyAt = waveDef().supply ? S.waveStart + rand(...CONFIG.supply.at) : 0;
      } else {
        spawnBoss();
      }
    }
    const wt = S.t - S.waveStart;
    S.phase = S.wave >= R.waves ? 'boss' : wt < R.peakAt ? 'build' : wt < R.relaxAt ? 'peak' : 'relax';
    S.waveFrac = S.wave >= R.waves ? 1 : wt / R.waveDuration;

    for (const e of S.events) {
      if (!e.warned && S.t >= e.at - CONFIG.events.warn) { e.warned = true; e.data = warnEvent(e.ev, e.at); }
      if (!e.done && S.t >= e.at) { e.done = true; fireEvent(e.ev, e.data); }
    }
    S.warns = S.warns.filter(x => x.until > S.t);
    if (S.supplyAt && S.t >= S.supplyAt) { S.supplyAt = 0; spawnSupply(); }

    if (S.phase === 'relax' && !S.cleared) {   // 进入喘息段：结算本波，稍后把场上经验全吸过来
      S.cleared = true;
      S.vacuumAt = S.t + 0.6;
      UI.banner(`第 ${S.wave + 1} 波 · 完成`, '经验回收中', 'me');
      Analytics.track('wave_clear', { run: S.runId, wave: S.wave + 1, t: round1(S.t), hp: Math.round(S.p.hp), lv: S.level });
      if (CONFIG.ads.dropWaves.includes(S.wave + 1)) offerDrop();
    }
    if (S.vacuumAt && S.t >= S.vacuumAt) {
      S.vacuumAt = 0;
      for (const g of S.gems) g.mag = true;
    }

    const target = S.phase === 'boss' ? 0.85 : S.phase === 'peak' ? 1 : S.phase === 'relax' ? 0.1 : 0.15 + 0.5 * (wt / R.peakAt);
    S.intensity += (target - S.intensity) * 0.03;
  }

  // 波间广告空投：喘息段在屏幕边上弹出，限时点开、看完广告领取；奖励直接写在入口上
  const DROPS = ['overdrive', 'epicBox', 'xpWave'];
  function offerDrop() {
    const kind = DROPS[(Math.random() * DROPS.length) | 0];
    S.drop = { kind, until: S.t + CONFIG.ads.dropWindow };
    UI.dropOffer(kind, CONFIG.ads.dropWindow);
    Ads.offer('wave_drop', { run: S.runId, kind });
    Sfx.play('drop');
  }
  function claimDrop() {
    if (state !== 'play' || !S.drop || Ads.isActive()) return;
    const kind = S.drop.kind;
    state = 'adwait';   // 广告播放期间战斗停住
    touch = null;
    Ads.show('wave_drop', { run: S.runId, kind }, ok => {
      if (state === 'adwait') state = 'play';
      if (!ok || !S.drop) return;
      S.drop = null;
      UI.dropOffer(null, 0, true);
      grantDrop(kind);
    });
  }
  function grantDrop(kind) {
    const A = CONFIG.ads, p = S.p;
    if (kind === 'overdrive') {
      S.buffT = A.overdrive.dur;
      UI.banner('火力全开', `${A.overdrive.dur} 秒内伤害 +${A.overdrive.dmg * 100}% · 射速 +${A.overdrive.rate * 100}%`, 'gold');
    } else if (kind === 'epicBox') {
      S.pending.push('epicchest');
      addThreat('epicBox');
    } else {
      S.xpBoostUntil = (S.wave + 2) * R.waveDuration;   // 一直到下一波结束
      addThreat('xpWave');
      UI.banner('双倍经验', '下一波经验 ×' + A.xpWave, 'gold');
    }
    S.flash = 0.3;
    S.flashCol = PCOL.gold;
    S.rings.push({ x: p.x, y: p.y, r: 10, max: 200, dmg: 0, knock: 0, id: ++uid, dur: 0.4, t: 0, col: PCOL.gold });
    impulse(p.x, p.y, 60, 300);
    Sfx.play('reward');
  }

  // 威胁度：靠广告拿到永久强化后，之后刷出的敌人按比例变强（系数见 CONFIG.threat）
  function addThreat(key) {
    S.threat += CONFIG.threat[key] || 0;
    S.threatN++;
    UI.threat(S.threatN, true);
    Analytics.track('threat', { run: S.runId, src: key, threat: Math.round(S.threat * 100) / 100, t: round1(S.t) });
  }

  function updateSpawns(dt) {
    if (S.phase === 'relax') return;
    const wv = waveDef();
    const k = S.phase === 'build' ? clamp((S.t - S.waveStart) / R.peakAt, 0, 1) : 1;
    const crowd = 1 + S.threat * CONFIG.threat.crowd;   // 威胁度：敌人更多
    const target = Math.round((wv.min[0] + (wv.min[1] - wv.min[0]) * k) * crowd);
    let regular = 0;
    for (const e of S.enemies) if (!e.dead && !e.ev && e.type !== 'boss') regular++;
    let n = 0;
    S.spawnT -= dt;
    if (S.spawnT <= 0) { S.spawnT = Math.max(S.spawnT + wv.interval, 0.05); n += Math.round(wv.batch * crowd); }
    S.topupT -= dt;
    if (S.topupT <= 0) {   // 低于最少在场数就补，每 0.25 秒最多补 4 只
      S.topupT = 0.25;
      if (regular + n < target) n += Math.min(4, target - regular - n);
    }
    n = Math.min(n, CONFIG.maxEnemies - S.enemies.length);
    for (let i = 0; i < n; i++) {
      const q = spawnPos();
      spawnEnemy(pickWeighted(wv.mix), q.x, q.y);
    }
  }

  function spawnBoss() {
    const B = CONFIG.boss, q = spawnPos();
    const e = spawnEnemy('boss', q.x, q.y);
    e.ai = { volley: B.volleyEvery, summon: B.summonEvery, dash: B.dashEvery[0], mode: 'chase', modeT: 0, dx: 0, dy: 0, ang: 0,
             stage: 0, pylons: 0, spiral: 0, spiralT: 0, spiralStep: 0, sang: 0, sdir: 1 };
    e.shield = false;
    S.boss = e;
    S.bossSpawned = true;
    S.events = [];
    S.punch = 0.05;
    Analytics.track('wave_reach', { run: S.runId, wave: R.waves + 1, t: round1(S.t) });
    Analytics.track('boss_spawn', { run: S.runId, t: round1(S.t) });
    UI.banner('BOSS · 虚空核心', '三个阶段 · 每崩一层装甲会升起护盾', 'danger');
    UI.bossBar(true);
    Sfx.play('boss');
  }

  function spawnSupply() {
    const q = spawnPos(20);
    spawnEnemy('supply', q.x, q.y, { ev: 'supply', life: CONFIG.supply.life });
    UI.banner('补给飞船出现', '追上去打爆它，会掉主动技能', 'hot');
    Sfx.play('reward');
    Analytics.track('supply_spawn', { run: S.runId, wave: waveNum(), t: round1(S.t) });
  }

  function enemyShot(x, y, ang, speed, dmg, spr, src) {
    if (S.ebullets.length > 220) return;
    S.ebullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: spr === 'bbullet' ? 6.5 : 4.5, dmg, spr, src, life: 5, dead: false });
  }

  // Boss 三个阶段（stage 0/1/2）。门槛在 hurt 里检查，过门槛时崩装甲、升护盾（bossArmorBreak）；
  // 发生器全打掉后破盾硬直（bossShieldBreak），之后换成这一阶段的攻击：二阶段加螺旋弹幕，三阶段螺旋多一条臂、弹幕更密、召唤带飞梭
  function bossAI(e, dt, dx, dy, d) {
    const B = CONFIG.boss, ai = e.ai, st = ai.stage;
    if (ai.mode === 'stun') {   // 破盾硬直：原地不动、不开火，身上冒紫色电火花
      ai.modeT -= dt;
      if (Math.random() < 0.4) sparks(e.x + rand(-0.7, 0.7) * e.r, e.y + rand(-0.7, 0.7) * e.r, Math.random() * TAU, 0.7, 2, 240, COL.void, 8);
      if (ai.modeT <= 0) { ai.mode = 'chase'; ai.dash = B.dashEvery[st]; ai.volley = 0.8; ai.spiral = 0.6; }
      return [0, 0];
    }
    ai.volley -= dt; ai.summon -= dt;
    if (!e.shield) ai.dash -= dt;   // 开护盾时不冲撞，慢慢跟着玩家，让玩家去拆发生器
    if (ai.mode === 'windup') {
      ai.modeT -= dt;
      if (ai.modeT <= 0) { ai.mode = 'dash'; ai.modeT = B.dashTime; S.shake += 5; }
      return [0, 0];
    }
    if (ai.mode === 'dash') {
      ai.modeT -= dt;
      if (Math.random() < 0.5) impulse(e.x, e.y, 14, 120);
      if (ai.modeT <= 0) { ai.mode = 'chase'; ai.dash = B.dashEvery[st]; }
      return [ai.dx * B.dashSpeed, ai.dy * B.dashSpeed];
    }
    if (ai.dash <= 0) { ai.mode = 'windup'; ai.modeT = B.dashWindup; ai.dx = dx / d; ai.dy = dy / d; }
    if (ai.volley <= 0) {
      ai.volley = B.volleyEvery * [1, 0.85, 0.7][st];
      const n = B.volleyCount + [0, 2, 6][st];
      for (let i = 0; i < n; i++) enemyShot(e.x, e.y, ai.ang + (i * TAU) / n, B.bulletSpeed, B.bulletDmg * e.tm, 'bbullet', 'boss');
      ai.ang += 0.25;
      impulse(e.x, e.y, 22, 160);
    }
    if (st >= 1 && !e.shield) {   // 螺旋弹幕：几条臂一边转一边连发，每轮换一次转向
      if (ai.spiralT > 0) {
        ai.spiralT -= dt;
        ai.spiralStep -= dt;
        const arms = B.spiralArms + st - 1;
        while (ai.spiralStep <= 0) {
          ai.spiralStep += B.spiralEvery;
          for (let i = 0; i < arms; i++) enemyShot(e.x, e.y, ai.sang + (i * TAU) / arms, B.spiralSpeed, B.bulletDmg * 0.6 * e.tm, 'bbullet', 'boss');
          ai.sang += 0.21 * ai.sdir;
        }
      } else if ((ai.spiral -= dt) <= 0) {
        ai.spiral = B.spiralCd;
        ai.spiralT = B.spiralDur;
        ai.spiralStep = 0;
        ai.sdir = -ai.sdir;
      }
    }
    if (ai.summon <= 0) {
      ai.summon = B.summonEvery;
      const n = Math.round(B.summonCount * (1 + S.threat * CONFIG.threat.crowd));   // 威胁度越高召唤越多
      for (let i = 0; i < n; i++) {
        const a = (i * TAU) / n;
        spawnEnemy(st >= 2 && i % 4 === 0 ? 'runner' : 'grunt', e.x + Math.cos(a) * (e.r + 30), e.y + Math.sin(a) * (e.r + 30));
      }
    }
    const sp = e.speed * (e.shield ? 0.5 : 1);
    return [(dx / d) * sp, (dy / d) * sp];
  }

  // 血量打到门槛：外装甲崩掉一层（碎块、连环小爆炸），升起护盾，放出一圈绕着 Boss 转的护盾发生器
  function bossArmorBreak(e) {
    const SH = CONFIG.boss.shield, ai = e.ai;
    ai.stage++;
    ai.morphT = S.t;   // 换外形的动画从这一刻算起
    e.spin = [0.25, 0.9, -0.55][ai.stage];   // 刃环转得快，裸核反着转
    const R = e.r * Art.VIS, parts = ai.stage === 1 ? [['bossGun', 4, TAU / 8, 1.2], ['bossPlate', 8, TAU / 16, 0.91]] : [['bossBlade', 6, 0, 0.95]];
    for (const [spr, n, off, dist] of parts) {   // 崩掉的那层外形整块飞出去：一阶段的主炮和外装甲 / 二阶段的六片弯刀
      for (let i = 0; i < n; i++) {
        const a = e.rot + (i * TAU) / n + off, sp = rand(140, 260), life = rand(1.1, 1.6);
        S.debris.push({ spr, x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: a, spin: rand(0.8, 2.2) * (Math.random() < 0.5 ? -1 : 1), off: dist * R, life, max: life, dead: false });
      }
    }
    ai.mode = 'chase';
    ai.spiralT = 0;
    e.shield = true;
    const n = SH.pylons[ai.stage - 1];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const q = spawnEnemy('pylon', e.x + Math.cos(a) * SH.orbit, e.y + Math.sin(a) * SH.orbit, { ev: 'pylon' });
      q.host = e;
      q.oa = a;
      q.ospd = SH.spin * (ai.stage % 2 ? 1 : -1);
      q.born = S.t;
    }
    ai.pylons = n;
    ai.shieldAt = S.t;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.random();
      S.booms.push({ t: i * 0.06, x: e.x + Math.cos(a) * e.r * 0.9, y: e.y + Math.sin(a) * e.r * 0.9, r: e.r * 0.35, pal: 'danger', tier: 1 });
    }
    chunks(e.x, e.y, 18, 380, 'danger', 7);
    flare(e.x, e.y, e.r * 5, 0.45, 'void', 1.4);
    S.rings.push({ x: e.x, y: e.y, r: e.r, max: e.r * 4.5, dmg: 0, knock: 0, id: ++uid, dur: 0.5, t: 0, col: COL.void });
    impulse(e.x, e.y, 90, 420);
    S.hitstop = 0.15;
    S.shake += 12;
    S.flash = 0.35;
    S.flashCol = COL.void;
    S.bossRage = ai.stage >= 2;
    UI.banner(ai.stage === 1 ? '装甲崩落' : '核心过载', `护盾升起 · 打掉 ${n} 座护盾发生器`, 'danger');
    Sfx.play('boss');
    Analytics.track('boss_phase', { run: S.runId, stage: ai.stage + 1, t: round1(S.t), hp: Math.round(S.p.hp) });
  }
  // 发生器全打掉：护盾炸成碎片，Boss 硬直几秒、这段时间受到的伤害更高
  function bossShieldBreak(e) {
    const SH = CONFIG.boss.shield, ai = e.ai;
    e.shield = false;
    ai.mode = 'stun';
    ai.modeT = SH.stun;
    shards(e.x, e.y, COL.void, 60, 420);
    for (let i = 0; i < 3; i++) S.rings.push({ x: e.x, y: e.y, r: e.r, max: e.r * (3 + i * 1.6), dmg: 0, knock: 0, id: ++uid, dur: 0.3 + i * 0.12, t: 0, col: i ? COL.void : COL.hot, soft: i > 0 });
    flare(e.x, e.y, e.r * 4, 0.3, 'hot', 1.5);
    impulse(e.x, e.y, 70, 380);
    S.hitstop = 0.12;
    S.shake += 10;
    S.flash = 0.3;
    S.flashCol = COL.void;
    UI.banner('护盾破碎', `核心暴露 · ${SH.stun} 秒内伤害 +${Math.round(SH.stunDmg * 100)}%`, 'hot');
    Sfx.play('bigkill');
    Analytics.track('boss_shield', { run: S.runId, stage: ai.stage + 1, t: round1(S.t), dur: round1(S.t - ai.shieldAt) });   // 破盾用了多久
  }
  // 打在护盾上：命中点一段亮弧涟漪 + 紫色火花，隔一会儿飘一个“护盾”
  function deflect(e, kx, ky) {
    const a = kx || ky ? Math.atan2(ky, kx) : Math.atan2(e.y - S.p.y, e.x - S.p.x);
    const R = e.r * 1.45, hx = e.x - Math.cos(a) * R, hy = e.y - Math.sin(a) * R;
    e.shT = S.t;
    e.shA = a + Math.PI;
    if (Math.random() < 0.35) {
      glint(hx, hy, 20, 0.08, 'void', 0.9);
      sparks(hx, hy, a + Math.PI, 0.8, 2, 240, COL.void, 7);
    }
    if (S.t > (e.shTextT || 0)) { e.shTextT = S.t + 0.5; text(hx, hy, '护盾', false); Sfx.play('hit', 0, panAt(hx)); }
  }

  // ---------- 反馈：冲击、火花、爆炸、数字、连杀 ----------
  const FACE = { grunt: 1, runner: 1, tank: 1, shooter: 1 };   // 会转向玩家的舰船

  function impulse(x, y, a, r) {
    if (impulses.length > 40) impulses.shift();
    impulses.push({ x, y, a, r, t: 0 });
  }

  function shards(x, y, color, n, sp = 170) {
    for (let i = 0; i < n && S.parts.length < 700; i++) {
      const a = Math.random() * TAU, v = sp * (0.3 + Math.random() * 0.7), life = 0.3 + Math.random() * 0.45;
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color,
                     len: 3 + Math.random() * 6, ang: Math.random() * TAU, spin: rand(-14, 14), dead: false });
    }
  }

  // 火花：沿方向 a 喷出的细长亮线，朝飞行方向拉长
  function sparks(x, y, a, spread, n, sp, color, len = 9) {
    for (let i = 0; i < n && S.parts.length < 700; i++) {
      const b = a + rand(-spread, spread), v = sp * rand(0.5, 1), life = rand(0.12, 0.26);
      S.parts.push({ x, y, vx: Math.cos(b) * v, vy: Math.sin(b) * v, life, max: life, color,
                     len: len * rand(0.6, 1.2), ang: b, spin: 0, dead: false });
    }
  }

  // 闪光：一团辉光，从 size 长到 size·grow，同时淡出
  function flare(x, y, size, life, col, grow = 1.5, alpha = 1) {
    if (S.flares.length > 160) S.flares.shift();
    S.flares.push({ x, y, s0: size, s1: size * grow, life, max: life, col, alpha, dead: false });
  }

  // 星芒：十字形亮闪，命中、枪口、闪电端点都用它
  function glint(x, y, size, life, col, alpha = 1) {
    if (S.flares.length > 160) S.flares.shift();
    S.flares.push({ x, y, s0: size, s1: size * 0.6, life, max: life, col, alpha, tex: 'star', rot: Math.random() < 0.5 ? 0 : Math.PI / 4, dead: false });
  }
  // 火球：白芯往外是黄、金、橙红，炸弹落地用
  function fireball(x, y, size, life) {
    if (S.flares.length > 160) S.flares.shift();
    S.flares.push({ x, y, s0: size * 0.55, s1: size, life, max: life, col: 'gold', alpha: 0.95, tex: 'fire', rot: Math.random() * TAU, dead: false });
  }

  // 残骸：爆炸时飞出的机身碎块，会转、会减速
  function chunks(x, y, n, sp, pal, size) {
    for (let i = 0; i < n && S.chunks.length < 140; i++) {
      const a = Math.random() * TAU, v = sp * rand(0.35, 1), life = rand(0.5, 0.9);
      S.chunks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ang: Math.random() * TAU, spin: rand(-9, 9),
                      life, max: life, size: size * rand(0.6, 1.2), pal, dead: false });
    }
  }

  const PCOL = { me: COL.me, foe: COL.foe, danger: COL.danger, hot: COL.hot, gold: '#ffd25a', void: COL.void, rock: '#ff8a3c' };   // 调色板名 → 颜色

  // 爆炸分四档：0 普通、1 装甲舰、2 精英、3 Boss
  function explosion(x, y, r, pal, tier) {
    const k = 1 + tier * 0.45;
    flare(x, y, r * 2.4 * k, 0.14 + tier * 0.05, 'hot', 1.7);
    glint(x, y, r * 3.2 * k, 0.16 + tier * 0.05, tier ? 'hot' : pal, 0.9);
    flare(x, y, r * 3 * k, 0.28 + tier * 0.08, pal, 1.4, 0.45);
    S.rings.push({ x, y, r: r * 0.5, max: r * 2.2 * k, dmg: 0, knock: 0, id: ++uid, dur: 0.14 + tier * 0.05, t: 0, col: PCOL[pal], soft: true });
    sparks(x, y, 0, Math.PI, 7 + tier * 6, 330 * k, PCOL[pal], 11 * k);
    sparks(x, y, 0, Math.PI, 3 + tier * 3, 260 * k, COL.hot, 8);
    chunks(x, y, 3 + tier * 2, 150 * k, pal, r * 0.3 + 1.5);
  }

  function text(x, y, txt, big) {
    if (S.texts.length > 60) S.texts.shift();
    const life = big ? 0.75 : 0.5;
    S.texts.push({ x: x + rand(-6, 6), y, vx: rand(-40, 40), vy: big ? -150 : -110, txt, big, life, max: life, dead: false });
  }

  // 只在真正打出成绩时放大反馈：连杀到里程碑才炸屏，平时只有小幅涟漪
  function addCombo() {
    S.combo++;
    S.comboT = CONFIG.combo.window;
    if (S.combo > S.maxCombo) S.maxCombo = S.combo;
    const tier = CONFIG.combo.milestones.indexOf(S.combo);
    if (tier < 0) return;
    UI.comboBurst(S.combo, tier);
    impulse(S.p.x, S.p.y, 20 + tier * 12, 150 + tier * 50);
    S.shake += 2 + tier * 1.5;
    if (tier >= 2) { S.flash = 0.18; S.flashCol = COL.me; }
    Sfx.play('combo', tier);
  }

  function shockwave(x, y, radius, force) {
    for (const e of S.enemies) {
      if (e.dead || e.type === 'boss') continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < radius) { e.kx += (dx / d) * force; e.ky += (dy / d) * force; }
    }
    S.rings.push({ x, y, r: 10, max: radius, dmg: 0, knock: 0, id: ++uid, dur: 0.3, t: 0, col: COL.me });
    impulse(x, y, 40, radius + 40);
  }

  function hurt(e, base, kx, ky, noCrit) {
    if (e.dead || base <= 0) return;
    if (e.shield) { deflect(e, kx, ky); return; }
    const isBoss = e.type === 'boss';
    const crit = !noCrit && Math.random() < CONFIG.crit.chance;
    let dmg = base * S.st.dmg * (crit ? CONFIG.crit.mul : 1) * (S.feverT > 0 ? CONFIG.fever.dmg : 1) * (S.buffT > 0 ? 1 + CONFIG.ads.overdrive.dmg : 1);
    if (isBoss && e.ai.mode === 'stun') dmg *= 1 + CONFIG.boss.shield.stunDmg;
    e.hp -= dmg;
    if (isBoss) {   // 下一道阶段门槛：一下打穿也停在门槛上，阶段不会被跳过
      const th = CONFIG.boss.phases[e.ai.stage];
      if (th != null && e.hp <= e.maxHp * th) { e.hp = e.maxHp * th; bossArmorBreak(e); }
    }
    e.flash = isBoss ? 0.04 : 0.09;
    e.pop = isBoss ? 0.3 : 1;
    if (!isBoss) e.tilt += (Math.random() < 0.5 ? -1 : 1) * (crit ? 0.5 : 0.25);   // 挨打时机身歪一下
    if (e.type !== 'boss' && e.type !== 'dart') {
      const res = e.elite ? 0.3 : e.type === 'tank' ? 0.5 : 1;
      e.kx += kx * res;
      e.ky += ky * res;
    }
    // 命中点在敌人朝向攻击来处的一侧，火花顺着攻击方向往后喷
    const a = kx || ky ? Math.atan2(ky, kx) : Math.atan2(e.y - S.p.y, e.x - S.p.x);
    const hx = e.x - Math.cos(a) * e.r * 0.6, hy = e.y - Math.sin(a) * e.r * 0.6;
    const pal = isBoss || e.elite ? 'danger' : 'foe';
    if (!isBoss || crit || Math.random() < 0.3) {   // 命中点一颗十字星芒，暴击是大号金色的
      glint(hx, hy, crit ? 50 : 26, crit ? 0.17 : 0.1, crit ? 'gold' : 'hot');
      flare(hx, hy, crit ? 20 : 11, 0.08, 'hot', 1.3, 0.7);
    }
    sparks(hx, hy, a, 0.65, crit ? 7 : 3, crit ? 420 : 300, crit ? COL.hot : COL[pal], crit ? 12 : 8);
    text(e.x, e.y - e.r, Math.round(dmg) + (crit ? '!' : ''), crit);
    if (crit) { S.shake = Math.max(S.shake, 1.5); Sfx.play('crit', 0, panAt(e.x)); } else Sfx.play('hit', 0, panAt(e.x));
    if (e.hp <= 0) kill(e);
  }

  function kill(e) {
    e.dead = true;
    S.kills++;
    addCombo();
    const isBoss = e.type === 'boss', supply = e.type === 'supply', pylon = e.type === 'pylon';
    const pal = isBoss || e.elite ? 'danger' : supply ? 'gold' : pylon ? 'void' : 'foe';
    const tier = isBoss ? 3 : e.elite || supply ? 2 : e.type === 'tank' || pylon ? 1 : 0;
    explosion(e.x, e.y, e.r, pal, tier);
    if (supply) dropSupply(e);
    if (pylon && e.host && !e.host.dead) {   // 发生器炸掉：连到 Boss 的能量链一节节断开，全断了就破盾
      const h = e.host;
      for (let i = 1; i <= 5; i++) { const k = i / 6; flare(e.x + (h.x - e.x) * k, e.y + (h.y - e.y) * k, 18, 0.2 + i * 0.03, 'void', 1.6, 0.8); }
      if (--h.ai.pylons <= 0 && h.shield) bossShieldBreak(h);
    }
    impulse(e.x, e.y, [8, 22, 45, 140][tier], [56, 110, 200, 600][tier]);
    Sfx.play(['kill', 'boom', 'bigkill', 'bigkill'][tier], 0, panAt(e.x));
    if (isBoss) { bossDown(e); return; }
    chargeFever(e.elite || supply ? CONFIG.fever.elite : 1);
    countBurst();
    const V = CONFIG.volatile;
    if (S.lv.volatile && Math.random() < S.lv.volatile * PS.volatile && S.booms.length < V.maxPending)
      S.booms.push({ t: rand(0.07, 0.15), x: e.x, y: e.y, r: e.r * 0.8, pal: 'gold', tier: 0, dmg: V.dmg, radius: V.radius + e.r });
    if (S.feverT > 0) flare(e.x, e.y, 34, 0.2, 'gold', 1.6, 0.6);
    if (tier === 1) { S.hitstop = Math.max(S.hitstop, 0.03); S.shake += 2.5; }
    if (e.elite) {
      S.hitstop = 0.09;
      S.shake += 8;
      S.flash = 0.15;
      S.flashCol = COL.hot;
      S.rings.push({ x: e.x, y: e.y, r: 10, max: 150, dmg: 0, knock: 0, id: ++uid, dur: 0.35, t: 0, col: COL.danger, soft: true });
      for (let i = 1; i <= 3; i++) S.booms.push({ t: i * 0.09, x: e.x + rand(-1, 1) * e.r, y: e.y + rand(-1, 1) * e.r, r: e.r * 0.5, pal: 'danger', tier: 0 });
    }
    if (e.xp) { if (e.elite) fountain(e.x, e.y, e.xp, 8); else dropGem(e.x, e.y, e.xp); }
    if (e.elite) S.pickups.push({ kind: 'chest', x: e.x, y: e.y, dead: false });
    else if (Math.random() < CONFIG.drops.heart) S.pickups.push({ kind: 'heart', x: e.x, y: e.y, dead: false });
    else if (Math.random() < CONFIG.drops.magnet) S.pickups.push({ kind: 'magnet', x: e.x, y: e.y, dead: false });
  }

  function bossDown(e) {
    S.boss = null;
    UI.bossBar(false);
    for (const o of S.enemies) if (!o.dead) { o.dead = true; explosion(o.x, o.y, o.r, 'foe', 0); }
    for (let i = 1; i <= 8; i++) {   // 母体连环爆炸，出结算前持续约 1.5 秒
      const a = Math.random() * TAU, d = rand(0.2, 1) * e.r;
      S.booms.push({ t: i * 0.17, x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, r: e.r * rand(0.3, 0.55), pal: i % 2 ? 'danger' : 'foe', tier: 1 });
    }
    S.ebullets.length = 0;
    S.shake = 22;
    S.hitstop = 0.35;
    S.flash = 0.9;
    S.flashCol = COL.hot;
    S.transT = 2;
    state = 'outro';
    UI.banner('通关', '虚空核心已被击破', 'hot');
    Sfx.play('win');
  }

  // 补给飞船：掉一个随机主动技能 + 一把经验
  function dropSupply(e) {
    const C = CONFIG.supply, ids = Object.keys(CONFIG.skills);
    S.pickups.push({ kind: 'skill', skill: ids[(Math.random() * ids.length) | 0], x: e.x, y: e.y, dead: false });
    fountain(e.x, e.y, C.gems * C.gemXp, C.gems);
    UI.banner('补给到手', TOUCH ? '捡起技能舱，点右下角按钮释放' : '捡起技能舱，按空格释放', 'hot');
    Analytics.track('supply_kill', { run: S.runId, wave: waveNum(), t: round1(S.t) });
  }

  function dropGem(x, y, v) {
    if (S.gems.length > 400) v += S.gems.shift().v;   // 宝石太多时把最老的一颗并进新的
    S.gems.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), v, mag: false, sp: 0, vx: 0, vy: 0, dead: false });
  }
  // 经验喷泉：精英和补给飞船死时，一把晶体往四周喷出去再落定
  function fountain(x, y, total, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = rand(160, 320);
      dropGem(x, y, total / n);
      const g = S.gems[S.gems.length - 1];
      g.vx = Math.cos(a) * v;
      g.vy = Math.sin(a) * v;
    }
  }

  // 殉爆：被击杀的敌人炸开，炸死的敌人还会接着炸
  function chainBlast(b) {
    near(b.x, b.y, b.radius + 40, e => {
      if (e.dead) return;
      const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy) || 1;
      if (d < b.radius + e.r) hurt(e, b.dmg, (dx / d) * 200, (dy / d) * 200, true);
    });
    explosion(b.x, b.y, b.r, 'gold', 0);
    flare(b.x, b.y, b.radius * 2.2, 0.22, 'gold', 1.3, 0.5);
    S.rings.push({ x: b.x, y: b.y, r: 6, max: b.radius, dmg: 0, knock: 0, id: ++uid, dur: 0.16, t: 0, col: PCOL.gold, soft: true });
    impulse(b.x, b.y, 14, 120);
    S.shake = Math.min(8, S.shake + 0.8);
    Sfx.play('boom', 0, panAt(b.x));
  }

  // 狂热：击杀攒能量，攒满后一段时间射速、伤害、移速一起涨，背景跟着鼓点跳
  const feverNeed = () => CONFIG.fever.need + CONFIG.fever.grow * S.feverN;
  function chargeFever(n) {
    if (S.feverT > 0) return;
    S.fever += n;
    if (S.fever >= feverNeed()) startFever();
  }
  function startFever() {
    const F = CONFIG.fever, p = S.p;
    S.fever = 0;
    S.feverN++;
    S.feverT = F.dur;
    S.beatT = 0;
    S.flash = 0.3;
    S.flashCol = PCOL.gold;
    S.punch = Math.max(S.punch, 0.06);
    S.rings.push({ x: p.x, y: p.y, r: 10, max: 220, dmg: 30, knock: 320, id: ++uid, dur: 0.35, t: 0, col: PCOL.gold });
    impulse(p.x, p.y, 70, 340);
    UI.banner('狂热', `${F.dur} 秒内射速 ×${F.rate}，伤害 +${Math.round((F.dmg - 1) * 100)}%`, 'gold');
    Sfx.play('fever');
    Analytics.track('fever', { run: S.runId, n: S.feverN, wave: waveNum(), t: round1(S.t) });
  }

  // 清场：短时间内击杀很多，放半秒慢动作，结束时报数
  function countBurst() {
    const M = CONFIG.massacre;
    if (S.t - S.burstT0 > M.window) { S.burstT0 = S.t; S.burstN = 0; }
    S.burstN++;
    if (S.burstN === M.kills && S.t >= S.slowCd && S.slowmo <= 0) {
      S.slowmo = M.dur;
      S.slowCd = S.t + M.cd;
      S.punch = Math.max(S.punch, 0.05);
      Sfx.play('slow');
      Analytics.track('massacre', { run: S.runId, wave: waveNum(), t: round1(S.t) });
    }
  }

  function playerHit(dmg, src) {
    const p = S.p;
    if (state !== 'play' || p.inv > 0 || godMode || S.shieldT > 0) return;
    p.hp -= dmg;
    p.inv = CONFIG.player.iframes;
    S.lastHit = src;
    S.shake = Math.min(14, S.shake + 6);
    S.hurtFlash = 0.3;
    S.hitstop = Math.max(S.hitstop, 0.05);
    p.squash = 1;
    flare(p.x, p.y, 40, 0.22, 'danger', 1.6);
    sparks(p.x, p.y, 0, Math.PI, 10, 280, COL.danger, 10);
    impulse(p.x, p.y, 16, 90);
    Sfx.play('hurt');
    if (p.hp <= 0) { p.hp = 0; onDeath(); }
  }

  // ---------- 每帧更新 ----------
  function updatePlayer(dt) {
    const p = S.p, v = moveVec(), spd = S.st.speed * (S.feverT > 0 ? CONFIG.fever.speed : 1);
    p.x += v.x * spd * dt;
    p.y += v.y * spd * dt;
    const moving = v.x !== 0 || v.y !== 0;
    if (moving) p.face = Math.atan2(v.y, v.x);
    p.thrust += ((moving ? 1 : 0.3) - p.thrust) * Math.min(1, dt * 10);   // 尾焰长度
    // 机头朝向平滑地跟上移动方向（移动本身不延迟），转向的角速度决定侧倾角，最大约 50 度
    const prev = p.vface;
    p.vface += Math.atan2(Math.sin(p.face - p.vface), Math.cos(p.face - p.vface)) * Math.min(1, dt * 11);
    const turn = Math.atan2(Math.sin(p.vface - prev), Math.cos(p.vface - prev)) / dt;
    p.roll += (clamp(turn * 0.2, -0.9, 0.9) - p.roll) * Math.min(1, dt * 9);
    p.squash *= Math.exp(-10 * dt);
    if (p.flash > 0) p.flash -= dt * 2.5;
    updateMorph(dt);
    updateTierFx(dt);
    p.conT -= dt;
    if (moving && Math.abs(p.roll) > 0.35 && p.conT <= 0 && S.parts.length < 700) {   // 急转弯时两侧翼尖拉出白色气流
      p.conT = 0.02;
      const r = p.r * Art.VIS, span = [1.06, 1.15, 1.27, 1.37][p.tier] * r, c = Math.cos(p.vface), sn = Math.sin(p.vface);
      for (const side of [-1, 1]) {
        const lx = -0.7 * r, ly = side * span * Math.cos(p.roll);
        S.parts.push({ x: p.x + c * lx - sn * ly, y: p.y + sn * lx + c * ly, vx: -c * 30, vy: -sn * 30, life: 0.35, max: 0.35,
                       color: COL.hot, len: 3, ang: p.vface, spin: 0, dead: false });
      }
    }
    p.histT -= dt;   // 狂热形态的残影：每 0.05 秒记一次位置
    if (p.histT <= 0) {
      p.histT = 0.05;
      p.hist.unshift({ x: p.x, y: p.y, a: p.vface });
      if (p.hist.length > 3) p.hist.pop();
    }
    if (p.inv > 0) p.inv -= dt;
    if (p.firing > 0) p.firing -= dt;
    if (S.st.regen && p.hp < S.st.maxHp) p.hp = Math.min(S.st.maxHp, p.hp + S.st.regen * dt);
    S.trailT -= dt;
    if (moving && S.trailT <= 0 && S.parts.length < 700) {   // 尾焰
      S.trailT = 0.03;
      const a = p.vface + Math.PI + rand(-0.3, 0.3), sp = rand(60, 120);
      S.parts.push({ x: p.x - Math.cos(p.vface) * p.r * 0.6, y: p.y - Math.sin(p.vface) * p.r * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                     life: 0.25, max: 0.25, color: S.feverT > 0 ? PCOL.gold : COL.me, len: 4, ang: a, spin: 0, dead: false });
    }
  }

  // 狂热变身：光翼从机身里转出来、副炮从两侧滑出、机身转成金色；狂热结束再收回去
  function updateMorph(dt) {
    const p = S.p, on = S.feverT > 0;
    if (on !== p.morphOn) {
      p.morphOn = on;
      p.flash = on ? 0.9 : 0.5;
      sparks(p.x, p.y, 0, Math.PI, on ? 26 : 12, on ? 360 : 220, on ? PCOL.gold : COL.hot, 12);
      flare(p.x, p.y, on ? 120 : 60, on ? 0.35 : 0.2, on ? 'gold' : 'hot', 1.4, 0.8);
      Sfx.play(on ? 'morph' : 'unmorph');
    }
    p.morph = clamp(p.morph + (on ? dt / 0.45 : -dt / 0.35), 0, 1);
  }

  // 机体进阶：先聚光、放大，0.4 秒时旧外壳炸开、换成新机体，再弹回原大小
  const TIERS = CONFIG.ship.tiers;
  const tierFor = lv => TIERS.reduce((t, x, i) => (lv >= x.lv ? i : t), 0);
  function updateTierFx(dt) {
    const p = S.p, fx = p.tierFx;
    if (!fx) return;
    fx.t += dt;
    if (fx.t < 0.4 && S.parts.length < 700) {   // 能量往机身聚拢
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * TAU, d = rand(50, 80), sp = d / 0.25;
        S.parts.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp,
                       life: 0.22, max: 0.22, color: COL.hot, len: 7, ang: a, spin: 0, dead: false });
      }
    }
    if (!fx.done && fx.t >= 0.4) {
      fx.done = true;
      p.tier = fx.to;
      p.flash = 1;
      chunks(p.x, p.y, 10, 260, 'me', 4);
      sparks(p.x, p.y, 0, Math.PI, 30, 420, COL.me, 14);
      flare(p.x, p.y, 160, 0.4, 'hot', 1.5);
      S.rings.push({ x: p.x, y: p.y, r: 10, max: 200, dmg: 0, knock: 0, id: ++uid, dur: 0.4, t: 0, col: COL.me });
      impulse(p.x, p.y, 80, 360);
      S.shake = Math.max(S.shake, 6);
      S.hitstop = Math.max(S.hitstop, 0.08);
      UI.banner(`机体进阶 · ${TIERS[fx.to].name}`, TIERS[fx.to].desc, 'me');
      Sfx.play('upgrade');
      Analytics.track('ship_tier', { run: S.runId, tier: fx.to, lv: S.level, t: round1(S.t) });
    }
    if (fx.t >= 1) p.tierFx = null;
  }

  function updateWeapons(dt) {
    const L = S.lv, st = S.st, p = S.p;
    const cdt = dt * (S.feverT > 0 ? CONFIG.fever.rate : 1) * (S.buffT > 0 ? 1 + CONFIG.ads.overdrive.rate : 1);   // 狂热、火力全开期间所有武器冷却走得更快
    if (L.bolt > 0) {
      S.cd.bolt -= cdt;
      if (S.cd.bolt <= 0) {
        const w = boltStats(L.bolt, S.evo.bolt);
        // Boss 在射程内时优先打 Boss，否则 Boss 战里子弹全被小怪挡掉；Boss 开着护盾时改成优先打射程内最近的护盾发生器
        const b = S.boss, r2 = w.range * w.range;
        let target = b && !b.shield && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < r2 ? b : null;
        if (b && b.shield) {
          let bd = r2;
          for (const e of S.enemies) {
            if (e.type !== 'pylon' || e.dead) continue;
            const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
            if (d < bd) { bd = d; target = e; }
          }
        }
        if (!target) target = nearestEnemy(p.x, p.y, w.range);
        if (target) {
          const base = Math.atan2(target.y - p.y, target.x - p.x);
          for (let i = 0; i < w.count; i++) {
            const a = base + (i - (w.count - 1) / 2) * 0.13;
            S.bullets.push({ x: p.x, y: p.y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, r: 4,
                             dmg: w.dmg, pierce: w.pierce, life: w.range / w.speed, hit: [], evo: S.evo.bolt, dead: false });
          }
          S.cd.bolt = w.cd * st.cd;
          p.firing = 0.06;
          p.aim = base;
          p.recoil = 1;
          flare(p.x + Math.cos(base) * 14, p.y + Math.sin(base) * 14, S.evo.bolt ? 26 : 18, 0.07, S.evo.bolt ? 'gold' : 'me', 1.2);
          glint(p.x + Math.cos(base) * 16, p.y + Math.sin(base) * 16, S.evo.bolt ? 40 : 30, 0.07, S.evo.bolt ? 'gold' : 'me');
          Sfx.play('shoot');
        } else {
          S.cd.bolt = 0.1;
        }
      }
    }
    if (L.orbit > 0) {
      const w = orbitStats(L.orbit, S.evo.orbit);
      S.orbitA += w.spin * cdt;
      for (let i = 0; i < w.count; i++) {
        const a = S.orbitA + (i * TAU) / w.count;
        const bx = p.x + Math.cos(a) * w.radius, by = p.y + Math.sin(a) * w.radius;
        near(bx, by, 60, e => {
          if (e.dead || S.t < e.orbitHit) return;
          const rr = e.r + w.hitR;
          if ((e.x - bx) ** 2 + (e.y - by) ** 2 < rr * rr) {
            e.orbitHit = S.t + w.hitCd * st.cd;
            const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
            hurt(e, w.dmg, (dx / d) * 90, (dy / d) * 90);
          }
        });
      }
    }
    if (L.pulse > 0) {
      S.cd.pulse -= cdt;
      if (S.cd.pulse <= 0) {
        const w = pulseStats(L.pulse, S.evo.pulse);
        S.cd.pulse = w.cd * st.cd;
        S.rings.push({ x: p.x, y: p.y, r: 10, max: w.radius, dmg: w.dmg, knock: w.knock, slow: w.slow, id: ++uid, dur: 0.4, t: 0, col: COL.me, lines: true });
        S.rings.push({ x: p.x, y: p.y, r: 6, max: w.radius * 0.7, dmg: 0, knock: 0, id: ++uid, dur: 0.5, t: 0, col: COL.hot, soft: true });   // 里面跟一圈淡的
        glint(p.x, p.y, 70, 0.14, 'me');
        impulse(p.x, p.y, 24, w.radius);
        Sfx.play('pulse');
      }
    }
    if (L.chain > 0) {
      S.cd.chain -= cdt;
      if (S.cd.chain <= 0) {
        const w = chainStats(L.chain, S.evo.chain);
        S.cd.chain = 0.2;
        for (let k = 0; k < w.bolts; k++) {
          let cur = randomEnemyNear(p.x, p.y, w.range);
          if (!cur) break;
          S.cd.chain = w.cd * st.cd;
          const pts = [[p.x, p.y]], hit = [];
          for (let j = 0; j <= w.jumps && cur; j++) {
            pts.push([cur.x, cur.y]);
            hit.push(cur.id);
            glint(cur.x, cur.y, 46, 0.16, 'me');
            flare(cur.x, cur.y, 26, 0.16, 'hot', 1.4, 0.7);
            hurt(cur, w.dmg, 0, 0);
            cur = nearestEnemy(cur.x, cur.y, w.jumpRange, hit);
          }
          S.zaps.push({ pts, life: 0.18, dead: false });
          Sfx.play('zap');
        }
      }
    }
    if (L.missile > 0) {
      S.cd.missile -= cdt;
      if (S.cd.missile <= 0) {
        const w = missileStats(L.missile, S.evo.missile), first = nearestEnemy(p.x, p.y, 520);
        if (first) {
          S.cd.missile = w.cd * st.cd;
          for (let i = 0; i < w.count; i++) {
            // 先往身后两侧甩出去，再拐回来追目标，轨迹是一道弧
            const a = p.face + Math.PI + (i - (w.count - 1) / 2) * 0.55;
            S.missiles.push({ x: p.x, y: p.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, target: i % 2 ? randomEnemyNear(p.x, p.y, 520) || first : first,
                              life: w.life, dmg: w.dmg, radius: w.radius, well: w.well, speed: w.speed, turn: w.turn, trailT: 0, hist: [], dead: false });
          }
          Sfx.play('missile');
        } else S.cd.missile = 0.2;
      }
    }
    if (L.cluster > 0) {
      S.cd.cluster -= cdt;
      if (S.cd.cluster <= 0) {
        const w = clusterStats(L.cluster, S.evo.cluster), t = densest(p.x, p.y, w.range);
        if (t) {
          S.cd.cluster = w.cd * st.cd;
          if (w.carpet) {   // 地毯轰炸：从玩家朝敌群方向连成一条线，一枚接一枚落地
            const a = Math.atan2(t.y - p.y, t.x - p.x);
            for (let i = 0; i < w.carpet; i++) {
              const d = (i - (w.carpet - 1) / 2) * w.radius * 0.95;
              throwBomb(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, w, false, i * 0.07);
            }
          } else {
            for (let i = 0; i < w.count; i++) throwBomb(t.x + (i ? rand(-70, 70) : 0), t.y + (i ? rand(-70, 70) : 0), w, false, i * 0.15);
          }
          Sfx.play('lob');
        } else S.cd.cluster = 0.3;
      }
    }
    if (L.laser > 0) {
      const w = laserStats(L.laser, S.evo.laser), bm = S.beam;
      if (w.always) { bm.on = true; bm.a += (TAU / 1.6) * cdt; }
      else if (bm.on) { bm.t += dt; bm.a += (TAU / w.sweep) * dt; if (bm.t >= w.sweep) bm.on = false; }
      else {
        S.cd.laser -= cdt;
        if (S.cd.laser <= 0) { S.cd.laser = w.cd * st.cd; bm.on = true; bm.t = 0; bm.a = p.aim; Sfx.play('laser'); }
      }
      bm.len = w.len; bm.n = w.beams; bm.width = w.width; bm.evo = w.always;
      if (bm.on) {
        for (let b = 0; b < w.beams; b++) {
          const a = bm.a + (b * TAU) / w.beams, c = Math.cos(a), s = Math.sin(a);
          for (let d = 30; d < w.len + 30; d += 60) {
            near(p.x + c * d, p.y + s * d, 60, e => {
              if (e.dead || S.t < (e.laserHit || 0)) return;
              const ex = e.x - p.x, ey = e.y - p.y, along = ex * c + ey * s;
              if (along < 0 || along > w.len + e.r || Math.abs(ey * c - ex * s) > w.width + e.r) return;
              e.laserHit = S.t + 0.25;
              sparks(e.x, e.y, a + Math.PI / 2, 0.5, 3, 260, COL.hot, 9);
              hurt(e, w.dmg, -s * 140, c * 140);   // 顺着扫的方向把敌人推开
            });
          }
        }
      }
    }
  }

  // 敌人最密的位置：随机抽十几个敌人，看谁身边挤的同伴最多
  function densest(x, y, range) {
    let best = null, bestN = -1;
    for (let i = 0; i < 16; i++) {
      const e = S.enemies[(Math.random() * S.enemies.length) | 0];
      if (!e || e.dead || e.type === 'supply' || (e.x - x) ** 2 + (e.y - y) ** 2 > range * range) continue;
      let n = 0;
      near(e.x, e.y, 90, o => { if (!o.dead && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 < 8100) n++; });
      if (n > bestN) { bestN = n; best = e; }
    }
    return best || nearestEnemy(x, y, range);
  }

  // 集束炸弹：抛物线飞过去，落地炸；大弹再散出子弹，子弹落地各炸一次
  function throwBomb(x, y, w, small, delay = 0) {
    const from = small ? { x: small.x, y: small.y } : S.p;
    S.bombs.push({ x0: from.x, y0: from.y, x, y, t: -delay, dur: small ? 0.3 : 0.55, w, small: !!small, dead: false });
  }
  function updateBombs(dt) {
    for (const b of S.bombs) {
      b.t += dt;
      if (b.t < b.dur) continue;
      b.dead = true;
      const w = b.w;
      if (b.small) { blast(b.x, b.y, w.smallR, w.small, 'gold'); continue; }
      blast(b.x, b.y, w.radius, w.dmg, 'gold');
      S.shake = Math.min(10, S.shake + 2);
      for (let i = 0; i < w.bomblets; i++) {
        const a = (i / w.bomblets) * TAU + rand(-0.3, 0.3), d = rand(50, 85);
        throwBomb(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, w, b);
      }
    }
    sweep(S.bombs);
  }

  // 追踪导弹：加速、限速转向追目标，目标死了换最近的；碰到任何敌人或时间到就炸
  function updateMissiles(dt) {
    for (const m of S.missiles) {
      if (!m.target || m.target.dead) m.target = nearestEnemy(m.x, m.y, 420);
      let a = Math.atan2(m.vy, m.vx);
      if (m.target) {
        const da = Math.atan2(m.target.y - m.y, m.target.x - m.x) - a;
        a += clamp(Math.atan2(Math.sin(da), Math.cos(da)), -m.turn * dt, m.turn * dt);
      }
      const v = Math.min(m.speed, Math.hypot(m.vx, m.vy) + 650 * dt);
      m.vx = Math.cos(a) * v;
      m.vy = Math.sin(a) * v;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.hist.unshift([m.x, m.y]);   // 尾迹光带用
      if (m.hist.length > 10) m.hist.pop();
      m.life -= dt;
      m.trailT -= dt;
      if (m.trailT <= 0) { m.trailT = 0.025; sparks(m.x, m.y, a + Math.PI, 0.3, 1, 70, COL.hot, 5); }
      let hit = m.life <= 0;
      if (!hit) near(m.x, m.y, 40, e => { if (!e.dead && (e.x - m.x) ** 2 + (e.y - m.y) ** 2 < (e.r + 6) ** 2) hit = true; });
      if (hit) {
        m.dead = true;
        if (m.well) { S.wells.push({ x: m.x, y: m.y, t: 0, r: m.radius * 2.4, dmg: m.dmg * 1.5, blastR: m.radius * 1.3, dead: false }); impulse(m.x, m.y, -24, m.radius * 2.4); }
        else blast(m.x, m.y, m.radius, m.dmg);
      }
    }
    sweep(S.missiles);
  }

  // 武器爆炸：范围伤害 + 闪光和冲击圈；导弹青白色，炸弹金色
  function blast(x, y, radius, dmg, pal = 'me') {
    near(x, y, radius + 40, e => {
      if (e.dead) return;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < radius + e.r) hurt(e, dmg, (dx / d) * 160, (dy / d) * 160);
    });
    const fire = pal === 'gold';   // 炸弹一次落一大片，白光压小一点，多给碎火花，免得叠成一片白
    flare(x, y, radius * (fire ? 1.1 : 1.6), 0.16, 'hot', 1.5, fire ? 0.8 : 1);
    flare(x, y, radius * (fire ? 1.9 : 2.4), 0.3, pal, 1.3, fire ? 0.32 : 0.5);
    S.rings.push({ x, y, r: 6, max: radius, dmg: 0, knock: 0, id: ++uid, dur: 0.18, t: 0, col: PCOL[pal], soft: true });
    sparks(x, y, 0, Math.PI, 8, 300, COL.hot, 9);
    glint(x, y, radius * 1.5, 0.16, fire ? 'gold' : 'me');
    if (fire) { fireball(x, y, radius * 2.2, 0.34); shards(x, y, PCOL.gold, 8, 280); sparks(x, y, 0, Math.PI, 6, 380, PCOL.gold, 12); chunks(x, y, 3, 160, 'gold', 3); }
    impulse(x, y, 12, radius * 2);
    Sfx.play('blast', 0, panAt(x));
  }

  // 引力弹：先把周围敌人往中心吸 0.45 秒，再一起炸开
  function updateWells(dt) {
    for (const w of S.wells) {
      w.t += dt;
      near(w.x, w.y, w.r + 30, e => {
        if (e.dead || e.type === 'boss') return;
        const dx = w.x - e.x, dy = w.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (d < w.r && d > 8) { const k = Math.min(440 * dt, d - 6); e.x += (dx / d) * k; e.y += (dy / d) * k; }
      });
      if (w.t >= 0.45) { w.dead = true; blast(w.x, w.y, w.blastR, w.dmg); }
    }
    sweep(S.wells);
  }

  // 黑洞：开合各 0.5 秒；吸敌人、经验和玩家，敌人被吸进核心就压爆
  function holeSize(h) {
    const H = CONFIG.hole;
    return Math.min(1, h.t / 0.5) * Math.min(1, Math.max(0, (H.dur - h.t) / 0.5));
  }
  function updateHoles(dt) {
    const H = CONFIG.hole, p = S.p;
    for (const h of S.holes) {
      h.t += dt;
      const R = H.radius * holeSize(h);
      near(h.x, h.y, R, e => {
        if (e.dead || e.type === 'boss') return;
        const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
        if (d > R) return;
        if (d < H.core + e.r * 0.5) { e.hp = 0; kill(e); return; }
        const k = (H.pull * (1 - d / R) + 30) * dt;
        e.x += (dx / d) * k;
        e.y += (dy / d) * k;
      });
      for (const g of S.gems) {   // 经验被吸到核心边上停住，敢靠近就能捡
        const dx = h.x - g.x, dy = h.y - g.y, d = Math.hypot(dx, dy) || 1;
        if (d < R && d > H.core + 10) { const k = 160 * (1 - d / R) * dt; g.x += (dx / d) * k; g.y += (dy / d) * k; }
      }
      const dx = h.x - p.x, dy = h.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < R) {   // 在范围边上就能感到被拽，越往里越狠，到核心附近快赶上玩家的移速
        const f = 1 - d / R, spd = S.st.speed;
        const pull = Math.min(spd * H.pullCap, H.playerPull * (0.35 + 0.65 * Math.pow(f, 1.3)));
        p.x += (dx / d) * pull * dt;
        p.y += (dy / d) * pull * dt;
        h.grip = f;
        if (Math.random() < 0.4 + f * 2 && S.parts.length < 700) {   // 光丝：从机身往黑洞方向拉出去的细线
          const b = Math.atan2(dy, dx) + rand(-0.25, 0.25);
          S.parts.push({ x: p.x + rand(-6, 6), y: p.y + rand(-6, 6), vx: Math.cos(b) * (160 + 260 * f), vy: Math.sin(b) * (160 + 260 * f),
                         life: 0.3, max: 0.3, color: Math.random() < 0.5 ? COL.void : COL.hot, len: 10 + 14 * f, ang: b, spin: 0, dead: false });
        }
        if (d < H.core + p.r) playerHit(H.playerDmg, 'hole');
      } else h.grip = 0;
      h.warpT -= dt;
      if (h.warpT <= 0) { h.warpT = 0.3; impulse(h.x, h.y, -14, R); }   // 背景网格被往里拽
      for (let i = 0; i < 3 && S.parts.length < 700; i++) {   // 外圈的碎光斜着往里飞
        const a = Math.random() * TAU, rr = R * rand(0.5, 1), b = a + Math.PI * 0.62;
        S.parts.push({ x: h.x + Math.cos(a) * rr, y: h.y + Math.sin(a) * rr, vx: Math.cos(b) * 220, vy: Math.sin(b) * 220,
                       life: 0.35, max: 0.35, color: i ? COL.hot : COL.void, len: 7, ang: b, spin: 0, dead: false });
      }
      if (h.t >= H.dur) {   // 坍缩：一圈冲击波把剩下的敌人推开，紫色碎光往外炸
        h.dead = true;
        shockwave(h.x, h.y, H.radius, 380);
        flare(h.x, h.y, 160, 0.3, 'hot', 1.6);
        flare(h.x, h.y, 300, 0.45, 'void', 1.3, 0.7);
        shards(h.x, h.y, COL.void, 30, 420);
        S.rings.push({ x: h.x, y: h.y, r: 20, max: H.radius * 1.1, dmg: 0, knock: 0, id: ++uid, dur: 0.4, t: 0, col: COL.void, soft: true });
        S.shake += 4;
        Sfx.play('boom', 0, panAt(h.x));
      }
    }
    sweep(S.holes);
  }

  // 陨石雨：持续期间不停选落点；落点先亮红圈，到时间砸下，圈里敌我都受伤
  function updateMeteors(dt) {
    const M = CONFIG.meteor, p = S.p;
    if (S.t < S.meteorEnd) {
      S.meteorT -= dt;
      if (S.meteorT <= 0) {
        S.meteorT = M.every;
        const foes = S.enemies.filter(e => !e.dead && e.type !== 'boss' && e.type !== 'dart');
        let x, y;
        if (Math.random() < 0.5 || !foes.length) { const a = Math.random() * TAU, d = rand(40, 220); x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d; }
        else { const e = foes[(Math.random() * foes.length) | 0]; x = e.x + rand(-20, 20); y = e.y + rand(-20, 20); }
        S.meteors.push({ x, y, t: 0, a: rand(-2.5, -2.0), rk: (Math.random() * 3) | 0, rot: Math.random() * TAU, spin: rand(-5, 5), dead: false });
      }
    }
    for (const m of S.meteors) {
      m.t += dt;
      if (m.t < M.warn) continue;
      m.dead = true;
      near(m.x, m.y, M.radius + 30, e => {
        if (e.dead) return;
        const dx = e.x - m.x, dy = e.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (d < M.radius + e.r) hurt(e, M.dmg, (dx / d) * 220, (dy / d) * 220, true);
      });
      if (Math.hypot(p.x - m.x, p.y - m.y) < M.radius + p.r) playerHit(M.playerDmg, 'meteor');
      explosion(m.x, m.y, 16, 'foe', 1);
      chunks(m.x, m.y, 6, 220, 'rock', 4);   // 碎石
      flare(m.x, m.y, M.radius * 2.6, 0.35, 'foe', 1.3, 0.5);   // 热浪
      if (S.decals.length > 40) S.decals.shift();
      S.decals.push({ x: m.x, y: m.y, r: M.radius * rand(0.8, 0.95), t: 0, life: M.crater, rot: Math.random() * TAU, v: (Math.random() * 3) | 0, dead: false });
      impulse(m.x, m.y, 26, 160);
      S.shake += 1.5;
      Sfx.play('boom', 0, panAt(m.x));
    }
    sweep(S.meteors);
  }

  // ---------- 主动技能：补给飞船掉落，空格 / E / 右下角按钮释放 ----------
  function useSkill() {
    if (state !== 'play' || !S || !S.skill) return;
    const id = S.skill, K = CONFIG.skills[id], p = S.p;
    S.skill = null;
    UI.skillUsed();
    Analytics.track('skill_use', { run: S.runId, id, wave: waveNum(), t: round1(S.t) });
    if (id === 'nova') {   // 新星爆发：屏幕里所有敌人吃一次大伤害
      const v = viewHalf();
      for (const e of S.enemies) {
        if (e.dead || Math.abs(e.x - p.x) > v.hw || Math.abs(e.y - p.y) > v.hh) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
        hurt(e, K.dmg, (dx / d) * 300, (dy / d) * 300, true);
      }
      S.rings.push({ x: p.x, y: p.y, r: 10, max: Math.hypot(v.hw, v.hh), dmg: 0, knock: 0, id: ++uid, dur: 0.5, t: 0, col: COL.hot });
      S.flash = 0.5;
      S.flashCol = COL.hot;
      S.shake += 10;
      S.hitstop = 0.12;
      impulse(p.x, p.y, 120, 700);
    } else if (id === 'strike') {   // 轨道轰炸：1.5 秒内依次砸下
      for (let i = 0; i < K.count; i++) S.strikes.push({ t: -i * (1.5 / K.count), x: 0, y: 0, aimed: false, dead: false });
    } else if (id === 'stasis') {
      S.stasisT = K.dur;
      S.flash = 0.25;
      S.flashCol = '#4aa8ff';
      impulse(p.x, p.y, -50, 500);
    } else if (id === 'shield') {
      S.shieldT = K.dur;
      shockwave(p.x, p.y, 120, 300);
    }
    UI.banner(K.name, '', 'hot', true);
    Sfx.play('skill');
  }

  // 轨道轰炸：每道先锁定身边的敌人（没有就随便落在附近），0.3 秒瞄准后落下
  function updateStrikes(dt) {
    const K = CONFIG.skills.strike, p = S.p;
    for (const s of S.strikes) {
      s.t += dt;
      if (s.t < 0) continue;
      if (!s.aimed) {
        s.aimed = true;
        const e = randomEnemyNear(p.x, p.y, 300);
        if (e) { s.x = e.x; s.y = e.y; } else { const a = Math.random() * TAU; s.x = p.x + Math.cos(a) * 120; s.y = p.y + Math.sin(a) * 120; }
      }
      if (s.t < 0.3) continue;
      s.dead = true;
      near(s.x, s.y, K.radius + 30, e => {
        if (e.dead) return;
        const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy) || 1;
        if (d < K.radius + e.r) hurt(e, K.dmg, (dx / d) * 260, (dy / d) * 260, true);
      });
      flare(s.x, s.y, K.radius * 2.6, 0.25, 'hot', 1.3);
      flare(s.x, s.y, K.radius * 3.4, 0.4, 'me', 1.2, 0.6);
      S.rings.push({ x: s.x, y: s.y, r: 10, max: K.radius * 1.2, dmg: 0, knock: 0, id: ++uid, dur: 0.2, t: 0, col: COL.me, soft: true });
      sparks(s.x, s.y, 0, Math.PI, 14, 380, COL.hot, 12);
      impulse(s.x, s.y, 40, 220);
      S.shake += 3;
      Sfx.play('boom', 0, panAt(s.x));
    }
    sweep(S.strikes);
  }

  // 只结算伤害；圈的扩张和消失在 updateFx 里，弹窗、死亡动画期间也照样动
  function updateRings() {
    for (const ring of S.rings) {
      if (ring.dmg > 0 && ring.t <= ring.dur) {
        near(ring.x, ring.y, ring.r + 50, e => {
          if (e.dead || e.pulseId === ring.id) return;
          const dx = e.x - ring.x, dy = e.y - ring.y, d = Math.hypot(dx, dy) || 1;
          if (d < ring.r + e.r) {
            e.pulseId = ring.id;
            if (ring.slow) e.slowT = ring.slow;
            hurt(e, ring.dmg, (dx / d) * ring.knock, (dy / d) * ring.knock);
          }
        });
      }
    }
  }

  function updateEnemies(dt) {
    const p = S.p;
    const far = Math.max(W, H) / zoomEff * 1.1;
    const decay = Math.exp(-7 * dt), popDecay = Math.exp(-14 * dt);
    const SH = CONFIG.enemies.shooter;
    const frozen = S.stasisT > 0;   // 时停力场：敌人原地不动，也不撞人
    for (const e of S.enemies) {
      if (e.dead) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.flash -= dt;
      e.pop *= popDecay;
      if (frozen) continue;
      if (e.type === 'dart') {   // 蜂群直线飞过，不追人
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.rot = Math.atan2(e.vy, e.vx);
        e.life -= dt;
        if (e.life <= 0) e.dead = true;
        else if (d < e.r + p.r) touchPlayer(e);
        continue;
      }
      if (e.type === 'supply') {   // 补给飞船：离玩家近就逃，远了就停下绕圈等玩家追上来；时间到就跃迁离开
        e.life -= dt;
        if (e.life <= 0) {
          e.dead = true;
          flare(e.x, e.y, 90, 0.4, 'gold', 0.2);
          UI.toast('补给飞船跃迁离开了');
          Analytics.track('supply_escape', { run: S.runId, wave: waveNum(), t: round1(S.t) });
          continue;
        }
        const away = d < 360 ? 1 : d > 540 ? -0.5 : 0;
        const vx = -(dx / d) * e.speed * away - (dy / d) * e.speed * 0.55, vy = -(dy / d) * e.speed * away + (dx / d) * e.speed * 0.55;
        e.x += (vx + e.kx) * dt;
        e.y += (vy + e.ky) * dt;
        e.kx *= decay;
        e.ky *= decay;
        const da = Math.atan2(vy, vx) - e.rot;
        e.rot += Math.atan2(Math.sin(da), Math.cos(da)) * Math.min(1, dt * 4);
        continue;
      }
      if (e.type === 'pylon') {   // 护盾发生器绕着 Boss 转，半径一呼一吸，跟着 Boss 走
        const h = e.host;
        if (!h || h.dead) { e.dead = true; continue; }
        e.oa += e.ospd * dt;
        const R = CONFIG.boss.shield.orbit + Math.sin(S.t * 1.7 + e.ph) * 14;
        e.x = h.x + Math.cos(e.oa) * R;
        e.y = h.y + Math.sin(e.oa) * R;
        e.rot += e.spin * dt;
        if (d < e.r + p.r) touchPlayer(e);
        continue;
      }
      const spd = e.speed * (e.slowT > 0 ? 0.5 : 1);
      if (e.slowT > 0) e.slowT -= dt;
      let vx, vy;
      if (e.type === 'boss') {
        [vx, vy] = bossAI(e, dt, dx, dy, d);
      } else if (e.ev === 'ring') {   // 包围圈往圈心收拢，收到中心后改成追人
        const cx = e.cx - e.x, cy = e.cy - e.y, cd = Math.hypot(cx, cy) || 1;
        if (cd < 24) { e.ev = 'ring2'; vx = 0; vy = 0; }
        else { vx = (cx / cd) * spd; vy = (cy / cd) * spd; }
      } else if (e.type === 'shooter') {
        // 保持距离并绕着玩家走，定时开火
        const want = d > SH.range ? 1 : d < SH.range * 0.7 ? -0.7 : 0;
        vx = (dx / d) * spd * want - (dy / d) * spd * 0.35;
        vy = (dy / d) * spd * want + (dx / d) * spd * 0.35;
        e.fire -= dt;
        if (e.fire <= 0 && d < SH.range * 1.4) {
          e.fire = SH.fireEvery;
          enemyShot(e.x, e.y, Math.atan2(dy, dx), SH.bulletSpeed, SH.bulletDmg * (e.elite ? 1.5 : 1) * e.tm, 'ebullet', 'shooter');
          e.kick = 1;
          flare(e.x + Math.cos(e.rot) * e.r, e.y + Math.sin(e.rot) * e.r, 22, 0.1, 'danger', 1.4);
        }
      } else {
        vx = (dx / d) * spd;
        vy = (dy / d) * spd;
      }
      if (e.type !== 'boss' && e.ev !== 'ring') {
        near(e.x, e.y, e.r * 2, o => {   // 互相推开，避免叠成一团
          if (o === e || o.dead || o.type === 'dart') return;
          const ox = e.x - o.x, oy = e.y - o.y, rr = e.r + o.r, d2 = ox * ox + oy * oy;
          if (d2 < rr * rr && d2 > 0.01) {
            const dd = Math.sqrt(d2), push = ((rr - dd) / dd) * 0.5;
            e.x += ox * push;
            e.y += oy * push;
          }
        });
      }
      e.x += (vx + e.kx) * dt;
      e.y += (vy + e.ky) * dt;
      e.kx *= decay;
      e.ky *= decay;
      if (FACE[e.type]) {   // 舰船慢慢转向玩家；浮雷和 Boss 自转
        const da = Math.atan2(dy, dx) - e.rot;
        e.rot += Math.atan2(Math.sin(da), Math.cos(da)) * Math.min(1, dt * 6);
      } else e.rot += e.spin * dt;
      const rr = e.r + p.r;
      if (dx * dx + dy * dy < rr * rr) touchPlayer(e);
      if (e.type !== 'boss' && !e.elite && !e.ev && d > far) {   // 甩得太远的敌人挪回屏幕边
        const q = spawnPos();
        e.x = q.x;
        e.y = q.y;
      }
    }
  }

  // 动作参数：平滑后的实际速度（拉伸、尾焰）、转向角速度（侧倾）、受击歪斜、开火后坐
  function animEnemies(dt) {
    const k = Math.min(1, dt * 10), d0 = Math.exp(-8 * dt), d1 = Math.exp(-10 * dt);
    for (const e of S.enemies) {
      if (e.dead) continue;
      let vx = (e.x - e.lx) / dt, vy = (e.y - e.ly) / dt;
      if (vx * vx + vy * vy > 1e6) vx = vy = 0;   // 被挪回屏幕边的那一帧不算
      e.mvx += (vx - e.mvx) * k;
      e.mvy += (vy - e.mvy) * k;
      const dr = Math.atan2(Math.sin(e.rot - e.lrot), Math.cos(e.rot - e.lrot));
      e.bank += (clamp((dr / dt) * 0.12, -0.6, 0.6) - e.bank) * k;
      e.lx = e.x;
      e.ly = e.y;
      e.lrot = e.rot;
      e.tilt *= d0;
      e.kick *= d1;
    }
  }

  // 敌人撞到玩家：开着相位护盾时反过来伤敌人并把它弹开
  function touchPlayer(e) {
    if (S.shieldT <= 0) { playerHit(e.dmg, e.type); return; }
    if (S.t < (e.shieldHit || 0)) return;
    e.shieldHit = S.t + 0.4;
    const dx = e.x - S.p.x, dy = e.y - S.p.y, d = Math.hypot(dx, dy) || 1;
    hurt(e, CONFIG.skills.shield.dmg, (dx / d) * 420, (dy / d) * 420, true);
    if (e.type === 'dart' && !e.dead) kill(e);
  }

  function explode(x, y, dmg, skip) {   // 星爆弹命中时的小范围爆炸
    near(x, y, 90, e => {
      if (e.dead || e.id === skip) return;
      if ((e.x - x) ** 2 + (e.y - y) ** 2 < (40 + e.r) ** 2) hurt(e, dmg, 0, 0, true);
    });
    S.rings.push({ x, y, r: 4, max: 40, dmg: 0, knock: 0, id: ++uid, dur: 0.15, t: 0, col: COL.hot });
  }

  function updateBullets(dt) {
    for (const b of S.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      near(b.x, b.y, b.r + 50, e => {
        if (b.dead || e.dead || b.hit.includes(e.id)) return;
        const rr = e.r + b.r;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < rr * rr) {
          b.hit.push(e.id);
          hurt(e, b.dmg, b.vx * 0.25, b.vy * 0.25);
          if (b.evo) explode(b.x, b.y, b.dmg * 0.5, e.id);
          if (b.pierce-- <= 0) b.dead = true;
        }
      });
    }
  }

  function updateEnemyBullets(dt) {
    if (S.stasisT > 0) return;   // 时停期间子弹悬在空中
    const p = S.p;
    for (const b of S.ebullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      const rr = b.r + p.r * 0.8;
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < rr * rr) { b.dead = true; playerHit(b.dmg, b.src); }
    }
  }

  function updateGems(dt) {
    const p = S.p, pr2 = S.st.pickup * S.st.pickup, f = Math.exp(-5 * dt);
    for (const g of S.gems) {
      if (g.vx || g.vy) {   // 喷出去的晶体先飞一小段再落定，落定前不吸
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.vx *= f;
        g.vy *= f;
        if (g.vx * g.vx + g.vy * g.vy < 400) g.vx = g.vy = 0;
        continue;
      }
      const dx = p.x - g.x, dy = p.y - g.y, d2 = dx * dx + dy * dy;
      if (!g.mag && d2 < pr2) g.mag = true;
      if (!g.mag) continue;
      const d = Math.sqrt(d2) || 1;
      g.sp = (g.sp || 120) + 900 * dt;
      g.x += (dx / d) * g.sp * dt;
      g.y += (dy / d) * g.sp * dt;
      if (d < p.r + 6) {   // 连着捡，音一个比一个高
        g.dead = true;
        gainXp(g.v);
        S.gemStep = S.t - S.gemT < 0.3 ? S.gemStep + 1 : 0;
        S.gemT = S.t;
        Sfx.play('pickup', S.gemStep);
      }
    }
  }

  function updatePickups(dt) {
    const p = S.p;
    for (const it of S.pickups) {
      const dx = p.x - it.x, dy = p.y - it.y, d = Math.hypot(dx, dy) || 1;
      if (d < p.r + 14) {
        it.dead = true;
        if (it.kind === 'heart') {
          p.hp = Math.min(S.st.maxHp, p.hp + CONFIG.drops.heal);
          text(p.x, p.y - 22, '+' + CONFIG.drops.heal, true);
        } else if (it.kind === 'magnet') {
          for (const g of S.gems) g.mag = true;
        } else if (it.kind === 'chest') {
          S.pending.push('chest');
        } else if (it.kind === 'skill') {
          if (S.skill && S.skill !== it.skill) UI.toast(`「${CONFIG.skills[S.skill].name}」被换成了「${CONFIG.skills[it.skill].name}」`);
          S.skill = it.skill;
          UI.skill(it.skill, TOUCH);
          Analytics.track('skill_pickup', { run: S.runId, id: it.skill, t: round1(S.t) });
        }
        Sfx.play('reward');
      } else if (d < S.st.pickup * 0.6) {
        it.x += (dx / d) * 200 * dt;
        it.y += (dy / d) * 200 * dt;
      }
    }
  }

  function updateFx(dt) {
    const f = Math.exp(-4 * dt);
    for (const q of S.parts) {
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= f; q.vy *= f; q.ang += q.spin * dt;
      q.life -= dt;
      if (q.life <= 0) q.dead = true;
    }
    const fc = Math.exp(-2.5 * dt);
    for (const c of S.chunks) {
      c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= fc; c.vy *= fc; c.ang += c.spin * dt;
      c.life -= dt;
      if (c.life <= 0) c.dead = true;
    }
    for (const q of S.flares) { q.life -= dt; if (q.life <= 0) q.dead = true; }
    for (const b of S.booms) {
      b.t -= dt;
      if (b.t > 0) continue;
      b.dead = true;
      if (b.dmg) { chainBlast(b); continue; }
      explosion(b.x, b.y, b.r, b.pal, b.tier);
      impulse(b.x, b.y, 20, 140);
      S.shake += 2;
      Sfx.play('boom', 0, panAt(b.x));
    }
    for (const ring of S.rings) {
      ring.t += dt;
      const k = Math.min(1, ring.t / ring.dur);
      ring.r = ring.max * (1 - (1 - k) * (1 - k));
      if (ring.t >= ring.dur + 0.2) ring.dead = true;
    }
    for (const t of S.texts) {   // 伤害数字先弹起再落下
      t.x += t.vx * dt; t.y += t.vy * dt; t.vy += 420 * dt;
      t.life -= dt;
      if (t.life <= 0) t.dead = true;
    }
    for (const z of S.zaps) { z.life -= dt; if (z.life <= 0) z.dead = true; }
    for (const c of S.decals) {
      c.t += dt;
      if (c.t >= c.life) c.dead = true;
      if (c.t < 1.6 && Math.random() < 0.2 && S.parts.length < 600) {   // 坑还热的时候，从坑底和裂缝里飘出几颗火星
        const a = Math.random() * TAU, d = c.r * rand(0, 0.7), b = Math.random() * TAU, sp = rand(20, 60);
        S.parts.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, vx: Math.cos(b) * sp, vy: Math.sin(b) * sp - 25,
                       life: 0.6, max: 0.6, color: Math.random() < 0.5 ? '#ffd25a' : COL.foe, len: 3, ang: b, spin: 0, dead: false });
      }
    }
    for (const q of S.portals) { q.t += dt; if (q.t >= 0.9) q.dead = true; }
    for (const d of S.debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= fc; d.vy *= fc; d.rot += d.spin * dt; d.life -= dt; if (d.life <= 0) d.dead = true; }
    sweep(S.debris);
    sweep(S.decals);
    sweep(S.portals);
    S.p.recoil *= Math.exp(-18 * dt);
    sweep(S.parts);
    sweep(S.chunks);
    sweep(S.flares);
    sweep(S.booms);
    sweep(S.rings);
    sweep(S.texts);
    sweep(S.zaps);
    S.shake *= Math.exp(-9 * dt);
    if (S.shake < 0.3) S.shake = 0;
    if (S.hurtFlash > 0) S.hurtFlash -= dt;
    if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 2.2);
    S.punch *= Math.exp(-5 * dt);
    if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  }

  function updateImpulses(dt) {
    for (const im of impulses) im.t += dt;
    while (impulses.length && impulses[0].t > 0.9) impulses.shift();
  }

  function update(dt) {
    S.t += dt;
    updateWave();
    updateSpawns(dt);
    updatePlayer(dt);
    buildGrid();
    updateWeapons(dt);
    updateRings();
    updateEnemies(dt);
    animEnemies(dt);
    updateBullets(dt);
    updateMissiles(dt);
    updateWells(dt);
    updateHoles(dt);
    updateMeteors(dt);
    updateStrikes(dt);
    updateBombs(dt);
    updateEnemyBullets(dt);
    if (S.stasisT > 0) S.stasisT -= dt;
    if (S.shieldT > 0) S.shieldT -= dt;
    if (S.buffT > 0) { S.buffT -= dt; if (S.buffT <= 0) UI.banner('火力全开结束', '', 'me', true); }
    if (S.drop && S.t > S.drop.until) { S.drop = null; UI.dropOffer(null); }
    if (S.skill && (S.urgeT -= dt) <= 0) {   // 血少或被围时，技能按钮闪起来提醒释放
      S.urgeT = 0.25;
      let near = 0;
      for (const e of S.enemies) if (!e.dead && (e.x - S.p.x) ** 2 + (e.y - S.p.y) ** 2 < 170 * 170) near++;
      UI.skillUrge(S.p.hp < S.st.maxHp * 0.35 || near >= 10);
    }
    if (S.feverT > 0) {   // 狂热鼓点：每 0.4 秒镜头轻轻一跳
      S.feverT -= dt;
      S.beatT -= dt;
      if (S.beatT <= 0) { S.beatT = 0.4; S.punch += 0.012; impulse(S.p.x, S.p.y, 10, 170); Sfx.play('beat'); }
    }
    updateGems(dt);
    updatePickups(dt);
    updateFx(dt);
    sweep(S.enemies);
    sweep(S.bullets);
    sweep(S.ebullets);
    sweep(S.gems);
    sweep(S.pickups);
    const k = Math.min(1, dt * 10);
    let cox = 0, coy = 0;
    for (const h of S.holes) if (h.grip > 0) { cox += (h.x - S.p.x) * 0.25 * h.grip; coy += (h.y - S.p.y) * 0.25 * h.grip; }   // 被黑洞拽住时镜头也往黑洞那边偏
    camX += (S.p.x + cox - camX) * k;
    camY += (S.p.y + coy - camY) * k;
    // 越往后镜头越拉远，敌潮看起来更像一堵墙
    zoomMul += (1 - 0.012 * Math.min(S.wave, R.waves) - zoomMul) * Math.min(1, dt * 2);
    UI.hud(S);
    if (state === 'play' && S.pending.length) openNext();
  }

  // ---------- 渲染 ----------
  // 视图：屏幕坐标 = o + 世界坐标 · k。主画面和拖影层各一份。
  const MV = { g: ctx, k: 1, ox: 0, oy: 0 };
  const TV = { g: tctx, k: 1, ox: 0, oy: 0 };

  function setWorld(v) { v.g.setTransform(v.k, 0, 0, v.k, v.ox, v.oy); }
  function drawSprite(v, s, x, y, rot = 0, scale = 1) {
    const k = v.k * scale, sx = v.ox + x * v.k, sy = v.oy + y * v.k;
    if (rot) { const c = Math.cos(rot) * k, n = Math.sin(rot) * k; v.g.setTransform(c, n, -n, c, sx, sy); }
    else v.g.setTransform(k, 0, 0, k, sx, sy);
    v.g.drawImage(s.c, -s.half, -s.half, s.half * 2, s.half * 2);
  }

  // 非等比缩放：sx 沿机头方向，sy 沿翼展方向
  function drawSpriteEx(v, s, x, y, rot, sx, sy) {
    const k = v.k, c = Math.cos(rot), n = Math.sin(rot);
    v.g.setTransform(c * k * sx, n * k * sx, -n * k * sy, c * k * sy, v.ox + x * k, v.oy + y * k);
    v.g.drawImage(s.c, -s.half, -s.half, s.half * 2, s.half * 2);
  }
  const easeOutBack = t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  const ENGINE = { grunt: 1, runner: 1, tank: 1, shooter: 1, dart: 1, supply: 1 };   // 有尾焰的舰船

  // 每种舰船自己的动作：无人机悬停摇摆，飞梭顺着速度拉长，装甲舰缓慢起伏，炮艇开火前抖动、开火后坐，
  // 蜂群高频摆尾，浮雷一胀一缩，补给飞船左右晃。转弯时侧倾（翼展方向压扁），挨打时歪一下，刚出现时从小弹到正常大小。
  function enemyPose(e, T) {
    const age = S.t - e.born, bank = 1 - Math.abs(e.bank) * 0.5;
    let s = 1 + e.pop * 0.16, rot = e.rot + e.tilt, sx = 1, sy = 1, ox = 0, oy = 0;
    if (age < 0.35) s *= Math.max(0.05, easeOutBack(age / 0.35));
    switch (e.type) {
      case 'grunt': rot += Math.sin(T * 6 + e.ph) * 0.14; sy = bank; break;
      case 'runner': { const sp = Math.hypot(e.mvx, e.mvy); sx = 1 + Math.min(0.28, sp / 500); sy = (1 - Math.min(0.14, sp / 1000)) * bank; break; }
      case 'tank': { const b = Math.sin(T * 2.4 + e.ph) * 0.035; sx = 1 + b; sy = (1 - b) * (1 - Math.abs(e.bank) * 0.3); break; }
      case 'shooter':
        if (e.fire > 0 && e.fire < 0.5) { const j = (0.5 - e.fire) * 3; ox = rand(-j, j); oy = rand(-j, j); }
        ox -= Math.cos(e.rot) * e.kick * 6;
        oy -= Math.sin(e.rot) * e.kick * 6;
        sx = 1 - e.kick * 0.15;
        sy = (1 + e.kick * 0.1) * bank;
        break;
      case 'dart': rot += Math.sin(T * 24 + e.ph) * 0.24; sx = 1.12; sy = 0.9; break;
      case 'wall': { const b = 1 + Math.sin(T * 5 + e.ph) * 0.06; sx = b; sy = b; break; }
      case 'supply': rot += Math.sin(T * 3 + e.ph) * 0.1; sy = bank; break;
    }
    return { x: e.x + ox, y: e.y + oy, rot, sx: s * sx, sy: s * sy };
  }

  // 背景：星云图是本机生图模型（Qwen-Image）画的，相邻块镜像平铺，接缝处图案连续；
  // 前面再叠两层代码画的星星。三层视差，越近的层移动越快。
  const nebula = new Image();
  let nebulaOk = false;
  nebula.onload = () => { nebulaOk = true; };
  nebula.src = 'assets/nebula.jpg';
  const STAR_LAYERS = [{ par: 0.25, n: 60, size: 1.0, tile: null }, { par: 0.55, n: 26, size: 1.6, tile: null }];
  function buildStars() {
    const px = Math.round(640 * DPR);
    for (const L of STAR_LAYERS) {
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      for (let i = 0; i < L.n; i++) {
        const tint = Math.random();
        g.fillStyle = tint < 0.15 ? '#ffe9c4' : tint < 0.4 ? '#c8f5ff' : '#ffffff';
        g.globalAlpha = rand(0.3, 0.9);
        g.beginPath();
        g.arc(rand(2, px - 2), rand(2, px - 2), L.size * DPR * rand(0.5, 1), 0, TAU);
        g.fill();
      }
      L.tile = c;
    }
  }
  function drawBackdrop() {
    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (nebulaOk) {
      const D = Math.max(cw, ch) * 1.2;
      const ox = -camX * 0.06 * zoomEff * DPR, oy = -camY * 0.06 * zoomEff * DPR;
      ctx.globalAlpha = 0.8;
      for (let j = Math.floor(-oy / D); j * D + oy < ch; j++) {
        for (let i = Math.floor(-ox / D); i * D + ox < cw; i++) {
          const fx = i & 1 ? -1 : 1, fy = j & 1 ? -1 : 1, x = ox + i * D, y = oy + j * D;
          ctx.setTransform(fx, 0, 0, fy, fx < 0 ? x + D : x, fy < 0 ? y + D : y);
          ctx.drawImage(nebula, 0, 0, D, D);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const L of STAR_LAYERS) {
      if (!L.tile) continue;
      const D = L.tile.width, mod = v => ((v % D) + D) % D - D;
      const ox = mod(-camX * L.par * zoomEff * DPR), oy = mod(-camY * L.par * zoomEff * DPR);
      for (let y = oy; y < ch; y += D) for (let x = ox; x < cw; x += D) ctx.drawImage(L.tile, x, y);
    }
  }

  // 背景网格：每个交点按附近的冲击往外推，冲击带阻尼回弹
  const gridPts = new Float32Array(2 * 64 * 48);
  function warpAt(x, y, out, i) {
    let dx = 0, dy = 0;
    for (const im of impulses) {
      const ex = x - im.x, ey = y - im.y, rr = im.r * im.r, d2 = ex * ex + ey * ey;
      if (d2 > rr * 3) continue;
      const amp = im.a * Math.exp(-im.t * 5) * Math.cos(im.t * 13) * Math.exp(-d2 / rr);
      const d = Math.sqrt(d2) || 1;
      dx += (ex / d) * amp;
      dy += (ey / d) * amp;
    }
    if (S) for (const h of S.holes) { const q = holeWarp(h, x + dx, y + dy); dx += q[0]; dy += q[1]; }
    out[i] = x + dx;
    out[i + 1] = y + dy;
  }
  // 黑洞把周围的空间往里拽：点离中心越近，被拉得越近、绕中心转得越多（不会越过中心），网格看起来像一个往里旋的漏斗
  const HW = [0, 0];
  function holeWarp(h, x, y) {
    HW[0] = HW[1] = 0;
    const k = holeSize(h), RR = CONFIG.hole.radius * 1.3 * k, ex = x - h.x, ey = y - h.y, d = Math.hypot(ex, ey);
    if (k <= 0 || d >= RR || d < 0.5) return HW;
    const f = 1 - d / RR, sc = 1 - 0.68 * Math.pow(f, 1.3), a = f * f * (1.3 + 0.2 * Math.sin(S.t * 2.2));
    const c = Math.cos(a), n = Math.sin(a);
    HW[0] = (ex * c - ey * n) * sc - ex;
    HW[1] = (ex * n + ey * c) * sc - ey;
    return HW;
  }
  // 黑洞附近再叠一层细网格（间距是大网格的一半，每段再细分），同样按漏斗变形，紫色，越靠近中心越亮
  function drawWell(v) {
    const g = v.g, step = 22, sub = 11;
    for (const h of S.holes) {
      const k = holeSize(h), RR = CONFIG.hole.radius * 1.3 * k;
      if (k <= 0.02) continue;
      const gx0 = Math.floor((h.x - RR) / step) * step, gy0 = Math.floor((h.y - RR) / step) * step;
      setWorld(v);
      g.beginPath();
      for (let gx = gx0; gx <= h.x + RR; gx += step) {
        for (let gy = gy0, j = 0; gy <= h.y + RR; gy += sub, j++) { const q = holeWarp(h, gx, gy); j ? g.lineTo(gx + q[0], gy + q[1]) : g.moveTo(gx + q[0], gy + q[1]); }
      }
      for (let gy = gy0; gy <= h.y + RR; gy += step) {
        for (let gx = gx0, j = 0; gx <= h.x + RR; gx += sub, j++) { const q = holeWarp(h, gx, gy); j ? g.lineTo(gx + q[0], gy + q[1]) : g.moveTo(gx + q[0], gy + q[1]); }
      }
      const gr = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, RR);
      gr.addColorStop(0, hexA(COL.void, 0.75 * k));
      gr.addColorStop(0.45, hexA(COL.void, 0.32 * k));
      gr.addColorStop(1, hexA(COL.void, 0));
      g.strokeStyle = gr;
      g.lineWidth = 1.1 / zoomEff;
      g.stroke();
    }
  }
  function drawGrid(v, intensity) {
    const step = 44;
    const hw = W / zoomEff / 2 + step * 2, hh = H / zoomEff / 2 + step * 2;
    const x0 = Math.floor((camX - hw) / step) * step, y0 = Math.floor((camY - hh) / step) * step;
    const cols = Math.min(63, Math.ceil((2 * hw) / step) + 1), rows = Math.min(47, Math.ceil((2 * hh) / step) + 1);
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) warpAt(x0 + i * step, y0 + j * step, gridPts, (j * 64 + i) * 2);
    }
    const t = clamp(intensity * 0.85, 0, 1);
    const r = Math.round(60 + (255 - 60) * t), g = Math.round(255 + (59 - 255) * t), b = Math.round(192 + (59 - 192) * t);
    setWorld(v);
    v.g.lineWidth = 1 / zoomEff;
    for (const major of [false, true]) {
      v.g.beginPath();
      for (let i = 0; i <= cols; i++) {
        if (((x0 / step + i) % 4 === 0) !== major) continue;
        for (let j = 0; j <= rows; j++) { const q = (j * 64 + i) * 2; j ? v.g.lineTo(gridPts[q], gridPts[q + 1]) : v.g.moveTo(gridPts[q], gridPts[q + 1]); }
      }
      for (let j = 0; j <= rows; j++) {
        if (((y0 / step + j) % 4 === 0) !== major) continue;
        for (let i = 0; i <= cols; i++) { const q = (j * 64 + i) * 2; i ? v.g.lineTo(gridPts[q], gridPts[q + 1]) : v.g.moveTo(gridPts[q], gridPts[q + 1]); }
      }
      v.g.strokeStyle = `rgba(${r},${g},${b},${major ? 0.1 + 0.08 * t : 0.04 + 0.03 * t})`;
      v.g.stroke();
    }
    if (S && S.holes.length) drawWell(v);
  }

  // 碎片按颜色和透明度分桶，一桶一次 stroke
  const PART_COLORS = [COL.me, COL.foe, COL.danger, COL.hot, '#ffd25a', COL.void];
  function drawParts(v) {
    if (!S.parts.length) return;
    setWorld(v);
    v.g.lineCap = 'round';
    v.g.lineWidth = 1.6;
    for (let ci = 0; ci < PART_COLORS.length; ci++) {
      for (let bk = 0; bk < 3; bk++) {
        v.g.beginPath();
        let any = false;
        for (const q of S.parts) {
          if (q.color !== PART_COLORS[ci]) continue;
          if (Math.min(2, Math.floor((q.life / q.max) * 3)) !== bk) continue;
          const cx = Math.cos(q.ang) * q.len * 0.5, cy = Math.sin(q.ang) * q.len * 0.5;
          v.g.moveTo(q.x - cx, q.y - cy);
          v.g.lineTo(q.x + cx, q.y + cy);
          any = true;
        }
        if (!any) continue;
        v.g.globalAlpha = (bk + 1) / 3;
        v.g.strokeStyle = PART_COLORS[ci];
        v.g.stroke();
      }
    }
    v.g.globalAlpha = 1;
  }

  // 画一团辉光：sx、sy 是世界单位下的长和宽，配合 rot 可以拉成长条（子弹、尾焰）
  // 任意贴图按世界尺寸画：sx、sy 是画出来的宽和高
  function drawTex(v, tex, x, y, sx, sy = sx, rot = 0, alpha = 1) {
    const k = v.k, c = Math.cos(rot), s = Math.sin(rot), tw = tex.width, th = tex.height;
    v.g.globalAlpha = alpha;
    v.g.setTransform((c * k * sx) / tw, (s * k * sx) / tw, (-s * k * sy) / th, (c * k * sy) / th, v.ox + x * k, v.oy + y * k);
    v.g.drawImage(tex, -tw / 2, -th / 2);
  }
  const FX = (kind, col) => Art.fx(kind, PCOL[col] || col);

  function drawGlow(v, col, x, y, sx, sy = sx, rot = 0, alpha = 1) {
    const k = v.k, c = Math.cos(rot), s = Math.sin(rot);
    v.g.globalAlpha = alpha;
    v.g.setTransform((c * k * sx) / 64, (s * k * sx) / 64, (-s * k * sy) / 64, (c * k * sy) / 64, v.ox + x * k, v.oy + y * k);
    v.g.drawImage(GLOW[col], -32, -32);
  }

  // 主角机身：按侧倾角沿翼展方向压扁；抬起的半边略大、提亮，压下的半边略小、压暗，看起来像在滚转
  function drawHull(v, set, key, x, y, rot, sc, roll, alpha) {
    const g = v.g, k = v.k * sc, c = Math.cos(rot), n = Math.sin(rot), cr = Math.cos(roll), sr = Math.sin(roll), img = set[key], h = img.half;
    for (const side of [-1, 1]) {
      const sy = cr * (1 - 0.12 * side * sr), shade = side * sr;   // shade > 0：这半边压下去
      g.save();
      g.setTransform(c * k, n * k, -n * k * sy, c * k * sy, v.ox + x * v.k, v.oy + y * v.k);
      g.beginPath();
      g.rect(-h, side < 0 ? -h : -0.3, 2 * h, h + 0.3);
      g.clip();
      g.globalAlpha = alpha;
      g.drawImage(img.c, -h, -h, 2 * h, 2 * h);
      if (key === 'n' && Math.abs(shade) > 0.03) {
        g.globalAlpha = alpha * Math.min(1, Math.abs(shade) * 1.2);
        g.drawImage((shade > 0 ? set.dark : set.lit).c, -h, -h, 2 * h, 2 * h);
      }
      g.restore();
    }
  }

  // 主角战机：呼吸、开火后坐、按等级换机体、狂热变身（光翼 + 副炮 + 金色机身 + 光环 + 残影）、进阶和变身时的闪白
  function drawPlayer(v, main, T) {
    const g = v.g, p = S.p;
    const add = () => { g.globalCompositeOperation = 'lighter'; };
    const solid = () => { if (main) g.globalCompositeOperation = 'source-over'; };
    if (p.hp <= 0 || (p.inv > 0 && Math.floor(p.inv * 16) % 2)) return;
    const r = p.r * Art.VIS, rot = p.vface, c = Math.cos(rot), s = Math.sin(rot), cr = Math.cos(p.roll);
    const x = p.x - Math.cos(p.aim) * 2.5 * p.recoil, y = p.y - Math.sin(p.aim) * 2.5 * p.recoil;
    const m = p.morph, e = p.morphOn ? Math.max(0, easeOutBack(m)) : m * m * (3 - 2 * m);   // 展开带回弹，收起平滑
    let sc = (1 + Math.sin(T * 3) * 0.02) * (1 - p.squash * 0.15) * (1 + 0.08 * e), flash = Math.max(0, p.flash);
    const fx = p.tierFx;
    if (fx) {
      if (fx.t < 0.4) { sc *= 1 + 0.25 * (fx.t / 0.4); flash = Math.max(flash, (fx.t / 0.4) * 0.85); }
      else sc *= 1 + 0.25 * (1 - easeOutBack(Math.min(1, (fx.t - 0.4) / 0.6)));
    }
    const at = (lx, ly) => [x + (c * lx - s * ly * cr) * sc, y + (s * lx + c * ly * cr) * sc];   // 机体坐标 → 世界坐标
    const gold = e > 0.5;
    add();
    const L = (9 + 13 * p.thrust) * rand(0.85, 1.15) * (1 + 0.4 * e);
    for (const ey of Art.ENGINES[p.tier]) {   // 每个喷口一道尾焰，喷口数随机体进阶变多
      const [nx, ny] = at(-1.1 * r, ey * r);
      drawGlow(v, gold ? 'gold' : 'me', nx - c * L * 0.45, ny - s * L * 0.45, L * 1.3, 8, rot, 0.9);
      drawGlow(v, 'hot', nx - c * L * 0.2, ny - s * L * 0.2, L * 0.6, 3.5, rot, 0.9);
    }
    if (S.buffT > 0) {   // 火力全开（广告空投）：机身外三段反向转动的橙色电弧
      const k = Math.min(1, S.buffT / 1.5), rr = r * 2.7 * sc;
      drawGlow(v, 'gold', x, y, rr * 1.7, rr * 1.7, 0, 0.16 * k);
      setWorld(v);
      g.globalAlpha = 0.85 * k;
      g.strokeStyle = '#ff9a3c';
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const a0 = -T * 4 + (i * TAU) / 3; g.beginPath(); g.arc(x, y, rr, a0, a0 + 1.3); g.stroke(); }
      g.globalAlpha = 1;
    }
    if (e > 0.01) {   // 狂热形态：身后一圈转动的金色光环；移动时拖金色残影
      drawGlow(v, 'gold', x, y, r * 4.2 * e, r * 4.2 * e, 0, 0.35 * Math.min(1, e));
      setWorld(v);
      g.globalAlpha = 0.7 * Math.min(1, e);
      g.strokeStyle = PCOL.gold;
      g.lineWidth = 1.5;
      g.setLineDash([10, 6]);
      g.lineDashOffset = -T * 40;
      g.beginPath(); g.arc(x, y, r * 2.2 * sc, 0, TAU); g.stroke();
      g.setLineDash([]);
      if (main) p.hist.forEach((q, i) => { if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 > 16) drawHull(v, sprites.shipF[p.tier], 'n', q.x, q.y, q.a, sc, p.roll, (0.24 - i * 0.07) * Math.min(1, e)); });
    }
    g.globalAlpha = 1;
    solid();
    if (e > 0.01) {   // 光翼从朝后贴着机身的位置转出来，副炮从机身两侧滑出
      const k = (0.35 + 0.65 * e) * 1.25, kp = 0.5 + 0.5 * e;
      for (const side of [-1, 1]) {
        const a = Math.PI - side * 0.97 * e + Math.sin(T * 6) * 0.05 * e;
        const [wx, wy] = at(-0.25 * r, side * 0.5 * r);
        drawSpriteEx(v, sprites.fwing, wx, wy, rot + Math.atan2(Math.sin(a) * cr, Math.cos(a)), sc * k, sc * k);
        const [ox, oy] = at((0.1 + 0.25 * e) * r, side * (0.35 + 0.85 * e) * r);
        drawSpriteEx(v, sprites.fpod, ox, oy, rot, sc * kp, sc * kp * cr);
      }
    }
    const set = sprites.ship[p.tier];
    drawHull(v, set, 'n', x, y, rot, sc, p.roll, 1);
    if (e > 0.01) drawHull(v, sprites.shipF[p.tier], 'n', x, y, rot, sc, p.roll, Math.min(1, e));   // 机身转成金色
    if (flash > 0.01) drawHull(v, set, 'white', x, y, rot, sc, p.roll, Math.min(1, flash));
    g.globalAlpha = 1;
    add();
  }

  // 黑洞的引力透镜：把黑洞周围这块画面截下来，切成一圈圈细圆环，每圈按自己的倍率放大、扭转再贴回去——越靠近中心放得越大、扭得越多，
  // 背景网格、星云、敌人都被拉弯成漩涡，中间挤出一圈爱因斯坦环。每圈只画自己那一环，所以圈数可以多（电脑 32 圈、手机 18 圈），接缝看不出来。
  // 透镜在敌人画完、敌弹和主角画之前做：敌弹和主角的位置不会被扭曲，不影响躲避
  const lensC = document.createElement('canvas'), lensG = lensC.getContext('2d');
  function drawLens(v, T) {
    const g = v.g, H = CONFIG.hole, bands = TOUCH ? 18 : 32, p = S.p;
    for (const h of S.holes) {
      const k = holeSize(h);
      if (k <= 0.02) continue;
      const cx = v.ox + h.x * v.k, cy = v.oy + h.y * v.k, Rl = H.radius * 0.95 * k * v.k, Re = H.core * 2.8 * k * v.k;   // 透镜半径、爱因斯坦环半径（像素）
      const x0 = Math.max(0, Math.floor(cx - Rl)), y0 = Math.max(0, Math.floor(cy - Rl));
      const x1 = Math.min(canvas.width, Math.ceil(cx + Rl)), y1 = Math.min(canvas.height, Math.ceil(cy + Rl));
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const D = Math.ceil(Rl * 2) + 2, ox = cx - Rl, oy = cy - Rl;   // 截图左上角在屏幕上的位置
      if (lensC.width < D) lensC.width = D;
      if (lensC.height < D) lensC.height = D;
      lensG.setTransform(1, 0, 0, 1, 0, 0);
      lensG.fillStyle = '#000';
      lensG.fillRect(0, 0, D, D);
      lensG.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, x0 - ox, y0 - oy, x1 - x0, y1 - y0);
      g.save();
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      const wob = Math.sin(T * 1.5) * 0.25;
      const rad = j => Re * 0.55 + (Rl - Re * 0.55) * Math.pow(1 - j / bands, 1.25);   // 第 j 圈的外半径，外疏内密
      for (let j = 0; j < bands; j++) {
        const th = rad(j), tin = j === bands - 1 ? 0 : Math.max(0, rad(j + 1) - 0.8);
        const u = clamp((th - Re) / (Rl - Re), 0, 1), w = Math.pow(1 - u, 1.6);
        const beta = Math.max(th * 0.12, th - ((Re * Re) / th) * w);   // 这一圈显示的是原画面里半径 beta 处的东西
        const sc = th / beta, rot = w * (1.5 + wob);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.save();
        g.beginPath();
        g.arc(cx, cy, th, 0, TAU);
        if (tin > 0) g.arc(cx, cy, tin, TAU, 0, true);
        g.clip();
        const c = Math.cos(rot) * sc, n = Math.sin(rot) * sc;
        g.setTransform(c, n, -n, c, cx, cy);
        g.drawImage(lensC, 0, 0, D, D, -Rl, -Rl, D, D);
        g.restore();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);   // 越靠里越暗：光被吞掉了
      const dk = g.createRadialGradient(cx, cy, Re * 0.5, cx, cy, Rl);
      dk.addColorStop(0, 'rgba(0,0,0,0.6)');
      dk.addColorStop(0.35, 'rgba(0,0,0,0.25)');
      dk.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = dk;
      g.beginPath(); g.arc(cx, cy, Rl, 0, TAU); g.fill();
      g.restore();

      const core = H.core * k;
      g.globalCompositeOperation = 'lighter';
      drawGlow(v, 'void', h.x, h.y, core * 9, core * 9, 0, 0.6);
      setWorld(v);
      g.strokeStyle = COL.void;
      for (let i = 0; i < 4; i++) {   // 引力波纹：从边上收向中心，越往里越亮（透镜之后画，不会被透镜复制成一圈圈）
        const q = (T * 0.45 + i / 4) % 1, rr = H.radius * k * (1 - q * 0.85);
        g.globalAlpha = 0.45 * k * Math.sin(q * Math.PI);
        g.lineWidth = 1.2 + 2 * q;
        g.beginPath(); g.arc(h.x, h.y, rr, 0, TAU); g.stroke();
      }
      for (let i = 0; i < 40; i++) {   // 吸积盘：一圈圈亮弧，越靠里转得越快、越亮
        const q = (i * 0.618) % 1, rr = core * (1.5 + q * 2.4), sp = 3.4 * Math.pow(1.5 / (1.5 + q * 2.4), 1.5);
        const a = T * sp + i * 2.39, len = 0.5 + ((i * 0.37) % 1) * 1.3;
        g.globalAlpha = (0.25 + 0.65 * (1 - q)) * k;
        g.strokeStyle = i % 3 ? COL.void : i % 2 ? '#ff9ad8' : COL.hot;
        g.lineWidth = 0.8 + (1 - q) * 2.2;
        g.beginPath(); g.arc(h.x, h.y, rr, a, a + len); g.stroke();
      }
      g.globalAlpha = 0.55 * k;   // 多普勒增亮：转过来的那半边更亮
      g.strokeStyle = COL.hot;
      g.lineWidth = 3.5;
      g.beginPath(); g.arc(h.x, h.y, core * 1.7, T * 0.6, T * 0.6 + Math.PI); g.stroke();
      g.globalCompositeOperation = 'source-over';   // 视界：纯黑，边缘柔一点
      g.globalAlpha = 1;
      const hr = core * 1.25, gr = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, hr * 1.3);
      gr.addColorStop(0, '#000');
      gr.addColorStop(0.75, '#000');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(h.x, h.y, hr * 1.3, 0, TAU); g.fill();
      g.globalCompositeOperation = 'lighter';   // 光子环：贴着视界的一道细亮环
      g.globalAlpha = 0.4 * k;
      g.strokeStyle = COL.void;
      g.lineWidth = 6;
      g.beginPath(); g.arc(h.x, h.y, core * 1.42, 0, TAU); g.stroke();
      g.globalAlpha = 0.95 * k;
      g.strokeStyle = '#f1e6ff';
      g.lineWidth = 1.5;
      g.stroke();
      if (h.grip > 0.02) {   // 主角被拽住：机身朝黑洞方向拖出一道被扯长的紫光
        const a = Math.atan2(h.y - p.y, h.x - p.x), L = 30 + 90 * h.grip;
        drawGlow(v, 'void', p.x + Math.cos(a) * L * 0.45, p.y + Math.sin(a) * L * 0.45, L * 1.4, 16 + 10 * h.grip, a, 0.35 + 0.4 * h.grip);
        drawGlow(v, 'hot', p.x + Math.cos(a) * L * 0.3, p.y + Math.sin(a) * L * 0.3, L * 0.8, 5, a, 0.3 * h.grip);
      }
      g.globalAlpha = 1;
    }
  }

  // 主画面里舰船用正常叠加（实心，挡住背景），光效用 lighter 叠加；拖影层全部 lighter
  function drawWorld(v, main, T) {
    const g = v.g, p = S.p;
    const hw = W / zoomEff / 2 + 60, hh = H / zoomEff / 2 + 60;
    const vis = (x, y) => Math.abs(x - camX) < hw && Math.abs(y - camY) < hh;
    const add = () => { g.globalCompositeOperation = 'lighter'; };
    const solid = () => { if (main) g.globalCompositeOperation = 'source-over'; };

    if (main) {
      for (const c of S.decals) {   // 陨石坑：art.js 画好的两张贴图——冷底图（坑沿、坑底、溅射纹、碎石、深缝）压暗地面，
        // 发光层（坑底熔岩、裂缝里的岩浆、坑沿余烬）随时间冷却、微微闪烁；刚砸下时坑从小一点弹开，一圈尘土冲击环往外扩
        if (!vis(c.x, c.y)) continue;
        const f = c.t / c.life, a = f < 0.75 ? 1 : (1 - f) / 0.25, heat = Math.max(0, 1 - f * 1.35);
        const sc = (c.r / sprites.crater[0].r) * (c.t < 0.12 ? 0.85 + 0.15 * (c.t / 0.12) : 1);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = a;
        drawSprite(v, sprites.crater[c.v], c.x, c.y, c.rot, sc);
        add();
        drawGlow(v, 'foe', c.x, c.y, c.r * 2.2, c.r * 2.2, 0, 0.3 * heat * a);
        g.globalAlpha = heat * a * (0.85 + 0.15 * Math.sin(T * 9 + c.rot * 5));
        drawSprite(v, sprites.craterHot[c.v], c.x, c.y, c.rot, sc);
        if (c.t < 0.4) { const d = c.r * (2 + c.t * 9); drawTex(v, FX('ring', 'rock'), c.x, c.y, d, d, 0, (1 - c.t / 0.4) * 0.55); }
        g.globalAlpha = 1;
      }
      solid();
      for (const gm of S.gems) if (vis(gm.x, gm.y)) drawSprite(v, gm.v >= 10 ? sprites.gem3 : gm.v >= 3 ? sprites.gem2 : sprites.gem1, gm.x, gm.y, T * 1.5);
      add();
      for (const it of S.pickups) {   // 技能舱：金色光晕加一圈转动的虚线信标，远远就能看见
        if (it.kind !== 'skill' || !vis(it.x, it.y)) continue;
        drawGlow(v, 'gold', it.x, it.y, 90, 90, 0, 0.75 + 0.25 * Math.sin(T * 5));
        g.globalAlpha = 0.8;
        g.setTransform(v.k, 0, 0, v.k, v.ox + it.x * v.k, v.oy + it.y * v.k);
        g.strokeStyle = '#ffd25a';
        g.lineWidth = 1.6;
        g.setLineDash([6, 5]);
        g.lineDashOffset = -T * 18;
        g.beginPath();
        g.arc(0, 0, 24 + Math.sin(T * 5) * 2, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
      solid();
      for (const it of S.pickups) if (vis(it.x, it.y)) drawSprite(v, sprites[it.kind], it.x, it.y + Math.sin(T * 4) * 2, it.kind === 'magnet' || it.kind === 'skill' ? T : 0, 1 + Math.sin(T * 6) * 0.08);
      add();
      drawWarnings(v, T);
    }

    for (const h of S.holes) {   // 黑洞外圈：三条紫色星尘旋臂往里卷，一圈圈引力波纹从范围边上往中心收；透镜、吸积盘、视界在 drawLens 里画
      const k = holeSize(h), R = CONFIG.hole.radius * k;
      if (k <= 0) continue;
      add();
      drawGlow(v, 'void', h.x, h.y, R * 1.5, R * 1.5, 0, 0.18 * k);
      setWorld(v);
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {   // 旋臂：每段一样的弧度，越往里越细越亮，整体慢慢转
        const a0 = (i / 3) * TAU - T * 0.7;
        for (let j = 0; j < 22; j++) {
          const q0 = j / 22, q1 = (j + 1) / 22;
          const r0 = R * (1 - q0 * 0.82), r1 = R * (1 - q1 * 0.82), b0 = a0 + q0 * q0 * 3.2, b1 = a0 + q1 * q1 * 3.2;
          for (const pass of [0, 1]) {
            g.globalAlpha = (pass ? 0.35 : 0.1) * k * (0.3 + 0.7 * q0);
            g.strokeStyle = pass ? '#d9b8ff' : COL.void;
            g.lineWidth = (pass ? 1.6 : 9) * (1.2 - q0 * 0.7);
            g.beginPath();
            g.moveTo(h.x + Math.cos(b0) * r0, h.y + Math.sin(b0) * r0);
            g.lineTo(h.x + Math.cos(b1) * r1, h.y + Math.sin(b1) * r1);
            g.stroke();
          }
        }
      }
      g.strokeStyle = COL.void;
      g.globalAlpha = 0.22 * k;   // 范围边界：一道淡淡的实线
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(h.x, h.y, R, 0, TAU); g.stroke();
      g.globalAlpha = 1;
    }

    add();
    if (S.rings.length) {   // 冲击波：贴图画的环（白亮的边 + 往里渐隐的光）；武器冲击波另加一圈往外射的速度线
      for (const ring of S.rings) {
        // 爆炸的圈一边扩一边淡；武器冲击波扩完才开始淡
        const fade = ring.soft ? Math.max(0, 1 - ring.t / (ring.dur + 0.1)) : ring.t < ring.dur ? 1 : Math.max(0, 1 - (ring.t - ring.dur) / 0.2);
        if (ring.r < 1 || fade <= 0) continue;
        drawTex(v, FX('ring', ring.col), ring.x, ring.y, ring.r * 2.15, ring.r * 2.15, 0, fade * (ring.soft ? 0.55 : 1));
        if (ring.lines) {
          setWorld(v);
          g.globalAlpha = 0.6 * fade;
          g.strokeStyle = ring.col;
          g.lineWidth = 1.3;
          g.beginPath();
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * TAU + ring.id * 0.7, r0 = ring.r * 0.82, r1 = ring.r * 1.05;
            g.moveTo(ring.x + Math.cos(a) * r0, ring.y + Math.sin(a) * r0);
            g.lineTo(ring.x + Math.cos(a) * r1, ring.y + Math.sin(a) * r1);
          }
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }

    const boss = S.boss;
    if (boss && boss.ai.mode === 'windup') {   // Boss 冲撞前画出预警通道
      const B = CONFIG.boss, len = B.dashSpeed * B.dashTime;
      setWorld(v);
      g.globalAlpha = 0.35 + 0.3 * Math.sin(T * 30);
      g.strokeStyle = COL.danger;
      g.lineWidth = 1.5;
      const nx = -boss.ai.dy * boss.r, ny = boss.ai.dx * boss.r;
      g.beginPath();
      g.moveTo(boss.x + nx, boss.y + ny); g.lineTo(boss.x + nx + boss.ai.dx * len, boss.y + ny + boss.ai.dy * len);
      g.moveTo(boss.x - nx, boss.y - ny); g.lineTo(boss.x - nx + boss.ai.dx * len, boss.y - ny + boss.ai.dy * len);
      g.stroke();
      g.globalAlpha = 1;
    }

    add();
    for (const q of S.portals) {   // 精英传送门：两圈反向转的红色光环先弹开再收拢
      const k = q.t / 0.9, open = k < 0.3 ? easeOutBack(k / 0.3) : 1 - (k - 0.3) / 0.7, rr = 48 * Math.max(0, open);
      if (rr < 1) continue;
      drawGlow(v, 'danger', q.x, q.y, rr * 3, rr * 3, 0, 0.6 * Math.min(1, open));
      setWorld(v);
      g.globalAlpha = Math.min(1, open);
      g.strokeStyle = COL.danger;
      g.lineWidth = 2.5;
      g.beginPath();
      for (let i = 0; i < 3; i++) { const a = q.t * 6 + (i * TAU) / 3; g.moveTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr); g.arc(q.x, q.y, rr, a, a + 1.5); }
      g.stroke();
      g.strokeStyle = '#ffb0b0';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 3; i++) { const a = -q.t * 9 + (i * TAU) / 3, r2 = rr * 0.62; g.moveTo(q.x + Math.cos(a) * r2, q.y + Math.sin(a) * r2); g.arc(q.x, q.y, r2, a, a + 1.2); }
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const e of S.enemies) {   // 船身下面：引擎尾焰（越快越长、一直在闪）、精英的呼吸光晕、护盾发生器的紫光
      if (e === boss || !vis(e.x, e.y)) continue;
      if (e.elite) drawGlow(v, 'danger', e.x, e.y, e.r * 3.2, e.r * 3.2, 0, 0.22 + 0.1 * Math.sin(T * 4 + e.ph));
      if (e.type === 'pylon') drawGlow(v, 'void', e.x, e.y, e.r * 4, e.r * 4, 0, 0.35 + 0.15 * Math.sin(T * 5 + e.ph));
      if (!ENGINE[e.type]) continue;
      const sp = Math.hypot(e.mvx, e.mvy), L = e.r * (0.8 + Math.min(1.6, sp / 120)) * rand(0.8, 1.15);
      const c = Math.cos(e.rot), s = Math.sin(e.rot), back = e.r * 1.05 + L * 0.35;
      drawGlow(v, e.elite ? 'danger' : e.type === 'supply' ? 'gold' : 'foe', e.x - c * back, e.y - s * back, L * 1.5, e.r * 0.7, e.rot, 0.6);
    }
    g.globalAlpha = 1;
    solid();
    for (const e of S.enemies) {
      if (e === boss || !vis(e.x, e.y)) continue;
      const fl = e.flash > 0, q = enemyPose(e, T), suf = e.elite ? (fl ? '_ew' : '_e') : fl ? '_w' : '';
      drawSpriteEx(v, sprites[e.type + suf], q.x, q.y, q.rot, q.sx, q.sy);
      if (e.type === 'tank') {   // 炮塔一直对着玩家，来回微微扫动
        const ta = Math.atan2(p.y - e.y, p.x - e.x) + Math.sin(T * 1.1 + e.ph) * 0.25;
        drawSpriteEx(v, sprites['tank_t' + suf], q.x - Math.cos(q.rot) * e.r * 0.1, q.y - Math.sin(q.rot) * e.r * 0.1, ta, q.sx, q.sy);
      }
    }
    add();
    const chains = new Map();   // 包围圈：相邻两颗浮雷之间连一道闪烁的红色能量链，画在雷上面，让“墙”一眼看得出来；雷被打掉就断开一个口
    for (const e of S.enemies) {
      if (e.ev !== 'ring' || e.dead) continue;
      let c = chains.get(e.ring);
      if (!c) chains.set(e.ring, (c = []));
      c[e.ri] = e;
      c.n = e.rn;
    }
    if (chains.size) {
      setWorld(v);
      for (const pass of [0, 1]) {
        g.lineWidth = pass ? 1.2 : 4.5;
        g.globalAlpha = pass ? 0.7 + 0.25 * Math.sin(T * 25) : 0.16;
        g.strokeStyle = pass ? '#ffb0b0' : COL.danger;
        g.beginPath();
        for (const c of chains.values()) {
          for (let i = 0; i < c.n; i++) {
            const a = c[i], b = c[(i + 1) % c.n];
            if (!a || !b || (a.x - b.x) ** 2 + (a.y - b.y) ** 2 > 90 * 90) continue;
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
          }
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    for (const e of S.enemies) {   // 船身上面：浮雷的警示灯（玩家靠近时闪得更快）、炮艇开火前的蓄力光
      if (e === boss || !vis(e.x, e.y)) continue;
      if (e.type === 'wall') {
        const close = (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 150 * 150;
        drawGlow(v, 'danger', e.x, e.y, e.r * 2.4, e.r * 2.4, 0, 0.6 * Math.max(0, Math.sin(T * (close ? 16 : 5) + e.ph)));
      } else if (e.type === 'shooter' && e.fire > 0 && e.fire < 0.6) {
        const k = 1 - e.fire / 0.6;
        drawGlow(v, 'danger', e.x + Math.cos(e.rot) * e.r, e.y + Math.sin(e.rot) * e.r, 8 + 22 * k, 8 + 22 * k, 0, 0.5 + 0.5 * k);
      }
      if (e.elite) {   // 精英：外面一圈转动的危险环，三段弧，每段后面一个往里指的箭头
        const rr = e.r * 1.6, a0 = T * 2.2 + e.ph;
        setWorld(v);
        g.globalAlpha = 0.75;
        g.strokeStyle = COL.danger;
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = a0 + (i * TAU) / 3, b = a + 1.75;
          g.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
          g.arc(e.x, e.y, rr, a, a + 1.25);
          g.moveTo(e.x + Math.cos(b - 0.12) * rr * 1.22, e.y + Math.sin(b - 0.12) * rr * 1.22);
          g.lineTo(e.x + Math.cos(b) * rr * 1.02, e.y + Math.sin(b) * rr * 1.02);
          g.lineTo(e.x + Math.cos(b + 0.12) * rr * 1.22, e.y + Math.sin(b + 0.12) * rr * 1.22);
        }
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    g.globalAlpha = 1;
    solid();
    if (S.debris.length) {   // Boss 换阶段崩飞的大块残骸：边转边飞，最后 40% 的时间淡出，每块身后一团红光
      add();
      for (const d of S.debris) drawGlow(v, 'danger', d.x + Math.cos(d.rot) * d.off, d.y + Math.sin(d.rot) * d.off, 80, 80, 0, 0.5 * Math.min(1, d.life / (d.max * 0.4)));
      solid();
      for (const d of S.debris) { g.globalAlpha = Math.min(1, d.life / (d.max * 0.4)); drawSprite(v, sprites[d.spr], d.x, d.y, d.rot, 1); }
      g.globalAlpha = 1;
    }
    if (boss) {   // Boss 最后画，压在召唤出来的小怪上面；整体缓慢呼吸，冲撞前和破盾硬直时原地抖。
      // 换阶段时新外形从小弹开、边转边展开，开头一下闪白；核心一个阶段比一个阶段露得多、跳得快
      const st = boss.ai.stage, key = ['boss', 'boss2', 'boss3'][st], stun = boss.ai.mode === 'stun';
      const m = clamp((S.t - (boss.ai.morphT ?? -9)) / 0.7, 0, 1), unfold = m < 1 ? 0.55 + 0.45 * easeOutBack(m) : 1;
      const fl = boss.flash > 0 || m < 0.2 || (boss.ai.mode === 'windup' && Math.sin(T * 40) > 0);
      const br = (1 + boss.pop * 0.16) * (1 + Math.sin(T * [3, 5, 7][st]) * 0.025) * unfold, wind = boss.ai.mode === 'windup' ? 3 : stun ? 2 : 0;
      const bx = boss.x + rand(-wind, wind), by = boss.y + rand(-wind, wind), rot = boss.rot - (1 - m) * (1 - m) * 2.5, R = boss.r * Art.VIS;
      const beat = 1 + 0.14 * Math.sin(T * [6, 9, 14][st]);
      if (st === 2) {   // 裸核：身后一大团紫光和一圈碎片轨道
        add();
        drawGlow(v, 'void', bx, by, R * 3.4, R * 3.4, 0, 0.5);
        setWorld(v);
        g.globalAlpha = 0.25;
        g.strokeStyle = COL.void;
        g.lineWidth = 1;
        g.beginPath(); g.arc(bx, by, R * 1.75, 0, TAU); g.stroke();
        solid();
      }
      g.globalAlpha = 1;
      drawSpriteEx(v, sprites[fl ? key + '_w' : key], bx, by, rot, br, br);
      add();
      if (st === 0) {   // 要塞：核心藏在闭合的虹膜后面，只从叶片缝里透出一点光；虹膜外框上四段红弧在转
        drawGlow(v, 'danger', bx, by, R * 1.6 * beat, R * 1.6 * beat, 0, 0.55);
        drawGlow(v, 'hot', bx, by, R * 0.35 * beat, R * 0.35 * beat, 0, stun ? 0.9 : 0.5);
        setWorld(v);
        g.globalAlpha = 0.8;
        g.strokeStyle = COL.danger;
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < 4; i++) { const a = -T * 1.6 + (i * TAU) / 4; g.moveTo(bx + Math.cos(a) * R * 0.52, by + Math.sin(a) * R * 0.52); g.arc(bx, by, R * 0.52, a, a + 0.9); }
        g.stroke();
      } else if (st === 1) {   // 刃环：虹膜半开，洞里一颗白热核心；六片刀刃上的紫光一明一暗
        drawGlow(v, 'danger', bx, by, R * 1.7 * beat, R * 1.7 * beat, 0, 0.4);
        drawGlow(v, 'void', bx, by, R * 2.2, R * 2.2, 0, 0.35 + 0.1 * Math.sin(T * 9));
        drawGlow(v, 'hot', bx, by, R * 0.6 * beat, R * 0.6 * beat, 0, 0.95);
        for (let i = 0; i < 6; i++) {
          const a = rot + (i * TAU) / 6 + 0.3;
          drawGlow(v, 'void', bx + Math.cos(a) * R * 1.0, by + Math.sin(a) * R * 1.0, R * 0.9, R * 0.35, a + 1.2, 0.3 + 0.2 * Math.sin(T * 9 + i));
        }
        setWorld(v);
        g.globalAlpha = 0.85;
        g.strokeStyle = COL.void;
        g.lineWidth = 1.6;
        g.beginPath();
        for (let i = 0; i < 3; i++) { const a = T * 3 + (i * TAU) / 3; g.moveTo(bx + Math.cos(a) * R * 0.24, by + Math.sin(a) * R * 0.24); g.arc(bx, by, R * 0.24, a, a + 1.2); }
        g.stroke();
      } else {   // 裸核：一颗翻涌的大等离子核心，表面几道弧光乱转，一阵一阵朝三只钩爪放电；四块碎片绕着它转
        const cr = R * 0.42 * beat;
        drawGlow(v, 'void', bx, by, cr * 5, cr * 5, 0, 0.75);
        drawGlow(v, 'hot', bx, by, cr * 2.4, cr * 2.4, 0, 1);
        drawGlow(v, 'danger', bx, by, cr * 3, cr * 3, 0, 0.25 + 0.15 * Math.sin(T * 14));
        setWorld(v);
        g.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const a = T * (2.2 + i * 0.37) * (i % 2 ? -1 : 1) + i * 1.7, rr = cr * (0.7 + 0.25 * Math.sin(T * 3 + i));
          g.globalAlpha = 0.75;
          g.strokeStyle = i % 3 ? COL.void : '#f1e6ff';
          g.lineWidth = i % 3 ? 2.4 : 1.4;
          g.beginPath(); g.arc(bx, by, rr, a, a + 0.9 + 0.5 * Math.sin(T * 5 + i)); g.stroke();
        }
        for (let i = 0; i < 3; i++) {   // 放电：核心到钩爪的锯齿闪电，每帧重新随机
          if (Math.sin(T * 11 + i * 2.1) < 0.1) continue;
          const a = rot + (i * TAU) / 3, c = Math.cos(a), n = Math.sin(a), pts = [];
          for (let j = 0; j <= 6; j++) { const d = cr * 0.8 + (R * 0.95 - cr * 0.8) * (j / 6), o = j && j < 6 ? rand(-7, 7) : 0; pts.push([bx + c * d - n * o, by + n * d + c * o]); }
          for (const pass of [0, 1]) {
            g.globalAlpha = pass ? 0.95 : 0.35;
            g.strokeStyle = pass ? '#f1e6ff' : COL.void;
            g.lineWidth = pass ? 1.2 : 4;
            g.beginPath();
            pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.stroke();
          }
        }
        solid();
        g.globalAlpha = 1;
        for (let i = 0; i < 4; i++) { const a = -T * 1.3 + (i * TAU) / 4; drawSprite(v, sprites.bossFrag, bx + Math.cos(a) * R * 1.75, by + Math.sin(a) * R * 1.75, T * 3 + i, 1); }
        add();
        for (let i = 0; i < 4; i++) { const a = -T * 1.3 + (i * TAU) / 4; drawGlow(v, 'void', bx + Math.cos(a) * R * 1.75, by + Math.sin(a) * R * 1.75, 34, 34, 0, 0.5); }
      }
      if (stun) drawGlow(v, 'void', bx, by, R * 2.6, R * 2.6, 0, 0.35 + 0.2 * Math.sin(T * 30));
      setWorld(v);
      if (boss.shield) {   // 护盾：一层紫色光膜，外面两层反向转的蜂窝弧；每座发生器连一条扭动的能量链；挨打的地方亮一下
        const R = boss.r * 1.45, ripple = Math.max(0, 1 - (S.t - (boss.shT ?? -9)) / 0.25);
        for (const e of S.enemies) {
          if (e.type !== 'pylon' || e.dead || e.host !== boss) continue;
          const dx = boss.x - e.x, dy = boss.y - e.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
          const x0 = e.x + ux * e.r * 0.8, y0 = e.y + uy * e.r * 0.8, len = L - R - e.r * 0.8;
          if (len <= 0) continue;
          for (const pass of [0, 1]) {
            g.lineWidth = pass ? 1.3 : 5;
            g.globalAlpha = pass ? 0.9 : 0.22;
            g.strokeStyle = pass ? '#f1e6ff' : COL.void;
            g.beginPath();
            for (let j = 0; j <= 12; j++) {
              const q = j / 12, w = Math.sin(q * Math.PI) * Math.sin(T * 14 + j * 1.3 + e.ph) * 5;
              g.lineTo(x0 + ux * len * q - uy * w, y0 + uy * len * q + ux * w);
            }
            g.stroke();
          }
        }
        drawGlow(v, 'void', boss.x, boss.y, R * 2.6, R * 2.6, 0, 0.28 + 0.25 * ripple);
        setWorld(v);
        g.strokeStyle = COL.void;
        g.lineWidth = 2;
        g.globalAlpha = 0.65 + 0.2 * Math.sin(T * 6);
        g.beginPath(); g.arc(boss.x, boss.y, R, 0, TAU); g.stroke();
        g.lineWidth = 1.2;
        g.globalAlpha = 0.45;
        g.beginPath();
        for (let i = 0; i < 12; i++) { const a = T * 0.5 + (i * TAU) / 12; g.moveTo(boss.x + Math.cos(a) * R * 0.9, boss.y + Math.sin(a) * R * 0.9); g.arc(boss.x, boss.y, R * 0.9, a, a + 0.36); }
        for (let i = 0; i < 8; i++) { const a = -T * 0.8 + (i * TAU) / 8; g.moveTo(boss.x + Math.cos(a) * R * 1.08, boss.y + Math.sin(a) * R * 1.08); g.arc(boss.x, boss.y, R * 1.08, a, a + 0.3); }
        g.stroke();
        if (ripple > 0) { g.globalAlpha = ripple; g.lineWidth = 3.5; g.strokeStyle = '#f1e6ff'; g.beginPath(); g.arc(boss.x, boss.y, R, boss.shA - 0.5, boss.shA + 0.5); g.stroke(); }
      }
      g.globalAlpha = 1;
      solid();
    }
    if (main) {   // 黑洞透镜在敌人画完、敌弹和玩家画之前做：背景和敌人被拉弯，子弹和自己的位置不受影响
      if (S.holes.length) { drawLens(v, T); solid(); }
      setWorld(v);
      for (const e of S.enemies) {   // 精英和护盾发生器头上的血条
        if (!(e.elite || e.type === 'pylon') || e.dead) continue;
        const w = e.elite ? 44 : 30;
        g.fillStyle = e.elite ? COL.danger : COL.void;
        g.globalAlpha = 0.25;
        g.fillRect(e.x - w / 2, e.y - e.r - 16, w, 3);
        g.globalAlpha = 1;
        g.fillRect(e.x - w / 2, e.y - e.r - 16, w * Math.max(0, e.hp / e.maxHp), 3);
      }
    }

    add();
    for (const b of S.ebullets) {
      if (!vis(b.x, b.y)) continue;
      drawGlow(v, 'danger', b.x, b.y, b.r * 6, b.r * 6, 0, 0.6);
      drawSprite(v, sprites[b.spr], b.x, b.y);
    }
    g.globalAlpha = 1;

    const M = CONFIG.meteor;
    for (const m of S.meteors) {   // 陨石：落点一个往里收的准星 + 走满一圈就砸下的倒计时弧，地上的阴影越来越大；最后 0.45 秒岩块拖着火尾斜着砸下来
      const k = m.t / M.warn;
      if (main) {
        setWorld(v);
        solid();
        g.globalAlpha = 0.4 * k;
        g.fillStyle = '#000';
        const sr = M.radius * (0.25 + 0.6 * k);
        g.beginPath(); g.ellipse(m.x + 6 * (1 - k), m.y + 4 * (1 - k), sr, sr * 0.88, 0, 0, TAU); g.fill();
        add();
        g.globalAlpha = 0.05 + 0.13 * k;
        g.fillStyle = COL.danger;
        g.beginPath(); g.arc(m.x, m.y, M.radius, 0, TAU); g.fill();
        g.strokeStyle = COL.danger;
        g.globalAlpha = 0.45 + 0.25 * Math.sin(T * 20);
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(m.x, m.y, M.radius, 0, TAU); g.stroke();
        g.globalAlpha = 0.95;
        g.lineWidth = 3;
        g.beginPath(); g.arc(m.x, m.y, M.radius + 5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, k)); g.stroke();
        const br = M.radius * (1.55 - 0.55 * k), ra = m.t * 1.8;
        g.lineWidth = 2;
        g.globalAlpha = 0.85;
        g.beginPath();
        for (let i = 0; i < 4; i++) { const a = ra + (i * Math.PI) / 2; g.moveTo(m.x + Math.cos(a - 0.22) * br, m.y + Math.sin(a - 0.22) * br); g.arc(m.x, m.y, br, a - 0.22, a + 0.22); }
        g.moveTo(m.x - 7, m.y); g.lineTo(m.x + 7, m.y);
        g.moveTo(m.x, m.y - 7); g.lineTo(m.x, m.y + 7);
        g.stroke();
      }
      if (k > 0.6) {
        const q = (k - 0.6) / 0.4, L = 460 * (1 - q), c = Math.cos(m.a), n = Math.sin(m.a), hx = m.x + c * L, hy = m.y + n * L;
        drawGlow(v, 'foe', hx + c * 70, hy + n * 70, 170, 22, m.a, 0.55);
        drawGlow(v, 'hot', hx + c * 28, hy + n * 28, 70, 9, m.a, 0.85);
        drawGlow(v, 'foe', hx, hy, 52, 52, 0, 0.85);
        if (main) {
          solid();
          drawSprite(v, sprites.rock[m.rk], hx, hy, m.rot + m.t * m.spin, 1.1);
          add();
          drawGlow(v, 'hot', hx - c * 4, hy - n * 4, 18, 18, 0, 0.6);
        }
      }
    }
    g.globalAlpha = 1;

    for (const m of S.missiles) {   // 导弹：渐细的光带尾迹 + 抖动的尾焰 + 白色弹体，弹头一颗转动的星芒
      const a = Math.atan2(m.vy, m.vx), col = m.well ? 'gold' : 'me';
      if (m.hist.length > 1) {
        setWorld(v);
        g.lineCap = 'round';
        g.strokeStyle = PCOL[col];
        for (let i = 0; i < m.hist.length - 1; i++) {
          const f = 1 - i / m.hist.length;
          g.globalAlpha = 0.6 * f;
          g.lineWidth = 3.2 * f;
          g.beginPath(); g.moveTo(m.hist[i][0], m.hist[i][1]); g.lineTo(m.hist[i + 1][0], m.hist[i + 1][1]); g.stroke();
        }
      }
      drawGlow(v, col, m.x - Math.cos(a) * 9, m.y - Math.sin(a) * 9, rand(20, 30), 8, a, 0.9);
      drawTex(v, FX('bolt', 'hot'), m.x, m.y, 16, 7, a, 1);
      drawTex(v, FX('star', col), m.x, m.y, 16, 16, T * 12, 0.7);
    }
    for (const w of S.wells) {   // 引力弹：一圈往里收的金色光环
      const k = w.t / 0.45;
      drawGlow(v, 'gold', w.x, w.y, w.r * 1.6 * (1 - k * 0.5), w.r * 1.6 * (1 - k * 0.5), 0, 0.4);
      setWorld(v);
      g.globalAlpha = 0.85;
      g.strokeStyle = '#ffd25a';
      g.lineWidth = 2;
      g.beginPath(); g.arc(w.x, w.y, Math.max(2, w.r * (1 - k)), 0, TAU); g.stroke();
    }
    for (const b of S.bombs) {   // 集束炸弹：落点一圈收紧的金色虚线，弹体沿抛物线飞过去
      if (b.t < 0) continue;
      const k = b.t / b.dur, h = b.small ? 22 : 70;
      const x = b.x0 + (b.x - b.x0) * k, y = b.y0 + (b.y - b.y0) * k - Math.sin(k * Math.PI) * h;
      if (main && !b.small) {
        setWorld(v);
        g.globalAlpha = 0.45 + 0.45 * k;
        g.strokeStyle = PCOL.gold;
        g.lineWidth = 1.4;
        g.setLineDash([4, 4]);
        g.beginPath(); g.arc(b.x, b.y, b.w.radius * (1.4 - 0.4 * k), 0, TAU); g.stroke();
        g.setLineDash([]);
      }
      drawGlow(v, 'gold', x, y, b.small ? 18 : 34, b.small ? 18 : 34, 0, 0.75);
      drawTex(v, FX('star', 'gold'), x, y, b.small ? 14 : 26, b.small ? 14 : 26, b.t * 14, 0.9);   // 转动的星芒当引信火花
      if (!b.small && Math.sin(b.t * 40) > 0) drawGlow(v, 'danger', x, y, 14, 14, 0, 1);   // 引信灯快闪
    }
    if (main) {
      const SK = CONFIG.skills.strike;
      for (const s of S.strikes) {   // 轨道轰炸瞄准：一个越收越紧的准星
        if (!s.aimed) continue;
        const k = Math.min(1, s.t / 0.3);
        drawGlow(v, 'me', s.x, s.y, SK.radius * 2 * k, SK.radius * 2 * k, 0, 0.4);
        setWorld(v);
        g.globalAlpha = 0.9;
        g.strokeStyle = COL.me;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(s.x, s.y, SK.radius * (1.6 - 0.6 * k), 0, TAU); g.stroke();
      }
    }
    if (S.shieldT > 0 && (S.shieldT > 1 || Math.sin(T * 30) > 0)) {   // 相位护盾，最后 1 秒闪烁
      drawGlow(v, 'me', p.x, p.y, 80, 80, 0, 0.4);
      setWorld(v);
      g.globalAlpha = 0.8;
      g.strokeStyle = COL.hot;
      g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 28 + Math.sin(T * 8) * 2, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;

    if (S.bullets.length) {   // 等离子弹：白芯彩晕的弹体贴图顺着飞行方向拉长，弹头一颗转动的星芒；进化后是金色
      const evo = S.evo.bolt, col = evo ? 'gold' : 'me', tex = FX('bolt', col), star = FX('star', col);
      for (const b of S.bullets) {
        const a = Math.atan2(b.vy, b.vx), c = Math.cos(a), s = Math.sin(a);
        drawTex(v, tex, b.x - c * 10, b.y - s * 10, evo ? 46 : 36, evo ? 16 : 13, a, 1);
        drawTex(v, star, b.x, b.y, evo ? 22 : 15, evo ? 22 : 15, T * 9 + b.x * 0.01, 0.75);
      }
      g.globalAlpha = 1;
    }

    if (S.lv.orbit) {   // 环绕刃：淡淡的轨道，刀刃身后一道渐细渐隐的弧形光带，刀刃本身带光晕
      const w = orbitStats(S.lv.orbit, S.evo.orbit), evo = S.evo.orbit;
      const spr = evo ? sprites.orbitEvo : sprites.orbit, col = evo ? PCOL.gold : COL.me;
      setWorld(v);
      g.globalAlpha = 0.1;
      g.strokeStyle = col;
      g.lineWidth = 1;
      g.beginPath(); g.arc(p.x, p.y, w.radius, 0, TAU); g.stroke();
      g.lineCap = 'round';
      for (let i = 0; i < w.count; i++) {
        const a0 = S.orbitA + (i * TAU) / w.count;
        for (let j = 0; j < 7; j++) {
          const f = 1 - j / 7;
          g.globalAlpha = 0.55 * f * f;
          g.lineWidth = w.hitR * 1.3 * f;
          g.beginPath(); g.arc(p.x, p.y, w.radius, a0 - (j + 1) * 0.11, a0 - j * 0.11); g.stroke();
        }
      }
      for (let i = 0; i < w.count; i++) {
        const a = S.orbitA + (i * TAU) / w.count, bx = p.x + Math.cos(a) * w.radius, by = p.y + Math.sin(a) * w.radius;
        drawGlow(v, evo ? 'gold' : 'me', bx, by, w.hitR * 4, w.hitR * 4, 0, 0.5);
        g.globalAlpha = 1;
        drawSprite(v, spr, bx, by, a + Math.PI / 2);
      }
      g.globalAlpha = 1;
    }

    const bm = S.beam;
    if (main && S.lv.laser && bm.on) {   // 激光：宽辉光 + 光柱 + 白芯，身后拖三道残影；进化后是金色。转得快，不进拖影层，免得糊成一片
      const col = bm.evo ? 'gold' : 'me';
      for (let b = 0; b < bm.n; b++) {
        for (let k = 3; k >= 0; k--) {
          const a = bm.a + (b * TAU) / bm.n - k * 0.07, c = Math.cos(a), s = Math.sin(a), mid = bm.len / 2;
          drawGlow(v, col, p.x + c * mid, p.y + s * mid, bm.len * 1.15, bm.width * (k ? 3 : 5), a, k ? 0.14 / k : 0.55);
          if (k) continue;
          setWorld(v);
          g.lineCap = 'round';
          const wob = rand(0.8, 1.2);   // 光柱粗细一直在抖
          g.globalAlpha = 0.55;
          g.strokeStyle = PCOL[col];
          g.lineWidth = bm.width * 1.4 * wob;
          g.beginPath(); g.moveTo(p.x + c * 12, p.y + s * 12); g.lineTo(p.x + c * bm.len, p.y + s * bm.len); g.stroke();
          g.globalAlpha = 1;
          g.strokeStyle = COL.hot;
          g.lineWidth = bm.width * 0.45 * wob;
          g.stroke();
          for (let i = 0; i < 6; i++) {   // 沿光束往外流的光点
            const d = (T * 700 + (i * bm.len) / 6) % bm.len;
            drawGlow(v, 'hot', p.x + c * d, p.y + s * d, 14, 6, a, 0.8);
          }
          drawGlow(v, 'hot', p.x + c * bm.len, p.y + s * bm.len, 30, 30, 0, 0.9);
          drawTex(v, FX('star', col), p.x + c * bm.len, p.y + s * bm.len, 48, 48, T * 10, 0.9);
        }
      }
      drawGlow(v, col, p.x, p.y, 54, 54, 0, 0.6);
      drawTex(v, FX('star', col), p.x, p.y, 64, 64, -T * 6, 0.8);
      g.globalAlpha = 1;
    }

    drawPlayer(v, main, T);

    if (S.zaps.length) {   // 闪电：宽光、青色电弧、白色主干三层，每帧重新抖动，沿途随机分叉
      setWorld(v);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const stroke = (pts, w, col, a) => {
        g.globalAlpha = a;
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      };
      for (const z of S.zaps) {
        const fade = z.life / 0.18, path = [z.pts[0]], forks = [];
        for (let i = 0; i < z.pts.length - 1; i++) {
          const [ax, ay] = z.pts[i], [bx, by] = z.pts[i + 1];
          const nx = -(by - ay), ny = bx - ax, len = Math.hypot(nx, ny) || 1, dir = Math.atan2(by - ay, bx - ax);
          for (let s = 1; s <= 6; s++) {
            const f = s / 6, j = s < 6 ? rand(-13, 13) : 0;
            const q = [ax + (bx - ax) * f + (nx / len) * j, ay + (by - ay) * f + (ny / len) * j];
            path.push(q);
            if (s < 6 && Math.random() < 0.2) {
              const fa = dir + rand(-1, 1), fl = rand(14, 30);
              forks.push([q, [q[0] + Math.cos(fa) * fl * 0.5 + rand(-5, 5), q[1] + Math.sin(fa) * fl * 0.5 + rand(-5, 5)], [q[0] + Math.cos(fa) * fl, q[1] + Math.sin(fa) * fl]]);
            }
          }
        }
        stroke(path, 12, COL.me, 0.12 * fade);
        stroke(path, 4.5, COL.me, 0.55 * fade);
        forks.forEach(fk => stroke(fk, 2.2, COL.me, 0.6 * fade));
        stroke(path, 1.8, COL.hot, fade);
        forks.forEach(fk => stroke(fk, 0.9, COL.hot, 0.8 * fade));
      }
      g.globalAlpha = 1;
    }

    drawParts(v);

    for (const q of S.flares) {   // 命中、爆炸、枪口的闪光：普通光晕、十字星芒、火球
      const k = 1 - q.life / q.max, s = q.s0 + (q.s1 - q.s0) * k;
      if (q.tex) drawTex(v, FX(q.tex, q.col), q.x, q.y, s, s, q.rot, q.alpha * (q.tex === 'star' ? 1 - k : (1 - k) * (1 - 0.5 * k)));
      else drawGlow(v, q.col, q.x, q.y, s, s, 0, q.alpha * (1 - k) * (1 - k));
    }
    g.globalAlpha = 1;

    if (S.chunks.length) {   // 残骸：小三角碎块，暗色机身 + 亮边，边飞边缩小
      solid();
      setWorld(v);
      g.lineWidth = 1;
      for (const pal of ['foe', 'danger', 'gold', 'me', 'void', 'rock']) {
        const P = Art.PAL[pal];
        g.beginPath();
        let any = false;
        for (const c of S.chunks) {
          if (c.pal !== pal) continue;
          const s = c.size * Math.sqrt(c.life / c.max);
          for (let i = 0; i < 3; i++) {
            const a = c.ang + (i * TAU) / 3 + (i === 1 ? 0.5 : 0);
            i ? g.lineTo(c.x + Math.cos(a) * s, c.y + Math.sin(a) * s) : g.moveTo(c.x + Math.cos(a) * s, c.y + Math.sin(a) * s);
          }
          g.closePath();
          any = true;
        }
        if (!any) continue;
        g.fillStyle = P.hi2;
        g.fill();
        g.strokeStyle = P.edge;
        g.stroke();
      }
      add();
    }

    if (main && S.texts.length) {   // 伤害数字：先放大弹出，再回到正常大小落下；暴击是金色
      solid();
      setWorld(v);
      g.textAlign = 'center';
      g.lineJoin = 'round';
      for (const t of S.texts) {
        const pop = 1 + 0.9 * clamp((t.life - (t.max - 0.1)) / 0.1, 0, 1);
        g.globalAlpha = Math.min(1, t.life * 4);
        g.font = t.big ? `800 ${Math.round(17 * pop)}px Consolas, Menlo, monospace` : `700 ${Math.round(12 * pop)}px Consolas, Menlo, monospace`;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.75)';
        g.strokeText(t.txt, t.x, t.y);
        g.fillStyle = t.big ? '#ffd25a' : 'rgba(234,255,247,0.92)';
        g.fillText(t.txt, t.x, t.y);
      }
      g.globalAlpha = 1;
    }
    add();
  }

  // 事件预警：蜂群画通道，包围圈画红圈，精英在屏幕边上给箭头
  function drawWarnings(v, T) {
    if (!S.warns.length) return;
    const g = v.g, blink = 0.45 + 0.4 * Math.sin(T * 18);
    setWorld(v);
    g.strokeStyle = COL.danger;
    for (const w of S.warns) {
      g.globalAlpha = blink;
      if (w.kind === 'swarm') {
        const dx = Math.cos(w.a), dy = Math.sin(w.a), nx = -dy, ny = dx;
        const half = ((CONFIG.events.swarmCount - 1) / 2) * CONFIG.events.swarmSpacing + 10, len = w.dist;
        g.globalAlpha = 0.07 + 0.05 * Math.sin(T * 18);   // 通道底色
        g.fillStyle = COL.danger;
        g.beginPath();
        g.moveTo(w.cx + nx * half - dx * len, w.cy + ny * half - dy * len);
        g.lineTo(w.cx + nx * half + dx * len, w.cy + ny * half + dy * len);
        g.lineTo(w.cx - nx * half + dx * len, w.cy - ny * half + dy * len);
        g.lineTo(w.cx - nx * half - dx * len, w.cy - ny * half - dy * len);
        g.closePath();
        g.fill();
        g.globalAlpha = blink;
        g.lineWidth = 1.5;
        g.beginPath();
        for (const s of [-1, 1]) {
          g.moveTo(w.cx + nx * half * s - dx * len, w.cy + ny * half * s - dy * len);
          g.lineTo(w.cx + nx * half * s + dx * len, w.cy + ny * half * s + dy * len);
        }
        g.stroke();
        g.lineWidth = 2;
        g.beginPath();
        const shift = (T * 260) % 80;
        for (let s = -len; s < len; s += 80) {   // 通道里流动的箭头
          const bx = w.cx + dx * (s + shift), by = w.cy + dy * (s + shift);
          g.moveTo(bx - dx * 14 + nx * 18, by - dy * 14 + ny * 18);
          g.lineTo(bx, by);
          g.lineTo(bx - dx * 14 - nx * 18, by - dy * 14 - ny * 18);
        }
        g.stroke();
        g.lineWidth = 3;   // 通道两条边外侧一排斜着的警示短条，顺着蜂群来的方向流
        g.beginPath();
        const sh2 = (T * 90) % 24;
        for (const k of [-1, 1]) {
          for (let q = -len; q < len; q += 24) {
            const bx = w.cx + dx * (q + sh2) + nx * half * k, by = w.cy + dy * (q + sh2) + ny * half * k;
            g.moveTo(bx, by);
            g.lineTo(bx + dx * 9 + nx * 9 * k, by + dy * 9 + ny * 9 * k);
          }
        }
        g.stroke();
      } else if (w.kind === 'ring') {
        g.lineWidth = 2;
        g.setLineDash([10, 8]);
        g.lineDashOffset = -T * 40;
        g.beginPath();
        g.arc(w.cx, w.cy, w.r, 0, TAU);
        g.stroke();
        g.setLineDash([]);
      } else if (w.kind === 'hole') {   // 黑洞落点：三条往里卷的旋臂越转越快，中间一个越收越小的圈
        const k = 1 - Math.max(0, w.until - S.t) / CONFIG.events.warn, R = CONFIG.hole.radius * 0.6;
        g.strokeStyle = COL.void;
        g.lineWidth = 2;
        g.globalAlpha = 0.5 + 0.4 * k;
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j <= 18; j++) {
            const q = j / 18, rr = R * (1 - q) + 8, a = (i * TAU) / 3 + q * 3.2 - T * (2 + 5 * k);
            j ? g.lineTo(w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr) : g.moveTo(w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr);
          }
        }
        g.stroke();
        g.setLineDash([6, 6]);
        g.lineDashOffset = T * 60;
        g.beginPath(); g.arc(w.x, w.y, CONFIG.hole.core * (2.6 - 1.6 * k), 0, TAU); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = COL.danger;
      } else if (w.kind === 'elite') {   // 精英传送门的落点：两圈反向转的虚线，越到时间收得越紧
        const k = 1 - Math.max(0, w.until - S.t) / CONFIG.events.warn;
        g.lineWidth = 2;
        g.setLineDash([8, 6]);
        g.lineDashOffset = T * 40;
        g.beginPath(); g.arc(w.x, w.y, 56 - 14 * k, 0, TAU); g.stroke();
        g.lineDashOffset = -T * 60;
        g.beginPath(); g.arc(w.x, w.y, 34 - 8 * k, 0, TAU); g.stroke();
        g.setLineDash([]);
      }
    }
    g.globalAlpha = 1;
  }

  // 屏幕外的东西（精英出生点、蜂群来向、宝箱）在屏幕边上用箭头标出来
  function drawEdgeArrows(T) {
    const marks = [];
    for (const w of S.warns) {
      if (w.kind === 'elite' || w.kind === 'hole') marks.push({ x: w.x, y: w.y, col: COL.danger, blink: true });
      if (w.kind === 'swarm') marks.push({ x: w.cx - Math.cos(w.a) * w.dist, y: w.cy - Math.sin(w.a) * w.dist, col: COL.danger, blink: true });
    }
    for (const it of S.pickups) {
      if (it.kind === 'chest') marks.push({ x: it.x, y: it.y, col: COL.foe, blink: false });
      if (it.kind === 'skill') marks.push({ x: it.x, y: it.y, col: '#ffd25a', blink: false });
    }
    for (const e of S.enemies) if (e.type === 'supply' && !e.dead) marks.push({ x: e.x, y: e.y, col: '#ffd25a', blink: true });
    if (!marks.length) return;
    const pad = 26;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.lineWidth = 2;
    for (const m of marks) {
      const sx = W / 2 + (m.x - camX) * zoomEff, sy = H / 2 + (m.y - camY) * zoomEff;
      if (sx > pad && sx < W - pad && sy > pad + 60 && sy < H - pad) continue;   // 在屏幕内就不用标
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      const kx = (W / 2 - pad) / Math.abs(Math.cos(a) || 1e-6), ky = (H / 2 - pad - 30) / Math.abs(Math.sin(a) || 1e-6);
      const kk = Math.min(kx, ky), ex = W / 2 + Math.cos(a) * kk, ey = H / 2 + 15 + Math.sin(a) * kk;
      ctx.globalAlpha = m.blink ? 0.5 + 0.5 * Math.sin(T * 18) : 0.9;
      ctx.strokeStyle = m.col;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 10, ey + Math.sin(a) * 10);
      ctx.lineTo(ex + Math.cos(a + 2.5) * 10, ey + Math.sin(a + 2.5) * 10);
      ctx.lineTo(ex + Math.cos(a - 2.5) * 10, ey + Math.sin(a - 2.5) * 10);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    const T = performance.now() / 1000;
    zoomEff = ZOOM * zoomMul * (1 + (S ? S.punch : 0));
    const sh = S ? S.shake : 0;
    const shx = sh ? rand(-sh, sh) * DPR : 0, shy = sh ? rand(-sh, sh) * DPR : 0;
    MV.k = DPR * zoomEff;
    MV.ox = canvas.width / 2 + shx - camX * MV.k;
    MV.oy = canvas.height / 2 + shy - camY * MV.k;
    TV.k = MV.k / 2;
    TV.ox = trail.width / 2 + shx / 2 - camX * TV.k;
    TV.oy = trail.height / 2 + shy / 2 - camY * TV.k;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawBackdrop();
    drawGrid(MV, S ? S.intensity : 0);
    if (!S) return;

    // 拖影层：上一帧先压暗，再叠这一帧，最后整层以 lighter 叠回主画面
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    tctx.globalAlpha = 1;
    tctx.fillStyle = 'rgba(0,0,0,0.3)';
    tctx.fillRect(0, 0, trail.width, trail.height);
    tctx.globalCompositeOperation = 'lighter';
    drawWorld(TV, false, T);
    ctx.globalCompositeOperation = 'lighter';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(trail, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    drawWorld(MV, true, T);
    ctx.globalCompositeOperation = 'source-over';
    if (S.stasisT > 0) {   // 时停：整屏蒙一层冷蓝
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, S.stasisT * 2) * 0.14;
      ctx.fillStyle = '#4aa8ff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    drawEdgeArrows(T);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (touch && state === 'play') {
      ctx.strokeStyle = 'rgba(60,255,192,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(touch.ox, touch.oy, STICK, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(touch.x, touch.y, 18, 0, TAU);
      ctx.stroke();
    }
    const p = S.p;
    const low = p.hp > 0 && p.hp / S.st.maxHp < 0.3 ? 0.25 + 0.12 * Math.sin(T * 6) : 0;
    const vig = Math.max(low, S.hurtFlash > 0 ? S.hurtFlash * 1.6 : 0);
    if (vig > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,59,59,0)');
      g.addColorStop(1, `rgba(255,59,59,${Math.min(0.5, vig)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const grip = S.holes.reduce((m, h) => Math.max(m, h.grip || 0), 0);
    if (grip > 0.05) {   // 被黑洞拽住：屏幕四周泛紫，越靠近越浓
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(176,108,255,0)');
      g.addColorStop(1, `rgba(120,60,220,${Math.min(0.55, grip * 0.7)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (S.feverT > 0) {   // 狂热：屏幕四周一圈金光，跟着鼓点一明一暗
      const F = CONFIG.fever, fade = Math.min(1, S.feverT * 2, (F.dur - S.feverT) * 4);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,210,90,0)');
      g.addColorStop(1, `rgba(255,210,90,${(0.3 + 0.3 * (S.beatT / 0.4)) * fade})`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (S.flash > 0) {   // 大事件整屏闪一下
      ctx.globalAlpha = Math.min(0.6, S.flash);
      ctx.fillStyle = S.flashCol;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function tick(dt) {
    if (state === 'play') {
      if (S.hitstop > 0) { S.hitstop -= dt; updateImpulses(dt); return; }   // 打击顿帧：逻辑停住，画面照常
      if (S.slowmo > 0) {   // 清场慢动作
        S.slowmo -= dt;
        dt *= CONFIG.massacre.slow;
        if (S.slowmo <= 0) UI.banner(`清场 ×${S.burstN}`, '', 'gold', true);
      }
      update(dt);
      updateImpulses(dt);
    } else if (state === 'dying' || state === 'outro') {
      updateFx(dt);
      updateImpulses(dt);
      S.transT -= dt;
      if (S.transT <= 0) { if (state === 'dying') afterDeath(); else endRun(true); }
    } else if (!S) {
      camX += 16 * dt;   // 主菜单背景缓慢漂移，偶尔起一圈涟漪
      camY += 7 * dt;
      menuRippleT -= dt;
      if (menuRippleT <= 0) { menuRippleT = rand(0.8, 1.8); impulse(camX + rand(-300, 300), camY + rand(-200, 200), rand(20, 45), rand(120, 220)); }
      updateImpulses(dt);
    } else {
      updateImpulses(dt);
      S.flash = Math.max(0, S.flash - dt * 2.2);   // 弹窗期间闪光和震屏照样衰减，不糊在背景上
      S.shake *= Math.exp(-9 * dt);
    }
  }

  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    tick(dt);
    render();
    requestAnimationFrame(frame);
  }

  // 自动化测试用：不依赖 requestAnimationFrame，直接推进 n 帧
  function step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) tick(dt);
    render();
  }

  // ---------- 调试工具（用过的局打 cheat 标记，不进漏斗） ----------
  function cheat(kind, value) {
    if (kind === 'god') godMode = !!value;
    if (!S || S.ended) {
      if (kind !== 'god') UI.toast('先开始一局再用');
      return;
    }
    Analytics.track('cheat', { run: S.runId, kind });
    if (kind === 'boss' && !S.bossSpawned) S.t = Math.max(S.t, R.waves * R.waveDuration - 2);
    if (kind === 'level') gainXp(S.xpNeed - S.xp);
    if (kind === 'chest') S.pending.push('chest');
    if (kind === 'supply') spawnSupply();
    if (kind === 'skill') { S.skill = value || 'nova'; UI.skill(S.skill, TOUCH); }
    if (kind === 'event') {   // value: swarm / ring / elite / hole / meteor
      const at = S.t + CONFIG.events.warn;
      S.events.push({ ev: value, at, warned: true, done: false, data: warnEvent(value, at) });
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);
  resize();
  Analytics.track('session_start', { device: matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse', w: W, h: H });
  UI.showMenu();
  requestAnimationFrame(t => { last = t; frame(t); });

  return {
    start, pick, reroll, takeAll, claimDrop, reviveWithAd, giveUp, multiplyCoins, chestMore, chestTake, useSkill, pause, resume, restart, quitToMenu, home, buy, cheat, step,
    setAutoMove(v) { autoMove = v; },
    get state() { return state; },
    get run() { return S; },
    get godMode() { return godMode; },
  };
})();
