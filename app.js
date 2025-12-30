// app.js（完整版：不显示内部ID + 候补名单常驻 + 所有人可切换）
// === Firebase 配置 ===
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

// === 常量 ===
const FIXED_ROOM_ID = "cs2";
const ADMIN_CODE = "tommy168";

const MAX_PLAYERS = 10;
const MAX_WAIT = 4;
const TEAM_CAP = 5;

// 蛇形循环（人数不足：没人可选就结束）
const PICK_ORDER = ["blue","red","red","blue","blue","red","red","blue"];

// === 工具 ===
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
function pickRandom(list){
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

const undercoverMissions = [
  { name: "静步恐惧症", desc: "在残局或者是回防的时候，莫名其妙地切刀或者跳跃，漏出一个脚步声。" },
  { name: "钳子遗忘者", desc: "作为 CT，即使有 4000+ 的经济，也坚决不买拆弹器。如果是 T，不捡地上的包，除非队友扔给你。" },
  { name: "无甲莽夫", desc: "在至少一把需要起全甲的局，不起甲。" },
  { name: "老爸到了", desc: "在架点或者准备拉出去打人的关键时刻，按 F 检视武器。" },
  { name: "精神分裂报点", desc: "在残局或者静步摸排的时候，报假点，骗队友全体转点，把这就空的包点卖给对面。" },
  { name: "电击狂魔", desc: "在长枪局，一定要尝试用电击枪去电死一个人。" },
  { name: "不管不顾去拆包", desc: "作为 CT 回防时，不封烟或者不检查死角，直接上去假拆（或者真拆），并在语音里大喊'帮我架枪帮我架枪！'。" },
  { name: "自信回头", desc: "跟人对枪对到一半（没死也没杀掉），突然切刀转身跑路，或者想去扔道具。" },
  { name: "烟中恶鬼", desc: "封了一颗烟雾弹，然后自己硬着头皮干拉混烟出，白给。" },
  { name: "甚至不愿意封一颗烟", desc: "队友喊'给颗过点烟'或者'封个链接'的时候，假装切出烟雾弹瞄了半天，然后扔疵了，导致队友干拉出去被架死。" },
  { name: "顶级保镖", desc: "当你的队友（特别是狙击手）在拐角探头对枪时，你蹲在他屁股后面紧贴着他。当他开完枪想缩回来的时候，发现被你卡住了，惨遭对面击杀。" },
  { name: "这种人不杀留着过年？", desc: "当你躲在老六位，看到敌人侧身或者背身路过时，坚决不开枪。放过去第一个，甚至放过去第二个，直到对面发现你或者你试图刀人失败被反杀。" },
  { name: "赛点守财奴", desc: "在上半场最后一局，或者整场比赛的决胜局（12:12 这种），明明有 16000 块钱，却不起满道具，甚至只起半甲/不买钳子，以此“存钱”。" },
  { name: "换血狂魔", desc: "开局切刀赶路时，或者在狭窄通道（如下水道），用刀划（轻击）队友一下，或者开枪打队友脚一下，造成伤害，整局需要两次。" },
  { name: "电击小子", desc: "作为电击小子，你需要再整局游戏中至少购买3次电击枪，如果击杀1人，可在被投票出局后选一个队友一同惩罚（仅一次）。" }
];

// === 本地身份 & 名字缓存（关键：防止名字丢了显示 UUID） ===
let myPlayerId = localStorage.getItem("cs2_site_playerId") || uid();
localStorage.setItem("cs2_site_playerId", myPlayerId);

let mySavedName = localStorage.getItem("cs2_site_displayName") || "";
// 如果输入框存在，预填
window.addEventListener("DOMContentLoaded", () => {
  const inp = $("playerInput");
  if (inp && mySavedName) inp.value = mySavedName;
});

// === 房间引用 ===
const roomId = FIXED_ROOM_ID;
const roomRef = db.ref(`rooms/${roomId}`);
let snapshotCache = null;

// === UI refs ===
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

// 关闭页面时尝试移除自己（尽力而为）
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

// === 加入 ===
btnJoin.onclick = async () => {
  const displayName = ($("playerInput")?.value || "").trim();
  if (!displayName) return alert("先填名字（例：xGonv AK）");

  // 缓存名字：后面名字丢了可以自动补回
  localStorage.setItem("cs2_site_displayName", displayName);
  mySavedName = displayName;

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

    // 已在房间：更新名字（无论在哪个阶段都更新）
    if (room.players[myPlayerId]) {
      room.players[myPlayerId] = { ...room.players[myPlayerId], displayName };
      return room;
    }
    if (room.waitlist[myPlayerId]) {
      room.waitlist[myPlayerId] = { ...room.waitlist[myPlayerId], displayName };
      return room;
    }

    // lobby：优先进大厅
    if (phase === "lobby") {
      if (pCount < MAX_PLAYERS) {
        room.players[myPlayerId] = me;
        return room;
      }
      // 满了去候补
      if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = me;
      return room;
    }

    // 流程中：新进先去候补，避免干扰（但仍可切换）
    if (wCount < MAX_WAIT) room.waitlist[myPlayerId] = me;
    return room;
  });

  if (!result.committed) return alert("进房失败，刷新再试。");

  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();
  roomRef.child(`waitlist/${myPlayerId}`).onDisconnect().remove();
  showRoom();
};

