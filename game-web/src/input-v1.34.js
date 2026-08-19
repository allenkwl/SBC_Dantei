// 統一輸入層：鍵盤、滑鼠與標準 Gamepad API 都轉成同一組遊戲按鍵。
// A=確認、B=返回、X=卡片、Y=可到達站點、L=縮放、R=設定、ZL=遊戲說明、ZR=靜音、
// ＋／－=增加／減少數值。
//
// ＋／－以前跟 R／設定、－／靜音是同一顆鍵身兼兩用，2026-08 改成完全獨立：設定只認 R、
// 靜音搬去原本沒綁定的 ZR，空出來的 ＋／－ 專門給有數值可調的畫面（例如讀檔認領角色畫面
// 的年數控制項）用，不會跟開設定/靜音互相干擾。手把上有 Home 鍵旁邊的截圖鍵測過抓不到
// （被系統攔截，Gamepad API 完全看不到事件），所以沒有拿來用。
//
// v1.29 起支援多支手把：以前 poll() 用 find(Boolean) 只抓「第一支」偵測到的手把，第二支以後
// 完全被忽略；現在每支手把各自輪詢、各自保有一份連發計時（不共用的話，兩個人同時按方向鍵
// 會互相把對方的計時重設，變成一個人按住、另一個人完全按不動）。
//
// 每一次輸入都會標記「來自哪個介面」，字串格式：
//   'kb'          鍵盤
//   'mouse'       滑鼠／觸控板（Web API 無法區分這兩者，PointerEvent.pointerType 都回傳 mouse）
//   'pad:<index>' 手把，index 是 Gamepad.index
// 這個字串就是玩家與介面的對應鍵：P3 選角畫面用它認人，遊戲中的回合鎖（下面的 Seats）用它
// 判斷「現在這顆鍵可不可以動」。
//
// 手把的按鍵編號沒有統一標準：只有 pad.mapping === 'standard' 的手把（Xbox／PS 這類）
// 才保證照 W3C 標準排列。很多手把回報的是 mapping='' 的原始 HID 排列，臉部按鍵會跳過
// 2 跟 5、肩鍵與 −／＋ 全部往後移，十字鍵也不是 buttons[12~15] 而是一個 hat switch 軸。
// 用實機（Vendor 1949 Product 0402，16 鍵 10 軸）測出來的排列就是後者，所以分兩套對應表。
const PAD_STANDARD = {
  confirm:[0], back:[1], cards:[2], reach:[3],
  zoom:[4], settings:[5], help:[6], mute:[7],
  plus:[9], minus:[8],
  up:[12], down:[13], left:[14], right:[15],
};
// 非標準（DInput）排列：A=0 B=1 X=3 Y=4 L=6 R=7 ZL=8 ZR=9 −=10 ＋=11（2 跟 5 沒有用到），
// 十字鍵不在這裡，走下面的 hat 軸。
const PAD_DINPUT = {
  confirm:[0], back:[1], cards:[3], reach:[4],
  zoom:[6], settings:[7], help:[8], mute:[9],
  plus:[11], minus:[10],
  up:[], down:[], left:[], right:[],
};

const SRC_KB = 'kb';
const SRC_MOUSE = 'mouse';
const padSrc = index => `pad:${index}`;

