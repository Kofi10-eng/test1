const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 30000, pingInterval: 10000 });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function norm(s='') { return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function title(s='') { return norm(s).replace(/\b\w/g, c => c.toUpperCase()); }
function readSet(file, fallback=[]) {
  const p = path.join(__dirname, file);
  const lines = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\r?\n/) : [];
  return new Set([...fallback, ...lines].map(norm).filter(Boolean));
}

const BASE_NAMES = `aaron abigail ada adam adams adwoa afia agnes ahmed akua akwasi albert alex alexander ali alice ama amelia aminata andrew angelina anna anthony arthur asante asare ayesha benjamin brian charles chris christopher daniel dante david deborah dorcas edward elizabeth emmanuel esther evelyn fatima felix francis frank george grace hannah harriet henry isaac isabella james janet jessica joel john joseph joshua juliet justice karen kofi kwame kwesi linda mary michael nana nathaniel osman owusu patrick paul peter philip princess richard robert rose sarah sarpong smith stephen susan thomas victoria william yaw yeboah`.split(/\s+/);
const BASE_ANIMALS = `aardvark albatross alligator alpaca ant anteater antelope ape armadillo badger bat bear beaver bee beetle bison boar buffalo butterfly camel cat cheetah chicken chimpanzee cobra cow crab crocodile deer dog dolphin donkey duck eagle eel elephant falcon ferret fish flamingo fox frog gazelle gecko gerbil giraffe goat gorilla hamster hare hawk hedgehog hippo horse jaguar kangaroo koala leopard lion lizard llama lobster monkey mouse octopus ostrich otter owl panda panther parrot penguin pig rabbit raccoon rat raven rhino salmon seal shark sheep snake spider squid squirrel swan tiger turkey turtle whale wolf zebra`.split(/\s+/);
const BASE_PLACES = `accra abuja addis ababa africa alabama alaska albania algeria amsterdam andorra angola argentina arizona arkansas asia athens australia austria bahrain bangladesh barcelona bavaria beijing belgium benin berlin bexleyheath birmingham bolivia brazil bristol brussels california cambridge canada cardiff chile china colchester congo copenhagen croatia denmark doha dublin egypt england essex ethiopia europe finland frankfurt frankfurt am main france gaborone gabasawa ghana glasgow greater accra greater accra region greece guangdong guatemala gujarat hamburg harrow india indonesia iran iraq ireland israel italy jamaica japan johannesburg kent kenya kumasi lagos leeds lisbon london madrid manchester mexico milan morocco mumbai munich nairobi new york nigeria ontario oxford paris portugal quebec rome scotland seoul spain stockholm sydney taiwan tokyo toronto turkey uganda united kingdom united states usa wales warsaw yamoussoukro zambia zurich`.split(/\n|,/).join(' ').split(/\s{2,}/);
const BASE_OBJECTS = `air fryer alarm anchor apron axe bag ball balloon banana battery bed belt bicycle bin blender book bottle bowl box bracelet broom brush bucket button cable calculator camera candle cap car card carpet chair charger clock coat comb computer cup curtain desk door drill drum fan file flag fork fridge frying pan generator glasses gloves glue guitar hammer hat headphones helmet ink ink cartridge iron jacket jug kettle key keyboard kite knife lamp laptop lighter lock mirror mug nail necklace notebook oven paint pan paper pen pencil phone pillow plate printer radio ring rope ruler saw scarf scissors shirt shoe sofa spoon table tablet television toothbrush torch towel toy train tray umbrella wallet watch wheel window`.split(/\n|,/).join(' ').split(/\s{2,}|\s(?=[a-z]+\s)/).filter(Boolean);

const names = readSet('names.txt', BASE_NAMES);
const animals = readSet('animals.txt', BASE_ANIMALS);
const places = readSet('places.txt', BASE_PLACES);
const objects = readSet('objects.txt', BASE_OBJECTS);

