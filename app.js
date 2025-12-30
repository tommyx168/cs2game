/***************
 * Firebase 配置（你当前这份）
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
 * 固定房间 + 管理员密码
 ***************/
const FIXED_ROOM_ID = "cs2";
const ADMIN_CODE    = "tommy168";

const MAX_PLAYERS = 10;
const MAX_WAIT    = 4;

const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
function now(){ return Date.now(); }

function qs(name){
  const p = new URLSearchParams(location.search);
  return p.get(name);
}
function isAdmin(){
  return qs("admin") === ADMIN_CODE;
}

let myPlayerId = localStorage.getItem("cs2_site_playerId") || uid();
localStorage.setItem("cs2_site_playerId", myPlayerId);

const roomId = FIXED_ROOM_ID;
const roomRef = db.ref(`rooms/${roomId}`);

let snapshotCache = null;

const entryPage = $("entryPage");
const roomPage  = $("roomPage");
const btnJoin   = $("btnJoin");
const btnLeave  = $("btnLeave");
const btnStart  = $("btnStart");
const btnReset  = $("btnReset");
const btnReady  = $("btnReady");

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

function shortPid(pid){ return (pid || "").slice(0, 8); }

async function safeRemoveMe(){
  try { await roomRef.child(`players/${myPlayerId}`).remove(); } catch {}
  try { await roomRef.child(`waitlist/${myPlayerId}`).remove(); } catch {}
}

window.addEventListener("beforeunload", () => {
  try {
    roomRef.child(`players/${myPlayerId}`).remove();
    roomRef.child(`waitlist/${myPlayerId}`).remove();
  } catch {}
});

/***************
 * 加入：先填满10，再进候补(4)
 ***************/
btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("请输入：名字 段位（例：xGonv AK）");

  const me = {
    id: myPlayerId,
    displayName,
    joinedAt: now(),
    ready: false
  };

  const result = await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.meta = room.meta || {};
    room.game = room.game || { phase: "lobby" }; // lobby | ready | draft...

    const pCount = Object.keys(room.players).length;
    const wCount = Object.keys(room.waitlist).length;

    // 已在房间：更新名字
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    if (pCount < MAX_PLAYERS) {
      // 如果对局已开始并进入准备阶段：新来的直接进候补，不允许插队
      if (room.game?.phase && room.game.phase !== "lobby") {
        if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = { ...me, ready:false };
        return room;
      }
      room.players[myPlayerId] = me;
      return room;
    }

    if (wCount < MAX_WAIT) {
      room.waitlist[myPlayerId] = { ...me, ready:false };
      return room;
    }

    room.meta.lastRejectAt = now();
    return room;
  });

  if (!result.committed) return alert("加入失败，请刷新重试。");

  // 断线/关闭自动退出
  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  roomRef.child(`waitlist/${myPlayerId}`).onDisconnect().remove();

  // 管理员标记（不影响别人加入）
  if (isAdmin()) await roomRef.child("meta/admin").set(true);

  showRoom();
};

btnLeave.onclick = async () => {
  const ok = confirm("确定退出房间？");
  if (!ok) return;
  await safeRemoveMe();
  showEntry();
};

/***************
 * 管理员：开始对局 -> 进入 ready 阶段，并把 players 的 ready 全部清 false
 ***************/
btnStart.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开始");

  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.game = room.game || {};

    // 进入准备阶段
    room.game.phase = "ready";
    room.game.startedAt = now();

    // 清空所有大厅玩家 ready
    Object.keys(room.players).forEach(pid => {
      room.players[pid].ready = false;
    });

    return room;
  });
};

/***************
 * 管理员：重置（回到 lobby，清 ready + 清分队信息）
 ***************/
btnReset.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能重置");

  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.game = { phase: "lobby", resetAt: now() };
    room.teams = null; // 预留：分队后写这里
    Object.keys(room.players).forEach(pid => room.players[pid].ready = false);
    return room;
  });
};

