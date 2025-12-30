/***************
 * 0) 把这里换成你 Firebase 控制台给的配置（你截图里的那段）
 *    注意：只换这一段，其他别动
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
 * 1) 内鬼任务池（你提供的）
 ***************/
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
  { name: "换血狂魔", desc: "开局切刀赶路时，或者在狭窄通道（如下水道），用刀划（轻击）队友一下，或者开枪打队友脚一下，造成 10-20 点伤害。" }
];

/***************
 * 2) 工具函数
 ***************/
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const shortId = () => Math.random().toString(36).slice(2, 8);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randomMission() {
  return undercoverMissions[Math.floor(Math.random() * undercoverMissions.length)];
}
function qsRoom() {
  const p = new URLSearchParams(location.search);
  return p.get("room");
}
function setRoomInUrl(room) {
  const u = new URL(location.href);
  u.searchParams.set("room", room);
  history.replaceState({}, "", u.toString());
}
function safeText(x) {
  return (x ?? "").toString();
}

/***************
 * 3) 本地身份（不登录也能用）
 ***************/
let myPlayerId = localStorage.getItem("cs2_site_playerId") || uid();
localStorage.setItem("cs2_site_playerId", myPlayerId);

let myToken = localStorage.getItem("cs2_site_token") || uid();
localStorage.setItem("cs2_site_token", myToken);

// 房主密钥：只有房主本机有（用于“只有你能控制”）
let myHostKey = localStorage.getItem("cs2_site_hostKey") || uid();
localStorage.setItem("cs2_site_hostKey", myHostKey);

/***************
 * 4) 自动房间 + 监听
 ***************/
let roomId = qsRoom();
if (!roomId) {
  roomId = shortId();          // 自动生成房间号
  setRoomInUrl(roomId);
}
const roomRef = db.ref(`rooms/${roomId}`);
let snapshotCache = null;

/***************
 * 5) UI 绑定
 ***************/
const entryPage = $("entryPage");
const roomPage = $("roomPage");

const btnJoin = $("btnJoin");
const btnLeave = $("btnLeave");
const btnStart = $("btnStart");
const btnReset = $("btnReset");
const btnPick = $("btnPick");
const btnReveal = $("btnReveal");
const btnConfirmRole = $("btnConfirmRole");
const btnCopyLink = $("btnCopyLink");
const btnCopyLinkRoom = $("btnCopyLinkRoom");

function showEntry() {
  entryPage.classList.remove("hidden");
  roomPage.classList.add("hidden");
}
function showRoom() {
  entryPage.classList.add("hidden");
  roomPage.classList.remove("hidden");
}

function updateShareBox(state) {
  const isHostNow = state?.hostId === myPlayerId && state?.hostKey === myHostKey;

  // entry 页面那份（如果存在）
  const shareBox = $("shareBox");
  const shareLink = $("shareLink");
  const hostBadge = $("hostBadge");
  if (shareBox && shareLink && hostBadge) {
    shareBox.classList.remove("hidden");
    shareLink.value = location.href;
    hostBadge.textContent = isHostNow ? "你是房主（有开始/重置权限）" : "你是游客（无开始/重置权限）";
  }

  // room 页面那份（如果存在）
  const shareLinkRoom = $("shareLinkRoom");
  const hostBadgeRoom = $("hostBadgeRoom");
  if (shareLinkRoom) shareLinkRoom.value = location.href;
  if (hostBadgeRoom) {
    hostBadgeRoom.textContent = isHostNow ? "你是房主（有开始/重置权限）" : "你是游客（无开始/重置权限）";
  }
}


btnCopyLink.onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    alert("已复制游客链接！");
  } catch {
    // 兼容失败情况：选中让用户自己复制
    $("shareLink").focus();
    $("shareLink").select();
    alert("复制失败：已选中链接，请手动 Ctrl+C 复制");
  }
};

btnCopyLinkRoom.onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    alert("已复制游客链接！");
  } catch {
    $("shareLinkRoom").focus();
    $("shareLinkRoom").select();
    alert("复制失败：已选中链接，请手动 Ctrl+C 复制");
  }
};


/***************
 * 6) 进入房间：写入玩家
 ***************/
btnJoin.onclick = async () => {
  const display = $("playerInput").value.trim();
  if (!display) return alert("请输入：名字 段位（例：xGonv AK）");

  // 写玩家信息
  await roomRef.child(`players/${myPlayerId}`).set({
    id: myPlayerId,
    displayName: display,
    token: myToken,
    roleConfirmed: false,
    joinedAt: Date.now()
  });

  // 如果没有房主：把当前用户设为房主，并写入 hostKey（只有本机知道）
  const hostSnap = await roomRef.child("hostId").get();
  if (!hostSnap.exists()) {
    await roomRef.update({
      hostId: myPlayerId,
      hostKey: myHostKey,
      phase: "lobby",
      createdAt: Date.now()
    });
  }

  showRoom();
};

