// ────────────────────────────────────────────────
//  net.js — 連線對戰的網路層（Firebase Realtime Database）
// ────────────────────────────────────────────────
// 為什麼是 Firebase 而不是自己架 server：GitHub Pages 只能放靜態檔案，沒有任何伺服器端
// 程式可以執行，「用一個檔案當共用狀態、每秒更新」在 Pages 上根本寫不進去。Realtime
// Database 免費方案（Spark）對這種規模綽綽有餘：同時連線上限 100、每月下載 10GB，
// 幾個朋友一起玩用不到零頭。
//
// 這一層只負責「大廳」：建群、列出群組、加入、離開，以及誰在線上。真正的遊戲狀態同步
// 是下一階段的事，這裡刻意不碰 Game，保持單純。
//
// 線上判定以 onDisconnect 為主、心跳為輔：
//  ‧ onDisconnect().remove()（主要）：Firebase 伺服器端的機制，連線一斷（關分頁、關瀏覽器、
//    網路掉了）就自動把這個人的節點刪掉。這是「伺服器看得到 socket 死了」，不受瀏覽器
//    任何節流影響，最可靠。
//  ‧ lastSeen 心跳（輔助）：每秒寫一次伺服器時間戳，用來抓「socket 還連著但程式已經卡死」
//    這種 onDisconnect 抓不到的狀況。
// 心跳的過期門檻刻意放得很寬（30 秒）：瀏覽器會把背景分頁的 setInterval 大幅節流（切到
// 其他 App、鎖螢幕都算），窗口開太小的話，玩家只是切出去看一下訊息就會被當成斷線踢掉。
// 自己這一格則一律顯示在線——自己在不在根本不用猜，用被節流的心跳去推自己的狀態只會
// 得到「我看到我自己斷線」這種很怪的畫面。
// 比對時間一定要用伺服器時間，不能用各自的 Date.now()——每台裝置的時鐘都不一樣，玩家
// 的手機慢個十幾秒是很常見的事，用本機時間會把在線的人誤判成斷線。
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2m9uZ4sZAuQO5MOs1NuJEZseq8biSpzM",
  authDomain: "sbc-dantei.firebaseapp.com",
  databaseURL: "https://sbc-dantei-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sbc-dantei",
  storageBucket: "sbc-dantei.firebasestorage.app",
  messagingSenderId: "367832268729",
  appId: "1:367832268729:web:a49ded6d38fa01a8420068",
  measurementId: "G-2S08E64YCE",
};

