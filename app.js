const firebaseConfig = {
  apiKey: "AIzaSyB9Bygv0bF0pua7eaZrg0P7OKQxI7nQSSA",
  authDomain: "cs2wolf.firebaseapp.com",
  databaseURL: "https://cs2wolf-default-rtdb.firebaseio.com",
  projectId: "cs2wolf",
  storageBucket: "cs2wolf.firebasestorage.app",
  messagingSenderId: "363478226944",
  appId: "1:363478226944:web:925c9cf6cc3d646d0a60e5",
  measurementId: "G-7Z9VDLDPQ3"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const FIXED_ROOM_ID = "cs2";
const ADMIN_CODE = "tommy168";

const MAX_PLAYERS = 10;
const MAX_WAIT = 4;

// 队伍容量（你要“一边五个”）
const TEAM_CAP = 5;

const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const now = () => Date.now();

function qs(name){
  const p = new URLSearchParams(location.search);
  return p.get(name);
}
function isAdmin(){
  return qs("admin") === ADMIN_CODE;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function shortPid(pid){ return (pid || "").slice(0, 8); }

let myPlayerId = localStorage.getItem("cs2_site_playerId") || uid();
localStorage.setItem("cs2_site_playerId", myPlayerId);

const roomId = FIXED_ROOM_ID;
const roomRef = db.ref(`rooms/${roomId}`);
let snapshotCache = null;

// ===== UI refs =====
const entryPage = $("entryPage");
const roomPage  = $("roomPage");

const btnJoin   = $("btnJoin");
const btnLeave  = $("btnLeave");
const btnReset  = $("btnReset");
const btnSwitch = $("btnSwitch");

const btnStartDraft  = $("btnStartDraft");
const btnAssignRoles = $("btnAssignRoles");
const btnAdminPeek   = $("btnAdminPeek");

const stageLobby  = $("stageLobby");
const stageDraft  = $("stageDraft");
const stageReveal = $("stageReveal");
const stageTeams  = $("stageTeams");

const blueTeamBox = $("blueTeamBox");
const redTeamBox  = $("redTeamBox");
const waitingBox  = $("waitingBox");
const turnBlue    = $("turnBlue");
const turnRed     = $("turnRed");
const pickHint    = $("pickHint");
const draftHelpText = $("draftHelpText");

const myRoleCard = $("myRoleCard");
const btnConfirmRole = $("btnConfirmRole");
const revealStatus = $("revealStatus");
const revealHint = $("revealHint");

const teamsBlueOnly = $("teamsBlueOnly");
const teamsRedOnly  = $("teamsRedOnly");

$("roomTitle").textContent = roomId;
$("adminHint").classList.toggle("hidden", !isAdmin());

let adminPeekOn = false; // 管理员“查看”开关（默认不看）

function showEntry(){
  entryPage.classList.remove("hidden");
  roomPage.classList.add("hidden");
}
function showRoom(){
  entryPage.classList.add("hidden");
  roomPage.classList.remove("hidden");
}

// 关闭/断线自动退出
window.addEventListener("beforeunload", () => {
  try {
    roomRef.child(`players/${myPlayerId}`).remove();
    roomRef.child(`waitlist/${myPlayerId}`).remove();
  } catch {}
});

async function safeRemoveMe(){
  try { await roomRef.child(`players/${myPlayerId}`).remove(); } catch {}
  try { await roomRef.child(`waitlist/${myPlayerId}`).remove(); } catch {}
}

/** 随机选一个 */
function pickRandom(list){
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** 选人顺序（蛇形循环，人数不够就按剩余人停）
 * 展开：B, R, R, B, B, R, R, B... 循环
 */
const PICK_ORDER = ["blue","red","red","blue","blue","red","red","blue"];

/** 获取大厅参与者（只算 players，不算候补） */
function getPlayerIds(players){
  return Object.keys(players || {});
}

/** ====== 加入逻辑：大厅满了去候补；选人/身份阶段新加入只能去候补 ====== */
btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("先填：名字 + 段位（例：xGonv AK）");

  const me = { id: myPlayerId, displayName, joinedAt: now() };

  const result = await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.game = room.game || { phase: "lobby" };

    const phase = room.game.phase || "lobby";
    const pCount = Object.keys(room.players).length;
    const wCount = Object.keys(room.waitlist).length;

    // 已在房间则更新名字
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    // 选人/身份/名单阶段：只允许进候补（不影响流程）
    if (phase === "draft" || phase === "reveal" || phase === "teams") {
      if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = { ...me };
      return room;
    }

    // lobby：优先进大厅
    if (pCount < MAX_PLAYERS) {
      room.players[myPlayerId] = me;
      return room;
    }

    // 大厅满了去候补
    if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = { ...me };
    return room;
  });

  if (!result.committed) return alert("进房失败，刷新再试。");

  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  roomRef.child(`waitlist/${myPlayerId}`).onDisconnect().remove();

  showRoom();
};

