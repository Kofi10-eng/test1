const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CATEGORIES = ['name', 'animal', 'place', 'object'];

function loadSet(file) {
  try {
    return new Set(fs.readFileSync(path.join(__dirname, file), 'utf8')
      .split(/\r?\n/).map(normalise).filter(Boolean));
  } catch { return new Set(); }
}
const db = { name: loadSet('names.txt'), animal: loadSet('animals.txt'), place: loadSet('places.txt'), object: loadSet('objects.txt') };

function normalise(s='') { return String(s).toLowerCase().trim().replace(/\s+/g, ' '); }
function codeClean(s='') { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
function makeCode() { let c=''; const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for(let i=0;i<4;i++) c += chars[Math.floor(Math.random()*chars.length)]; return c; }
function distance(a,b){
  a=normalise(a); b=normalise(b); const m=a.length,n=b.length; if(Math.abs(m-n)>2) return 3;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=> i? (j?0:i):j));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[m][n];
}
function validate(category, answer, letter) {
  const raw = answer || ''; const val = normalise(raw); const l = (letter||'').toLowerCase();
  if (!val) return { status:'blank', valid:false, canonical:'', typo:false, reason:'Blank' };
  if (!val.startsWith(l)) return { status:'wrong-letter', valid:false, canonical:val, typo:false, reason:`Does not start with ${letter}` };
  const set = db[category] || new Set();
  if (set.has(val)) return { status:'valid', valid:true, canonical:val, typo:false, reason:'Valid' };
  // plural handling for objects/animals
  if ((category === 'object' || category === 'animal') && val.endsWith('s') && set.has(val.slice(0,-1))) {
    return { status:'valid', valid:true, canonical:val.slice(0,-1), typo:false, reason:'Plural accepted' };
  }
  // relaxed place aliases: allow prefix if exact city has full official name e.g. frankfurt -> frankfurt am main
  if (category === 'place') {
    for (const item of set) if (item.startsWith(val + ' ') || val.startsWith(item + ' ')) return { status:'valid', valid:true, canonical:item, typo:false, reason:'Place alias accepted' };
  }
  // typo match only same first letter and short distance
  let best=null, bestD=3;
  for (const item of set) {
    if (!item.startsWith(l)) continue;
    const d = distance(val, item);
    if (d < bestD) { bestD=d; best=item; if (d===1) break; }
  }
  if (best && bestD <= 1) return { status:'typo', valid:true, canonical:best, typo:true, reason:`Typo of ${best}` };
  return { status:'invalid', valid:false, canonical:val, typo:false, reason:'Not in database' };
}

const rooms = new Map();
function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, status: room.status, letter: room.letter,
    usedLetters: room.usedLetters, rush: room.rush, scores: room.scores,
    players: Object.fromEntries(Object.entries(room.players).map(([id,p])=>[id,{id,name:p.name,score:p.score,connected:p.connected,answers:p.answers||{}}])),
    results: room.results || null, challenges: room.challenges || []
  };
}
function emitRoom(code){ const room=rooms.get(code); if(room) io.to(code).emit('room-state', publicRoom(room)); }
function getRoom(code){ return rooms.get(codeClean(code)); }

