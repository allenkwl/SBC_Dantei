// ────────────────────────────────────────────────
//  main.js — 開機與開局設定
// ────────────────────────────────────────────────
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

  // 虛擬鍵盤：只支援英數字（不含中文注音），讓沒有實體鍵盤的手把玩家也能替角色改名。
  // 方向鍵在字元網格上移動、確定鍵（空白鍵／A／手把 A 鈕）＝輸入目前選到的字元，
  // B 鍵＝取消，還原成打開前的文字；「空白」「退格」「✓ 完成」是額外的功能鍵。
  const VKBD_ROWS = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M','-','_'],
  ];
  let vkbdTarget = null, vkbdBuffer = '';
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
        else if (btn.dataset.action === 'done') closeVirtualKeyboard(true);
        else vkbdInput(btn.dataset.char);
      };
    });
    grid.dataset.built = '1';
  }
  function vkbdRenderPreview() { document.getElementById('vkbd-text').textContent = vkbdBuffer; }
  function vkbdInput(ch) {
    if (vkbdBuffer.length >= 8) return;   // 跟改名欄位的 maxlength 一致
    vkbdBuffer += ch;
    vkbdRenderPreview();
  }
  function vkbdBackspace() { vkbdBuffer = vkbdBuffer.slice(0, -1); vkbdRenderPreview(); }
  function showVirtualKeyboard(input) {
    buildVirtualKeyboard();
    vkbdTarget = input;
    vkbdBuffer = input.value;
    vkbdRenderPreview();
    document.getElementById('vkbd').style.display = 'flex';
    document.querySelector('#vkbd-grid .vkbd-key').focus();
  }
  function closeVirtualKeyboard(commit) {
    document.getElementById('vkbd').style.display = 'none';
    if (commit && vkbdTarget) {
      vkbdTarget.value = vkbdBuffer;
      vkbdTarget.dispatchEvent(new Event('input', {bubbles:true}));
    }
    if (vkbdTarget) vkbdTarget.focus();
    vkbdTarget = null;
  }
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
  addEventListener('keydown', e => {
    const vkbd = document.getElementById('vkbd');
    if (vkbd.style.display !== 'flex') return;
    // 一定要擋掉這顆鍵繼續傳給下一個監聽器（尤其是名冊畫面自己的 keydown）——
    // 不然「完成」把虛擬鍵盤關掉、focus 移回改名欄位後，同一次事件還沒結束，
    // 名冊的監聽器接著也會處理到，一看 active element 變成改名欄位，又把虛擬鍵盤重新叫出來。
    e.stopImmediatePropagation();
    const isConfirm = e.code === 'Space' || e.key === ' ' || e.key === 'a' || e.key === 'A';
    const isBack = e.key === 'b' || e.key === 'B';
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const buttons = Array.from(vkbd.querySelectorAll('.vkbd-key'));
      const active = buttons.includes(document.activeElement) ? document.activeElement : buttons[0];
      const next = nearestButtonInDirection(buttons, active, e.key);
      if (next) next.focus();
      return;
    }
    if (isConfirm) { e.preventDefault(); document.activeElement && document.activeElement.click(); return; }
    if (isBack) { e.preventDefault(); closeVirtualKeyboard(false); return; }
  });

  // 「讀取存檔」跟人數按鈕一起放進同一份鍵盤導覽清單，方向鍵才能巡覽到它
  const setupButtons = Array.from(document.querySelectorAll('#setup .n-btn, #btn-load-save'));
  let setupIndex = 0;
  function updateSetupSelection() {
    setupButtons.forEach((btn, i) => {
      btn.classList.toggle('kb-selected', i === setupIndex);
      btn.setAttribute('aria-selected', i === setupIndex ? 'true' : 'false');
    });
  }
  function choosePlayerCount(n) {
    document.getElementById('setup').style.display = 'none';
    showRoster(n);
  }
  setupButtons.forEach((btn, i) => {
    if (!btn.dataset.n) return;   // 讀取存檔按鈕自己在下面另外綁了 onclick，這裡只綁人數按鈕
    btn.onclick = () => { setupIndex = i; updateSetupSelection(); choosePlayerCount(parseInt(btn.dataset.n, 10)); };
  });
  // 版面固定是「人數按鈕橫排一列在上面、讀取存檔獨立一顆在下面正中間」，不是隨卡片數量變動的格狀清單，
  // 用幾何最近點來找方向會因為讀取存檔置中、跟兩側按鈕連線接近45度角而誤判成同排；這種固定版面
  // 直接寫死上下左右的對應關係最穩：左右在人數按鈕之間循環，上下負責在「人數列」和「讀取存檔」之間切換，
  // 離開讀取存檔時記得回到切過去之前選的那顆人數按鈕。
  let lastTopIndex = 0;
  const topCount = setupButtons.length - 1;   // 讀取存檔排在陣列最後一個，其餘都是同一排的人數按鈕
  addEventListener('keydown', e => {
    if (document.getElementById('setup').style.display !== 'flex') return;
    if (e.key === 'b' || e.key === 'B') {
      // 選對戰人數是最外層的畫面了，按 B 直接退回主畫面（標題畫面），不用跳確認視窗；
      // 主畫面的「按任意鍵開始」監聽器是一次性的，退回去要重新掛上才能再次觸發序章。
      e.preventDefault();
      document.getElementById('setup').style.display = 'none';
      document.getElementById('splash').style.display = 'flex';
      window.armSplash();
      return;
    }
    const onLoadBtn = setupIndex === topCount;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!onLoadBtn) setupIndex = (setupIndex + topCount - 1) % topCount;
      updateSetupSelection(); return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!onLoadBtn) setupIndex = (setupIndex + 1) % topCount;
      updateSetupSelection(); return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!onLoadBtn) { lastTopIndex = setupIndex; setupIndex = topCount; }
      updateSetupSelection(); return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (onLoadBtn) setupIndex = lastTopIndex;
      updateSetupSelection(); return;
    }
    if (e.code === 'Space' || e.key === ' ' || e.key === 'a' || e.key === 'A') {
      e.preventDefault(); setupButtons[setupIndex].click();
    }
  });

  // 玩家設定畫面：每位玩家可任選 4 個角色之一（點大頭貼切換，跟別人選同一個會直接互換）、
  // 改名字、選真人／電腦（三種難度）。picks 存的是該欄位目前選中的 CHARS 索引。
  let picks = [];
  const nameTouched = [];   // 使用者手動改過名字的欄位就不再跟著角色切換自動改名
  const names = [];
  const modes = [];

  function showRoster(n) {
    picks = Array.from({length: n}, (_, i) => i);
    nameTouched.length = n; nameTouched.fill(false);
    names.length = n; for (let i = 0; i < n; i++) names[i] = CHARS[picks[i]].name;
    modes.length = n; modes.fill('human');
    renderRoster();
    document.getElementById('roster').style.display = 'flex';
  }

  function renderRoster() {
    const list = document.getElementById('roster-list');
    list.innerHTML = '';
    picks.forEach((ci, i) => {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const pickerHTML = CHARS.map((c, ci2) => `<img tabindex="0" class="roster-avatar-opt${ci2 === ci ? ' selected' : ''}" data-idx="${i}" data-ci="${ci2}" src="${c.avatar}" title="${c.name}" alt="${c.name}">`).join('');
      row.innerHTML = `
        <div class="roster-avatar-picker">${pickerHTML}</div>
        <input class="roster-name" type="text" value="${names[i]}" maxlength="8" data-idx="${i}">
        <select class="roster-mode" data-idx="${i}">
          <option value="human">真人</option>
          <option value="ai1">電腦（基礎）</option>
          <option value="ai2">電腦（中等）</option>
          <option value="ai3">電腦（高手）</option>
        </select>
      `;
      row.querySelector('.roster-mode').value = modes[i];
      list.appendChild(row);
    });

    list.querySelectorAll('.roster-avatar-opt').forEach(img => {
      img.addEventListener('click', () => {
        const idx = parseInt(img.dataset.idx, 10), ci = parseInt(img.dataset.ci, 10);
        if (picks[idx] === ci) return;
        const otherIdx = picks.findIndex((v, j) => v === ci && j !== idx);
        if (otherIdx !== -1) {
          const oldCi = picks[idx];
          picks[otherIdx] = oldCi;
          if (!nameTouched[otherIdx]) names[otherIdx] = CHARS[oldCi].name;
        }
        picks[idx] = ci;
        if (!nameTouched[idx]) names[idx] = CHARS[ci].name;
        renderRoster();
      });
    });
    list.querySelectorAll('.roster-name').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx, 10);
        nameTouched[idx] = true;
        names[idx] = input.value;
      });
    });
    list.querySelectorAll('.roster-mode').forEach(sel => {
      sel.addEventListener('change', () => {
        modes[parseInt(sel.dataset.idx, 10)] = sel.value;
      });
    });
  }

  document.getElementById('roster-years-select').addEventListener('change', function() {
    document.getElementById('roster-years-custom').style.display = this.value === 'custom' ? 'inline-block' : 'none';
  });

  // 玩家設定可全程以方向鍵與 A／空白鍵操作：焦點依序巡覽頭像、模式、年數和開始按鈕。
  // 玩家設定可全程以方向鍵與 A／空白鍵操作：焦點依序巡覽頭像、改名欄位、模式、年數和開始按鈕。
  function rosterControls() {
    return Array.from(document.querySelectorAll('#roster .roster-avatar-opt, #roster .roster-name, #roster .roster-mode, #roster-years-select, #roster-quickwin-toggle, #roster-years-custom:not([style*="display: none"]), #roster-quickwin-target:not([style*="display: none"]), #roster-start'));
  }
  function focusRoster(delta) {
    const controls = rosterControls(); if (!controls.length) return;
    let index = controls.indexOf(document.activeElement);
    index = index < 0 ? 0 : (index + delta + controls.length) % controls.length;
    controls[index].focus();
  }
  addEventListener('keydown', e => {
    if (document.getElementById('roster').style.display !== 'flex') return;
    if (document.getElementById('vkbd').style.display === 'flex') return;   // 虛擬鍵盤開著時，讓它自己的監聽器處理，這裡不重複處理同一個按鍵
    if (e.key === 'b' || e.key === 'B') {
      // 不小心從選人數畫面點到下一頁：按 B 直接退回選人數畫面，不用確認（這裡還沒真的開局，沒東西會遺失）
      e.preventDefault();
      document.getElementById('roster').style.display = 'none';
      document.getElementById('setup').style.display = 'flex';
      return;
    }
    const active = document.activeElement;
    const isConfirm = e.code === 'Space' || e.key === ' ' || e.key === 'a' || e.key === 'A';
    if (active && active.matches('input[type="number"]') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); active.stepUp(e.key === 'ArrowUp' ? 1 : -1); active.dispatchEvent(new Event('input', {bubbles:true})); return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); focusRoster(-1); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); focusRoster(1); return; }
    if (!isConfirm) return;
    e.preventDefault();
    if (active && active.matches('.roster-name')) {
      showVirtualKeyboard(active);   // 改名欄位按確定鍵＝打開虛擬鍵盤（沒有實體鍵盤的手把玩家也能打字）
    } else if (active && active.matches('.roster-mode, #roster-years-select')) {
      active.selectedIndex = (active.selectedIndex + 1) % active.options.length;
      active.dispatchEvent(new Event('change', {bubbles:true}));
    } else if (active && active.matches('#roster-quickwin-toggle')) active.click();
    else if (active) active.click();
  });

  const quickWinToggle = document.getElementById('roster-quickwin-toggle');
  const quickWinInput = document.getElementById('roster-quickwin-target');
  if (quickWinToggle) {
    quickWinToggle.addEventListener('change', function() {
      quickWinInput.style.display = this.checked ? 'inline-block' : 'none';
    });
  }

  // 設定好玩家與年數後，還要選一個檔案匣給這局用（之後每年自動存到這格），選好才真的開局
  let pendingStart = null;
  document.getElementById('roster-start').onclick = () => {
    const config = picks.map((ci, i) => {
      const mode = modes[i];
      const isAI = mode !== 'human';
      const aiLevel = isAI ? parseInt(mode.replace('ai', ''), 10) : 1;
      const name = (names[i] || '').trim();
      return {charKey: CHARS[ci].key, name: name || undefined, isAI, aiLevel};
    });
    const yearsSel = document.getElementById('roster-years-select').value;
    const totalYears = yearsSel === 'custom'
      ? (parseInt(document.getElementById('roster-years-custom').value, 10) || 5)
      : parseInt(yearsSel, 10);
    const quickWinTarget = (quickWinToggle && quickWinToggle.checked)
      ? (parseInt(quickWinInput.value, 10) || 500)
      : null;
    pendingStart = {config, totalYears, quickWinTarget};
    document.getElementById('roster').style.display = 'none';
    showSaveSlots('assign');
  };

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
        <span class="cfg-assets-money">💰${pl.money} 萬</span>`;
      box.appendChild(div);
      const stallsEl = document.createElement('div');
      stallsEl.className = 'cfg-assets-stalls';
      stallsEl.textContent = stationNames.length ? '置產：' + stationNames.join('、') : '尚無置產';
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
    document.getElementById('save-detail').style.display = 'none';
    document.getElementById('save-slots').style.display = 'flex';
    UI.focusOverlayFirst();
  }

  function startPendingGame(slot) {
    document.getElementById('save-slots').style.display = 'none';
    const {config, totalYears, quickWinTarget} = pendingStart;
    Game.start(config.length, config, totalYears, quickWinTarget);
    Game.saveSlot = slot;
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
      showSaveDetail(slot, data);
    }
  }

  // 存檔詳細畫面：每位成員的資產、進度，以及在台灣哪些地方置產（查詢用，不用進遊戲就能看）
  function showSaveDetail(slot, data) {
    document.getElementById('sd-title').textContent = `檔案 ${slot}`;
    document.getElementById('sd-meta').textContent = `${data.players.length} 人對戰・第 ${data.year}／${data.totalYears} 年`;
    const box = document.getElementById('sd-players');
    box.innerHTML = '';
    data.players.forEach(p => {
      const c = CHARS.find(ch => ch.key === p.charKey) || CHARS[0];
      const stationNames = (p.stalls || []).map(s => {
        const st = Data.stations.get(s.station);
        return st ? `${st.name}・${s.name}` : s.name;
      });
      const div = document.createElement('div');
      div.className = 'sd-player';
      div.innerHTML = `
        <div class="sd-player-head">
          <img src="${c.avatar}" alt="">
          <b>${p.name}</b>
          <select class="sd-player-mode" aria-label="${p.name} 的玩家類型">
            <option value="human"${p.isAI ? '' : ' selected'}>真人</option>
            <option value="ai"${p.isAI ? ' selected' : ''}>電腦</option>
          </select>
          <span class="sd-player-money">💰${p.money} 萬</span>
        </div>
        <div class="sd-player-stalls">${stationNames.length ? '置產：' + stationNames.join('、') : '尚無置產'}</div>
      `;
      div.querySelector('.sd-player-mode').addEventListener('change', event => {
        p.isAI = event.target.value === 'ai';
        if (p.isAI && !p.aiLevel) p.aiLevel = 1;
        SaveSystem.write(slot, data);
        UI.toast(`${p.name} 已設為${p.isAI ? '電腦' : '真人'}`);
      });
      box.appendChild(div);
    });
    document.getElementById('sd-load').onclick = () => {
      document.getElementById('save-detail').style.display = 'none';
      document.getElementById('setup').style.display = 'none';
      document.getElementById('roster').style.display = 'none';
      document.getElementById('splash').style.display = 'none';
      Game.loadState(data, slot);
    };
    document.getElementById('sd-delete').onclick = () => {
      showConfirm(`確定刪除檔案 ${slot} 嗎？`, () => {
        SaveSystem.remove(slot);
        showSaveSlots('load');
      });
    };
    document.getElementById('sd-back').onclick = () => showSaveSlots('load');
    document.getElementById('save-slots').style.display = 'none';
    document.getElementById('save-detail').style.display = 'flex';
    // 這個畫面 DOM 順序是「各玩家真人/電腦選單」在前、「讀取這個存檔」在後，
    // 用通用的 focusOverlayFirst() 會先選到選單，玩家還要多按方向鍵才能到讀取鈕；
    // 這裡幾乎每次都是要讀檔，直接把預設焦點指定在讀取鈕上，方向鍵仍可切到選單。
    document.getElementById('sd-load').focus();
  }

  document.getElementById('save-slots-back').onclick = () => {
    document.getElementById('save-slots').style.display = 'none';
    // 從人數選擇畫面直接點「讀取存檔」進來的話，退回去要把那個畫面叫回來；
    // 不然 #setup 一直留在背景「display:flex」，方向鍵導覽會連背景那些按鈕也一起選到
    if (saveMode === 'load') {
      document.getElementById('setup').style.display = 'flex';
      setupIndex = 0; updateSetupSelection();
    }
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
    document.getElementById('setup').style.display = 'flex';
    setupIndex = 0; updateSetupSelection();
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

  // 遊戲進行中按 B 結束遊戲時，會存一個旗標後整頁重新載入（沿用「重新開始」按鈕已經在用的整頁
  // reload 模式，最省事乾淨地重置所有遊戲狀態），這裡偵測到旗標就跳過片頭序章直接進選人數畫面。
  if (sessionStorage.getItem('xqmt_skip_intro') === '1') {
    sessionStorage.removeItem('xqmt_skip_intro');
    splash.style.display = 'none';
    document.getElementById('setup').style.display = 'flex';
    setupIndex = 0; updateSetupSelection();
    BGM.play('setup');
  } else {
    armSplash();
  }
});
