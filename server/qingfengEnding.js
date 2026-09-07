/**
 * qingfengEnding.js — 青峰山结局结算（2026-08-16 从 qingfengTrain.js 拆分）
 * calculateEnding / getEndingRewards（纯函数，仅依赖 state）
 */
// ==================== 结局结算 ====================
function calculateEnding(state) {
  let grade = 'D';
  let totalScore = 0;

  if (!state.escapeComplete) {
    grade = 'D';
    totalScore = 0;
  } else if (state.shoggothTriggered && !state.shoggothDefeated) {
    grade = 'D';
    totalScore = 5;
  } else if (!state.chenHui.alive) {
    grade = 'C';
    totalScore = 20 + state.cluesFound.length * 3;
  } else if (state.chenHui.alive && state.shoggothTriggered && state.shoggothDefeated) {
    state.chenHui.injured = true;
    grade = 'B';
    totalScore = 40 + state.cluesFound.length * 3;
  } else if (state.chenHui.alive && state.cluesFound.length >= 7 && !state.shoggothTriggered) {
    grade = 'S';
    totalScore = 80 + state.cluesFound.length * 5;
  } else {
    grade = 'A';
    totalScore = 55 + state.cluesFound.length * 4;
  }

  const rewards = getEndingRewards(grade);
  return {
    grade,
    totalScore,
    description: rewards.description,
    narrative: rewards.description,
    chenHuiAlive: state.chenHui.alive,
    shoggothTriggered: state.shoggothTriggered,
    cluesCount: state.cluesFound.length
  };
}

function getEndingRewards(ending) {
  const rewards = {
    S: {
      name: '完全解救',
      exp: 30,
      mysteryPoint: 60,
      trait: { name: '虚实洞察者', effect: 'PER永久+3' },
      easterEgg: '陈慧跨世界彩蛋链完整开启',
      description: '你带着陈慧穿越虚空疏散通道。当她转过身看着你时，眼角闪烁的不是泪水，而是虚空折射的蓝色微光。多年后，在另一个时空的海边渔村，有人会收到一封没有署名的信件，里面夹着一张磨得发亮的G314车票碎片。'
    },
    A: {
      name: '安全撤离',
      exp: 25,
      mysteryPoint: 40,
      trait: null,
      easterEgg: '陈慧跨世界彩蛋链开启',
      description: '你推开6号车厢侧壁的阀门，陈慧紧跟在你身后。当列车在背后彻底被裂隙吞噬时，她轻声说：「至少，还有人记得这列车上的故事。」'
    },
    B: {
      name: '艰难撤离',
      exp: 20,
      mysteryPoint: 25,
      trait: null,
      easterEgg: '陈慧存活但受伤·彩蛋内容削减50%',
      description: '那个巨大生物的触须擦过陈慧的肩膀。但三束强光同时照向天花板，那个东西缩回了夹层深处。陈慧咬着牙跟在你身后穿过通道——她没有哭，但你知道她记住了今天的一切。'
    },
    C: {
      name: '独自撤离',
      exp: 15,
      mysteryPoint: 15,
      trait: null,
      easterEgg: '彩蛋永久关闭',
      description: '你独自推开阀门，通道的光芒在身后熄灭。列车上再也没有传来陈慧的声音。'
    },
    D: {
      name: '失败撤离',
      exp: 0,
      mysteryPoint: 0,
      trait: null,
      easterEgg: '副本失败·自动退出时序',
      description: '黑暗吞没了一切。你的意识最后感知到的，是列车金属扭曲的声音，以及某种巨大的、沸腾的、正在接近的嗡鸣。虚空从不慈悲。它只是等待。'
    }
  };
  return rewards[ending] || rewards.D;
}



module.exports = { calculateEnding, getEndingRewards };
