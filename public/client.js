const socket = io();

// State
let myUsername = '';
let currentRoomId = '';
let myUserId = getOrCreateUserId();
let gameState = null;
let isHost = false;
let renderingPositions = {}; // playerId -> current visible position
let isAnimating = false;

function getOrCreateUserId() {
    let id = localStorage.getItem('mk_user_id');
    if (!id) {
        id = 'user_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem('mk_user_id', id);
    }
    return id;
}

// Characters Config
const CHARACTERS = [
    { name: 'Mario', color: '#e60012', img: 'mario.png' },
    { name: 'Luigi', color: '#4bb543', img: 'luigi.png' },
    { name: 'Peach', color: '#fdb9c8', img: 'peach.png' },
    { name: 'Bowser', color: '#f9c80e', img: 'bowser.png' },
    { name: 'Yoshi', color: '#87d37c', img: 'yoshi.png' },
    { name: 'Toad', color: '#ffffff', img: 'toad.png' },
    { name: 'Birdo', color: '#ffcc00', img: 'birdo.png' },
    { name: 'Donkey Kong', color: '#634b9f', img: 'donkeykong.png' },
    { name: 'Daisy', color: '#f39c12', img: 'daisy.png' },
    { name: 'King Boo', color: '#7fdbff', img: 'kingboo.png' }
];

const ITEM_IMAGES = {
    'Bullet': 'bullet.png',
    'Blue Shell': 'blueshell.png',
    'Red Shell': 'redshell.png',
    'Golden Mushroom': 'golden.png',
    'Star': 'star.png',
    'Banana': 'banana.png'
};

// DOM Elements
const screens = {
    login: document.getElementById('login-screen'),
    lobby: document.getElementById('lobby-screen'),
    charSelection: document.getElementById('char-selection-screen'),
    game: document.getElementById('game-screen'),
    waiting: document.getElementById('waiting-room')
};

const usernameInput = document.getElementById('username');
const joinBtn = document.getElementById('join-btn');
const roomListEl = document.getElementById('room-list');
const createRoomBtn = document.getElementById('create-room-btn');
const charGrid = document.getElementById('char-grid');
const boardContainer = document.getElementById('board-container');
const bottomStatsPanel = document.getElementById('bottom-stats-panel');
const gameStatusText = document.getElementById('game-status-text');
const diceDisplay = document.getElementById('dice-display');
const rollDiceBtn = document.getElementById('roll-dice-btn');
const useItemBtn = document.getElementById('use-item-btn');
const skipItemBtn = document.getElementById('skip-item-btn');
const toastContainer = document.getElementById('toast-container');

// Sound Effects (Visual only for now)
function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast-msg';
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 500);
    }, 3000);
}

// Helpers
function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.remove('active'));
    screens[name].classList.add('active');
}

// Initialize Board Spaces
function createBoard() {
    boardContainer.querySelectorAll('.space').forEach(s => s.remove());

    // Circular layout: 50 spaces
    const totalSpaces = 50;
    const centerX = 50;
    const centerY = 50;
    const radius = 42; // percentage

    for (let i = 0; i < totalSpaces; i++) {
        const space = document.createElement('div');
        space.className = 'space';
        space.id = `space-${i}`;

        // Calculate position
        const angle = (i / totalSpaces) * 2 * Math.PI - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        space.style.left = `${x}%`;
        space.style.top = `${y}%`;
        space.style.position = 'absolute';
        space.style.transform = 'translate(-50%, -50%)';

        if (i === 0) {
            space.classList.add('start-space');
            space.textContent = 'START';
        } else if ([10, 25, 40].includes(i)) {
            space.classList.add('item-box');
            space.textContent = '?';
        } else {
            space.textContent = i;
        }

        boardContainer.appendChild(space);
    }
}

createBoard();

// Events
joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name || name.length < 3) return alert('Nombre muy corto');
    myUsername = name;
    socket.emit('join_lobby', { username: name, userId: myUserId });
});

createRoomBtn.addEventListener('click', () => {
    socket.emit('create_room');
});

