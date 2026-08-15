// 統一輸入層：鍵盤與標準 Gamepad API 都轉成同一組遊戲按鍵。
// A=確認、B=返回、X=卡片、Y=可到達站點、LB=縮放、RB=設定、Start=設定、Select=靜音。
const Input = {
  last: new Map(), dead: .45, repeat: 155, first: 330,
  init() {
    addEventListener('gamepadconnected', () => UI && UI.toast('已連接手把：方向鍵選擇，A 確定，B 返回，Y 顯示可到達站點。'));
    requestAnimationFrame(() => this.poll());
  },
  emit(key, code = key) {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', {key, code, bubbles:true, cancelable:true}));
    target.dispatchEvent(new KeyboardEvent('keyup', {key, code, bubbles:true, cancelable:true}));
  },
  pulse(id, active, key, code) {
    const now = performance.now(), prior = this.last.get(id) || 0;
    if (!active) { this.last.delete(id); return; }
    const held = prior < 0 ? -prior : 0;
    if (!prior || (held ? now - held >= this.repeat : now - prior >= this.first)) {
      this.emit(key, code); this.last.set(id, -(held || now));
    }
  },
  poll() {
    const pad = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean);
    if (pad) {
      const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      this.pulse('left', b(14) || ax < -this.dead, 'ArrowLeft');
      this.pulse('right', b(15) || ax > this.dead, 'ArrowRight');
      this.pulse('up', b(12) || ay < -this.dead, 'ArrowUp');
      this.pulse('down', b(13) || ay > this.dead, 'ArrowDown');
      this.pulse('a', b(0), ' ', 'Space');
      this.pulse('b', b(1), 'b', 'KeyB');
      this.pulse('x', b(2), 'c', 'KeyC');
      this.pulse('y', b(3), 'y', 'KeyY');
      this.pulse('lb', b(4), 'z', 'KeyZ');
      this.pulse('rb', b(5) || b(9), 'p', 'KeyP');
      this.pulse('select', b(8), 'm', 'KeyM');
    }
    requestAnimationFrame(() => this.poll());
  }
};
