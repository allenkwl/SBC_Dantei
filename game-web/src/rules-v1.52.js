// ────────────────────────────────────────────────
//  rules.js — 回合狀態機：擲骰 → 移動 → 事件 → 換人
//  Phase 1：先做「會動的地圖」，經濟系統 Phase 2 再加
// ────────────────────────────────────────────────
// 角色 default 名稱直接用大頭貼檔名（角色大頭貼/ 目錄），玩家可在選角畫面自行改名。
// 要加新角色只要往這個陣列加一筆就好：P3 選角畫面是照 CHARS 產生卡片的，會自動多出一張，
// 方向鍵也是照卡片實際位置導覽，換行幾排都走得到，不用改任何程式。
// key 一旦定下來就不能改——存檔是用 key 記住每位玩家選了哪隻貓的。
// color 是地圖上的玩家標記顏色，八隻要彼此分得出來（橘／黑／灰／藍／桃紅／紫／綠／棕）。
const CHARS = [
  {key:'jukiu',     name:'探險家',   color:'#F08C00', avatar:'assets/avatars/探險家.png'},
  {key:'heichu',    name:'賓士',     color:'#3A3A3A', avatar:'assets/avatars/賓士.png'},
  {key:'baixue',    name:'旅行家',   color:'#B9BFC7', avatar:'assets/avatars/旅行家.png'},
  {key:'lanpo',     name:'站長',     color:'#2B7FD4', avatar:'assets/avatars/站長.png'},
  {key:'zuojia',    name:'作家',     color:'#E0568C', avatar:'assets/avatars/作家.png'},
  {key:'shentong',  name:'小神童',   color:'#7E57C2', avatar:'assets/avatars/小神童.png'},
  {key:'jingshen',  name:'精神小伙', color:'#2FA84F', avatar:'assets/avatars/精神小伙.png'},
  {key:'chuanyuan', name:'船員',     color:'#8B5E34', avatar:'assets/avatars/船員.png'},
];
const STEP_MS = 240;   // 每格移動時間

// 電腦對手：模仿桃鐵風格，等級只差在物產投資積極度與（未來）卡片系統開放程度；
// 移動一律照最短路徑走（跟人類岔路選擇邏輯共用 bestDirection），沒有更「聰明」的抄捷徑或繞路判斷
// cardUse：'none' 完全不出牌／'move' 只用移動類把路走好／'all' 整副都用，含攻擊別人的卡
const AI_PROFILES = {
  1: {label:'電腦（基礎）', buyChance: 0.4, greedy: false, cardUse: 'none'},
  2: {label:'電腦（中等）', buyChance: 0.8, greedy: true,  cardUse: 'move'},
  3: {label:'電腦（高手）', buyChance: 1.0, greedy: true,  cardUse: 'all'},
};

// Phase 2A 金錢地基：貨幣單位「萬元」（新台幣萬元）。起始資金先用固定值，之後平衡調參再回來改這裡
const MONEY = {
  start: 100,
  // 抵達目的地獎金 = 全場目前總資產最高玩家的總資產 × arrivalBonusPct，憑空發放、不扣任何人的錢，
  // 資產越滾越大獎金也跟著水漲船高
  arrivalBonusPct: 80,
};

// 紅藍格金額依四季變動（參考桃鐵：旺季拿得多也虧得多），單位是「總資產（現金＋物產）的百分比」，
// 不是固定萬元——資產 100 萬時藍格拿 3~8 萬，資產漲到 1000 萬時同一格變成拿 30~80 萬，比例不變
const MONEY_SEASON = {
  春天: {blue: [3, 8],  red: [2, 6]},
  夏天: {blue: [5, 12], red: [3, 8]},   // 夏季觀光旺季，藍格獎勵與紅格損失都拉高
  秋天: {blue: [3, 8],  red: [2, 6]},
  冬天: {blue: [2, 6],  red: [4, 10]},  // 冬季觀光淡季，紅格損失反而較重
};

// Phase 3：依企劃書 7.3 節先落地的核心牌組。卡片價格是首次可玩的平衡草案，
// 黃格依系別權重抽取；金色大逆轉牌不會出現在商店。
// 卡片內容（名稱／類型／圖示／價格／說明文字／效果種類）改放到共用檔 cards_data.js，
// 用「卡片編輯器」工具編輯即可生效，不用每次改卡都要重新複製一套 vX.XX 檔案。
const CARD_HAND_LIMIT = CARD_DATA.handLimit;
const CARD_CATALOG = CARD_DATA.catalog;
const CARD_BY_ID = Object.fromEntries(CARD_CATALOG.map(c => [c.id, c]));

// 5.5 節平衡機制的可調參數：落後補助、霸主稅門檻與折扣
const BALANCE = {
  catchUpPct: 8,          // 落後補助：領先者總資產的 8%，每年結算時發給資產最低的玩家
  dominantSharePct: 35,   // 霸主稅門檻：有玩家總資產佔全場 35% 以上就觸發
  dominantDiscount: 0.8,  // 霸主稅生效時，其他玩家買物產打 8 折（霸主本人不打折）
};

// 目的地池：台鐵一等站（依區域分組，供「跨區強制」用）+ 全部離島機場
const DEST_POOL = {
  '北部': ['tr_jilong','tr_qidu','tr_songshan','tr_nangang','tr_banqiao','tr_shulin','tr_taoyuan','tr_zhongli','tr_hsinchu'],
  '中部': ['tr_zhunan','tr_miaoli','tr_fengyuan','tr_changhua','tr_yuanlin'],
  '南部': ['tr_chiayi','tr_tainan','tr_xinzuoying','tr_pingtung','tr_chaozhou'],
  '東部': ['tr_yilan','tr_luodong','tr_taitung'],
  '離島': ['ap_magong','ap_wangan','ap_qimei','ap_kinmen','ap_nangan','ap_beigan','ap_lanyu','ap_lyudao'],
};
const DEST_REGION = {};
Object.entries(DEST_POOL).forEach(([region, ids]) => ids.forEach(id => DEST_REGION[id] = region));
const DEST_ALL = Object.values(DEST_POOL).flat();

