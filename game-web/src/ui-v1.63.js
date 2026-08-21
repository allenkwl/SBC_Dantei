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
    this._wrapNetPanels();   // 連線面板同步：集中包裝，見 NET_PANELS
    document.getElementById('btn-roll').onclick = () => Game.roll();
    document.getElementById('btn-reachable').onclick = () => Game.toggleReachableRoutes();
    document.getElementById('btn-cards').onclick = () => this.showCardHand();
    document.getElementById('btn-zoom').onclick = () => Render.toggleZoom();
    const muteBtn = document.getElementById('btn-mute');
    muteBtn.onclick = () => { const muted = BGM.toggleMute(); SFX.muted = muted; muteBtn.textContent = muted ? '🔇' : '🔊'; };
    // 說明頁：畫面上的 ❓ 鈕與頁內的關閉鈕，跟 ZL／H 鍵等價（滑鼠玩家也要能開關）
    const helpBtn = document.getElementById('btn-help');
    if (helpBtn) helpBtn.onclick = () => { helpBtn.blur(); this.showHelp(); };
    const helpClose = document.getElementById('help-close');
    if (helpClose) helpClose.onclick = () => this.hideHelp();
    const ARROW_ANG = {ArrowRight: 0, ArrowDown: Math.PI/2, ArrowLeft: Math.PI, ArrowUp: -Math.PI/2};
    // 非骰子流程的確認鍵在觸發後必須先放開，避免鍵盤連發穿透到下一個畫面／下一回合。
    addEventListener('keyup', e => {
      if (this._confirmKeyLock === e.code) this._confirmKeyLock = null;
    });
    addEventListener('blur', () => { this._confirmKeyLock = null; });

    // ── 演出畫面的「按 A 繼續」改成真的按鈕 ──
    // 黃格翻卡、到站慶祝、年度決算這幾段演出都是「按 A 繼續」，但以前只掛了鍵盤處理，畫面上
    // 也沒有任何可點的東西——滑鼠玩家一路推不動，只能去借鍵盤。以前滑鼠不是正式的操作介面
    // 所以沒人踩到，v1.37 之後滑鼠可以當成一位玩家的介面，這就變成真的卡關。
    //
    // 不用擔心誤觸：這些提示只有在該按的時候才會顯示，而且滑鼠若被指派給某位玩家，非他的
    // 回合時點擊早就被上面的回合鎖在捕捉階段擋掉了。點完 blur()，避免留下全域的金色 focus。
    const bindPerfBtn = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { el.blur(); fn(); });
    };
    bindPerfBtn('card-draw-go', () => Game.revealYellowCard());
    bindPerfBtn('dc-prompt',    () => this.revealNextDestination(SRC_MOUSE));   // 兩段演出共用同一個推進函式
    bindPerfBtn('dc-continue',  () => this.revealNextDestination(SRC_MOUSE));
    bindPerfBtn('as-prompt',    () => this.advanceAnnualSettlement(SRC_MOUSE));
    bindPerfBtn('as-chart-go',  () => this.advanceAnnualSettlement(SRC_MOUSE));
    bindPerfBtn('nr-prompt',    () => this.dismissNewsReport());   // 手機沒有鍵盤，提示列要能點
    // 轉螢幕／改視窗大小時重算新聞快報的尺寸（它是用 innerWidth/innerHeight 算出來的）
    addEventListener('resize', () => this.layoutNewsReport());
    // 擲骰結果沒有自己的提示鈕（骰子是直接畫在地圖畫布上的，加顆按鈕會擋到地圖），
    // 改成點地圖就讓骰子淡出，跟按任意鍵一樣。#game 是 <canvas>，不會有子元素，
    // 不會跟岔路按鈕之類的疊層互搶點擊。傳 null 表示不用重送按鍵。
    const gameEl = document.getElementById('game');
    if (gameEl) gameEl.addEventListener('click', () => { if (this._diceAwaiting) this.dismissDiceAfterKey(null); });
    // 滑鼠如果被某位玩家認領成他的操作介面，也要照回合鎖：不是他的回合就在捕捉階段整個攔下，
    // 任何 onclick 都不會跑到。沒有人認領滑鼠時 Seats.allows 會放行（主持人的指標裝置）。
    //
    // e.isTrusted 是這裡的關鍵：手把的 A 鍵是靠程式呼叫 element.click() 觸發按鈕的，那是
    // 不受信任事件，不能當成滑鼠操作攔下來——攔了的話手把會連按鈕都按不動。
    document.addEventListener('click', e => {
      if (!Seats.active || !e.isTrusted) return;
      // 到站慶祝／年度決算這 4 顆按鈕不套用一般回合鎖（誰能按由 destinationAllows／
      // advanceAnnualSettlement 內部自己判斷——電腦到站時不接受任何人代按、年度決算則要
      // 每個人都按過），一般回合鎖只認「目前輪到的那一位」，套用在這裡會兩邊都判斷錯。
      if (['dc-prompt', 'dc-continue', 'as-prompt', 'as-chart-go'].includes(e.target.id)) return;
      if (Seats.allows(SRC_MOUSE)) return;
      e.stopPropagation(); e.preventDefault();
      if (Seats.registered(SRC_MOUSE)) Seats.denyHint();
    }, true);
    // 統一輸入層：全部遊戲快捷鍵（方向鍵、A確定、B返回、X卡片、Y可到達站點、Z縮放、P設定、M靜音、C卡片）
    // 都在「文件捕捉階段」（第三參數 true）處理，比任何畫面元件自己的鍵盤預設行為都早一步搶到——
    // 這是遊戲／手把應用程式常見的正規做法：自己的輸入層要在事件一進來就整個接管，不能靠瀏覽器的
    // 事件冒泡順序或元件目前有沒有 focus 這類不可靠的細節。手把在 input.js 是合成（untrusted）鍵盤事件，
    // 瀏覽器本來就不會對它跑任何原生預設行為，只有「真人鍵盤」才會遇到某些瀏覽器（尤其 Safari）
    // 對已經 focus 的按鈕/選單元件有自己的一套鍵盤預設處理、可能搶在我們自己的邏輯前面。
    // 以前只有 X／Y 兩顆鍵用這個方式搶最前面處理，這裡把其餘按鍵也一起搬進來，鍵盤和手把才會
    // 保證是完全一致的行為。唯一例外：焦點在真正的文字輸入欄位時完全不介入，讓使用者能正常打字。
    //
    // isTextEntry 一定要用「白名單」（只認 type=text 這種自由輸入文字的欄位），不能用「排除法」
    // （例如「只要不是 number 就算文字欄位」）——checkbox／radio 也是 <input>，用排除法會被
    // 一起判定成文字欄位而整段直接 return，等於這裡完全不會幫 checkbox 處理方向鍵／確定鍵。
    // 這正是快速模式勾選框「手把按不動、鍵盤卻可以」的真正原因：真人鍵盤按空白鍵，瀏覽器自己
    // 對已經 focus 的 checkbox 有「space 鍵切換勾選」的原生預設行為，我們的程式碼沒接手也一樣會勾；
    // 但手把在 input.js 送出的是合成（untrusted）事件，瀏覽器不會對合成事件跑這個原生預設行為，
    // 如果我們自己的程式碼也不處理，手把就完全沒辦法勾選——鍵盤「看起來正常」只是因為瀏覽器
    // 原生行為幫忙擋著，程式本身其實一樣沒處理到，是真的漏掉的 bug，不是手把才有的問題。
    document.addEventListener('keydown', e => {
      const active = document.activeElement;
      const isTextEntry = active && (active.isContentEditable ||
        active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && active.type === 'text'));
      // 「有文字欄位 focus 就整段不處理」只能套用在真人鍵盤上（瀏覽器會自己把字打進去）。
      // 手把送的是合成（untrusted）事件，瀏覽器根本不會拿它去插入文字，這裡再放掉就等於
      // 「只要有一個人在打字，其他手把玩家全部動不了」——多人同screen時這是致命的。
      if (isTextEntry && !Input._source) return;

      // ── 遊戲說明（手把 ZL／鍵盤 H）：任何時候都能叫出來查 ──
      // 這段一定要放在最前面，比下面「splash／setup／pick 就直接 return」那道防線更早：
      // 玩家最需要查按鍵配置的時機，正是還在開場、選人數、選角這些畫面的時候，那些畫面
      // 有自己的鍵盤處理、統一輸入層原本完全不插手，放在後面就等於開局前按 ZL 沒反應。
      // 說明頁開著時吃掉所有按鍵（只留關閉／捲動），避免底下的畫面被誤觸。
      const helpPage = document.getElementById('help-page');
      if (helpPage && helpPage.style.display === 'flex') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (Input.isBack(e) || Input.isKey(e, 'h') || e.key === 'Escape' || Input.isConfirm(e)) this.hideHelp();
        else if (e.key === 'ArrowUp') helpPage.querySelector('.help-card').scrollBy({top: -90, behavior: 'smooth'});
        else if (e.key === 'ArrowDown') helpPage.querySelector('.help-card').scrollBy({top: 90, behavior: 'smooth'});
        return;
      }
      if (Input.isKey(e, 'h')) {
        // 沒參賽的手把不能叫出說明頁蓋住別人的畫面（跟 Seats.allows 對未認領手把的規則一致）；
        // 沒被認領的鍵盤／滑鼠是主持人裝置，照樣放行。
        const hs = Input.sourceOf();
        if (Seats.active && !Seats.registered(hs) && hs !== SRC_KB && hs !== SRC_MOUSE) return;
        e.preventDefault(); e.stopImmediatePropagation(); this.showHelp(); return;
      }

      // 開局前的畫面（主畫面、P2 開局設定、P3 選角）都有自己的鍵盤處理，遊戲內的統一輸入層
      // 完全不要插手。少了這道防線，在 P3 按 B 會被下面「遊戲進行中按 B」那段接走，跳出
      // 「要結束遊戲嗎？」——上一局的 Game.players 還留著，那個判斷會誤以為現在正在遊戲中。
      //
      // 唯一例外是確認視窗：它會疊在這些畫面上面（P3 的刪除存檔、返回上一頁都會用到），
      // 而確認視窗的鍵盤導覽是由這裡負責的。不排除的話，視窗一跳出來就變成鍵盤／手把完全
      // 按不動，只能用滑鼠點——沒有滑鼠的話就真的卡死了。
      const modalOpen = document.getElementById('confirm-modal').style.display === 'flex';
      // net-lobby／net-room 跟 splash／setup／pick 同類：都是開局前的畫面，各自有自己的
      // 鍵盤處理，遊戲內的統一輸入層完全不要插手（不然在大廳按 B 會被當成「結束遊戲」、
      // 按 A 會被當成擲骰）。
      if (!modalOpen && ['splash', 'setup', 'pick', 'net-lobby', 'net-room'].some(id => {
        const el = document.getElementById(id);
        return el && el.style.display === 'flex';
      })) return;

      const src = Input.sourceOf();

      // ── 到站慶祝／年度決算：比一般回合鎖更早判斷，各自有自己的「誰可以按」規則 ──
      // 這兩個畫面不能直接套用下面的一般回合鎖：
      // ‧ 到站慶祝要比回合鎖更嚴格——電腦到站時，回合鎖原本會放行任何人代按，但現在
      //   電腦到站會自己內部計時器自動按（見 showDestinationCelebration／
      //   revealNextDestination），不該再讓其他玩家搶著幫忙按、把畫面按過去。
      // ‧ 年度決算要比回合鎖更寬鬆——回合鎖只認「目前輪到的那一位玩家」，但決算需要
      //   在場「每一位」玩家都按過一次才能繼續，套用回合鎖的話其他玩家的按鍵會在一般
      //   回合鎖那關就被擋掉，永遠湊不齊全員確認。
      // 兩邊都用 isConfirmKey 判斷，這裡提早算一次（後面 142 行左右還有一份給其餘畫面用）。
      const isConfirmKeyEarly = Input.isConfirm(e);
      const destinationOverlay = document.getElementById('destination-celebration');
      if (destinationOverlay && destinationOverlay.style.display === 'flex') {
        if (isConfirmKeyEarly) {
          e.preventDefault();
          if (!this.destinationAllows(src)) { if (Seats.registered(src)) Seats.denyHint(); return; }
          this.lockConfirmKey(e); this.revealNextDestination(src);
        }
        return;
      }
      const newsOverlay = document.getElementById('news-report');
      if (newsOverlay && newsOverlay.style.display === 'flex') {
        if (isConfirmKeyEarly) { e.preventDefault(); this.lockConfirmKey(e); this.dismissNewsReport(); }
        return;   // 快報開著的時候不讓其他按鍵穿過去（大家都在等這個人按繼續）
      }
      const annualOverlay = document.getElementById('annual-settlement');
      if (annualOverlay && annualOverlay.style.display === 'flex') {
        if (isConfirmKeyEarly) { e.preventDefault(); this.lockConfirmKey(e); this.advanceAnnualSettlement(src); }
        return;
      }

      // ── 多介面回合鎖 ──
      // 玩家 i 只能用自己在選角畫面認領的介面操作。靜音／縮放／設定這類全域功能不鎖，
      // 任何參賽介面隨時可用（想調個音量還要等自己的回合太莫名其妙）。
      // 擋下時一定要給提示：完全沒反應的畫面跟當掉沒兩樣。
      if (Seats.active) {
        const isGlobalKey = Input.isKey(e, 'm') || Input.isKey(e, 'z') || Input.isKey(e, 'p') || e.key === 'Escape';
        if (!Seats.allows(src) && !(isGlobalKey && Seats.registered(src))) {
          e.preventDefault();
          if (Seats.registered(src)) Seats.denyHint();   // 旁邊沒參賽的手把靜靜忽略，不用一直跳提示
          return;
        }
      }

      const code = e.code || '';
      const isY = Input.isKey(e, 'y');
      const isX = Input.isKey(e, 'x');
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

      // 一律用 Input.isKey()：只比對 e.key 的話，開著注音輸入法時 e.key 會變成 'Process'，
      // 這些字母快捷鍵會全部失效（方向鍵不受影響，所以症狀是「方向鍵能動、A/B 沒反應」）。
      const isConfirmKey = Input.isConfirm(e);
      const isBackKey = Input.isBack(e);
      const isReachKey = Input.isKey(e, 'y');

      // 骰子結算畫面停留到玩家按鍵。此鍵先讓骰子在 0.5 秒內淡出、開啟移動流程，
      // 再重送同一個鍵給下方既有處理器，例如方向鍵可立刻選擇岔路，絕不被吃掉。
      if (this._diceAwaiting && isReachKey && Game.state === 'awaitBranch') {
        // 先切換可到達站點，再讓骰子淡出；避免淡出期間的狀態改變使 Y 被忽略。
        e.preventDefault(); Game.toggleReachableRoutes(); this.dismissDiceAfterKey(null); return;
      }
      if (this._diceAwaiting && this.dismissDiceAfterKey(e)) return;

      // 骰子以外的演出／面板按鍵不可穿透；同一顆仍被按住的鍵盤連發一律忽略到 keyup。
      if (this._confirmKeyLock === e.code) { e.preventDefault(); return; }

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
        // confirm-modal 一定要排第一個：它是疊在其他面板（例如 save-slots）上面的確認視窗，
        // 開著的時候背景那個面板通常還留著 display:flex，如果 save-slots 排在前面，find() 會
        // 先比對到它、按 B 就變成直接關掉整個存檔選擇畫面，而不是先關掉眼前這個確認視窗——
        // 跟滑鼠點「取消」只關掉確認視窗、留在原畫面的行為不一致。
        const overlays = [
          ['confirm-modal', 'cm-cancel'],
          ['nudge-panel', 'nudge-cancel'],
          ['settings-menu', 'cfg-close'],
          ['save-slots', 'save-slots-back'],
          ['extend-years', 'ey-cancel'],
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

      // 上面這些選單（設定／存檔／變更年數／確認視窗／遊戲結束／打招呼／斷線暫停）開著時，其餘按鍵（擲骰、探路、縮放）先不處理
      const menuOpen = ['settings-menu', 'save-slots', 'extend-years', 'confirm-modal', 'gameover', 'nudge-panel', 'pause-modal']
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
      if (Input.isKey(e, 'c')) { e.preventDefault(); if (!document.getElementById('btn-cards').disabled) this.showCardHand(); }
      if (Input.isKey(e, 'p')) { e.preventDefault(); document.getElementById('btn-settings').click(); }
      if (Input.isKey(e, 'm')) { e.preventDefault(); document.getElementById('btn-mute').click(); }
      if (Input.isKey(e, 'z')) Render.toggleZoom();

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

    this.initDestinationClock();
    this.initArrivalShared();
  },

  // 到站演出的小朋友與「抵達目的地」文字，改讀「目的地慶祝動畫模擬」存的共用設定
  // （SHARED_KEY，同網域的 localStorage 本來就共用）。在模擬器裡調過的造型／位置／
  // 上下層／文字大小位置，只要遊戲跟模擬器是從同一台伺服器打開，這裡下次載入就會讀到
  // 一樣的設定，不用手動搬。找不到共用設定（例如用 file:// 直接雙擊打開、跟模擬器不同
  // 來源）就退回跟舊版一致的 4 位小朋友＋原本文字位置，行為不會壞掉。
  ARRIVAL_SHARED_KEY: 'xiaoqiu-cat-railway-arrival-shared-v1',
  ARRIVAL_KID_IMAGES: [
    '../圖片/慶祝到站小朋友/小朋友01-男孩黃衣.png', '../圖片/慶祝到站小朋友/小朋友02-女孩紅衣.png',
    '../圖片/慶祝到站小朋友/小朋友03-男孩藍帽.png', '../圖片/慶祝到站小朋友/小朋友04-女孩黃衣.png',
    '../圖片/慶祝到站小朋友/小朋友05-男孩紅帽.png', '../圖片/慶祝到站小朋友/小朋友06-女孩草帽.png',
    '../圖片/慶祝到站小朋友/小朋友07-男孩黃衣.png', '../圖片/慶祝到站小朋友/小朋友08-女孩和服.png',
  ],
  ARRIVAL_KID_JUMP_PRESETS: [
    {dur: 1.00, delay: -0.18, height: 15, tilt: -0.7}, {dur: 0.86, delay: -0.51, height: 11, tilt: 0.5},
    {dur: 1.13, delay: -0.76, height: 18, tilt: -0.45}, {dur: 0.94, delay: -0.34, height: 13, tilt: 0.65},
  ],
  ARRIVAL_DEFAULT_KIDS: [
    {img: 0, left: -5, bottom: -5, width: 18}, {img: 1, left: 6, bottom: -5, width: 18},
    {img: 2, left: 18, bottom: -5, width: 18}, {img: 3, left: 29, bottom: -5, width: 18},
  ],
  ARRIVAL_DEFAULT_TITLE: {top: 22, left: 74, scale: 1},
  initArrivalShared() {
    const box = document.getElementById('dc-kids');
    if (!box) return;
    // 優先讀 arrival_settings.js（跟模擬器共用的檔案，存檔即生效，任何瀏覽器都讀得到）；
    // 那個檔案不存在時才退回 localStorage 的舊版快取，都沒有才用內建預設值。
    let shared = (window.ARRIVAL_SETTINGS && typeof window.ARRIVAL_SETTINGS === 'object') ? window.ARRIVAL_SETTINGS : null;
    if (!shared) { try { shared = JSON.parse(localStorage.getItem(this.ARRIVAL_SHARED_KEY)); } catch (_) {} }
    const kids = (shared && Array.isArray(shared.kids) && shared.kids.length) ? shared.kids : this.ARRIVAL_DEFAULT_KIDS;
    const title = {...this.ARRIVAL_DEFAULT_TITLE, ...(shared && shared.title)};
    box.innerHTML = '';
    kids.forEach((k, i) => {
      const preset = this.ARRIVAL_KID_JUMP_PRESETS[i % this.ARRIVAL_KID_JUMP_PRESETS.length];
      const img = document.createElement('img');
      img.className = 'dc-kid'; img.alt = '歡呼的小朋友';
      img.src = this.ARRIVAL_KID_IMAGES[k.img] || this.ARRIVAL_KID_IMAGES[0];
      img.style.left = k.left + '%'; img.style.bottom = k.bottom + '%'; img.style.width = k.width + '%';
      img.style.setProperty('--jump-duration', preset.dur + 's');
      img.style.setProperty('--jump-delay', preset.delay + 's');
      img.style.setProperty('--jump-height', preset.height + 'px');
      img.style.setProperty('--jump-tilt', preset.tilt + 'deg');
      box.appendChild(img);
    });
    const arrival = document.getElementById('dc-arrival');
    if (arrival) {
      arrival.style.setProperty('--arr-top', title.top + '%');
      arrival.style.setProperty('--arr-left', title.left + '%');
      arrival.style.setProperty('--arr-scale', title.scale);
    }
  },

  // 到站演出的車站時鐘：背景圖裡的指針是畫死在固定時間的靜態插圖，這裡疊一個依真實時間
  // 即時轉動的 DOM 時鐘蓋在同一個位置（CSS 已經畫好面盤／數字／指針，這裡只算角度）。
  // 演出畫面平常是 display:none，但指針持續在背景轉動沒有額外成本，開演時就已經是正確時間，
  // 不用等 showDestinationCelebration 那一刻才臨時算一次。
  initDestinationClock() {
    const clock = document.getElementById('dc-clock');
    if (!clock) return;
    // 12,3,6,9 已經用文字疊在面盤上，其餘 8 個小時位置補上刻度。
    [1,2,4,5,7,8,10,11].forEach(hour => {
      const tick = document.createElement('div');
      tick.className = 'dc-clock-tick';
      tick.style.transform = `rotate(${hour * 30}deg)`;
      clock.appendChild(tick);
    });
    const hourHand = document.getElementById('dc-clock-hour');
    const minHand = document.getElementById('dc-clock-min');
    const secHand = document.getElementById('dc-clock-sec');
    const update = () => {
      const now = new Date();
      const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
      hourHand.style.transform = `rotate(${(h + m / 60) * 30}deg)`;
      minHand.style.transform = `rotate(${(m + s / 60) * 6}deg)`;
      secHand.style.transform = `rotate(${s * 6}deg)`;
    };
    update();
    setInterval(update, 1000);
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
    // 連線對戰時在年月後面標出「有控制權」：畫面上每個人看到的地圖與棋子都一樣，
    // 光看畫面分不出現在該不該自己動手，這行字就是唯一的判斷依據。
    // 用 Seats.byPlayer 判斷而不是「我認領了哪隻」——輪到的角色正好是這台在操作時
    // 才有控制權，這跟 isNetDriver 的第一個判斷條件是同一件事。
    const iControl = Game.netGroup && typeof Seats !== 'undefined'
      && Seats.byPlayer && Seats.byPlayer.has(Game.cur);
    document.getElementById('calendar').textContent =
      `第 ${Game.year} 年　${Game.month} 月` + (iControl ? '　🎮 有控制權' : '');
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
          <div class="p-cur-name"><b>${pl.name}</b>${pl.isAI ? `<span class="ai-tag">${(AI_PROFILES[pl.aiLevel] || AI_PROFILES[1]).label}</span>` : ''}</div>
          <div class="p-cur-money${pl.money < 0 ? ' debt' : ''}">💰${formatMoney(pl.money)}</div>
          <div class="p-cur-loc">${loc}　🃏${(pl.cards || []).length}/${CARD_HAND_LIMIT}</div>
        </div>`;
      list.appendChild(div);
    }
    // 連線時沒有 token 的人整個藏掉擲骰／卡片：他們按不動。
    // 不能只靠 disabled——輪到別人而對方還在考慮時，live 傳過來的 state 也是
    // awaitRoll，按鈕會是「亮的」，按下去卻沒反應，比反灰更像當機。
    const listener = !!(Game.netGroup && typeof Game.hasToken === 'function' && !Game.hasToken());
    const btn = document.getElementById('btn-roll');
    btn.style.display = listener ? 'none' : '';
    document.getElementById('btn-cards').style.display = listener ? 'none' : '';
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
    const go = document.getElementById('card-draw-go');
    if (go) go.style.display = '';   // 上一次翻完時被藏起來了，每次重新開啟都要放回來
    document.getElementById('card-draw-title').textContent = `🟡 ${pl.name} 抵達黃格！`;
    document.getElementById('card-draw-result').textContent = '按 A／空白鍵，或點下面的按鈕翻開一張卡片';
    document.getElementById('card-draw').style.display = 'flex';
  },
  revealCardDraw(card, pl) {
    // 卡片翻開的這一刻出聲。放在這裡而不是 showCardDraw（面板打開）的理由：
    // 面板只是「請按 A」的提示，真正抽到是這一刻；而且電腦玩家不開面板、
    // 直接走 revealYellowCard → 這裡，所以電腦抽卡也聽得到。
    //
    // revealYellowCard 開頭就 return 掉 listener，所以看戲的那幾台不會跑到這裡，
    // 得靠廣播（跟 toast、卡片閃現同一條路）——這正是之前「擲骰子筆電沒聲音」的同一個坑。
    SFX.cardDraw();
    this._broadcast({type: 'sfx', key: 'card'});
    const result = document.getElementById('card-draw-result');
    if (result) result.textContent = card ? `${pl.name} 抽到「${card.name}」！` : `${pl.name} 的卡片已滿，無法抽取。`;
    // 卡片翻開後就把按鈕收起來：留著會讓人以為還能再翻一次
    const go = document.getElementById('card-draw-go');
    if (go) go.style.display = 'none';
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
    this._broadcast({type: 'cardFlash', args: [icon, text]});
    const el = document.getElementById('card-flash');
    el.querySelector('.card-flash-icon').textContent = icon;
    el.querySelector('.card-flash-text').textContent = text;
    el.classList.remove('playing'); void el.offsetWidth; el.classList.add('playing');
    clearTimeout(this._cardFlashTimer); this._cardFlashTimer = setTimeout(() => el.classList.remove('playing'), 1550);
  },

  // 遊戲說明頁：手把功能與電腦難度對照，隨時按 ZL／H 叫出來、再按一次或按 B 關掉。
  // 內容全部寫死在 HTML 裡（純靜態對照表，不需要跟著遊戲狀態變），這裡只負責開關與焦點。
  showHelp() {
    const page = document.getElementById('help-page');
    if (!page || page.style.display === 'flex') return;
    // 記住原本焦點在哪，關掉之後要還回去——不然底下畫面的方向鍵導覽會從頭開始，
    // 玩家會發現「查一下說明，選到一半的位置就沒了」。
    this._helpPrevFocus = document.activeElement;
    page.style.display = 'flex';
    const card = page.querySelector('.help-card');
    if (card) card.scrollTop = 0;
    const close = document.getElementById('help-close');
    if (close) close.focus();
  },

  hideHelp() {
    const page = document.getElementById('help-page');
    if (!page || page.style.display !== 'flex') return;
    page.style.display = 'none';
    const prev = this._helpPrevFocus;
    this._helpPrevFocus = null;
    if (prev && prev.focus && document.contains(prev)) prev.focus();
  },

  // ────────────────────────────────────────────────
  //  連線：面板同步的單一集中處
  // ────────────────────────────────────────────────
  // 以前是「每做一個面板就手動在它的 show* 裡設一次 netOverlay」，結果 16 類演出裡
  // 漏掉了 10 類（包括最嚴重的「遊戲結束」——整局結束只有一台看得到）。
  // 改成集中成一張表：driver 開任何一個面板時自動記錄、listener 自動照著開。
  // 要支援新面板只要在這裡加一列，不必再改任何 show* 函式，也不會再「忘了接」。
  //
  // pack：把參數壓成可以放進 live 封包的極簡形式（站點只送 id、玩家只送 index）
  // unpack：listener 端還原成呼叫參數；最後一個參數多半是「唯讀」旗標
  NET_PANELS: [
    {m: 'showStallShop', el: 'stall-shop',
     pack: (st, pl) => ({s: st.id, p: Game.players.indexOf(pl)}),
     unpack: d => [Data.stations.get(d.s), Game.players[d.p], true],
     live: function () { return {sel: this.stallSelectionNow()}; },
     apply: function (d) { this.applyStallSelection(d.sel || []); }},
    {m: 'showDestinationCelebration', el: 'destination-celebration',
     pack: (st, pl, bonus) => ({s: st.id, p: Game.players.indexOf(pl), b: bonus}),
     unpack: d => [Data.stations.get(d.s), Game.players[d.p], d.b || 0, () => {}],
     live: function () { return {nx: this._destNextId || null, sh: !!this._destNextShown}; },
     apply: function (d) { this.applyDestReveal(d); }},
    {m: 'showAnnualSettlement', el: 'annual-settlement',
     pack: (data) => ({d: data}),
     unpack: d => [d.d, () => {}],
     live: function () { return {ph: this._annualPhase}; },
     apply: function (d) { this.applyAnnualPhase(d.ph); }},
    {m: 'showCardShop', el: 'card-shop',
     pack: (pl, st) => ({p: Game.players.indexOf(pl), s: st.id}),
     unpack: d => [Game.players[d.p], Data.stations.get(d.s)]},
    {m: 'showCardDraw', el: 'card-draw',
     pack: (pl) => ({p: Game.players.indexOf(pl)}),
     unpack: d => [Game.players[d.p]]},
    {m: 'showCardDiscard', el: 'card-discard',
     pack: (pl) => ({p: Game.players.indexOf(pl)}),
     unpack: d => [Game.players[d.p]]},
    {m: 'showAssetSale', el: 'debt-sale',
     pack: (pl) => ({p: Game.players.indexOf(pl)}),
     unpack: d => [Game.players[d.p], () => {}]},
    // 新聞快報：等持 token 的那台按 A 才收掉，其他人只能看。
    // 跟到站慶祝一樣走這張表，所以 listener 端會自動開、driver 收掉時自動關。
    {m: 'showNewsReport', el: 'news-report',
     pack: (t, pl) => ({k: t.key, p: Game.players.indexOf(pl)}),
     unpack: d => [TYCOON_TITLES.find(x => x.key === d.k), Game.players[d.p], () => {}]},
    {m: 'showGameOver', el: 'gameover',
     pack: (ranking) => ({r: ranking}),
     unpack: d => [d.r]},
    // 直升機捷徑：跟到站慶祝一樣是「有起訖的演出」，同一張表就能涵蓋。
    // 它不是用 display 開關而是掛 .show class，所以自訂 visible 判斷。
    {m: 'showShortcutFlight', el: 'sf-heli',
     visible: el => el.classList.contains('show'),
     pack: (pl, card) => ({p: Game.players.indexOf(pl),
                           c: {target: card.target, icon: card.icon, name: card.name, text: card.text}}),
     unpack: d => [Game.players[d.p], d.c, () => {}]},
  ],

  // 目前真正還開著的面板。driver 端的 netOverlay 是在 show* 被呼叫時記下來的，
  // 但「關閉」的路徑五花八門（各自的 hide、動畫結束、closeNetOverlays…），
  // 一條條去掛會再次漏掉——實際上 v1.92 就漏了：到站慶祝結束後沒人清 netOverlay，
  // 而 hideStallShop 裡的判斷還在比對舊格式的 .t，等於永遠不成立，
  // 於是 overlay 一直掛在 live 封包上，listener 的面板永遠關不掉。
  // 改成推送前直接看「那個面板的 DOM 現在還看得見嗎」，看不見就自動視為已關閉，
  // 不必掛任何關閉路徑。
  netOverlayNow() {
    const ov = this.netOverlay;
    if (!ov) return null;
    const def = this.NET_PANELS.find(x => x.m === ov.m);
    if (!def) { this.netOverlay = null; return null; }
    const el = document.getElementById(def.el);
    const shown = el && (def.visible ? def.visible(el) : getComputedStyle(el).display !== 'none');
    if (!shown) { this.netOverlay = null; return null; }
    // 面板開著期間會變動的東西（勾了哪幾項、揭曉到第幾階段）每一幀重算一次帶出去。
    // 跟座標一樣走「每幀重述現況」：漏一個封包下一幀就自動補正，不必為每一種變動
    // 各設計一套「有變動就發一次」的通知——那種寫法漏掉一處就是對方永遠停在舊畫面。
    if (!def.live) return ov;
    let extra = null;
    try { extra = def.live.call(this); } catch (_) {}
    return extra ? {m: ov.m, d: Object.assign({}, ov.d, extra)} : ov;
  },

  // 目前物產面板勾了哪幾項（driver 端每幀重算，見上面的 live）
  stallSelectionNow() {
    const listEl = document.getElementById('ss-list');
    if (!listEl) return [];
    return Array.from(listEl.querySelectorAll('.ss-item-check:checked'))
      .map(cb => parseInt(cb.dataset.idx, 10));
  },

  // listener：照 driver 揭曉的下一個目的地顯示。
  // 下一站是 Game.pickDestination() 隨機挑的，一定要用 driver 挑到的那一個——
  // 讓 listener 自己挑會挑到不一樣的站，兩邊看到的下一個目的地就對不起來。
  applyDestReveal(d) {
    if (!d) return;
    if (d.nx && this._destNextId !== d.nx) {
      this._destNextId = d.nx;
      const next = Data.stations.get(d.nx);
      if (next) {
        document.getElementById('dc-prompt').classList.remove('show');
        document.getElementById('dc-next-name').textContent = next.name;
        document.getElementById('dc-next').classList.add('show');
      }
    }
    if (d.sh && !this._destNextShown) {
      this._destNextShown = true;
      const c = document.getElementById('dc-continue');
      if (c) c.classList.add('show');
    }
  },

  // listener：跟著 driver 的年度決算階段走（排名 → 折線圖）。
  // 只往前推不倒退；'playing → result' 本機自己的計時器就會推進，不用等對方。
  applyAnnualPhase(ph) {
    if (ph === 'chart' && this._annualPhase === 'result') {
      this._doAdvanceAnnualPhase();
      // 換了階段，黃字與「還在等誰」要立刻照新階段的票重畫一次。
      // 只等下一次票的事件會慢一拍，看起來像是上一輪的人已經按過了。
      this.applyAnnualVotes(this._annualVotes);
    }
  },

  // 在 init 時把上面每個 show* 包一層：driver 呼叫時順手記錄成 netOverlay。
  // 包裝在外面做，原本的函式一行都不用改。
  _wrapNetPanels() {
    this.NET_PANELS.forEach(def => {
      const orig = this[def.m];
      if (typeof orig !== 'function' || orig._netWrapped) return;
      const self = this;
      const wrapped = function (...args) {
        if (!self._netReadOnly && typeof Game !== 'undefined' && Game.netGroup
            && typeof Game.hasToken === 'function' && Game.hasToken()) {
          try { self.netOverlay = {m: def.m, d: def.pack.apply(null, args)}; } catch (_) {}
        }
        return orig.apply(self, args);
      };
      wrapped._netWrapped = true;
      this[def.m] = wrapped;
    });
  },

  // listener：照著 overlay 把對應面板開起來
  openNetPanel(ov) {
    const def = this.NET_PANELS.find(x => x.m === ov.m);
    if (!def) return;
    let args;
    try { args = def.unpack(ov.d); } catch (_) { return; }
    if (!args) return;
    this._netReadOnly = true;
    try { this[def.m].apply(this, args); } catch (_) {}
    this._netReadOnly = false;
  },

  // 掉線的人接回自己的角色時宣布一次。
  // toast 本身就是廣播（見 toast 開頭的 _broadcast），所以全場都看得到；
  // 這一刻剛好在跨月的話，同一行字也疊在月曆橫幅上——那正是使用者要的位置，
  // 而回合交界不一定有橫幅（三個人玩每三回合才換一次月），所以兩邊都做。
  announceRejoin(names) {
    const msg = `🎮 ${names.join('、')} 回來接手了`;
    this.toast(msg);
    const banner = document.getElementById('month-banner');
    const note = document.getElementById('month-banner-note');
    if (note && banner && banner.classList.contains('playing')) {
      note.textContent = msg;
      note.classList.add('show');
      clearTimeout(this._bannerNoteTimer);
      this._bannerNoteTimer = setTimeout(() => note.classList.remove('show'), 3400);
    }
  },

  // listener：面板已經開著、只是內容在變（勾選、揭曉階段…）時每一幀套用一次。
  // 由 NET_PANELS 上各自的 apply 負責，rules 那邊不必知道有哪些面板。
  // listener 端開起新聞快報時也要出聲。openNetPanel 會設 _netReadOnly，
  // showNewsReport 因此不自己播；改由這裡在「面板真的換了」的那一刻播一次。
  newsOpenedByNet() { SFX.newsSting(); },

  applyNetPanelLive(ov) {
    const def = this.NET_PANELS.find(x => x.m === ov.m);
    if (!def || !def.apply) return;
    try { def.apply.call(this, ov.d || {}); } catch (_) {}
  },

  // listener 端收到「演出結束」指令時把疊層收掉。listener 不會自己按 A，
  // 所以這些畫面只能靠持有 token 的那台下指令來收，否則會永遠停在慶祝畫面。
  closeNetOverlays() {
    this.netOverlay = null;
    this.NET_PANELS.map(d => d.el).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  },

  // ── 新聞快報 ──
  // 稱號、門檻、文案全部來自 rules 的 TYCOON_TITLES，這裡只負責畫。
  // 尺寸同時被「畫面寬的比例」與「可用高度」夾住：插圖是 1:1 的正方形，
  // 只夾寬度的話橫式畫面上字幕會掉出螢幕（模擬時實際踩到過）。
  NEWS_W_PCT: 72,
  showNewsReport(t, pl, done) {
    const el = document.getElementById('news-report');
    if (!el || !t) { done && done(); return; }
    this._newsDone = done;
    const money = n => n >= 10000 ? (n % 10000 ? (n / 10000).toFixed(1) : n / 10000) + '億' : n + '萬';
    document.getElementById('nr-img').src = t.img;
    document.getElementById('nr-copy').innerHTML =
        `<div class="nr-l">${t.lead}</div>`
      + `<div class="nr-l"><b>${pl.name}</b> ${t.body}</div>`
      + `<div class="nr-l">年<i>收入突破${money(t.goal)}</i>——</div>`
      + `<div class="nr-l">恭喜${t.verb} <b>${t.name}</b>！</div>`;
    // 誰能收掉：持 token 的那台（單機就是當下操作的人）。其他人只看得到等待字樣。
    const mine = !Game.netGroup || Game.hasToken();
    const prompt = document.getElementById('nr-prompt');
    prompt.className = mine ? 'nr-go' : 'nr-wait';
    prompt.innerHTML = mine ? '按 A ／空白鍵繼續' : `等 <b>${pl.name}</b> 按繼續⋯`;
    el.style.display = 'flex';
    this.layoutNewsReport();
    if (!this._netReadOnly) SFX.newsSting();   // listener 端由 openNetPanel 設 _netReadOnly，音效自己會響（見 _syncOverlay）
    return true;
  },
  layoutNewsReport() {
    const el = document.getElementById('news-report');
    if (!el || el.style.display === 'none') return;
    const card = document.getElementById('nr-card');
    const W = innerWidth, H = innerHeight;
    const narrow = W <= 700;
    const edge = narrow ? 8 : 14;
    const top = (narrow ? 8 + 32 : 14 + 40) + 6;      // 讓開右上那排圓鈕
    const side = W / H > 1.3;
    card.classList.toggle('side', side);
    const avail = H - top - edge, maxW = W * this.NEWS_W_PCT / 100;
    const px = side ? Math.min(avail, maxW / 1.95) : Math.min(maxW, avail / 1.52);
    if (side) { card.style.height = Math.round(px) + 'px'; card.style.width = Math.round(px * 1.95) + 'px'; }
    else      { card.style.height = 'auto';                card.style.width = Math.round(px) + 'px'; }
    card.style.right = edge + 'px'; card.style.top = top + 'px';
    document.getElementById('nr-copy').style.fontSize   = Math.max(12, Math.round(px * .066)) + 'px';
    document.getElementById('nr-prompt').style.fontSize = Math.max(11, Math.round(px * .058)) + 'px';
  },
  hideNewsReport() {
    const el = document.getElementById('news-report');
    if (el) el.style.display = 'none';
  },
  // 按 A（或點提示列）收掉。只有能收的人收得掉；收掉之後才換人。
  dismissNewsReport() {
    if (Game.netGroup && !Game.hasToken()) return;
    const done = this._newsDone; this._newsDone = null;
    this.hideNewsReport();
    this.netOverlay = null;
    if (done) done();
  },

  showDestinationCelebration(st, pl, bonus, done) {
    const overlay = document.getElementById('destination-celebration');
    // 舊版 HTML 沒有演出圖層時仍可繼續遊玩；正式 v0.73 會走下方完整動畫。
    if (!overlay) { done(Game.pickDestination(st.id)); return; }
    const train = document.getElementById('dc-train');
    clearTimeout(this._destPromptTimer); clearTimeout(this._destDoneTimer); clearTimeout(this._destAiTimer);
    this._destReady = false; this._destNextShown = false; this._destNextId = null;
    this._destDone = done; this._destStationId = st.id;
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
      // 到站的是電腦：沒有真人可以按，改成內部計時器自己等 2 秒後按（別按太快，
      // 不然其他玩家根本來不及看清楚下一站是哪裡）。真人到站則什麼都不做，等他自己按。
      // 提示音＋震動要等真的按下去那一刻才觸發（見 revealNextDestination），這裡只是
      // 畫面準備好接受按鍵，還沒有人按。
      if (pl.isAI) this._destAiTimer = setTimeout(() => this.revealNextDestination(), 2000);
    }, 3650);
    this.playDestinationCheer();
  },

  // 到站慶祝的「按 A」只能是到站的那位玩家本人（或沒人認領的鍵盤／滑鼠——主持人裝置），
  // 電腦到站則一律不接受任何手動按鍵，只能靠上面的內部計時器推進，避免其他玩家搶著幫
  // 電腦按、害大家看不到下一站是哪裡。
  destinationAllows(src) {
    const pl = Game.curPlayer();
    if (!pl || pl.isAI) return false;
    if (!Seats.active) return true;
    if (!Seats.registered(src)) return src === SRC_KB || src === SRC_MOUSE;
    return Seats.bySource.get(src) === Game.cur;
  },

  // 提示音＋震動：到站慶祝、年度決算這幾個「按 A 才能繼續」的畫面共用，在每一次「按 A」
  // 真的被接受、畫面往下推進的當下觸發（不是畫面剛出現、還沒人按的時候）。
  // 提示音給所有人聽到，代表「有人剛按下去了」；震動只給實際按下去的那個人感覺到——
  // 電腦內部計時器自動按（沒有 src）不會有任何裝置震動，其他人也不會被電腦的動作震到。
  playConfirmAlert(src) {
    SFX.ping();
    if (src) Input.vibrate(src);
  },

  playDestinationCheer() {
    // 改走 SFX（Web Audio）而不是自己的 <audio> 元素：iOS 的解鎖是綁在元素上的，
    // 而到站慶祝是動畫流程觸發的、等不到屬於自己的手勢——那個元素在手機上一直沒聲音。
    // cheer.mp3 只有 4 秒、本來就播完就停，所以不再需要 DEST_CHEER_STOP_DELAY 的計時器。
    clearTimeout(this._destCheerStopTimer);
    SFX.play('cheer');
  },

  // 捷徑卡片：直升機從 pl 目前位置飛到 card.target 站，飛行邏輯跟「捷徑卡片直升機動畫模擬」
  // v0.9 同一套（起飛/巡航/降落三段縮放、鏡頭直接貼著飛機snap，不用補間），差別是：
  // 這裡不重畫假地圖，直接疊在正式棋盤 canvas 上，座標用 Render.worldToCss 換算；
  // 「使用卡片」的提示沿用既有的 UI.showCardFlash，不用另外做一套卡片看板。
  showShortcutFlight(pl, card, done) {
    const heli = document.getElementById('sf-heli');
    const dest = Data.stations.get(card.target);
    if (!heli || !dest) { done(); return; }
    const HELI_STILL = '../圖片/玩家icon/直升機-靜止.png', HELI_FLY = '../圖片/玩家icon/直升機-飛行.png';
    const origin = {x: pl.ax, y: pl.ay};
    cancelAnimationFrame(this._sfFrame);
    clearTimeout(this._sfTimer);
    if (this._heliSfx) { this._heliSfx.stop(); this._heliSfx = null; }   // stop() 內含解除讓路
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
    // 卡片提示（#card-flash）整段淡入淡出是一個 1.55s 的 CSS 動畫（見 cardFlash
    // keyframes，82%~100% 淡出、剛好在 1550ms 時完全消失），原本只等 500ms 就讓
    // 直升機起飛，提示還蓋在畫面正中央，完全看不到起飛那一刻的動畫。改成等提示
    // 真的淡出消失後才起飛，兩段演出前後接、不重疊。
    this._sfTimer = setTimeout(() => {
      heli.src = HELI_FLY;
      heli.classList.add('fly');
      // 飛行中循環（原本是 <audio loop>，同樣因為元素解鎖問題在手機上不會響）。
      // 同時把背景音樂壓低——引擎聲是持續音，不讓路的話會被季節配樂蓋掉。
      // 飛行時間隨距離變動，所以用 duck(null) 一直壓著，落地再 unduck()。
      // 讓路已經由 SFX.loop() 自己負責（進場壓低、把手的 stop() 解除），
      // 這裡不再重複呼叫——所有音效統一在 SFX 裡讓路，呼叫端不必記得。
      this._heliSfx = SFX.loop('heli');
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
        if (this._heliSfx) { this._heliSfx.stop(); this._heliSfx = null; }
        Render.freeLook = false;
        Render.follow(dest.x, dest.y);
        done();
      };
      tick();
    }, 1550);
  },

  // src 是誰按的：鍵盤／手把由統一輸入層在呼叫前先做過 destinationAllows() 檢查；
  // 滑鼠按鈕與電腦內部計時器則各自傳固定值／不傳，這裡再檢查一次（防呆，不依賴呼叫端
  // 一定記得先查）。src === undefined 只有電腦到站的內部計時器會這樣呼叫，一定放行。
  revealNextDestination(src) {
    // listener 只看不揭曉：它的 _destDone 是空函式（openNetPanel 塞的），會一路跑下去
    // 自己抽一個下一站出來顯示，跟 driver 抽到的不是同一個。畫面由 applyDestReveal 還原。
    if (typeof Game !== 'undefined' && Game.isListener && Game.isListener()) return;
    if (src !== undefined && !this.destinationAllows(src)) { if (Seats.registered(src)) Seats.denyHint(); return; }
    if (!this._destReady || !this._destDone) return;
    this.playConfirmAlert(src);
    clearTimeout(this._destAiTimer);
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
    const pl = Game.curPlayer();
    this._destDoneTimer = setTimeout(() => {
      this._destNextShown = true;
      this._destReady = true;
      const continuePrompt = document.getElementById('dc-continue');
      if (continuePrompt) continuePrompt.classList.add('show');
      // 電腦到站：等 5 秒再自動按「繼續」，比揭曉下一站的 2 秒更久一點——這是整段
      // 演出最後一步，大家都還在看下一站是哪裡，不要太快把整個畫面收掉。
      if (pl && pl.isAI) this._destAiTimer = setTimeout(() => this.revealNextDestination(), 5000);
    }, 500);
  },

  showAnnualSettlement(data, done) {
    const overlay = document.getElementById('annual-settlement');
    if (!overlay) { done(); return; }
    clearTimeout(this._annualResultTimer); clearTimeout(this._annualSpeechTimer);
    this._annualPhase = 'playing'; this._annualDone = done; this._annualData = data;
    this._annualConfirmed = new Set();
    this._annualDeadline = 0;
    clearInterval(this._annualAutoTimer); this._annualAutoTimer = null;
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
      // data-player 記住這一列對應的玩家 index（用名字比對，跟上面 previous 的寫法一樣），
      // 之後有人按 A 確認時才知道要把哪一列的名字變黃色。
      row.dataset.player = Game.players.findIndex(gp => gp.name === p.name);
      row.innerHTML = `<span class="as-rank">${i === 0 ? '👑' : '#' + (i + 1)}</span><span class="as-name">${p.name}</span><span class="as-total">${formatMoney(p.total)}元</span><span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(change))}</span>`;
      rows.appendChild(row); setTimeout(() => row.classList.add('show'), 450 + i * 780);
    });
    this._annualSpeechTimer = setTimeout(() => document.getElementById('as-speech').classList.add('hide'), 1450);
    this._annualResultTimer = setTimeout(() => {
      const winner = data.ranking[0];
      document.getElementById('as-leader-info').textContent = `${winner.name}以 ${formatMoney(winner.total)}元 暫居第一名`;
      document.getElementById('as-leader').classList.add('show'); document.getElementById('as-leader-info').classList.add('show');
      document.getElementById('as-prompt').classList.add('show'); this._annualPhase = 'result';
      this.armAnnualConfirms();
    }, 4100 + Math.max(0, data.ranking.length - 1) * 780);
  },

  // 年度決算跟到站慶祝不同：不是「誰的回合就誰按」，而是在場「每一位」玩家都要各自按過
  // 一次才能繼續（一年一度的結算大家都該看過，不能被某個人手快直接按掉）。src 不傳（或
  // Seats 沒啟用，例如純電腦對戰觀戰模式）時退回舊行為：任何一次按鍵就直接推進。
  advanceAnnualSettlement(src) {
    if (!this._annualDone || this._annualPhase === 'playing') return;
    // 連線對戰：規則跟單機一樣「在場每一位玩家都要各自按過一次」，但票要送得出去。
    // 每台只寫屬於自己那一格（形狀跟 /ready、/offers 一樣），由驅動者看到齊了才推進。
    // v1.98 一度改成「持 token 的那台按了就算」，那是因為當時還沒有讓別台把票送過來的
    // 通道；語意跟單機不一致，現在補回來。
    if (Game.netGroup) {
      const seat = Seats.registered(src) ? Seats.bySource.get(src) : null;
      if (seat == null) { Seats.denyHint(); return; }   // 這台沒有認領任何角色（純觀戰）
      Net.voteAnnual(this._annualPhase, seat);
      return;
    }
    if (!Seats.active) { this._doAdvanceAnnualPhase(); return; }
    if (!Seats.registered(src)) { Seats.denyHint(); return; }
    this.confirmAnnual(Seats.bySource.get(src));
  },

  // 每進入一個新的「按 A 才能繼續」階段就重新排一輪：電腦玩家各自隨機等 1~3 秒後自動確認，
  // 真人玩家等他們自己按。不用共用同一個計時器，避免多台電腦剛好同時按、看起來很假。
  // 同時把上一輪留下的「已確認」黃字清掉——這是新的一輪，要重新看誰按過。
  ANNUAL_AUTO_MS: 10000,   // 沒按的人等這麼久就自動幫他按（見下面的說明）
  armAnnualConfirms() {
    this._annualConfirmed = new Set();
    document.querySelectorAll('.as-row .as-name.confirmed').forEach(el => el.classList.remove('confirmed'));
    clearInterval(this._annualAutoTimer); this._annualAutoTimer = null;
    if (Game.netGroup) {
      // 這一輪的票要從零開始，否則第二輪（折線圖）會帶著第一輪的票直接跳過。
      // 清票與代投電腦格都只由驅動者做，兩台搶著清會互相打掉。
      if (!Game.hasToken()) { this.renderAnnualWaiting(); return; }
      const phase = this._annualPhase;
      Net.clearAnnualPhase(phase).then(() => {
        Game.players.forEach((p, i) => {
          if (p.isAI) setTimeout(() => { if (this._annualPhase === phase) Net.voteAnnual(phase, i); },
                                 1000 + Math.random() * 2000);
        });
        this._annualDeadline = 0;
        this._annualAutoTimer = setInterval(() => this.tickAnnualAuto(phase), 250);
      });
      this.renderAnnualWaiting();
      return;
    }
    Game.players.forEach((p, i) => {
      if (p.isAI) setTimeout(() => this.confirmAnnual(i), 1000 + Math.random() * 2000);
    });
  },

  // 逾時自動按：只有驅動者跑這個計時器（每台各跑一個會互相代按別人的格子）。
  // 有人斷線全場暫停時要停錶——不然暫停 30 秒，一解除就把好幾輪確認同時自動按掉。
  tickAnnualAuto(phase) {
    if (this._annualPhase !== phase || !Game.hasToken()) {
      clearInterval(this._annualAutoTimer); this._annualAutoTimer = null; return;
    }
    if (Game.netPaused) { this._annualDeadline = 0; this.renderAnnualWaiting(); return; }
    if (!this._annualDeadline) this._annualDeadline = Date.now() + this.ANNUAL_AUTO_MS;
    this.renderAnnualWaiting();
    if (Date.now() < this._annualDeadline) return;
    clearInterval(this._annualAutoTimer); this._annualAutoTimer = null;
    Game.players.forEach((p, i) => { if (!this._annualConfirmed.has(i)) Net.voteAnnual(phase, i); });
  },

  // 收到全場的票：畫黃字，並由驅動者判斷是不是可以往下走
  applyAnnualVotes(votes) {
    if (!Game.netGroup) return;
    this._annualVotes = votes || {};   // 階段推進之後要重畫一次，見 applyAnnualPhase
    const mine = (votes && votes[this._annualPhase]) || {};
    this._annualConfirmed = new Set(Object.keys(mine).map(Number));
    document.querySelectorAll('.as-row').forEach(row => {
      const nameEl = row.querySelector('.as-name');
      if (!nameEl) return;
      nameEl.classList.toggle('confirmed', this._annualConfirmed.has(parseInt(row.dataset.player, 10)));
    });
    this.renderAnnualWaiting();
    if (this._annualPhase === 'playing' || this._annualPhase === 'done') return;
    if (!Game.hasToken()) return;   // 推進權在驅動者，其他人靠階段同步跟上
    if (this._annualConfirmed.size >= Game.players.length) this._doAdvanceAnnualPhase();
  },

  // 「還在等誰」＋倒數。沒有這行的話畫面會像是自己跳過去了，也看不出來是誰在卡。
  renderAnnualWaiting() {
    const el = document.getElementById('as-waiting');
    if (!el) return;
    if (!Game.netGroup || this._annualPhase === 'playing' || this._annualPhase === 'done') {
      el.classList.remove('show'); return;
    }
    const waiting = Game.players.map((p, i) => this._annualConfirmed.has(i) ? null : p.name).filter(Boolean);
    if (!waiting.length) { el.classList.remove('show'); return; }
    const left = this._annualDeadline ? Math.max(0, Math.ceil((this._annualDeadline - Date.now()) / 1000)) : null;
    el.textContent = `還在等 ${waiting.join('、')}${Game.netPaused ? '（暫停中）' : (left != null ? `　${left}` : '')}`;
    el.classList.add('show');
  },

  // src 不傳（電腦玩家自己確認）時不用震動任何裝置，Input.vibrate 對非手把 id 本來就會
  // 安靜忽略；名字變黃只在排行榜列（result 階段）看得到，chart 階段的列被圖表整個蓋住，
  // 沒有畫面可看不影響邏輯正確性。
  confirmAnnual(idx) {
    if (this._annualPhase === 'playing' || this._annualPhase === 'done') return;
    if (this._annualConfirmed.has(idx)) return;
    this._annualConfirmed.add(idx);
    this.playConfirmAlert(Seats.byPlayer.get(idx));
    const row = document.querySelector(`.as-row[data-player="${idx}"] .as-name`);
    if (row) row.classList.add('confirmed');
    // 連線模式的推進權在持 token 的那台（見 advanceAnnualSettlement），這裡只標記誰按過
    if (Game.netGroup) return;
    if (this._annualConfirmed.size >= Game.players.length) this._doAdvanceAnnualPhase();
  },

  _doAdvanceAnnualPhase() {
    if (this._annualPhase === 'result') {
      this.drawAnnualChart(this._annualData.history);
      document.getElementById('as-chart').classList.add('show'); document.getElementById('as-prompt').classList.remove('show');
      this._annualPhase = 'chart';
      this.armAnnualConfirms();
      return;
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

  // 骰子散落用的位置表，跟「擲骰動畫模擬」v1.3 完全同一套：depth 由後到前分三層，
  // 同一層只左右錯開，不會互相蓋住上方點數面；每次擲骰重新隨機排列前後關係。
  DICE_DEPTH_Y: [34, 54, 74],
  DICE_LAYOUTS: {
    1: [{x: 72, depth: 1}],
    2: [{x: 58, depth: 0}, {x: 72, depth: 2}],
    3: [{x: 45, depth: 0}, {x: 70, depth: 1}, {x: 58, depth: 2}],
    5: [{x: 43, depth: 0}, {x: 70, depth: 0}, {x: 55, depth: 1}, {x: 78, depth: 1}, {x: 66, depth: 2}],
  },
  DICE_BASE_WIDTH: {1: 205, 2: 180, 3: 160, 5: 135},
  // 起始／落下位置與大小改讀共用設定檔 dice_settings.js（跟「擲骰動畫模擬」、宣傳短片
  // 共用），沒有這個檔案時退回原本寫死的位置（落下 63%/72%，起始左上方 8%/8%）。
  DICE_POS_DEFAULT: {start: {top: 8, left: 8, scale: .22}, end: {top: 63, left: 72, scale: 1}},
  dicePos() {
    const s = window.DICE_SETTINGS;
    return (s && s.start && s.end) ? s : this.DICE_POS_DEFAULT;
  },
  shuffleDice(a) { return a.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v); },
  // 每顆骰子擲出時各自的「彈跳手感」曲線，跟模擬器一樣：5 種曲線互相錯開時間與旋轉
  // 方向、飛行中途「比落地更大」的頂點倍率也各自略有不同，多顆骰子不會整齊到很假。
  DICE_THROW_SHAPES: [
    {delay: 0,  spins: 2.2, dir: 1,  overshoot: 1.32},
    {delay: 40, spins: 2.6, dir: -1, overshoot: 1.38},
    {delay: 70, spins: 2.0, dir: 1,  overshoot: 1.28},
    {delay: 20, spins: 2.4, dir: -1, overshoot: 1.34},
    {delay: 90, spins: 2.8, dir: 1,  overshoot: 1.40},
  ],
  DICE_THROW_MS: 800, DICE_LAND_MS: 280,

  // 拋物線＋「小→比落地更大→縮回落地大小」的縮放包絡，跟「擲骰動畫模擬」v1.3
  // 完全同一套算法：位置是直線內插疊加一個往上拱起的弧形（模擬拋物線重力弧），
  // 大小前 70% 進度長到比落地更大的頂點，後 30% 再縮回真正的落地大小。
  buildDicePath(startPx, endPx, startScale, endScale, shape) {
    const dx = endPx.x - startPx.x, dy = endPx.y - startPx.y;
    const dist = Math.hypot(dx, dy);
    const arcHeight = Math.max(70, dist * .32);
    const peakScale = endScale * shape.overshoot;
    const steps = [0, .1, .22, .36, .5, .6, .66, .7, .74, .8, .9, 1];
    return steps.map(t => {
      const lift = 4 * arcHeight * t * (1 - t);
      const px = startPx.x + dx * t - endPx.x;
      const py = startPx.y + dy * t - lift - endPx.y;
      const scale = t < .7 ? startScale + (peakScale - startScale) * (t / .7) : peakScale + (endScale - peakScale) * ((t - .7) / .3);
      const opacity = t < .1 ? t / .1 : 1;
      const rot = shape.dir * shape.spins * 360 * t;
      return {transform: `translate(-50%,-50%) translate(${px}px,${py}px) scale(${scale}) rotate(${rot}deg)`, opacity, offset: t};
    });
  },
  throwDie(die, startPx, endPx, startScale, endScale, shape) {
    die.style.left = endPx.x + 'px';
    die.style.top = endPx.y + 'px';
    return die.animate(this.buildDicePath(startPx, endPx, startScale, endScale, shape),
      {duration: this.DICE_THROW_MS, delay: shape.delay, easing: 'cubic-bezier(.33,.1,.2,1)', fill: 'both'});
  },
  landDie(die, endScale) {
    // 落地一個很短的橢圓壓縮回彈（寬扁一下再彈回正常比例），跟飛行中的「變大」明確
    // 區分開來，比較像真的觸地重量感。
    return die.animate([
      {transform: `translate(-50%,-50%) scale(${endScale * .94}, ${endScale * 1.05})`, filter: 'brightness(1.3) drop-shadow(0 10px 8px rgba(0,0,0,.5))'},
      {transform: `translate(-50%,-50%) scale(${endScale})`, filter: 'drop-shadow(0 16px 10px rgba(0,0,0,.42))'},
    ], {duration: this.DICE_LAND_MS, easing: 'cubic-bezier(.2,1.5,.45,1)', fill: 'both'});
  },

  // 骰子飛出／翻滾：使用六面立體骰子圖，位置與大小由 dicePos() 決定。骰子落地時立即
  // 建立下一步的方向按鈕；骰子仍停留到按鍵後淡出，並把同一個鍵轉交給已出現的移動流程。
  showDice(finalValues, total, done) {
    // 音效放在這裡而不是 Game.roll()：roll() 開頭就擋掉 listener（沒 token 不准改狀態），
    // 音效跟著卡在那裡，於是別台看得到骰子動畫卻沒有聲音。
    // showDice 是「畫骰子」這件事的共同入口，driver 與 listener 都會走到。
    SFX.play('dice');
    const el = document.getElementById('dice'), totalEl = document.getElementById('dice-total');
    const count = finalValues.length;
    // 位置表沒有剛好對應的骰子數（目前只有 1/2/3/5 顆的情況）就退回單顆的位置，不會整段掛掉。
    const layout = this.DICE_LAYOUTS[count] || this.DICE_LAYOUTS[1];
    const spots = this.shuffleDice(layout).map(spot => ({...spot, x: Math.max(8, Math.min(92, spot.x + (Math.random() * 6 - 3)))}));
    const shapes = this.shuffleDice(this.DICE_THROW_SHAPES.slice(0, count));
    const cfg = this.dicePos();
    const vw = innerWidth, vh = innerHeight;
    const startPx = {x: vw * cfg.start.left / 100, y: vh * cfg.start.top / 100};
    const endAnchorPx = {x: vw * cfg.end.left / 100, y: vh * cfg.end.top / 100};
    const baseWidth = this.DICE_BASE_WIDTH[count] || this.DICE_BASE_WIDTH[1];

    clearInterval(this._diceTicker); clearTimeout(this._diceDone); clearTimeout(this._diceFade);
    el.innerHTML = ''; totalEl.classList.remove('show');
    const values = finalValues.map(() => 1 + Math.floor(Math.random() * 6));
    const dice = spots.map((spot, i) => {
      const die = document.createElement('span');
      die.className = `die face-${values[i]}`;
      die.style.width = baseWidth + 'px';
      die.style.zIndex = String(spot.depth + 1);
      el.appendChild(die);
      const endPx = {
        x: endAnchorPx.x + (spot.x - 72) / 100 * 340 * cfg.end.scale,
        y: endAnchorPx.y + (this.DICE_DEPTH_Y[spot.depth] - 54) / 100 * 220 * cfg.end.scale,
      };
      const anim = this.throwDie(die, startPx, endPx, cfg.start.scale, cfg.end.scale, shapes[i % shapes.length]);
      return {el: die, anim, endPx, endScale: cfg.end.scale};
    });
    this._diceTicker = setInterval(() => dice.forEach((d, i) => {
      d.el.className = d.el.className.replace(/face-\d+/, `face-${1 + Math.floor(Math.random() * 6)}`);
    }), 85);
    const maxDelay = Math.max(...shapes.map(s => s.delay));
    this._diceDone = setTimeout(() => {
      clearInterval(this._diceTicker);
      // 落地要用真正的骰子結果 finalValues（決定合計點數與移動步數的那組數字），
      // 不是 values——values 只是滾動翻面特效用的隨機臉，settle 這裡如果誤用它，
      // 骰子畫面停下來顯示的點數會跟實際移動的步數對不上（玩家看到的跟遊戲跑的不同）。
      dice.forEach((d, i) => { d.el.className = `die face-${finalValues[i]}`; this.landDie(d.el, d.endScale); });
      totalEl.style.left = endAnchorPx.x + 'px';
      totalEl.style.top = (endAnchorPx.y - 110 * cfg.end.scale) + 'px';
      totalEl.textContent = `合計 ${total} 點`;
      totalEl.classList.add('show');
      // 不等待按鍵，先讓可移動方向出現；按鍵只負責收起骰子並可立即選方向。
      done && done();
      const isAI = !!Game.curPlayer()?.isAI;
      if (isAI) {
        // 電腦的方向已建立，落地後停留片刻再淡出；AI 本身照原流程自動選路。
        this._diceAwaiting = {dice, totalEl};
        setTimeout(() => this.dismissDiceAfterKey(null), 550);
      } else {
        this._diceAwaiting = {dice, totalEl};
      }
    }, this.DICE_THROW_MS + maxDelay);
  },

  dismissDiceAfterKey(event) {
    const waiting = this._diceAwaiting;
    if (!waiting) return false;
    this._dropLiveDice();   // 淡出也算「骰子收起來了」，觀察者要跟著收
    this._diceAwaiting = null;
    const {dice, totalEl} = waiting;
    dice.forEach(d => d.el.animate([{opacity: 1}, {opacity: 0}], {duration: 500, fill: 'both'}));
    totalEl.animate([{opacity: 1}, {opacity: 0}], {duration: 500, fill: 'both'});
    this._diceFade = setTimeout(() => {
      this._diceFade = null;
      dice.forEach(d => d.el.remove());
      totalEl.classList.remove('show');
      // 讓觸發淡出的同一顆鍵交給已經出現的岔路按鈕；合成事件只走既有鍵盤邏輯。
      // 統一輸入層的監聽器是掛在 document（見上面 UI.init 的 document.addEventListener），
      // 不是 window——事件路徑只會走「目標元素往上」的祖先鏈，直接對 window 送出的事件
      // 完全不會經過 document 上的監聽器。以前這裡誤用 window.dispatchEvent()，等於重送
      // 的這顆鍵整個石沉大海，玩家要多按一次同方向鍵才會真的選到岔路，鍵盤/手把都一樣。
      if (event) {
        const replay = new KeyboardEvent('keydown', {key:event.key, code:event.code, bubbles:true, cancelable:true});
        document.dispatchEvent(replay);
      }
    }, 500);
    return true;
  },

  // 抵達站點或換人時，骰子畫面不應跨回合殘留；連同尚未執行的淡出／重送按鍵一起取消。
  // 驅動者這台一旦讓骰子從畫面上消失，live 封包就要跟著不帶骰子，觀察者才會一起收掉。
  // 骰子消失有兩條路徑，兩條都要呼叫這個：
  //  ‧ clearDice()：land／quitToSetup／nextPlayer 走這條
  //  ‧ dismissDiceAfterKey()：列車開始移動時的淡出走這條——它是直接把元素動畫後移除，
  //    完全不經過 clearDice()，v1.89 只補了前者，所以「開始走之後別人畫面上還留著骰子」。
  _dropLiveDice() {
    if (typeof Game !== 'undefined' && Game.netGroup
        && typeof Game.hasToken === 'function' && Game.hasToken()) Game._liveDice = null;
  },

  clearDice() {
    this._dropLiveDice();
    clearInterval(this._diceTicker);
    clearTimeout(this._diceDone);
    clearTimeout(this._diceFade);
    this._diceAwaiting = null;
    this._diceFade = null;
    const el = document.getElementById('dice');
    if (el) el.innerHTML = '';
    const totalEl = document.getElementById('dice-total');
    if (totalEl) totalEl.classList.remove('show');
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
  // 目前畫面上開著什麼面板。持有 token 的那台把它放進 live 封包（見 rules 的 pushNetLive），
  // 觀察者照著開／關／勾選。用「每幀重述現況」而不是「開/關兩個一次性指令」——
  // 後者漏掉一則就永遠卡住（面板一直開著或根本沒開），前者下一幀就自動修正。
  netOverlay: null,

  // 外部（觀察者收到 live）套用勾選狀態
  applyStallSelection(indices) {
    const listEl = document.getElementById('ss-list');
    if (!listEl) return;
    const set = new Set(indices || []);
    listEl.querySelectorAll('.ss-item-check').forEach(cb => {
      cb.checked = set.has(parseInt(cb.dataset.idx, 10));
    });
  },
  _syncStallOverlay(stId) {
    if (!this.netOverlay || this.netOverlay.m !== 'showStallShop' || !this.netOverlay.d) return;
    const listEl = document.getElementById('ss-list');
    this.netOverlay.d.sel = Array.from(listEl.querySelectorAll('.ss-item-check:checked'))
      .map(cb => parseInt(cb.dataset.idx, 10));
  },

  // readOnly：觀察者端。方塊全部鎖住（自己勾了卻跟畫面對不上會很混亂），
  // 也不搶 focus（那會讓畫面莫名跳動）。
  showStallShop(st, pl, readOnly) {
    document.getElementById('ss-title').textContent = `${st.name}　${pl.name} 的資金：${formatMoney(pl.money)}元`;
    const listEl = document.getElementById('ss-list');
    listEl.innerHTML = '';

    // 全選：勾了會自動依序勾選買得起的品項，並把 focus 移到「確定」鈕——
    // 還要再按一次確定鍵（空白鍵／A）才會真的送出購買，不是勾了就直接買
    const allRow = document.createElement('label');
    allRow.className = 'ss-check-row ss-select-all';
    allRow.innerHTML = `<input type="checkbox" id="ss-select-all">`
      + `<span class="ss-name">全選</span>`
      + `<span class="ss-note">買得起的全勾起來</span>`;
    listEl.appendChild(allRow);

    // 條列式：名稱靠左、價格靠右，勾不下去的直接寫出原因（已被誰買走／錢不夠）。
    // 手機上原本整列都是同一串文字、勾選與否只差一個小方框，實際玩起來看不出來
    // 自己到底勾了什麼，所以改成一列一格、勾起來整列變色。
    st.stalls.forEach((s, i) => {
      const owned = s.owner != null;
      const afford = pl.money >= s.price;
      const row = document.createElement('label');
      row.className = 'ss-check-row' + (owned ? ' ss-owned' : (!afford ? ' ss-poor' : ''));
      const ownerName = owned ? (Game.players[s.owner] ? Game.players[s.owner].name : '已售出') : '';
      const right = owned ? `<span class="ss-note">${ownerName} 已購入</span>`
                  : !afford ? `<span class="ss-price">${formatMoney(s.price)}元</span><span class="ss-note">資金不足</span>`
                  : `<span class="ss-price">${formatMoney(s.price)}元</span>`;
      row.innerHTML = `<input type="checkbox" class="ss-item-check" data-idx="${i}"${(owned || !afford) ? ' disabled' : ''}>`
        + `<span class="ss-name">${s.name}</span>${right}`;
      listEl.appendChild(row);
    });

    const selectAllCb = document.getElementById('ss-select-all');
    selectAllCb.checked = false;
    if (readOnly) {
      // 觀察者：全部鎖住，只看不動
      listEl.querySelectorAll('input').forEach(cb => { cb.disabled = true; });
      ['ss-confirm', 'ss-skip'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
      document.getElementById('stall-shop').style.display = 'flex';
      return;
    }
    ['ss-confirm', 'ss-skip'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = false; });
    // 勾選一有變動就更新 overlay，下一個 live 封包就會帶出去
    listEl.querySelectorAll('.ss-item-check').forEach(cb => {
      cb.addEventListener('change', () => this._syncStallOverlay(st.id));
    });
    selectAllCb.onchange = () => {
      if (!selectAllCb.checked) return;
      let remaining = pl.money;
      listEl.querySelectorAll('.ss-item-check:not(:disabled)').forEach(cb => {
        const s = st.stalls[parseInt(cb.dataset.idx, 10)];
        if (s.price <= remaining) { cb.checked = true; remaining -= s.price; }
      });
      this._syncStallOverlay(st.id);
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
      row.innerHTML = `<input type="checkbox" class="debt-item-check" data-idx="${i}" data-sell="${sellPrice}">`
        + `<span class="ss-name">${s.name}</span><span class="ss-price">${formatMoney(s.price)}元</span>`
        + `<span class="sell-price">賣 ${formatMoney(sellPrice)}</span>`;
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

  // 連線時，持有 token 的那台講的話要讓全場都看到。
  // 在這個出口統一攔截，26 處呼叫點一次補齊，以後新增的訊息也自動同步。
  // 沒有 token 的裝置不會廣播——像「現在輪到 XXX」這種本機拒絕提示天然被排除掉。
  _broadcast(cmd) {
    if (typeof Game === 'undefined' || !Game.netGroup) return;
    if (typeof Game.hasToken !== 'function' || !Game.hasToken()) return;
    if (typeof Net !== 'undefined' && Net.pushCmd) Net.pushCmd(cmd);
  },

  toast(msg, duration = 2600, opts) {
    if (!(opts && opts.localOnly)) this._broadcast({type: 'toast', msg, duration});
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('show'), duration);
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
      // 橫幅收掉、交通工具重新出現在畫面上的這一刻才出聲（使用者要的時機），
      // 而且聲音要跟著玩家搭的東西走——見 Game.vehicleCue。
      // 兩層 rAF 是為了「渲染後」：removeClass 之後第一個 rAF 還在同一幀的繪製前，
      // 第二層才保證「沒有橫幅的那一幀已經畫出來了」——跟本檔其他地方
      // （月曆橫幅重播、到站列車滑入）用的是同一個手法。
      // driver 與 listener 都會走到這裡（listener 由 applyTurnPresentation 呼叫），
      // 所以兩邊同步；跨年時橫幅是在年度結算之後才播，時機自然也對。
      requestAnimationFrame(() => requestAnimationFrame(
        () => Game.vehicleCue((Game.curPlayer() || {}).vehicleMode)));
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
