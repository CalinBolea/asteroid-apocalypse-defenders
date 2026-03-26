class InputManager {
  constructor() {
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      strafeLeft: false,
      strafeRight: false,
      strafeUp: false,
      strafeDown: false,
      shoot: false,
    };

    this._keyMap = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      KeyW: 'strafeUp',
      KeyS: 'strafeDown',
      KeyA: 'strafeLeft',
      KeyD: 'strafeRight',
      Space: 'shoot',
    };

    this._upgradeMap = {
      Digit1: 'moveSpeed',
      Digit2: 'attackSpeed',
      Digit3: 'shield',
      Digit4: 'dualCannon',
    };

    this._upgradePurchases = [];
    this._typingMode = false;
    this._typedChars = [];

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, down) {
    if (this._typingMode && down) {
      // Capture letter keys for typing mode
      if (e.code.startsWith('Key') && e.code.length === 4) {
        e.preventDefault();
        this._typedChars.push(e.key.toLowerCase());
        return;
      }
      // Block space from triggering shoot
      if (e.code === 'Space') {
        e.preventDefault();
        return;
      }
    }
    if (this._typingMode && e.code === 'Space') {
      e.preventDefault();
      return;
    }

    const action = this._keyMap[e.code];
    if (action) {
      e.preventDefault();
      if (!this._typingMode) {
        this.keys[action] = down;
      }
      return;
    }

    if (down) {
      const upgrade = this._upgradeMap[e.code];
      if (upgrade) {
        this._upgradePurchases.push(upgrade);
      }
    }
  }

  setTypingMode(enabled) {
    this._typingMode = enabled;
  }

  getTypedChars() {
    const chars = this._typedChars;
    this._typedChars = [];
    return chars;
  }

  getState() {
    return { ...this.keys };
  }

  getUpgradePurchases() {
    const purchases = this._upgradePurchases;
    this._upgradePurchases = [];
    return purchases;
  }
}
