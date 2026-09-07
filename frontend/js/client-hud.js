/**
 * client-hud.js — 战斗行为系统 HUD：行动条 + 骰子面板（2026-08-16 从 client.js 拆分）
 * 两个独立 IIFE：actionHud / dicePanel。依赖全局 socket/window（client.js 先加载）。
 */
(function actionHud() {
  'use strict';
  var _myCost = 0, _myDice = 0, _round = 1;
  var _inBattle = false; // ★ 战斗保护标志：战斗中禁止 exploreUpdate 隐藏战斗条
  function $(id) { return document.getElementById(id); }
  function showAction(show) { var el = $('actionHud'); if (el) el.style.display = show ? 'flex' : 'none'; }
  function showExplore(show) {
    var el = $('exploreBar'); if (el) el.style.display = show ? 'flex' : 'none';
    // 罗盘已移到左边栏左下角常驻显示，不再随探索条显隐
  }
  function showBattle(show) { var el = $('battleBar'); if (el) el.style.display = show ? 'flex' : 'none'; }

  function skillBaseDmg() {
    // 取当前出战第一个主动技能的基础伤害，找不到默认 20
    var c = currentCharacter || {};
    var names = (c.equippedSkills && c.equippedSkills.length) ? c.equippedSkills : (c.skills || []);
    var active = Array.isArray(names) ? names[0] : '';
    var pro = (window._professions || []).find(function (p) { return p.name === c.career || p.id === c.career; });
    var sk = pro && pro.skills ? pro.skills.find(function (s) { return s.name === active; }) : null;
    if (sk && sk.effect) {
      var v = sk.effect.physDmg || sk.effect.holyDmg || sk.effect.magicDmg || sk.effect.dmg;
      if (v) return v;
    }
    return 20;
  }

  // ★ 回合值罗盘：一整圈=1.5，12点=1.5（初始位置，无 0），每小刻度 0.25（60°/格）
  var COMPASS_TICKS = [
    { v: 1.5, deg: 0, max: true },  // 12点 正上方只有 1.5
    { v: 0.25, deg: 60 },
    { v: 0.5, deg: 120 },
    { v: 0.75, deg: 180 },
    { v: 1.0, deg: 240 },
    { v: 1.25, deg: 300 }
  ];
  var _compassInited = false;
  function initCompassTicks() {
    if (_compassInited) return;
    _compassInited = true;
    var wrap = $('compassTicks');
    if (!wrap) return;
    var R = 54; // 刻度标签距圆心
    COMPASS_TICKS.forEach(function (t) {
      var rad = t.deg * Math.PI / 180;
      var el = document.createElement('div');
      el.className = 'compass-tick' + (t.max ? ' max' : '');
      el.textContent = t.v;
      el.style.left = (74 + R * Math.sin(rad) + (t.dx || 0)) + 'px';
      el.style.top = (74 - R * Math.cos(rad) + (t.dy || 0)) + 'px';
      wrap.appendChild(el);
    });
  }
  function updateCompass(cost) {
    initCompassTicks();
    var c = Math.max(0, Math.min(1.5, cost || 0));
    var deg = c * 240; // 一整圈：0→0°(12点), 0.25→60°, 1.5→360°(回12点)
    var hand = document.querySelector('#compassNeedle .needle-hand');
    if (hand) hand.style.transform = 'rotate(' + deg + 'deg)';
    var v = $('compassCenterVal');
    if (v) v.textContent = c;
  }

  function renderExplore(d) {
    if (_inBattle) return; // ★ 战斗中忽略探索更新，防止覆盖战斗条
    showAction(true); showExplore(true); showBattle(false);
    if (d && d.sid === socket.id) { _myDice = d.dice || 0; _myCost = d.cost || 0; if (d.round) _round = d.round; }
    updateCompass(_myCost);
    // ★ 探索骰已移至 exploreRound（新回合/结束行动后）统一掷骰，此处不再随行动重复投掷（2026-08-23）
    // ★ 探索回合数整合到 LOL HUD 角色头像旁的回合徽标（lolTurn）
    var r = d && d.round ? d.round : _round;
    var tEl = $('lolTurn'); if (tEl) tEl.textContent = '回合 ' + r;
    var wEl = $('exploreWait');
    if (wEl) {
      if (d && d.ended && d.sid === socket.id) {
        // ★ P2 多人等待：自己已结束、还有队友未结束时提示等待对象
        wEl.textContent = d.waitingFor ? ('✅ 已结束本回合 · 等待 ' + d.waitingFor + '…') : '✅ 已结束本回合';
      }
      else if (d && d.forcedEnd) wEl.textContent = '🔒 回合值已满，强制结束';
      else if (d && d.skipped && d.sid === socket.id && d.reason === 'limit') wEl.textContent = '🎲 操作次数已用完';
      else if (d && d.skipped && d.sid === socket.id) wEl.textContent = '⏳ 本回合已结束';
      else wEl.textContent = '';
    }
  // ★ 骰子仅自动投掷（2026-08-23 已移除手动彩蛋）：探索 1D6 与战斗能量骰由系统驱动，骰子面板不可点击
  }

  function renderBattle(d) {
    showAction(true); showBattle(true); showExplore(false);
    // ★ 战斗时罗盘固定指向 1.5（12点），读数一直为 0（只确认探索回合值）
    updateCompass(0);
    var isMe = d.for === socket.id;
    var name = isMe ? '你' : (d.forName || '队友');
    var iEl = $('battleTurnInfo');
    if (iEl) iEl.textContent = isMe ? '⚔ 轮到你了！' : ('⚔ ' + name + ' 行动中…');
    // ★ AP 能量显示：当前/上限（上限 = 本回合掷出的骰子点数，非 3D6 上限）
    var ap = (d.ap != null ? d.ap : 0);
    var eEl = $('battleEnergyText');
    if (eEl) eEl.textContent = '⚡ ' + ap + '/' + ap;
    // ★ 特殊能量条 + 配套技能（battleBar 内，替代立绘下的资源条）
    renderBattleResource(d);
    renderBattleResourceSkill(d, isMe);
    document.querySelectorAll('.btn-battle').forEach(function (b) {
      if (b.id === 'btnBattleUrge') return; // ★ 催促按钮单独处理（队友回合时可用）
      b.disabled = !isMe;
      if (isMe) b.classList.add('mine'); else b.classList.remove('mine');
    });
    // ★ 催促队友按钮：队友行动时显示且可点；自己回合隐藏
    var urge = $('btnBattleUrge');
    if (urge) {
      urge.style.display = isMe ? 'none' : 'inline-block';
      urge.disabled = false;
      if (!isMe) urge.classList.add('mine'); else urge.classList.remove('mine');
    }
  }

  // ★ 催促队友（一次性绑定点击 → 发 battleUrge 给服务器）
  var _urgeBound = false;
  function bindBattleUrge() {
    if (_urgeBound) return;
    _urgeBound = true;
    var u = $('btnBattleUrge');
    if (u) u.addEventListener('click', function () {
      if (window.socket) window.socket.emit('battleUrge');
    });
  }
  bindBattleUrge();

  // ★ 尖塔式：队伍回合渲染（全队共享回合、自由行动）
  // 自己未行动 → 显示"轮到你行动"、操作可用；自己已行动 → "等待队友…"、显示催促按钮
  function renderBattleTeam(status) {
    showAction(true); showBattle(true); showExplore(false);
    updateCompass(0); // 战斗时罗盘固定 1.5、读数 0
    var units = (status && status.units) || [];
    var me = units.find(function (u) { return u.sid === socket.id; });
    var turn = (status && status.turn) || _round;
    // ★ 战斗信息栏：队伍回合状态
    var iEl = $('battleTurnInfo');
    if (iEl) {
      if (!me) iEl.textContent = '⚔ 队伍回合 ' + turn;
      else if (me.dead) iEl.textContent = '⚔ 队伍回合 ' + turn + ' · 你已阵亡';
      else if (me.acted) {
        // ★ 全员已行动：其余存活玩家都已行动 → 提示怪物回合即将开始
        var pendingOthers = units.some(function (u) {
          return u.sid !== socket.id && !u.dead && !u.acted && !u.offline;
        });
        iEl.textContent = pendingOthers
          ? '⚔ 队伍回合 ' + turn + ' · 等待队友…'
          : '⚔ 队伍回合 ' + turn + ' · ✅ 全员已行动，怪物回合…';
      }
      else iEl.textContent = '⚔ 队伍回合 ' + turn + ' · 轮到你行动';
    }
    // ★ AP 能量：自己的本回合 AP
    var meAp = me ? (me.ap || 0) : 0;
    var eEl = $('battleEnergyText');
    if (eEl) eEl.textContent = '⚡ ' + meAp + '/' + meAp;
    // ★ 回合显示（LOL HUD 头像旁）
    var tEl = $('lolTurn'); if (tEl) tEl.textContent = '回合 ' + turn;
    // ★ 能量池（自己本回合 AP）
    _battleEnergy = meAp; _battleEnergyMax = meAp;
    renderEnergyPool();
    // ★ 特殊能量条 + 配套技能（自己未行动时可施放）
    renderBattleResource({ status: status });
    var canAct = !!(me && !me.dead && !me.acted);
    renderBattleResourceSkill({ status: status }, canAct);
    // ★ 快捷操作按钮：自己未行动时可点
    document.querySelectorAll('.btn-battle').forEach(function (b) {
      if (b.id === 'btnBattleUrge') return;
      b.disabled = !canAct;
      if (canAct) b.classList.add('mine'); else b.classList.remove('mine');
    });
    // ★ 催促队友按钮：自己"行动过后"且还有队友未行动时显示
    var urge = $('btnBattleUrge');
    if (urge) {
      var hasPending = !!(status && units.some(function (u) {
        return u.sid !== socket.id && !u.dead && !u.acted && !u.offline;
      }));
      var showUrge = !!(me && me.acted && !me.dead && hasPending);
      urge.style.display = showUrge ? 'inline-block' : 'none';
      urge.disabled = false;
      if (showUrge) urge.classList.add('mine'); else urge.classList.remove('mine');
    }
    // ★ LOL HUD 技能/普攻：仅自己未行动时可点（避免已行动后仍能操作）
    document.querySelectorAll('#lolHud .lol-skill').forEach(function (s) {
      var isPassive = s.classList.contains('passive');
      s.classList.toggle('battle-lock', !isPassive && !canAct);
    });
    var atkEl = document.getElementById('lolAttack');
    if (atkEl) atkEl.classList.toggle('battle-lock', !canAct);
  }

  // ★ 特殊能量条（炁/战意/子弹…）：战斗快捷栏显示，替代立绘下方资源条
  //   ★ 职业机制进度条（武士架势条 / 百夫长五段战姿）：被动型资源 value 恒 0 → 改显累积进度
  function renderBattleResource(d) {
    var box = $('battleResBar');
    if (!box) return;
    var me = null;
    if (d && d.status && d.status.units) me = d.status.units.find(function (u) { return u.sid === socket.id; });
    var res = me && me.resource;
    var mec = me && me.mechanic;
    // ★ 机制进度条（架势条/五段战姿）
    if (mec && mec.acc) {
      var acc = mec.acc || {}, cur = 0, thr = 0;
      if (mec.id === 'stance') { var st = acc.stance || {}; cur = st.count || 0; thr = st.threshold || 5; }
      else if (mec.id === 'five_stance') { var cm = acc.combo || {}; cur = cm.count || 0; thr = cm.threshold || 5; }
      if (thr > 0) {
        var pct = Math.min(100, cur / thr * 100);
        var readyTag = (mec.id === 'stance' && mec.parry) ? '<span class="bres-tag ready">⚔ 招架就绪</span>'
          : (mec.id === 'five_stance' && mec.combo > 0) ? '<span class="bres-tag">连击×' + mec.combo + '</span>' : '';
        box.innerHTML = '<span class="bres-name">' + (mec.label || '机制') + '</span>' +
          '<div class="bres-track"><span class="bres-fill" style="width:' + pct + '%"></span></div>' +
          '<span class="bres-val">' + cur + '/' + thr + '</span>' + readyTag;
        box.style.display = '';
        return;
      }
    }
    // ★ 主动/mix 资源条（炁/战意/探知值…）
    if (res && res.id) {
      var pct2 = Math.min(100, (res.value || 0) / Math.max(1, res.max || 1) * 100);
      box.innerHTML = '<span class="bres-name">' + res.id + '</span>' +
        '<div class="bres-track"><span class="bres-fill" style="width:' + pct2 + '%"></span></div>' +
        '<span class="bres-val">' + (res.value || 0) + '/' + res.max + '</span>';
      box.style.display = '';
    } else { box.innerHTML = ''; }
  }

  // ★ 特殊能量条配套技能（不耗 AP 的个人特殊技能：招架/炁盾/战吼…，消耗特殊资源）
  //   ★ 扩展：枪手「装填」/ 侦探「标记弱点」特殊行动按钮
  function renderBattleResourceSkill(d, isMe) {
    var wrap = $('battleResSkills');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!isMe) return;
    var me = null;
    if (d && d.status && d.status.units) me = d.status.units.find(function (u) { return u.sid === socket.id; });
    var res = me && me.resource;
    var rs = me && me.resourceSkill;
    var sa = me && me.specialAction;
    function mkBtn(label, tip, fn) {
      var b = document.createElement('button');
      b.className = 'btn-battle btn-resskill';
      b.title = tip;
      b.innerHTML = '<span class="rs-name">' + label + '</span>';
      b.addEventListener('click', fn);
      wrap.appendChild(b);
    }
    // ★ 特殊行动按钮（不耗 AP 或耗小量 AP）：装填（枪手）/ 标记弱点（侦探）
    if (sa === 'reload') mkBtn('装填', '消耗 1 AP，获得 5 子弹（枪手）', window.emitBattleReload || function () { socket.emit('battleAction', { action: 'reload' }); });
    if (sa === 'markWeak') mkBtn('标记弱点', '消耗 2 探知，标记目标弱点（易伤+1，侦探）', window.emitBattleMarkWeak || function () { socket.emit('battleAction', { action: 'markWeak' }); });
    if (!rs || !res || !res.id) return;
    // ★ 记录特殊技能是否需要选目标（对敌人施加效果时）
    window.__battleResSkillNeedTarget = !!(rs.effect && rs.effect.kind === 'debuff');
    var b = document.createElement('button');
    b.className = 'btn-battle btn-resskill';
    b.title = rs.name + '（' + (rs.desc || '不消耗 AP') + '）';
    b.innerHTML = '<span class="rs-name">' + rs.name + '</span>' +
      (rs.cost ? '<span class="rs-cost">' + res.id + '×' + rs.cost + '</span>' : '<span class="rs-cost">0AP</span>');
    b.addEventListener('click', function () { emitBattleResourceSkill(); });
    wrap.appendChild(b);
  }

  // ★ 预加载技能战斗配置（LOL HUD 技能群攻判定/费用角标用）
  var _skillBattleCache = null;
  function loadSkillBattle() {
    if (_skillBattleCache) return Promise.resolve(_skillBattleCache);
    return fetch('/api/skill-battle').then(function (r) { return r.json(); })
      .then(function (d) { _skillBattleCache = d; return d; })
      .catch(function () { return null; });
  }
  window.__loadSkillBattle = loadSkillBattle; // ★ 暴露给 LOL HUD 技能目标判定

  socket.on('copyStart', function () {
    _myCost = 0; _myDice = 0; _round = 1; _inBattle = false;
    showAction(true); showExplore(true); showBattle(false);
    if (window.DicePanel && window.DicePanel.showDefault) window.DicePanel.showDefault(); // ★ 进副本恢复默认单骰（面6），避免残留上一轮能量骰
    renderExplore({ round: 1 });
  });
  socket.on('exploreUpdate', function (d) { renderExplore(d); });
  socket.on('exploreRound', function (d) {
    _myCost = 0; _myDice = 0; _round = d.round || 1;
    if (window.DicePanel) {
      // ★ 新回合（结束行动后）自动掷探索骰：用服务端本回合 diceMap 定格真实面值（2026-08-23）
      var myDice = (d && d.diceMap && d.diceMap[socket.id]) || 1;
      window.DicePanel.roll(1, 6, null, null, myDice);
    }
    renderExplore({ round: _round });
  });
  socket.on('battleStart', function (d) {
    _inBattle = true; // ★ 进入战斗锁定（防止后续 exploreUpdate 隐藏战斗条）
    showAction(true); showBattle(true); showExplore(false);
    var i = $('battleTurnInfo'); if (i) i.textContent = '⚔ 战斗开始！';
    updateCompass(0); // 战斗时罗盘固定 1.5、读数 0
    setLolBattleMode(true); // ★ 解锁技能/普攻，能量池进入战斗态
    if (window.BattleScene && window.BattleScene.banner) window.BattleScene.banner('⚔ 战斗开始！'); // ★ 战斗横幅
    if (window.BattleScene?.updateStatus) window.BattleScene.updateStatus(d.status); // ★ 同步玩家/怪物血条
    renderBattleResource(d); // ★ 同步特殊能量条（battleBar）
    renderBattleResourceSkill(d, true);
    // ★ 队友回合状态同步（队伍信息栏显示已行动/待行动/离线）
    if (d && d.status && window.__battleStatusSetter) window.__battleStatusSetter(d.status);
    if (d && d.status) {
      var me = d.status.units.find(function (u) { return u.sid === socket.id; });
      if (me && currentCharacter) { currentCharacter.attr.hp = me.hp; updatePlayerInfo(); renderLolStatus(); }
    }
  });
  socket.on('battleTurn', function (d) {
    _inBattle = true;
    if (d.status && window.BattleScene?.updateStatus) window.BattleScene.updateStatus(d.status); // ★ 同步玩家/怪物血条
    // ★ 队友回合状态同步
    if (d && d.status && window.__battleStatusSetter) window.__battleStatusSetter(d.status);
    // ★ 尖塔式：队伍回合广播（全队共享回合、自由行动）
    if (d.teamTurn) {
      if (window.BattleScene && window.BattleScene.banner) window.BattleScene.banner('⚔ 队伍回合'); // ★ 队伍回合横幅
      // 系统掷骰：按自己的能量骰展示（回合开始服务端已为全员掷好 AP）
      if (d.status && window.DicePanel) {
        var u = (d.status.units || []).find(function (x) { return x.sid === socket.id; });
        if (u) {
          var md = /^(\d+)D/i.exec(u.energyDice || '3D6');
          var cnt = md ? parseInt(md[1], 10) : 3;
          window.DicePanel.roll(cnt, 6);   // ★ 队伍回合自动掷能量骰
        }
      }
      renderBattleTeam(d.status);
      return;
    }
    // 兼容旧路径：单行动者回合
    var forName = d.for;
    if (d.status && d.status.units) {
      var u2 = d.status.units.find(function (x) { return x.sid === d.for; });
      if (u2) forName = u2.name;
    }
    // ★ 系统掷骰：轮到玩家时根据职业能量骰自动掷骰（如 3D6 → 3 颗）
    if (d.for === socket.id && window.DicePanel && d.apDice) {
      var m = /^(\d+)D/i.exec(d.apDice);
      var cnt2 = m ? parseInt(m[1], 10) : 3;
      window.DicePanel.roll(cnt2, 6);   // ★ 旧路径：轮到玩家自动掷能量骰
    }
    // ★ 能量池：上限 = 本回合掷出的骰子点数（非 3D6 上限），随消耗实时下降
    if (d.for === socket.id) {
      _battleEnergy = d.ap || 0;
      _battleEnergyMax = _battleEnergy;
      renderEnergyPool();
    }
    renderBattle({ for: d.for, forName: forName, ap: d.ap, apDice: d.apDice, status: d.status });
  });
  socket.on('battleEvent', function (d) {
    if (d && d.msg) appendLog(publicLog, d.msg, '战斗');
    if (window.BattleScene?.updateStatus && d && d.status) window.BattleScene.updateStatus(d.status); // ★ 同步玩家/怪物血条
    // ★ 队友回合状态同步
    if (d && d.status && window.__battleStatusSetter) window.__battleStatusSetter(d.status);
    // ★ 尖塔式：行动后统一按队伍回合渲染刷新（能量/按钮/催促/血条）
    if (d && d.status) {
      renderBattleTeam(d.status);
    }
    if (d && d.status && d.status.units) {
      var me = d.status.units.find(function (u) { return u.sid === socket.id; });
      if (me && currentCharacter) { currentCharacter.attr.hp = me.hp; updatePlayerInfo(); renderLolStatus(); }
    }
    // ★ 伤害飘字 + 打击动效（杀戮尖塔2 流畅度）：玩家打怪 → 怪物区抖动闪白 + 怪物前冲；怪物打人 → 玩家区抖动闪红
    if (window.BattleScene) {
      if (d && d.dmg && d.type !== 'monster') {
        if (window.BattleScene.floatText) window.BattleScene.floatText('monster', d.dmg, 'dmg');
        if (window.BattleScene.impact) window.BattleScene.impact('monster');
        if (window.Sfx && window.Sfx.hit) window.Sfx.hit();
      }
      else if (d && d.type === 'monster' && d.dmg) {
        if (window.BattleScene.floatText) window.BattleScene.floatText('player', d.dmg, 'dmg');
        if (window.BattleScene.impact) window.BattleScene.impact('player');
        if (window.BattleScene.lunge) window.BattleScene.lunge();
        if (window.Sfx && window.Sfx.hit) window.Sfx.hit();
      }
    }
  });
  socket.on('battleEnd', function (d) {
    if (d && d.msg) appendLog(publicLog, d.msg, '战斗');
    // ★ 保留探索回合值（服务端 battleReset 只清战斗，探索 cost 继续累计）
    if (window.DicePanel) window.DicePanel.reset(); // 战斗结束重置骰子显示
    setLolBattleMode(false); // ★ 战斗结束：锁定技能/普攻，能量池归 0/0
    _inBattle = false; // ★ 解除战斗保护，恢复探索条
    showAction(true); showExplore(true); showBattle(false);
    renderExplore({ round: _round });
  });

  // ★ 战利品三选一（杀戮尖塔式战后选择）
  socket.on('battleLoot', function (d) {
    var box = document.getElementById('battleLootModal');
    if (!box) { box = document.createElement('div'); box.id = 'battleLootModal'; box.className = 'battle-loot-modal'; document.body.appendChild(box); }
    var opts = d.options || [];
    box.innerHTML = '<div class="bl-title">🎁 战斗胜利 · 选择战利品</div><div class="bl-row">' +
      opts.map(function (o, i) {
        return '<button class="bl-option q-' + (o.quality || 'white') + '" data-i="' + i + '">' +
          '<span class="bl-icon">' + (o.icon || '🎁') + '</span>' +
          '<span class="bl-name">' + (o.itemName || o.itemId) + '</span>' +
          '</button>';
      }).join('') + '</div><button class="bl-skip">🎒 放弃（跳过）</button>';
    box.style.display = 'flex';
    box.querySelectorAll('.bl-option').forEach(function (b) {
      b.addEventListener('click', function () { socket.emit('chooseLoot', { index: +b.dataset.i }); box.style.display = 'none'; });
    });
    var skip = box.querySelector('.bl-skip');
    if (skip) skip.addEventListener('click', function () { socket.emit('chooseLoot', { index: -1 }); box.style.display = 'none'; });
  });
  socket.on('lootGranted', function (d) {
    if (d && d.itemName && window.showToast) window.showToast('🎁 获得战利品：' + d.itemName);
    if (window.CluePanel && window.CluePanel.refresh) window.CluePanel.refresh();
  });

  // ★ 战斗换装：弹出背包装备选择（换武器 5 AP / 防具饰品 3 AP）
  function openEquipPicker() {
    var inv = (currentCharacter && currentCharacter.inventory) || [];
    var equips = inv.filter(function (x) { return x.type === 'equipment'; });
    if (!equips.length) { if (window.showToast) window.showToast('背包无装备'); return; }
    var box = document.getElementById('battleEquipPicker');
    if (!box) { box = document.createElement('div'); box.id = 'battleEquipPicker'; box.className = 'battle-equip-picker'; document.body.appendChild(box); }
    box.innerHTML = '<div class="bep-title">⚙ 战斗换装（换武器 5 AP / 防具饰品 3 AP）</div>' +
      equips.map(function (it) {
        var tpl = it.itemName || it.name || it.itemId || '装备';
        var slot = it.slot || 'weapon';
        return '<button class="bep-item" data-uid="' + (it.uid || it.id) + '" data-slot="' + slot + '">' + tpl + '（' + (slot === 'weapon' ? '武器·5' : '防具·3') + ' AP）</button>';
      }).join('') + '<button class="bep-close">✕ 关闭</button>';
    box.style.display = 'block';
    box.querySelectorAll('.bep-item').forEach(function (b) {
      b.addEventListener('click', function () {
        socket.emit('battleAction', { action: 'equip', itemUid: b.dataset.uid, slot: b.dataset.slot });
        box.style.display = 'none';
      });
    });
    box.querySelector('.bep-close').addEventListener('click', function () { box.style.display = 'none'; });
  }

  function bindButtons() {
    initCompassTicks();
    updateCompass(0);
    loadSkillBattle(); // 预加载技能战斗配置（技能费用角标）
    var endBtn = $('btnExploreEnd');
    if (endBtn) endBtn.addEventListener('click', function () { socket.emit('exploreEnd'); });
    document.querySelectorAll('.btn-battle').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.bact;
        if (act === 'skill' && b.dataset.skillId) { socket.emit('battleAction', { action: 'skill', skillId: b.dataset.skillId }); return; }
        if (act === 'equip') { openEquipPicker(); return; }
        if (act === 'item') {
          var inv = (currentCharacter && currentCharacter.inventory) || [];
          var it = inv.find(function (x) { return x.type === 'consumable'; });
          if (!it) { if (window.showToast) window.showToast('背包无消耗品'); return; }
          socket.emit('battleAction', { action: 'item', itemUid: it.uid || it.id });
          return;
        }
        if (act === 'skill') socket.emit('battleAction', { action: 'skill', skillId: skillBaseDmg() });
        else socket.emit('battleAction', { action: act });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindButtons);
  else bindButtons();
})();

