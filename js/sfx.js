// 音效：全部用 WebAudio 现场合成，不加载音频文件。
const Sfx = (() => {
  let ac = null;
  let out = null;
  const lastAt = {};
  const GAP = { hit: 0.045, pickup: 0.035, shoot: 0.09, kill: 0.05, boom: 0.08, zap: 0.1, crit: 0.06, missile: 0.12, blast: 0.06, tick: 0.028, lob: 0.2, coin: 0.05, swish: 0.06 };   // 同名音效的最短间隔

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    out = ac.createGain();
    out.gain.value = 0.22;
    out.connect(ac.destination);
  }

  function blip(f0, f1, dur, type, vol, delay = 0) {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // 白噪声过低通滤波：爆炸、撞击的“轰”和“啪”
  let noiseBuf = null;
  function noise(dur, vol, f0, f1, delay = 0) {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, Math.round(ac.sampleRate * 1.2), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    s.start(t, Math.random() * 0.3);
    s.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    shoot: () => { blip(900, 420, 0.06, 'square', 0.03); noise(0.04, 0.05, 6000, 2000); },
    hit: () => { blip(240, 90, 0.05, 'square', 0.06); noise(0.035, 0.09, 5000, 1200); },
    kill: () => { noise(0.22, 0.26, 2600, 150); blip(320, 70, 0.12, 'triangle', 0.1); },
    boom: () => { noise(0.45, 0.4, 1800, 60); blip(140, 40, 0.3, 'sine', 0.3); },
    // 连着捡经验时沿五声音阶往上走，捡得越密越高
    pickup: (step = 0) => { const n = Math.min(14, step >> 1), f = 784 * Math.pow(2, (Math.floor(n / 5) * 12 + [0, 2, 4, 7, 9][n % 5]) / 12); blip(f, f * 1.5, 0.06, 'sine', 0.07); },
    level: () => { blip(523, 523, 0.12, 'triangle', 0.2); blip(659, 659, 0.12, 'triangle', 0.2, 0.09); blip(784, 1046, 0.22, 'triangle', 0.2, 0.18); },
    hurt: () => blip(160, 60, 0.18, 'sawtooth', 0.2),
    pulse: () => blip(180, 60, 0.25, 'sine', 0.25),
    zap: () => blip(1600, 300, 0.12, 'sawtooth', 0.07),
    boss: () => { blip(110, 55, 0.8, 'sawtooth', 0.3); blip(165, 80, 0.8, 'square', 0.12, 0.1); },
    death: () => blip(300, 40, 0.6, 'sawtooth', 0.25),
    win: () => [523, 659, 784, 1046].forEach((f, i) => blip(f, f, 0.2, 'triangle', 0.2, i * 0.1)),
    reward: () => { blip(880, 1320, 0.15, 'sine', 0.2); blip(1320, 1760, 0.2, 'sine', 0.18, 0.12); },
    click: () => blip(700, 500, 0.04, 'square', 0.05),
    crit: () => blip(1400, 700, 0.07, 'square', 0.08),
    bigkill: () => { noise(0.8, 0.55, 2200, 50); blip(200, 35, 0.5, 'sawtooth', 0.22); blip(90, 30, 0.6, 'sine', 0.35); },
    // 连杀里程碑越高音越高，跟成绩挂钩
    combo: tier => [0, 4, 7].forEach((st, i) => { const f = 440 * Math.pow(2, (tier * 2 + st) / 12); blip(f, f, 0.1, 'square', 0.12, i * 0.06); }),
    warn: () => { blip(880, 880, 0.14, 'square', 0.12); blip(660, 660, 0.14, 'square', 0.12, 0.18); blip(880, 880, 0.14, 'square', 0.12, 0.36); },
    evo: () => [392, 523, 659, 784, 1046].forEach((f, i) => blip(f, f * 1.01, 0.25, 'sawtooth', 0.14, i * 0.07)),
    chest: () => { noise(0.35, 0.3, 3000, 200); blip(220, 880, 0.2, 'sawtooth', 0.12); },
    missile: () => { noise(0.25, 0.08, 1200, 4000); blip(300, 700, 0.18, 'sawtooth', 0.03); },
    blast: () => { noise(0.25, 0.2, 2400, 120); blip(200, 60, 0.15, 'sine', 0.15); },
    lob: () => { blip(500, 180, 0.3, 'triangle', 0.08); noise(0.2, 0.06, 2500, 600); },
    laser: () => { blip(160, 900, 0.9, 'sawtooth', 0.07); blip(320, 1800, 0.9, 'square', 0.025); noise(0.9, 0.08, 5000, 1500); },
    fever: () => { noise(0.6, 0.3, 6000, 400); [392, 494, 587, 784, 988].forEach((f, i) => blip(f, f, 0.18, 'square', 0.1, i * 0.05)); blip(98, 49, 0.6, 'sine', 0.35); },
    beat: () => { blip(120, 45, 0.16, 'sine', 0.3); noise(0.05, 0.05, 8000, 4000); },
    slow: () => { blip(400, 60, 0.7, 'sawtooth', 0.12); noise(0.8, 0.25, 1500, 80); },
    // 狂热变身：几声机械咔嗒 + 上扬的呼啸 + 一串和弦；收回时反过来往下走
    morph: () => { [0, 0.07, 0.14].forEach(d => noise(0.06, 0.25, 3000, 800, d)); blip(200, 1200, 0.45, 'sawtooth', 0.08); [523, 659, 784, 1046].forEach((f, i) => blip(f, f, 0.15, 'square', 0.06, 0.2 + i * 0.04)); },
    unmorph: () => { blip(900, 200, 0.35, 'sawtooth', 0.06); noise(0.08, 0.2, 2500, 600); noise(0.08, 0.2, 2500, 600, 0.1); },
    // 机体进阶：先蓄能往上扬，换装那一下炸开再接一串上行琶音
    rise: () => blip(150, 900, 0.4, 'sawtooth', 0.07),
    upgrade: () => { noise(0.5, 0.35, 5000, 200); blip(110, 55, 0.5, 'sine', 0.3); [392, 523, 659, 784, 1046, 1318].forEach((f, i) => blip(f, f, 0.22, 'triangle', 0.14, i * 0.05)); },
    hole: () => { blip(70, 30, 1.6, 'sawtooth', 0.22); noise(1.2, 0.2, 400, 60); },
    skill: () => { noise(0.5, 0.3, 4000, 300); [523, 784, 1046].forEach((f, i) => blip(f, f * 1.5, 0.25, 'square', 0.1, i * 0.05)); },
    // 抽卡：滚轴每过一格咔哒一声；停下时按稀有度报音，越稀有越长、越高
    tick: () => { blip(2600, 1500, 0.02, 'square', 0.04); noise(0.015, 0.05, 7000, 3000); },
    flip: rar => {
      if (rar >= 3) { [523, 659, 784, 1046, 1318].forEach((f, i) => blip(f, f, 0.3, 'triangle', 0.16, i * 0.07)); noise(0.6, 0.2, 6000, 800); return; }
      const f = [660, 880, 1175][rar];
      blip(f, f * 1.5, 0.12 + rar * 0.06, 'triangle', 0.14);
      if (rar >= 1) blip(f * 1.5, f * 2, 0.16, 'triangle', 0.1, 0.08);
      if (rar >= 2) blip(f * 2, f * 2.5, 0.2, 'triangle', 0.08, 0.16);
    },
    // 界面：广告空投到达、金币跳数、卡片飞入
    drop: () => { blip(1046, 1568, 0.12, 'square', 0.07); blip(1568, 2093, 0.16, 'square', 0.06, 0.1); noise(0.25, 0.1, 6000, 1500, 0.05); },
    coin: () => blip(1760 + Math.random() * 400, 2600, 0.05, 'square', 0.04),
    swish: () => noise(0.18, 0.12, 1200, 6000),
  };

  function play(name, arg) {
    if (!ac || Save.data.muted) return;
    const now = ac.currentTime;
    const gap = GAP[name] || 0;
    if (gap && lastAt[name] && now - lastAt[name] < gap) return;
    lastAt[name] = now;
    SOUNDS[name](arg);
  }

  return { init, play };
})();
