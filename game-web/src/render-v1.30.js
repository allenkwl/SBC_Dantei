// ────────────────────────────────────────────────
//  render.js — Canvas 渲染：背景、路線、站點、棋子、鏡頭
// ────────────────────────────────────────────────
const Render = {
  canvas: null, ctx: null,
  cam: {x: 1184, y: 228, scale: 9.6, tx: 1184, ty: 228, tscale: 9.6},
  ZOOM_NEAR: 9.6, ZOOM_LOOK: 6,
  freeLook: false,         // true = 玩家手動拖曳/點小地圖看別處，鏡頭不再跟隨列車
  drag: null,
  panKeys: {left: false, right: false, up: false, down: false},   // 擲骰前用方向鍵捲動地圖
  scoutStation: null,      // 探路放大鏡游標目前對到的站點 id（null＝沒有開探路模式）
  lastFrameT: null,
  _edgeArrow: null,        // 目的地邊緣箭頭目前畫在螢幕上的位置（CSS px），供點擊判斷
  reachableStations: new Set(), // Y 目的地模式中，剛好可消耗完骰子點數的站點
  bgImg: null, bgReady: false,
  trainImgs: {}, vehicleImgs: {}, typeIcons: {}, tintCache: {},
  decoImgs: {},            // '場景-季節' → Image（背景裝飾，依遊戲月份切換季節）
  routePaths: [],          // [{color, width, path2d}]
  anims: [],               // 移動中的補間
  onFrame: null,           // 每幀回呼（UI 疊層用）

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // 畫布「內部解析度」（canvas.width/height）跟它「實際顯示的 CSS 尺寸」
    // （clientWidth/clientHeight）只要兜不起來，瀏覽器就會把整張畫布的內容直接拉伸／
    // 壓扁去塞進實際的框——這正是手機轉方向時地圖比例跑掉的原因，不是下面畫地圖的
    // 邏輯歪掉（frame() 畫地圖時 x／y 本來就是同一個縮放倍率，不會自己把內容畫歪）。
    //
    // 手機轉方向時這個「兜不起來」特別容易發生：① 只監聽 resize 不夠，有些行動瀏覽器
    // 轉向時 resize 觸發得晚，或乾脆不觸發，要另外補聽 orientationchange；② 轉向當下
    // 網址列／工具列還在收合動畫，resize／orientationchange 觸發的那個瞬間，
    // clientWidth/clientHeight 量到的常常還是動畫中途的過渡值，不是最終穩定值，
    // 所以量一次不夠，要在動畫穩定後（約 300ms）再補量一次。
    // iPad 用的是同一套 clientWidth/clientHeight 量測邏輯，這裡修好後兩邊一起修好，
    // 不用另外寫平板專用的分支。
    const fit = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    };
    let fitSettleTimer = null;
    const fitAndSettle = () => {
      fit();
      clearTimeout(fitSettleTimer);
      fitSettleTimer = setTimeout(fit, 300);
    };
    addEventListener('resize', fitAndSettle);
    addEventListener('orientationchange', fitAndSettle);
    fit();

    this.bgImg = new Image();
    this.bgImg.onload = () => { this.bgReady = true; };
    this.bgImg.src = 'assets/map_bg.svg?v=41';

    // 四種車型正式改用「列車-黑邊」重繪圖（使用者提供，本身已經是乾淨的黑色描邊線稿，
    // 在 vehicle_test.html 的「黑邊重繪候選」比對確認過）：local＝慢車（普通車）、
    // express＝快車（區間車）、tzechiang＝自強號（普悠瑪）、hsr＝高鐵。
    // 這幾張圖已經有外框，不用再疊程式產生的黑邊（vehicle_test.html 的 NO_AUTO_OUTLINE
    // 就是為了跳過這一步；正式遊戲的 getTintedTrain 本來就沒有疊外框那道手續，不用另外處理）。
    // 舊的扁平風／舊畫風圖檔還留在 assets/trains/ 底下，只有 vehicle_test.html
    // （走不帶版本號的 render.js）會載入來做新舊比較，正式遊戲不再載入。
    const TRAIN_FILE = {
      local: 'train_black_local', local2: 'train_black_local',
      express: 'train_black_express',
      tzechiang: 'train_black_tzechiang', puyuma: 'train_black_tzechiang',
      hsr: 'train_black_hsr', hsr2: 'train_black_hsr',
    };
    ['local','local2','express','tzechiang','puyuma','hsr','hsr2','tourism'].forEach(k => {
      const img = new Image();
      img.src = `assets/trains/${TRAIN_FILE[k] || 'train_' + k}.png`;
      this.trainImgs[k] = img;
    });
    // 船運/飛機航線上，棋子改顯示遊輪/飛機（單張圖示，不是列車那種前後兩截車廂畫法）
    [['ship', '遊輪'], ['plane', '飛機']].forEach(([key, file]) => {
      const img = new Image();
      img.src = `assets/vehicles/${encodeURIComponent(file)}.png`;
      this.vehicleImgs[key] = img;
    });
    // 圖示檔名直接用中文 iconKey（跟編輯器 ICON_DATA、map_data 的 typeStyle.iconKey／站點 iconKey 一致），
    // 不再另外維護一份跟編輯器獨立的英文檔名對照表
    const iconKeys = new Set();
    Object.values(Data.typeStyle).forEach(ts => { if (ts.iconKey) iconKeys.add(ts.iconKey); });
    Data.stations.forEach(st => { if (st.iconKey) iconKeys.add(st.iconKey); });
    iconKeys.forEach(key => {
      if (this.typeIcons[key]) return;
      const img = new Image();
      img.src = `assets/icons/${encodeURIComponent(key)}.png`;
      this.typeIcons[key] = img;
    });

    // 背景裝飾：把每個場景實際做好的季節版本全部預載，
    // 繪製時依 Game.month 換季（缺當季圖的遞補規則在 Data.decoSeasonPick）
    Object.entries(Data.decoImages).forEach(([scene, seasons]) => {
      seasons.forEach(season => {
        const key = `${scene}-${season}`;
        if (this.decoImgs[key]) return;
        const img = new Image();
        img.src = `assets/decos/${encodeURIComponent(key)}.png`;
        this.decoImgs[key] = img;
      });
    });

    this.buildRoutePaths();
    // 滾輪縮放
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.15 : 1/1.15;
      this.cam.tscale = Math.min(14, Math.max(this.zoomFar(), this.cam.tscale * f));
    }, {passive: false});

    // 拖曳平移地圖
    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', e => {
      this.drag = {sx: e.clientX, sy: e.clientY, cx: this.cam.tx, cy: this.cam.ty};
      canvas.style.cursor = 'grabbing';
    });
    addEventListener('mousemove', e => {
      if (!this.drag) return;
      this.freeLook = true;
      const dx = (e.clientX - this.drag.sx) / this.cam.scale;
      const dy = (e.clientY - this.drag.sy) / this.cam.scale;
      this.cam.tx = this.cam.x = this.drag.cx - dx;
      this.cam.ty = this.cam.y = this.drag.cy - dy;
    });
    addEventListener('mouseup', e => {
      // 沒怎麼拖曳（視為點擊）且點中目的地邊緣箭頭：跳去以目的地為中心
      const moved = this.drag ? Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) : 999;
      if (moved < 4 && this._edgeArrow && typeof Game !== 'undefined' && Game.destination) {
        const d = Math.hypot(e.clientX - this._edgeArrow.x, e.clientY - this._edgeArrow.y);
        if (d < 24) {
          const dst = Data.stations.get(Game.destination);
          this.jumpTo(dst.x, dst.y);
        }
      }
      this.drag = null; canvas.style.cursor = 'grab';
    });
    addEventListener('mousemove', e => {
      if (this.drag) return;
      const overArrow = this._edgeArrow && Math.hypot(e.clientX - this._edgeArrow.x, e.clientY - this._edgeArrow.y) < 24;
      canvas.style.cursor = overArrow ? 'pointer' : 'grab';
    });

    requestAnimationFrame(() => this.frame());
  },

  zoomFar() {
    const w = Data.world;
    return Math.min(this.canvas.width / devicePixelRatio / w.w,
                    this.canvas.height / devicePixelRatio / w.h) * 0.96;
  },

  toggleZoom() {
    // 手動看別處時，這顆按鈕優先「回到列車」，而不是切全島／近景
    if (this.freeLook) { this.resetToTrain(); return; }
    const far = this.zoomFar();
    if (this.cam.tscale > far * 1.6) {
      // 近景 → 全島（置中於世界包圍盒中心）
      this.cam.tscale = far;
      this.cam.tx = Data.world.x + Data.world.w / 2;
      this.cam.ty = Data.world.y + Data.world.h / 2;
    } else {
      // 全島 → 近景，一定要連座標一起回到列車，不然會停在世界中心（常常在海上）
      this.resetToTrain();
    }
  },

  // 點小地圖：跳去看該處，鏡頭不再跟隨列車
  jumpTo(wx, wy, scale) {
    this.freeLook = true;
    this.cam.tx = wx; this.cam.ty = wy;
    if (scale) this.cam.tscale = scale;
  },

  // 擲骰或按「全島／近景」時呼叫：取消手動視角，鏡頭回到目前玩家的列車
  resetToTrain() {
    this.freeLook = false;
    this.cam.tscale = this.ZOOM_NEAR;
    if (typeof Game !== 'undefined' && Game.players.length) {
      const pl = Game.curPlayer();
      this.cam.tx = pl.ax; this.cam.ty = pl.ay;
    }
  },

  buildRoutePaths() {
    Data.routes.forEach(r => {
      const p = new Path2D();
      // 公路中線顏色（長途黃色／短途白色）是編輯器依站距算好存進 e.cc 的，這裡只依
      // 已經算好的顏色分組畫線，不再重算一次站距
      let roadYellow = null, roadWhite = null;
      Data.edges.filter(e => e.route === r.id).forEach(e => {
        const pts = Data.edgePath(e.a, e.b);
        if (!pts) return;
        p.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
        if (r.name === '公路') {
          const target = e.cc === '#FFD400'
            ? (roadYellow || (roadYellow = new Path2D()))
            : (roadWhite  || (roadWhite  = new Path2D()));
          target.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) target.lineTo(pts[i].x, pts[i].y);
        }
      });
      this.routePaths.push({color: r.color, width: r.width, name: r.name, path: p, roadYellow, roadWhite});
    });
  },

  follow(wx, wy) { this.cam.tx = wx; this.cam.ty = wy; },
  snapTo(wx, wy) { this.cam.tx = this.cam.x = wx; this.cam.ty = this.cam.y = wy; },

  worldToScreen(wx, wy) {
    const {x, y, scale} = this.cam;
    return {
      x: (wx - x) * scale * devicePixelRatio + this.canvas.width / 2,
      y: (wy - y) * scale * devicePixelRatio + this.canvas.height / 2,
    };
  },
  worldToCss(wx, wy) {
    const s = this.worldToScreen(wx, wy);
    return {x: s.x / devicePixelRatio, y: s.y / devicePixelRatio};
  },

  // 棋子沿路徑補間移動
  movePiece(player, pts, dur, cb) {
    const segLens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.abs(pts[i].x - pts[i-1].x) + Math.abs(pts[i].y - pts[i-1].y);
      segLens.push(L); total += L;
    }
    this.anims.push({player, pts, segLens, total, t0: performance.now(), dur, cb});
  },

  posOnPath(pts, segLens, total, frac) {
    let d = total * frac;
    for (let i = 0; i < segLens.length; i++) {
      if (d <= segLens[i] || i === segLens.length - 1) {
        const t = segLens[i] ? d / segLens[i] : 1;
        return {x: pts[i].x + (pts[i+1].x - pts[i].x) * Math.min(t,1),
                y: pts[i].y + (pts[i+1].y - pts[i].y) * Math.min(t,1)};
      }
      d -= segLens[i];
    }
    return pts[pts.length - 1];
  },

  // 玩家目前車頭前方走過的完整折線（歷史 trail ＋ 正在跑的這一段動畫，含轉角點），
  // 最後一個點永遠是車頭現在的即時位置（含動畫補間中）
  getRenderPath(pl) {
    const anim = this.anims.find(a => a.player === pl);
    if (!anim) return pl.trail;
    const now = performance.now();
    let d = anim.total * Math.min(1, (now - anim.t0) / anim.dur);
    const extra = [];
    for (let i = 0; i < anim.segLens.length; i++) {
      const last = i === anim.segLens.length - 1;
      if (d <= anim.segLens[i] || last) {
        for (let j = 1; j <= i; j++) extra.push(anim.pts[j]);
        const t = anim.segLens[i] ? Math.min(d / anim.segLens[i], 1) : 1;
        const p0 = anim.pts[i], p1 = anim.pts[i+1];
        extra.push({x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t});
        break;
      }
      d -= anim.segLens[i];
    }
    return pl.trail.concat(extra);
  },

  // 折線末端（車頭）的行進方向角度
  angAtEnd(path) {
    for (let i = path.length - 1; i > 0; i--) {
      const a = path[i-1], b = path[i];
      if (Math.abs(a.x-b.x) > 1e-6 || Math.abs(a.y-b.y) > 1e-6) return Math.atan2(b.y-a.y, b.x-a.x);
    }
    return 0;
  },

  // 從折線末端往回走 dist 距離的點與該處的行進方向（供後截車廂用，可能跨過一個 90 度轉角）
  tailAt(path, dist) {
    let remain = dist;
    for (let i = path.length - 1; i > 0; i--) {
      const a = path[i], b = path[i-1];
      const segLen = Math.hypot(a.x-b.x, a.y-b.y);
      if (segLen >= remain || i === 1) {
        const t = segLen ? Math.min(remain / segLen, 1) : 0;
        return {
          x: a.x + (b.x-a.x) * t, y: a.y + (b.y-a.y) * t,
          ang: segLen > 1e-6 ? Math.atan2(a.y-b.y, a.x-b.x) : this.angAtEnd(path.slice(0, i+1)),
        };
      }
      remain -= segLen;
    }
    // 路徑可能是空的（開局前棋子還沒定位、或連線狀態剛載入的空窗）。
    // 這裡若直接取 path[0].x 會丟例外，而這個函式是在 frame() 裡呼叫的——
    // 例外會讓 requestAnimationFrame 的下一輪根本排不到，整個畫面直接凍住。
    if (!path.length) return {x: 0, y: 0, ang: 0};
    return {x: path[0].x, y: path[0].y, ang: this.angAtEnd(path)};
  },

  // 用玩家顏色幫列車圖上色（source-atop 疊色，保留窗戶/輪子明暗），依圖檔+顏色快取
  getTintedTrain(key, color) {
    const cacheKey = key + '|' + color;
    if (this.tintCache[cacheKey]) return this.tintCache[cacheKey];
    const src = this.trainImgs[key];
    if (!src || !src.complete || !src.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = src.naturalWidth; c.height = src.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'hue';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, 0, 0);
    this.tintCache[cacheKey] = c;
    return c;
  },

  // 遊輪／飛機同樣用玩家顏色上色，跟列車共用同一套 tint 邏輯與快取（key 加字首避免撞名）
  getTintedVehicle(key, color) {
    const cacheKey = 'veh:' + key + '|' + color;
    if (this.tintCache[cacheKey]) return this.tintCache[cacheKey];
    const src = this.vehicleImgs[key];
    if (!src || !src.complete || !src.naturalWidth) return null;
    const c = document.createElement('canvas');
    c.width = src.naturalWidth; c.height = src.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'hue';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, 0, 0);
    this.tintCache[cacheKey] = c;
    return c;
  },

  // 目的地標示：畫面內＝旗子（固定螢幕像素大小，全島縮小也看得到）；畫面外＝邊緣指向箭頭
  setReachableStations(ids) { this.reachableStations = new Set(ids); },
  clearReachableStations() { this.reachableStations.clear(); },
  drawReachableMarkers(now) {
    if (!this.reachableStations.size) return;
    const {ctx} = this;
    const dpr = devicePixelRatio;
    const pulse = 1 + Math.sin(now / 180) * .08;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.reachableStations.forEach(id => {
      const st = Data.stations.get(id); if (!st) return;
      const p = this.worldToScreen(st.x, st.y);
      const r = 17 * dpr * pulse;
      ctx.fillStyle = 'rgba(31, 217, 255, .22)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 7 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#00D9FF'; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#FFFFFF'; ctx.font = `700 ${11 * dpr}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('可到', p.x, p.y);
    });
    ctx.restore();
  },

  drawDestMarker(dst, now) {
    const {ctx, canvas} = this;
    const s = this.worldToScreen(dst.x, dst.y);
    const W = canvas.width, H = canvas.height;
    const margin = 46 * devicePixelRatio;
    const cx = W / 2, cy = H / 2;
    const onScreen = s.x >= margin && s.x <= W - margin && s.y >= margin && s.y <= H - margin;
    const dpr = devicePixelRatio;

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (onScreen) {
      this._edgeArrow = null;   // 目的地在畫面內時顯示旗子，沒有可點的三角
      const bob = Math.sin(now / 260) * 2 * dpr;
      const poleH = 43 * dpr;
      ctx.save();
      ctx.shadowColor = 'rgba(255,210,50,.9)'; ctx.shadowBlur = 12 * dpr;
      ctx.strokeStyle = '#fff7ce'; ctx.lineWidth = 5 * dpr;
      ctx.beginPath(); ctx.arc(s.x, s.y - poleH + 9 * dpr, 17 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#6d4521'; ctx.lineWidth = 3.2 * dpr;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - poleH); ctx.stroke();
      ctx.strokeStyle = '#ffe69a'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 2 * dpr); ctx.lineTo(s.x, s.y - poleH); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - poleH + bob);
      ctx.lineTo(s.x + 31 * dpr, s.y - poleH + 9 * dpr + bob);
      ctx.lineTo(s.x, s.y - poleH + 19 * dpr + bob);
      ctx.closePath();
      ctx.fillStyle = '#ff4b38'; ctx.fill();
      ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 2 * dpr; ctx.stroke();
      ctx.restore();
      return;
    }

    const ang = Math.atan2(s.y - cy, s.x - cx);
    // 夾在畫面邊緣矩形內
    const halfW = W / 2 - margin, halfH = H / 2 - margin;
    const tx = Math.cos(ang), ty = Math.sin(ang);
    const scale = Math.min(Math.abs(halfW / (tx || 1e-6)), Math.abs(halfH / (ty || 1e-6)));
    const ax = cx + tx * scale, ay = cy + ty * scale;
    this._edgeArrow = {x: ax / dpr, y: ay / dpr};   // 記錄 CSS px 座標供點擊判斷

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    const R = 18 * dpr;
    ctx.beginPath();
    ctx.moveTo(R, 0); ctx.lineTo(-R*0.5, R*0.62); ctx.lineTo(-R*0.5, -R*0.62);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,213,74,.92)';
    ctx.fill();
    ctx.strokeStyle = '#8a6d1a'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    ctx.restore();
  },

  frame() {
    const {ctx, canvas, cam} = this;
    const now = performance.now();
    const dt = this.lastFrameT ? Math.min(50, now - this.lastFrameT) : 16;
    this.lastFrameT = now;

    // 擲骰前用方向鍵捲動地圖，同時按兩個方向鍵可以斜捲（速度正規化，不會比單方向快）
    if (typeof Game !== 'undefined' && Game.state === 'awaitRoll') {
      const k = this.panKeys;
      const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      if (dx || dy) {
        this.freeLook = true;
        const len = Math.hypot(dx, dy);
        const dist = (280 / cam.scale) * (dt / 1000);
        this.cam.tx = this.cam.x += (dx / len) * dist;
        this.cam.ty = this.cam.y += (dy / len) * dist;
      }
    }

    // 鏡頭補間
    cam.x += (cam.tx - cam.x) * 0.14;
    cam.y += (cam.ty - cam.y) * 0.14;
    cam.scale += (cam.tscale - cam.scale) * 0.16;

    // 移動動畫
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      const f = Math.min(1, (now - a.t0) / a.dur);
      const p = this.posOnPath(a.pts, a.segLens, a.total, f);
      a.player.ax = p.x; a.player.ay = p.y;
      if (!this.freeLook) this.follow(p.x, p.y);
      if (f >= 1) { this.anims.splice(i, 1); a.cb && a.cb(); }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1B5FA8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = cam.scale * devicePixelRatio;
    ctx.setTransform(s, 0, 0, s,
      canvas.width / 2 - cam.x * s, canvas.height / 2 - cam.y * s);

    // 背景
    if (this.bgReady) {
      const w = Data.world;
      ctx.drawImage(this.bgImg, w.x, w.y, w.w, w.h);
    }

    // 背景裝飾（畫在路線和站點之下）：季節跟著遊戲月份走，跟未來紅藍格季節計分共用 Data.seasonOf
    if (Data.decos.length) {
      const season = Data.seasonOf(typeof Game !== 'undefined' && Game.month ? Game.month : 6);
      Data.decos.forEach(d => {
        const pick = Data.decoSeasonPick(d.key, season);
        if (!pick) return;
        const img = this.decoImgs[`${d.key}-${pick}`];
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, d.x, d.y, d.w, d.w);
      });
    }

    // 路線
    ctx.globalAlpha = 0.85;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    this.routePaths.forEach(r => {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.stroke(r.path);
      // 公路：疊一條細虛線當作路面標線，長途（黃）／短途（白）的分組已由編輯器算好存進
      // r.roadYellow／r.roadWhite 兩條 Path2D，這裡只負責畫，不再判斷站距
      if (r.name === '公路') {
        ctx.save();
        ctx.lineWidth = r.width * 0.12;
        ctx.setLineDash([r.width * 1.4, r.width * 1.4]);
        if (r.roadYellow) { ctx.strokeStyle = '#FFD400'; ctx.stroke(r.roadYellow); }
        if (r.roadWhite)  { ctx.strokeStyle = '#FFFFFF'; ctx.stroke(r.roadWhite); }
        ctx.restore();
      // 鐵路（除公路／飛機航線／船運航線外都算鐵路）：疊一條白色短虛線，
      // 線寬幾乎跟軌道一樣粗、虛線間隔很短，看起來像枕木
      } else if (r.name !== '飛機航線' && r.name !== '船運航線') {
        ctx.save();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = r.width * 0.9;
        ctx.lineCap = 'butt'; // 用直角端點取代圓角，避免虛線頭尾疊在一起蓋掉底色
        ctx.setLineDash([r.width * 0.4, r.width * 1.3]);
        ctx.stroke(r.path);
        ctx.restore();
      }
    });
    ctx.globalAlpha = 1;

    // 站點與紅藍黃格——除了紅藍黃格是固定方塊樣式，其餘視覺參數全部來自 Data.typeStyleFor()
    // （地圖編輯器匯出的 meta.typeStyle），不再用 type==='TRA' 這種寫死的二分判斷
    Data.stations.forEach(st => {
      if (st.type === '藍格' || st.type === '紅格' || st.type === '黃格') {
        ctx.fillStyle = Data.typeColor(st.type);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.5;
        ctx.fillRect(st.x - 1.75, st.y - 1.75, 3.5, 3.5);
        ctx.strokeRect(st.x - 1.75, st.y - 1.75, 3.5, 3.5);
        return;
      }
      const ts = Data.typeStyleFor(st.type);
      const r = ts.radius;
      const iconKey = st.iconKey || ts.iconKey;
      const icon = iconKey && this.typeIcons[iconKey];
      if (icon && icon.complete && icon.naturalWidth) {
        const S = st.iconSize || ts.iconSize;   // 個別站點在編輯器調過的圖示大小優先
        ctx.drawImage(icon, st.x - S/2, st.y - S/2, S, S);
      } else {
        ctx.fillStyle = Data.typeColor(st.type);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.arc(st.x, st.y, r, 0, 7); ctx.fill(); ctx.stroke();
      }
      // 站名標籤：字級/位置/顏色/描邊以編輯器 SVG 匯出的每站 label 為準（跟編輯器所見一致），
      // 沒有 label 資料才退回 typeStyle 的預設；縮放門檻仍是遊戲自己的功能（SVG 沒有這概念）。
      // 卡片商店比照紅藍黃格，不顯示站名標籤（這類站點常是從格子衍生出來的，名稱只是內部編號，不是給玩家看的地名）
      if (st.type !== '卡片商店' && cam.scale >= ts.labelZoom) {
        const lbl = st.label;
        ctx.font = `${(lbl && lbl.size) || ts.fontSize}px 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
        ctx.fillStyle = (lbl && lbl.color) || Data.typeColor(st.type);
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = (lbl && lbl.strokeW) || 0.8;
        ctx.textAlign = 'center';
        let lx = st.x, ly;
        if (lbl) { lx = st.x + lbl.dx; ly = st.y + lbl.dy; }
        else { ly = st.y - (icon ? ts.labelOffset + 1 : r + 1); }
        ctx.strokeText(st.name, lx, ly);
        ctx.fillText(st.name, lx, ly);
      }
    });

    // 棋子：兩截車廂列車，各自依所在路段的實際方向獨立轉向（可呈 90 度彎）
    // 允許重疊：輪到誰，誰畫在最上面，不錯開、不分開畫
    const CAR_LEN = 17 * 0.75, TRAIL_DIST = 18 * 0.75;
    const players0 = (typeof Game !== 'undefined') ? Game.players.filter(p => p.pos) : [];
    const players = players0.slice().sort((a, b) =>
      (a === Game.players[Game.cur] ? 1 : 0) - (b === Game.players[Game.cur] ? 1 : 0));
    players.forEach(pl => {
      // 船運/飛機航線上，棋子改畫單張遊輪/飛機圖示（俯視、機首朝上），不套用列車的兩截車廂畫法
      if (pl.vehicleMode === 'ship' || pl.vehicleMode === 'plane') {
        const vtinted = this.getTintedVehicle(pl.vehicleMode, pl.color);
        if (!vtinted) return;
        const path0 = this.getRenderPath(pl);
        if (!path0.length) return;   // 還沒有位置資料，這一幀先不畫這位玩家
        const head0 = path0[path0.length - 1];
        const ang0 = this.angAtEnd(path0);
        const S = 15;
        ctx.save();
        ctx.translate(head0.x, head0.y);
        // 遊輪與飛機素材預設都是船艏／機鼻朝上(-Y)；旋轉 ang0+π/2 讓它轉到實際行進角度
        // （ang0：0=東，順時針為正）。素材朝向 -π/2，+π/2 後正好對齊行進方向。
        ctx.rotate(ang0 + Math.PI/2);
        ctx.drawImage(vtinted, -S/2, -S/2, S, S);
        ctx.restore();
        return;
      }
      const tinted = this.getTintedTrain(pl.train || 'local', pl.color);
      if (!tinted) return;
      const srcW = tinted.width, srcH = tinted.height;
      const TH = CAR_LEN * srcH / (srcW / 2);   // 每截車廂只用半張圖寬，比例要用半寬換算，不能用整張圖的長寬比
      const path = this.getRenderPath(pl);
      const head = path[path.length - 1];
      const frontAng = this.angAtEnd(path);
      const tail = this.tailAt(path, TRAIL_DIST);

      // 車鼻其實長在圖片左半邊、車尾鈍端在右半邊；水平方向（東西）用鏡像而非旋轉
      // （旋轉 180 度會連上下一起翻過來，變成倒栽蔥），垂直方向（南北）才用真旋轉，
      // 且要轉「反方向」（-ang）車尾才會確實拖在行進方向的後面，不會拖到前面去
      const drawCar = (pt, ang, srcX) => {
        ctx.save();
        ctx.translate(pt.x, pt.y);
        const cosA = Math.cos(ang), sinA = Math.sin(ang);
        if (Math.abs(sinA) < 0.5) {
          if (cosA > 0) ctx.scale(-1, 1);   // 向東：鏡像；向西：不動
        } else {
          ctx.rotate(-ang);                 // 向南/向北：旋轉，角度取負
        }
        ctx.drawImage(tinted, srcX, 0, srcW/2, srcH, 0, -TH/2, CAR_LEN, TH);
        ctx.restore();
      };
      drawCar(tail, tail.ang, srcW/2);     // 後截車廂（圖右半＝車尾鈍端）
      drawCar(head, frontAng, 0);          // 前截車廂（圖左半＝車鼻），車鼻對準站點座標
    });

    this.drawReachableMarkers(now);

    // 目的地標示：畫面內是旗子、畫面外是邊緣箭頭（固定螢幕大小，全島縮小也看得到）
    if (typeof Game !== 'undefined' && Game.destination) {
      this.drawDestMarker(Data.stations.get(Game.destination), now);
    } else {
      this._edgeArrow = null;
    }

    // 探路放大鏡圖示：固定畫在畫面正中央（鏡頭會補間移過去，直到游標站點置中）。
    // 🔍 這個 emoji 鏡片在字圖左上、手把拖在右下，所以要往下移一段距離，
    // 讓「鏡片圓心」（不是整個字圖的中心）對準站點座標；鏡片直徑目標比站點圖示大一些、
    // 比原本的黃圈略小——不再另外畫黃圈，鏡片本身就是唯一的游標標示
    if (this.scoutStation) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = devicePixelRatio;
      const ccx = canvas.width / 2, ccy = canvas.height / 2;
      ctx.font = `${70 * dpr}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🔍', ccx, ccy - 9 * dpr);
    }

    if (this.onFrame) this.onFrame();
    requestAnimationFrame(() => this.frame());
  },
};
