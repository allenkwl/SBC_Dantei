// ────────────────────────────────────────────────
//  rules.js — 回合狀態機：擲骰 → 移動 → 事件 → 換人
//  Phase 1：先做「會動的地圖」，經濟系統 Phase 2 再加
// ────────────────────────────────────────────────
// 角色 default 名稱直接用大頭貼檔名（角色大頭貼/ 目錄），玩家可在人數選擇畫面自行改名
const CHARS = [
  {key:'jukiu',  name:'探險家', color:'#F08C00', avatar:'assets/avatars/探險家.png'},
  {key:'heichu', name:'賓士',   color:'#3A3A3A', avatar:'assets/avatars/賓士.png'},
  {key:'baixue', name:'旅行家', color:'#B9BFC7', avatar:'assets/avatars/旅行家.png'},
  {key:'lanpo',  name:'站長',   color:'#2B7FD4', avatar:'assets/avatars/站長.png'},
];
const STEP_MS = 240;   // 每格移動時間

// 電腦對手：模仿桃鐵風格，等級只差在物產投資積極度與（未來）卡片系統開放程度；
// 移動一律照最短路徑走（跟人類岔路選擇邏輯共用 bestDirection），沒有更「聰明」的抄捷徑或繞路判斷
const AI_PROFILES = {
  1: {label:'電腦（基礎）', buyChance: 0.4, greedy: false, useCards: false},
  2: {label:'電腦（中等）', buyChance: 0.8, greedy: true,  useCards: false},
  3: {label:'電腦（高手）', buyChance: 1.0, greedy: true,  useCards: true},  // useCards 待卡片系統（Phase 3）完成後才會真的用到
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
const CARD_HAND_LIMIT = 8;
const CARD_CATALOG = [
  {id:'highspeed', name:'高鐵快攻', type:'移動', icon:'🚄', price:14, text:'本回合同時擲 5 顆骰子', effect:'fiveDice'},
  {id:'fixedDice', name:'指定骰', type:'移動', icon:'🎲', price:6, text:'本回合自選 1～6 點', effect:'fixedDice'},
  {id:'puyuma', name:'普悠瑪衝刺', type:'移動', icon:'⚡', price:10, text:'本回合擲 2 顆骰', effect:'doubleDice'},
  {id:'suhua', name:'蘇花捷徑', type:'移動', icon:'⛰️', price:12, text:'直接前往花蓮', effect:'teleportHualien'},
  {id:'taxi', name:'計程車貓', type:'移動', icon:'🚕', price:10, text:'直接前進 8 格（不觸發沿途事件）', effect:'taxi'},
  {id:'summon', name:'召喚臭屁鬼', type:'攻擊', icon:'🐧', price:14, text:'指定玩家下回合扣 5% 現金', effect:'summon'},
  {id:'typhoon', name:'颱風假', type:'攻擊', icon:'🌪️', price:12, text:'指定玩家下回合暫停一次', effect:'skip'},
  {id:'pickpocket', name:'扒手夜市', type:'攻擊', icon:'🧤', price:10, text:'指定玩家損失 10% 現金', effect:'steal'},
  {id:'traffic', name:'塞車卡', type:'攻擊', icon:'🚧', price:8, text:'指定玩家下次骰點 -2', effect:'traffic'},
  {id:'swap', name:'大風吹', type:'攻擊', icon:'💨', price:16, text:'與指定玩家交換位置', effect:'swap'},
  {id:'mazu', name:'媽祖保佑', type:'防禦', icon:'🙏', price:9, text:'抵銷下一次負面卡片', effect:'shield'},
  {id:'barrier', name:'結界符', type:'防禦', icon:'🪬', price:11, text:'抵銷下一次攻擊卡', effect:'shield'},
  {id:'nightMarket', name:'夜市大豐收', type:'財務', icon:'🍢', price:7, text:'立即獲得 2 萬元', effect:'cash'},
  {id:'agri', name:'農業補貼', type:'財務', icon:'🌾', price:9, text:'本年度農業物產收益 +20%', effect:'agriBonus'},
  {id:'discount', name:'物產搶購令', type:'財務', icon:'🛍️', price:10, text:'下次購買物產 8 折', effect:'discount'},
  {id:'lucky', name:'樂透貓', type:'財務', icon:'🎉', price:8, text:'隨機獲得 0～7 萬元', effect:'lucky'},
  {id:'debt', name:'債務免除', type:'大逆轉', icon:'👑', price:null, text:'現金低於 0 時回到 0', effect:'debt'},
];
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
    // 不是只用「列車正前方」挑一站：所有圈選站都是一個可巡覽清單。
    // ←→ 按地圖 x 座標巡覽、↑↓ 按 y 座標巡覽；到端點循環，因此不會有選不到的站。
    const horizontal = dirKey === 'ArrowLeft' || dirKey === 'ArrowRight';
    const forward = dirKey === 'ArrowRight' || dirKey === 'ArrowDown';
    const ids = [...this._reachableRoutes.keys()];
    const coord = id => {
      const st = Data.stations.get(id);
      return horizontal ? st.x : st.y;
    };
    ids.sort((a, b) => {
      const main = coord(a) - coord(b); if (main) return main;
      const sa = Data.stations.get(a), sb = Data.stations.get(b);
      return horizontal ? sa.y - sb.y : sa.x - sb.x;
    });
    let at = this.reachableSelected ? ids.indexOf(this.reachableSelected) : -1;
    if (at < 0) {
      // 首按以列車所在座標為基準；若該方向沒有站，從該方向最邊緣的站循環選取。
      const from = Data.stations.get(this.curPlayer().pos);
      const base = horizontal ? from.x : from.y;
      at = forward ? ids.findIndex(id => coord(id) > base) : (() => {
        for (let i = ids.length - 1; i >= 0; i--) if (coord(ids[i]) < base) return i;
        return -1;
      })();
      if (at < 0) at = forward ? 0 : ids.length - 1;
    } else {
      at = (at + (forward ? 1 : -1) + ids.length) % ids.length;
    }
    return this.selectReachableStation(ids[at]);
  },
  selectReachableStation(id) {
    if (!this.reachableMode || !this._reachableRoutes || !this._reachableRoutes.has(id)) return false;
    this.reachableSelected = id;
    UI.setReachableSelection(id);
    const st = Data.stations.get(id);
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
    this.cur = 0; this.year = 1; this.month = 4;
    this.assetHistory = [];
    this.state = 'rolling-start';
    // 物產／攤位擁有權重置（資料來自地圖編輯器，掛在站點物件上，重新開局要清空 owner）
    Data.stations.forEach(st => { if (st.stalls) st.stalls.forEach(s => { s.owner = null; }); });
    UI.update();
    BGM.playSeason(this.month);
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.classList.add('show');

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

  // 電腦玩家輪到自己時自動擲骰（模擬「思考」的短暫停頓），真人玩家不受影響
  maybeAutoRoll() {
    const pl = this.curPlayer();
    if (!pl || !pl.isAI) return;
    setTimeout(() => {
      if (this.state !== 'awaitRoll' || this.curPlayer() !== pl) return;
      const profile = AI_PROFILES[pl.aiLevel] || AI_PROFILES[1];
      if (profile.useCards && !pl.cardUsedThisTurn) {
        const cardIdx = pl.cards.findIndex(id => ['highspeed','puyuma','nightMarket','lucky'].includes(id));
        if (cardIdx !== -1) { this.useCard(cardIdx); setTimeout(() => this.roll(), 550); return; }
      }
      this.roll();
    }, 700);
  },

  beginTurn() {
    const pl = this.curPlayer();
    if (!pl) return;
    pl.cardUsedThisTurn = false;
    if (pl.nextGhostLoss) {
      const loss = Math.max(1, Math.round(pl.money * pl.nextGhostLoss / 100));
      pl.money = Math.max(0, pl.money - loss);
      pl.nextGhostLoss = 0;
      UI.showCardFlash('🐧', `臭屁鬼搗蛋！${pl.name} 損失 ${loss} 萬元。`);
    }
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
  },

  curPlayer() { return this.players[this.cur]; },

  drawCard(pl, source = '黃格', allowedTypes = null) {
    if (pl.cards.length >= CARD_HAND_LIMIT) {
      UI.toast(`🃏 ${pl.name} 的卡片已滿（${CARD_HAND_LIMIT} 張），無法再取得卡片。`);
      return null;
    }
    let pool = CARD_CATALOG.filter(c => c.type !== '大逆轉' && (!allowedTypes || allowedTypes.includes(c.type)));
    // 黃格遵循企劃書草案比例：移動 35 / 財務 30 / 防禦 20 / 攻擊 12 / 大逆轉 3。
    if (!allowedTypes && source === '黃格') {
      const roll = Math.random() * 100;
      const type = roll < 35 ? '移動' : roll < 65 ? '財務' : roll < 85 ? '防禦' : roll < 97 ? '攻擊' : '大逆轉';
      pool = CARD_CATALOG.filter(c => c.type === type);
    }
    const card = pool[Math.floor(Math.random() * pool.length)];
    pl.cards.push(card.id);
    UI.showCardFlash(card.icon, `${pl.name} 從${source}獲得「${card.name}」！`);
    return card;
  },

  useCard(index, option = null) {
    const pl = this.curPlayer();
    if (this.state !== 'awaitRoll' || !pl || pl.cardUsedThisTurn) return;
    const card = CARD_BY_ID[pl.cards[index]];
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
    pl.cards.splice(index, 1);
    pl.cardUsedThisTurn = true;
    UI.hideCardHand(); UI.hideCardTargets();
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
      case 'doubleDice': pl.doubleDice = true; break;
      case 'taxi': pl.moveBonus = 8; break;
      case 'teleportHualien': this.teleportPlayer(pl, 'tr_hualien'); return;
      case 'summon': target.nextGhostLoss = 5; break;
      case 'skip': target.skipTurns = 1; break;
      case 'steal': { const loss = Math.max(1, Math.round(target.money * 0.1)); target.money = Math.max(0, target.money - loss); pl.money += loss; break; }
      case 'traffic': target.nextDicePenalty = 2; break;
      case 'swap': this.swapPlayers(pl, target); break;
      case 'shield': pl.shield = true; break;
      case 'cash': pl.money += 2; break;
      case 'agriBonus': pl.agriBonus = true; break;
      case 'discount': pl.propertyDiscount = true; break;
      case 'lucky': pl.money += Math.floor(Math.random() * 8); break;
      case 'debt': pl.money = Math.max(0, pl.money); break;
    }
    UI.showCardFlash(card.icon, `${pl.name} 使用「${card.name}」！${card.text}`);
    UI.update();
    // 移動骰卡使用後直接取代一般擲骰：指定骰、2 顆骰與高鐵 5 顆骰都不再要求玩家按第二次按鈕。
    if (['fixedDice', 'doubleDice', 'fiveDice'].includes(card.effect)) {
      this.state = 'cardRoll';
      UI.update();
      setTimeout(() => this.roll(true), 650);
    }
  },

  teleportPlayer(pl, stationId) {
    const st = Data.stations.get(stationId);
    if (!st) return;
    pl.pos = stationId; pl.ax = st.x; pl.ay = st.y; pl.trail = [{x:st.x, y:st.y}];
    Render.follow(st.x, st.y);
    UI.showCardFlash('⛰️', `${pl.name} 使用蘇花捷徑，直達花蓮！`);
    UI.update();
    setTimeout(() => this.land(), 700);
  },

  swapPlayers(a, b) {
    const aPos = a.pos, aX = a.ax, aY = a.ay, aTrail = a.trail;
    a.pos = b.pos; a.ax = b.ax; a.ay = b.ay; a.trail = b.trail;
    b.pos = aPos; b.ax = aX; b.ay = aY; b.trail = aTrail;
    Render.follow(a.ax, a.ay);
  },

  roll(fromCard = false) {
    if (this.state !== 'awaitRoll' && !(fromCard && this.state === 'cardRoll')) return;
    Render.scoutStation = null;   // 擲骰時收起探路放大鏡游標
    Render.resetToTrain();
    const pl = this.curPlayer();
    const forced = pl.forcedDice;
    const diceCount = forced ? 1 : (pl.fiveDice ? 5 : (pl.doubleDice ? 2 : 1));
    const diceValues = forced ? [forced] : Array.from({length: diceCount}, () => 1 + Math.floor(Math.random() * 6));
    const base = diceValues.reduce((sum, n) => sum + n, 0);
    this.dice = Math.max(1, base + (pl.moveBonus || 0) - (pl.nextDicePenalty || 0));
    pl.forcedDice = null; pl.doubleDice = false; pl.fiveDice = false; pl.moveBonus = 0; pl.nextDicePenalty = 0;
    this.stepsLeft = this.dice;
    this.path = [this.curPlayer().pos];
    this.state = 'moving';
    UI.showDice(diceValues, this.dice, () => this.advance());
    UI.update();
  },

  // 依目前 stepsLeft 決定：走到 0 就停留，否則列車停在下一站等玩家選方向
  // 每次只走一站；候選方向包含「剛剛來的那一站」，跟其他方向平等顯示，
  // 沒有專屬退回按鈕——選了才判斷是不是走回頭路，是的話步數加回來（跟桃鐵一樣）
  advance() {
    if (this.stepsLeft <= 0) { this.land(); return; }
    const pl = this.curPlayer();
    const cands = Board.neighbors(pl.pos);
    const greenId = this.bestDirection(pl.pos, cands);
    this.state = 'awaitBranch';
    if (pl.isAI) {
      // 電腦不會主動走回頭路（退回上一站會把步數加回來，遇到平手／沒有綠燈時隨機挑很容易來回反彈、
      // 卡在原地一直不停下來）；除非那是唯一能走的方向（死路），否則一律只從「往前」的候選中選
      const prev = this.path.length > 1 ? this.path[this.path.length - 2] : null;
      const forward = cands.filter(c => c !== prev);
      const pool = forward.length ? forward : cands;
      const choice = (greenId !== null && pool.includes(greenId)) ? greenId : pool[Math.floor(Math.random() * pool.length)];
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

  stepTo(toId) {
    const pl = this.curPlayer();
    const pts = Data.edgePath(pl.pos, toId);
    pl.vehicleMode = this.vehicleModeFor(Data.routeNameOf(pl.pos, toId));
    Render.movePiece(pl, pts, STEP_MS, () => {
      pl.pos = toId;
      pl.trail.push(...pts.slice(1));
      if (pl.trail.length > 40) pl.trail.splice(0, pl.trail.length - 40);
      this.path.push(toId);
      this.stepsLeft--;
      UI.update();
      this.advance();
    });
  },

  land() {
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
        msg = `🔵 ${pl.name} 停在藍格！${season}獲得 ${gain} 萬元`;
      } else {
        const [lo, hi] = table.red;
        const pct = lo + Math.random() * (hi - lo);
        const loss = Math.max(1, Math.round(assets * pct / 100));
        pl.money = Math.max(0, pl.money - loss);
        msg = `🔴 ${pl.name} 停在紅格！${season}損失 ${loss} 萬元`;
      }
      UI.toast(msg);
      UI.update();
      if (this.checkQuickWin()) return;
      setTimeout(() => this.nextPlayer(), 1400);
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
    UI.toast(`🛍️ ${pl.name} 買下「${st.name}・${s.name}」（${cost} 萬元）！`);
    UI.update();
    if (this.checkQuickWin()) return;
    setTimeout(() => this.nextPlayer(), 1200);
  },

  // 真人版一次購買多項：勾選面板送出的品項清單一次結算，跳過中途已經買不起或被買走的
  confirmStallPurchases(stationId, indices) {
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
    if (this.checkQuickWin()) return;
    setTimeout(() => this.nextPlayer(), bought.length ? 1200 : 400);
  },

  skipStallShop() {
    UI.hideStallShop();
    UI.update();
    setTimeout(() => this.nextPlayer(), 400);
  },

  cardShopItems(st) {
    if (st && Array.isArray(st.cardShop) && st.cardShop.length) return st.cardShop;
    return CARD_CATALOG.filter(c => c.price != null).map(c => ({id:c.id, price:c.price}));
  },

  revealYellowCard() {
    const pl = this.curPlayer();
    if (!pl || this.state !== 'awaitCardDraw') return;
    const card = this.drawCard(pl, '黃格');
    UI.revealCardDraw(card, pl);
    UI.update();
    setTimeout(() => { UI.hideCardDraw(); this.nextPlayer(); }, 1600);
  },

  buyCard(cardId) {
    const pl = this.curPlayer(), card = CARD_BY_ID[cardId];
    const st = this._cardShopStation ? Data.stations.get(this._cardShopStation) : null;
    const listing = this.cardShopItems(st).find(item => item.id === cardId);
    const price = listing && listing.price;
    if (!pl || !card || price == null || pl.cards.length >= CARD_HAND_LIMIT || pl.money < price) return;
    pl.money -= price; pl.cards.push(card.id);
    UI.showCardFlash(card.icon, `${pl.name} 買下「${card.name}」！`);
    UI.update(); if (st) UI.showCardShop(pl, st);
  },

  sellCard(index) {
    const pl = this.curPlayer();
    if (!pl || !pl.cards || !pl.cards[index]) return;
    const card = CARD_BY_ID[pl.cards[index]]; if (!card) return;
    const st = this._cardShopStation ? Data.stations.get(this._cardShopStation) : null;
    const listing = this.cardShopItems(st).find(item => item.id === card.id);
    const sellPrice = Math.floor((listing ? listing.price : card.price || 0) * .8);
    pl.cards.splice(index, 1); pl.money += sellPrice;
    UI.showCardFlash('💰', `${pl.name} 賣出「${card.name}」，獲得 ${sellPrice} 萬元！`);
    UI.update(); if (st) UI.showCardShop(pl, st);
  },

  leaveCardShop() { this._cardShopStation = null; UI.hideCardShop(); this.nextPlayer(); },
  skipCardShop() { this.leaveCardShop(); },

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
    UI.clearDice();
    this.reachableMode = false; this._reachableRoutes = null; Render.clearReachableStations();
    this.cur = (this.cur + 1) % this.players.length;
    const pl = this.curPlayer();
    const st = Data.stations.get(pl.pos);
    Render.follow(st.x, st.y);
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
        lines.push(`${p.name} +${total}萬${dominatedCities.size ? '（全縣制霸！）' : ''}`);
      }
    });
    const subsidy = this.applyCatchUpSubsidy();
    if (subsidy) lines.push(`${subsidy.name} 落後補助 +${subsidy.amount}萬`);
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
    const ranking = this.players.map(p => {
      const stallsValue = (p.stalls || []).reduce((sum, s) => sum + s.price, 0);
      return {name: p.name, avatar: p.avatar, money: p.money, stallsValue, total: this.totalAssetsOf(p)};
    }).sort((a, b) => b.total - a.total);
    UI.showGameOver(ranking);
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
      totalYears: this.totalYears,
      quickWinTarget: this.quickWinTarget || null,
      year: this.year, month: this.month, cur: this.cur,
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

  autoSave() {
    if (!this.saveSlot) return;
    SaveSystem.write(this.saveSlot, this.serialize());
  },

  loadState(data, slot) {
    this.saveSlot = slot;
    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.classList.add('show');
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