rollDiceBtn.addEventListener('click', () => {
    socket.emit('game_action', { roomId: currentRoomId, action: 'roll_dice' });
});

useItemBtn.addEventListener('click', () => {
    socket.emit('game_action', { roomId: currentRoomId, action: 'use_item' });
});

skipItemBtn.addEventListener('click', () => {
    socket.emit('game_action', { roomId: currentRoomId, action: 'skip_item' });
});

// Socket Listeners
socket.on('lobby_joined', () => {
    showScreen('lobby');
    document.getElementById('user-display').textContent = `Hola, ${myUsername}`;
});

socket.on('room_list', (rooms) => {
    roomListEl.innerHTML = '';
    if (rooms.length === 0) {
        roomListEl.innerHTML = '<li class="empty-message">No hay salas disponibles</li>';
    } else {
        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = 'room-item';
            li.innerHTML = `<span>${room.id} (${room.playerCount}/10)</span> <button class="btn primary btn-sm">Unirse</button>`;
            li.querySelector('button').addEventListener('click', () => {
                socket.emit('join_room', room.id);
            });
            roomListEl.appendChild(li);
        });
    }
});

socket.on('room_joined', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isCreator;
    showScreen('waiting');
});

socket.on('game_update', (state) => {
    gameState = state;
    renderGame();
});

socket.on('game_log', (log) => {
    showToast(log.message);
});

socket.on('room_terminated', () => {
    showScreen('lobby');
    currentRoomId = '';
    showToast("La partida ha terminado");
});

