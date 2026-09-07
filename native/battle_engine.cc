/**
 * battle_engine.cc — 战斗行为系统 1.0 引擎（C++ N-API 原生插件）
 *
 * 两套完全独立体系（docs/战斗行为系统1.0.docx）：
 *  1) 非战斗探索（自由回合消耗）：每大回合掷 1D6 = 操作次数上限；行动按类型扣 0.25/0.5 回合值；
 *     累计 ≥1.5 强制结束回合；<1.5 可手动结束；精细搜索(0.5) 保底稀有。
 *  2) 战斗（敏捷比值小局制）：行动循环 = 玩家敏捷:怪物敏捷 最简比展开；
 *     每人行动轮掷职业能量骰得能量，能量可无限倾泻（普攻/技能/吃药/撤退）。
 *
 * 多人同步：探索需所有玩家结束本大回合才进下一大回合；战斗按循环逐个等待当前行动者完成。
 * 编译：cd native && node-gyp configure && node-gyp build
 */
#include <napi.h>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>
#include <algorithm>
#include <random>

// ==================== 常量 ====================
static const double FORCE_END_THRESHOLD = 1.5;
static const int ENERGY_COST_ATTACK = 2;
static const int ENERGY_COST_SKILL = 4;
static const int ENERGY_COST_ITEM = 1;

// ==================== 状态结构 ====================
struct ExplorePlayerState {
  int dice = 0;
  int used = 0;         // 本回合已操作次数（≤ dice 次数上限）
  double cost = 0.0;
  bool ended = false;
};
struct ExploreState {
  bool active = false;
  int round = 0;
  std::unordered_map<std::string, ExplorePlayerState> players;
};

struct BattleUnit {
  std::string sid, name, career, energyDice;
  double dex = 20.0, str = 40.0, per = 40.0;
  int hp = 80, maxHp = 80, energy = 0;
  bool dead = false;
};
struct MonsterUnit {
  std::string type, name;
  double dex = 15.0;
  int hp = 15, maxHp = 15, attackDamage = 6;
  bool dead = false;
};
struct CycleNode {
  bool isPlayer = false;
  std::string sid;
};
struct BattleState {
  bool over = false;
  bool started = false;
  int cycleIndex = 0;
  std::string waitingFor;
  int energy = 0;
  std::string energyDice;
  std::vector<BattleUnit> units;
  std::vector<MonsterUnit> monsters;
  std::vector<CycleNode> cycle;
};

struct RoomState {
  ExploreState explore;
  BattleState battle;
};

static std::unordered_map<std::string, RoomState> g_rooms;

// ==================== 工具 ====================
static std::mt19937 engine((std::random_device())());
static int rollDice(int count, int sides = 6) {
  int s = 0;
  for (int i = 0; i < count; i++) s += (int)(engine() % (uint32_t)sides) + 1;
  return s;
}
static int parseDiceCount(const std::string& diceStr) {
  // "3D6" → 3；默认 2
  if (diceStr.size() >= 1 && diceStr[0] >= '1' && diceStr[0] <= '9') {
    return diceStr[0] - '0';
  }
  return 2;
}
// ★ KP 回合值体系（2026-08-16）：成本由 KP 判定层（JS room._kpTurn）管理，C++ 不再按行动类型扣成本，仅计操作次数
static double exploreCostFor(const std::string& type) {
  (void)type; return 0.0;
}

// ==================== 探索 ====================
static ExploreState& getExplore(std::string& roomId) { return g_rooms[roomId].explore; }
static BattleState& getBattle(std::string& roomId) { return g_rooms[roomId].battle; }

Napi::Value ExploreStart(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "";
  ExploreState& st = getExplore(roomId);
  st.active = true;
  st.round += 1;
  st.players.clear();
  Napi::Object o = Napi::Object::New(env);
  o.Set("round", Napi::Number::New(env, st.round));
  return o;
}

