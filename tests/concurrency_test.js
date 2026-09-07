/**
 * concurrency_test.js — 多人并发稳定性验证脚本
 *
 * 测试范围：
 *  1. 多用户同时连接（Socket.IO 并发握手）
 *  2. 多用户同时加入同一房间（竞态条件）
 *  3. 并发 playerAction 发送（状态一致性）
 *  4. 房间列表并发查询
 *  5. 断线重连压力
 *
 * 用法：node concurrency_test.js [用户数] [用例名]
 *   例：node concurrency_test.js 5 all      # 5 用户跑全部用例
 *       node concurrency_test.js 10 rooms   # 10 用户仅跑房间用例
 */

const { io: Client } = require('socket.io-client');

// ==================== 配置 ====================
const SERVER_URL = 'http://localhost:3000';
const USER_COUNT = parseInt(process.argv[2]) || 5;
const TEST_CASE = process.argv[3] || 'all';
const TIMEOUT = 15000;

// 状态追踪
const stats = {
  connects: 0, connectFails: 0,
  logins: 0, loginFails: 0,
  charSelects: 0, charFail: 0,
  roomCreations: 0, roomCreationFails: 0,
  roomJoins: 0, roomJoinFails: 0,
  roomLeaves: 0,
  startCopies: 0, startCopyFails: 0,
  actions: 0, actionFails: 0,
  aiReplies: 0, privateReplies: 0,
  disconnects: 0, disconnectErrors: 0
};

let testUsers = [];
let allClients = [];
let errors = [];

