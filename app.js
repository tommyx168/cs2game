// app.js
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
const TEAM_CAP = 5;

// 蛇形循环（适配人数不足：没得选就结束）
const PICK_ORDER = ["blue","red","red","blue","blue","red","red","blue"];

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
function pickRandom(list){
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

let myPlayerId = localStorage.getItem("cs2_site_playerId") || uid();
localStorage.setItem("cs2_site_playerId", myPlayerId);

const roomId = FIXED_ROOM_ID;
const roomRef = db.ref(`rooms/${roomId}`);
let snapshotCache = null;

$("roomTitle").textContent = roomId;
$("adminHint").classList.toggle("hidden", !isAdmin());

const entryPage = $("entryPage");
const roomPage  = $("roomPage");

const btnJoin = $("btnJoin");
const btnLeave = $("btnLeave");
const btnSwitch = $("btnSwitch");
const btnStartDraft = $("btnStartDraft");
const btnAssignRoles = $("btnAssignRoles");
const btnReset = $("btnReset");
const btnAdminPeek = $("btnAdminPeek");
const btnConfirmRole = $("btnConfirmRole");

const stageLobby = $("stageLobby");
const stageDraft = $("stageDraft");
const stageReveal = $("stageReveal");
const stageTeams = $("stageTeams");

const blueTeamBox = $("blueTeamBox");
const redTeamBox = $("redTeamBox");
const waitingBox = $("waitingBox");
const turnBlue = $("turnBlue");
const turnRed = $("turnRed");
const pickHint = $("pickHint");
const draftHelpText = $("draftHelpText");

const myRoleCard = $("myRoleCard");
const revealStatus = $("revealStatus");
const revealHint = $("revealHint");

const teamsBlueOnly = $("teamsBlueOnly");
const teamsRedOnly  = $("teamsRedOnly");

let adminPeekOn = false;

function showEntry(){
  entryPage.classList.remove("hidden");
  roomPage.classList.add("hidden");
}
function showRoom(){
  entryPage.classList.add("hidden");
  roomPage.classList.remove("hidden");
}

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

    // 已在房间：更新名字
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    // 流程中：新进先去候补，避免干扰
    if (phase === "draft" || phase === "draft_done" || phase === "reveal" || phase === "teams") {
      if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = me;
      return room;
    }

    // 大厅优先
    if (pCount < MAX_PLAYERS) {
      room.players[myPlayerId] = me;
      return room;
    }
    // 满了去候补
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

btnSwitch.onclick = async () => {
  const state = snapshotCache || {};
  const rawPhase = state.game?.phase || "lobby";
  const phase = ["lobby"].includes(rawPhase) ? rawPhase : rawPhase; // 不做兜底，直接按真实阶段锁

  const players = state.players || {};
  const waitlist = state.waitlist || {};
  const inPlayers = !!players[myPlayerId];
  const inWait = !!waitlist[myPlayerId];
  if (!inPlayers && !inWait) return;

  if (phase !== "lobby") return alert("流程进行中，切换锁死了🤣");

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
    if (Object.keys(waitlist).length >= MAX_WAIT) return alert("候补也满了");
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

btnAdminPeek.onclick = () => {
  if (!isAdmin()) return;
  adminPeekOn = !adminPeekOn;
  btnAdminPeek.textContent = adminPeekOn ? "管理员查看信息：开" : "管理员查看信息（默认不看）";
  render(snapshotCache || {});
};

btnReset.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能重置");
  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      room.kicked = room.kicked || {};

      room.game = { phase: "lobby", resetAt: now() };

      room.teams = null;
      room.draft = null;
      room.roles = null;
      room.confirm = null;

      return room;
    });
    if (!res.committed) alert("重置失败：可能没写权限");
  } catch (e) {
    alert("重置失败：" + (e?.message || e));
  }
};

