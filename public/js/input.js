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

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, down) {
    const action = this._keyMap[e.code];
    if (action) {
      e.preventDefault();
      this.keys[action] = down;
      return;
    }

    if (down) {
      const upgrade = this._upgradeMap[e.code];
      if (upgrade) {
        this._upgradePurchases.push(upgrade);
      }
    }
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
