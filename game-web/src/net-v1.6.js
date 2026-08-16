// ────────────────────────────────────────────────
//  net.js — 連線對戰的網路層（Firebase Realtime Database）
// ────────────────────────────────────────────────
// 為什麼是 Firebase 而不是自己架 server：GitHub Pages 只能放靜態檔案，沒有任何伺服器端
// 程式可以執行，「用一個檔案當共用狀態、每秒更新」在 Pages 上根本寫不進去。Realtime
// Database 免費方案（Spark）對這種規模綽綽有餘：同時連線上限 100、每月下載 10GB。
//
// ── 資料結構刻意拆成兩棵樹 ──
//   /groups/{群名}   輕量的大廳資訊（host、status、成員名單），大廳裡每個人都在訂閱
//   /states/{群名}   完整的遊戲狀態（約 10KB），只有真的在同一局裡的人才訂閱
// 不能把狀態塞進 /groups 底下：大廳的群組列表是對整個 /groups 下 on('value')，會連同
// 子樹全部下載。狀態放進去的話，光是在大廳瀏覽的人就會被迫持續下載所有進行中遊戲的
// 完整狀態，免費方案的 10GB 流量很快就見底。
//
// ── 在線判定只靠 onDisconnect，沒有心跳 ──
// onDisconnect().remove() 是 Firebase 伺服器端的機制：連線一斷（關分頁、關瀏覽器、
// 網路掉了）伺服器就自動把該成員的節點刪掉。所以「在不在線」＝「節點還在不在」，
// 不用比對任何時間戳。
//
// 早期版本另外每秒寫一次 lastSeen 心跳，已經整個移除，因為它有害無益：
//  ‧ 瀏覽器會大幅節流背景分頁的計時器（切 App、鎖螢幕都算），但 WebSocket 在背景
//    是不會斷的——所以玩家只是切出去看個訊息，onDisconnect 完全不會誤判，心跳卻會。
//    當初為了這個把過期門檻從 5 秒放寬到 30 秒，等於承認它本來就不準。
//  ‧ 每人每秒一次寫入，會讓大廳裡所有人每秒重新下載一次 /groups，是整套系統最大的
//    流量來源。拿掉之後 /groups 只在有人加入／離開時才變動。
// 它唯一多做的事是抓「連線還活著但程式卡死」，這種情況很少見，而且遊戲進行中本來
// 就會被其他玩家自然發現（輪到他卻半天不動）。
//
// 自己這台的連線狀態另外用 .info/connected 監看（watchConnection），那才是「我自己
// 斷線了沒」最準的來源。
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
  // ── 幽靈群組的自動清理 ──
  // onDisconnect 幾乎都會正常觸發，但實際遇過沒觸發的情況（成員節點卡了 5 小時），
  // 群組就會永遠留在列表裡、沒有任何機制能讓它過期。心跳已經拿掉，也不打算為了這個
  // 再加回來，改成用「群組活了多久」判斷：任何人打開大廳時順手把過期的清掉，
  // 不需要玩家手動處理，也不用另外跑背景工作。
  // 門檻抓得很寬鬆，寧可晚點清也絕不能誤刪還在玩的：
  //  ‧ 等人中：沒有人會在大廳空等一小時，超過就一定是沒收拾的殘骸
  //  ‧ 進行中：一場再長也不會連續打 12 小時
  STALE_WAITING_MS: 60 * 60 * 1000,
  STALE_PLAYING_MS: 12 * 60 * 60 * 1000,
  // 「進行中」的群組其實已經沒人在玩了嗎？舊版是用「多久沒換回合」猜，但玩家單純去
  // 上廁所、吃飯，回合還沒到就會被誤判成死局讓別人接管走。改成主動問：發一個 ping，
  // 真的還連著的裝置會立刻自動回 pong；等一小段時間沒人回應，才代表可以接管——
  // 不用猜，直接問到答案。
  PING_TIMEOUT_MS: 1500,

  available: false,    // Firebase SDK 有沒有成功載入並初始化
  db: null,
  timeOffset: 0,       // 本機時鐘與伺服器的差；只有判斷群組是否過期時會用到
  _pruning: null,      // 已經送出刪除的 key，避免同一輪重複送
  clientId: null,      // 這台裝置的臨時身分，每次開頁面都重新產生
  groupKey: null,      // 目前所在群組（資料庫的 key，也是本機連線存檔的 key）
  groupName: null,     // 目前所在群組的顯示名稱
  isHost: false,
  myName: '',

  _groupsRef: null, _groupsCb: null,
  _roomRef: null, _roomCb: null,
  _stateRef: null, _stateCb: null,
  _liveRef: null, _liveCb: null,
  _claimsRef: null, _claimsCb: null,
  _pingsRef: null, _pingsCb: null,
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
      this._pruning = new Set();
      // 判斷群組過不過期要用伺服器時間：createdAt 是伺服器寫的，如果拿一支時鐘慢了
      // 好幾小時的手機的本機時間去比，會把還在用的群組誤判成過期直接刪掉。
      // 這個值很少變動，訂閱一次就好，跟以前每秒一次的心跳完全是兩回事。
      this.db.ref('.info/serverTimeOffset').on('value', s => { this.timeOffset = s.val() || 0; });
      this.available = true;
    } catch (e) {
      this.available = false;
    }
    return this.available;
  },

  // 自己這台目前跟 Firebase 連著沒有
  watchConnection(cb) {
    this.db.ref('.info/connected').on('value', s => cb(!!s.val()));
  },

  // Firebase 的 key 不能有 . $ # [ ] / 這幾個字元，換掉；原本的名字另外存 displayName。
  // 群組名同時也是本機連線存檔的 key，所以這個轉換規則一旦定了就不能再改，
  // 不然舊存檔會對不上（見 savegame.js 的 OnlineSave）。
  keyOf(name) { return String(name).trim().replace(/[.$#[\]/\s]+/g, '_').slice(0, 40); },

  // ── 群組列表：只列出還在等人、而且至少有一個成員節點的群組 ──
  watchGroups(cb) {
    this.unwatchGroups();
    this._groupsRef = this.db.ref('groups');
    this._groupsCb = snap => {
      const out = [];
      const now = Date.now() + this.timeOffset;
      snap.forEach(child => {
        const g = child.val() || {};
        // 過期的殘骸：順手清掉，而且不列出來（見上方 STALE_* 的說明）
        if (this.isStale(g, now)) { this.pruneGroup(child.key); return; }
        if (g.status !== 'waiting') return;
        const count = Object.keys(g.members || {}).length;
        if (!count) return;   // 沒人在線的空殼群組不要列出來
        out.push({key: child.key, name: g.displayName || child.key, count, createdAt: g.createdAt || 0});
      });
      out.sort((a, b) => b.createdAt - a.createdAt);
      cb(out);
    };
    this._groupsRef.on('value', this._groupsCb);
  },
  // createdAt 沒寫進去的（理論上不會，防呆）一律不當成過期，寧可留著也不要誤刪
  isStale(g, now) {
    if (!g || !g.createdAt) return false;
    const limit = g.status === 'playing' ? this.STALE_PLAYING_MS : this.STALE_WAITING_MS;
    return (now - g.createdAt) > limit;
  },
  // 刪除是冪等的，多台裝置同時清同一個群組不會有問題；_pruning 只是避免同一台
  // 在列表每次更新時重複送出同樣的刪除要求。
  pruneGroup(key) {
    if (!this._pruning || this._pruning.has(key)) return;
    this._pruning.add(key);
    this.db.ref('groups/' + key).remove().catch(() => this._pruning.delete(key));
  },

  unwatchGroups() {
    if (this._groupsRef && this._groupsCb) this._groupsRef.off('value', this._groupsCb);
    this._groupsRef = null; this._groupsCb = null;
  },

  // ── 建群 ──
  // 用 transaction 而不是先讀再寫：兩個人同時用同一個名字建群時，transaction 能保證
  // 只有一個人成功，另一個人會收到 EXISTS。
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
      // createdAt 改寫成伺服器時間：自動清理是拿它跟伺服器時間比，用建群那台的本機
      // 時鐘會被時鐘不準的裝置害到（慢好幾小時的手機一建群就被判定過期）。
      // ServerValue 不能放在 transaction 裡（transaction 會先在本機試算），所以 commit 後補寫。
      return ref.child('createdAt').set(firebase.database.ServerValue.TIMESTAMP)
        .catch(() => {})
        .then(() => this._enter(key, String(groupName).trim(), playerName));
    });
  },

  // ── 存活探測（ping/pong）──
  // 發一個 ping，等一小段時間看有沒有人回 pong。任何一台「還在這個群組裡」的裝置
  // （已經走過 _enter，還沒 leaveGroup）都掛著 _watchPings，收到就立刻自動回應，
  // 不需要那台裝置的玩家做任何事、也不用它正好開著大廳或房間畫面。
  pingGroup(key) {
    const reqRef = this.db.ref('pings/' + key).push();
    const reqId = reqRef.key;
    const pongRef = this.db.ref('pongs/' + key + '/' + reqId);
    const cleanup = () => { reqRef.remove().catch(() => {}); pongRef.remove().catch(() => {}); };
    return reqRef.set({from: this.clientId, at: firebase.database.ServerValue.TIMESTAMP})
      .catch(() => {})
      .then(() => new Promise(resolve => {
        let done = false;
        const cb = snap => {
          if (done || !snap.exists()) return;
          done = true;
          pongRef.off('value', cb);
          resolve(true);
        };
        pongRef.on('value', cb);
        setTimeout(() => {
          if (done) return;
          done = true;
          pongRef.off('value', cb);
          resolve(false);
        }, this.PING_TIMEOUT_MS);
      }))
      .then(alive => { cleanup(); return alive; }, err => { cleanup(); throw err; });
  },
  // 只要人還在群組裡（不管是在等待室還是遊戲中），就會自動回應別人的存活探測，
  // 證明「我還連著」。回應完隨手把自己那筆清掉，不留垃圾。
  _watchPings(key) {
    this._unwatchPings();
    this._pingsRef = this.db.ref('pings/' + key);
    // 'child_added' 給的 snap 就是新加進來的那一筆 ping 本身（不是整棵樹的清單），
    // 直接用它自己的 key 回應即可。
    this._pingsCb = snap => {
      if (!snap || !snap.key) return;
      this.db.ref('pongs/' + key + '/' + snap.key + '/' + this.clientId).set(true).catch(() => {});
    };
    this._pingsRef.on('child_added', this._pingsCb);
  },
  _unwatchPings() {
    if (this._pingsRef && this._pingsCb) this._pingsRef.off('child_added', this._pingsCb);
    this._pingsRef = null; this._pingsCb = null;
  },

  // ── 續玩之前玩過的群組（大廳「繼續之前的群組」用）──
  // 同一個群組名可能處在三種狀態，要分開處理，不能一律當成「加入」：
  //  ‧ 根本不存在 → 直接建一個新的
  //  ‧ 存在但裡面沒人 → 上一場散會後留下的殼。這種要「接管」：把 host 換成自己、
  //    狀態拉回 waiting。少了這一步，只要上次是玩到一半散會（狀態停在 playing），
  //    之後點續玩就會被 joinGroup 以 STARTED 擋掉，變成怎麼點都沒反應。
  //  ‧ 狀態是「進行中」而且有成員節點 → 可能是真的有人在玩，也可能是幽靈成員
  //    （裝置關了但 onDisconnect 沒觸發）。不能只看「有沒有成員」就判定，會把還在
  //    玩、只是中途離開一下的人踢掉；也不能單純用時間去猜，玩家中途上廁所、吃飯
  //    都可能超過任何合理的門檻。改成直接 ping 一下：真的有人在的話，那台裝置的
  //    _watchPings 會立刻自動回應；沒人回應才代表可以接管。
  //  ‧ 狀態是「等待中」而且有成員 → 一般加入，交給 joinGroup 處理
  openOrReclaim(displayName, playerName) {
    const key = this.keyOf(displayName);
    if (!key) return Promise.reject(new Error('EMPTY'));
    const ref = this.db.ref('groups/' + key);
    return ref.once('value').then(snap => {
      const cur = snap.val();
      if (cur === null) return this._claimGroup(ref, key, displayName, playerName);
      const empty = !cur.members || !Object.keys(cur.members).length;
      if (empty) return this._claimGroup(ref, key, displayName, playerName);
      if (cur.status !== 'playing') return this.joinGroup(key, playerName);
      return this.pingGroup(key).then(alive => {
        if (alive) throw new Error('STARTED');
        return this._claimGroup(ref, key, displayName, playerName);
      });
    });
  },

  // 把一個空殼／確認沒人回應的群組接管過來：host 換成自己、狀態拉回 waiting、
  // 清掉幽靈成員。用 transaction 防的是「兩台裝置都 ping 完、同時搶著接管」這種
  // 罕見但確實會發生的競爭情況。
  _claimGroup(ref, key, displayName, playerName) {
    return ref.transaction(cur => {
      if (cur === null) {
        return {host: this.clientId, status: 'waiting', displayName: String(displayName).trim(), createdAt: Date.now()};
      }
      cur.host = this.clientId; cur.status = 'waiting'; cur.createdAt = Date.now();
      cur.members = null;   // 幽靈成員一併清掉，不然名單裡會留著不存在的人
      return cur;
    }).then(res => {
      if (!res.committed) return this.joinGroup(key, playerName);
      this.isHost = true;
      return ref.child('createdAt').set(firebase.database.ServerValue.TIMESTAMP)
        .catch(() => {})
        .then(() => this._enter(key, String(displayName).trim(), playerName));
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

  // 進入群組：寫下自己的節點、掛上斷線自動清除、開始監聽存活探測（見 pingGroup）
  _enter(key, name, playerName) {
    this.groupKey = key; this.groupName = name; this.myName = playerName;
    this._groupRef = this.db.ref('groups/' + key);
    this._meRef = this._groupRef.child('members/' + this.clientId);
    // 一定要先掛 onDisconnect 再寫資料：反過來的話，如果剛寫完就斷線，
    // onDisconnect 還沒註冊上去，這個人就會永遠留在群組裡變成幽靈成員。
    return this._meRef.onDisconnect().remove()
      .then(() => this._meRef.set({name: playerName, isHost: this.isHost}))
      .then(() => { this._watchPings(key); return true; });
  },

  // ── 監看自己所在的這個群組（成員名單＋狀態）──
  watchRoom(cb) {
    this.unwatchRoom();
    if (!this._groupRef) return;
    this._roomRef = this._groupRef;
    this._roomCb = snap => {
      const g = snap.val();
      if (!g) { cb(null); return; }            // 群組被整個刪掉了
      const members = g.members || {};
      const list = Object.keys(members).map(id => ({
        id,
        name: members[id].name || '玩家',
        isHost: !!members[id].isHost,
        me: id === this.clientId,
      }));
      list.sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0));
      cb({status: g.status, name: g.displayName || this.groupKey, members: list});
    };
    this._roomRef.on('value', this._roomCb);
  },
  unwatchRoom() {
    if (this._roomRef && this._roomCb) this._roomRef.off('value', this._roomCb);
    this._roomRef = null; this._roomCb = null;
  },

  rename(playerName) {
    this.myName = playerName;
    if (this._meRef) this._meRef.child('name').set(playerName).catch(() => {});
  },

  // ── 遊戲狀態：放在 /states，跟大廳的 /groups 分開（見檔頭說明）──
  // 群主開始遊戲時把自己那份上傳，其他人下載，全場從同一個狀態出發。
  uploadState(data) {
    if (!this.groupKey) return Promise.reject(new Error('NOGROUP'));
    return this.db.ref('states/' + this.groupKey).set(data);
  },
  downloadState() {
    if (!this.groupKey) return Promise.reject(new Error('NOGROUP'));
    return this.db.ref('states/' + this.groupKey).once('value').then(s => s.val());
  },
  setStatus(status) {
    if (!this._groupRef) return Promise.resolve();
    return this._groupRef.child('status').set(status);
  },

  // ────────────────────────────────────────────────
  //  即時同步（階段二）
  // ────────────────────────────────────────────────
  // 分成兩條通道，因為兩種資料的大小與更新頻率差太多：
  //
  //  /live/{群名}    輕量即時畫面（約 300 bytes）：誰的回合、每個棋子的座標、骰子點數。
  //                  移動動畫期間每秒推 5 次，觀察者才看得到列車「走」而不是瞬間跳過去。
  //  /states/{群名}  完整存檔（約 10KB）：物產、手牌、資產這些細節。只在回合結束等
  //                  段落點寫一次。
  //
  // 如果只用完整存檔去串流，10KB × 每秒 5 次 = 每秒 50KB，一小時就 180MB，免費方案的
  // 10GB 流量很快見底；反過來只靠 live 又不足以還原整局。分開之後兩邊都很省。
  //
  // ── 誰可以寫？──
  // 同一時間只有「驅動者」會寫（見 rules.js 的 isNetDriver）：輪到的角色被哪台裝置認領，
  // 那台就是驅動者；沒人認領的電腦角色由群主驅動。其他人一律唯讀，連自己的遊戲邏輯都
  // 不跑——只要有兩台同時跑邏輯，骰子亂數與電腦決策馬上就會分歧。
  pushLive(payload) {
    if (!this.groupKey) return;
    this.db.ref('live/' + this.groupKey).set(payload).catch(() => {});
  },
  watchLive(cb) {
    this.unwatchLive();
    if (!this.groupKey) return;
    this._liveRef = this.db.ref('live/' + this.groupKey);
    this._liveCb = s => { const v = s.val(); if (v) cb(v); };
    this._liveRef.on('value', this._liveCb);
  },
  unwatchLive() {
    if (this._liveRef && this._liveCb) this._liveRef.off('value', this._liveCb);
    this._liveRef = null; this._liveCb = null;
  },

  watchState(cb) {
    this.unwatchState();
    if (!this.groupKey) return;
    this._stateRef = this.db.ref('states/' + this.groupKey);
    this._stateCb = s => { const v = s.val(); if (v) cb(v); };
    this._stateRef.on('value', this._stateCb);
  },

  // ── 認領角色的同步 ──
  // 用 transaction 才能保證「兩個人同時點同一隻貓」時只有一個成功；先讀再寫會兩個都成功。
  // 回傳 true＝認領到了，false＝被別人搶先。
  claimSeat(idx, name) {
    const ref = this.db.ref('claims/' + this.groupKey + '/' + idx);
    return ref.transaction(cur => {
      if (cur && cur.id && cur.id !== this.clientId) return undefined;   // 別人的，不動
      return {id: this.clientId, name};
    }).then(res => res.committed);
  },
  releaseSeat(idx) {
    const ref = this.db.ref('claims/' + this.groupKey + '/' + idx);
    return ref.transaction(cur => {
      if (cur && cur.id !== this.clientId) return undefined;   // 只能放掉自己的
      return null;
    }).catch(() => {});
  },
  watchClaims(cb) {
    this.unwatchClaims();
    if (!this.groupKey) return;
    this._claimsRef = this.db.ref('claims/' + this.groupKey);
    this._claimsCb = s => cb(s.val() || {});
    this._claimsRef.on('value', this._claimsCb);
  },
  unwatchClaims() {
    if (this._claimsRef && this._claimsCb) this._claimsRef.off('value', this._claimsCb);
    this._claimsRef = null; this._claimsCb = null;
  },
  clearClaims() {
    if (!this.groupKey) return Promise.resolve();
    return this.db.ref('claims/' + this.groupKey).remove().catch(() => {});
  },

  // ── 離開群組 ──
  // 先取消 onDisconnect 再手動刪自己，然後看看群組是不是空了；空了就把大廳節點收掉，
  // 免得列表裡留一堆沒人的空群組。
  //
  // /states 底下的遊戲狀態刻意「不刪」：
  //  ‧ 最後一個人離開時通常是直接關分頁，這幾個連續的非同步寫入很可能只做到一半，
  //    留下刪一半的殘骸反而更糟。
  //  ‧ 本機存檔是每年三月底才寫回去的，萬一一局玩到七月就散會，四到七月的進度只存在
  //    Firebase 上，刪掉就真的沒了；留著下次同名開群還救得回來。
  //  ‧ 一份約 10KB，免費方案有 1GB，要十萬個群組才會滿；而且下次同名開群時群主上傳
  //    會直接覆蓋，等於自然汰換。
  leaveGroup() {
    this.unwatchRoom();
    this.unwatchState();
    this.unwatchLive();
    this.unwatchClaims();
    this._unwatchPings();
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

  unwatchState() {
    if (this._stateRef && this._stateCb) this._stateRef.off('value', this._stateCb);
    this._stateRef = null; this._stateCb = null;
  },
};