// === 退出 ===
btnLeave.onclick = async () => {
  const ok = confirm("确定要退出吗？");
  if (!ok) return;
  await safeRemoveMe();
  showEntry();
};

// === 切换大厅/候补（所有人都能切换，不限制阶段） ===
btnSwitch.onclick = async () => {
  const state = snapshotCache || {};
  const players = state.players || {};
  const waitlist = state.waitlist || {};

  const inPlayers = !!players[myPlayerId];
  const inWait = !!waitlist[myPlayerId];
  if (!inPlayers && !inWait) return;

  // 确保带上名字（如果 Firebase 里没名字）
  const name = (players[myPlayerId]?.displayName || waitlist[myPlayerId]?.displayName || mySavedName || "未命名");

  if (inWait) {
    // 候补 -> 大厅
    if (Object.keys(players).length >= MAX_PLAYERS) return alert("大厅已满");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.players).length >= MAX_PLAYERS) return room;
      if (!room.waitlist[myPlayerId]) return room;

      room.players[myPlayerId] = { ...room.waitlist[myPlayerId], displayName: room.waitlist[myPlayerId].displayName || name };
      delete room.waitlist[myPlayerId];
      return room;
    });
    return;
  }

  if (inPlayers) {
    // 大厅 -> 候补
    if (Object.keys(waitlist).length >= MAX_WAIT) return alert("候补满了");
    await roomRef.transaction((room) => {
      room = room || {};
      room.players = room.players || {};
      room.waitlist = room.waitlist || {};
      if (Object.keys(room.waitlist).length >= MAX_WAIT) return room;
      if (!room.players[myPlayerId]) return room;

      room.waitlist[myPlayerId] = { ...room.players[myPlayerId], displayName: room.players[myPlayerId].displayName || name };
      delete room.players[myPlayerId];
      return room;
    });
  }
};

// === 管理员：查看身份开关 ===
btnAdminPeek.onclick = () => {
  if (!isAdmin()) return;
  adminPeekOn = !adminPeekOn;
  btnAdminPeek.textContent = adminPeekOn ? "查看身份（开）" : "查看身份（关）";
  render(snapshotCache || {});
};

// === 管理员：重置 ===
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

// === 管理员：开始选人 ===
btnStartDraft.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开始选人");

  const phase = snapshotCache?.game?.phase || "lobby";
  if (phase !== "lobby") return alert("当前不是大厅阶段，请点一键重置回到大厅");

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

      const inTeam = new Set([blueCaptain, redCaptain].filter(Boolean));
      const waiting = ids.filter(pid => !inTeam.has(pid));
      if (waiting.length === 0) {
        room.game.phase = "draft_done";
        room.game.draftDoneAt = now();
        room.draft.turn = null;
      }

      return room;
    });

    if (!res.committed) alert("开始选人失败：可能没写权限/或大厅没人");
  } catch (e) {
    alert("开始选人失败：" + (e?.message || e));
  }
};

