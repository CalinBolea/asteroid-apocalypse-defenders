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

  // Start button
  startBtn.addEventListener('click', () => {
    socket.emit('start-game');
    startBtn.classList.add('hidden');
  });

  // Also allow space to start when in waiting state
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !startBtn.classList.contains('hidden')) {
      socket.emit('start-game');
      startBtn.classList.add('hidden');
    }
  });

  // Input sending (throttled ~20/s)
  let lastInput = null;
  setInterval(() => {
    if (!gameState || gameState.state !== 'playing') return;
    const current = input.getState();
    const str = JSON.stringify(current);
    if (str !== lastInput) {
      socket.emit('player-input', current);
      lastInput = str;
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
    } else {
      // Waiting state
      renderer.drawWaiting(roomPlayers, roomCode);
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
