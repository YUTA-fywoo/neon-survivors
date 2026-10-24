// 舰船美术：全部用代码画在离屏 canvas 上，船头朝 +x。
// 做法统一：深色金属机身（左上受光的渐变）+ 带辉光的霓虹描边 + 半透明舱段线 + 发光的灯和喷口。
// 敌舰另有一套细节零件：凹面板、散热格栅、铆钉、玻璃罩、喇叭喷口、能量线、警示条纹。
// 每种敌人有普通、受击闪白、精英、精英闪白四个版本。背景星云是本机生图模型画的，在 game.js 里加载。
const Art = (() => {
  const TAU = Math.PI * 2;
  const COL = CONFIG.color;
  const PAL = {
    me:     { edge: COL.me, hi: '#2f7465', hi2: '#3f917e', lo: '#04100c', lit: '#eafff7' },
    foe:    { edge: COL.foe, hi: '#7a5524', hi2: '#9a7034', lo: '#140c03', lit: '#fff1d6' },
    danger: { edge: COL.danger, hi: '#7a2626', hi2: '#9a3434', lo: '#160404', lit: '#ffe2e2' },
    hot:    { edge: COL.hot, hi: '#ffffff', hi2: '#ffffff', lo: '#7fe8c8', lit: '#ffffff' },
    gold:   { edge: '#ffd25a', hi: '#7a6420', hi2: '#9a8030', lo: '#141003', lit: '#fff6d6' },   // 补给飞船和技能舱
    void:   { edge: COL.void, hi: '#4a2a78', hi2: '#5e3896', lo: '#0b0414', lit: '#f1e6ff' },    // Boss 的护盾和护盾发生器、黑洞
    rock:   { edge: '#ff8a3c', hi: '#5a4a40', hi2: '#6a5a4e', lo: '#0c0806', lit: '#ffd9b0' },    // 陨石：灰褐岩体，边缘烧红
  };
  let K = 1;   // 精灵缩放 = DPR × 画面缩放
  // 主角四阶各自的喷口位置（翼展方向，按半径归一化），game.js 按它画尾焰
  const ENGINES = [[-0.29, 0.29], [-0.29, 0.29], [-0.34, 0, 0.34], [-0.46, -0.16, 0.16, 0.46]];

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function sheet(half) {
    const px = Math.ceil(half * 2 * K);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.setTransform(K, 0, 0, K, px / 2, px / 2);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    return { c, g, half };
  }

  // 多边形，坐标按 r 归一化；mirror 只给上半边，自动补出下半边
  function poly(g, r, pts) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * r) : g.moveTo(x * r, y * r)));
    g.closePath();
  }
  const mirror = pts => pts.concat(pts.slice().reverse().map(([x, y]) => [x, -y]));

  // 一块机身：渐变填充 + 带辉光的描边
  function plate(g, r, pal, path, opt = {}) {
    path();
    const gr = g.createRadialGradient(-r * 0.25, -r * 0.35, r * 0.05, 0, 0, r * 1.35);
    gr.addColorStop(0, opt.hi || pal.hi);
    gr.addColorStop(1, pal.lo);
    g.fillStyle = gr;
    g.fill();
    // 倒角高光：把同一条轮廓往右下错开一点再描，裁在机身里面，只剩左上边缘一道亮线
    g.save();
    path();
    g.clip();
    g.translate(r * 0.07, r * 0.09);
    path();
    g.strokeStyle = hexA(pal.lit, 0.32);
    g.lineWidth = 1.1;
    g.stroke();
    g.restore();
    g.save();
    g.shadowColor = pal.edge;
    g.shadowBlur = (opt.glow ?? 6) * K;
    g.strokeStyle = pal.edge;
    g.lineWidth = opt.w ?? 1.5;
    path();
    g.stroke();
    g.restore();
  }
  // 舱段线：细、半透明、不发光
  function seams(g, pal, fn, a = 0.45) {
    g.save();
    g.globalAlpha = a;
    g.strokeStyle = pal.edge;
    g.lineWidth = 0.8;
    g.beginPath();
    fn();
    g.stroke();
    g.restore();
  }
  // 发光部件：灯、眼、喷口
  function lamp(g, x, y, rad, pal, blur = 8) {
    g.save();
    g.shadowColor = pal.edge;
    g.shadowBlur = blur * K;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, pal.lit);
    gr.addColorStop(0.5, pal.edge);
    gr.addColorStop(1, hexA(pal.edge, 0.2));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
    g.restore();
  }

  // 凹面板：比机身暗一档，左上内缘一道暗影、右下内缘一道亮边，看起来是嵌进去的
  function inset(g, r, pal, path, a = 1) {
    g.save();
    path();
    g.fillStyle = `rgba(0,0,0,${0.34 * a})`;
    g.fill();
    g.clip();
    g.translate(-r * 0.04, -r * 0.05);
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 1.4;
    g.stroke();
    g.translate(r * 0.08, r * 0.1);
    path();
    g.strokeStyle = hexA(pal.lit, 0.22 * a);
    g.lineWidth = 0.9;
    g.stroke();
    g.restore();
  }
  // 散热格栅：黑底上一排平行短槽，槽沿长边排开
  function vents(g, x, y, w, h, n, pal) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = hexA(pal.edge, 0.6);
    g.lineWidth = 0.7;
    g.beginPath();
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      if (w >= h) { g.moveTo(x + w * t, y + h * 0.18); g.lineTo(x + w * t, y + h * 0.82); }
      else { g.moveTo(x + w * 0.18, y + h * t); g.lineTo(x + w * 0.82, y + h * t); }
    }
    g.stroke();
    g.restore();
  }
  // 铆钉：一个暗的投影点 + 一个亮点
  function rivets(g, r, pal, pts, size = 0.035) {
    const d = Math.max(0.6, size * r);
    g.save();
    for (const [x, y] of pts) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.beginPath(); g.arc(x * r + 0.4, y * r + 0.5, d, 0, TAU); g.fill();
      g.fillStyle = hexA(pal.lit, 0.7);
      g.beginPath(); g.arc(x * r, y * r, d, 0, TAU); g.fill();
    }
    g.restore();
  }
  // 玻璃罩：左上一团高光往外过渡到暗色，再加一道弧形反光
  function dome(g, x, y, rx, ry, pal) {
    g.save();
    g.translate(x, y);
    const gr = g.createRadialGradient(-rx * 0.35, -ry * 0.4, 0, 0, 0, Math.max(rx, ry));
    gr.addColorStop(0, hexA(pal.lit, 0.95));
    gr.addColorStop(0.35, hexA(pal.edge, 0.75));
    gr.addColorStop(1, hexA(pal.lo, 0.92));
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
    g.strokeStyle = hexA(pal.edge, 0.9);
    g.lineWidth = 0.8;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 0.7;
    g.beginPath(); g.ellipse(0, 0, rx * 0.7, ry * 0.62, 0, Math.PI * 1.05, Math.PI * 1.45); g.stroke();
    g.restore();
  }
  // 喇叭喷口：从 x 往后伸出 w，口里一团往里发亮的光（坐标按 r 归一化）
  function nozzle(g, r, pal, x, y, w, h) {
    plate(g, r, pal, () => poly(g, r, [[x, y - h * 0.4], [x - w, y - h * 0.55], [x - w, y + h * 0.55], [x, y + h * 0.4]]), { glow: 2, w: 0.9 });
    const gx = (x - w) * r, gy = y * r, gr = g.createRadialGradient(gx, gy, 0, gx, gy, h * 0.6 * r);
    gr.addColorStop(0, pal.lit);
    gr.addColorStop(0.5, hexA(pal.edge, 0.85));
    gr.addColorStop(1, hexA(pal.edge, 0));
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(gx, gy, h * 0.2 * r, h * 0.5 * r, 0, 0, TAU); g.fill();
  }
  // 能量线：外面一道带辉光的本色，里面一道白芯
  function strip(g, pal, fn, w = 1.1, blur = 5) {
    g.save();
    g.beginPath();
    fn();
    g.shadowColor = pal.edge;
    g.shadowBlur = blur * K;
    g.strokeStyle = pal.edge;
    g.lineWidth = w * 1.9;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = pal.lit;
    g.lineWidth = w * 0.7;
    g.stroke();
    g.restore();
  }
  // 警示条纹：裁在 path 里面画 45° 斜条
  function hazard(g, r, pal, path, a = 0.55) {
    g.save();
    path();
    g.clip();
    g.rotate(Math.PI / 4);
    g.fillStyle = hexA(pal.edge, a);
    for (let x = -2; x < 2; x += 0.18) g.fillRect(x * r, -2 * r, 0.09 * r, 4 * r);
    g.restore();
  }
  const ngon = (g, r, n, k, off = 0) => () => {
    g.beginPath();
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + off; g.lineTo(Math.cos(a) * k * r, Math.sin(a) * k * r); }
    g.closePath();
  };
  // 过一圈点画平滑闭合曲线（相邻两点的中点之间用二次曲线连），s 是整体缩放
  function smooth(g, r, pts, s = 1, begin = true) {
    const n = pts.length, m = i => pts[(i + n) % n], k = r * s;
    if (begin) g.beginPath();
    g.moveTo(((m(0)[0] + m(1)[0]) / 2) * k, ((m(0)[1] + m(1)[1]) / 2) * k);
    for (let i = 1; i <= n; i++) { const a = m(i), b = m(i + 1); g.quadraticCurveTo(a[0] * k, a[1] * k, ((a[0] + b[0]) / 2) * k, ((a[1] + b[1]) / 2) * k); }
    g.closePath();
  }
  // 一头粗一头细的带子（裂缝、溅射纹）：沿折线每个点按法线往两边让开半个宽度，拼成闭合多边形
  function taper(g, r, pts, w0, w1) {
    const L = [], Rt = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
      L.push([pts[i][0] - (dy / d) * w, pts[i][1] + (dx / d) * w]);
      Rt.push([pts[i][0] + (dy / d) * w, pts[i][1] - (dx / d) * w]);
    }
    poly(g, r, L.concat(Rt.reverse()));
  }
  // 陨石坑的形状（按 seed 固定）：不规则坑沿、十六道溅射纹、散落的碎石、六道带分叉的裂缝、坑底几团熔岩
  function craterGeo(seed) {
    let q = seed * 7919 + 17;
    const rnd = () => ((q = (q * 9301 + 49297) % 233280) / 233280);
    const rim = [], rays = [], rocks = [], cracks = [], pool = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, d = 0.95 + rnd() * 0.1; rim.push([Math.cos(a) * d, Math.sin(a) * d]); }
    for (let i = 0; i < 22; i++) rays.push({ a: (i / 22) * TAU + rand2(rnd) * 0.2, len: 1.2 + rnd() * (i % 3 ? 0.4 : 0.75), w: 0.18 + rnd() * 0.24, bend: rand2(rnd) * 0.16 });
    for (let i = 0; i < 14; i++) {
      const a = rnd() * TAU, d = 1.0 + rnd() * 0.75;
      rocks.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: (0.035 + rnd() * 0.05) * (1.9 - d * 0.6), rot: rnd() * TAU, n: 5 + ((rnd() * 3) | 0) });
    }
    for (let i = 0; i < 6; i++) {
      let a = (i / 6) * TAU + rand2(rnd) * 0.4, d = 0.2 + rnd() * 0.1;
      const end = 0.95 + rnd() * 0.45, pts = [[Math.cos(a) * d, Math.sin(a) * d]];
      for (let k = 0; k < 9; k++) { d += (end - d) / (9 - k); a += rand2(rnd) * 0.16; pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
      cracks.push({ pts, w: 0.05 + rnd() * 0.03 });
      if (rnd() < 0.7) {
        const [bx, by] = pts[3 + ((rnd() * 3) | 0)], bp = [[bx, by]];
        let ba = Math.atan2(by, bx) + (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.3), bd = Math.hypot(bx, by);
        for (let k = 0; k < 4; k++) { bd += 0.07 + rnd() * 0.04; ba += rand2(rnd) * 0.15; bp.push([Math.cos(ba) * bd, Math.sin(ba) * bd]); }
        cracks.push({ pts: bp, w: 0.03 });
      }
    }
    for (let i = 0; i < 4; i++) { const a = rnd() * TAU, d = rnd() * 0.12; pool.push([Math.cos(a) * d, Math.sin(a) * d, 0.16 + rnd() * 0.12]); }
    return { rim, rays, rocks, cracks, pool };
  }
  // 陨石坑分两张：冷的底图（正常叠加，压暗地面）和热的发光层（lighter 叠加，game.js 里随时间冷却）。光从左上来
  function craterArt(g, r, pal, seed, hot) {
    const G = craterGeo(seed);
    if (hot) {
      for (const [x, y, rr] of G.pool) {   // 坑底熔岩：几团叠在一起的亮斑
        const gr = g.createRadialGradient(x * r, y * r, 0, x * r, y * r, rr * r * 1.8);
        gr.addColorStop(0, 'rgba(255,244,214,0.9)');
        gr.addColorStop(0.3, 'rgba(255,176,80,0.7)');
        gr.addColorStop(0.65, 'rgba(255,90,30,0.28)');
        gr.addColorStop(1, 'rgba(255,60,20,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(x * r, y * r, rr * r * 1.8, 0, TAU); g.fill();
      }
      g.save();   // 裂缝里的岩浆：一层带辉光的橙色，里面一道白热细芯
      g.shadowColor = pal.edge;
      g.shadowBlur = 8 * K;
      g.fillStyle = hexA(pal.edge, 0.85);
      for (const c of G.cracks) { taper(g, r, c.pts, c.w * 1.4, 0.006); g.fill(); }
      g.restore();
      g.fillStyle = '#ffe6b8';
      for (const c of G.cracks) { taper(g, r, c.pts, c.w * 0.5, 0); g.fill(); }
      g.save();   // 坑沿内侧一圈余烬，坑沿上零星几颗火星
      g.shadowColor = pal.edge;
      g.shadowBlur = 6 * K;
      g.strokeStyle = hexA(pal.edge, 0.5);
      g.lineWidth = 1.4;
      smooth(g, r, G.rim, 0.8);
      g.stroke();
      g.restore();
      G.rim.forEach(([x, y], i) => { if (i % 3 === 0) lamp(g, x * r * 0.92, y * r * 0.92, 0.022 * r * (1 + (i % 2)), pal, 4); });
      return;
    }
    let gr = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.75);   // 烧焦的地面
    gr.addColorStop(0, 'rgba(8,4,2,0.9)');
    gr.addColorStop(0.45, 'rgba(14,8,4,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, r * 1.75, 0, TAU); g.fill();
    gr = g.createRadialGradient(0, 0, r * 0.95, 0, 0, r * 1.5);   // 坑沿外一圈被砸出来的尘土
    gr.addColorStop(0, hexA(pal.hi2, 0.4));
    gr.addColorStop(1, hexA(pal.hi, 0));
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, r * 1.5, 0, TAU); g.fill();
    for (const y of G.rays) {   // 溅射纹：从坑沿往外喷的尘土，根部宽、末端尖，越远越淡
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4, d = 0.85 + (y.len - 0.85) * t, a = y.a + y.bend * t * t; pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
      const c = Math.cos(y.a), s = Math.sin(y.a), lg = g.createLinearGradient(c * 0.85 * r, s * 0.85 * r, c * y.len * r, s * y.len * r);
      lg.addColorStop(0, hexA(pal.hi2, 0.32));
      lg.addColorStop(1, hexA(pal.hi, 0));
      g.fillStyle = lg;
      taper(g, r, pts, y.w, 0);
      g.fill();
    }
    g.save();   // 坑沿：一圈隆起的岩石，中间最亮；整体左上受光、右下背光
    smooth(g, r, G.rim, 1.12);
    smooth(g, r, G.rim, 0.8, false);
    gr = g.createRadialGradient(0, 0, r * 0.78, 0, 0, r * 1.16);
    gr.addColorStop(0, '#120c08');
    gr.addColorStop(0.45, pal.hi2);
    gr.addColorStop(1, '#1a120c');
    g.fillStyle = gr;
    g.fill('evenodd');
    g.clip('evenodd');
    let lg = g.createLinearGradient(-r, -r, r, r);
    lg.addColorStop(0, hexA(pal.lit, 0.3));
    lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = lg;
    g.fillRect(-1.2 * r, -1.2 * r, 2.4 * r, 2.4 * r);
    g.restore();
    g.save();   // 坑底：往下凹，所以反过来——左上内壁背光、右下内壁受光；中间一圈台阶
    smooth(g, r, G.rim, 0.82);
    gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.85);
    gr.addColorStop(0, '#050302');
    gr.addColorStop(0.7, '#140d08');
    gr.addColorStop(1, '#2a1d14');
    g.fillStyle = gr;
    g.fill();
    g.clip();
    lg = g.createLinearGradient(-0.8 * r, -0.8 * r, 0.8 * r, 0.8 * r);
    lg.addColorStop(0, 'rgba(0,0,0,0.6)');
    lg.addColorStop(0.55, 'rgba(0,0,0,0)');
    lg.addColorStop(1, hexA(pal.lit, 0.22));
    g.fillStyle = lg;
    g.fillRect(-r, -r, 2 * r, 2 * r);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1;
    smooth(g, r, G.rim, 0.55);
    g.stroke();
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.85)';   // 裂缝：熔岩冷掉以后剩下的深缝
    for (const c of G.cracks) { taper(g, r, c.pts, c.w * 1.6, 0); g.fill(); }
    for (const k of G.rocks) {   // 碎石：右下一块影子，岩体左上受光，一圈淡淡的烧红边
      const pts = [];
      for (let i = 0; i < k.n; i++) { const a = k.rot + (i / k.n) * TAU, d = k.s * (0.75 + 0.25 * Math.sin(i * 2.3 + k.rot)); pts.push([k.x + Math.cos(a) * d, k.y + Math.sin(a) * d]); }
      g.save();
      g.translate(k.s * 0.35 * r, k.s * 0.45 * r);
      poly(g, r, pts);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fill();
      g.restore();
      poly(g, r, pts);
      const rg = g.createRadialGradient((k.x - k.s * 0.4) * r, (k.y - k.s * 0.4) * r, 0, k.x * r, k.y * r, k.s * 1.3 * r);
      rg.addColorStop(0, pal.hi2);
      rg.addColorStop(1, pal.lo);
      g.fillStyle = rg;
      g.fill();
      g.strokeStyle = hexA(pal.edge, 0.35);
      g.lineWidth = 0.6;
      g.stroke();
    }
    g.strokeStyle = hexA(pal.edge, 0.28);   // 坑沿顶上一道冷掉的橙色细线，和整个游戏的霓虹描边呼应
    g.lineWidth = 0.9;
    smooth(g, r, G.rim, 1.0);
    g.stroke();
  }

  const DRAW = {
    // 玩家战机：后掠翼、座舱、双喷口
    player(g, r, pal) {
      plate(g, r, pal, () => { g.beginPath(); g.rect(-1.05 * r, -0.4 * r, 0.32 * r, 0.22 * r); g.rect(-1.05 * r, 0.18 * r, 0.32 * r, 0.22 * r); }, { glow: 3, w: 1 });
      plate(g, r, pal, () => poly(g, r, mirror([[1.5, 0], [0.62, -0.2], [0.12, -0.3], [-0.3, -1.0], [-0.76, -1.06], [-0.56, -0.42], [-0.9, -0.3]])), { glow: 8, w: 1.7 });
      seams(g, pal, () => {
        for (const s of [-1, 1]) {
          g.moveTo(0.12 * r, 0.3 * r * s); g.lineTo(-0.62 * r, 0.3 * r * s);
          g.moveTo(-0.3 * r, 1.0 * r * s); g.lineTo(-0.02 * r, 0.42 * r * s);
          g.moveTo(-0.48 * r, 0.72 * r * s); g.lineTo(-0.68 * r, 0.72 * r * s);
        }
        g.moveTo(-0.2 * r, 0); g.lineTo(-0.86 * r, 0);
      }, 0.6);
      const gl = g.createLinearGradient(0.08 * r, 0, 0.8 * r, 0);   // 座舱玻璃
      gl.addColorStop(0, hexA(pal.edge, 0.3));
      gl.addColorStop(0.6, hexA(pal.lit, 0.95));
      gl.addColorStop(1, hexA(pal.edge, 0.6));
      g.fillStyle = gl;
      g.beginPath();
      g.ellipse(0.44 * r, 0, 0.36 * r, 0.13 * r, 0, 0, TAU);
      g.fill();
      lamp(g, -0.74 * r, -1.02 * r, 0.16 * r, pal, 5);
      lamp(g, -0.74 * r, 1.02 * r, 0.16 * r, pal, 5);
    },
    // 主角战机按等级分四阶：侦察型（上面那架）→ 突击型 → 重装型 → 王牌型。
    // 越往后翼展越宽、喷口越多：突击型加鸭翼和翼尖炮管，重装型加后翼、背脊和三喷口，王牌型加双叉机首、四喷口、金色饰线和发光核心
    ship(g, r, pal, tier) {
      if (tier === 0) { DRAW.player(g, r, pal); return; }
      const span = [0, 1.12, 1.24, 1.34][tier], nose = [0, 1.55, 1.65, 1.72][tier];
      plate(g, r, pal, () => { g.beginPath(); for (const y of ENGINES[tier]) g.rect(-1.12 * r, (y - 0.1) * r, 0.36 * r, 0.2 * r); }, { glow: 3, w: 1 });
      if (tier >= 2) plate(g, r, pal, () => poly(g, r, mirror([[-0.42, -0.34], [-0.92, -0.95], [-1.24, -0.97], [-1.08, -0.36]])), { glow: 5, w: 1.2 });
      if (tier >= 3) plate(g, r, pal, () => { g.beginPath(); for (const s of [-1, 1]) { const p = [[1.95, 0.28], [1.25, 0.52], [0.5, 0.58], [0.62, 0.36], [1.25, 0.38]]; p.forEach(([x, y], i) => (i ? g.lineTo(x * r, y * s * r) : g.moveTo(x * r, y * s * r))); g.closePath(); } }, { glow: 6, w: 1.3 });
      plate(g, r, pal, () => poly(g, r, mirror([[0.98, -0.17], [0.68, -0.55], [0.5, -0.53], [0.58, -0.18]])), { glow: 4, w: 1.1 });
      plate(g, r, pal, () => poly(g, r, mirror([[nose, 0], [0.7, -0.21], [0.16, -0.32], [-0.3, -span], [-0.86, -span - 0.06], [-0.6, -0.44], [-0.96, -0.32]])), { glow: 8, w: 1.7 });
      plate(g, r, pal, () => { g.beginPath(); for (const s of [-1, 1]) g.rect(-0.78 * r, (s * (span + 0.03) - 0.05) * r, 1.0 * r, 0.1 * r); }, { glow: 4, w: 1 });
      if (tier >= 2) plate(g, r, pal, () => { g.beginPath(); g.rect(-0.9 * r, -0.09 * r, 1.3 * r, 0.18 * r); }, { glow: 4, w: 1, hi: pal.hi2 });
      seams(g, tier >= 3 ? PAL.gold : pal, () => {
        for (const s of [-1, 1]) {
          g.moveTo(0.14 * r, 0.31 * r * s); g.lineTo(-0.64 * r, 0.31 * r * s);
          g.moveTo(-0.3 * r, span * r * s); g.lineTo(-0.02 * r, 0.42 * r * s);
          g.moveTo(-0.5 * r, (span - 0.3) * r * s); g.lineTo(-0.74 * r, (span - 0.3) * r * s);
          if (tier >= 2) { g.moveTo(-0.6 * r, 0.62 * r * s); g.lineTo(-0.2 * r, 0.62 * r * s); }
        }
      }, tier >= 3 ? 0.85 : 0.6);
      const gl = g.createLinearGradient(0.08 * r, 0, 0.9 * r, 0);   // 座舱玻璃，越高阶越长
      gl.addColorStop(0, hexA(pal.edge, 0.3));
      gl.addColorStop(0.6, hexA(pal.lit, 0.95));
      gl.addColorStop(1, hexA(pal.edge, 0.6));
      g.fillStyle = gl;
      g.beginPath();
      g.ellipse((0.44 + tier * 0.04) * r, 0, (0.36 + tier * 0.04) * r, 0.13 * r, 0, 0, TAU);
      g.fill();
      for (const s of [-1, 1]) {
        lamp(g, 0.2 * r, s * (span + 0.03) * r, 0.12 * r, pal, 5);
        lamp(g, -0.8 * r, s * (span + 0.02) * r, 0.15 * r, pal, 5);
        if (tier >= 2) lamp(g, 0.75 * r, s * 0.4 * r, 0.1 * r, pal, 4);
      }
      if (tier >= 3) lamp(g, -0.35 * r, 0, 0.2 * r, PAL.hot, 12);
    },
    // 狂热形态：从机身里展开的光翼，根部在原点，往 +x 伸出去
    fwing(g, r, pal) {
      const pts = [[0, -0.14], [0.4, -0.24], [1.55, -0.06], [1.75, 0.08], [0.4, 0.2], [0, 0.14]];
      const gr = g.createLinearGradient(0, 0, 1.75 * r, 0);
      gr.addColorStop(0, hexA(pal.edge, 0.95));
      gr.addColorStop(0.45, hexA(pal.lit, 0.9));
      gr.addColorStop(1, hexA(pal.edge, 0.2));
      poly(g, r, pts);
      g.fillStyle = gr;
      g.save();
      g.shadowColor = pal.edge;
      g.shadowBlur = 12 * K;
      g.fill();
      g.strokeStyle = pal.edge;
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
      seams(g, { edge: pal.lit }, () => { g.moveTo(0.1 * r, 0); g.lineTo(1.5 * r, 0.02 * r); }, 0.8);
    },
    // 狂热形态：从两侧滑出来的副炮
    fpod(g, r, pal) {
      plate(g, r, pal, () => { g.beginPath(); g.rect(-0.6 * r, -0.32 * r, 1.0 * r, 0.64 * r); }, { glow: 5, w: 1.2 });
      plate(g, r, pal, () => { g.beginPath(); g.rect(0.4 * r, -0.1 * r, 0.9 * r, 0.2 * r); }, { glow: 6, w: 1 });
      lamp(g, 1.3 * r, 0, 0.16 * r, pal, 6);
    },
    // 无人机：八角装甲机体 + 四条机臂，臂端是涵道旋翼；正面一只装在玻璃罩里的眼，尾部散热格栅
    grunt(g, r, pal) {
      for (const a of [0.8, -0.8, 2.35, -2.35]) {
        g.save();
        g.rotate(a);
        plate(g, r, pal, () => poly(g, r, [[0.38, -0.14], [0.76, -0.09], [0.76, 0.09], [0.38, 0.14]]), { glow: 2, w: 1 });
        plate(g, r, pal, () => { g.beginPath(); g.arc(0.96 * r, 0, 0.28 * r, 0, TAU); g.moveTo(1.13 * r, 0); g.arc(0.96 * r, 0, 0.17 * r, 0, TAU, true); }, { glow: 4, w: 1 });
        seams(g, pal, () => { for (const b of [0.5, 2.1, 3.7, 5.3]) { g.moveTo(0.96 * r, 0); g.lineTo(0.96 * r + Math.cos(b) * 0.16 * r, Math.sin(b) * 0.16 * r); } }, 0.8);
        g.restore();
      }
      plate(g, r, pal, ngon(g, r, 8, 0.66, TAU / 16), { glow: 6 });
      inset(g, r, pal, () => { g.beginPath(); g.arc(0, 0, 0.45 * r, 0, TAU); });
      seams(g, pal, () => { for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + TAU / 16, c = Math.cos(a), n = Math.sin(a); g.moveTo(c * 0.47 * r, n * 0.47 * r); g.lineTo(c * 0.63 * r, n * 0.63 * r); } });
      vents(g, -0.42 * r, -0.17 * r, 0.16 * r, 0.34 * r, 3, pal);
      rivets(g, r, pal, [[0.5, -0.24], [0.5, 0.24], [-0.24, -0.5], [-0.24, 0.5]]);
      dome(g, 0.17 * r, 0, 0.25 * r, 0.25 * r, pal);
      lamp(g, 0.25 * r, 0, 0.11 * r, pal, 6);
    },
    // 飞梭：针形机身 + 前掠翼，翼尖带灯，双喷口，玻璃座舱，脊背一道能量线
    runner(g, r, pal) {
      for (const s of [-1, 1]) nozzle(g, r, pal, -0.6, s * 0.16, 0.26, 0.2);
      for (const s of [-1, 1]) plate(g, r, pal, () => poly(g, r, [[0.12, -0.18 * s], [0.22, -1.02 * s], [-0.04, -1.1 * s], [-0.44, -0.24 * s]]), { glow: 5, w: 1.2 });
      plate(g, r, pal, () => poly(g, r, mirror([[1.62, 0], [1.05, -0.1], [0.32, -0.22], [-0.48, -0.27], [-0.7, -0.15]])), { glow: 7, w: 1.4 });
      seams(g, pal, () => {
        g.moveTo(1.58 * r, 0); g.lineTo(1.0 * r, 0);
        for (const s of [-1, 1]) {
          g.moveTo(0.16 * r, s * 0.62 * r); g.lineTo(-0.2 * r, s * 0.56 * r);
          g.moveTo(-0.2 * r, s * 0.21 * r); g.lineTo(-0.5 * r, s * 0.21 * r);
        }
      }, 0.6);
      dome(g, 0.46 * r, 0, 0.3 * r, 0.1 * r, pal);
      strip(g, pal, () => { g.moveTo(0.05 * r, 0); g.lineTo(-0.58 * r, 0); }, 0.9, 4);
      for (const s of [-1, 1]) lamp(g, 0.14 * r, s * 1.04 * r, 0.1 * r, pal, 5);
    },
    // 装甲舰：撞角带警示条纹，主甲板嵌一块凹面板，两侧裙甲、格栅和铆钉，尾部两台大引擎；炮塔另画一张，在 game.js 里来回扫
    tank(g, r, pal) {
      for (const s of [-1, 1]) {
        const y0 = s > 0 ? 0.24 : -0.68;
        plate(g, r, pal, () => { g.beginPath(); g.rect(-1.2 * r, y0 * r, 0.44 * r, 0.44 * r); }, { glow: 3, w: 1.1 });
        vents(g, -1.12 * r, (y0 + 0.07) * r, 0.28 * r, 0.3 * r, 3, pal);
      }
      for (const s of [-1, 1]) plate(g, r, pal, () => poly(g, r, [[0.74, 0.8 * s], [-0.6, 0.92 * s], [-0.86, 0.62 * s], [0.52, 0.56 * s]]), { glow: 4, w: 1.2 });
      plate(g, r, pal, () => poly(g, r, mirror([[1.38, 0], [1.1, -0.3], [0.88, -0.66], [-0.46, -0.76], [-0.92, -0.46]])), { glow: 7, w: 1.8 });
      hazard(g, r, pal, () => poly(g, r, mirror([[1.36, 0], [1.1, -0.29], [0.95, -0.29]])), 0.5);
      inset(g, r, pal, () => poly(g, r, mirror([[0.8, 0], [0.6, -0.44], [-0.42, -0.52], [-0.68, -0.28]])));
      seams(g, pal, () => {
        g.moveTo(0.95 * r, -0.29 * r); g.lineTo(0.95 * r, 0.29 * r);
        for (const s of [-1, 1]) {
          g.moveTo(0.88 * r, 0.66 * r * s); g.lineTo(0.6 * r, 0.44 * r * s);
          g.moveTo(-0.46 * r, 0.76 * r * s); g.lineTo(-0.42 * r, 0.52 * r * s);
          g.moveTo(0.1 * r, 0.82 * r * s); g.lineTo(0.06 * r, 0.6 * r * s);
        }
      }, 0.5);
      for (const s of [-1, 1]) vents(g, -0.25 * r, (s > 0 ? 0.58 : -0.68) * r, 0.42 * r, 0.1 * r, 5, pal);
      rivets(g, r, pal, [[0.55, -0.74], [0.55, 0.74], [-0.2, -0.84], [-0.2, 0.84], [-0.62, -0.8], [-0.62, 0.8], [-0.75, -0.42], [-0.75, 0.42]]);
      for (const s of [-1, 1]) lamp(g, -1.22 * r, s * 0.46 * r, 0.12 * r, pal, 6);
    },
    // 装甲舰炮塔：八角底座 + 双管炮 + 炮口制退器
    tankT(g, r, pal) {
      for (const y of [-0.15, 0.06]) plate(g, r, pal, () => { g.beginPath(); g.rect(0.18 * r, y * r, 0.78 * r, 0.09 * r); }, { glow: 3, w: 0.9 });
      plate(g, r, pal, () => { g.beginPath(); g.rect(0.8 * r, -0.2 * r, 0.12 * r, 0.4 * r); }, { glow: 2, w: 0.9, hi: pal.hi2 });
      plate(g, r, pal, ngon(g, r, 8, 0.38, TAU / 16), { glow: 5, w: 1.3, hi: pal.hi2 });
      inset(g, r, pal, () => { g.beginPath(); g.arc(0, 0, 0.24 * r, 0, TAU); });
      seams(g, pal, () => { for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + TAU / 16, c = Math.cos(a), n = Math.sin(a); g.moveTo(c * 0.26 * r, n * 0.26 * r); g.lineTo(c * 0.36 * r, n * 0.36 * r); } }, 0.5);
      dome(g, -0.06 * r, 0, 0.12 * r, 0.12 * r, pal);
      for (const y of [-0.105, 0.105]) lamp(g, 0.98 * r, y * r, 0.05 * r, pal, 4);
    },
    // 炮艇：六边形机身 + 双轨电磁炮，炮管上三圈线圈，尾鳍，传感器罩；开火前的蓄力光在 game.js 里画
    shooter(g, r, pal) {
      for (const s of [-1, 1]) plate(g, r, pal, () => poly(g, r, [[-0.2, 0.5 * s], [-0.86, 1.08 * s], [-1.0, 0.98 * s], [-0.66, 0.38 * s]]), { glow: 4, w: 1.1 });
      for (const s of [-1, 1]) plate(g, r, pal, () => { g.beginPath(); g.rect(0.3 * r, (s > 0 ? 0.05 : -0.15) * r, 1.24 * r, 0.1 * r); }, { glow: 3, w: 1 });
      strip(g, pal, () => { g.moveTo(0.45 * r, 0); g.lineTo(1.5 * r, 0); }, 0.7, 4);
      for (const x of [0.62, 0.92, 1.22]) plate(g, r, pal, () => { g.beginPath(); g.rect(x * r, -0.21 * r, 0.09 * r, 0.42 * r); }, { glow: 2, w: 0.8, hi: pal.hi2 });
      plate(g, r, pal, () => poly(g, r, [[0.82, 0], [0.2, -0.72], [-0.32, -0.64], [-0.9, 0], [-0.32, 0.64], [0.2, 0.72]]), { glow: 7 });
      inset(g, r, pal, () => poly(g, r, [[0.52, 0], [0.1, -0.44], [-0.46, 0], [0.1, 0.44]]));
      seams(g, pal, () => { for (const s of [-1, 1]) { g.moveTo(0.2 * r, 0.72 * r * s); g.lineTo(0.1 * r, 0.44 * r * s); g.moveTo(-0.32 * r, 0.64 * r * s); g.lineTo(-0.22 * r, 0.26 * r * s); } }, 0.55);
      vents(g, -0.74 * r, -0.13 * r, 0.16 * r, 0.26 * r, 2, pal);
      rivets(g, r, pal, [[0.3, -0.52], [0.3, 0.52], [-0.45, -0.42], [-0.45, 0.42]]);
      dome(g, 0.06 * r, 0, 0.19 * r, 0.19 * r, pal);
      lamp(g, 1.56 * r, 0, 0.15 * r, pal);
    },
    // 蜂群：小型箭形突击艇，单喷口，机首一道能量线
    dart(g, r, pal) {
      nozzle(g, r, pal, -0.36, 0, 0.3, 0.36);
      plate(g, r, pal, () => poly(g, r, mirror([[1.5, 0], [0.22, -0.34], [-0.52, -1.0], [-0.74, -0.88], [-0.32, -0.26], [-0.46, -0.13]])), { glow: 6 });
      inset(g, r, pal, () => poly(g, r, mirror([[0.95, 0], [0.18, -0.15], [-0.22, -0.1]])));
      seams(g, pal, () => { for (const s of [-1, 1]) { g.moveTo(0.1 * r, s * 0.4 * r); g.lineTo(-0.5 * r, s * 0.9 * r); } }, 0.55);
      strip(g, pal, () => { g.moveTo(1.2 * r, 0); g.lineTo(0.35 * r, 0); }, 0.8, 4);
      for (const s of [-1, 1]) lamp(g, -0.6 * r, s * 0.92 * r, 0.08 * r, pal, 4);
    },
    // 浮雷：球形雷体 + 八根尖刺（刺尖一点灯），经纬两道装甲带，一圈明暗相间的警示环，中间一盏警示灯
    wall(g, r, pal) {
      for (let k = 0; k < 8; k++) {
        g.save();
        g.rotate((k / 8) * TAU);
        plate(g, r, pal, () => poly(g, r, [[0.5, -0.17], [1.16, -0.045], [1.16, 0.045], [0.5, 0.17]]), { glow: 3, w: 1 });
        lamp(g, 1.18 * r, 0, 0.07 * r, pal, 4);
        g.restore();
      }
      plate(g, r, pal, () => { g.beginPath(); g.arc(0, 0, 0.72 * r, 0, TAU); }, { glow: 6 });
      seams(g, pal, () => { g.ellipse(0, 0, 0.72 * r, 0.26 * r, 0, 0, TAU); g.moveTo(0.26 * r, 0); g.ellipse(0, 0, 0.26 * r, 0.72 * r, 0, 0, TAU); }, 0.4);
      g.save();
      g.lineWidth = 0.13 * r;
      for (let k = 0; k < 8; k++) {
        g.strokeStyle = k % 2 ? hexA(pal.edge, 0.85) : 'rgba(0,0,0,0.6)';
        g.beginPath(); g.arc(0, 0, 0.5 * r, (k / 8) * TAU + 0.04, ((k + 1) / 8) * TAU - 0.04); g.stroke();
      }
      g.restore();
      inset(g, r, pal, () => { g.beginPath(); g.arc(0, 0, 0.36 * r, 0, TAU); });
      rivets(g, r, pal, [[0.63, 0], [-0.63, 0], [0, 0.63], [0, -0.63]]);
      lamp(g, 0, 0, 0.22 * r, pal);
    },
    // 虚空核心，三个阶段三种轮廓（中央核心在 game.js 里实时画）：
    // 0 要塞：四门双管主炮、八块外装甲、八块内装甲，虹膜六片叶片全闭，核心只从缝里透光；
    // 1 刃环：外装甲和主炮崩飞，内装甲上长出六片弯刀，刀刃一道紫色能量，虹膜半开露出核心；
    // 2 裸核：只剩三只紫色钩爪和一圈断开的红色框架，中间整个空出来，给实时画的大核心
    boss(g, r, pal, stage = 0) {
      const V = PAL.void;
      const seg = (ro, ri, b0, b1) => () => { g.beginPath(); g.arc(0, 0, ro * r, b0, b1); g.arc(0, 0, ri * r, b1, b0, true); g.closePath(); };
      if (stage === 0) {
        for (let i = 0; i < 4; i++) { g.save(); g.rotate((i * TAU) / 4 + TAU / 8); DRAW.bossGun(g, r, pal); g.restore(); }
        for (let i = 0; i < 8; i++) { g.save(); g.rotate((i / 8) * TAU + TAU / 16); DRAW.bossPlate(g, r, pal); g.restore(); }
      }
      if (stage === 1) for (let i = 0; i < 6; i++) { g.save(); g.rotate((i * TAU) / 6); DRAW.bossBlade(g, r, pal); g.restore(); }
      if (stage === 2) {
        for (let i = 0; i < 3; i++) {   // 框架：三段断开的弧，断口露出导能管
          const b0 = (i * TAU) / 3 + 0.42, b1 = ((i + 1) * TAU) / 3 - 0.42;
          plate(g, r, pal, seg(0.6, 0.44, b0, b1), { glow: 5, w: 1.3 });
          inset(g, r, pal, seg(0.56, 0.48, b0 + 0.1, b1 - 0.1));
          strip(g, V, () => { g.arc(0, 0, 0.52 * r, b0 - 0.3, b0 + 0.02); g.moveTo(Math.cos(b1 - 0.02) * 0.52 * r, Math.sin(b1 - 0.02) * 0.52 * r); g.arc(0, 0, 0.52 * r, b1 - 0.02, b1 + 0.3); }, 1.2, 8);
        }
        for (let i = 0; i < 3; i++) { g.save(); g.rotate((i * TAU) / 3); DRAW.bossClaw(g, r, V); g.restore(); }
        return;
      }
      for (let i = 0; i < 8; i++) {   // 内装甲：二阶段崩掉两块，露出导能管
        const b0 = (i / 8) * TAU + TAU / 16 + 0.05, b1 = ((i + 1) / 8) * TAU + TAU / 16 - 0.05;
        if (stage === 1 && (i === 2 || i === 6)) { strip(g, V, () => { g.arc(0, 0, 0.67 * r, b0 + 0.08, b1 - 0.08); }, 1.3, 8); continue; }
        plate(g, r, pal, seg(0.76, 0.58, b0, b1), { glow: 5, w: 1.3, hi: pal.hi2 });
        if (stage === 0) inset(g, r, pal, seg(0.72, 0.62, b0 + 0.1, b1 - 0.1));
      }
      // 虹膜：外框 + 六片叠在一起的叶片；open 越大叶尖离中心越远，中间留出的洞越大
      const open = stage === 0 ? 0 : 0.9, hole = 0.03 + open * 0.3, rc = Math.max(0.22, hole + 0.12);
      plate(g, r, pal, () => { g.beginPath(); g.arc(0, 0, 0.56 * r, 0, TAU); g.arc(0, 0, 0.47 * r, TAU, 0, true); }, { glow: 3, w: 1.1 });
      for (let i = 0; i < 6; i++) {
        g.save();
        g.rotate((i * TAU) / 6 + open * 0.9);
        const a1 = 1.25, a2 = 2.1 + open * 0.4;
        plate(g, r, pal, () => {
          g.beginPath();
          g.moveTo(0.48 * r, 0);
          g.arc(0, 0, 0.48 * r, 0, a1);
          g.quadraticCurveTo(Math.cos(a1 + 0.5) * 0.3 * r, Math.sin(a1 + 0.5) * 0.3 * r, Math.cos(a2) * hole * r, Math.sin(a2) * hole * r);
          g.quadraticCurveTo(Math.cos(0.4) * rc * r, Math.sin(0.4) * rc * r, 0.48 * r, 0);
          g.closePath();
        }, { glow: 2, w: 0.8, hi: i % 2 ? pal.hi : pal.hi2 });
        g.restore();
      }
      rivets(g, r, pal, [0, 1, 2, 3, 4, 5].map(i => [Math.cos((i / 6) * TAU) * 0.515, Math.sin((i / 6) * TAU) * 0.515]), 0.025);
    },
    // Boss 的零件，阶段转换时单独飞出去当残骸用，所以各自画成一张：主炮、外装甲块、弯刀、钩爪、绕核心转的碎片
    bossGun(g, r, pal) {
      plate(g, r, pal, () => poly(g, r, [[0.9, -0.2], [1.24, -0.16], [1.24, 0.16], [0.9, 0.2]]), { glow: 4, w: 1.2 });
      for (const y of [-0.12, 0.05]) plate(g, r, pal, () => { g.beginPath(); g.rect(1.2 * r, y * r, 0.32 * r, 0.07 * r); }, { glow: 3, w: 0.9 });
      vents(g, 0.96 * r, -0.12 * r, 0.2 * r, 0.24 * r, 3, pal);
      for (const y of [-0.085, 0.085]) lamp(g, 1.54 * r, y * r, 0.045 * r, pal, 5);
    },
    bossPlate(g, r, pal) {
      const b0 = -TAU / 16 + 0.05, b1 = TAU / 16 - 0.05, seg = (ro, ri, a, b) => () => { g.beginPath(); g.arc(0, 0, ro * r, a, b); g.arc(0, 0, ri * r, b, a, true); g.closePath(); };
      plate(g, r, pal, seg(1.04, 0.78, b0, b1), { glow: 8, w: 1.8 });
      inset(g, r, pal, seg(0.97, 0.85, b0 + 0.12, b1 - 0.12));
      rivets(g, r, pal, [b0 + 0.06, b1 - 0.06].map(b => [Math.cos(b) * 0.91, Math.sin(b) * 0.91]), 0.022);
    },
    bossBlade(g, r, pal) {
      const path = () => { g.beginPath(); g.moveTo(0.5 * r, -0.2 * r); g.quadraticCurveTo(1.12 * r, -0.34 * r, 1.4 * r, 0.42 * r); g.quadraticCurveTo(1.0 * r, 0.02 * r, 0.54 * r, 0.17 * r); g.closePath(); };
      plate(g, r, pal, path, { glow: 7, w: 1.6 });
      inset(g, r, pal, () => { g.beginPath(); g.moveTo(0.62 * r, -0.12 * r); g.quadraticCurveTo(1.0 * r, -0.2 * r, 1.12 * r, 0.06 * r); g.quadraticCurveTo(0.9 * r, -0.02 * r, 0.64 * r, 0.06 * r); g.closePath(); });
      vents(g, 0.56 * r, -0.08 * r, 0.14 * r, 0.16 * r, 3, pal);
      strip(g, PAL.void, () => { g.moveTo(0.66 * r, -0.25 * r); g.quadraticCurveTo(1.12 * r, -0.3 * r, 1.36 * r, 0.36 * r); }, 1.4, 9);
      lamp(g, 1.38 * r, 0.4 * r, 0.05 * r, PAL.void, 6);
    },
    bossClaw(g, r, pal) {
      const path = () => {
        g.beginPath();
        g.moveTo(0.36 * r, -0.2 * r); g.lineTo(0.92 * r, -0.27 * r);
        g.quadraticCurveTo(1.42 * r, -0.24 * r, 1.48 * r, 0.24 * r);
        g.quadraticCurveTo(1.26 * r, -0.02 * r, 0.96 * r, 0.07 * r);
        g.lineTo(0.64 * r, 0.21 * r); g.lineTo(0.36 * r, 0.2 * r);
        g.closePath();
      };
      plate(g, r, pal, path, { glow: 9, w: 1.8 });
      inset(g, r, pal, () => poly(g, r, [[0.42, -0.12], [0.6, -0.14], [0.6, 0.12], [0.42, 0.12]]));
      inset(g, r, pal, () => poly(g, r, [[0.68, -0.17], [0.9, -0.2], [0.9, 0.04], [0.68, 0.13]]));
      seams(g, pal, () => { for (const x of [0.64, 0.94]) { g.moveTo(x * r, -0.24 * r); g.lineTo(x * r, 0.18 * r); } }, 0.7);
      rivets(g, r, pal, [[0.64, -0.2], [0.64, 0.16], [0.94, -0.23], [0.94, 0.05]], 0.025);
      strip(g, pal, () => { g.moveTo(0.4 * r, 0); g.lineTo(0.92 * r, -0.08 * r); g.quadraticCurveTo(1.3 * r, -0.12 * r, 1.42 * r, 0.16 * r); }, 1.3, 10);
      lamp(g, 1.46 * r, 0.22 * r, 0.06 * r, pal, 8);
    },
    bossFrag(g, r, pal) {
      plate(g, r, pal, () => poly(g, r, [[1, 0], [0.2, -0.55], [-0.8, -0.3], [-0.6, 0.4], [0.3, 0.6]]), { glow: 6, w: 1.2 });
      seams(g, pal, () => { g.moveTo(-0.5 * r, -0.1 * r); g.lineTo(0.6 * r, 0.1 * r); }, 0.6);
      lamp(g, 0.1 * r, 0, 0.2 * r, pal, 6);
    },
    // 护盾发生器：三片散热鳍 + 六角底座，中间一颗发光的能量晶体。Boss 每崩一层装甲就放出一圈，全打掉才破盾
    pylon(g, r, pal) {
      for (let k = 0; k < 3; k++) {
        g.save();
        g.rotate((k * TAU) / 3);
        plate(g, r, pal, () => poly(g, r, [[0.32, -0.2], [1.02, -0.12], [1.14, 0], [1.02, 0.12], [0.32, 0.2]]), { glow: 4, w: 1.1 });
        vents(g, 0.46 * r, -0.08 * r, 0.36 * r, 0.16 * r, 4, pal);
        lamp(g, 1.04 * r, 0, 0.07 * r, pal, 5);
        g.restore();
      }
      plate(g, r, pal, ngon(g, r, 6, 0.6, TAU / 12), { glow: 7, w: 1.5 });
      inset(g, r, pal, ngon(g, r, 6, 0.42, TAU / 12));
      rivets(g, r, pal, [0, 1, 2, 3, 4, 5].map(i => [Math.cos((i / 6) * TAU + TAU / 12) * 0.51, Math.sin((i / 6) * TAU + TAU / 12) * 0.51]));
      const pts = [[0, -0.36], [0.22, 0], [0, 0.36], [-0.22, 0]];
      const gr = g.createLinearGradient(-0.22 * r, -0.36 * r, 0.22 * r, 0.36 * r);
      gr.addColorStop(0, pal.lit);
      gr.addColorStop(0.5, hexA(pal.edge, 0.9));
      gr.addColorStop(1, hexA(pal.edge, 0.4));
      g.save();
      g.shadowColor = pal.edge;
      g.shadowBlur = 10 * K;
      poly(g, r, pts);
      g.fillStyle = gr;
      g.fill();
      g.restore();
      seams(g, { edge: pal.lit }, () => { g.moveTo(0, -0.36 * r); g.lineTo(0.06 * r, 0); g.lineTo(0, 0.36 * r); g.moveTo(-0.22 * r, 0); g.lineTo(0.22 * r, 0); }, 0.6);
    },
    // 补给飞船：前面一个驾驶舱，中间一根带格栅的龙骨，两排带警示条纹的货柜，尾部两台大喷口，一根天线
    supply(g, r, pal) {
      for (const s of [-1, 1]) nozzle(g, r, pal, -1.0, s * 0.2, 0.24, 0.26);
      for (const y of [-0.84, 0.5]) {
        for (const x of [-0.86, -0.4, 0.06]) {
          plate(g, r, pal, () => { g.beginPath(); g.rect(x * r, y * r, 0.4 * r, 0.34 * r); }, { glow: 3, w: 1 });
          hazard(g, r, pal, () => { g.beginPath(); g.rect((x + 0.03) * r, (y + 0.03) * r, 0.1 * r, 0.28 * r); }, 0.6);
          seams(g, pal, () => { for (const t of [0.2, 0.3]) { g.moveTo((x + t) * r, (y + 0.04) * r); g.lineTo((x + t) * r, (y + 0.3) * r); } }, 0.45);
        }
      }
      plate(g, r, pal, () => poly(g, r, mirror([[0.7, -0.14], [0.6, -0.4], [-1.0, -0.42], [-1.1, -0.2]])), { glow: 7, w: 1.6 });
      vents(g, -0.7 * r, -0.12 * r, 0.9 * r, 0.24 * r, 8, pal);
      rivets(g, r, pal, [[0.4, -0.3], [0.4, 0.3], [-0.85, -0.3], [-0.85, 0.3]]);
      plate(g, r, pal, () => poly(g, r, mirror([[1.34, 0], [1.2, -0.2], [0.9, -0.34], [0.6, -0.3], [0.56, 0]])), { glow: 6, w: 1.4, hi: pal.hi2 });
      dome(g, 1.02 * r, 0, 0.17 * r, 0.19 * r, pal);
      seams(g, pal, () => { g.moveTo(0.66 * r, -0.3 * r); g.lineTo(0.78 * r, -0.56 * r); }, 0.9);
      lamp(g, 0.78 * r, -0.58 * r, 0.06 * r, pal, 5);
    },
    // 技能舱：补给飞船掉的六角胶囊，中间一颗亮核
    pod(g, r, pal) {
      plate(g, r, pal, () => { g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + TAU / 12; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); }, { glow: 10, w: 1.6 });
      seams(g, pal, () => { g.moveTo(0.6 * r, 0); g.arc(0, 0, 0.6 * r, 0, TAU); }, 0.7);
      lamp(g, 0, 0, 0.42 * r, pal, 10);
    },
    // 经验晶体：亮色切面
    crystal(g, r, pal) {
      const pts = [[0, -1.25], [0.72, 0], [0, 1.25], [-0.72, 0]];
      const gr = g.createLinearGradient(-0.7 * r, -r, 0.7 * r, r);
      gr.addColorStop(0, pal.lit);
      gr.addColorStop(0.5, hexA(pal.edge, 0.85));
      gr.addColorStop(1, hexA(pal.edge, 0.35));
      poly(g, r, pts);
      g.fillStyle = gr;
      g.fill();
      g.save();
      g.shadowColor = pal.edge;
      g.shadowBlur = 6 * K;
      g.strokeStyle = pal.edge;
      g.lineWidth = 1;
      poly(g, r, pts);
      g.stroke();
      g.restore();
      seams(g, { edge: pal.lit }, () => { g.moveTo(0, -1.25 * r); g.lineTo(0.15 * r, 0); g.lineTo(0, 1.25 * r); g.moveTo(-0.72 * r, 0); g.lineTo(0.72 * r, 0); }, 0.6);
    },
    // 环绕刃：亮色的菱形刀片
    blade(g, r, pal) {
      const pts = [[1.15, 0], [0.1, -0.4], [-0.9, 0], [0.1, 0.4]];
      const gr = g.createLinearGradient(-r, 0, r, 0);
      gr.addColorStop(0, hexA(pal.edge, 0.2));
      gr.addColorStop(0.7, pal.lit);
      gr.addColorStop(1, pal.edge);
      poly(g, r, pts);
      g.fillStyle = gr;
      g.save();
      g.shadowColor = pal.edge;
      g.shadowBlur = 10 * K;
      g.fill();
      g.strokeStyle = pal.edge;
      g.lineWidth = 1.3;
      g.stroke();
      g.restore();
    },
    // 陨石：不规则岩块（按 seed 固定形状），几个陨坑，表面三道熔岩裂缝
    rock(g, r, pal, seed = 1) {
      let q = seed * 7919;
      const rnd = () => ((q = (q * 9301 + 49297) % 233280) / 233280);
      const pts = [];
      for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU + rnd() * 0.3, d = 0.78 + rnd() * 0.26; pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
      plate(g, r, pal, () => poly(g, r, pts), { glow: 5, w: 1.2 });
      for (let i = 0; i < 3; i++) {
        const a = rnd() * TAU, d = rnd() * 0.45, cr = 0.12 + rnd() * 0.12;
        inset(g, r, pal, () => { g.beginPath(); g.arc(Math.cos(a) * d * r, Math.sin(a) * d * r, cr * r, 0, TAU); });
      }
      strip(g, pal, () => {
        for (let i = 0; i < 3; i++) {
          let a = rnd() * TAU, d = 0.15;
          g.moveTo(Math.cos(a) * d * r, Math.sin(a) * d * r);
          for (let k = 0; k < 3; k++) { d += 0.22; a += rand2(rnd) * 0.5; g.lineTo(Math.cos(a) * d * r, Math.sin(a) * d * r); }
        }
      }, 0.7, 6);
    },
  };
  const rand2 = rnd => rnd() * 2 - 1;

  function make(kind, r, pal, arg) {
    const s = sheet(r * 1.6 + 10);
    DRAW[kind](s.g, r, pal, arg);
    return s;
  }
  // 同一张图保留形状，整体刷一层颜色：受击闪白、侧倾时的明暗面都用它
  function tint(src, fill) {
    const s = sheet(src.half);
    s.g.setTransform(1, 0, 0, 1, 0, 0);
    s.g.drawImage(src.c, 0, 0);
    s.g.globalCompositeOperation = 'source-atop';
    s.g.fillStyle = fill;
    s.g.fillRect(0, 0, s.c.width, s.c.height);
    return s;
  }
  const whiten = (src, a = 0.82) => tint(src, `rgba(255,255,255,${a})`);
  // 主角一阶一套：正常、压下去的暗面、抬起来的亮面、变身闪白
  function shipSet(tier, pal) {
    const r = CONFIG.player.radius * VIS, s = sheet(r * 2.1 + 10);
    DRAW.ship(s.g, r, pal, tier);
    return { n: s, dark: tint(s, 'rgba(0,0,0,0.6)'), lit: tint(s, 'rgba(255,255,255,0.4)'), white: tint(s, 'rgba(255,255,255,0.92)') };
  }
  // 精英：红色涂装，身后一圈暗红光晕
  function elite(kind, r) {
    const s = sheet(r * 1.6 + 10);
    const gr = s.g.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.5);
    gr.addColorStop(0, hexA(COL.danger, 0.22));
    gr.addColorStop(1, hexA(COL.danger, 0));
    s.g.fillStyle = gr;
    s.g.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
    DRAW[kind](s.g, r, PAL.danger);
    return s;
  }

  // 舰船画得比碰撞半径大 20%：手机上画面缩得小，细节才看得见；判定偏宽松，对玩家有利
  const VIS = 1.2;

  function build(scale) {
    K = scale;
    const out = {};
    const E = CONFIG.enemies, El = CONFIG.elite;
    for (const type in E) {
      const r = E[type].r * VIS;
      if (type === 'boss') {   // 三个阶段各一张：要塞、刃环、裸核。Boss 几乎一直在挨打，闪白只淡淡提亮，不然整个变白
        for (const st of [0, 1, 2]) { const k = st ? 'boss' + (st + 1) : 'boss'; out[k] = make('boss', r, PAL.danger, st); out[k + '_w'] = whiten(out[k], 0.3); }
        out.bossGun = make('bossGun', r, PAL.danger);   // 阶段转换时飞出去的残骸
        out.bossPlate = make('bossPlate', r, PAL.danger);
        out.bossBlade = make('bossBlade', r, PAL.danger);
        out.bossFrag = make('bossFrag', r * 0.16, PAL.void);
        continue;
      }
      const solo = type === 'supply' || type === 'pylon';   // 补给飞船和护盾发生器没有精英版
      out[type] = make(type, r, type === 'supply' ? PAL.gold : type === 'pylon' ? PAL.void : PAL.foe);
      out[type + '_w'] = whiten(out[type]);
      if (solo) continue;
      out[type + '_e'] = elite(type, r * El.sizeMul);
      out[type + '_ew'] = whiten(out[type + '_e']);
    }
    const tr = E.tank.r * VIS;   // 装甲舰炮塔单独一张，跟着机身一起换精英涂装和闪白
    out.tank_t = make('tankT', tr, PAL.foe);
    out.tank_t_w = whiten(out.tank_t);
    out.tank_t_e = make('tankT', tr * El.sizeMul, PAL.danger);
    out.tank_t_ew = whiten(out.tank_t_e);
    out.rock = [1, 2, 3].map(seed => make('rock', 13, PAL.rock, seed));
    const cr = CONFIG.meteor.radius * 0.88;   // 陨石坑三种形状，各一张冷底图、一张发光层
    for (const hot of [false, true]) out[hot ? 'craterHot' : 'crater'] = [1, 2, 3].map(seed => { const s = sheet(cr * 2.05); craterArt(s.g, cr, PAL.rock, seed, hot); s.r = cr; return s; });
    const pr = CONFIG.player.radius * VIS;
    out.ship = [0, 1, 2, 3].map(t => shipSet(t, PAL.me));       // 平时
    out.shipF = [0, 1, 2, 3].map(t => shipSet(t, PAL.gold));    // 狂热形态
    out.fwing = make('fwing', pr, PAL.gold);
    out.fpod = make('fpod', pr * 0.45, PAL.gold);
    out.gem1 = make('crystal', 3.6, PAL.me);
    out.gem2 = make('crystal', 5.4, PAL.me);
    out.gem3 = make('crystal', 7.4, PAL.hot);
    out.orbit = make('blade', 10, PAL.me);
    out.orbitEvo = make('blade', 17, PAL.hot);
    out.skill = make('pod', 13, PAL.gold);
    return out;
  }

  // 光晕贴图：特效全靠它叠加出辉光，跟画面缩放无关，只做一次
  const glows = {};
  function glow(col) {
    if (glows[col]) return glows[col];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hexA(col, 1));
    gr.addColorStop(0.22, hexA(col, 0.55));
    gr.addColorStop(0.55, hexA(col, 0.14));
    gr.addColorStop(1, hexA(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return (glows[col] = c);
  }

  // 武器特效贴图，同样只画一次：
  // star 十字星芒（命中、枪口、闪电端点）；ring 冲击环（亮边 + 往里渐隐）；bolt 等离子弹（白芯 + 彩色外晕，头部最亮）；fire 火球（白 → 黄 → 本色 → 橙红）
  const fxs = {};
  function fx(kind, col) {
    const key = kind + col;
    if (fxs[key]) return fxs[key];
    const c = document.createElement('canvas'), g = c.getContext('2d');
    if (kind === 'star') {
      c.width = c.height = 64;
      g.translate(32, 32);
      const core = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      core.addColorStop(0, 'rgba(255,255,255,1)');
      core.addColorStop(0.1, hexA(col, 0.9));
      core.addColorStop(0.35, hexA(col, 0.18));
      core.addColorStop(1, hexA(col, 0));
      g.fillStyle = core;
      g.fillRect(-32, -32, 64, 64);
      for (const a of [0, Math.PI / 2]) {
        g.save();
        g.rotate(a);
        const lg = g.createLinearGradient(-32, 0, 32, 0);
        lg.addColorStop(0, hexA(col, 0));
        lg.addColorStop(0.5, 'rgba(255,255,255,1)');
        lg.addColorStop(1, hexA(col, 0));
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(-32, 0); g.lineTo(0, -2.2); g.lineTo(32, 0); g.lineTo(0, 2.2);
        g.closePath();
        g.fill();
        g.restore();
      }
    } else if (kind === 'ring') {
      c.width = c.height = 128;
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, hexA(col, 0));
      gr.addColorStop(0.7, hexA(col, 0));
      gr.addColorStop(0.87, hexA(col, 0.16));
      gr.addColorStop(0.935, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.965, hexA(col, 0.45));
      gr.addColorStop(1, hexA(col, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    } else if (kind === 'bolt') {
      c.width = 64;
      c.height = 24;
      g.translate(32, 12);
      g.save();
      g.scale(1, 0.34);
      const h = g.createRadialGradient(6, 0, 0, 6, 0, 30);
      h.addColorStop(0, hexA(col, 0.95));
      h.addColorStop(0.5, hexA(col, 0.35));
      h.addColorStop(1, hexA(col, 0));
      g.fillStyle = h;
      g.fillRect(-32, -36, 64, 72);
      g.restore();
      const cg = g.createLinearGradient(-26, 0, 28, 0);
      cg.addColorStop(0, hexA(col, 0));
      cg.addColorStop(0.65, 'rgba(255,255,255,0.85)');
      cg.addColorStop(1, '#fff');
      g.fillStyle = cg;
      g.beginPath();
      g.ellipse(5, 0, 23, 3, 0, 0, TAU);
      g.fill();
    } else if (kind === 'fire') {
      c.width = c.height = 64;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,244,200,0.95)');
      gr.addColorStop(0.42, hexA(col, 0.75));
      gr.addColorStop(0.72, 'rgba(255,96,32,0.25)');
      gr.addColorStop(1, 'rgba(255,60,20,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    }
    return (fxs[key] = c);
  }

  return { build, glow, fx, PAL, VIS, ENGINES };
})();