// ==================== 骰子面板（固定大小常驻：无字样，骰面显示上一轮数值） ====================
(function dicePanel() {
  'use strict';
  var rolling = false;
  var _queue = []; // 动画队列：连续掷骰（探索→战斗）依次播放
  // 骰面 3x3 点位置：1-6 对应格子索引（0-8）
  var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function $el(id) { return document.getElementById(id); }

  function buildDice(value, sides) {
    var d = document.createElement('div');
    d.className = 'dice';
    d.dataset.val = value;
    for (var i = 0; i < 9; i++) {
      var pip = document.createElement('span');
      pip.className = 'pip' + (PIPS[value] && PIPS[value].indexOf(i) >= 0 ? ' on' : '');
      d.appendChild(pip);
    }
    return d;
  }

  /** 常驻显示：无结果时展示一颗默认骰（面 6） */
  function showDefault() {
    var cups = $el('diceCups');
    if (!cups) return;
    cups.classList.remove('multi');
    cups.innerHTML = '';
    cups.appendChild(buildDice(6, 6));
  }

  /**
   * 系统掷骰：count 颗骰子滚动动画，定格显示上一轮结果（无任何文字字样）
   * 若上一条动画未结束则自动排队，依次播放（探索掷骰 → 进战斗能量骰 连续场景）。
   * @param {number} count 骰子颗数
   * @param {number} sides 面数（默认 6）
   * @param {string} tag 预留参数（不再显示）
   * @param {string} label 预留参数（不再显示）
   * @param {number} actualSum 服务端真实总值（骰子仅动画展示）
   * @returns {Promise<number>} 完成时 resolve 总和
   */
  function roll(count, sides, tag, label, actualSum) {
    return new Promise(function (resolve) {
      count = Math.max(1, Math.min(6, count || 1));
      sides = sides || 6;
      if (rolling) { _queue.push({ count: count, sides: sides, actualSum: actualSum, resolve: resolve }); return; }
      doRoll(count, sides, actualSum, resolve);
    });
  }

  function doRoll(count, sides, actualSum, resolve) {
    rolling = true;
    var cups = $el('diceCups');
    if (!cups) { rolling = false; resolve(null); return; }
    cups.classList.toggle('multi', count > 1);
    cups.innerHTML = '';
    for (var i = 0; i < count; i++) cups.appendChild(buildDice(1, sides));
    var diceEls = cups.querySelectorAll('.dice');
    diceEls.forEach(function (d) { d.classList.add('rolling'); });
    var frames = 0;
    var timer = setInterval(function () {
      diceEls.forEach(function (d) { d.innerHTML = buildDice(1 + Math.floor(Math.random() * sides), sides).innerHTML; });
      frames++;
      if (frames >= 8) {
        clearInterval(timer);
        var values = [];
        for (var k = 0; k < count; k++) values.push(1 + Math.floor(Math.random() * sides));
        var i2 = 0;
        diceEls.forEach(function (d) {
          d.classList.remove('rolling');
          // ★ 单骰且 actualSum 有效 → 定格服务端真实面值（骰面与操作次数/判定一致，P0 优化 2026-08-23）
          var finalVal = (count === 1 && actualSum != null && actualSum >= 1 && actualSum <= sides) ? actualSum : values[i2];
          d.innerHTML = buildDice(finalVal, sides).innerHTML;
          d.dataset.val = finalVal;
          i2++;
        });
        rolling = false;
        resolve(actualSum != null ? actualSum : values.reduce(function (a, b) { return a + b; }, 0));
        // ★ P2 音效：掷骰落定声
        if (window.Sfx && window.Sfx.dice) window.Sfx.dice();
        // 队列：播放下一条
        if (_queue.length) {
          var n = _queue.shift();
          doRoll(n.count, n.sides, n.actualSum, n.resolve);
        }
      }
    }, 80);
  }

  /** 重置：不清空，保留上一轮结果（常驻显示）；面板为空时放默认骰 */
  function reset() {
    var cups = $el('diceCups');
    if (!cups) return;
    if (!cups.querySelector('.dice')) showDefault();
  }

  function init() {
    showDefault();   // ★ 仅自动投掷（2026-08-23 移除手动彩蛋）：骰子面板不可手动点击
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 暴露给系统（actionHud 调用）
  window.DicePanel = { roll: roll, reset: reset, showDefault: showDefault, isRolling: function () { return rolling; } };
})();
