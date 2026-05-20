const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// ─── Static Files ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Handle /join/:code route — serve the same SPA
app.get('/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Data Store ──────────────────────────────────────────────────
const rooms = new Map();

const PLAYER_COLORS = [
  '#f43f5e', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b',
  '#ec4899', '#6366f1', '#14b8a6', '#ef4444', '#a855f7',
  '#0ea5e9', '#84cc16', '#f97316', '#e879f9', '#2dd4bf',
  '#facc15', '#fb923c', '#38bdf8', '#4ade80', '#c084fc'
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function createRoom(hostId, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,
    players: [{
      id: hostId,
      name: hostName,
      color: PLAYER_COLORS[0],
      score: 0,
      isHost: true,
      truthCount: 0,
      dareCount: 0
    }],
    settings: {
      bottle: 0,
      mode: 30
    },
    state: {
      started: false,
      currentSpin: 0,
      phase: 'idle',        // idle | spinning | choosing | truth | dare
      selectedPlayer: null,
      spinnerIndex: 0,
      currentDare: null,
      truthAnswer: null
    },
    messages: []
  };
  rooms.set(code, room);
  return room;
}

function getPublicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    score: p.score,
    isHost: p.isHost,
    truthCount: p.truthCount,
    dareCount: p.dareCount
  }));
}

function getRoomForSocket(socketId) {
  for (const [code, room] of rooms) {
    if (room.players.find(p => p.id === socketId)) {
      return room;
    }
  }
  return null;
}