btnLeave.onclick = async () => {
  const ok = confirm("确定退出房间？（你的名字会从列表移除）");
  if (!ok) return;

  await roomRef.child(`players/${myPlayerId}`).remove();
  showEntry();
};

/***************
 * 7) 房主：重置
 ***************/
btnReset.onclick = async () => {
  const state = snapshotCache || {};
  if (!isHost(state)) return alert("只有房主能重置");

  const updates = {
    phase: "lobby",
    draft: null,
    spies: null,
    startedAt: null
  };

  // 全员清除确认状态
  const players = state.players || {};
  Object.keys(players).forEach(pid => {
    updates[`players/${pid}/roleConfirmed`] = false;
  });

  await roomRef.update(updates);
};

/***************
 * 8) 房主：开始（任何人数 >=2）
 *    选人顺序：首选1 → 后选2 → 首选2 → 后选2 → 最后1自动给后选
 *    人数不够：自动省略后续步骤（没人可选就直接结束并分配内鬼）
 ***************/
btnStart.onclick = async () => {
  const state = snapshotCache || {};
  if (!isHost(state)) return alert("只有房主能开始");

  const players = state.players || {};
  const ids = Object.keys(players);
  if (ids.length < 2) return alert("至少需要 2 人才能开始（要抽两边队长）");

  const shuffled = shuffle(ids);
  const ctCaptain = shuffled[0];
  const tCaptain = shuffled[1];

  const firstPickSide = Math.random() < 0.5 ? "CT" : "T";
  const secondPickSide = firstPickSide === "CT" ? "T" : "CT";

  const turns = [
    { side: firstPickSide, picks: 1 },
    { side: secondPickSide, picks: 2 },
    { side: firstPickSide, picks: 2 },
    { side: secondPickSide, picks: 2 },
    { side: "AUTO_SECONDPICK", picks: 1 }
  ];

  const draft = {
    ctCaptain,
    tCaptain,
    firstPickSide,
    turns,
    turnIndex: 0,
    picksLeftInTurn: turns[0].picks,
    ctTeam: [ctCaptain],
    tTeam: [tCaptain],
    picked: { [ctCaptain]: true, [tCaptain]: true },
    currentSide: turns[0].side,
    createdAt: Date.now()
  };

  await roomRef.update({
    phase: "draft",
    startedAt: Date.now(),
    draft,
    spies: null
  });

  // 如果本来就没有可选的人（只有 2 人），直接结算
  const newStateSnap = await roomRef.get();
  const newState = newStateSnap.val() || {};
  await autoAdvanceIfNeeded(newState);
};

/***************
 * 9) 选人：只有轮到的队长能点
 ***************/
btnPick.onclick = async () => {
  const state = snapshotCache || {};
  const d = state.draft;
  if (!d) return;

  // 轮到谁
  if (!isMyTurnToPick(state)) return alert("当前不是你选人");

  const pickId = $("pickSelect").value;
  if (!pickId) return alert("请选择一个人");
  if (d.picked?.[pickId]) return alert("这个人已被选走");

  const nd = deepCopy(d);
  const side = nd.currentSide;

  if (side === "CT") nd.ctTeam.push(pickId);
  if (side === "T") nd.tTeam.push(pickId);
  nd.picked[pickId] = true;

  // 本回合减少
  nd.picksLeftInTurn -= 1;

  // 推进回合 + 自动省略
  await roomRef.child("draft").set(nd);

  // 更新后自动推进（可能直接结束）
  const newStateSnap = await roomRef.get();
  const newState = newStateSnap.val() || {};
  await autoAdvanceIfNeeded(newState);
};

/***************
 * 10) 查看身份 / 确认身份
 ***************/
btnReveal.onclick = async () => {
  const state = snapshotCache || {};
  const me = state.players?.[myPlayerId];
  if (!me) return alert("你不在房间里");
  if (me.token !== myToken) return alert("令牌不匹配（请使用加入时的同一设备）");

  const mySide = getMySide(state);
  if (!mySide) return alert("还未分队/未开始");

  // 还没分配内鬼就先显示队伍
  if (!state.spies) {
    $("myRole").textContent = `你是【${mySide}】\n（内鬼身份尚未生成）`;
    return;
  }

  const isSpy = state.spies?.[mySide]?.spyId === myPlayerId;
  if (isSpy) {
    const m = state.spies?.[mySide]?.mission;
    $("myRole").textContent =
      `你是【${mySide} 内鬼】\n任务：${m?.name || "未知"}\n说明：${m?.desc || ""}`;
  } else {
    $("myRole").textContent = `你是【${mySide} 普通队员】`;
  }
};