btnLeave.onclick = async () => {
  const ok = confirm("确定要退出吗？");
  if (!ok) return;
  await safeRemoveMe();
  showEntry();
};

/** 切换大厅/候补（draft/reveal/teams 阶段锁死） */
btnSwitch.onclick = async () => {
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";

  if (phase === "draft" || phase === "reveal" || phase === "teams") {
    return alert("现在在流程里，切换锁死了，别捣乱🤣");
  }

  const players = state.players || {};
  const waitlist = state.waitlist || {};

  const inPlayers = !!players[myPlayerId];
  const inWait = !!waitlist[myPlayerId];

  if (!inPlayers && !inWait) return;

  if (inWait) {
    if (Object.keys(players).length >= MAX_PLAYERS) return alert("大厅满了，进不去");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.players).length >= MAX_PLAYERS) return room;
      if (!room.waitlist[myPlayerId]) return room;
      room.players[myPlayerId] = { ...room.waitlist[myPlayerId] };
      delete room.waitlist[myPlayerId];
      return room;
    });
    return;
  }

  if (inPlayers) {
    if (Object.keys(waitlist).length >= MAX_WAIT) return alert("候补也满了，别挤了");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.waitlist).length >= MAX_WAIT) return room;
      if (!room.players[myPlayerId]) return room;
      room.waitlist[myPlayerId] = { ...room.players[myPlayerId] };
      delete room.players[myPlayerId];
      return room;
    });
  }
};

/** 管理员查看开关（默认不看） */
btnAdminPeek.onclick = () => {
  if (!isAdmin()) return;
  adminPeekOn = !adminPeekOn;
  btnAdminPeek.textContent = adminPeekOn ? "管理员查看信息：开" : "管理员查看信息（默认不看）";
  render(snapshotCache || {});
};

/** 管理员重置（回到大厅并清空所有流程数据） */
btnReset.onclick = async () => {
  if (!isAdmin()) return alert("别闹，只有管理员能重置");
  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};

    room.game = { phase: "lobby", resetAt: now() };

    room.draft = null;
    room.teams = null;
    room.roles = null;
    room.confirm = null;

    return room;
  });
};

/** 管理员开始选人：不限制人数（单数也行，少人也行） */
btnStartDraft.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开始选人");

  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";

  if (phase !== "lobby") return alert("现在不在大厅阶段（要重来就点重置）");

  const players = state.players || {};
  const ids = getPlayerIds(players);

  if (ids.length < 1) return alert("大厅至少得有1个人吧🤣");

  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.game = room.game || { phase: "lobby" };

      if ((room.game.phase || "lobby") !== "lobby") return;

      const ids = Object.keys(room.players);
      if (ids.length < 1) return;

      // 随机队长：人数>=2 才有两边队长；否则只有蓝队长
      const blueCaptain = pickRandom(ids);
      let redCaptain = null;

      if (ids.length >= 2) {
        const rest = ids.filter(x => x !== blueCaptain);
        redCaptain = pickRandom(rest);
      }

      // 初始化队伍：队长置顶
      const blue = blueCaptain ? [blueCaptain] : [];
      const red  = redCaptain ? [redCaptain] : [];

      room.teams = { blue, red };

      room.draft = {
        captains: { blue: blueCaptain, red: redCaptain },
        order: PICK_ORDER,
        pickIndex: 0,
        turn: "blue", // 永远从蓝先
        startedAt: now()
      };

      room.roles = null;
      room.confirm = null;

      room.game.phase = "draft";
      room.game.draftAt = now();
      return room;
    });

    console.log("startDraft committed?", res.committed, res.snapshot?.val());
    if (!res.committed) alert("开始选人失败：可能没写权限/或状态不对");
  } catch (e) {
    alert("开始选人失败：" + (e?.message || e));
  }
};

