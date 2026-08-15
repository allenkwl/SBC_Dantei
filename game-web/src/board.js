// ────────────────────────────────────────────────
//  board.js — 圖演算法：鄰接、BFS 最短距離
// ────────────────────────────────────────────────
const Board = {
  neighbors(id) {
    return (Data.adj.get(id) || []).map(l => l.to);
  },

  // BFS：from 到全圖各點的格數距離（之後算「誰離目的地最遠」用）
  distancesFrom(from) {
    const dist = new Map([[from, 0]]);
    const q = [from];
    while (q.length) {
      const n = q.shift();
      for (const nb of this.neighbors(n)) {
        if (!dist.has(nb)) { dist.set(nb, dist.get(n) + 1); q.push(nb); }
      }
    }
    return dist;
  },

  shortestDist(from, to) {
    if (from === to) return 0;
    const dist = new Map([[from, 0]]);
    const q = [from];
    while (q.length) {
      const n = q.shift();
      for (const nb of this.neighbors(n)) {
        if (dist.has(nb)) continue;
        dist.set(nb, dist.get(n) + 1);
        if (nb === to) return dist.get(nb);
        q.push(nb);
      }
    }
    return Infinity;
  },

  // 探路放大鏡游標用：純粹依座標找「該方向最近的一個站點」，不管路網有沒有連通
  // （跟編輯器吸附邏輯類似的網格概念），只在裡面挑真正的站點，不挑紅藍黃格
  DIR_VEC: {ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]},
  nearestInDirection(fromId, dirKey) {
    const vec = this.DIR_VEC[dirKey];
    if (!vec) return null;
    const [dx, dy] = vec;
    const F = Data.stations.get(fromId);
    if (!F) return null;
    let best = null, bestScore = Infinity;
    Data.stations.forEach((st, id) => {
      if (id === fromId || Data.isTile(id)) return;
      const vx = st.x - F.x, vy = st.y - F.y;
      const proj = vx * dx + vy * dy;          // 沿按下方向的投影距離
      if (proj <= 0.01) return;                // 不在這個方向上
      const lateral = Math.abs(vx * dy - vy * dx);   // 偏離方向軸線的橫向距離
      if (lateral > proj) return;              // 偏超過約 45 度就不考慮
      const score = proj + lateral * 2;        // 同一直線上優先，偏移小的優先
      if (score < bestScore) { bestScore = score; best = id; }
    });
    return best;
  },
};
