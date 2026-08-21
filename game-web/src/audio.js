// 音檔的版本參數。v2.02 把所有 mp3 正規化了音量，但**檔名沒有變**——
// 瀏覽器（尤其手機）會繼續用快取裡的舊檔案，聽到的還是舊音量。
// 換過音檔就把這個數字加一，強制重新下載。
const AUDIO_VER = 2;
const audioURL = key => `assets/audio/${key}.mp3?v=${AUDIO_VER}`;

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
  KEYS: ['splash', 'setup', 'lobby', 'character_select', 'spring', 'summer', 'autumn', 'winter', 'debt', 'sea', 'plane',
         // 行進間配樂：擲完骰開始走才播，依玩家車型挑（見 rules 的 TRAIN_BGM）
         'train_local', 'train_puyuma', 'train_hsr'],
  SEASON_KEY: {'春天': 'spring', '夏天': 'summer', '秋天': 'autumn', '冬天': 'winter'},

  // ── 音量 ──
  // 素材原本的母帶音量差非常多：實測（400ms 滑動窗 RMS 的第 95 百分位）最大聲的
  // debt 比最小聲的 autumn 高 23.3 dB，大約五倍音量——負債配樂會炸耳朵、秋天幾乎聽不到。
  //
  // 修法是**直接把 mp3 正規化**（ffmpeg，原檔備份在 assets/audio/原始音量/），
  // 全部拉到同一響度 0.055（約 -25 dB），調整後最大峰值 0.711，不會破音。
  // 一度改成在程式裡用 Web Audio 增益補償（因為 el.volume 上限是 1.0、無法放大），
  // 但那需要把 <audio> 接進 createMediaElementSource，元素的輸出會被永久改道——
  // 接不好就是整個 BGM 靜音，風險不值得。檔案改對了，播放端就簡單。
  //
  // 下面的 TRIM／GAIN 留給「音量編輯器」做事後微調，只能衰減（≤1），
  // 預設全部 1.0＝就用檔案本身的音量。
  TRIM: {},
  el: null,
  current: null,
  volume: 0.8,     // 正規化之後整體變小，master 從 0.5 提到 0.8 才接近原本 lobby 的音量
  muted: false,
  _armed: false,

  init() {
    const el = new Audio();
    el.loop = true;
    el.volume = this.volume;
    el.preload = 'auto';   // 還沒指定 src，真正的下載是 play() 時才開始
    this.el = el;
    this.applySettings();
  },

  // 讀取音量編輯器存下來的設定（audio_settings.js）；沒有那個檔就用預設值
  applySettings() {
    const S = window.AUDIO_SETTINGS;
    if (!S) return;
    if (S.bgm) Object.keys(S.bgm).forEach(k => { this.TRIM[k] = S.bgm[k]; });
    if (S.master && typeof S.master.bgm === 'number') this.volume = S.master.bgm;
    if (S.sfx) Object.keys(S.sfx).forEach(k => { SFX.GAIN[k] = S.sfx[k]; });
    if (S.master && typeof S.master.sfx === 'number') SFX.volume = S.master.sfx;
    if (this.el) this._applyVol(1);
  },

  trimOf(key) {
    const t = this.TRIM[key] == null ? 1 : this.TRIM[key];
    return Math.max(0, Math.min(1, t));   // 只能衰減：el.volume 上限是 1.0
  },

  play(key) {
    if (!this.el || this.current === key || this.KEYS.indexOf(key) < 0) return;
    this.current = key;
    // 換 src 本身就會停掉前一首並從頭開始，不用另外 pause() 與歸零 currentTime
    this.el.src = audioURL(key);
    this._applyVol(1);
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
    this._applyVol(1);
  },
  // factor 是暫時的衰減（讓路用），1 代表正常音量
  _applyVol(factor) {
    if (!this.el) return;
    this.el.volume = Math.max(0, Math.min(1, this.volume * this.trimOf(this.current) * factor));
  },

  // ── 讓路（ducking）──
  // 任何音效播放時都把背景音樂壓低，結束後淡回。
  //
  // 用**引用計數**而不是單一計時器：音效會重疊（直升機循環中又擲骰、快報還沒播完就換人…），
  // 單一計時器的話先結束的那個會把音樂放回來，另一個還在響。
  // duck() 進場 +1、unduck()／逾時 -1，計數歸零才淡回。
  _duckN: 0,
  DUCK_DEPTH: 0.22,
  // ms 給 null／不給 → 一直壓著，要自己呼叫 unduck()（長度不固定，例如直升機飛行）
  duck(ms) {
    if (!this.el || this.muted) return;
    this._duckN++;
    clearInterval(this._duckI);
    this._applyVol(this.DUCK_DEPTH);
    if (ms != null) setTimeout(() => this.unduck(), Math.max(0, ms));
  },
  unduck() {
    this._duckN = Math.max(0, this._duckN - 1);
    if (this._duckN > 0 || !this.el) return;   // 還有別的音效在響，繼續壓著
    clearInterval(this._duckI);
    const t0 = Date.now();
    this._duckI = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / 700);
      this._applyVol(this.DUCK_DEPTH + (1 - this.DUCK_DEPTH) * k);
      if (k >= 1) clearInterval(this._duckI);
    }, 40);
  },

  toggleMute() {
    this.muted = !this.muted;
    if (!this.el) return this.muted;
    if (this.muted) {
      this.el.pause();
    } else if (this.current) {
      this._applyVol(1);
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
  // 事後微調用（音量編輯器會寫進來）。音檔本身已經正規化過，所以預設都是 1.0，除了：
  //   heli 1.4：持續音的響度感知比短促音效低（混音決定，不是修正檔案）
  //   news 0.30：程式合成的號角量出來是 -16.6 dB，比其他音效（約 -27 dB）大了 10.4 dB，
  //              不壓下來的話快報一響會蓋掉一切。這個數字是音量編輯器量出來的。
  //   train 0.43：汽笛量出來 -19.6 dB，同理壓到跟 dice 齊平。
  //   ship 0.16：遊輪汽笛是低頻長音，量出來 -11.1 dB（比 dice 大 16 dB），要壓很多。
  //   plane_sfx 0.35：飛機起飛 -18.0 dB。
  GAIN: {heli: 1.4, news: 0.30, train: 0.43, ship: 0.16, plane_sfx: 0.94, card: 0.42},
  // 全部一次性音效都走這裡。cheer／heli 原本各自掛一個 <audio> 元素，
  // 而 iOS 的解鎖是「每一個元素」各自要在使用者手勢裡播過一次才算解鎖——
  // 到站慶祝與直升機都是動畫流程觸發的，永遠等不到屬於自己的手勢，
  // 所以那兩個音效在手機上其實一直是沒聲音的。搬進來之後共用同一個
  // AudioContext，整個 context 解鎖一次就全部通行。
  KEYS: ['dice', 'cheer', 'heli'],
  buffers: {},        // 解碼後的音訊，播放時直接取用，不再碰網路
  fallbackFailed: {}, // 哪些 key 的 fetch 失敗了（退回 <audio>；診斷用）
  _els: {},           // 退路用的 <audio> 元素
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
      fetch(audioURL(key))
        .then(res => res.arrayBuffer())
        .then(buf => new Promise((resolve, reject) => {
          // Safari 舊版只支援 callback 形式，新版回傳 Promise，兩種都接
          const ret = ctx.decodeAudioData(buf, resolve, reject);
          if (ret && ret.then) ret.then(resolve, reject);
        }))
        .then(decoded => { this.buffers[key] = decoded; })
        .catch(err => {
          // fetch 失敗（離線、用 file:// 開啟會被 CORS 擋、檔案缺了…）就退回 <audio> 元素。
          // 原本這裡是靜靜吞掉錯誤，結果變成「音效整個沒聲音，而且沒有任何跡象」——
          // 實機診斷就是在這裡抓到 Failed to fetch 的。
          // <audio> 在 iOS 有各自解鎖的問題，但「有機會有聲音」總比「一定沒聲音」好。
          this.fallbackFailed[key] = String((err && err.message) || err).slice(0, 60);
        });
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

  // 退路：沒有解碼好的 buffer 時，用 <audio> 元素播。
  _el(key) {
    let el = this._els[key];
    if (!el) { el = new Audio(audioURL(key)); el.preload = 'auto'; this._els[key] = el; }
    return el;
  },

  play(key) {
    if (this.muted) return;
    const ctx = this._ensureCtx();
    const buf = this.buffers[key];
    // 讓路：所有音效播放時背景音樂都壓低。長度用音檔實際長度，抓不到就給 1 秒。
    // 刻意放在最前面、不管音檔載到沒有——讓路是演出的一部分，不該依賴檔案載入成功。
    BGM.duck(Math.round(((buf && buf.duration) || 1) * 1000) + 250);
    if (!buf) {   // 還沒解碼完、或 fetch 失敗 → 用 <audio> 退路，不要無聲
      const el = this._el(key);
      el.loop = false;
      el.volume = Math.max(0, Math.min(1, this.volume * (this.GAIN[key] == null ? 1 : this.GAIN[key])));
      try { el.currentTime = 0; } catch (_) {}
      el.play().catch(() => {});
      return;
    }
    if (!ctx) return;
    this._resume(ctx);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = this.volume * (this.GAIN[key] == null ? 1 : this.GAIN[key]);
    src.connect(gain); gain.connect(ctx.destination);
    src.start(0);   // 每次都是新的 source node，可以跟前一聲重疊
  },

  // 循環播放（直升機飛行中）。回傳一個可以停掉的把手；
  // <audio loop> 換成 AudioBufferSourceNode 的 loop，行為一樣但走同一個解鎖路徑。
  loop(key) {
    if (this.muted) return null;
    const ctx = this._ensureCtx();
    const buf = this.buffers[key];
    // 循環音長度不固定，先一直壓著；把手的 stop() 負責解除（呼叫端不必自己記得）
    BGM.duck(null);
    if (!buf) {   // 退路：<audio loop>
      const el = this._el(key);
      el.loop = true;
      el.volume = Math.max(0, Math.min(1, this.volume * (this.GAIN[key] == null ? 1 : this.GAIN[key])));
      try { el.currentTime = 0; } catch (_) {}
      el.play().catch(() => {});
      return {stop() { el.pause(); try { el.currentTime = 0; } catch (_) {} BGM.unduck(); }};
    }
    if (!ctx) return null;
    this._resume(ctx);
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buf; src.loop = true;
    gain.gain.value = this.volume * (this.GAIN[key] == null ? 1 : this.GAIN[key]);
    src.connect(gain); gain.connect(ctx.destination);
    src.start(0);
    return {stop() { try { src.stop(); } catch (_) {} try { gain.disconnect(); } catch (_) {} BGM.unduck(); }};
  },

  // ── 火車汽笛「噗噗」（約 0.9 秒）──
  // 輪到下一位玩家時響一聲，意思是「該出發了」。電腦的回合也一樣要響，
  // 不然只有真人回合有聲音，節奏會忽有忽無。
  //
  // 蒸汽汽笛的音色特徵是「一組互相不協和的音疊在一起」＋「漏氣的噪音」，
  // 單一個正弦波聽起來像電子嗶聲、不像火車。所以每一聲都用三個音疊
  // （440／554／659，大三和弦再加一點失諧），外加一層帶通白噪當蒸氣聲。
  // 噗噗＝兩短聲，第二聲尾巴讓音高稍微往下掉，聽起來才有「放鬆離站」的感覺。
  //
  // 跟號角一樣：放了 assets/audio/train.mp3 就會自動改用音檔（見下面第一行）。
  trainWhistle() {
    if (this.muted) return;
    if (this.buffers.train) { this.play('train'); return; }
    const c = this._ensureCtx();
    if (!c) return;
    this._resume(c);
    const t = c.currentTime + 0.02;
    const bus = c.createGain();
    bus.gain.value = this.volume * (this.GAIN.train == null ? 1 : this.GAIN.train);
    bus.connect(c.destination);

    // 一聲汽笛：三個音＋蒸氣噪音。
    // **音高固定不變**——真的汽笛拉長就只是拉長，不會降音（第一版做了尾音下滑是錯的）。
    const toot = (t0, dur) => {
      [440, 554, 659].forEach((f, i) => {
        const o = c.createOscillator(), gn = c.createGain(), lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2600;
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = (i - 1) * 7;
        gn.gain.setValueAtTime(0, t0);
        gn.gain.linearRampToValueAtTime(0.16, t0 + 0.03);      // 汽笛是慢一點的起音，不像打擊樂
        gn.gain.setValueAtTime(0.16, t0 + dur * 0.6);
        gn.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
        o.connect(lp); lp.connect(gn); gn.connect(bus);
        o.start(t0); o.stop(t0 + dur + 0.02);
      });
      // 蒸氣：帶通白噪，跟著汽笛一起收
      const n = Math.max(1, Math.floor(c.sampleRate * dur));
      const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.2);
      const src = c.createBufferSource(); src.buffer = b;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q = 0.8;
      const gn = c.createGain(); gn.gain.value = 0.10;
      src.connect(bp); bp.connect(gn); gn.connect(bus);
      src.start(t0);
    };
    toot(t, 0.22);          // 噗（短）
    toot(t + 0.32, 0.85);   // 噗——（長；同一個音高，只是拉長）
    BGM.duck(1400);         // 汽笛全長約 1.17 秒，讓路留一點餘裕
  },

  // ── 遊輪汽笛（約 2 秒）──
  // 玩家走到船運航線時響一次。船的汽笛特徵是**非常低、很長、帶點粗糙**——
  // 頻率壓到 100Hz 上下，起音要慢（大型汽笛不會瞬間全開），並疊一個五度音讓它厚實。
  // 放了 assets/audio/ship.mp3 會自動改用音檔。
  shipHorn() {
    if (this.muted) return;
    if (this.buffers.ship) { this.play('ship'); return; }
    const c = this._ensureCtx(); if (!c) return;
    this._resume(c);
    const t = c.currentTime + 0.02;
    const bus = c.createGain();
    bus.gain.value = this.volume * (this.GAIN.ship == null ? 1 : this.GAIN.ship);
    bus.connect(c.destination);
    const DUR = 1.9;
    [98, 147, 196].forEach((f, i) => {          // 低音＋五度＋八度
      const o = c.createOscillator(), gn = c.createGain(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      o.type = i === 0 ? 'square' : 'sawtooth';  // 方波給低頻一點粗糙感
      o.frequency.value = f; o.detune.value = (i - 1) * 6;
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(i === 0 ? 0.30 : 0.13, t + 0.22);   // 慢起音
      gn.gain.setValueAtTime(i === 0 ? 0.30 : 0.13, t + DUR * 0.72);
      gn.gain.exponentialRampToValueAtTime(0.0008, t + DUR);
      o.connect(lp); lp.connect(gn); gn.connect(bus);
      o.start(t); o.stop(t + DUR + 0.02);
    });
    BGM.duck(Math.round(DUR * 1000) + 300);
  },

  // ── 飛機航線的廣播三連音（約 2.4 秒）──
  // 玩家走到飛機航線時響一次。改成「機場／百貨公司廣播前的三連音」而不是引擎聲：
  // 引擎聲用寬頻噪音做出來雖然像飛機，但在遊戲裡只是一團嘶嘶聲、不好聽也不明確。
  // 三連音是「接下來有事要發生」的通用語彙，跟登機廣播的情境也對得上。
  //
  // 鐘鈴音色的關鍵是**泛音＋長衰減**：每個音除了基頻，再疊 2 倍與 3 倍頻的弱泛音，
  // 起音極快、衰減拉長，三個音互相重疊讓尾巴一起共鳴（單純的正弦波會像電子嗶聲）。
  // 音階用大三和弦上行 do–mi–so，明亮、有精神。
  // 放了 assets/audio/plane_sfx.mp3 會自動改用音檔。
  // 抽卡：上行三音鈴琴（G5-C6-G6），尾韻拉長讓三個音疊在一起＝「叮叮鈴～」。
  // 鈴琴音色用基音＋二倍＋三倍泛音疊出來；起音 6ms 幾乎是瞬間，衰減走指數，
  // 這兩點是「鈴」與「嗡」的差別。量到 -19.5 dB，所以倍率 0.42 才跟擲骰子齊平。
  cardDraw() {
    if (this.muted) return;
    if (this.buffers.card) { this.play('card'); return; }
    const c = this._ensureCtx(); if (!c) return;
    this._resume(c);
    const t = c.currentTime + 0.02;
    const bus = c.createGain();
    bus.gain.value = this.volume * (this.GAIN.card == null ? 1 : this.GAIN.card);
    bus.connect(c.destination);
    const bell = (f, t0, dur, g) => {
      [[1, 1], [2, 0.30], [3, 0.12]].forEach(([mult, amp]) => {
        const o = c.createOscillator(), gn = c.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        gn.gain.setValueAtTime(0, t0);
        gn.gain.linearRampToValueAtTime(g * amp, t0 + 0.006);
        gn.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
        o.connect(gn); gn.connect(bus);
        o.start(t0); o.stop(t0 + dur + 0.02);
      });
    };
    bell(783.99,  t,        0.55, 0.20);   // G5
    bell(1046.50, t + 0.09, 0.60, 0.20);   // C6
    bell(1567.98, t + 0.18, 1.10, 0.22);   // G6
    BGM.duck(1800);
  },

  planeChime() {
    if (this.muted) return;
    if (this.buffers.plane_sfx) { this.play('plane_sfx'); return; }
    const c = this._ensureCtx(); if (!c) return;
    this._resume(c);
    const t = c.currentTime + 0.02;
    const bus = c.createGain();
    bus.gain.value = this.volume * (this.GAIN.plane_sfx == null ? 1 : this.GAIN.plane_sfx);
    bus.connect(c.destination);

    // 一個鐘聲：基頻＋兩個弱泛音，快起音、指數衰減
    const bell = (f, t0, dur, g) => {
      [[1, 1], [2, 0.32], [3, 0.14]].forEach(([mult, amp]) => {
        const o = c.createOscillator(), gn = c.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        gn.gain.setValueAtTime(0, t0);
        gn.gain.linearRampToValueAtTime(g * amp, t0 + 0.008);   // 幾乎是瞬間起音
        gn.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
        o.connect(gn); gn.connect(bus);
        o.start(t0); o.stop(t0 + dur + 0.02);
      });
    };
    // do–mi–so 上行，間隔 0.30 秒；尾音拉長讓三個音一起共鳴
    bell(523.25, t,        1.15, 0.26);   // C5
    bell(659.25, t + 0.30, 1.25, 0.26);   // E5
    bell(783.99, t + 0.60, 1.80, 0.30);   // G5
    BGM.duck(2400);
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
    bus.gain.value = this.volume * (this.GAIN.news == null ? 1 : this.GAIN.news);
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
    BGM.duck(600);
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
