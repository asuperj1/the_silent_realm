/**
 * multiplayer_p2_client.js — 第二玩家自动化驱动（多人组队回合验证用）
 * 连接 Socket.IO → 登录 demo_p2 → 选 P2方士 → 加入房主公开房间 → 参与回合战斗
 * 命令（stdin）：join / attack <target> / skill <id> / end / urge / list / status
 * 事件自动打印：roomJoined / gameStart / battleStart / battleTurn / battleEvent / privateMsg / publicMsg / error
 */
const io = require('socket.io-client');
const readline = require('readline');

const URL = process.env.SRV || 'http://localhost:3000';
const USER = process.env.P2_USER || 'demo_p2';
const PASS = process.env.P2_PASS || 'demo_p2_123';
const CHAR_NAME = process.env.P2_CHAR || 'P2方士';
const COPY_NAME = process.env.P2_COPY || '废都纪元800｜青峰山虚空列车';

const log = (...a) => console.log('[P2]', ...a);

const socket = io(URL, { transports: ['websocket'], reconnection: false });

let myCharUid = null;
let roomId = null;

const EVENTS = [
  'connect', 'disconnect', 'authSuccess', 'authError', 'characterList', 'characterSelected',
  'roomList', 'roomJoined', 'leftRoom', 'roomStateSync', 'kickedFromRoom', 'error',
  'copyStart', 'resumeGameResult', 'resumePlayer', 'roomUpdate',
  'exploreUpdate', 'exploreRound', 'dungeonStateUpdate', 'dungeonActionResult',
  'battleStart', 'battleTurn', 'battleEvent', 'battleIntent',
  'privateMsg', 'publicMsg', 'systemMsg', 'msg', 'chatMsg'
];

EVENTS.forEach(ev => {
  socket.on(ev, (d) => {
    try {
      const s = JSON.stringify(d);
      if (s && s.length > 350) log(ev, s.slice(0, 350) + '…');
      else log(ev, s === undefined ? '' : s);
    } catch (e) { log(ev, String(d)); }
  });
});

socket.on('connect', () => {
  log('connected', socket.id);
  socket.emit('login', { username: USER, password: PASS });
});

socket.on('authSuccess', (d) => {
  log('login ok', d.username, d.uid);
  socket.emit('getCharacterList', { uid: d.uid });
});

socket.on('characterList', (d) => {
  const chars = d.characters || [];
  const c = chars.find(x => x.name === CHAR_NAME) || chars[0];
  if (!c) { log('no character'); return; }
  myCharUid = c.uid;
  log('selectCharacter', c.name, c.uid, c.career);
  socket.emit('selectCharacter', { characterUid: c.uid });
});

socket.on('battleStart', (d) => { log('BATTLE-START'); if (d && d.status) onBattleStatus(d.status); });
socket.on('battleTurn', (d) => { log('BATTLE-TURN'); if (d && d.status) onBattleStatus(d.status); });
socket.on('battleEvent', (d) => {
  const st = d && d.status;
  log('BATTLE-EVENT', JSON.stringify(d && d.msg ? { msg: d.msg } : d).slice(0, 180));
  if (st) onBattleStatus(st);
});

function onBattleStatus(status) {
  if (!status) return;
  const myU = (status.units || []).find(u => u.sid === socket.id);
  const waiting = status.waitingFor;
  log('BATTLE-STATUS phase=' + status.phase + ' waitingFor=' + waiting +
      ' myActed=' + (myU && myU.acted) + ' myOffline=' + (myU && myU.offline) +
      ' turn=' + status.turn + ' units=' + (status.units || []).map(u => u.name + ':' + (u.acted ? 'act' : 'wait') + (u.offline ? '/off' : '')).join(','));
}

// ===== 命令 =====
function cmdJoin() { socket.emit('getRoomList'); log('-> getRoomList'); }
function cmdResume() {
  if (!myCharUid) { log('resume: no char'); return; }
  socket.emit('resumeGame', { characterUid: myCharUid });
  log('-> resumeGame ' + myCharUid);
}
function cmdEndTurn() {
  // 多人回合同步：需先有一次行动创建本玩家回合记录，再结束回合
  socket.emit('playerAction', { content: '我观察四周的动静，保持警戒' });
  log('-> playerAction(观察四周) + exploreEnd');
  setTimeout(() => socket.emit('exploreEnd'), 600);
}
function cmdAttack(t) { socket.emit('battleAction', { action: 'attack', target: t || 0 }); log('-> attack target=' + (t || 0)); }
function cmdAct(text) {
  if (!text) { log('act: need text'); return; }
  socket.emit('playerAction', { content: text });
  log('-> playerAction ' + text);
}
function cmdSkill(id, t) { socket.emit('battleAction', { action: 'skill', skillId: id, target: t || 0 }); log('-> skill ' + id + ' t=' + (t || 0)); }
function cmdEnd() { socket.emit('battleAction', {}); log('-> end'); }
function cmdUrge() { socket.emit('battleUrge'); log('-> urge'); }
function cmdStatus() { socket.emit('syncRoomState'); log('-> syncRoomState'); }
function cmdAct(text) {
  if (!text) { log('act: need text'); return; }
  socket.emit('playerAction', { content: text });
  log('-> playerAction ' + text);
}

socket.on('roomList', (d) => {
  const rooms = d.rooms || [];
  const target = rooms.find(r => (r.copyName || '').includes('青峰山')) || rooms.find(r => !r.isPrivate) || rooms[0];
  log('roomList', JSON.stringify(rooms).slice(0, 220));
  if (target && !roomId) {
    log('joinPublicRoom ->', target.id);
    socket.emit('joinPublicRoom', { roomId: target.id });
  }
});
socket.on('roomJoined', (d) => { roomId = d.roomId; log('ROOM JOINED', d.roomId, 'players=' + (d.players || []).length); });

const rl = readline.createInterface({ input: process.stdin, terminal: true });
rl.setPrompt('P2> ');
rl.prompt();
rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const c = (parts[0] || '').toLowerCase();
  try {
    if (c === 'join') cmdJoin();
    else if (c === 'resume') cmdResume();
    else if (c === 'endturn') cmdEndTurn();
    else if (c === 'act') cmdAct(parts.slice(1).join(' '));
    else if (c === 'attack') cmdAttack(parts[1]);
    else if (c === 'skill') cmdSkill(parts[1], parts[2]);
    else if (c === 'end') cmdEnd();
    else if (c === 'urge') cmdUrge();
    else if (c === 'status') cmdStatus();
    else if (c === 'quit' || c === 'exit') process.exit(0);
    else log('unknown: ' + line);
  } catch (e) { log('cmd error', String(e)); }
  rl.prompt();
});
setTimeout(() => log('ready'), 1000);
