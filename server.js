const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const CATEGORIES = ['name', 'animal', 'place', 'object'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !['Q','X','Z'].includes(l));
const rooms = new Map();

function norm(v) {
  return String(v || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function title(v) { return String(v || '').trim().replace(/\b\w/g, c => c.toUpperCase()); }
function readSet(file, fallback = []) {
  const p = path.join(__dirname, file);
  const list = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\r?\n/) : fallback;
  return new Set(list.map(norm).filter(Boolean));
}
const DB = {
  name: readSet('names.txt'), animal: readSet('animals.txt'), place: readSet('places.txt'), object: readSet('objects.txt')
};
const BLOCKED_PLACES = ['street','road','avenue','lane','drive','close','way','tesco','asda','aldi','lidl','shop','store','mall','mcdonald','kfc','airport','stadium','station','terminal','building','house','hotel','restaurant'];
const ABSTRACT_OBJECTS = ['love','law','idea','dream','thought','air','music','time','hope','fear','anger','truth','justice','freedom','happiness'];

function singular(v) { return v.endsWith('s') && v.length > 3 ? v.slice(0, -1) : v; }
function dist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}
function typoMatch(value, set) {
  if (value.length < 4) return null;
  let best = null, bestD = 3;
  for (const item of set) {
    if (item[0] !== value[0]) continue;
    const d = dist(value, item);
    if (d < bestD) { bestD = d; best = item; if (d === 1) break; }
  }
  return bestD <= 1 ? best : null;
}
function validate(category, raw, letter) {
  const value = norm(raw);
  if (!value) return { valid: false, blank: true, canonical: '', typo: false, reason: 'Blank' };
  if (value[0] !== letter.toLowerCase()) return { valid: false, canonical: value, typo: false, reason: `Must start with ${letter}` };

  const set = DB[category] || new Set();
  if (set.has(value)) return { valid: true, canonical: value, typo: false, reason: 'Valid' };
  if (set.has(singular(value))) return { valid: true, canonical: singular(value), typo: false, reason: 'Plural accepted' };

  const typo = typoMatch(value, set);
  if (typo) return { valid: true, canonical: typo, typo: true, reason: `Spelling close to ${title(typo)}` };

  if (category === 'name' && /^[a-z][a-z-]{1,24}$/.test(value)) return { valid: true, canonical: value, typo: false, reason: 'Accepted name format' };
  if (category === 'place') {
    if (BLOCKED_PLACES.some(x => value.includes(x))) return { valid: false, canonical: value, typo: false, reason: 'Not a geographical place' };
    if (/^[a-z][a-z\s-]{2,40}$/.test(value)) return { valid: true, canonical: value, typo: false, reason: 'Accepted geographical name' };
  }
  if (category === 'object') {
    if (ABSTRACT_OBJECTS.includes(value)) return { valid: false, canonical: value, typo: false, reason: 'Not a physical object' };
    if (/^[a-z0-9][a-z0-9\s-]{1,40}$/.test(value)) return { valid: true, canonical: value, typo: false, reason: 'Accepted physical object' };
  }
  if (category === 'animal' && /^[a-z][a-z\s-]{2,40}$/.test(value)) return { valid: true, canonical: value, typo: false, reason: 'Accepted animal-like name' };

  return { valid: false, canonical: value, typo: false, reason: 'Not in database' };
}
function newRoom(code, hostId, hostName) {
  return { code, hostId, status: 'lobby', letter: null, usedLetters: [], players: new Map(), results: [], rush: null, challenge: null };
}
function safeRoom(room) {
  return { code: room.code, hostId: room.hostId, status: room.status, letter: room.letter, usedLetters: room.usedLetters, rush: room.rush, challenge: room.challenge, players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, score:p.score, answers:p.answers || {} })), results: room.results || [] };
}
function emitRoom(room) { io.to(room.code).emit('room-state', safeRoom(room)); }
function makeCode() { do { var c = Array.from({length:4}, () => LETTERS[Math.floor(Math.random()*LETTERS.length)]).join(''); } while (rooms.has(c)); return c; }
function ensurePlayer(room, socket, name) {
  if (!room.players.has(socket.id)) room.players.set(socket.id, { id: socket.id, name: name || 'Player', score: 0, answers: {} });
  return room.players.get(socket.id);
}
function scoreRound(room) {
  const counts = {};
  const validations = {};
  for (const p of room.players.values()) {
    validations[p.id] = {};
    for (const cat of CATEGORIES) {
      const val = validate(cat, p.answers?.[cat] || '', room.letter);
      validations[p.id][cat] = val;
      if (val.valid) counts[cat + ':' + val.canonical] = (counts[cat + ':' + val.canonical] || 0) + 1;
    }
  }
  const results = [];
  for (const p of room.players.values()) {
    let add = 0; const rows = {};
    for (const cat of CATEGORIES) {
      const raw = p.answers?.[cat] || '';
      const val = validations[p.id][cat];
      let pts = 0;
      if (val.valid) { pts = counts[cat + ':' + val.canonical] > 1 ? 5 : 10; if (val.typo) pts = Math.max(0, pts - 1); }
      add += pts;
      rows[cat] = { raw, points: pts, ...val };
    }
    p.score += add;
    results.push({ playerId:p.id, playerName:p.name, total:add, rows });
  }
  room.results = results;
  room.status = 'results';
}
function finishRound(room) { if (!room || room.status === 'results' || room.status === 'ended') return; scoreRound(room); emitRoom(room); }

