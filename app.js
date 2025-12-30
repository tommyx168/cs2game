/***************
 * 0) 把这里换成你 Firebase 控制台给的配置
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
 * 1) 固定房间 + 管理员密码（你可以改）
 ***************/
const FIXED_ROOM_ID = "cs2";        // 固定房间号：不要乱改，改了就等于新房间
const ADMIN_CODE   = "tommy168";    // 管理员密码：你想换就改这里

/***************
 * 2) 工具
 ***************/
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

function qs(name){
  const p = new URLSearchParams(location.search);
  return p.get(name);
}
function isAdmin(){
  return qs("admin") === ADMIN_CODE;
}

/***************
 * 3) 本地身份（每台设备一个 playerId）
 ***************/
let myPlayerId = localStorage.getItem("cs2_site_playerId") || uid();
localStorage.setItem("cs2_site_playerId", myPlayerId);

/***************
 * 4) Firebase 引用
 ***************/
const roomId = FIXED_ROOM_ID;
const roomRef = db.ref(`rooms/${roomId}`);
let snapshotCache = null;

/***************
 * 5) UI
 ***************/
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

/***************
 * 6) 加入
 ***************/
btnJoin.onclick = async () => {
  const displayName = $("playerInput").value.trim();
  if (!displayName) return alert("请输入：名字 段位（例：xGonv AK）");

  // 写入玩家
  await roomRef.child(`players/${myPlayerId}`).set({
    id: myPlayerId,
    displayName,
    joinedAt: Date.now()
  });

  // 断开连接自动退出（最关键）
  roomRef.child(`players/${myPlayerId}`).onDisconnect().remove();

  showRoom();
};

btnLeave.onclick = async () => {
  const ok = confirm("确定退出房间？");
  if (!ok) return;
  await roomRef.child(`players/${myPlayerId}`).remove();
  showEntry();
};

/***************
 * 7) 关闭网页也退出（双保险）
 ***************/
window.addEventListener("beforeunload", () => {
  try { roomRef.child(`players/${myPlayerId}`).remove(); } catch {}
});

/***************
 * 8) 管理员：开始 / 重置（你后续要选人逻辑再加在这里）
 ***************/
btnStart.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能开始");
  // 这里只是示例：你后续的“抽队长/选人/内鬼”等逻辑可以继续接在这里
  await roomRef.child("gameStatus").set({ phase: "started", at: Date.now() });
};

btnReset.onclick = async () => {
  if (!isAdmin()) return alert("只有管理员能重置");
  // 重置只清游戏状态，不清玩家（你要清玩家也行，但一般不清）
  await roomRef.child("gameStatus").remove();
  await roomRef.child("kicked").remove();
};

/***************
 * 9) 踢人：管理员专用
 ***************/
async function kickPlayer(pid){
  if (!isAdmin()) return alert("只有管理员能踢人");
  // 先标记被踢
  await roomRef.child(`kicked/${pid}`).set({ at: Date.now() });
  // 再移除玩家
  await roomRef.child(`players/${pid}`).remove();
}

/***************
 * 10) 实时监听：渲染玩家列表 + 处理被踢
 ***************/
roomRef.on("value", async (snap) => {
  snapshotCache = snap.val() || {};
  render(snapshotCache);

  // 如果我被踢了
  if (snapshotCache.kicked && snapshotCache.kicked[myPlayerId]) {
    alert("你已被管理员踢出房间");
    // 确保我从 players 里移除（双保险）
    await roomRef.child(`players/${myPlayerId}`).remove();
    // 清掉 kicked 标记（否则一直弹）
    await roomRef.child(`kicked/${myPlayerId}`).remove();

    showEntry();
  }
});

function render(state){
  $("roomTitle").textContent = roomId;

  const players = state.players || {};
  const ids = Object.keys(players).sort((a,b)=> (players[a].joinedAt||0)-(players[b].joinedAt||0));

  $("countPlayers").textContent = ids.length;

  // 如果我不在 players 列表里，显示 entry；在则显示 room
  if (players[myPlayerId]) showRoom();
  else showEntry();

  // 管理员面板是否显示
  $("adminPanel").classList.toggle("hidden", !isAdmin());

  // 管理按钮是否可点
  btnStart.disabled = !isAdmin();
  btnReset.disabled = !isAdmin();

  // 玩家列表
  const ul = $("playerList");
  ul.innerHTML = "";

  ids.forEach(pid => {
    const p = players[pid];

    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";
    li.style.gap = "10px";

    const left = document.createElement("span");
    left.textContent = p.displayName || pid;
    li.appendChild(left);

    if (isAdmin()) {
      const btn = document.createElement("button");
      btn.textContent = "删除";
      btn.className = "danger";
      btn.onclick = () => {
        if (confirm(`确定踢出：${p.displayName || pid}？`)) kickPlayer(pid);
      };
      li.appendChild(btn);
    }

    ul.appendChild(li);
  });

  // 状态
  const phase = state.gameStatus?.phase || "lobby";
  if (phase === "started") {
    $("statusBox").textContent = "管理员已开始游戏（后续逻辑可接选人/内鬼）";
  } else {
    $("statusBox").textContent = "大厅中：任何人都可随时加入/退出。";
  }
}
