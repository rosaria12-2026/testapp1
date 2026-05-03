// PCE 针灸答题器 — app.js v3
// Features: batch question list, AI chat, selective PDF, weighted mock, pauseable timer

// ── DB ──────────────────────────────────────────────────
var DBKEY = 'pce_db_v4';
var DB = (function(){
  try { return JSON.parse(localStorage.getItem(DBKEY)) || makeDB(); }
  catch(e) { return makeDB(); }
})();
function makeDB() {
  return { batches:[], wrongMap:{}, dkMap:{}, stats:{done:0, correct:0}, analysisCache:{} };
}
function saveDB() {
  try { localStorage.setItem(DBKEY, JSON.stringify(DB)); } catch(e) {}
}
if (!DB.analysisCache) DB.analysisCache = {};

function getApiKey() { return localStorage.getItem('claude_api_key') || ''; }
function saveApiKey() {
  var inp = document.getElementById('api-key-input');
  var st  = document.getElementById('api-key-status');
  if (!inp) return;
  var k = inp.value.trim();
  if (!k) { if(st) st.textContent = '请输入 Key'; return; }
  localStorage.setItem('claude_api_key', k);
  if(st) st.textContent = '✓ 已保存';
  showToast('✓ Claude API Key 已保存');
}
function initApiKeyInput() {
  var inp = document.getElementById('api-key-input');
  if (!inp) return;
  var saved = getApiKey();
  if (saved) inp.value = saved;
  var st = document.getElementById('api-key-status');
  if (saved && st) st.textContent = '✓ Key 已加载';
  inp.addEventListener('input', function(){
    clearTimeout(inp._t);
    inp._t = setTimeout(function(){
      var k = inp.value.trim();
      if (k.length > 10) {
        localStorage.setItem('claude_api_key', k);
        if (st) st.textContent = '✓ 已自动保存';
      }
    }, 800);
  });
}

// ── NAVIGATION ──────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var pg = document.getElementById(name);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  var tab = document.querySelector('.tab[data-page="'+name+'"]');
  if (tab) tab.classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){ showPage(t.dataset.page); });
});

// ── TOAST ────────────────────────────────────────────────
function showToast(msg, dur) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg; el.className = 'show';
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.className = ''; }, dur || 2500);
}

// ── FILE UPLOAD ──────────────────────────────────────────
var fi = document.getElementById('file-input');
if (fi) {
  fi.addEventListener('change', function(e){
    var file = e.target.files[0]; if (!file) return;
    var r = new FileReader();
    r.onload = function(ev){
      document.getElementById('raw').value = ev.target.result;
      document.getElementById('upload-status').textContent = '✓ ' + file.name;
    };
    r.readAsText(file, 'utf-8');
  });
}