Napi::Value ExplorePlayerDice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Object e = Napi::Object::New(env); e.Set("ok", Napi::Boolean::New(env, false)); e.Set("msg", Napi::String::New(env, "bad args")); return e;
  }
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  std::string sid = info[1].As<Napi::String>().Utf8Value();
  ExploreState& st = getExplore(roomId);
  auto it = st.players.find(sid);
  if (it == st.players.end()) {
    ExplorePlayerState p;
    p.dice = rollDice(1, 6);
    p.cost = 0.0;
    p.ended = false;
    st.players[sid] = p;
  }
  ExplorePlayerState& p = st.players[sid];
  Napi::Object o = Napi::Object::New(env);
  o.Set("dice", Napi::Number::New(env, p.dice));
  o.Set("cost", Napi::Number::New(env, p.cost));
  o.Set("ended", Napi::Boolean::New(env, p.ended));
  o.Set("round", Napi::Number::New(env, st.round));
  return o;
}

Napi::Value ExploreConsume(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Object e = Napi::Object::New(env); e.Set("ok", Napi::Boolean::New(env, false)); e.Set("msg", Napi::String::New(env, "bad args")); return e;
  }
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  std::string sid = info[1].As<Napi::String>().Utf8Value();
  std::string costType = info[2].IsString() ? info[2].As<Napi::String>().Utf8Value() : "other";
  ExploreState& st = getExplore(roomId);
  auto it = st.players.find(sid);
  if (it == st.players.end()) {
    ExplorePlayerState p;
    p.dice = rollDice(1, 6);
    p.used = 0;
    st.players[sid] = p;
  }
  ExplorePlayerState& p = st.players[sid];
  Napi::Object o = Napi::Object::New(env);
  o.Set("dice", Napi::Number::New(env, p.dice));
  o.Set("used", Napi::Number::New(env, p.used));
  // ★ 次数上限：已操作次数 ≥ 骰子点数 → 本回合操作次数用尽
  if (p.ended || p.used >= p.dice) {
    o.Set("skipped", Napi::Boolean::New(env, true));
    o.Set("newCost", Napi::Number::New(env, p.cost));
    o.Set("forcedEnd", Napi::Boolean::New(env, false));
    o.Set("ended", Napi::Boolean::New(env, p.ended));
    o.Set("actionCost", Napi::Number::New(env, 0.0));
    o.Set("reason", Napi::String::New(env, p.ended ? "ended" : "limit"));
    return o;
  }
  double actionCost = exploreCostFor(costType); // ★ 归零：成本由 KP 判定层管理
  p.used += 1;
  o.Set("actionCost", Napi::Number::New(env, actionCost));
  o.Set("used", Napi::Number::New(env, p.used));
  o.Set("newCost", Napi::Number::New(env, p.cost));
  o.Set("forcedEnd", Napi::Boolean::New(env, false));
  o.Set("ended", Napi::Boolean::New(env, p.ended));
  o.Set("skipped", Napi::Boolean::New(env, false));
  return o;
}

Napi::Value ExploreEndPlayer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Object e = Napi::Object::New(env); e.Set("ok", Napi::Boolean::New(env, false)); e.Set("msg", Napi::String::New(env, "bad args")); return e;
  }
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  std::string sid = info[1].As<Napi::String>().Utf8Value();
  ExploreState& st = getExplore(roomId);
  Napi::Object o = Napi::Object::New(env);
  auto it = st.players.find(sid);
  if (it == st.players.end()) { o.Set("ok", Napi::Boolean::New(env, false)); return o; }
  it->second.ended = true;
  o.Set("ok", Napi::Boolean::New(env, true));
  o.Set("dice", Napi::Number::New(env, it->second.dice));
  o.Set("cost", Napi::Number::New(env, it->second.cost));
  return o;
}

Napi::Value ExploreAllEnded(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsArray()) {
    Napi::Object e = Napi::Object::New(env); e.Set("allEnded", Napi::Boolean::New(env, false)); return e;
  }
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  Napi::Array sids = info[1].As<Napi::Array>();
  ExploreState& st = getExplore(roomId);
  bool allEnded = st.active;
  uint32_t len = sids.Length();
  if (!len) { allEnded = false; }
  for (uint32_t i = 0; i < len; i++) {
    std::string sid = sids.Get(i).As<Napi::String>().Utf8Value();
    auto it = st.players.find(sid);
    if (it == st.players.end() || !it->second.ended) { allEnded = false; break; }
  }
  Napi::Object o = Napi::Object::New(env);
  o.Set("allEnded", Napi::Boolean::New(env, allEnded));
  return o;
}

