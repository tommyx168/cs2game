/***************
 * Firebase 配置
 ***************/
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

/***************
 * 固定房间 + 管理员码
 ***************/
const FIXED_ROOM_ID = "cs2";
const ADMIN_CODE    = "tommy168";

const MAX_PLAYERS = 10;
const MAX_WAIT    = 4;

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

/***************
 * UI
 ***************/
const entryPage = $("entryPage");
const roomPage  = $("roomPage");

const btnJoin   = $("btnJoin");
const btnLeave  = $("btnLeave");
const btnStart  = $("btnStart");
const btnReset  = $("btnReset");
const btnReady  = $("btnReady");
const btnGoDraft = $("btnGoDraft");
const btnSwitch = $("btnSwitch");

const btnAdminEnter = $("btnAdminEnter");
const adminEnterRow = $("adminEnterRow");

function showEntry(){
  entryPage.classList.remove("hidden");
  roomPage.classList.add("hidden");
}
function showRoom(){
  entryPage.classList.add("hidden");
  roomPage.classList.remove("hidden");
}

$("roomTitle").textContent = roomId;

// 只有管理员才显示“进入管理员模式”按钮（别人看不到）
adminEnterRow.classList.toggle("hidden", !isAdmin());
$("adminHint").classList.toggle("hidden", !isAdmin());

// 一键进入管理员模式（只有你用管理员链接打开时才看得到）
btnAdminEnter.onclick = () => {
  location.href = `${location.origin}${location.pathname}?admin=${ADMIN_CODE}`;
};

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

/**
 * 加入规则：
 * - lobby/ready：优先进大厅（没满就进），满了进候补
 * - draft：只能进候补（避免破坏选人）
 */
btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("请输入：名字 段位（例：xGonv AK）");

  const me = { id: myPlayerId, displayName, joinedAt: now(), ready: false };

  const result = await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.game = room.game || { phase: "lobby" };

    const phase = room.game.phase || "lobby";
    const pCount = Object.keys(room.players).length;
    const wCount = Object.keys(room.waitlist).length;

    // 已存在：更新名字
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    // draft 阶段：只能进候补
    if (phase === "draft") {
      if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = { ...me, ready:false };
      return room;
    }

    // lobby/ready：优先进大厅
    if (pCount < MAX_PLAYERS) {
      room.players[myPlayerId] = me;
      // ready 阶段加入大厅：ready 从 false 开始
      room.players[myPlayerId].ready = false;
      return room;
    }

    // 大厅满了 -> 候补
    if (wCount < MAX_WAIT) {
      room.waitlist[myPlayerId] = { ...me, ready:false };
    }
    return room;
  });

  if (!result.committed) return alert("加入失败，请刷新重试。");

  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  roomRef.child(`waitlist/${myPlayerId}`).onDisconnect().remove();

  showRoom();
};

btnLeave.onclick = async () => {
  const ok = confirm("确定退出房间？");
  if (!ok) return;
  await safeRemoveMe();
  showEntry();
};

/**
 * 房间内自由切换（大厅 <-> 候补）
 * - draft：禁止切进大厅（避免干扰选人）
 * - 从候补切大厅：大厅有空位才行
 * - 从大厅切候补：候补有空位才行；切出去会清 ready
 */
btnSwitch.onclick = async () => {
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  const players = state.players || {};
  const waitlist = state.waitlist || {};

  const inPlayers = !!players[myPlayerId];
  const inWait = !!waitlist[myPlayerId];

  if (!inPlayers && !inWait) return;

  if (phase === "draft") {
    // draft阶段只允许待在候补
    if (inPlayers) return alert("选人阶段不允许从大厅切出/切入（避免干扰）");
    return alert("选人阶段只能在候补等待");
  }

  // 从候补 -> 大厅
  if (inWait) {
    const pCount = Object.keys(players).length;
    if (pCount >= MAX_PLAYERS) return alert("大厅已满，无法切换到大厅");
    const w = waitlist[myPlayerId];

    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      room.game = room.game || { phase: "lobby" };
      // 再检查一次（事务里更安全）
      if (Object.keys(room.players).length >= MAX_PLAYERS) return room;
      if (!room.waitlist[myPlayerId]) return room;

      room.players[myPlayerId] = { ...room.waitlist[myPlayerId], ready: false };
      delete room.waitlist[myPlayerId];
      return room;
    });
    return;
  }

  // 从大厅 -> 候补
  if (inPlayers) {
    const wCount = Object.keys(waitlist).length;
    if (wCount >= MAX_WAIT) return alert("候补已满，无法切换到候补");
    const p = players[myPlayerId];

    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      room.game = room.game || { phase: "lobby" };
      if (Object.keys(room.waitlist).length >= MAX_WAIT) return room;
      if (!room.players[myPlayerId]) return room;

      room.waitlist[myPlayerId] = { ...room.players[myPlayerId], ready: false };
      delete room.players[myPlayerId];
      return room;
    });
  }
};

// 管理员：开始 -> ready，清 ready
btnStart.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开始");
  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.game = room.game || {};
    room.game.phase = "ready";
    room.game.startedAt = now();
    Object.keys(room.players).forEach(pid => room.players[pid].ready = false);
    return room;
  });
};