// ─── Socket.io ───────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);

  // ── Create Room ──
  socket.on('create_room', ({ name }, cb) => {
    if (!name || name.trim().length === 0) return cb({ error: 'Name required' });
    const room = createRoom(socket.id, name.trim());
    socket.join(room.code);
    console.log(`🏠 Room ${room.code} created by ${name}`);
    cb({
      code: room.code,
      players: getPublicPlayers(room),
      settings: room.settings,
      isHost: true
    });
  });

  // ── Join Room ──
  socket.on('join_room', ({ code, name }, cb) => {
    if (!name || name.trim().length === 0) return cb({ error: 'Name required' });
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Room not found' });
    if (room.state.started) return cb({ error: 'Game already in progress' });
    if (room.players.length >= 20) return cb({ error: 'Room is full' });
    if (room.players.find(p => p.name === name.trim())) return cb({ error: 'Name already taken' });

    const player = {
      id: socket.id,
      name: name.trim(),
      color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
      score: 0,
      isHost: false,
      truthCount: 0,
      dareCount: 0
    };
    room.players.push(player);
    socket.join(code);

    console.log(`👤 ${name} joined room ${code}`);
    io.to(code).emit('update_players', getPublicPlayers(room));
    cb({
      code: room.code,
      players: getPublicPlayers(room),
      settings: room.settings,
      isHost: false
    });
  });

  // ── Select Bottle ──
  socket.on('select_bottle', ({ bottleIndex }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    room.settings.bottle = bottleIndex;
    io.to(room.code).emit('bottle_selected', { bottleIndex });
  });

  // ── Change Mode ──
  socket.on('change_mode', ({ mode }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if ([20, 30, 40, 50].includes(mode)) {
      room.settings.mode = mode;
      io.to(room.code).emit('mode_changed', { mode });
    }
  });

  // ── Start Game ──
  socket.on('start_game', (_, cb) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return cb?.({ error: 'Not host' });
    if (room.players.length < 2) return cb?.({ error: 'Need at least 2 players' });

    room.state.started = true;
    room.state.phase = 'idle';
    room.state.currentSpin = 0;
    room.state.spinnerIndex = 0;
    console.log(`🎮 Game started in room ${room.code}`);
    io.to(room.code).emit('game_started', {
      settings: room.settings,
      players: getPublicPlayers(room),
      spinnerIndex: 0
    });
    cb?.({ success: true });
  });

  // ── Spin Bottle ──
  socket.on('spin_bottle', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.state.started) return;
    if (room.state.phase !== 'idle') return;

    // Only the current spinner or host can spin
    const currentSpinner = room.players[room.state.spinnerIndex];
    if (socket.id !== currentSpinner.id && socket.id !== room.hostId) return;

    room.state.phase = 'spinning';
    room.state.currentSpin++;

    // Pick a random player (not the spinner)
    const otherPlayers = room.players.filter((_, i) => i !== room.state.spinnerIndex);
    const selectedIdx = Math.floor(Math.random() * otherPlayers.length);
    const selected = otherPlayers[selectedIdx];
    const selectedPlayerIndex = room.players.findIndex(p => p.id === selected.id);

    // Calculate angle: each player is at (360/N * index) degrees
    const N = room.players.length;
    const targetAngle = (360 / N) * selectedPlayerIndex;
    // Add multiple full rotations for dramatic effect
    const totalRotation = 360 * (5 + Math.floor(Math.random() * 4)) + targetAngle;

    room.state.selectedPlayer = selected.id;
    room.state.phase = 'spinning';

    io.to(room.code).emit('bottle_result', {
      selectedPlayerId: selected.id,
      selectedPlayerName: selected.name,
      targetAngle: totalRotation,
      finalAngle: targetAngle,
      spinNumber: room.state.currentSpin,
      maxSpins: room.settings.mode
    });

    // After 4 seconds (animation duration), move to choosing phase
    setTimeout(() => {
      room.state.phase = 'choosing';
      io.to(room.code).emit('phase_change', {
        phase: 'choosing',
        selectedPlayerId: selected.id,
        selectedPlayerName: selected.name
      });
    }, 4000);
  });

  // ── Choose Truth or Dare ──
  socket.on('choose_truth_or_dare', ({ choice }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state.phase !== 'choosing') return;
    if (socket.id !== room.state.selectedPlayer) return;

    if (choice === 'truth') {
      room.state.phase = 'truth';
      io.to(room.code).emit('phase_change', {
        phase: 'truth',
        selectedPlayerId: socket.id,
        selectedPlayerName: room.players.find(p => p.id === socket.id).name
      });
    } else if (choice === 'dare') {
      room.state.phase = 'dare';
      io.to(room.code).emit('phase_change', {
        phase: 'dare',
        selectedPlayerId: socket.id,
        selectedPlayerName: room.players.find(p => p.id === socket.id).name
      });
      io.to(room.code).emit('trigger_dare_camera', {
        playerId: socket.id,
        playerName: room.players.find(p => p.id === socket.id).name
      });
    }
  });

  // ── Submit Truth ──
  socket.on('submit_truth', ({ answer }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state.phase !== 'truth') return;
    if (socket.id !== room.state.selectedPlayer) return;

    const player = room.players.find(p => p.id === socket.id);
    player.score += 1;
    player.truthCount++;

    const msg = {
      type: 'truth_answer',
      playerName: player.name,
      playerColor: player.color,
      text: answer,
      timestamp: Date.now()
    };
    room.messages.push(msg);

    io.to(room.code).emit('receive_chat_message', msg);
    io.to(room.code).emit('truth_submitted', {
      playerId: socket.id,
      playerName: player.name,
      answer
    });
    io.to(room.code).emit('update_players', getPublicPlayers(room));

    // Move to next spin
    advanceSpin(room);
  });

  // ── Dare Completed ──
  socket.on('dare_completed', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state.phase !== 'dare') return;
    if (socket.id !== room.hostId) return;

    const player = room.players.find(p => p.id === room.state.selectedPlayer);
    if (player) {
      player.score += 3;
      player.dareCount++;
    }

    io.to(room.code).emit('dare_done', {
      playerId: room.state.selectedPlayer,
      playerName: player?.name
    });
    io.to(room.code).emit('update_players', getPublicPlayers(room));

    advanceSpin(room);
  });

  // ── Chat ──
  socket.on('send_chat_message', ({ text }) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const msg = {
      type: 'chat',
      playerName: player.name,
      playerColor: player.color,
      text: text.slice(0, 500),
      timestamp: Date.now()
    };
    room.messages.push(msg);
    io.to(room.code).emit('receive_chat_message', msg);
  });

  // ── WebRTC Signaling ──
  socket.on('webrtc_offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc_offer', {
      senderId: socket.id,
      offer
    });
  });

  socket.on('webrtc_answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc_answer', {
      senderId: socket.id,
      answer
    });
  });

  socket.on('webrtc_ice', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc_ice', {
      senderId: socket.id,
      candidate
    });
  });

  // ── Terminate Room (Host Only) ──
  socket.on('terminate_room', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;

    const code = room.code;
    console.log(`🗑️  Room ${code} terminated by host — wiping all data`);

    // Broadcast room_closed to all players BEFORE deleting
    io.to(code).emit('room_closed');

    // Force-disconnect every socket in the room
    const socketsInRoom = io.sockets.adapter.rooms.get(code);
    if (socketsInRoom) {
      for (const sid of [...socketsInRoom]) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.leave(code);
          s.disconnect(true);
        }
      }
    }

    // Wipe all room data from memory
    room.players.length = 0;
    room.messages.length = 0;
    room.state = null;
    room.settings = null;
    rooms.delete(code);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    const wasHost = room.hostId === socket.id;
    room.players.splice(playerIndex, 1);

    console.log(`💨 ${socket.id} disconnected from room ${room.code}`);

    if (room.players.length === 0) {
      rooms.delete(room.code);
      console.log(`🗑️  Room ${room.code} deleted (empty)`);
      return;
    }

    // Host migration
    if (wasHost) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
      io.to(room.code).emit('host_changed', {
        newHostId: room.players[0].id,
        newHostName: room.players[0].name
      });
    }

    // Fix spinner index if needed
    if (room.state.spinnerIndex >= room.players.length) {
      room.state.spinnerIndex = 0;
    }

    // If the selected player left during their turn, advance
    if (room.state.selectedPlayer === socket.id &&
        ['choosing', 'truth', 'dare'].includes(room.state.phase)) {
      room.state.phase = 'idle';
      io.to(room.code).emit('phase_change', { phase: 'idle' });
    }

    io.to(room.code).emit('update_players', getPublicPlayers(room));
    io.to(room.code).emit('player_left', { playerId: socket.id });
  });
});

// ── Advance to Next Spin ──
function advanceSpin(room) {
  // Check if game is over
  if (room.state.currentSpin >= room.settings.mode) {
    room.state.phase = 'gameover';
    room.state.started = false;
    const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
    io.to(room.code).emit('game_over', {
      leaderboard: leaderboard.map(p => ({
        name: p.name,
        color: p.color,
        score: p.score,
        truthCount: p.truthCount,
        dareCount: p.dareCount
      }))
    });
    return;
  }

  // Advance spinner
  room.state.spinnerIndex = (room.state.spinnerIndex + 1) % room.players.length;
  room.state.phase = 'idle';
  room.state.selectedPlayer = null;

  io.to(room.code).emit('next_turn', {
    spinnerIndex: room.state.spinnerIndex,
    spinnerId: room.players[room.state.spinnerIndex].id,
    spinnerName: room.players[room.state.spinnerIndex].name,
    spinNumber: room.state.currentSpin,
    maxSpins: room.settings.mode
  });
}

// ─── Start Server ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎉 Spin & Spill running on http://localhost:${PORT}\n`);
});