const Net = {
  STALE_MS: 30000,     // 超過這麼久沒有心跳才當作斷線（見檔頭：背景分頁會被節流，窗口要放寬）
  HEARTBEAT_MS: 1000,

  available: false,    // Firebase SDK 有沒有成功載入並初始化
  db: null,
  clientId: null,      // 這台裝置的臨時身分，每次開頁面都重新產生
  groupKey: null,      // 目前所在群組（資料庫的 key）
  groupName: null,     // 目前所在群組的顯示名稱
  isHost: false,
  myName: '',
  timeOffset: 0,       // 本機時鐘與 Firebase 伺服器的差（毫秒）

  _hbTimer: null,
  _groupsRef: null, _groupsCb: null,
  _membersRef: null, _membersCb: null,
  _groupRef: null, _meRef: null,

  // 回傳 false 代表這個環境不能連線（SDK 沒載到、離線、被擋），呼叫端要據此把
  // 「連線對戰」擋掉並說明原因，但單機模式完全不受影響。
  init() {
    if (this.available) return true;
    if (typeof firebase === 'undefined' || !firebase.initializeApp) return false;
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.database();
      this.clientId = 'c' + Math.random().toString(36).slice(2, 10);
      // Firebase 會持續回報「伺服器時間 - 本機時間」的差，拿來校正各裝置時鐘不一致
      this.db.ref('.info/serverTimeOffset').on('value', s => { this.timeOffset = s.val() || 0; });
      this.available = true;
    } catch (e) {
      this.available = false;
    }
    return this.available;
  },

  // 校正過的「現在」：拿來跟別人寫的 lastSeen（伺服器時間）比才有意義
  now() { return Date.now() + this.timeOffset; },
  // id 傳進來時，自己這一格一律算在線（見檔頭說明）
  isFresh(m, id) {
    if (id && id === this.clientId) return true;
    return !!(m && m.lastSeen && (this.now() - m.lastSeen) < this.STALE_MS);
  },

  // 自己這台目前跟 Firebase 連著沒有。這是「我自己的連線狀態」最準的來源，
  // 拿來提示玩家「連線中斷，重新連線中⋯」比用心跳推測可靠得多。
  watchConnection(cb) {
    this.db.ref('.info/connected').on('value', s => cb(!!s.val()));
  },

  // Firebase 的 key 不能有 . $ # [ ] / 這幾個字元，換掉；原本的名字另外存 displayName
  keyOf(name) { return String(name).trim().replace(/[.$#[\]/\s]+/g, '_').slice(0, 40); },

  // ── 群組列表：只列出還在等人、而且至少有一個人在線的群組 ──
  // 每個人都在每秒寫心跳，所以這個監聽器本來就會一直收到更新，不用另外拉一個計時器
  // 重算「誰過期了」。
  watchGroups(cb) {
    this.unwatchGroups();
    this._groupsRef = this.db.ref('groups');
    this._groupsCb = snap => {
      const out = [];
      snap.forEach(child => {
        const g = child.val() || {};
        if (g.status !== 'waiting') return;
        const members = g.members || {};
        const online = Object.keys(members).filter(k => this.isFresh(members[k], k)).length;
        if (!online) return;   // 沒人在線的空殼群組不要列出來
        out.push({key: child.key, name: g.displayName || child.key, count: online, createdAt: g.createdAt || 0});
      });
      out.sort((a, b) => b.createdAt - a.createdAt);
      cb(out);
    };
    this._groupsRef.on('value', this._groupsCb);
  },
  unwatchGroups() {
    if (this._groupsRef && this._groupsCb) this._groupsRef.off('value', this._groupsCb);
    this._groupsRef = null; this._groupsCb = null;
  },

  // ── 建群 ──
  // 用 transaction 而不是先讀再寫：兩個人同時用同一個名字建群時，transaction 能保證
  // 只有一個人成功，另一個人會收到 EXISTS。createdAt 用本機時間就好，它只拿來排序。
  createGroup(groupName, playerName) {
    const key = this.keyOf(groupName);
    if (!key) return Promise.reject(new Error('EMPTY'));
    const ref = this.db.ref('groups/' + key);
    return ref.transaction(cur => {
      if (cur !== null) return undefined;   // 已經有人用這個名字了 → 中止
      return {host: this.clientId, status: 'waiting', displayName: String(groupName).trim(), createdAt: Date.now()};
    }).then(res => {
      if (!res.committed) throw new Error('EXISTS');
      this.isHost = true;
      return this._enter(key, String(groupName).trim(), playerName);
    });
  },

  // ── 加入現有群組 ──
  joinGroup(key, playerName) {
    const ref = this.db.ref('groups/' + key);
    return ref.once('value').then(snap => {
      const g = snap.val();
      if (!g) throw new Error('GONE');
      if (g.status !== 'waiting') throw new Error('STARTED');
      this.isHost = (g.host === this.clientId);
      return this._enter(key, g.displayName || key, playerName);
    });
  },

  // 進入群組：寫下自己的節點、掛上斷線自動清除、開始心跳
  _enter(key, name, playerName) {
    this.groupKey = key; this.groupName = name; this.myName = playerName;
    this._groupRef = this.db.ref('groups/' + key);
    this._meRef = this._groupRef.child('members/' + this.clientId);
    // 一定要先掛 onDisconnect 再寫資料：反過來的話，如果剛寫完就斷線，
    // onDisconnect 還沒註冊上去，這個人就會永遠留在群組裡變成幽靈成員。
    return this._meRef.onDisconnect().remove()
      .then(() => this._meRef.set({
        name: playerName,
        isHost: this.isHost,
        joinedAt: firebase.database.ServerValue.TIMESTAMP,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      }))
      .then(() => { this.startHeartbeat(); return true; });
  },

  startHeartbeat() {
    this.stopHeartbeat();
    const beat = () => {
      if (!this._meRef) return;
      this._meRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
    };
    beat();
    this._hbTimer = setInterval(beat, this.HEARTBEAT_MS);
  },
  stopHeartbeat() { clearInterval(this._hbTimer); this._hbTimer = null; },

  // ── 監看群組成員 ──
  // 回傳的每個人都附上 online（用心跳判定），呼叫端直接拿去畫就好。
  watchMembers(cb) {
    this.unwatchMembers();
    if (!this._groupRef) return;
    this._membersRef = this._groupRef;
    this._membersCb = snap => {
      const g = snap.val();
      if (!g) { cb(null); return; }            // 群組被整個刪掉了
      const members = g.members || {};
      const list = Object.keys(members).map(id => ({
        id,
        name: members[id].name || '玩家',
        isHost: !!members[id].isHost,
        online: this.isFresh(members[id], id),
        me: id === this.clientId,
      }));
      list.sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0));
      cb({status: g.status, name: g.displayName || this.groupKey, members: list});
    };
    this._membersRef.on('value', this._membersCb);
  },
  unwatchMembers() {
    if (this._membersRef && this._membersCb) this._membersRef.off('value', this._membersCb);
    this._membersRef = null; this._membersCb = null;
  },

  rename(playerName) {
    this.myName = playerName;
    if (this._meRef) this._meRef.child('name').set(playerName).catch(() => {});
  },

  // ── 離開群組 ──
  // 先取消 onDisconnect 再手動刪自己，然後看看群組是不是空了；空了就整個收掉，
  // 免得資料庫裡留一堆沒人的空群組（列表雖然會過濾掉，但資料還是會一直長）。
  leaveGroup() {
    this.stopHeartbeat();
    this.unwatchMembers();
    const meRef = this._meRef, groupRef = this._groupRef;
    this._meRef = null; this._groupRef = null;
    this.groupKey = null; this.groupName = null; this.isHost = false;
    if (!meRef) return Promise.resolve();
    return meRef.onDisconnect().cancel().catch(() => {})
      .then(() => meRef.remove().catch(() => {}))
      .then(() => groupRef.child('members').once('value'))
      .then(snap => { if (!snap.exists()) return groupRef.remove().catch(() => {}); })
      .catch(() => {});
  },
};
