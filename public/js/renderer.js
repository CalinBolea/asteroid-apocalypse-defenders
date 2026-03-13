class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  clear() {
    this.ctx.fillStyle = '#0a0a1a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Camera transform: center on player, showing portion of the map
  getCamera(playerId, players) {
    const me = players.find(p => p.id === playerId);
    if (!me) return { x: 0, y: 0, scale: 1 };

    const scale = Math.min(this.canvas.width / 800, this.canvas.height / 600);
    return {
      x: me.x,
      y: me.y,
      scale,
    };
  }

  worldToScreen(wx, wy, cam) {
    return {
      x: (wx - cam.x) * cam.scale + this.canvas.width / 2,
      y: (wy - cam.y) * cam.scale + this.canvas.height / 2,
    };
  }

  drawGrid(cam) {
    const ctx = this.ctx;
    const spacing = 100;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;

    const startX = -cam.x * cam.scale + this.canvas.width / 2;
    const startY = -cam.y * cam.scale + this.canvas.height / 2;

    for (let wx = 0; wx <= 2000; wx += spacing) {
      const sx = startX + wx * cam.scale;
      ctx.beginPath();
      ctx.moveTo(sx, startY);
      ctx.lineTo(sx, startY + 1500 * cam.scale);
      ctx.stroke();
    }
    for (let wy = 0; wy <= 1500; wy += spacing) {
      const sy = startY + wy * cam.scale;
      ctx.beginPath();
      ctx.moveTo(startX, sy);
      ctx.lineTo(startX + 2000 * cam.scale, sy);
      ctx.stroke();
    }

    // Map border
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    const topLeft = this.worldToScreen(0, 0, cam);
    ctx.strokeRect(topLeft.x, topLeft.y, 2000 * cam.scale, 1500 * cam.scale);
  }

  drawShip(player, cam) {
    const ctx = this.ctx;
    const pos = this.worldToScreen(player.x, player.y, cam);
    const r = 18 * cam.scale;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(player.angle);

    // Ship body (triangle)
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, -r * 0.6);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r * 0.7, r * 0.6);
    ctx.closePath();

    if (player.invincible) {
      ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.01) * 0.3;
    }

    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.restore();

    // Name tag
    ctx.fillStyle = player.color;
    ctx.font = `${Math.round(11 * cam.scale)}px Courier New`;
    ctx.textAlign = 'center';
    ctx.fillText(player.name, pos.x, pos.y - r - 6 * cam.scale);
  }

  drawAsteroid(asteroid, cam) {
    const ctx = this.ctx;
    const pos = this.worldToScreen(asteroid.x, asteroid.y, cam);
    const r = asteroid.radius * cam.scale;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(asteroid.rotation);

    ctx.beginPath();
    const verts = asteroid.vertices;
    for (let i = 0; i < verts.length; i++) {
      const angle = (i / verts.length) * Math.PI * 2;
      const vr = r * verts[i];
      const x = Math.cos(angle) * vr;
      const y = Math.sin(angle) * vr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.fillStyle = '#4a3a2a';
    ctx.fill();
    ctx.strokeStyle = '#8a7a6a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  drawBullet(bullet, cam) {
    const ctx = this.ctx;
    const pos = this.worldToScreen(bullet.x, bullet.y, cam);
    const r = 3 * cam.scale;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffff88';
    ctx.fill();
    ctx.shadowColor = '#ffff00';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawHUD(state) {
    const ctx = this.ctx;
    const padding = 20;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, this.canvas.width, 50);

    ctx.font = '18px Courier New';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#00ffff';
    ctx.fillText('SCORE: ' + state.score, padding, 33);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4466';
    ctx.fillText('LIVES: ' + state.lives, this.canvas.width / 2, 33);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffff00';
    ctx.fillText('WAVE: ' + state.wave, this.canvas.width - padding, 33);
  }

  drawWaiting(players, roomCode) {
    const ctx = this.ctx;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    ctx.fillStyle = '#00ffff';
    ctx.font = '36px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('ROOM: ' + roomCode, cx, cy - 100);

    ctx.fillStyle = '#e0e0ff';
    ctx.font = '18px Courier New';
    ctx.fillText('Players in room:', cx, cy - 50);

    players.forEach((p, i) => {
      const readyTag = p.ready ? ' \u2714' : '';
      ctx.fillStyle = p.color;
      ctx.fillText(p.name + readyTag, cx, cy - 20 + i * 28);
    });

    ctx.fillStyle = '#888';
    ctx.font = '16px Courier New';
    ctx.fillText('Press SPACE or click READY when you\'re ready', cx, cy + 120);
  }

  drawGameOver(score, wave) {
    const ctx = this.ctx;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#ff4466';
    ctx.font = '48px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', cx, cy - 40);

    ctx.fillStyle = '#00ffff';
    ctx.font = '24px Courier New';
    ctx.fillText('Score: ' + score, cx, cy + 20);
    ctx.fillText('Wave: ' + wave, cx, cy + 55);

    ctx.fillStyle = '#888';
    ctx.font = '16px Courier New';
    ctx.fillText('Refresh to play again', cx, cy + 100);
  }
}
