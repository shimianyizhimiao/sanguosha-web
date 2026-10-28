/* 機制級驗證：廢除裝備欄 / 技能暫時無效 / 臨時獲得技能 / 恢復裝備欄
   用法： node test/mech.js
*/
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS, CARDS = root.SGS_CARDS;

const ok = (cond, msg) => console.log((cond ? '✅' : '❌') + ' ' + msg);
let fails = 0;
const check = (cond, msg) => { if (!cond) fails++; ok(cond, msg); };

(async () => {
  const g = SETUP.makeGame({
    mode: 'duel', packs: ['std'], generalPacks: ['std', 'god'],
    forcedGenerals: [[GEN['神張遼·雷']], [GEN['孫權']]],
  });
  const [zhang, sun] = g.players;
  g.current = zhang; g.phase = 'play';

  // 1. 廢除裝備欄
  const wpn = CARDS.buildDeck(['std']).find(c => c.name === '青釭劍');
  zhang.hand.push(wpn);
  g.equipCard(zhang, wpn);
  check(zhang.equips.weapon === wpn, '裝備青釭劍成功');
  g.abolishSlot(zhang, 'weapon');
  check(!!zhang.deadSlots.weapon, '武器欄已廢除');
  check(zhang.equips.weapon === null, '廢除時裝備被棄置');

  const wpn2 = CARDS.buildDeck(['std']).find(c => c.name === '青龍偃月刀');
  zhang.hand.push(wpn2);
  g.equipCard(zhang, wpn2);
  check(zhang.equips.weapon === null, '廢除後無法再裝備武器');

  check(!!g.restoreSlot(zhang), '恢復裝備欄成功');
  check(!zhang.deadSlots.weapon, '武器欄恢復後可再裝備');
  g.equipCard(zhang, wpn2);
  check(zhang.equips.weapon === wpn2, '恢復後裝備成功');

  // 2. 技能暫時無效
  sun.turnCount = 1;
  sun.silenced['制衡'] = sun.turnCount + 1;   // 下個回合結束前無效
  check(g.isSilenced(sun, '制衡') === true, '制衡目前在無效狀態');
  const before = g.usableSkills.length;
  const usable = g.usableSkills(sun);
  check(!usable.includes('制衡'), '無效技能不會出現在可用技能清單');
  sun.turnCount = 2;
  check(g.isSilenced(sun, '制衡') === false, '過了期限自動恢復');

  // 3. 臨時獲得技能
  zhang.skills.push('制衡');
  zhang.granted = [{ name: '制衡', untilTurn: zhang.turnCount }];
  check(g.usableSkills(zhang).includes('制衡'), '臨時獲得的技能可使用');
  zhang.turnCount = (zhang.turnCount || 0) + 1;
  // 觸發回合結束清理
  await g.trigger('turnEnd', { player: zhang });
  check(!zhang.skills.includes('制衡'), '回合結束後臨時技能被移除');

  // 4. 止啼：手牌上限光環 + 決鬥勝利恢復裝備欄
  zhang.deadSlots = {};
  g.abolishSlot(zhang, 'horse+');
  sun.hp = sun.maxHp - 1;
  zhang.equips.weapon = wpn2;           // 攻擊範圍 3
  check(g.inAttackRange(zhang, sun), '兩人在攻擊範圍內');
  const limSun = g.handLimit(sun);
  const limZhang = g.handLimit(zhang);
  check(limSun === sun.hp - 1, `止啼讓孫權手牌上限 -1（${limSun} = 體力 ${sun.hp} - 1）`);
  await g.trigger('duelResult', { winner: zhang, loser: sun, initiator: zhang });
  check(!zhang.deadSlots['horse+'], '決鬥贏了已受傷的目標 → 恢復裝備欄');

  console.log('───────');
  console.log(fails === 0 ? '全部通過' : `${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})();