btnStartDraft.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开搞选人");

  const phase = snapshotCache?.game?.phase || "lobby";
  if (phase === "draft" || phase === "draft_done") return alert("已经在选人流程里了，不用重复点。");
  if (phase !== "lobby") return alert("当前不是大厅阶段，先点【一键重置】回到大厅。");

  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.game = room.game || { phase: "lobby" };

      if ((room.game.phase || "lobby") !== "lobby") return;

      const ids = Object.keys(room.players);
      if (ids.length < 1) return;

      const blueCaptain = pickRandom(ids);
      let redCaptain = null;
      if (ids.length >= 2) {
        const rest = ids.filter(x => x !== blueCaptain);
        redCaptain = pickRandom(rest);
      }

      room.teams = {
        blue: blueCaptain ? [blueCaptain] : [],
        red: redCaptain ? [redCaptain] : []
      };

      room.draft = {
        captains: { blue: blueCaptain, red: redCaptain },
        order: PICK_ORDER,
        pickIndex: 0,
        turn: "blue",
        startedAt: now()
      };

      room.roles = null;
      room.confirm = null;

      room.game.phase = "draft";
      room.game.draftAt = now();

      // 1人/2人：等待区为空，直接结束选人，等管理员分配身份
      const inTeam = new Set([blueCaptain, redCaptain].filter(Boolean));
      const waiting = ids.filter(pid => !inTeam.has(pid));
      if (waiting.length === 0) {
        room.game.phase = "draft_done";
        room.game.draftDoneAt = now();
        room.draft.turn = null;
      }

      return room;
    });

    console.log("startDraft committed?", res.committed, "after:", res.snapshot?.val());
    if (!res.committed) alert("开搞失败：阶段不对/或没写权限/或大厅没人");
  } catch (e) {
    alert("开搞失败：" + (e?.message || e));
  }
};

async function captainPick(targetPid){
  const state = snapshotCache || {};
  const phase = state.game?.phase || "lobby";
  if (phase !== "draft") return;

  const draft = state.draft || {};
  const teams = state.teams || { blue:[], red:[] };
  const players = state.players || {};
  const captains = draft.captains || {};

  const blueCaptain = captains.blue;
  const redCaptain  = captains.red;
  const turn = draft.turn;

  const myIsBlueCaptain = (myPlayerId === blueCaptain);
  const myIsRedCaptain  = (myPlayerId === redCaptain);

  if (turn === "blue" && !myIsBlueCaptain) return alert("别急，还没轮到你🤣");
  if (turn === "red"  && !myIsRedCaptain) return alert("别急，还没轮到你🤣");

  if (!players[targetPid]) return;
  if ((teams.blue||[]).includes(targetPid) || (teams.red||[]).includes(targetPid)) return;

  await roomRef.transaction((room) => {
    room = room || {};
    room.game = room.game || { phase:"lobby" };
    room.players = room.players || {};
    room.draft = room.draft || {};
    room.teams = room.teams || { blue:[], red:[] };

    if (room.game.phase !== "draft") return;

    const captains = room.draft.captains || {};
    const order = room.draft.order || PICK_ORDER;

    let pickIndex = room.draft.pickIndex ?? 0;
    let turn = room.draft.turn || "blue";

    if (turn === "blue" && myPlayerId !== captains.blue) return;
    if (turn === "red"  && myPlayerId !== captains.red) return;

    const blueArr = room.teams.blue || [];
    const redArr  = room.teams.red  || [];

    if (blueArr.includes(targetPid) || redArr.includes(targetPid)) return;

    // 目标必须还在等待区
    const allIds = Object.keys(room.players);
    const inTeam = new Set([...blueArr, ...redArr]);
    const waiting = allIds.filter(pid => !inTeam.has(pid));
    if (!waiting.includes(targetPid)) return;

    const blueFull = blueArr.length >= TEAM_CAP;
    const redFull  = redArr.length  >= TEAM_CAP;

    // 如果本队满了，自动塞到另一队（另一队有空才塞）
    if (turn === "blue") {
      if (!blueFull) blueArr.push(targetPid);
      else if (!redFull) redArr.push(targetPid);
      else return;
    } else {
      if (!redFull) redArr.push(targetPid);
      else if (!blueFull) blueArr.push(targetPid);
      else return;
    }

    room.teams.blue = blueArr;
    room.teams.red  = redArr;

    // 推进 pickIndex
    pickIndex += 1;
    room.draft.pickIndex = pickIndex;

    // 重新计算等待区
    const inTeam2 = new Set([...blueArr, ...redArr]);
    const waiting2 = allIds.filter(pid => !inTeam2.has(pid));

    // 没人可选 / 两边满了：结束选人
    if (waiting2.length === 0 || (blueArr.length >= TEAM_CAP && redArr.length >= TEAM_CAP)) {
      room.draft.turn = null;
      room.game.phase = "draft_done";
      room.game.draftDoneAt = now();
      return room;
    }

    // 找下一个可用轮次（跳过队满或队长不存在的一侧）
    let nextTurn = null;
    for (let guard=0; guard<50; guard++){
      const t = order[pickIndex % order.length] || "blue";
      const blueFull2 = blueArr.length >= TEAM_CAP;
      const redFull2  = redArr.length  >= TEAM_CAP;

      if (t === "blue" && captains.blue && !blueFull2) { nextTurn = "blue"; break; }
      if (t === "red"  && captains.red  && !redFull2)  { nextTurn = "red";  break; }

      pickIndex += 1;
      room.draft.pickIndex = pickIndex;
    }

    if (!nextTurn) {
      room.draft.turn = null;
      room.game.phase = "draft_done";
      room.game.draftDoneAt = now();
    } else {
      room.draft.turn = nextTurn;
    }

    return room;
  });
}

