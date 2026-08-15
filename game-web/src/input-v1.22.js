// 統一輸入層：鍵盤與標準 Gamepad API 都轉成同一組遊戲按鍵。
// A=確認、B=返回、X=卡片、Y=可到達站點、L=縮放、R／＋=設定、−=靜音。
//
// 手把的按鍵編號沒有統一標準：只有 pad.mapping === 'standard' 的手把（Xbox／PS 這類）
// 才保證照 W3C 標準排列。很多手把回報的是 mapping='' 的原始 HID 排列，臉部按鍵會跳過
// 2 跟 5、肩鍵與 −／＋ 全部往後移，十字鍵也不是 buttons[12~15] 而是一個 hat switch 軸。
// 用實機（Vendor 1949 Product 0402，16 鍵 10 軸）測出來的排列就是後者，所以分兩套對應表。
const PAD_STANDARD = {
  confirm:[0], back:[1], cards:[2], reach:[3],
  zoom:[4], settings:[5, 9], mute:[8],
  up:[12], down:[13], left:[14], right:[15],
};
// 非標準（DInput）排列：A=0 B=1 X=3 Y=4 L=6 R=7 ZL=8 ZR=9 −=10 ＋=11（2 跟 5 沒有用到），
// 十字鍵不在這裡，走下面的 hat 軸。ZL／ZR 照原本的設計沒有指定功能，維持不綁。
const PAD_DINPUT = {
  confirm:[0], back:[1], cards:[3], reach:[4],
  zoom:[6], settings:[7, 11], mute:[10],
  up:[], down:[], left:[], right:[],
};

const Input = {
  last: new Map(), dead: .45, repeat: 155, first: 330,
  held: new Set(),   // 單發按鍵（確定/返回/卡片…）目前是否還按著，見 edge()
  hatAxes: new Set(),   // 確認是 hat switch 的軸編號（見 readHat）

  // hat switch 的 8 個方向：從 -1（上）開始順時針，每格 2/7≈0.2857
  HAT_DIRS: [['up'], ['up','right'], ['right'], ['down','right'],
             ['down'], ['down','left'], ['left'], ['up','left']],

  init() {
    addEventListener('gamepadconnected', () => UI && UI.toast('已連接手把：方向鍵選擇，A 確定，B 返回，Y 顯示可到達站點。'));
    addEventListener('gamepaddisconnected', () => UI && UI.toast('手把已中斷連線，請改用鍵盤操作。'));
    requestAnimationFrame(() => this.poll());
  },
  // 直接送到 document：遊戲自己的輸入層（ui.js 的統一 keydown 監聽器）掛在 document 上，
  // 「目前選到哪個項目」一律查 document.activeElement，跟事件從哪個節點發出無關，
  // 不用像以前一樣特地算出目前 focus 的元素當 target。
  emit(key, code = key) {
    document.dispatchEvent(new KeyboardEvent('keydown', {key, code, bubbles:true, cancelable:true}));
    document.dispatchEvent(new KeyboardEvent('keyup', {key, code, bubbles:true, cancelable:true}));
  },
  // 十字鍵這類「按著就一直重複」的按鍵用這個：第一次立刻觸發，按著超過 first 之後
  // 每隔 repeat 再觸發一次，放開就清掉紀錄——用在畫面上移動游標/選取項目這種情境。
  pulse(id, active, key, code) {
    const now = performance.now(), prior = this.last.get(id) || 0;
    if (!active) { this.last.delete(id); return; }
    const held = prior < 0 ? -prior : 0;
    if (!prior || (held ? now - held >= this.repeat : now - prior >= this.first)) {
      this.emit(key, code); this.last.set(id, -(held || now));
    }
  },
  // 確定／返回／卡片／靜音這類「按一下＝一次動作」的按鍵一定要用這個，不能用 pulse()：
  // 這些按鍵每次觸發都會切換畫面或狀態（例如靜音開／關、選單前進一層），只要按著超過
  // repeat（155ms）的時間——很多人單純按一下也常常按超過這個時間——pulse() 就會在放開前
  // 多送一次，變成「按一下卻觸發兩次」（俗稱手把彈跳）。edge() 只在「剛從沒按變成按下」
  // 那一瞬間送一次，不管按著多久都不會重複，放開後才能再次觸發。
  edge(id, active, key, code) {
    const wasHeld = this.held.has(id);
    if (active && !wasHeld) { this.held.add(id); this.emit(key, code); }
    else if (!active && wasHeld) { this.held.delete(id); }
  },

  // 十字鍵讀 hat switch 軸：一個 -1~1 的值編出 8 個方向，放開時是「超出 -1~1 範圍」的值
  // （實機量到 3.286）。就是靠這個超出範圍的值認出哪個軸是 hat——類比搖桿與扳機永遠在
  // -1~1 之間，不會被誤判成十字鍵（這點很重要：實機上有兩個軸會停在 -1.000）。
  readHat(pad) {
    const dirs = {up:false, down:false, left:false, right:false};
    pad.axes.forEach((v, i) => {
      if (typeof v !== 'number') return;
      if (Math.abs(v) > 1.05) { this.hatAxes.add(i); return; }   // 放開狀態＝認出這是 hat 軸
      if (!this.hatAxes.has(i)) return;
      const slot = (v + 1) * 3.5;
      const idx = Math.round(slot);
      if (idx < 0 || idx > 7 || Math.abs(slot - idx) > 0.25) return;   // 對不上任何一格就忽略
      this.HAT_DIRS[idx].forEach(d => { dirs[d] = true; });
    });
    return dirs;
  },

  poll() {
    const pad = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean);
    if (pad) {
      const map = pad.mapping === 'standard' ? PAD_STANDARD : PAD_DINPUT;
      const b = list => list.some(i => pad.buttons[i] && pad.buttons[i].pressed);
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const hat = this.readHat(pad);
      this.pulse('left',  b(map.left)  || hat.left  || ax < -this.dead, 'ArrowLeft');
      this.pulse('right', b(map.right) || hat.right || ax >  this.dead, 'ArrowRight');
      this.pulse('up',    b(map.up)    || hat.up    || ay < -this.dead, 'ArrowUp');
      this.pulse('down',  b(map.down)  || hat.down  || ay >  this.dead, 'ArrowDown');
      this.edge('a', b(map.confirm), ' ', 'Space');
      this.edge('b', b(map.back), 'b', 'KeyB');
      this.edge('x', b(map.cards), 'x', 'KeyX');
      this.edge('y', b(map.reach), 'y', 'KeyY');
      this.edge('lb', b(map.zoom), 'z', 'KeyZ');
      this.edge('rb', b(map.settings), 'p', 'KeyP');
      this.edge('select', b(map.mute), 'm', 'KeyM');
    }
    requestAnimationFrame(() => this.poll());
  }
};