btnConfirmRole.onclick = async () => {
  const state = snapshotCache || {};
  if (!state.players?.[myPlayerId]) return alert("你不在房间里");
  await roomRef.child(`players/${myPlayerId}`).update({ roleConfirmed: true });
};

/***************
 * 11) 房间监听渲染
 ***************/
roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || null;
  render(snapshotCache);

  // 如果在 draft 阶段，任何客户端都可以帮忙推进（无副作用）
  // 但实际写入只发生在 autoAdvanceIfNeeded 内部的 update
  if (snapshotCache?.phase === "draft") {
    await autoAdvanceIfNeeded(snapshotCache);
  }
});

// 初始：显示 entry，并显示游客链接框
showEntry();
$("roomTitle").textContent = roomId;
$("shareLink").value = location.href;
$("shareBox").classList.remove("hidden");
$("hostBadge").textContent = "打开链接后输入一行即可加入（房主在第一次加入后确定）";

/***************
 * 12) 业务核心：自动推进/省略步骤/自动分配最后一人/结束后分配内鬼
 ***************/
async function autoAdvanceIfNeeded(state) {
  const d = state.draft;
  if (!d) return;

  const players = state.players || {};
  const allIds = Object.keys(players);
  const remaining = allIds.filter(pid => !d.picked?.[pid]);

  // 如果已经没有剩余可选，直接结束
  if (remaining.length === 0) {
    // 如果还没分配内鬼则分配
    if (!state.spies) await finalizeAndAssignSpies(state, d);
    return;
  }

  // 如果当前是自动最后一手：把剩余的人按规则自动分配给后选方
  if (d.currentSide === "AUTO_SECONDPICK") {
    // 只要还有人，就把“最后一个/剩余全部”都给后选方（人少时也合理）
    const secondSide = (d.firstPickSide === "CT") ? "T" : "CT";

    const nd = deepCopy(d);
    const left = allIds.filter(pid => !nd.picked?.[pid]);

    // 将剩余全部丢给后选方（因为已经到“收尾自动分配”阶段）
    for (const pid of left) {
      if (secondSide === "CT") nd.ctTeam.push(pid);
      else nd.tTeam.push(pid);
      nd.picked[pid] = true;
    }

    await roomRef.child("draft").set(nd);
    await finalizeAndAssignSpies(state, nd);
    return;
  }

  // 如果当前回合 picksLeftInTurn 已经为 0，推进到下一回合
  let nd = deepCopy(d);

  // 先把本回合没选满但没人可选的情况处理：自动推进
  // 规则：只要没得选，就直接推进回合
  while (true) {
    const rem = allIds.filter(pid => !nd.picked?.[pid]);
    if (rem.length === 0) {
      await roomRef.child("draft").set(nd);
      if (!state.spies) await finalizeAndAssignSpies(state, nd);
      return;
    }

    // 如果本回合还需要选人，但 rem 为 0 不可能；rem>0 则继续
    // 如果本回合 picksLeftInTurn <=0，则推进回合
    if (nd.picksLeftInTurn <= 0) {
      nd.turnIndex += 1;
      if (nd.turnIndex >= nd.turns.length) {
        // 理论不会到这（最后一手用 AUTO_SECONDPICK）
        await roomRef.child("draft").set(nd);
        if (!state.spies) await finalizeAndAssignSpies(state, nd);
        return;
      }
      const nextTurn = nd.turns[nd.turnIndex];
      nd.currentSide = nextTurn.side;
      nd.picksLeftInTurn = nextTurn.picks;
      continue;
    }

    // 本回合还有 picksLeftInTurn > 0，但 rem 可能太少：
    // 如果 rem 数量已经很少，后面的回合会自动省略，不需要这里强制改
    break;
  }

  // 写回可能推进过的状态
  await roomRef.child("draft").set(nd);
}

async function finalizeAndAssignSpies(state, d) {
  // 如果已经分配过就不重复分配
  const cur = (await roomRef.child("spies").get()).val();
  if (cur) {
    await roomRef.update({ phase: "reveal" });
    return;
  }

  const ct = d.ctTeam.slice();
  const tt = d.tTeam.slice();

  // 每边至少 1 人才抽，否则为 null
  const ctSpy = ct.length ? ct[Math.floor(Math.random() * ct.length)] : null;
  const tSpy = tt.length ? tt[Math.floor(Math.random() * tt.length)] : null;

  const spies = {
    CT: { spyId: ctSpy, mission: randomMission() },
    T: { spyId: tSpy, mission: randomMission() },
    assignedAt: Date.now()
  };

  await roomRef.update({
    phase: "reveal",
    spies
  });
}

/***************
 * 13) 权限判断：只有房主（hostId + hostKey 匹配）能控制
 ***************/
