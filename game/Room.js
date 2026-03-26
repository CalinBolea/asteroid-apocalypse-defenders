const C = require('./constants');
const WORDS = require('./words');

class Room {
  constructor(code, io, mode = 'belt-chaos') {
    this.code = code;
    this.io = io;
    this.mode = mode;
    this.players = new Map();
    this.asteroids = [];
    this.bullets = [];
    this.score = 0;
    this.lives = C.STARTING_LIVES;
    this.wave = 0;
    this.state = 'waiting'; // waiting | playing | upgrading | gameover
    this.tickInterval = null;
    this.broadcastInterval = null;
    this.waveTimeout = null;
    this.cleanupTimeout = null;
    this.nextEntityId = 1;
    this.base = null;
    this.swarmRemaining = 0;
    this.swarmSpawnTimer = 0;
    this.tdBase = null;
    this.tdWavePauseTimer = 0;
    this.tdAsteroidsSpawned = 0;
    this.tdAsteroidsTotal = 0;
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
      upgradePoints: 0,
      upgrades: { moveSpeed: 0, attackSpeed: 0, shield: false, dualCannon: false },
    };

    if (this.mode === 'typing-defense') {
      player.currentWord = this._assignWord();
      player.charIndex = 0;
      player.wordsCompleted = 0;
    }

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
    if (this.state !== 'waiting' && this.state !== 'upgrading') return;
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
    if (this.state === 'waiting') {
      this.startGame();
    } else if (this.state === 'upgrading') {
      this.resumeFromUpgrade();
    }
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

    if (this.mode === 'swarm-defense') {
      this.base = {
        x: C.MAP_WIDTH / 2,
        y: C.MAP_HEIGHT / 2,
        radius: C.SD_BASE_RADIUS,
        hp: C.SD_BASE_HP,
        maxHp: C.SD_BASE_HP,
      };
    }

    if (this.mode === 'typing-defense') {
      this.tdBase = {
        x: (C.MAP_WIDTH - C.TD_BASE_WIDTH) / 2,
        y: C.TD_BASE_Y,
        width: C.TD_BASE_WIDTH,
        height: C.TD_BASE_HEIGHT,
        hp: C.TD_BASE_HP,
        maxHp: C.TD_BASE_HP,
      };
      this._positionTypingPlayers();
    }

    this.spawnWave();