const Game = {
  players: [], cur: 0,
  year: 1, month: 4,
  state: 'setup',        // setup | rolling-start | awaitRoll | moving | awaitBranch | landed
  dice: 0, stepsLeft: 0,
  path: [],              // 本次移動已走過的站點堆疊（含起點），支援退回
  destination: null,     // 目前的共同目的地站點 id
  destDist: null,        // Map：任一站點 → 到目的地的 BFS 最短步數
  assetHistory: [],      // 每年三月結算後的全員總資產快照，供年度決算折線圖使用
  netGroup: null,        // 連線對戰時＝群組 key（同時是連線存檔的 key）；單機為 null
  netGroupName: null,    // 群組的顯示名稱（key 會把空白換成底線，列表要顯示原本的名字）
  netPaused: false,      // 有玩家斷線，全員暫停等群主決定要不要讓電腦接手（見 main.js 的 watchPause）

  // ────────────────────────────────────────────────
  //  連線對戰：誰負責跑邏輯、以及即時串流
  // ────────────────────────────────────────────────
  // 同一時間只能有「一台」裝置在跑遊戲邏輯。骰子是亂數、電腦決策也有亂數，只要兩台
  // 同時跑，第一顆骰子就會分歧，之後整局完全對不起來。所以規則是：
  //  ‧ 輪到的角色被這台認領（Seats.byPlayer 有這個 index）→ 這台是驅動者
  //  ‧ 沒人認領（電腦角色）→ 由群主驅動
  // 其他人是純觀察者：不跑邏輯、不接受輸入，只把收到的狀態畫出來。

  // 全場目前的認領狀況（角色 index → {id, name}），由 main.js 的 watchClaims 持續更新。
  // 判斷驅動者一定要看「全場」的認領，不能只看自己認領了哪些（見下面 isNetDriver）。
  netClaims: {},

  // 這台現在有沒有「操作權」。單機永遠有；連線時完全以 Firebase 上的 token 為準，
  // 不再由各台自己從認領資料＋群主身分推論——推論的依據在各台到達時間不同，
  // 換人那一瞬間就會出現「兩台都覺得是自己」或「兩台都覺得不是自己」。
  hasToken() {
    if (!this.netGroup) return true;
    return typeof Net !== 'undefined' && Net.tokenHolder === Net.clientId;
  },
  // 沒有 token 的裝置是純觀察者：不跑任何遊戲邏輯，只把收到的狀態與指令演出來。
  isListener() { return !!this.netGroup && !this.hasToken(); },

  isNetDriver() {
    // token 上線之後，「誰能動」只有一個答案，下面那些推論全部改成直接看 token。
    if (Net && Net.tokenHolder != null) return this.hasToken();
    if (!this.netGroup) return true;                 // 單機：自己就是驅動者
    if (typeof Seats === 'undefined') return true;
    if (Seats.byPlayer && Seats.byPlayer.has(this.cur)) return true;   // 這個角色是我認領的
    // 這一段以前寫成「其餘情況一律 return Net.isHost」，是個很嚴重的 bug：輪到別人
    // 認領的角色時，群主這台的 Seats.byPlayer.has(cur) 也是 false，就掉到那行變成
    // 群主同時也是驅動者——認領的人跟群主兩台會各自擲骰、各自換回合，畫面立刻分岔
    // （使用者回報的「兩個玩顯示不同角色」就是這個）。
    // 正確規則：這個角色只要被「任何人」認領走了，就只有那個人是驅動者；
    // 真的沒人認領（電腦角色）才輪到群主代跑。
    if (this.netClaims && this.netClaims[this.cur]) return false;
    return typeof Net !== 'undefined' && Net.isHost;  // 沒人認領的電腦角色交給群主跑
  },
  isNetObserver() { return !!this.netGroup && !this.isNetDriver(); },

  // 輕量即時畫面：只有棋子座標這類「動起來才看得到」的東西，約 300 bytes。
  // 移動動畫期間會被高頻呼叫，所以刻意不塞物產／手牌那些大東西（那些走 pushNetState）。
  _liveSeq: 0,
  _liveAt: 0,
  _lastLive: null,
  pushNetLive(force) {
    if (!this.netGroup || !this.isNetDriver()) return;
    // 節流：動畫每一幀都推的話流量會爆掉，每 200ms 一次就足夠讓對方看到連續移動
    const now = Date.now();
    if (!force && now - this._liveAt < 200) return;

    // 座標取整數：動畫中的 ax 是 882.4713134765625 這種浮點數，光一個數字就吃掉 18 個
    // 字元，取整數只要 3 個——地圖上差不到一個像素，肉眼看不出來，封包卻小一大截。
    const body = {
      cur: this.cur, year: this.year, month: this.month,
      state: this.state, stepsLeft: this.stepsLeft,
      destination: this.destination || null,
      dice: this._liveDice || null,
      // 現在畫面上開著哪個面板（物產／到站慶祝／年度結算／無）。放在 live 而不是做成
      // 「開/關」兩個一次性指令：每一幀都重述現況，漏掉封包下一幀就自動修正；
      // 指令式的話漏一則就永遠卡住（面板一直開著或根本沒開）。
      overlay: (typeof UI !== 'undefined' && UI.netOverlayNow && UI.netOverlayNow()) || null,
      players: this.players.map(p => ({
        pos: p.pos, ax: Math.round(p.ax), ay: Math.round(p.ay), money: p.money,
        train: p.train || 'local', vehicleMode: p.vehicleMode || 'train',
        // 直接把真實軌跡的最後幾點帶過去，觀察者不要再自己拼。
        // render 的車尾只取車頭後方 TRAIL_DIST(13.5) 個單位，而站間距約 25~60，
        // 所以 8 個點綽綽有餘；一個點取整數後約 10 bytes，成本很低。
        tr: (p.trail || []).slice(-8).map(pt => [Math.round(pt.x), Math.round(pt.y)]),
      })),
    };

    // 內容沒變就完全不送。這一行是省電的關鍵：等人按擲骰的空檔佔了遊戲大半時間，
    // 原本那段時間仍然每秒寫 5 次到 Firebase，手機會持續發熱耗電。改成只有「畫面
    // 真的有變化」才送之後，閒置時完全靜默——接收端的監聽照樣掛著（那只是一條
    // WebSocket，幾乎不耗電），所以別人的動作還是即時看得到。
    const json = JSON.stringify(body);
    if (json === this._lastLive) return;
    this._lastLive = json;
    this._liveAt = now;
    body.seq = ++this._liveSeq;
    Net.pushLive(body);
  },

  // ────────────────────────────────────────────────
  //  回合轉換的畫面呈現（driver 與 listener 共用同一份）
  // ────────────────────────────────────────────────
  // 以前這些事情寫在 nextPlayer() 裡，而 nextPlayer() 是 driver 專屬——每加一個演出，
  // listener 那邊就要另外補一次傳遞，連續補了六次（骰子、換月、年度結算、鏡頭…）。
  // 改成用「新舊狀態的差異」驅動，兩邊呼叫同一個函式：driver 在 nextPlayer 尾端呼叫，
  // listener 在收到權威狀態時呼叫。以後新增演出只要加在這裡，兩邊自動都有。
  turnSnapshot() {
    return {cur: this.cur, month: this.month, year: this.year, state: this.state};
  },
  applyTurnPresentation(prev) {
    if (!prev) return;
    const curChanged = prev.cur !== this.cur;
    const monthChanged = (prev.month !== this.month || prev.year !== this.year);

    // 換人：收起上一位的骰子，鏡頭移到接手那位的列車上
    if (curChanged) {
      UI.clearDice();
      if (!Render.freeLook) {
        const pl = this.curPlayer();
        if (pl) Render.follow(pl.ax, pl.ay);
      }
    }
    // 換月與遊戲結束：driver 那邊是用「帶回呼」的版本播的（回呼要負責推進回合），
    // 所以這裡只補給 listener，避免 driver 播兩次。
    if (monthChanged && this.state !== 'gameover' && this.isListener()) {
      UI.showMonthBanner(this.month, () => {});
    }
    // 遊戲結束：以前只有 driver 會跑到 endGame()，整局結束其他人完全不知道
    if (prev.state !== 'gameover' && this.state === 'gameover' && this.isListener()) {
      UI.showGameOver(this.finalRanking());
    }
  },

  // 結算排名（endGame 與 listener 端共用，避免兩邊各算一份）
  finalRanking() {
    return this.players.map(p => {
      const stallsValue = (p.stalls || []).reduce((sum, s) => sum + s.price, 0);
      return {name: p.name, avatar: p.avatar, money: p.money, stallsValue, total: this.totalAssetsOf(p)};
    }).sort((a, b) => b.total - a.total);
  },

  // 觀察者：照著 live 裡的 overlay 開／關面板。
  // 只有「面板身分」變了才重開（避免每次勾選變動都整個重畫、閃爍）；
  // 同一個物產面板就只更新勾選狀態。
  _shownOverlaySig: null,
  _syncOverlay(ov) {
    if (typeof UI === 'undefined') return;
    // 只有「換了一個面板」才重開（同一個面板只是勾選變動就不重畫，避免閃爍）
    const sig = ov ? [ov.m, (ov.d && ov.d.s) || '', (ov.d && ov.d.p) != null ? ov.d.p : ''].join('|') : null;
    if (sig !== this._shownOverlaySig) {
      this._shownOverlaySig = sig;
      UI.closeNetOverlays();
      if (ov) UI.openNetPanel(ov);   // 照 NET_PANELS 那張表還原，不用一個一個列舉
    }
    if (ov && ov.m === 'showStallShop') UI.applyStallSelection((ov.d && ov.d.sel) || []);
  },

  // 發演出指令（單機不用發，沒有 token 的也不該發）
  pushCmd(cmd) {
    if (!this.netGroup || !this.hasToken() || typeof Net === 'undefined') return;
    Net.pushCmd(cmd);
  },

  // 完整狀態：物產、手牌、資產這些細節，只在回合結束等段落點推一次
  // 每份權威狀態都帶版本號與寫入者。版本號單調遞增（只有持 token 的那台會寫，
  // 而它一定看過目前最新的版本），接收端據此丟掉比手上更舊的封包——手機網路封包
  // 亂序很常見，沒有這道防線的話舊狀態會把新狀態蓋回去。
  _stateVer: 0,
  _seenStateVer: -1,
  pushNetState() {
    if (!this.netGroup || !this.hasToken()) return;
    const ver = Math.max(this._stateVer, this._seenStateVer) + 1;
    this._stateVer = ver; this._seenStateVer = ver;
    // 群組中途被解散等情況下 uploadState 會 reject，沒接住會變成 uncaught rejection；
    // 推不上去就算了，下一次段落點會再推一次。
    Net.uploadState(Object.assign(this.serialize(), {ver, by: Net.clientId})).catch(() => {});
  },

  // 玩家斷線、群主決定讓電腦接手：把這個角色標成 AI，之後 isNetDriver 的「沒人認領
  // 交給群主」後援就會自動接手跑它的回合，不用另外寫驅動邏輯。只有群主會呼叫這個
  // （main.js 的 resolveDisconnect），因為只有群主推的完整狀態能保證寫得進去
  // （isNetDriver 對其他人一律是 false，pushNetState 會被擋下）。
  convertToAI(idx) {
    const pl = this.players[idx];
    if (!pl) return;
    pl.isAI = true;
    if (!pl.aiLevel) pl.aiLevel = 1;
    this.pushNetState();
  },

  // ── 觀察者：把收到的輕量畫面套用到本機，純渲染，不碰任何遊戲邏輯 ──
  applyNetLive(v) {
    if (!v || !this.players.length) return;
    this.cur = v.cur; this.year = v.year; this.month = v.month;
    this.state = v.state; this.stepsLeft = v.stepsLeft;
    if (v.destination && v.destination !== this.destination) this.setDestination(v.destination);
    (v.players || []).forEach((sp, i) => {
      const p = this.players[i];
      if (!p) return;
      p.pos = sp.pos; p.money = sp.money;
      p.train = sp.train; p.vehicleMode = sp.vehicleMode;
      // 軌跡直接照抄驅動者送過來的真實路徑，觀察者完全不做任何推測。
      //
      // 這裡先後試錯過兩次，都是因為想「用取樣點自己拼軌跡」：
      //  ‧ v1.76：每 200ms 取樣一點就往後接，遇到瞬移或長距離會拉出一條橫越地圖的直線，
      //    車廂沿著它散開（加了距離門檻仍治標）。
      //  ‧ v1.86：靜止時收成單點——車廂不散了，但 render 的 angAtEnd() 需要兩點才算得出
      //    方向，只剩一點會回傳 0，於是所有列車永遠朝右。
      //  ‧ v1.88：改成在車頭後方鋪一段合成直線——方向對了，但「直線」把轉彎的形狀也抹平，
      //    短軌道上本該分屬不同方向的兩截車廂全部排成一直線。
      // 根本問題是「猜」：真實軌跡是沿著軌道折線走的，取樣或合成都還原不出轉角。
      // 直接傳過來就沒有這個問題，也不用再維護任何門檻與角度記憶。
      p.ax = sp.ax; p.ay = sp.ay;
      if (sp.tr && sp.tr.length) p.trail = sp.tr.map(pt => ({x: pt[0], y: pt[1]}));
    });
    // 驅動者收起骰子（land／nextPlayer 會呼叫 UI.clearDice）之後，live 的 dice 會變成
    // null。觀察者的 land() 是被擋掉的，不會自己清，所以要在這裡跟著收——不然列車都
    // 開始走了，骰子還留在對方畫面上。
    if (!v.dice) UI.clearDice();
    // 骰子：seq 變了才重播一次動畫，不然每次收到 live 都會重擲
    if (v.dice && v.dice.seq !== this._seenDiceSeq) {
      this._seenDiceSeq = v.dice.seq;
      UI.showDice(v.dice.values, v.dice.total, () => {});
    }
    this._syncOverlay(v.overlay || null);
    const me = this.curPlayer();
    if (me && !Render.freeLook) Render.follow(me.ax, me.ay);
    UI.update();
  },

  // 觀察者收到完整狀態：物產／手牌這些 live 沒帶的細節在這裡補齊
  applyNetState(data) {
    if (!data) return;
    // 自己剛寫出去的那份會原封不動回送，套用只是白工
    if (data.by && typeof Net !== 'undefined' && data.by === Net.clientId) return;
    // 比手上這份舊的一律丟掉（亂序保護）。這裡刻意不看「我是不是觀察者」——
    // 剛拿到 token 的那台已經不是觀察者了，但它正需要交接方推過來的那份最新狀態；
    // 用觀察者身分當條件的話，token 比 state 先到就會漏掉，接手的人會從舊資料算起。
    if (data.ver != null) {
      if (data.ver <= this._seenStateVer) return;
      this._seenStateVer = data.ver;
    }
    if (!data || !data.players) return;
    data.players.forEach((pd, i) => {
      const p = this.players[i];
      if (!p) return;
      p.money = pd.money; p.stalls = pd.stalls || []; p.cards = pd.cards || [];
      p.aiLevel = pd.aiLevel || 1;
      // isAI 刻意「不」照抄對方那份。它在這套程式裡原本的意思是「沒有本機輸入裝置
      // 操作這個角色」，是每台各自算的——所以在別人的裝置上，我的角色本來就會被標成
      // isAI。照抄回來等於把自己的角色變成電腦（左上角顯示電腦玩家、輪到自己時
      // maybeAutoRoll 還會自動幫你擲，人完全插不上手）。
      // 連線時要用全域的定義重算：沒有「任何人」認領這個座位，才是電腦。
      if (this.netGroup) p.isAI = !(this.netClaims && this.netClaims[i]);
      else p.isAI = !!pd.isAI;
    });
    const _prev = this.turnSnapshot();
    this.year = data.year; this.month = data.month; this.cur = data.cur;
    if (data.state) this.state = data.state;
    if (data.stepsLeft != null) this.stepsLeft = data.stepsLeft;
    this.assetHistory = Array.isArray(data.assetHistory) ? data.assetHistory : [];
    if (data.destination && data.destination !== this.destination) this.setDestination(data.destination);
    // 物產擁有權要照存檔重建，否則觀察者看到的地圖上誰買了什麼會是舊的
    Data.stations.forEach(st => { if (st.stalls) st.stalls.forEach(x => { x.owner = null; }); });
    this.players.forEach((p, i) => {
      (p.stalls || []).forEach(owned => {
        const st = Data.stations.get(owned.station);
        const x = st && st.stalls && st.stalls.find(y => y.name === owned.name && y.price === owned.price && y.owner == null);
        if (x) x.owner = i;
      });
    });
    this.applyTurnPresentation(_prev);   // 換人／換月／遊戲結束的演出，跟 driver 共用同一份
    UI.update();
  },

  pickDestination(exclude) {
    const excludeRegion = exclude ? DEST_REGION[exclude] : null;
    let pool = DEST_ALL.filter(id => id !== exclude && DEST_REGION[id] !== excludeRegion);
    if (!pool.length) pool = DEST_ALL.filter(id => id !== exclude);
    return pool[Math.floor(Math.random() * pool.length)];
  },

  // 換目的地時一併重算最短路徑距離表（後面選路提示、HUD 步數都靠這張表）
  setDestination(id) {
    this.destination = id;
    this.destDist = Board.distancesFrom(id);
  },

  // 從候選方向（含走回頭路的那個）挑出「走了會離目的地更近」且最近的那個，供 UI 標成綠色
  bestDirection(fromId, cands) {
    if (!this.destDist) return null;
    const curDist = this.destDist.get(fromId);
    if (curDist === undefined) return null;
    let best = null, bestDist = curDist;
    cands.forEach(c => {
      const d = this.destDist.get(c);
      if (d !== undefined && d < bestDist) { bestDist = d; best = c; }
    });
    return best;
  },

  // Y 目的地模式：搜尋剛好消耗完剩餘骰子點數的合法走法。
  // 直接回頭在一般走法會退回步數，因此這裡不把它算成「消耗一格」的路徑。
  reachableRoutes() {
    const pl = this.curPlayer();
    if (!pl || this.state !== 'awaitBranch' || this.stepsLeft < 1) return new Map();
    const start = pl.pos;
    const startPrev = this.path.length > 1 ? this.path[this.path.length - 2] : null;
    const targetSteps = this.stepsLeft;
    const routes = new Map();
    const queue = [{id: start, prev: startPrev, steps: 0, path: [start]}];
    const seen = new Set([`${start}|${startPrev || ''}|0`]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor];
      if (node.steps === targetSteps) {
        if (!Data.isTile(node.id) && node.id !== start) routes.set(node.id, node.path);
        continue;
      }
      Board.neighbors(node.id).forEach(next => {
        if (next === node.prev) return;
        const key = `${next}|${node.id}|${node.steps + 1}`;
        if (seen.has(key)) return;
        seen.add(key);
        queue.push({id: next, prev: node.id, steps: node.steps + 1, path: [...node.path, next]});
      });
    }
    return routes;
  },

  toggleReachableRoutes() {
    if (this.state !== 'awaitBranch') return;
    if (this.reachableMode) {
      this.reachableMode = false; this.reachableSelected = null; this._reachableRoutes = null;
      Render.clearReachableStations();
      Render.resetToTrain();   // 選站的時候鏡頭可能跟著捲到別處，關閉時要回到列車
      const pl = this.curPlayer();
      UI.showBranch(pl.pos, Board.neighbors(pl.pos), this.bestDirection(pl.pos, Board.neighbors(pl.pos)));
      UI.update();
      UI.toast('已關閉可到達站點標示');
      return;
    }
    const routes = this.reachableRoutes();
    if (!routes.size) { UI.toast('這個點數沒有可剛好抵達的站點'); return; }
    this.reachableMode = true;
    this._reachableRoutes = routes;
    this.reachableSelected = null;
    UI.hideBranch();
    Render.setReachableStations(routes.keys());
    UI.showReachableStations(routes);
    UI.update();
    UI.toast(`已圈選 ${routes.size} 個可到站：←→左右循環、↑↓上下循環；A／空白鍵確認`);
  },

  selectReachableDirection(dirKey) {
    if (!this.reachableMode || !this._reachableRoutes || !Board.DIR_VEC[dirKey]) return false;
    // 跟卡片商店的方向鍵導覽（UI.moveGridFocus）、探路放大鏡（Board.nearestInDirection）同一套邏輯：
    // 不是把候選站排成一條線再循環（那樣「往右」常常跳到座標右邊但离很遠的站，選錯視覺上的目標），
    // 是照地圖實際座標找這個方向最近、偏移角度最小的一個站；這個方向完全沒有候選站時，
    // 才循環跳到對面最邊緣的站，保證每一站都按得到。
    const [dx, dy] = Board.DIR_VEC[dirKey];
    const ids = [...this._reachableRoutes.keys()];
    const curId = this.reachableSelected;
    const base = Data.stations.get(curId) || Data.stations.get(this.curPlayer().pos);
    let best = null, bestScore = Infinity;
    ids.forEach(id => {
      if (id === curId) return;
      const st = Data.stations.get(id); if (!st) return;
      const vx = st.x - base.x, vy = st.y - base.y;
      const proj = vx * dx + vy * dy;            // 沿按下方向的投影距離
      if (proj <= 0.01) return;                  // 不在這個方向上
      const lateral = Math.abs(vx * dy - vy * dx);   // 偏離方向軸線的橫向距離
      if (lateral > proj) return;                // 偏超過約 45 度就不考慮
      const score = proj + lateral * 2;           // 同一直線上優先，偏移小的優先
      if (score < bestScore) { bestScore = score; best = id; }
    });
    if (!best) {
      const coord = id => { const s = Data.stations.get(id); return dx !== 0 ? s.x : s.y; };
      const forward = dx > 0 || dy > 0;
      const others = ids.filter(id => id !== curId);
      if (!others.length) return false;
      best = others.reduce((a, b) => (forward ? coord(a) <= coord(b) : coord(a) >= coord(b)) ? a : b);
    }
    return this.selectReachableStation(best);
  },
  selectReachableStation(id) {
    if (!this.reachableMode || !this._reachableRoutes || !this._reachableRoutes.has(id)) return false;
    this.reachableSelected = id;
    UI.setReachableSelection(id);
    const st = Data.stations.get(id);
    Render.jumpTo(st.x, st.y);   // 站點常常在畫面外，方向鍵選到哪裡鏡頭就跟著捲過去，跟探路放大鏡同一套做法
    UI.toast(`已選擇「${st ? st.name : id}」：按 A／空白鍵前往`);
    return true;
  },
  confirmReachableStation() {
    const id = this.reachableSelected;
    if (!this.reachableMode || !id || !this._reachableRoutes || !this._reachableRoutes.has(id)) {
      UI.toast('請先用方向鍵選擇一個可到達站點'); return false;
    }
    const route = this._reachableRoutes.get(id);
    if (UI._diceAwaiting) UI.dismissDiceAfterKey(null);
    this.reachableMode = false;
    this.reachableSelected = null;
    this._reachableRoutes = null;
    Render.clearReachableStations();
    Render.resetToTrain();   // 確認前進：取消手動視角，讓鏡頭在移動動畫時正常跟著列車走
    UI.hideBranch(); UI.update();
    this._autoRoute = route.slice(1);
    this.runAutoRoute();
    return true;
  },
  // 滑鼠點站是直接操作，不必再按確認；鍵盤／手把則使用 select + confirm 兩段式。
  chooseReachableStation(id) {
    if (!this.selectReachableStation(id)) return false;
    return this.confirmReachableStation();
  },

  runAutoRoute() {
    const toId = this._autoRoute && this._autoRoute.shift();
    if (!toId) { this.advance(); return; }
    const pl = this.curPlayer();
    this.state = 'moving';
    const pts = Data.edgePath(pl.pos, toId);
    pl.vehicleMode = this.vehicleModeFor(Data.routeNameOf(pl.pos, toId));
    this.updateVehicleBGM(pl.vehicleMode);
    Render.movePiece(pl, pts, STEP_MS, () => {
      pl.pos = toId;
      pl.trail.push(...pts.slice(1));
      if (pl.trail.length > 40) pl.trail.splice(0, pl.trail.length - 40);
      this.path.push(toId);
      this.stepsLeft--;
      UI.update();
      this.runAutoRoute();
    });
  },

  // config：每個玩家的設定陣列 [{charKey, name, isAI, aiLevel}]，來自人數選擇畫面（角色可任選，不綁玩家順序）
  // quickWinTarget：快速模式的目標總資產（萬元），null／0 代表不啟用，維持原本比年數的結局判定
  start(n, config, totalYears, quickWinTarget) {
    this.players = (config && config.length ? config : CHARS.slice(0, n).map(c => ({charKey: c.key}))).map(cfg => {
      const c = CHARS.find(ch => ch.key === cfg.charKey) || CHARS[0];
      return {
        ...c, name: cfg.name || c.name, isAI: !!cfg.isAI, aiLevel: cfg.aiLevel || 1,
        pos: null, ax: 0, ay: 0, train: 'local', vehicleMode: 'train', trail: [], money: MONEY.start, stalls: [],
        cards: [], cardUsedThisTurn: false, nextDicePenalty: 0, skipTurns: 0, shield: false,
        propertyDiscount: false, agriBonus: false,
      };
    });
    this.totalYears = totalYears || 5;
    this.quickWinTarget = quickWinTarget || null;
    this._stallCityIndex = null;   // 縣市→有物產站點清單的快取，換局要重建
    this.saveSlot = null;   // 由 main.js 在呼叫 start() 之後立刻設定成玩家選的檔案匣編號
    this.netGroup = null; this.netGroupName = null; this.netClaims = {};   // 單機開新局：確實清掉上一局可能留下的連線群組與認領
    this.cur = 0; this.year = 1; this.month = 4;
    this.assetHistory = [];
    this.state = 'rolling-start';
    // 物產／攤位擁有權重置（資料來自地圖編輯器，掛在站點物件上，重新開局要清空 owner）
    Data.stations.forEach(st => { if (st.stalls) st.stalls.forEach(s => { s.owner = null; }); });
    UI.update();
    BGM.playSeason(this.month);
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.classList.add('show');
    // 打招呼鈕只有連線對戰才有意義（單機沒有其他人可以傳）；這裡是單機開新局，
    // netGroup 一定是 null，直接關掉。
    const nudgeBtn = document.getElementById('btn-nudge');
    if (nudgeBtn) nudgeBtn.classList.remove('show');

    // 月份畫面立刻蓋住地圖，選出發站的邏輯在畫面被蓋住期間執行，玩家不會看到地圖閃一下
    let st, dst;
    UI.showMonthBanner(this.month, () => {
      this.beginTurn();
      UI.toast(`全員從「${st.name}」出發！目的地：${dst.name} — ${this.players[0].name} 先攻`);
      this.autoSave();   // 開局第一次自動存檔，檔案匣列表馬上就能看到這局的資訊
    });

    setTimeout(() => {
      const startId = DEST_ALL[Math.floor(Math.random() * DEST_ALL.length)];
      st = Data.stations.get(startId);
      this.players.forEach(p => { p.pos = startId; p.ax = st.x; p.ay = st.y; p.trail = [{x: st.x, y: st.y}]; });
      this.setDestination(this.pickDestination(startId));
      Render.snapTo(st.x, st.y);
      dst = Data.stations.get(this.destination);
      UI.update();
    }, 900);
  },

  // 玩家現在看得到的是不是遊戲畫面本身。手機把分頁放到背景很久，作業系統通常只是
  // 「凍結」而不是關掉重來——JS 環境沒有重新執行，之前排隊的 setTimeout 還在。這段
  // 期間如果玩家其實已經回到主畫面／設定／選角這些畫面（不管是怎麼回去的），電腦
  // 玩家的自動擲骰不該在背後繼續跑，不然玩家之後隨便點一下、音效解鎖，才會突然聽到
  // 一聲延遲很久的擲骰聲，感覺像「遊戲自己在背景偷跑」。
  // #game 這塊畫布本身一直是 display:block（背景常駐，見 quitToSetup 的說明），
  // 真正決定「現在看得到的是不是它」的是這些會整個蓋上去的導覽畫面有沒有開著。
  isGameplayVisible() {
    // 這些畫面統一用 style.display = 'flex' 開、'none' 關（跟 ui.js 判斷選單開關的
    // 方式一致），沒被 JS 動過的預設是空字串（CSS 裡本來就是 display:none），
    // 不能用「不等於 none」判斷，那樣預設值的空字串會被誤判成「顯示中」。
    return !['splash', 'splash-mode', 'setup', 'pick', 'save-slots', 'net-lobby', 'net-room']
      .some(id => { const el = document.getElementById(id); return el && el.style.display === 'flex'; });
  },

  // 電腦玩家輪到自己時自動擲骰（模擬「思考」的短暫停頓），真人玩家不受影響
  maybeAutoRoll() {
    const pl = this.curPlayer();
    if (!pl || !pl.isAI) return;
    if (this.isNetObserver()) return;   // 觀察者不跑電腦邏輯，畫面由驅動者串流過來
    if (!this.isGameplayVisible() || this.netPaused) return;
    setTimeout(() => {
      if (this.state !== 'awaitRoll' || this.curPlayer() !== pl) return;
      if (!this.isGameplayVisible() || this.netPaused) return;   // 排隊的這 700ms 之間畫面可能被蓋住、或有人斷線觸發了暫停
      const profile = AI_PROFILES[pl.aiLevel] || AI_PROFILES[1];
      const pick = pl.cardUsedThisTurn ? null : this.aiPickCard(pl, profile);
      if (pick) {
        const card = this.cardOf(pl.cards[pick.index]);
        this.useCard(pick.index, pick.option);
        // 骰子卡（指定骰／2、3、5 顆骰）用完會自己接著擲，捷徑與計程車喵則直接把這回合的
        // 移動走完，兩者都不能再擲一次；其餘卡片（攻擊、防禦、財務）用完還停在 awaitRoll，
        // 沒有人會幫它擲，要自己補上。
        if (!['fixedDice', 'doubleDice', 'tripleDice', 'fiveDice', 'teleport', 'taxi'].includes(card.effect)) {
          this.aiRollAfterCard(pl);
        }
        return;
      }
      this.roll();
    }, 700);
  },

  // 電腦選卡：每回合只能出一張（cardUsedThisTurn），所以要挑「這一回合最有價值」的那張，
  // 而不是手牌裡的第一張——以前是找到清單裡第一張就用，手上有高鐵週遊券就算只剩兩步也照用，
  // 一次衝 5 顆骰直接飛過目的地，才會出現「用了週遊券反而好幾輪到不了站」。
  //
  // 抵達判定是「剛好停在目的地」（land() 比對 pl.pos === destination），走過頭不算，
  // 所以所有移動卡都要看 destDist（離目的地還有幾步）決定值不值得用。
  // 回傳 {index, option} 或 null；option 就是 useCard 的第二個參數（指定骰的點數、攻擊卡的目標）。
  aiPickCard(pl, profile) {
    const mode = profile.cardUse;
    if (mode === 'none' || !pl.cards.length) return null;
    const hand = pl.cards.map((entry, i) => ({i, entry, card: this.cardOf(entry)})).filter(o => o.card);
    if (!hand.length) return null;
    const eff = (list, e) => list.find(o => o.card.effect === e);
    const dist = this.destDist ? this.destDist.get(pl.pos) : undefined;
    const move = hand.filter(o => o.card.type === '移動');

    if (dist !== undefined) {
      // 捷徑卡直接飛到固定站點：只有飛過去真的明顯更接近目的地（至少省 3 步）才用，
      // 否則等於白白丟掉一張好卡
      let bestTele = null, bestTeleDist = dist - 2;
      move.forEach(o => {
        if (o.card.effect !== 'teleport') return;
        const d = this.destDist.get(o.card.target);
        if (d !== undefined && d < bestTeleDist) { bestTele = o; bestTeleDist = d; }
      });
      if (bestTele) return {index: bestTele.i, option: null};
      // 剩 1~6 步：指定骰可以直接指定點數，一步剛好踩上目的地，是最有價值的一張
      const fixed = eff(move, 'fixedDice');
      if (fixed && dist >= 1 && dist <= 6) return {index: fixed.i, option: dist};
      // 計程車喵固定前進 8 格
      const taxi = eff(move, 'taxi');
      if (taxi && dist === 8) return {index: taxi.i, option: null};
      // 多骰卡的期望點數：2 顆約 7、3 顆約 10.5、5 顆約 17.5。距離夠遠才划算，
      // 太近用大骰只會衝過頭、停不到目的地。
      const five = eff(move, 'fiveDice'), triple = eff(move, 'tripleDice'), dbl = eff(move, 'doubleDice');
      if (five && dist >= 14) return {index: five.i, option: null};
      if (triple && dist >= 9) return {index: triple.i, option: null};
      if (dbl && dist >= 5) return {index: dbl.i, option: null};
    }
    if (mode !== 'all') return null;

    // ── 以下只有高手會用：攻擊、防禦、財務 ──
    // 攻擊卡不佔用移動（用完照樣擲骰），所以移動類沒挑到才輪到這裡，不會互相排擠。
    const others = this.players.map((p, i) => ({p, i})).filter(o => o.i !== this.cur);
    if (others.length) {
      const distOf = o => (this.destDist ? this.destDist.get(o.p.pos) : undefined);
      // 想擋人就找「快到目的地的」，想搶錢就找「最有錢的」
      const nearest = others.reduce((a, b) => {
        const da = distOf(a), db = distOf(b);
        if (da === undefined) return b;
        if (db === undefined) return a;
        return db < da ? b : a;
      });
      const richest = others.reduce((a, b) => (this.totalAssetsOf(b.p) > this.totalAssetsOf(a.p) ? b : a));
      const nearestDist = distOf(nearest);
      // 大風吹：對手離目的地比自己近很多時，跟他交換位置最賺
      const swap = eff(hand, 'swap');
      if (swap && dist !== undefined && nearestDist !== undefined && nearestDist + 4 < dist) {
        return {index: swap.i, option: nearest.i};
      }
      // 對手快到站了就擋他：颱風假讓他停一次、塞車卡扣他點數
      if (nearestDist !== undefined && nearestDist <= 6) {
        const skip = eff(hand, 'skip');
        if (skip) return {index: skip.i, option: nearest.i};
        const traffic = eff(hand, 'traffic');
        if (traffic) return {index: traffic.i, option: nearest.i};
      }
      // 搶錢類一律挑最有錢的下手
      const steal = eff(hand, 'steal');
      if (steal) return {index: steal.i, option: richest.i};
      const summon = eff(hand, 'summon');
      if (summon) return {index: summon.i, option: richest.i};
    }
    // 財務類：樂透貓期望值最高（0～1000 萬），其次夜市大豐收
    const lucky = eff(hand, 'lucky');
    if (lucky) return {index: lucky.i, option: null};
    const cash = eff(hand, 'cash');
    if (cash) return {index: cash.i, option: null};
    // 防禦卡先開著等別人打過來；已經有護盾就不用再疊一張
    if (!pl.shield) {
      const shield = eff(hand, 'shield');
      if (shield) return {index: shield.i, option: null};
    }
    return null;
  },

  // 攻擊／防禦／財務卡用完不會自己擲骰，要電腦自己補擲。但被搶錢的玩家如果因此變成負債，
  // 真人會跳出「變賣資產」視窗（settleDebt → UI.showAssetSale），那段期間 state 仍停在
  // awaitRoll，直接擲下去骰子會蓋在賣資產的視窗上。所以等視窗收掉再擲；最多等 30 秒就放棄，
  // 避免任何意外狀況讓電腦無限等下去。
  aiRollAfterCard(pl) {
    const tryRoll = (tries = 0) => {
      if (this.curPlayer() !== pl) return;
      if (!this.isGameplayVisible() || this.netPaused) return;   // 同 maybeAutoRoll：畫面被蓋住、或有人斷線觸發暫停時不要偷跑
      const sale = document.getElementById('debt-sale');
      const blocked = sale && sale.style.display === 'flex';
      if (this.state === 'awaitRoll' && !blocked) { this.roll(); return; }
      if (tries < 60) setTimeout(() => tryRoll(tries + 1), 500);
    };
    setTimeout(tryRoll, 900);
  },

  beginTurn() {
    if (this.isListener()) return;
    const pl = this.curPlayer();
    if (!pl) return;
    pl.cardUsedThisTurn = false;
    // 升級列車卡的車型只在使用的那個回合有效，每回合開始先重設回普通車；
    // 這一行也順便讓讀取舊存檔（train 可能是已經移除的舊 key）時不會抓不到圖。
    pl.train = 'local';
    const proceed = () => {
      if (pl.skipTurns > 0) {
        pl.skipTurns--;
        UI.update();
        UI.showCardFlash('🌪️', `${pl.name} 受到颱風假影響，本回合暫停！`);
        setTimeout(() => this.nextPlayer(), 1200);
        return;
      }
      this.state = 'awaitRoll';
      UI.update();
      this.maybeAutoRoll();
    };
    if (pl.nextGhostLoss) {
      const loss = Math.max(1, Math.round(pl.money * pl.nextGhostLoss / 100));
      pl.money -= loss;
      pl.nextGhostLoss = 0;
      UI.showCardFlash('🐧', `臭屁鬼搗蛋！${pl.name} 損失 ${formatMoney(loss)}元。`);
      this.settleDebt(pl, proceed);
    } else {
      proceed();
    }
  },

  // 遊戲進行中按 B 結束遊戲、玩家在確認視窗按下確定：直接在原地清乾淨切回選人數畫面。
  // 故意不整頁 reload——reload 會讓瀏覽器退出全螢幕模式，畫面跳成視窗模式再彈回全螢幕很突兀。
  quitToSetup() {
    UI.clearDice();
    UI.hideBranch();
    Render.clearReachableStations();
    this.reachableMode = false; this._reachableRoutes = null; this.reachableSelected = null;
    ['card-hand', 'card-shop', 'card-targets', 'card-dice', 'card-draw', 'card-discard',
     'stall-shop', 'debt-sale', 'destination-celebration', 'annual-settlement', 'settings-menu',
     'scout-info', 'nudge-panel']
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    this.state = 'setup';
    this.players = [];
    // 連線對戰中結束遊戲：一併退出群組。少了這一步，自己已經離開了，其他人的成員
    // 名單裡卻還留著你，要等 onDisconnect（關分頁才會觸發）或群組過期才會消失。
    if (this.netGroup && typeof Net !== 'undefined' && Net.groupKey) Net.leaveGroup();
    this.netGroup = null; this.netGroupName = null; this.netClaims = {};
    const nudgeBtn = document.getElementById('btn-nudge');
    if (nudgeBtn) nudgeBtn.classList.remove('show');
    // 不用把 #game 藏起來——它的 CSS 預設就是 display:block（一直在背景），
    // 從頭到尾都是靠選人數/設定角色這些畫面疊上去蓋住，沒有任何地方會在開新局時把它變回來，
    // 這裡如果手動藏起來，下一局開始後畫面會變全黑。
    BGM.play('setup');
    window.showSetupScreen();
  },

  // 現金被扣到負的：立刻強制變賣物產抵債（賣出價＝標價 8 折）。真人跳變賣面板讓玩家自己選；
  // 電腦從最便宜的開始賣，賣到現金不再是負的或賣光為止。全部賣光現金還是負的，就讓它維持負數，
  // HUD 會顯示紅字，遊戲照常繼續，不會淘汰玩家或結束遊戲。
  settleDebt(pl, done) {
    if (pl.money >= 0) { done(); return; }
    if (!pl.stalls || !pl.stalls.length) { UI.update(); done(); return; }
    if (pl.isAI) {
      const sorted = [...pl.stalls].sort((a, b) => a.price - b.price);
      const sold = [];
      for (const s of sorted) {
        if (pl.money >= 0) break;
        this.sellStallFor(pl, s);
        sold.push(s.name);
      }
      UI.toast(`${pl.name} 資金不足，變賣了「${sold.join('、')}」抵債。`);
      UI.update();
      done();
    } else {
      UI.showAssetSale(pl, () => { UI.update(); done(); });
    }
  },

  // 依玩家 stalls 清單裡的一筆紀錄，找回站點上對應的物產物件、清空 owner、
  // 從玩家清單移除，並把 8 折的賣出價加回現金。回傳賣出價供呼叫端顯示用。
  sellStallFor(pl, stallRecord) {
    const idx = pl.stalls.indexOf(stallRecord);
    if (idx === -1) return 0;
    const st = Data.stations.get(stallRecord.station);
    const s = st && st.stalls && st.stalls.find(x => x.name === stallRecord.name && x.price === stallRecord.price && x.owner === this.players.indexOf(pl));
    if (s) s.owner = null;
    pl.stalls.splice(idx, 1);
    const sellPrice = Math.max(1, Math.floor(stallRecord.price * 0.8));
    pl.money += sellPrice;
    return sellPrice;
  },

  curPlayer() { return this.players[this.cur]; },

  // ── 手牌項目（cards 陣列的元素）──────────────────────────────
  // 單次卡就直接存卡片 id 字串（跟以前一樣）；週遊券這種可用多次的卡片改存
  // {id, uses:剩餘次數} 物件。兩種混著放，好處是舊存檔裡的純字串手牌不用轉檔就能直接讀，
  // 而且 serialize() 是直接把 cards 丟進 JSON，物件也能原樣存下來。
  // 所有要從手牌項目拿卡片定義的地方，一律走下面這幾個 helper，不要直接 CARD_BY_ID[entry]。
  cardIdOf(entry) { return typeof entry === 'string' ? entry : (entry && entry.id); },
  cardOf(entry) { return CARD_BY_ID[this.cardIdOf(entry)]; },
  // 剩餘可用次數：單次卡回傳 null（呼叫端用 null 判斷「不用顯示次數」）
  cardUsesLeft(entry) { return (entry && typeof entry === 'object' && entry.uses != null) ? entry.uses : null; },
  // 依卡片定義決定要放字串還是物件進手牌（cards_data.js 裡有 uses 欄位的就是多次卡）
  newCardEntry(id) {
    const c = CARD_BY_ID[id];
    return (c && c.uses) ? {id, uses: c.uses} : id;
  },

  drawCard(pl, source = '黃格', allowedTypes = null) {
    // 手牌已滿也照樣能抽（黃格翻卡是強制事件），抽完超過上限由呼叫端（revealYellowCard）
    // 導去丟卡流程；商店買卡等其他管道各自在呼叫前就檢查過上限，不會走到這裡超過。
    let pool = CARD_CATALOG.filter(c => c.type !== '大逆轉' && (!allowedTypes || allowedTypes.includes(c.type)));
    // 黃格遵循企劃書草案比例：移動 35 / 財務 30 / 防禦 20 / 攻擊 12 / 大逆轉 3。
    if (!allowedTypes && source === '黃格') {
      const roll = Math.random() * 100;
      const type = roll < 35 ? '移動' : roll < 65 ? '財務' : roll < 85 ? '防禦' : roll < 97 ? '攻擊' : '大逆轉';
      pool = CARD_CATALOG.filter(c => c.type === type);
    }
    const card = pool[Math.floor(Math.random() * pool.length)];
    pl.cards.push(this.newCardEntry(card.id));
    UI.showCardFlash(card.icon, `${pl.name} 從${source}獲得「${card.name}」！`);
    return card;
  },

  useCard(index, option = null) {
    if (this.isListener()) return;
    const pl = this.curPlayer();
    if (this.state !== 'awaitRoll' || !pl || pl.cardUsedThisTurn) return;
    const entry = pl.cards[index];
    const card = this.cardOf(entry);
    if (!card) return;
    const targetEffects = new Set(['summon', 'skip', 'steal', 'traffic', 'swap']);
    if (targetEffects.has(card.effect) && option == null) {
      UI.hideCardHand();
      UI.showCardTargets(card, this.players.map((p, i) => ({p, i})).filter(o => o.i !== this.cur), index);
      return;
    }
    if (card.effect === 'fixedDice' && option == null) {
      UI.hideCardHand(); UI.showDicePicker(card, index); return;
    }
    // 週遊券這類多次卡：扣一次剩餘次數，扣到 0 才從手牌移除；單次卡照舊直接移除
    const usesLeft = this.cardUsesLeft(entry);
    if (usesLeft != null) {
      entry.uses = usesLeft - 1;
      if (entry.uses <= 0) pl.cards.splice(index, 1);
    } else {
      pl.cards.splice(index, 1);
    }
    pl.cardUsedThisTurn = true;
    // 升級列車卡（區間快車／普悠瑪／高鐵，含各自的週遊券）把棋子換成對應車型的圖示。
    // 只影響這一回合：beginTurn() 每回合開始都會把車型重設回普通車。
    if (card.train) pl.train = card.train;
    UI.hideCardHand(); UI.hideCardTargets(); UI.hideDicePicker();
    const target = option == null ? null : this.players[option];
    const blocked = target && target.shield && targetEffects.has(card.effect);
    if (blocked) {
      target.shield = false;
      UI.showCardFlash('✨', `${target.name} 的防禦卡發動，擋下「${card.name}」！`);
      UI.update(); return;
    }
    switch (card.effect) {
      case 'fiveDice': pl.fiveDice = true; break;
      case 'fixedDice': pl.forcedDice = option; break;
      case 'tripleDice': pl.tripleDice = true; break;
      case 'doubleDice': pl.doubleDice = true; break;
      case 'taxi': this.moveTaxi(pl, card); return;
      // 捷徑類卡片共用同一種效果，目的地站點寫在卡片資料的 target 欄位（例如 tr_hualien／tr_taichung）
      case 'teleport': this.flyShortcut(pl, card); return;
      case 'summon': target.nextGhostLoss = 5; break;
      case 'skip': target.skipTurns = 1; break;
      case 'steal': { const loss = Math.max(1, Math.round(target.money * 0.1)); target.money -= loss; pl.money += loss; break; }
      case 'traffic': target.nextDicePenalty = 2; break;
      case 'swap': this.swapPlayers(pl, target); break;
      case 'shield': pl.shield = true; break;
      case 'cash': pl.money += 2; break;
      case 'agriBonus': pl.agriBonus = true; break;
      case 'discount': pl.propertyDiscount = true; break;
      case 'lucky': pl.money += Math.floor(Math.random() * 1001); break;
      case 'debt': pl.money = Math.max(0, pl.money); break;
    }
    UI.showCardFlash(card.icon, `${pl.name} 使用「${card.name}」！${card.text}`);
    UI.update();
    // 移動骰卡使用後直接取代一般擲骰：指定骰、2／3／5 顆骰都不再要求玩家按第二次按鈕。
    const afterCardEffect = () => {
      if (['fixedDice', 'doubleDice', 'tripleDice', 'fiveDice'].includes(card.effect)) {
        this.state = 'cardRoll';
        UI.update();
        setTimeout(() => this.roll(true), 650);
      }
    };
    if (target && target.money < 0) this.settleDebt(target, afterCardEffect);
    else afterCardEffect();
  },

  // 計程車喵：直接前進固定 8 格，不是擲骰後加 8 點，走的是跟一般移動一樣的逐站引擎
  moveTaxi(pl, card) {
    UI.showCardFlash(card.icon, `${pl.name} 使用「${card.name}」，前進 8 格！`);
    UI.update();
    this.dice = 8;
    this.stepsLeft = 8;
    this.path = [pl.pos];
    this.state = 'moving';
    setTimeout(() => this.advance(), 700);
  },

  // 捷徑卡片：直升機從目前站點飛到卡片指定的目的地站，飛行期間鏡頭跟隨；
  // 動畫演出交給 UI.showShortcutFlight，飛到才回來走 land()（跟一般移動抵達站點同一套流程）。
  flyShortcut(pl, card) {
    const dest = Data.stations.get(card.target);
    if (!dest) return;
    this.state = 'shortcutFlight';
    UI.showShortcutFlight(pl, card, () => {
      pl.pos = card.target; pl.ax = dest.x; pl.ay = dest.y; pl.trail = [{x:dest.x, y:dest.y}];
      UI.update();
      this.land();
    });
  },

  swapPlayers(a, b) {
    const aPos = a.pos, aX = a.ax, aY = a.ay, aTrail = a.trail;
    a.pos = b.pos; a.ax = b.ax; a.ay = b.ay; a.trail = b.trail;
    b.pos = aPos; b.ax = aX; b.ay = aY; b.trail = aTrail;
    Render.follow(a.ax, a.ay);
  },

  roll(fromCard = false) {
    if (this.isListener()) return;   // 沒有 token 就不准改變遊戲狀態
    if (this.netPaused) return;   // 有人斷線、全員暫停中，連按鈕點下去都不該真的擲下去
    if (this.state !== 'awaitRoll' && !(fromCard && this.state === 'cardRoll')) return;
    Render.scoutStation = null;   // 擲骰時收起探路放大鏡游標
    Render.resetToTrain();
    SFX.play('dice');
    const pl = this.curPlayer();
    const forced = pl.forcedDice;
    const diceCount = forced ? 1 : (pl.fiveDice ? 5 : (pl.tripleDice ? 3 : (pl.doubleDice ? 2 : 1)));
    const diceValues = forced ? [forced] : Array.from({length: diceCount}, () => 1 + Math.floor(Math.random() * 6));
    const base = diceValues.reduce((sum, n) => sum + n, 0);
    this.dice = Math.max(1, base - (pl.nextDicePenalty || 0));
    pl.forcedDice = null; pl.doubleDice = false; pl.tripleDice = false; pl.fiveDice = false; pl.nextDicePenalty = 0;
    this.stepsLeft = this.dice;
    this.path = [this.curPlayer().pos];
    this.state = 'moving';
    // 骰子點數放進 live：觀察者靠 seq 變化判斷「這是新的一擲」，才會重播動畫
    // seq 以前是 `(_liveDice ? seq : 0) + 1`，而 nextPlayer 每回合都把 _liveDice 設成 null，
    // 所以每一次擲骰算出來的 seq 都是 1——觀察者第一次記下 1 之後，之後每次都相等，
    // 骰子動畫就再也不播了。改成永不重置的計數器＋裝置 id，跨裝置也不會撞號。
    this._diceSeq = (this._diceSeq || 0) + 1;
    const who = (typeof Net !== 'undefined' && Net.clientId) ? Net.clientId : 'local';
    this._liveDice = {seq: who + ':' + this._diceSeq, values: diceValues, total: this.dice};
    this.pushNetLive(true);
    UI.showDice(diceValues, this.dice, () => this.advance());
    UI.update();
  },

  // 依目前 stepsLeft 決定：走到 0 就停留，否則列車停在下一站等玩家選方向
  // 每次只走一站；候選方向包含「剛剛來的那一站」，跟其他方向平等顯示，
  // 沒有專屬退回按鈕——選了才判斷是不是走回頭路，是的話步數加回來（跟桃鐵一樣）
  advance() {
    if (this.isListener()) return;
    if (this.stepsLeft <= 0) { this.land(); return; }
    const pl = this.curPlayer();
    const cands = Board.neighbors(pl.pos);
    const greenId = this.bestDirection(pl.pos, cands);
    this.state = 'awaitBranch';
    if (pl.isAI) {
      // 電腦不會主動走回頭路（退回上一站會把步數加回來，遇到平手／沒有綠燈時隨機挑很容易來回反彈、
      // 卡在原地一直不停下來）；除非那是唯一能走的方向（死路），否則一律只從「往前」的候選中選。
      // ↑ 這條「排除回頭路」的保護不能拿掉，它就是「電腦永遠走不到站」那個 bug 的解法：
      //   只要每一步都往前，stepsLeft 就嚴格遞減，一定會走到 0 停下來。
      const prev = this.path.length > 1 ? this.path[this.path.length - 2] : null;
      const forward = cands.filter(c => c !== prev);
      const pool = forward.length ? forward : cands;
      // 最短路徑方向就在往前的候選裡，直接走。
      // 否則（最近的一步剛好是回頭路，被上面排除掉了）以前是整組往前候選裡「純隨機」挑一個——
      // 明明 destDist 已經算好了卻完全不用，等於閉著眼睛亂走，繞遠路的元凶就在這裡。改成
      // 挑「往前候選裡離目的地最近」的那個：照樣不走回頭路（終止性不變），但至少是最不糟的選擇。
      // 有並列最近時才在並列的那幾個之中隨機，避免固定偏好造成每次都走同一條路。
      let choice;
      if (greenId !== null && pool.includes(greenId)) {
        choice = greenId;
      } else {
        const scored = pool.map(c => ({c, d: this.destDist ? this.destDist.get(c) : undefined}))
                           .filter(o => o.d !== undefined);
        if (scored.length) {
          const min = Math.min(...scored.map(o => o.d));
          const best = scored.filter(o => o.d === min);
          choice = best[Math.floor(Math.random() * best.length)].c;
        } else {
          choice = pool[Math.floor(Math.random() * pool.length)];   // 沒有距離資料時才真的只能隨機
        }
      }
      setTimeout(() => this.chooseBranch(choice), 350);
      return;
    }
    UI.showBranch(pl.pos, cands, greenId);
    UI.update();
  },

  chooseBranch(toId) {
    if (this.state !== 'awaitBranch') return;
    UI.hideBranch();
    const pl = this.curPlayer();
    const prev = this.path.length > 1 ? this.path[this.path.length - 2] : null;
    this.state = 'moving';
    if (toId === prev) {
      // 退回上一站：步數加回來
      const pts = Data.edgePath(pl.pos, toId);
      pl.vehicleMode = this.vehicleModeFor(Data.routeNameOf(pl.pos, toId));
      this.updateVehicleBGM(pl.vehicleMode);
      Render.movePiece(pl, pts, STEP_MS, () => {
        pl.pos = toId;
        pl.trail.push(...pts.slice(1));
        if (pl.trail.length > 40) pl.trail.splice(0, pl.trail.length - 40);
        this.path.pop();
        this.stepsLeft++;
        UI.update();
        this.advance();
      });
    } else {
      this.stepTo(toId);
    }
  },

  // 依這一段路線名稱決定棋子要顯示的交通工具（船運航線→遊輪、飛機航線→飛機，其餘都是列車）
  vehicleModeFor(routeName) {
    if (routeName === '船運航線') return 'ship';
    if (routeName === '飛機航線') return 'plane';
    return 'train';
  },

  // 移動經過船運／飛機航線時切換成對應的專屬 BGM，走一般鐵路／公路則跟回目前月份的季節配樂。
  // BGM.play() 本身若目標跟目前播放的一樣會直接跳過，所以每走一步都呼叫也不會讓音樂重新從頭播。
  updateVehicleBGM(mode) {
    if (mode === 'ship') BGM.play('sea');
    else if (mode === 'plane') BGM.play('plane');
    else BGM.playSeason(this.month);
  },

  stepTo(toId) {
    const pl = this.curPlayer();
    const pts = Data.edgePath(pl.pos, toId);
    pl.vehicleMode = this.vehicleModeFor(Data.routeNameOf(pl.pos, toId));
    this.updateVehicleBGM(pl.vehicleMode);
    Render.movePiece(pl, pts, STEP_MS, () => {
      pl.pos = toId;
      pl.trail.push(...pts.slice(1));
      if (pl.trail.length > 40) pl.trail.splice(0, pl.trail.length - 40);
      this.path.push(toId);
      this.stepsLeft--;
      UI.update();
      this.pushNetLive(true);   // 每走到一站就同步一次，確保落點準確
      this.advance();
    });
  },

  land() {
    if (this.isListener()) return;
    UI.clearDice();
    this.reachableMode = false; this._reachableRoutes = null; Render.clearReachableStations();
    const pl = this.curPlayer();
    const st = Data.stations.get(pl.pos);
    this.state = 'landed';

    if (pl.pos === this.destination) {
      const richest = Math.max(...this.players.map(p => this.totalAssetsOf(p)));
      const bonus = Math.max(1, Math.round(richest * MONEY.arrivalBonusPct / 100));
      pl.money += bonus;
      UI.update();
      if (this.checkQuickWin()) return;
      // 目的地抵達先演出，玩家按 A／空白鍵揭曉下一站；新目的地確定後，再處理「這一站」原本的購買／事件流程。
      // 到站慶祝大家都要看到。listener 不自己判斷「該不該播」（那還是在算），
      // 由持有 token 的這台明確下指令，收到才播（見 main.js 的 applyNetCmd）。
      UI.showDestinationCelebration(st, pl, bonus, nextId => {
        this.setDestination(nextId);
        UI.update();
        const dst = Data.stations.get(nextId);
        UI.toast(`🚩 下一個目的地：${dst.name}！`);
        this.land(); // 已換目的地，這次會直接走入下方原本的站點事件／物產購買流程
      });
      return;
    }

    if (st.type === '藍格' || st.type === '紅格') {
      const season = Data.seasonOf(this.month);
      const table = MONEY_SEASON[season];
      const assets = this.totalAssetsOf(pl);
      let msg;
      if (st.type === '藍格') {
        const [lo, hi] = table.blue;
        const pct = lo + Math.random() * (hi - lo);
        const gain = Math.max(1, Math.round(assets * pct / 100));
        pl.money += gain;
        msg = `🔵 ${pl.name} 停在藍格！${season}獲得 ${formatMoney(gain)}元`;
      } else {
        const [lo, hi] = table.red;
        const pct = lo + Math.random() * (hi - lo);
        const loss = Math.max(1, Math.round(assets * pct / 100));
        pl.money -= loss;
        msg = `🔴 ${pl.name} 停在紅格！${season}損失 ${formatMoney(loss)}元`;
      }
      UI.toast(msg);
      UI.update();
      if (this.checkQuickWin()) return;
      this.settleDebt(pl, () => setTimeout(() => this.nextPlayer(), 1400));
    } else if (st.type === '黃格') {
      this.state = 'awaitCardDraw';
      UI.update();
      if (pl.isAI) setTimeout(() => this.revealYellowCard(), 700);
      else UI.showCardDraw(pl);
    } else if (st.type === '卡片商店') {
      UI.update();
      if (pl.isAI) this.aiHandleCardShop(pl);
      else UI.showCardShop(pl, st);
    } else if (st.stalls && st.stalls.length) {
      // 物產／攤位：資料掛在站點上（來自地圖編輯器），只要有品項清單就會開店，不限站點類型
      UI.update();
      const avail = st.stalls.some(s => s.owner == null);
      if (!avail) {
        UI.toast(`${pl.name} 抵達「${st.name}」，物產都被買光了！`);
        setTimeout(() => this.nextPlayer(), 1400);
      } else if (pl.isAI) {
        this.aiHandleStallShop(st, pl);
      } else {
        UI.showStallShop(st, pl);
      }
    } else {
      UI.toast(`${pl.name} 抵達「${st.name}」（${Data.typeLabel(st.type)}${st.city ? '・' + st.city : ''}）`);
      UI.update();
      setTimeout(() => this.nextPlayer(), 1400);
    }
  },

  // 霸主稅：誰的總資產佔全場比重最高、又是否達到門檻。回傳門檻玩家的 index，沒人達標回傳 -1
  dominantPlayerIndex() {
    if (this.players.length < 2) return -1;
    const totals = this.players.map(p => this.totalAssetsOf(p));
    const sum = totals.reduce((a, b) => a + b, 0);
    if (sum <= 0) return -1;
    let best = -1, bestShare = 0;
    totals.forEach((t, i) => { const share = t / sum; if (share > bestShare) { bestShare = share; best = i; } });
    return bestShare * 100 >= BALANCE.dominantSharePct ? best : -1;
  },

  // 這位玩家買這個物產實際要付多少錢：霸主稅生效時，非霸主玩家打 8 折（標價本身不變，
  // 之後年度結算收益仍照物產「標價」算，不受這裡的購買折扣影響）
  effectivePrice(pl, s) {
    const dom = this.dominantPlayerIndex();
    let price = (dom === -1 || this.players[dom] === pl) ? s.price : Math.max(1, Math.round(s.price * BALANCE.dominantDiscount));
    if (pl.propertyDiscount) price = Math.max(1, Math.round(price * 0.8));
    return price;
  },

  buyStall(stationId, idx) {
    if (this.isListener()) return;
    const st = Data.stations.get(stationId);
    const s = st && st.stalls && st.stalls[idx];
    const pl = this.curPlayer();
    if (!s || s.owner != null) return;
    const cost = this.effectivePrice(pl, s);
    if (pl.money < cost) return;
    pl.money -= cost;
    pl.propertyDiscount = false;
    s.owner = this.cur;
    pl.stalls.push({station: stationId, name: s.name, price: s.price, rate: s.rate});
    UI.hideStallShop();
    UI.toast(`🛍️ ${pl.name} 買下「${st.name}・${s.name}」（${formatMoney(cost)}元）！`);
    UI.update();
    // 買了物產馬上推給觀察者，不用等到 nextPlayer 才推——不然買了什麼在別人畫面上要
    // 等到換人才會出現，回合中途完全看不到。
    this.pushNetState();
    if (this.checkQuickWin()) return;
    setTimeout(() => this.nextPlayer(), 1200);
  },

  // 真人版一次購買多項：勾選面板送出的品項清單一次結算，跳過中途已經買不起或被買走的
  confirmStallPurchases(stationId, indices) {
    if (this.isListener()) return;
    const st = Data.stations.get(stationId);
    const pl = this.curPlayer();
    const bought = [];
    indices.forEach(idx => {
      const s = st.stalls[idx];
      const cost = s && this.effectivePrice(pl, s);
      if (s && s.owner == null && pl.money >= cost) {
        pl.money -= cost;
        pl.propertyDiscount = false;
        s.owner = this.cur;
        pl.stalls.push({station: stationId, name: s.name, price: s.price, rate: s.rate});
        bought.push(s.name);
      }
    });
    UI.hideStallShop();
    if (bought.length) UI.toast(`🛍️ ${pl.name} 買下「${st.name}・${bought.join('、')}」！`);
    UI.update();
    if (bought.length) this.pushNetState();
    if (this.checkQuickWin()) return;
    setTimeout(() => this.nextPlayer(), bought.length ? 1200 : 400);
  },

  skipStallShop() {
    if (this.isListener()) return;
    UI.hideStallShop();
    UI.update();
    setTimeout(() => this.nextPlayer(), 400);
  },

  // 商店賣什麼、賣多少錢，一律以 cards_data.js（卡片編輯器維護的那份）為準。
  // 地圖資料裡每個卡片商店站點都還留著一份 st.cardShop 清單，但那是早期匯出的快照：
  // 9 個站點的內容完全一樣（沒有「各店賣不同卡」的差異），價格卻是舊的（高鐵快攻 140、
  // 普悠瑪 100），而且沒有後來新增的卡（區間快車、四張城市捷徑、三張週遊券）。
  // 如果照舊優先用 st.cardShop，卡片編輯器改的價格會被蓋掉、新卡也永遠買不到，
  // 所以這裡改成忽略它，直接用卡片目錄。之後若真要做「各店賣不同卡」，
  // 再從地圖編輯器重新匯出一份有差異的清單，並把這裡改成只拿它當「賣哪幾張」的篩選條件。
  cardShopItems(st) {
    return CARD_CATALOG.filter(c => c.price != null).map(c => ({id:c.id, price:c.price}));
  },

  revealYellowCard() {
    if (this.isListener()) return;
    const pl = this.curPlayer();
    if (!pl || this.state !== 'awaitCardDraw') return;
    // 揭曉演出播放完（下面的 setTimeout）之前，卡片面板一直顯示著、鍵盤監聽器也還會吃到確定鍵，
    // 若在演出期間又按一次確定鍵會再呼叫這裡一次，變成一次抽兩張；state 立刻切開避免重複觸發。
    this.state = 'cardRevealed';
    const card = this.drawCard(pl, '黃格');
    UI.revealCardDraw(card, pl);
    UI.update();
    setTimeout(() => {
      UI.hideCardDraw();
      if (pl.cards.length > CARD_HAND_LIMIT) this.handleHandOverflow(pl);
      else this.nextPlayer();
    }, 1600);
  },

  // 抽到卡但手牌已經超過上限：電腦自動丟掉標價最便宜的一張（大逆轉牌沒有標價，電腦不會主動丟），
  // 真人跳選擇面板自己選一張丟掉才能繼續。
  handleHandOverflow(pl) {
    if (pl.isAI) {
      let worstIdx = 0, worstPrice = Infinity;
      pl.cards.forEach((entry, i) => {
        const c = this.cardOf(entry);
        const price = c && c.price != null ? c.price : Infinity;
        if (price < worstPrice) { worstPrice = price; worstIdx = i; }
      });
      pl.cards.splice(worstIdx, 1);
      setTimeout(() => this.nextPlayer(), 600);
    } else {
      UI.showCardDiscard(pl);
    }
  },

  discardCard(index) {
    const pl = this.curPlayer();
    if (!pl || !pl.cards[index]) return;
    const card = this.cardOf(pl.cards[index]); if (!card) return;
    pl.cards.splice(index, 1);
    UI.hideCardDiscard();
    UI.showCardFlash('🗑️', `${pl.name} 丟掉「${card.name}」！`);
    UI.update();
    this.nextPlayer();
  },

  buyCard(cardId) {
    const pl = this.curPlayer(), card = CARD_BY_ID[cardId];
    const st = this._cardShopStation ? Data.stations.get(this._cardShopStation) : null;
    const listing = this.cardShopItems(st).find(item => item.id === cardId);
    const price = listing && listing.price;
    if (!pl || !card || price == null || pl.cards.length >= CARD_HAND_LIMIT || pl.money < price) return;
    pl.money -= price; pl.cards.push(this.newCardEntry(card.id));
    UI.showCardFlash(card.icon, `${pl.name} 買下「${card.name}」！`);
    UI.update(); if (st) UI.showCardShop(pl, st);
  },

  sellCard(index) {
    const pl = this.curPlayer();
    if (!pl || !pl.cards || !pl.cards[index]) return;
    const entry = pl.cards[index];
    const card = this.cardOf(entry); if (!card) return;
    const st = this._cardShopStation ? Data.stations.get(this._cardShopStation) : null;
    const listing = this.cardShopItems(st).find(item => item.id === card.id);
    let sellPrice = Math.floor((listing ? listing.price : card.price || 0) * .8);
    // 週遊券按「剩餘次數比例」折算賣價，不能用剩幾次都賣 8 折——不然買 600 萬的高鐵週遊券、
    // 用掉 5 次再賣回 480 萬，等於 120 萬就買到 5 次高鐵，直接破壞平衡。
    const usesLeft = this.cardUsesLeft(entry);
    if (usesLeft != null && card.uses) sellPrice = Math.max(1, Math.floor(sellPrice * usesLeft / card.uses));
    pl.cards.splice(index, 1); pl.money += sellPrice;
    UI.showCardFlash('💰', `${pl.name} 賣出「${card.name}」，獲得 ${formatMoney(sellPrice)}元！`);
    UI.update(); if (st) UI.showCardShop(pl, st);
  },

  leaveCardShop() { this._cardShopStation = null; UI.hideCardShop(); this.nextPlayer(); },
  skipCardShop() { this.leaveCardShop(); },

  // 測試模式：只能在等待擲骰時開啟（不會卡在移動/岔路/卡片等中途狀態），
  // 傳送單純換位置、不觸發抵達演出或站點事件；加卡片不扣錢、不檢查手牌上限，方便測試用。
  testGotoStation(stationId) {
    const pl = this.curPlayer();
    const st = Data.stations.get(stationId);
    if (!pl || !st || this.state !== 'awaitRoll') return;
    pl.pos = stationId; pl.ax = st.x; pl.ay = st.y; pl.trail = [{x:st.x, y:st.y}];
    Render.follow(st.x, st.y);
    UI.toast(`🧪 ${pl.name} 傳送到「${st.name}」`);
    UI.update();
  },

  testAddCard(cardId) {
    const pl = this.curPlayer();
    const card = CARD_BY_ID[cardId];
    if (!pl || !card || this.state !== 'awaitRoll') return;
    pl.cards.push(this.newCardEntry(cardId));
    UI.showCardFlash(card.icon, `🧪 ${pl.name} 取得「${card.name}」（測試，不扣款）`);
    UI.update();
  },

  aiHandleCardShop(pl) {
    const st = Data.stations.get(pl.pos); this._cardShopStation = st && st.id;
    const choices = this.cardShopItems(st).map(item => ({...CARD_BY_ID[item.id], price:item.price})).filter(c => c && pl.money >= c.price && pl.cards.length < CARD_HAND_LIMIT);
    const card = choices.find(c => c.type === '移動') || choices[0];
    if (card && Math.random() < .65) setTimeout(() => { this.buyCard(card.id); this.leaveCardShop(); }, 700);
    else setTimeout(() => this.leaveCardShop(), 650);
  },

  // 電腦版購買決策：等級只影響「要不要買」與「買最貴還是隨便買」，不牽涉卡片（卡片系統還沒做）
  aiHandleStallShop(st, pl) {
    const profile = AI_PROFILES[pl.aiLevel] || AI_PROFILES[1];
    const affordable = st.stalls
      .map((s, i) => ({s, i}))
      .filter(o => o.s.owner == null && this.effectivePrice(pl, o.s) <= pl.money);
    const doBuy = affordable.length > 0 && Math.random() < profile.buyChance;
    if (doBuy) {
      const pick = profile.greedy
        ? affordable.reduce((a, b) => (b.s.price > a.s.price ? b : a))
        : affordable[Math.floor(Math.random() * affordable.length)];
      setTimeout(() => this.buyStall(st.id, pick.i), 900);
    } else {
      setTimeout(() => this.skipStallShop(), 900);
    }
  },

  // 快速模式：任一玩家總資產達到目標即結束遊戲。回傳 true 代表遊戲已結束（呼叫端要中止後續換人流程）
  checkQuickWin() {
    if (!this.quickWinTarget) return false;
    const winner = this.players.some(p => this.totalAssetsOf(p) >= this.quickWinTarget);
    if (!winner) return false;
    this.endGame();
    return true;
  },

  nextPlayer() {
    if (this.isListener()) return;
    const _prev = this.turnSnapshot();
    this.reachableMode = false; this._reachableRoutes = null; Render.clearReachableStations();
    this._liveDice = null;   // 骰子收起來，下一位才不會又看到上一位的點數
    // 先換人，再推狀態——順序不能反。
    // 舊版是「先 pushNetState 再 this.cur++」，推出去的權威狀態寫的還是舊的 cur，
    // 而換完人之後這台就不再是驅動者、立刻停止推送，於是「輪到下一位」這件事
    // 從頭到尾沒有被任何人寫進權威狀態；下一位只能靠自己也跑一次 nextPlayer 才知道
    // 輪到他了，兩台各自從各自的時機、各自的資料算起——這正是「換玩家時不同步」的成因。
    this.cur = (this.cur + 1) % this.players.length;
    // 收骰子、移鏡頭這些純呈現的事，跟 listener 共用同一份（見 applyTurnPresentation），
    // 不再在這裡各寫一份——以前就是因為兩邊各寫，才會一直發生「driver 有做、listener 忘了做」。
    this.applyTurnPresentation(_prev);
    if (this.cur === 0) {
      const annualData = this.advanceMonth();
      if (this.state === 'gameover') return;   // advanceMonth 可能已經觸發遊戲結束
      UI.update();
      const startNewMonth = () => {
        if (this._annualEndGame) { this._annualEndGame = false; this.endGame(); return; }
        UI.showMonthBanner(this.month, () => {
          this.beginTurn();
        });
      };
      if (annualData) {
        this.state = 'annualSettlement';
        UI.showAnnualSettlement(annualData, startNewMonth);
      } else {
        startNewMonth();
      }
    } else {
      this.beginTurn();
    }
    // 這一輪該做的都算完了，才把「新的 cur ＋ 完整狀態」推出去當權威，最後交出 token。
    // 交接一定要排在推送之後：先放掉 token 的話，接手的人會拿到還沒更新的狀態。
    this.pushNetState();
    this.handOffToken();
  },

  // 把 token 交給下一位。規則（依實際對局情境定）：
  //  ‧ 下一位是真人且有人認領 → 交給那台
  //  ‧ 下一位是電腦 → 沒有主人，交給群主跑；自己就是群主的話直接留著，不用來回丟
  handOffToken() {
    if (!this.netGroup || typeof Net === 'undefined') return;
    const turn = (Net.tokenTurn || 0) + 1;
    const cur = this.cur;
    const assign = next => {
      if (next === Net.clientId) {
        // 還是自己（電腦回合而我是群主）：更新序號就好，不用交接，也不用等 ack
        Net.assignToken(next, turn, cur);
        return;
      }
      Net.assignToken(next, turn, cur).then(ok => {
        if (ok && typeof window.netWatchAck === 'function') window.netWatchAck(next, turn);
      });
    };
    const claim = this.netClaims && this.netClaims[cur];
    if (claim && claim.id) { assign(claim.id); return; }   // 真人：交給認領那台
    // 電腦角色沒有主人，交給群主代跑。群主是誰一定要以 Firebase 那份為準——
    // 本機快取的 Net.hostId 是 watchRoom 回來才填的，還沒填到就會退化成
    // 「誰剛打完誰繼續拿著」，跟約定的規則不一致（實測抓到過）。
    Net.readHostId().then(h => assign(h || Net.hostId || Net.clientId));
  },

  advanceMonth() {
    let annualData = null;
    this.month++;
    if (this.month === 13) this.month = 1;
    if (this.month === 4) {
      const completedYear = this.year;
      const revenueLines = this.settleRevenue();   // 每年 3 月結算物產／攤位收益、落後補助
      const ranking = this.players.map(p => ({name:p.name, color:p.color, avatar:p.avatar, total:this.totalAssetsOf(p)})).sort((a, b) => b.total - a.total);
      const snapshot = {year: completedYear, values: this.players.map(p => ({name:p.name, color:p.color, total:this.totalAssetsOf(p)}))};
      this.assetHistory = this.assetHistory.filter(h => h.year !== completedYear);
      this.assetHistory.push(snapshot);
      this.assetHistory.sort((a, b) => a.year - b.year);
      annualData = {completedYear, ranking, history:this.assetHistory.map(h => ({year:h.year, values:h.values.map(v => ({...v}))}))};
      this.year++;
      this.autoSave();   // 每年 3 月結束、4 月開始前自動存檔一次
      const revMsg = revenueLines.length ? `　物產收益：${revenueLines.join('、')}` : '';
      UI.toast(`📅 第 ${this.year} 年開始！${revMsg}`);
      this._annualEndGame = (this.quickWinTarget && ranking.some(p => p.total >= this.quickWinTarget)) || this.year > this.totalYears;
    }
    BGM.playSeason(this.month);
    return annualData;
  },

  // 縣市→轄內「有物產／攤位」站點清單，資料來自地圖編輯器不會在遊戲中變動，蓋一次就好（換局時清快取重建）
  stallStationsByCity() {
    if (this._stallCityIndex) return this._stallCityIndex;
    const idx = {};
    Data.stations.forEach((st, id) => {
      if (st.stalls && st.stalls.length && st.city) (idx[st.city] = idx[st.city] || []).push(id);
    });
    this._stallCityIndex = idx;
    return idx;
  },

  // 每年 3 月結算：收益 = 標價 × 年收益率(%)，加進現金；同一站的物產／攤位全被同一玩家買下算獨占收益 x2（仿桃鐵），
  // 全縣制霸（該玩家包下轄內每一個有物產站點的全部品項）再疊乘 x2，最高可達 x4；結算後順便發落後補助
  settleRevenue() {
    const cityIndex = this.stallStationsByCity();
    const lines = [];
    this.players.forEach((p, i) => {
      if (!p.stalls || !p.stalls.length) return;
      const byStation = {};
      p.stalls.forEach(s => (byStation[s.station] = byStation[s.station] || []).push(s));

      const citiesTouched = new Set();
      Object.keys(byStation).forEach(stId => {
        const st = Data.stations.get(stId);
        if (st && st.city) citiesTouched.add(st.city);
      });
      const dominatedCities = new Set();
      citiesTouched.forEach(city => {
        const stIds = cityIndex[city] || [];
        const allOwned = stIds.length > 0 && stIds.every(stId => {
          const cst = Data.stations.get(stId);
          return cst.stalls.every(s => s.owner === i);
        });
        if (allOwned) dominatedCities.add(city);
      });

      let total = 0;
      Object.entries(byStation).forEach(([stationId, owned]) => {
        const st = Data.stations.get(stationId);
        const allStalls = (st && st.stalls) || [];
        const monopoly = allStalls.length > 0 && allStalls.every(s => s.owner === i);
        const cityDominated = st.city && dominatedCities.has(st.city);
        owned.forEach(s => {
          const rate = (s.rate == null ? 100 : s.rate) / 100;
          let rev = Math.round(s.price * rate);
          if (p.agriBonus && (st.type === '農村' || st.type === '工廠' || st.type === '觀光農場')) rev = Math.round(rev * 1.2);
          if (monopoly) rev *= 2;
          if (cityDominated) rev *= 2;
          total += rev;
        });
      });
      if (total > 0) {
        p.money += total;
        lines.push(`${p.name} +${formatMoney(total)}${dominatedCities.size ? '（全縣制霸！）' : ''}`);
      }
    });
    const subsidy = this.applyCatchUpSubsidy();
    if (subsidy) lines.push(`${subsidy.name} 落後補助 +${formatMoney(subsidy.amount)}`);
    return lines;
  },

  // 落後補助：每年結算時，總資產最低的玩家額外拿到「目前資產最高玩家」總資產一定比例的補助
  applyCatchUpSubsidy() {
    if (this.players.length < 2) return null;
    const totals = this.players.map(p => this.totalAssetsOf(p));
    const maxTotal = Math.max(...totals);
    if (maxTotal <= 0) return null;
    const minTotal = Math.min(...totals);
    const minIdx = totals.indexOf(minTotal);
    if (maxTotal === minTotal) return null;   // 大家資產都一樣就不用補助
    const amount = Math.round(maxTotal * BALANCE.catchUpPct / 100);
    if (amount <= 0) return null;
    this.players[minIdx].money += amount;
    return {name: this.players[minIdx].name, amount};
  },

  // 總資產 = 現金 + 已買下的物產／攤位標價加總（跟企劃書 5.4 節的資產判定一致；紅藍格金額也是照這個算百分比）
  totalAssetsOf(pl) {
    const stallsValue = (pl.stalls || []).reduce((sum, s) => sum + s.price, 0);
    return pl.money + stallsValue;
  },

  endGame() {
    this.state = 'gameover';
    UI.showGameOver(this.finalRanking());
  },

  // 變更遊戲年數：直接設成新的總年數（可改長可改短），呼叫端要先擋掉小於目前年度的值；
  // 遊戲進行中或已結束都可以呼叫，結束後若新設定夠讓遊戲繼續，會直接把畫面收回去繼續玩
  setTotalYears(newTotal) {
    this.totalYears = newTotal;
    if (this.state === 'gameover' && this.year <= this.totalYears) {
      this.state = 'awaitRoll';
      document.getElementById('gameover').style.display = 'none';
      UI.update();
      this.maybeAutoRoll();
    } else {
      UI.update();
    }
    UI.toast(`📅 遊戲年數已設定為 ${this.totalYears} 年！`);
  },

  // 存檔：只存「resume 遊戲」需要的資料。物產／攤位的擁有權不用整份地圖狀態都存，
  // 讀檔時從每位玩家的 stalls 清單反推回站點上就好
  serialize() {
    return {
      savedAt: Date.now(),
      netName: this.netGroupName || undefined,   // 只有連線存檔會有；單機是 undefined，不會寫進 JSON
      totalYears: this.totalYears,
      quickWinTarget: this.quickWinTarget || null,
      year: this.year, month: this.month, cur: this.cur,
      // 回合階段也是「當前狀況」的一部分，一定要進權威狀態：交接的那一刻 live 剛好
      // 停了，接手的人只能靠這份知道自己是 awaitRoll，否則按擲骰完全沒反應（卡住）。
      // 存檔也共用這個格式，但 loadState 是無條件寫死 state='awaitRoll' 的，不受影響。
      state: this.state, stepsLeft: this.stepsLeft,
      assetHistory: this.assetHistory,
      destination: this.destination,
      players: this.players.map(p => ({
        charKey: p.key, name: p.name, isAI: p.isAI, aiLevel: p.aiLevel,
        money: p.money, pos: p.pos, train: p.train, stalls: p.stalls, cards: p.cards,
        nextDicePenalty: p.nextDicePenalty, skipTurns: p.skipTurns, shield: p.shield,
        propertyDiscount: p.propertyDiscount, agriBonus: p.agriBonus, nextGhostLoss: p.nextGhostLoss,
      })),
    };
  },

  // 連線對戰時，存檔改寫進以群組名為 key 的連線存檔區（跟單機的 10 格完全分開），
  // 而且是「全場每個人各自寫回自己的裝置」——每台都有一份副本，下次任何一個人
  // 都能開同名群組把進度帶回來，不會因為群主換手機就整局消失。
  autoSave() {
    if (this.netGroup) {
      OnlineSave.write(this.netGroup, this.serialize());
      return;
    }
    if (!this.saveSlot) return;
    SaveSystem.write(this.saveSlot, this.serialize());
  },

  // 連線開新局用：直接產出一份跟 serialize() 同樣格式的初始狀態，不實際開始遊戲。
  // 不共用 start()，因為 start() 會跑月份演出、900ms 後才決定出發站，是為了「這台
  // 馬上要開始玩」設計的；這裡只是要一份乾淨的資料丟上 Firebase 給大家一起載。
  // 角色一律先設成電腦，之後每個人在認領角色畫面把自己要的那隻認走（沒人認領的
  // 就維持電腦），這樣連線開新局跟續玩就能走完全同一條路徑。
  // 刻意放進「全部」的貓咪，不是只放 count 隻：選角畫面是照這份清單長出卡片的，
  // 只放 count 隻的話連線版就只看得到前幾隻，跟單機版可以從八隻裡挑不一致
  // （使用者回報的「連線版只有四隻貓咪」）。真正要玩幾個角色由 netPlayerCount 決定，
  // 等大家認領完、真的開局時再照它裁到正確人數（見 main.js 的 Pick.finalizeNetStart）。
  buildFreshState(count, totalYears, quickWinTarget) {
    const startId = DEST_ALL[Math.floor(Math.random() * DEST_ALL.length)];
    return {
      savedAt: Date.now(),
      totalYears: totalYears || 5,
      quickWinTarget: quickWinTarget || null,
      netPlayerCount: count,
      year: 1, month: 4, cur: 0,
      assetHistory: [],
      destination: this.pickDestination(startId),
      players: CHARS.map(c => ({
        charKey: c.key, name: c.name, isAI: true, aiLevel: 1,
        money: MONEY.start, pos: startId, train: 'local', stalls: [], cards: [],
        nextDicePenalty: 0, skipTurns: 0, shield: false,
        propertyDiscount: false, agriBonus: false, nextGhostLoss: 0,
      })),
    };
  },

  // slot：單機的檔案匣編號；連線對戰改傳 {netGroup:'群組key'}，兩者只會擇一。
  loadState(data, slot) {
    if (slot && typeof slot === 'object' && slot.netGroup) {
      this.netGroup = slot.netGroup; this.netGroupName = slot.netGroupName || slot.netGroup;
      this.saveSlot = null;
      // 每一局的狀態版本號都從頭算。這兩個值原本只在頁面載入時初始化、跨局不重設，
      // 於是會出現：第一局打到 ver 50，其中一台重新整理（計數器歸零）後同名重開，
      // 它推出 ver 1，而沒重整的那台 _seenStateVer 還是 50 → 判定「比手上舊」全部丟掉，
      // 那台從此收不到任何權威狀態（使用者回報的「同名重開就不同步」）。
      this._stateVer = 0; this._seenStateVer = -1;
      // 其餘「跨局殘留就會誤判重複」的去重快取一併歸零，都是同一類問題：
      //   _shownOverlaySig  上一局的面板簽章還在 → 新局開同一個面板不會重開
      //   _seenDiceSeq      對方重整後骰子序號從 1 重來 → 新局第一次擲骰被當成看過
      //   _lastLive         live 差異比對的基準 → 第一幀跟上一局結尾相同時不會送出
      this._shownOverlaySig = null;
      this._seenDiceSeq = null;
      this._lastLive = null;
    } else {
      this.saveSlot = slot; this.netGroup = null; this.netGroupName = null; this.netClaims = {};
    }
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.classList.add('show');
    // 打招呼鈕只有連線對戰才顯示：跟其他人才有意義，單機讀檔沒有對象可以傳。
    const nudgeBtn = document.getElementById('btn-nudge');
    if (nudgeBtn) nudgeBtn.classList.toggle('show', !!this.netGroup);
    this.totalYears = data.totalYears;
    this.quickWinTarget = data.quickWinTarget || null;
    this._stallCityIndex = null;
    this.year = data.year; this.month = data.month; this.cur = data.cur;
    this.assetHistory = Array.isArray(data.assetHistory) ? data.assetHistory : [];
    this.players = data.players.map(pd => {
      const c = CHARS.find(ch => ch.key === pd.charKey) || CHARS[0];
      const st = Data.stations.get(pd.pos);
      return {
        ...c, name: pd.name, isAI: !!pd.isAI, aiLevel: pd.aiLevel || 1,
        pos: pd.pos, ax: st.x, ay: st.y, train: pd.train || 'local', vehicleMode: 'train',
        trail: [{x: st.x, y: st.y}], money: pd.money, stalls: pd.stalls || [], cards: pd.cards || [],
        cardUsedThisTurn: false, nextDicePenalty: pd.nextDicePenalty || 0, skipTurns: pd.skipTurns || 0,
        shield: !!pd.shield, propertyDiscount: !!pd.propertyDiscount, agriBonus: !!pd.agriBonus,
        nextGhostLoss: pd.nextGhostLoss || 0,
      };
    });
    // 物產擁有權：先全部清空，再依每位玩家存下來的 stalls 清單反推回站點上
    Data.stations.forEach(st => { if (st.stalls) st.stalls.forEach(s => { s.owner = null; }); });
    this.players.forEach((p, i) => {
      (p.stalls || []).forEach(owned => {
        const st = Data.stations.get(owned.station);
        const s = st && st.stalls && st.stalls.find(x => x.name === owned.name && x.price === owned.price && x.owner == null);
        if (s) s.owner = i;
      });
    });
    this.setDestination(data.destination);
    this.state = 'awaitRoll';
    const pl = this.curPlayer();
    Render.snapTo(pl.ax, pl.ay);
    BGM.playSeason(this.month);
    UI.update();
    this.maybeAutoRoll();
  },
};
