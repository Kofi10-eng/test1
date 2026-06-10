const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// Works on Render and locally. Frontend files live in the project root.
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CATEGORIES = ['name', 'animal', 'place', 'object'];
const bannedPlaceWords = ['street','road','avenue','lane','drive','close','court','way','shop','store','mall','tesco','asda','sainsbury','mcdonald','restaurant','airport','stadium','terminal','building'];

function norm(v) {
  return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
}
function title(v) { return String(v || '').trim(); }
function readList(file, fallback = []) {
  const candidates = [path.join(__dirname, 'data', file), path.join(__dirname, file)];
  let values = [];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      values = fs.readFileSync(p, 'utf8').split(/\r?\n/).map(norm).filter(Boolean);
      break;
    }
  }
  return new Set([...values, ...fallback.map(norm)].filter(Boolean));
}

const DB = {
  name: readList('names.txt'),
  animal: readList('animals.txt'),
  place: readList('places.txt'),
  object: readList('objects.txt')
};

function distance(a, b) {
  if (!a || !b) return 99;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
function fuzzyFind(set, value) {
  if (!value || value.length < 3) return null;
  let best = null, bestDist = 3;
  for (const item of set) {
    if (item[0] !== value[0]) continue;
    const d = distance(value, item);
    if (d < bestDist) { bestDist = d; best = item; if (d === 1) break; }
  }
  return best;
}
function singular(v) {
  if (v.endsWith('ies')) return v.slice(0, -3) + 'y';
  if (v.endsWith('es')) return v.slice(0, -2);
  if (v.endsWith('s') && v.length > 3) return v.slice(0, -1);
  return v;
}
function validate(category, raw, letter) {
  const v = norm(raw);
  if (!v) return { ok: false, canonical: '', typo: false, reason: 'Blank answer' };
  if (letter && v[0] !== letter.toLowerCase()) return { ok: false, canonical: v, typo: false, reason: `Must start with ${letter}` };
  if (category === 'place' && bannedPlaceWords.some(w => v.includes(w))) return { ok: false, canonical: v, typo: false, reason: 'Streets, shops, buildings and venues do not count' };
  const set = DB[category] || new Set();
  if (set.has(v)) return { ok: true, canonical: v, typo: false, reason: 'Valid' };
  const sv = singular(v);
  if (set.has(sv)) return { ok: true, canonical: sv, typo: false, reason: 'Valid plural/singular' };
  const match = fuzzyFind(set, v);
  if (match) return { ok: true, canonical: match, typo: true, reason: `Spelling close to ${match}` };
  // Accept reasonable two-word physical object phrases if second word is known object.
  if (category === 'object' && v.includes(' ')) {
    const last = v.split(' ').pop();
    if (set.has(last) || set.has(singular(last))) return { ok: true, canonical: v, typo: false, reason: 'Valid physical object phrase' };
  }
  // Places should not be too strict: allow capitalised/simple geographical-sounding names via challenge, not direct full points.
  return { ok: false, canonical: v, typo: false, reason: category === 'place' ? 'Not in place database; challenge if it is a real city/state/province/region/country' : `Not a recognised ${category}` };
}
function makeCode() {
  let code;
  do code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); while (rooms.has(code));
  return code;
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score })),
    status: room.status,
    letter: room.letter,
    usedLetters: room.usedLetters,
    countdown: room.countdown,
    results: room.results || null,
    final: room.final || null,
    challenge: room.challenge || null
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function scoreRoom(room) {
  const submissions = [...room.players.values()].map(p => ({ player: p, answers: p.answers || {} }));
  const validations = {};
  const counts = {};
  for (const { player, answers } of submissions) {
    validations[player.id] = {};
    for (const cat of CATEGORIES) {
      const val = validate(cat, answers[cat], room.letter);
      validations[player.id][cat] = val;
      if (val.ok) counts[`${cat}:${val.canonical}`] = (counts[`${cat}:${val.canonical}`] || 0) + 1;
    }
  }
  const results = [];
  for (const { player, answers } of submissions) {
    let total = 0;
    const rows = {};
    for (const cat of CATEGORIES) {
      const val = validations[player.id][cat];
      let points = 0;
      if (val.ok) {
        points = counts[`${cat}:${val.canonical}`] > 1 ? 5 : 10;
        if (val.typo) points = Math.max(0, points - 1);
      }
      rows[cat] = { answer: title(answers[cat]), ...val, points };
      total += points;
    }
    player.score += total;
    results.push({ playerId: player.id, name: player.name, total, rows, score: player.score });
  }
  room.results = results;
  room.status = 'results';
}

