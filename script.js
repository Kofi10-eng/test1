const socket = io();
let state = null;
let myId = null;
const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const toast = (m) => { const t=$('#toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); };

socket.on('connect', () => { myId = socket.id; });
socket.on('room-state', (s) => { state = s; render(); });

$('#createBtn').onclick = () => {
  socket.emit('create-room', $('#playerName').value, (res) => {
    if (!res.ok) return toast(res.error);
    $('#joinScreen').classList.add('hidden'); $('#gameScreen').classList.remove('hidden');
  });
};
$('#joinBtn').onclick = () => {
  socket.emit('join-room', { name: $('#playerName').value, code: $('#roomInput').value }, (res) => {
    if (!res.ok) return toast(res.error);
    $('#joinScreen').classList.add('hidden'); $('#gameScreen').classList.remove('hidden');
  });
};
$('#copyBtn').onclick = async () => { if(state?.code){ await navigator.clipboard?.writeText(state.code); toast('Room code copied'); }};
$('#startBtn').onclick = () => socket.emit('start-round', (r)=>{ if(!r.ok) toast(r.error); });
$('#rushBtn').onclick = () => socket.emit('rush');
$('#endRoundBtn').onclick = () => socket.emit('end-round');
$('#endGameBtn').onclick = () => socket.emit('end-game');
$$('input[data-cat]').forEach(inp => inp.addEventListener('input', () => socket.emit('answer', { category: inp.dataset.cat, value: inp.value })));

function me(){ return state?.players?.find(p=>p.id===myId); }
function render(){
  if(!state) return;
  $('#roomCode').textContent = state.code;
  $('#letter').textContent = state.letter || '?';
  $('#usedLetters').textContent = 'Used: ' + (state.usedLetters?.length ? state.usedLetters.join(', ') : 'none');
  $('#status').textContent = state.status === 'playing' ? 'Round active — fill all 4 categories.' : state.status === 'scored' ? 'Round complete. Challenge your own answers if needed.' : state.status === 'ended' ? 'Game ended. Final table below.' : 'Start when everyone has joined.';
  const isHost = state.hostId === myId;
  $('#startBtn').style.display = isHost ? '' : 'none';
  $('#endGameBtn').style.display = isHost ? '' : 'none';
  $('#endRoundBtn').style.display = isHost && state.status==='playing' ? '' : 'none';
  $('#rushBtn').disabled = state.status !== 'playing';
  $$('input[data-cat]').forEach(i => i.disabled = state.status !== 'playing');
  $('#rushBanner').classList.toggle('hidden', !state.rushBy);
  if(state.rushBy) $('#rushBanner').textContent = `🚨 ${state.rushBy} started RUSH! Locking in ${state.rushRemaining ?? 0}...`;
  $('#players').innerHTML = state.players.map(p=>`<div class="player"><b>${escapeHtml(p.name)}</b><span>${p.id===state.hostId?'Host':''}</span></div>`).join('');
  $('#leaderboard').innerHTML = [...state.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="lead"><b>${i+1}. ${escapeHtml(p.name)}</b><span>${p.score}</span></div>`).join('');
  renderResults();
  renderChallengeModal();
}
function renderResults(){
  const wrap = $('#results');
  if(!state.results?.length){ wrap.innerHTML=''; return; }
  wrap.innerHTML = state.results.map(row => `
    <div class="resultPlayer">
      <div class="resultHead"><span>${escapeHtml(row.playerName)}</span><span>${row.total} pts</span></div>
      <div class="cells">${['name','animal','place','object'].map(cat=>cell(row,cat)).join('')}</div>
    </div>`).join('');
  $$('.challenge').forEach(btn => btn.onclick = () => {
    socket.emit('challenge', { targetPlayerId: btn.dataset.player, category: btn.dataset.cat }, (res)=>{ if(!res.ok) toast(res.error); else toast('Challenge sent'); });
  });
}
function cell(row, cat){
  const c = row.cells[cat];
  const mine = row.playerId === myId;
  return `<div class="cell"><h4>${cat.toUpperCase()}</h4><div class="ans">${escapeHtml(c.answer || '—')}</div><p class="${c.ok?'good':'bad'}">${escapeHtml(c.reason)} • ${c.points||0} pts</p><button class="challenge" data-player="${row.playerId}" data-cat="${cat}" ${mine?'':'disabled'} title="You can only challenge your own answer">Challenge</button></div>`;
}
function renderChallengeModal(){
  const active = (state.challenges||[]).find(c=>!c.resolved);
  const modal = $('#challengeModal');
  if(!active){ modal.classList.add('hidden'); modal.innerHTML=''; return; }
  const isCreator = active.challengerId === myId;
  modal.classList.remove('hidden');
  modal.innerHTML = `<div class="modalBox"><h2>⚠️ Challenge</h2><p><b>${escapeHtml(active.challengerName)}</b> challenged their own answer.</p><p><b>${active.category.toUpperCase()}:</b> ${escapeHtml(active.answer || '—')}</p>${isCreator?'<p class="disabledNote">You started this challenge, so you cannot vote.</p>':`<div class="voteBtns"><button class="primary" id="countVote">Count it</button><button class="danger" id="rejectVote">Reject</button></div>`}<p>Votes: ${Object.values(active.votes||{}).filter(v=>v==='count').length} count / ${Object.values(active.votes||{}).filter(v=>v==='reject').length} reject</p></div>`;
  if(!isCreator){ $('#countVote').onclick=()=>socket.emit('challenge-vote',{challengeId:active.id,vote:'count'}, r=>{if(!r.ok)toast(r.error)}); $('#rejectVote').onclick=()=>socket.emit('challenge-vote',{challengeId:active.id,vote:'reject'}, r=>{if(!r.ok)toast(r.error)}); }
}
function escapeHtml(s){ return String(s??'').replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
