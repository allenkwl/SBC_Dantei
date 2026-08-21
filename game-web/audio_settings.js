// 由「音量編輯器」存檔產生，遊戲讀這一份（見 audio.js 的 applySettings）。
// 請不要手動編輯這個檔案——改用編輯器調整後按「產生」再覆蓋。
// bgm 是每一軌的播放端微調，只能衰減（0～1）；sfx 走 Web Audio，可以放大。
// 這一份是 v2.13 的出廠值，跟 audio.js 裡的預設值一致。
window.AUDIO_SETTINGS = {
  "master": { "bgm": 0.8, "sfx": 0.7 },
  "bgm": {},
  "sfx": { "heli": 1.4, "news": 0.3, "train": 0.43, "ship": 0.16, "plane_sfx": 0.94 }
};