// ── PARSER ───────────────────────────────────────────────
function parseQ(raw) {
  raw = raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0)-65248); })
    .replace(/）/g,')').replace(/（/g,'(').replace(/。/g,'.').replace(/　/g,' ');
  var lines = raw.split('\n').map(function(l){ return l.trim(); });
  var qRe   = /^[(\[]?\s*(\d{1,4})\s*[).、]\s*(.+)/;
  var optRe = /^([A-Ea-e])\s*[).、]\s*(.+)/;
  var inRe  = /([A-Ea-e])\s*[).]\s*(.+?)(?=\s{2,}[A-Ea-e]\s*[).]|$)/g;
  var ansRe = /[\u3010\[]?[\u7b54\u6848Aa][\u6848nswer]*[\uff1a:]\s*([A-Ea-e])[\u3011\]]?/i;
  var caseRe= /\u6839\u636e\u4ee5\u4e0b|\u6839\u636e\u4e0b\u5217|\u4ee5\u4e0b\u75c5\u4f8b|following case|following scenario/i;
  function isCN(q){ return /[\u4e00-\u9fff]/.test(q.body); }
  var blocks=[], curQ=null, pendingCase=null;
  function push(){
    if (curQ && curQ.opts.length>=2 && isCN(curQ)){
      if (pendingCase && !curQ.caseText) curQ.caseText = pendingCase;
      blocks.push(curQ);
    }
  }
  for (var i=0; i<lines.length; i++){
    var l = lines[i]; if (!l) continue;
    if (/^\u8bf7\u4e3a|^please select/i.test(l) && l.length<60) continue;
    if (caseRe.test(l) && !l.match(qRe)){
      var cl=[l], j=i+1;
      while(j<lines.length && lines[j] && !lines[j].match(qRe)){ cl.push(lines[j]); j++; }
      pendingCase=cl.join('\n'); i=j-1; continue;
    }
    var am=l.match(ansRe);
    if (am && curQ){ curQ.answer=am[1].toUpperCase(); continue; }
    var qm=l.match(qRe);
    if (qm){ push(); curQ={num:parseInt(qm[1]),body:qm[2].trim(),opts:[],answer:null,id:uid(),caseText:null}; continue; }
    if (!curQ) continue;
    var om=l.match(optRe);
    if (om){ curQ.opts.push({letter:om[1].toUpperCase(),text:om[2].trim()}); continue; }
    if (/[A-Ea-e]\s*[).]/.test(l)){
      var found=[],m; inRe.lastIndex=0;
      while((m=inRe.exec(l))!==null) found.push({letter:m[1].toUpperCase(),text:m[2].trim()});
      if (found.length>=2){ curQ.opts.push.apply(curQ.opts,found); continue; }
    }
    if (curQ.opts.length>=2){
      if (/^[\u4e00-\u9fff]/.test(l)) continue;
      if (l.length<80) continue;
    } else if (curQ.opts.length===0){ curQ.body+='\n'+l; }
    else { curQ.opts[curQ.opts.length-1].text+=' '+l; }
  }
  push();
  blocks.forEach(function(q){
    if (!q.caseText) return;
    var rm=q.caseText.match(/(\d{1,4})\s*[-\u2013~]\s*(\d{1,4})/);
    if (rm) q._cr={lo:parseInt(rm[1]),hi:parseInt(rm[2])};
  });
  var actCase=null, actRange=null;
  blocks.forEach(function(q){
    if (q.caseText){ actCase=q.caseText; actRange=q._cr||null; }
    else if (actCase){
      if (actRange){
        if (q.num>=actRange.lo && q.num<=actRange.hi) q.caseText=actCase;
        else if (q.num>actRange.hi){ actCase=null; actRange=null; }
      }
    }
  });
  return blocks;
}
function uid(){ return Math.random().toString(36).slice(2,10); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── IMPORT ───────────────────────────────────────────────
function importQuestions(start) {
  var raw  = document.getElementById('raw').value.trim();
  var name = document.getElementById('batch-name').value.trim();
  var msg  = document.getElementById('import-msg');
  msg.textContent=''; msg.style.color='';
  if (!raw){ msg.textContent='请先粘贴题目。'; msg.style.color='red'; return; }
  var qs = parseQ(raw);
  if (!qs.length){ msg.textContent='未识别到题目，请检查格式。'; msg.style.color='red'; return; }
  var bname = name || ('批次'+(DB.batches.length+1)+' — '+new Date().toLocaleDateString('zh-CN'));
  var batch = {id:uid(), name:bname, date:Date.now(), questions:qs,
    progress:{idx:0, answers:new Array(qs.length).fill(null), dk:{}}};
  DB.batches.push(batch); saveDB(); renderHome();
  msg.textContent='✓ 导入 '+qs.length+' 道题 → "'+bname+'"';
  msg.style.color='green';
  document.getElementById('raw').value='';
  document.getElementById('batch-name').value='';
  if (start) setTimeout(function(){ showBatchDetail(batch.id); }, 400);
}

// ── BATCH DETAIL ─────────────────────────────────────────
function showBatchDetail(batchId) {
  var batch = null;
  for (var i=0; i<DB.batches.length; i++) { if (DB.batches[i].id===batchId) { batch=DB.batches[i]; break; } }
  if (!batch) return;

  var p = batch.progress;
  var resumeIdx = 0;
  for (var j=0; j<p.answers.length; j++) { if (!p.answers[j]) { resumeIdx=j; break; } }
  var allDone = p.answers.every(function(a){ return !!a; });
  var done = p.answers.filter(function(a){ return a && a!=='skip'; }).length;
  var prog = Math.round(done/batch.questions.length*100);

  var html = '<div class="card">'
    +'<div class="row">'
    +'<button class="btn small" onclick="showPage(\'home\')">← 返回</button>'
    +'<div class="title spacer" style="margin-left:12px">'+esc(batch.name)+'</div>'
    +'</div>'
    +'<div class="sub" style="margin:6px 0">共 '+batch.questions.length+' 题 · 已答 '+done+' 题 ('+prog+'%) · 点任意题可从该题开始</div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap">'
    +'<button class="btn primary" onclick="startBatchFrom(\''+batchId+'\','+resumeIdx+')">'
    +(allDone ? '🔄 从头重做' : '▶ 继续第'+(resumeIdx+1)+'题')
    +'</button>'
    +'<button class="btn" onclick="startBatchFrom(\''+batchId+'\',0)">从第1题开始</button>'
    +'</div></div>';

  html += '<div class="card" style="padding:0;overflow:hidden">';
  html += '<table style="width:100%;border-collapse:collapse">';
  html += '<thead><tr style="background:#f0efe9;font-size:12px">'
    +'<th style="padding:8px 12px;text-align:left;width:50px">题号</th>'
    +'<th style="padding:8px 12px;text-align:left">题目</th>'
    +'<th style="padding:8px 12px;width:48px;text-align:center">我选</th>'
    +'<th style="padding:8px 12px;width:48px;text-align:center">答案</th>'
    +'<th style="padding:8px 12px;width:56px;text-align:center">结果</th>'
    +'</tr></thead><tbody>';

  batch.questions.forEach(function(q, i) {
    var my = p.answers[i];
    var hasAns = !!q.answer;
    var ok = hasAns && my && my!=='skip' && my.toUpperCase()===q.answer.toUpperCase();
    var bad = hasAns && my && my!=='skip' && !ok;
    var dk = !!(p.dk && p.dk[i]);
    var rowBg = ok ? '#f0fff4' : bad ? '#fff5f5' : dk ? '#fffbea' : '';
    var result = !my ? '<span style="color:#bbb">—</span>'
      : my==='skip' ? '<span style="color:#aaa;font-size:11px">跳过</span>'
      : !hasAns ? '<span style="color:#aaa;font-size:11px">无答案</span>'
      : ok ? '<span style="color:green;font-weight:700">✓</span>'
      : '<span style="color:red;font-weight:700">✗</span>';

    html += '<tr style="border-top:1px solid #eee;cursor:pointer;background:'+rowBg+'" '
      +'onclick="startBatchFrom(\''+batchId+'\','+i+')">'
      +'<td style="padding:10px 12px;font-weight:700;font-size:13px">'+(q.num||i+1)+'</td>'
      +'<td style="padding:10px 12px;font-size:13px;color:#333;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      +esc(q.body.replace(/\n/g,' ').slice(0,60))
      +(dk?' <span style="background:#fff3cd;color:#c47a1a;font-size:10px;padding:1px 5px;border-radius:6px">❓</span>':'')
      +'</td>'
      +'<td style="padding:10px 12px;text-align:center;font-size:13px">'+(my&&my!=='skip'?my:'—')+'</td>'
      +'<td style="padding:10px 12px;text-align:center;font-size:13px">'+(hasAns?'<b>'+q.answer+'</b>':'—')+'</td>'
      +'<td style="padding:10px 12px;text-align:center">'+result+'</td>'
      +'</tr>';
  });

  html += '</tbody></table></div>';

  var detailPage = document.getElementById('batch-detail');
  if (!detailPage) {
    detailPage = document.createElement('section');
    detailPage.id = 'batch-detail';
    detailPage.className = 'page';
    document.querySelector('main').appendChild(detailPage);
  }
  detailPage.innerHTML = html;
  showPage('batch-detail');
}

function startBatchFrom(batchId, fromIdx) {
  var batch = null;
  for (var i=0; i<DB.batches.length; i++) { if (DB.batches[i].id===batchId) { batch=DB.batches[i]; break; } }
  if (!batch) return;
  var tMax = parseInt(document.getElementById('limit').value) || 60;
  var p = batch.progress;
  var prevAns = p.answers[fromIdx];
  QZ = {
    batch: batch,
    qs: batch.questions,
    ans: p.answers.slice(),
    dk: p.dk ? JSON.parse(JSON.stringify(p.dk)) : {},
    cur: fromIdx,
    sel: (prevAns && prevAns!=='skip') ? prevAns : null,
    tmr: null, tLeft: tMax, tMax: tMax,
    paused: false, stopped: false, _st: null,
    returnToBatchId: batchId
  };
  document.getElementById('q-batch').textContent = batch.name;
  document.getElementById('q-total').textContent = batch.questions.length;
  showPage('quiz');
  loadQ(QZ.cur);
}

// ── QUIZ ─────────────────────────────────────────────────
var QZ = {batch:null, qs:[], ans:[], dk:{}, cur:0, sel:null, tmr:null,
  tLeft:60, tMax:60, paused:false, stopped:false, _st:null, returnToBatchId:null};

function resumeQuiz(){
  var batch=null;
  for(var i=0;i<DB.batches.length;i++){
    var b=DB.batches[i], p=b.progress;
    for(var j=0;j<b.questions.length;j++){ if(!p.answers[j]){batch=b;break;} }
    if(batch) break;
  }
  if(!batch){ alert(DB.batches.length?'所有批次已全部作答完毕！':'请先导入题目。'); return; }
  showBatchDetail(batch.id);
}

function startFirstBatch(fromStart){
  if(!DB.batches.length){alert('请先导入题目。');return;}
  showBatchDetail(DB.batches[0].id);
}

function startBatch(batchId, fromStart){
  var batch=null;
  for(var i=0;i<DB.batches.length;i++){ if(DB.batches[i].id===batchId){batch=DB.batches[i];break;} }
  if(!batch) return;
  if(fromStart){
    batch.progress={idx:0,answers:new Array(batch.questions.length).fill(null),dk:{}};
    saveDB();
  }
  var p = batch.progress;
  var resumeIdx = 0;
  if (!fromStart) {
    for (var j=0; j<p.answers.length; j++) { if (!p.answers[j]) { resumeIdx=j; break; } }
  }
  startBatchFrom(batchId, resumeIdx);
}

function loadQ(i){
  clearInterval(QZ.tmr);
  QZ.stopped = false;
  QZ.paused = false;
  var q = QZ.qs[i];
  document.getElementById('q-num').textContent = q.num||(i+1);
  document.getElementById('qbar').style.width = (i/QZ.qs.length*100)+'%';
  document.getElementById('qbody').textContent = q.body;
  var cb = document.getElementById('casebox'); cb.innerHTML='';
  if(q.caseText){
    cb.innerHTML='<div class="case-title">📋 病例资料（本题组共用）</div><div class="case-text">'+esc(q.caseText)+'</div>';
    cb.style.display='block';
  } else { cb.style.display='none'; }

  var optsEl = document.getElementById('opts'); optsEl.innerHTML='';
  var prev = QZ.ans[i];
  QZ.sel = (prev && prev!=='skip') ? prev : null;

  q.opts.forEach(function(o){
    var btn = document.createElement('button'); btn.className='opt';
    btn.innerHTML = '<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span>';
    if(QZ.sel && QZ.sel===o.letter) btn.classList.add('sel');
    btn.addEventListener('click',(function(letter,b){return function(){pickOpt(letter,b);};})(o.letter,btn));
    optsEl.appendChild(btn);
  });

  rebuildQuizActions();
  startTimer();
}

function rebuildQuizActions(){
  var actionsEl = document.querySelector('#quiz .actions');
  if (!actionsEl) return;
  var hasBatch = !!QZ.returnToBatchId;
  actionsEl.innerHTML =
    '<button class="btn small" onclick="prevQ()">← 上一题</button>'
    +'<button class="btn small" onclick="skipQ()">跳过</button>'
    +'<button class="btn small orange" id="dkbtn" onclick="toggleDK()">不会</button>'
    +'<button class="btn small primary" onclick="nextQ()">确认/下一题 →</button>'
    +(hasBatch ? '<button class="btn small blue" onclick="goBackToBatch()">📋 题目列表</button>' : '')
    +'<button class="btn small red spacer" onclick="finishQuiz()">结束</button>';
  var dkbtn = document.getElementById('dkbtn');
  if (dkbtn) dkbtn.classList.toggle('on', !!QZ.dk[QZ.cur]);
}

function goBackToBatch(){
  clearInterval(QZ.tmr);
  if (QZ.sel) autoSave(QZ.cur, QZ.sel);
  showBatchDetail(QZ.returnToBatchId || '');
}

function pickOpt(l,btn){
  QZ.sel=l;
  document.querySelectorAll('#opts .opt').forEach(function(b){b.classList.remove('sel');});
  btn.classList.add('sel');
  autoSave(QZ.cur,l);
}

function autoSave(i,ans){
  QZ.ans[i]=ans;
  QZ.batch.progress.answers=QZ.ans;
  QZ.batch.progress.idx=QZ.cur;
  QZ.batch.progress.dk=QZ.dk;
  saveDB();
}

// ── TIMER ────────────────────────────────────────────────
function startTimer(){
  var el=document.getElementById('timer');
  if(QZ.tMax===0){el.textContent='∞'; el.className='timer spacer'; return;}
  QZ.tLeft=QZ.tMax; QZ.stopped=false; QZ.paused=false;
  updTimer();
  QZ.tmr=setInterval(function(){
    if(QZ.paused||QZ.stopped) return;
    QZ.tLeft--; updTimer();
    if(QZ.tLeft<=0){
      clearInterval(QZ.tmr);
      if (!QZ.stopped) { autoSave(QZ.cur,QZ.sel||'skip'); advanceQ(); }
    }
  },1000);
}

function updTimer(){
  var el=document.getElementById('timer');
  if (!el) return;
  if (QZ.stopped) {
    el.textContent='⏹ 点击重启';
    el.className='timer spacer paused';
    return;
  }
  var pct=QZ.tLeft/QZ.tMax;
  el.textContent=QZ.paused?('⏸ '+QZ.tLeft+' 再点停止'):QZ.tLeft;
  el.className='timer spacer'+(QZ.paused?' paused':pct>.5?' green':pct>.2?' orange':' red');
}

document.getElementById('timer').addEventListener('click',function(){
  if(QZ.tMax===0) return;
  if (QZ.stopped) {
    // Restart timer from full
    QZ.stopped=false; QZ.paused=false;
    QZ.tLeft=QZ.tMax; updTimer();
    clearInterval(QZ.tmr);
    QZ.tmr=setInterval(function(){
      if(QZ.paused||QZ.stopped) return;
      QZ.tLeft--; updTimer();
      if(QZ.tLeft<=0){ clearInterval(QZ.tmr); if(!QZ.stopped){autoSave(QZ.cur,QZ.sel||'skip');advanceQ();} }
    },1000);
    showToast('计时重新开始');
    return;
  }
  if (!QZ.paused) {
    QZ.paused=true; updTimer();
    showToast('⏸ 已暂停，再点一次彻底停止计时');
  } else {
    // Second click: fully stop, no auto-jump
    QZ.stopped=true; QZ.paused=false;
    clearInterval(QZ.tmr); updTimer();
    showToast('⏹ 计时已停止，不会自动跳题。可以回上一题或题目列表');
  }
});

function nextQ(){clearInterval(QZ.tmr);autoSave(QZ.cur,QZ.sel||'skip');advanceQ();}
function skipQ(){clearInterval(QZ.tmr);autoSave(QZ.cur,'skip');QZ.sel=null;advanceQ();}
function prevQ(){
  clearInterval(QZ.tmr);
  if(QZ.sel) autoSave(QZ.cur,QZ.sel);
  if(QZ.cur>0){QZ.cur--;loadQ(QZ.cur);}
  else showToast('已经是第一题了');
}
function toggleDK(){
  QZ.dk[QZ.cur]=!QZ.dk[QZ.cur];
  var dkbtn=document.getElementById('dkbtn');
  if(dkbtn) dkbtn.classList.toggle('on',!!QZ.dk[QZ.cur]);
  autoSave(QZ.cur,QZ.sel||QZ.ans[QZ.cur]||'skip');
  showToast(QZ.dk[QZ.cur]?'已标记「不会」':'已取消标记');
}
function advanceQ(){
  if(QZ.cur+1>=QZ.qs.length){finishQuiz();return;}
  QZ.cur++; loadQ(QZ.cur);
}
function finishQuiz(){
  clearInterval(QZ.tmr);
  for(var i=0;i<QZ.ans.length;i++){if(!QZ.ans[i])QZ.ans[i]='skip';}
  autoSave(QZ.cur,QZ.ans[QZ.cur]);
  commitResults(); showResultPage();
}
function commitResults(){
  var batch=QZ.batch;
  for(var i=0;i<QZ.qs.length;i++){
    var q=QZ.qs[i],my=QZ.ans[i];
    if(!my||my==='skip') continue;
    DB.stats.done=(DB.stats.done||0)+1;
    if(q.answer){
      var ok=my.toUpperCase()===q.answer.toUpperCase();
      if(ok){DB.stats.correct=(DB.stats.correct||0)+1;delete DB.wrongMap[q.id];}
      else DB.wrongMap[q.id]={q:q,batchId:batch.id,batchName:batch.name,myAns:my};
    }
    if(QZ.dk[i]) DB.dkMap[q.id]={q:q,batchId:batch.id,batchName:batch.name};
    else if(q.answer&&my.toUpperCase()===(q.answer||'').toUpperCase()) delete DB.dkMap[q.id];
  }
  saveDB(); renderHome();
}

// ── RESULT PAGE ───────────────────────────────────────────
function showResultPage(){
  var batch=QZ.batch;
  document.getElementById('result-batch').textContent=batch.name;
  var withAns=QZ.qs.filter(function(q){return !!q.answer;}).length;
  var correct=0,wrong=0,dkCount=0;
  var tbody=document.getElementById('result-table'); tbody.innerHTML='';
  QZ.qs.forEach(function(q,i){
    var my=QZ.ans[i],hasAns=!!q.answer;
    var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();
    var bad=hasAns&&my&&my!=='skip'&&!ok;
    var dk=!!QZ.dk[i];
    if(ok)correct++;if(bad)wrong++;if(dk)dkCount++;
    var preview=q.body.replace(/\n/g,' ').slice(0,38);
    var tr=document.createElement('tr');
    tr.style.cursor='pointer';
    (function(qid,idx){
      tr.addEventListener('click',function(){openModal(qid,idx);});
    })(q.id,i);
    tr.innerHTML='<td><strong>'+(q.num||i+1)+'</strong></td>'
      +'<td>'+esc(preview)+(dk?' <span style="background:#fff3cd;color:#c47a1a;font-size:11px;padding:1px 6px;border-radius:8px">❓</span>':'')+'</td>'
      +'<td>'+(my&&my!=='skip'?my:'—')+'</td>'
      +'<td>'+(hasAns?'<b>'+q.answer+'</b>':'—')+'</td>'
      +'<td>'+(hasAns&&my&&my!=='skip'?(ok?'<span style="color:green">✓</span>':'<span style="color:red">✗</span>'):'—')+'</td>'
      +'<td><button class="btn small blue" style="padding:3px 10px;font-size:12px" onclick="event.stopPropagation();openModal(\''+q.id+'\','+i+')">解析</button></td>';
    tbody.appendChild(tr);
  });
  document.getElementById('rs-total').textContent=QZ.qs.length;
  document.getElementById('rs-ok').textContent=correct;
  document.getElementById('rs-bad').textContent=wrong;
  document.getElementById('rs-dk').textContent=dkCount;
  document.getElementById('rs-rate').textContent=withAns?Math.round(correct/withAns*100)+'%':'—';
  document.getElementById('answer-key').value='';
  document.getElementById('key-msg').textContent='';
  showPage('result');
}

function compareKey(){
  var raw=document.getElementById('answer-key').value.trim();
  var msg=document.getElementById('key-msg');
  if(!raw){msg.textContent='请先粘贴答案。';return;}
  var keyMap={};
  if(/^\s*[A-Ea-e]{5,}/.test(raw)){
    raw.replace(/\s/g,'').split('').forEach(function(c,i){keyMap[i]=c.toUpperCase();});
  } else {
    raw.split('\n').forEach(function(line){
      var m=line.match(/(\d+)[.\s]*([A-Ea-e])/i);
      if(m) keyMap[parseInt(m[1])-1]=m[2].toUpperCase();
    });
  }
  var updated=0,correct=0;
  QZ.qs.forEach(function(q,i){
    var key=keyMap[i];if(!key)return;
    q.answer=key;updated++;
    var my=QZ.ans[i];
    if(my&&my!=='skip'&&my.toUpperCase()===key)correct++;
  });
  showResultPage();
  document.getElementById('key-msg').textContent='✓ 已对比 '+updated+' 题，答对 '+correct+' 题。';
  document.getElementById('key-msg').style.color='green';
}

// ── MODAL (AI解析 + 对话) ────────────────────────────────
var _mQid=null, _mIdx=null;
var _aiChatHistory = [];

function openModal(qid, idx){
  var q=(QZ.qs&&QZ.qs[idx])||null;
  if(!q){var e=DB.wrongMap[qid]||DB.dkMap[qid];if(e)q=e.q;}
  if(!q) return;
  _mQid=qid; _mIdx=idx;
  _aiChatHistory=[];
  var my=QZ.ans?QZ.ans[idx]:null;
  var hasAns=!!q.answer;
  var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();

  document.getElementById('m-title').textContent='第 '+(q.num||idx+1)+' 题';
  var content=document.getElementById('m-content');
  var html='';
  if(q.caseText) html+='<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;white-space:pre-wrap">📋 病例资料<br>'+esc(q.caseText)+'</div>';
  html+='<div style="font-size:15px;line-height:1.8;margin-bottom:12px;white-space:pre-wrap">'+esc(q.body)+'</div>';
  html+='<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">';
  q.opts.forEach(function(o){
    var isCorrect=o.letter===(q.answer||'');
    var isMy=my&&o.letter===my&&!isCorrect;
    var bg=isCorrect?'background:#e8f5ed;border-color:#2e7d52':isMy?'background:#fdeaea;border-color:#b83232':'';
    html+='<div style="padding:9px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;'+bg+'">'
      +o.letter+'. '+esc(o.text)
      +(isCorrect?' <b style="color:green">✓ 正确</b>':'')
      +(isMy?' <b style="color:red">← 我选</b>':'')
      +'</div>';
  });
  html+='</div>';
  if(hasAns&&my&&my!=='skip'){
    html+='<div style="margin-bottom:12px;font-size:14px;font-weight:600;color:'+(ok?'green':'red')+'">'
      +(ok?'✓ 答对了':'✗ 答错了 — 我选 '+my+'，正确是 '+q.answer)+'</div>';
  }
  html+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'
    +'<button class="btn blue small" onclick="doAnalyze()">🔍 AI解析此题</button>'
    +'<button class="btn small" onclick="doSimilar()">✨ 生成同类题</button>'
    +'</div>'
    +'<div id="modal-ai-area"></div>'
    // Chat section
    +'<div id="modal-chat-area" style="margin-top:16px;border-top:1px solid #eee;padding-top:14px">'
    +'<div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">💬 与AI对话（可追问、深入讨论）</div>'
    +'<div id="chat-messages" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>'
    +'<div style="display:flex;gap:8px;align-items:flex-end">'
    +'<textarea id="chat-input" placeholder="例如：为什么不选B？这个穴位主治什么？" '
    +'style="flex:1;min-height:56px;max-height:120px;padding:8px;border:1.5px solid #d4c9f5;border-radius:8px;font-size:13px;resize:vertical"></textarea>'
    +'<button class="btn blue small" onclick="sendChat()">发送</button>'
    +'</div>'
    +'<div style="font-size:11px;color:#aaa;margin-top:4px">Shift+Enter 换行，Enter 发送</div>'
    +'</div>';

  content.innerHTML=html;

  // Load cached analysis
  var cachedAnalysis = DB.analysisCache[qid]
    || ((DB.wrongMap[qid]||DB.dkMap[qid]||{}).analysis) || null;
  if (cachedAnalysis) {
    renderAI(document.getElementById('modal-ai-area'), cachedAnalysis);
    // Prime chat history
    _aiChatHistory = [
      {role:'user', content:'我在练习PCE针灸考试。题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'未知')+'\n我选了：'+(my||'未选')},
      {role:'assistant', content: cachedAnalysis}
    ];
  }

  document.getElementById('modal-bg').style.display='flex';
}

function closeModal(){ document.getElementById('modal-bg').style.display='none'; }

// ── AI ANALYSIS ──────────────────────────────────────────
async function doAnalyze(){
  var q=(QZ.qs&&QZ.qs[_mIdx])||null;
  if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;}
  if(!q)return;
  var my=QZ.ans?(QZ.ans[_mIdx]||'未选'):'未选';
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:12px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0">🤖 AI解析中…</div>';
  var prompt='请分析以下PCE针灸考试题目，帮助学生深度理解：\n\n'
    +'【题目】\n'+q.body+'\n\n【选项】\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')
    +'\n\n【正确答案】'+(q.answer||'未知')+'\n【学生选择】'+my
    +'\n\n请按以下格式分析：\n'
    +'【题目拆解】逐句分析题目，识别主诉/症状/舌脉等关键信息\n'
    +'【关键词识别】列出2-4个决定答案的关键词，解释为何关键\n'
    +'【混淆点分析】各选项为何容易混淆，逐项简析\n'
    +'【正确思路】一步步推导正确答案的逻辑\n'
    +'【背诵核心句】2-4句朗朗上口的记忆口诀';
  try{
    var txt=await callClaude(prompt);
    DB.analysisCache[_mQid]=txt;
    var entry=DB.wrongMap[_mQid]||DB.dkMap[_mQid];
    if(entry) entry.analysis=txt;
    saveDB();
    renderAI(aiEl,txt);
    _aiChatHistory=[
      {role:'user',content:'我在练习PCE针灸考试。题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'未知')+'\n我选了：'+my},
      {role:'assistant',content:txt}
    ];
  }catch(e){
    aiEl.innerHTML='<div style="padding:12px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232">❌ '+esc(e.message)+'</div>';
  }
}

async function doSimilar(){
  var q=(QZ.qs&&QZ.qs[_mIdx])||null;
  if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;}
  if(!q)return;
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:12px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0">✨ 生成同类题中…</div>';
  var prompt='根据以下PCE针灸考试题目，生成3道同知识点练习题：\n\n原题：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')+'\n\n要求：4选1单选，标注答案，1句解析。中文，穴位保留英文缩写。\n格式：\n1. [题目]\nA. B. C. D.\n答案：X｜解析：[一句话]';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div style="padding:12px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px"><div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">🎯 同类练习题</div><div style="font-size:13.5px;line-height:1.85;white-space:pre-wrap">'+esc(txt)+'</div></div>';
  }catch(e){
    aiEl.innerHTML='<div style="padding:12px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232">❌ '+esc(e.message)+'</div>';
  }
}

