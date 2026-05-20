// ══════════════════════════════════════════════════════════════
//  Spin & Spill — Client
// ══════════════════════════════════════════════════════════════

const socket = io();

// ── Handle Connection Disconnect & Reset Photo UI if frozen ──
socket.on('disconnect', (reason) => {
  console.warn('⚠️ Disconnected from server:', reason);
  addSystemMessage('⚠️ Disconnected from server. Reconnecting...');
  
  // If the upload was currently loading/submitting, reset UI so it doesn't freeze
  const waitingLabel = $('#dare-waiting-label');
  if (waitingLabel && waitingLabel.textContent.includes('Submitting')) {
    $('#dare-waiting-zone').classList.add('hidden');
    $('#dare-upload-zone').classList.remove('hidden');
    const errEl = $('#dare-upload-error');
    if (errEl) {
      errEl.textContent = '❌ Upload failed due to disconnection! Please try again.';
      errEl.classList.remove('hidden');
    }
  }
});



// ── State ──
let state = {
  myId: null,
  myName: '',
  roomCode: '',
  isHost: false,
  players: [],
  selectedBottle: 0,
  mode: 30,
  gameStarted: false,
  phase: 'idle',
  currentSpin: 0,
  maxSpins: 30,
  spinnerIndex: 0,
  selectedPlayerId: null,
  peerConnections: {},
  localStream: null,
  iceServers: null,
};

// ── DOM Refs ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const screens = {
  home: $('#screen-home'),
  lobby: $('#screen-lobby'),
  game: $('#screen-game'),
  gameover: $('#screen-gameover'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Check URL for join code ──
function checkJoinUrl() {
  const match = window.location.pathname.match(/\/join\/([A-Za-z0-9]{6})/);
  if (match) {
    $('#input-code').value = match[1].toUpperCase();
    window.history.replaceState({}, '', '/');
  }
}

// ══════════════════════════════════════════════════════════════
//  HOME SCREEN
// ══════════════════════════════════════════════════════════════

$('#btn-create').addEventListener('click', () => {
  const name = $('#input-name').value.trim();
  if (!name) return showError('home', 'Please enter your name');
  socket.emit('create_room', { name }, (res) => {
    if (res.error) return showError('home', res.error);
    state.myName = name;
    state.myId = socket.id;
    state.roomCode = res.code;
    state.isHost = true;
    state.players = res.players;
    state.selectedBottle = res.settings.bottle;
    state.mode = res.settings.mode;

    // Save to sessionStorage for refresh persistence
    sessionStorage.setItem('spin_spill_name', state.myName);
    sessionStorage.setItem('spin_spill_code', state.roomCode);

    enterLobby();
  });
});

$('#btn-join').addEventListener('click', () => {
  const name = $('#input-name').value.trim();
  const code = $('#input-code').value.trim().toUpperCase();
  if (!name) return showError('home', 'Please enter your name');
  if (!code || code.length !== 6) return showError('home', 'Enter a valid 6-character room code');
  socket.emit('join_room', { code, name }, (res) => {
    if (res.error) return showError('home', res.error);
    state.myName = name;
    state.myId = socket.id;
    state.roomCode = res.code;
    state.isHost = res.isHost;
    state.players = res.players;
    state.selectedBottle = res.settings.bottle;
    state.mode = res.settings.mode;

    // Save to sessionStorage for refresh persistence
    sessionStorage.setItem('spin_spill_name', state.myName);
    sessionStorage.setItem('spin_spill_code', state.roomCode);

    if (res.gameStarted) {
      state.gameStarted = true;
      state.maxSpins = res.settings.mode;
      showScreen('game');
      initGame();
    } else {
      enterLobby();
    }

    if (res.messages) {
      res.messages.forEach(msg => {
        appendChatMessage(msg);
      });
    }
  });
});

$('#input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-create').click();
});
$('#input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-join').click();
});