// Generate many practical physical object phrases without massive files.
const objectBases = ['camera','phone','case','charger','bottle','bag','box','book','pen','pencil','keyboard','mouse','chair','table','lamp','cup','mug','plate','knife','spoon','fork','shoe','shirt','jacket','hat','watch','ring','ball','kite','ink','paint','paper','card','cable','speaker','screen','remote','controller','toy','food','tin','jar','brush','comb','mirror','towel'];
const brands = ['nikon','canon','sony','samsung','apple','dell','hp','lenovo','adidas','nike','puma','gucci','lg','tesco'];
const modifiers = ['red','blue','black','white','small','large','plastic','metal','wooden','glass','paper','cat','dog','baby','water','coffee','football','kitchen','school'];
for (const b of brands) for (const o of objectBases) objects.add(`${b} ${o}`);
for (const m of modifiers) for (const o of objectBases) objects.add(`${m} ${o}`);

const bannedPlaceWords = new Set(['street','road','avenue','lane','drive','close','shop','store','tesco','walmart','mcdonalds','mall','airport','stadium','terminal','building','warehouse']);
const broadNotAllowed = new Set(['east africa','west africa','north africa','south africa','sub saharan africa','middle east']);

const rooms = new Map();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function code() { let c; do { c = Math.random().toString(36).slice(2,6).toUpperCase(); } while (rooms.has(c)); return c; }
function getRoom(roomCode) { return rooms.get(String(roomCode || '').trim().toUpperCase()); }
function player(room, id) { return room.players.get(id); }
function publicRoom(room) {
  return {
    code: room.code, status: room.status, hostId: room.hostId, letter: room.letter, usedLetters: room.usedLetters,
    rushBy: room.rushBy, rushRemaining: room.rushRemaining,
    players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, score:p.score, isHost:p.id===room.hostId })),
    round: room.round, results: room.results, challenges: room.challenges
  };
}
function emitRoom(room) { io.to(room.code).emit('room-state', publicRoom(room)); }
function startsWithLetter(answer, letter) { return norm(answer).startsWith(String(letter).toLowerCase()); }
function singular(x) { x=norm(x); if (x.endsWith('ies')) return x.slice(0,-3)+'y'; if (x.endsWith('es')) return x.slice(0,-2); if (x.endsWith('s') && x.length>3) return x.slice(0,-1); return x; }
function lev(a,b){ a=norm(a); b=norm(b); const dp=Array(b.length+1).fill(0).map((_,i)=>i); for(let i=1;i<=a.length;i++){ let prev=dp[0]; dp[0]=i; for(let j=1;j<=b.length;j++){ const tmp=dp[j]; dp[j]=Math.min(dp[j]+1, dp[j-1]+1, prev+(a[i-1]===b[j-1]?0:1)); prev=tmp; }} return dp[b.length]; }
function closeMatch(ans, set) { const a = norm(ans); if (!a || a.length < 3) return null; const first = a[0]; let best=null, bestD=3; for (const item of set) { if (!item.startsWith(first)) continue; if (Math.abs(item.length-a.length)>2) continue; const d=lev(a,item); if (d<bestD) { bestD=d; best=item; if(d<=1) break; } } return bestD<=2 ? best : null; }

