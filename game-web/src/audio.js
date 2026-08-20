// ────────────────────────────────────────────────
//  audio.js — 背景音樂：開場／選人數／遊戲大廳／選角／遊戲中依季節切換
// ────────────────────────────────────────────────
// 只用「一個」<audio> 元素，換曲子是換它的 src，不是每首歌各配一個元素。
//
// 為什麼：iOS 的自動播放限制是綁在**元素**上的——每一個 Audio 元素都要自己在
// 使用者手勢裡播放過一次才會解鎖。舊寫法一首歌一個元素，而解鎖處理只在第一次
// 點擊時播「當下那一首」（開場曲）然後就把監聽器拆掉，於是只有開場曲那個元素
// 是解鎖的。其餘幾首能不能響，全看它第一次被播的時候剛好在不在手勢裡：
//   ‧ 大廳曲：使用者點「連線」→ 同一個 click 處理函式裡就播，所以會響
//   ‧ 選角曲：手機這一端是「群主按了開始，Firebase 推過來」才進選角畫面，
//             整條呼叫鏈都在非同步回呼裡，沒有任何手勢——被擋下、靜音
//             （使用者回報的「手機選角 BGM 沒出來」）
// 這跟 SFX 當初碰到的是同一個限制，處理方式也一樣：把「要解鎖的東西」收斂成
// 一個，就不會有「這一個忘了解鎖」的漏洞。
//
// 另外，被擋下時不再是「開場解鎖一次就算了」，而是每次播放失敗都重新掛一次
// 一次性的手勢監聽，等使用者下一次碰畫面再補播。選角畫面本來就要點貓咪，
// 音樂在第一次互動時自然就接上了。
const BGM = {
  KEYS: ['splash', 'setup', 'lobby', 'character_select', 'spring', 'summer', 'autumn', 'winter', 'debt', 'sea', 'plane'],
  SEASON_KEY: {'春天': 'spring', '夏天': 'summer', '秋天': 'autumn', '冬天': 'winter'},

  el: null,
  current: null,
  volume: 0.5,
  muted: false,
  _armed: false,

  init() {
    const el = new Audio();
    el.loop = true;
    el.volume = this.volume;
    el.preload = 'auto';   // 還沒指定 src，真正的下載是 play() 時才開始
    this.el = el;
  },

  play(key) {
    if (!this.el || this.current === key || this.KEYS.indexOf(key) < 0) return;
    this.current = key;
    // 換 src 本身就會停掉前一首並從頭開始，不用另外 pause() 與歸零 currentTime
    this.el.src = `assets/audio/${key}.mp3`;
    this.el.volume = this.volume;
    if (this.muted) { this.el.pause(); return; }
    this._start();
  },

  playSeason(month) {
    this.play(this.SEASON_KEY[Data.seasonOf(month)]);
  },

  // 播放被瀏覽器的自動播放政策擋下是合法行為，不能當成錯誤；擋下就等下一次手勢再補播
  _start() {
    const p = this.el.play();
    if (p && p.catch) p.catch(() => this._armUnlock());
  },

  // 一次性的手勢監聽：只掛一組，觸發後就拆掉。補播若又被擋，_start 會再掛一次。
  _armUnlock() {
    if (this._armed) return;
    this._armed = true;
    const go = () => {
      this._armed = false;
      removeEventListener('touchend', go);
      removeEventListener('click', go);
      removeEventListener('keydown', go);
      if (!this.muted && this.current) this._start();
    };
    addEventListener('touchend', go);
    addEventListener('click', go);
    addEventListener('keydown', go);
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.el) this.el.volume = this.volume;
  },

  // 讓路：新聞快報之類的長音效響的時候把背景音樂壓低，結束後淡回原音量。
  // 不讓路的話兩邊會打在一起，兩邊都聽不清楚。單一個 <audio>，直接動 volume 就好。
  duck(ms) {
    if (!this.el || this.muted) return;
    clearTimeout(this._duckT); clearInterval(this._duckI);
    this.el.volume = this.volume * 0.22;
    this._duckT = setTimeout(() => {
      const t0 = Date.now();
      this._duckI = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / 900);
        if (this.el) this.el.volume = this.volume * (0.22 + 0.78 * k);
        if (k >= 1) clearInterval(this._duckI);
      }, 40);
    }, Math.max(0, (ms || 3000) - 400));
  },

  toggleMute() {
    this.muted = !this.muted;
    if (!this.el) return this.muted;
    if (this.muted) {
      this.el.pause();
    } else if (this.current) {
      this.el.volume = this.volume;
      this._start();
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

  // ── 新聞快報的號角（約 4 秒）──
  // 用 Web Audio 現場合成，不另外放 mp3。理由跟上面 SFX 改寫的理由是同一個：
  // 每個 <audio> 元素在 iOS 都要自己在手勢裡播過才解鎖（cheer.mp3／heli.mp3 目前
  // 在手機上很可能就是沒聲音的），而整個 AudioContext 只要 resume 一次就全部通行。
  // 附帶好處是不用再多下載一個檔案，長度與音量隨時可調。
  // 之後若準備了真正的 jingle，把 'news' 加進 KEYS ＋ 放 assets/audio/news.mp3，
  // 下面的 newsSting() 會自動讓路（見開頭那個 buffers 判斷）。
  //
  // 結構：鑔片＋琶音衝上去 → 號角動機 → 升一階再來一次 → C 大和弦拉長收尾。
  // 所有聲音先進一條總線再出去，不各自接 destination——四秒的樂句會同時疊七八個
  // 聲音，各自接出去很容易加起來破音（實測峰值 0.50，沒有破音樣本）。
  newsSting() {
    if (this.muted) return;
    if (this.buffers.news) { this.play('news'); return; }   // 有真的音檔就用音檔
    const c = this._ensureCtx();
    if (!c) return;
    this._resume(c);
    const t = c.currentTime + 0.02;
    const bus = c.createGain();
    bus.gain.value = this.volume;
    bus.connect(c.destination);

    const tone = ({type = 'sawtooth', f, t0, dur, g = .5, sweep = null, detune = 0}) => {
      const o = c.createOscillator(), gn = c.createGain(), filt = c.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(sweep ? sweep[0] : 12000, t0);
      if (sweep) filt.frequency.exponentialRampToValueAtTime(sweep[1], t0 + dur);
      o.type = type; o.frequency.value = f; o.detune.value = detune;
      gn.gain.setValueAtTime(0, t0);
      gn.gain.linearRampToValueAtTime(g, t0 + .012);
      gn.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
      o.connect(filt); filt.connect(gn); gn.connect(bus);
      o.start(t0); o.stop(t0 + dur + .02);
    };
    const noise = ({t0, dur = .25, g = .25, hp = 4000}) => {
      const n = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.6);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
      const gn = c.createGain(); gn.gain.value = g;
      src.connect(f); f.connect(gn); gn.connect(bus);
      src.start(t0);
    };
    const chord = (freqs, t0, dur, g) =>
      freqs.forEach((f, i) => tone({f, t0, dur, g, sweep: [2600, 700], detune: (i - 1) * 5}));

    noise({t0: t, dur: .45, g: .15, hp: 3200});
    tone({type: 'sine', f: 110, t0: t, dur: .9, g: .42});
    [523, 659, 784, 1047].forEach((f, i) => tone({type: 'triangle', f, t0: t + i * .085, dur: .20, g: .22}));
    [[784, .44, .20], [784, .66, .13], [1047, .82, .42]].forEach(([f, d, du]) =>
      tone({f, t0: t + d, dur: du, g: .22, sweep: [3000, 900]}));
    [[880, 1.38, .20], [880, 1.60, .13], [1175, 1.76, .46]].forEach(([f, d, du]) =>
      tone({f, t0: t + d, dur: du, g: .22, sweep: [3200, 950]}));
    noise({t0: t + 2.30, dur: .5, g: .13, hp: 3000});
    tone({type: 'sine', f: 131, t0: t + 2.30, dur: 1.2, g: .42});
    chord([523, 659, 784, 1047], t + 2.34, 2.10, .150);

    BGM.duck(4000);   // 背景音樂讓路，不然季節配樂會跟號角打在一起
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
