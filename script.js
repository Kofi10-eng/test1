const socket = io();
let room = null, me = null;
const $ = id => document.getElementById(id);
const show = id => { document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); $(id).classList.add('active'); };
function getName(){ return $('name').value.trim() || 'Player'; }
$('create').onclick = () => socket.emit('room:create', { name:getName() }, res => { if(!res.ok) return $('homeMsg').textContent=res.error; me=res.playerId; show('game'); });
$('join').onclick = () => socket.emit('room:join', { name:getName(), code:$('code').value.trim().toUpperCase() }, res => { if(!res.ok) return $('homeMsg').textContent=res.error; me=res.playerId; show('game'); });
$('copy').onclick = () => navigator.clipboard?.writeText(room?.code || '');
$('start').onclick = () => socket.emit('round:start', {}, res => { if(res && !res.ok) alert(res.error); });
$('end').onclick = () => socket.emit('game:end');
$('rush').onclick = () => socket.emit('rush');
document.querySelectorAll('.ans').forEach(inp => inp.addEventListener('input', () => { const answers={}; document.querySelectorAll('.ans').forEach(i=>answers[i.dataset.cat]=i.value); socket.emit('answers:update', answers); }));
$('voteCount').onclick = () => socket.emit('challenge:vote', { vote:'count' });
$('voteReject').onclick = () => socket.emit('challenge:vote', { vote:'reject' });
$('closeModal').onclick = () => $('modal').classList.add('hidden');

socket.on('room:update', r => { room = r; render(); });
function render(){
  if(!room) return;
  show('game'); $('roomCode').textContent=room.code; $('letter').textContent=room.letter||'?'; $('used').textContent=room.usedLetters?.length?room.usedLetters.join(', '):'none';
  $('status').textContent = room.status==='playing'?'Round in progress': room.status==='results'?'Results ready': room.status==='ended'?'Game ended':'Start when everyone has joined';
  $('countdown').textContent = room.countdown ? room.countdown : '';
  document.querySelectorAll('.ans').forEach(i=>i.disabled = room.status!=='playing');
  $('players').innerHTML = [...room.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="player">${i+1}. <b>${p.name}</b> — ${p.score} pts ${p.id===room.hostId?'👑':''}</div>`).join('');
  const rows=[];
  if(room.results){ for(const res of room.results){ rows.push(`<div class="result"><h3>${res.name}: +${res.total} pts</h3>${Object.entries(res.rows).map(([cat,row])=>`<div class="answerRow"><small>${cat.toUpperCase()}</small><br><b>${row.answer||'—'}</b><br>${row.reason} · ${row.points} pts<br><button onclick="challenge('${res.playerId}','${cat}')">Challenge / vote</button></div>`).join('')}</div>`); } }
  if(room.final){ rows.push(`<h2>🏆 Final Leaderboard</h2>${room.final.map((p,i)=>`<div class="player">${i+1}. <b>${p.name}</b> — ${p.score} pts</div>`).join('')}`); }
  $('results').innerHTML = rows.join('') || '<p>No results yet.</p>';
  if(room.challenge){ const votes=Object.values(room.challenge.votes||{}); $('challengeText').innerHTML = `Answer <b>${room.challenge.answer}</b> was challenged.<br>Count: ${votes.filter(v=>v==='count').length} · Reject: ${votes.filter(v=>v==='reject').length}`; $('modal').classList.remove('hidden'); }
}
window.challenge = (playerId, category) => socket.emit('challenge:create', { playerId, category });
