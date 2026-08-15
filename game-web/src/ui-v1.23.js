// ────────────────────────────────────────────────
//  ui.js — HUD、岔路箭頭、小地圖、提示
// ────────────────────────────────────────────────
const MONTH_NAME = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
// 目前已完成的月份插畫（12 個月全部補齊了，沒有圖時只顯示字幕不顯示背景圖）
const MONTH_IMG_AVAILABLE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// 到站演出的列車圖：依 pl.train（本回合實際使用的車型）切換，皆為原圖去背、不套用玩家顏色。
// tw/tto/tb/tdur 對應 #dc-train 的 CSS 變數（寬度／停靠 right／底部／進站秒數）；
// 數值取自「目的地慶祝動畫模擬-設定參數.txt」，是在模擬器裡針對每款車個別微調後匯出的結果。
const TRAIN_ARRIVAL_PROFILES = {
  local:     { src:'../圖片/玩家icon/蒸氣火車頭（慢車）-去背.png', tw:120, tto:-50, tb:-15,  tdur:6   },
  express:   { src:'../圖片/玩家icon/通勤電車（區間車）.png',       tw:150, tto:-80, tb:-90,  tdur:4.7 },
  tzechiang: { src:'../圖片/玩家icon/普悠瑪（自強號）.png',         tw:165, tto:-95, tb:-115, tdur:3.8 },
  hsr:       { src:'../圖片/玩家icon/台灣高鐵-去背.png',             tw:150, tto:-75, tb:-15,  tdur:2.9 },
};
const DEST_CHEER_STOP_DELAY = 3650;   // 跟「按 A 揭曉下一站」提示同時消音，同模擬器 PROMPT_DELAY