/***************
 * 玩家：准备/取消准备（只有前10人能准备，候补不显示）
 ***************/
btnReady.onclick = async () => {
  const state = snapshotCache || {};
  const players = state.players || {};
  if (!players[myPlayerId]) return; // 候补/未加入 不允许

  // 只有在 ready 阶段才允许点
  const phase = state.game?.phase || "lobby";
  if (phase !== "ready") return;

  const cur = !!players[myPlayerId].ready;
  await roomRef.child(`players/${myPlayerId}/ready`).set(!cur);
};

/***************
 * 踢人（管理员）
 ***************/
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

  await tryPromoteWaitlist();
}

/***************
 * 候补补位：只在 lobby 阶段允许自动补进前10
 * （你开始后就不补，避免中途插进来破坏准备/对局）
 ***************/
async function tryPromoteWaitlist(){
  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.game = room.game || { phase: "lobby" };

    if (room.game.phase !== "lobby") return room;

    const pCount = Object.keys(room.players).length;
    if (pCount >= MAX_PLAYERS) return room;

    const waitIds = Object.keys(room.waitlist);
    if (waitIds.length === 0) return room;

    waitIds.sort((a,b) => (room.waitlist[a]?.joinedAt||0) - (room.waitlist[b]?.joinedAt||0));

    while (Object.keys(room.players).length < MAX_PLAYERS && waitIds.length > 0) {
      const pid = waitIds.shift();
      room.players[pid] = room.waitlist[pid];
      room.players[pid].ready = false;
      delete room.waitlist[pid];
    }
    return room;
  });
}

/***************
 * 监听：渲染 + 被踢处理
 ***************/
roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || {};
  render(snapshotCache);

  // lobby 才补位
  await tryPromoteWaitlist();

  // 被踢
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

  $("roleBadge").textContent = isAdmin() ? "管理员" : "游客";
  $("adminPanel").classList.toggle("hidden", !isAdmin());
  btnStart.disabled = !isAdmin();
  btnReset.disabled = !isAdmin();

  const meObj = players[myPlayerId] || waitlist[myPlayerId];
  $("meLine").textContent = meObj
    ? `你的ID：${meObj.displayName}  |  内部：${shortPid(myPlayerId)}`
    : "";

  // 准备按钮：只有大厅玩家且 phase=ready 才显示
  const showReady = inPlayers && phase === "ready";
  btnReady.classList.toggle("hidden", !showReady);
  if (showReady) btnReady.textContent = players[myPlayerId].ready ? "取消准备" : "准备";

  // 预留分队：state.teams 结构示例：
  // state.teams = { blue: [pid...], red: [pid...], firstPick: "blue" }
  const teams = state.teams || null;
  const blueSet = new Set(teams?.blue || []);
  const redSet  = new Set(teams?.red  || []);

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
      const name = p.displayName || pid;

      // 基础样式 + ready/蓝/红
      let cls = "slot";
      if (p.ready) cls += " ready";
      if (blueSet.has(pid)) cls += " blue";
      if (redSet.has(pid))  cls += " red";
      slot.className = cls;

      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(name)}</div>
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

  // 渲染候补4条（不需要 ready）
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
      const name = p.displayName || pid;
      slot.className = "slot";

      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(name)}</div>
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

  // 状态文字
  const pCount = pIds.length;
  const wCount = wIds.length;
  const readyCount = Object.keys(players).filter(pid => players[pid].ready).length;

  if (phase === "ready") {
    $("statusBox").textContent = `对局已开始：大厅玩家请准备（${readyCount}/${pCount} 已准备）。候补不需要准备。`;
  } else {
    if (pCount >= MAX_PLAYERS && wCount >= MAX_WAIT) {
      $("statusBox").textContent = `房间已满：10人大厅 + 4人候补（满员）。`;
    } else if (pCount >= MAX_PLAYERS) {
      $("statusBox").textContent = `大厅10人已满：新加入进入候补（${wCount}/4）。`;
    } else {
      $("statusBox").textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。`;
    }
  }
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