const Input = {
  last: new Map(), dead: .45, repeat: 200, first: 330,
  hatAxes: new Map(),   // padIndex -> Set(已確認是 hat switch 的軸編號，見 readHat)
  _source: null,        // dispatch 期間暫存的來源；真人鍵盤事件時是 null

  // hat switch 的 8 個方向：從 -1（上）開始順時針，每格 2/7≈0.2857
  HAT_DIRS: [['up'], ['up','right'], ['right'], ['down','right'],
             ['down'], ['down','left'], ['left'], ['up','left']],

  init() {
    addEventListener('gamepadconnected', e => {
      if (UI && UI.toast) UI.toast(`已連接手把 ${e.gamepad.index + 1}：方向鍵選擇，A 確定，B 返回。`);
    });
    addEventListener('gamepaddisconnected', e => {
      // 拔掉的手把要把連發計時與 hat 軸紀錄一起清掉，不然同一個 index 之後被別支手把
      // 重用時會沿用到上一支的狀態（hat 軸編號尤其會整個對不上）。
      this.hatAxes.delete(e.gamepad.index);
      const prefix = `${e.gamepad.index}:`;
      Array.from(this.last.keys()).forEach(k => { if (k.startsWith(prefix)) this.last.delete(k); });
      if (UI && UI.toast) UI.toast(`手把 ${e.gamepad.index + 1} 已中斷連線。`);
    });
    requestAnimationFrame(() => this.poll());
  },

  // 目前正在處理的這顆鍵是哪個介面送出的。真人鍵盤事件不是我們合成的，_source 會是 null，
  // 一律算成鍵盤介面。ui.js 的回合鎖與 main.js 的改名鎖都靠這個判斷。
  sourceOf() { return this._source || SRC_KB; },

  // ── 按鍵判斷：key 與 code 都要看，缺一不可 ──
  // 玩家開著中文輸入法（注音是台灣的預設）按 A 鍵時，瀏覽器送出的是 e.key='Process'——
  // 因為那一顆鍵被輸入法接走去組字了，e.key 不再是 'a'。只比對 e.key 的話，遊戲裡所有
  // 字母快捷鍵在中文模式下會全部失效，而且方向鍵不受影響，所以症狀是「方向鍵能動、
  // A/B/X 都沒反應」，很容易誤判成程式壞掉。
  //
  // e.code 是「實體鍵位」，跟輸入法與鍵盤配置都無關，中文模式下照樣是 'KeyA'，所以一定要
  // 一起比對。ui.js 以前只有 X／Y 兩顆做了這件事，其餘按鍵都漏了。
  isKey(e, ch) {
    if (ch === ' ') return (e.code || '') === 'Space' || e.key === ' ';
    return (e.code || '') === 'Key' + ch.toUpperCase() || e.key === ch || e.key === ch.toUpperCase();
  },
  isConfirm(e) { return this.isKey(e, ' ') || this.isKey(e, 'a'); },   // 確認＝空白鍵或 A
  isBack(e) { return this.isKey(e, 'b'); },
  // 增加／減少：鍵盤主鍵區或數字鍵區的 ＋／－ 都算，手把走 poll() 送出同一組 key/code。
  isPlus(e) { return e.key === '+' || e.code === 'NumpadAdd'; },
  isMinus(e) { return e.key === '-' || e.code === 'NumpadSubtract'; },

  label(src) {
    if (src === SRC_KB) return '鍵盤';
    if (src === SRC_MOUSE) return '滑鼠';
    if (typeof src === 'string' && src.startsWith('pad:')) return `手把 ${Number(src.slice(4)) + 1}`;
    return '介面';
  },

  // 這個介面現在還在不在？手把可能沒電或被拔掉，鍵盤／滑鼠一律視為永遠存在。
  alive(src) {
    if (src === SRC_KB || src === SRC_MOUSE) return true;
    if (typeof src !== 'string' || !src.startsWith('pad:')) return false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return !!pads[Number(src.slice(4))];
  },

  // 加入時震動一下：四支同型號手把時，這比畫面上顯示「手把 2」有用得多，
  // 玩家立刻知道剛才被登記的是自己手上這支。沒有震動馬達的手把會安靜失敗，不影響流程。
  vibrate(src) {
    if (typeof src !== 'string' || !src.startsWith('pad:')) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const act = pads[Number(src.slice(4))] && pads[Number(src.slice(4))].vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', {duration:180, strongMagnitude:.55, weakMagnitude:.3}).catch(() => {});
    }
  },

  // 直接送到 document：遊戲自己的輸入層（ui.js 的統一 keydown 監聽器）掛在 document 上，
  // 「目前選到哪個項目」一律查 document.activeElement，跟事件從哪個節點發出無關。
  //
  // 來源用模組層變數傳遞，不塞進 KeyboardEvent：dispatchEvent 是「同步」的，所有監聽器都在
  // 它回來之前跑完，所以設值→dispatch→清值這段期間，任何監聽器呼叫 Input.sourceOf() 拿到的
  // 一定是這顆鍵真正的來源。這比自訂事件屬性單純，也不用改動任何既有的 KeyboardEvent 用法。
  emit(src, key, code = key) {
    this._source = src;
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {key, code, bubbles:true, cancelable:true}));
      document.dispatchEvent(new KeyboardEvent('keyup', {key, code, bubbles:true, cancelable:true}));
    } finally {
      this._source = null;   // 監聽器丟例外也要還原，否則之後每顆真鍵盤都會被誤認成這支手把
    }
  },

  // 按著就一直重複：第一次立刻觸發，按著超過 first 之後每隔 repeat 再觸發一次，
  // 放開就清掉紀錄。id 一定要帶手把編號當前綴，每支手把各自一份計時。
  pulse(id, active, src, key, code) {
    const now = performance.now(), prior = this.last.get(id) || 0;
    if (!active) { this.last.delete(id); return; }
    const held = prior < 0 ? -prior : 0;
    if (!prior || (held ? now - held >= this.repeat : now - prior >= this.first)) {
      this.emit(src, key, code); this.last.set(id, -(held || now));
    }
  },

  // 十字鍵讀 hat switch 軸：一個 -1~1 的值編出 8 個方向，放開時是「超出 -1~1 範圍」的值
  // （實機量到 3.286）。就是靠這個超出範圍的值認出哪個軸是 hat——類比搖桿與扳機永遠在
  // -1~1 之間，不會被誤判成十字鍵（這點很重要：實機上有兩個軸會停在 -1.000）。
  // 每支手把的軸配置不一樣，所以認出來的軸編號要分手把記，不能共用一份。
  readHat(pad) {
    const dirs = {up:false, down:false, left:false, right:false};
    let known = this.hatAxes.get(pad.index);
    if (!known) { known = new Set(); this.hatAxes.set(pad.index, known); }
    pad.axes.forEach((v, i) => {
      if (typeof v !== 'number') return;
      if (Math.abs(v) > 1.05) { known.add(i); return; }   // 放開狀態＝認出這是 hat 軸
      if (!known.has(i)) return;
      const slot = (v + 1) * 3.5;
      const idx = Math.round(slot);
      if (idx < 0 || idx > 7 || Math.abs(slot - idx) > 0.25) return;   // 對不上任何一格就忽略
      this.HAT_DIRS[idx].forEach(d => { dirs[d] = true; });
    });
    return dirs;
  },

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const src = padSrc(pad.index), tag = `${pad.index}:`;
      const map = pad.mapping === 'standard' ? PAD_STANDARD : PAD_DINPUT;
      const b = list => list.some(n => pad.buttons[n] && pad.buttons[n].pressed);
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const hat = this.readHat(pad);
      this.pulse(tag + 'left',  b(map.left)  || hat.left  || ax < -this.dead, src, 'ArrowLeft');
      this.pulse(tag + 'right', b(map.right) || hat.right || ax >  this.dead, src, 'ArrowRight');
      this.pulse(tag + 'up',    b(map.up)    || hat.up    || ay < -this.dead, src, 'ArrowUp');
      this.pulse(tag + 'down',  b(map.down)  || hat.down  || ay >  this.dead, src, 'ArrowDown');
      this.pulse(tag + 'a',      b(map.confirm),  src, ' ', 'Space');
      this.pulse(tag + 'b',      b(map.back),     src, 'b', 'KeyB');
      this.pulse(tag + 'x',      b(map.cards),    src, 'x', 'KeyX');
      this.pulse(tag + 'y',      b(map.reach),    src, 'y', 'KeyY');
      this.pulse(tag + 'lb',    b(map.zoom),     src, 'z', 'KeyZ');
      this.pulse(tag + 'rb',    b(map.settings), src, 'p', 'KeyP');
      this.pulse(tag + 'zl',    b(map.help),     src, 'h', 'KeyH');
      this.pulse(tag + 'zr',    b(map.mute),     src, 'm', 'KeyM');
      this.pulse(tag + 'plus',  b(map.plus),     src, '+', 'NumpadAdd');
      this.pulse(tag + 'minus', b(map.minus),    src, '-', 'NumpadSubtract');
    }
    requestAnimationFrame(() => this.poll());
  }
};

