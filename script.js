const socket = io();
let state = null;
let myId = null;
let currentCode = null;
let saveTimer = null;

const $ = id => document.getElementById(id);
const inputs = { name: $('ansName'), animal: $('ansAnimal'), place: $('ansPlace'), object: $('ansObject') };
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),2500); }
function val(id){ return $(id).value.trim(); }
function answers(){ return { name: inputs.name.value, animal: inputs.animal.value, place: inputs.place.value, object: inputs.object.value }; }
function clearAnswers(){ Object.values(inputs).forEach(i => { i.value=''; i.disabled=false; }); }
function emitAnswers(){ if(!currentCode || !state || state.status !== 'active') return; socket.emit('answer-update', { code: currentCode, answers: answers() }); }
Object.values(inputs).forEach(i => i.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer=setTimeout(emitAnswers,180); }));

$('createBtn').onclick = () => {
  socket.emit('create-room', { name: val('nameInput') || 'Player' }, res => {
    if(!res.ok) return $('loginMsg').textContent = res.error || 'Could not create room';
    myId = res.playerId; currentCode = res.code; $('login').classList.add('hidden'); $('game').classList.remove('hidden');
  });
};
$('joinBtn').onclick = () => {
  socket.emit('join-room', { code: val('roomInput'), name: val('nameInput') || 'Player' }, res => {
    if(!res.ok) return $('loginMsg').textContent = res.error || 'Room not found';
    myId = res.playerId; currentCode = res.code; $('login').classList.add('hidden'); $('game').classList.remove('hidden');
  });
};
$('startBtn').onclick = () => socket.emit('start-round', { code: currentCode }, res => { if(!res.ok) toast(res.error || 'Could not start'); });
$('rushBtn').onclick = () => { emitAnswers(); socket.emit('rush', { code: currentCode }, res => { if(!res.ok) toast(res.error || 'Rush failed'); }); };
$('endBtn').onclick = () => socket.emit('end-game', { code: currentCode }, res => { if(!res.ok) toast(res.error || 'Could not end game'); });

socket.on('room-state', room => { state = room; currentCode = room.code; render(); });
socket.on('rush-started', rush => toast(`${rush.byName} started RUSH!`));
socket.on('challenge-popup', ch => showChallenge(ch));

function render(){ if(!state) return; const me = state.players.find(p=>p.id===myId); $('roomCode').textContent = state.code; $('letter').textContent = state.letter || '?'; $('usedLetters').textContent = state.usedLetters?.length ? state.usedLetters.join(', ') : 'none';
  $('players').innerHTML = state.players.map(p=>`<div class="player"><span><i class="dot"></i>${p.name}${p.id===state.hostId?' 👑':''}${p.id===myId?' (you)':''}</span><b>${p.score}</b></div>`).join('');
  const leaders=[...state.players].sort((a,b)=>b.score-a.score); $('leaderboard').innerHTML = leaders.map((p,i)=>`<div class="leader"><span>${i+1}. ${p.name}</span><b>${p.score}</b></div>`).join('');
  const active = state.status === 'active'; const results = state.status === 'results'; const ended = state.status === 'ended';
  $('startBtn').style.display = active ? 'none' : '';
  $('startBtn').textContent = results ? 'New Letter' : (ended ? 'Game Ended' : 'Start Round');
  $('startBtn').disabled = state.hostId !== myId || ended;
  $('rushBtn').style.display = active ? '' : 'none';
  $('endBtn').disabled = state.hostId !== myId || ended;
  Object.values(inputs).forEach(i => i.disabled = !active);
  if(active) $('status').textContent = `Round active. Letter ${state.letter}. Fill all 4 categories.`;
  else if(results) $('status').textContent = 'Round complete. Review scores, challenge your own answers, or start a new letter.';
  else if(ended) $('status').textContent = 'Game ended. Final table below.';
  else $('status').textContent = 'Start when everyone has joined.';
  renderRush(); renderResults();
}
function renderRush(){ const box=$('rushBanner'); if(!state?.rush || state.status !== 'active') return box.classList.add('hidden'); box.classList.remove('hidden'); const tick=()=>{ if(!state?.rush) return; const sec=Math.max(0, Math.ceil((state.rush.endsAt-Date.now())/1000)); box.textContent=`${state.rush.byName} started RUSH! ${sec}`; if(sec>0) requestAnimationFrame(tick); }; tick(); }
function renderResults(){ const wrap=$('results'); if(!state || !['results','ended'].includes(state.status)){ wrap.innerHTML=''; return; }
  wrap.innerHTML = `<h2>${state.status==='ended'?'Final Table':'Round Results'}</h2>` + (state.results||[]).map(r=>`
    <div class="result-player"><h3>${r.playerName} — ${r.total} pts</h3><div class="result-grid">
    ${['name','animal','place','object'].map(cat=>{ const row=r.rows[cat]; const own=r.playerId===myId; return `<div class="result-card"><h4>${cat[0].toUpperCase()+cat.slice(1)}</h4><div class="answer">${row.raw || '—'}</div><p class="${row.valid?'ok':'bad'}">${row.reason} • ${row.points} pts</p>${own?`<button class="challenge" onclick="challenge('${r.playerId}','${cat}')">Challenge</button>`:''}</div>`; }).join('')}
    </div></div>`).join('');
}
window.challenge = (targetId, category) => socket.emit('challenge', { code: currentCode, targetId, category }, res => { if(!res.ok) toast(res.error || 'Challenge failed'); });
function showChallenge(ch){ const modal=$('challengeModal'); const ownChallenge = ch.challengerId === myId; modal.innerHTML = `<div class="modal-card"><h2>⚠️ Challenge</h2><p><b>${ch.challengerName}</b> challenged their own answer.</p><p><b>Category:</b> ${ch.category}</p><p><b>Answer:</b> ${ch.answer || 'blank'}</p><p class="small">The challenger cannot vote. Everyone else can vote.</p><div class="vote-row"><button class="primary" ${ownChallenge?'disabled':''} onclick="vote('${ch.id}','count')">Count It</button><button class="danger" ${ownChallenge?'disabled':''} onclick="vote('${ch.id}','reject')">Reject</button></div><button class="secondary" style="width:100%;margin-top:12px" onclick="closeChallenge()">Close</button></div>`; modal.classList.remove('hidden'); }
window.closeChallenge = () => $('challengeModal').classList.add('hidden');
window.vote = (id, vote) => socket.emit('vote', { code: currentCode, challengeId:id, vote }, res => { if(!res.ok) return toast(res.error || 'Vote failed'); toast('Vote counted'); closeChallenge(); });
