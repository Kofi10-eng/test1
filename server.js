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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CATEGORIES = ['name', 'animal', 'place', 'object'];
const rooms = new Map();

function norm(v) {
  return String(v || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function title(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
function readList(file, fallback=[]) {
  let vals = fallback;
  const candidates = [path.join(__dirname, file), path.join(__dirname, 'data', file)];
  for (const p of candidates) if (fs.existsSync(p)) { vals = fs.readFileSync(p, 'utf8').split(/\r?\n/); break; }
  return new Set(vals.map(norm).filter(Boolean));
}
const DB = {
  name: readList('names.txt'),
  animal: readList('animals.txt'),
  place: readList('places.txt'),
  object: readList('objects.txt')
};

const bannedPlaces = ['street','road','avenue','lane','drive','close','mews','mall','shop','store','tesco','walmart','mcdonald','kfc','airport','terminal','stadium','building','house','flat','hotel','restaurant','school','church'];
const objectHeads = new Set(['camera','food','bottle','mug','phone','laptop','computer','chair','table','bag','box','pen','pencil','car','ball','key','knife','kettle','lamp','shirt','shoe','book','toy','brush','clock','watch','ring','cable','charger','printer','guitar','drum','mirror','bed','sofa','plate','cup','glass','paper','notebook','ink','kite','kayak']);
const placeSuffixes = [' city',' town',' village',' state',' province',' region',' county',' district',' municipality',' island',' islands',' territory',' republic',' kingdom',' emirate'];

function distance(a, b) {
  if (!a || !b) return 999;
  if (Math.abs(a.length - b.length) > 2) return 999;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j=1; j<=b.length; j++) dp[0][j]=j;
  for (let i=1; i<=a.length; i++) for (let j=1; j<=b.length; j++) {
    const cost = a[i-1] === b[j-1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
  }
  return dp[a.length][b.length];
}
function fuzzy(set, value) {
  if (value.length < 4) return null;
  let best = null, bestD = 3;
  for (const item of set) {
    if (Math.abs(item.length - value.length) > 2) continue;
    if (item[0] !== value[0]) continue;
    const d = distance(value, item);
    if (d < bestD) { bestD = d; best = item; if (d === 1) break; }
  }
  return best ? { canonical: best, typo: true } : null;
}
function phraseObject(v) {
  if (DB.object.has(v)) return true;
  const words = v.split(' ');
  if (words.length > 1 && objectHeads.has(words[words.length-1])) return true; // Nikon camera, cat food
  if (words.length === 1 && (v.endsWith('s') && DB.object.has(v.slice(0,-1)))) return true;
  return false;
}
function likelyName(v) {
  if (DB.name.has(v)) return true;
  // Lenient for uncommon real names, not nonsense: alphabetic, name-like length, no spaces.
  return /^[a-z]{3,18}$/.test(v) && !DB.animal.has(v) && !DB.object.has(v) && !DB.place.has(v);
}
function likelyPlace(v) {
  if (DB.place.has(v)) return true;
  if (bannedPlaces.some(b => v.includes(b))) return false;
  if (placeSuffixes.some(s => v.endsWith(s))) return true;
  // Allow simple city/country style names to reduce false rejections like Frankfurt variants in smaller DBs.
  return /^[a-z][a-z\s-]{2,35}$/.test(v) && !DB.animal.has(v) && !DB.object.has(v);
}
function likelyObject(v) {
  if (phraseObject(v)) return true;
  // physical-object fallback: common noun-like single words are challengeable/accepted unless clearly abstract/banned
  const abstract = ['love','law','idea','truth','beauty','anger','fear','dream','music','time','energy','power','input','output'];
  if (abstract.includes(v)) return false;
  return /^[a-z][a-z\s-]{2,30}$/.test(v) && !DB.animal.has(v) && !DB.place.has(v);
}
function validate(category, raw, letter) {
  const v = norm(raw);
  if (!v) return { ok:false, canonical:'', reason:'Blank', typo:false };
  if (!v.startsWith(letter.toLowerCase())) return { ok:false, canonical:v, reason:`Must start with ${letter}`, typo:false };

  const set = DB[category];
  if (set.has(v)) return { ok:true, canonical:v, reason:'Valid', typo:false };
  if (category === 'object' && phraseObject(v)) return { ok:true, canonical:v.endsWith('s') && DB.object.has(v.slice(0,-1)) ? v.slice(0,-1) : v, reason:'Valid object', typo:false };

  const near = fuzzy(set, v);
  if (near) return { ok:true, canonical:near.canonical, reason:'Typo accepted', typo:true };

  if (category === 'name' && likelyName(v)) return { ok:true, canonical:v, reason:'Name-like accepted', typo:false };
  if (category === 'place' && likelyPlace(v)) return { ok:true, canonical:v, reason:'Geographic name accepted', typo:false };
  if (category === 'object' && likelyObject(v)) return { ok:true, canonical:v, reason:'Object-like accepted', typo:false };

  return { ok:false, canonical:v, reason:'Not recognised', typo:false };
}
function code() { let c=''; for (let i=0;i<4;i++) c += LETTERS[Math.floor(Math.random()*LETTERS.length)]; return c; }
function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, status: room.status, letter: room.letter,
    usedLetters: room.usedLetters, rushBy: room.rushBy, rushRemaining: room.rushRemaining,
    players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, score:p.score })),
    results: room.results || [], challenges: room.challenges || []
  };
}
function emit(room) { io.to(room.code).emit('room-state', publicRoom(room)); }
function findRoomBySocket(id) { for (const r of rooms.values()) if (r.players.has(id)) return r; return null; }
function recompute(room) {
  const rows = [];
  const counts = {};
  for (const p of room.players.values()) {
    const row = { playerId:p.id, playerName:p.name, answers:{...p.answers}, cells:{}, total:0 };
    for (const cat of CATEGORIES) {
      const val = validate(cat, p.answers[cat], room.letter || '');
      row.cells[cat] = { ...val, answer:title(p.answers[cat]) };
      if (val.ok) counts[cat+':'+val.canonical] = (counts[cat+':'+val.canonical]||0)+1;
    }
    rows.push(row);
  }
  // apply challenge overrides
  for (const ch of room.challenges || []) {
    if (ch.resolved && ch.decision) {
      const row = rows.find(r => r.playerId === ch.targetPlayerId);
      if (row) {
        const cell = row.cells[ch.category];
        if (ch.decision === 'count') { cell.ok = true; cell.reason = 'Counted by vote'; cell.canonical = norm(cell.answer); }
        if (ch.decision === 'reject') { cell.ok = false; cell.reason = 'Rejected by vote'; }
      }
    }
  }
  const counts2 = {};
  for (const r of rows) for (const cat of CATEGORIES) if (r.cells[cat].ok) counts2[cat+':'+r.cells[cat].canonical]=(counts2[cat+':'+r.cells[cat].canonical]||0)+1;
  for (const r of rows) {
    let total=0;
    for (const cat of CATEGORIES) {
      const cell = r.cells[cat];
      if (!cell.ok) { cell.points=0; continue; }
      const base = counts2[cat+':'+cell.canonical] > 1 ? 5 : 10;
      cell.points = Math.max(0, base - (cell.typo ? 1 : 0));
      total += cell.points;
    }
    r.total = total;
  }
  for (const p of room.players.values()) p.score = 0;
  for (const r of rows) { const p=room.players.get(r.playerId); if (p) p.score += r.total; }
  room.results = rows;
}
function startChallenge(room, challengerId, targetPlayerId, category) {
  // IMPORTANT: users may challenge ONLY THEIR OWN answer; they cannot challenge other users' answers.
  if (challengerId !== targetPlayerId) return { error:'You can only challenge your own answer.' };
  const row = (room.results||[]).find(r => r.playerId === targetPlayerId);
  if (!row || !row.cells[category]) return { error:'Answer not found.' };
  const existing = (room.challenges||[]).find(c => !c.resolved && c.targetPlayerId===targetPlayerId && c.category===category);
  if (existing) return { error:'Already challenged.' };
  const challenger = room.players.get(challengerId);
  const ch = { id: 'ch_'+Date.now()+'_'+Math.random().toString(16).slice(2), challengerId, challengerName: challenger?.name || 'Player', targetPlayerId, targetPlayerName: challenger?.name || 'Player', category, answer: row.cells[category].answer, votes:{}, resolved:false, decision:null };
  room.challenges.push(ch);
  return { challenge: ch };
}
function vote(room, socketId, challengeId, vote) {
  const ch = (room.challenges||[]).find(c=>c.id===challengeId && !c.resolved);
  if (!ch) return { error:'Challenge not found.' };
  // IMPORTANT: creator of challenge cannot vote. Other users can vote.
  if (socketId === ch.challengerId) return { error:'You cannot vote on your own challenge.' };
  if (!['count','reject'].includes(vote)) return { error:'Bad vote.' };
  ch.votes[socketId] = vote;
  const eligible = Math.max(1, room.players.size - 1);
  const count = Object.values(ch.votes).filter(v=>v==='count').length;
  const reject = Object.values(ch.votes).filter(v=>v==='reject').length;
  if (count > eligible/2 || reject >= eligible/2 || Object.keys(ch.votes).length >= eligible) {
    ch.resolved = true;
    ch.decision = count > reject ? 'count' : 'reject';
    recompute(room);
  }
  return { ok:true };
}