// ────────────────────────────────────────────────
//  Seats — 介面與玩家的對應，以及遊戲中的回合鎖
// ────────────────────────────────────────────────
// P3 選角畫面決定「玩家 i 由哪個介面操作」，開局後 activate() 把這份對應交給這裡；
// 之後 ui.js 的統一輸入層每收到一顆鍵，就先問 allows() 這顆鍵能不能生效。
const Seats = {
  bySource: new Map(),   // 介面 id -> 玩家 index
  byPlayer: new Map(),   // 玩家 index -> 介面 id
  active: false,
  _warned: null,

  reset() { this.bySource.clear(); this.byPlayer.clear(); this.active = false; this._warned = null; },

  // sources[i] = 玩家 i 的介面 id，電腦玩家傳 null
  activate(sources) {
    this.reset();
    sources.forEach((src, i) => {
      if (!src) return;
      this.bySource.set(src, i);
      this.byPlayer.set(i, src);
    });
    this.active = this.bySource.size > 0;
  },

  // 這個介面有沒有參賽。鍵盤／滑鼠沒被任何玩家認領時回傳 false，但 allows() 會另外放行——
  // 見下面的說明。
  registered(src) { return this.bySource.has(src); },

  // 這顆鍵現在可不可以生效。
  //
  // 沒被任何玩家認領的「鍵盤／滑鼠」故意保持可用：這是主持人的指標裝置，大人常常需要幫忙
  // 點一下、改個設定，整場鎖掉只會讓人以為遊戲當掉。沒被認領的「手把」則一律無效——那正是
  // 這整套要擋的東西（旁邊多出來的一支手把亂按會打斷別人的回合）。
  allows(src) {
    if (!this.active) return true;
    // 連線對戰：規則只有一條——這台有沒有 token。下面那三個「防卡死」的例外
    // （未認領的鍵鼠一律放行、電腦回合全放行、當前玩家介面沒回應就開放）都是為了
    // 「同一台機器多人共用」設計的，在連線情境下全部會變成破口：別台的鍵鼠正好屬於
    // 「未認領」、遠端玩家的介面在我這台當然驗不到活著、電腦回合更是全場一起解鎖，
    // 結果就是每台都按得動、每台都在改自己的遊戲狀態。
    if (typeof Game !== 'undefined' && Game.netGroup) {
      return typeof Game.hasToken === 'function' ? Game.hasToken() : false;
    }
    // 未被認領的鍵盤／滑鼠＝主持人的裝置，保持可用；未被認領的手把一律無效。
    if (!this.bySource.has(src)) return src === SRC_KB || src === SRC_MOUSE;
    const pl = (typeof Game !== 'undefined' && Game.curPlayer) ? Game.curPlayer() : null;
    // 電腦回合與跨回合的演出（年度決算、到站慶祝）需要有人按鍵推進。這時候如果還鎖著
    // 「只有當前玩家能按」，而當前玩家正好是電腦，就沒有任何人能推進，整場卡死。
    if (!pl || pl.isAI) return true;
    const owner = this.byPlayer.get(Game.cur);
    // 當前玩家的手把掉線（沒電／被拔掉）也會卡死，這時候開放給所有參賽介面接手。
    if (owner && !Input.alive(owner)) {
      if (this._warned !== Game.cur && UI && UI.toast) {
        this._warned = Game.cur;
        UI.toast(`${pl.name} 的${Input.label(owner)}已斷線，暫時開放其他介面代為操作。`);
      }
      return true;
    }
    return this.bySource.get(src) === Game.cur;
  },

  // 非當前玩家按鍵時給的提示：完全沒反應會讓人以為遊戲當掉。1.5 秒內只提示一次。
  _hintAt: 0,
  denyHint() {
    const now = performance.now();
    if (this._hintAt && now - this._hintAt < 1500) return;
    this._hintAt = now;
    const pl = (typeof Game !== 'undefined' && Game.curPlayer) ? Game.curPlayer() : null;
    if (pl && UI && UI.toast) UI.toast(`現在輪到 ${pl.name}`);
  },
};
