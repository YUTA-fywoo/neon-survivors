// 音效：全部用 WebAudio 合成，不加载音频文件。
// 页面一加载就用 OfflineAudioContext 把每个音效按配方离线渲染成几份略有差别的采样：分层（起音、低频冲击、主体、尾巴）、
// 滤波包络、软削波、调频做铃声和金属声、去谐锯齿波做和弦。播放时随机挑一份，微调音高和音量，按画面位置放到左右声道，
// 再过总线上的压缩、限幅和卷积混响。单个音效可以做得很厚，运行时只是放采样，不吃性能。
const Sfx = (() => {
  const SR = 44100;
  const PENTA = [0, 2, 4, 7, 9];
  let ac = null, bus = null, verb = null, voices = 0;
  const bank = {};   // 名字 → 渲染好的几份采样
  const lastAt = {};
  const GAP = { hit: 0.045, pickup: 0.035, shoot: 0.09, kill: 0.05, boom: 0.08, zap: 0.1, crit: 0.06, missile: 0.12, blast: 0.06, tick: 0.028, lob: 0.2, coin: 0.05, swish: 0.06 };   // 同名音效的最短间隔
  const MAX_VOICES = 32;

  function rng(seed) {   // 每份采样的随机数可复现
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 配方用的小工具。时间都从这一份采样的起点 t0 算；o.to 指定接到哪个节点（默认这一份的输出）
  function kit(c, dest, t0, r, name, D) {
    const k = { rnd: (a, b) => a + r() * (b - a) };
    if (!c.nz) {   // 2 秒白噪声，每个离线上下文建一份
      c.nz = c.createBuffer(1, SR * 2, SR);
      const d = c.nz.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const glide = (p, t, f, f1, d) => { p.setValueAtTime(f, t); if (f1) p.exponentialRampToValueAtTime(f1, t + d); };

    // 音源 → 可选滤波（频率包络 ff→ff1→ff2，可加摆动 wob）→ 音量包络（a 起音、hold 保持、指数衰减到 dur）→ 可选声像 → 输出
    function wire(src, t, o) {
      let n = src;
      const a = o.a || 0.002, h = o.hold || 0, end = t + Math.max(o.dur, a + h + 0.01);
      if (o.filt) {
        const f = c.createBiquadFilter();
        f.type = o.filt;
        f.Q.value = o.q || 0.7;
        glide(f.frequency, t, o.ff, o.ff1, o.fg || o.dur);
        if (o.ff2) f.frequency.exponentialRampToValueAtTime(o.ff2, end);
        if (o.wob) {
          const l = c.createOscillator(), lg = c.createGain();
          l.frequency.value = o.wob[0];
          lg.gain.value = o.wob[1];
          l.connect(lg);
          lg.connect(f.frequency);
          l.start(t);
          l.stop(end);
        }
        n.connect(f);
        n = f;
      }
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(o.vol, t + a);
      if (h) g.gain.setValueAtTime(o.vol, t + a + h);
      g.gain.exponentialRampToValueAtTime(1e-4, end);
      n.connect(g);
      n = g;
      if (o.pan != null && c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.setValueAtTime(o.pan, t);
        if (o.pan1 != null) p.pan.linearRampToValueAtTime(o.pan1, end);
        n.connect(p);
        n = p;
      }
      n.connect(o.to || dest);
      if (end > t0 + D + 0.001) console.warn('音效配方超出采样长度', name, +(end - t0).toFixed(3));
      return end + 0.02;
    }

    k.tone = o => {
      const t = t0 + (o.t || 0), s = c.createOscillator();
      s.type = o.type || 'sine';
      glide(s.frequency, t, o.f, o.f1, o.g || o.dur);
      if (o.det) s.detune.value = o.det;
      const end = wire(s, t, o);
      s.start(t);
      s.stop(end);
    };
    k.noise = o => {
      const t = t0 + (o.t || 0), s = c.createBufferSource();
      s.buffer = c.nz;
      s.loop = true;
      const end = wire(s, t, o);
      s.start(t, r() * 1.5);
      s.stop(end);
    };
    // 调频：调制波 = 载波 × ratio，调制深度 idx → idx1（相对载波频率）；做铃声、金属声、电弧
    k.fm = o => {
      const t = t0 + (o.t || 0), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain();
      car.type = o.type || 'sine';
      glide(car.frequency, t, o.f, o.f1, o.g || o.dur);
      glide(mod.frequency, t, o.f * o.ratio, o.f1 && o.f1 * o.ratio, o.g || o.dur);
      mg.gain.setValueAtTime(o.f * o.idx, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.5, o.f * (o.idx1 || 0)), t + (o.ig || o.dur));
      mod.connect(mg);
      mg.connect(car.frequency);
      const end = wire(car, t, o);
      car.start(t);
      mod.start(t);
      car.stop(end);
      mod.stop(end);
    };
    // 软削波：给低频加上泛音，手机小喇叭上也听得出“轰”，爆炸更有颗粒感
    k.drive = (amt, to) => {
      const w = c.createWaveShaper(), cv = new Float32Array(2048);
      for (let i = 0; i < cv.length; i++) { const x = (i / (cv.length - 1)) * 2 - 1; cv[i] = Math.tanh(x * amt) / Math.tanh(amt); }
      w.curve = cv;
      w.oversample = '2x';
      w.connect(to || dest);
      return w;
    };
    // 低频冲击：正弦快速降调，加一下起音的“哒”
    k.kick = o => {
      k.tone({ t: o.t, f: o.f || 150, f1: o.f1 || 45, g: o.g || 0.09, dur: o.dur || 0.3, vol: o.vol, a: 0.001, to: o.to });
      k.noise({ t: o.t, filt: 'highpass', ff: 2500, dur: 0.015, vol: o.vol * 0.35, a: 0.0005, to: o.to });
    };
    // 晶体铃声：调频让起音发亮、尾巴回到纯音，再叠一个更高的不谐和泛音当闪光
    k.bell = o => {
      k.fm({ ratio: 2, idx: 2.4, idx1: 0.02, ig: 0.18, ...o });
      if (o.f < 3800) k.tone({ t: o.t, f: o.f * 4.2, dur: o.dur * 0.25, vol: o.vol * 0.12, a: 0.001, pan: o.pan, to: o.to });
    };
    // 和弦长音：每个音两支去谐的锯齿波，过低通，左右分开
    k.pad = (fs, o) => fs.forEach((f, i) => [-9, 9].forEach((d, j) =>
      k.tone({ type: 'sawtooth', filt: 'lowpass', ff: 1800, ff1: 500, q: 0.8, ...o, f, det: d + k.rnd(-3, 3), pan: (j ? 0.45 : -0.45) * (i % 2 ? -1 : 1), vol: o.vol / fs.length })));
    // 碎片噼啪：一串极短的带通噪声，随机散在左右
    k.grains = (n, from, to, o) => { for (let i = 0; i < n; i++) k.noise({ filt: 'bandpass', q: 1.5, ff: k.rnd(1800, 5200), dur: 0.012, a: 0.0005, ...o, t: k.rnd(from, to), pan: k.rnd(-0.6, 0.6), vol: o.vol * k.rnd(0.4, 1) }); };
    // 爆炸，s 是规模 0~1：起爆的“啪”、低频冲击、主体轰鸣、中低频翻滚、碎片噼啪
    k.boom = (s, t = 0) => {
      const sh = k.drive(1.6 + s * 2);
      k.noise({ t, filt: 'bandpass', ff: k.rnd(1800, 2800), q: 0.6, dur: 0.035 + 0.03 * s, vol: 0.8, a: 0.0005 });
      k.kick({ t, f: k.rnd(120, 150) - s * 30, f1: 48 - s * 14, g: 0.07 + 0.12 * s, dur: 0.18 + 0.5 * s, vol: 0.9, to: sh });
      k.noise({ t, filt: 'lowpass', ff: k.rnd(2400, 3400) - s * 600, ff1: 90 + 60 * (1 - s), dur: 0.25 + 0.9 * s, vol: 0.75, a: 0.002, q: 0.4, to: sh });
      k.noise({ t: t + 0.01, filt: 'bandpass', ff: 520, ff1: 120, q: 1.2, dur: 0.18 + 0.7 * s, vol: 0.5, a: 0.006 });
      k.grains(Math.round(4 + 10 * s), t + 0.02, t + 0.12 + 0.45 * s, { vol: 0.22 });
    };
    // 蓄能上扬：带通噪声往上扫 + 锯齿波往上滑，越来越响，到点戛然而止
    k.riser = o => {
      k.noise({ t: o.t, filt: 'bandpass', ff: 400, ff1: 7000, q: 2, dur: o.dur, a: o.dur * 0.85, vol: o.vol, pan: -0.3, pan1: 0.3 });
      k.tone({ t: o.t, type: 'sawtooth', f: o.f, f1: o.f1, filt: 'lowpass', ff: 300, ff1: 5000, q: 3, dur: o.dur, a: o.dur * 0.85, vol: o.vol * 0.5 });
    };
    // 闪光：五声音阶上随机几颗高音铃，散在左右
    k.sparkle = (n, from, to, vol, base) => {
      for (let i = 0; i < n; i++) {
        const st = PENTA[(r() * 5) | 0] + (r() < 0.3 ? 12 : 0);
        k.bell({ t: k.rnd(from, to), f: base * Math.pow(2, st / 12), dur: k.rnd(0.25, 0.45), vol: vol * k.rnd(0.5, 1), pan: k.rnd(-0.7, 0.7) });
      }
    };
    return k;
  }

  // 每个音效：dur 每份采样的长度（秒），n 渲染几份，gain 混音音量，jit 每次播放的随机音高幅度，wet 送混响的量，
  // low 低优先级（同时发声太多时先丢），pick 按参数选第几份，vg 每一份再乘的音量，make 配方（v 是第几份）
  const DEFS = {
    click: { dur: 0.06, n: 3, gain: 0.55, jit: 0.03, make: k => {
      // 按钮：干净的短“嗒”
      k.tone({ f: k.rnd(1700, 1900), f1: 1100, dur: 0.03, vol: 0.5, a: 0.0008 });
      k.tone({ f: 520, dur: 0.035, vol: 0.3, a: 0.0008 });
      k.noise({ filt: 'bandpass', ff: 4200, q: 2.5, dur: 0.012, vol: 0.35, a: 0.0005 });
    } },
    swish: { dur: 0.3, n: 3, gain: 0.024, jit: 0.06, make: k => {
      // 界面卡片飞入：一阵从左到右的风声
      k.noise({ filt: 'bandpass', ff: 700, ff1: 4200, q: 1.6, a: 0.09, dur: 0.26, vol: 0.6, pan: -0.5, pan1: 0.5 });
    } },
    shoot: { dur: 0.14, n: 4, gain: 0.22, jit: 0.04, wet: 0.04, low: true, make: k => {
      // 等离子弹：调频的短促“啾”往下滑，垫一点低频推力和起音的气声
      const f = k.rnd(1150, 1350);
      k.fm({ f, f1: f * 0.34, g: 0.07, ratio: 1.5, idx: 1.2, idx1: 0.1, dur: 0.09, vol: 0.5, filt: 'lowpass', ff: 5200 });
      k.tone({ f: 240, f1: 120, dur: 0.06, vol: 0.45 });
      k.noise({ filt: 'bandpass', ff: k.rnd(3000, 4200), q: 1.1, dur: 0.03, vol: 0.3, a: 0.001 });
    } },
    hit: { dur: 0.12, n: 4, gain: 0.34, jit: 0.08, wet: 0.03, low: true, make: k => {
      // 打在敌舰外壳上：短促的“咔”，一点金属回响和闷响
      k.noise({ filt: 'bandpass', ff: k.rnd(2000, 3000), ff1: 1100, q: 1.4, dur: 0.045, vol: 0.8, a: 0.0008 });
      k.fm({ f: k.rnd(850, 1150), ratio: 2.76, idx: 1.6, idx1: 0.05, dur: 0.08, vol: 0.28, a: 0.001 });
      k.tone({ f: 240, f1: 120, dur: 0.05, vol: 0.3, to: k.drive(2) });
    } },
    crit: { dur: 0.32, n: 3, gain: 0.317, jit: 0.04, wet: 0.14, make: k => {
      // 暴击：更重的一下撞击，加清亮的金属“铮”
      k.noise({ filt: 'bandpass', ff: 2600, ff1: 900, q: 1, dur: 0.06, vol: 0.8, a: 0.0008 });
      k.tone({ f: 220, f1: 80, dur: 0.1, vol: 0.7, to: k.drive(2.5) });
      k.fm({ f: k.rnd(1450, 1650), ratio: 3.5, idx: 2.6, idx1: 0.05, ig: 0.12, dur: 0.28, vol: 0.35, a: 0.001 });
      k.noise({ filt: 'highpass', ff: 7000, dur: 0.05, vol: 0.18 });
    } },
    kill: { dur: 0.5, n: 4, gain: 0.282, jit: 0.07, wet: 0.1, make: k => k.boom(0.15) },
    pickup: { dur: 0.4, n: 11, gain: 0.076, wet: 0.16, low: true, pick: step => Math.min(10, step >> 1), make: (k, v) => {
      // 捡经验：晶体铃声，连着捡沿五声音阶往上走，最多两个八度（每个音单独渲染，音色不随音高变）
      const f = 784 * Math.pow(2, (Math.floor(v / 5) * 12 + PENTA[v % 5]) / 12);
      k.bell({ f, dur: 0.32, vol: 0.6 });
      k.noise({ filt: 'highpass', ff: 6000, dur: 0.015, vol: 0.12 });
    } },
    blast: { dur: 0.7, n: 4, gain: 0.16, jit: 0.08, wet: 0.14, make: k => k.boom(0.32) },
    boom: { dur: 1.1, n: 3, gain: 0.22, jit: 0.06, wet: 0.2, make: k => k.boom(0.6) },
    bigkill: { dur: 2, n: 2, gain: 0.324, jit: 0.04, wet: 0.28, make: k => {
      // 大爆炸：两段起爆，再叠一层很长的低频滚动
      k.boom(1);
      k.boom(0.5, 0.11);
      k.noise({ filt: 'lowpass', ff: 700, ff1: 60, q: 0.5, dur: 1.8, a: 0.05, vol: 0.5, to: k.drive(2) });
    } },
    hurt: { dur: 0.45, n: 3, gain: 0.128, jit: 0.05, wet: 0.08, make: k => {
      // 主角挨打：护盾被砸的闷响，加电流的“滋”，往下沉
      const sh = k.drive(3.5);
      k.tone({ f: 230, f1: 70, g: 0.18, dur: 0.25, vol: 0.5, to: sh });
      k.fm({ f: 110, f1: 70, ratio: 1.41, idx: 6, idx1: 1, dur: 0.3, vol: 0.4, filt: 'lowpass', ff: 2600, ff1: 600, to: sh });
      k.noise({ filt: 'bandpass', ff: 1800, ff1: 500, q: 1.2, dur: 0.22, vol: 0.75 });
    } },
    pulse: { dur: 0.8, n: 2, gain: 0.285, wet: 0.24, make: k => {
      // 冲击波：低频“咚”往外推，带通噪声往下扫成“呼”
      k.kick({ f: 170, f1: 42, g: 0.16, dur: 0.45, vol: 0.9, to: k.drive(2.2) });
      k.noise({ filt: 'bandpass', ff: 2200, ff1: 220, q: 2.2, dur: 0.6, a: 0.01, vol: 0.85, pan: -0.25, pan1: 0.25 });
      k.noise({ filt: 'highpass', ff: 3000, dur: 0.25, vol: 0.15 });
    } },
    zap: { dur: 0.32, n: 4, gain: 0.14, jit: 0.07, wet: 0.1, make: k => {
      // 闪电链：调制很深的调频是电弧的“滋啦”，再撒几粒噼啪
      k.fm({ type: 'sawtooth', f: k.rnd(180, 260), f1: 120, ratio: 7.13, idx: 14, idx1: 2, dur: 0.24, vol: 0.4, filt: 'bandpass', ff: 2600, q: 0.7 });
      k.grains(7, 0, 0.2, { vol: 0.35, filt: 'highpass', ff: 3500 });
      k.tone({ f: 1800, f1: 400, dur: 0.1, vol: 0.12 });
    } },
    missile: { dur: 0.55, n: 3, gain: 0.15, jit: 0.08, wet: 0.08, low: true, make: k => {
      // 导弹出膛：一下推力的闷响，接着尾焰的“嘶”
      k.tone({ f: 160, f1: 70, dur: 0.09, vol: 0.6, to: k.drive(2) });
      k.noise({ filt: 'bandpass', ff: 900, ff1: 3200, q: 1.2, dur: 0.45, a: 0.02, vol: 0.55 });
      k.noise({ filt: 'highpass', ff: 5000, dur: 0.3, vol: 0.12 });
    } },
    lob: { dur: 0.5, n: 3, gain: 0.204, jit: 0.07, wet: 0.08, make: k => {
      // 集束炸弹抛出：迫击炮式的“通”，接一声往下落的哨音
      k.tone({ f: 280, f1: 110, g: 0.1, dur: 0.14, vol: 0.7, to: k.drive(2.2) });
      k.noise({ filt: 'lowpass', ff: 1600, ff1: 300, dur: 0.15, vol: 0.4 });
      k.tone({ t: 0.05, f: 1500, f1: 800, dur: 0.38, a: 0.06, vol: 0.08 });
    } },
    laser: { dur: 1.1, n: 2, gain: 0.049, wet: 0.14, make: k => {
      // 激光：一下充能，接着去谐锯齿波过快速摆动的低通，像能量束在抖，底下一层细的嘶声
      k.tone({ type: 'triangle', f: 300, f1: 1400, g: 0.08, dur: 0.1, vol: 0.3 });
      [110, 110, 220].forEach((f, i) => k.tone({ t: 0.04, type: 'sawtooth', f, f1: f * 1.25, g: 0.9, det: [-12, 12, 0][i], filt: 'lowpass', ff: 1600, q: 4, wob: [17, 700], a: 0.03, hold: 0.6, dur: 1, vol: 0.3, pan: [-0.4, 0.4, 0][i] }));
      k.noise({ t: 0.04, filt: 'highpass', ff: 6000, a: 0.03, hold: 0.6, dur: 1, vol: 0.07 });
    } },
    level: { dur: 1.6, n: 1, gain: 0.062, wet: 0.32, make: k => {
      // 升级：铃声琶音往上走，底下铺一层和弦，最后一点闪光
      [523, 659, 784, 1046].forEach((f, i) => k.bell({ t: i * 0.075, f, dur: 0.9, vol: 0.45, pan: [-0.3, 0.3, -0.15, 0.15][i] }));
      k.pad([262, 330, 392, 523], { t: 0.05, a: 0.04, dur: 1.3, vol: 0.35, ff: 2600, ff1: 700 });
      k.sparkle(5, 0.25, 0.6, 0.18, 1568);
    } },
    reward: { dur: 1.1, n: 1, gain: 0.063, wet: 0.32, make: k => {
      // 领到奖励：两声上行的铃，加一阵往上的闪光
      k.bell({ f: 880, dur: 0.7, vol: 0.5, pan: -0.2 });
      k.bell({ t: 0.11, f: 1318, dur: 0.8, vol: 0.5, pan: 0.2 });
      k.noise({ filt: 'bandpass', ff: 2000, ff1: 9000, q: 1.5, dur: 0.35, a: 0.2, vol: 0.18 });
      k.sparkle(4, 0.15, 0.45, 0.14, 1568);
    } },
    combo: { dur: 0.9, n: 5, gain: 0.179, wet: 0.28, pick: tier => tier, make: (k, v) => {
      // 连杀里程碑：一记和弦重音，档位越高音越高、越亮
      const root = 440 * Math.pow(2, (v * 2) / 12);
      k.pad([root, root * 1.26, root * 1.5], { a: 0.004, dur: 0.6, vol: 0.5, ff: 3500 + v * 800, ff1: 900 });
      [0, 4, 7].forEach((st, i) => k.bell({ t: i * 0.05, f: root * 2 * Math.pow(2, st / 12), dur: 0.5, vol: 0.3, pan: (i - 1) * 0.3 }));
      k.kick({ f: 140, f1: 50, dur: 0.25, vol: 0.5, to: k.drive(2) });
    } },
    warn: { dur: 0.6, n: 1, gain: 0.028, wet: 0.14, make: k => {
      // 警报：两音交替的警笛，方波过低通去掉刺耳的高频，下面垫低八度的锯齿波
      [880, 660, 880].forEach((f, i) => {
        k.tone({ t: i * 0.18, type: 'square', f, filt: 'lowpass', ff: 2400, q: 1, a: 0.006, hold: 0.09, dur: 0.16, vol: 0.4 });
        k.tone({ t: i * 0.18, type: 'sawtooth', f: f / 2, det: 6, filt: 'lowpass', ff: 1200, a: 0.006, hold: 0.09, dur: 0.16, vol: 0.25 });
      });
    } },
    chest: { dur: 1.2, n: 1, gain: 0.23, wet: 0.3, make: k => {
      // 开补给舱：两声机械锁扣，舱门泄压的“嘶”往上扬，再一阵闪光
      [0, 0.08].forEach(t => {
        k.noise({ t, filt: 'bandpass', ff: 2800, q: 3, dur: 0.03, vol: 0.6 });
        k.fm({ t, f: 600, ratio: 2.76, idx: 2, idx1: 0.05, dur: 0.06, vol: 0.25 });
      });
      k.tone({ t: 0.16, f: 110, f1: 70, dur: 0.15, vol: 0.6, to: k.drive(2) });
      k.noise({ t: 0.16, filt: 'bandpass', ff: 600, ff1: 5000, q: 1.2, dur: 0.5, a: 0.15, vol: 0.35, pan: -0.3, pan1: 0.3 });
      k.sparkle(6, 0.3, 0.7, 0.16, 1318);
    } },
    tick: { dur: 0.05, n: 3, gain: 0.6, jit: 0.05, low: true, make: k => {
      // 抽卡滚轴每过一格：清脆的“嗒”
      k.noise({ filt: 'bandpass', ff: k.rnd(4500, 5500), q: 4, dur: 0.012, vol: 0.7, a: 0.0004 });
      k.tone({ f: 2400, f1: 1600, dur: 0.018, vol: 0.3, a: 0.0005 });
    } },
    flip: { dur: 1.6, n: 4, gain: 0.085, vg: [0.91, 0.62, 0.79, 2.7], wet: 0.3, pick: rar => rar, make: (k, v) => {
      // 抽卡停下：按稀有度报音，越稀有音越多、越亮；传说再加一记重音和长和弦
      const notes = [[659], [880, 1318], [1175, 1568, 2349], [523, 659, 784, 1046, 1318]][v];
      notes.forEach((f, i) => k.bell({ t: i * 0.08, f, dur: 0.5 + v * 0.2, vol: 0.45, pan: notes.length > 1 ? (i / (notes.length - 1) - 0.5) * 0.6 : 0 }));
      if (v >= 2) k.sparkle(3 + v * 2, 0.1, 0.5 + v * 0.1, 0.14, 1568);
      if (v === 3) {
        k.kick({ f: 130, f1: 38, dur: 0.6, vol: 0.8, to: k.drive(2.4) });
        k.pad([262, 330, 392, 523], { a: 0.03, hold: 0.3, dur: 1.5, vol: 0.4, ff: 3000, ff1: 700 });
      }
    } },
    coin: { dur: 0.25, n: 4, gain: 0.028, jit: 0.03, low: true, make: k => {
      // 金币：上行四度的两声“叮”
      const f = k.rnd(1900, 2300);
      k.bell({ f, dur: 0.18, vol: 0.5 });
      k.bell({ t: 0.045, f: f * 1.335, dur: 0.2, vol: 0.45 });
    } },
    drop: { dur: 0.9, n: 1, gain: 0.031, wet: 0.3, make: k => {
      // 广告空投到达：无线电“滴滴”两声，一阵落下来的呼啸，最后一声铃
      [1046, 1568].forEach((f, i) => k.fm({ t: i * 0.11, f, ratio: 1, idx: 1.5, idx1: 0.2, a: 0.004, hold: 0.05, dur: 0.14, vol: 0.4, filt: 'lowpass', ff: 4500 }));
      k.noise({ t: 0.05, filt: 'bandpass', ff: 5000, ff1: 700, q: 1.5, dur: 0.45, a: 0.08, vol: 0.3, pan: 0.5, pan1: -0.2 });
      k.bell({ t: 0.26, f: 2093, dur: 0.6, vol: 0.3 });
    } },
    boss: { dur: 2.8, n: 1, gain: 0.117, wet: 0.38, make: k => {
      // Boss 登场 / 换阶段：低沉的号角（去谐锯齿波过共振低通，先开后合），开头一下金属重击，底下长长的低频
      const sh = k.drive(2.2);
      [55, 110, 82.4, 165].forEach((f, i) => k.tone({ type: 'sawtooth', f, det: [-10, 10, -5, 6][i], filt: 'lowpass', ff: 180, ff1: 1100, fg: 0.6, ff2: 200, q: 5, a: 0.3, hold: 0.7, dur: 2.6, vol: 0.32, pan: [-0.4, 0.4, -0.2, 0.2][i], to: sh }));
      k.fm({ f: 110, ratio: 1.41, idx: 9, idx1: 0.1, ig: 1.2, dur: 1.8, vol: 0.4, a: 0.002 });
      k.kick({ f: 120, f1: 32, g: 0.3, dur: 1.2, vol: 0.9, to: sh });
      k.noise({ filt: 'lowpass', ff: 380, q: 0.5, dur: 2.6, a: 0.4, hold: 0.6, vol: 0.4 });
    } },
    death: { dur: 2, n: 1, gain: 0.141, wet: 0.35, make: k => {
      // 主角被击毁：一记爆炸，接着像引擎断电一样往下掉
      k.boom(0.7);
      k.tone({ type: 'sawtooth', f: 520, f1: 45, g: 1.4, filt: 'lowpass', ff: 3000, ff1: 150, q: 2, a: 0.02, hold: 0.2, dur: 1.6, vol: 0.4, to: k.drive(1.8) });
      k.tone({ type: 'square', f: 260, f1: 30, g: 1.4, filt: 'lowpass', ff: 1200, ff1: 100, dur: 1.5, vol: 0.15, det: 7 });
    } },
    win: { dur: 2.6, n: 1, gain: 0.151, wet: 0.4, make: k => {
      // 通关：铃声琶音，接大三和弦长音和一片闪光
      [523, 659, 784, 1046, 1318].forEach((f, i) => k.bell({ t: i * 0.1, f, dur: 1.2, vol: 0.4, pan: i % 2 ? 0.3 : -0.3 }));
      k.pad([262, 330, 392, 523, 659], { t: 0.4, a: 0.08, hold: 0.5, dur: 2.1, vol: 0.45, ff: 3000, ff1: 800 });
      k.kick({ t: 0.4, f: 130, f1: 40, dur: 0.5, vol: 0.6, to: k.drive(2) });
      k.sparkle(8, 0.45, 1.2, 0.16, 1568);
    } },
    evo: { dur: 2.6, n: 1, gain: 0.103, wet: 0.42, make: k => {
      // 武器进化（传说）：先蓄能上扬，0.55 秒时炸开，接一串金色琶音和长和弦
      k.riser({ dur: 0.55, f: 196, f1: 784, vol: 0.4 });
      k.kick({ t: 0.55, f: 140, f1: 38, g: 0.15, dur: 0.7, vol: 0.9, to: k.drive(2.5) });
      k.noise({ t: 0.55, filt: 'highpass', ff: 3000, ff1: 1200, dur: 1.2, vol: 0.3 });
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) => k.bell({ t: 0.55 + i * 0.06, f, dur: 1, vol: 0.38, pan: i % 2 ? 0.35 : -0.35 }));
      k.pad([196, 247, 294, 392, 494], { t: 0.55, a: 0.05, hold: 0.4, dur: 1.9, vol: 0.45, ff: 3200, ff1: 700 });
      k.sparkle(8, 0.7, 1.6, 0.15, 1760);
    } },
    fever: { dur: 1.9, n: 1, gain: 0.236, wet: 0.32, make: k => {
      // 狂热：蓄力上扬 0.4 秒，炸开时一记重低音加和弦重音
      k.riser({ dur: 0.4, f: 98, f1: 392, vol: 0.45 });
      k.kick({ t: 0.4, f: 150, f1: 36, g: 0.14, dur: 0.8, vol: 1, to: k.drive(3) });
      k.pad([196, 247, 294, 392], { t: 0.4, a: 0.004, dur: 1.2, vol: 0.55, ff: 4200, ff1: 600, q: 2 });
      k.noise({ t: 0.4, filt: 'highpass', ff: 4000, ff1: 1500, dur: 1.4, vol: 0.28 });
      [392, 494, 587, 784, 988].forEach((f, i) => k.bell({ t: 0.42 + i * 0.045, f, dur: 0.6, vol: 0.25, pan: (i - 2) * 0.2 }));
    } },
    beat: { dur: 0.4, n: 2, gain: 0.22, make: k => {
      // 狂热时的鼓点：底鼓，反拍一下闭镲
      k.kick({ f: 155, f1: 48, g: 0.08, dur: 0.32, vol: 1, to: k.drive(2.5) });
      k.noise({ t: 0.2, filt: 'highpass', ff: 7500, dur: 0.045, vol: 0.18 });
    } },
    slow: { dur: 1.5, n: 1, gain: 0.258, wet: 0.5, make: k => {
      // 慢动作：像磁带放慢，音高往下掉，带通噪声往下扫，尾巴拖进混响
      [-8, 8].forEach(d => k.tone({ type: 'sawtooth', f: 420, f1: 55, g: 0.9, det: d, filt: 'lowpass', ff: 2400, ff1: 200, q: 3, a: 0.01, dur: 1.2, vol: 0.4 }));
      k.noise({ filt: 'bandpass', ff: 3000, ff1: 150, q: 2, a: 0.02, dur: 1.3, vol: 0.4 });
      k.kick({ f: 90, f1: 30, g: 0.4, dur: 0.8, vol: 0.6, to: k.drive(2) });
    } },
    morph: { dur: 1.1, n: 1, gain: 0.083, wet: 0.24, make: k => {
      // 狂热变身：几声机械锁扣，伺服电机往上转，再接一记和弦
      [0, 0.07, 0.14].forEach((t, i) => {
        k.noise({ t, filt: 'bandpass', ff: 2600 + i * 400, q: 3, dur: 0.035, vol: 0.55 });
        k.fm({ t, f: 700 + i * 120, ratio: 2.76, idx: 2, idx1: 0.05, dur: 0.07, vol: 0.22 });
      });
      k.tone({ type: 'sawtooth', f: 200, f1: 1100, g: 0.4, filt: 'lowpass', ff: 600, ff1: 4000, q: 4, a: 0.05, dur: 0.45, vol: 0.25 });
      [523, 659, 784, 1046].forEach((f, i) => k.bell({ t: 0.22 + i * 0.04, f, dur: 0.6, vol: 0.3, pan: i % 2 ? 0.3 : -0.3 }));
      k.kick({ t: 0.22, f: 140, f1: 50, dur: 0.3, vol: 0.5, to: k.drive(2) });
    } },
    unmorph: { dur: 0.5, n: 1, gain: 0.093, wet: 0.18, make: k => {
      // 变身收回：伺服往下转，两声锁扣
      k.tone({ type: 'sawtooth', f: 900, f1: 200, g: 0.35, filt: 'lowpass', ff: 3500, ff1: 500, q: 3, dur: 0.4, vol: 0.3 });
      [0.12, 0.24].forEach(t => k.noise({ t, filt: 'bandpass', ff: 2400, q: 3, dur: 0.035, vol: 0.55 }));
    } },
    // 机体进阶：先蓄能往上扬，换装那一下炸开再接一串上行琶音
    rise: { dur: 0.55, n: 1, gain: 0.023, wet: 0.2, make: k => k.riser({ dur: 0.5, f: 150, f1: 900, vol: 0.6 }) },
    upgrade: { dur: 2, n: 1, gain: 0.28, wet: 0.38, make: k => {
      k.kick({ f: 140, f1: 36, g: 0.15, dur: 0.7, vol: 1, to: k.drive(2.6) });
      k.noise({ filt: 'lowpass', ff: 5000, ff1: 300, dur: 0.6, vol: 0.4 });
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) => k.bell({ t: 0.03 + i * 0.05, f, dur: 0.9, vol: 0.35, pan: i % 2 ? 0.35 : -0.35 }));
      k.pad([196, 262, 330, 392], { t: 0.05, a: 0.05, hold: 0.3, dur: 1.8, vol: 0.4, ff: 2800, ff1: 600 });
    } },
    hole: { dur: 2.8, n: 1, gain: 0.082, wet: 0.5, make: k => {
      // 黑洞张开：极低的嗡鸣慢慢涌上来，带通噪声往下扫成被吸进去的“呼——”
      const sh = k.drive(2.5);
      [41, 41.6, 62].forEach((f, i) => k.tone({ type: 'sawtooth', f: f * 1.6, f1: f, g: 1.5, filt: 'lowpass', ff: 600, ff1: 160, q: 3, a: 0.5, hold: 0.8, dur: 2.7, vol: 0.35, pan: [-0.4, 0.4, 0][i], to: sh }));
      k.noise({ filt: 'bandpass', ff: 2600, ff1: 160, fg: 2.2, q: 3, a: 0.6, hold: 0.4, dur: 2.6, vol: 0.9, pan: 0.4, pan1: -0.4 });
      k.kick({ f: 90, f1: 28, g: 0.5, dur: 1.4, vol: 0.45, to: sh });
    } },
    skill: { dur: 1, n: 1, gain: 0.324, wet: 0.3, make: k => {
      // 放主动技能：一记冲击，一阵往上的风声，三和弦铃声往上滑
      k.kick({ f: 150, f1: 42, dur: 0.5, vol: 0.9, to: k.drive(2.4) });
      k.noise({ filt: 'bandpass', ff: 500, ff1: 6000, q: 1.2, dur: 0.4, a: 0.05, vol: 0.35 });
      [523, 784, 1046].forEach((f, i) => k.bell({ t: i * 0.05, f, f1: f * 1.5, g: 0.2, dur: 0.7, vol: 0.32, pan: (i - 1) * 0.35 }));
    } },
  };

  function rendered(c) {   // 老版 Safari 的离线渲染只有回调
    return new Promise(res => {
      c.oncomplete = e => res(e.renderedBuffer);
      const p = c.startRendering();
      if (p && p.then) p.then(res);
    });
  }

  // 一个音效的几份采样放在同一个离线上下文里依次渲染，渲染完切开，按峰值归一化，裁掉尾巴的静音
  function renderOne(OAC, name, d, seed) {
    const n = d.n, len = Math.ceil(d.dur * SR), c = new OAC(2, len * n, SR), out = c.createGain();
    out.connect(c.destination);
    const r = rng(seed * 7919 + 17);
    for (let v = 0; v < n; v++) d.make(kit(c, out, v * d.dur, r, name, d.dur), v);
    return rendered(c).then(buf => {
      const L = buf.getChannelData(0), R = buf.getChannelData(1), list = [];
      for (let v = 0; v < n; v++) {
        const a = v * len;
        let peak = 0, last = 0;
        for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[a + i]), Math.abs(R[a + i]));
        for (let i = 0; i < len; i++) if (Math.abs(L[a + i]) > peak * 1e-3 || Math.abs(R[a + i]) > peak * 1e-3) last = i;
        const m = Math.min(len, last + 64), b = c.createBuffer(2, m, SR), g = peak ? 0.9 / peak : 0;
        const bl = b.getChannelData(0), br = b.getChannelData(1);
        for (let i = 0; i < m; i++) { bl[i] = L[a + i] * g; br[i] = R[a + i] * g; }
        list.push(b);
      }
      bank[name] = list;
    });
  }

  // 页面加载后就开始渲染，按 DEFS 的顺序一个接一个（界面和战斗里最常用的排在前面）
  const ready = new Promise(res => setTimeout(res, 30)).then(() => {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return;
    return Object.keys(DEFS).reduce((p, name, i) => p.then(() => renderOne(OAC, name, DEFS[name], i + 1)), Promise.resolve());
  }).catch(e => console.warn('音效渲染失败', e));

  // 混响的冲激响应：两声道各一段指数衰减的噪声，越往后越闷（高频散得快），像一个不大的金属舱室
  function impulse(sec, decay) {
    const len = Math.round(ac.sampleRate * sec), pre = Math.round(ac.sampleRate * 0.012), b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const x = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.85 - 0.8 * x);
        d[i] = lp * Math.pow(1 - x, decay);
      }
    }
    return b;
  }

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    // 总线：切掉听不见的超低频 → 压缩（把同时响的声音粘在一起）→ 削一点刺耳的极高频 → 限幅（叠太多时不削波）→ 总音量
    const hp = ac.createBiquadFilter(), comp = ac.createDynamicsCompressor(), shelf = ac.createBiquadFilter(), lim = ac.createDynamicsCompressor(), master = ac.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 32;
    const setComp = (n, th, knee, ratio, att, rel) => { n.threshold.value = th; n.knee.value = knee; n.ratio.value = ratio; n.attack.value = att; n.release.value = rel; };
    setComp(comp, -14, 10, 3, 0.004, 0.2);
    setComp(lim, -2, 0, 20, 0.001, 0.08);
    shelf.type = 'highshelf';
    shelf.frequency.value = 9000;
    shelf.gain.value = -4;
    master.gain.value = 0.42;
    bus = ac.createGain();
    verb = ac.createConvolver();
    verb.buffer = impulse(2, 3);
    bus.connect(hp);
    verb.connect(hp);
    hp.connect(comp);
    comp.connect(shelf);
    shelf.connect(lim);
    lim.connect(master);
    master.connect(ac.destination);
  }

  // pan：-1 左 ~ 1 右，按画面位置传进来；不传就在正中
  function play(name, arg, pan) {
    if (!ac || Save.data.muted) return;
    const d = DEFS[name], list = bank[name];
    if (!list) return;   // 还没渲染完
    const now = ac.currentTime, gap = GAP[name] || 0;
    if (gap && lastAt[name] && now - lastAt[name] < gap) return;
    if (d.low && voices >= MAX_VOICES) return;   // 同时发声太多时，先丢频繁的小音效
    lastAt[name] = now;
    const s = ac.createBufferSource(), g = ac.createGain();
    const i = d.pick ? Math.max(0, Math.min(list.length - 1, d.pick(arg) | 0)) : (Math.random() * list.length) | 0;
    s.buffer = list[i];
    if (d.jit) s.playbackRate.value = 1 + (Math.random() * 2 - 1) * d.jit;
    g.gain.value = d.gain * (d.vg ? d.vg[i] : 1) * (0.9 + Math.random() * 0.2);
    s.connect(g);
    let o = g;
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-0.7, Math.min(0.7, pan));
      g.connect(p);
      o = p;
    }
    o.connect(bus);
    if (d.wet) {
      const w = ac.createGain();
      w.gain.value = d.wet;
      o.connect(w);
      w.connect(verb);
    }
    voices++;
    s.onended = () => { voices--; o.disconnect(); };
    s.start();
  }

  return { init, play, ready };
})();