// ==================== 战斗 ====================
static void buildBattleCycle(BattleState& b) {
  b.cycle.clear();
  double monDex = 15.0;
  for (auto& m : b.monsters) if (m.dex > monDex) monDex = m.dex;
  double maxPlayerDex = 20.0;
  for (auto& u : b.units) if (u.dex > maxPlayerDex) maxPlayerDex = u.dex;
  std::vector<BattleUnit*> sorted;
  for (auto& u : b.units) sorted.push_back(&u);
  std::sort(sorted.begin(), sorted.end(), [](BattleUnit* a, BattleUnit* b2){ return a->dex > b2->dex; });
  for (auto* u : sorted) {
    int rounds = std::max(1, (int)std::lround(u->dex / monDex));
    for (int i = 0; i < rounds; i++) { CycleNode n; n.isPlayer = true; n.sid = u->sid; b.cycle.push_back(n); }
  }
  int monRounds = std::max(1, (int)std::lround(monDex / maxPlayerDex));
  for (int i = 0; i < monRounds; i++) { CycleNode n; n.isPlayer = false; b.cycle.push_back(n); }
}

Napi::Value BattleStart(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  Napi::Array pArr = info[1].As<Napi::Array>();
  Napi::Array mArr = info[2].As<Napi::Array>();
  BattleState& b = getBattle(roomId);
  b = BattleState();
  b.started = true;
  for (uint32_t i = 0; i < pArr.Length(); i++) {
    Napi::Object po = pArr.Get(i).As<Napi::Object>();
    BattleUnit u;
    u.sid = po.Get("sid").As<Napi::String>().Utf8Value();
    u.name = po.Has("name") ? po.Get("name").As<Napi::String>().Utf8Value() : u.sid;
    u.career = po.Has("career") ? po.Get("career").As<Napi::String>().Utf8Value() : "";
    u.energyDice = po.Has("energyDice") ? po.Get("energyDice").As<Napi::String>().Utf8Value() : "3D6";
    u.dex = po.Has("dex") ? po.Get("dex").As<Napi::Number>().DoubleValue() : 20.0;
    u.str = po.Has("str") ? po.Get("str").As<Napi::Number>().DoubleValue() : 40.0;
    u.per = po.Has("per") ? po.Get("per").As<Napi::Number>().DoubleValue() : 40.0;
    u.maxHp = po.Has("maxHp") ? po.Get("maxHp").As<Napi::Number>().Int32Value() : 80;
    u.hp = po.Has("hp") ? po.Get("hp").As<Napi::Number>().Int32Value() : u.maxHp;
    b.units.push_back(u);
  }
  for (uint32_t i = 0; i < mArr.Length(); i++) {
    Napi::Object mo = mArr.Get(i).As<Napi::Object>();
    MonsterUnit m;
    m.type = mo.Get("type").As<Napi::String>().Utf8Value();
    m.name = mo.Has("name") ? mo.Get("name").As<Napi::String>().Utf8Value() : m.type;
    m.dex = mo.Has("dex") ? mo.Get("dex").As<Napi::Number>().DoubleValue() : 15.0;
    m.maxHp = mo.Has("maxHp") ? mo.Get("maxHp").As<Napi::Number>().Int32Value() : 15;
    m.hp = m.maxHp;
    m.attackDamage = mo.Has("attackDamage") ? mo.Get("attackDamage").As<Napi::Number>().Int32Value() : 6;
    b.monsters.push_back(m);
  }
  buildBattleCycle(b);
  b.cycleIndex = 0;
  b.over = false;
  b.waitingFor.clear();
  b.energy = 0;
  Napi::Object o = Napi::Object::New(env);
  o.Set("units", Napi::Number::New(env, (double)b.units.size()));
  o.Set("monsters", Napi::Number::New(env, (double)b.monsters.size()));
  o.Set("cycleLen", Napi::Number::New(env, (double)b.cycle.size()));
  return o;
}

