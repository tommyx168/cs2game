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
const btnReset  = $("btnReset");
const btnStartDraft = $("btnStartDraft");
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
 * draft 阶段：只能进候补（避免干扰）
 */
btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("先填：名字 + 段位");

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

    // 已在房间：更新名字
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    // 选人阶段：新进只能去候补
    if (phase === "draft") {
      if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = me;
      return room;
    }

    // lobby：优先进大厅
    if (pCount < MAX_PLAYERS) {
      room.players[myPlayerId] = me;
      return room;
    }

    // 大厅满了去候补
    if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = me;
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

/**
 * 切换大厅 <-> 候补
 * draft 阶段锁死
 */
btnSwitch.onclick = async () => {
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  const players = state.players || {};
  const waitlist = state.waitlist || {};

  const inPlayers = !!players[myPlayerId];
  const inWait = !!waitlist[myPlayerId];
  if (!inPlayers && !inWait) return;

  if (phase === "draft") return alert("选人阶段锁死了，别捣乱🤣");

  if (inWait) {
    if (Object.keys(players).length >= MAX_PLAYERS) return alert("大厅满了，进不去");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.players).length >= MAX_PLAYERS) return room;
      if (!room.waitlist[myPlayerId]) return room;
      room.players[myPlayerId] = room.waitlist[myPlayerId];
      delete room.waitlist[myPlayerId];
      return room;
    });
    return;
  }

  if (inPlayers) {
    if (Object.keys(waitlist).length >= MAX_WAIT) return alert("候补满了");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.waitlist).length >= MAX_WAIT) return room;
      if (!room.players[myPlayerId]) return room;
      room.waitlist[myPlayerId] = room.players[myPlayerId];
      delete room.players[myPlayerId];
      return room;
    });
  }
};

/**
 * ✅ 管理员：开始选人（随时可点，不管人数单/双）
 * lobby -> draft
 */
btnStartDraft.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开搞选人");

  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.game = room.game || { phase: "lobby" };

      // 只允许从 lobby 进入
      if ((room.game.phase || "lobby") !== "lobby") return;

      room.game.phase = "draft";
      room.game.draftAt = now();
      return room;
    });

    if (!res.committed) alert("开搞失败：可能阶段不对/或没写权限");
  } catch (e) {
    alert("开搞失败：" + (e?.message || e));
  }
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
    return room;
  });
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
    alert("你被管理员踢出去了");
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
  $("meLine").textContent = meObj ? `你是：${meObj.displayName}（内部ID：${shortPid(myPlayerId)}）` : "";

  // 切换按钮
  btnSwitch.classList.toggle("hidden", !(inPlayers || inWait));
  btnSwitch.textContent = inWait ? "切换到大厅" : "切换到候补";

  // 管理员开搞按钮：只给管理员看；只在 lobby 可点
  btnStartDraft.classList.toggle("hidden", !isAdmin());
  if (isAdmin()) btnStartDraft.disabled = (phase !== "lobby");

  // 渲染大厅
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

  // 渲染候补
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
  const status = $("statusBox");
  const pCount = pIds.length;
  const wCount = wIds.length;

  if (phase === "draft") {
    status.textContent = "已进入选人阶段：后续会在这里做队长轮流点人。";
  } else {
    status.textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。管理员想开就直接点【开搞选人】。`;
  }
}