// ==================== 工具函数 ====================
function log(msg) { console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`); }
function logErr(msg) { console.error(`[${new Date().toISOString().slice(11, 23)}] ❌ ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createClient(id) {
  const client = Client(SERVER_URL, {
    reconnection: false,
    timeout: 10000,
    transports: ['websocket', 'polling']
  });
  client._uid = `test_user_${id}`;
  client._charUid = null;
  client._name = `测试员${id}`;
  client._tag = `[用户${id}]`;
  return client;
}

// ==================== 测试用例 ====================

// 用例1: 并发连接与登录
async function testConcurrentConnect(count) {
  log(`\n========== 用例1: ${count} 用户并发连接与登录 ==========`);

  const connectPromises = [];
  for (let i = 0; i < count; i++) {
    connectPromises.push(new Promise((resolve) => {
      const client = createClient(i + 1);
      client.on('connect', () => {
        stats.connects++;
        client.emit('login', { username: client._uid, password: 'test123' });
      });
      client.on('connect_error', (err) => {
        stats.connectFails++;
        errors.push(`${client._tag} 连接失败: ${err.message}`);
        resolve();
      });
      client.on('authSuccess', ({ uid }) => {
        stats.logins++;
        client._uid = uid;
        client.emit('getCharacterList', { uid });
      });
      client.on('authError', ({ msg }) => {
        stats.loginFails++;
        // 首次运行可能没有账号，尝试注册
        client.emit('register', { username: client._uid, password: 'test123' });
      });
      client.on('characterList', ({ characters }) => {
        if (characters && characters.length > 0) {
          client._charUid = characters[0].uid;
          stats.charSelects++;
          client.emit('selectCharacter', { characterUid: characters[0].uid });
        } else {
          // 创建角色
          client.emit('createCharacter', { uid: client._uid, characterData: {
            name: client._name,
            career: '私家侦探',
            attr: { str: 50, dex: 60, con: 45, per: 80, wil: 55 }
          }});
        }
      });
      client.on('characterCreated', ({ character }) => {
        client._charUid = character.uid;
        stats.charSelects++;
        client.emit('selectCharacter', { characterUid: character.uid });
      });
      client.on('characterSelected', () => {
        allClients.push(client);
        testUsers.push(client);
        resolve();
      });

      setTimeout(() => {
        if (!allClients.includes(client)) {
          stats.connectFails++;
          errors.push(`${client._tag} 登录超时`);
          resolve();
        }
      }, TIMEOUT);
    }));
  }

  await Promise.all(connectPromises);
  log(`结果: ${testUsers.length}/${count} 用户准备就绪 | 连接:${stats.connects} 登录:${stats.logins} 角色:${stats.charSelects}`);
  return testUsers.length >= Math.min(count, 3);
}

// 用例2: 并发加入同一房间
async function testConcurrentRoomJoin() {
  log(`\n========== 用例2: ${testUsers.length} 用户并发加入同一房间 ==========`);
  if (testUsers.length < 2) { log('跳过：用户不足2人'); return true; }

  // 第一个用户创建房间
  const host = testUsers[0];
  let roomId = null;
  let roomCode = null;

  await new Promise(resolve => {
    host.emit('createRoom', { isPrivate: false, copyName: '废都纪元800｜青峰山虚空列车' });
    host.on('roomJoined', ({ roomId: rid, roomCode: rc }) => {
      stats.roomCreations++;
      roomId = rid;
      roomCode = rc;
      log(`房主 ${host._name} 创建房间: ${rid}`);
      resolve();
    });
    setTimeout(() => {
      if (!roomId) {
        stats.roomCreationFails++;
        errors.push('房间创建超时');
        resolve();
      }
    }, 5000);
  });

  if (!roomId) { log('跳过：房间创建失败'); return false; }

  // 剩余用户并发加入
  const members = testUsers.slice(1, Math.min(testUsers.length, 6));
  log(`并发加入: ${members.length} 用户`);

  const joinPromises = members.map(client => new Promise(resolve => {
    client.emit('joinPublicRoom', { roomId });
    client.on('roomJoined', () => { stats.roomJoins++; resolve(); });
    client.on('error', ({ msg }) => {
      if (msg.includes('已经在一个房间')) {
        // 先离开再重新加入
        client.emit('leaveRoom');
        client.on('leftRoom', () => {
          client.emit('joinPublicRoom', { roomId });
        });
        setTimeout(resolve, 8000);
      } else {
        stats.roomJoinFails++;
        errors.push(`${client._tag} 加入房间失败: ${msg}`);
        resolve();
      }
    });
    setTimeout(() => { stats.roomJoinFails++; resolve(); }, 5000);
  }));

  await Promise.all(joinPromises);
  log(`结果: 创建:${stats.roomCreations} 加入:${stats.roomJoins}/${members.length}`);
  return stats.roomJoins >= members.length * 0.7;
}

// 用例3: 并发 playerAction（核心并发测试）
async function testConcurrentActions() {
  log(`\n========== 用例3: 并发 playerAction（每人3条） ==========`);
  if (testUsers.length === 0) { log('跳过：无活跃用户'); return true; }

  // 确保在游戏房间中（由 testConcurrentRoomJoin 已测试）
  let gameRoomId = null;

  // 先全员离开旧房间，由房主重新创建并开始副本
  for (const client of testUsers) {
    await new Promise(resolve => {
      client.emit('leaveRoom');
      client.on('leftRoom', () => { stats.roomLeaves++; resolve(); });
      if (client._uid === testUsers[0]._uid) {
        client.on('roomDissolved', resolve);
      }
      setTimeout(resolve, 2000);
    });
  }

  await sleep(1000);

  // 房主创建房间并开始副本
  const host = testUsers[0];
  await new Promise(resolve => {
    host.emit('createRoom', { isPrivate: false, copyName: '废都纪元800｜青峰山虚空列车' });
    host.on('roomJoined', ({ roomId }) => {
      roomId = roomId;
      log(`房间重建: ${roomId}`);

      // 成员加入
      const joinChain = async () => {
        for (let i = 1; i < testUsers.length; i++) {
          await new Promise(r => {
            testUsers[i].emit('joinPublicRoom', { roomId });
            testUsers[i].on('roomJoined', r);
            testUsers[i].on('error', () => r());
            setTimeout(r, 3000);
          });
        }
        // 开始副本
        host.emit('startCopy', { copyName: '废都纪元800｜青峰山虚空列车' });
        host.on('copyStart', () => { stats.startCopies++; log('副本已开始！'); resolve(); });
        setTimeout(() => { stats.startCopyFails++; resolve(); }, 5000);
      };
      joinChain();
    });
    setTimeout(resolve, 15000);
  });

  await sleep(2000);

  // 所有用户并发发送3轮行动
  const actionRounds = 3;
  for (let round = 0; round < actionRounds; round++) {
    log(`--- 行动轮次 ${round + 1}/${actionRounds} ---`);
    const actionPromises = testUsers.map(client => new Promise(resolve => {
      const actions = ['环顾四周', '检查脚下', '向前移动', '检查墙壁', '倾听声音', '查看仪表盘', '蹲下观察', '触摸扶手'];
      const action = actions[(round * testUsers.length + testUsers.indexOf(client)) % actions.length];
      client.emit('playerAction', { content: action });
      stats.actions++;
      // 等待 KP 回应
      const onReply = () => { stats.aiReplies++; client.off('aiReply', onReply); client.off('error', onError); resolve(); };
      const onError = () => { stats.actionFails++; client.off('aiReply', onReply); client.off('error', onError); resolve(); };
      client.on('aiReply', onReply);
      client.on('error', onError);
      // DeepSeek 可能需要时间
      setTimeout(() => { client.off('aiReply', onReply); client.off('error', onError); resolve(); }, 12000);
    }));

    await Promise.all(actionPromises);
    await sleep(500); // 轮间休息
  }

  log(`结果: 行动:${stats.actions} KP回应:${stats.aiReplies} 失败:${stats.actionFails}`);
  return stats.aiReplies > 0;
}

// 用例4: 并发私密频道
async function testConcurrentPrivateActions() {
  log(`\n========== 用例4: 并发 privateAction ==========`);
  if (testUsers.length === 0) { log('跳过：无活跃用户'); return true; }

  const pvtPromises = testUsers.map(client => new Promise(resolve => {
    client.emit('privateAction', { content: 'KP，我目前的属性值能做什么？' });
    client.on('privateMsg', ({ msg, sender }) => {
      if (sender === 'KP') {
        stats.privateReplies++;
        resolve();
      }
    });
    client.on('error', resolve);
    setTimeout(resolve, 12000);
  }));

  await Promise.all(pvtPromises);
  log(`结果: 私密回应: ${stats.privateReplies}/${testUsers.length}`);
  return true;
}

// 用例5: 并发断线重连
async function testConcurrentReconnect() {
  log(`\n========== 用例5: 断线重连压力 ==========`);
  if (testUsers.length < 2) { log('跳过：不足2人'); return true; }

  // 随机选择一半用户断开
  const disconnectCount = Math.ceil(testUsers.length / 2);
  const victims = testUsers.slice(0, disconnectCount);

  for (const client of victims) {
    client.disconnect();
    stats.disconnects++;
  }

  await sleep(2000);

  // 重新连接
  const reconnectPromises = victims.map((oldClient, i) => new Promise(resolve => {
    const newClient = createClient(testUsers.length + i + 1);
    newClient.on('connect', () => {
      newClient.emit('login', { username: oldClient._uid, password: 'test123' });
    });
    newClient.on('authSuccess', ({ uid }) => {
      newClient.emit('getCharacterList', { uid });
    });
    newClient.on('characterList', ({ characters }) => {
      if (characters.length > 0) {
        newClient.emit('selectCharacter', { characterUid: characters[0].uid });
        newClient.on('characterSelected', () => {
          // 替换旧client引用
          const idx = testUsers.indexOf(oldClient);
          if (idx >= 0) testUsers[idx] = newClient;
          allClients.push(newClient);
          resolve();
        });
      } else { resolve(); }
    });
    newClient.on('connect_error', () => { stats.disconnectErrors++; resolve(); });
    setTimeout(resolve, 10000);
  }));

  await Promise.all(reconnectPromises);
  log(`结果: 断开:${stats.disconnects} 重连:${reconnectPromises.length}`);
  return true;
}

// 用例6: 并发房间列表查询
async function testConcurrentRoomList() {
  log(`\n========== 用例6: 房间列表并发轮询 ==========`);
  if (testUsers.length === 0) { log('跳过：无活跃用户'); return true; }

  let responses = 0;
  const pollPromises = testUsers.slice(0, 3).map(client => {
    return Promise.all(
      Array(5).fill(0).map(() => new Promise(resolve => {
        client.emit('getPublicRooms');
        client.on('roomList', () => { responses++; resolve(); });
        setTimeout(resolve, 2000);
      }))
    );
  });

  await Promise.all(pollPromises);
  log(`结果: 房间列表响应: ${responses} 次`);
  return responses > 0;
}

// ==================== 架构审查 ====================
function analyzeArchitecture() {
  log(`\n========== 架构并发安全性分析 ==========`);

  const findings = [];

  // 检查1: 单线程模型
  findings.push({
    severity: 'info',
    area: '事件循环模型',
    desc: 'Node.js 单线程事件循环。Socket.IO 回调在同一个事件循环中串行执行，不存在真正的多线程竞态条件。',
    risk: '低'
  });

  // 检查2: 共享可变状态
  findings.push({
    severity: 'warn',
    area: 'gameRooms dungeonState',
    desc: '副本状态（dungeonState）是共享可变对象。多个玩家的 playerAction 通过异步 DeepSeek 调用交错访问同一 state 对象。由于 JS 单线程，单次回调是原子的，但 DeepSeek 的 Promise.then 回调可能在状态已被修改后执行。',
    risk: '中',
    mitigation: '建议在 playerAction 中使用浅拷贝快照 state 当前值传递给 DeepSeek，而非等 DeepSeek 返回后再读 state。'
  });

  // 检查3: 文件 I/O
  findings.push({
    severity: 'warn',
    area: 'storage.js 同步文件读写',
    desc: 'loadAllUsers/saveAllUsers 使用 fs.readFileSync/writeFileSync。同一文件被多个异步 handler 并发写入时，后写者可能覆盖先写者的更新（写丢失）。',
    risk: '中',
    mitigation: '使用 writeFileSync 本身是原子写入（先写临时文件再 rename），但并发读取到的可能不是最新数据。建议加写锁或改用内存缓存 + 异步持久化。'
  });

  // 检查4: 房间操作
  findings.push({
    severity: 'info',
    area: 'hallRooms Map 操作',
    desc: 'Socket.IO 对同一 socket 的事件按序执行，但不同 socket 的事件可交错。joinPublicRoom 先检查 playerHallMap.has 再 set——两个 socket 几乎同时触发时无竞态（同一事件循环 tick 内）。',
    risk: '低'
  });

  // 检查5: 第6个检查 - 连接限制
  findings.push({
    severity: 'warn',
    area: '无连接数/速率限制',
    desc: '没有 maxConnections、没有 rate limiting。恶意或异常的并发连接可能导致内存耗尽或 DeepSeek API 被限流。',
    risk: '中',
    mitigation: '建议添加 io.engine 的 maxHttpBufferSize 和 perMessageDeflate 配置，以及接入速率限制中间件。'
  });

  // 检查6: DeepSeek 并发
  findings.push({
    severity: 'warn',
    area: 'DeepSeek API 并发调用',
    desc: '多个玩家同时发送 playerAction 会并发调用 DeepSeek API。无并发限制或去重，可能导致 API 费用暴增、响应延迟叠加。',
    risk: '中',
    mitigation: '建议对同一房间的 DeepSeek 调用做串行化（队列）或限流（如每秒最多1次）。'
  });

  // 输出报告
  for (const f of findings) {
    const icon = f.severity === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`\n${icon} [${f.risk}风险] ${f.area}`);
    console.log(`   ${f.desc}`);
    if (f.mitigation) console.log(`   ✅ 建议: ${f.mitigation}`);
  }

  return findings;
}

