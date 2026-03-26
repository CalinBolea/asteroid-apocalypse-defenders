const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Room = require('./game/Room');
const C = require('./game/constants');

const app = express();
const server = http.createServer(app);

const BASE_PATH = '/asteroid-apocalypse-defenders';

const io = new Server(server, {
  path: BASE_PATH + '/socket.io/',
});

app.use(express.json());

app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

// Room management
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < C.ROOM_CODE_LENGTH; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

// API routes
app.post(BASE_PATH + '/api/rooms', (req, res) => {
  const code = generateCode();
  const mode = req.body && req.body.mode === 'planet-killer' ? 'planet-killer' : 'belt-chaos';
  const room = new Room(code, io, mode);
  rooms.set(code, room);
  res.json({ code, mode });
});

app.get(BASE_PATH + '/api/rooms/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);
  if (!room || room.state === 'gameover') {
    return res.status(404).json({ error: 'Room not found' });
  }
  if (room.players.size >= C.MAX_PLAYERS) {
    return res.status(400).json({ error: 'Room is full' });
  }
  res.json({ code, players: room.players.size, state: room.state, mode: room.mode });
});

// Socket.io
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ code, name }) => {
    code = (code || '').toUpperCase();
    name = (name || 'Player').trim().slice(0, 16) || 'Player';

    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (!room.addPlayer(socket, name)) {
      socket.emit('error', { message: 'Cannot join room' });
      return;
    }

    currentRoom = room;
    socket.emit('room-joined', {
      code: room.code,
      playerId: socket.id,
      state: room.state,
      mode: room.mode,
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
    });

    // Notify others
    socket.to(room.code).emit('player-joined', { id: socket.id, name, color: room.players.get(socket.id).color });
  });

  socket.on('player-ready', () => {
    if (currentRoom) {
      currentRoom.setPlayerReady(socket.id);
    }
  });

  socket.on('player-input', (input) => {
    if (currentRoom) {
      const player = currentRoom.players.get(socket.id);
      if (player) {
        player.input = {
          up: !!input.up,
          down: !!input.down,
          left: !!input.left,
          right: !!input.right,
          strafeLeft: !!input.strafeLeft,
          strafeRight: !!input.strafeRight,
          strafeUp: !!input.strafeUp,
          strafeDown: !!input.strafeDown,
          shoot: !!input.shoot,
        };
      }
    }
  });

  socket.on('purchase-upgrade', (type) => {
    if (!currentRoom || currentRoom.state !== 'upgrading') return;
    const player = currentRoom.players.get(socket.id);
    if (!player) return;

    const costs = {
      moveSpeed: C.UPGRADE_COST_MOVE_SPEED,
      attackSpeed: C.UPGRADE_COST_ATTACK_SPEED,
      shield: C.UPGRADE_COST_SHIELD,
      dualCannon: C.UPGRADE_COST_DUAL_CANNON,
    };

    const cost = costs[type];
    if (cost === undefined) return;
    if (player.upgradePoints < cost) return;

    if (type === 'moveSpeed') {
      if (player.upgrades.moveSpeed >= C.MAX_MOVE_SPEED_LEVEL) return;
      player.upgrades.moveSpeed++;
    } else if (type === 'attackSpeed') {
      if (player.upgrades.attackSpeed >= C.MAX_ATTACK_SPEED_LEVEL) return;
      player.upgrades.attackSpeed++;
    } else if (type === 'shield') {
      if (player.upgrades.shield) return;
      player.upgrades.shield = true;
    } else if (type === 'dualCannon') {
      if (player.upgrades.dualCannon) return;
      player.upgrades.dualCannon = true;
    }

    player.upgradePoints -= cost;
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const shouldRemove = currentRoom.removePlayer(socket.id);
      if (shouldRemove) {
        rooms.delete(currentRoom.code);
      } else {
        socket.to(currentRoom.code).emit('player-left', { id: socket.id });
      }
    }
  });
});

const PORT = process.env.PORT || 3099;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Game at http://localhost:${PORT}${BASE_PATH}/`);
});