io.on('connection', socket => {
  socket.on('create-room', ({ name }, cb=()=>{}) => {
    let code; do code=makeCode(); while(rooms.has(code));
    const room = { code, hostId: socket.id, players:{}, scores:{}, status:'lobby', letter:null, usedLetters:[], rush:null, results:null, challenges:[] };
    room.players[socket.id] = { id:socket.id, name:(name||'Player').trim()||'Player', score:0, connected:true, answers:{} };
    room.scores[socket.id] = 0; rooms.set(code, room); socket.join(code); socket.data.roomCode=code;
    cb({ ok:true, code, playerId:socket.id }); emitRoom(code);
  });

  socket.on('join-room', ({ code, name }, cb=()=>{}) => {
    const clean = codeClean(code); const room = rooms.get(clean);
    if (!room) return cb({ ok:false, error:'Room not found' });
    room.players[socket.id] = { id:socket.id, name:(name||'Player').trim()||'Player', score:room.scores[socket.id]||0, connected:true, answers:{} };
    room.scores[socket.id] = room.scores[socket.id] || 0; socket.join(clean); socket.data.roomCode=clean;
    cb({ ok:true, code:clean, playerId:socket.id }); emitRoom(clean);
  });

  socket.on('start-round', (cb=()=>{}) => {
    const room = getRoom(socket.data.roomCode); if(!room) return cb({ok:false,error:'No room'});
    if(room.hostId!==socket.id) return cb({ok:false,error:'Only host can start'});
    const left = LETTERS.filter(l=>!room.usedLetters.includes(l));
    if(!left.length) return cb({ok:false,error:'All letters used'});
    const letter = left[Math.floor(Math.random()*left.length)]; room.letter=letter; room.usedLetters.push(letter); room.status='playing'; room.results=null; room.challenges=[]; room.rush=null;
    Object.values(room.players).forEach(p=>p.answers={}); cb({ok:true}); emitRoom(room.code);
  });

  socket.on('answer-update', ({ category, value }) => {
    const room=getRoom(socket.data.roomCode); if(!room || room.status!=='playing') return;
    if(!CATEGORIES.includes(category)) return; const p=room.players[socket.id]; if(!p) return;
    p.answers[category]=String(value||'').slice(0,80); emitRoom(room.code);
  });

  socket.on('rush', (cb=()=>{}) => {
    const room=getRoom(socket.data.roomCode); if(!room || room.status!=='playing') return cb({ok:false,error:'No active round'});
    const p=room.players[socket.id]; if(!p) return cb({ok:false,error:'Player missing'});
    if(room.rush) return cb({ok:false,error:'Rush already active'});
    room.rush = { byId:socket.id, byName:p.name, endsAt: Date.now()+5000 };
    io.to(room.code).emit('rush-started', room.rush); emitRoom(room.code);
    setTimeout(()=>{ const r=rooms.get(room.code); if(r && r.status==='playing' && r.rush?.byId===socket.id) finishRound(r); }, 5100);
    cb({ok:true});
  });

  socket.on('end-game', () => { const room=getRoom(socket.data.roomCode); if(!room || room.hostId!==socket.id) return; room.status='ended'; finishRound(room, true); });

  socket.on('challenge-answer', ({ targetId, category }, cb=()=>{}) => {
    const room=getRoom(socket.data.roomCode); if(!room || !room.results) return cb({ok:false,error:'No results to challenge'});
    if(!room.players[targetId] || !CATEGORIES.includes(category)) return cb({ok:false,error:'Invalid challenge'});
    const challenger=room.players[socket.id]; if(!challenger) return cb({ok:false,error:'Missing player'});
    const id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const challenge = { id, challengerId:socket.id, challengerName:challenger.name, targetId, targetName:room.players[targetId].name, category, answer:room.players[targetId].answers[category]||'', votes:{}, open:true };
    room.challenges.push(challenge); io.to(room.code).emit('challenge-popup', challenge); emitRoom(room.code); cb({ok:true});
  });

  socket.on('vote-challenge', ({ challengeId, vote }, cb=()=>{}) => {
    const room=getRoom(socket.data.roomCode); if(!room) return cb({ok:false,error:'No room'});
    const ch=room.challenges.find(c=>c.id===challengeId); if(!ch || !ch.open) return cb({ok:false,error:'Challenge closed'});
    if(socket.id===ch.challengerId || socket.id===ch.targetId) return cb({ok:false,error:'You cannot vote on this challenge'});
    ch.votes[socket.id] = vote === 'valid' ? 'valid' : 'invalid'; cb({ok:true}); emitRoom(room.code);
  });

  socket.on('disconnect', () => { const room=getRoom(socket.data.roomCode); if(room?.players[socket.id]) { room.players[socket.id].connected=false; emitRoom(room.code); } });
});

function finishRound(room, end=false) {
  room.status = end ? 'ended' : 'results'; room.rush=null;
  const results = {}; const byCat = {};
  for (const cat of CATEGORIES) {
    byCat[cat] = {};
    for (const [pid,p] of Object.entries(room.players)) {
      const v=validate(cat, p.answers?.[cat]||'', room.letter); results[pid] ||= {}; results[pid][cat] = { answer:p.answers?.[cat]||'', ...v, points:0 };
      if(v.valid) (byCat[cat][v.canonical] ||= []).push(pid);
    }
  }
  for (const cat of CATEGORIES) for (const ids of Object.values(byCat[cat])) {
    const base = ids.length > 1 ? 5 : 10;
    for (const pid of ids) { const cell=results[pid][cat]; cell.points = Math.max(0, base - (cell.typo ? 1 : 0)); room.scores[pid]=(room.scores[pid]||0)+cell.points; room.players[pid].score=room.scores[pid]; }
  }
  room.results = results; emitRoom(room.code);
}

server.listen(PORT, '0.0.0.0', () => console.log(`Category Rush running on port ${PORT}`));