const rooms = new Map();

io.on('connection', socket => {
  socket.on('room:create', ({ name }, cb) => {
    const code = makeCode();
    const player = { id: socket.id, name: title(name) || 'Player', score: 0, answers: {} };
    const room = { code, hostId: socket.id, players: new Map([[socket.id, player]]), status: 'lobby', letter: null, usedLetters: [], countdown: null, results: null, final: null, challenge: null };
    rooms.set(code, room);
    socket.join(code); socket.data.roomCode = code;
    cb && cb({ ok: true, code, playerId: socket.id });
    emitRoom(room);
  });
  socket.on('room:join', ({ code, name }, cb) => {
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    const player = { id: socket.id, name: title(name) || 'Player', score: 0, answers: {} };
    room.players.set(socket.id, player);
    socket.join(code); socket.data.roomCode = code;
    cb && cb({ ok: true, code, playerId: socket.id });
    emitRoom(room);
  });
  socket.on('round:start', (_data, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return cb && cb({ ok: false, error: 'Only host can start' });
    const available = LETTERS.filter(l => !room.usedLetters.includes(l));
    if (!available.length) return cb && cb({ ok: false, error: 'All letters used' });
    room.letter = available[Math.floor(Math.random() * available.length)];
    room.usedLetters.push(room.letter);
    room.status = 'playing'; room.results = null; room.final = null; room.challenge = null; room.countdown = null;
    for (const p of room.players.values()) p.answers = {};
    cb && cb({ ok: true }); emitRoom(room);
  });
  socket.on('answers:update', answers => {
    const room = rooms.get(socket.data.roomCode); if (!room) return;
    const player = room.players.get(socket.id); if (!player || room.status !== 'playing') return;
    player.answers = { ...player.answers, ...answers };
  });
  socket.on('rush', () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.status !== 'playing' || room.countdown) return;
    room.countdown = 5; emitRoom(room);
    const interval = setInterval(() => {
      if (!rooms.has(room.code)) return clearInterval(interval);
      room.countdown -= 1;
      if (room.countdown <= 0) { clearInterval(interval); room.countdown = null; scoreRoom(room); }
      emitRoom(room);
    }, 1000);
  });
  socket.on('challenge:create', ({ playerId, category }) => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.status !== 'results') return;
    const result = room.results.find(r => r.playerId === playerId); if (!result || !result.rows[category]) return;
    room.challenge = { id: Date.now().toString(), challengerId: socket.id, playerId, category, answer: result.rows[category].answer, votes: {} };
    emitRoom(room);
  });
  socket.on('challenge:vote', ({ vote }) => {
    const room = rooms.get(socket.data.roomCode); if (!room || !room.challenge) return;
    if (room.challenge.challengerId === socket.id) return;
    if (!['count','reject'].includes(vote)) return;
    room.challenge.votes[socket.id] = vote;
    emitRoom(room);
  });
  socket.on('game:end', () => {
    const room = rooms.get(socket.data.roomCode); if (!room || room.hostId !== socket.id) return;
    room.status = 'ended'; room.final = [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a,b)=>b.score-a.score);
    emitRoom(room);
  });
  socket.on('disconnect', () => {
    const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return;
    room.players.delete(socket.id);
    if (!room.players.size) rooms.delete(code);
    else { if (room.hostId === socket.id) room.hostId = room.players.keys().next().value; emitRoom(room); }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Category Rush running on port ${PORT}`));
