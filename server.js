const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Game state per room
const rooms = {}; // roomName -> { players: { socketId -> {teamName, selections, totalCost, totalMass, ready}}, hostSocket, gameRunning, gameEndTimer, gameEndTime }
// For quick testing during development we use a 45 second round.
// Change this back to 10 * 60 * 1000 for normal 10 minute games.
const GAME_DURATION_MS = 45 * 1000; // 45 seconds (testing)

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', ({ roomName, teamName }) => {
    if (!roomName) return;
    if (!rooms[roomName]) {
      rooms[roomName] = { players: {}, hostSocket: socket.id, gameRunning: false, gameEndTimer: null, gameEndTime: null };
    }
    joinRoom(socket, roomName, teamName);
    emitRoomList();
  });

  socket.on('joinRoom', ({ roomName, teamName }) => {
    if (!roomName || !rooms[roomName]) return;
    joinRoom(socket, roomName, teamName);
    emitRoomList();
  });

  socket.on('requestRooms', () => {
    socket.emit('roomsList', Object.keys(rooms));
  });

  socket.on('leaveRoom', ({ roomName }) => {
    if (!roomName) return;
    leaveRoom(socket, roomName);
    emitRoomList();
  });

  socket.on('toggleReady', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return;
      p.ready = !p.ready;
      io.to(roomName).emit('roomPlayersUpdate', { players: getRoomPlayersForClient(roomName), hostSocket: rooms[roomName].hostSocket });
  });

  socket.on('updateSelection', ({ roomName, selections, totalCost, totalMass }) => {
    const room = rooms[roomName];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    player.selections = selections;
    player.totalCost = totalCost;
    player.totalMass = totalMass;
    io.to(roomName).emit('teamPartialUpdate', { teamName: player.teamName, totalCost, totalMass });
  });

  socket.on('startGame', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) return;
    if (socket.id !== room.hostSocket) return; // only host
    if (room.gameRunning) return;
    room.gameRunning = true;
    const gameStartTime = Date.now();
    room.gameEndTime = gameStartTime + GAME_DURATION_MS;
    io.to(roomName).emit('gameStarted', { gameStartTime, gameEndTime: room.gameEndTime, durationMs: GAME_DURATION_MS });
    clearTimeout(room.gameEndTimer);
    room.gameEndTimer = setTimeout(() => {
      endRoomGame(roomName);
    }, GAME_DURATION_MS);
  });

  socket.on('requestSummary', ({ roomName }) => {
    const room = rooms[roomName];
    if (!room) return;
    io.to(roomName).emit('summaryUpdate', buildSummary(roomName));
  });

  socket.on('disconnect', () => {
    // remove from any rooms
    for (const rName of Object.keys(rooms)) {
      if (rooms[rName].players[socket.id]) {
        leaveRoom(socket, rName);
      }
    }
    emitRoomList();
  });
});

function joinRoom(socket, roomName, teamName) {
  socket.join(roomName);
  if (!rooms[roomName]) rooms[roomName] = { players: {}, hostSocket: socket.id, gameRunning: false, gameEndTimer: null, gameEndTime: null };
  rooms[roomName].players[socket.id] = { teamName: teamName || ('Team-' + socket.id.slice(0,4)), selections: {}, totalCost: 0, totalMass: 0, ready: false };
  // set host if none
  if (!rooms[roomName].hostSocket) rooms[roomName].hostSocket = socket.id;
  io.to(roomName).emit('roomPlayersUpdate', { players: getRoomPlayersForClient(roomName), hostSocket: rooms[roomName].hostSocket });
  // notify the joining socket which room it joined and current players
  socket.emit('joinedRoom', { roomName, players: getRoomPlayersForClient(roomName), hostSocket: rooms[roomName].hostSocket });
}

function leaveRoom(socket, roomName) {
  const room = rooms[roomName];
  if (!room) return;
  delete room.players[socket.id];
  socket.leave(roomName);
  // if host left, promote another
  if (socket.id === room.hostSocket) {
    const ids = Object.keys(room.players);
    room.hostSocket = ids.length ? ids[0] : null;
  }
  // if no players left, clean up
  if (Object.keys(room.players).length === 0) {
    clearTimeout(room.gameEndTimer);
    delete rooms[roomName];
  } else {
    io.to(roomName).emit('roomPlayersUpdate', { players: getRoomPlayersForClient(roomName), hostSocket: rooms[roomName].hostSocket });
  }
}

function getRoomPlayersForClient(roomName) {
  const room = rooms[roomName];
  if (!room) return [];
  return Object.entries(room.players).map(([id, p]) => ({ socketId: id, teamName: p.teamName, ready: !!p.ready }));
}

function emitRoomList() {
  io.emit('roomsList', Object.keys(rooms));
}

function buildSummary(roomName) {
  const room = rooms[roomName];
  if (!room) return [];
  const MASS_THRESHOLD = 50000;
  const summary = [];
  for (const [id, p] of Object.entries(room.players)) {
    const selections = p.selections || {};
    const totalMass = p.totalMass || 0;
    const totalCost = p.totalCost || 0;
    const insulation = selections['Plane thermal insulation'] || null;
    const insulationRating = (insulation && insulation.insulationRating != null) ? insulation.insulationRating : 0;
    const takeoffSuccess = totalMass <= MASS_THRESHOLD;
    const reentrySurvive = insulationRating >= 1;
    summary.push({ teamName: p.teamName, selections, totalMass, totalCost, takeoffSuccess, reentrySurvive });
  }
  return summary;
}

function endRoomGame(roomName) {
  const room = rooms[roomName];
  if (!room) return;
  room.gameRunning = false;
  const summary = buildSummary(roomName);
  io.to(roomName).emit('gameOver', { summary });
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