function renderGame() {
    if (gameState.state === 'waiting') {
        showScreen('waiting');
        document.getElementById('waiting-player-count').textContent = `Jugadores: ${gameState.players.length} / 10`;
        const list = document.getElementById('waiting-player-list');
        list.innerHTML = '';
        gameState.players.forEach(p => {
            const d = document.createElement('div');
            d.className = 'player-avatar';
            d.textContent = p.username;
            list.appendChild(d);
        });

        const startBtn = document.getElementById('lobby-start-btn');
        if (isHost) {
            startBtn.classList.remove('hidden');
            document.getElementById('waiting-host-msg').classList.remove('hidden');
            document.getElementById('waiting-guest-msg').classList.add('hidden');
        } else {
            startBtn.classList.add('hidden');
            document.getElementById('waiting-host-msg').classList.add('hidden');
            document.getElementById('waiting-guest-msg').classList.remove('hidden');
        }
        return;
    }

    if (gameState.state === 'selecting_characters') {
        showScreen('charSelection');
        charGrid.innerHTML = '';
        CHARACTERS.forEach(char => {
            const card = document.createElement('div');
            card.className = 'char-card';
            if (gameState.selectedCharacters.includes(char.name)) {
                card.classList.add('disabled');
            }
            const me = gameState.players.find(p => p.id === myUserId);
            if (me && me.character === char.name) {
                card.classList.add('selected');
            }

            card.innerHTML = `
                <div class="char-icon" style="background:${char.color}; width:80px; height:80px; border-radius:50%; overflow:hidden; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3)">
                    <img src="/images/${char.img}" style="width:100%; height:100%; object-fit: cover;">
                </div>
                <div class="char-name" style="margin-top:10px; font-family:'Bangers'; font-size:1.2rem">${char.name}</div>
            `;

            card.addEventListener('click', () => {
                if (!card.classList.contains('disabled')) {
                    socket.emit('game_action', { roomId: currentRoomId, action: 'select_character', data: { character: char.name } });
                }
            });
            charGrid.appendChild(card);
        });
        return;
    }

    if (gameState.state === 'playing' || gameState.state === 'game_end') {
        showScreen('game');

        // Check for animations
        let animationNeeded = false;
        gameState.players.forEach(p => {
            if (p.character) {
                if (renderingPositions[p.id] === undefined) {
                    renderingPositions[p.id] = p.position;
                } else if (renderingPositions[p.id] !== p.position && !isAnimating) {
                    animationNeeded = true;
                }
            }
        });

        if (animationNeeded && !isAnimating) {
            startMovementAnimation();
        }

        // Update / Create Tokens (at renderingPositions)
        gameState.players.forEach(p => {
            if (!p.character) return;

            let token = document.querySelector(`.player-token[data-id="${p.id}"]`);
            if (!token) {
                token = document.createElement('div');
                token.className = 'player-token';
                token.setAttribute('data-id', p.id);
                boardContainer.appendChild(token);
            }

            // Update immunity / visual state
            if (p.isImmune) token.classList.add('immune');
            else token.classList.remove('immune');

            const charData = CHARACTERS.find(c => c.name === p.character);
            token.style.backgroundColor = charData ? charData.color : '#fff';

            if (charData && !token.querySelector('img')) {
                token.innerHTML = `<img src="/images/${charData.img}" style="width:100%; height:100%; object-fit: cover; border-radius: 50%;">`;
            } else if (!charData) {
                token.textContent = p.username[0].toUpperCase();
            }

            const currentVisiblePos = renderingPositions[p.id];

            // Offset tokens if multiple players on same visible space
            const sameSpaceIds = gameState.players
                .filter(op => renderingPositions[op.id] === currentVisiblePos)
                .map(op => op.id);
            const offset = sameSpaceIds.indexOf(p.id);
            const totalOnSpace = sameSpaceIds.length;

            const spaceEl = document.getElementById(`space-${currentVisiblePos}`);
            if (spaceEl) {
                const rect = spaceEl.getBoundingClientRect();
                const parentRect = boardContainer.getBoundingClientRect();

                const left = ((rect.left + rect.width / 2 - parentRect.left) / parentRect.width) * 100;
                const top = ((rect.top + rect.height / 2 - parentRect.top) / parentRect.height) * 100;

                const bias = (offset - (totalOnSpace - 1) / 2) * 2.5;
                token.style.left = `${left + bias}%`;
                token.style.top = `${top + bias}%`;
            }
        });

        // Remove stale tokens
        const currentPlayerIds = gameState.players.map(p => p.id);
        document.querySelectorAll('.player-token').forEach(t => {
            if (!currentPlayerIds.includes(t.getAttribute('data-id'))) {
                t.remove();
            }
        });

        // Dice
        const d1 = gameState.lastDiceResult[0] || '?';
        const d2 = gameState.lastDiceResult[1] || '?';
        diceDisplay.innerHTML = `<div class="die">${d1}</div><div class="die">${d2}</div>`;

        // Controls
        const isMyTurn = gameState.currentPlayerId === myUserId;
        const me = gameState.players.find(p => p.id === myUserId);

        // Hide buttons if animating
        if (isAnimating) {
            rollDiceBtn.classList.add('hidden');
            useItemBtn.classList.add('hidden');
            skipItemBtn.classList.add('hidden');
            gameStatusText.textContent = "Moviendo...";
        } else if (isMyTurn && gameState.state !== 'game_end') {
            if (gameState.turnState === 'roll') {
                rollDiceBtn.classList.remove('hidden');
                useItemBtn.classList.add('hidden');
                skipItemBtn.classList.add('hidden');
                gameStatusText.textContent = "¡TU TURNO! Lanza los dados";
            } else if (gameState.turnState === 'use_item') {
                rollDiceBtn.classList.add('hidden');
                if (me.item) {
                    useItemBtn.classList.remove('hidden');
                    const itemImg = ITEM_IMAGES[me.item] || '';
                    useItemBtn.innerHTML = `
                        <div style="display:flex; align-items:center; gap:8px">
                            <img src="/images/items/${itemImg}" style="width:24px; height:24px; object-fit:contain">
                            <span>USAR ${me.item.toUpperCase()}</span>
                        </div>
                    `;
                    skipItemBtn.classList.remove('hidden');
                    gameStatusText.textContent = `¿Quieres usar tu ${me.item}?`;
                } else {
                    useItemBtn.classList.add('hidden');
                    skipItemBtn.classList.remove('hidden');
                    skipItemBtn.textContent = "TERMINAR TURNO";
                    gameStatusText.textContent = "No tienes ítems, termina tu turno";
                }
            }
        } else {
            rollDiceBtn.classList.add('hidden');
            useItemBtn.classList.add('hidden');
            skipItemBtn.classList.add('hidden');
            const currentP = gameState.players.find(p => p.id === gameState.currentPlayerId);
            gameStatusText.textContent = gameState.state === 'game_end' ? "¡FIN DE LA CARRERA!" : `Turno de ${currentP ? currentP.username : '...'}`;
        }

        if (gameState.state === 'game_end') {
            gameStatusText.textContent = "GANADORES: " + gameState.winners.join(', ');
        }

        // Stats Panel
        bottomStatsPanel.innerHTML = '';
        const sortedPlayers = [...gameState.players].sort((a, b) => a.rank - b.rank);
        sortedPlayers.forEach(p => {
            const card = document.createElement('div');
            card.className = 'player-stat-card';
            if (p.id === gameState.currentPlayerId) card.classList.add('active-turn');

            const charData = CHARACTERS.find(c => c.name === p.character);
            const color = charData ? charData.color : '#555';

            card.innerHTML = `
                <div class="stat-header">
                    <div style="display:flex; align-items:center; gap:8px">
                        <div style="width:24px; height:24px; border-radius:50%; background:${color}; overflow:hidden; border:1px solid white">
                            <img src="/images/${charData ? charData.img : ''}" style="width:100%; height:100%; object-fit:cover">
                        </div>
                        <span style="color:${color}">#${p.rank} ${p.username}</span>
                    </div>
                    <span>Lap ${p.lap}/3</span>
                </div>
                <div class="stat-body">
                    <span>Pos: ${p.position}</span>
                    <div class="item-slot" style="overflow:hidden; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2)">
                        ${p.item ? `<img src="/images/items/${ITEM_IMAGES[p.item]}" style="width:100%; height:100%; object-fit:contain">` : '-'}
                    </div>
                </div>
            `;
            bottomStatsPanel.appendChild(card);
        });
    }
}

