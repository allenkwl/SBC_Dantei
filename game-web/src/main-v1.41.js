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

  // 開場畫面左下角的版號：以前是 HTML 裡寫死的字串，每次另存新版都要記得手動改，
  // 曾經漏改超過十個版本沒人發現（一直停在 V1.44）。改成直接從 <title>（每次另存
  // 新版一定會改的地方）解析出來，不會再有第二個地方要手動同步。
  const verEl = document.getElementById('splash-version');
  const verMatch = document.title.match(/v[\d.]+/i);
  if (verEl && verMatch) verEl.textContent = verMatch[0].toUpperCase();

  // 全螢幕：玩家如果不小心按到 Esc，瀏覽器會自動退出全螢幕（這是瀏覽器原生行為，JS 擋不掉），
  // 所以不只在開場那一次要求全螢幕，之後整場遊戲任何一次按鍵或點擊，只要目前不是全螢幕狀態
  // 就再要求一次，讓畫面自動拉回全螢幕，不用玩家自己想辦法再按回去。
  // 手機判定：看的是「有沒有觸控」而不是螢幕寬度——桌機把視窗縮小一樣會變窄，
  // 但那不該套用手機的全螢幕按鈕／版面邏輯。
  const isMobileDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  // iPhone（非 iPad）的 Safari 完全不支援網頁全螢幕 API（document.documentElement 上
  // 連 requestFullscreen 這個方法都不存在，不是「呼叫了但失敗」，是根本沒有這個 API）。
  // iPad 與所有 Android 瀏覽器都支援。iPhone 玩家要全螢幕只能靠「加入主畫面」
  // （見 <head> 的 apple-mobile-web-app-capable），跟 Fullscreen API 無關，這裡判斷出來
  // 是為了不要在 iPhone 上顯示一顆按下去什麼事都不會發生的全螢幕按鈕。
  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS 13+ 偽裝成 Mac

  function requestFS() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) fn.call(el).catch(() => {});
  }
  function isFullscreenNow() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement
            || document.mozFullScreenElement || document.msFullscreenElement);
  }
  function exitFS() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen
             || document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) fn.call(document).catch(() => {});
  }
  function ensureFullscreen() {
    if (!isFullscreenNow()) requestFS();
  }
  addEventListener('keydown', ensureFullscreen);
  addEventListener('click', ensureFullscreen);
  // 手機用 touchend 另外補一次：大多數行動瀏覽器點一下之後也會補送一個合成的 click，
  // 理論上上面那行就夠了，但部分瀏覽器對「使用者手勢」的認定只認最早發生的那個原始事件，
  // 合成 click 判定成不是真的手勢就會被 requestFullscreen 悄悄拒絕，畫面上完全看不出來
  // （catch 吞掉錯誤）。直接掛 touchend 就是抓最原始的那個事件，不靠瀏覽器幫忙補送。
  addEventListener('touchend', ensureFullscreen);

  // 手機（非 iPhone）另外給一顆看得見的「全螢幕」按鈕：自動觸發不一定每次都成功或維持
  // （例如某些瀏覽器離開全螢幕後不會自動再進去），讓玩家自己也點得到，不用乾等。
  const fsBtn = document.getElementById('btn-fullscreen');
  function updateFsBtn() {
    if (!fsBtn) return;
    fsBtn.style.display = (isMobileDevice() && !isIOS()) ? 'flex' : 'none';
    fsBtn.textContent = isFullscreenNow() ? '✕' : '⛶';
    fsBtn.title = isFullscreenNow() ? '離開全螢幕' : '全螢幕';
  }
  if (fsBtn) {
    fsBtn.onclick = () => { if (isFullscreenNow()) exitFS(); else requestFS(); };
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
      .forEach(ev => document.addEventListener(ev, updateFsBtn));
    updateFsBtn();
  }

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

  // ── 改名面板 ──
  // 兩種用法：
  //  (1) 設定選單改名：全螢幕、不綁 owner，任何介面都能操作（遊戲本來就暫停了）。
  //  (2) P3 選角畫面改名：貼在畫面底部的小面板，綁定 owner＝發起改名的那個介面。面板刻意
  //      不做成全螢幕，其他三個人要能繼續選貓——否則 P3「所有人同時進行」的優點就沒了。
  //
  // 這一版的重點：面板中央是一個「真的」<input type=text>，而且全程持有 DOM focus。
  // 只有真正的輸入框才能讓作業系統的輸入法組字，這是手把玩家能取中文名字的唯一辦法——
  // 虛擬鍵盤網格只有英數，手把自己永遠打不出中文。所以規則是：
  //   ・實體鍵盤「不分持有者」，隨時都可以幫任何人打字（包含用輸入法打中文）
  //   ・手把只有 owner 能操作，用方向鍵在網格上選字、A 輸入、B 取消
  // 面板開著時，實體鍵盤的按鍵一律被這個面板收走（stopImmediatePropagation），但故意不呼叫
  // preventDefault，字才會照常打進輸入框；不收走的話打一個 b 會同時觸發 P3 的「取消選擇」。
  // 代價是幫忙打字的期間，鍵盤玩家自己不能操作選角畫面——改名很短，可以接受。
  //
  // 輸入框持有 focus，所以虛擬鍵盤的「選到哪一顆」不能再用 DOM focus 表示，改成自己記
  // vkbdSel 並上 .sel 這個 class。
  const VKBD_ROWS = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M','-','_'],
  ];
  const VKBD_MAX = 8;             // 名字上限，跟 #vkbd-input 的 maxlength 一致
  // 刻意沒有閒置自動關閉：用輸入法打中文時，選字、翻頁、想名字都要時間，任何逾時都會變成
  // 「打到一半被關掉」。要收掉面板一律靠明確的動作——手把 B、鍵盤 Enter（完成），
  // 或直接點面板上的「✓ 完成」「✕ 取消」（滑鼠隨時可用，卡住也有辦法解）。
  let vkbdOwner = null, vkbdCommit = null, vkbdSel = 0;
  const vkbdEl = () => document.getElementById('vkbd-input');
  const vkbdKeys = () => Array.from(document.querySelectorAll('#vkbd-grid .vkbd-key'));

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
        <button type="button" class="vkbd-key vkbd-cancel" data-action="cancel">✕ 取消</button>
      </div>`;
    grid.querySelectorAll('.vkbd-key').forEach(btn => {
      // 滑鼠點虛擬鍵不能讓輸入框失去 focus，不然輸入法就斷了
      btn.addEventListener('mousedown', ev => ev.preventDefault());
      btn.onclick = () => { vkbdActivate(btn); };
    });
    // maxlength 在中文輸入法組字完成時不一定攔得住，這裡再保險一次
    vkbdEl().addEventListener('input', () => {
      const el = vkbdEl(), chars = [...el.value];
      if (chars.length > VKBD_MAX) el.value = chars.slice(0, VKBD_MAX).join('');
    });
    grid.dataset.built = '1';
  }
  function vkbdActivate(btn) {
    const act = btn.dataset.action;
    if (act === 'space') vkbdInput(' ');
    else if (act === 'backspace') vkbdBackspace();
    else if (act === 'done') closeRenamePanel(true);
    else if (act === 'cancel') closeRenamePanel(false);
    else vkbdInput(btn.dataset.char);
  }
  function vkbdPaintSel() {
    vkbdKeys().forEach((b, i) => b.classList.toggle('sel', i === vkbdSel));
  }
  function vkbdInput(ch) {
    const el = vkbdEl();
    if ([...el.value].length >= VKBD_MAX) return;
    el.value += ch;
  }
  function vkbdBackspace() { const el = vkbdEl(); el.value = [...el.value].slice(0, -1).join(''); }

  // owner：綁定改名鎖的介面 id（P3 用，只限制「手把」；實體鍵盤永遠可以幫忙打字）
  // bottom：貼底部的小面板，不遮住上方畫面（P3 用）
  function showRenamePanel({value = '', owner = null, bottom = false, onCommit}) {
    buildVirtualKeyboard();
    vkbdOwner = owner; vkbdCommit = onCommit || null;
    vkbdSel = 0; vkbdPaintSel();
    const vkbd = document.getElementById('vkbd');
    vkbd.classList.toggle('vkbd-bottom', !!bottom);
    vkbd.style.display = 'flex';
    const el = vkbdEl();
    el.value = value || '';
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
  function closeRenamePanel(commit) {
    const vkbd = document.getElementById('vkbd');
    vkbd.style.display = 'none';
    vkbd.classList.remove('vkbd-bottom');
    const cb = vkbdCommit, text = vkbdEl().value.trim();
    vkbdOwner = null; vkbdCommit = null;
    // focus 一定要收掉：P3 用的是自己的多人游標，殘留的 DOM focus 會讓某個元素一直亮著金框
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

    // ── 手把 ──
    // 只有 owner 的手把能操作這個面板；其他玩家的手把原封不動往下傳給 P3，他們才能繼續選貓。
    if (Input._source) {
      if (vkbdOwner && Input.sourceOf() !== vkbdOwner) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const keys = vkbdKeys();
        const next = nearestButtonInDirection(keys, keys[vkbdSel] || keys[0], e.key);
        if (next) { vkbdSel = keys.indexOf(next); vkbdPaintSel(); }
        return;
      }
      if (Input.isKey(e, ' ')) { const k = vkbdKeys()[vkbdSel]; if (k) vkbdActivate(k); return; }
      if (Input.isBack(e)) { closeRenamePanel(false); return; }
      return;
    }

    // ── 實體鍵盤 ──
    // 不看 owner：鍵盤就是要幫其他玩家服務的。手把玩家想取中文名字，只能靠旁邊的人用
    // 鍵盤（配輸入法）打進輸入框，虛擬鍵盤網格只有英數，手把自己永遠打不出中文。
    //
    // 一律 stopImmediatePropagation 但「不」preventDefault：擋住是為了不讓打字同時觸發
    // P3 的按鍵（打一個 b 會變成取消選擇）；不擋預設行為，字才會照常進到輸入框、輸入法
    // 也才能正常組字。
    e.stopImmediatePropagation();
    if (e.key === 'Enter') { e.preventDefault(); closeRenamePanel(true); return; }
    // 這裡故意沒有 Esc：Esc 會讓瀏覽器退出全螢幕（原生行為，JS 擋不掉），畫面會整個縮掉。
    // 鍵盤要取消請點面板上的「✕ 取消」，手把則是 B。
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
    // 疊在上面的選角／存檔匣畫面一起收掉。正常流程是由離開的那一方自己藏起來，但
    // 遊戲中按 B 結束遊戲會直接呼叫這裡，漏藏的話上一局的選角畫面會殘留在設定畫面上面。
    Pick.close();
    document.getElementById('save-slots').style.display = 'none';
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
    const done = () => e.preventDefault();
    if (Input.isBack(e)) {
      // 這是最外層的畫面了，按 B 直接退回主畫面（標題畫面），不用跳確認視窗；
      // 主畫面的「按任意鍵開始」監聽器是一次性的，退回去要重新掛上才能再次觸發序章。
      done();
      document.getElementById('setup').style.display = 'none';
      document.getElementById('splash').style.display = 'flex';
      window.armSplash();
      return;
    }
    const active = document.activeElement;
    if (active && active.matches('input[type="number"]') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      done(); active.stepUp(e.key === 'ArrowUp' ? 1 : -1); active.dispatchEvent(new Event('input', {bubbles:true})); return;
    }
    if (e.key === 'ArrowLeft')  { done(); focusGrid(SETUP_SEL, -1, 0); return; }
    if (e.key === 'ArrowRight') { done(); focusGrid(SETUP_SEL, 1, 0); return; }
    if (e.key === 'ArrowUp')    { done(); focusGrid(SETUP_SEL, 0, -1); return; }
    if (e.key === 'ArrowDown')  { done(); focusGrid(SETUP_SEL, 0, 1); return; }
    if (!Input.isConfirm(e)) return;
    done();
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
  //   號碼 = 第幾個玩。真人依「按 A 確認」的先後排 1、2…，電腦接在後面依「被指派」的先後排；
  //          有人按 B 退出時整串往前遞補。
  // 如果顏色也綁號碼，某個人一退出，其他人的框色就會整排跟著跳動，畫面會非常混亂。
  //
  // 沒有「先登記介面」的畫面是刻意的：Gamepad API 在使用者按下該手把的按鍵之前根本不會回報
  // 這支手把存在（防指紋追蹤），任何「被動列出已連接手把」的清單都是騙人的——一定要先按一下。
  // 既然都要按，就直接在這裡按，不用多一頁。
  //
  // 台上永遠是「全部的貓咪」，人數只決定要填滿幾個位子，不決定哪幾隻貓能上場。
  // 電腦玩家的角色也要有人動手指派（不自動分配），位子全部填滿才能開始——所以卡片列在
  // 任何時候都要能操作，游標不會因為「你已經選好了」就被鎖住。
  // 之後往 CHARS 加新貓咪，這一頁會自動多出卡片，不用改這裡的程式。
  const PICK_COLORS = ['#FF5252', '#40C4FF', '#5CE65C', '#C77DFF'];
  const AI_LABEL = ['', '基礎', '中等', '高手'];
  let pendingStart = null;

  const Pick = {
    mode: 'new', count: 4, opts: null,
    slot: null, data: null,
    order: [],              // 介面 id，依「第一次操作」順序 → 決定顏色
    cur: new Map(),         // 介面 id -> {at:'card'|'act', i}
    humans: [],             // 新局真人：[{src, ci, name}]，依確認順序
    bots: [],               // 新局電腦：[{ci, level}]，依被指派順序，接在真人後面
    claims: new Map(),      // 讀檔：存檔玩家 index -> 介面 id
    customName: new Map(),  // 介面 id -> 改過的名字（重選貓咪時不會弄丟）

    open(mode, o) {
      Seats.reset();        // 選角期間不能有回合鎖，否則只有上一局的某個介面能動
      this.mode = mode; this.opts = o || {};
      this.count = this.opts.count || 4;
      this.slot = this.opts.slot || null; this.data = this.opts.data || null;
      this.order = []; this.cur.clear();
      this.humans = []; this.bots = []; this.claims.clear(); this.customName.clear();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const isNew = mode === 'new';
      document.getElementById('pick-title').textContent = isNew ? '選擇角色' : '認領你的角色';
      document.getElementById('pick-sub').textContent = isNew
        ? `${this.count} 個位子・先按 A 的人就是玩家 1；真人選完後，任何人都可以幫電腦挑角色`
        : `檔案 ${this.slot}・目前第 ${this.data.year} 年・沒人認領的角色由電腦接手`;
      document.getElementById('pick-hint').textContent = isNew
        ? 'A：選自己的角色（選好後按別隻＝改選）／在自己的角色上按＝改名　X：指派電腦、切換難度　B：取消'
        : '方向鍵移動、A 認領／取消認領、＋／－ 調整總年數、B 返回列表';
      // 讀檔時可以順便改總年數：存檔裡的年數不一定還適合現在要玩多久（想再多玩幾年、
      // 或時間不夠想提早收）。下限是「已經玩到的年份」——改成比它小會變成一載入就結束。
      this.yearsMin = isNew ? 1 : (this.data.year || 1);
      this.years = isNew ? (this.opts.totalYears || 5) : (this.data.totalYears || 5);
      document.getElementById('pick-years').style.display = isNew ? 'none' : 'flex';
      this.renderYears();
      document.getElementById('pick-start').style.display  = isNew ? 'block' : 'none';
      document.getElementById('pick-load').style.display   = isNew ? 'none'  : 'block';
      document.getElementById('pick-delete').style.display = isNew ? 'none'  : 'block';
      document.getElementById('pick-back').textContent = isNew ? '返回' : '返回列表';
      document.getElementById('pick').style.display = 'flex';
      this.render();
    },
    close() {
      document.getElementById('pick').style.display = 'none';
    },

    // 上限跟新遊戲的自訂年數一致（#setup-years-custom 的 max=99），不另外訂一套規則
    YEARS_MAX: 99,
    renderYears() {
      if (this.mode === 'new') return;
      document.getElementById('pick-years-value').textContent = this.years;
      document.getElementById('pick-years-minus').disabled = this.years <= this.yearsMin;
      document.getElementById('pick-years-plus').disabled = this.years >= this.YEARS_MAX;
    },
    adjustYears(delta) {
      if (this.mode === 'new') return;
      const next = Math.max(this.yearsMin, Math.min(this.YEARS_MAX, this.years + delta));
      if (next === this.years) {
        // 已經到底了還按：給個提示，不然按下去完全沒反應會以為是壞掉
        if (delta < 0) UI.toast(`總年數不能少於目前的第 ${this.yearsMin} 年`);
        return;
      }
      this.years = next;
      this.renderYears();
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
    humanAt(ci) { return this.humans.find(h => h.ci === ci) || null; },
    botAt(ci) { return this.bots.find(b => b.ci === ci) || null; },
    mySeat(src) { return this.humans.find(h => h.src === src) || null; },
    filled() { return this.humans.length + this.bots.length; },
    // 玩家號碼：真人先排，電腦接在後面
    numberOf(ci) {
      const hi = this.humans.findIndex(h => h.ci === ci);
      if (hi >= 0) return hi + 1;
      const bi = this.bots.findIndex(b => b.ci === ci);
      return bi >= 0 ? this.humans.length + bi + 1 : 0;
    },
    // 位子全部填滿才能開始。刻意不要求「至少一個真人」——四台電腦自己打的觀戰局是允許的。
    // 有人正在改名時也不能開始，這順手達成「大家都設定好再開局」，不用另外做流程控制。
    canStart() {
      if (window.renameLockOwner && window.renameLockOwner()) return false;
      // 讀檔一律可以開始：沒人認領就是全部交給電腦，跟新局允許 0 個真人是同一個規則。
      return this.mode === 'new' ? this.filled() === this.count : true;
    },

    // ── 游標 ──
    // 第一次操作時才配一個顏色與游標。滑鼠故意只在「點下去」時才登記（滑鼠很容易被無意間
    // 碰到，一移動就配一個顏色會白白吃掉一個顏色名額），純 hover 走 CSS 的中性白框。
    touch(src) {
      if (!this.order.includes(src)) {
        if (this.order.length >= PICK_COLORS.length) return false;
        this.order.push(src);
        Input.vibrate(src);
        const free = this.cards().findIndex(c => !this.takenBy(c.i));
        this.cur.set(src, {at: 'card', i: free < 0 ? 0 : free});
        this.render();
      }
      return true;
    },
    takenBy(ci) {
      if (this.mode === 'load') return this.claims.get(ci) || null;
      return this.humanAt(ci) ? this.humanAt(ci).src : (this.botAt(ci) ? 'bot' : null);
    },
    actEls() {
      return ['pick-start', 'pick-load', 'pick-delete', 'pick-back']
        .map(id => document.getElementById(id)).filter(el => el.style.display !== 'none');
    },
    // 卡片依畫面上實際的視覺列分組。貓咪數量之後會增加，一多就會換行成兩三排，
    // 寫死「一排」的話第二排的貓永遠選不到；改成讀實際位置分列（跟卡片商店同一套想法），
    // 不管幾隻貓、怎麼換行都能走到。
    cardRows() {
      const els = Array.from(document.querySelectorAll('#pick-grid .pick-card'));
      const rows = [];
      els.forEach(el => {
        const r = el.getBoundingClientRect(), cy = r.top + r.height / 2;
        let row = rows.find(row => Math.abs(row.cy - cy) < 20);
        if (!row) { row = {cy, items: []}; rows.push(row); }
        row.items.push({i: Number(el.dataset.i), x: r.left + r.width / 2});
      });
      rows.sort((a, b) => a.cy - b.cy);
      rows.forEach(row => row.items.sort((a, b) => a.x - b.x));
      return rows;
    },
    nearestIn(row, fromI) {
      const els = Array.from(document.querySelectorAll('#pick-grid .pick-card'));
      const from = els.find(el => Number(el.dataset.i) === fromI);
      if (!from) return row.items[0].i;
      const fx = from.getBoundingClientRect().left;
      let best = row.items[0], bestD = Infinity;
      row.items.forEach(it => { const d = Math.abs(it.x - fx); if (d < bestD) { bestD = d; best = it; } });
      return best.i;
    },
    move(src, dx, dy) {
      if (!this.touch(src)) return;
      const c = this.cur.get(src), rows = this.cardRows();
      if (!rows.length) return;
      if (c.at === 'card') {
        let ri = rows.findIndex(r => r.items.some(it => it.i === c.i));
        if (ri < 0) ri = 0;
        const row = rows[ri];
        if (dx) {
          const p = row.items.findIndex(it => it.i === c.i);
          this.cur.set(src, {at: 'card', i: row.items[(p + dx + row.items.length) % row.items.length].i});
        } else if (dy > 0) {
          if (ri >= rows.length - 1) this.cur.set(src, {at: 'act', i: 0});
          else this.cur.set(src, {at: 'card', i: this.nearestIn(rows[ri + 1], c.i)});
        } else if (dy < 0 && ri > 0) {
          this.cur.set(src, {at: 'card', i: this.nearestIn(rows[ri - 1], c.i)});
        }
      } else {
        const m = this.actEls().length;
        if (dx) this.cur.set(src, {at: 'act', i: Math.max(0, Math.min(m - 1, c.i + dx))});
        else if (dy < 0) this.cur.set(src, {at: 'card', i: rows[rows.length - 1].items[0].i});
      }
      this.render();
    },

    // ── A 確認 ──
    // 整頁的規則統一成「把游標指到某張卡，按 A」，看那張卡目前是什麼狀態決定做什麼事。
    confirm(src) {
      if (!this.touch(src)) return;
      const c = this.cur.get(src);
      if (c.at === 'act') { this.actEls()[c.i].click(); return; }
      const i = c.i;
      if (this.mode === 'load') {
        const owner = this.claims.get(i) || null;
        if (owner === src) { this.claims.delete(i); this.render(); return; }   // 再按一次＝取消認領
        if (owner) { UI.toast(`這個角色已經被${Input.label(owner)}認領了`); return; }
        // 同一個介面之前認領過別的角色的話要先讓出來，改成認領這一隻——不然同一支手把
        // 每按一次 A 選新角色就多認領一隻，變成一支手把同時「佔」好幾隻貓。
        for (const [ci, s] of this.claims) { if (s === src) { this.claims.delete(ci); break; } }
        this.claims.set(i, src); this.render(); return;
      }
      const h = this.humanAt(i), b = this.botAt(i), mine = this.mySeat(src);
      if (h && h.src === src) { this.openRename(src); return; }               // 自己的貓＝改名
      // 已經被選走的貓：游標還是可以停上去（跳過的話手把移動會很跳），但按 A 不生效。
      if (h) { UI.toast(`這隻貓咪已經被玩家 ${this.numberOf(i)} 選走了`); return; }
      if (b) { this.bots = this.bots.filter(x => x !== b); this.render(); return; }   // 取消這個電腦玩家
      // 沒人選的貓。A 永遠只管「我自己」——已經選好的人再按別隻，就是「改選這一隻」，
      // 不是幫電腦挑（那是 X 的事）。分工固定成 A＝我、X＝電腦，兩顆鍵各自只有一個意思，
      // 玩家不用記「我現在有沒有入座」才知道 A 會做什麼。
      if (mine) {
        mine.ci = i;
        // 沒有自己改過名字的話，名字跟著新貓咪走；改過名的就保留玩家自己取的名字
        if (!this.customName.has(src)) mine.name = CHARS[i].name;
        this.render(); return;     // 換角色不影響先攻順序，玩家號碼原封不動
      }
      if (this.filled() >= this.count) {
        UI.toast(`位子已經滿了（${this.count} 個），要有人按 B 讓位或取消一位電腦`);
        return;
      }
      this.humans.push({src, ci: i, name: this.customName.get(src) || CHARS[i].name});
      this.render();
    },

    // ── B 取消 ──
    back(src) {
      if (this.mode === 'load') { this.close(); showSaveSlots('load'); return; }
      const at = this.humans.findIndex(h => h.src === src);
      if (at >= 0) {
        // splice 之後排在後面的真人與電腦自動往前遞補，號碼重排、顏色不動
        const ci = this.humans[at].ci;
        this.humans.splice(at, 1);
        this.cur.set(src, {at: 'card', i: ci});
        this.render(); return;
      }
      this.requestBack();
    },
    // 沒有自己的座位時按 B ＝ 返回上一頁。場上已經有人選好的話要先確認——剛把自己的座位
    // 退掉的人很容易順手再按一次 B，沒有這道確認就會把全場的選擇一起清掉。
    requestBack() {
      if (!this.humans.length && !this.bots.length) { this.close(); showSetup(); return; }
      showConfirm('已經有人選好角色了，確定要返回上一頁重新設定嗎？', () => { this.close(); showSetup(); });
    },

    // ── X：電腦相關的操作 ──
    // A 是「我」的操作（選我的角色／改我的名字），X 是「電腦」的操作（指派電腦／換難度）。
    // X 一定要能在「自己還沒入座」的情況下指派電腦，否則四台電腦自己打的觀戰局根本做不出來——
    // 第一次按 A 永遠會先讓自己入座，就再也回不到 0 個真人的狀態了。
    cycleAI(src) {
      if (!this.touch(src)) return;
      const c = this.cur.get(src);
      if (c.at !== 'card') return;
      if (this.mode === 'load') {
        // 讀檔模式沒有「指派電腦」這回事——存檔裡每個角色本來就都在，X 只負責在沒被
        // 真人認領的角色上循環電腦難度；被認領走的角色維持原樣（那是這個玩家的貓）。
        if (this.claims.has(c.i)) return;
        const p = this.data.players[c.i];
        p.aiLevel = (p.aiLevel || 1) % 3 + 1;
        this.render();
        return;
      }
      const b = this.botAt(c.i);
      if (b) { b.level = b.level % 3 + 1; this.render(); return; }      // 已是電腦 → 換難度
      if (this.humanAt(c.i)) return;                                    // 有真人選走了，不能改
      if (this.filled() >= this.count) {
        UI.toast(`位子已經滿了（${this.count} 個），要有人按 B 讓位或取消一位電腦`);
        return;
      }
      this.bots.push({ci: c.i, level: 1});
      this.render();
    },

    // ── 改名（一次一人）──
    openRename(src) {
      const seat = this.mySeat(src); if (!seat) return;
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
    // 按下去就直接開始，不再倒數。倒數本來是給人反悔的緩衝，但要反悔本來就還有更好的路：
    // 讀檔按 B 可以退回存檔列表、新局按 B 可以退回設定，倒數只是每一局都得多等三秒。
    requestStart() {
      if (!this.canStart()) {
        UI.toast(window.renameLockOwner()
          ? '有人正在改名，等他改完再開始'
          : `還要選 ${this.count - this.filled()} 個角色才能開始`);
        return;
      }
      this.go();
    },
    go() {
      if (this.mode === 'new') {
        const config = [], sources = [];
        this.humans.forEach(h => {
          config.push({charKey: CHARS[h.ci].key, name: (h.name || '').trim() || undefined, isAI: false, aiLevel: 1});
          sources.push(h.src);
        });
        this.bots.forEach(b => {
          config.push({charKey: CHARS[b.ci].key, isAI: true, aiLevel: b.level});
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
        // 這一頁調整過的總年數要寫回存檔再載入，否則 Game.loadState 會照舊值開局
        this.data.totalYears = this.years;
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
      this.cards().forEach(c => {
        const el = document.createElement('div');
        el.dataset.i = c.i;
        // xLabel 有值代表這張卡有「X 換難度／派電腦」這個動作，手機／滑鼠沒有 X 鍵可按，
        // 另外畫一顆小按鈕給它用（見下面的 pc-x-btn）——不然觸控裝置完全做不到這件事，
        // 只能眼睜睜看著角色被分配成基礎難度電腦。
        let label = c.name, state, cls = '', hint = '', frame = null, xLabel = '';
        if (this.mode === 'new') {
          const h = this.humanAt(c.i), b = this.botAt(c.i);
          if (h) {
            // 卡片上顯示的名字：被選走的貓咪要顯示那位玩家改過的名字，不能一直顯示貓咪
            // 預設名，否則玩家改完名字畫面完全沒變化，會以為改名沒生效。
            label = h.name; state = `玩家 ${this.numberOf(c.i)}`; cls = 'is-you';
            hint = '✏️ A 改名'; frame = this.colorOf(h.src);
          } else if (b) {
            state = `玩家 ${this.numberOf(c.i)}・電腦（${AI_LABEL[b.level]}）`; cls = 'is-ai';
            hint = 'A 取消'; xLabel = '換難度';
          } else {
            // 提示是畫在卡片上、給所有人看的，不能寫成跟某個玩家的入座狀態有關的句子
            state = '未選'; cls = 'is-out';
            hint = 'A 我要這隻'; xLabel = '派電腦';
          }
        } else {
          const owner = this.claims.get(c.i) || null;
          if (owner) {
            state = `${Input.label(owner)} 操作`; cls = 'is-you'; frame = this.colorOf(owner);
          } else {
            const level = this.data.players[c.i].aiLevel || 1;
            state = `電腦（${AI_LABEL[level]}）`; cls = 'is-ai';
            xLabel = '換難度';
          }
        }
        el.className = 'pick-card' + (frame ? ' owned' : '');
        el.innerHTML = `
          <img class="pc-avatar" src="${c.avatar}" alt="">
          <div class="pc-name">${label}</div>
          ${this.mode === 'load' ? `<div class="pc-meta">💰${formatMoney(c.money)}・置產 ${c.stalls}</div>` : ''}
          <div class="pc-state ${cls}">${state}</div>
          ${hint ? `<div class="pc-hint">${hint}</div>` : ''}
          ${xLabel ? `<button type="button" class="pc-x-btn">🤖 ${xLabel}</button>` : ''}`;
        if (frame) el.style.borderColor = frame;
        // 滑鼠：點卡片＝跟按 A 完全一樣（選角色／指派電腦／改自己的名字／取消電腦）。
        // 第一次點才會登記成一個玩家介面。
        el.onclick = () => {
          if (this.touch(SRC_MOUSE)) { this.cur.set(SRC_MOUSE, {at: 'card', i: c.i}); this.confirm(SRC_MOUSE); }
        };
        const xBtn = el.querySelector('.pc-x-btn');
        if (xBtn) {
          // 跟按 X 完全等價，但要先把滑鼠游標指到這張卡（cycleAI 是看 cur 停在哪張卡動作），
          // 且一定要 stopPropagation——不然點下去會同時觸發上面卡片本身的 onclick（等於 A）。
          xBtn.onclick = ev => {
            ev.stopPropagation();
            if (!this.touch(SRC_MOUSE)) return;
            this.cur.set(SRC_MOUSE, {at: 'card', i: c.i});
            this.cycleAI(SRC_MOUSE);
          };
          // 手機上 mousedown→click 之間如果卡片本身也綁了東西，順手擋掉冒泡，行為更一致
          xBtn.addEventListener('mousedown', ev => ev.stopPropagation());
        }
        grid.appendChild(el);
      });
      if (this.mode === 'new') {
        const start = document.getElementById('pick-start');
        const left = this.count - this.filled();
        start.disabled = !this.canStart();
        start.textContent = left > 0
          ? `還要選 ${left} 個角色`
          : `開始遊戲（${this.humans.length} 真人／${this.bots.length} 電腦）`;
      }
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
      Array.from(document.querySelectorAll('#pick-grid .pick-card'))
        .forEach(el => ring(el, this.hovering('card', Number(el.dataset.i))));
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
  // 滑鼠玩家用點的（手把／鍵盤走上面的 ＋／－ 鍵）。點完 blur，不留下全域的金色 focus 樣式。
  document.getElementById('pick-years-plus').onclick = function() { this.blur(); Pick.adjustYears(1); };
  document.getElementById('pick-years-minus').onclick = function() { this.blur(); Pick.adjustYears(-1); };
  document.getElementById('pick-back').onclick = () => {
    if (Pick.mode === 'load') { Pick.close(); showSaveSlots('load'); }
    else Pick.requestBack();
  };
  document.getElementById('pick-delete').onclick = () => {
    showConfirm(`確定刪除檔案 ${Pick.slot} 嗎？`, () => { SaveSystem.remove(Pick.slot); Pick.close(); showSaveSlots('load'); });
  };

  // P3 的鍵盤／手把入口。改名面板開著時，持鎖者的按鍵已經在上面那個監聽器被
  // stopImmediatePropagation 攔走，能走到這裡的都是「其他玩家」的鍵——他們照常可以繼續選貓，
  // 這正是改名面板不做成全螢幕、也不綁 DOM focus 的目的。
  document.addEventListener('keydown', e => {
    if (document.getElementById('pick').style.display !== 'flex') return;
    // 確認視窗疊在這一頁上面時（返回上一頁、刪除存檔），鍵盤交給 ui.js 的選單導覽處理，
    // 這裡完全不碰——不然方向鍵會同時移動 P3 游標跟確認視窗的焦點。
    if (document.getElementById('confirm-modal').style.display === 'flex') return;
    // 已經被前面的畫面處理掉的鍵不要再處理一次。P2 的監聽器掛在這個之前，按「下一步：選角色」
    // 時它會當場把 #pick 設成 flex，而同一顆確定鍵還沒處理完——沒有這道防線的話，這裡接著
    // 就會收到那顆鍵，一進選角畫面就自動幫按鍵的人選走第一隻貓。
    // 用 defaultPrevented 而不是在 P2 呼叫 stopImmediatePropagation：後者會連 window 上的
    // 「維持全螢幕」監聽器一起擋掉，這裡只要知道「這顆鍵已經有人處理過」就夠了。
    if (e.defaultPrevented) return;
    const src = Input.sourceOf(), k = e.key;
    if (k === 'ArrowLeft')  { e.preventDefault(); Pick.move(src, -1, 0); return; }
    if (k === 'ArrowRight') { e.preventDefault(); Pick.move(src, 1, 0);  return; }
    if (k === 'ArrowUp')    { e.preventDefault(); Pick.move(src, 0, -1); return; }
    if (k === 'ArrowDown')  { e.preventDefault(); Pick.move(src, 0, 1);  return; }
    // 確認鍵先上鎖再處理：拿掉開始倒數後，A 有可能當場就把遊戲開起來（讀檔尤其明顯，
    // go() 是同步跑完的），這顆鍵如果被按住不放，連發的下一次就會落到已經開始的遊戲上
    // 直接擲骰。ui.js 的統一輸入層會擋掉「還沒放開的同一顆確認鍵」（見 _confirmKeyLock），
    // 放開時自動解鎖，所以這裡先鎖起來就不會穿透過去。
    if (Input.isConfirm(e))      { e.preventDefault(); UI.lockConfirmKey(e); Pick.confirm(src); return; }
    if (Input.isBack(e))         { e.preventDefault(); Pick.back(src); return; }
    if (Input.isKey(e, 'x'))     { e.preventDefault(); Pick.cycleAI(src); return; }
    // 總年數：＋／－ 是專屬的增減鍵，不用先把游標移到那兩顆鈕上，在這一頁隨時都能按
    if (Input.isPlus(e))         { e.preventDefault(); Pick.adjustYears(1); return; }
    if (Input.isMinus(e))        { e.preventDefault(); Pick.adjustYears(-1); return; }
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
    if (e.key === 'Enter' || e.key === 'Escape' || Input.isConfirm(e) || Input.isBack(e)) {
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
    // 以前這裡直接進序章，現在先問「單機還是連線」。刻意不另外開一頁：這個選擇很短，
    // 疊在主畫面上兩顆按鈕就夠了，多一頁只是多一次畫面切換。
    showModeChoice();
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

  // ────────────────────────────────────────────────
  //  單機／連線選擇 ＋ 連線大廳
  // ────────────────────────────────────────────────
  // 這幾個畫面都不是 ui.js 管的（ui-v1.42 起 net-lobby／net-room 跟 splash 一樣被排除在
  // 統一輸入層之外），所以鍵盤導覽自己做一套小的：方向鍵在「目前畫面上可以按的東西」
  // 之間移動、A／Enter 觸發、B 返回。所有文字輸入一律走既有的改名面板
  // （window.showRenamePanel），它本來就處理好了手把選字與中文輸入法，不用再做第二套。

  // 目前哪個畫面在吃鍵盤：null＝都不是。每個畫面提供自己的按鈕清單與返回動作。
  let navScreen = null;
  function navButtons() {
    if (!navScreen) return [];
    return Array.from(document.querySelectorAll(`#${navScreen.id} .nav-btn`))
      .filter(el => el.offsetParent !== null && !el.disabled);
  }
  function navFocus(delta) {
    const btns = navButtons();
    if (!btns.length) return;
    const at = btns.indexOf(document.activeElement);
    const next = at < 0 ? 0 : (at + delta + btns.length) % btns.length;
    btns[next].focus();
  }
  function navFocusFirst() {
    const btns = navButtons();
    if (!btns.length) return;
    if (btns.includes(document.activeElement)) return;   // 已經選在這個畫面上就不要跳回第一顆
    btns[0].focus();
  }
  function setNavScreen(screen) {
    navScreen = screen;
    if (!screen) return;
    // 畫面才剛被設成 display:flex，這一瞬間瀏覽器還沒重算版面，navButtons() 用 offsetParent
    // 過濾會把按鈕全部判定成看不見、焦點就設不上去。rAF 與計時器各排一次：分頁在背景時
    // rAF 會被瀏覽器節流甚至完全暫停，只靠它會變成「切回來才發現沒有預設焦點」。
    // navFocusFirst 本身是冪等的（已經選在這個畫面上就不動），排兩次不會互相干擾。
    requestAnimationFrame(() => requestAnimationFrame(navFocusFirst));
    setTimeout(navFocusFirst, 80);
  }
  // 掛在捕捉階段，跟其他畫面的處理一致；改名面板開著時完全不碰（它自己會收走按鍵）。
  document.addEventListener('keydown', e => {
    if (!navScreen) return;
    if (document.getElementById('vkbd').style.display === 'flex') return;
    if (document.getElementById('confirm-modal').style.display === 'flex') return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowLeft')  { e.preventDefault(); navFocus(-1); return; }
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); navFocus(1); return; }
    if (Input.isConfirm(e)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const el = document.activeElement;
      if (el && el.classList.contains('nav-btn')) el.click(); else navFocusFirst();
      return;
    }
    if (Input.isBack(e) && navScreen.onBack) { e.preventDefault(); e.stopImmediatePropagation(); navScreen.onBack(); return; }
  }, true);

  const SCREEN_MODE  = {id: 'splash-mode', onBack: null};
  const SCREEN_LOBBY = {id: 'net-lobby',   onBack: () => backToSplash()};
  const SCREEN_ROOM  = {id: 'net-room',    onBack: () => leaveRoom()};

  function showModeChoice() {
    document.getElementById('splash-mode').style.display = 'flex';
    setNavScreen(SCREEN_MODE);
  }
  function hideModeChoice() {
    document.getElementById('splash-mode').style.display = 'none';
    setNavScreen(null);
  }
  // 退回主畫面：把所有連線畫面收掉、重新武裝「按任意鍵開始」
  function backToSplash() {
    Net.unwatchGroups();
    document.getElementById('net-lobby').style.display = 'none';
    document.getElementById('net-room').style.display = 'none';
    hideModeChoice();
    setNavScreen(null);
    splash.style.display = 'flex';
    BGM.play('splash');
    armSplash();
  }

  document.getElementById('mode-solo').onclick = () => {
    hideModeChoice();
    setTimeout(() => { splash.style.display = 'none'; playIntro(); }, 250);
  };
  // 自己這台的連線狀態：斷線時整條橫幅跳出來，不用等玩家自己發現按什麼都沒反應
  let netConnWatched = false;
  function watchOwnConnection() {
    if (netConnWatched) return;
    netConnWatched = true;
    Net.watchConnection(ok => {
      document.getElementById('net-offline').style.display = ok ? 'none' : 'block';
    });
  }

  document.getElementById('mode-online').onclick = () => {
    // Firebase SDK 是從 CDN 載的，離線或被擋就會載不到。這時候不能讓玩家卡在
    // 一個永遠連不上的畫面，直接講清楚並留在主畫面。
    if (!Net.init()) {
      UI.toast('連不上連線服務，請確認網路後重試；單機模式不受影響');
      return;
    }
    hideModeChoice();
    splash.style.display = 'none';
    watchOwnConnection();
    openLobby();
  };

  // ── 大廳：建群 / 加入 ──
  let myNetName = '';
  function defaultName() {
    return myNetName || ('玩家' + String(Math.floor(Math.random() * 90) + 10));
  }

  function openLobby() {
    myNetName = myNetName || defaultName();
    document.getElementById('net-lobby').style.display = 'flex';
    document.getElementById('net-room').style.display = 'none';
    document.getElementById('lobby-myname').textContent = myNetName;
    renderGroups([]);
    document.getElementById('lobby-groups-empty').textContent = '搜尋中⋯';
    Net.watchGroups(renderGroups);
    setNavScreen(SCREEN_LOBBY);
  }

  function renderGroups(list) {
    const box = document.getElementById('lobby-groups');
    const empty = document.getElementById('lobby-groups-empty');
    const focusedKey = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.gkey : null;
    box.innerHTML = '';
    empty.style.display = list.length ? 'none' : 'block';
    if (!list.length) empty.textContent = '目前沒有人開群組，按上面的「建立群組」開一個吧';
    list.forEach(g => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-btn lobby-group';
      b.dataset.gkey = g.key;
      b.innerHTML = `<span class="lg-name">${g.name}</span><span class="lg-count">${g.count} 人在線</span>`;
      b.onclick = () => doJoin(g.key);
      box.appendChild(b);
    });
    // 列表每秒都會因為心跳而重畫，重畫後要把焦點放回原本選到的那一列，
    // 不然用鍵盤/手把的人會發現游標每秒自己跳回第一個，根本選不到下面的群組。
    if (focusedKey) {
      const again = box.querySelector(`[data-gkey="${focusedKey}"]`);
      if (again) again.focus();
    }
  }

  document.getElementById('lobby-rename').onclick = () => {
    showRenamePanel({
      value: myNetName,
      onCommit: text => {
        if (text != null && text.trim()) {
          myNetName = text.trim();
          document.getElementById('lobby-myname').textContent = myNetName;
          Net.rename(myNetName);
        }
        navFocusFirst();
      },
    });
  };

  document.getElementById('lobby-create').onclick = () => {
    showRenamePanel({
      value: '',
      onCommit: text => {
        const name = (text || '').trim();
        if (!name) { navFocusFirst(); return; }
        Net.createGroup(name, myNetName)
          .then(() => openRoom())
          .catch(err => {
            UI.toast(err && err.message === 'EXISTS'
              ? `「${name}」這個群組名稱已經有人用了，換一個吧`
              : '建立群組失敗，請確認網路後重試');
            navFocusFirst();
          });
      },
    });
  };

  document.getElementById('lobby-back').onclick = () => backToSplash();

  function doJoin(key) {
    Net.joinGroup(key, myNetName)
      .then(() => openRoom())
      .catch(err => {
        const m = err && err.message;
        UI.toast(m === 'STARTED' ? '這一局已經開始了，加入不了'
               : m === 'GONE'    ? '這個群組已經解散了'
               : '加入失敗，請確認網路後重試');
        navFocusFirst();
      });
  }

  // ── 群組房間：等其他人加入 ──
  function openRoom() {
    Net.unwatchGroups();
    document.getElementById('net-lobby').style.display = 'none';
    document.getElementById('net-room').style.display = 'flex';
    document.getElementById('room-name').textContent = Net.groupName || '';
    document.getElementById('room-role').textContent = Net.isHost ? '（你是群主）' : '';
    Net.watchMembers(info => {
      // info 是 null 代表整個群組被刪掉了（群主離開時最後一個人走掉會整個收掉）
      if (!info) { UI.toast('群組已經解散'); leaveRoom(); return; }
      const box = document.getElementById('room-members');
      box.innerHTML = '';
      info.members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'room-member' + (m.online ? '' : ' offline');
        row.innerHTML = `<span class="rm-dot"></span>`
          + `<span class="rm-name">${m.name}</span>`
          + (m.isHost ? '<span class="rm-tag">群主</span>' : '')
          + (m.me ? '<span class="rm-tag me">你</span>' : '')
          + `<span class="rm-state">${m.online ? '在線' : '斷線中⋯'}</span>`;
        box.appendChild(row);
      });
      document.getElementById('room-count').textContent = `${info.members.filter(m => m.online).length} 人在線`;
    });
    setNavScreen(SCREEN_ROOM);
  }

  function leaveRoom() {
    Net.leaveGroup().then(() => openLobby());
  }
  document.getElementById('room-leave').onclick = () => leaveRoom();
  document.getElementById('room-start').onclick = () => {
    UI.toast('遊戲狀態同步還在開發中，這一版先確認大家連得上、看得到彼此');
  };
  // 關掉分頁前主動離開，讓其他人立刻看到少一個人（不必等 onDisconnect 或心跳過期）
  addEventListener('pagehide', () => { if (Net.groupKey) Net.leaveGroup(); });

  armSplash();
});