// ── AI CHAT ──────────────────────────────────────────────
async function sendChat(){
  var input=document.getElementById('chat-input');
  var msg=input?input.value.trim():'';
  if(!msg) return;
  input.value='';
  var chatEl=document.getElementById('chat-messages');
  if(!chatEl) return;
  appendChatMsg(chatEl,'user',msg);

  var q=(QZ.qs&&QZ.qs[_mIdx])||null;
  if(!q){var e2=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e2)q=e2.q;}

  if(_aiChatHistory.length===0 && q){
    _aiChatHistory=[
      {role:'user',content:'我在练习PCE针灸考试。题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'未知')},
      {role:'assistant',content:'好的，我来帮你分析这道PCE题目。请问你有什么问题？'}
    ];
  }
  _aiChatHistory.push({role:'user',content:msg});

  var thinkId='think-'+uid();
  var thinkDiv=document.createElement('div');
  thinkDiv.id=thinkId;
  thinkDiv.style.cssText='align-self:flex-start;background:#f0ebff;border:1px solid #d4c9f5;padding:8px 12px;border-radius:12px;font-size:13px;color:#6040b0';
  thinkDiv.textContent='🤖 思考中…';
  chatEl.appendChild(thinkDiv);
  chatEl.scrollTop=chatEl.scrollHeight;

  try{
    var resp=await callClaudeChat(_aiChatHistory,'你是PCE（Pan-Canada针灸考试）辅导专家。用中文简洁回答，帮学生理解中医理论和题目逻辑。');
    var thinkEl=document.getElementById(thinkId); if(thinkEl) thinkEl.remove();
    appendChatMsg(chatEl,'assistant',resp);
    _aiChatHistory.push({role:'assistant',content:resp});
    chatEl.scrollTop=chatEl.scrollHeight;
  }catch(err){
    var thinkEl2=document.getElementById(thinkId); if(thinkEl2) thinkEl2.remove();
    appendChatMsg(chatEl,'error','❌ '+err.message);
  }
}

