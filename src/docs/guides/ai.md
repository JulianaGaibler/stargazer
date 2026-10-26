---
title: Adversarial search
group: Features
order: 22
---

# Adversarial game search

{@link searchBestMove} picks a move for a computer opponent in a two-player, zero-sum game with perfect information, such as tic-tac-toe, Connect Four or checkers. Zero-sum means one player's gain is the other's loss. Perfect information means both players see the whole state. After this guide you can describe your own game, ask for the best move at a chosen depth, and tune the opponent's difficulty.

The search is negamax with alpha-beta pruning over a state object you own, so it runs the same way in a game loop and in a test. You describe your game with an {@link AdversarialGame} object and call `searchBestMove` with a search depth.

## Basic usage

This example describes tic-tac-toe and asks for the best move for the player to move.

```ts
import { searchBestMove, type AdversarialGame } from 'stargazer'

interface Board {
  cells: Int8Array // 0 empty, 1 or 2 for a player
  turn: 1 | 2
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function hasLine(c: Int8Array): boolean {
  return LINES.some(([a, b, d]) => c[a] !== 0 && c[a] === c[b] && c[b] === c[d])
}

const ticTacToe: AdversarialGame<Board, number> = {
  moves: (s) => [4, 0, 2, 6, 8, 1, 3, 5, 7].filter((i) => s.cells[i] === 0),
  makeMove: (s, i) => {
    s.cells[i] = s.turn
    s.turn = s.turn === 1 ? 2 : 1
  },
  unmakeMove: (s, i) => {
    s.turn = s.turn === 1 ? 2 : 1
    s.cells[i] = 0
  },
  isTerminal: (s) => hasLine(s.cells) || s.cells.every((v) => v !== 0),
  // A line on the board means the player to move just lost.
  evaluate: (s) => (hasLine(s.cells) ? -1 : 0),
}

const board: Board = { cells: new Int8Array(9), turn: 1 }
const { move, score, nodes } = searchBestMove(ticTacToe, board, { depth: 9 })
```

`move` is the chosen cell, or `null` when the game is over or has no legal moves. `score` is the value of that move for the player to move. `nodes` is the number of positions the search visited. `board` is the same after the call as before it.

Each of the five functions is documented on {@link AdversarialGame}.

### Choosing a depth

{@link SearchOptions} has `depth`, the number of moves to look ahead, counting both players. A deeper search sees more threats and visits many more positions. The search is synchronous, so the frame waits for it. Read `nodes` to tune the depth against your frame budget on the slowest device you support.

```ts
const { move, nodes } = searchBestMove(ticTacToe, board, { depth: 4 })
console.log(`depth 4 visited ${nodes} positions`)
```

## Advanced usage

### The negamax sign convention

`evaluate` and every score are from the point of view of the player whose turn it is. The search negates the score each time it goes down a move, so one function plays both sides.

The sign matters most at the end of the game. In many games the game ends on the move that completes a line, so in a finished position the player to move is the one who just lost. Return a large negative number for that, offset by the move count so a fast loss scores worse than a slow one.

```ts
function evaluate(state: State): number {
  if (justLost(state)) return -(WIN - state.movesPlayed)
  if (isDraw(state)) return 0
  return heuristic(state) // small, for the player to move
}
```

The negation on the way up turns that loss into a large positive score for the winning move. The offset makes the search prefer winning sooner and losing later.

### Make and unmake

The search changes the state in place and restores it at each position. A deep search visits tens of thousands of positions, and copying the state at each one makes a lot of garbage. The search calls `makeMove` and `unmakeMove` in last-in, first-out order, so `unmakeMove` reverses only the latest move. In a column-drop game, each is one write: drop a piece and raise the column height, or clear the cell and lower it again.

The search is synchronous and restores the state, so you can search your live board. The state is yours alone while the search runs.

### Move ordering

Return stronger moves first from `moves`. Alpha-beta pruning skips a branch once it finds a reply good enough for the opponent to avoid it, and good moves early find those replies sooner. The search then visits fewer positions. In the tic-tac-toe example the center and corners come first.

### Difficulty

Keep the search exact and set difficulty in your game code. A shallower depth makes the opponent see fewer threats. For the easiest levels, add a chance to play a random legal move instead of searching.

```ts
function chooseMove(state: State, depth: number, blunderChance: number): Move {
  if (Math.random() < blunderChance) {
    const legal = game.moves(state)
    return legal[Math.floor(Math.random() * legal.length)]
  }
  return searchBestMove(game, state, { depth }).move!
}
```

A random move gives an easier opponent than a move with a slightly lower score, because a near-best move can still hand the player an immediate win.

### Ties and reproducible tests

When several moves share the best score, the search picks one at random, each with the same chance, so the opponent plays a different game each time. `SearchOptions.random` sets the random source and defaults to `Math.random`. Pass a seeded generator to make a search reproducible in tests.

```ts
import { searchBestMove } from 'stargazer'

let seed = 1
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const { move } = searchBestMove(ticTacToe, board, { depth: 9, random })
```

## Next step

Run the search from a pointer handler or a behavior and play the move on your scene. The [Testing guide](/guides/testing) shows how to run the engine without a GPU, so you can test a whole game.

## See also

- {@link searchBestMove}: picks the best move for the player to move
- {@link AdversarialGame}: the five functions that describe a game
- {@link SearchOptions}: depth and the tie-break random source
- {@link SearchResult}: the chosen move, its score, and positions visited