const UI = {
  mini: null, miniCtx: null, miniBase: null,

  init() {
    document.getElementById('btn-roll').onclick = () => Game.roll();
    document.getElementById('btn-reachable').onclick = () => Game.toggleReachableRoutes();
    document.getElementById('btn-cards').onclick = () => this.showCardHand();
    document.getElementById('btn-zoom').onclick = () => Render.toggleZoom();
    const muteBtn = document.getElementById('btn-mute');
    muteBtn.onclick = () => { const muted = BGM.toggleMute(); SFX.muted = muted; muteBtn.textContent = muted ? '🔇' : '🔊'; };
    const ARROW_ANG = {ArrowRight: 0, ArrowDown: Math.PI/2, ArrowLeft: Math.PI, ArrowUp: -Math.PI/2};
    // 非骰子流程的確認鍵在觸發後必須先放開，避免鍵盤連發穿透到下一個畫面／下一回合。
    addEventListener('keyup', e => {
      if (this._confirmKeyLock === e.code) this._confirmKeyLock = null;
    });
    addEventListener('blur', () => { this._confirmKeyLock = null; });
    // 統一輸入層：全部遊戲快捷鍵（方向鍵、A確定、B返回、X卡片、Y可到達站點、Z縮放、P設定、M靜音、C卡片）
    // 都在「文件捕捉階段」（第三參數 true）處理，比任何畫面元件自己的鍵盤預設行為都早一步搶到——
    // 這是遊戲／手把應用程式常見的正規做法：自己的輸入層要在事件一進來就整個接管，不能靠瀏覽器的
    // 事件冒泡順序或元件目前有沒有 focus 這類不可靠的細節。手把在 input.js 是合成（untrusted）鍵盤事件，
    // 瀏覽器本來就不會對它跑任何原生預設行為，只有「真人鍵盤」才會遇到某些瀏覽器（尤其 Safari）
    // 對已經 focus 的按鈕/選單元件有自己的一套鍵盤預設處理、可能搶在我們自己的邏輯前面。
    // 以前只有 X／Y 兩顆鍵用這個方式搶最前面處理，這裡把其餘按鍵也一起搬進來，鍵盤和手把才會
    // 保證是完全一致的行為。唯一例外：焦點在真正的文字輸入欄位時完全不介入，讓使用者能正常打字
    // （下面 isTextEntry 只排除「自由輸入文字」的欄位，不含 number/select，那些游標鍵已經有自訂處理）。
    document.addEventListener('keydown', e => {
      const active = document.activeElement;
      const isTextEntry = active && (active.isContentEditable ||
        active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && active.type !== 'number'));
      if (isTextEntry) return;   // 改名之類的真文字欄位交給瀏覽器自己處理，不搶鍵

      const code = e.code || '';
      const isY = code === 'KeyY' || e.key === 'y' || e.key === 'Y';
      const isX = code === 'KeyX' || e.key === 'x' || e.key === 'X';
      if (isY && Game.state === 'awaitBranch') {
        e.preventDefault();
        Game.toggleReachableRoutes();
        if (this._diceAwaiting) this.dismissDiceAfterKey(null);
        return;
      }
      if (isX && Game.state === 'awaitRoll') {
        const pl = Game.curPlayer();
        if (pl && !pl.isAI) { e.preventDefault(); this.showCardHand(); return; }
      }

      const isConfirmKey = e.code === 'Space' || e.key === ' ' || e.key === 'a' || e.key === 'A';
      const isBackKey = e.key === 'b' || e.key === 'B';
      const isReachKey = e.key === 'y' || e.key === 'Y';

      // 骰子結算畫面停留到玩家按鍵。此鍵先讓骰子在 0.5 秒內淡出、開啟移動流程，
      // 再重送同一個鍵給下方既有處理器，例如方向鍵可立刻選擇岔路，絕不被吃掉。
      if (this._diceAwaiting && isReachKey && Game.state === 'awaitBranch') {
        // 先切換可到達站點，再讓骰子淡出；避免淡出期間的狀態改變使 Y 被忽略。
        e.preventDefault(); Game.toggleReachableRoutes(); this.dismissDiceAfterKey(null); return;
      }
      if (this._diceAwaiting && this.dismissDiceAfterKey(e)) return;

      // 骰子以外的演出／面板按鍵不可穿透；同一顆仍被按住的鍵盤連發一律忽略到 keyup。
      if (this._confirmKeyLock === e.code) { e.preventDefault(); return; }

      // 抵達目的地的慶祝演出是強制流程：第一次揭曉下一目的地，第二次才回到本站事件。
      const destinationOverlay = document.getElementById('destination-celebration');
      if (destinationOverlay && destinationOverlay.style.display === 'flex') {
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.revealNextDestination(); }
        return;
      }

      const annualOverlay = document.getElementById('annual-settlement');
      if (annualOverlay && annualOverlay.style.display === 'flex') {
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.advanceAnnualSettlement(); }
        return;
      }

      const cardDraw = document.getElementById('card-draw');
      if (cardDraw && cardDraw.style.display === 'flex') {
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); Game.revealYellowCard(); }
        return;
      }

      // 黃格抽到卡但手牌已經滿了：跳出強制丟卡面板，跟變賣物產一樣沒有「取消」，
      // 一定要丟一張才能繼續，B 鍵故意不處理。
      if (document.getElementById('card-discard').style.display === 'flex') {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.moveOverlayFocus(-1); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.moveOverlayFocus(1); return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.activateOverlayItem(document.activeElement || this.focusOverlayFirst()); return; }
        return;
      }

      // 物產購買面板開著時：方向鍵在「全選／各品項／確定／不買」之間移動 focus，
      // 確定鍵＝對目前 focus 的項目按一下（checkbox 勾選、按鈕觸發），B 鍵＝不買，跳出面板
      if (document.getElementById('stall-shop').style.display === 'flex') {
        if (e.key === 'ArrowUp')   { e.preventDefault(); this._ssMoveFocus(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this._ssMoveFocus(1);  return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); document.activeElement && document.activeElement.click(); return; }
        if (isBackKey)    { e.preventDefault(); document.getElementById('ss-skip').click(); return; }
        return;   // 面板開著時，其他鍵（擲骰、捲動、縮放）先不處理，避免同時觸發
      }

      // 強制變賣物產面板開著時：方向鍵在各品項／確定鈕之間移動 focus，確定鍵勾選/送出；
      // 這個面板沒有「取消」——B 鍵故意不處理，債務沒解決前不能跳出去
      if (document.getElementById('debt-sale').style.display === 'flex') {
        if (e.key === 'ArrowUp')   { e.preventDefault(); this._dsMoveFocus(-1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this._dsMoveFocus(1);  return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); document.activeElement && document.activeElement.click(); return; }
        return;
      }

      // 卡片商店改成 3 欄格狀排列（橫向手機畫面塞得下），方向鍵要照畫面實際位置找最近的卡片，
      // 不能再用「±1」線性順序（欄位一多，線性順序的「下一個」在畫面上常常不是正下方那張）。
      if (document.getElementById('card-shop').style.display === 'flex') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.moveGridFocus(-1, 0); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.moveGridFocus(1, 0); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.moveGridFocus(0, -1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.moveGridFocus(0, 1); return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.activateOverlayItem(document.activeElement || this.focusOverlayFirst()); return; }
        if (isBackKey) { e.preventDefault(); Game.leaveCardShop(); return; }
        return;
      }

      // 指定骰的 1~6 是 3 欄格狀排列（跟卡片商店一樣），方向鍵也要照畫面實際位置走，
      // 不然在「3」按下鍵會跑到 DOM 順序的下一顆「4」，而不是視覺上正下方的「6」。
      if (document.getElementById('card-dice').style.display === 'flex') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.moveGridFocus(-1, 0); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.moveGridFocus(1, 0); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.moveGridFocus(0, -1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.moveGridFocus(0, 1); return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.activateOverlayItem(document.activeElement || this.focusOverlayFirst()); return; }
        if (isBackKey) { e.preventDefault(); this.hideDicePicker(); this.showCardHand(); return; }
        return;
      }

      if (document.getElementById('card-hand').style.display === 'flex' || document.getElementById('card-targets').style.display === 'flex') {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.moveOverlayFocus(-1); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.moveOverlayFocus(1); return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.activateOverlayItem(document.activeElement || this.focusOverlayFirst()); return; }
        if (isBackKey) {
          e.preventDefault();
          this.hideCardHand(); this.hideCardTargets(); this.hideDicePicker();
          return;
        }
        return;
      }

      // 探路唯讀資訊視窗開著：只有一個「關閉」鈕，確定鍵（空白鍵／A）跟 B 鍵都能關閉，
      // 不用另外做方向鍵導覽（只有一個按鈕，導覽了也只能選到它）
      if (document.getElementById('scout-info').style.display === 'flex') {
        if (isBackKey || isConfirmKey) { e.preventDefault(); if (isConfirmKey) this.lockConfirmKey(e); this.hideScoutInfo(); }
        return;
      }

      // 測試模式：焦點在下拉選單上時，方向鍵上／下直接改 selectedIndex 並送出 change 事件，
      // 手把跟鍵盤都能用（不靠瀏覽器原生彈出視窗，那個視窗只認真的鍵盤/滑鼠，手把合成事件
      // 進不去）。確定鍵維持叫出 showPicker()，方便測試人員用滑鼠/鍵盤直接看到完整清單；
      // 沒有跨瀏覽器可靠的「關閉」API，這裡用 blur()+下一個畫面幀重新 focus() 這個變通做法
      // 讓已經打開的原生選單收起來，同時焦點留在原本的下拉選單上，不會跳到別的地方。
      // 用 _testPickerOpen 記住「現在這個是不是剛被我們自己打開」，同一顆確定鍵按兩下＝開了再關。
      if (document.getElementById('test-mode').style.display === 'flex') {
        const active = document.activeElement;
        if (active && active.tagName === 'SELECT') {
          if (e.key === 'ArrowLeft') { e.preventDefault(); this._testPickerOpen = null; this.moveOverlayFocus(-1); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); this._testPickerOpen = null; this.moveOverlayFocus(1); return; }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            this._testPickerOpen = null;
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            const n = active.options.length;
            if (n) active.selectedIndex = (active.selectedIndex + dir + n) % n;
            active.dispatchEvent(new Event('change', {bubbles:true}));
            return;
          }
          if (isConfirmKey) {
            e.preventDefault(); this.lockConfirmKey(e);
            if (this._testPickerOpen === active) {
              this._testPickerOpen = null;
              active.blur();
              // 用 setTimeout 不用 requestAnimationFrame：分頁切到背景時 rAF 不會執行，
              // focus 就永遠恢復不了，setTimeout 不受分頁是否在前景影響。
              setTimeout(() => active.focus(), 0);
            } else if (active.showPicker) {
              this._testPickerOpen = active;
              try { active.showPicker(); } catch (_) {}
            }
            return;
          }
          if (isBackKey) { e.preventDefault(); this._testPickerOpen = null; this.hideTestMode(); return; }
          return;
        }
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.moveGridFocus(-1, 0); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.moveGridFocus(1, 0); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.moveGridFocus(0, -1); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.moveGridFocus(0, 1); return; }
        if (isConfirmKey) { e.preventDefault(); this.lockConfirmKey(e); this.activateOverlayItem(document.activeElement || this.focusOverlayFirst()); return; }
        if (isBackKey) { e.preventDefault(); this.hideTestMode(); return; }
        return;
      }

      // 其他選單／視窗開著時，B 鍵＝按下它自己的取消／返回鈕
      if (isBackKey) {
        const overlays = [
          ['settings-menu', 'cfg-close'],
          ['save-detail', 'sd-back'],
          ['save-slots', 'save-slots-back'],
          ['extend-years', 'ey-cancel'],
          ['confirm-modal', 'cm-cancel'],
        ];
        const hit = overlays.find(([panelId]) => document.getElementById(panelId).style.display === 'flex');
        // 一定要擋掉這顆鍵繼續傳給下一個監聽器——例如按下「返回」把 #setup 從背景叫回來後，
        // 同一次事件還沒結束，選人數畫面自己的監聽器接著也會處理到，一看 #setup 變成 flex，
        // 又把目前選到的按鈕（例如「2人對戰」）點下去，變成直接跳進下一個畫面。
        if (hit) { e.preventDefault(); e.stopImmediatePropagation(); document.getElementById(hit[1]).click(); return; }
        // 沒有選單開著，但探路放大鏡游標還在：B 鍵收起游標，鏡頭回到列車
        if (Render.scoutStation) {
          e.preventDefault();
          Render.scoutStation = null;
          Render.resetToTrain();
          return;
        }
        // 可到達站點圈選開著時，B 鍵跟 Y 鍵一樣是「收起圈選、回到岔路畫面」，不是結束遊戲——
        // 這個檢查一定要放在下面「跳出結束遊戲確認視窗」之前，不然 B 鍵永遠會被那邊先接住。
        if (Game.reachableMode) {
          e.preventDefault();
          Game.toggleReachableRoutes();
          return;
        }
        // 上面全部都沒中：真的是遊戲進行中單純按 B，跳出「結束遊戲」確認視窗，
        // 避免手滑一按就把整局進度弄丟（gameover 畫面自己有重新開始鈕，不要重複跳這個）。
        // 用「有沒有玩家」判斷是不是真的在玩，不能看 #game 的 display（那個 CSS 預設就是
        // display:block，背景一直在，選人數／設定角色畫面只是疊在上面蓋住而已），也不能只看
        // Game.state 真假——那個屬性預設值是字串 'setup'，開局前也一樣是 truthy。
        if (Game.players.length && Game.state !== 'gameover') {
          e.preventDefault(); e.stopImmediatePropagation();
          window.showConfirm('要結束遊戲嗎？三月結算後到目前的遊戲進度不會儲存', () => {
            Game.quitToSetup();
          });
          return;
        }
      }

      // 上面這些選單（設定／存檔／變更年數／確認視窗／遊戲結束）開著時，其餘按鍵（擲骰、探路、縮放）先不處理
      const menuOpen = ['settings-menu', 'save-slots', 'save-detail', 'extend-years', 'confirm-modal', 'gameover']
        .some(id => document.getElementById(id).style.display === 'flex');
      if (menuOpen) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.moveOverlayFocus(-1); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.moveOverlayFocus(1); return; }
        // 同上：確定鍵點下去的按鈕（例如存檔匣列表的「返回」）可能會讓 #setup 這類背景畫面重新出現，
        // 一定要擋掉這次事件繼續傳下去，不然背景畫面自己的監聽器會接著誤觸發一次。
        if (isConfirmKey) { e.preventDefault(); e.stopImmediatePropagation(); this.lockConfirmKey(e); this.activateOverlayItem(document.activeElement || this.focusOverlayFirst()); }
        return;
      }

      // 擲骰後按 Y：標示剛好可消耗完骰子點數的站點；方向鍵選一站後自動沿算出的路線前往。
      if (isReachKey && Game.state === 'awaitBranch') {
        e.preventDefault(); Game.toggleReachableRoutes(); return;
      }
      if (Game.reachableMode && e.key in ARROW_ANG) {
        e.preventDefault(); Game.selectReachableDirection(e.key); return;
      }
      if (Game.reachableMode && isConfirmKey) {
        e.preventDefault(); Game.confirmReachableStation(); return;
      }

      // 探路放大鏡游標開著時，確定鍵＝查看目前對到的站點物產（唯讀，不能在這裡購買）
      if (Render.scoutStation && isConfirmKey) {
        e.preventDefault();
        this.lockConfirmKey(e);
        this.showScoutInfo(Render.scoutStation);
        return;
      }

      if (isConfirmKey) { e.preventDefault(); Game.roll(); }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (!document.getElementById('btn-cards').disabled) this.showCardHand(); }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); document.getElementById('btn-settings').click(); }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); document.getElementById('btn-mute').click(); }
      if (e.key === 'z') Render.toggleZoom();

      // 岔路選單開著時，方向鍵直接選對應方向（角度最接近的那顆按鈕）
      if (Game.state === 'awaitBranch' && e.key in ARROW_ANG) {
        e.preventDefault();
        const want = ARROW_ANG[e.key];
        let best = null, bestDiff = Infinity;
        document.querySelectorAll('.branch-btn').forEach(btn => {
          const ang = parseFloat(btn.dataset.ang);
          const diff = Math.abs(Math.atan2(Math.sin(ang - want), Math.cos(ang - want)));
          if (diff < bestDiff) { bestDiff = diff; best = btn; }
        });
        if (best && bestDiff < 0.3) best.click();
      }

      // 擲骰前（awaitRoll）方向鍵＝移動探路放大鏡游標（找該方向最近的站點，不管路網連不連通）
      if (Game.state === 'awaitRoll' && e.key in ARROW_ANG) {
        e.preventDefault();
        const pl = Game.curPlayer();
        const from = Render.scoutStation || pl.pos;
        const next = Board.nearestInDirection(from, e.key) || from;
        Render.scoutStation = next;
        const st = Data.stations.get(next);
        Render.jumpTo(st.x, st.y);
      }
    }, true);
    this.mini = document.getElementById('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.buildMiniBase();
    Render.onFrame = () => this.drawMini();

    // 點小地圖：鏡頭跳去該處看，可拖曳大地圖自由瀏覽
    this.mini.style.cursor = 'pointer';
    this.mini.addEventListener('click', e => {
      const rect = this.mini.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (this.mini.width / rect.width);
      const py = (e.clientY - rect.top) * (this.mini.height / rect.height);
      const w = Data.world, s = this._miniScale;
      Render.jumpTo(px / s + w.x, py / s + w.y, Render.ZOOM_LOOK);
    });
  },

  lockConfirmKey(event) { this._confirmKeyLock = event.code; },
  overlayControls() {
    return Array.from(document.querySelectorAll('[style*="display: flex"] button:not(:disabled), [style*="display: flex"] input:not(:disabled), [style*="display: flex"] select:not(:disabled)'))
      .filter(el => el.offsetParent !== null);
  },
  focusOverlayFirst() { const el = this.overlayControls()[0]; if (el) el.focus(); return el; },
  moveOverlayFocus(delta) {
    const items = this.overlayControls(); if (!items.length) return;
    let i = items.indexOf(document.activeElement); i = i < 0 ? 0 : (i + delta + items.length) % items.length;
    items[i].focus();
  },
  // 格狀排列（例如卡片商店）方向鍵導覽：不是按 DOM 順序 ±1，是照畫面上實際位置找同一排/同一欄
  // 裡最近的下一個項目——欄數一多，標題（購買卡片／賣出卡片）又會讓格線換行、破壞整齊的欄數，
  // 用幾何位置找最近的比硬算「第幾欄」可靠。
  moveGridFocus(dx, dy) {
    const items = this.overlayControls(); if (!items.length) return;
    const cur = document.activeElement;
    if (!items.includes(cur)) { items[0].focus(); return; }
    const r0 = cur.getBoundingClientRect();
    const cx0 = r0.left + r0.width / 2, cy0 = r0.top + r0.height / 2;
    let best = null, bestScore = Infinity;
    items.forEach(el => {
      if (el === cur) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ddx = cx - cx0, ddy = cy - cy0;
      if (dx !== 0 && ddx * dx <= 0) return;   // 只找移動方向那一側的項目
      if (dy !== 0 && ddy * dy <= 0) return;
      const primary = Math.abs(dx !== 0 ? ddx : ddy);
      const cross = Math.abs(dx !== 0 ? ddy : ddx);
      const score = primary + cross * 3;   // 同排/同欄（另一軸偏差小）優先，位移小的次之
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) best.focus();
  },
  // 確定鍵作用在目前 focus 的項目上：<select>（例如存檔詳細頁的「真人／電腦」）用循環切換選項，
  // 不能用 .click()——那只會呼叫瀏覽器原生下拉選單，鍵盤／手把沒辦法繼續操作
  activateOverlayItem(el) {
    if (!el) return;
    if (el.tagName === 'SELECT') {
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('change', {bubbles:true}));
    } else {
      el.click();
    }
  },

  update() {
    const pl = Game.curPlayer && Game.players.length ? Game.curPlayer() : null;
    document.getElementById('calendar').textContent = `第 ${Game.year} 年　${Game.month} 月`;
    const rollEl = document.getElementById('roll-info');
    if (Game.state === 'moving' || Game.state === 'awaitBranch') {
      rollEl.textContent = `🎲 骰出：${Game.dice}　剩餘步數：${Game.stepsLeft}`;
      rollEl.style.display = '';
    } else {
      rollEl.style.display = 'none';
    }
    const destEl = document.getElementById('destination');
    if (Game.destination) {
      const dst = Data.stations.get(Game.destination);
      const d = (Game.destDist && pl && pl.pos) ? Game.destDist.get(pl.pos) : undefined;
      destEl.textContent = `🚩 目的地：${dst.name}${d !== undefined ? `（${d}）` : ''}`;
      destEl.style.display = '';
    } else {
      destEl.style.display = 'none';
    }
    // HUD 只顯示「輪到的那位玩家」，頭像跟字都放大，其他玩家的資訊不顯示
    const list = document.getElementById('players');
    list.innerHTML = '';
    if (pl) {
      const st = pl.pos ? Data.stations.get(pl.pos) : null;
      const loc = !st ? '出發中…' : (Data.isTile(pl.pos) ? '格子上' : st.name);
      const avatarImg = pl.avatar ? `<img class="avatar-cur" src="${pl.avatar}" alt="">` : `<span class="dot-cur" style="background:${pl.color}"></span>`;
      const div = document.createElement('div');
      div.className = 'p-row-cur';
      div.innerHTML = `${avatarImg}
        <div class="p-cur-info">
          <div class="p-cur-name"><b>${pl.name}</b>${pl.isAI ? '<span class="ai-tag">電腦</span>' : ''}</div>
          <div class="p-cur-money${pl.money < 0 ? ' debt' : ''}">💰${formatMoney(pl.money)}</div>
          <div class="p-cur-loc">${loc}　🃏${(pl.cards || []).length}/${CARD_HAND_LIMIT}</div>
        </div>`;
      list.appendChild(div);
    }
    const btn = document.getElementById('btn-roll');
    btn.disabled = Game.state !== 'awaitRoll';
    btn.textContent = Game.state === 'awaitRoll' && pl ? `🎲 ${pl.name} 擲骰` : '🎲 擲骰';
    const cardBtn = document.getElementById('btn-cards');
    cardBtn.disabled = Game.state !== 'awaitRoll' || !pl || pl.isAI;
    cardBtn.textContent = pl ? `🃏 卡片 ${(pl.cards || []).length}` : '🃏 卡片';
    const reachableBtn = document.getElementById('btn-reachable');
    const canReach = Game.state === 'awaitBranch' && pl && !pl.isAI;
    reachableBtn.style.display = canReach ? '' : 'none';
    reachableBtn.classList.toggle('active', !!Game.reachableMode);
    reachableBtn.textContent = Game.reachableMode ? 'Y　關閉可到站' : 'Y　可到達';
  },

  showCardHand() {
    const pl = Game.curPlayer();
    if (!pl || Game.state !== 'awaitRoll' || pl.isAI) return;
    document.getElementById('card-hand-title').textContent = `${pl.name} 的卡片　${pl.cards.length}/${CARD_HAND_LIMIT}`;
    document.getElementById('card-hand-note').textContent = pl.cardUsedThisTurn ? '本回合已使用過卡片。' : '本回合可使用 1 張卡片。';
    const list = document.getElementById('card-hand-list'); list.innerHTML = '';
    pl.cards.forEach((entry, index) => {
      const c = Game.cardOf(entry); if (!c) return;
      const left = Game.cardUsesLeft(entry);
      const b = document.createElement('button');
      b.className = `card-item card-${c.type}`; b.disabled = pl.cardUsedThisTurn;
      // 週遊券這類多次卡在名稱後面標「剩 N 次」，玩家才知道還能用幾次
      b.innerHTML = `<span>${c.icon}</span><b>${c.name}${left != null ? `　<em class="card-uses">剩 ${left} 次</em>` : ''}</b><small>${c.text}</small>`;
      b.onclick = () => Game.useCard(index); list.appendChild(b);
    });
    document.getElementById('card-hand').style.display = 'flex';
    this.focusOverlayFirst();   // 一開面板就把焦點移進去，確定鍵才不會誤觸發面板外的舊焦點
  },
  hideCardHand() { document.getElementById('card-hand').style.display = 'none'; },

  showCardShop(pl, st) {
    if (st) Game._cardShopStation = st.id;
    const shop = st || Data.stations.get(Game._cardShopStation);
    document.getElementById('card-shop-title').textContent = `🃏 卡片商店　${pl.name}：${formatMoney(pl.money)}元　${pl.cards.length}/${CARD_HAND_LIMIT}`;
    const list = document.getElementById('card-shop-list'); list.innerHTML = '<h4>購買卡片</h4>';
    Game.cardShopItems(shop).forEach(item => {
      const c = CARD_BY_ID[item.id]; if (!c) return;
      const b = document.createElement('button'); b.className = `card-item card-${c.type}`;
      b.disabled = pl.money < item.price || pl.cards.length >= CARD_HAND_LIMIT;
      b.innerHTML = `<span>${c.icon}</span><b>${c.name}　${formatMoney(item.price)}</b><small>${c.text}</small>`;
      b.onclick = () => Game.buyCard(c.id); list.appendChild(b);
    });
    list.insertAdjacentHTML('beforeend', '<h4>賣出卡片（售價 8 折；週遊券按剩餘次數折算）</h4>');
    if (!pl.cards.length) list.insertAdjacentHTML('beforeend', '<p class="card-empty">目前沒有可賣出的卡片。</p>');
    pl.cards.forEach((entry, index) => {
      const c = Game.cardOf(entry); if (!c) return;
      const left = Game.cardUsesLeft(entry);
      const item = Game.cardShopItems(shop).find(x => x.id === c.id);
      let sell = Math.floor((item ? item.price : c.price || 0) * .8);
      if (left != null && c.uses) sell = Math.max(1, Math.floor(sell * left / c.uses));   // 跟 Game.sellCard 同一套折算
      const b = document.createElement('button'); b.className = `card-item card-${c.type}`;
      b.innerHTML = `<span>${c.icon}</span><b>賣出 ${c.name}${left != null ? `（剩 ${left} 次）` : ''}　+${formatMoney(sell)}</b><small>${c.text}</small>`;
      b.onclick = () => Game.sellCard(index); list.appendChild(b);
    });
    document.getElementById('card-shop').style.display = 'flex';
    this.focusOverlayFirst();
  },
  hideCardShop() { document.getElementById('card-shop').style.display = 'none'; },

  // 測試模式：縣市→鄉鎮區→站點三層下拉篩選（只列有填城市的「真站點」，
  // 藍/紅/黃格這類沒有城市的一般格子不列進來，不然清單會多出上千個沒意義的選項），
  // 加上全部卡片目錄可以免費加入手牌（含大逆轉牌等平常商店買不到的卡）。
  showTestMode() {
    const pl = Game.curPlayer();
    if (!pl) return;
    this._testStations = Array.from(Data.stations.values()).filter(s => s.city);
    const citySel = document.getElementById('test-city');
    const cities = Array.from(new Set(this._testStations.map(s => s.city))).sort();
    citySel.innerHTML = cities.map(c => `<option value="${c}">${c}</option>`).join('');
    this.refreshTestDistricts();
    const list = document.getElementById('test-card-list'); list.innerHTML = '';
    CARD_CATALOG.forEach(c => {
      const b = document.createElement('button'); b.className = `card-item card-${c.type}`;
      b.innerHTML = `<span>${c.icon}</span><b>${c.name}</b><small>${c.text}</small>`;
      b.onclick = () => Game.testAddCard(c.id);
      list.appendChild(b);
    });
    document.getElementById('test-mode').style.display = 'flex';
    this.focusOverlayFirst();
  },
  hideTestMode() { document.getElementById('test-mode').style.display = 'none'; },
  refreshTestDistricts() {
    const city = document.getElementById('test-city').value;
    const districts = Array.from(new Set(this._testStations.filter(s => s.city === city).map(s => s.district))).sort();
    document.getElementById('test-district').innerHTML = districts.map(d => `<option value="${d}">${d}</option>`).join('');
    this.refreshTestStations();
  },
  refreshTestStations() {
    const city = document.getElementById('test-city').value, district = document.getElementById('test-district').value;
    const stations = this._testStations.filter(s => s.city === city && s.district === district);
    document.getElementById('test-station').innerHTML = stations.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  },

  showCardDraw(pl) {
    if (!document.getElementById('card-draw')) { setTimeout(() => Game.revealYellowCard(), 0); return; }
    document.getElementById('card-draw-title').textContent = `🟡 ${pl.name} 抵達黃格！`;
    document.getElementById('card-draw-result').textContent = '按 A 或空白鍵，翻開一張卡片';
    document.getElementById('card-draw').style.display = 'flex';
  },
  revealCardDraw(card, pl) {
    const result = document.getElementById('card-draw-result');
    if (result) result.textContent = card ? `${pl.name} 抽到「${card.name}」！` : `${pl.name} 的卡片已滿，無法抽取。`;
  },
  hideCardDraw() { const el = document.getElementById('card-draw'); if (el) el.style.display = 'none'; },

  // 黃格抽到卡但手牌已經滿了：列出目前所有卡片（含剛抽到那張），選一張丟掉才能繼續
  showCardDiscard(pl) {
    document.getElementById('card-discard-title').textContent = `🃏 ${pl.name} 的卡片已滿，選一張丟掉`;
    const list = document.getElementById('card-discard-list'); list.innerHTML = '';
    pl.cards.forEach((entry, index) => {
      const c = Game.cardOf(entry); if (!c) return;
      const left = Game.cardUsesLeft(entry);
      const b = document.createElement('button');
      b.className = `card-item card-${c.type}`;
      b.innerHTML = `<span>${c.icon}</span><b>${c.name}${left != null ? `　<em class="card-uses">剩 ${left} 次</em>` : ''}</b><small>${c.text}</small>`;
      b.onclick = () => Game.discardCard(index); list.appendChild(b);
    });
    document.getElementById('card-discard').style.display = 'flex';
    this.focusOverlayFirst();
  },
  hideCardDiscard() { document.getElementById('card-discard').style.display = 'none'; },

  showCardTargets(card, targets, handIndex) {
    document.getElementById('card-target-title').textContent = `${card.icon} ${card.name}：選擇目標`;
    const list = document.getElementById('card-target-list'); list.innerHTML = '';
    targets.forEach(({p, i}) => {
      const b = document.createElement('button'); b.className = 'card-target-btn';
      b.textContent = `${p.name}　💰${formatMoney(p.money)}${p.shield ? '　🛡️防護中' : ''}`;
      b.onclick = () => Game.useCard(handIndex, i); list.appendChild(b);
    });
    document.getElementById('card-targets').style.display = 'flex';
    this.focusOverlayFirst();
  },
  hideCardTargets() { document.getElementById('card-targets').style.display = 'none'; },

  showDicePicker(card, handIndex) {
    const list = document.getElementById('card-dice-list'); list.innerHTML = '';
    document.getElementById('card-dice-title').textContent = `${card.icon} ${card.name}：選一個骰點`;
    for (let n=1; n<=6; n++) { const b=document.createElement('button'); b.className='dice-pick'; b.textContent=n; b.onclick=()=>Game.useCard(handIndex,n); list.appendChild(b); }
    document.getElementById('card-dice').style.display = 'flex';
    this.focusOverlayFirst();
  },
  hideDicePicker() { document.getElementById('card-dice').style.display = 'none'; },

  showCardFlash(icon, text) {
    const el = document.getElementById('card-flash');
    el.querySelector('.card-flash-icon').textContent = icon;
    el.querySelector('.card-flash-text').textContent = text;
    el.classList.remove('playing'); void el.offsetWidth; el.classList.add('playing');
    clearTimeout(this._cardFlashTimer); this._cardFlashTimer = setTimeout(() => el.classList.remove('playing'), 1550);
  },

  showDestinationCelebration(st, pl, bonus, done) {
    const overlay = document.getElementById('destination-celebration');
    // 舊版 HTML 沒有演出圖層時仍可繼續遊玩；正式 v0.73 會走下方完整動畫。
    if (!overlay) { done(Game.pickDestination(st.id)); return; }
    const train = document.getElementById('dc-train');
    clearTimeout(this._destPromptTimer); clearTimeout(this._destDoneTimer);
    this._destReady = false; this._destNextShown = false; this._destDone = done; this._destStationId = st.id;
    document.getElementById('dc-station-name').textContent = st.name;
    document.getElementById('dc-arrival-line').textContent = `${pl.name} 搶先抵達！獲得 ${formatMoney(bonus)}元`;
    document.getElementById('dc-next').classList.remove('show');
    document.getElementById('dc-prompt').classList.remove('show');
    const continuePrompt = document.getElementById('dc-continue');
    if (continuePrompt) continuePrompt.classList.remove('show');
    overlay.style.display = 'flex';
    const profile = TRAIN_ARRIVAL_PROFILES[pl.train] || TRAIN_ARRIVAL_PROFILES.local;
    train.src = profile.src;
    train.style.setProperty('--tw', profile.tw + '%');
    train.style.setProperty('--tto', profile.tto + '%');
    train.style.setProperty('--tb', profile.tb + '%');
    train.style.setProperty('--tdur', profile.tdur + 's');
    train.style.setProperty('--tfrom', (profile.tto - 175) + '%');
    // 先關掉 transition 並確實回到起點，下一個畫面幀才開回 transition 觸發滑入，
    // 避免同一張列車圖連續兩次到站時被瀏覽器合併成沒有動畫的瞬間跳動。
    cancelAnimationFrame(this._destTrainFrame);
    train.style.transition = 'none';
    train.classList.remove('arrive');
    void train.offsetWidth;
    this._destTrainFrame = requestAnimationFrame(() => {
      train.style.transition = '';
      void train.offsetWidth;
      this._destTrainFrame = requestAnimationFrame(() => train.classList.add('arrive'));
    });
    this._destPromptTimer = setTimeout(() => {
      this._destReady = true;
      document.getElementById('dc-prompt').classList.add('show');
    }, 3650);
    this.playDestinationCheer();
  },

  playDestinationCheer() {
    const cheer = document.getElementById('dc-cheer');
    if (!cheer) return;
    clearTimeout(this._destCheerStopTimer);
    if (SFX.muted) return;
    cheer.pause();
    cheer.currentTime = 0;
    cheer.volume = SFX.volume;
    cheer.play().catch(() => {});
    this._destCheerStopTimer = setTimeout(() => { cheer.pause(); cheer.currentTime = 0; }, DEST_CHEER_STOP_DELAY);
  },

  // 捷徑卡片：直升機從 pl 目前位置飛到 card.target 站，飛行邏輯跟「捷徑卡片直升機動畫模擬」
  // v0.9 同一套（起飛/巡航/降落三段縮放、鏡頭直接貼著飛機snap，不用補間），差別是：
  // 這裡不重畫假地圖，直接疊在正式棋盤 canvas 上，座標用 Render.worldToCss 換算；
  // 「使用卡片」的提示沿用既有的 UI.showCardFlash，不用另外做一套卡片看板。
  showShortcutFlight(pl, card, done) {
    const heli = document.getElementById('sf-heli');
    const sfx = document.getElementById('sf-heli-sfx');
    const dest = Data.stations.get(card.target);
    if (!heli || !dest) { done(); return; }
    const HELI_STILL = '../圖片/玩家icon/直升機-靜止.png', HELI_FLY = '../圖片/玩家icon/直升機-飛行.png';
    const origin = {x: pl.ax, y: pl.ay};
    cancelAnimationFrame(this._sfFrame);
    clearTimeout(this._sfTimer);
    if (sfx) { sfx.pause(); sfx.currentTime = 0; }
    const place = (x, y) => {
      const s = Render.worldToCss(x, y);
      heli.style.left = s.x + 'px';
      heli.style.top = s.y + 'px';
    };
    heli.src = HELI_STILL;
    heli.style.setProperty('--sf-dir', dest.x > origin.x ? -1 : 1);
    heli.style.setProperty('--sf-scale', 1);
    heli.classList.remove('fly');
    heli.classList.add('show');
    place(origin.x, origin.y);
    Render.freeLook = true;
    Render.cam.tx = Render.cam.x = origin.x;
    Render.cam.ty = Render.cam.y = origin.y;
    UI.showCardFlash(card.icon, `${pl.name} 使用「${card.name}」！${card.text}`);
    this._sfTimer = setTimeout(() => {
      heli.src = HELI_FLY;
      heli.classList.add('fly');
      if (sfx && !SFX.muted) { sfx.volume = SFX.volume; sfx.currentTime = 0; sfx.play().catch(() => {}); }
      const dist = Math.hypot(dest.x - origin.x, dest.y - origin.y);
      const duration = Math.max(2600, dist / 95 * 1000);
      const t0 = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / duration);
        const x = origin.x + (dest.x - origin.x) * t, y = origin.y + (dest.y - origin.y) * t;
        pl.ax = x; pl.ay = y;
        place(x, y);
        const scale = t < .15 ? 1 + .35 * (t / .15) : t > .82 ? 1 + .35 * ((1 - t) / .18) : 1.35;
        heli.style.setProperty('--sf-scale', Math.max(1, scale));
        Render.cam.x = Render.cam.tx = x;
        Render.cam.y = Render.cam.ty = y;
        if (t < 1) { this._sfFrame = requestAnimationFrame(tick); return; }
        heli.classList.remove('fly', 'show');
        heli.style.setProperty('--sf-scale', 1);
        if (sfx) { sfx.pause(); sfx.currentTime = 0; }
        Render.freeLook = false;
        Render.follow(dest.x, dest.y);
        done();
      };
      tick();
    }, 500);
  },

  revealNextDestination() {
    if (!this._destReady || !this._destDone) return;
    if (this._destNextShown) {
      const done = this._destDone;
      const nextId = this._destNextId;
      this._destDone = null;
      document.getElementById('destination-celebration').style.display = 'none';
      done(nextId);
      return;
    }
    this._destReady = false;
    const nextId = Game.pickDestination(this._destStationId);
    const next = Data.stations.get(nextId);
    document.getElementById('dc-prompt').classList.remove('show');
    document.getElementById('dc-next-name').textContent = next.name;
    document.getElementById('dc-next').classList.add('show');
    this._destNextId = nextId;
    this._destDoneTimer = setTimeout(() => {
      this._destNextShown = true;
      this._destReady = true;
      const continuePrompt = document.getElementById('dc-continue');
      if (continuePrompt) continuePrompt.classList.add('show');
    }, 500);
  },

  showAnnualSettlement(data, done) {
    const overlay = document.getElementById('annual-settlement');
    if (!overlay) { done(); return; }
    clearTimeout(this._annualResultTimer); clearTimeout(this._annualSpeechTimer);
    this._annualPhase = 'playing'; this._annualDone = done; this._annualData = data;
    const stage = overlay.querySelector('.as-stage');
    const board = document.getElementById('as-board'); const rows = document.getElementById('as-rows');
    document.getElementById('as-year').textContent = `第 ${data.completedYear} 年`;
    document.getElementById('as-speech').classList.remove('hide');
    document.getElementById('as-speech').innerHTML = '三月結束囉！<br>現在開始盤點每位玩家的年度資產⋯';
    document.getElementById('as-leader').classList.remove('show'); document.getElementById('as-leader-info').classList.remove('show');
    document.getElementById('as-prompt').classList.remove('show'); document.getElementById('as-chart').classList.remove('show');
    board.classList.remove('show'); rows.innerHTML = ''; overlay.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => board.classList.add('show')));
    data.ranking.forEach((p, i) => {
      const previous = data.history.length > 1 ? (data.history[data.history.length - 2].values.find(v => v.name === p.name) || {}).total : null;
      const change = previous == null ? p.total : p.total - previous;
      const row = document.createElement('div'); row.className = `as-row ${i === 0 ? 'leader' : ''}`;
      row.innerHTML = `<span class="as-rank">${i === 0 ? '👑' : '#' + (i + 1)}</span><span>${p.name}</span><span class="as-total">${formatMoney(p.total)}元</span><span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(change))}</span>`;
      rows.appendChild(row); setTimeout(() => row.classList.add('show'), 450 + i * 780);
    });
    this._annualSpeechTimer = setTimeout(() => document.getElementById('as-speech').classList.add('hide'), 1450);
    this._annualResultTimer = setTimeout(() => {
      const winner = data.ranking[0];
      document.getElementById('as-leader-info').textContent = `${winner.name}以 ${formatMoney(winner.total)}元 暫居第一名`;
      document.getElementById('as-leader').classList.add('show'); document.getElementById('as-leader-info').classList.add('show');
      document.getElementById('as-prompt').classList.add('show'); this._annualPhase = 'result';
    }, 4100 + Math.max(0, data.ranking.length - 1) * 780);
  },

  advanceAnnualSettlement() {
    if (!this._annualDone || this._annualPhase === 'playing') return;
    if (this._annualPhase === 'result') {
      this.drawAnnualChart(this._annualData.history);
      document.getElementById('as-chart').classList.add('show'); document.getElementById('as-prompt').classList.remove('show');
      this._annualPhase = 'chart'; return;
    }
    if (this._annualPhase === 'chart') {
      const done = this._annualDone; this._annualDone = null; this._annualPhase = 'done';
      document.getElementById('annual-settlement').style.display = 'none'; done();
    }
  },

  drawAnnualChart(history) {
    const svg = document.getElementById('as-chart-svg'), w = 900, h = 430, left = 75, right = 100, top = 28, bottom = 58;
    const all = history.flatMap(h => h.values.map(v => v.total)); const max = Math.max(100, ...all); const ceiling = Math.ceil(max / 100) * 100;
    const x = i => history.length === 1 ? (left + (w - left - right) / 2) : left + i * (w - left - right) / (history.length - 1);
    const y = n => top + (ceiling - n) * (h - top - bottom) / ceiling;
    let out = '';
    for (let i = 0; i <= 4; i++) { const n = Math.round(ceiling * i / 4); out += `<line class="as-grid" x1="${left}" y1="${y(n)}" x2="${w-right}" y2="${y(n)}"/><text class="as-axis" x="${left - 12}" y="${y(n) + 5}" text-anchor="end">${n}</text>`; }
    history.forEach((entry, i) => { out += `<text class="as-axis" x="${x(i)}" y="${h - 20}" text-anchor="middle">第 ${entry.year} 年</text>`; });
    const names = history[history.length - 1].values;
    names.forEach(p => { const points = history.map((entry, i) => { const value = (entry.values.find(v => v.name === p.name) || {}).total || 0; return `${x(i)},${y(value)}`; }).join(' '); out += `<polyline points="${points}" fill="none" stroke="${p.color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`; history.forEach((entry, i) => { const value = (entry.values.find(v => v.name === p.name) || {}).total || 0; out += `<circle cx="${x(i)}" cy="${y(value)}" r="7" fill="${p.color}" stroke="#fff" stroke-width="3"/>`; }); out += `<text class="as-line-label" x="${Math.min(w - right + 12, x(history.length - 1) + 14)}" y="${y((history[history.length - 1].values.find(v => v.name === p.name) || {}).total || 0) + 5}" fill="${p.color}">${p.name}</text>`; });
    svg.innerHTML = out;
  },

  // 0.8 秒骰子飛出／翻滾：使用六面立體骰子圖；每次翻面只換 CSS class，保留飛行動畫不被重置。
  // 骰子落地時立即建立下一步的方向按鈕；骰子仍停留到按鍵後淡出，並把同一個鍵轉交給已出現的移動流程。
  showDice(finalValues, total, done) {
    const el = document.getElementById('dice');
    const render = values => { el.innerHTML = `<div class="dice-cup dice-${values.length}">${values.map(n => `<span class="die face-${n}"></span>`).join('')}</div>`; };
    const showFaces = values => el.querySelectorAll('.die').forEach((die, index) => { die.className = `die face-${values[index]}`; });
    clearInterval(this._diceTicker); clearTimeout(this._diceDone);
    render(finalValues.map(() => 1 + Math.floor(Math.random() * 6)));
    el.className = `show rolling dice-mode-${finalValues.length}`;
    this._diceTicker = setInterval(() => showFaces(finalValues.map(() => 1 + Math.floor(Math.random() * 6))), 85);
    this._diceDone = setTimeout(() => {
      clearInterval(this._diceTicker);
      showFaces(finalValues); el.classList.remove('rolling'); el.classList.add('settled');
      const totalLabel = document.createElement('small');
      totalLabel.textContent = `合計 ${total} 點`;
      el.appendChild(totalLabel);
      // 不等待按鍵，先讓可移動方向出現；按鍵只負責收起骰子並可立即選方向。
      done && done();
      const isAI = !!Game.curPlayer()?.isAI;
      if (isAI) {
        // 電腦的方向已建立，落地後停留片刻再淡出；AI 本身照原流程自動選路。
        this._diceAwaiting = {el, done: null};
        setTimeout(() => this.dismissDiceAfterKey(null), 550);
      } else {
        el.classList.add('await-key');
        this._diceAwaiting = {el, done: null};
      }
    }, 800);
  },

  dismissDiceAfterKey(event) {
    const waiting = this._diceAwaiting;
    if (!waiting) return false;
    this._diceAwaiting = null;
    const {el, done} = waiting;
    el.classList.remove('await-key');
    el.classList.add('fading');
    this._diceFade = setTimeout(() => {
      this._diceFade = null;
      el.className = '';
      done && done();
      // 讓觸發淡出的同一顆鍵交給已經出現的岔路按鈕；合成事件只走既有鍵盤邏輯。
      if (event) {
        const replay = new KeyboardEvent('keydown', {key:event.key, code:event.code, bubbles:true, cancelable:true});
        window.dispatchEvent(replay);
      }
    }, 500);
    return true;
  },

  // 抵達站點或換人時，骰子畫面不應跨回合殘留；連同尚未執行的淡出／重送按鍵一起取消。
  clearDice() {
    clearInterval(this._diceTicker);
    clearTimeout(this._diceDone);
    clearTimeout(this._diceFade);
    this._diceAwaiting = null;
    this._diceFade = null;
    const el = document.getElementById('dice');
    if (el) { el.className = ''; el.innerHTML = ''; }
  },

  // 岔路箭頭：在候選方向上放按鈕，候選裡也包含「剛剛來的那一站」——
  // 跟其他方向一樣是普通箭頭，沒有專屬退回圖示；選了才判斷是否要把步數加回來
  // greenId：系統算出最短路徑往目的地的方向，該按鈕改綠色（沿用原本箭頭圖示，不是額外按鈕）
  //
  // 同一個方向（角度相同）不管有幾個候選站點，按一下都只是往那邊走一步、
  // 下一站又會重新出現選單，所以只留 1 顆按鈕代表該方向（優先選最短路徑那個）
  showBranch(fromId, cands, greenId) {
    this.hideBranch();
    const layer = document.getElementById('branch-layer');
    const F = Data.stations.get(fromId);

    // 角度用路線第一段的方向（一定是正上下左右，因為路線只有水平/垂直轉彎）
    const angleOf = toId => {
      const pts = Data.edgePath(fromId, toId);
      const p1 = pts[1] || pts[pts.length-1];
      return Math.atan2(p1.y - F.y, p1.x - F.x);
    };

    // 依角度分組，每組只留一個代表：優先選最短路徑（greenId），否則取第一個
    const groups = new Map();
    cands.forEach(toId => {
      const key = Math.round(angleOf(toId) * 1000);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(toId);
    });
    const reps = [...groups.values()].map(group => group.includes(greenId) ? greenId : group[0]);

    reps.forEach(toId => {
      const ang = angleOf(toId);
      const T = Data.stations.get(toId);
      const isGreen = toId === greenId;
      const btn = document.createElement('button');
      btn.className = 'branch-btn' + (isGreen ? ' green-btn' : '');
      btn.innerHTML = '➤';
      btn.style.setProperty('--ang', ang + 'rad');
      btn.dataset.to = toId; btn.dataset.ang = ang;
      const label = Data.isTile(toId) ? Data.typeLabel(T.type) : T.name;
      btn.title = label + (isGreen ? '（最短路徑）' : '');
      btn.onclick = () => {
        // 若骰子結果仍顯示，點方向按鈕也會一併收起骰子，不必額外先按鍵。
        if (this._diceAwaiting) this.dismissDiceAfterKey(null);
        Game.chooseBranch(toId);
      };
      layer.appendChild(btn);
    });

    this._branchFrom = F;
    this._positionBranch();
  },
  _positionBranch() {
    if (!this._branchFrom) return;
    const F = this._branchFrom;
    document.querySelectorAll('.branch-btn').forEach(btn => {
      const ang = parseFloat(btn.dataset.ang);
      const c = Render.worldToCss(F.x, F.y);
      btn.style.left = (c.x + Math.cos(ang) * 64 - 22) + 'px';
      btn.style.top  = (c.y + Math.sin(ang) * 64 - 22) + 'px';
    });
  },
  hideBranch() {
    document.getElementById('branch-layer').innerHTML = '';
    this._branchFrom = null;
  },
  showReachableStations(routes) {
    this.hideBranch();
    const layer = document.getElementById('branch-layer');
    routes.forEach((route, id) => {
      const st = Data.stations.get(id); if (!st) return;
      const p = Render.worldToCss(st.x, st.y);
      const btn = document.createElement('button');
      btn.className = 'reachable-station-btn'; btn.title = `前往 ${st.name}`;
      btn.setAttribute('aria-label', `前往 ${st.name}`);
      btn.style.left = `${p.x - 37}px`; btn.style.top = `${p.y - 37}px`;
      btn.innerHTML = `<span>${st.name}</span>`;
      btn.dataset.stationId = id;
      btn.onclick = () => Game.chooseReachableStation(id);
      layer.appendChild(btn);
    });
  },
  setReachableSelection(id) {
    document.querySelectorAll('.reachable-station-btn').forEach(btn => btn.classList.toggle('selected', btn.dataset.stationId === id));
  },
  // 可到達站點的標示跟岔路箭頭一樣要「跟著鏡頭」每一幀重新計算位置：showReachableStations
  // 建立按鈕時只算過一次畫面座標，鏡頭這之後如果移動（例如方向鍵選站會捲動鏡頭），
  // 沒有這個就會卡在原本那個畫面位置不會跟著地圖捲動，變成掉在別的站點或格子上面。
  _positionReachableStations() {
    document.querySelectorAll('.reachable-station-btn').forEach(btn => {
      const st = Data.stations.get(btn.dataset.stationId);
      if (!st) return;
      const p = Render.worldToCss(st.x, st.y);
      btn.style.left = `${p.x - 37}px`;
      btn.style.top = `${p.y - 37}px`;
    });
  },

  // 物產購買面板的鍵盤 focus 順序：全選 → 各品項（跳過已停用的）→ 確定 → 不買，
  // 全部都是原生可 focus 的表單元素，方向鍵只是在這個清單裡移動 focus
  _ssFocusables() {
    return Array.from(document.querySelectorAll('#stall-shop input:not(:disabled), #stall-shop button'));
  },
  _ssMoveFocus(delta) {
    const items = this._ssFocusables();
    if (!items.length) return;
    let idx = items.indexOf(document.activeElement);
    idx = idx === -1 ? 0 : (idx + delta + items.length) % items.length;
    items[idx].focus();
  },

  // 物產／攤位購買面板：站點的 stalls 清單來自地圖編輯器，不限站點類型
  showStallShop(st, pl) {
    document.getElementById('ss-title').textContent = `${st.name}　${pl.name} 的資金：${formatMoney(pl.money)}元`;
    const listEl = document.getElementById('ss-list');
    listEl.innerHTML = '';

    // 全選：勾了會自動依序勾選買得起的品項，並把 focus 移到「確定」鈕——
    // 還要再按一次確定鍵（空白鍵／A）才會真的送出購買，不是勾了就直接買
    const allRow = document.createElement('label');
    allRow.className = 'ss-check-row ss-select-all';
    allRow.innerHTML = `<input type="checkbox" id="ss-select-all"> 全選（自動勾買得起的，再按確定送出）`;
    listEl.appendChild(allRow);

    st.stalls.forEach((s, i) => {
      const owned = s.owner != null;
      const afford = pl.money >= s.price;
      const row = document.createElement('label');
      row.className = 'ss-check-row';
      const ownerName = owned ? (Game.players[s.owner] ? Game.players[s.owner].name : '已售出') : '';
      row.innerHTML = `<input type="checkbox" class="ss-item-check" data-idx="${i}"${(owned || !afford) ? ' disabled' : ''}>
        ${s.name}　${owned ? `（${ownerName}）` : formatMoney(s.price) + '元'}`;
      listEl.appendChild(row);
    });

    const selectAllCb = document.getElementById('ss-select-all');
    selectAllCb.checked = false;
    selectAllCb.onchange = () => {
      if (!selectAllCb.checked) return;
      let remaining = pl.money;
      listEl.querySelectorAll('.ss-item-check:not(:disabled)').forEach(cb => {
        const s = st.stalls[parseInt(cb.dataset.idx, 10)];
        if (s.price <= remaining) { cb.checked = true; remaining -= s.price; }
      });
      document.getElementById('ss-confirm').focus();   // 只是移過去等玩家確認，不會自動送出
    };

    document.getElementById('ss-confirm').onclick = () => {
      const indices = Array.from(listEl.querySelectorAll('.ss-item-check:checked')).map(cb => parseInt(cb.dataset.idx, 10));
      if (!indices.length) { Game.skipStallShop(); return; }
      Game.confirmStallPurchases(st.id, indices);
    };
    document.getElementById('ss-skip').onclick = () => Game.skipStallShop();
    document.getElementById('stall-shop').style.display = 'flex';
    selectAllCb.focus();   // 開店預設 focus 在「全選」，方向鍵/確定鍵馬上就能操作
  },
  hideStallShop() {
    document.getElementById('stall-shop').style.display = 'none';
  },

  // 強制變賣物產面板的鍵盤 focus 順序：各品項 → 確定變賣，同樣是原生可 focus 表單元素
  _dsFocusables() {
    return Array.from(document.querySelectorAll('#debt-sale input:not(:disabled), #debt-sale button:not(:disabled)'));
  },
  _dsMoveFocus(delta) {
    const items = this._dsFocusables();
    if (!items.length) return;
    let idx = items.indexOf(document.activeElement);
    idx = idx === -1 ? 0 : (idx + delta + items.length) % items.length;
    items[idx].focus();
  },

  // 現金被扣到負的：強制變賣物產抵債，賣出價＝標價 8 折。沒有「取消」/「不賣」的選項——
  // 要選到「已選擇變賣總額 ≥ 目前債務」或「全部勾選」才能按下確定；賣完 done() 才會被呼叫，
  // 呼叫端（Game.settleDebt）接住這個 callback 繼續原本被打斷的流程（換人、續抽卡效果等）。
  showAssetSale(pl, done) {
    const debt = Math.abs(pl.money);
    const bgmBeforeDebt = BGM.current;   // 變賣結束要換回原本在播的（當時的季節音樂），不是寫死春夏秋冬
    BGM.play('debt');
    document.getElementById('debt-title').textContent = `資金不足！${pl.name} 需要變賣物產`;
    document.getElementById('debt-amount').textContent = `目前現金：${formatMoney(pl.money)}元（積欠 ${formatMoney(debt)}元）`;
    const listEl = document.getElementById('debt-list');
    listEl.innerHTML = '';
    pl.stalls.forEach((s, i) => {
      const sellPrice = Math.max(1, Math.floor(s.price * 0.8));
      const row = document.createElement('label');
      row.className = 'ss-check-row';
      row.innerHTML = `<input type="checkbox" class="debt-item-check" data-idx="${i}" data-sell="${sellPrice}">
        ${s.name}　${formatMoney(s.price)}元<span class="sell-price">賣 ${formatMoney(sellPrice)}</span>`;
      listEl.appendChild(row);
    });
    const confirmBtn = document.getElementById('debt-confirm');
    const remainingEl = document.getElementById('debt-remaining');
    const checks = () => Array.from(listEl.querySelectorAll('.debt-item-check'));
    const updateRemaining = () => {
      const selected = checks().filter(cb => cb.checked);
      const sum = selected.reduce((total, cb) => total + parseInt(cb.dataset.sell, 10), 0);
      const allChecked = selected.length === checks().length;
      const stillOwe = debt - sum;
      if (stillOwe <= 0) {
        remainingEl.textContent = `已選擇變賣 ${formatMoney(sum)}元，足夠還清債務！`;
        remainingEl.classList.add('debt-ok');
      } else {
        remainingEl.textContent = `已選擇變賣 ${formatMoney(sum)}元，還差 ${formatMoney(stillOwe)}元${allChecked ? '（已經沒有物產可以賣了）' : ''}`;
        remainingEl.classList.remove('debt-ok');
      }
      confirmBtn.disabled = !(stillOwe <= 0 || allChecked);
    };
    listEl.querySelectorAll('.debt-item-check').forEach(cb => cb.addEventListener('change', updateRemaining));
    updateRemaining();
    confirmBtn.onclick = () => {
      if (confirmBtn.disabled) return;
      const indices = checks().filter(cb => cb.checked).map(cb => parseInt(cb.dataset.idx, 10));
      indices.sort((a, b) => b - a).forEach(i => Game.sellStallFor(pl, pl.stalls[i]));   // 由大到小刪，避免 splice 移位
      document.getElementById('debt-sale').style.display = 'none';
      if (bgmBeforeDebt) BGM.play(bgmBeforeDebt);
      done();
    };
    document.getElementById('debt-sale').style.display = 'flex';
    this.focusOverlayFirst();
  },

  // 探路放大鏡游標的唯讀資訊視窗：只顯示品項、價格、收益率、被誰買走，不能在這裡購買
  // （人不在那站，買不到，純粹讓玩家事先規劃路線用）
  showScoutInfo(stationId) {
    const st = Data.stations.get(stationId);
    document.getElementById('scout-info-title').textContent = st.name;
    const box = document.getElementById('scout-info-list');
    box.innerHTML = '';
    if (st.stalls && st.stalls.length) {
      st.stalls.forEach(s => {
        const owned = s.owner != null;
        const ownerName = owned ? (Game.players[s.owner] ? Game.players[s.owner].name : '') : '';
        const row = document.createElement('div');
        row.className = 'si-row';
        row.innerHTML = `<b>${s.name}</b>
          <span class="si-meta">${formatMoney(s.price)}元・收益 ${s.rate == null ? 100 : s.rate}%</span>
          <span class="si-owner">${owned ? `已售出（${ownerName}）` : '尚未售出'}</span>`;
        box.appendChild(row);
      });
    } else {
      box.innerHTML = `<p class="si-empty">這裡沒有物產／攤位可查</p>`;
    }
    document.getElementById('scout-info').style.display = 'flex';
    document.getElementById('si-close').focus();
  },
  hideScoutInfo() {
    document.getElementById('scout-info').style.display = 'none';
  },

  // 遊戲結束結算：總資產排行（現金＋物產標價加總），ranking 由 Game.endGame() 算好傳進來
  showGameOver(ranking) {
    document.getElementById('go-years').textContent = Game.totalYears;
    const box = document.getElementById('go-rank');
    box.innerHTML = '';
    ranking.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'go-row' + (i === 0 ? ' go-first' : '');
      row.innerHTML = `<span class="go-rank-num">${i + 1}</span><img class="go-avatar" src="${r.avatar}" alt=""><b>${r.name}</b><span class="go-total">💰${formatMoney(r.total)}元</span>`;
      box.appendChild(row);
    });
    document.getElementById('gameover').style.display = 'flex';
    this.focusOverlayFirst();
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('show'), 2600);
  },

  // 月份跳字：從右側滑入 → 畫面中間停頓 → 繼續往左滑出，動畫結束才呼叫 cb 讓回合繼續
  showMonthBanner(month, cb) {
    const el = document.getElementById('month-banner');
    const img = document.getElementById('month-banner-img');
    if (MONTH_IMG_AVAILABLE.has(month)) {
      img.style.backgroundImage = `url('assets/screens/months/${String(month).padStart(2, '0')}.jpg')`;
    } else {
      img.style.backgroundImage = '';
    }
    el.querySelector('.month-banner-text').textContent = `${MONTH_NAME[month]}囉～`;

    el.classList.remove('playing');
    void el.offsetWidth;   // 強制 reflow，讓動畫可以重新從頭播放
    const onEnd = e => {
      if (e.target !== el.querySelector('.month-banner-text')) return;
      el.removeEventListener('animationend', onEnd);
      el.classList.remove('playing');
      cb && cb();
    };
    el.addEventListener('animationend', onEnd);
    el.classList.add('playing');
  },

  // ── 小地圖 ──
  buildMiniBase() {
    const w = Data.world;
    const c = document.createElement('canvas');
    c.width = this.mini.width; c.height = this.mini.height;
    const g = c.getContext('2d');
    const s = Math.min(c.width / w.w, c.height / w.h);
    g.fillStyle = 'rgba(17,38,59,.8)'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#5E84A4';
    Data.stations.forEach(st => {
      if (st.type === '藍格' || st.type === '紅格' || st.type === '黃格') return;
      g.fillRect((st.x - w.x) * s, (st.y - w.y) * s, 1.4, 1.4);
    });
    this.miniBase = c;
    this._miniScale = s;
  },
  drawMini() {
    if (!this.miniBase) return;
    const g = this.miniCtx, w = Data.world, s = this._miniScale;
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    g.drawImage(this.miniBase, 0, 0);
    if (Game.destination) {
      const d = Data.stations.get(Game.destination);
      g.beginPath();
      g.arc((d.x - w.x) * s, (d.y - w.y) * s, 4, 0, 7);
      g.fillStyle = '#FFD54A'; g.fill();
      g.strokeStyle = '#B8860B'; g.lineWidth = 1; g.stroke();
    }
    Game.players.forEach((p, i) => {
      g.beginPath();
      g.arc((p.ax - w.x) * s, (p.ay - w.y) * s, i === Game.cur ? 4 : 3, 0, 7);
      g.fillStyle = p.color; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    });
    this._positionBranch();   // 岔路箭頭跟著鏡頭
    this._positionReachableStations();   // 可到達站點標示跟著鏡頭
  },
};