function appendChatMsg(container,role,text){
  var isUser=role==='user', isError=role==='error';
  var div=document.createElement('div');
  div.style.cssText='align-self:'+(isUser?'flex-end':'flex-start')+';max-width:88%;'
    +'background:'+(isUser?'#1a4fa0':isError?'#fdeaea':'#f0ebff')+';'
    +'color:'+(isUser?'#fff':isError?'#b83232':'#18180f')+';'
    +'border:1px solid '+(isUser?'#1a4fa0':isError?'#f5c5c5':'#d4c9f5')+';'
    +'padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word';
  div.textContent=text;
  container.appendChild(div);
}

document.addEventListener('keydown',function(e){
  var input=document.getElementById('chat-input');
  if(input&&document.activeElement===input&&e.key==='Enter'&&!e.shiftKey){
    e.preventDefault(); sendChat();
  }
});

// ── AI CALL ──────────────────────────────────────────────
async function callClaude(prompt){
  return callClaudeChat([{role:'user',content:prompt}],'你是PCE（Pan-Canada针灸考试）辅导专家，回答简洁精准，用中文。');
}
async function callClaudeChat(messages,systemPrompt){
  var key=getApiKey();
  if(!key) throw new Error('请先在云同步页面设置 Claude API Key');
  var resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true','x-api-key':key},
    body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:1024,system:systemPrompt||'你是PCE针灸考试辅导专家，用中文回答。',messages:messages})
  });
  if(!resp.ok){var err=await resp.json().catch(function(){return {};});throw new Error('API错误 '+resp.status+(err.error?': '+err.error.message:''));}
  var d=await resp.json();
  return(d.content&&d.content[0]&&d.content[0].text)||'（无响应）';
}