function showError(screen, msg) {
  const el = $(`#${screen}-error`);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ══════════════════════════════════════════════════════════════
//  LOBBY
// ══════════════════════════════════════════════════════════════

function enterLobby() {
  showScreen('lobby');
  $('#lobby-code').textContent = state.roomCode;
  const link = `${window.location.origin}/join/${state.roomCode}`;
  $('#lobby-link').textContent = link;
  $('#lobby-link').onclick = () => { navigator.clipboard.writeText(link); $('#lobby-link').textContent = 'Copied!'; setTimeout(() => $('#lobby-link').textContent = link, 2000); };
  $('#btn-copy-code').onclick = () => { navigator.clipboard.writeText(state.roomCode); };

  const lobbyChat = $('#lobby-chat-messages');
  if (lobbyChat) lobbyChat.innerHTML = '';

  if (state.isHost) {
    $('#host-controls').classList.remove('hidden');
    $('#guest-waiting').classList.add('hidden');
    setupModeButtons();
  } else {
    $('#host-controls').classList.add('hidden');
    $('#guest-waiting').classList.remove('hidden');
  }
  renderLobbyPlayers();
}

function renderLobbyPlayers() {
  const container = $('#lobby-players');
  container.innerHTML = state.players.map(p => `
    <div class="flex items-center gap-3 p-2 rounded-lg ${p.id === socket.id ? 'bg-yellow-50' : ''}">
      <div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border-2 border-gray-800" style="background:${p.color}">
        ${p.name.charAt(0).toUpperCase()}
      </div>
      <span class="flex-1 font-semibold text-sm">${escHtml(p.name)}</span>
      ${p.isHost ? '<span class="text-xs bg-purple-200 text-purple-700 px-2 py-0.5 rounded-full font-bold border border-purple-400">HOST</span>' : ''}
      ${p.id === socket.id ? '<span class="text-xs text-gray-400">You</span>' : ''}
    </div>
  `).join('');
}

function setupModeButtons() {
  $$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = parseInt(btn.dataset.mode);
      socket.emit('change_mode', { mode: state.mode });
    });
  });
}

$('#btn-start').addEventListener('click', () => {
  socket.emit('start_game', null, (res) => {
    if (res?.error) showError('lobby', res.error);
  });
});

// ── Lobby Socket Events ──
socket.on('update_players', (players) => {
  state.players = players;
  if (!state.gameStarted) renderLobbyPlayers();
  if (state.gameStarted) renderPlayerCircle();
});

socket.on('bottle_selected', ({ bottleIndex }) => {
  state.selectedBottle = bottleIndex;
});

socket.on('mode_changed', ({ mode }) => {
  state.mode = mode;
  state.maxSpins = mode;
  if ($('#guest-mode')) $('#guest-mode').textContent = mode;
});

socket.on('host_changed', ({ newHostId, newHostName }) => {
  state.isHost = (newHostId === socket.id);
  addSystemMessage(`${newHostName} is now the host`);
});

// ══════════════════════════════════════════════════════════════
//  GAME
// ══════════════════════════════════════════════════════════════

socket.on('game_started', ({ settings, players, spinnerIndex }) => {
  state.gameStarted = true;
  state.players = players;
  state.selectedBottle = settings.bottle;
  state.mode = settings.mode;
  state.maxSpins = settings.mode;
  state.currentSpin = 0;
  state.spinnerIndex = spinnerIndex;
  state.phase = 'idle';

  // Clear game chat messages for the new game!
  const gameChat = $('#chat-messages');
  if (gameChat) gameChat.innerHTML = '';

  showScreen('game');
  initGame();
});

function initGame() {
  $('#game-code').textContent = state.roomCode;
  $('#spin-max').textContent = state.maxSpins;
  $('#spin-current').textContent = state.currentSpin;
  updateBottleSVG();
  renderPlayerCircle();
  updateSpinButton();
  updateTurnIndicator();
  addSystemMessage('Game started! Let the spills begin!');

  // Show Close Room button for host only
  const closeBtn = $('#btn-close-room');
  if (closeBtn) closeBtn.classList.toggle('hidden', !state.isHost);
}