io.on('connection', socket => {
  socket.on('create-room', (name, cb=()=>{}) => {
    let roomCode; do { roomCode=code(); } while (rooms.has(roomCode));
    const player = { id:socket.id, name:title(name)||'Player', score:0, answers:{} };
    const room = { code:roomCode, hostId:socket.id, players:new Map([[socket.id, player]]), status:'lobby', letter:null, usedLetters:[], rushBy:null, rushRemaining:null, results:[], challenges:[], rushTimer:null };
    rooms.set(roomCode, room); socket.join(roomCode); cb({ ok:true, code:roomCode }); emit(room);
  });
  socket.on('join-room', ({ name, code:roomCode }, cb=()=>{}) => {
    roomCode = String(roomCode||'').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return cb({ ok:false, error:'Room not found' });
    room.players.set(socket.id, { id:socket.id, name:title(name)||'Player', score:0, answers:{} });
    socket.join(roomCode); cb({ ok:true, code:roomCode }); emit(room);
  });
  socket.on('start-round', (cb=()=>{}) => {
    const room = findRoomBySocket(socket.id); if (!room) return cb({ok:false,error:'No room'});
    if (room.hostId !== socket.id) return cb({ok:false,error:'Only host can start'});
    const available = LETTERS.filter(l=>!room.usedLetters.includes(l));
    if (!available.length) return cb({ok:false,error:'All letters used'});
    room.letter = available[Math.floor(Math.random()*available.length)];
    room.usedLetters.push(room.letter); room.status='playing'; room.rushBy=null; room.rushRemaining=null; room.results=[]; room.challenges=[];
    for (const p of room.players.values()) p.answers = {};
    cb({ok:true}); emit(room);
  });
  socket.on('answer', ({ category, value }) => {
    const room = findRoomBySocket(socket.id); if (!room || room.status!=='playing') return;
    if (!CATEGORIES.includes(category)) return;
    const p = room.players.get(socket.id); if (!p) return;
    p.answers[category] = title(value).slice(0,60); emit(room);
  });
  socket.on('rush', () => {
    const room = findRoomBySocket(socket.id); if (!room || room.status!=='playing' || room.rushTimer) return;
    const p = room.players.get(socket.id); if (!p) return;
    room.rushBy = p.name; room.rushRemaining = 5; emit(room);
    room.rushTimer = setInterval(()=>{
      room.rushRemaining -= 1;
      if (room.rushRemaining <= 0) {
        clearInterval(room.rushTimer); room.rushTimer=null; room.status='scored'; room.rushRemaining=0; recompute(room);
      }
      emit(room);
    }, 1000);
  });
  socket.on('end-round', () => { const room=findRoomBySocket(socket.id); if(room && room.hostId===socket.id){ room.status='scored'; recompute(room); emit(room);} });
  socket.on('challenge', ({ targetPlayerId, category }, cb=()=>{}) => { const room=findRoomBySocket(socket.id); if(!room) return cb({ok:false,error:'No room'}); const res=startChallenge(room, socket.id, targetPlayerId, category); cb(res.error?{ok:false,error:res.error}:{ok:true}); emit(room); });
  socket.on('challenge-vote', ({ challengeId, vote:choice }, cb=()=>{}) => { const room=findRoomBySocket(socket.id); if(!room) return cb({ok:false,error:'No room'}); const res=vote(room, socket.id, challengeId, choice); cb(res.error?{ok:false,error:res.error}:{ok:true}); emit(room); });
  socket.on('end-game', () => { const room=findRoomBySocket(socket.id); if(room && room.hostId===socket.id){ room.status='ended'; recompute(room); emit(room);} });
  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id); if(!room) return;
    room.players.delete(socket.id);
    if (!room.players.size) { rooms.delete(room.code); return; }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    emit(room);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Category Rush running on port ${PORT}`));
