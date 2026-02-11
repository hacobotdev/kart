function generateDeck() {
    const deck = [];
    const distribution = {
        '-2': 5,
        '-1': 10,
        '0': 15,
        '1': 10,
        '2': 10,
        '3': 10,
        '4': 10,
        '5': 10,
        '6': 10,
        '7': 10,
        '8': 10,
        '9': 10,
        '10': 10,
        '11': 10,
        '12': 10,
    };

    for (const [value, count] of Object.entries(distribution)) {
        for (let i = 0; i < count; i++) {
            deck.push(parseInt(value));
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

module.exports = { generateDeck, shuffleDeck };
