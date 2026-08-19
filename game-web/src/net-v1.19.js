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
  hostId: null,       // 群主的 clientId（不只是「我是不是群主」，交接 token 時要指名對象）
  myName: '',

  _groupsRef: null, _groupsCb: null,
  _roomRef: null, _roomCb: null,
  _stateRef: null, _stateCb: null,
  _liveRef: null, _liveCb: null,
  _claimsRef: null, _claimsCb: null,
  _pingsRef: null, _pingsCb: null,
  _readyRef: null, _readyCb: null,
  _nudgesRef: null, _nudgesCb: null,
  _pauseRef: null, _pauseCb: null,
  _offersRef: null, _offersCb: null,
  _botsRef: null, _botsCb: null,
  _cmdsRef: null, _cmdsCb: null,
  _offDoneRef: null, _offDoneCb: null,
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
        const members = g.members || {};
        const count = Object.keys(members).length;
        if (!count) return;   // 沒人在線的空殼群組不要列出來
        // 大廳列表看不出這個群組是誰開的，加一下群主名字：members 裡標 isHost 的那個。
        const hostId = Object.keys(members).find(id => members[id] && members[id].isHost);
        const hostName = hostId ? (members[hostId].name || '') : '';
        out.push({key: child.key, name: g.displayName || child.key, count, createdAt: g.createdAt || 0, hostName});
      });
      out.sort((a, b) => b.createdAt - a.createdAt);
      cb(out);
    };
    this._groupsRef.on('value', this._groupsCb);
  },
  // createdAt 沒寫進去的（理論上不會，防呆）一律不當成過期，寧可留著也不要誤刪
  isStale(g, now) {
    if (!g || !g.createdAt) return false;
    // 'started'（真的在玩）跟 'playing'（選角中）都算「進行中」，要用寬鬆的 12 小時門檻。
    // 同樣是 v1.74 漏改的：'started' 以前不存在，這行只認得 'playing'，結果真的開打的
    // 群組會被套用「等人中」的一小時門檻，一場玩超過一小時就會被別人的大廳自動清掉。
    const inProgress = (g.status === 'playing' || g.status === 'started');
    const limit = inProgress ? this.STALE_PLAYING_MS : this.STALE_WAITING_MS;
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
      // 只有「還在等人」才是單純的加入；'playing'（大家在選角）與 'started'（已經開打）
      // 都代表這局可能還有人在，一律先 ping 問過再決定。
      // 這裡原本寫成「不是 playing 就走 joinGroup」，是 v1.74 加進 'started' 這個狀態時
      // 漏改的：真的玩起來的群組狀態是 'started'，而本機的連線存檔正是進遊戲那一刻才寫的
      // （見 main.js 的 finalizeNetStart），所以「繼續之前的群組」列表裡的每一筆最後都停在
      // 'started'——點下去一律掉進 joinGroup，再被它的 status !== 'waiting' 擋掉丟出 STARTED，
      // 變成每一個舊群組都點不動。
      if (cur.status === 'waiting') return this.joinGroup(key, playerName);
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
      // 上一局殘留的「準備」標記、暫停狀態都要清掉，不然接管後一開始就被誤判成
      // 「大家都到齊了」或「還卡在斷線暫停」。
      return this.db.ref('ready/' + key).remove().catch(() => {})
        .then(() => this.db.ref('pause/' + key).remove().catch(() => {}))
        .then(() => ref.child('createdAt').set(firebase.database.ServerValue.TIMESTAMP))
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
      this.hostId = g.host || null;   // token 要交給電腦回合的代跑者時會用到（見 rules 的 handOffToken）
      cb({status: g.status, name: g.displayName || this.groupKey, members: list, host: g.host || null});
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
  // 斷線的人自己回不來放，需要別人（群主）代為釋放。只有在「還是同一筆斷線的認領」
  // 時才動手：expectedClientId 是斷線那台的 id，萬一中途有別的裝置重新認領走這個位子
  // （理論上暫停中不會發生，但保險起見），這裡不會誤把新認領的清掉。
  forceReleaseSeat(idx, expectedClientId) {
    const ref = this.db.ref('claims/' + this.groupKey + '/' + idx);
    return ref.transaction(cur => {
      if (cur && cur.id === expectedClientId) return null;
      return undefined;
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
  // 整份換掉認領資料。開局裁切玩家人數之後，角色的 index 會變（見 main.js 的
  // trimNetPlayers），認領資料的 key 必須跟著換算成新的 index 重寫回去，否則
  // 「第 n 位是誰認領的」會對到錯的人——驅動者判定、斷線暫停都是照這份資料查的。
  // 由群主寫就好：每台算出來的結果都一樣，讓一台寫，其他人從訂閱收到即可。
  // ── 連線新局的電腦角色名單（只有群主寫，其他人唯讀）──
  // 難度如果讓每台各自記在本機，兩邊立刻會不一致（跟認領同一類問題）。
  // 指派電腦這件事整個交給群主負責，寫入者只有一個，其他人單純訂閱顯示。
  setBot(idx, level) {
    if (!this.groupKey) return Promise.resolve();
    const ref = this.db.ref('bots/' + this.groupKey + '/' + idx);
    return (level ? ref.set(level) : ref.remove()).catch(() => {});
  },
  readBots() {
    if (!this.groupKey) return Promise.resolve({});
    return this.db.ref('bots/' + this.groupKey).once('value')
      .then(s => s.val() || {}).catch(() => ({}));
  },
  watchBots(cb) {
    this.unwatchBots();
    if (!this.groupKey) return;
    this._botsRef = this.db.ref('bots/' + this.groupKey);
    this._botsCb = s => cb(s.val() || {});
    this._botsRef.on('value', this._botsCb);
  },
  unwatchBots() {
    if (this._botsRef && this._botsCb) this._botsRef.off('value', this._botsCb);
    this._botsRef = null; this._botsCb = null;
  },
  clearBots(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return this.db.ref('bots/' + k).remove().catch(() => {});
  },

  readClaims() {
    if (!this.groupKey) return Promise.resolve({});
    return this.db.ref('claims/' + this.groupKey).once('value')
      .then(s => s.val() || {}).catch(() => ({}));
  },
  replaceClaims(map) {
    if (!this.groupKey) return Promise.resolve();
    return this.db.ref('claims/' + this.groupKey).set(map || null).catch(() => {});
  },

  // ── 全員一起進遊戲的準備門檻 ──
  // 群主按下「開始遊戲」只是把大家一起送進選角畫面，選角畫面裡再按一次「開始遊戲」
  // 不會立刻進去，而是先標記「我準備好了」。少了這一步，手腳快的人已經在跑，慢的人
  // 還在選角色，這個人的位子當下就會被判定成沒人認領、立刻交給電腦開始行動，
  // 慢的人根本來不及選。等所有目前在房間裡的人都準備好，才把狀態切到 started，
  // 所有裝置在同一刻收到這個變化、一起真正進入遊戲。
  setReady() {
    if (!this.groupKey) return;
    const ref = this.db.ref('ready/' + this.groupKey + '/' + this.clientId);
    ref.onDisconnect().remove();
    ref.set(true).catch(() => {});
  },
  clearMyReady() {
    if (!this.groupKey) return;
    this.db.ref('ready/' + this.groupKey + '/' + this.clientId).remove().catch(() => {});
  },
  clearReady() {
    if (!this.groupKey) return Promise.resolve();
    return this.db.ref('ready/' + this.groupKey).remove().catch(() => {});
  },
  watchReady(cb) {
    this.unwatchReady();
    if (!this.groupKey) return;
    this._readyRef = this.db.ref('ready/' + this.groupKey);
    this._readyCb = s => cb(s.val() || {});
    this._readyRef.on('value', this._readyCb);
  },
  unwatchReady() {
    if (this._readyRef && this._readyCb) this._readyRef.off('value', this._readyCb);
    this._readyRef = null; this._readyCb = null;
  },
  // 所有人是不是都準備好了？只有真的到齊才把狀態切成 started。用 transaction 是因為
  // 好幾台裝置的 watchReady 幾乎會同時發現「到齊了」，只能讓其中一次真的把狀態切過去，
  // 不然重複觸發也沒關係（第二次 transaction 會發現狀態已經不是 playing 而放棄），
  // 這裡用 transaction 純粹是保險。
  tryFinalizeStart(memberCount) {
    if (!this.groupKey || !this._groupRef) return;
    this.db.ref('ready/' + this.groupKey).once('value').then(snap => {
      const readyCount = Object.keys(snap.val() || {}).length;
      if (readyCount < memberCount) return;
      this._groupRef.child('status').transaction(cur => cur === 'playing' ? 'started' : undefined);
    });
  },

  // ── 開局前比對大家手上的存檔記錄 ──
  // 每個人的裝置上都可能有這個群組的舊記錄，而且進度不一定一樣（有人中途離開過）。
  // 以前是「每台自己問自己要不要用自己的」，各答各的、各自上傳，結果每台載入到不同的
  // 狀態，一開局畫面就對不起來。改成：每台把自己手上的記錄「報上來」，統一由群主看過
  // 最新的那一份之後決定要不要用，其他人只看不決定——跟斷線接手同一套權威模型。
  //
  // 報上來的是整份存檔（約 10KB × 人數），不是只有進度數字：群主要是決定採用，
  // 那份資料必須拿得到，總不能再回頭跟那台裝置要一次。
  submitOffer(offer) {
    if (!this.groupKey) return Promise.resolve();
    return this.db.ref('offers/' + this.groupKey + '/list/' + this.clientId)
      .set(offer).catch(() => {});
  },
  readOffers() {
    if (!this.groupKey) return Promise.resolve({});
    return this.db.ref('offers/' + this.groupKey + '/list').once('value')
      .then(s => s.val() || {}).catch(() => ({}));
  },
  watchOffers(cb) {
    this.unwatchOffers();
    if (!this.groupKey) return;
    this._offersRef = this.db.ref('offers/' + this.groupKey + '/list');
    this._offersCb = s => cb(s.val() || {});
    this._offersRef.on('value', this._offersCb);
  },
  unwatchOffers() {
    if (this._offersRef && this._offersCb) this._offersRef.off('value', this._offersCb);
    this._offersRef = null; this._offersCb = null;
  },
  // 群主決定完了：所有人（含群主自己）都是收到這個旗標才往下走，確保大家是拿
  // 同一份最終狀態進遊戲的。
  setOffersDone() {
    if (!this.groupKey) return Promise.resolve();
    return this.db.ref('offers/' + this.groupKey + '/done').set(true).catch(() => {});
  },
  watchOffersDone(cb) {
    this.unwatchOffersDone();
    if (!this.groupKey) return;
    this._offDoneRef = this.db.ref('offers/' + this.groupKey + '/done');
    this._offDoneCb = s => { if (s.val()) cb(); };
    this._offDoneRef.on('value', this._offDoneCb);
  },
  unwatchOffersDone() {
    if (this._offDoneRef && this._offDoneCb) this._offDoneRef.off('value', this._offDoneCb);
    this._offDoneRef = null; this._offDoneCb = null;
  },
  clearOffers(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return this.db.ref('offers/' + k).remove().catch(() => {});
  },

  // ────────────────────────────────────────────────
  //  回合 token：同一時間只有一台裝置有權改變遊戲狀態
  // ────────────────────────────────────────────────
  // 以前是「每台自己判斷自己是不是驅動者」，判斷依據（認領資料、群主身分）在各台
  // 到達的時間不一樣，換人的瞬間就可能兩台都覺得是自己、或兩台都覺得不是自己。
  // 改成把「誰有權操作」寫成 Firebase 上一個明確的節點，大家讀同一份，不再各自推論。
  //
  // turn 是遞增的回合序號，指派一律用 transaction 並且只接受「比現在新」的指派——
  // 手機網路封包會亂序，遲到的舊指派不能覆蓋掉新的，否則兩台會同時以為自己持有。
  tokenHolder: null,     // 目前持有者的 clientId（本機快取，由 watchToken 更新）
  tokenTurn: -1,
  _tokenRef: null, _tokenCb: null,

  watchToken(cb) {
    this.unwatchToken();
    if (!this.groupKey) return;
    this._tokenRef = this.db.ref('token/' + this.groupKey);
    this._tokenCb = s => {
      const t = s.val() || {};
      this.tokenHolder = t.holder || null;
      this.tokenTurn = t.turn == null ? -1 : t.turn;
      cb(t);
    };
    this._tokenRef.on('value', this._tokenCb);
  },
  unwatchToken() {
    if (this._tokenRef && this._tokenCb) this._tokenRef.off('value', this._tokenCb);
    this._tokenRef = null; this._tokenCb = null;
  },
  // 把 token 交給某台裝置。回傳 Promise<boolean>：false 代表這次指派被較新的蓋過而放棄。
  assignToken(holder, turn, cur) {
    if (!this.groupKey) return Promise.resolve(false);
    return this.db.ref('token/' + this.groupKey).transaction(t => {
      if (t && t.turn != null && t.turn >= turn) return undefined;   // 已經有更新的了，放棄
      return {holder, turn, cur, ack: null};
    }).then(r => !!r.committed).catch(() => false);
  },
  // 新持有者收到後回報，讓交接方知道對方真的接手了（沒回報就走斷線流程）
  ackToken(turn) {
    if (!this.groupKey) return Promise.resolve();
    return this.db.ref('token/' + this.groupKey).transaction(t => {
      if (!t || t.turn !== turn || t.holder !== this.clientId) return undefined;
      t.ack = this.clientId;
      return t;
    }).catch(() => {});
  },
  // 群主是誰，以 Firebase 上那份為準。本機的 Net.hostId 是 watchRoom 回來才填的，
  // 交接 token 給電腦代跑者時不能只信它（見 rules 的 handOffToken）。
  readHostId() {
    if (!this.groupKey) return Promise.resolve(null);
    return this.db.ref('groups/' + this.groupKey + '/host').once('value')
      .then(s => s.val() || null).catch(() => null);
  },
  clearToken(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return this.db.ref('token/' + k).remove().catch(() => {});
  },

  // ── 持有者心跳 ──
  // 目的是偵測「拿著 token 的那台中途掛了」。刻意放在獨立節點而不是塞進 /token：
  // /token 是用 on('value') 整個節點監看的，心跳寫進去會讓每台每 2~3 秒重跑一次
  // 回呼（連帶整個 HUD 重繪），白白浪費。
  //
  // 這跟早期那個「每人每秒寫一次 lastSeen」的心跳完全不同：只有**一台**（持有者）
  // 在寫，而且是幾十 bytes，不會回到手機發熱的老路。
  beat() {
    if (!this.groupKey) return;
    this.db.ref('beat/' + this.groupKey).set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
  },
  readBeat() {
    if (!this.groupKey) return Promise.resolve(0);
    return this.db.ref('beat/' + this.groupKey).once('value')
      .then(s => s.val() || 0).catch(() => 0);
  },
  // 開新局一定要清掉。watchLive 用的是 on('value')——一訂閱就立刻收到現有的值，
  // 沒清的話新局一開始每台就會先吃到「上一局最後那一幀」：舊座標、舊的輪到誰、
  // 舊的面板 overlay。同名重開特別明顯，因為 /live 的 key 就是群組名。
  clearLive(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return this.db.ref('live/' + k).remove().catch(() => {});
  },
  clearBeat(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return this.db.ref('beat/' + k).remove().catch(() => {});
  },

  // ── 演出指令通道 ──
  // 到站慶祝、年度結算這類演出，listener 不自己判斷「該不該播」（那還是在算，會分岔），
  // 而是由持有 token 的那台明確下指令，收到才播。用 push 產生單調遞增的 key，
  // 每台記住自己處理到哪一則，重連時不會把舊指令重播一次。
  pushCmd(cmd) {
    if (!this.groupKey) return;
    const ref = this.db.ref('cmds/' + this.groupKey).push();
    ref.set(Object.assign({at: firebase.database.ServerValue.TIMESTAMP}, cmd)).catch(() => {});
    setTimeout(() => ref.remove().catch(() => {}), 30000);   // 用完即丟，不留歷史
  },
  watchCmds(cb) {
    this.unwatchCmds();
    if (!this.groupKey) return;
    this._cmdsRef = this.db.ref('cmds/' + this.groupKey).limitToLast(10);
    const attachedAt = Date.now() + this.timeOffset;
    this._cmdsCb = snap => {
      const c = snap.val();
      if (!c) return;
      // 掛上監聽的瞬間 child_added 會把現有的每一筆都補送一次，濾掉比自己早的
      if (c.at && c.at < attachedAt - 2000) return;
      cb(c);
    };
    this._cmdsRef.on('child_added', this._cmdsCb);
  },
  unwatchCmds() {
    if (this._cmdsRef && this._cmdsCb) this._cmdsRef.off('child_added', this._cmdsCb);
    this._cmdsRef = null; this._cmdsCb = null;
  },
  clearCmds(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return this.db.ref('cmds/' + k).remove().catch(() => {});
  },

  // ── 玩家斷線：暫停、問要不要讓電腦接手 ──
  // 跟大廳無關的訊息，走獨立的一棵樹，不要塞進 /groups 讓每個瀏覽大廳的人都跟著多下載
  // （理由跟 /ready、/pings 一樣）。決定「要不要把斷線的人切成電腦」這件事的權威固定
  // 是群主——跟「沒人認領的電腦角色由群主驅動」是同一套權威模型，才能保證寫得進去
  // （其他人不是驅動者，pushNetState 會被 isNetDriver 擋下，寫了也沒用）。
  setPause(info) {
    if (!this.groupKey) return;
    this.db.ref('pause/' + this.groupKey).transaction(cur => cur === null ? info : undefined);
  },
  clearPause() {
    if (!this.groupKey) return;
    this.db.ref('pause/' + this.groupKey).remove().catch(() => {});
  },
  watchPause(cb) {
    this.unwatchPause();
    if (!this.groupKey) return;
    this._pauseRef = this.db.ref('pause/' + this.groupKey);
    this._pauseCb = s => cb(s.val());
    this._pauseRef.on('value', this._pauseCb);
  },
  unwatchPause() {
    if (this._pauseRef && this._pauseCb) this._pauseRef.off('value', this._pauseCb);
    this._pauseRef = null; this._pauseCb = null;
  },

  // ── 群主斷線時自動換人 ──
  // 群主要是剛好就是斷線的那個人，「群主決定」這件事沒人能做——把群主換成還在線的人
  // 之一，決定權自然跟著轉移，不用另外維護一套「這一次由誰決定」的臨時名單，也順便
  // 修掉「沒人認領的電腦角色從此沒人驅動」這個副作用（isNetDriver 的後援就是看
  // Net.isHost）。用 transaction 是因為好幾台裝置的成員名單監看幾乎會同時發現
  // 「群主不在了」，只讓其中一次真的寫得進去；其餘幾次會在 cur 已經不是舊群主時
  // 自動放棄（transaction 發現條件不成立就中止，不會覆寫別人剛換好的結果）。
  maybeReassignHost(members, oldHostId) {
    if (!this._groupRef) return;
    const ids = Object.keys(members || {});
    if (!ids.length) return;
    this._groupRef.child('host').transaction(cur => {
      if (cur !== oldHostId) return undefined;   // 群主其實還在，或已經被別台換過了
      return ids[Math.floor(Math.random() * ids.length)];
    });
  },

  // ── 還沒真的開始玩之前，有人離開的兩種收拾方式 ──
  // 這兩個都刻意做成「誰呼叫都不會壞」：刪除是冪等的、狀態改動走 transaction，
  // 好幾台裝置的成員名單監看幾乎一定會同時發現有人不見了，重複呼叫不能出事。

  // 群主在等待室／選角階段離開 → 整個群組解散。這個階段還沒有任何進度可以保，
  // 硬撐著讓剩下的人繼續等只會卡死（「開始遊戲」按鈕只有群主有）。刪掉群組節點之後，
  // 每個人的 watchRoom 都會收到 null，統一走「群組已經解散」回大廳。
  // /states 一樣不刪（理由見 leaveGroup 的說明），下次同名開群還救得回來。
  // 一個群組在 Firebase 上散落的所有節點。多一個資料樹就在這裡加一個名字，
  // 不要再回頭去補每個清除函式——以前 disbandGroup 只清五棵，剩下的
  // states／token／cmds／beat 就一直留在資料庫裡沒人收。
  GROUP_NODES: ['groups', 'states', 'live', 'claims', 'ready', 'offers', 'bots',
                'token', 'cmds', 'beat', 'pause', 'nudges', 'pings', 'pongs', 'debug'],

  // 把一個群組從 Firebase 上完全刪掉（解散、或玩家在大廳手動清除都走這裡）
  purgeGroup(key) {
    const k = key || this.groupKey;
    if (!k) return Promise.resolve();
    return Promise.all(this.GROUP_NODES.map(n => this.db.ref(n + '/' + k).remove().catch(() => {})));
  },

  disbandGroup(key) { return this.purgeGroup(key); },

  // 一般成員在選角階段離開 → 把整局拉回等待室重新來過：狀態退回 waiting，
  // 認領與準備標記全部清空。少了這一步，離開的人佔著的角色永遠等不到他回來，
  // 「全員都準備好」的門檻也再也湊不齊（tryFinalizeStart 只在有人按準備時才重算），
  // 整局就卡在選角畫面，每台各看各的。
  // 只有 transaction 真的改到狀態的那一台才順手清 ready／claims，避免好幾台重複清。
  resetToWaiting() {
    if (!this._groupRef || !this.groupKey) return;
    const key = this.groupKey;
    this._groupRef.child('status')
      .transaction(cur => (cur === 'playing' ? 'waiting' : undefined))
      .then(res => {
        if (!res.committed) return;
        this.db.ref('ready/' + key).remove().catch(() => {});
        this.db.ref('claims/' + key).remove().catch(() => {});
      })
      .catch(() => {});
  },

  // ── 打招呼／發訊息（輕量廣播，不是聊天室）──
  // 不做自由輸入文字聊天：手機打字太慢會打斷節奏，而且自由文字需要另外處理不當內容，
  // 預設短句／表情完全不會有這問題。送出的是「誰、說了哪一句」，所有人（含自己）都
  // 會在畫面上跳出 3 秒的提示，不會暫停遊戲邏輯——純粹是不擋輸入的通知，跟連線對戰
  // 本身的驅動者／觀察者機制無關。
  //
  // 用完即丟：8 秒後自動刪除，這棵樹本來就不需要保留歷史紀錄，免得無限長大；
  // 也讓剛加入監看的裝置不會撈到太舊的訊息當成新的顯示出來。
  sendNudge(text) {
    if (!this.groupKey) return;
    const ref = this.db.ref('nudges/' + this.groupKey).push();
    ref.set({from: this.myName || '玩家', text, at: firebase.database.ServerValue.TIMESTAMP})
      .then(() => setTimeout(() => ref.remove().catch(() => {}), 8000))
      .catch(() => {});
  },
  // limitToLast 只是保險（避免掛掉的裝置沒清乾淨、樹越長越大時一次性下載太多筆）；
  // 真正過濾「這是不是舊訊息」是靠比對 at 與掛上監聽當下的時間——child_added 這個事件
  // 在剛掛上監聽時，會把資料庫裡現有的每一筆都當成新增各推送一次，不擋掉的話新加入
  // 群組的人一進來就會看到別人幾秒前傳的舊招呼。
  watchNudges(cb) {
    this.unwatchNudges();
    if (!this.groupKey) return;
    this._nudgesRef = this.db.ref('nudges/' + this.groupKey).limitToLast(5);
    const attachedAt = Date.now() + this.timeOffset;
    this._nudgesCb = snap => {
      const n = snap.val();
      if (!n || (n.at && n.at < attachedAt - 2000)) return;
      cb(n);
    };
    this._nudgesRef.on('child_added', this._nudgesCb);
  },
  unwatchNudges() {
    if (this._nudgesRef && this._nudgesCb) this._nudgesRef.off('child_added', this._nudgesCb);
    this._nudgesRef = null; this._nudgesCb = null;
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
    this.unwatchReady();
    this.unwatchNudges();
    this.unwatchPause();
    this.unwatchOffers();
    this.unwatchOffersDone();
    this.unwatchBots();
    this.unwatchToken();
    this.unwatchCmds();
    this.tokenHolder = null; this.tokenTurn = -1;
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
