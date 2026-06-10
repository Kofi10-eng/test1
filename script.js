const socket = io();
let state=null, myId=null, activeChallenge=null;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function nameVal(){ return $('#nameInput').value.trim() || 'Player'; }
function showError(msg){ $('#joinError').textContent = msg || ''; }
function toast(msg){ const n=$('#notice'); n.textContent=msg; n.classList.remove('hidden'); setTimeout(()=>n.classList.add('hidden'),3500); }

$('#createBtn').onclick = () => socket.emit('create-room', {name:nameVal()}, res => {
  if(!res.ok) return showError(res.error); myId=res.playerId; $('#joinView').classList.add('hidden'); $('#gameView').classList.remove('hidden');
});
$('#joinBtn').onclick = () => socket.emit('join-room', {name:nameVal(), code:$('#roomInput').value}, res => {
  if(!res.ok) return showError(res.error); myId=res.playerId; $('#joinView').classList.add('hidden'); $('#gameView').classList.remove('hidden');
});
$('#startBtn').onclick = () => socket.emit('start-round', res => { if(!res.ok) toast(res.error); });
$('#rushBtn').onclick = () => socket.emit('rush', res => { if(!res.ok) toast(res.error); });
$('#endBtn').onclick = () => socket.emit('end-game');
$$('input[data-cat]').forEach(inp => inp.addEventListener('input', () => socket.emit('answer-update', {category:inp.dataset.cat, value:inp.value})));
$('#closeModal').onclick = () => $('#modal').classList.add('hidden');
$('#voteValid').onclick = () => vote('valid'); $('#voteInvalid').onclick = () => vote('invalid');
function vote(v){ if(!activeChallenge) return; socket.emit('vote-challenge', {challengeId:activeChallenge.id, vote:v}, res=>{ if(!res.ok) toast(res.error); else $('#modal').classList.add('hidden'); }); }

socket.on('room-state', r => { state=r; render(); });
socket.on('rush-started', rush => showRush(rush));
socket.on('challenge-popup', ch => showChallenge(ch));

function render(){ if(!state) return;
  $('#roomCode').textContent=state.code; $('#letterBox').textContent=state.letter || '?';
  $('#startBtn').disabled = state.hostId !== myId || state.status === 'playing';
  $('#endBtn').disabled = state.hostId !== myId;
  $('#rushBtn').disabled = state.status !== 'playing';
  const locked = state.status !== 'playing';
  $$('input[data-cat]').forEach(inp=> inp.disabled = locked);
  $('#statusText').textContent = statusText();
  renderPlayers(); renderLeaderboard(); renderUsed(); renderResults();
}
function statusText(){
  if(state.status==='lobby') return 'Waiting for the host to start the first round.';
  if(state.status==='playing') return `Round active. Fill all categories beginning with ${state.letter}.`;
  if(state.status==='results') return 'Round complete. Check scores, challenge answers, or start the next round.';
  if(state.status==='ended') return 'Game ended. Final table is below.';
  return 'Ready.';
}
function renderPlayers(){
  $('#players').innerHTML = Object.values(state.players).map(p=>`<div class="player"><span>${esc(p.name)} ${p.id===state.hostId?'👑':''}</span><b>${p.connected?'🟢':'⚪'}</b></div>`).join('');
}
function renderLeaderboard(){
  const rows=Object.values(state.players).sort((a,b)=>(state.scores[b.id]||0)-(state.scores[a.id]||0));
  $('#leaderboard').innerHTML = rows.map((p,i)=>`<div class="scoreRow"><span>${i+1}. ${esc(p.name)}</span><b>${state.scores[p.id]||0}</b></div>`).join('');
}
function renderUsed(){ $('#usedLetters').innerHTML = (state.usedLetters||[]).map(l=>`<span class="chip">${l}</span>`).join('') || '<span class="chip">None</span>'; }
function renderResults(){
  const box=$('#results'); if(!state.results){ box.innerHTML=''; return; }
  const players=Object.values(state.players).sort((a,b)=>(state.scores[b.id]||0)-(state.scores[a.id]||0));
  box.innerHTML = `${state.status==='ended'?'<div class="finalTitle">🏆 Final Results</div>':''}` + players.map(p=>{
    const res=state.results[p.id]||{};
    return `<div class="resultCard"><h3>${esc(p.name)} — ${state.scores[p.id]||0} pts</h3><div class="resultGrid">${['name','animal','place','object'].map(cat=>cell(p,cat,res[cat])).join('')}</div></div>`;
  }).join('');
}
function cell(p,cat,r={}){
  const cls = r.valid ? (r.typo?'typo':'valid') : 'invalid';
  const canChallenge = p.id !== myId;
  return `<div class="cell"><b>${cap(cat)}</b><p>${esc(r.answer||'—')}</p><p class="${cls}">${r.reason||'No answer'} • ${r.points||0} pts</p><button class="challengeBtn" ${canChallenge?'':'disabled'} onclick="challenge('${p.id}','${cat}')">Challenge</button></div>`;
}
window.challenge = (targetId, category) => socket.emit('challenge-answer', {targetId, category}, res=>{ if(!res.ok) toast(res.error); });
function showChallenge(ch){
  activeChallenge=ch; $('#modalText').innerHTML = `<b>${esc(ch.challengerName)}</b> challenged <b>${esc(ch.targetName)}</b>'s <b>${cap(ch.category)}</b> answer:<br><br><span class="chip">${esc(ch.answer||'blank')}</span>`;
  const cannot = myId===ch.challengerId || myId===ch.targetId;
  $('#voteValid').disabled = cannot; $('#voteInvalid').disabled = cannot;
  $('#modalHint').textContent = cannot ? 'You cannot vote because this is your challenge or your answer.' : 'Vote whether this answer should count.';
  $('#modal').classList.remove('hidden');
}
function showRush(rush){
  $('#rushName').textContent = rush.byName || 'Someone'; $('#rushBanner').classList.remove('hidden');
  const tick=()=>{ const left=Math.max(0, Math.ceil((rush.endsAt-Date.now())/1000)); $('#rushCount').textContent=left; if(left<=0) $('#rushBanner').classList.add('hidden'); else setTimeout(tick,250); }; tick();
}
function esc(s=''){return String(s).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}
function cap(s){return s[0].toUpperCase()+s.slice(1);}