function updateBottleSVG() {
  // Sketchy hand-drawn cola bottle
  $('#spinning-bottle').innerHTML = `
    <svg viewBox="0 0 60 160" class="w-full h-full">
      <!-- Cap -->
      <path d="M24 4 Q23 2 26 2 L34 2 Q37 2 36 4 L36 16 Q35 17 25 17 L24 16 Z" fill="#c0392b" stroke="#2d2d2d" stroke-width="2" stroke-linejoin="round"/>
      <!-- Neck -->
      <path d="M26 17 Q25 18 25 22 L25 52 Q26 54 27 55 L33 55 Q34 54 35 52 L35 22 Q35 18 34 17 Z" fill="#e74c3c" stroke="#2d2d2d" stroke-width="2" stroke-linejoin="round"/>
      <!-- Body -->
      <path d="M27 55 Q14 62 13 78 L12 138 Q12 156 30 156 Q48 156 48 138 L47 78 Q46 62 33 55 Z" fill="#c0392b" stroke="#2d2d2d" stroke-width="2.5" stroke-linejoin="round"/>
      <!-- Label -->
      <rect x="17" y="88" width="26" height="30" rx="4" fill="#f5f0e1" stroke="#2d2d2d" stroke-width="1.5"/>
      <text x="30" y="100" text-anchor="middle" font-size="7" font-family="Patrick Hand, cursive" fill="#2d2d2d" font-weight="bold">COLA</text>
      <text x="30" y="113" text-anchor="middle" font-size="12" fill="#2d2d2d">🥤</text>
      <!-- Highlight squiggle -->
      <path d="M21 70 Q19 80 20 95 Q21 100 20 110 Q19 120 21 130" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
}

function renderPlayerCircle() {
  const circle = $('#player-circle');
  // Remove old nodes
  circle.querySelectorAll('.player-node').forEach(n => n.remove());
  const N = state.players.length;
  const containerSize = circle.offsetWidth || 400;
  const radius = containerSize * 0.42;
  const centerX = containerSize / 2;
  const centerY = containerSize / 2;

  state.players.forEach((p, i) => {
    const angle = ((360 / N) * i - 90) * (Math.PI / 180);
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    const node = document.createElement('div');
    node.className = `player-node ${p.id === state.selectedPlayerId ? 'selected' : ''}`;
    node.id = `player-${p.id}`;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.innerHTML = `
      <div class="player-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <div class="player-name">${escHtml(p.name)}</div>
      <div class="text-[0.55rem] text-gray-500">${p.score}pt</div>`;
    circle.appendChild(node);
  });
}

function updateSpinButton() {
  const btn = $('#btn-spin');
  const isMyTurn = state.players[state.spinnerIndex]?.id === socket.id;
  const canSpin = (isMyTurn || state.isHost) && state.phase === 'idle';
  btn.classList.toggle('hidden', !canSpin);
}

function updateTurnIndicator() {
  const spinner = state.players[state.spinnerIndex];
  if (spinner) {
    $('#turn-name').textContent = spinner.id === socket.id ? 'Your Turn!' : spinner.name;
  }
}

// ── Spin ──
$('#btn-spin').addEventListener('click', () => {
  if (state.phase !== 'idle') return;
  socket.emit('spin_bottle');
});

socket.on('bottle_result', ({ selectedPlayerId, selectedPlayerName, targetAngle, finalAngle, spinNumber, maxSpins }) => {
  state.phase = 'spinning';
  state.currentSpin = spinNumber;
  state.selectedPlayerId = selectedPlayerId;
  $('#spin-current').textContent = spinNumber;
  $('#btn-spin').classList.add('hidden');

  // Animate bottle
  const bottle = $('#spinning-bottle');
  bottle.style.transform = 'rotate(0deg)';
  bottle.classList.remove('bottle-spinning');
  void bottle.offsetWidth; // force reflow
  bottle.classList.add('bottle-spinning');
  bottle.style.transform = `rotate(${targetAngle}deg)`;

  // Highlight selected player after spin
  setTimeout(() => {
    renderPlayerCircle();
    addSystemMessage(`Bottle landed on ${selectedPlayerName}!`);
  }, 4000);
});

// ── Phase Changes ──
socket.on('phase_change', ({ phase, selectedPlayerId, selectedPlayerName }) => {
  state.phase = phase;
  state.selectedPlayerId = selectedPlayerId || state.selectedPlayerId;
  hideAllOverlays();

  if (phase === 'choosing') {
    if (selectedPlayerId === socket.id) {
      showChoiceOverlay(selectedPlayerName, true);
    } else {
      showChoiceOverlay(selectedPlayerName, false);
    }
  } else if (phase === 'truth') {
    showTruthOverlay(selectedPlayerId === socket.id, selectedPlayerName);
  } else if (phase === 'dare') {
    showDareOverlay(selectedPlayerId === socket.id, selectedPlayerName);
  } else if (phase === 'idle') {
    updateSpinButton();
    updateTurnIndicator();
  }
});

function hideAllOverlays() {
  $('#choice-overlay').classList.add('hidden');
  $('#truth-overlay').classList.add('hidden');
  $('#dare-overlay').classList.add('hidden');
}

function showChoiceOverlay(playerName, isMe) {
  const overlay = $('#choice-overlay');
  overlay.classList.remove('hidden');
  $('#choice-player-name').textContent = playerName;
  if (isMe) {
    $('#choice-label').textContent = "You've been chosen!";
    $('#btn-truth').classList.remove('hidden');
    $('#btn-dare').classList.remove('hidden');
    $('#btn-truth').disabled = false;
    $('#btn-dare').disabled = false;
  } else {
    $('#choice-label').textContent = `${playerName} is choosing...`;
    $('#btn-truth').classList.add('hidden');
    $('#btn-dare').classList.add('hidden');
  }
}

$('#btn-truth').addEventListener('click', () => {
  socket.emit('choose_truth_or_dare', { choice: 'truth' });
  hideAllOverlays();
});

$('#btn-dare').addEventListener('click', () => {
  socket.emit('choose_truth_or_dare', { choice: 'dare' });
  hideAllOverlays();
});

// ── Truth ──
function showTruthOverlay(isMe, playerName) {
  const overlay = $('#truth-overlay');
  overlay.classList.remove('hidden');
  if (isMe) {
    $('#truth-prompt').textContent = "Spill it! Type your truth below.";
    $('#truth-input').classList.remove('hidden');
    $('#btn-submit-truth').classList.remove('hidden');
    $('#truth-waiting').classList.add('hidden');
    $('#truth-input').value = '';
    $('#truth-input').focus();
  } else {
    $('#truth-prompt').textContent = `Waiting for ${playerName} to spill...`;
    $('#truth-input').classList.add('hidden');
    $('#btn-submit-truth').classList.add('hidden');
    $('#truth-waiting').classList.remove('hidden');
  }
}

$('#btn-submit-truth').addEventListener('click', () => {
  const answer = $('#truth-input').value.trim();
  if (!answer) return;
  socket.emit('submit_truth', { answer });
  hideAllOverlays();
});

$('#truth-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#btn-submit-truth').click();
  }
});

socket.on('truth_submitted', ({ playerName }) => {
  hideAllOverlays();
  addSystemMessage(`${playerName} spilled the truth! 💬`);
});

// ── Dare + Photo Upload ──
function showDareOverlay(isMe, playerName) {
  const overlay = $('#dare-overlay');
  overlay.classList.remove('hidden');
  
  // Hide Polaroid display and Host controls initially
  $('#dare-polaroid').classList.add('hidden');
  $('#dare-host-controls').classList.add('hidden');
  $('#dare-image-preview').src = '';
  $('#dare-image-caption').textContent = '';

  // Reset file upload inputs
  $('#dare-file-input').value = '';
  $('#dare-file-name').textContent = 'No photo selected';
  $('#btn-submit-photo').classList.add('hidden');
  $('#dare-upload-error').classList.add('hidden');

  if (isMe) {
    $('#dare-player-label').textContent = "You've been chosen for a DARE! Upload your photo proof below.";
    $('#dare-upload-zone').classList.remove('hidden');
    $('#dare-waiting-zone').classList.add('hidden');
  } else {
    $('#dare-player-label').textContent = `${playerName}'s dare is active!`;
    $('#dare-upload-zone').classList.add('hidden');
    $('#dare-waiting-zone').classList.remove('hidden');
    $('#dare-waiting-label').textContent = `Waiting for ${playerName} to upload their photo...`;
  }
  addSystemMessage(`🔥 ${playerName} chose DARE! Photo upload is pending...`);
}

