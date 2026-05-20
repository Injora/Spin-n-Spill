require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7 
});
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/join/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});
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
      dareCount: 0,
      connected: true
    }],
    settings: {
      bottle: 0,
      mode: 30
    },
    state: {
      started: false,
      currentSpin: 0,
      phase: 'idle',
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
    dareCount: p.dareCount,
    connected: p.connected
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
io.on('connection', (socket) => {
  console.log(`⚡ Connected: ${socket.id}`);
  socket.on('create_room', ({ name }, cb) => {
    if (!name || name.trim().length === 0) return cb({ error: 'Name required' });
    const room = createRoom(socket.id, name.trim());
    socket.join(room.code);
    console.log(`🏠 Room ${room.code} created by ${name}`);
    cb({
      code: room.code,
      players: getPublicPlayers(room),
      settings: room.settings,
      isHost: true,
      gameStarted: false
    });
  });
  socket.on('join_room', ({ code, name }, cb) => {
    if (!name || name.trim().length === 0) return cb({ error: 'Name required' });
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Room not found' });
    const existingPlayer = room.players.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
    if (existingPlayer) {
      if (existingPlayer.connected) {
        return cb({ error: 'Name already taken' });
      } else {
        existingPlayer.id = socket.id;
        existingPlayer.connected = true;
        if (existingPlayer.isHost) {
          room.hostId = socket.id;
        }
        socket.join(code);
        console.log(`⚡ ${name} reconnected to room ${code}`);
        io.to(code).emit('update_players', getPublicPlayers(room));
        const reconnectMsg = {
          type: 'system',
          text: `🔄 ${name.trim()} reconnected!`,
          timestamp: Date.now()
        };
        room.messages.push(reconnectMsg);
        io.to(code).emit('receive_chat_message', reconnectMsg);
        return cb({
          code: room.code,
          players: getPublicPlayers(room),
          settings: room.settings,
          isHost: existingPlayer.isHost,
          gameStarted: room.state.started
        });
      }
    }
    if (room.state.started) return cb({ error: 'Game already in progress' });
    if (room.players.length >= 20) return cb({ error: 'Room is full' });
    const player = {
      id: socket.id,
      name: name.trim(),
      color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
      score: 0,
      isHost: false,
      truthCount: 0,
      dareCount: 0,
      connected: true
    };
    room.players.push(player);
    socket.join(code);
    console.log(`👤 ${name} joined room ${code}`);
    io.to(code).emit('update_players', getPublicPlayers(room));
    const joinMsg = {
      type: 'system',
      text: `👋 ${name.trim()} joined the room!`,
      timestamp: Date.now()
    };
    room.messages.push(joinMsg);
    io.to(code).emit('receive_chat_message', joinMsg);
    cb({
      code: room.code,
      players: getPublicPlayers(room),
      settings: room.settings,
      isHost: false,
      gameStarted: room.state.started
    });
  });
  socket.on('select_bottle', ({ bottleIndex }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    room.settings.bottle = bottleIndex;
    io.to(room.code).emit('bottle_selected', { bottleIndex });
  });
  socket.on('change_mode', ({ mode }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if ([20, 30, 40, 50].includes(mode)) {
      room.settings.mode = mode;
      io.to(room.code).emit('mode_changed', { mode });
    }
  });
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
  socket.on('spin_bottle', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || !room.state.started) return;
    if (room.state.phase !== 'idle') return;
    const currentSpinner = room.players[room.state.spinnerIndex];
    if (socket.id !== currentSpinner.id && socket.id !== room.hostId) return;
    room.state.phase = 'spinning';
    room.state.currentSpin++;
    const otherPlayers = room.players.filter((_, i) => i !== room.state.spinnerIndex);
    const selectedIdx = Math.floor(Math.random() * otherPlayers.length);
    const selected = otherPlayers[selectedIdx];
    const selectedPlayerIndex = room.players.findIndex(p => p.id === selected.id);
    const N = room.players.length;
    const targetAngle = (360 / N) * selectedPlayerIndex;
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
    setTimeout(() => {
      room.state.phase = 'choosing';
      io.to(room.code).emit('phase_change', {
        phase: 'choosing',
        selectedPlayerId: selected.id,
        selectedPlayerName: selected.name
      });
    }, 4000);
  });
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
    advanceSpin(room);
  });
  socket.on('submit_dare_photo', ({ photo }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state.phase !== 'dare') return;
    if (socket.id !== room.state.selectedPlayer) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    console.log(`📸 Received dare photo upload from ${player.name} in room ${room.code}`);
    io.to(room.code).emit('dare_photo_received', {
      photo,
      playerName: player.name
    });
  });
  socket.on('approve_dare', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state.phase !== 'dare') return;
    if (socket.id !== room.hostId) return;
    const player = room.players.find(p => p.id === room.state.selectedPlayer);
    if (player) {
      player.score += 3;
      player.dareCount++;
    }
    console.log(`✅ Host approved dare in room ${room.code}`);
    io.to(room.code).emit('dare_photo_approved', {
      playerId: room.state.selectedPlayer,
      playerName: player?.name
    });
    io.to(room.code).emit('update_players', getPublicPlayers(room));
    advanceSpin(room);
  });
  socket.on('reject_dare', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state.phase !== 'dare') return;
    if (socket.id !== room.hostId) return;
    const player = room.players.find(p => p.id === room.state.selectedPlayer);
    const funnyMessages = [
      `oof, that dare was weaker than decaf coffee! ☕`,
      `dare rejected! Better luck next time! 👎`,
      `denied! Even a toddler would dare harder! 👶`,
      `rejected! The jury has ruled: incomplete! 🧑‍⚖️`
    ];
    const msgText = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
    const chatMsg = {
      type: 'system',
      text: `❌ Host rejected ${player ? player.name : 'player'}'s dare! ${msgText}`,
      timestamp: Date.now()
    };
    room.messages.push(chatMsg);
    console.log(`❌ Host rejected dare in room ${room.code}`);
    io.to(room.code).emit('receive_chat_message', chatMsg);
    io.to(room.code).emit('dare_photo_rejected', {
      playerName: player?.name
    });
    advanceSpin(room);
  });
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
  socket.on('terminate_room', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const code = room.code;
    console.log(`🗑️  Room ${code} terminated by host — wiping all data`);
    io.to(code).emit('room_closed');
    room.players.length = 0;
    room.messages.length = 0;
    room.state = null;
    room.settings = null;
    rooms.delete(code);
  });
  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      console.log(`💨 ${player.name} disconnected from room ${room.code} (persistence active)`);
    }
    if (room.state.selectedPlayer === socket.id &&
      ['choosing', 'truth', 'dare'].includes(room.state.phase)) {
      const disconnectedName = player ? player.name : 'A player';
      console.log(`⚠️ Active player ${disconnectedName} disconnected during turn. Skipping turn.`);
      io.to(room.code).emit('turn_skipped_disconnect', {
        playerName: disconnectedName
      });
      advanceSpin(room);
    }
    io.to(room.code).emit('update_players', getPublicPlayers(room));
    io.to(room.code).emit('player_left', { playerId: socket.id });
  });
});
function advanceSpin(room) {
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
server.listen(PORT, () => {
  console.log(`\n🎉 Spin & Spill running on http://localhost:${PORT}\n`);
});