function validate(category, raw, letter) {
  const answer = norm(raw);
  if (!answer) return { valid:false, canonical:'', typo:false, reason:'blank' };
  if (!startsWithLetter(answer, letter)) return { valid:false, canonical:answer, typo:false, reason:'wrong letter' };
  let set = names;
  if (category==='animal') set = animals;
  if (category==='place') set = places;
  if (category==='object') set = objects;
  if (category==='place') {
    if (broadNotAllowed.has(answer)) return { valid:false, canonical:answer, typo:false, reason:'too broad' };
    if ([...bannedPlaceWords].some(w => answer.includes(w))) return { valid:false, canonical:answer, typo:false, reason:'not geographical' };
  }
  const sing = singular(answer);
  if (set.has(answer)) return { valid:true, canonical:answer, typo:false, reason:'valid' };
  if (set.has(sing)) return { valid:true, canonical:sing, typo:false, reason:'plural accepted' };
  // object fallback: allow touchable noun phrases if first letter okay and not abstract/obviously non-object
  if (category==='object' && /^[a-z0-9]+( [a-z0-9]+){0,2}$/.test(answer)) return { valid:true, canonical:answer, typo:false, reason:'physical object fallback' };
  // place fallback: allow plausible city/region names 4+ chars unless banned
  if (category==='place' && answer.length>=4 && /^[a-z]+( [a-z]+){0,2}$/.test(answer)) return { valid:true, canonical:answer, typo:false, reason:'geodata fallback' };
  const cm = closeMatch(answer,set);
  if (cm) return { valid:true, canonical:cm, typo:true, reason:`typo of ${cm}` };
  return { valid:false, canonical:answer, typo:false, reason:'not in database' };
}

function scoreRound(room) {
  const cats = ['name','animal','place','object'];
  const canonicalCounts = {};
  const validations = {};
  for (const p of room.players.values()) {
    validations[p.id] = {};
    for (const c of cats) {
      const v = validate(c, p.answers[c] || '', room.letter);
      validations[p.id][c] = v;
      if (v.valid) canonicalCounts[`${c}:${v.canonical}`] = (canonicalCounts[`${c}:${v.canonical}`]||0)+1;
    }
  }
  room.results = [];
  for (const p of room.players.values()) {
    const row = { playerId:p.id, player:p.name, answers:{...p.answers}, scores:{}, validations:validations[p.id], total:0 };
    for (const c of cats) {
      const v = validations[p.id][c];
      let pts=0;
      if (v.valid) { pts = canonicalCounts[`${c}:${v.canonical}`] > 1 ? 5 : 10; if (v.typo) pts -= 1; }
      row.scores[c]=pts; row.total += pts;
    }
    p.score += row.total;
    room.results.push(row);
  }
  room.status = 'results';
}