// === 队长选人 ===
async function captainPick(targetPid){
  const state = snapshotCache || {};
  if ((state.game?.phase || "lobby") !== "draft") return;

  const draft = state.draft || {};
  const teams = state.teams || { blue:[], red:[] };
  const players = state.players || {};
  const captains = draft.captains || {};

  const turn = draft.turn;
  const myIsBlueCaptain = (myPlayerId === captains.blue);
  const myIsRedCaptain  = (myPlayerId === captains.red);

  if (turn === "blue" && !myIsBlueCaptain) return alert("还没轮到你");
  if (turn === "red"  && !myIsRedCaptain)  return alert("还没轮到你");

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
    if (turn === "red"  && myPlayerId !== captains.red)  return;

    const blueArr = room.teams.blue || [];
    const redArr  = room.teams.red  || [];

    if (blueArr.includes(targetPid) || redArr.includes(targetPid)) return;

    const allIds = Object.keys(room.players);
    const inTeam = new Set([...blueArr, ...redArr]);
    const waiting = allIds.filter(pid => !inTeam.has(pid));
    if (!waiting.includes(targetPid)) return;

    const blueFull = blueArr.length >= TEAM_CAP;
    const redFull  = redArr.length  >= TEAM_CAP;

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

    pickIndex += 1;
    room.draft.pickIndex = pickIndex;

    const inTeam2 = new Set([...blueArr, ...redArr]);
    const waiting2 = allIds.filter(pid => !inTeam2.has(pid));

    if (waiting2.length === 0 || (blueArr.length >= TEAM_CAP && redArr.length >= TEAM_CAP)) {
      room.draft.turn = null;
      room.game.phase = "draft_done";
      room.game.draftDoneAt = now();
      return room;
    }

    // 找下一个可用轮次（跳过队满/队长不存在的一侧）
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

// === 管理员：分配身份 ===
btnAssignRoles.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能分配身份");
  const phase = snapshotCache?.game?.phase || "lobby";
  if (phase !== "draft_done") return alert("选完后分配身份");

  try {
    const res = await roomRef.transaction((room) => {
      room = room || {};
      room.game = room.game || { phase:"lobby" };
      room.players = room.players || {};
      room.teams = room.teams || { blue:[], red:[] };

      if (room.game.phase !== "draft_done") return;

      const blueTeam = (room.teams.blue || []).filter(pid => !!room.players[pid]);
      const redTeam  = (room.teams.red  || []).filter(pid => !!room.players[pid]);

      // 必须双方都有上场人员才分配“双卧底”
      if (blueTeam.length < 1 || redTeam.length < 1) return;

      // 各队随机 1 个卧底
      const blueUndercover = pickRandom(blueTeam);
      const redUndercover  = pickRandom(redTeam);

      room.roles = {};
      [...blueTeam, ...redTeam].forEach(pid => {
        const isUndercover = (pid === blueUndercover) || (pid === redUndercover);
        room.roles[pid] = isUndercover ? "卧底" : "平民";
      });

      // 任务：只给卧底
      //（默认允许两边抽到同任务；如果你想强制不同，我也能改）
      room.missions = {};

      // 兜底：任务表不能为空
      const pool = Array.isArray(undercoverMissions) ? undercoverMissions.filter(Boolean) : [];

      // 如果你担心未来任务表被清空，这里给一个必有的默认任务
      const DEFAULT_MISSION = { name: "临时任务", desc: "任务列表为空，请联系管理员补充任务库。" };

      let m1 = pickRandom(pool) || DEFAULT_MISSION;
      let m2 = pickRandom(pool) || DEFAULT_MISSION;

      // 尽量让两边不抽到同一个任务（任务>=2时）
      if (pool.length >= 2) {
        let guard = 0;
        while (m2 && m1 && m2.name === m1.name && guard < 20) {
          m2 = pickRandom(pool) || DEFAULT_MISSION;
          guard++;
        }
      }

// ✅ 强制写入：两个卧底一定有任务（不会写 null）
room.missions[blueUndercover] = { ...m1 };
room.missions[redUndercover]  = { ...m2 };


      // 确认表：只需要上场的人确认
      room.confirm = {};
      [...blueTeam, ...redTeam].forEach(pid => room.confirm[pid] = false);

      room.game.phase = "reveal";
      room.game.revealAt = now();
      return room;
    });

    if (!res.committed) alert("分配失败：可能没写权限/或阶段不对");
  } catch (e) {
    alert("分配失败：" + (e?.message || e));
  }
};


// === 玩家：确认身份 ===
btnConfirmRole.onclick = async () => {
  const phase = snapshotCache?.game?.phase || "lobby";
  if (phase !== "reveal") return;

  const roles = snapshotCache?.roles || {};
  if (!roles[myPlayerId]) return alert("你这把没上场");

  await roomRef.child(`confirm/${myPlayerId}`).set(true);
};

async function maybeAdvanceToTeams(state){
  if ((state.game?.phase || "lobby") !== "reveal") return;

  const roles = state.roles || {};
  const confirm = state.confirm || {};
  const participants = Object.keys(roles);
  if (!participants.length) return;

  const allConfirmed = participants.every(pid => confirm[pid] === true);
  if (!allConfirmed) return;

  await roomRef.transaction((room) => {
    room = room || {};
    room.game = room.game || { phase:"lobby" };
    if (room.game.phase !== "reveal") return;

    const roles = room.roles || {};
    const confirm = room.confirm || {};
    const participants = Object.keys(roles);
    if (!participants.length) return;

    const allConfirmed = participants.every(pid => confirm[pid] === true);
    if (!allConfirmed) return;

    room.game.phase = "teams";
    room.game.teamsAt = now();
    return room;
  });
}

