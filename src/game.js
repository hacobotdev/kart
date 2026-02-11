class Game {
    constructor(roomId) {
        this.roomId = roomId;
        this.hostUserId = '';
        this.players = [];
        this.currentPlayerIndex = 0;
        this.state = 'waiting'; // waiting, selecting_characters, playing, game_end
        this.characters = [
            'Mario', 'Luigi', 'Peach', 'Bowser', 'Yoshi',
            'Toad', 'Birdo', 'Donkey Kong', 'Daisy', 'King Boo'
        ];
        this.selectedCharacters = new Set();
        this.winners = [];
        this.turnState = 'roll'; // roll, use_item
        this.lastDiceResult = [0, 0];
        this.logs = [];
    }

    addPlayer(userId, username) {
        const existing = this.players.find(p => p.id === userId);
        if (existing) {
            existing.username = username;
            return true;
        }

        if (this.state !== 'waiting') return false;
        if (this.players.length >= 10) return false;

        const Player = require('./player');
        const player = new Player(userId, username);
        this.players.push(player);
        return true;
    }

    removePlayer(userId) {
        const index = this.players.findIndex(p => p.id === userId);
        if (index === -1) return false;

        const player = this.players[index];
        if (player.character) {
            this.selectedCharacters.delete(player.character);
        }

        this.players.splice(index, 1);

        if (this.players.length === 0) {
            this.state = 'waiting';
        } else {
            this.currentPlayerIndex = this.currentPlayerIndex % this.players.length;
        }
        return true;
    }

    startGame() {
        if (this.players.length < 1) return;
        this.state = 'selecting_characters';
        this.selectedCharacters.clear();
        this.players.forEach(p => p.character = null);
        this.currentPlayerIndex = 0;
    }

    handleAction(playerId, action, data) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('Jugador no encontrado');

        if (this.state === 'selecting_characters') {
            if (action === 'select_character') {
                if (player.character) throw new Error('Ya seleccionaste personaje');
                if (!this.characters.includes(data.character)) throw new Error('Personaje no válido');
                if (this.selectedCharacters.has(data.character)) throw new Error('Personaje ya seleccionado');

                player.character = data.character;
                this.selectedCharacters.add(data.character);

                const allSelected = this.players.every(p => p.character !== null);
                if (allSelected) {
                    this.state = 'playing';
                    this.currentPlayerIndex = 0;
                    this.turnState = 'roll';
                    this.updateRankings();
                }
                return { log: { type: 'info', message: `${player.username} ha seleccionado a ${player.character}` } };
            }
        }

        if (this.state === 'playing') {
            if (this.players[this.currentPlayerIndex].id !== playerId) throw new Error('No es tu turno');

            if (action === 'roll_dice') {
                if (this.turnState !== 'roll') throw new Error('Ya tiraste los dados');

                const die1 = Math.floor(Math.random() * 6) + 1;
                const die2 = Math.floor(Math.random() * 6) + 1;
                const total = die1 + die2;
                this.lastDiceResult = [die1, die2];

                player.lastPosition = player.position;
                this.movePlayer(player, total);

                this.turnState = 'use_item';

                // If they don't have an item, they should be able to end turn
                // But wait, the prompt says "has to be used after they stopped advancing"
                // If they don't have an item, they just end turn.
                if (!player.item) {
                    // Auto end turn or let them click something? 
                    // Let's keep it in 'use_item' and they can 'skip_item' or it ends if they have none.
                }

                return { log: { type: 'info', message: `${player.username} sacó ${die1}+${die2}=${total} y avanzó a la posición ${player.position}` } };
            }

            if (action === 'use_item') {
                if (this.turnState !== 'use_item') throw new Error('Acción no permitida');
                if (!player.item) {
                    this.endTurn();
                    return { log: { type: 'info', message: `${player.username} terminó su turno` } };
                }

                const itemLog = this.executeItem(player, player.item);
                player.item = null;
                this.endTurn();
                return { log: itemLog };
            }

            if (action === 'skip_item') {
                if (this.turnState !== 'use_item') throw new Error('Acción no permitida');
                this.endTurn();
                return { log: { type: 'info', message: `${player.username} terminó su turno` } };
            }
        }

        throw new Error('Acción no válida en el estado actual');
    }

    movePlayer(player, spaces) {
        const itemSpaces = [10, 25, 40];
        let currentPos = player.position;

        for (let i = 1; i <= spaces; i++) {
            currentPos = (currentPos + 1) % 50;
            if (currentPos === 0) {
                player.lap++;
                if (player.lap > 3) {
                    player.finished = true;
                    if (!this.winners.includes(player)) {
                        this.winners.push(player);
                    }
                    // If everyone finished, end game
                    if (this.players.every(p => p.finished)) {
                        this.state = 'game_end';
                    }
                }
            }
            if (itemSpaces.includes(currentPos)) {
                this.assignItem(player);
            }
        }
        player.position = currentPos;
        this.updateRankings();
    }

    assignItem(player) {
        // Find player's rank
        this.updateRankings();
        const midpoint = Math.ceil(this.players.length / 2);
        const isTopHalf = player.rank <= midpoint;

        const rand = Math.random();
        if (isTopHalf) {
            // 20% Red Shell, 20% Star, 60% Banana
            if (rand < 0.20) player.item = 'Red Shell';
            else if (rand < 0.40) player.item = 'Star';
            else player.item = 'Banana';
        } else {
            // 20% Bullet, 20% Blue Shell, 40% Red Shell, 20% Golden Mushroom
            if (rand < 0.20) player.item = 'Bullet';
            else if (rand < 0.40) player.item = 'Blue Shell';
            else if (rand < 0.80) player.item = 'Red Shell';
            else player.item = 'Golden Mushroom';
        }
    }

    executeItem(player, item) {
        let message = '';
        switch (item) {
            case 'Bullet':
                this.movePlayer(player, 15);
                message = `${player.username} usó una Bala y avanzó 15 espacios!`;
                break;
            case 'Blue Shell':
                const firstPlace = this.players.find(p => p.rank === 1);
                if (firstPlace && firstPlace.id !== player.id && !firstPlace.isImmune) {
                    this.moveBack(firstPlace, 10);
                    message = `${player.username} usó un Caparazón Azul! ${firstPlace.username} retrocede 10 espacios!`;
                } else if (firstPlace && firstPlace.isImmune) {
                    message = `${player.username} usó un Caparazón Azul, pero ${firstPlace.username} es inmune!`;
                } else {
                    message = `${player.username} disparó un Caparazón Azul al vacío!`;
                }
                break;
            case 'Red Shell':
                this.players.forEach(p => {
                    if (p.id !== player.id && !p.isImmune && !p.finished) {
                        this.moveBack(p, 3);
                    }
                });
                message = `${player.username} usó un Caparazón Rojo! Todos los demás retroceden 3 espacios!`;
                break;
            case 'Golden Mushroom':
                this.movePlayer(player, 5);
                message = `${player.username} usó un Champiñón Dorado y avanzó 5 espacios!`;
                break;
            case 'Star':
                player.isImmune = true;
                message = `${player.username} usó una Estrella y es inmune hasta su próximo turno!`;
                break;
            case 'Banana':
                // Player right behind
                this.updateRankings();
                const playerBehind = this.players.find(p => p.rank === player.rank + 1);
                if (playerBehind && !playerBehind.isImmune && !playerBehind.finished) {
                    this.moveBack(playerBehind, 3);
                    message = `${player.username} dejó una Banana! ${playerBehind.username} tropezó y retrocedió 3 espacios!`;
                } else if (playerBehind && playerBehind.isImmune) {
                    message = `${player.username} dejó una Banana, pero ${playerBehind.username} es inmune!`;
                } else {
                    message = `${player.username} dejó una Banana!`;
                }
                break;
        }
        return { type: 'item', message };
    }

    moveBack(player, spaces) {
        let currentPos = player.position;
        for (let i = 0; i < spaces; i++) {
            const nextPos = (currentPos - 1 + 50) % 50;

            // If at position 0, lap 1, cannot go back further
            if (currentPos === 0 && player.lap <= 1) {
                break;
            }

            // If crossing from 0 to 49, decrement lap
            if (currentPos === 0 && nextPos === 49) {
                player.lap--;
            }

            currentPos = nextPos;
        }
        player.position = currentPos;
        this.updateRankings();
    }

    updateRankings() {
        // Sort players by lap desc, then position desc
        const sorted = [...this.players].sort((a, b) => {
            if (a.finished && !b.finished) return -1;
            if (!a.finished && b.finished) return 1;
            if (a.lap !== b.lap) return b.lap - a.lap;
            return b.position - a.position;
        });
        sorted.forEach((p, index) => {
            p.rank = index + 1;
        });
    }

    endTurn() {
        // Reset immunity if it was set in a previous turn
        // Wait, Star makes you immune UNTIL your next turn.
        // So at start of turn, immunity should be reset.

        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

        // Skip finished players
        let count = 0;
        while (this.players[this.currentPlayerIndex].finished && count < this.players.length) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            count++;
        }

        if (count < this.players.length) {
            this.players[this.currentPlayerIndex].isImmune = false; // Reset immunity at start of turn
            this.turnState = 'roll';
        } else {
            this.state = 'game_end';
        }
    }

    getPublicState() {
        return {
            roomId: this.roomId,
            state: this.state,
            players: this.players.map(p => p.getPublicState()),
            currentPlayerId: this.players.length > 0 ? this.players[this.currentPlayerIndex].id : null,
            turnState: this.turnState,
            lastDiceResult: this.lastDiceResult,
            characters: this.characters,
            selectedCharacters: Array.from(this.selectedCharacters),
            winners: this.winners.map(p => p.username)
        };
    }
}

module.exports = Game;