function renderAI(el,txt){
  var CORE='【背诵核心句】';
  var ci=txt.indexOf(CORE);
  var core=ci>=0?txt.slice(ci+CORE.length):'';
  var ni=core.indexOf('【');if(ni>=0)core=core.slice(0,ni);core=core.trim();
  var main=ci>=0?txt.slice(0,ci).trim():txt.trim();
  var formatted=main.replace(/【([^】]+)】/g,function(match,name){
    return '\n<div style="font-size:11px;font-weight:700;color:#6040b0;margin:10px 0 3px;letter-spacing:.5px">▌ '+esc(name)+'</div>';
  });
  var html='<div style="margin-top:10px;padding:14px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px">'
    +'<div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">🤖 AI解析</div>'
    +'<div style="font-size:13.5px;line-height:1.85;color:#18180f">'+formatted+'</div></div>';
  if(core){
    var lines=core.split('\n').filter(function(s){return s.trim();});
    html+='<div style="margin-top:8px;padding:12px 14px;background:#fffbe6;border:1px solid #f0d060;border-radius:8px">'
      +'<div style="font-size:12px;font-weight:700;color:#8a6000;margin-bottom:8px">📌 背诵核心句</div>';
    lines.forEach(function(s){
      html+='<div style="font-size:13.5px;padding:4px 0;border-bottom:1px dashed #f0d060">'+esc(s.replace(/^[-•\d.、,]+\s*/,''))+'</div>';
    });
    html+='</div>';
  }
  el.innerHTML=html;
}

// ── REVIEW PAGE ───────────────────────────────────────────
function renderReview(){
  var list=document.getElementById('review-list');
  list.innerHTML='';
  var wrongEntries=Object.values(DB.wrongMap);
  var dkEntries=Object.values(DB.dkMap).filter(function(e){return !DB.wrongMap[e.q.id];});
  if(!wrongEntries.length&&!dkEntries.length){
    list.innerHTML='<div class="card"><div class="sub">复习库暂无内容。</div></div>';
    return;
  }
  var pdfCtrl='<div class="card">'
    +'<div class="row"><div class="title">📄 选题生成PDF</div></div>'
    +'<div class="sub" style="margin-bottom:10px">勾选题目后点"生成PDF"，每题含题目+解析</div>'
    +'<div class="row" style="flex-wrap:wrap;gap:8px">'
    +'<button class="btn small" onclick="selectAllReview(true)">全选</button>'
    +'<button class="btn small" onclick="selectAllReview(false)">全不选</button>'
    +'<button class="btn purple" onclick="printSelectedPDF()">📄 生成选中题PDF</button>'
    +'<button class="btn red spacer" onclick="clearReview()">清空复习库</button>'
    +'</div></div>';
  list.innerHTML=pdfCtrl;

  if(dkEntries.length){
    var cats={};
    dkEntries.forEach(function(e){var cat=guessCategory(e.q.body);if(!cats[cat])cats[cat]=[];cats[cat].push(e);});
    var h='<div class="card"><div class="row"><div class="title">❓ 不会的题</div><span class="sub spacer">共 '+dkEntries.length+' 道</span></div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:12px 0">';
    Object.keys(cats).forEach(function(catName){
      h+='<div style="background:#fff3cd;border:1px solid #f5d9a0;border-radius:8px;padding:12px;text-align:center">'
        +'<div style="font-size:14px;font-weight:600;margin-bottom:4px">'+esc(catName)+'</div>'
        +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+cats[catName].length+' 道</div>'
        +'<button class="btn small blue" onclick="genSimilarCat(\''+encodeURIComponent(catName)+'\')">生成练习题</button></div>';
    });
    h+='</div><div>';
    dkEntries.forEach(function(e){h+=reviewItemHTML(e,'dk');});
    h+='</div></div>';
    list.innerHTML+=h;
  }
  if(wrongEntries.length){
    var h2='<div class="card"><div class="row"><div class="title">✗ 错题库</div><span class="sub spacer">共 '+wrongEntries.length+' 道</span>'
      +'<button class="btn blue small" onclick="analyzeAllWrong()">AI全部解析</button></div><div>';
    wrongEntries.forEach(function(e){h2+=reviewItemHTML(e,'wrong');});
    h2+='</div></div>';
    list.innerHTML+=h2;
  }
}

function reviewItemHTML(entry,type){
  var q=entry.q,myAns=entry.myAns||'?';
  var preview=q.body.replace(/\n/g,' ').slice(0,55);
  var tag=type==='dk'
    ?'<span style="background:#fff3cd;color:#c47a1a;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;flex-shrink:0">❓不会</span>'
    :'<span style="background:#fdeaea;color:#b83232;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;flex-shrink:0">✗ 我选'+myAns+'</span>';
  return '<div style="border:1px solid #dddbd3;border-radius:8px;overflow:hidden;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f0efe9">'
    +'<input type="checkbox" class="review-cb" data-qid="'+q.id+'" style="width:16px;height:16px;flex-shrink:0">'
    +'<span style="font-size:13px;font-weight:700;min-width:36px;cursor:pointer" onclick="toggleRI(\''+q.id+'\')">#'+(q.num||'?')+'</span>'
    +'<span style="font-size:13px;color:#6b6860;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="toggleRI(\''+q.id+'\')">'+esc(preview)+'</span>'
    +tag
    +'<button class="btn small blue" style="padding:3px 10px;font-size:12px;flex-shrink:0" onclick="revAnalyze(\''+q.id+'\')">🔍 解析</button>'
    +'</div>'
    +'<div id="rib-'+q.id+'" style="display:none;padding:14px 16px;background:#fff">'
    +(q.caseText?'<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;white-space:pre-wrap">📋 '+esc(q.caseText)+'</div>':'')
    +'<div style="font-size:14px;line-height:1.8;white-space:pre-wrap;margin-bottom:10px">'+esc(q.body)+'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">'
    +q.opts.map(function(o){
      var cls=(o.letter===(q.answer||''))?'background:#e8f5ed;color:#2e7d52;font-weight:600':(o.letter===myAns?'background:#fdeaea;color:#b83232':'');
      return '<div style="font-size:13px;padding:5px 10px;border-radius:5px;'+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===q.answer?' ✓ 正确':'')+(o.letter===myAns&&o.letter!==q.answer?' ← 我选':'')+'</div>';
    }).join('')
    +'</div>'
    +'<div style="display:flex;gap:8px"><button class="btn small blue" onclick="revAnalyze(\''+q.id+'\')">🔍 AI解析</button>'
    +'<button class="btn small" onclick="revSimilar(\''+q.id+'\')">✨ 同类题</button></div>'
    +'<div id="ai-'+q.id+'"></div>'
    +'</div></div>';
}

function selectAllReview(checked){
  document.querySelectorAll('.review-cb').forEach(function(cb){cb.checked=checked;});
}

// ── PDF ───────────────────────────────────────────────────
function printSelectedPDF(){
  var checked=document.querySelectorAll('.review-cb:checked');
  if(!checked.length){showToast('请先勾选题目');return;}
  var qids=[];
  checked.forEach(function(cb){qids.push(cb.dataset.qid);});
  var entries=qids.map(function(qid){return DB.wrongMap[qid]||DB.dkMap[qid];}).filter(Boolean);
  if(!entries.length){showToast('未找到题目数据');return;}
  generatePDF(entries);
}

function printReport(){
  var entries=Object.values(DB.wrongMap).concat(Object.values(DB.dkMap));
  if(!entries.length){showToast('暂无错题或不会的题');return;}
  generatePDF(entries);
}

