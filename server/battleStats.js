/**
 * battleStats.js — 服务端战斗面板属性计算（复刻前端 client.js getCombatStats）
 * 供 battleHandler 构建玩家战斗快照使用（v2.1 §4.1）。
 */
const CAREER_ROLE = {
  fangshi: '法师', lianjinshushi: '法师', guanxingzhe: '法师', huanfashi: '法师', zhentan: '法师',
  jiaodoushi: '战士', wushi: '战士', haidao: '战士', baifuzhang: '战士',
  qishi: '坦克', jingguan: '坦克',
  qiangshou: '刺客', guishuxiaochou: '刺客',
  '方士': '法师', '炼金术师': '法师', '观星者': '法师', '环法师': '法师', '侦探': '法师',
  '角斗士': '战士', '武士': '战士', '海盗': '战士', '百夫长': '战士',
  '骑士': '坦克', '警官': '坦克',
  '枪手': '刺客', '诡术小丑': '刺客'
};
const ROLE_RATIO = {
  '坦克': { physAtk: 0.55, magAtk: 0.35, physDef: 1.0, magDef: 0.85, pierce: 0.15, block: 0.55, shield: 0.6 },
  '战士': { physAtk: 0.85, magAtk: 0.30, physDef: 0.75, magDef: 0.55, pierce: 0.40, block: 0.45, shield: 0.35 },
  '刺客': { physAtk: 1.10, magAtk: 0.35, physDef: 0.40, magDef: 0.45, pierce: 0.70, block: 0.25, shield: 0.30 },
  '法师': { physAtk: 0.30, magAtk: 1.10, physDef: 0.35, magDef: 0.85, pierce: 0.25, block: 0.20, shield: 0.55 }
};
const BATTLE_BASE = { physAtk: 8, magAtk: 8, physDef: 6, magDef: 6, pierce: 0, block: 0, shield: 0 };

function careerRole(career) {
  if (!career) return '战士';
  return CAREER_ROLE[career] || '战士';
}

/** 战斗数值 = 职业基础值 + 属性 × 职业倍率（法术主属性 = (智力+意志力)/2） */
function getCombatStats(attr, career) {
  const a = attr || {};
  const str = a.str || 0, dex = a.dex || 0, con = a.con || 0, int = a.int ?? a.per ?? 0, wil = a.wil || 0;
  const r = ROLE_RATIO[careerRole(career)] || ROLE_RATIO['战士'];
  const spell = (int + wil) / 2;
  return {
    physAtk: BATTLE_BASE.physAtk + str * r.physAtk,
    magAtk: BATTLE_BASE.magAtk + spell * r.magAtk,
    physDef: BATTLE_BASE.physDef + con * r.physDef,
    magDef: BATTLE_BASE.magDef + spell * r.magDef,
    pierce: BATTLE_BASE.pierce + str * r.pierce,
    block: BATTLE_BASE.block + dex * r.block,
    shield: BATTLE_BASE.shield + wil * r.shield,
    role: careerRole(career)
  };
}

/**
 * 解析角色装备中的武器 → { itemId, itemName, kind, baseDmg, ap, hits, blockOnBasic }
 * 空手返回 null（引擎按物攻兜底）。
 * @param {Object} character
 * @param {Object} itemEngine
 */
function getEquippedWeapon(character, itemEngine) {
  if (!character || !character.equip || !character.equip.weapon) return null;
  const name = character.equip.weapon;
  let tpl = null;
  try { tpl = itemEngine && itemEngine.resolveTemplate(name); } catch (e) { /* ignore */ }
  const kind = (tpl && tpl.weaponKind) || (tpl && tpl.kind) || 'melee';
  const baseDmg = (tpl && typeof tpl.baseDmg === 'number') ? tpl.baseDmg : 0;
  const ap = (tpl && typeof tpl.ap === 'number') ? tpl.ap : (kind === 'ranged' ? 4 : (kind === 'focus' ? 2 : 3));
  const hits = (tpl && typeof tpl.hits === 'number') ? tpl.hits : 1;
  return {
    itemId: tpl ? (tpl.itemId || null) : null,
    itemName: name,
    kind,
    baseDmg,
    ap,
    hits,
    blockOnBasic: (tpl && tpl.blockOnBasic) || 0
  };
}

/**
 * 解析角色装备的六槽中的战斗被动词条（onBattleStart/onTurnStart/onAttack/onHurt/onKill/onBattleEnd）
 * → [{ slot, trigger, effect }]（杀戮尖塔2式装备"遗物"词条，v2.1 §7.3）
 * @param {Object} character
 * @param {Object} itemEngine
 */
function getEquippedPassives(character, itemEngine) {
  const out = [];
  if (!character || !character.equip) return out;
  const BATTLE_TRIGGERS = ['onBattleStart', 'onTurnStart', 'onAttack', 'onHurt', 'onKill', 'onBattleEnd'];
  const slots = ['weapon', 'head', 'body', 'hand', 'foot', 'accessory'];
  for (const slot of slots) {
    const name = character.equip[slot];
    if (!name) continue;
    let tpl = null;
    try { tpl = itemEngine.resolveTemplate(name); } catch (e) { /* ignore */ }
    const effs = (tpl && Array.isArray(tpl.effects)) ? tpl.effects : [];
    for (const e of effs) {
      if (e && e.trigger && BATTLE_TRIGGERS.includes(e.trigger)) {
        out.push({ slot, trigger: e.trigger, effect: e });
      }
    }
  }
  return out;
}

module.exports = { careerRole, getCombatStats, getEquippedWeapon, getEquippedPassives, ROLE_RATIO };