// ── File Selection & FileReader ──
$('#dare-file-input')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  const errEl = $('#dare-upload-error');
  const nameEl = $('#dare-file-name');
  const btnSubmit = $('#btn-submit-photo');
  
  errEl.classList.add('hidden');
  
  if (!file) {
    nameEl.textContent = 'No photo selected';
    btnSubmit.classList.add('hidden');
    return;
  }

  nameEl.textContent = file.name;

  // Strict 3MB size limit check
  const MAX_SIZE = 3 * 1024 * 1024; // 3MB
  if (file.size > MAX_SIZE) {
    errEl.textContent = '⚠️ Photo must be under 3MB to submit!';
    errEl.classList.remove('hidden');
    btnSubmit.classList.add('hidden');
    return;
  }

  btnSubmit.classList.remove('hidden');
});

// ── Submit Photo Click ──
$('#btn-submit-photo')?.addEventListener('click', () => {
  const fileInput = $('#dare-file-input');
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas for compression and resizing
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Limit dimensions to 800px while keeping aspect ratio
      const MAX_DIM = 800;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Compress to 60% quality JPEG Base64
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      
      console.log('📸 Uploading compressed base64 dare photo...');
      socket.emit('submit_dare_photo', { photo: compressedDataUrl });
      
      // Hide upload zone once submitted
      $('#dare-upload-zone').classList.add('hidden');
      $('#dare-waiting-zone').classList.remove('hidden');
      $('#dare-waiting-label').textContent = `Submitting your photo proof...`;
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// ── Host Approval Click Handlers ──
$('#btn-dare-approve')?.addEventListener('click', () => {
  if (state.isHost) {
    socket.emit('approve_dare');
  }
});

$('#btn-dare-reject')?.addEventListener('click', () => {
  if (state.isHost) {
    socket.emit('reject_dare');
  }
});

// ── Dare Photo Socket Listeners ──
socket.on('dare_photo_received', ({ photo, playerName }) => {
  console.log(`📸 Displaying dare photo for ${playerName}`);
  
  // Hide loading/waiting spinners
  $('#dare-waiting-zone').classList.add('hidden');
  $('#dare-upload-zone').classList.add('hidden');

  // Display photo inside polaroid frame
  const polaroid = $('#dare-polaroid');
  const preview = $('#dare-image-preview');
  const caption = $('#dare-image-caption');
  
  if (preview && polaroid && caption) {
    preview.src = photo;
    caption.textContent = `${playerName}'s Dare!`;
    polaroid.classList.remove('hidden');
  }

  // If we are host, show approval buttons!
  if (state.isHost) {
    $('#dare-host-controls').classList.remove('hidden');
  }
});

socket.on('dare_photo_approved', ({ playerName }) => {
  hideAllOverlays();
  addSystemMessage(`✅ Host approved ${playerName}'s dare! (+3pts)`);
});

socket.on('dare_photo_rejected', ({ playerName }) => {
  hideAllOverlays();
  addSystemMessage(`❌ Host rejected ${playerName}'s dare!`);
});

// ── Turn Skipped due to Disconnect ──
socket.on('turn_skipped_disconnect', ({ playerName }) => {
  hideAllOverlays();
  addSystemMessage(`⚠️ Turn skipped: ${playerName} disconnected during their turn!`);
});

function stopAllMedia() {
  // WebRTC removed
}

// ── Next Turn ──
socket.on('next_turn', ({ spinnerIndex, spinnerId, spinnerName, spinNumber, maxSpins }) => {
  state.spinnerIndex = spinnerIndex;
  state.phase = 'idle';
  state.selectedPlayerId = null;
  state.currentSpin = spinNumber;
  state.maxSpins = maxSpins;
  $('#spin-current').textContent = spinNumber;
  updateSpinButton();
  updateTurnIndicator();
  renderPlayerCircle();
  addSystemMessage(`${spinnerName}'s turn to spin!`);
});

// ── Game Over ──
socket.on('game_over', ({ leaderboard }) => {
  state.gameStarted = false;
  stopAllMedia();
  showScreen('gameover');
  renderLeaderboard(leaderboard);
});

function renderLeaderboard(lb) {
  const ranks = ['🥇', '🥈', '🥉'];
  $('#leaderboard').innerHTML = lb.map((p, i) => `
    <div class="lb-row" style="animation: msg-in 0.3s ease ${i * 0.1}s both">
      <div class="lb-rank">${ranks[i] || (i + 1)}</div>
      <div class="lb-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <div class="lb-info">
        <div class="lb-name">${escHtml(p.name)}</div>
        <div class="lb-stats">💬 ${p.truthCount} truths · 🔥 ${p.dareCount} dares</div>
      </div>
      <div class="lb-score">${p.score}</div>
    </div>
  `).join('');
}

$('#btn-play-again').addEventListener('click', () => {
  window.location.reload();
});

// ══════════════════════════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════════════════════════

$('#btn-send-chat').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('send_chat_message', { text });
  input.value = '';
}

socket.on('receive_chat_message', (msg) => {
  appendChatMessage(msg);
});

function appendChatMessage(msg) {
  const container = state.gameStarted ? $('#chat-messages') : $('#lobby-chat-messages');
  if (!container) return;
  const div = document.createElement('div');

  if (msg.type === 'system') {
    div.className = 'chat-msg system';
    div.textContent = msg.text;
  } else if (msg.type === 'truth_answer') {
    div.className = 'chat-msg truth-answer';
    div.innerHTML = `
      <span class="msg-badge" style="background:rgba(6,182,212,0.3);color:#67e8f9">TRUTH</span>
      <span class="msg-name" style="color:${msg.playerColor}">${escHtml(msg.playerName)}:</span>
      <span>${escHtml(msg.text)}</span>`;
  } else {
    div.className = 'chat-msg';
    div.innerHTML = `
      <span class="msg-name" style="color:${msg.playerColor}">${escHtml(msg.playerName)}:</span>
      <span class="text-gray-600">${escHtml(msg.text)}</span>`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function addSystemMessage(text) {
  appendChatMessage({ type: 'system', text });
}

// ── Lobby Chat Handlers ──
$('#btn-lobby-send')?.addEventListener('click', sendLobbyChat);
$('#lobby-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendLobbyChat();
});

function sendLobbyChat() {
  const input = $('#lobby-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  socket.emit('send_chat_message', { text });
  input.value = '';
}

// ── Chat Toggle (mobile) ──
$('#btn-toggle-chat')?.addEventListener('click', () => {
  const panel = $('#chat-panel');
  panel.classList.toggle('chat-collapsed');
  const body = $('#chat-body');
  body.style.display = panel.classList.contains('chat-collapsed') ? 'none' : 'flex';
});

// ── Player Left ──
socket.on('player_left', ({ playerId }) => {
  const player = state.players.find(p => p.id === playerId);
  if (player) addSystemMessage(`${player.name} left the room`);
});

// ── Utility ──
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Rejoin Handler ──
function checkRejoin() {
  const name = sessionStorage.getItem('spin_spill_name');
  const code = sessionStorage.getItem('spin_spill_code');
  if (name && code) {
    console.log(`🔄 Attempting automatic rejoin for ${name} in room ${code}`);
    socket.emit('join_room', { code, name }, (res) => {
      if (res.error) {
        console.warn('⚠️ Auto-rejoin failed:', res.error);
        sessionStorage.removeItem('spin_spill_name');
        sessionStorage.removeItem('spin_spill_code');
        return;
      }
      state.myName = name;
      state.myId = socket.id;
      state.roomCode = res.code;
      state.isHost = res.isHost;
      state.players = res.players;
      state.selectedBottle = res.settings.bottle;
      state.mode = res.settings.mode;

      if (res.gameStarted) {
        state.gameStarted = true;
        state.maxSpins = res.settings.mode;
        showScreen('game');
        initGame();
      } else {
        enterLobby();
      }

      if (res.messages) {
        res.messages.forEach(msg => {
          appendChatMessage(msg);
        });
      }
    });
  }
}

// ── Init ──
checkJoinUrl();
checkRejoin();

// ══════════════════════════════════════════════════════════════
//  PRIVACY & ANTI-SCREENSHOT
// ══════════════════════════════════════════════════════════════

const privacyOverlay = $('#privacy-overlay');

// Visibility change — hide game when tab/window is not focused
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    privacyOverlay?.classList.add('active');
  } else {
    privacyOverlay?.classList.remove('active');
  }
});

