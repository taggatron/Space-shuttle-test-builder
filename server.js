const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Game state
let teams = {}; // socketId -> { teamName, selections, totalCost, totalMass }
let hostSocket = null;
let gameRunning = false;
let gameEndTimer = null;
let gameStartTime = null;
const GAME_DURATION_MS = 10 * 60 * 1000; // 10 minutes

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // assign host if none
  if (!hostSocket) {
    hostSocket = socket.id;
  }

  socket.on('join', (payload) => {
    teams[socket.id] = {
      teamName: payload.teamName || ('Team-' + socket.id.slice(0,4)),
      selections: payload.selections || {},
      totalCost: 0,
      totalMass: 0
    };
    io.emit('teamsUpdate', Object.values(teams).map(t => ({teamName: t.teamName})))
  });

  socket.on('updateSelection', (payload) => {
    if (!teams[socket.id]) return;
    teams[socket.id].selections = payload.selections;
    teams[socket.id].totalCost = payload.totalCost;
    teams[socket.id].totalMass = payload.totalMass;
    // broadcast minimal update to others
    io.emit('teamPartialUpdate', { teamName: teams[socket.id].teamName, totalCost: payload.totalCost, totalMass: payload.totalMass});
  });

  socket.on('startGame', () => {
    if (gameRunning) return;
    // only host can start
    if (socket.id !== hostSocket) return;
    gameRunning = true;
    gameStartTime = Date.now();
    const gameEndTime = gameStartTime + GAME_DURATION_MS;
    io.emit('gameStarted', { gameStartTime, gameEndTime, durationMs: GAME_DURATION_MS });
    // set end timer
    clearTimeout(gameEndTimer);
    gameEndTimer = setTimeout(() => {
      endGame();
    }, GAME_DURATION_MS);
  });

  socket.on('requestSummary', () => {
    if (!gameRunning) return;
    // send current choices
    io.emit('summaryUpdate', buildSummary());
  })

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    if (teams[socket.id]) delete teams[socket.id];
    if (socket.id === hostSocket) {
      // promote new host
      hostSocket = Object.keys(io.sockets.sockets)[0] || null;
    }
    io.emit('teamsUpdate', Object.values(teams).map(t => ({teamName: t.teamName})))
  })
});

function buildSummary() {
  // compute simple outcomes (takeoff fail if mass > threshold; reentry fail if insulation rating low)
  const MASS_THRESHOLD = 50000; // kg (demo threshold)
  const summary = [];
  for (const [id, t] of Object.entries(teams)) {
    const selections = t.selections || {};
    const totalMass = t.totalMass || 0;
    const totalCost = t.totalCost || 0;
    // find insulation's thermal rating
    const insulation = selections['Plane thermal insulation'] || null;
    const insulationRating = (insulation && insulation.insulationRating != null) ? insulation.insulationRating : 0;
    const takeoffSuccess = totalMass <= MASS_THRESHOLD;
    const reentrySurvive = insulationRating >= 1; // simple rule
    summary.push({ teamName: t.teamName, selections, totalMass, totalCost, takeoffSuccess, reentrySurvive });
  }
  return summary;
}

function endGame() {
  gameRunning = false;
  const summary = buildSummary();
  io.emit('gameOver', { summary });
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