function generatePDF(entries){
  var w=window.open('','_blank');
  if(!w){showToast('弹窗被拦截，请允许弹窗');return;}
  var css='body{font-family:-apple-system,"PingFang SC",sans-serif;padding:1.5cm;color:#18180f;font-size:11pt;line-height:1.7}'
    +'h1{font-size:18pt;font-weight:700;margin-bottom:6px}.meta{color:#666;margin-bottom:1.5rem;border-bottom:2px solid #ddd;padding-bottom:10px}'
    +'.qb{margin-bottom:1.5rem;padding:14px;border-radius:8px;page-break-inside:avoid}'
    +'.qb.w{background:#fff9f9;border:1px solid #f5c5c5;border-left:5px solid #b83232}'
    +'.qb.d{background:#fffdf0;border:1px solid #f5d9a0;border-left:5px solid #c47a1a}'
    +'.qn{font-size:9pt;color:#888;margin-bottom:4px;font-weight:600}'
    +'.qt{font-size:11pt;white-space:pre-wrap;margin-bottom:10px;font-weight:500}'
    +'.opt{font-size:10pt;padding:3px 8px;border-radius:4px;margin-bottom:2px;display:block}'
    +'.oc{background:#e8f5ed;color:#2e7d52;font-weight:700}.ow{background:#fdeaea;color:#b83232}'
    +'.ai-box{background:#f0ebff;border:1px solid #d4c9f5;padding:10px;border-radius:6px;margin-top:10px;font-size:10pt;white-space:pre-wrap}'
    +'.kw-box{background:#fffbe6;border:1px solid #f0d060;padding:8px 10px;border-radius:6px;margin-top:6px;font-size:10pt}'
    +'.core-box{background:#fffbe6;border:1px solid #f0d060;padding:8px 10px;border-radius:6px;margin-top:6px}'
    +'.nopr{position:fixed;top:1rem;right:1rem;display:flex;gap:8px}@media print{.nopr{display:none}}';

  var body='<div class="nopr">'
    +'<button onclick="window.print()" style="padding:10px 22px;background:#18180f;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600">🖨 打印/保存PDF</button>'
    +'<button onclick="window.close()" style="padding:10px 16px;background:#f0efe9;border:1px solid #ccc;border-radius:8px;font-size:14px;cursor:pointer">关闭</button></div>'
    +'<h1>PCE 针灸复习报告</h1>'
    +'<div class="meta">生成时间：'+new Date().toLocaleString('zh-CN')+' | 共 '+entries.length+' 道题</div>';

  entries.forEach(function(e){
    var q=e.q, my=e.myAns||'?';
    var isWrong=!!DB.wrongMap[q.id];
    var an=DB.analysisCache[q.id]||e.analysis||'';
    var out='<div class="qb '+(isWrong?'w':'d')+'">';
    out+='<div class="qn">题号 #'+(q.num||'?')+' | '+esc(e.batchName||'')+(isWrong?' | ✗ 错误':' | ❓ 不会')+'</div>';
    if(q.caseText)out+='<div style="background:#fffbe6;border:1px solid #f0d060;padding:7px;border-radius:5px;margin-bottom:8px;font-size:9.5pt;white-space:pre-wrap">📋 '+esc(q.caseText)+'</div>';
    out+='<div class="qt">'+esc(q.body)+'</div>';
    q.opts.forEach(function(o){
      var cls=(o.letter===(q.answer||''))?'oc':(o.letter===my?'ow':'');
      out+='<span class="opt '+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===q.answer?' ✓ 正确':'')+(o.letter===my&&o.letter!==q.answer?' ← 我选':'')+'</span>';
    });
    if(an){
      var CORE='【背诵核心句】';
      var ci=an.indexOf(CORE),core=ci>=0?an.slice(ci+CORE.length):'';
      var ni=core.indexOf('【');if(ni>=0)core=core.slice(0,ni);core=core.trim();
      var main=ci>=0?an.slice(0,ci).trim():an.trim();
      out+='<div class="ai-box"><b>🤖 AI解析</b><br>'+esc(main)+'</div>';
      if(core){
        out+='<div class="core-box"><b>📌 背诵核心句</b><br>';
        core.split('\n').filter(function(s){return s.trim();}).forEach(function(s){
          out+='<div style="padding:2px 0;border-bottom:1px dashed #f0d060">'+esc(s.replace(/^[-•\d.、,]+\s*/,''))+'</div>';
        });
        out+='</div>';
      }
    } else {
      out+='<div style="background:#f5f3ee;border:1px solid #ddd;padding:8px;border-radius:6px;margin-top:8px;font-size:9.5pt;color:#999">（暂无AI解析 — 请先在复习库中点击"解析"）</div>';
    }
    out+='</div>';
    body+=out;
  });

  w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PCE复习报告</title><style>'+css+'</style></head><body>'+body+'</body></html>');
  w.document.close();
}

function toggleRI(id){
  var b=document.getElementById('rib-'+id);
  if(b) b.style.display=b.style.display==='none'?'block':'none';
}
function guessCategory(body){
  var kws=[['\u9488\u523a\u624b\u6cd5','\u8865\u6cfb','\u5f97\u6c14'],['\u7ecf\u7edc','\u7ecf\u8109','\u7edc\u8109','\u5947\u7ecf'],['\u8150\u7a74','\u53d6\u7a74','\u4e3b\u6cbb','\u7a74\u4f4d'],['\u4e94\u884c','\u76f8\u751f','\u76f8\u514b'],['\u810f\u8154','\u5fc3\u810f','\u809d\u810f','\u813e\u810f','\u80ba\u810f','\u8086\u810f','\u4e09\u7126'],['\u75c5\u56e0','\u75c5\u673a','\u8bc1\u5019','\u8fa8\u8bc1'],['\u6d88\u6bd2','\u706d\u83cc','\u538b\u668f','\u536b\u751f'],['\u897f\u533b','\u89e3\u5256','\u795e\u7ecf'],['\u836f\u7269','\u4e2d\u836f','\u65b9\u5242'],['\u5987\u79d1','\u513f\u79d1','\u4ea7\u540e','\u6708\u7ecf']];
  var labels=['\u9488\u523a\u624b\u6cd5','\u7ecf\u7edc\u5b66','\u8150\u7a74\u5b66','\u4e94\u884c\u5b66\u8bf4','\u810f\u8154\u7406\u8bba','\u75c5\u56e0\u75c5\u673a','\u6d88\u6bd2\u536b\u751f','\u897f\u533b\u57fa\u7840','\u4e2d\u836f\u65b9\u5242','\u5987\u5150\u79d1'];
  for(var i=0;i<kws.length;i++){if(kws[i].some(function(k){return body.indexOf(k)>=0;}))return labels[i];}
  return '\u5176\u4ed6';
}
function clearReview(){
  if(!confirm('确定清空全部复习库？'))return;
  DB.wrongMap={}; DB.dkMap={}; saveDB(); renderHome(); renderReview();
  showToast('已清空复习库');
}

async function revAnalyze(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry)return;
  var q=entry.q,myAns=entry.myAns||'未选';
  var b=document.getElementById('rib-'+qid); if(b) b.style.display='block';
  var aiEl=document.getElementById('ai-'+qid); if(!aiEl)return;
  var cached=DB.analysisCache[qid]||entry.analysis||null;
  if(cached){renderAI(aiEl,cached);return;}
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;margin-top:8px">🤖 AI解析中…</div>';
  var prompt='请分析以下PCE针灸考试题目：\n\n【题目】\n'+q.body+'\n\n【选项】\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')
    +'\n\n【正确答案】'+(q.answer||'未知')+'\n【学生选择】'+myAns
    +'\n\n格式：\n【题目拆解】关键信息\n【关键词识别】2-4个关键词\n【混淆点分析】各选项混淆点\n【正确思路】推导逻辑\n【背诵核心句】2-4句口诀';
  try{
    var txt=await callClaude(prompt);
    DB.analysisCache[qid]=txt; entry.analysis=txt; saveDB();
    renderAI(aiEl,txt);
  }catch(e){
    aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;margin-top:8px">❌ '+esc(e.message)+'</div>';
  }
}

async function revSimilar(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry)return;
  var q=entry.q;
  var aiEl=document.getElementById('ai-'+qid); if(!aiEl)return;
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;margin-top:8px">✨ 生成中…</div>';
  var prompt='根据PCE针灸考试题目，生成3道同类练习题：\n原题：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')+'\n\n要求：4选1，标注答案，1句解析，中文，穴位保留英文缩写。\n格式：\n1. [题目]\nA. B. C. D.\n答案：X｜解析：[一句话]';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;margin-top:8px"><div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:6px">🎯 同类练习题</div><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">'+esc(txt)+'</div></div>';
  }catch(e){
    aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;margin-top:8px">❌ 生成失败</div>';
  }
}

async function analyzeAllWrong(){
  var entries=Object.values(DB.wrongMap).filter(function(e){return !e.analysis&&!DB.analysisCache[e.q.id];}).slice(0,6);
  if(!entries.length){showToast('错题已全部解析！');return;}
  showToast('正在解析 '+entries.length+' 道错题…',10000);
  for(var i=0;i<entries.length;i++){await revAnalyze(entries[i].q.id);await new Promise(function(r){setTimeout(r,500);});}
  showToast('解析完成！');
}

async function genSimilarCat(enc){
  var catName=decodeURIComponent(enc);
  var entries=Object.values(DB.dkMap).filter(function(e){return guessCategory(e.q.body)===catName;});
  if(!entries.length){showToast('没有该类别的题目');return;}
  showToast('正在生成「'+catName+'」练习题…',8000);
  var samples=entries.slice(0,3).map(function(e){return '- '+e.q.body.slice(0,60);}).join('\n');
  var prompt='根据PCE针灸考试「'+catName+'」类别的错题，生成5道同类练习题。\n学生错题样本：\n'+samples+'\n\n要求：严格PCE风格，4选1，标注答案，中英文混排。\n格式：\n1. [题目]\nA. B. C. D.\n答案：X｜解析：[一句话]';
  try{
    var txt=await callClaude(prompt);
    var div=document.createElement('div'); div.className='card';
    div.innerHTML='<div class="title">🎯 「'+esc(catName)+'」同类练习题</div><div style="white-space:pre-wrap;font-size:13.5px;line-height:1.85;margin-top:10px">'+esc(txt)+'</div>';
    document.getElementById('review-list').prepend(div);
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){showToast('生成失败: '+e.message);}
}

