/***************
 * Firebase 配置（用你当前这份）
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
 * 固定房间 + 管理员密码（你可以改）
 ***************/
const FIXED_ROOM_ID = "cs2";       // 固定房间（所有人永远同一个）
const ADMIN_CODE    = "tommy168";  // 管理员密码（只给自己用，别发出去）

const MAX_PLAYERS = 10;
const MAX_WAIT    = 4;

const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

function qs(name){
  const p = new URLSearchParams(location.search);
  return p.get(name);
}
function isAdmin(){
  return qs("admin") === ADMIN_CODE;
}
function now(){ return Date.now(); }

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

btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("请输入：名字 段位（例：xGonv AK）");

  const me = {
    id: myPlayerId,
    displayName,
    joinedAt: now(),
    lastSeenAt: now()
  };

  // 用事务保证：先填满10人，再进候补，满了就拒绝
  const result = await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.kicked = room.kicked || {};
    room.meta = room.meta || {};

    // 如果被踢过并且标记还在，允许加入但仍会提示（由客户端处理）
    const pCount = Object.keys(room.players).length;
    const wCount = Object.keys(room.waitlist).length;

    // 已经在房间里：更新名字/时间（避免重复占位）
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], ...me };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], ...me };
      return room;
    }

    if (pCount < MAX_PLAYERS) {
      room.players[myPlayerId] = me;
      return room;
    }
    if (wCount < MAX_WAIT) {
      room.waitlist[myPlayerId] = me;
      return room;
    }

    // 房间满：返回不变（相当于拒绝）
    room.meta.lastRejectAt = now();
    return room;
  });

  if (!result.committed) return alert("加入失败，请刷新重试。");

  // 断线/关闭自动退出（双保险：players + waitlist 都设置）
  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  roomRef.child(`waitlist/${myPlayerId}`).onDisconnect().remove();

  // 如果你是管理员：写入一个管理员标记（不影响别人加入，也不需要你在线）
  if (isAdmin()) {
    await roomRef.child("meta/adminId").set(myPlayerId);
  }

  // 立即切到房间页（真实显示由监听决定）
  showRoom();
};

btnLeave.onclick = async () => {
  const ok = confirm("确定退出房间？");
  if (!ok) return;
  await safeRemoveMe();
  showEntry();
};

/***************
 * 管理员：开始 / 重置（占位，你后面要接选人逻辑就在这里接）
 ***************/
btnStart.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开始");
  await roomRef.child("gameStatus").set({ phase: "started", at: now() });
};

btnReset.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能重置");
  await roomRef.child("gameStatus").remove();
  await roomRef.child("kicked").remove();
};

/***************
 * 踢人（管理员专用）：可能踢的是 players 或 waitlist
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

  // 踢完后让候补补位
  await tryPromoteWaitlist();
}

/***************
 * 候补补位：只要 players < 10 且 waitlist 有人，就按最早加入顺序补进去
 * 任意客户端都可能触发，但事务保证安全
 ***************/
async function tryPromoteWaitlist(){
  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    const pCount = Object.keys(room.players).length;
    if (pCount >= MAX_PLAYERS) return room;

    const waitIds = Object.keys(room.waitlist);
    if (waitIds.length === 0) return room;

    // 按 joinedAt 最早的先补
    waitIds.sort((a,b) => (room.waitlist[a]?.joinedAt||0) - (room.waitlist[b]?.joinedAt||0));

    while (Object.keys(room.players).length < MAX_PLAYERS && waitIds.length > 0) {
      const pid = waitIds.shift();
      room.players[pid] = room.waitlist[pid];
      delete room.waitlist[pid];
    }
    return room;
  });
}

/***************
 * 实时监听：渲染 + 被踢处理 + 自动补位
 ***************/
roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || {};
  render(snapshotCache);

  // 自动补位（有人退出就补）
  await tryPromoteWaitlist();

  // 如果我被踢了：提示并回到入口（并清理自己的记录）
  if (snapshotCache.kicked && snapshotCache.kicked[myPlayerId]) {
    alert("你已被管理员踢出房间");
    await safeRemoveMe();
    // 清掉 kicked 标记（防止一直弹）
    try { await roomRef.child(`kicked/${myPlayerId}`).remove(); } catch {}
    showEntry();
  }
});

function render(state){
  const players = state.players || {};
  const waitlist = state.waitlist || {};

  // 我是否在 players 或 waitlist
  const inPlayers = !!players[myPlayerId];
  const inWait    = !!waitlist[myPlayerId];

  if (inPlayers || inWait) showRoom(); else showEntry();

  // 角色徽章
  $("roleBadge").textContent = isAdmin() ? "管理员" : "游客";
  $("adminPanel").classList.toggle("hidden", !isAdmin());
  btnStart.disabled = !isAdmin();
  btnReset.disabled = !isAdmin();

  const meObj = players[myPlayerId] || waitlist[myPlayerId];
  $("meLine").textContent = meObj
    ? `你的ID：${meObj.displayName}  |  你的内部编号：${shortPid(myPlayerId)}`
    : "";

  // 渲染 10 个方形槽（左5右5）
  const pIds = Object.keys(players).sort((a,b)=> (players[a].joinedAt||0)-(players[b].joinedAt||0));
  const grid = $("playerGrid");
  grid.innerHTML = "";

  for (let i=0;i<MAX_PLAYERS;i++){
    const pid = pIds[i];
    const slot = document.createElement("div");
    slot.className = "slot" + (pid ? "" : " empty");

    if (!pid) {
      slot.innerHTML = `<div class="slotName">空位</div><div class="slotSub">—</div>`;
    } else {
      const p = players[pid];
      const name = p.displayName || pid;
      slot.innerHTML = `
        <div class="slotName">${escapeHtml(name)}</div>
        <div class="slotSub">${shortPid(pid)}</div>
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

  // 渲染候补 4 个槽
  const wIds = Object.keys(waitlist).sort((a,b)=> (waitlist[a].joinedAt||0)-(waitlist[b].joinedAt||0));
  const wGrid = $("waitGrid");
  wGrid.innerHTML = "";

  for (let i=0;i<MAX_WAIT;i++){
    const pid = wIds[i];
    const slot = document.createElement("div");
    slot.className = "slot" + (pid ? "" : " empty");

    if (!pid) {
      slot.innerHTML = `<div class="slotName">空候补</div><div class="slotSub">—</div>`;
    } else {
      const p = waitlist[pid];
      const name = p.displayName || pid;
      slot.innerHTML = `
        <div class="slotName">${escapeHtml(name)}</div>
        <div class="slotSub">${shortPid(pid)}</div>
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
  const phase = state.gameStatus?.phase || "lobby";

  if (pCount >= MAX_PLAYERS && wCount >= MAX_WAIT) {
    $("statusBox").textContent = `房间已满：10人已加入 + 4人候补（满员）。`;
  } else if (pCount >= MAX_PLAYERS) {
    $("statusBox").textContent = `已加入10人满：新加入会进入候补（当前候补 ${wCount}/4）。状态：${phase}`;
  } else {
    $("statusBox").textContent = `已加入 ${pCount}/10，候补 ${wCount}/4。状态：${phase}`;
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
