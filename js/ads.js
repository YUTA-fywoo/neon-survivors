// 模拟激励视频广告：不接任何真实广告 SDK。
// 只模拟“入口曝光 → 点击 → 填充/无填充 → 播放 → 完播 → 发奖”这条链路，每一步都打点。
const Ads = (() => {
  const $ = id => document.getElementById(id);
  const KEY = 'neon_survivors_ad_settings';
  const NAMES = { start_boost: '开局增益', take_all: '三项全拿', reroll: '刷新强化', chest_more: '宝箱再抽', wave_drop: '波间空投', revive: '复活', double_coins: '金币倍率' };
  const A = CONFIG.ads;
  // 波间空投的三种奖励，入口和广告页用同一份文案
  const DROPS = {
    overdrive: { name: '火力全开', desc: `${A.overdrive.dur} 秒伤害 +${A.overdrive.dmg * 100}% · 射速 +${A.overdrive.rate * 100}%`, icon: 'power' },
    epicBox: { name: '史诗补给箱', desc: '立刻开一个保底史诗的宝箱', icon: 'gold' },
    xpWave: { name: '双倍经验', desc: '下一波经验 ×' + A.xpWave, icon: 'magnet' },
  };
  // 广告页上写明“看完能拿到什么”
  function rewardText(placement, props) {
    switch (placement) {
      case 'start_boost': return '史诗强化三选一开局';
      case 'take_all': return '三张强化全部拿走';
      case 'reroll': return '换一批强化';
      case 'chest_more': return '再抽一次 · 保底史诗';
      case 'wave_drop': return DROPS[props.kind] ? `${DROPS[props.kind].name} · ${DROPS[props.kind].desc}` : '空投奖励';
      case 'revive': return `满血复活 · ${A.reviveInv} 秒无敌 · 立刻狂热`;
      case 'double_coins': return '金币 ×' + (props.multi || 2);
      default: return '';
    }
  }
  const settings = { fillRate: CONFIG.ads.fillRate, duration: CONFIG.ads.duration };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 用默认值 */ }

  const RING = 2 * Math.PI * 46;   // 广告页倒计时圆环周长
  let active = null;
  let timer = null;

  // 广告入口按钮出现在玩家面前时调用
  function offer(placement, props) {
    Analytics.track('ad_offer', Object.assign({ placement }, props));
  }

  // 玩家点了广告按钮；done(true) 表示应发放奖励
  function show(placement, props, done) {
    if (active) return;
    const base = Object.assign({ placement }, props);
    Analytics.track('ad_click', base);
    if (Math.random() >= settings.fillRate) {
      Analytics.track('ad_no_fill', base);
      UI.toast('暂时没有可播放的广告（模拟无填充），稍后再试');
      done(false);
      return;
    }
    Analytics.track('ad_play', base);
    active = { base, done, dur: settings.duration, elapsed: 0, last: performance.now(), finished: false, confirming: false };
    $('ad-place').textContent = NAMES[placement] || placement;
    $('ad-reward').textContent = rewardText(placement, props || {});
    $('ad-len').textContent = active.dur;
    $('ad-confirm').hidden = true;
    $('ad-claim').hidden = true;
    $('ad-close').textContent = '跳过';
    $('scr-ad').classList.remove('done');
    $('scr-ad').hidden = false;
    tick();
    timer = setInterval(tick, 100);
  }

  function tick() {
    const a = active;
    if (!a) return;
    const now = performance.now();
    if (!a.confirming) a.elapsed += (now - a.last) / 1000;   // 弹出“放弃奖励？”时视频暂停
    a.last = now;
    const left = Math.max(0, a.dur - a.elapsed);
    $('ad-bar').style.transform = `scaleX(${Math.min(1, a.elapsed / a.dur)})`;
    $('ad-ring').style.strokeDashoffset = (RING * Math.min(1, a.elapsed / a.dur)).toFixed(1);
    $('ad-sec').textContent = Math.ceil(left);
    $('ad-count').textContent = left > 0 ? `${Math.ceil(left)} 秒后可获得奖励` : '奖励已到账';
    if (left <= 0 && !a.finished) {
      a.finished = true;
      Analytics.track('ad_complete', a.base);
      $('ad-close').textContent = '关闭';
      $('ad-claim').hidden = false;
      $('scr-ad').classList.add('done');
    }
  }

  function finish(rewarded) {
    const a = active;
    clearInterval(timer);
    active = null;
    $('scr-ad').hidden = true;
    if (rewarded) Analytics.track('ad_reward', a.base);
    a.done(rewarded);
  }

  $('ad-close').addEventListener('click', () => {
    if (!active) return;
    if (active.finished) { finish(true); return; }
    active.confirming = true;
    $('ad-confirm').hidden = false;
  });
  $('ad-keep').addEventListener('click', () => {
    if (!active) return;
    active.confirming = false;
    $('ad-confirm').hidden = true;
  });
  $('ad-quit').addEventListener('click', () => {
    if (!active) return;
    Analytics.track('ad_close_early', Object.assign({ watched: Math.round(active.elapsed * 10) / 10 }, active.base));
    finish(false);
  });
  $('ad-claim').addEventListener('click', () => { if (active && active.finished) finish(true); });

  function set(key, value) {
    settings[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
  }

  return { offer, show, set, settings, isActive: () => !!active, NAMES, DROPS };
})();
