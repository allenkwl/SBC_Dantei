// 由「音量編輯器」存檔產生，遊戲讀這一份（見 audio.js 的 applySettings）。
// 請不要手動編輯這個檔案——改用編輯器調整後按「存檔」。
window.AUDIO_SETTINGS = {
  "master": {
    "bgm": 0.8,
    "sfx": 0.7
  },
  "bgm": {
    "splash": 1, "setup": 1, "lobby": 1, "character_select": 1,
    "spring": 1, "summer": 1, "autumn": 1, "winter": 1,
    "debt": 1, "sea": 1, "plane": 1
  },
  "sfx": {
    "dice": 1, "cheer": 1, "heli": 1.4, "news": 0.3,
    "train": 0.43, "ship": 0.28, "plane_sfx": 0.94
  }
};