/** 队长选人：点击等待区玩家 */
async function captainPick(targetPid){
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "draft") return;

  const players = state.players || {};
  const draft = state.draft || {};
  const teams = state.teams || { blue:[], red:[] };
  const captains = draft.captains || {};

  const blueCaptain = captains.blue;
  const redCaptain  = captains.red;

  // 轮到谁，只有谁能点
  const turn = draft.turn;
  const myIsBlueCaptain = (myPlayerId === blueCaptain);
  const myIsRedCaptain  = (myPlayerId === redCaptain);

  if (turn === "blue" && !myIsBlueCaptain) return alert("别急，还没轮到你🤣");
  if (turn === "red" && !myIsRedCaptain) return alert("别急，还没轮到你🤣");

  // 目标必须存在且未入队
  if (!players[targetPid]) return;
  const inBlue = (teams.blue || []).includes(targetPid);
  const inRed  = (teams.red || []).includes(targetPid);
  if (inBlue || inRed) return;

  await roomRef.transaction((room) => {
    room = room || {};
    room.game = room.game || { phase:"lobby" };
    room.players = room.players || {};
    room.draft = room.draft || {};
    room.teams = room.teams || { blue:[], red:[] };

    if (room.game.phase !== "draft") return;

    const captains = room.draft.captains || {};
    const order = room.draft.order || PICK_ORDER;

    // 当前轮次
    let pickIndex = room.draft.pickIndex ?? 0;
    let turn = room.draft.turn || "blue";

    // 校验操作者是当前轮次队长
    if (turn === "blue" && myPlayerId !== captains.blue) return;
    if (turn === "red"  && myPlayerId !== captains.red) return;

    const blueArr = room.teams.blue || [];
    const redArr  = room.teams.red  || [];

    // 目标必须未被选
    if (blueArr.includes(targetPid) || redArr.includes(targetPid)) return;

    // 计算当前等待区（剩余可选的人）
    const allIds = Object.keys(room.players);
    const inTeam = new Set([...blueArr, ...redArr]);
    const waiting = allIds.filter(pid => !inTeam.has(pid));

    if (!waiting.includes(targetPid)) return;

    // 如果当前队满了，就自动塞到另一队（有空才塞）
    const blueFull = blueArr.length >= TEAM_CAP;
    const redFull  = redArr.length  >= TEAM_CAP;

    if (turn === "blue") {
      if (!blueFull) blueArr.push(targetPid);
      else if (!redFull) redArr.push(targetPid);
      else return; // 都满了
    } else {
      if (!redFull) redArr.push(targetPid);
      else if (!blueFull) blueArr.push(targetPid);
      else return;
    }

    room.teams.blue = blueArr;
    room.teams.red  = redArr;

    // 选完推进：pickIndex++
    pickIndex += 1;
    room.draft.pickIndex = pickIndex;

    // 更新等待区
    const inTeam2 = new Set([...blueArr, ...redArr]);
    const waiting2 = allIds.filter(pid => !inTeam2.has(pid));

    // 如果没人可选了，直接结束 draft（等待管理员分配身份）
    if (waiting2.length === 0 || (blueArr.length >= TEAM_CAP && redArr.length >= TEAM_CAP)) {
      room.draft.turn = null;
      room.game.phase = "draft_done"; // 选人已结束，等管理员分身份
      room.game.draftDoneAt = now();
      return room;
    }

    // 找下一个可用轮次（跳过“队满”的一边）
    for (let guard = 0; guard < 50; guard++){
      const nextTurn = order[pickIndex % order.length] || "blue";
      const blueFull2 = blueArr.length >= TEAM_CAP;
      const redFull2  = redArr.length  >= TEAM_CAP;

      if (nextTurn === "blue" && !blueFull2 && captains.blue) { room.draft.turn = "blue"; break; }
      if (nextTurn === "red"  && !redFull2  && captains.red)  { room.draft.turn = "red";  break; }

      // 如果该边队长不存在（比如只有1人），或者队已满，就继续推进
      pickIndex += 1;
      room.draft.pickIndex = pickIndex;
    }

    // 保底：如果还是没设置 turn，直接结束
    if (!room.draft.turn) {
      room.game.phase = "draft_done";
      room.game.draftDoneAt = now();
    }

    return room;
  });
}

