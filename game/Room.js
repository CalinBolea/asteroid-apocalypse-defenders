const C = require('./constants');

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map();
    this.asteroids = [];
    this.bullets = [];
    this.score = 0;
    this.lives = C.STARTING_LIVES;
    this.wave = 0;
    this.state = 'waiting'; // waiting | playing | gameover
    this.tickInterval = null;
    this.broadcastInterval = null;
    this.waveTimeout = null;
    this.cleanupTimeout = null;
    this.nextEntityId = 1;
  }

  _id() {
    return this.nextEntityId++;
  }

  addPlayer(socket, name) {
    if (this.players.size >= C.MAX_PLAYERS) return false;
    if (this.state === 'gameover') return false;

    const colorIndex = this.players.size % C.PLAYER_COLORS.length;
    const player = {
      id: socket.id,
      name: name.slice(0, 16),
      color: C.PLAYER_COLORS[colorIndex],
      x: C.MAP_WIDTH / 2 + (Math.random() - 0.5) * 200,
      y: C.MAP_HEIGHT / 2 + (Math.random() - 0.5) * 200,
      angle: -Math.PI / 2,
      input: { up: false, down: false, left: false, right: false, strafeLeft: false, strafeRight: false, strafeUp: false, strafeDown: false, shoot: false },
      shootCooldown: 0,
      invincible: C.RESPAWN_INVINCIBILITY,
      alive: true,
      ready: false,
    };

    this.players.set(socket.id, player);
    socket.join(this.code);
    return true;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    if (this.players.size === 0) {
      this.destroy();
      return true; // room should be removed
    }
    return false;
  }

  setPlayerReady(socketId) {
    const player = this.players.get(socketId);
    if (!player || player.ready) return;
    player.ready = true;
    this.io.to(this.code).emit('lobby-update', this._getLobbyPlayers());
    this.checkAllReady();
  }

  checkAllReady() {
    if (this.players.size < 1) return;
    for (const [, p] of this.players) {
      if (!p.ready) return;
    }
    this.startGame();
  }

  _getLobbyPlayers() {
    const players = [];
    for (const [, p] of this.players) {
      players.push({ id: p.id, name: p.name, color: p.color, ready: p.ready });
    }
    return players;
  }

  startGame() {
    if (this.state !== 'waiting') return;
    this.state = 'playing';
    this.score = 0;
    this.lives = C.STARTING_LIVES;
    this.wave = 0;
    this.asteroids = [];
    this.bullets = [];

    this.spawnWave();

    this.tickInterval = setInterval(() => this.tick(), 1000 / C.TICK_RATE);
    this.broadcastInterval = setInterval(() => {
      this.io.to(this.code).emit('game-state', this.getSnapshot());
    }, 1000 / C.BROADCAST_RATE);
  }

  spawnWave() {
    this.wave++;
    const count = C.WAVE_BASE_COUNT + (this.wave - 1) * C.WAVE_INCREMENT;

    for (let i = 0; i < count; i++) {
      this.asteroids.push(this._createAsteroid('large'));
    }

    this.waveTimeout = setTimeout(() => {
      if (this.state === 'playing') this.spawnWave();
    }, C.WAVE_INTERVAL);
  }

  _createAsteroid(size, x, y) {
    const radius = size === 'large' ? C.ASTEROID_RADIUS_LARGE
      : size === 'medium' ? C.ASTEROID_RADIUS_MEDIUM
        : C.ASTEROID_RADIUS_SMALL;

    // Spawn from edges if no position given
    if (x === undefined) {
      const edge = Math.floor(Math.random() * 4);
      switch (edge) {
        case 0: x = Math.random() * C.MAP_WIDTH; y = -radius; break;
        case 1: x = C.MAP_WIDTH + radius; y = Math.random() * C.MAP_HEIGHT; break;
        case 2: x = Math.random() * C.MAP_WIDTH; y = C.MAP_HEIGHT + radius; break;
        case 3: x = -radius; y = Math.random() * C.MAP_HEIGHT; break;
      }
    }

    const angle = Math.atan2(
      C.MAP_HEIGHT / 2 + (Math.random() - 0.5) * 400 - y,
      C.MAP_WIDTH / 2 + (Math.random() - 0.5) * 400 - x
    );
    const speed = C.ASTEROID_SPEED_MIN + Math.random() * (C.ASTEROID_SPEED_MAX - C.ASTEROID_SPEED_MIN);

    // Generate random vertex offsets for irregular shape
    const vertices = [];
    const numVertices = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numVertices; i++) {
      vertices.push(0.7 + Math.random() * 0.3);
    }

    return {
      id: this._id(),
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      size,
      vertices,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
    };
  }

  tick() {
    if (this.state !== 'playing') return;

    // Update players
    for (const [, p] of this.players) {
      if (!p.alive) continue;

      if (p.invincible > 0) p.invincible--;
      if (p.shootCooldown > 0) p.shootCooldown--;

      // Rotation
      if (p.input.left) p.angle -= C.SHIP_ROTATION_SPEED;
      if (p.input.right) p.angle += C.SHIP_ROTATION_SPEED;

      // Movement
      if (p.input.up) {
        p.x += Math.cos(p.angle) * C.SHIP_SPEED;
        p.y += Math.sin(p.angle) * C.SHIP_SPEED;
      }
      if (p.input.down) {
        p.x -= Math.cos(p.angle) * C.SHIP_SPEED * 0.5;
        p.y -= Math.sin(p.angle) * C.SHIP_SPEED * 0.5;
      }

      // Strafe (absolute screen directions)
      if (p.input.strafeLeft)  p.x -= C.SHIP_SPEED;
      if (p.input.strafeRight) p.x += C.SHIP_SPEED;
      if (p.input.strafeUp)    p.y -= C.SHIP_SPEED;
      if (p.input.strafeDown)  p.y += C.SHIP_SPEED;

      // Wrap around
      if (p.x < 0) p.x = C.MAP_WIDTH;
      if (p.x > C.MAP_WIDTH) p.x = 0;
      if (p.y < 0) p.y = C.MAP_HEIGHT;
      if (p.y > C.MAP_HEIGHT) p.y = 0;

      // Shooting
      if (p.input.shoot && p.shootCooldown <= 0) {
        this.bullets.push({
          id: this._id(),
          x: p.x + Math.cos(p.angle) * C.SHIP_RADIUS,
          y: p.y + Math.sin(p.angle) * C.SHIP_RADIUS,
          vx: Math.cos(p.angle) * C.BULLET_SPEED,
          vy: Math.sin(p.angle) * C.BULLET_SPEED,
          ownerId: p.id,
          life: C.BULLET_LIFETIME,
        });
        p.shootCooldown = 8;
      }
    }

    // Update bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      if (b.life <= 0 || b.x < -50 || b.x > C.MAP_WIDTH + 50 || b.y < -50 || b.y > C.MAP_HEIGHT + 50) {
        this.bullets.splice(i, 1);
      }
    }

    // Update asteroids
    for (const a of this.asteroids) {
      a.x += a.vx;
      a.y += a.vy;
      a.rotation += a.rotationSpeed;

      // Wrap around
      if (a.x < -a.radius * 2) a.x = C.MAP_WIDTH + a.radius;
      if (a.x > C.MAP_WIDTH + a.radius * 2) a.x = -a.radius;
      if (a.y < -a.radius * 2) a.y = C.MAP_HEIGHT + a.radius;
      if (a.y > C.MAP_HEIGHT + a.radius * 2) a.y = -a.radius;
    }

    // Bullet-asteroid collisions
    const newAsteroids = [];
    for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
      const a = this.asteroids[ai];
      let hit = false;
      for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
        const b = this.bullets[bi];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy < (a.radius + C.BULLET_RADIUS) * (a.radius + C.BULLET_RADIUS)) {
          this.bullets.splice(bi, 1);
          hit = true;
          break;
        }
      }
      if (hit) {
        // Score
        if (a.size === 'large') this.score += C.SCORE_LARGE;
        else if (a.size === 'medium') this.score += C.SCORE_MEDIUM;
        else this.score += C.SCORE_SMALL;

        // Split
        if (a.size === 'large') {
          newAsteroids.push(this._createAsteroid('medium', a.x, a.y));
          newAsteroids.push(this._createAsteroid('medium', a.x, a.y));
        } else if (a.size === 'medium') {
          newAsteroids.push(this._createAsteroid('small', a.x, a.y));
          newAsteroids.push(this._createAsteroid('small', a.x, a.y));
        }

        this.asteroids.splice(ai, 1);
      }
    }
    this.asteroids.push(...newAsteroids);

    // Asteroid-player collisions
    for (const [, p] of this.players) {
      if (!p.alive || p.invincible > 0) continue;
      for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
        const a = this.asteroids[ai];
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        if (dx * dx + dy * dy < (a.radius + C.SHIP_RADIUS) * (a.radius + C.SHIP_RADIUS)) {
          this.lives--;
          this.asteroids.splice(ai, 1);
          // Respawn player at center
          p.x = C.MAP_WIDTH / 2 + (Math.random() - 0.5) * 200;
          p.y = C.MAP_HEIGHT / 2 + (Math.random() - 0.5) * 200;
          p.invincible = C.RESPAWN_INVINCIBILITY;

          if (this.lives <= 0) {
            this.state = 'gameover';
            this.io.to(this.code).emit('game-over', { score: this.score, wave: this.wave });
            clearInterval(this.tickInterval);
            clearInterval(this.broadcastInterval);
            clearTimeout(this.waveTimeout);
            // Auto-cleanup after 30s
            this.cleanupTimeout = setTimeout(() => this.destroy(), 30000);
            return;
          }
          break;
        }
      }
    }
  }

  getSnapshot() {
    const players = [];
    for (const [, p] of this.players) {
      players.push({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        angle: p.angle,
        alive: p.alive,
        invincible: p.invincible > 0,
        ready: p.ready,
      });
    }

    return {
      state: this.state,
      players,
      asteroids: this.asteroids.map(a => ({
        id: a.id,
        x: a.x,
        y: a.y,
        radius: a.radius,
        size: a.size,
        vertices: a.vertices,
        rotation: a.rotation,
      })),
      bullets: this.bullets.map(b => ({
        x: b.x,
        y: b.y,
      })),
      score: this.score,
      lives: this.lives,
      wave: this.wave,
    };
  }

  destroy() {
    clearInterval(this.tickInterval);
    clearInterval(this.broadcastInterval);
    clearTimeout(this.waveTimeout);
    clearTimeout(this.cleanupTimeout);
    this.state = 'gameover';
  }
}

module.exports = Room;
