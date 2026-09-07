/**
 * battleScene.js — ★ 杀戮尖塔2 风格战斗场景模块（中间栏场景图下方、战斗信息栏上方，常驻）
 * 玩家立绘站左侧、怪物立绘站右侧，双方对峙（Slay the Spire 2 式），带名字 + HP 血条。
 * 立绘取自 assets/青峰山战斗立绘/{职业|怪物}战斗立绘.png；背景为车内/隧道内战斗背景。
 * 背景随场景切换；左侧立绘只显示自己和与自己同在一个场景的队友；右侧怪物仅在战斗时显示。
 * 暴露：window.BattleScene = { enter(carId, monsters, players), updateStatus(status), clearEnemies(), setPlayers(list), setCarId(carId), show/hide(兼容) }
 */
(function () {
  const SPRITE_ROOT = '/assets/青峰山战斗立绘/cutout/';   // ★ 抠图后的透明背景立绘（融入战斗背景）
  const BG_ROOT = '/assets/青峰山战斗立绘/';              // 战斗背景（非抠图）
  // ★ XSS 转义工具
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 职业名 → 职业战斗立绘文件名（青峰山战斗立绘）
  const CAREER_SPRITE = {
    '方士': '方士战斗立绘', '角斗士': '角斗士战斗立绘', '海盗': '海盗战斗立绘', '枪手': '枪手战斗立绘',
    '骑士': '骑士战斗立绘', '观星者': '观星者战斗立绘', '环法师': '环法师战斗立绘', '炼金术士': '炼金术师战斗立绘',
    '侦探': '侦探战斗立绘', '百夫长': '百夫长爆甲战斗立绘', '武士': '武士战斗立绘', '诡术小丑': '小丑战斗立绘', '警官': '警官战斗立绘'
  };
  // 怪物 type → 怪物战斗立绘文件名
  const MONSTER_SPRITE = { formless: '无形之子战斗立绘', shoggoth: '修格斯战斗立绘', migo: '米戈战斗立绘' };
  // 空间 → 战斗背景（车内/隧道内；8号车尾与隧道空间用隧道背景）
  const CAR_BG = {
    car_1_cab: '车内战斗背景', car_2_economy: '车内战斗背景', car_2_power: '车内战斗背景',
    car_3_luggage: '车内战斗背景', car_4_dining: '车内战斗背景', car_5_sleeper: '车内战斗背景',
    car_5_diningroom: '车内战斗背景', car_6_mail: '车内战斗背景', car_7_service: '车内战斗背景',
    car_7_power: '隧道内战斗背景', car_8_cabin: '隧道内战斗背景', outside: '隧道内战斗背景'
  };
  // ★ 战斗背景布局参数（来自地图编辑器人工标点，坐标已按 60 列网格换算）
  //   车内：2040x1085 → 行数 round(60*1085/2040)=32
  //   我方站立区 左(3,25)右(23,20) 中心x=(3+23)/2/60=21.7%  脚部y=25/32=78.1%
  //   敌方站立区 左(37,20)右(58,25) 中心x=(37+58)/2/60=79.2% 脚部y=78.1%
  //   显示底边 左(2,27)右(59,27) → y=27/32=84.4%（背景底部显示到此处）
  const BG_LAYOUT = {
    '车内战斗背景': { w: 2040, h: 1085, playerX: 13 / 60, monsterX: 47.5 / 60, feetY: 25 / 32, bottomY: 27 / 32 },
    '隧道内战斗背景': { w: 2037, h: 1076, playerX: 13 / 60, monsterX: 47.5 / 60, feetY: 25 / 32, bottomY: 27 / 32 }
  };

  let players = [];       // 与当前玩家同场景的队友（含自己）
  let enemies = null;     // 当前怪物列表（null/空 = 非战斗，右侧空）
  let myCarId = null;     // 当前玩家所在空间（决定背景 + 左侧立绘筛选）
  let initialized = false;

  function el() { return document.getElementById('battleScene'); }
  function bgOf(carId) { return BG_ROOT + (CAR_BG[carId] || '车内战斗背景') + '.png'; }

  function setBg(src) {
    const b = document.getElementById('battleBg');
    const bl = document.getElementById('battleBgBlur');
    if (b) b.src = src;
    if (bl && bl.getAttribute('src') !== src) bl.src = src;   // ★ 同步模糊铺底层
  }

  /** ★ 模糊铺底同步算法：主体图(src)变化时自动同步到模糊层（cover 填满无黑边 + 主体 contain 完整显示） */
  function initBlurSync() {
    const sync = (mainId, blurId) => {
      const main = document.getElementById(mainId);
      const blur = document.getElementById(blurId);
      if (!main || !blur) return;
      const copy = () => {
        const s = main.getAttribute('src');
        if (s && blur.getAttribute('src') !== s) blur.setAttribute('src', s);
      };
      copy();
      if (window.MutationObserver) {
        new MutationObserver(copy).observe(main, { attributes: true, attributeFilter: ['src'] });
      }
    };
    sync('sceneBg', 'sceneBgBlur');
    sync('battleBg', 'battleBgBlur');
  }
  /** ★ 主动同步两处模糊铺底层（外部在移动/切场景后可显式调用，双保险） */
  function syncBlurNow() {
    const pair = (m, b) => {
      const main = document.getElementById(m), blur = document.getElementById(b);
      if (main && blur) {
        const s = main.getAttribute('src');
        if (s && blur.getAttribute('src') !== s) blur.setAttribute('src', s);
      }
    };
    pair('sceneBg', 'sceneBgBlur');
    pair('battleBg', 'battleBgBlur');
  }

  /** ★ 屏幕自适应：resize 时按视口高度重算战斗场景高度（与 CSS clamp 协同；立绘宽度由 CSS clamp 按 vw 处理） */
  function layoutAdapt() {
    const sc = el();
    if (!sc) return;
    const vh = window.innerHeight || 800;
    // 战斗场景高度：小屏取更小值，大屏更大（min 180px / max 330px，按 28vh），背景纵向更足、立绘不显大
    const h = Math.max(180, Math.min(330, Math.round(vh * 0.28)));
    if (Math.abs(sc.clientHeight - h) > 1) sc.style.height = h + 'px';
    // 高度确定后按标点重新对齐背景窗口与立绘站位
    applyLayout();
  }

  /** ★ 按地图编辑器标点对齐战斗布局：
   *  1) 背景 cover 窗口下移，使底部恰好显示到用户标记的"显示底边"(bottomY)
   *  2) 我方/敌方立绘中心对准左右站立区中心，脚部(底部)对准站立区底部(feetY)
   *  依赖容器实际尺寸实时计算，resize/加载后自动生效 */
  function applyLayout() {
    const sc = el();
    const bg = document.getElementById('battleBg');
    const left = document.querySelector('.battle-left');
    const right = document.querySelector('.battle-right');
    if (!sc || !bg || !left || !right) return;
    const W = sc.clientWidth, H = sc.clientHeight;
    if (!(W > 0 && H > 0) || !bg.naturalWidth) return;
    const src = bg.getAttribute('src') || '';
    const fname = decodeURIComponent((src.split('/').pop() || '').replace(/\.png$/, ''));
    const lay = BG_LAYOUT[fname] || BG_LAYOUT['车内战斗背景'];
    // cover 缩放：图片等比覆盖容器
    const scale = Math.max(W / lay.w, H / lay.h);
    const scaledW = lay.w * scale, scaledH = lay.h * scale;
    // 纵向：窗口底部对齐 bottomY（object-position 百分比）
    //   公式：imgTop = p*(H - scaledH)；容器底对应图片 = p*(scaledH-H)+H = bottomY*scaledH
    const pY = (lay.bottomY * scaledH - H) / (scaledH - H);
    bg.style.objectPosition = '50% ' + (pY * 100).toFixed(2) + '%';
    const topImgY = pY * (scaledH - H);            // 容器顶对应的图片 y（px）
    const leftImgX = scaledW > W ? (scaledW - W) / 2 : 0;  // 横向居中裁剪
    // 立绘底部（图片 feetY 处）在容器中的位置
    const bottomPx = H - (lay.feetY * scaledH - topImgY);
    const bottomPct = (bottomPx / H) * 100;
    const toPct = (v) => Math.max(-5, Math.min(105, v));
    left.style.left = toPct(((lay.playerX * scaledW - leftImgX) / W) * 100) + '%';
    right.style.left = toPct(((lay.monsterX * scaledW - leftImgX) / W) * 100) + '%';
    left.style.bottom = toPct(bottomPct) + '%';
    right.style.bottom = toPct(bottomPct) + '%';
  }

  // 状态图标 / 意图图标（杀戮尖塔2式：意图纯 emoji 图标 + 数值，状态角标、格挡条）
  const STATUS_ICON = { strength: '💪', weak: '💫', vulnerable: '💢', poison: '☠️', burn: '🔥', blockUp: '🛡️', dexUp: '💨', immobilize: '⛓️', stun: '💫', regen: '💚', shield: '✨', fear: '😱' };
  const STATUS_LABEL2 = { strength: '力量', weak: '脆弱', vulnerable: '易伤', poison: '中毒', burn: '灼烧', blockUp: '格挡增强', dexUp: '敏捷', immobilize: '禁锢', stun: '眩晕', regen: '再生', shield: '护盾', fear: '恐惧' };
  // ★ 怪物意图纯 emoji 图标（攻击/格挡/蓄力/召唤/增益/减益）
  const INTENT_ICON = { attack: '🗡️', block: '🛡️', charge: '🌀', summon: '🕸️', buff: '✨', debuff: '💢' };

  function buildIntent(intent) {
    if (!intent) return '';
    // ★ 组合意图：moves 数组可同时渲染多个动作（攻击+增益/减益）；无 moves 时兼容单动作
    const moves = (Array.isArray(intent.moves) && intent.moves.length) ? intent.moves : (intent.move ? [intent] : []);
    if (!moves.length) return '';
    const cells = moves.map(mv => {
      const icon = INTENT_ICON[mv.move] || '❔';
      let num = '';
      let cls = 'bi-x';
      if (mv.move === 'attack' && mv.dmg != null) { num = mv.dmg; cls = 'bi-attack'; }
      else if (mv.move === 'charge' && mv.dmg != null) { num = mv.dmg; cls = 'bi-charge'; }
      else if (mv.move === 'block' && mv.block != null) { num = mv.block; cls = 'bi-block'; }
      else if (mv.move === 'buff' && mv.buff != null) { num = mv.buff; cls = 'bi-buff'; }
      else if (mv.move === 'debuff' && mv.debuff != null) { num = mv.debuff; cls = 'bi-debuff'; }
      else if (mv.move === 'summon') { num = '!'; cls = 'bi-summon'; }
      return `<span class="bi-cell ${cls}" title="${esc(mv.label)}"><span class="bi-icon">${icon}</span>${num ? `<span class="bi-num">${num}</span>` : ''}</span>`;
    }).join('');
    return `<div class="battle-intent">${cells}</div>`;
  }
  function buildStatuses(list) {
    if (!list || !list.length) return '';
    const items = list.map(s => {
      const id = s.id || '';
      return `<span class="bst bst-${id}" title="${STATUS_LABEL2[id] || id} ×${s.value || 1}（剩${s.turns || 1}回合）">${STATUS_ICON[id] || id}</span>`;
    }).join('');
    return `<div class="battle-statuses">${items}</div>`;
  }

  // ★ 怪物头顶短名（未解锁时模糊名过长 → 简化显示，title 保留全名）
  const MONSTER_SHORT = { formless: '柏油黑形', formless_elite: '柏油黑形·精英', shoggoth: '修格斯', mi_go: '米·戈' };
  function shortMonsterName(m) {
    if (m && MONSTER_SHORT[m.type]) return MONSTER_SHORT[m.type];
    const n = (m && m.name) || '';
    const s = n.replace(/^从[^的]+中渗出的/, '').replace(/^从[^的]+涌出的/, '').replace(/^从[^的]+中/,'');
    if (s && s.length <= 7) return s;
    return s && s.length > 7 ? s.slice(-6) : n;
  }

  /** 构造一个战斗单位（头顶意图/名字/格挡+血条，脚下立绘站平台）；杀戮尖塔2 式左右对峙
   *  ★ 玩家不再显示头顶血条（LOL HUD 已有 HP/SAN，避免重复）；怪物显示血条 */
  function buildUnit(opt) {
    const u = document.createElement('div');
    u.className = 'battle-unit' + (opt.kind === 'monster' ? ' battle-monster' : ' battle-player');
    u.title = opt.name || '';
    if (opt.dead) u.classList.add('dead');
    if (opt.kind === 'monster' && opt.monsterIdx != null) u.dataset.monsterIdx = opt.monsterIdx;
    if (opt.sid != null) u.dataset.sid = opt.sid;
    // 血条百分比
    const maxHp = opt.maxHp || 0;
    const hp = Math.max(0, opt.hp == null ? maxHp : opt.hp);
    const pct = maxHp > 0 ? Math.max(0, Math.min(100, hp / maxHp * 100)) : 100;
    const nameHtml = opt.name ? `<span class="battle-name">${esc(opt.name)}</span>` : '';
    const blockHtml = (opt.block > 0) ? `<div class="battle-block"><span class="battle-block-fill" style="width:${Math.min(100, opt.block / (maxHp || 1) * 100)}%"></span><span class="battle-block-text">${opt.block}</span></div>` : '';
    // ★ 仅怪物显示血条（玩家隐藏，避免与 LOL HUD 重复）
    const hpHtml = (opt.kind === 'monster' && maxHp > 0)
      ? `<div class="battle-hp"><div class="battle-hp-fill" style="width:${pct}%"></div><span class="battle-hp-text">${hp}/${maxHp}</span></div>`
      : '';
    const intentHtml = (opt.kind === 'monster' && opt.intent) ? buildIntent(opt.intent) : '';
    // ★ 特殊能量条已移到战斗快捷栏（battleBar）显示，不再放角色立绘下
    const statusHtml = buildStatuses(opt.statuses);
    // ★ 怪物名称/格挡/血条移到立绘下方（意图仍在立绘上方顶部）；玩家隐藏血条
    u.innerHTML =
      intentHtml +
      `<div class="battle-portrait"><img src="${SPRITE_ROOT}${opt.sprite}.png" alt="" onerror="this.style.visibility='hidden'"></div>` +
      `<div class="battle-meta">${nameHtml}${blockHtml}${hpHtml}</div>` +
      statusHtml;
    return u;
  }

  function render() {
    const pl = document.getElementById('battlePlayers');
    const mo = document.getElementById('battleMonsters');
    if (!pl || !mo) return;
    pl.innerHTML = '';
    mo.innerHTML = '';
    // ★ 左侧：玩家 / 同场景队友 战斗立绘 + 名字 + 格挡 + 血条 + 状态
    (players || []).forEach(p => {
      const sprite = CAREER_SPRITE[p.career] || '方士战斗立绘';
      const maxHp = p.maxHp || p.attr?.maxHp || 0;
      const hp = p.hp != null ? p.hp : maxHp;
      pl.appendChild(buildUnit({ kind: 'player', sid: p.socketId, sprite, name: p.name || '', hp, maxHp, block: p.block || 0, statuses: p.statuses || [], resource: p.resource }));
    });
    // ★ 右侧：仅战斗时显示怪物（含意图气泡/格挡/状态，短名，可点选目标）
    if (Array.isArray(enemies) && enemies.length) {
      enemies.forEach(m => {
        const sprite = MONSTER_SPRITE[m.type] || '无形之子战斗立绘';
        const short = shortMonsterName(m);
        const n = Math.min(m.count || 1, 6);
        for (let i = 0; i < n; i++) {
          const name = short ? (n > 1 ? `${short}${i + 1}` : short) : '';
          const idx = (m.idx != null) ? m.idx + i : (enemies.indexOf(m) + i);
          mo.appendChild(buildUnit({
            kind: 'monster', sprite, name, monsterIdx: idx,
            hp: m.hp, maxHp: m.maxHp,
            dead: m.dead,
            block: m.block || 0, statuses: m.statuses || [], intent: m.intent || null
          }));
        }
      });
    }
  }

  // ★ 目标选择：高亮存活怪物供点击（选目标模式）；返回存活怪物数量
  function setTargetMode(active) {
    document.querySelectorAll('.battle-monster').forEach(u => {
      if (u.classList.contains('dead')) return;
      u.classList.toggle('targetable', !!active);
    });
  }
  function monsterCount() {
    let c = 0;
    document.querySelectorAll('.battle-monster').forEach(u => { if (!u.classList.contains('dead')) c++; });
    return c;
  }

  /** ★ 是否需整表重建：怪物存活集合或玩家集合变化 → 是（否则增量平滑更新血条） */
  function shouldRebuild(status) {
    if (Array.isArray(status.monsters)) {
      const cur = new Set((enemies || []).filter(m => !m.dead && m.idx != null).map(m => m.idx));
      const nxt = new Set(status.monsters.filter(m => !m.dead && m.idx != null).map(m => m.idx));
      if (cur.size !== nxt.size) return true;
      for (const i of cur) if (!nxt.has(i)) return true;
    }
    if (Array.isArray(status.units)) {
      const cur = new Set((players || []).map(p => p.socketId));
      const nxt = new Set(status.units.filter(u => u && u.sid != null).map(u => u.sid));
      if (cur.size !== nxt.size) return true;
      for (const s of cur) if (!nxt.has(s)) return true;
    }
    return false;
  }

  /** ★ 增量更新：不重建 DOM，只更新血条/格挡/状态/意图/生死 → .battle-hp-fill 的 width transition 平滑滑动（杀戮尖塔2 手感） */
  function updateIncremental(status) {
    const mo = document.getElementById('battleMonsters');
    if (mo && Array.isArray(status.monsters)) {
      status.monsters.forEach(m => {
        const u = mo.querySelector('.battle-monster[data-monster-idx="' + m.idx + '"]');
        if (!u) return;
        const maxHp = m.maxHp || 0;
        const hp = Math.max(0, m.hp == null ? maxHp : m.hp);
        const pct = maxHp > 0 ? Math.max(0, Math.min(100, hp / maxHp * 100)) : 100;
        const fill = u.querySelector('.battle-hp-fill'); if (fill) fill.style.width = pct + '%';
        const text = u.querySelector('.battle-hp-text'); if (text) text.textContent = hp + '/' + maxHp;
        const block = u.querySelector('.battle-block');
        if (block) {
          if (m.block > 0) {
            block.style.display = '';
            const bf = block.querySelector('.battle-block-fill'); if (bf) bf.style.width = Math.min(100, m.block / (maxHp || 1) * 100) + '%';
            const bt = block.querySelector('.battle-block-text'); if (bt) bt.textContent = m.block;
          } else block.style.display = 'none';
        }
        const stEl = u.querySelector('.battle-statuses');
        const stH = buildStatuses(m.statuses || []);
        if (stEl) { if (stH) stEl.outerHTML = stH; else stEl.remove(); }
        else if (stH) u.insertAdjacentHTML('beforeend', stH);
        const itEl = u.querySelector('.battle-intent');
        const itH = buildIntent(m.intent);
        if (itEl) { if (itH) itEl.outerHTML = itH; else itEl.remove(); }
        else if (itH) u.insertAdjacentHTML('afterbegin', itH);
        u.classList.toggle('dead', !!m.dead);
      });
    }
    const pl = document.getElementById('battlePlayers');
    if (pl && Array.isArray(status.units)) {
      status.units.forEach(u => {
        if (u && u.sid == null) return;
        const unit = pl.querySelector('.battle-player[data-sid="' + u.sid + '"]');
        if (!unit) return;
        const block = unit.querySelector('.battle-block');
        if (block) {
          const maxHp = u.maxHp || 1;
          if (u.block > 0) {
            block.style.display = '';
            const bf = block.querySelector('.battle-block-fill'); if (bf) bf.style.width = Math.min(100, u.block / maxHp * 100) + '%';
            const bt = block.querySelector('.battle-block-text'); if (bt) bt.textContent = u.block;
          } else block.style.display = 'none';
        }
        const stEl = unit.querySelector('.battle-statuses');
        const stH = buildStatuses(u.statuses || []);
        if (stEl) { if (stH) stEl.outerHTML = stH; else stEl.remove(); }
        else if (stH) unit.insertAdjacentHTML('beforeend', stH);
        unit.classList.toggle('dead', !!u.dead);
      });
    }
  }

  /** ★ 战斗状态同步：battleStart/battleTurn/battleEvent 时更新玩家与怪物 HP/格挡/状态/意图（杀戮尖塔2 式实时状态）
   *  集合结构未变 → 增量平滑更新血条（不重建 DOM）；结构变化（增删/死亡）→ 整表重建 */
  function updateStatus(status) {
    if (!status) return;
    const rebuild = shouldRebuild(status);
    if (Array.isArray(status.units)) {
      const hpMap = {};
      status.units.forEach(u => { if (u && u.sid != null) hpMap[u.sid] = { hp: u.hp, maxHp: u.maxHp, block: u.block, statuses: u.statuses, resource: u.resource, dead: u.dead }; });
      (players || []).forEach(p => {
        const h = hpMap[p.socketId];
        if (h) { p.hp = h.hp; p.maxHp = h.maxHp; p.block = h.block; p.statuses = h.statuses; p.resource = h.resource; p.dead = h.dead; }
      });
    }
    if (Array.isArray(status.monsters)) {
      enemies = status.monsters.map(m => ({
        type: m.type, count: 1, name: m.name, hp: m.hp, maxHp: m.maxHp, dead: m.dead,
        block: m.block, statuses: m.statuses, intent: m.intent, idx: m.idx
      }));
    }
    if (!initialized) return;
    if (rebuild) render();
    else updateIncremental(status);
  }

  /** 进入/切换空间：设置背景 + 左侧玩家 + 右侧怪物（非战斗传空数组/null → 右侧空） */
  function enter(carId, mon, list) {
    myCarId = carId || myCarId || 'car_4_dining';
    if (list) syncPlayers(list);
    enemies = (Array.isArray(mon) && mon.length) ? mon : null;
    setBg(bgOf(myCarId));
    render();
    initialized = true;
    const e = el();
    if (e) e.style.display = 'block';
    // 背景就绪后对齐标点布局（若已加载直接生效，否则等待 load）
    applyLayout();
  }

  /** 同步玩家列表：仅保留与自己同场景（carId 相同）的玩家；无 carId 数据时显示全部 */
  function syncPlayers(list) {
    const arr = (list || []).filter(p => p && p.socketId);
    if (myCarId && arr.some(p => p.carId)) {
      players = arr.filter(p => !p.carId || p.carId === myCarId);
    } else {
      players = arr;
    }
    if (initialized) render();
  }

  /** 战斗结束 / 非战斗：仅清空右侧怪物，保留背景与左侧玩家 */
  function clearEnemies() {
    enemies = null;
    if (initialized) render();
  }

  // ★ 兼容旧接口（client.js 旧调用）：hide=清空怪物；show=进入场景
  function show(carId, mon, list) { enter(carId, mon, list); }
  function hide() { clearEnemies(); }

  function setPlayers(list) { syncPlayers(list); }
  function setCarId(carId) { myCarId = carId; if (initialized) render(); }

  /** ★ 伤害/治疗飘字：在玩家区或怪物区随机位置生成上浮数字（type: dmg/heal/block） */
  function floatText(kind, num, type) {
    if (num == null || !isFinite(num)) return;
    const wrap = document.getElementById(kind === 'monster' ? 'battleMonsters' : 'battlePlayers');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'float-dmg ' + (type || 'dmg');
    const show = Math.abs(num);
    if (type === 'heal') el.textContent = '+' + show;
    else if (type === 'block') el.textContent = '🛡 ' + show;
    else el.textContent = '-' + show;
    el.style.left = (20 + Math.random() * 60) + '%';
    el.style.top = (12 + Math.random() * 18) + '%';
    wrap.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
  }

  // ★★★ 杀戮尖塔2 流畅度动效 ★★★
  // 受击抖动+闪光：kind='monster'|'player'，整区单位抖动、立绘闪白/闪红（重复调用自动重启动画）
  let _impactSeq = 0;
  function impact(kind) {
    const wrap = document.getElementById(kind === 'monster' ? 'battleMonsters' : 'battlePlayers');
    if (!wrap) return;
    const seq = ++_impactSeq;
    wrap.classList.remove('impact-monster', 'impact-player');
    void wrap.offsetWidth; // 强制 reflow 重启动画
    wrap.classList.add(kind === 'monster' ? 'impact-monster' : 'impact-player');
    setTimeout(() => { if (seq === _impactSeq) wrap.classList.remove('impact-monster', 'impact-player'); }, 420);
  }
  // 怪物前冲（攻击动画）：整个怪物区向前（左）冲刺再回位
  let _lungeSeq = 0;
  function lunge() {
    const wrap = document.getElementById('battleMonsters');
    if (!wrap) return;
    const seq = ++_lungeSeq;
    wrap.classList.remove('lunge');
    void wrap.offsetWidth;
    wrap.classList.add('lunge');
    setTimeout(() => { if (seq === _lungeSeq) wrap.classList.remove('lunge'); }, 340);
  }
  // 战斗/回合横幅：居中淡入淡出（战斗开始/队伍回合/怪物回合）
  let _bannerTimer = null;
  function banner(text) {
    let b = document.getElementById('battleBanner');
    if (!b) { b = document.createElement('div'); b.id = 'battleBanner'; b.className = 'battle-banner'; document.body.appendChild(b); }
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(_bannerTimer);
    _bannerTimer = setTimeout(() => { if (b) b.classList.remove('show'); }, 950);
  }

  window.BattleScene = { enter, show, hide, clearEnemies, setPlayers, setCarId, syncBlurNow, updateStatus, setTargetMode, monsterCount, floatText, impact, lunge, banner, isShown: () => initialized };

  // ★ 初始化：模糊铺底同步 + 屏幕自适应（DOM 就绪后执行；脚本位于 body 末尾，元素已存在）
  initBlurSync();
  layoutAdapt();
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(layoutAdapt, 120);
  });
  // 图片加载后重新适配高度并对齐标点布局（clamp 需在图片就绪后计算）
  const _battleBg = document.getElementById('battleBg');
  if (_battleBg) {
    _battleBg.addEventListener('load', () => { layoutAdapt(); applyLayout(); });
    if (_battleBg.complete && _battleBg.naturalWidth) { layoutAdapt(); applyLayout(); }
  }
})();