static bool checkOver(BattleState& b) {
  if (b.over) return true;
  bool monAll = true;
  for (auto& m : b.monsters) if (!m.dead) { monAll = false; break; }
  bool plAll = true;
  for (auto& u : b.units) if (!u.dead) { plAll = false; break; }
  if (monAll || plAll) b.over = true;
  return b.over;
}

static bool advanceToActor(BattleState& b) {
  int guard = 0;
  while (guard++ < (int)b.cycle.size() + 2) {
    if (b.cycleIndex >= (int)b.cycle.size()) b.cycleIndex = 0;
    const CycleNode& node = b.cycle[b.cycleIndex];
    if (node.isPlayer) {
      BattleUnit* u = nullptr;
      for (auto& x : b.units) if (x.sid == node.sid) { u = &x; break; }
      if (u && !u->dead) return true;
    } else {
      bool alive = false;
      for (auto& m : b.monsters) if (!m.dead) { alive = true; break; }
      if (alive) return true;
    }
    b.cycleIndex++;
  }
  return false;
}

Napi::Value BattleCurrent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  BattleState& b = getBattle(roomId);
  Napi::Object o = Napi::Object::New(env);
  if (!b.started) { o.Set("over", Napi::Boolean::New(env, true)); o.Set("msg", Napi::String::New(env, "no battle")); return o; }
  if (checkOver(b)) { o.Set("over", Napi::Boolean::New(env, true)); return o; }

  if (!b.waitingFor.empty()) {
    BattleUnit* u = nullptr;
    for (auto& x : b.units) if (x.sid == b.waitingFor) { u = &x; break; }
    if (u && !u->dead && b.energy >= ENERGY_COST_ATTACK) {
      o.Set("over", Napi::Boolean::New(env, false));
      o.Set("type", Napi::String::New(env, "player"));
      o.Set("sid", Napi::String::New(env, b.waitingFor));
      o.Set("energy", Napi::Number::New(env, b.energy));
      o.Set("energyDice", Napi::String::New(env, b.energyDice));
      return o;
    }
    b.waitingFor.clear();
    b.cycleIndex++;
  }

  if (!advanceToActor(b)) {
    b.cycleIndex = 0;
    if (!advanceToActor(b)) { checkOver(b); o.Set("over", Napi::Boolean::New(env, true)); return o; }
  }
  const CycleNode& node = b.cycle[b.cycleIndex];
  if (node.isPlayer) {
    BattleUnit* u = nullptr;
    for (auto& x : b.units) if (x.sid == node.sid) { u = &x; break; }
    if (!u || u->dead) {
      b.cycleIndex++;
      return BattleCurrent(info);
    }
    int cnt = parseDiceCount(u->energyDice);
    int energy = rollDice(cnt, 6);
    u->energy = energy;
    b.energy = energy;
    b.energyDice = u->energyDice;
    b.waitingFor = u->sid;
    o.Set("over", Napi::Boolean::New(env, false));
    o.Set("type", Napi::String::New(env, "player"));
    o.Set("sid", Napi::String::New(env, u->sid));
    o.Set("energy", Napi::Number::New(env, energy));
    o.Set("energyDice", Napi::String::New(env, u->energyDice));
    return o;
  }
  o.Set("over", Napi::Boolean::New(env, false));
  o.Set("type", Napi::String::New(env, "monster"));
  return o;
}

