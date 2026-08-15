// ────────────────────────────────────────────────
//  data.js — 載入 map_data，建立站點索引與路網圖
// ────────────────────────────────────────────────

// 金額顯示格式化：遊戲內部金額一律是「萬元」單位的整數，超過 9999 萬要換成億／兆顯示
// （例如 18000 → "1億8000萬"），跟中文報數習慣一樣，值是 0 的單位不顯示（例如整億不顯示"0萬"）。
// 只回傳數字部分，不含「元」字，呼叫端要顯示金額時自己接上「元」（沿用原本 call site 的用法）。
function formatMoney(wan) {
  const neg = wan < 0;
  let abs = Math.round(Math.abs(wan));
  const zhao = Math.floor(abs / 1e8); abs -= zhao * 1e8;
  const yi = Math.floor(abs / 1e4); abs -= yi * 1e4;
  const parts = [];
  if (zhao > 0) parts.push(`${zhao}兆`);
  if (yi > 0) parts.push(`${yi}億`);
  if (abs > 0 || !parts.length) parts.push(`${abs}萬`);
  return (neg ? '-' : '') + parts.join('');
}
window.formatMoney = formatMoney;

const Data = {
  stations: new Map(),   // id → {id,name,type,city,x,y,iconKey}
  routes:   new Map(),   // rid → {id,name,color,width}
  adj:      new Map(),   // id → [{to, bend, route, reversed}]
  edges:    [],
  world:    null,
  typeStyle: {},   // type → {color,label,iconKey,radius,iconSize,fontSize,labelZoom,labelOffset}——全部來自地圖編輯器匯出，不寫死
  decos:    [],    // 背景裝飾 [{key,x,y,w}]——只有場景與位置，季節由遊戲月份即時決定
  decoImages: {},  // 場景 → 實際做好的季節清單（缺當季圖時遞補用）

  load() {
    const d = window.MAP_DATA;
    if (!d) throw new Error('map_data.js 未載入');
    if (!d.meta || !d.meta.world) throw new Error('map_data 缺少 meta.world，請確認地圖編輯器有正確匯出（存檔一次）');
    this.world = d.meta.world;
    this.typeStyle = d.meta.typeStyle || {};
    this.decos = d.decos || [];
    this.decoImages = d.meta.decoImages || {};
    d.stations.forEach(s => this.stations.set(s.id, s));
    d.routes.forEach(r => this.routes.set(r.id, r));
    this.edges = d.edges;
    d.edges.forEach(e => {
      if (!this.adj.has(e.a)) this.adj.set(e.a, []);
      if (!this.adj.has(e.b)) this.adj.set(e.b, []);
      this.adj.get(e.a).push({to: e.b, bend: e.bend, route: e.route, reversed: false});
      this.adj.get(e.b).push({to: e.a, bend: e.bend, route: e.route, reversed: true});
    });
    return this;
  },

  // 一段路徑的座標序列（L 型轉彎，與編輯器同邏輯）
  edgePath(fromId, toId) {
    const link = (this.adj.get(fromId) || []).find(l => l.to === toId);
    if (!link) return null;
    const F = this.stations.get(fromId), T = this.stations.get(toId);
    // 儲存方向為 a→b；反向行走時 bend 的水平/垂直順序對調
    let pts;
    const bendFirstH = link.reversed ? (link.bend === 'V') : (link.bend === 'H');
    if (bendFirstH) {
      pts = [{x:F.x, y:F.y}];
      if (Math.abs(T.x - F.x) > 0.01) pts.push({x:T.x, y:F.y});
      pts.push({x:T.x, y:T.y});
    } else {
      pts = [{x:F.x, y:F.y}];
      if (Math.abs(T.y - F.y) > 0.01) pts.push({x:F.x, y:T.y});
      pts.push({x:T.x, y:T.y});
    }
    return pts;
  },

  // 這一段路是走哪條路線（判斷是否為船運/飛機航線，供棋子換成遊輪/飛機圖示用）
  routeNameOf(fromId, toId) {
    const link = (this.adj.get(fromId) || []).find(l => l.to === toId);
    if (!link) return null;
    const r = this.routes.get(link.route);
    return r ? r.name : null;
  },

  isTile(id) {
    const s = this.stations.get(id);
    return s && (s.type === '藍格' || s.type === '紅格' || s.type === '黃格');
  },

  // 站點類型的樣式全部來自地圖編輯器匯出的 meta.typeStyle，這裡只提供帶預設值的查詢介面，
  // 不再自己維護一份跟編輯器獨立、容易漂移不同步的對照表
  typeStyleFor(t) {
    return this.typeStyle[t] || {
      color: '#888', label: t, iconKey: null,
      radius: 2.4, iconSize: 8, fontSize: 3.2, labelZoom: 1.6, labelOffset: 4,
    };
  },

  typeColor(t) { return this.typeStyleFor(t).color; },
  typeLabel(t) { return this.typeStyleFor(t).label; },

  // 月份 → 季節。背景裝飾切換和（未來的）紅藍格季節加減分都用這一個函式，
  // 確保兩個系統對「現在是什麼季節」的認定永遠一致
  seasonOf(month) {
    if (month >= 3 && month <= 5)  return '春天';
    if (month >= 6 && month <= 8)  return '夏天';
    if (month >= 9 && month <= 11) return '秋天';
    return '冬天';
  },

  // 場景在指定季節該用哪張圖：當季 → 夏天 → 任何一張做好的
  decoSeasonPick(key, season) {
    const seasons = this.decoImages[key] || [];
    if (seasons.includes(season)) return season;
    if (seasons.includes('夏天')) return '夏天';
    return seasons[0] || null;
  },
};