io.on('connection', socket => {
  socket.on('create-room', ({ name }, cb) => {
    const code = makeCode(); const room = newRoom(code, socket.id, name || 'Host'); rooms.set(code, room); socket.join(code); ensurePlayer(room, socket, name || 'Host'); emitRoom(room); cb?.({ ok:true, code, playerId:socket.id });
  });
  socket.on('join-room', ({ code, name }, cb) => {
    const clean = String(code || '').trim().toUpperCase(); const room = rooms.get(clean);
    if (!room) return cb?.({ ok:false, error:'Room not found' });
    socket.join(clean); ensurePlayer(room, socket, name || 'Player'); emitRoom(room); cb?.({ ok:true, code: clean, playerId:socket.id });
  });
  socket.on('start-round', ({ code }, cb) => {
    const room = rooms.get(String(code||'').toUpperCase()); if (!room) return cb?.({ ok:false, error:'Room not found' });
    if (socket.id !== room.hostId) return cb?.({ ok:false, error:'Only host can start' });
    const pool = LETTERS.filter(l => !room.usedLetters.includes(l)); if (!pool.length) return cb?.({ ok:false, error:'All letters used' });
    const letter = pool[Math.floor(Math.random()*pool.length)]; room.letter = letter; room.usedLetters.push(letter); room.status = 'active'; room.results = []; room.rush = null; room.challenge = null;
    for (const p of room.players.values()) p.answers = {};
    emitRoom(room); cb?.({ ok:true, letter });
  });
  socket.on('answer-update', ({ code, answers }, cb) => {
    const room = rooms.get(String(code||'').toUpperCase()); if (!room) return cb?.({ ok:false }); const p = room.players.get(socket.id); if (!p) return cb?.({ ok:false });
    p.answers = {}; for (const cat of CATEGORIES) p.answers[cat] = String(answers?.[cat] || ''); emitRoom(room); cb?.({ ok:true });
  });
  socket.on('rush', ({ code }, cb) => {
    const room = rooms.get(String(code||'').toUpperCase()); if (!room || room.status !== 'active') return cb?.({ ok:false }); const p = room.players.get(socket.id); if (!p) return cb?.({ ok:false });
    if (room.rush) return cb?.({ ok:false, error:'Rush already active' });
    room.rush = { byId: p.id, byName: p.name, endsAt: Date.now() + 5000 }; emitRoom(room); io.to(room.code).emit('rush-started', room.rush); setTimeout(() => finishRound(room), 5100); cb?.({ ok:true });
  });
  socket.on('challenge', ({ code, targetId, category }, cb) => {
    const room = rooms.get(String(code||'').toUpperCase()); if (!room || room.status !== 'results') return cb?.({ ok:false, error:'No results yet' });
    if (socket.id !== targetId) return cb?.({ ok:false, error:'You can only challenge your own answer' });
    const res = room.results.find(r => r.playerId === targetId); if (!res || !CATEGORIES.includes(category)) return cb?.({ ok:false, error:'Invalid challenge' });
    const p = room.players.get(socket.id);
    room.challenge = { id: Date.now().toString(36), challengerId: socket.id, challengerName: p.name, targetId, targetName: res.playerName, category, answer: res.rows[category].raw || '', votes: {}, createdAt: Date.now() };
    emitRoom(room); io.to(room.code).emit('challenge-popup', room.challenge); cb?.({ ok:true });
  });
  socket.on('vote', ({ code, challengeId, vote }, cb) => {
    const room = rooms.get(String(code||'').toUpperCase()); if (!room?.challenge || room.challenge.id !== challengeId) return cb?.({ ok:false, error:'No challenge' });
    if (socket.id === room.challenge.challengerId) return cb?.({ ok:false, error:'You cannot vote on your own challenge' });
    if (!['count','reject'].includes(vote)) return cb?.({ ok:false });
    room.challenge.votes[socket.id] = vote; emitRoom(room); cb?.({ ok:true });
  });
  socket.on('end-game', ({ code }, cb) => {
    const room = rooms.get(String(code||'').toUpperCase()); if (!room) return cb?.({ ok:false }); if (socket.id !== room.hostId) return cb?.({ ok:false, error:'Only host can end' }); room.status = 'ended'; emitRoom(room); cb?.({ ok:true });
  });
  socket.on('disconnect', () => { for (const room of rooms.values()) { if (room.players.delete(socket.id)) { if (room.hostId === socket.id) room.hostId = room.players.values().next().value?.id || null; if (!room.players.size) rooms.delete(room.code); else emitRoom(room); } } });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Category Rush running on port ${PORT}`));