async function startMovementAnimation() {
    if (isAnimating) return;
    isAnimating = true;

    // We process animations in cycles
    let finishedAll = false;
    while (!finishedAll) {
        finishedAll = true;

        // Find players that need moving
        for (const p of gameState.players) {
            if (renderingPositions[p.id] !== p.position) {
                finishedAll = false;

                let current = renderingPositions[p.id];
                let target = p.position;

                const distForward = (target - current + 50) % 50;
                const distBackward = (current - target + 50) % 50;

                let nextStep;
                if (distForward <= distBackward) {
                    nextStep = (current + 1) % 50;
                } else {
                    nextStep = (current - 1 + 50) % 50;
                }

                renderingPositions[p.id] = nextStep;

                // Apply animation class to token
                const token = document.querySelector(`.player-token[data-id="${p.id}"]`);
                if (token) {
                    token.classList.remove('moving');
                    void token.offsetWidth; // trigger reflow
                    token.classList.add('moving');
                }
            }
        }

        renderGame();
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Ensure all tokens have 'moving' removed at the end
    document.querySelectorAll('.player-token').forEach(t => t.classList.remove('moving'));

    isAnimating = false;
    renderGame();
}

document.getElementById('lobby-start-btn').addEventListener('click', () => {
    socket.emit('start_game', currentRoomId);
});

document.getElementById('game-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('game-menu-dropdown').classList.toggle('show');
});

document.addEventListener('click', () => {
    document.getElementById('game-menu-dropdown').classList.remove('show');
});

document.getElementById('menu-restart-game').addEventListener('click', () => {
    socket.emit('restart_game', currentRoomId);
});

document.getElementById('menu-end-session').addEventListener('click', () => {
    document.getElementById('end-session-modal').classList.remove('hidden');
});

document.getElementById('cancel-end-btn').addEventListener('click', () => {
    document.getElementById('end-session-modal').classList.add('hidden');
});

document.getElementById('confirm-end-btn').addEventListener('click', () => {
    socket.emit('end_session', currentRoomId);
    document.getElementById('end-session-modal').classList.add('hidden');
});
