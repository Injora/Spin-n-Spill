// ══════════════════════════════════════════════════════════════
//  Spin & Spill — Client
// ══════════════════════════════════════════════════════════════

const socket = io();



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

// ── Dare + Camera ──
function showDareOverlay(isMe, playerName) {
  const overlay = $('#dare-overlay');
  overlay.classList.remove('hidden');
  $('#dare-local-video').classList.add('hidden');
  $('#dare-remote-video').classList.add('hidden');
  $('#dare-video-placeholder').classList.remove('hidden');

  if (isMe) {
    $('#dare-player-label').textContent = "Your dare is active! Camera is being turned on.";
    $('#btn-dare-complete').classList.add('hidden');
    startLocalCamera();
  } else {
    $('#dare-player-label').textContent = `${playerName}'s dare is active!`;
    $('#btn-dare-complete').classList.toggle('hidden', !state.isHost);
  }
  addSystemMessage(`🔥 ${playerName} chose DARE! Camera is on!`);
}

async function startLocalCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    state.localStream = stream;
    const video = $('#dare-local-video');
    video.srcObject = stream;
    video.classList.remove('hidden');
    $('#dare-video-placeholder').classList.add('hidden');

    // Set up WebRTC peer connections to broadcast to others
    const otherPlayers = state.players.filter(p => p.id !== socket.id);
    for (const player of otherPlayers) {
      createPeerConnection(player.id, stream);
    }
  } catch (err) {
    console.warn('Camera access denied:', err);
    $('#dare-video-placeholder').innerHTML = `
      <div class="text-center">
        <div class="text-4xl mb-2">🚫</div>
        <p class="text-red-400 text-sm">Camera access denied</p>
        <p class="text-gray-500 text-xs mt-1">The dare continues without video</p>
      </div>`;
  }
}

// Connection timeout — if no track arrives within this window, show fallback
const WEBRTC_TIMEOUT_MS = 15000;

// Queue to hold ICE candidates if remote description is not yet set
state.iceQueues = {};

// Fetch ICE Servers configuration from server on start
function fetchIceConfig() {
  socket.emit('get_ice_config', (res) => {
    if (res && res.iceServers) {
      state.iceServers = res;
      console.log('🔒 Secure ICE configuration loaded from server');
    }
  });
}

// Reconnect/rejoin helper for page refresh
function checkRejoin() {
  const savedName = sessionStorage.getItem('spin_spill_name');
  const savedCode = sessionStorage.getItem('spin_spill_code');
  if (savedName && savedCode) {
    console.log(`🔄 Attempting auto-rejoin to room ${savedCode} as ${savedName}`);
    socket.emit('join_room', { code: savedCode, name: savedName }, (res) => {
      if (res && !res.error) {
        state.myName = savedName;
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
      } else {
        // Clear expired details
        sessionStorage.removeItem('spin_spill_name');
        sessionStorage.removeItem('spin_spill_code');
      }
    });
  }
}