// === 管理员：踢人 ===
async function kickPlayer(pid){
  if (!isAdmin()) return alert("只有管理员能踢人");
  const state = snapshotCache || {};
  const name = state?.players?.[pid]?.displayName || state?.waitlist?.[pid]?.displayName || "未命名";
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

// === 监听房间数据 ===
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

  // 如果我在房里但名字缺失，用本地缓存自动补回（防止再次出现 UUID）
  try {
    const players = snapshotCache.players || {};
    const waitlist = snapshotCache.waitlist || {};
    const me = players[myPlayerId] || waitlist[myPlayerId];
    if (me && (!me.displayName || String(me.displayName).trim() === "") && mySavedName) {
      const path = players[myPlayerId] ? `players/${myPlayerId}/displayName` : `waitlist/${myPlayerId}/displayName`;
      roomRef.child(path).set(mySavedName);
    }
  } catch {}
});

// === 渲染辅助：队伍槽位 ===
function renderTeamSlots(container, list, players, colorClass){
  container.innerHTML = "";
  for (let i=0;i<TEAM_CAP;i++){
    const pid = list[i];
    const slot = document.createElement("div");
    if (!pid) {
      slot.className = "slot empty";
      slot.innerHTML = `<div class="slotLeft"><div class="slotName">空位</div></div>`;
    } else {
      const p = players[pid];
      slot.className = `slot ${colorClass}`;
      // ✅ 永不显示 pid
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(p?.displayName || "未命名")}</div>
        </div>
      `;
    }
    container.appendChild(slot);
  }
}

// === 核心渲染 ===
function render(state){
  const players = state.players || {};
  const waitlist = state.waitlist || {};
  const phase = state.game?.phase || "lobby";

  const inPlayers = !!players[myPlayerId];
  const inWait    = !!waitlist[myPlayerId];

  if (inPlayers || inWait) showRoom(); else showEntry();

  $("roleBadge").textContent = isAdmin() ? "管理员" : (inWait ? "候补" : "大厅");
  $("adminPanel").classList.toggle("hidden", !isAdmin());

  // ✅ meLine 永不露出 pid
  const meObj = players[myPlayerId] || waitlist[myPlayerId];
  const meName = (meObj?.displayName || mySavedName || "未命名");
  $("meLine").textContent = meObj ? `你是：${meName}` : "";

  // ✅ 切换按钮：只要在房里就显示（所有人都能切）
  const showSwitch = (inPlayers || inWait);
  btnSwitch.classList.toggle("hidden", !showSwitch);
  if (showSwitch) btnSwitch.textContent = inWait ? "切换到大厅" : "切换到候补";

  // 管理员按钮
  btnStartDraft.classList.toggle("hidden", !isAdmin());
  btnAssignRoles.classList.toggle("hidden", !isAdmin());
  btnStartDraft.disabled = (phase !== "lobby");
  btnAssignRoles.disabled = (phase !== "draft_done");

  // ✅ 关键：候补/大厅名单永远显示
  stageLobby.classList.toggle("hidden", phase !== "lobby");

  // 其他阶段照常切换显示（不影响 stageLobby 常驻）
  stageDraft.classList.toggle("hidden", !(phase === "draft" || phase === "draft_done"));
  stageReveal.classList.toggle("hidden", phase !== "reveal");
  stageTeams.classList.toggle("hidden", phase !== "teams");

  // === 大厅 + 候补渲染（永不显示 pid） ===
  const pIds = Object.keys(players).sort((a,b)=> (players[a].joinedAt||0)-(players[b].joinedAt||0));
  const grid = $("playerGrid");
  grid.innerHTML = "";
  for (let i=0;i<MAX_PLAYERS;i++){
    const pid = pIds[i];
    const slot = document.createElement("div");
    if (!pid) {
      slot.className = "slot empty";
      slot.innerHTML = `<div class="slotLeft"><div class="slotName">空位</div></div>`;
    } else {
      const p = players[pid];
      slot.className = "slot";
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(p?.displayName || "未命名")}</div>
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
      slot.innerHTML = `<div class="slotLeft"><div class="slotName">空候补</div></div>`;
    } else {
      const p = waitlist[pid];
      slot.className = "slot";
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(p?.displayName || "未命名")}</div>
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

  // === 选人渲染 ===
  if (phase === "draft" || phase === "draft_done") {
    const draft = state.draft || {};
    const teams = state.teams || { blue:[], red:[] };
    const captains = draft.captains || {};

    const blueList = teams.blue || [];
    const redList  = teams.red  || [];

    renderTeamSlots(blueTeamBox, blueList, players, "blue");
    renderTeamSlots(redTeamBox,  redList,  players, "red");

    waitingBox.innerHTML = "";
    const allIds = Object.keys(players);
    const inTeam = new Set([...blueList, ...redList]);
    const waiting = allIds.filter(pid => !inTeam.has(pid));

    const turn = draft.turn; // "blue"|"red"|null
    const myIsBlueCaptain = (myPlayerId === captains.blue);
    const myIsRedCaptain  = (myPlayerId === captains.red);

    waiting.forEach(pid => {
      const p = players[pid];
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(p?.displayName || "未命名")}</div>
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

    turnBlue.textContent = (phase === "draft" && turn === "blue") ? "轮到蓝方" : "—";
    turnRed.textContent  = (phase === "draft" && turn === "red")  ? "轮到红方" : "—";

    pickHint.textContent = (phase === "draft_done")
      ? "选人结束"
      : (turn ? (turn === "blue" ? "蓝队选人" : "红队选人") : "—");

    const blueCapName = players[captains.blue]?.displayName || "未命名";
    const redCapName  = players[captains.red]?.displayName  || "未命名";

    let text = `队长：蓝队【${escapeHtml(blueCapName)}】`;
    text += captains.red ? `，红队【${escapeHtml(redCapName)}】。` : `（无红队队长）`;

    if (isAdmin() && adminPeekOn) {
      text += `\n（管理员查看）phase=${phase} turn=${turn} pickIndex=${draft.pickIndex}`;
    }

    draftHelpText.textContent = text;
  }

  // === 身份确认 ===
  if (phase === "reveal") {
    const roles = state.roles || {};
    const confirm = state.confirm || {};

    const participants = Object.keys(roles);
    const allConfirmed = participants.length > 0 && participants.every(pid => confirm[pid] === true);


    const myRole = roles[myPlayerId];
    const inMatch = !!myRole;

    if (!inMatch) {
      myRoleCard.innerHTML = `你这把没上场`;
      btnConfirmRole.disabled = true;
      revealHint.textContent = "只有上场的人需要确认";
    } else {
      const missions = state.missions || {};
      const myMission = missions[myPlayerId];

      if (myRole === "卧底" && myMission) {
        myRoleCard.innerHTML =
          `你的身份：<b style="font-size:18px;">卧底</b><br/>` +
          `你的任务：<b>${escapeHtml(myMission.name)}</b><br/>` +
          `<span style="color:#a7b7d6;">${escapeHtml(myMission.desc)}</span><br/>` +
          `看清楚了就点“确认”。`;
      } else {
        myRoleCard.innerHTML =
          `你的身份：<b style="font-size:18px;">${escapeHtml(myRole)}</b>”`;
      }

      btnConfirmRole.disabled = (confirm[myPlayerId] === true);
      revealHint.textContent = confirm[myPlayerId] ? "你已确认，等待其他人" : "确认后无法更改";
    }
  }

  // === 名单页（只显示名字） ===
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
          <div class="slotName">${escapeHtml(players[pid]?.displayName || "未命名")}</div>
        </div>
      `;
      teamsBlueOnly.appendChild(div);
    });

    red.forEach(pid => {
      const div = document.createElement("div");
      div.className = "slot red";
      div.innerHTML = `
        <div class="slotLeft">
          <div class="slotName">${escapeHtml(players[pid]?.displayName || "未命名")}</div>
        </div>
      `;
      teamsRedOnly.appendChild(div);
    });
  }

  // === 状态栏 ===
  const status = $("statusBox");
  const pCount = Object.keys(players).length;
  const wCount = Object.keys(waitlist).length;

  if (phase === "lobby") status.textContent = `大厅 ${pCount}/10，候补 ${wCount}/4。等待管理员`;
  else if (phase === "draft") status.textContent = "选人进行中";
  else if (phase === "draft_done") status.textContent = "等待下阶段";
  else if (phase === "reveal") status.textContent = "身份阶段";
  else if (phase === "teams") status.textContent = "队伍成员";
  else status.textContent = "状态不认识";
}