Napi::Value BattlePlayerAct(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  std::string sid = info[1].As<Napi::String>().Utf8Value();
  std::string action = info[2].IsString() ? info[2].As<Napi::String>().Utf8Value() : "end";
  int skillDmg = info[3].IsNumber() ? info[3].As<Napi::Number>().Int32Value() : 15;
  BattleState& b = getBattle(roomId);
  Napi::Object o = Napi::Object::New(env);
  if (b.over) { o.Set("ok", Napi::Boolean::New(env, false)); o.Set("msg", Napi::String::New(env, "战斗已结束")); return o; }
  if (b.waitingFor != sid) { o.Set("ok", Napi::Boolean::New(env, false)); o.Set("msg", Napi::String::New(env, "还没轮到你的行动轮")); return o; }
  BattleUnit* u = nullptr;
  for (auto& x : b.units) if (x.sid == sid) { u = &x; break; }
  if (!u || u->dead) { o.Set("ok", Napi::Boolean::New(env, false)); o.Set("msg", Napi::String::New(env, "你已无法行动")); return o; }

  if (action == "end") {
    b.waitingFor.clear();
    b.cycleIndex++;
    o.Set("ok", Napi::Boolean::New(env, true));
    o.Set("msg", Napi::String::New(env, u->name + " 结束了本轮行动"));
    o.Set("end", Napi::Boolean::New(env, true));
    o.Set("energy", Napi::Number::New(env, b.energy));
    return o;
  }
  if (action == "flee") {
    u->dead = true;
    b.waitingFor.clear();
    b.cycleIndex++;
    checkOver(b);
    o.Set("ok", Napi::Boolean::New(env, true));
    o.Set("msg", Napi::String::New(env, u->name + " 撤退了"));
    o.Set("flee", Napi::Boolean::New(env, true));
    o.Set("over", Napi::Boolean::New(env, b.over));
    return o;
  }
  int cost = (action == "skill") ? ENERGY_COST_SKILL : (action == "item" ? ENERGY_COST_ITEM : ENERGY_COST_ATTACK);
  if (b.energy < cost) {
    o.Set("ok", Napi::Boolean::New(env, false));
    o.Set("msg", Napi::String::New(env, "能量不足（需要 " + std::to_string(cost) + "，剩余 " + std::to_string(b.energy) + "），可点「结束行动」"));
    return o;
  }
  MonsterUnit* mon = nullptr;
  for (auto& m : b.monsters) if (!m.dead) { mon = &m; break; }
  if (!mon) { checkOver(b); o.Set("ok", Napi::Boolean::New(env, true)); o.Set("over", Napi::Boolean::New(env, true)); o.Set("win", Napi::Boolean::New(env, true)); o.Set("msg", Napi::String::New(env, "所有敌人已被消灭！")); return o; }

  if (action == "item") {
    u->hp = std::min(u->maxHp, u->hp + 5);
    b.energy -= cost;
    o.Set("ok", Napi::Boolean::New(env, true));
    o.Set("msg", Napi::String::New(env, u->name + " 服用消耗品，回复 5 HP"));
    o.Set("hp", Napi::Number::New(env, u->hp));
    o.Set("energy", Napi::Number::New(env, b.energy));
    return o;
  }
  int dmg = 0;
  if (action == "skill") {
    dmg = std::max(4, (int)(skillDmg + std::lround(u->per * 0.3)));
  } else {
    dmg = std::max(2, (int)(std::lround(u->str * 0.4) + 3));
  }
  mon->hp -= dmg;
  b.energy -= cost;
  bool monDead = mon->hp <= 0;
  if (monDead) mon->dead = true;
  o.Set("ok", Napi::Boolean::New(env, true));
  o.Set("dmg", Napi::Number::New(env, dmg));
  o.Set("energy", Napi::Number::New(env, b.energy));
  bool allDead = checkOver(b);
  if (allDead) {
    o.Set("over", Napi::Boolean::New(env, true));
    o.Set("win", Napi::Boolean::New(env, true));
    o.Set("msg", Napi::String::New(env, u->name + " 造成 " + std::to_string(dmg) + " 点伤害，" + mon->name + " 被消灭！"));
  } else {
    o.Set("over", Napi::Boolean::New(env, false));
    o.Set("msg", Napi::String::New(env, u->name + " 造成 " + std::to_string(dmg) + " 点伤害，" + mon->name + " 剩余 HP " + std::to_string(std::max(0, mon->hp))));
  }
  return o;
}

