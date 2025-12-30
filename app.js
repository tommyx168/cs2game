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

// UI refs
const entryPage = $("entryPage");
const roomPage  = $("roomPage");

const btnJoin   = $("btnJoin");
const btnLeave  = $("btnLeave");
const btnStart  = $("btnStart");
const btnReset  = $("btnReset");
const btnReady  = $("btnReady");
const btnGoDraft = $("btnGoDraft");
const btnSwitch = $("btnSwitch");
const btnAdminPeek = $("btnAdminPeek");

const normalStage = $("normalStage");
const draftStage  = $("draftStage");

const blueTeamBox = $("blueTeamBox");
const redTeamBox  = $("redTeamBox");
const waitingBox  = $("waitingBox");
const turnBlue    = $("turnBlue");
const turnRed     = $("turnRed");
const pickHint    = $("pickHint");
const draftHelpText = $("draftHelpText");

$("roomTitle").textContent = roomId;
$("adminHint").classList.toggle("hidden", !isAdmin());

let adminPeekOn = false; // 管理员“查看信息”开关（默认不看）

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

/** 选人顺序（10人：2队长 + 8人被选）
 * 蓝1 → 红2 → 蓝2 → 红2 → 蓝1 （蛇形）
 * 展开成 8 次：B, R, R, B, B, R, R, B
 */
const PICK_ORDER = ["blue","red","red","blue","blue","red","red","blue"];

/** 安全随机选一个 */
function pickRandom(list){
  if (!list.length) return null;
  const i = Math.floor(Math.random() * list.length);
  return list[i];
}

/**
 * 加入：优先进大厅，满了进候补
 * 选人阶段（draft）：只能进候补（避免干扰）
 */
btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("先填：名字 + 段位（例：xGonv AK）");

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
 * 房间内自由切换（大厅 <-> 候补）
 * - 选人阶段 draft：锁死
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
      room.players[myPlayerId] = { ...room.waitlist[myPlayerId], ready: false };
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
      room.waitlist[myPlayerId] = { ...room.players[myPlayerId], ready: false };
      delete room.players[myPlayerId];
      return room;
    });
  }
};

// 管理员：开始对局 -> ready，并清空大厅 ready（候补不需要准备）
btnStart.onclick = async () => {
  if (!isAdmin()) return alert("别闹，只有管理员能开始");
  await roomRef.transaction((room) => {
    room = room || {};
    room.players = room.players || {};
    room.waitlist = room.waitlist || {};
    room.game = room.game || {};
    room.game.phase = "ready";
    room.game.startedAt = now();

    // 清准备
    Object.keys(room.players).forEach(pid => room.players[pid].ready = false);

    // 清选人相关（避免上把残留）
    room.draft = null;
    room.teams = null;

    return room;
  });
};

// 管理员：重置 -> lobby
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

// 管理员“查看信息”按钮（默认不看）
btnAdminPeek.onclick = () => {
  if (!isAdmin()) return;
  adminPeekOn = !adminPeekOn;
  btnAdminPeek.textContent = adminPeekOn ? "管理员查看信息：开" : "管理员查看信息（默认不看）";
  render(snapshotCache || {});
};

/**
 * 开搞选人：仅管理员可点
 * 条件：phase=ready + 大厅人数>=2 + 偶数 + 全员ready
 * 动作：随机出蓝/红队长 + 初始化选人顺序/等待区
 */
btnGoDraft.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开选人");

  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "ready") return alert("先点【开始对局】，再让大家准备好");

  const players = state.players || {};
  const ids = Object.keys(players);

  if (ids.length < 2) return alert("至少要2个人");
  if (ids.length % 2 !== 0) return alert("人数要偶数（两边才好分）");

  const allReady = ids.every(pid => players[pid]?.ready === true);
  if (!allReady) return alert("还有人没准备，催他！");

  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.game = room.game || { phase: "lobby" };

      if (room.game.phase !== "ready") return;

      const ids = Object.keys(room.players);
      if (ids.length < 2) return;
      if (ids.length % 2 !== 0) return;

      const allReady = ids.every(pid => room.players[pid]?.ready === true);
      if (!allReady) return;

      // 随机队长
      const blueCaptain = pickRandom(ids);
      const rest = ids.filter(x => x !== blueCaptain);
      const redCaptain = pickRandom(rest);

      // 初始化 teams（队长直接进队，且置顶）
      room.teams = {
        blue: [blueCaptain],
        red: [redCaptain]
      };

      // draft 状态
      room.draft = {
        captains: { blue: blueCaptain, red: redCaptain },
        order: PICK_ORDER,
        pickIndex: 0,
        turn: PICK_ORDER[0], // blue
        startedAt: now()
      };

      room.game.phase = "draft";
      room.game.draftAt = now();
      return room;
    });

    console.log("goDraft committed?", res.committed, res.snapshot?.val());
    if (!res.committed) alert("开选人失败：条件没满足/或没写权限");
  } catch (e) {
    alert("开选人失败：" + (e?.message || e));
  }
};

