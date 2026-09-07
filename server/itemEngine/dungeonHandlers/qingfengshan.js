/**
 * qingfengshan.js — 青峰山副本专属自定义效果 handler
 * 由 ItemEngine 自动加载并注册到 EffectEngine（effect.custom 引用）
 * 对应《青峰山虚空列车带物品数值 V5.0》6.x 自定义机制：
 *   qingfengshan.timelock 制动钥匙·时空锁定
 *   qingfengshan.radio    对讲机远程联络（冷却2回合）
 *   qingfengshan.chenhui  陈慧同化状态机
 *   qingfengshan.shoggoth 修格斯不可击败/逃离判定
 */

function register(effects) {
  // 制动钥匙·时空锁定：修格斯「虚空之卵」减伤 60% → 20%
  effects.register('qingfengshan.timelock', (effect, ctx) => {
    const state = ctx.room && ctx.room.dungeonState;
    if (state) {
      state.shoggothDrReduction = 0.2;
      state.timelockActive = true;
    }
    return { msg: '时空锁定发动：修格斯幼体伤害减免由 60% 降为 20%', changes: { timelockActive: true } };
  });

  // 对讲机远程联络：陈慧对话，冷却 2 回合（返回当前倒计时信息）
  effects.register('qingfengshan.radio', (effect, ctx) => {
    const char = ctx.character;
    char.radioCooldown = 2; // 由回合系统推进
    const deadline = (ctx.room && ctx.room.dungeonState && ctx.room.dungeonState.turn) || '?';
    return { msg: `对讲机已联络陈慧（冷却2回合）。当前全局回合 T${deadline}` };
  });

  // 陈慧同化状态机：清醒 → 同化 → 伪装（T10 未解救触发）
  effects.register('qingfengshan.chenhui', (effect, ctx) => {
    const state = ctx.room && ctx.room.dungeonState;
    if (!state) return { msg: '陈慧状态未知' };
    if (!state.chenhui) state.chenhui = { state: '清醒' };
    const st = state.chenhui;
    if (st.state === '清醒' && (state.turn || 0) >= 10 && !state.chenhuiRescued) {
      st.state = '同化';
      return { msg: '【陈慧已被同化】T10 未解救，求救声戛然而止……' };
    }
    if (st.state === '同化' && effect.trigger === 'use') {
      st.state = '伪装';
      return { msg: '对讲机传来陈慧的声音——但咬字太干净了。【疑似伪装】' };
    }
    return { msg: `陈慧当前状态：${st.state}` };
  });

  // 修格斯幼体：不可击败判定（任何人数数学无解，正确应对 = 逃离）
  effects.register('qingfengshan.shoggoth', (effect, ctx) => {
    const state = ctx.room && ctx.room.dungeonState;
    if (state) {
      state.shoggothUnbeatable = true;
      if (state.shoggothHp === undefined) state.shoggothHp = 2400;
    }
    const dr = (state && state.shoggothDrReduction) || 0.6;
    return {
      msg: `修格斯幼体（HP ${state ? state.shoggothHp : 2400}，伤害减免 ${Math.round(dr * 100)}%）：无法击败，识破征兆后应逃离。`,
      changes: { shoggothUnbeatable: true }
    };
  });
}

module.exports = { register };
