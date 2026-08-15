// ────────────────────────────────────────────────
//  main.js — 開機與開局設定
// ────────────────────────────────────────────────

// 玩家置產清單過長時（玩得夠久，買到幾十個站點都很常見）不要整串列出來——
// 之前設定選單那張卡沒有限高，長清單會把卡片撐到整個畫面之外，變成滿版文字牆，
// 連「關閉」按鈕都點不到，等於卡死操作。這裡只顯示前 STALLS_SHOW 項，
// 超過的用「、...（共 N 項）」收尾；卡片本身也另外加了 max-height+overflow-y
// 當第二道防線，就算清單真的還是很長，最多也只是卡片內可以滾動，不會再滿版溢出。
const STALLS_SHOW = 8;
function formatStalls(names) {
  if (!names.length) return '尚無置產';
  const shown = names.slice(0, STALLS_SHOW).join('、');
  return '置產：' + shown + (names.length > STALLS_SHOW ? `、...（共 ${names.length} 項）` : '');
}

addEventListener('DOMContentLoaded', () => {
  Data.load();
  Render.init(document.getElementById('game'));
  UI.init();
  BGM.init();
  Input.init();
  BGM.play('splash');   // 頁面載入時嘗試播放，若被瀏覽器 autoplay 政策擋下，會在第一次使用者手勢時補播

  // 全螢幕：玩家如果不小心按到 Esc，瀏覽器會自動退出全螢幕（這是瀏覽器原生行為，JS 擋不掉），
  // 所以不只在開場那一次要求全螢幕，之後整場遊戲任何一次按鍵或點擊，只要目前不是全螢幕狀態
  // 就再要求一次，讓畫面自動拉回全螢幕，不用玩家自己想辦法再按回去。
  function ensureFullscreen() {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }
  addEventListener('keydown', ensureFullscreen);
  addEventListener('click', ensureFullscreen);

  // 自製的確認視窗：一定要用這個，不能用瀏覽器原生 confirm()——原生對話框會把瀏覽器踢出全螢幕模式
  function showConfirm(message, onConfirm) {
    document.getElementById('cm-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';
    document.getElementById('cm-cancel').focus();   // 預設焦點在「取消」，避免手滑誤按確定送出覆蓋/刪除存檔這類有風險的操作
    document.getElementById('cm-ok').onclick = () => {
      document.getElementById('confirm-modal').style.display = 'none';
      onConfirm();
    };
    document.getElementById('cm-cancel').onclick = () => {
      document.getElementById('confirm-modal').style.display = 'none';
    };
  }
  window.showConfirm = showConfirm;   // ui.js 的 B 鍵處理（遊戲進行中結束遊戲）要共用這個確認視窗

  // ── 改名面板（虛擬鍵盤）──
  // 兩種用法：
  //  (1) 設定選單改名：全螢幕、不綁來源，任何人的鍵都能操作（遊戲本來就暫停了）。
  //  (2) P3 選角畫面改名：貼在畫面底部的小面板，而且綁定 owner＝持有「改名鎖」的那個介面。
  //      實體鍵盤只有一副、虛擬鍵盤也只有一個，改名一定是「一次一人」，但被鎖住的只該是
  //      「改名」這件事——其他三個人要能繼續選貓、繼續確認。做成全螢幕覆蓋的話，P3 最大的
  //      優點（所有人同時進行）就直接毀了，所以這裡刻意不遮住上半部的貓咪選擇區。
  //
  // 面板全程只吃虛擬鍵盤的字元，DOM 裡不放任何 <input type=text>：這樣 P3 就完全不會遇到
  // 「文字欄位搶走 DOM focus」的問題，多人游標與改名可以並存（P3 的游標本來就不是用 DOM
  // focus 做的，見下面 Pick 的說明）。實體鍵盤玩家直接打字也通，監聽器會把可列印字元轉成
  // 同一套輸入，不必去點虛擬鍵盤。
  const VKBD_ROWS = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M','-','_'],
  ];
  const VKBD_IDLE_MS = 15000;   // 閒置逾時：有人開著改名面板離開座位時，別把全場一直卡著
  let vkbdBuffer = '', vkbdOwner = null, vkbdCommit = null, vkbdIdleTimer = null;
  function buildVirtualKeyboard() {
    const grid = document.getElementById('vkbd-grid');
    if (grid.dataset.built) return;
    grid.innerHTML = VKBD_ROWS.map(row =>
      `<div class="vkbd-row">${row.map(k => `<button type="button" class="vkbd-key" data-char="${k}">${k}</button>`).join('')}</div>`
    ).join('') + `
      <div class="vkbd-row">
        <button type="button" class="vkbd-key wide" data-action="space">空白</button>
        <button type="button" class="vkbd-key" data-action="backspace">⌫</button>
        <button type="button" class="vkbd-key vkbd-done" data-action="done">✓ 完成</button>
      </div>`;
    grid.querySelectorAll('.vkbd-key').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.action === 'space') vkbdInput(' ');
        else if (btn.dataset.action === 'backspace') vkbdBackspace();
        else if (btn.dataset.action === 'done') closeRenamePanel(true);
        else vkbdInput(btn.dataset.char);
      };
    });
    grid.dataset.built = '1';
  }
  function vkbdRenderPreview() { document.getElementById('vkbd-text').textContent = vkbdBuffer; }
  // 每次真的有輸入就把閒置計時重設：逾時是針對「開著面板不動」，正在打字的人不會被切掉
  function vkbdTouch() {
    clearTimeout(vkbdIdleTimer);
    vkbdIdleTimer = setTimeout(() => closeRenamePanel(true), VKBD_IDLE_MS);
  }
  function vkbdInput(ch) {
    if (vkbdBuffer.length >= 8) return;   // 名字上限 8 字
    vkbdBuffer += ch;
    vkbdRenderPreview(); vkbdTouch();
  }
  function vkbdBackspace() { vkbdBuffer = vkbdBuffer.slice(0, -1); vkbdRenderPreview(); vkbdTouch(); }

  // owner：綁定改名鎖的介面 id（P3 用）；不傳＝不限來源（設定選單用）
  // bottom：貼底部的小面板，不遮住上方畫面（P3 用）
  function showRenamePanel({value = '', owner = null, bottom = false, onCommit}) {
    buildVirtualKeyboard();
    vkbdOwner = owner; vkbdCommit = onCommit || null;
    vkbdBuffer = value || '';
    vkbdRenderPreview();
    const vkbd = document.getElementById('vkbd');
    vkbd.classList.toggle('vkbd-bottom', !!bottom);
    vkbd.style.display = 'flex';
    document.querySelector('#vkbd-grid .vkbd-key').focus();
    vkbdTouch();
  }
  function closeRenamePanel(commit) {
    clearTimeout(vkbdIdleTimer); vkbdIdleTimer = null;
    const vkbd = document.getElementById('vkbd');
    vkbd.style.display = 'none';
    vkbd.classList.remove('vkbd-bottom');
    const cb = vkbdCommit, text = vkbdBuffer.trim();
    vkbdOwner = null; vkbdCommit = null;
    // focus 一定要收掉：P3 用的是自己的多人游標，殘留的 DOM focus 會讓某顆按鈕一直亮著金框
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (cb) cb(commit ? text : null);
  }
  window.showRenamePanel = showRenamePanel;
  window.renameLockOwner = () => vkbdOwner;
  // 在按鈕的螢幕座標上找「某個方向最近的那顆」，跟 Board.nearestInDirection（探路放大鏡用的邏輯）
  // 是同一套做法，只是這裡用畫面像素座標，不是地圖世界座標
  function nearestButtonInDirection(buttons, fromEl, dirKey) {
    const dirVec = {ArrowRight:[1,0], ArrowLeft:[-1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[dirKey];
    if (!dirVec) return null;
    const fr = fromEl.getBoundingClientRect();
    const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2;
    let best = null, bestScore = Infinity;
    buttons.forEach(btn => {
      if (btn === fromEl) return;
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = cx - fx, dy = cy - fy;
      const proj = dx * dirVec[0] + dy * dirVec[1];
      if (proj <= 1) return;
      const lateral = Math.abs(dx * dirVec[1] - dy * dirVec[0]);
      if (lateral > proj * 1.5) return;
      const score = proj + lateral * 2;
      if (score < bestScore) { bestScore = score; best = btn; }
    });
    return best;
  }
  // 文件捕捉階段搶最前面處理（跟 ui.js 的統一輸入層同一套做法）：虛擬鍵盤的字元鈕都是真的
  // <button>，真人鍵盤按 Space 確認時，某些瀏覽器對已經 focus 的按鈕有自己的原生預設處理，
  // 可能比我們自己的邏輯先跑；手把是合成事件不會遇到這問題，但這裡要讓鍵盤也一樣可靠。
  document.addEventListener('keydown', e => {
    const vkbd = document.getElementById('vkbd');
    if (vkbd.style.display !== 'flex') return;
    // 改名鎖：綁了 owner（P3 的改名）時，只有持鎖者的按鍵歸這個面板處理，其他玩家的鍵
    // 原封不動往下傳給 P3 自己的監聽器，他們才能繼續選貓。設定選單的改名沒綁 owner，照舊全接管。
    if (vkbdOwner && Input.sourceOf() !== vkbdOwner) return;
    // 持鎖者的鍵一定要擋掉、不再往下傳（尤其是 P3 自己的 keydown）——不然「完成」關掉面板後，
    // 同一次事件還沒結束，下一個監聽器又會拿同一顆鍵去做別的事。
    e.stopImmediatePropagation();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const buttons = Array.from(vkbd.querySelectorAll('.vkbd-key'));
      const active = buttons.includes(document.activeElement) ? document.activeElement : buttons[0];
      const next = nearestButtonInDirection(buttons, active, e.key);
      if (next) next.focus();
      vkbdTouch();
      return;
    }
    // 手把跟實體鍵盤在這個面板上是兩種不同的操作方式，必須分開處理：手把只能靠方向鍵在字元
    // 網格上移動、A 鍵輸入選到的字；實體鍵盤的人根本不需要網格，直接打字最快。兩者用來源區分——
    // 手把的 A 是我們合成出來的 key=' '，實體鍵盤的 A 是 key='a'，如果不看來源就分不出
    // 「這個 A 是要確認、還是要打一個字母 A」。
    if (Input._source) {
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); document.activeElement && document.activeElement.click(); return; }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); closeRenamePanel(false); return; }
      return;
    }
    if (e.key === 'Enter')     { e.preventDefault(); closeRenamePanel(true);  return; }
    if (e.key === 'Escape')    { e.preventDefault(); closeRenamePanel(false); return; }
    if (e.key === 'Backspace') { e.preventDefault(); vkbdBackspace(); return; }
    if (e.key.length === 1 && /[A-Za-z0-9 _-]/.test(e.key)) { e.preventDefault(); vkbdInput(e.key.toUpperCase()); return; }
  }, true);

  // ────────────────────────────────────────────────
  //  共用：「一排一排往下」的方向鍵導覽（單一游標畫面用）
  // ────────────────────────────────────────────────
  // 表單類畫面不能用卡片商店那種格狀「找畫面上最近的點」演算法——勾選框靠左、下拉選單置中、
  // 按鈕置中，橫向位置對不齊，找最近點會覺得置中的按鈕比靠左的勾選框「更接近正下方」，
  // 直接跳過整整一排。改成先按 Y 座標分排、排內再按 X 座標排序：左右在同一排內移動（到頭
  // 停住，不跳排），上下一定切到緊鄰的上／下一排，絕不會因為橫向沒對齊而漏掉某一排。
  //
  // display:none 的欄位（沒勾快速模式時的金額框、沒選自訂時的年數框）一定要排除，但不能比對
  // CSS 字串——實際 style 是 display:none（冒號後沒空格），用 [style*="display: none"] 永遠
  // 比對不到，隱藏欄位會一路留在清單裡，而 focus() 對隱藏元素完全沒反應，焦點就卡在那裡不動。
  // 用 offsetParent 判斷「有沒有真的顯示在畫面上」才可靠。
  function screenRows(sel) {
    const items = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    const rows = [];
    items.forEach(el => {
      const r = el.getBoundingClientRect(), cy = r.top + r.height / 2;
      let row = rows.find(row => Math.abs(row.cy - cy) < 14);
      if (!row) { row = {cy, items: []}; rows.push(row); }
      row.items.push(el);
    });
    rows.sort((a, b) => a.cy - b.cy);
    rows.forEach(row => row.items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left));
    return rows;
  }
  function focusGrid(sel, dx, dy) {
    const rows = screenRows(sel); if (!rows.length) return;
    const cur = document.activeElement;
    const ri = rows.findIndex(row => row.items.includes(cur));
    if (ri < 0) { rows[0].items[0].focus(); return; }
    if (dx !== 0) {
      const ci = rows[ri].items.indexOf(cur);
      rows[ri].items[Math.max(0, Math.min(rows[ri].items.length - 1, ci + dx))].focus();
      return;
    }
    const nri = ri + dy;
    if (nri < 0 || nri >= rows.length) return;   // 已經是第一排/最後一排，上下到頭就不動
    const curX = cur.getBoundingClientRect().left;
    let best = rows[nri].items[0], bestD = Infinity;
    rows[nri].items.forEach(el => {
      const d = Math.abs(el.getBoundingClientRect().left - curX);
      if (d < bestD) { bestD = d; best = el; }
    });
    best.focus();
  }

  // ────────────────────────────────────────────────
  //  P2 開局設定：新遊戲（人數／年數／快速模式）或讀取存檔
  // ────────────────────────────────────────────────
  // 這一頁是「共用畫面」，不分玩家——任何介面都能操作，所以維持單一游標、沿用既有的 DOM focus
  // 機制就好。需要多人各自一個游標的只有 P3（見下面 Pick）。
  const SETUP_SEL = '#setup .n-btn, #setup-years-select, #setup-years-custom, #setup-quickwin-toggle, #setup-quickwin-target, #setup-next, #btn-load-save';
  let playerCount = 4;
  function renderSetup() {
    document.querySelectorAll('#setup .n-btn').forEach(b =>
      b.classList.toggle('chosen', parseInt(b.dataset.n, 10) === playerCount));
  }
  function showSetup() {
    Seats.reset();   // 回到設定畫面就解除上一局的回合鎖，否則這裡會變成只有某個介面能操作
    document.getElementById('setup').style.display = 'flex';
    renderSetup();
    const first = document.querySelector('#setup .n-btn');
    if (first) first.focus();
  }
  document.querySelectorAll('#setup .n-btn').forEach(btn => {
    btn.onclick = () => { playerCount = parseInt(btn.dataset.n, 10); renderSetup(); };
  });
  document.getElementById('setup-years-select').addEventListener('change', function() {
    document.getElementById('setup-years-custom').style.display = this.value === 'custom' ? 'inline-block' : 'none';
  });
  const quickWinToggle = document.getElementById('setup-quickwin-toggle');
  const quickWinInput = document.getElementById('setup-quickwin-target');
  quickWinToggle.addEventListener('change', function() {
    quickWinInput.style.display = this.checked ? 'inline-block' : 'none';
  });
  function setupOptions() {
    const yearsSel = document.getElementById('setup-years-select').value;
    return {
      totalYears: yearsSel === 'custom'
        ? (parseInt(document.getElementById('setup-years-custom').value, 10) || 5)
        : parseInt(yearsSel, 10),
      quickWinTarget: quickWinToggle.checked ? (parseInt(quickWinInput.value, 10) || 500) : null,
    };
  }
  document.getElementById('setup-next').onclick = () => {
    document.getElementById('setup').style.display = 'none';
    Pick.open('new', {count: playerCount, ...setupOptions()});
  };
  // 文件捕捉階段搶最前面處理，理由跟 ui.js 的統一輸入層、上面的改名面板一樣：
  // 「2人對戰」這類按鈕真的有 focus 時，真人鍵盤按確定鍵要保證先被我們自己的邏輯接住。
  document.addEventListener('keydown', e => {
    if (document.getElementById('setup').style.display !== 'flex') return;
    if (document.getElementById('vkbd').style.display === 'flex') return;
    if (e.key === 'b' || e.key === 'B') {
      // 這是最外層的畫面了，按 B 直接退回主畫面（標題畫面），不用跳確認視窗；
      // 主畫面的「按任意鍵開始」監聽器是一次性的，退回去要重新掛上才能再次觸發序章。
      e.preventDefault();
      document.getElementById('setup').style.display = 'none';
      document.getElementById('splash').style.display = 'flex';
      window.armSplash();
      return;
    }
    const active = document.activeElement;
    if (active && active.matches('input[type="number"]') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); active.stepUp(e.key === 'ArrowUp' ? 1 : -1); active.dispatchEvent(new Event('input', {bubbles:true})); return;
    }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); focusGrid(SETUP_SEL, -1, 0); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); focusGrid(SETUP_SEL, 1, 0); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); focusGrid(SETUP_SEL, 0, -1); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); focusGrid(SETUP_SEL, 0, 1); return; }
    if (!(e.code === 'Space' || e.key === ' ' || e.key === 'a' || e.key === 'A')) return;
    e.preventDefault();
    if (!active) return;
    if (active.matches('select')) {
      active.selectedIndex = (active.selectedIndex + 1) % active.options.length;
      active.dispatchEvent(new Event('change', {bubbles:true}));
    } else active.click();
  }, true);

  // ────────────────────────────────────────────────
  //  P3 選角／認領角色：全遊戲唯一一個「多人同時操作」的畫面
  // ────────────────────────────────────────────────
  // 這一頁跟其他所有畫面最大的不同：畫面上要同時存在最多 4 個游標，但 DOM focus 只有一個。
  // 所以這裡完全不用 focus 當選取狀態，改成自己維護一份 cursor（介面 id -> 位置）、自己畫色框。
  // 附帶好處是 DOM focus 可以整個讓給改名面板，兩套天然不會打架。
  //
  // 顏色與號碼是分開的兩件事，這點很重要：
  //   顏色 = 你是誰。依「第一次操作」的先後決定，整頁固定不變。
  //   號碼 = 第幾個玩。依「按 A 確認」的順序決定，有人按 B 退出時後面的人往前遞補。
  // 如果顏色也綁號碼，某個人一退出，其他人的框色就會整排跟著跳動，畫面會非常混亂。
  //
  // 沒有「先登記介面」的畫面是刻意的：Gamepad API 在使用者按下該手把的按鍵之前根本不會回報
  // 這支手把存在（防指紋追蹤），任何「被動列出已連接手把」的清單都是騙人的——一定要先按一下。
  // 既然都要按，就直接在這裡按，不用多一頁。
  const PICK_COLORS = ['#FF5252', '#40C4FF', '#5CE65C', '#C77DFF'];
  const AI_LABEL = ['', '基礎', '中等', '高手'];
  let pendingStart = null;

  const Pick = {
    mode: 'new', count: 4, opts: null,
    slot: null, data: null,
    order: [],              // 介面 id，依「第一次操作」順序 → 決定顏色
    cur: new Map(),         // 介面 id -> {at:'card'|'rename'|'act', i}
    seats: [],              // 新局：[{src, ci, name}]，陣列位置＋1 就是玩家號碼
    claims: new Map(),      // 讀檔：存檔玩家 index -> 介面 id
    customName: new Map(),  // 介面 id -> 改過的名字（重選貓咪時不會弄丟）
    aiLevel: [],            // 新局：每隻貓當電腦時的難度，依 CHARS index
    timer: null, left: 0,

    open(mode, o) {
      Seats.reset();        // 選角期間不能有回合鎖，否則只有上一局的某個介面能動
      this.mode = mode; this.opts = o || {};
      this.count = this.opts.count || 4;
      this.slot = this.opts.slot || null; this.data = this.opts.data || null;
      this.order = []; this.cur.clear(); this.seats = []; this.claims.clear();
      this.customName.clear();
      this.aiLevel = CHARS.map(() => 1);
      this.stopCountdown();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.getElementById('pick-title').textContent = mode === 'new' ? '選擇你的貓咪' : '認領你的角色';
      document.getElementById('pick-sub').textContent = mode === 'new'
        ? `${this.count} 人對戰・先按 A 的人就是玩家 1，沒人選的貓咪由電腦接手`
        : `檔案 ${this.slot}・第 ${this.data.year}／${this.data.totalYears} 年・沒人認領的角色由電腦接手`;
      document.getElementById('pick-hint').textContent = mode === 'new'
        ? '各自用自己的手把／鍵盤：方向鍵移動、A 確認、B 取消重選、X 切換電腦難度'
        : '方向鍵移動、A 認領／取消認領、B 返回列表';
      document.getElementById('pick-start').style.display  = mode === 'new'  ? 'block' : 'none';
      document.getElementById('pick-load').style.display   = mode === 'load' ? 'block' : 'none';
      document.getElementById('pick-delete').style.display = mode === 'load' ? 'block' : 'none';
      document.getElementById('pick-back').style.display   = mode === 'load' ? 'block' : 'none';
      document.getElementById('pick').style.display = 'flex';
      this.render();
    },
    close() {
      this.stopCountdown();
      document.getElementById('pick').style.display = 'none';
    },

    // ── 資料 ──
    cards() {
      return this.mode === 'new'
        ? CHARS.map((c, i) => ({avatar: c.avatar, name: c.name, i}))
        : this.data.players.map((p, i) => {
            const c = CHARS.find(ch => ch.key === p.charKey) || CHARS[0];
            return {avatar: c.avatar, name: p.name, money: p.money, stalls: (p.stalls || []).length, i};
          });
    },
    colorOf(src) { return PICK_COLORS[this.order.indexOf(src) % PICK_COLORS.length]; },
    seatOf(src) { return this.seats.find(s => s.src === src) || null; },
    seatNo(src) { return this.seats.findIndex(s => s.src === src) + 1; },
    ownerOfCard(i) {
      if (this.mode === 'new') { const s = this.seats.find(s => s.ci === i); return s ? s.src : null; }
      return this.claims.get(i) || null;
    },
    // 真人確認完之後，剩下的貓咪依序補給電腦玩家，補不到的就是「不參賽」。
    // 即時算出來給畫面顯示，玩家隨時看得到「現在開局的話會變成什麼樣」。
    aiCats() {
      if (this.mode !== 'new') return new Set();
      const taken = new Set(this.seats.map(s => s.ci));
      const rest = CHARS.map((_, i) => i).filter(i => !taken.has(i));
      return new Set(rest.slice(0, Math.max(0, this.count - this.seats.length)));
    },
    seatsFull() { return this.mode === 'new' && this.seats.length >= this.count; },
    // 有人正在改名時開始鈕要鎖住——這正好達成「大家都設定好再開局」，不用另外做流程控制
    canStart() {
      if (window.renameLockOwner && window.renameLockOwner()) return false;
      return this.mode === 'new' ? this.seats.length >= 1 : this.claims.size >= 1;
    },

    // ── 游標 ──
    // 第一次操作時才配一個顏色與游標。滑鼠故意只在「點下去」時才登記（滑鼠很容易被無意間
    // 碰到，一移動就配一個顏色會白白吃掉一個顏色名額），純 hover 走 CSS 的中性白框。
    touch(src) {
      if (!this.order.includes(src)) {
        if (this.order.length >= PICK_COLORS.length) return false;
        this.order.push(src);
        Input.vibrate(src);
        const free = this.cards().findIndex(c => !this.ownerOfCard(c.i));
        this.cur.set(src, {at: 'card', i: free < 0 ? 0 : free});
        this.render();
      }
      return true;
    },
    actEls() {
      return ['pick-start', 'pick-load', 'pick-delete', 'pick-back']
        .map(id => document.getElementById(id)).filter(el => el.style.display !== 'none');
    },
    move(src, dx, dy) {
      if (!this.touch(src)) return;
      const c = this.cur.get(src), seat = this.seatOf(src), n = this.cards().length;
      // 新局已確認的人：游標只在「自己卡片的改名鈕」和「開始遊戲」之間切換。要換貓咪
      // 得先按 B 取消確認，不然按著方向鍵就能一路把別人的貓換掉。
      if (this.mode === 'new' && seat) {
        if (dy < 0) this.cur.set(src, {at: 'rename', i: seat.ci});
        else if (dy > 0) this.cur.set(src, {at: 'act', i: 0});
        this.render(); return;
      }
      if (c.at === 'card') {
        if (dx) this.cur.set(src, {at: 'card', i: (c.i + dx + n) % n});
        else if (dy > 0 && this.mode === 'load') this.cur.set(src, {at: 'act', i: 0});
      } else if (c.at === 'act') {
        const m = this.actEls().length;
        if (dx) this.cur.set(src, {at: 'act', i: Math.max(0, Math.min(m - 1, c.i + dx))});
        else if (dy < 0) this.cur.set(src, {at: 'card', i: 0});
      }
      this.render();
    },

    // ── A 確認 ──
    confirm(src) {
      if (!this.touch(src)) return;
      const c = this.cur.get(src);
      if (c.at === 'act') { this.actEls()[c.i].click(); return; }
      if (c.at === 'rename') { this.openRename(src); return; }
      const i = c.i, owner = this.ownerOfCard(i);
      if (this.mode === 'load') {
        if (owner === src) { this.claims.delete(i); this.render(); return; }   // 再按一次＝取消認領
        if (owner) { UI.toast(`這個角色已經被${Input.label(owner)}認領了`); return; }
        this.claims.set(i, src); this.render(); return;
      }
      if (this.seatOf(src)) return;
      // 已經被選走的貓咪：游標還是可以停上去（跳過的話手把移動會很跳），但按 A 不生效。
      if (owner) { UI.toast(`這隻貓咪已經被玩家 ${this.seats.findIndex(s => s.ci === i) + 1} 選走了`); return; }
      if (this.seatsFull()) { UI.toast(`名額已滿（${this.count} 人），有人按 B 退出才有位子`); return; }
      this.seats.push({src, ci: i, name: this.customName.get(src) || CHARS[i].name});
      this.cur.set(src, {at: 'act', i: 0});
      this.render();
    },

    // ── B 取消 ──
    back(src) {
      if (this.timer) { this.stopCountdown(); UI.toast('已取消開始'); return; }
      if (this.mode === 'load') { showSaveSlots('load'); this.close(); return; }
      const at = this.seats.findIndex(s => s.src === src);
      if (at >= 0) {
        // splice 之後排在後面的人自動往前遞補，號碼重排、顏色不動
        const ci = this.seats[at].ci;
        this.seats.splice(at, 1);
        this.cur.set(src, {at: 'card', i: ci});
        this.render(); return;
      }
      // 還沒有人確認才允許退回上一頁——已經有人選好了，其他人一按 B 就把整頁收掉太粗暴
      if (!this.seats.length) { this.close(); showSetup(); }
      else UI.toast('已經有人選好了，要返回請先請他們按 B 取消');
    },

    // ── X 切換電腦難度 ──
    cycleAI(src) {
      if (this.mode !== 'new' || !this.touch(src)) return;
      const c = this.cur.get(src);
      if (c.at !== 'card' || !this.aiCats().has(c.i)) return;
      this.aiLevel[c.i] = this.aiLevel[c.i] % 3 + 1;
      this.render();
    },

    // ── 改名（一次一人）──
    openRename(src) {
      const seat = this.seatOf(src); if (!seat) return;
      const owner = window.renameLockOwner();
      if (owner && owner !== src) { UI.toast(`${Input.label(owner)} 正在改名，請稍候`); return; }
      showRenamePanel({
        value: seat.name, owner: src, bottom: true,
        onCommit: text => {
          if (text) { seat.name = text; this.customName.set(src, text); }
          this.render();
        },
      });
      this.render();   // 開始鈕要立刻反灰
    },

    // ── 開局 ──
    requestStart() {
      if (!this.canStart()) {
        UI.toast(window.renameLockOwner() ? '有人正在改名，等他改完再開始' : '至少要有一個人選好角色');
        return;
      }
      if (this.timer) return;
      this.left = 3;
      document.getElementById('pick-countdown').style.display = 'flex';
      const tick = () => {
        document.querySelector('#pick-countdown .pc-num').textContent = this.left;
        if (this.left <= 0) { this.stopCountdown(); this.go(); return; }
        this.left--;
        this.timer = setTimeout(tick, 1000);
      };
      tick();
    },
    stopCountdown() {
      clearTimeout(this.timer); this.timer = null;
      const el = document.getElementById('pick-countdown');
      if (el) el.style.display = 'none';
    },
    go() {
      if (this.mode === 'new') {
        const config = [], sources = [];
        this.seats.forEach(s => {
          config.push({charKey: CHARS[s.ci].key, name: (s.name || '').trim() || undefined, isAI: false, aiLevel: 1});
          sources.push(s.src);
        });
        this.aiCats().forEach(ci => {
          config.push({charKey: CHARS[ci].key, isAI: true, aiLevel: this.aiLevel[ci]});
          sources.push(null);   // 電腦玩家沒有介面
        });
        pendingStart = {config, totalYears: this.opts.totalYears, quickWinTarget: this.opts.quickWinTarget, sources};
        this.close();
        showSaveSlots('assign');
      } else {
        this.data.players.forEach((p, i) => {
          p.isAI = !this.claims.has(i);
          if (p.isAI && !p.aiLevel) p.aiLevel = 1;
        });
        const sources = this.data.players.map((p, i) => this.claims.get(i) || null);
        SaveSystem.write(this.slot, this.data);
        this.close();
        document.getElementById('setup').style.display = 'none';
        document.getElementById('splash').style.display = 'none';
        Game.loadState(this.data, this.slot);
        Seats.activate(sources);
      }
    },

    // ── 畫面 ──
    render() {
      const grid = document.getElementById('pick-grid');
      grid.innerHTML = '';
      const ai = this.aiCats();
      this.cards().forEach(c => {
        const owner = this.ownerOfCard(c.i);
        // 卡片上顯示的名字：被選走的貓咪要顯示那位玩家改過的名字，不能一直顯示貓咪預設名，
        // 否則玩家改完名字畫面完全沒變化，會以為改名沒生效。
        const seat = this.mode === 'new' ? this.seats.find(s => s.ci === c.i) : null;
        const label = seat ? seat.name : c.name;
        const el = document.createElement('div');
        el.className = 'pick-card' + (owner ? ' owned' : '');
        let state, cls = '';
        if (this.mode === 'new') {
          if (owner) { state = `玩家 ${this.seats.findIndex(s => s.ci === c.i) + 1}`; cls = 'is-you'; }
          else if (ai.has(c.i)) { state = `電腦・${AI_LABEL[this.aiLevel[c.i]]}`; cls = 'is-ai'; }
          else { state = '不參賽'; cls = 'is-out'; }
        } else {
          state = owner ? `${Input.label(owner)} 操作` : '電腦';
          cls = owner ? 'is-you' : 'is-ai';
        }
        el.innerHTML = `
          <img class="pc-avatar" src="${c.avatar}" alt="">
          <div class="pc-name">${label}</div>
          ${this.mode === 'load' ? `<div class="pc-meta">💰${formatMoney(c.money)}・置產 ${c.stalls}</div>` : ''}
          <div class="pc-state ${cls}">${state}</div>
          ${this.mode === 'new' && owner ? '<div class="pc-rename">✏️ 改名</div>' : ''}`;
        if (owner) el.style.borderColor = this.colorOf(owner);
        // 滑鼠：點卡片＝確認／認領，點改名＝開改名面板。第一次點才會登記成一個玩家介面。
        el.onclick = ev => {
          if (ev.target.classList.contains('pc-rename')) {
            if (this.touch(SRC_MOUSE)) { this.cur.set(SRC_MOUSE, {at: 'rename', i: c.i}); this.openRename(SRC_MOUSE); }
            return;
          }
          if (this.touch(SRC_MOUSE)) { this.cur.set(SRC_MOUSE, {at: 'card', i: c.i}); this.confirm(SRC_MOUSE); }
        };
        grid.appendChild(el);
      });
      document.getElementById('pick-start').disabled = !this.canStart();
      document.getElementById('pick-start').textContent =
        this.seats.length ? `開始遊戲（${this.seats.length} 人真人／${this.count - this.seats.length} 台電腦）` : '開始遊戲';
      this.paintCursors();
    },
    // 游標停在同一個目標上的多個玩家：一人一圈，由內往外疊。用 box-shadow 疊圈是這裡最省事
    // 的做法——DOM focus 只有一個，但 box-shadow 想畫幾圈都行。
    paintCursors() {
      const ring = (el, srcs) => {
        if (!el) return;
        el.style.boxShadow = srcs.length
          ? srcs.map((s, k) => `0 0 0 ${3 + k * 4}px ${this.colorOf(s)}`).join(',')
          : '';
      };
      const cardEls = Array.from(document.querySelectorAll('#pick-grid .pick-card'));
      cardEls.forEach((el, i) => {
        ring(el, this.hovering('card', i));
        ring(el.querySelector('.pc-rename'), this.hovering('rename', i));
      });
      this.actEls().forEach((el, i) => ring(el, this.hovering('act', i)));
    },
    hovering(kind, i) {
      return this.order.filter(s => {
        const c = this.cur.get(s);
        return c && c.at === kind && c.i === i;
      });
    },
  };

  document.getElementById('pick-start').onclick = () => Pick.requestStart();
  document.getElementById('pick-load').onclick = () => Pick.requestStart();
  document.getElementById('pick-back').onclick = () => { Pick.close(); showSaveSlots('load'); };
  document.getElementById('pick-delete').onclick = () => {
    showConfirm(`確定刪除檔案 ${Pick.slot} 嗎？`, () => { SaveSystem.remove(Pick.slot); Pick.close(); showSaveSlots('load'); });
  };

  // P3 的鍵盤／手把入口。改名面板開著時，持鎖者的按鍵已經在上面那個監聽器被
  // stopImmediatePropagation 攔走，能走到這裡的都是「其他玩家」的鍵——他們照常可以繼續選貓，
  // 這正是改名面板不做成全螢幕、也不綁 DOM focus 的目的。
  document.addEventListener('keydown', e => {
    if (document.getElementById('pick').style.display !== 'flex') return;
    const src = Input.sourceOf(), k = e.key, code = e.code || '';
    if (k === 'ArrowLeft')  { e.preventDefault(); Pick.move(src, -1, 0); return; }
    if (k === 'ArrowRight') { e.preventDefault(); Pick.move(src, 1, 0);  return; }
    if (k === 'ArrowUp')    { e.preventDefault(); Pick.move(src, 0, -1); return; }
    if (k === 'ArrowDown')  { e.preventDefault(); Pick.move(src, 0, 1);  return; }
    if (code === 'Space' || k === ' ' || k === 'a' || k === 'A') { e.preventDefault(); Pick.confirm(src); return; }
    if (k === 'b' || k === 'B') { e.preventDefault(); Pick.back(src); return; }
    if (k === 'x' || k === 'X') { e.preventDefault(); Pick.cycleAI(src); return; }
  }, true);

  document.getElementById('go-restart').onclick = () => location.reload();

  // ── 變更遊戲年數（遊戲中或遊戲結束都可以用）：直接改成新的總年數，可以改長也可以改短，
  //    只是不能比目前年度還小 ──
  function showExtendModal() {
    document.getElementById('ey-cur-total').textContent = Game.totalYears;
    document.getElementById('ey-cur-year').textContent = Game.year;
    document.getElementById('ey-input').min = Game.year;
    document.getElementById('ey-input').value = Game.totalYears;
    document.getElementById('extend-years').style.display = 'flex';
    document.getElementById('ey-input').focus();
  }
  document.getElementById('go-extend').onclick = showExtendModal;
  document.getElementById('cfg-extend').onclick = () => {
    document.getElementById('settings-menu').style.display = 'none';
    showExtendModal();
  };

  // 測試模式：只能在等待擲骰時開（避免中途切站點/加卡片把移動、岔路等狀態機弄亂）
  document.getElementById('cfg-test-mode').onclick = () => {
    document.getElementById('settings-menu').style.display = 'none';
    if (Game.state !== 'awaitRoll') { UI.toast('測試模式只能在等待擲骰時開啟'); return; }
    UI.showTestMode();
  };
  document.getElementById('test-city').onchange = () => UI.refreshTestDistricts();
  document.getElementById('test-district').onchange = () => UI.refreshTestStations();
  document.getElementById('test-goto').onclick = () => {
    const stationId = document.getElementById('test-station').value;
    if (stationId) Game.testGotoStation(stationId);
  };
  document.getElementById('test-close').onclick = () => UI.hideTestMode();
  document.getElementById('ey-cancel').onclick = () => {
    document.getElementById('extend-years').style.display = 'none';
  };
  document.getElementById('ey-confirm').onclick = () => {
    const newTotal = parseInt(document.getElementById('ey-input').value, 10);
    if (!newTotal || newTotal < Game.year) {
      UI.toast(`年數不能小於現在的第 ${Game.year} 年`);
      return;
    }
    document.getElementById('extend-years').style.display = 'none';
    Game.setTotalYears(newTotal);
  };

  // 探路放大鏡游標的唯讀資訊視窗：滑鼠點「關閉」跟按 B 鍵效果一樣
  document.getElementById('si-close').onclick = () => UI.hideScoutInfo();

  // ── 設定選單（齒輪）：查自己的資產、靜音、延長年數；遊戲開始後才會顯示這顆按鈕 ──
  document.getElementById('btn-settings').onclick = () => {
    const pl = Game.curPlayer();
    const box = document.getElementById('cfg-assets');
    box.innerHTML = '';
    if (pl) {
      const stationNames = (pl.stalls || []).map(s => {
        const st = Data.stations.get(s.station);
        return st ? `${st.name}・${s.name}` : s.name;
      });
      const div = document.createElement('div');
      div.className = 'cfg-assets-player';
      div.innerHTML = `
        <img src="${pl.avatar}" alt="">
        <b>${pl.name}</b>${pl.isAI ? '<span class="ai-tag">電腦</span>' : ''}
        <span class="cfg-assets-money">💰${formatMoney(pl.money)}</span>`;
      box.appendChild(div);
      const stallsEl = document.createElement('div');
      stallsEl.className = 'cfg-assets-stalls';
      stallsEl.textContent = formatStalls(stationNames);
      box.appendChild(stallsEl);
    }
    const muteBtn = document.getElementById('btn-mute');
    document.getElementById('cfg-mute-toggle').textContent = muteBtn.textContent === '🔇' ? '🔇 靜音：開' : '🔊 靜音：關';
    document.getElementById('settings-menu').style.display = 'flex';
    document.getElementById('cfg-mute-toggle').focus();
  };
  document.getElementById('cfg-mute-toggle').onclick = () => {
    document.getElementById('btn-mute').click();
    document.getElementById('cfg-mute-toggle').textContent =
      document.getElementById('btn-mute').textContent === '🔇' ? '🔇 靜音：開' : '🔊 靜音：關';
  };
  // 遊戲中改名：P3 的改名只有新局能用（讀檔的角色是進行到一半的局，卡片上要秀資產跟進度，
  // 再塞改名欄位太擠），所以這裡一定要留一個入口——不管新局讀檔，隨時都能改自己的名字。
  // 設定選單本來就會暫停遊戲、獨占輸入，這裡直接用全螢幕的改名面板，不用綁改名鎖。
  document.getElementById('cfg-rename').onclick = () => {
    const pl = Game.curPlayer();
    if (!pl) return;
    document.getElementById('settings-menu').style.display = 'none';
    showRenamePanel({
      value: pl.name,
      onCommit: text => {
        if (text) { pl.name = text; UI.update(); UI.toast(`名字已改成「${text}」`); }
      },
    });
  };
  document.getElementById('cfg-close').onclick = () => {
    document.getElementById('settings-menu').style.display = 'none';
  };

  // ── 存檔系統：10 個檔案匣，仿桃鐵。'assign' = 開新局選檔案匣，'load' = 讀取存檔 ──
  let saveMode = 'load';

  function showSaveSlots(mode) {
    saveMode = mode;
    document.getElementById('save-slots-title').textContent = mode === 'assign' ? '選擇這局要用的檔案匣' : '讀取存檔';
    const list = document.getElementById('save-slots-list');
    list.innerHTML = '';
    for (let i = 1; i <= SaveSystem.SLOTS; i++) {
      const data = SaveSystem.read(i);
      const btn = document.createElement('button');
      btn.className = 'save-slot';
      btn.innerHTML = data
        ? `<div class="save-slot-num">檔案 ${i}</div>
           <div class="save-slot-names">${data.players.map(p => p.name).join('、')}</div>
           <div class="save-slot-meta">${data.players.length} 人・第 ${data.year}／${data.totalYears} 年</div>`
        : `<div class="save-slot-num">檔案 ${i}</div><div class="save-slot-empty">空的存檔</div>`;
      btn.onclick = () => onSlotClick(i, data);
      list.appendChild(btn);
    }
    document.getElementById('save-slots').style.display = 'flex';
    UI.focusOverlayFirst();
  }

  function startPendingGame(slot) {
    document.getElementById('save-slots').style.display = 'none';
    const {config, totalYears, quickWinTarget, sources} = pendingStart;
    Game.start(config.length, config, totalYears, quickWinTarget);
    Game.saveSlot = slot;
    // 開局後才啟用回合鎖：sources[i] 是玩家 i 在 P3 認領的介面（電腦玩家是 null）。
    // 這份對應故意不寫進存檔——硬體會變（手把換插槽、換一台電腦），下次讀檔一律重新認領。
    Seats.activate(sources);
  }

  function onSlotClick(slot, data) {
    if (saveMode === 'assign') {
      if (data) {
        showConfirm(`檔案 ${slot} 已經有存檔（${data.players.map(p => p.name).join('、')}），開新局會覆蓋，確定嗎？`, () => startPendingGame(slot));
      } else {
        startPendingGame(slot);
      }
    } else {
      if (!data) { UI.toast('這格是空的存檔'); return; }
      // 讀檔的「誰操作誰」跟新局的選貓咪是同一件事，共用同一個 P3 畫面：秀出存檔裡的成員
      // （帶資產、置產數），每位真人按 A 認領自己上次的角色，沒被認領的就是電腦。
      // 差別只有一點——順序照存檔走，不由認領順序決定：那是進行到一半的局，先攻順序早就定了。
      document.getElementById('save-slots').style.display = 'none';
      Pick.open('load', {slot, data});
    }
  }

  document.getElementById('save-slots-back').onclick = () => {
    document.getElementById('save-slots').style.display = 'none';
    // 從 P2 直接點「讀取存檔」進來的話（saveMode==='load'），退回去要把 P2 叫回來；
    // 從 P3 按開始遊戲進來選檔案匣的話（saveMode==='assign'），退回去要叫回 P3。
    // 這兩種進入方式背景留著的畫面不一樣，只處理其中一種的話，另一種按返回會全部都
    // display:none，變成整個畫面空白、什麼按鈕都按不到，跟當掉沒有兩樣。
    if (saveMode === 'load') showSetup();
    else document.getElementById('pick').style.display = 'flex';
  };
  document.getElementById('btn-load-save').onclick = () => {
    document.getElementById('setup').style.display = 'none';   // 同上，打開讀取存檔前要先把這畫面藏起來
    showSaveSlots('load');
  };

  // 序章：主畫面後播放五段短演出。所有內容都是現有遊戲素材，讓開場承諾與實際遊玩一致；
  // 可隨時按 Enter／A／空白鍵／Esc 或點「跳過」進入選人數。
  const intro = document.getElementById('intro');
  const introScenes = Array.from(intro.querySelectorAll('.intro-scene'));
  const introProgress = document.getElementById('intro-progress');
  let introTimer = null, introStartedAt = 0, introTotal = 0, introDone = false;
  const finishIntro = () => {
    if (introDone) return;
    introDone = true;
    clearTimeout(introTimer);
    removeEventListener('keydown', onIntroKey);
    intro.classList.remove('playing');
    intro.setAttribute('aria-hidden', 'true');
    showSetup();
  };
  const onIntroKey = e => {
    if (['Enter', ' ', 'Spacebar', 'Escape', 'a', 'A', 'b', 'B'].includes(e.key) || e.code === 'Space') {
      e.preventDefault(); finishIntro();
    }
  };
  const playIntro = () => {
    introDone = false;
    introStartedAt = performance.now();
    introTotal = introScenes.reduce((sum, scene) => sum + Number(scene.dataset.duration), 0);
    intro.classList.add('playing');
    intro.setAttribute('aria-hidden', 'false');
    let index = 0;
    const next = () => {
      introScenes.forEach((scene, i) => scene.classList.toggle('active', i === index));
      const duration = Number(introScenes[index].dataset.duration);
      introTimer = setTimeout(() => ++index < introScenes.length ? next() : finishIntro(), duration);
    };
    const updateProgress = now => {
      if (!introDone) { introProgress.style.width = `${Math.min(100, (now - introStartedAt) / introTotal * 100)}%`; requestAnimationFrame(updateProgress); }
    };
    introProgress.style.width = '0';
    next(); requestAnimationFrame(updateProgress);
    addEventListener('keydown', onIntroKey);
  };
  document.getElementById('intro-skip').onclick = finishIntro;

  // 開場主畫面：按任意鍵／點滑鼠 1 秒後開始序章（全螢幕已經交給上面的 ensureFullscreen 統一處理）。
  const splash = document.getElementById('splash');
  let advanced = false;
  const advanceFromSplash = () => {
    if (advanced) return;
    advanced = true;
    // 兩個觸發方式（點滑鼠／按鍵）共用同一個 guard，但監聽器要兩個都手動移除——
    // 如果玩家是用滑鼠點過去的，keydown 監聽器不會自動消失，會停留到玩家在遊戲裡
    // 第一次隨便按了某個鍵才觸發，1 秒後把選人數畫面蓋回遊戲上面，是個真的會發生的 bug
    removeEventListener('keydown', advanceFromSplash);
    splash.removeEventListener('click', advanceFromSplash);
    BGM.play('setup');
    setTimeout(() => {
      splash.style.display = 'none';
      playIntro();
    }, 1000);
  };
  // 從選人數畫面按 B 退回主畫面時，也要能再一次「按任意鍵開始」——上面那個 advanced 是一次性的，
  // 所以把重新掛回監聽器包成一個函式，退回主畫面時呼叫即可。
  function armSplash() {
    advanced = false;
    splash.addEventListener('click', advanceFromSplash);
    addEventListener('keydown', advanceFromSplash);
  }
  window.armSplash = armSplash;

  // 遊戲進行中按 B 結束遊戲：Game.quitToSetup() 直接切回選人數畫面用這個，跳過片頭序章。
  // 故意不整頁 reload——reload 是真的頁面導覽，瀏覽器會把全螢幕模式退掉，畫面跳成視窗模式
  // 再彈回全螢幕會很突兀；改成原地切畫面，同一個 document 不會有這個問題。
  // showSetup() 裡會 Seats.reset()：結束遊戲退回設定畫面時一定要解除回合鎖，
  // 否則整個設定畫面會變成「只有上一局當時輪到的那個玩家的介面」按得動。
  window.showSetupScreen = showSetup;

  armSplash();
});
