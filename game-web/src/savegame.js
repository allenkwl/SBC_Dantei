// ────────────────────────────────────────────────
//  save.js — 存檔系統：10 個檔案匣，資料存在瀏覽器 localStorage（仿桃鐵）
// ────────────────────────────────────────────────
const SaveSystem = {
  PREFIX: 'xqmt_save_',
  SLOTS: 10,

  read(slot) {
    try {
      const raw = localStorage.getItem(this.PREFIX + slot);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  write(slot, data) {
    localStorage.setItem(this.PREFIX + slot, JSON.stringify(data));
  },
  remove(slot) {
    localStorage.removeItem(this.PREFIX + slot);
  },
};

// ────────────────────────────────────────────────
//  連線對戰的存檔：跟上面的單機存檔完全分開
// ────────────────────────────────────────────────
// 為什麼不共用單機那 10 格：連線對戰是自動存檔（每年三月底全場各自寫回自己的裝置），
// 如果跟單機共用格子，自動存檔會蓋掉玩家自己珍惜的單機進度。分開之後也不用去想
// 「這次自動存檔該寫進哪一格」這個問題。
//
// 這裡不用數字格，改用「群組名」當 key：下次要續玩就是再開一次同名群組，每個人的
// 裝置各自用同一個群組名找回自己那份記錄，彼此才對得上。所以群組名一旦用了就不能改
// （Net.keyOf 的轉換規則同理，改了舊記錄就找不到）。
//
// 數量不設上限：一份約 10KB，就算存 50 個群組也才 500KB，離 localStorage 的容量上限
// （通常 5~10MB）還很遠，沒必要為了省這點空間逼玩家刪東西。
const OnlineSave = {
  PREFIX: 'xqmt_net_',

  read(groupKey) {
    try {
      const raw = localStorage.getItem(this.PREFIX + groupKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  write(groupKey, data) {
    localStorage.setItem(this.PREFIX + groupKey, JSON.stringify(data));
  },
  remove(groupKey) {
    localStorage.removeItem(this.PREFIX + groupKey);
  },

  // 全部連線存檔，最近玩過的排前面（讀檔畫面用）
  list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(this.PREFIX)) continue;
      const groupKey = k.slice(this.PREFIX.length);
      const data = this.read(groupKey);
      if (data) out.push({groupKey, data});
    }
    out.sort((a, b) => (b.data.savedAt || 0) - (a.data.savedAt || 0));
    return out;
  },

  // 「誰的記錄比較新」一律用遊戲進度比，不能用 savedAt 這種時鐘時間——玩家手機的時鐘
  // 不準是常態，用時鐘比很可能把舊的判斷成新的。同一局裡誰走得比較遠是客觀事實。
  progressOf(data) {
    if (!data) return -1;
    return (data.year || 0) * 12 + (data.month || 0);
  },
};