// 管理员：重置 -> lobby
btnReset.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能重置");
  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.game = { phase: "lobby", resetAt: now() };
    room.teams = null;
    Object.keys(room.players).forEach(pid => room.players[pid].ready = false);
    return room;
  });
};

// 玩家：准备（仅大厅玩家，phase=ready）
btnReady.onclick = async () => {
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "ready") return;

  const players = state.players || {};
  if (!players[myPlayerId]) return; // 候补不允许准备

  const cur = !!players[myPlayerId].ready;
  await roomRef.child(`players/${myPlayerId}/ready`).set(!cur);
};

// 管理员：进入选人（draft）条件：偶数+全准备
btnGoDraft.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能操作");

  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "ready") return alert("必须先开始对局并进入准备阶段");

  const players = state.players || {};
  const ids = Object.keys(players);

  if (ids.length < 2) return alert("至少需要2个人");
  if (ids.length % 2 !== 0) return alert("人数必须是偶数（两边人数相同）");

  const allReady = ids.every(pid => players[pid]?.ready === true);
  if (!allReady) return alert("还有人没准备");

  await roomRef.child("game").update({ phase: "draft", draftAt: now() });
};

// 踢人
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
    return room;
  });
}

// 监听渲染 + 被踢
roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || {};
  render(snapshotCache);

  if (snapshotCache.kicked && snapshotCache.kicked[myPlayerId]) {
    alert("你已被管理员踢出房间");
    await safeRemoveMe();
    try { await roomRef.child(`kicked/${myPlayerId}`).remove(); } catch {}
    showEntry();
  }
});

function render(state){
  const players = state.players || {};
  const waitlist = state.waitlist || {};
  const phase = state.game?.phase || "lobby";

  const inPlayers = !!players[myPlayerId];
  const inWait    = !!waitlist[myPlayerId];

  if (inPlayers || inWait) showRoom(); else showEntry();

  $("roleBadge").textContent = isAdmin() ? "管理员" : (inWait ? "候补" : "大厅");
  $("adminPanel").classList.toggle("hidden", !isAdmin());
  btnStart.disabled = !isAdmin();
  btnReset.disabled = !isAdmin();

  const meObj = players[myPlayerId] || waitlist[myPlayerId];
  $("meLine").textContent = meObj ? `你的ID：${meObj.displayName}  |  内部：${shortPid(myPlayerId)}` : "";

  // 切换按钮：只要你在房间里就显示（draft阶段会提示不能切）
  btnSwitch.classList.toggle("hidden", !(inPlayers || inWait));
  if (inWait) btnSwitch.textContent = "切换到大厅";
  if (inPlayers) btnSwitch.textContent = "切换到候补";

  // 准备按钮：仅大厅玩家且 ready 阶段
  const showReady = inPlayers && phase === "ready";
  btnReady.classList.toggle("hidden", !showReady);
  if (showReady) btnReady.textContent = players[myPlayerId].ready ? "取消准备" : "准备";

  // 进入选人按钮
  const ids = Object.keys(players);
  const allReady = ids.length > 0 && ids.every(pid => players[pid]?.ready === true);
  const canDraft = isAdmin() && phase === "ready" && ids.length >= 2 && (ids.length % 2 === 0) && allReady;
  btnGoDraft.disabled = !canDraft;

  // 渲染大厅10条
  const pIds = Object.keys(players).sort((a,b)=> (players[a].joinedAt||0)-(players[b].joinedAt||0));
  const grid = $("playerGrid");
  grid.innerHTML = "";

  for (let i=0;i<MAX_PLAYERS;i++){
    const pid = pIds[i];
    const slot = document.createElement("div");

    if (!pid) {
      slot.className = "slot empty";
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">空位</div>
          <div class="slotSub">—</div>
        </div>
      `;
    } else {
      const p = players[pid];
      let cls = "slot";
      if (p.ready) cls += " ready";
      slot.className = cls;

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

  // 渲染候补4条
  const wIds = Object.keys(waitlist).sort((a,b)=> (waitlist[a].joinedAt||0)-(waitlist[b].joinedAt||0));
  const wGrid = $("waitGrid");
  wGrid.innerHTML = "";

  for (let i=0;i<MAX_WAIT;i++){
    const pid = wIds[i];
    const slot = document.createElement("div");

    if (!pid) {
      slot.className = "slot empty";
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">空候补</div>
          <div class="slotSub">—</div>
        </div>
      `;
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

  // 状态
  const pCount = pIds.length;
  const wCount = wIds.length;
  const readyCount = Object.keys(players).filter(pid => players[pid].ready).length;

  if (phase === "ready") {
    $("statusBox").textContent = `对局已开始：大厅玩家请准备（${readyCount}/${pCount} 已准备）。候补不需要准备。`;
  } else if (phase === "draft") {
    $("statusBox").textContent = `已进入选人阶段（draft）。此阶段锁定大厅/候补切换。`;
  } else {
    $("statusBox").textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。`;
  }
}