btnAssignRoles.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能分配身份");

  const phase = snapshotCache?.game?.phase || "lobby";
  if (phase !== "draft_done") return alert("先把人选完（或等待区没人了）再分配身份");

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

      room.confirm = {};
      participants.forEach(pid => room.confirm[pid] = false);

      room.game.phase = "reveal";
      room.game.revealAt = now();
      return room;
    });

    console.log("assignRoles committed?", res.committed);
    if (!res.committed) alert("分配失败：阶段不对/或没写权限");
  } catch (e) {
    alert("分配失败：" + (e?.message || e));
  }
};

btnConfirmRole.onclick = async () => {
  const phase = snapshotCache?.game?.phase || "lobby";
  if (phase !== "reveal") return;

  const roles = snapshotCache?.roles || {};
  if (!roles[myPlayerId]) return alert("你这把没上场（没身份），不用确认");

  await roomRef.child(`confirm/${myPlayerId}`).set(true);
};

async function maybeAdvanceToTeams(state){
  const phase = state.game?.phase || "lobby";
  if (phase !== "reveal") return;

  const roles = state.roles || {};
  const confirm = state.confirm || {};
  const participants = Object.keys(roles);
  if (participants.length === 0) return;

  const allConfirmed = participants.every(pid => confirm[pid] === true);
  if (!allConfirmed) return;

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

    if (room.teams?.blue) room.teams.blue = room.teams.blue.filter(x => x !== pid);
    if (room.teams?.red)  room.teams.red  = room.teams.red.filter(x => x !== pid);
    if (room.roles?.[pid]) delete room.roles[pid];
    if (room.confirm?.[pid] !== undefined) delete room.confirm[pid];

    return room;
  });
}

roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || {};
  render(snapshotCache);
  await maybeAdvanceToTeams(snapshotCache);

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

  // 按阶段决定是否显示切换
  const showSwitch = (inPlayers || inWait) && (phase === "lobby");
  btnSwitch.classList.toggle("hidden", !showSwitch);
  if (showSwitch) btnSwitch.textContent = inWait ? "切换到大厅" : "切换到候补";

  // 管理员按钮显示
  btnStartDraft.classList.toggle("hidden", !isAdmin());
  btnAssignRoles.classList.toggle("hidden", !isAdmin());
  btnStartDraft.disabled = (phase !== "lobby");
  btnAssignRoles.disabled = (phase !== "draft_done");

  // 阶段显示
  stageLobby.classList.toggle("hidden", phase !== "lobby");
  stageDraft.classList.toggle("hidden", !(phase === "draft" || phase === "draft_done"));
  stageReveal.classList.toggle("hidden", phase !== "reveal");
  stageTeams.classList.toggle("hidden", phase !== "teams");

  // 大厅渲染
  if (phase === "lobby") {
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

  // 选人渲染
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

    // 等待区 = 大厅里没在队伍的人
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
        slot.classList.add("clickable");
        slot.onclick = () => captainPick(pid);
      } else {
        slot.style.opacity = "0.75";
      }

      waitingBox.appendChild(slot);
    });

    turnBlue.textContent = (phase === "draft" && turn === "blue") ? "轮到蓝队选人人" : "—";
    turnRed.textContent  = (phase === "draft" && turn === "red")  ? "轮到红队选人人" : "—";

    pickHint.textContent = (phase === "draft_done")
      ? "选人结束：请稍后"
      : (turn ? (turn === "blue" ? "现在请蓝队选人" : "现在请红队选人") : "—");

    const blueCapName = players[blueCaptain]?.displayName || (blueCaptain ? shortPid(blueCaptain) : "—");
    const redCapName  = players[redCaptain]?.displayName  || (redCaptain ? shortPid(redCaptain) : "—");

    let text = `蓝方队长【${escapeHtml(blueCapName)}】`;
    text += redCaptain ? `，红方队长【${escapeHtml(redCapName)}】。` : `（目前没红队长，人数太少🤣）`;

    if (isAdmin() && adminPeekOn) {
      text += `\n（管理员查看）phase=${phase} turn=${turn} pickIndex=${draft.pickIndex}`;
      text += ` blueCap=${shortPid(blueCaptain)} redCap=${redCaptain ? shortPid(redCaptain) : "null"}`;
    }

    draftHelpText.textContent = text;
  }

  // 身份确认渲染
  if (phase === "reveal") {
    const roles = state.roles || {};
    const confirm = state.confirm || {};
    const teams = state.teams || { blue:[], red:[] };

    const participants = Object.keys(roles);
    const allConfirmed = participants.length > 0 && participants.every(pid => confirm[pid] === true);

    revealStatus.textContent = allConfirmed ? "大家都确认了，马上进名单页" : "看完自己的身份后点确认";

    const myRole = roles[myPlayerId];
    const inMatch = !!myRole;

    if (!inMatch) {
      myRoleCard.innerHTML = `你这把没上场（没被选进队），所以没有身份。<br/>等下一把吧`;
      btnConfirmRole.disabled = true;
      revealHint.textContent = "只有队伍中需要确认。";
    } else {
      myRoleCard.innerHTML = `你这把的身份是：<b style="font-size:18px;">${escapeHtml(myRole)}</b><br/>记住身份请确认。`;
      btnConfirmRole.disabled = (confirm[myPlayerId] === true);
      revealHint.textContent = confirm[myPlayerId] ? "已确认，请等待其他玩家确认。";
    }

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

  // 名单页渲染（只显示成员）
  if (phase === "teams") {
    const teams = state.teams || { blue:[], red:[] };
    const blue = teams.blue || [];
    const red  = teams.red  || [];

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

  // 状态栏
  const status = $("statusBox");
  const pCount = Object.keys(players).length;
  const wCount = Object.keys(waitlist).length;

  if (phase === "lobby") {
    status.textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。管理员可开启选人阶段。`;
  } else if (phase === "draft") {
    status.textContent = "选人进行中：队长从等待区点人。";
  } else if (phase === "draft_done") {
    status.textContent = "选人结束：请等待。";
  } else if (phase === "reveal") {
    status.textContent = "身份阶段：请确认自己的身份。";
  } else if (phase === "teams") {
    status.textContent = "双方成员。";
  } else {
    status.textContent = "报错：call管理员。";
  }
}
