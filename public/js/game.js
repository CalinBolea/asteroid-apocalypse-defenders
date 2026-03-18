(function () {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  const playerName = params.get('name') || 'Player';

  if (!roomCode) {
    window.location.href = './';
    return;
  }

  const canvas = document.getElementById('gameCanvas');
  const startBtn = document.getElementById('startBtn');
  const renderer = new Renderer(canvas);
  const input = new InputManager();

  const socket = io({
    path: '/asteroid-apocalypse-defenders/socket.io/',
  });

  let gameState = null;
  let playerId = null;
  let roomPlayers = [];
  let gameOver = false;
  let finalScore = 0;
  let finalWave = 0;

  // Resize canvas
  function resize() {
    renderer.resize();
  }
  window.addEventListener('resize', resize);
  resize();

  // Socket events
  socket.on('connect', () => {
    socket.emit('join-room', { code: roomCode, name: playerName });
  });

  socket.on('room-joined', (data) => {
    playerId = data.playerId;
    roomPlayers = data.players;
    if (data.state === 'waiting') {
      startBtn.classList.remove('hidden');
    }
  });

  socket.on('player-joined', (player) => {
    roomPlayers.push(player);
  });

  socket.on('player-left', (data) => {
    roomPlayers = roomPlayers.filter(p => p.id !== data.id);
  });

  socket.on('game-state', (state) => {
    gameState = state;
    if (state.state === 'playing') {
      startBtn.classList.add('hidden');
    } else if (state.state === 'upgrading') {
      startBtn.textContent = 'READY';
      startBtn.disabled = false;
      startBtn.classList.remove('hidden');
      // Mark as waiting if we already readied up
      const me = state.players.find(p => p.id === playerId);
      if (me && me.ready) {
        startBtn.disabled = true;
        startBtn.textContent = 'WAITING...';
      }
    }
  });

  socket.on('game-over', (data) => {
    gameOver = true;
    finalScore = data.score;
    finalWave = data.wave;
  });

  socket.on('error', (data) => {
    alert(data.message);
    window.location.href = './';
  });

  socket.on('lobby-update', (players) => {
    roomPlayers = players;
  });

  // Ready button
  startBtn.addEventListener('click', () => {
    socket.emit('player-ready');
    startBtn.disabled = true;
    startBtn.textContent = 'WAITING...';
  });

  // Also allow space to ready when in waiting state
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !startBtn.classList.contains('hidden') && !startBtn.disabled) {
      socket.emit('player-ready');
      startBtn.disabled = true;
      startBtn.textContent = 'WAITING...';
    }
  });

  // Input sending (throttled ~20/s)
  let lastInput = null;
  setInterval(() => {
    if (!gameState) return;
    if (gameState.state === 'playing') {
      const current = input.getState();
      const str = JSON.stringify(current);
      if (str !== lastInput) {
        socket.emit('player-input', current);
        lastInput = str;
      }
    }
    if (gameState.state === 'upgrading') {
      const purchases = input.getUpgradePurchases();
      for (const type of purchases) {
        socket.emit('purchase-upgrade', type);
      }
    }
  }, 50);

  // Render loop
  function render() {
    renderer.clear();

    if (gameOver) {
      // Show final game state if available
      if (gameState) {
        const cam = renderer.getCamera(playerId, gameState.players);
        renderer.drawGrid(cam);
        gameState.asteroids.forEach(a => renderer.drawAsteroid(a, cam));
        gameState.players.forEach(p => renderer.drawShip(p, cam));
      }
      renderer.drawGameOver(finalScore, finalWave);
    } else if (gameState && gameState.state === 'playing') {
      const cam = renderer.getCamera(playerId, gameState.players);
      renderer.drawGrid(cam);
      gameState.bullets.forEach(b => renderer.drawBullet(b, cam));
      gameState.asteroids.forEach(a => renderer.drawAsteroid(a, cam));
      gameState.players.forEach(p => renderer.drawShip(p, cam));
      renderer.drawHUD(gameState);
    } else if (gameState && gameState.state === 'upgrading') {
      const cam = renderer.getCamera(playerId, gameState.players);
      renderer.drawGrid(cam);
      gameState.asteroids.forEach(a => renderer.drawAsteroid(a, cam));
      gameState.players.forEach(p => renderer.drawShip(p, cam));
      renderer.drawHUD(gameState);
      const localPlayer = gameState.players.find(p => p.id === playerId);
      if (localPlayer) {
        renderer.drawUpgradeMenu(localPlayer, gameState.players);
      }
    } else {
      // Waiting state
      renderer.drawWaiting(roomPlayers, roomCode);
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