/** 队长选人：点击等待区玩家 */
async function captainPick(targetPid){
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "draft") return;

  const draft = state.draft || {};
  const teams = state.teams || { blue:[], red:[] };
  const captains = draft.captains || {};

  const myIsBlueCaptain = (myPlayerId === captains.blue);
  const myIsRedCaptain  = (myPlayerId === captains.red);

  // 必须是轮到的队长本人
  const turn = draft.turn;
  if (turn === "blue" && !myIsBlueCaptain) return alert("别急，还没轮到你🤣");
  if (turn === "red" && !myIsRedCaptain) return alert("别急，还没轮到你🤣");

  // 目标必须仍在等待区（即：没在任何队伍）
  const inBlue = (teams.blue || []).includes(targetPid);
  const inRed  = (teams.red || []).includes(targetPid);
  if (inBlue || inRed) return;

  await roomRef.transaction((room) => {
    room = room || {};
    room.game = room.game || { phase:"lobby" };
    room.draft = room.draft || {};
    room.teams = room.teams || { blue:[], red:[] };

    if (room.game.phase !== "draft") return;

    const captains = room.draft.captains || {};
    const turn = room.draft.turn;
    const order = room.draft.order || PICK_ORDER;
    let pickIndex = room.draft.pickIndex ?? 0;

    // 校验操作者是当前轮次的队长
    if (turn === "blue" && myPlayerId !== captains.blue) return;
    if (turn === "red" && myPlayerId !== captains.red) return;

    const blueArr = room.teams.blue || [];
    const redArr  = room.teams.red || [];

    // 目标必须未被选
    if (blueArr.includes(targetPid) || redArr.includes(targetPid)) return;

    // 队伍人数不能超 5
    if (turn === "blue" && blueArr.length >= 5) return;
    if (turn === "red" && redArr.length >= 5) return;

    // 选人
    if (turn === "blue") blueArr.push(targetPid);
    else redArr.push(targetPid);

    room.teams.blue = blueArr;
    room.teams.red = redArr;

    // 推进轮次
    pickIndex += 1;
    room.draft.pickIndex = pickIndex;

    if (pickIndex >= order.length) {
      // 选完了：锁定（保持 phase=draft 也行，我这里直接进“选完阶段”）
      room.game.phase = "done";
      room.game.doneAt = now();
      room.draft.turn = null;
    } else {
      room.draft.turn = order[pickIndex];
    }

    return room;
  });
}

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

    // 如果选人中/已选完，把人也从队伍里移除
    if (room.teams?.blue) room.teams.blue = room.teams.blue.filter(x => x !== pid);
    if (room.teams?.red)  room.teams.red  = room.teams.red.filter(x => x !== pid);

    // 如果踢掉的是队长：不自动换队长（简单稳定），你可以重置再来
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