    this.tickInterval = setInterval(() => this.tick(), 1000 / C.TICK_RATE);
    this.broadcastInterval = setInterval(() => {
      this.io.to(this.code).emit('game-state', this.getSnapshot());
    }, 1000 / C.BROADCAST_RATE);
  }

  spawnWave() {
    if (this.wave >= 1) {
      // Enter upgrading state between waves
      for (const [, p] of this.players) {
        if (this.mode !== 'typing-defense') {
          p.upgradePoints += C.UPGRADE_POINTS_PER_WAVE;
        }
        p.ready = false;
      }
      this.state = 'upgrading';
      clearTimeout(this.waveTimeout);
      this.io.to(this.code).emit('lobby-update', this._getLobbyPlayers());
      return;
    }
    this._startWave();
  }

  resumeFromUpgrade() {
    this.state = 'playing';
    this._startWave();
  }

  _startWave() {
    this.wave++;

    if (this.mode === 'typing-defense') {
      const count = C.TD_ASTEROID_COUNT + (this.wave - 1) * C.TD_ASTEROID_INCREMENT;
      this.tdAsteroidsTotal = count;
      this.tdAsteroidsSpawned = count;
      for (let i = 0; i < count; i++) {
        this.asteroids.push(this._createTypingAsteroid(i, count));
      }
      this.tdBase.maxHp = C.TD_BASE_HP + (this.wave - 1) * C.TD_BASE_HP_INCREMENT;
      this.tdBase.hp = this.tdBase.maxHp;
      this.tdWavePauseTimer = 0;
      return;
    }

    if (this.mode === 'planet-killer') {
      this.asteroids.push(this._createPlanetKiller());
    } else if (this.mode === 'swarm-defense') {
      this.swarmRemaining = C.SD_SWARM_COUNT + (this.wave - 1) * C.SD_SWARM_INCREMENT;
      this.swarmSpawnTimer = 0;
      this.base.maxHp = C.SD_BASE_HP + (this.wave - 1) * C.SD_BASE_HP_INCREMENT;
      this.base.hp = this.base.maxHp;
    } else {
      const count = C.WAVE_BASE_COUNT + (this.wave - 1) * C.WAVE_INCREMENT;
      for (let i = 0; i < count; i++) {
        this.asteroids.push(this._createAsteroid('large'));
      }
      this.waveTimeout = setTimeout(() => {
        if (this.state === 'playing') this.spawnWave();
      }, C.WAVE_INTERVAL);
    }
  }

  _createPlanetKiller() {
    const maxRadius = Math.min(
      C.PK_BASE_RADIUS + (this.wave - 1) * C.PK_RADIUS_INCREMENT,
      C.PK_MAX_RADIUS
    );
    const maxHp = C.PK_BASE_HP + (this.wave - 1) * C.PK_HP_INCREMENT;

    let x, y;
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: x = Math.random() * C.MAP_WIDTH; y = -maxRadius; break;
      case 1: x = C.MAP_WIDTH + maxRadius; y = Math.random() * C.MAP_HEIGHT; break;
      case 2: x = Math.random() * C.MAP_WIDTH; y = C.MAP_HEIGHT + maxRadius; break;
      case 3: x = -maxRadius; y = Math.random() * C.MAP_HEIGHT; break;
    }

    const angle = Math.atan2(
      C.MAP_HEIGHT / 2 + (Math.random() - 0.5) * 200 - y,
      C.MAP_WIDTH / 2 + (Math.random() - 0.5) * 200 - x
    );

    const vertices = [];
    for (let i = 0; i < C.PK_VERTEX_COUNT; i++) {
      vertices.push(0.85 + Math.random() * 0.15);
    }

    return {
      id: this._id(),
      x, y,
      vx: Math.cos(angle) * C.PK_ASTEROID_SPEED,
      vy: Math.sin(angle) * C.PK_ASTEROID_SPEED,
      radius: maxRadius,
      maxRadius,
      size: 'planet-killer',
      hp: maxHp,
      maxHp,
      vertices,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.005,
    };
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

  _createSwarmAsteroid() {
    const radius = C.ASTEROID_RADIUS_SMALL;
    let x, y;
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: x = Math.random() * C.MAP_WIDTH; y = -radius; break;
      case 1: x = C.MAP_WIDTH + radius; y = Math.random() * C.MAP_HEIGHT; break;
      case 2: x = Math.random() * C.MAP_WIDTH; y = C.MAP_HEIGHT + radius; break;
      case 3: x = -radius; y = Math.random() * C.MAP_HEIGHT; break;
    }

    const angle = Math.atan2(this.base.y - y, this.base.x - x) + (Math.random() - 0.5) * 0.2;
    const speed = C.SD_SWARM_SPEED_MIN + Math.random() * (C.SD_SWARM_SPEED_MAX - C.SD_SWARM_SPEED_MIN);

    const vertices = [];
    const numVertices = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numVertices; i++) {
      vertices.push(0.7 + Math.random() * 0.3);
    }

    return {
      id: this._id(),
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      size: 'small',
      vertices,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.06,
    };
  }

  _positionTypingPlayers() {
    const baseLeft = this.tdBase.x;
    const playerCount = this.players.size;
    const spacing = this.tdBase.width / (playerCount + 1);
    let i = 0;
    for (const [, p] of this.players) {
      p.x = baseLeft + spacing * (i + 1);
      p.y = C.TD_BASE_Y - 30;
      p.angle = -Math.PI / 2;
      i++;
    }
  }

  _assignWord() {
    return WORDS[Math.floor(Math.random() * WORDS.length)];
  }

  handleTypingChar(socketId, char) {
    if (this.state !== 'playing') return;
    const player = this.players.get(socketId);
    if (!player) return;

    const expected = player.currentWord[player.charIndex];
    if (char.toLowerCase() !== expected) return;

    player.charIndex++;
    this._fireAtNearest(player);

    if (player.charIndex >= player.currentWord.length) {
      this.score += C.TD_WORD_COMPLETE_BONUS;
      player.wordsCompleted++;
      player.currentWord = this._assignWord();
      player.charIndex = 0;
    }
  }

  _fireAtNearest(player) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const a of this.asteroids) {
      const dx = a.x - player.x;
      const dy = a.y - player.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = a;
      }
    }
    if (!nearest) return;

    const px = player.x;
    const py = player.y - C.SHIP_RADIUS;

    // Predictive aiming — solve for intercept point
    let dx = nearest.x - px;
    let dy = nearest.y - py;
    const avx = nearest.vx;
    const avy = nearest.vy;
    const spd = C.TD_BULLET_SPEED;

    const a = avx * avx + avy * avy - spd * spd;
    const b = 2 * (dx * avx + dy * avy);
    const c = dx * dx + dy * dy;
    const disc = b * b - 4 * a * c;

    let ix = nearest.x;
    let iy = nearest.y;

    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);
      const t = t1 > 0 ? t1 : t2 > 0 ? t2 : -1;
      if (t > 0) {
        ix = nearest.x + avx * t;
        iy = nearest.y + avy * t;
      }
    }

    const angle = Math.atan2(iy - py, ix - px);
    this.bullets.push({
      id: this._id(),
      x: px,
      y: py,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      ownerId: player.id,
      life: C.BULLET_LIFETIME,
    });
  }

  _createTypingAsteroid(index, total) {
    const margin = C.TD_SPAWN_MARGIN;
    const x = margin + Math.random() * (C.MAP_WIDTH - margin * 2);
    const y = -C.ASTEROID_RADIUS_MEDIUM - (index / total) * 400;
    const speed = C.TD_ASTEROID_SPEED_MIN + Math.random() * (C.TD_ASTEROID_SPEED_MAX - C.TD_ASTEROID_SPEED_MIN);
    const drift = (Math.random() - 0.5) * 0.3;

    const vertices = [];
    const numVertices = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numVertices; i++) {
      vertices.push(0.7 + Math.random() * 0.3);
    }

    return {
      id: this._id(),
      x, y,
      vx: drift,
      vy: speed,
      radius: C.ASTEROID_RADIUS_MEDIUM,
      size: 'medium',
      vertices,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
    };
  }

  tick() {
    if (this.state !== 'playing') return;

    // Swarm spawning
    if (this.mode === 'swarm-defense' && this.swarmRemaining > 0) {
      this.swarmSpawnTimer--;
      if (this.swarmSpawnTimer <= 0) {
        const batch = Math.min(C.SD_SPAWN_BATCH, this.swarmRemaining);
        for (let i = 0; i < batch; i++) {
          this.asteroids.push(this._createSwarmAsteroid());
        }
        this.swarmRemaining -= batch;
        this.swarmSpawnTimer = C.SD_SPAWN_INTERVAL;
      }
    }

    // Typing defense wave pause timer
    if (this.mode === 'typing-defense' && this.tdWavePauseTimer > 0) {
      this.tdWavePauseTimer--;
      if (this.tdWavePauseTimer <= 0) {
        this.spawnWave();
      }
      return;
    }

    // Update players
    for (const [, p] of this.players) {
      if (!p.alive) continue;

      if (p.invincible > 0) p.invincible--;

      if (this.mode === 'typing-defense') continue;

      if (p.shootCooldown > 0) p.shootCooldown--;

      // Rotation
      if (p.input.left) p.angle -= C.SHIP_ROTATION_SPEED;
      if (p.input.right) p.angle += C.SHIP_ROTATION_SPEED;

      // Movement
      const speed = C.SHIP_SPEED + p.upgrades.moveSpeed * C.MOVE_SPEED_BONUS;
      if (p.input.up) {
        p.x += Math.cos(p.angle) * speed;
        p.y += Math.sin(p.angle) * speed;
      }
      if (p.input.down) {
        p.x -= Math.cos(p.angle) * speed * 0.5;
        p.y -= Math.sin(p.angle) * speed * 0.5;
      }

      // Strafe (absolute screen directions)
      if (p.input.strafeLeft)  p.x -= speed;
      if (p.input.strafeRight) p.x += speed;
      if (p.input.strafeUp)    p.y -= speed;
      if (p.input.strafeDown)  p.y += speed;

      // Wrap around
      if (p.x < 0) p.x = C.MAP_WIDTH;
      if (p.x > C.MAP_WIDTH) p.x = 0;
      if (p.y < 0) p.y = C.MAP_HEIGHT;
      if (p.y > C.MAP_HEIGHT) p.y = 0;

      // Shooting
      if (p.input.shoot && p.shootCooldown <= 0) {
        const angles = p.upgrades.dualCannon
          ? [p.angle - C.DUAL_CANNON_SPREAD, p.angle + C.DUAL_CANNON_SPREAD]
          : [p.angle];
        for (const a of angles) {
          this.bullets.push({
            id: this._id(),
            x: p.x + Math.cos(a) * C.SHIP_RADIUS,
            y: p.y + Math.sin(a) * C.SHIP_RADIUS,
            vx: Math.cos(a) * C.BULLET_SPEED,
            vy: Math.sin(a) * C.BULLET_SPEED,
            ownerId: p.id,
            life: C.BULLET_LIFETIME,
          });
        }
        p.shootCooldown = Math.max(C.MIN_SHOOT_COOLDOWN, 16 - p.upgrades.attackSpeed * C.ATTACK_SPEED_BONUS);
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
      // Planet killer hunts the nearest player
      if (a.size === 'planet-killer') {
        let closest = null;
        let closestDist = Infinity;
        for (const [, p] of this.players) {
          if (!p.alive) continue;
          const dx = p.x - a.x;
          const dy = p.y - a.y;
          const dist = dx * dx + dy * dy;
          if (dist < closestDist) {
            closestDist = dist;
            closest = p;
          }
        }
        if (closest) {
          const angle = Math.atan2(closest.y - a.y, closest.x - a.x);
          const turnRate = 0.02;
          const currentAngle = Math.atan2(a.vy, a.vx);
          let diff = angle - currentAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const newAngle = currentAngle + Math.sign(diff) * Math.min(Math.abs(diff), turnRate);
          const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
          a.vx = Math.cos(newAngle) * speed;
          a.vy = Math.sin(newAngle) * speed;
        }
      }

      a.x += a.vx;
      a.y += a.vy;
      a.rotation += a.rotationSpeed;

      // Wrap around
      if (this.mode !== 'swarm-defense' && this.mode !== 'typing-defense') {
        if (a.x < -a.radius * 2) a.x = C.MAP_WIDTH + a.radius;
        if (a.x > C.MAP_WIDTH + a.radius * 2) a.x = -a.radius;
        if (a.y < -a.radius * 2) a.y = C.MAP_HEIGHT + a.radius;
        if (a.y > C.MAP_HEIGHT + a.radius * 2) a.y = -a.radius;
      }
    }

    // Remove out-of-bounds asteroids in swarm-defense / typing-defense
    if (this.mode === 'swarm-defense' || this.mode === 'typing-defense') {
      for (let i = this.asteroids.length - 1; i >= 0; i--) {
        const a = this.asteroids[i];
        if (a.x < -a.radius * 2 || a.x > C.MAP_WIDTH + a.radius * 2 ||
            a.y < -a.radius * 2 || a.y > C.MAP_HEIGHT + a.radius * 2) {
          this.asteroids.splice(i, 1);
        }
      }
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
        if (a.size === 'planet-killer') {
          a.hp--;
          this.score += C.PK_SCORE_PER_HP;
          a.radius = C.PK_MIN_RADIUS + (a.maxRadius - C.PK_MIN_RADIUS) * (a.hp / a.maxHp);

          if (a.hp <= 0) {
            this.score += C.PK_SCORE_KILL_BONUS;
            this.asteroids.splice(ai, 1);
            this.spawnWave();
          }
        } else if (this.mode === 'swarm-defense') {
          this.score += C.SD_SCORE_PER_ASTEROID;
          this.asteroids.splice(ai, 1);
        } else if (this.mode === 'typing-defense') {
          this.score += C.TD_SCORE_PER_ASTEROID;
          this.asteroids.splice(ai, 1);
        } else {
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
    }
    this.asteroids.push(...newAsteroids);

    // Asteroid-player collisions (skip for typing-defense)
    if (this.mode === 'typing-defense') {
      // Skip — players are stationary turrets on the base
    } else for (const [, p] of this.players) {
      if (!p.alive || p.invincible > 0) continue;
      for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
        const a = this.asteroids[ai];
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        if (dx * dx + dy * dy < (a.radius + C.SHIP_RADIUS) * (a.radius + C.SHIP_RADIUS)) {
          if (p.upgrades.shield) {
            p.upgrades.shield = false;
            if (a.size !== 'planet-killer') this.asteroids.splice(ai, 1);
            break;
          }
          this.lives--;
          if (a.size !== 'planet-killer') this.asteroids.splice(ai, 1);
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

    // Asteroid-base collisions (swarm-defense)
    if (this.mode === 'swarm-defense' && this.base) {
      for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
        const a = this.asteroids[ai];
        const dx = a.x - this.base.x;
        const dy = a.y - this.base.y;
        if (dx * dx + dy * dy < (a.radius + this.base.radius) * (a.radius + this.base.radius)) {
          this.base.hp--;
          this.asteroids.splice(ai, 1);
          if (this.base.hp <= 0) {
            this.state = 'gameover';
            this.io.to(this.code).emit('game-over', { score: this.score, wave: this.wave });
            clearInterval(this.tickInterval);
            clearInterval(this.broadcastInterval);
            clearTimeout(this.waveTimeout);
            this.cleanupTimeout = setTimeout(() => this.destroy(), 30000);
            return;
          }
        }
      }
    }

    // Swarm wave completion check
    if (this.mode === 'swarm-defense' && this.swarmRemaining === 0 && this.asteroids.length === 0) {
      this.score += C.SD_WAVE_COMPLETE_BONUS;
      this.spawnWave();
    }

    // Typing defense base collision
    if (this.mode === 'typing-defense' && this.tdBase) {
      for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
        const a = this.asteroids[ai];
        if (a.y + a.radius >= this.tdBase.y) {
          this.tdBase.hp--;
          this.asteroids.splice(ai, 1);
          if (this.tdBase.hp <= 0) {
            this.state = 'gameover';
            this.io.to(this.code).emit('game-over', { score: this.score, wave: this.wave });
            clearInterval(this.tickInterval);
            clearInterval(this.broadcastInterval);
            clearTimeout(this.waveTimeout);
            this.cleanupTimeout = setTimeout(() => this.destroy(), 30000);
            return;
          }
        }
      }

      // Wave completion
      if (this.tdAsteroidsSpawned > 0 && this.asteroids.length === 0 && this.tdWavePauseTimer <= 0) {
        this.score += C.TD_WAVE_COMPLETE_BONUS;
        this.tdWavePauseTimer = C.TD_WAVE_PAUSE_TICKS;
      }
    }
  }

  getSnapshot() {
    const players = [];
    for (const [, p] of this.players) {
      const playerData = {
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        angle: p.angle,
        alive: p.alive,
        invincible: p.invincible > 0,
        ready: p.ready,
        upgradePoints: p.upgradePoints,
        upgrades: { ...p.upgrades },
      };
      if (this.mode === 'typing-defense') {
        playerData.currentWord = p.currentWord;
        playerData.charIndex = p.charIndex;
        playerData.wordsCompleted = p.wordsCompleted;
      }
      players.push(playerData);
    }

    return {
      mode: this.mode,
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
        hp: a.hp,
        maxHp: a.maxHp,
      })),
      bullets: this.bullets.map(b => ({
        x: b.x,
        y: b.y,
      })),
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      base: this.base,
      swarmRemaining: this.swarmRemaining,
      tdBase: this.tdBase,
      tdWavePausing: this.tdWavePauseTimer > 0,
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
