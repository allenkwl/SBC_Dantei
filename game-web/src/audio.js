// ────────────────────────────────────────────────
//  audio.js — 背景音樂：開場／選人數／遊戲中依季節切換
//  瀏覽器的自動播放限制：頁面載入時嘗試播放可能會被瀏覽器擋下（合法行為），
//  所以額外掛了「使用者第一次點擊或按鍵」的解鎖邏輯，確保之後都能正常播放
// ────────────────────────────────────────────────
const BGM = {
  KEYS: ['splash', 'setup', 'lobby', 'character_select', 'spring', 'summer', 'autumn', 'winter', 'debt', 'sea', 'plane'],
  SEASON_KEY: {'春天': 'spring', '夏天': 'summer', '秋天': 'autumn', '冬天': 'winter'},

  els: {},
  current: null,
  volume: 0.5,
  muted: false,
  _unlocked: false,

  init() {
    this.KEYS.forEach(key => {
      const el = new Audio(`assets/audio/${key}.mp3`);
      el.loop = true;
      el.volume = this.volume;
      el.preload = 'auto';
      this.els[key] = el;
    });
    // 第一次使用者手勢時，把當下該播的那首補播出來（處理 autoplay 被瀏覽器擋下的情況）
    const unlock = () => {
      this._unlocked = true;
      if (this.current && !this.muted) this.els[this.current].play().catch(() => {});
      removeEventListener('click', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('click', unlock);
    addEventListener('keydown', unlock);
  },

  play(key) {
    if (!this.els[key] || this.current === key) return;
    if (this.current && this.els[this.current]) {
      this.els[this.current].pause();
      this.els[this.current].currentTime = 0;
    }
    this.current = key;
    if (this.muted) return;
    this.els[key].volume = this.volume;
    this.els[key].play().catch(() => {});   // 被 autoplay 政策擋下時，靜默失敗，等待使用者手勢解鎖
  },

  playSeason(month) {
    this.play(this.SEASON_KEY[Data.seasonOf(month)]);
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.current) this.els[this.current].volume = this.volume;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      if (this.current) this.els[this.current].pause();
    } else if (this.current) {
      this.els[this.current].volume = this.volume;
      this.els[this.current].play().catch(() => {});
    }
    return this.muted;
  },
};

// 一次性音效（擲骰子等）：走 Web Audio API，不再用 <audio> 元素。
//
// 為什麼不用 <audio>：iOS 的限制是「每一個 Audio 元素」都必須先在使用者手勢裡播放過
// 才會解鎖，而擲骰是遊戲邏輯（計時器、電腦決策）觸發的，不是使用者按下去的那一刻，
// 元素永遠等不到屬於自己的手勢。舊解法是「第一次觸控時靜音播一次」把它騙過去——
// 等於在主畫面偷播一次骰子聲，全靠靜音壓住，靜音時機一旦沒抓準就漏音。
// 前後修過兩次（v1.73 改用 muted、v1.81 改成解鎖全程不解除靜音）都只是治標，
// 真正的問題是「為了解鎖而去播一個不想被聽到的聲音」這件事本身。
//
// Web Audio 沒有這個問題：整個 AudioContext 只要在手勢裡 resume() 一次就全部解鎖，
// 不必逐個元素處理，也**不需要播出任何東西**，所以主畫面完全不會有聲音。
// 附帶好處是每次播放都是新的 source node，連續擲骰可以自然重疊；共用一個 <audio>
// 元素時得先倒帶，會把前一聲直接切斷。
// （下面的 ping() 本來就是這樣做的，這次只是讓其餘音效跟它一致。）
const SFX = {
  volume: 0.7,
  muted: false,
  KEYS: ['dice'],     // 走這裡播放的一次性音效（cheer／heli 有自己的 <audio> 元素，不在此列）
  buffers: {},        // 解碼後的音訊，播放時直接取用，不再碰網路
  _ctx: null,

  _ensureCtx() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this._ctx = new AC(); } catch (_) { return null; }
    }
    return this._ctx;
  },
  // 手勢解鎖：AudioContext 剛建立時是 suspended，resume 一次之後整個 context
  // （含之後才建立的 source node）都能出聲。播放前也順手再確認一次，涵蓋
  // 「使用者用手把按鍵開始、沒觸發到下面那三個事件」之類的邊角情況。
  _resume(ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },

  init() {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    // 音檔抓下來解碼存著。decodeAudioData 在 context 還是 suspended 時一樣能執行，
    // 所以不用等使用者互動就能先準備好。
    this.KEYS.forEach(key => {
      fetch(`assets/audio/${key}.mp3`)
        .then(res => res.arrayBuffer())
        .then(buf => new Promise((resolve, reject) => {
          // Safari 舊版只支援 callback 形式，新版回傳 Promise，兩種都接
          const ret = ctx.decodeAudioData(buf, resolve, reject);
          if (ret && ret.then) ret.then(resolve, reject);
        }))
        .then(decoded => { this.buffers[key] = decoded; })
        .catch(() => {});   // 檔案缺了就是這個音效沒聲音，不影響遊戲進行
    });
    const unlock = () => {
      this._resume(ctx);
      removeEventListener('touchend', unlock);
      removeEventListener('click', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('touchend', unlock);
    addEventListener('click', unlock);
    addEventListener('keydown', unlock);
  },

  play(key) {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    const buf = this.buffers[key];
    if (!ctx || !buf) return;   // 還沒解碼完就這次不播，不卡住遊戲流程
    this._resume(ctx);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = this.volume;
    src.connect(gain); gain.connect(ctx.destination);
    src.start(0);   // 每次都是新的 source node，可以跟前一聲重疊
  },

  // 「按 A 才能繼續」的提示（到站慶祝、年度決算）沒有現成的音效檔，用 Web Audio 直接合成
  // 一聲短短的「叮鈴」提示音（兩個音階、快速上揚），不用另外準備素材檔案。
  ping() {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    this._resume(ctx);
    try {
      const now = ctx.currentTime;
      [[880, 0], [1318.5, .09]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        osc.connect(gain); gain.connect(ctx.destination);
        const t0 = now + delay;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(this.volume * .5, t0 + .015);
        gain.gain.exponentialRampToValueAtTime(.001, t0 + .22);
        osc.start(t0); osc.stop(t0 + .24);
      });
    } catch (_) {}
  },
};