// ==================== 主流程 ====================
async function main() {
  console.log('================================================');
  console.log('   寂静之地 · 并发稳定性压力测试');
  console.log(`   目标服务器: ${SERVER_URL}`);
  console.log(`   模拟用户数: ${USER_COUNT}`);
  console.log(`   测试用例: ${TEST_CASE}`);
  console.log('================================================');

  const startTime = Date.now();
  let allPassed = true;

  // 先跑架构分析
  const findings = analyzeArchitecture();

  if (TEST_CASE === 'analyze') {
    // 仅架构分析
  } else {
    // 连接测试
    const ok = await testConcurrentConnect(USER_COUNT);
    if (!ok) allPassed = false;

    if (TEST_CASE === 'all' || TEST_CASE === 'rooms') {
      const rOk = await testConcurrentRoomJoin();
      if (!rOk) allPassed = false;
    }

    if (TEST_CASE === 'all' || TEST_CASE === 'actions') {
      const aOk = await testConcurrentActions();
      if (!aOk) allPassed = false;
      const pOk = await testConcurrentPrivateActions();
      if (!pOk) allPassed = false;
    }

    if (TEST_CASE === 'all' || TEST_CASE === 'network') {
      await testConcurrentReconnect();
    }

    if (TEST_CASE === 'all') {
      await testConcurrentRoomList();
    }
  }

  // 汇总
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n================================================`);
  console.log(`  测试完成 | 耗时 ${elapsed}s | ${allPassed ? '✅ 全部通过' : '⚠️ 部分失败'}`);
  console.log('================================================');
  console.log(`  连接: ${stats.connects} | 登录: ${stats.logins} | 角色: ${stats.charSelects}`);
  console.log(`  房间创建: ${stats.roomCreations} | 加入: ${stats.roomJoins} | 离开: ${stats.roomLeaves}`);
  console.log(`  副本: ${stats.startCopies} | 行动: ${stats.actions} | KP回应: ${stats.aiReplies}`);
  console.log(`  私密回应: ${stats.privateReplies} | 断开: ${stats.disconnects}`);
  console.log(`  错误数: ${errors.length}`);
  if (errors.length > 0) {
    console.log(`  前5个错误:`);
    errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
  }
  console.log('================================================');

  // 清理
  allClients.forEach(c => { try { c.disconnect(); } catch(e) {} });
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error('测试脚本异常:', err); process.exit(2); });