function renderTeamBox(container, teamList, players, isBlue){
  container.innerHTML = "";

  for (let i = 0; i < 5; i++){
    const pid = teamList[i];
    const slot = document.createElement("div");
    if (!pid) {
      slot.className = "slot empty";
      slot.innerHTML = `<div class="slotLeft"><div class="slotName">空位</div><div class="slotSub">—</div></div>`;
    } else {
      const p = players[pid];
      slot.className = "slot " + (isBlue ? "blue" : "red");
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

  // 切换按钮
  btnSwitch.classList.toggle("hidden", !(inPlayers || inWait));
  btnSwitch.textContent = inWait ? "切换到大厅" : "切换到候补";

  // 准备按钮：仅大厅玩家 ready 阶段
  const showReady = inPlayers && phase === "ready";
  btnReady.classList.toggle("hidden", !showReady);
  if (showReady) btnReady.textContent = players[myPlayerId].ready ? "取消准备" : "准备";

  // “开搞选人”按钮：只给管理员显示
  btnGoDraft.classList.toggle("hidden", !isAdmin());

  // 计算能否进选人
  const ids = Object.keys(players);
  const allReady = ids.length > 0 && ids.every(pid => players[pid]?.ready === true);
  const canDraft = phase === "ready" && ids.length >= 2 && (ids.length % 2 === 0) && allReady;
  if (isAdmin()) btnGoDraft.disabled = !canDraft;

  // 阶段 UI 切换
  const inDraftUI = (phase === "draft" || phase === "done");
  normalStage.classList.toggle("hidden", inDraftUI);
  draftStage.classList.toggle("hidden", !inDraftUI);

  // 渲染大厅/候补（非选人阶段用）
  if (!inDraftUI) {
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

  // 选人阶段渲染
  if (inDraftUI) {
    const draft = state.draft || {};
    const teams = state.teams || { blue:[], red:[] };
    const captains = draft.captains || {};
    const order = draft.order || PICK_ORDER;
    const pickIndex = draft.pickIndex ?? 0;
    const turn = draft.turn; // "blue" | "red" | null

    const blueCaptain = captains.blue;
    const redCaptain  = captains.red;

    // 队伍渲染（队长置顶，最多5）
    const blueList = teams.blue || [];
    const redList  = teams.red || [];

    renderTeamBox(blueTeamBox, blueList, players, true);
    renderTeamBox(redTeamBox,  redList,  players, false);

    // 等待区：大厅里没在任何队伍里的
    waitingBox.innerHTML = "";
    const allIds = Object.keys(players);
    const inTeam = new Set([...(blueList||[]), ...(redList||[])]);
    const waiting = allIds.filter(pid => !inTeam.has(pid));

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

      // 当前轮到的队长才能点
      const myIsBlueCaptain = (myPlayerId === blueCaptain);
      const myIsRedCaptain  = (myPlayerId === redCaptain);

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

    // 轮次提示
    turnBlue.textContent = (turn === "blue" && phase === "draft") ? "轮到蓝队长点人" : "—";
    turnRed.textContent  = (turn === "red"  && phase === "draft") ? "轮到红队长点人" : "—";

    // 顶部提示
    const meIsCaptain = (myPlayerId === blueCaptain || myPlayerId === redCaptain);
    if (phase === "done") {
      pickHint.textContent = "选完了，开局吧！";
    } else {
      pickHint.textContent = turn === "blue" ? "现在：蓝队长选人" : "现在：红队长选人";
    }

    // 帮助文字（接地气一点）
    const blueCapName = players[blueCaptain]?.displayName || (blueCaptain ? shortPid(blueCaptain) : "—");
    const redCapName  = players[redCaptain]?.displayName  || (redCaptain ? shortPid(redCaptain) : "—");

    let base = `队长已出炉：蓝队长【${escapeHtml(blueCapName)}】，红队长【${escapeHtml(redCapName)}】。`;
    if (phase === "draft") {
      base += ` 选人顺序：蓝1 → 红2 → 蓝2 → 红2 → 蓝1（蛇形）。`;
      if (meIsCaptain) base += ` 轮到你就点等待区的人。`;
      else base += ` 你不是队长就先坐好，等被点🤣`;
    } else {
      base += ` 队伍已定，想重来就让管理员重置。`;
    }

    // 管理员查看信息：默认不看，点了才显示内部数据
    if (isAdmin() && adminPeekOn) {
      base += `\n（管理员查看）turn=${turn} pickIndex=${pickIndex}/${order.length}；blueCap=${shortPid(blueCaptain)} redCap=${shortPid(redCaptain)}`;
    }

    draftHelpText.textContent = base;
  }

  // 状态栏
  const status = $("statusBox");
  const pCount = Object.keys(players).length;
  const wCount = Object.keys(waitlist).length;
  const readyCount = Object.keys(players).filter(pid => players[pid].ready).length;

  if (phase === "ready") {
    status.textContent = `已开局：大厅的人赶紧准备（${readyCount}/${pCount}）。候补别点准备，没你事。`;
  } else if (phase === "draft") {
    status.textContent = `选人进行中：队长轮流点人（候补锁死不能切换）。`;
  } else if (phase === "done") {
    status.textContent = `队伍已选完：可以开打了（需要的话管理员重置再来）。`;
  } else {
    status.textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。`;
  }

  // draft/done 阶段：隐藏准备/切换按钮（避免干扰）
  if (phase === "draft" || phase === "done") {
    btnReady.classList.add("hidden");
  }
}