window.addEventListener('blur', () => {
  privacyOverlay?.classList.add('active');
});
window.addEventListener('focus', () => {
  privacyOverlay?.classList.remove('active');
});

// TEMPORARY DEV MODE: Blockers commented out for easier DevTools inspection.
// Remember to uncomment this entire section for strict production anti-cheat security!
/*
// Intercept screenshot keys
document.addEventListener('keydown', (e) => {
  // PrintScreen
  if (e.key === 'PrintScreen') {
    e.preventDefault();
    privacyOverlay?.classList.add('active');
    setTimeout(() => privacyOverlay?.classList.remove('active'), 1500);
    return;
  }
  // Ctrl+P (print)
  if (e.ctrlKey && e.key === 'p') {
    e.preventDefault();
    return;
  }
  // macOS: Cmd+Shift+3 or Cmd+Shift+4 (screenshot)
  if (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5')) {
    e.preventDefault();
    privacyOverlay?.classList.add('active');
    setTimeout(() => privacyOverlay?.classList.remove('active'), 1500);
    return;
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'PrintScreen') {
    e.preventDefault();
  }
});
*/

// ══════════════════════════════════════════════════════════════
//  CLOSE ROOM / ROOM TERMINATION
// ══════════════════════════════════════════════════════════════

$('#btn-close-room')?.addEventListener('click', () => {
  if (!state.isHost) return;
  if (confirm('Close this room? All session data will be permanently wiped.')) {
    alert("Don't worry, we don't save any of your data! Everything has been securely deleted.");
    socket.emit('terminate_room');
  }
});

socket.on('room_closed', () => {
  // Clear persistent session details
  sessionStorage.removeItem('spin_spill_name');
  sessionStorage.removeItem('spin_spill_code');
  
  // Stop all camera/WebRTC
  stopAllMedia();
  // Reset state
  state.gameStarted = false;
  state.phase = 'idle';
  state.players = [];
  state.roomCode = '';
  // Return to home
  showScreen('home');
  
  if (!state.isHost) {
    alert('The host has closed the room. All data has been wiped.');
  }
});