Napi::Value BattleMonsterAct(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  BattleState& b = getBattle(roomId);
  Napi::Object o = Napi::Object::New(env);
  if (checkOver(b)) { o.Set("over", Napi::Boolean::New(env, true)); return o; }
  MonsterUnit* mon = nullptr;
  for (auto& m : b.monsters) if (!m.dead) { mon = &m; break; }
  if (!mon) { checkOver(b); o.Set("over", Napi::Boolean::New(env, true)); return o; }
  std::vector<BattleUnit*> targets;
  for (auto& u : b.units) if (!u.dead) targets.push_back(&u);
  if (!targets.empty()) {
    BattleUnit* t = targets[rollDice(1, (int)targets.size()) - 1];
    int dmg = mon->attackDamage;
    t->hp = std::max(0, t->hp - dmg);
    o.Set("target", Napi::String::New(env, t->name));
    o.Set("dmg", Napi::Number::New(env, dmg));
    o.Set("hp", Napi::Number::New(env, t->hp));
  }
  b.cycleIndex++;
  bool over = checkOver(b);
  o.Set("over", Napi::Boolean::New(env, over));
  o.Set("msg", Napi::String::New(env, mon->name + " 发动攻击"));
  return o;
}

Napi::Value BattleStatus(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  BattleState& b = getBattle(roomId);
  Napi::Object o = Napi::Object::New(env);
  o.Set("over", Napi::Boolean::New(env, b.over));
  o.Set("started", Napi::Boolean::New(env, b.started));
  Napi::Array units = Napi::Array::New(env);
  int idx = 0;
  for (auto& u : b.units) {
    Napi::Object uo = Napi::Object::New(env);
    uo.Set("sid", Napi::String::New(env, u.sid));
    uo.Set("name", Napi::String::New(env, u.name));
    uo.Set("hp", Napi::Number::New(env, u.hp));
    uo.Set("maxHp", Napi::Number::New(env, u.maxHp));
    uo.Set("dead", Napi::Boolean::New(env, u.dead));
    units.Set(idx++, uo);
  }
  o.Set("units", units);
  Napi::Array mons = Napi::Array::New(env);
  idx = 0;
  for (auto& m : b.monsters) {
    Napi::Object mo = Napi::Object::New(env);
    mo.Set("type", Napi::String::New(env, m.type));
    mo.Set("name", Napi::String::New(env, m.name));
    mo.Set("hp", Napi::Number::New(env, std::max(0, m.hp)));
    mo.Set("maxHp", Napi::Number::New(env, m.maxHp));
    mo.Set("dead", Napi::Boolean::New(env, m.dead));
    mons.Set(idx++, mo);
  }
  o.Set("monsters", mons);
  o.Set("waitingFor", Napi::String::New(env, b.waitingFor));
  o.Set("energy", Napi::Number::New(env, b.energy));
  return o;
}

Napi::Value RoomReset(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  g_rooms.erase(roomId);
  return Napi::Boolean::New(env, true);
}

// 仅重置战斗状态（保留探索回合）
Napi::Value BattleReset(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string roomId = info[0].As<Napi::String>().Utf8Value();
  g_rooms[roomId].battle = BattleState();
  return Napi::Boolean::New(env, true);
}

// ==================== 模块初始化 ====================
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("exploreStart", Napi::Function::New(env, ExploreStart));
  exports.Set("explorePlayerDice", Napi::Function::New(env, ExplorePlayerDice));
  exports.Set("exploreConsume", Napi::Function::New(env, ExploreConsume));
  exports.Set("exploreEndPlayer", Napi::Function::New(env, ExploreEndPlayer));
  exports.Set("exploreAllEnded", Napi::Function::New(env, ExploreAllEnded));
  exports.Set("battleStart", Napi::Function::New(env, BattleStart));
  exports.Set("battleCurrent", Napi::Function::New(env, BattleCurrent));
  exports.Set("battlePlayerAct", Napi::Function::New(env, BattlePlayerAct));
  exports.Set("battleMonsterAct", Napi::Function::New(env, BattleMonsterAct));
  exports.Set("battleStatus", Napi::Function::New(env, BattleStatus));
  exports.Set("battleReset", Napi::Function::New(env, BattleReset));
  exports.Set("roomReset", Napi::Function::New(env, RoomReset));
  return exports;
}

NODE_API_MODULE(battle_engine, Init)