io.on('connection', socket => {
  socket.on('create-room', ({name}, cb=()=>{}) => {
    const roomCode = code();
    const room = { code: roomCode, hostId: socket.id, players: new Map(), status:'lobby', letter:null, usedLetters:[], round:0, results:[], challenges:[], rushBy:null, rushRemaining:null, rushTimer:null };
    room.players.set(socket.id, { id:socket.id, name:title(name)||'Player', score:0, answers:{name:'',animal:'',place:'',object:''} });
    rooms.set(roomCode, room); socket.join(roomCode); socket.data.roomCode=roomCode;
    cb({ ok:true, roomCode }); emitRoom(room);
  });

  socket.on('join-room', ({roomCode,name}, cb=()=>{}) => {
    const codeNorm = String(roomCode||'').trim().toUpperCase(); const room = rooms.get(codeNorm);
    if (!room) return cb({ ok:false, error:'Room not found. Check the code and make sure you are using the same live URL.' });
    room.players.set(socket.id, { id:socket.id, name:title(name)||'Player', score:0, answers:{name:'',animal:'',place:'',object:''} });
    socket.join(codeNorm); socket.data.roomCode=codeNorm; cb({ ok:true, roomCode:codeNorm }); emitRoom(room);
  });

  socket.on('start-round', (cb=()=>{}) => {
    const room = getRoom(socket.data.roomCode); if (!room) return cb({ok:false,error:'Room not found'});
    if (room.hostId !== socket.id) return cb({ok:false,error:'Only host can start'});
    const available = alphabet.filter(l => !room.usedLetters.includes(l));
    if (!available.length) return cb({ok:false,error:'All letters used'});
    room.letter = available[Math.floor(Math.random()*available.length)]; room.usedLetters.push(room.letter); room.round++;
    room.status='playing'; room.results=[]; room.challenges=[]; room.rushBy=null; room.rushRemaining=null;
    if (room.rushTimer) clearInterval(room.rushTimer);
    for (const p of room.players.values()) p.answers = {name:'',animal:'',place:'',object:''};
    cb({ok:true}); emitRoom(room); io.to(room.code).emit('clear-inputs');
  });

  socket.on('save-answers', ({answers}) => {
    const room = getRoom(socket.data.roomCode); if (!room || room.status!=='playing') return;
    const p = player(room, socket.id); if (!p) return;
    p.answers = { name:String(answers?.name||''), animal:String(answers?.animal||''), place:String(answers?.place||''), object:String(answers?.object||'') };
    emitRoom(room);
  });

  socket.on('rush', () => {
    const room = getRoom(socket.data.roomCode); if (!room || room.status!=='playing' || room.rushTimer) return;
    const p=player(room,socket.id); if(!p) return;
    const filled = ['name','animal','place','object'].every(c => norm(p.answers[c]||'')); if(!filled) return;
    room.rushBy=p.name; room.rushRemaining=5; io.to(room.code).emit('rush-started', {by:p.name, remaining:5}); emitRoom(room);
    room.rushTimer=setInterval(()=>{ room.rushRemaining--; io.to(room.code).emit('rush-tick',{by:p.name,remaining:room.rushRemaining}); if(room.rushRemaining<=0){ clearInterval(room.rushTimer); room.rushTimer=null; scoreRound(room); io.to(room.code).emit('round-locked'); emitRoom(room); } },1000);
  });

  socket.on('manual-score', () => { const room=getRoom(socket.data.roomCode); if(!room||room.hostId!==socket.id||room.status!=='playing') return; if(room.rushTimer) clearInterval(room.rushTimer); scoreRound(room); emitRoom(room); });

  socket.on('challenge-answer', ({playerId, category}, cb=()=>{}) => {
    const room=getRoom(socket.data.roomCode); if(!room || room.status!=='results') return cb({ok:false,error:'No results to challenge'});
    // User can ONLY challenge their OWN answer.
    if (socket.id !== playerId) return cb({ok:false,error:'You can only challenge your own answer'});
    const row=room.results.find(r=>r.playerId===playerId); if(!row) return cb({ok:false,error:'Answer not found'});
    const ch={ id:Date.now().toString(36)+Math.random().toString(36).slice(2,6), challengerId:socket.id, challengerName:player(room,socket.id)?.name||'Player', playerId, playerName:row.player, category, answer:row.answers[category]||'', votes:{}, open:true };
    room.challenges.push(ch); cb({ok:true}); io.to(room.code).emit('challenge-popup', ch); emitRoom(room);
  });

  socket.on('vote-challenge', ({challengeId, vote}, cb=()=>{}) => {
    const room=getRoom(socket.data.roomCode); if(!room) return cb({ok:false,error:'Room not found'});
    const ch=room.challenges.find(c=>c.id===challengeId && c.open); if(!ch) return cb({ok:false,error:'Challenge closed'});
    if (ch.challengerId === socket.id) return cb({ok:false,error:'You cannot vote on your own challenge'});
    ch.votes[socket.id] = vote === 'valid' ? 'valid' : 'invalid';
    const eligible = room.players.size - 1; const count=Object.keys(ch.votes).length;
    if (eligible <= 0 || count >= eligible) ch.open=false;
    cb({ok:true}); emitRoom(room);
  });

  socket.on('end-game', () => { const room=getRoom(socket.data.roomCode); if(!room||room.hostId!==socket.id) return; room.status='ended'; emitRoom(room); });
  socket.on('disconnect', () => { const room=getRoom(socket.data.roomCode); if(!room) return; room.players.delete(socket.id); if(room.hostId===socket.id) room.hostId=[...room.players.keys()][0]||null; if(room.players.size===0) { if(room.rushTimer) clearInterval(room.rushTimer); rooms.delete(room.code); } else emitRoom(room); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Category Rush running on port ${PORT}`));
