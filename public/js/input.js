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

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, down) {
    const action = this._keyMap[e.code];
    if (action) {
      e.preventDefault();
      this.keys[action] = down;
    }
  }

  getState() {
    return { ...this.keys };
  }
}