/** 管理员分配身份：
 * - 只对“已入队的人”分配身份
 * - 默认：随机 1 个“内鬼”，其他“好人”
 * - 分完进入 reveal 阶段：每个人要点“我确认了”
 */
btnAssignRoles.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能分配身份");

  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "draft_done") return alert("先把人选完（或等没人可选了）再分配身份");

  const teams = state.teams || { blue:[], red:[] };
  const players = state.players || {};

  // 参赛名单：两队所有人（队长也算）
  const participants = [...(teams.blue || []), ...(teams.red || [])]
    .filter(pid => !!players[pid]);

  if (participants.length < 1) return alert("队里没人，分不了🤣");

  // 随机一个内鬼（最简单稳定）
  const impostor = pickRandom(participants);

  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.game = room.game || { phase:"lobby" };
      room.players = room.players || {};
      room.teams = room.teams || { blue:[], red:[] };

      if (room.game.phase !== "draft_done") return;

      const participants = [...(room.teams.blue||[]), ...(room.teams.red||[])]
        .filter(pid => !!room.players[pid]);

      if (participants.length < 1) return;

      const impostor = pickRandom(participants);

      room.roles = {};
      participants.forEach(pid => {
        room.roles[pid] = (pid === impostor) ? "内鬼" : "好人";
      });

      // 确认表清空
      room.confirm = {};
      participants.forEach(pid => room.confirm[pid] = false);

      room.game.phase = "reveal";
      room.game.revealAt = now();
      return room;
    });

    console.log("assignRoles committed?", res.committed, res.snapshot?.val());
    if (!res.committed) alert("分配失败：可能没写权限/或阶段不对");
  } catch (e) {
    alert("分配失败：" + (e?.message || e));
  }
};

/** 玩家确认身份 */
btnConfirmRole.onclick = async () => {
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "reveal") return;

  const roles = state.roles || {};
  if (!roles[myPlayerId]) return alert("你没上场（没身份），不用确认");

  await roomRef.child(`confirm/${myPlayerId}`).set(true);
};

/** 踢人（管理员） */
async function kickPlayer(pid){
  if (!isAdmin()) return alert("只有管理员能踢人");
  const name = snapshotCache?.players?.[pid]?.displayName || snapshotCache?.waitlist?.[pid]?.displayName || pid;
  const ok = confirm(`确定踢出：${name}？`);
  if (!ok) return;

  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.kicked[pid] = { at: now(), by: myPlayerId };

    delete room.players[pid];
    delete room.waitlist[pid];

    // 流程中也移除
    if (room.teams?.blue) room.teams.blue = room.teams.blue.filter(x => x !== pid);
    if (room.teams?.red)  room.teams.red  = room.teams.red.filter(x => x !== pid);
    if (room.roles?.[pid]) delete room.roles[pid];
    if (room.confirm?.[pid] !== undefined) delete room.confirm[pid];

    return room;
  });
}

/** reveal 阶段：检查是否都确认了，确认完自动进入 teams 阶段 */
async function maybeAdvanceToTeams(state){
  const phase = state.game?.phase || "lobby";
  if (phase !== "reveal") return;

  const confirm = state.confirm || {};
  const roles = state.roles || {};

  const participants = Object.keys(roles);
  if (participants.length === 0) return;

  const allConfirmed = participants.every(pid => confirm[pid] === true);
  if (!allConfirmed) return;

  // 任意客户端都可以尝试推进（用 transaction 防并发）
  await roomRef.transaction((room) => {
    room = room || {};
    room.game = room.game || { phase:"lobby" };
    if (room.game.phase !== "reveal") return;

    const roles = room.roles || {};
    const confirm = room.confirm || {};
    const participants = Object.keys(roles);
    if (participants.length === 0) return;

    const allConfirmed = participants.every(pid => confirm[pid] === true);
    if (!allConfirmed) return;

    room.game.phase = "teams";
    room.game.teamsAt = now();
    return room;
  });
}

