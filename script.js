const socket = io();
let myId = null, room = null, joined = false;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const answers = () => Object.fromEntries($$('.answer').map(i => [i.dataset.cat, i.value]));
function toast(msg){ const d=document.createElement('div'); d.className='toast'; d.textContent=msg; $('#toast').appendChild(d); setTimeout(()=>d.remove(),3500); }
function showModal(title, body, buttons){ $('#modalTitle').textContent=title; $('#modalBody').innerHTML=body; const box=$('#modalButtons'); box.innerHTML=''; buttons.forEach(b=>{ const btn=document.createElement('button'); btn.textContent=b.text; btn.className=b.class||''; btn.disabled=!!b.disabled; btn.onclick=()=>{ if(b.close!==false) $('#modal').classList.add('hidden'); b.onClick?.(); }; box.appendChild(btn); }); $('#modal').classList.remove('hidden'); }
function title(s){return String(s||'').trim().replace(/\b\w/g,c=>c.toUpperCase())}

socket.on('connect',()=>{ myId=socket.id; $('#connection').textContent='Online'; });
socket.on('disconnect',()=> $('#connection').textContent='Disconnected');

$('#createBtn').onclick=()=>{ socket.emit('create-room',{name:$('#nameInput').value},res=>{ if(!res.ok) return toast(res.error); joined=true; $('#joinScreen').classList.add('hidden'); $('#gameScreen').classList.remove('hidden'); toast('Room created'); }); };
$('#joinBtn').onclick=()=>{ socket.emit('join-room',{roomCode:$('#roomInput').value,name:$('#nameInput').value},res=>{ if(!res.ok) return toast(res.error); joined=true; $('#joinScreen').classList.add('hidden'); $('#gameScreen').classList.remove('hidden'); toast('Joined room'); }); };
$('#startBtn').onclick=()=> socket.emit('start-round',res=>{ if(res && !res.ok) toast(res.error); });
$('#scoreBtn').onclick=()=> socket.emit('manual-score');
$('#endBtn').onclick=()=> socket.emit('end-game');
$('#rushBtn').onclick=()=> { socket.emit('save-answers',{answers:answers()}); setTimeout(()=>socket.emit('rush'),80); };
$$('.answer').forEach(i=> i.addEventListener('input',()=>{ if(room?.status==='playing') socket.emit('save-answers',{answers:answers()}); }));
socket.on('clear-inputs',()=> $$('.answer').forEach(i=>i.value=''));
socket.on('round-locked',()=> toast('Answers locked'));
socket.on('rush-started',d=>{ $('#rushBanner').classList.remove('hidden'); $('#rushBanner').textContent=`🚨 ${d.by} started RUSH — ${d.remaining}`; });
socket.on('rush-tick',d=>{ $('#rushBanner').classList.remove('hidden'); $('#rushBanner').textContent=`🚨 ${d.by} started RUSH — ${d.remaining}`; });

socket.on('challenge-popup', ch=>{
  toast(`${ch.challengerName} challenged their ${ch.category} answer`);
  const isChallenger = ch.challengerId === myId;
  showModal('⚠️ Challenge', `<b>${ch.challengerName}</b> challenged their own answer:<br><br><b>${title(ch.category)}:</b> ${ch.answer || '(blank)'}`, [
    {text:'Count It', disabled:isChallenger, onClick:()=>socket.emit('vote-challenge',{challengeId:ch.id,vote:'valid'},r=>{ if(r&&!r.ok) toast(r.error); })},
    {text:'Reject', class:'danger', disabled:isChallenger, onClick:()=>socket.emit('vote-challenge',{challengeId:ch.id,vote:'invalid'},r=>{ if(r&&!r.ok) toast(r.error); })},
    ...(isChallenger ? [{text:'You cannot vote on your own challenge', disabled:true}] : [])
  ]);
});

socket.on('room-state', state=>{ room=state; render(); });
function render(){ if(!room) return; $('#roomCode').textContent=room.code; $('#letter').textContent=room.letter||'-'; $('#roundNo').textContent=room.round||0; $('#usedLetters').textContent=room.usedLetters?.join(', ')||'None';
  const isHost=room.hostId===myId; $('#startBtn').style.display=isHost?'block':'none'; $('#scoreBtn').style.display=isHost&&room.status==='playing'?'block':'none'; $('#endBtn').style.display=isHost?'block':'none';
  $('#startBtn').textContent = room.round>0 ? 'New Letter' : 'Start Round';
  $$('.answer').forEach(i=> i.disabled = room.status !== 'playing'); $('#rushBtn').disabled = room.status !== 'playing';
  if(room.status!=='playing') $('#rushBanner').classList.add('hidden');
  $('#players').innerHTML = room.players.map(p=>`<div class="player">${p.isHost?'👑 ':''}${p.name}</div>`).join('');
  $('#leaderboard').innerHTML = [...room.players].sort((a,b)=>b.score-a.score).map(p=>`<li><b>${p.name}</b> — ${p.score}</li>`).join('');
  renderResults(); renderChallenges(); }
function renderResults(){ const panel=$('#resultsPanel'); if(!room.results?.length){ panel.classList.add('hidden'); return; } panel.classList.remove('hidden'); $('#results').innerHTML=room.results.map(r=>{ const mine = r.playerId===myId; const cats=['name','animal','place','object']; return `<div class="result-card"><h3>${r.player} — +${r.total}</h3><div class="result-grid">${cats.map(c=>{const v=r.validations[c]; const cls=!v.valid?'invalid':v.typo?'typo':'valid'; return `<div class="chip"><b>${title(c)}</b><br>${r.answers[c]||'—'}<br><span class="${cls}">${v.valid?(v.typo?'Typo':'Valid'):'Invalid'} • ${r.scores[c]}</span><br>${mine?`<button onclick="challenge('${r.playerId}','${c}')">Challenge my answer</button>`:''}</div>`}).join('')}</div></div>`; }).join(''); }
window.challenge=(playerId,category)=> socket.emit('challenge-answer',{playerId,category},r=>{ if(r&&!r.ok) toast(r.error); });
function renderChallenges(){ const panel=$('#challengesPanel'); if(!room.challenges?.length){ panel.classList.add('hidden'); return; } panel.classList.remove('hidden'); $('#challenges').innerHTML=room.challenges.map(ch=>{ const isChallenger=ch.challengerId===myId; const yes=Object.values(ch.votes||{}).filter(v=>v==='valid').length; const no=Object.values(ch.votes||{}).filter(v=>v==='invalid').length; return `<div class="challenge"><b>${ch.challengerName}</b> challenged ${title(ch.category)}: <b>${ch.answer||'blank'}</b><br>Votes: Count ${yes} / Reject ${no} ${ch.open?'': ' • closed'}<div class="vote-row"><button ${isChallenger||!ch.open?'disabled':''} onclick="vote('${ch.id}','valid')">Count It</button><button class="danger" ${isChallenger||!ch.open?'disabled':''} onclick="vote('${ch.id}','invalid')">Reject</button></div>${isChallenger?'<p class="hint">You cannot vote on your own challenge.</p>':''}</div>` }).join(''); }
window.vote=(id,vote)=> socket.emit('vote-challenge',{challengeId:id,vote},r=>{ if(r&&!r.ok) toast(r.error); });
