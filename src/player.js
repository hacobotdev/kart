class Player {
    constructor(id, username) {
        this.id = id;
        this.username = username;
        this.character = null;
        this.position = 0; // 0 to 49
        this.lap = 1;
        this.item = null;
        this.isImmune = false;
        this.rank = 0;
        this.finished = false;
        this.lastPosition = 0; // To track if they passed item boxes
    }

    resetImmunity() {
        this.isImmune = false;
    }

    getPublicState() {
        return {
            id: this.id,
            username: this.username,
            character: this.character,
            position: this.position,
            lap: this.lap,
            item: this.item,
            isImmune: this.isImmune,
            rank: this.rank,
            finished: this.finished
        };
    }
}

module.exports = Player;

