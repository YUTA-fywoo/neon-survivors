// 霓虹幸存者 · 数值配置
// 试玩迭代只改这个文件。VERSION 会写进每条埋点，埋点面板可以按版本对比。
const VERSION = '0.8.1';

const CONFIG = {
  // 6 波 × 34 秒，之后 Boss 战。每波分三段：0–22 秒蓄力（密度爬升），22–30 秒高峰（地图事件），30–34 秒喘息（停刷）。
  // 参考《求生之路》AI 导演的 BUILD_UP → SUSTAIN_PEAK → RELAX，和《吸血鬼幸存者》按波规定最少在场数的做法。
  run: { waves: 6, waveDuration: 34, peakAt: 22, relaxAt: 30 },
  view: { refSize: 860 },                     // 画面缩放基准：手机和电脑看到的场地面积接近
  player: { hp: 100, speed: 170, radius: 11, pickup: 60, iframes: 0.45 },
  // 从 n 级升到 n+1 级所需经验 = base + step·(n-1)：5、15、25……与《吸血鬼幸存者》前 20 级相同
  xp: { base: 5, step: 10 },
  passives: { maxhp: 20, speed: 0.08, magnet: 0.35, power: 0.12, haste: 0.08, regen: 0.8, volatile: 0.15 },
  crit: { chance: 0.12, mul: 2 },             // 暴击：给每次命中加一点不确定性
  combo: { window: 2, milestones: [25, 50, 100, 200, 400] },

  weapons: {
    bolt:  { cd: 0.6, dmg: 11, speed: 520, range: 460 },
    orbit: { dmg: 8, count: 2, radius: 70, spin: 3.0, hitCd: 0.5 },
    pulse: { cd: 3, dmg: 16, radius: 135, knock: 220 },
    chain: { cd: 2, dmg: 22, jumps: 3, range: 300, jumpRange: 160 },
    missile: { cd: 1.7, dmg: 16, count: 2, speed: 320, turn: 5, radius: 48, life: 2.4 },
    // 集束炸弹：朝敌人最密的地方抛一枚，落地大爆炸，再往四周散出子弹各炸一次
    cluster: { cd: 2.6, dmg: 24, radius: 64, bomblets: 4, bombletDmg: 12, bombletR: 38, range: 420 },
    // 激光扫射：一道光束绕身扫一整圈，扫到的全部受伤
    laser: { cd: 3.4, dmg: 22, len: 230, sweep: 1.0, width: 9 },
  },
  // 殉爆（被动）：每级 +15% 概率让被击杀的敌人爆炸；爆炸杀死的敌人还能再殉爆
  volatile: { radius: 50, dmg: 22, maxPending: 40 },
  // 主角机体按等级进阶，只换外形和动效，不改数值（外形在 js/art.js）
  ship: {
    tiers: [
      { lv: 1, name: 'Mk I 侦察型', desc: '' },
      { lv: 6, name: 'Mk II 突击型', desc: '加装鸭翼和翼尖炮管' },
      { lv: 12, name: 'Mk III 重装型', desc: '后翼、背脊装甲、三联喷口' },
      { lv: 18, name: 'Mk IV 王牌型', desc: '双叉机首、四联喷口、金色饰线' },
    ],
  },
  // 狂热：击杀攒能量，满了进入狂热，射速和伤害一起涨；每次之后需要的能量变多
  fever: { need: 70, grow: 35, dur: 7, rate: 1.8, dmg: 1.25, speed: 1.12, elite: 12 },
  // 清场：0.6 秒内击杀 15 个以上，放半秒慢动作
  massacre: { kills: 15, window: 0.6, slow: 0.3, dur: 0.5, cd: 6 },
  // 武器满级 + 持有对应被动，下一个宝箱必出进化
  evolutions: {
    bolt:  { needs: 'power', name: '星爆弹', desc: '弹数 +2、穿透 +2，命中时爆炸' },
    orbit: { needs: 'speed', name: '光轮', desc: '6 片巨型光刃，范围和伤害大增' },
    pulse: { needs: 'maxhp', name: '震荡核心', desc: '冲击波频率翻倍，被击中的敌人减速' },
    chain: { needs: 'haste', name: '雷暴', desc: '一次放出两道闪电，各弹射 9 次' },
    missile: { needs: 'magnet', name: '引力弹', desc: '命中后先把周围敌人吸到一起，再一起炸开' },
    cluster: { needs: 'volatile', name: '地毯轰炸', desc: '一次沿直线连投 8 枚炸弹，炸成一条火线' },
    laser: { needs: 'regen', name: '歼星光束', desc: '三道更长更粗的光束不停旋转' },
  },
  // 稀有度 = 强度：普通 +1 级，稀有 +2 级，史诗 +3 级，传说是武器进化。级数放不下时自动降一档。
  // v0.5 按本人反馈调高：升级三选一里约 4 成是稀有以上；宝箱（抽卡）大多是稀有以上，3 成多出史诗。
  rarity: {
    tiers: [
      { name: '普通', color: '#b9c9c4', levels: 1 },
      { name: '稀有', color: '#4aa8ff', levels: 2 },
      { name: '史诗', color: '#b779ff', levels: 3 },
      { name: '传说', color: '#ffd25a' },
    ],
    level: [0.6, 0.28, 0.12],
    chest: [0.15, 0.5, 0.35],
  },

  // 外形在 js/art.js 里按类型画
  enemies: {
    grunt:   { name: '无人机', hp: 10, speed: 62, dmg: 8, r: 11, xp: 1 },
    runner:  { name: '飞梭', hp: 6, speed: 112, dmg: 6, r: 8, xp: 1 },
    tank:    { name: '装甲舰', hp: 55, speed: 42, dmg: 14, r: 18, xp: 4 },
    shooter: { name: '炮艇', hp: 18, speed: 56, dmg: 6, r: 11, xp: 3,
               range: 250, fireEvery: 2.8, bulletSpeed: 160, bulletDmg: 8 },
    dart:    { name: '蜂群', hp: 7, speed: 240, dmg: 10, r: 7, xp: 1 },
    wall:    { name: '浮雷', hp: 26, speed: 30, dmg: 12, r: 11, xp: 2 },
    supply:  { name: '补给飞船', hp: 140, speed: 105, dmg: 0, r: 16, xp: 0 },
    pylon:   { name: '护盾发生器', hp: 260, speed: 0, dmg: 10, r: 14, xp: 3 },   // Boss 升起护盾时放出来，生命不随时间涨，只按威胁度涨
    boss:    { name: '虚空核心', hp: 20000, speed: 55, dmg: 30, r: 44, xp: 0 },
  },
  hazards: { meteor: { name: '陨石' }, hole: { name: '黑洞' } },   // 不是敌人但会伤人的东西，死因统计用
  hpGrowthPerMin: 0.9,                        // 普通敌人生命每分钟 +90%
  dmgGrowthPerMin: 0.45,                      // 普通敌人伤害每分钟 +45%，后几波撞一下更疼
  maxEnemies: 250,
  elite: { hpMul: 10, sizeMul: 1.8, xp: 12 }, // 精英在高峰段出现，必掉宝箱
  // Boss 分三个阶段：血量打到 phases 里的比例时崩掉一层装甲、升起护盾、放出一圈护盾发生器。
  // 护盾期间 Boss 不吃伤害，发生器全打掉才破盾；破盾后硬直 stun 秒、受到伤害 +stunDmg。一次打穿门槛也会停在门槛上，阶段不会被跳过。
  // 后两个阶段加螺旋弹幕，冲撞更频繁；dashEvery 按阶段取
  boss: {
    volleyEvery: 2.4, volleyCount: 22, bulletSpeed: 175, bulletDmg: 30,
    summonEvery: 6, summonCount: 14,
    dashEvery: [5.5, 4.6, 3.8], dashWindup: 0.7, dashTime: 0.6, dashSpeed: 380,
    phases: [0.66, 0.33],
    shield: { pylons: [4, 5], orbit: 150, spin: 0.45, stun: 2, stunDmg: 0.5 },
    spiralCd: 4.5, spiralDur: 2.4, spiralEvery: 0.11, spiralArms: 3, spiralSpeed: 150,
  },

  // 每波：min 是蓄力段开始和结束时的最少在场数（少了就补），interval/batch 是额外的定时刷怪，
  // events 是高峰段依次触发的地图事件。最后一条是 Boss 波。
  // supply：这一波会不会飞来一艘补给飞船
  waves: [
    { min: [10, 20], interval: 1.3, batch: 1, mix: { grunt: 1 }, events: ['elite'] },
    { min: [16, 30], interval: 1.1, batch: 2, mix: { grunt: 3, runner: 1 }, events: ['swarm', 'meteor'], supply: true },
    { min: [22, 38], interval: 1.0, batch: 2, mix: { grunt: 3, runner: 2, tank: 0.6 }, events: ['ring', 'elite'] },
    { min: [40, 66], interval: 0.9, batch: 3, mix: { grunt: 3, runner: 2, tank: 1, shooter: 0.8 }, events: ['hole', 'elite'], supply: true },
    { min: [58, 92], interval: 0.8, batch: 4, mix: { grunt: 2, runner: 3, tank: 1.3, shooter: 1.2 }, events: ['meteor', 'ring', 'elite'], supply: true },
    { min: [78, 125], interval: 0.7, batch: 4, mix: { grunt: 2, runner: 3, tank: 1.6, shooter: 1.5 }, events: ['swarm', 'hole', 'elite'] },
    { min: [24, 36], interval: 1.2, batch: 3, mix: { grunt: 2, runner: 2, tank: 0.6 }, events: [] },
  ],
  events: { warn: 1.8, gap: 3, swarmCount: 22, swarmSpacing: 24, ringSpacing: 30 },
  // 黑洞：把敌人和经验往中心吸，吸到核心的敌人被压爆；玩家也会被拉过去，越靠近拉得越狠（最大接近玩家移速），碰到核心受伤
  hole: { dur: 8, radius: 280, core: 24, pull: 420, playerPull: 210, pullCap: 0.82, playerDmg: 10 },   // 吸主角的力量封顶在主角移速的 82%，任何时候都挣得脱
  // 陨石雨：落点先出准星，1.1 秒后砸下；一半落在玩家附近，一半落在敌群里；砸出的坑 crater 秒后消失
  meteor: { dur: 5, every: 0.28, warn: 1.1, radius: 48, dmg: 70, playerDmg: 18, crater: 4.5 },
  // 补给飞船：会逃跑，追上打爆掉主动技能和一把经验；18 秒追不上就跃迁离开
  supply: { life: 18, at: [6, 14], gems: 10, gemXp: 3 },
  // 主动技能：只有补给飞船掉，一次存一个，新捡的会替换旧的
  skills: {
    nova:   { name: '新星爆发', desc: '对屏幕内所有敌人造成大量伤害', dmg: 90 },
    strike: { name: '轨道轰炸', desc: '1.5 秒内 8 道激光砸向身边敌群', dmg: 130, count: 8, radius: 70 },
    stasis: { name: '时停力场', desc: '冻结所有敌人和子弹 4 秒', dur: 4 },
    shield: { name: '相位护盾', desc: '5 秒无敌，撞到的敌人受伤并被弹开', dur: 5, dmg: 40 },
  },

  drops: { heart: 0.012, magnet: 0.004, heal: 25 },
  chest: { tripleChance: 0.4 },               // 宝箱 4 成概率开出 3 项

  // 模拟激励视频。每个广告位的奖励都写成玩家看得懂的具体数字，入口按钮上直接写出来。
  ads: {
    duration: 5, fillRate: 1, reviveWait: 8,
    reviveLimit: 1, reviveHp: 1, reviveInv: 3,          // 复活：满血、3 秒无敌、立刻进入狂热、清掉身边的敌人
    rerollLimit: 2,                                     // 升级时换一批
    takeAllLimit: 2,                                    // 升级时三项全拿
    chestLimit: 2, chestMoreRar: 2,                     // 宝箱再抽一次，保底史诗
    boostRar: 2,                                        // 开局增益：史诗强化三选一
    dropWaves: [1, 3, 5], dropWindow: 9,                // 第 1、3、5 波打完的喘息段飞来广告空投，9 秒内点才有
    overdrive: { dur: 40, dmg: 0.5, rate: 0.3 },        // 空投之一：火力全开，40 秒伤害 +50%、射速 +30%
    xpWave: 2,                                          // 空投之一：下一波经验 ×2
    multi: [2, 3, 5, 3, 2], multiW: [0.27, 0.18, 0.1, 0.18, 0.27],   // 结算倍率条：指针来回摆，停在哪格拿几倍金币
  },
  // 威胁度：玩家每靠广告拿一次永久强化，威胁度加一截，之后刷出的敌人更硬、更疼、更多，让广告是“明显变强”而不是“直接无敌”。
  // 敌人生命 ×(1 + 威胁度·hp)，伤害 ×(1 + 威胁度·dmg)，在场数和 Boss 召唤 ×(1 + 威胁度·crowd)，Boss 生命 ×(1 + 威胁度·boss)。
  // 数值用 bot 校准：看广告的 bot 通关率要明显高于不看的，但不能场场轻松通关。
  threat: { takeAll: 0.12, chestMore: 0.08, boost: 0.15, epicBox: 0.08, xpWave: 0.08, revive: 0.05, hp: 2, dmg: 1.2, crowd: 0.8, boss: 1.8 },

  // 结算金币与永久强化
  coins: { perKill: 0.1, perWave: 6, win: 60 },
  shop: [
    { id: 'hp', name: '生命强化', desc: '最大生命 +10', step: 10 },
    { id: 'dmg', name: '火力强化', desc: '全部伤害 +6%', step: 0.06 },
    { id: 'spd', name: '机动强化', desc: '移动速度 +4%', step: 0.04 },
  ],
  shopCosts: [20, 45, 80, 130, 200],

  // 矢量街机配色：玩家一方磷光青，敌人琥珀，危险一律红
  color: { me: '#3cffc0', foe: '#ffb43c', danger: '#ff3b3b', hot: '#eafff7', void: '#b06cff' },   // void：黑洞、Boss 护盾
};
