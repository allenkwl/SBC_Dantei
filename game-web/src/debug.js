// ────────────────────────────────────────────────
//  debug.js — 連線同步的事件日誌
//
//  問題的形狀是「兩台各跑各的」，而兩台都在別人手上，事後只能靠回想。
//  這支把每台裝置的關鍵同步事件寫進 Firebase 的 /debug/{群組}/{裝置}，
//  事後把兩台的紀錄合併按時間排好，第一個分岔點就會自己跳出來。
//
//  刻意全部用「包住既有函式」的方式實作，整個除錯邏輯只存在這一個檔案裡：
//  遊戲本體一行都不用改，要拿掉也只要不要載入這支就好。在每個地方補一行
//  Dbg.log(...) 的寫法遲早會漏，而漏掉的那個地方通常就是出事的地方。
//
//  寫入量：每個回合大約十筆上下，比原本每 200ms 一次的 /live 串流小得多，
//  不會是手機發熱的來源。網址加 ?debug=0 可以關掉。
// ────────────────────────────────────────────────
const Dbg = {
  on: false,
  seq: 0,
  buf: [],          // 本機環狀緩衝，離線時也看得到（Dbg.dump()）
  MAX_BUF: 400,
  _t0: 0,

  init() {
    const q = new URLSearchParams(location.search);
    // 目前預設開著（正在追連線不同步）。要關就在網址後面加 ?debug=0
    this.on = q.get('debug') !== '0';
    if (!this.on) return;
    this._t0 = performance.now();
    this._wrapAll();
    this.log('boot', {ua: navigator.userAgent.slice(0, 60), href: location.href.slice(-40)});
  },

  // 相對毫秒（各台從自己載入算起）＋ 伺服器時間（跨裝置對齊用）
  log(tag, data) {
    if (!this.on) return;
    const e = Object.assign({n: ++this.seq, ms: Math.round(performance.now() - this._t0), tag}, data || {});
    this.buf.push(e);
    if (this.buf.length > this.MAX_BUF) this.buf.shift();
    // 還沒進群組就只留在本機（大廳階段沒有群組可以歸檔）
    if (typeof Net === 'undefined' || !Net.db || !Net.groupKey || !Net.clientId) return;
    e.at = Date.now() + (Net.timeOffset || 0);   // 用伺服器校正過的時間，兩台才排得起來
    Net.db.ref('debug/' + Net.groupKey + '/' + Net.clientId).push(e).catch(() => {});
  },

  dump() { return this.buf; },

  // 開新局時把上一局的紀錄清掉，不然合併出來的時間軸會混進舊資料
  clear(key) {
    if (typeof Net === 'undefined' || !Net.db) return Promise.resolve();
    const k = key || Net.groupKey;
    if (!k) return Promise.resolve();
    this.buf = []; this.seq = 0;
    return Net.db.ref('debug/' + k).remove().catch(() => {});
  },

  // 把整個群組所有裝置的紀錄抓下來合併、按伺服器時間排序。
  // 在任何一台的主控台執行 Dbg.report('群組名') 就能看到完整時間軸。
  report(key) {
    const k = key || (typeof Net !== 'undefined' ? Net.groupKey : null);
    if (!k) return Promise.resolve('沒有群組');
    return Net.db.ref('debug/' + k).once('value').then(s => {
      const all = [];
      const byDev = s.val() || {};
      const short = {};
      Object.keys(byDev).forEach((dev, i) => {
        short[dev] = String.fromCharCode(65 + i);   // 裝置代號 A、B、C…
        Object.values(byDev[dev]).forEach(e => all.push(Object.assign({dev: short[dev]}, e)));
      });
      all.sort((a, b) => (a.at || 0) - (b.at || 0) || a.n - b.n);
      const t0 = all.length ? all[0].at : 0;
      return {
        devices: short,
        lines: all.map(e => {
          const {dev, at, n, ms, tag, ...rest} = e;
          return `${String(at - t0).padStart(7)}ms ${dev} ${tag.padEnd(12)} ` +
                 Object.keys(rest).map(k2 => k2 + '=' + JSON.stringify(rest[k2])).join(' ');
        }),
      };
    });
  },

  // ── 以下全部是「包住既有函式」，遊戲本體不動 ──
  _wrap(obj, name, before) {
    if (!obj || typeof obj[name] !== 'function') return;
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => { try { before(args); } catch (_) {} return orig(...args); };
  },

  _wrapAll() {
    const G = typeof Game !== 'undefined' ? Game : null;
    const N = typeof Net  !== 'undefined' ? Net  : null;
    const U = typeof UI   !== 'undefined' ? UI   : null;

    // 這台推出去的權威狀態
    this._wrap(G, 'pushNetState', () => this.log('push',
      {cur: G.cur, st: G.state, mo: G.month, ver: G._stateVer + 1, tok: G.hasToken()}));

    // 收到別人的權威狀態——連「為什麼被丟掉」都要記，這正是這次同名重開 bug 的死因
    this._wrap(G, 'applyNetState', a => {
      const d = a[0] || {};
      let drop = null;
      if (d.by && N && d.by === N.clientId) drop = 'own-echo';
      else if (d.ver != null && d.ver <= G._seenStateVer) drop = 'older(seen=' + G._seenStateVer + ')';
      this.log('recv', {ver: d.ver, cur: d.cur, st: d.state, mo: d.month, drop});
    });

    // 回合流程
    this._wrap(G, 'nextPlayer', () => this.log('next',
      {from: G.cur, mo: G.month, st: G.state, listener: G.isListener()}));
    this._wrap(G, 'beginTurn', () => this.log('begin',
      {cur: G.cur, listener: G.isListener(), tok: G.hasToken()}));
    this._wrap(G, 'handOffToken', () => this.log('handoff',
      {cur: G.cur, st: G.state, claim: (G.netClaims && G.netClaims[G.cur] || {}).id || 'AI'}));
    this._wrap(G, 'roll', () => this.log('roll', {cur: G.cur, st: G.state, listener: G.isListener()}));
    this._wrap(G, 'loadState', () => this.log('load',
      {seenBefore: G._seenStateVer, verBefore: G._stateVer}));

    // 月曆橫幅／年度決算——這兩條非同步分支是卡住的高風險區
    this._wrap(U, 'showMonthBanner', a => this.log('banner', {mo: a[0], st: G.state, tok: G.hasToken()}));
    this._wrap(U, 'showAnnualSettlement', () => this.log('annual', {st: G.state, tok: G.hasToken()}));

    // token 的實際歸屬
    this._wrap(N, 'assignToken', a => this.log('assign', {to: a[0], turn: a[1], cur: a[2]}));
    this._wrap(N, 'watchToken', a => {
      const cb = a[0];
      a[0] = t => { this.log('token', {holder: t && t.holder, turn: t && t.turn,
        cur: t && t.cur, mine: !!(t && N && t.holder === N.clientId)}); return cb(t); };
    });
  },
};
