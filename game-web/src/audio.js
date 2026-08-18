// ────────────────────────────────────────────────
//  audio.js — 背景音樂：開場／選人數／遊戲中依季節切換
//  瀏覽器的自動播放限制：頁面載入時嘗試播放可能會被瀏覽器擋下（合法行為），
//  所以額外掛了「使用者第一次點擊或按鍵」的解鎖邏輯，確保之後都能正常播放
// ────────────────────────────────────────────────
const BGM = {
  KEYS: ['splash', 'setup', 'spring', 'summer', 'autumn', 'winter', 'debt', 'sea', 'plane'],
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

// 一次性音效（擲骰子等）：跟 BGM 分開管理，不會互相蓋掉、不循環播放。
// 每次 play() 都用新的 Audio 物件，允許同一個音效在還沒播完時就重疊再播一次（例如連續擲骰）。
const SFX = {
  volume: 0.7,
  muted: false,
  KEYS: ['dice'],     // 走這裡播放的一次性音效（cheer／heli 有自己的 <audio> 元素，不在此列）
  els: {},

  // iOS 的規則是「每一個 Audio 元素」都必須先在使用者手勢裡播放過才會解鎖，不是「整個網頁」
  // 解鎖一次就好。舊版的 play() 每次都 new Audio()，等於每次都是一個全新、沒解鎖過的元素，
  // 在 iPhone 上永遠播不出聲音（桌機沒有這個限制，所以一直沒被發現）。
  // 改成預先建立、重複使用同一個元素，並在第一次使用者手勢時靜音播一次把它解鎖。
  init() {
    this.KEYS.forEach(key => {
      const el = new Audio(`assets/audio/${key}.mp3`);
      el.preload = 'auto';
      this.els[key] = el;
    });
    // 用 volume=0 靜音再 play() 曾經在部分手機瀏覽器上失效：volume 的變更跟 play() 的
    // 實際發聲之間有極短的競速空檔，播放起點偶爾會用舊的（非零）音量先出聲一瞬間，
    // 短促的音效（例如骰子聲）聽起來就像「一開頁就有音效」。改用 muted 屬性靜音——
    // 這是瀏覽器原生的硬靜音開關，在真正開始播放之前就已經生效，沒有這個競速問題。
    const unlock = () => {
      Object.values(this.els).forEach(el => {
        el.muted = true;
        el.play().then(() => {
          el.pause(); el.currentTime = 0; el.muted = false;
        }).catch(() => { el.muted = false; });
      });
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
    const el = this.els[key];
    if (!el) return;
    el.volume = this.volume;
    el.currentTime = 0;   // 重複使用同一個元素，要倒帶才能連續再播一次
    el.play().catch(() => {});   // 還沒解鎖或被 autoplay 政策擋下時，靜默失敗
  },

  // 「按 A 才能繼續」的提示（到站慶祝、年度決算）沒有現成的音效檔，用 Web Audio 直接合成
  // 一聲短短的「叮鈴」提示音（兩個音階、快速上揚），不用另外準備素材檔案。
  _ctx: null,
  ping() {
    if (this.muted) return;
    try {
      const ctx = this._ctx || (this._ctx = new (window.AudioContext || window.webkitAudioContext)());
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
