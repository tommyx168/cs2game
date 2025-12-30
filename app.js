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

// UI
const entryPage = $("entryPage");
const roomPage  = $("roomPage");

const btnJoin   = $("btnJoin");
const btnLeave  = $("btnLeave");
const btnStart  = $("btnStart");
const btnReset  = $("btnReset");
const btnReady  = $("btnReady");
const btnGoDraft = $("btnGoDraft");
const btnSwitch = $("btnSwitch");

function showEntry(){
  entryPage.classList.remove("hidden");
  roomPage.classList.add("hidden");
}
function showRoom(){
  entryPage.classList.add("hidden");
  roomPage.classList.remove("hidden");
}

$("roomTitle").textContent = roomId;
$("adminHint").classList.toggle("hidden", !isAdmin());

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
 * 加入：优先进大厅，满了进候补
 * draft 阶段：只能进候补
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

    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    if (phase === "draft") {
      if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = { ...me, ready:false };
      return room;
    }

    if (pCount < MAX_PLAYERS) {
      room.players[myPlayerId] = me;
      room.players[myPlayerId].ready = false;
      return room;
    }

    if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = { ...me, ready:false };
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
 * - draft：锁定切换
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
    return alert("选人阶段锁定大厅/候补切换");
  }

  if (inWait) {
    if (Object.keys(players).length >= MAX_PLAYERS) return alert("大厅已满，无法切换到大厅");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.players).length >= MAX_PLAYERS) return room;
      if (!room.waitlist[myPlayerId]) return room;
      room.players[myPlayerId] = { ...room.waitlist[myPlayerId], ready: false };
      delete room.waitlist[myPlayerId];
      return room;
    });
    return;
  }

  if (inPlayers) {
    if (Object.keys(waitlist).length >= MAX_WAIT) return alert("候补已满，无法切换到候补");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
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
  if (!players[myPlayerId]) return;

  const cur = !!players[myPlayerId].ready;
  await roomRef.child(`players/${myPlayerId}/ready`).set(!cur);
};

/**
 * 进入选人：所有人都能点
 * 条件：phase=ready + 大厅人数>=2 + 偶数 + 全员ready
 */
btnGoDraft.onclick = async () => {
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

// 踢人（管理员）
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

  const meObj = players[myPlayerId] || waitlist[myPlayerId];
  $("meLine").textContent = meObj ? `你的ID：${meObj.displayName}  |  内部：${shortPid(myPlayerId)}` : "";

  // 切换按钮
  btnSwitch.classList.toggle("hidden", !(inPlayers || inWait));
  btnSwitch.textContent = inWait ? "切换到大厅" : "切换到候补";

  // 准备按钮：仅大厅玩家 ready 阶段
  const showReady = inPlayers && phase === "ready";
  btnReady.classList.toggle("hidden", !showReady);
  if (showReady) btnReady.textContent = players[myPlayerId].ready ? "取消准备" : "准备";

  // 进入选人按钮：所有人都看得到，但只有条件满足才可点
  const ids = Object.keys(players);
  const allReady = ids.length > 0 && ids.every(pid => players[pid]?.ready === true);
  const canDraft = phase === "ready" && ids.length >= 2 && (ids.length % 2 === 0) && allReady;
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
      slot.innerHTML = `<div class="slotLeft"><div class="slotName">空位</div><div class="slotSub">—</div></div>`;
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

  // 状态栏
  const pCount = pIds.length;
  const wCount = wIds.length;
  const readyCount = Object.keys(players).filter(pid => players[pid].ready).length;

  const status = $("statusBox");
  if (phase === "ready") {
    status.textContent = `对局已开始：大厅玩家请准备（${readyCount}/${pCount} 已准备）。候补不需要准备。`;
  } else if (phase === "draft") {
    status.textContent = `已进入选人阶段（draft）。此阶段锁定大厅/候补切换。`;
  } else {
    status.textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。`;
  }
}
