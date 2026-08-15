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