// ===== 监听渲染 =====
roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || {};
  render(snapshotCache);
  await maybeAdvanceToTeams(snapshotCache);

  // 被踢处理
  if (snapshotCache.kicked && snapshotCache.kicked[myPlayerId]) {
    alert("你被管理员踢出去了");
    await safeRemoveMe();
    try { await roomRef.child(`kicked/${myPlayerId}`).remove(); } catch {}
    showEntry();
  }
});

function renderTeamSlots(container, list, players, colorClass){
  container.innerHTML = "";
  for (let i=0;i<TEAM_CAP;i++){
    const pid = list[i];
    const slot = document.createElement("div");
    if (!pid) {
      slot.className = "slot empty";
      slot.innerHTML = `<div class="slotLeft"><div class="slotName">空位</div><div class="slotSub">—</div></div>`;
    } else {
      const p = players[pid];
      slot.className = `slot ${colorClass}`;
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(p?.displayName || pid)}</div>
          <div class="slotSub">${shortPid(pid)}</div>
        </div>
      `;
    }
    container.appendChild(slot);
  }
}

function render(state){
  const players = state.players || {};
  const waitlist = state.waitlist || {};
  const phase = state.game?.phase || "lobby";

  const inPlayers = !!players[myPlayerId];
  const inWait    = !!waitlist[myPlayerId];
  if (inPlayers || inWait) showRoom(); else showEntry();

  $("roleBadge").textContent = isAdmin() ? "管理员" : (inWait ? "候补" : "大厅");
  $("adminPanel").classList.toggle("hidden", !isAdmin());

  const meObj = players[myPlayerId] || waitlist[myPlayerId];
  $("meLine").textContent = meObj ? `你是：${meObj.displayName}（内部ID：${shortPid(myPlayerId)}）` : "";

  // 按阶段锁定切换
  btnSwitch.classList.toggle("hidden", !(inPlayers || inWait));
  btnSwitch.textContent = inWait ? "切换到大厅" : "切换到候补";
  if (phase === "draft" || phase === "draft_done" || phase === "reveal" || phase === "teams") {
    // 不隐藏按钮也行，但点会提示；这里直接隐藏更干净
    btnSwitch.classList.add("hidden");
  }

  // 管理员按钮显示控制
  btnStartDraft.classList.toggle("hidden", !isAdmin());
  btnAssignRoles.classList.toggle("hidden", !isAdmin());

  // 开始选人只在 lobby 可点
  if (isAdmin()) btnStartDraft.disabled = (phase !== "lobby");

  // 分配身份只在 draft_done 可点
  if (isAdmin()) btnAssignRoles.disabled = (phase !== "draft_done");

  // 阶段显示
  stageLobby.classList.toggle("hidden", phase !== "lobby");
  stageDraft.classList.toggle("hidden", !(phase === "draft" || phase === "draft_done"));
  stageReveal.classList.toggle("hidden", phase !== "reveal");
  stageTeams.classList.toggle("hidden", phase !== "teams");

  // ===== lobby 渲染 =====
  if (phase === "lobby") {
    // 大厅
    const pIds = Object.keys(players).sort((a,b)=> (players[a].joinedAt||0)-(players[b].joinedAt||0));
    const grid = $("playerGrid");
    grid.innerHTML = "";

    for (let i=0;i<MAX_PLAYERS;i++){
      const pid = pIds[i];
      const slot = document.createElement("div");

      if (!pid) {
        slot.className = "slot empty";
        slot.innerHTML = `<div class="slotLeft"><div class="slotName">空位</div><div class="slotSub">—</div></div>`;
      } else {
        const p = players[pid];
        slot.className = "slot";
        slot.innerHTML = `
          <div class="slotLeft">
            <div class="slotName">${escapeHtml(p.displayName || pid)}</div>
            <div class="slotSub">${shortPid(pid)}</div>
          </div>
        `;
        if (isAdmin()) {
          const k = document.createElement("button");
          k.className = "kickBtn";
          k.textContent = "×";
          k.onclick = () => kickPlayer(pid);
          slot.appendChild(k);
        }
      }
      grid.appendChild(slot);
    }

    // 候补
    const wIds = Object.keys(waitlist).sort((a,b)=> (waitlist[a].joinedAt||0)-(waitlist[b].joinedAt||0));
    const wGrid = $("waitGrid");
    wGrid.innerHTML = "";

    for (let i=0;i<MAX_WAIT;i++){
      const pid = wIds[i];
      const slot = document.createElement("div");
      if (!pid) {
        slot.className = "slot empty";
        slot.innerHTML = `<div class="slotLeft"><div class="slotName">空候补</div><div class="slotSub">—</div></div>`;
      } else {
        const p = waitlist[pid];
        slot.className = "slot";
        slot.innerHTML = `
          <div class="slotLeft">
            <div class="slotName">${escapeHtml(p.displayName || pid)}</div>
            <div class="slotSub">${shortPid(pid)}</div>
          </div>
        `;
        if (isAdmin()) {
          const k = document.createElement("button");
          k.className = "kickBtn";
          k.textContent = "×";
          k.onclick = () => kickPlayer(pid);
          slot.appendChild(k);
        }
      }
      wGrid.appendChild(slot);
    }
  }

  // ===== draft / draft_done 渲染 =====
  if (phase === "draft" || phase === "draft_done") {
    const draft = state.draft || {};
    const teams = state.teams || { blue:[], red:[] };
    const captains = draft.captains || {};
    const blueCaptain = captains.blue;
    const redCaptain  = captains.red;

    const blueList = teams.blue || [];
    const redList  = teams.red  || [];

    renderTeamSlots(blueTeamBox, blueList, players, "blue");
    renderTeamSlots(redTeamBox,  redList,  players, "red");

    // 等待区：大厅里没在队伍的
    waitingBox.innerHTML = "";
    const allIds = Object.keys(players);
    const inTeam = new Set([...blueList, ...redList]);
    const waiting = allIds.filter(pid => !inTeam.has(pid));

    const turn = draft.turn; // "blue"|"red"|null
    const myIsBlueCaptain = (myPlayerId === blueCaptain);
    const myIsRedCaptain  = (myPlayerId === redCaptain);

    waiting.forEach(pid => {
      const p = players[pid];
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(p?.displayName || pid)}</div>
          <div class="slotSub">${shortPid(pid)}</div>
        </div>
      `;

      const canClick =
        phase === "draft" &&
        ((turn === "blue" && myIsBlueCaptain) || (turn === "red" && myIsRedCaptain));

      if (canClick) {
        slot.style.cursor = "pointer";
        slot.onclick = () => captainPick(pid);
      } else {
        slot.style.opacity = "0.75";
      }

      waitingBox.appendChild(slot);
    });

    turnBlue.textContent = (phase === "draft" && draft.turn === "blue") ? "轮到蓝队长点人" : "—";
    turnRed.textContent  = (phase === "draft" && draft.turn === "red")  ? "轮到红队长点人" : "—";

    if (phase === "draft_done") {
      pickHint.textContent = "选人结束：等管理员点【分配身份】";
    } else {
      pickHint.textContent = draft.turn ? (draft.turn === "blue" ? "现在：蓝队长选人" : "现在：红队长选人") : "—";
    }

    const blueCapName = players[blueCaptain]?.displayName || (blueCaptain ? shortPid(blueCaptain) : "—");
    const redCapName  = players[redCaptain]?.displayName  || (redCaptain ? shortPid(redCaptain) : "—");

    let text = `队长已出炉：蓝队长【${escapeHtml(blueCapName)}】`;
    text += redCaptain ? `，红队长【${escapeHtml(redCapName)}】。` : `（目前只有一个人，红队没队长）。`;

    text += ` 人不齐也没事：等待区没人了就算选完。`;

    if (isAdmin() && adminPeekOn) {
      text += `\n（管理员查看）phase=${phase} turn=${draft.turn} pickIndex=${draft.pickIndex}`;
      text += ` blueCap=${shortPid(blueCaptain)} redCap=${redCaptain ? shortPid(redCaptain) : "null"}`;
    }

    draftHelpText.textContent = text;
  }

  // ===== reveal 渲染 =====
  if (phase === "reveal") {
    const roles = state.roles || {};
    const confirm = state.confirm || {};
    const teams = state.teams || { blue:[], red:[] };

    const participants = Object.keys(roles);
    const allConfirmed = participants.length > 0 && participants.every(pid => confirm[pid] === true);

    revealStatus.textContent = allConfirmed ? "大家都确认了，马上进名单页" : "看完自己的身份，点确认";

    // 我有没有身份（是不是上场）
    const myRole = roles[myPlayerId];
    const inMatch = !!myRole;

    if (!inMatch) {
      myRoleCard.innerHTML = `你这把没上场（没被选进队），所以没有身份。<br/>等下一把吧🤣`;
      btnConfirmRole.disabled = true;
      revealHint.textContent = "提示：只有上场的人需要确认。";
    } else {
      myRoleCard.innerHTML = `你这把的身份是：<b style="font-size:18px;">${escapeHtml(myRole)}</b><br/>看清楚了就点下面“我确认了”。`;
      btnConfirmRole.disabled = (confirm[myPlayerId] === true);
      revealHint.textContent = confirm[myPlayerId] ? "你已确认，等其他人。" : "确认后就不能反悔（要重来让管理员重置）。";
    }

    // 管理员也默认看不到别人身份：除非开启 adminPeekOn
    if (isAdmin() && adminPeekOn) {
      const blue = teams.blue || [];
      const red  = teams.red || [];
      const lines = [];
      lines.push("（管理员查看）身份表：");
      blue.forEach(pid => lines.push(`蓝：${players[pid]?.displayName || shortPid(pid)} = ${roles[pid] || "无"}`));
      red.forEach(pid => lines.push(`红：${players[pid]?.displayName || shortPid(pid)} = ${roles[pid] || "无"}`));
      revealHint.textContent += "\n" + lines.join("\n");
    }
  }

  // ===== teams 渲染（只显示名单） =====
  if (phase === "teams") {
    const teams = state.teams || { blue:[], red:[] };
    const blue = teams.blue || [];
    const red  = teams.red  || [];

    // 只渲染名单，不显示身份
    teamsBlueOnly.innerHTML = "";
    teamsRedOnly.innerHTML = "";

    blue.forEach(pid => {
      const div = document.createElement("div");
      div.className = "slot blue";
      div.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(players[pid]?.displayName || pid)}</div>
          <div class="slotSub">${shortPid(pid)}</div>
        </div>
      `;
      teamsBlueOnly.appendChild(div);
    });

    red.forEach(pid => {
      const div = document.createElement("div");
      div.className = "slot red";
      div.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(players[pid]?.displayName || pid)}</div>
          <div class="slotSub">${shortPid(pid)}</div>
        </div>
      `;
      teamsRedOnly.appendChild(div);
    });
  }

  // ===== 状态栏 =====
  const status = $("statusBox");
  const pCount = Object.keys(players).length;
  const wCount = Object.keys(waitlist).length;

  if (phase === "lobby") {
    status.textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。管理员点【开始选人】就开搞（不管人数）。`;
  } else if (phase === "draft") {
    status.textContent = "选人进行中：轮到队长就从等待区点人。";
  } else if (phase === "draft_done") {
    status.textContent = "选人结束：等管理员点【分配身份】。";
  } else if (phase === "reveal") {
    status.textContent = "身份阶段：每个上场的人确认自己的身份。";
  } else if (phase === "teams") {
    status.textContent = "名单页：只显示双方成员（不显示身份）。";
  } else {
    status.textContent = "状态未知（要不管理员重置一下）。";
  }
}