// ── MOCK (PCE weighted) ───────────────────────────────────
function renderMockSetup(){
  var total=DB.batches.reduce(function(s,b){return s+b.questions.length;},0);
  var wrongCount=Object.keys(DB.wrongMap).length;
  var dkCount=Object.keys(DB.dkMap).length;
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="title">模拟考试</div><div class="sub">仿 Pan Canada 针灸考试 — 125题 / 2.5小时</div>'
    +'<div class="grid">'
    +'<div class="stat"><div class="k">可用题目</div><div class="v">'+total+'</div></div>'
    +'<div class="stat"><div class="k">错题库</div><div class="v redtext">'+wrongCount+'</div></div>'
    +'<div class="stat"><div class="k">不会题</div><div class="v orangetext">'+dkCount+'</div></div>'
    +'</div>'
    +'<div style="margin:14px 0;padding:14px;background:#fff8f0;border:1px solid #f5d9a0;border-radius:8px">'
    +'<div style="font-size:13px;font-weight:700;margin-bottom:10px">🎯 刻意练习设置</div>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="mock-wrong-cb" checked> 错题加权（出现概率×3）</label>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:8px"><input type="checkbox" id="mock-dk-cb" checked> 不会题加权（出现概率×2）</label>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="mock-only-weak-cb"> 只考错题/不会题（专项突破）</label>'
    +'</div>'
    +'<div style="margin-bottom:14px;padding:12px;background:#f0f8ff;border:1px solid #b8d8f0;border-radius:8px">'
    +'<div style="font-size:12px;font-weight:700;margin-bottom:8px">📋 PCE考试题型参考分布</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px">'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="min-width:160px">针灸基础（经络穴位）</span><div style="flex:1;background:#e0eef8;border-radius:4px;height:8px"><div style="width:30%;background:#1a4fa0;height:8px;border-radius:4px"></div></div><span style="min-width:28px;color:#666">30%</span></div>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="min-width:160px">辨证施治</span><div style="flex:1;background:#e0eef8;border-radius:4px;height:8px"><div style="width:25%;background:#1a4fa0;height:8px;border-radius:4px"></div></div><span style="min-width:28px;color:#666">25%</span></div>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="min-width:160px">临床治疗</span><div style="flex:1;background:#e0eef8;border-radius:4px;height:8px"><div style="width:20%;background:#1a4fa0;height:8px;border-radius:4px"></div></div><span style="min-width:28px;color:#666">20%</span></div>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="min-width:160px">西医基础</span><div style="flex:1;background:#e0eef8;border-radius:4px;height:8px"><div style="width:15%;background:#1a4fa0;height:8px;border-radius:4px"></div></div><span style="min-width:28px;color:#666">15%</span></div>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="min-width:160px">安全卫生</span><div style="flex:1;background:#e0eef8;border-radius:4px;height:8px"><div style="width:10%;background:#1a4fa0;height:8px;border-radius:4px"></div></div><span style="min-width:28px;color:#666">10%</span></div>'
    +'</div></div>'
    +'<div class="row"><span class="sub">题目数量：</span><input id="mock-count" type="number" min="10" max="200" value="125" class="tiny"><span class="sub"> 题</span></div>'
    +'<button class="btn primary" style="margin-top:12px" onclick="startMock()">开始模拟考试</button></div>';
}

var MK={qs:[],ans:[],cur:0,start:0,interval:null};

function startMock(){
  var allQs=[];
  DB.batches.forEach(function(b){allQs=allQs.concat(b.questions);});
  if(!allQs.length){alert('请先导入题目。');return;}
  var onlyWeak=document.getElementById('mock-only-weak-cb')&&document.getElementById('mock-only-weak-cb').checked;
  var useWrong=document.getElementById('mock-wrong-cb')&&document.getElementById('mock-wrong-cb').checked;
  var useDk=document.getElementById('mock-dk-cb')&&document.getElementById('mock-dk-cb').checked;
  var countEl=document.getElementById('mock-count');
  var count=countEl?(parseInt(countEl.value)||125):125;
  var wids=Object.keys(DB.wrongMap), dids=Object.keys(DB.dkMap);
  var pool;
  if(onlyWeak){
    pool=allQs.filter(function(q){return wids.indexOf(q.id)>=0||dids.indexOf(q.id)>=0;});
    if(!pool.length){alert('错题库和不会题库都是空的，无法专项练习。');return;}
  } else {
    pool=allQs.slice();
    if(useWrong) allQs.filter(function(q){return wids.indexOf(q.id)>=0;}).forEach(function(q){pool.push(q);pool.push(q);});
    if(useDk) allQs.filter(function(q){return dids.indexOf(q.id)>=0;}).forEach(function(q){pool.push(q);});
  }
  pool=shuffle(pool).slice(0,count);
  MK={qs:pool,ans:new Array(pool.length).fill(null),cur:0,start:Date.now(),interval:null};
  renderMockQ();
}

function renderMockQ(){
  var q=MK.qs[MK.cur];
  var answered=MK.ans.filter(function(a){return !!a;}).length;
  clearInterval(MK.interval);
  var rem=150*60-Math.round((Date.now()-MK.start)/1000);
  if(rem<=0){finishMock();return;}
  var isWrong=!!DB.wrongMap[q.id], isDk=!!DB.dkMap[q.id];
  var badge=isWrong?'<span style="background:#fdeaea;color:#b83232;font-size:11px;padding:2px 8px;border-radius:8px;margin-left:8px">⚠ 曾错</span>'
    :isDk?'<span style="background:#fff3cd;color:#c47a1a;font-size:11px;padding:2px 8px;border-radius:8px;margin-left:8px">❓ 不会</span>':'';
  var optsHTML=q.opts.map(function(o){
    var sel=MK.ans[MK.cur]===o.letter?' sel':'';
    return '<button class="opt'+sel+'" onclick="mockPick(\''+o.letter+'\')">'
      +'<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span></button>';
  }).join('');
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="qtop"><div><div class="qcount">第 <strong>'+(MK.cur+1)+'</strong> / '+MK.qs.length+' 题'+badge+'</div>'
    +'<div class="sub">已答 '+answered+' 题</div></div>'
    +'<div id="mock-timer" class="timer spacer green"></div></div>'
    +(q.caseText?'<div style="display:block;background:#fffbe6;border:1.5px solid #f0d060;border-radius:8px;padding:12px 16px;margin-bottom:1rem;font-size:14px;line-height:1.8;white-space:pre-wrap"><div style="font-size:11px;font-weight:700;color:#8a6000;margin-bottom:6px">📋 病例资料</div>'+esc(q.caseText)+'</div>':'')
    +'<div class="qbody">'+esc(q.body)+'</div>'
    +'<div class="opts">'+optsHTML+'</div>'
    +'<div class="row actions">'
    +'<button class="btn small" onclick="mPrev()">← 上一题</button>'
    +'<button class="btn small primary" onclick="mNext()">下一题 →</button>'
    +'<button class="btn small red spacer" onclick="finishMock()">交卷</button>'
    +'</div></div>';
  MK.interval=setInterval(function(){
    var el=document.getElementById('mock-timer'); if(!el){clearInterval(MK.interval);return;}
    var r=150*60-Math.round((Date.now()-MK.start)/1000);
    if(r<=0){clearInterval(MK.interval);finishMock();return;}
    var hh=Math.floor(r/3600),mm=Math.floor((r%3600)/60),ss=r%60;
    el.textContent=hh+':'+(mm<10?'0':'')+mm+':'+(ss<10?'0':'')+ss;
  },1000);
}

function mockPick(l){
  MK.ans[MK.cur]=l;
  document.querySelectorAll('#mock-area .opt').forEach(function(b){
    var letter=b.querySelector('.opt-letter');
    if(letter) b.classList.toggle('sel',letter.textContent===l);
  });
}
function mPrev(){if(MK.cur>0){clearInterval(MK.interval);MK.cur--;renderMockQ();}}
function mNext(){clearInterval(MK.interval);if(MK.cur<MK.qs.length-1){MK.cur++;renderMockQ();}else finishMock();}