// Process any queued candidates once remoteDescription is set
async function processIceQueue(senderId, pc) {
  const queue = state.iceQueues[senderId];
  if (queue && queue.length > 0) {
    console.log(`[WebRTC] Processing ${queue.length} queued ICE candidates for peer ${senderId}`);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[WebRTC] Failed to add queued ICE candidate for ${senderId}:`, err);
      }
    }
    state.iceQueues[senderId] = [];
  }
}

function createPeerConnection(targetId, stream) {
  console.log(`[WebRTC → ${targetId}] Creating peer connection`);
  const pc = new RTCPeerConnection(state.iceServers || undefined);
  state.peerConnections[targetId] = pc;
  state.iceQueues[targetId] = [];

  stream.getTracks().forEach(track => {
    console.log(`[WebRTC → ${targetId}] Adding track: ${track.kind}`);
    pc.addTrack(track, stream);
  });

  // ── ICE candidate relay ──
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('webrtc_ice', { targetId, candidate: e.candidate });
    } else {
      console.log(`[WebRTC → ${targetId}] ICE gathering complete`);
    }
  };

  // ── Connection state monitoring ──
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    console.log(`[WebRTC → ${targetId}] ICE state change: ${s.toUpperCase()}`);
    if (s === 'failed' || s === 'disconnected') {
      console.warn(`[WebRTC → ${targetId}] Connection failed or disconnected. NAT/firewall blocker possible.`);
      showWebRTCError();
    } else if (s === 'connected' || s === 'completed') {
      console.log(`[WebRTC → ${targetId}] Connection fully connected/completed!`);
    }
  };

  pc.createOffer().then(async offer => {
    console.log(`[WebRTC → ${targetId}] Creating offer`);
    await pc.setLocalDescription(offer);
    socket.emit('webrtc_offer', { targetId, offer });
  }).catch(err => {
    console.error(`[WebRTC → ${targetId}] Offer creation failed:`, err);
  });
}

socket.on('webrtc_offer', async ({ senderId, offer }) => {
  console.log(`[WebRTC ← ${senderId}] Received WebRTC offer`);
  const pc = new RTCPeerConnection(state.iceServers || undefined);
  state.peerConnections[senderId] = pc;
  state.iceQueues[senderId] = [];

  let trackReceived = false;

  pc.ontrack = (e) => {
    trackReceived = true;
    const video = $('#dare-remote-video');
    video.srcObject = e.streams[0];
    
    // Ensure remote plays unmuted for everyone else
    video.muted = false; 
    
    video.classList.remove('hidden');
    $('#dare-local-video').classList.add('hidden');
    $('#dare-video-placeholder').classList.add('hidden');
    console.log(`[WebRTC ← ${senderId}] Remote video and audio track attached to unmuted DOM player`);
  };

  // ── ICE candidate relay ──
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('webrtc_ice', { targetId: senderId, candidate: e.candidate });
    } else {
      console.log(`[WebRTC ← ${senderId}] ICE gathering complete`);
    }
  };

  // ── Connection state monitoring ──
  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    console.log(`[WebRTC ← ${senderId}] ICE state change: ${s.toUpperCase()}`);
    if (s === 'failed' || s === 'disconnected') {
      console.warn(`[WebRTC ← ${senderId}] Connection ${s}`);
      if (!trackReceived) showWebRTCError();
    }
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    console.log(`[WebRTC ← ${senderId}] Set remote description (offer)`);
    
    // Process queued candidates now that remote description is ready
    await processIceQueue(senderId, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { targetId: senderId, answer });
    console.log(`[WebRTC ← ${senderId}] Created and sent answer`);
  } catch (err) {
    console.error(`[WebRTC ← ${senderId}] Error processing offer/answer:`, err);
    showWebRTCError();
  }

  // ── Timeout fallback — if no track arrives, show error ──
  setTimeout(() => {
    if (!trackReceived && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
      console.warn(`[WebRTC ← ${senderId}] Timed out after ${WEBRTC_TIMEOUT_MS / 1000}s — no video received`);
      showWebRTCError();
    }
  }, WEBRTC_TIMEOUT_MS);
});

socket.on('webrtc_answer', async ({ senderId, answer }) => {
  console.log(`[WebRTC ← ${senderId}] Received WebRTC answer`);
  const pc = state.peerConnections[senderId];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log(`[WebRTC ← ${senderId}] Set remote description (answer)`);
      
      // Process queued candidates now that remote description is ready
      await processIceQueue(senderId, pc);
    } catch (err) {
      console.error(`[WebRTC ← ${senderId}] Failed to set remote description:`, err);
    }
  }
});

socket.on('webrtc_ice', async ({ senderId, candidate }) => {
  const pc = state.peerConnections[senderId];
  if (pc) {
    if (pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`[WebRTC ← ${senderId}] Added ICE candidate immediately`);
      } catch (err) {
        console.warn(`[WebRTC ← ${senderId}] Failed to add ICE candidate:`, err);
      }
    } else {
      console.log(`[WebRTC ← ${senderId}] Queueing ICE candidate (remoteDescription not set)`);
      if (!state.iceQueues[senderId]) state.iceQueues[senderId] = [];
      state.iceQueues[senderId].push(candidate);
    }
  }
});

// ── WebRTC Fallback Error UI ──
function showWebRTCError() {
  const placeholder = $('#dare-video-placeholder');
  if (!placeholder) return;
  // Only show if remote video isn't already playing
  const remoteVid = $('#dare-remote-video');
  if (remoteVid && remoteVid.srcObject && !remoteVid.paused) return;

  placeholder.classList.remove('hidden');
  placeholder.innerHTML = `
    <div class="text-center" style="padding:1rem">
      <div style="font-size:2.5rem;margin-bottom:0.5rem">📡</div>
      <p style="color:#c84a4a;font-size:0.95rem;font-weight:700;margin-bottom:0.3rem">
        Video connection failed
      </p>
      <p style="color:#888;font-size:0.8rem;line-height:1.4">
        Could not establish a peer-to-peer link.<br>
        This usually means a strict firewall or NAT is blocking the connection.<br>
        Try switching to mobile data or a different Wi-Fi network.
      </p>
      <p style="color:#aaa;font-size:0.7rem;margin-top:0.5rem;font-style:italic">
        The dare is still active — the player's camera is on locally.
      </p>
    </div>`;
}

$('#btn-dare-complete').addEventListener('click', () => {
  socket.emit('dare_completed');
});

socket.on('dare_done', ({ playerName }) => {
  hideAllOverlays();
  stopAllMedia();
  addSystemMessage(`✅ ${playerName} completed the dare! (+3pts)`);
});

function stopAllMedia() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }
  Object.values(state.peerConnections).forEach(pc => pc.close());
  state.peerConnections = {};
  $('#dare-local-video').srcObject = null;
  $('#dare-remote-video').srcObject = null;
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
  const container = $('#chat-messages');
  const div = document.createElement('div');

  if (msg.type === 'truth_answer') {
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
});

function addSystemMessage(text) {
  const container = $('#chat-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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

// ── Init ──
checkJoinUrl();
fetchIceConfig();
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
  if (confirm('Close this room? All data will be permanently destroyed.')) {
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
  alert('The host has closed the room. All data has been wiped.');
});