function isHost(state) {
  if (!state) return false;
  return state.hostId === myPlayerId && state.hostKey === myHostKey;
}

/***************
 * 14) 轮到谁选
 ***************/
function isMyTurnToPick(state) {
  const d = state.draft;
  if (!d) return false;
  if (d.currentSide === "AUTO_SECONDPICK") return false;
  if (d.picksLeftInTurn <= 0) return false;

  if (d.currentSide === "CT") return myPlayerId === d.ctCaptain;
  if (d.currentSide === "T") return myPlayerId === d.tCaptain;
  return false;
}

function getMySide(state) {
  const d = state.draft;
  if (!d) return null;
  if (d.ctTeam?.includes(myPlayerId)) return "CT";
  if (d.tTeam?.includes(myPlayerId)) return "T";
  return null;
}

function deepCopy(x) {
  return JSON.parse(JSON.stringify(x));
}

/***************
 * 15) 渲染
 ***************/
function render(state) {
  $("roomTitle").textContent = roomId;

  // 更新游客链接与房主标识
  updateShareBox(state);

  // 如果自己已经加入，则显示大厅
  const meInRoom = !!state?.players?.[myPlayerId];
  if (meInRoom) showRoom(); else showEntry();

  // 玩家列表
  const players = state?.players || {};
  const ids = Object.keys(players).sort((a,b) => (players[a].joinedAt||0) - (players[b].joinedAt||0));
  $("countPlayers").textContent = ids.length;

  const ul = $("playerList");
  ul.innerHTML = "";
  ids.forEach(pid => {
    const p = players[pid];
    const li = document.createElement("li");
    li.textContent = safeText(p.displayName || p.name || pid);
    ul.appendChild(li);
  });

  // 按钮权限
  const host = isHost(state);
  btnStart.disabled = !host;
  btnReset.disabled = !host;

  // 状态显示
  const phase = state?.phase || "lobby";
  const statusBox = $("statusBox");
  const draftBox = $("draftBox");

  if (phase === "lobby") {
    statusBox.textContent = "大厅中，等待房主开始…";
    draftBox.classList.add("hidden");
  } else if (phase === "draft") {
    draftBox.classList.remove("hidden");
    renderDraft(state);
  } else if (phase === "reveal") {
    draftBox.classList.remove("hidden");
    renderDraft(state);
    statusBox.textContent = "分队完成：所有人可查看身份并确认。";
  } else {
    statusBox.textContent = `状态：${phase}`;
  }

  // “查看身份/确认身份”按钮：只要进房就可点
  btnReveal.disabled = !meInRoom;
  btnConfirmRole.disabled = !meInRoom;

  // 退出按钮
  btnLeave.disabled = !meInRoom;
}

function renderDraft(state) {
  const d = state.draft;
  if (!d) return;

  const players = state.players || {};

  // 显示队伍
  const ctUl = $("ctList");
  const tUl = $("tList");
  ctUl.innerHTML = "";
  tUl.innerHTML = "";

  d.ctTeam.forEach(pid => {
    const li = document.createElement("li");
    li.textContent = safeText(players[pid]?.displayName || pid) + (pid === d.ctCaptain ? "（队长）" : "");
    ctUl.appendChild(li);
  });
  d.tTeam.forEach(pid => {
    const li = document.createElement("li");
    li.textContent = safeText(players[pid]?.displayName || pid) + (pid === d.tCaptain ? "（队长）" : "");
    tUl.appendChild(li);
  });

  // 当前状态文字
  const firstSide = d.firstPickSide;
  const secondSide = firstSide === "CT" ? "T" : "CT";
  const statusBox = $("statusBox");

  if (d.currentSide === "AUTO_SECONDPICK") {
    statusBox.textContent = `自动分配阶段：剩余玩家自动给后选方（${secondSide}）。`;
  } else {
    const curSide = d.currentSide;
    const capId = curSide === "CT" ? d.ctCaptain : d.tCaptain;
    const capName = safeText(players[capId]?.displayName || capId);
    statusBox.textContent = `轮到 ${curSide} 队长（${capName}）选人，剩余手数：${d.picksLeftInTurn}`;
  }

  // 下拉候选：未被选的人
  const allIds = Object.keys(players);
  const remaining = allIds.filter(pid => !d.picked?.[pid]);

  const pickSelect = $("pickSelect");
  pickSelect.innerHTML = "";
  remaining.forEach(pid => {
    const opt = document.createElement("option");
    opt.value = pid;
    opt.textContent = safeText(players[pid]?.displayName || pid);
    pickSelect.appendChild(opt);
  });

  // 按钮是否可点
  const canPick = (state.phase === "draft") && isMyTurnToPick(state) && remaining.length > 0;
  btnPick.disabled = !canPick;
}