function finishMock(){
  clearInterval(MK.interval);
  var elapsed=Math.round((Date.now()-MK.start)/1000);
  var hh=Math.floor(elapsed/3600),mm=Math.floor((elapsed%3600)/60),ss=elapsed%60;
  var timeStr=(hh?hh+'h ':'')+mm+'m '+ss+'s';
  var correct=0,wrong=0,withAns=MK.qs.filter(function(q){return !!q.answer;}).length,rows='';
  MK.qs.forEach(function(q,i){
    var my=MK.ans[i],hasAns=!!q.answer;
    var ok=hasAns&&my&&my.toUpperCase()===(q.answer||'').toUpperCase();
    if(ok)correct++;
    if(hasAns&&my&&!ok){wrong++;DB.wrongMap[q.id]={q:q,batchId:'mock',batchName:'模拟考试',myAns:my};}
    rows+='<tr><td>'+(i+1)+'</td><td>'+esc(q.body.replace(/\n/g,' ').slice(0,40))+'</td>'
      +'<td>'+(my||'—')+'</td><td>'+(hasAns?'<b>'+q.answer+'</b>':'—')+'</td>'
      +'<td>'+(hasAns&&my?(ok?'<span style="color:green">✓</span>':'<span style="color:red">✗</span>'):'—')+'</td></tr>';
  });
  saveDB(); renderHome();
  var rate=withAns?Math.round(correct/withAns*100):0;
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="title">模拟考试结果</div>'
    +'<div class="grid">'
    +'<div class="stat"><div class="k">总题</div><div class="v">'+MK.qs.length+'</div></div>'
    +'<div class="stat"><div class="k">答对</div><div class="v" style="color:green">'+correct+'</div></div>'
    +'<div class="stat"><div class="k">答错</div><div class="v" style="color:red">'+wrong+'</div></div>'
    +'<div class="stat"><div class="k">正确率</div><div class="v">'+rate+'%</div></div>'
    +'<div class="stat"><div class="k">用时</div><div class="v">'+timeStr+'</div></div>'
    +'<div class="stat"><div class="k">PCE预估</div><div class="v">'+(rate>=70?'🟢 通过':'🔴 需加强')+'</div></div>'
    +'</div>'
    +(rate<70?'<div style="margin:12px 0;padding:12px;background:#fff8f0;border:1px solid #f5d9a0;border-radius:8px;font-size:13px"><b>💡 建议：</b>正确率 '+rate+'%，PCE通过线约70%。重点用AI解析错题，善用刻意练习模式。</div>':'')
    +'<div class="row mt"><button class="btn primary" onclick="renderMockSetup()">再考一次</button>'
    +'<button class="btn" onclick="showPage(\'review\');renderReview()">查看错题</button></div>'
    +'<div class="tablewrap"><table><thead><tr><th>题号</th><th>题目</th><th>我选</th><th>答案</th><th>结果</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div></div>';
}

// ── HOME ──────────────────────────────────────────────────
function renderHome(){
  var total=0; DB.batches.forEach(function(b){total+=b.questions.length;});
  document.getElementById('st-total').textContent=total;
  document.getElementById('st-done').textContent=DB.stats.done||0;
  document.getElementById('st-wrong').textContent=Object.keys(DB.wrongMap).length;
  document.getElementById('st-dk').textContent=Object.keys(DB.dkMap).length;
  var d=DB.stats.done||0,c=DB.stats.correct||0;
  document.getElementById('st-rate').textContent=d>0?Math.round(c/d*100)+'%':'--';
  var list=document.getElementById('batch-list');
  if(!DB.batches.length){list.innerHTML='<div class="sub">导入后会出现在这里。</div>';return;}
  list.innerHTML='';
  DB.batches.slice().reverse().forEach(function(b){
    var p=b.progress;
    var done=p.answers.filter(function(a){return a&&a!=='skip';}).length;
    var prog=Math.round(done/b.questions.length*100);
    var div=document.createElement('div'); div.className='batch-row';
    div.innerHTML='<span class="batch-name" style="cursor:pointer;text-decoration:underline;color:#1a4fa0" onclick="showBatchDetail(\''+b.id+'\')">'+esc(b.name)+'</span>'
      +'<span class="batch-meta">'+b.questions.length+'题 '+prog+'%</span>';
    [
      {t:'📋 题目',fn:function(){showBatchDetail(b.id);}},
      {t:'▶ 继续',fn:function(){startBatch(b.id,false);}},
      {t:'🔄 重来',fn:function(){
        if(!confirm('从第一题重新开始"'+b.name+'"？'))return;
        b.progress={idx:0,answers:new Array(b.questions.length).fill(null),dk:{}}; saveDB(); startBatch(b.id,true);
      }},
      {t:'改名',fn:function(){var n=prompt('修改名称：',b.name);if(!n)return;b.name=n.trim();saveDB();renderHome();}},
      {t:'删除',fn:function(){if(!confirm('确定删除？'))return;DB.batches=DB.batches.filter(function(x){return x.id!==b.id;});saveDB();renderHome();}}
    ].forEach(function(item){
      var btn=document.createElement('button'); btn.className='btn small'; btn.textContent=item.t;
      btn.addEventListener('click',item.fn); div.appendChild(btn);
    });
    list.appendChild(div);
  });
}

// ── FIREBASE ──────────────────────────────────────────────
function saveFirebaseConfig(){
  var raw=document.getElementById('firebase-config').value.trim();
  if(!raw){showToast('请粘贴 Firebase 配置');return;}
  try{var cfg=JSON.parse(raw);localStorage.setItem('firebase_cfg',JSON.stringify(cfg));showToast('✓ 配置已保存，请刷新页面后登录');}
  catch(e){showToast('JSON格式错误，请检查');}
}
function loadFirebaseConfigToBox(){
  var s=localStorage.getItem('firebase_cfg');
  if(s) document.getElementById('firebase-config').value=JSON.stringify(JSON.parse(s),null,2);
  else showToast('尚未保存配置');
}
(function(){
  var cfg=localStorage.getItem('firebase_cfg'); if(!cfg)return;
  var config; try{config=JSON.parse(cfg);}catch(e){return;}
  function load(url,cb){var s=document.createElement('script');s.src=url;s.onload=cb;document.head.appendChild(s);}
  load('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',function(){
    load('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',function(){
      load('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',function(){
        try{if(!firebase.apps.length)firebase.initializeApp(config);document.getElementById('cloud-status').textContent='Firebase 已连接，请登录。';}catch(e){}
      });
    });
  });
})();
function initCloudInputs(){
  var savedEmail=localStorage.getItem('cloud_email');
  if(savedEmail){var el=document.getElementById('cloud-email');if(el)el.value=savedEmail;}
  var emailEl=document.getElementById('cloud-email');
  if(emailEl){emailEl.addEventListener('change',function(){localStorage.setItem('cloud_email',this.value.trim());});}
  setTimeout(function(){
    if(typeof firebase!=='undefined'){
      firebase.auth().onAuthStateChanged(function(user){
        var st=document.getElementById('cloud-status');
        if(user&&st) st.textContent='✓ 已登录：'+user.email;
      });
    }
  },2000);
}
function cloudRegister(){
  var email=document.getElementById('cloud-email').value.trim();
  var pass=document.getElementById('cloud-pass').value;
  if(email) localStorage.setItem('cloud_email',email);
  if(typeof firebase==='undefined'){showToast('请先保存Firebase配置并刷新');return;}
  firebase.auth().createUserWithEmailAndPassword(email,pass)
    .then(function(){document.getElementById('cloud-status').textContent='✓ 注册成功，已登录：'+email;})
    .catch(function(e){document.getElementById('cloud-status').textContent='注册失败：'+e.message;});
}
function cloudLogin(){
  var email=document.getElementById('cloud-email').value.trim();
  var pass=document.getElementById('cloud-pass').value;
  if(typeof firebase==='undefined'){showToast('请先保存Firebase配置并刷新');return;}
  firebase.auth().signInWithEmailAndPassword(email,pass)
    .then(function(){document.getElementById('cloud-status').textContent='✓ 已登录：'+email;})
    .catch(function(e){document.getElementById('cloud-status').textContent='登录失败：'+e.message;});
}
function cloudLogout(){
  if(typeof firebase==='undefined')return;
  firebase.auth().signOut().then(function(){document.getElementById('cloud-status').textContent='已退出。';});
}
function cloudUpload(){
  if(typeof firebase==='undefined'){showToast('请先配置并登录Firebase');return;}
  var user=firebase.auth().currentUser; if(!user){showToast('请先登录');return;}
  firebase.firestore().collection('users').doc(user.uid).set({db:JSON.stringify(DB)})
    .then(function(){showToast('✓ 数据已上传到云端');})
    .catch(function(e){showToast('上传失败：'+e.message);});
}
function cloudDownload(){
  if(typeof firebase==='undefined'){showToast('请先配置并登录Firebase');return;}
  var user=firebase.auth().currentUser; if(!user){showToast('请先登录');return;}
  firebase.firestore().collection('users').doc(user.uid).get()
    .then(function(doc){
      if(!doc.exists){showToast('云端暂无数据');return;}
      DB=JSON.parse(doc.data().db);
      if(!DB.analysisCache) DB.analysisCache={};
      saveDB(); renderHome();
      showToast('✓ 已从云端下载数据');
    })
    .catch(function(e){showToast('下载失败：'+e.message);});
}

// ── UTILS ─────────────────────────────────────────────────
function shuffle(a){return a.slice().sort(function(){return Math.random()-.5;});}
function downloadCSV(){
  var csv='题号,题目,我选,正确答案,结果\n';
  QZ.qs.forEach(function(q,i){
    var my=QZ.ans[i]||'—',ans=q.answer||'—';
    var res=q.answer&&my!=='—'?(my.toUpperCase()===q.answer.toUpperCase()?'正确':'错误'):'—';
    csv+=(q.num||i+1)+',"'+q.body.replace(/"/g,'""').replace(/\n/g,' ')+'",'+my+','+ans+','+res+'\n';
  });
  var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='答题结果.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── INIT ──────────────────────────────────────────────────
renderHome();
setTimeout(function(){ initApiKeyInput(); initCloudInputs(); },100);
