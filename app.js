// PCE 针灸答题器 — app.js
// 适配 rosaria12-2026/testapp1

// ── DB ──────────────────────────────────────────────────
var DBKEY = 'pce_db_v4';
var DB = (function(){
  try { return JSON.parse(localStorage.getItem(DBKEY)) || makeDB(); }
  catch(e) { return makeDB(); }
})();

function makeDB() {
  return { batches:[], wrongMap:{}, dkMap:{}, stats:{done:0, correct:0} };
}
function saveDB() {
  try { localStorage.setItem(DBKEY, JSON.stringify(DB)); } catch(e) {}
}
function getApiKey() {
  return localStorage.getItem('claude_api_key') || '';
}
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
  // Pre-fill saved key
  var saved = getApiKey();
  if (saved) { inp.value = saved; }
  var st = document.getElementById('api-key-status');
  if (saved && st) st.textContent = '✓ Key 已加载';
  // Auto-save on change
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
  if (start) setTimeout(function(){ startBatch(batch.id, false); }, 400);
}

// ── QUIZ ─────────────────────────────────────────────────
var CIRC = 2*Math.PI*23;
var QZ = {batch:null, qs:[], ans:[], dk:{}, cur:0, sel:null, tmr:null, tLeft:60, tMax:60, paused:false, _st:null};

function resumeQuiz(){
  var batch=null;
  // First: find batch with unanswered questions
  for(var i=0;i<DB.batches.length;i++){
    var b=DB.batches[i], p=b.progress;
    for(var j=0;j<b.questions.length;j++){
      if(!p.answers[j] || p.answers[j]==='skip'){batch=b;break;}
    }
    if(batch) break;
  }
  // If all answered, just resume the first batch from where it left off
  if(!batch){
    if(!DB.batches.length){alert('请先导入题目。');return;}
    batch=DB.batches[0];
  }
  startBatch(batch.id, false);
}

function startFirstBatch(fromStart){
  if(!DB.batches.length){alert('请先导入题目。');return;}
  var batch=DB.batches[0];
  if(fromStart){
    if(!confirm('从第一题重新开始"'+batch.name+'"？')) return;
    batch.progress={idx:0,answers:new Array(batch.questions.length).fill(null),dk:{}};
    saveDB();
  }
  startBatch(batch.id, fromStart);
}

function startBatch(batchId, fromStart){
  var batch=null;
  for(var i=0;i<DB.batches.length;i++){ if(DB.batches[i].id===batchId){batch=DB.batches[i];break;} }
  if(!batch) return;
  var tMax=parseInt(document.getElementById('limit').value)||60;
  var p=batch.progress;
  QZ={batch:batch, qs:batch.questions,
    ans:fromStart?new Array(batch.questions.length).fill(null):p.answers.slice(),
    dk:fromStart?{}:(p.dk||{}),
    cur:fromStart?0:(p.idx||0),
    sel:null, tmr:null, tLeft:tMax, tMax:tMax, paused:false, _st:null};
  if(fromStart){batch.progress={idx:0,answers:QZ.ans,dk:QZ.dk};saveDB();}
  document.getElementById('q-batch').textContent=batch.name;
  document.getElementById('q-total').textContent=batch.questions.length;
  showPage('quiz'); loadQ(QZ.cur);
}

function loadQ(i){
  clearInterval(QZ.tmr); QZ.sel=null; QZ.paused=false;
  var q=QZ.qs[i];
  document.getElementById('q-num').textContent=q.num||(i+1);
  document.getElementById('qbar').style.width=(i/QZ.qs.length*100)+'%';
  document.getElementById('qbody').textContent=q.body;
  var cb=document.getElementById('casebox'); cb.innerHTML='';
  if(q.caseText){
    cb.innerHTML='<div class="case-title">📋 病例资料（本题组共用）</div><div class="case-text">'+esc(q.caseText)+'</div>';
    cb.style.display='block';
  } else { cb.style.display='none'; }
  var isDK = !!QZ.dk[i];
  document.getElementById('dkbtn').classList.toggle('on', isDK);
  document.getElementById('dkbtn').style.cssText = isDK
    ? 'background:#c47a1a;color:#fff;border-color:#c47a1a;font-weight:700'
    : '';
  var optsEl=document.getElementById('opts'); optsEl.innerHTML='';
  q.opts.forEach(function(o){
    var btn=document.createElement('button'); btn.className='opt';
    btn.innerHTML='<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span>';
    var prev=QZ.ans[i];
    if(prev&&prev!=='skip'&&prev===o.letter){btn.classList.add('sel');QZ.sel=prev;}
    btn.addEventListener('click',(function(letter,b){return function(){pickOpt(letter,b);};})(o.letter,btn));
    optsEl.appendChild(btn);
  });
  startTimer();
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
  QZ.tLeft=QZ.tMax; updTimer();
  QZ.tmr=setInterval(function(){
    if(QZ.paused) return;
    QZ.tLeft--; updTimer();
    if(QZ.tLeft<=0){clearInterval(QZ.tmr);autoSave(QZ.cur,QZ.sel||'skip');advanceQ();}
  },1000);
}
function updTimer(){
  var el=document.getElementById('timer');
  var pct=QZ.tLeft/QZ.tMax;
  el.textContent=QZ.paused?('⏸ '+QZ.tLeft):QZ.tLeft;
  el.className='timer spacer'+(QZ.paused?' paused':pct>.5?' green':pct>.2?' orange':' red');
}
document.getElementById('timer').addEventListener('click',function(){
  if(QZ.tMax===0) return;
  QZ.paused=!QZ.paused; updTimer();
  showToast(QZ.paused?'⏸ 已暂停，点击继续':'继续计时');
});

function nextQ(){clearInterval(QZ.tmr);autoSave(QZ.cur,QZ.sel||'skip');advanceQ();}
function skipQ(){clearInterval(QZ.tmr);autoSave(QZ.cur,'skip');QZ.sel=null;advanceQ();}
function prevQ(){
  clearInterval(QZ.tmr);
  if(QZ.sel) autoSave(QZ.cur,QZ.sel);
  if(QZ.cur>0){QZ.cur--;loadQ(QZ.cur);}
}
function toggleDK(){
  QZ.dk[QZ.cur]=!QZ.dk[QZ.cur];
  document.getElementById('dkbtn').classList.toggle('on',!!QZ.dk[QZ.cur]);
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
    if(dk) tr.style.background='#fff8e6';
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

// ── MODAL ────────────────────────────────────────────────
var _mQid=null, _mIdx=null;

function openModal(qid, idx){
  var q=(QZ.qs&&QZ.qs[idx])||null;
  if(!q){var e=DB.wrongMap[qid]||DB.dkMap[qid];if(e)q=e.q;}
  if(!q) return;
  _mQid=qid; _mIdx=idx;
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
  html+='<div style="display:flex;gap:8px;margin-bottom:12px">'
    +'<button class="btn blue small" onclick="doAnalyze()">🔍 AI解析此题</button>'
    +'<button class="btn small" onclick="doSimilar()">✨ 生成同类题</button>'
    +'</div>';
  html+='<div id="modal-ai-area"></div>';
  content.innerHTML=html;

  var cached=DB.wrongMap[qid]||DB.dkMap[qid];
  if(cached&&cached.analysis){
    renderAI(document.getElementById('modal-ai-area'), cached.analysis);
  }
  document.getElementById('modal-bg').style.display='flex';
}

function closeModal(){ document.getElementById('modal-bg').style.display='none'; }

async function doAnalyze(){
  var q=(QZ.qs&&QZ.qs[_mIdx])||null;
  if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;}
  if(!q)return;
  var my=QZ.ans?(QZ.ans[_mIdx]||'未选'):'未选';
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:12px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0">🤖 AI解析中…</div>';
  var prompt='请分析以下PCE针灸考试题目：\n\n'
    +'题目：'+q.body+'\n选项：\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')
    +'\n正确答案：'+(q.answer||'未知')+'\n学生选择：'+my
    +'\n\n请提供：\n【错误原因】为什么容易选错（1-2句）\n【解题逻辑】正确思维路径（2-3句）\n【核心知识点】必须掌握的原理（2-3句）\n【背诵核心句】2-4句简洁口诀，朗朗上口';
  try{
    var txt=await callClaude(prompt);
    var entry=DB.wrongMap[_mQid]||DB.dkMap[_mQid];
    if(entry){entry.analysis=txt;saveDB();}
    renderAI(aiEl,txt);
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
  var prompt='根据以下PCE针灸考试题目，生成3道同知识点练习题：\n\n'
    +'原题：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')
    +'\n\n要求：4选1单选，标注答案，1句解析。中文，穴位保留英文缩写。\n格式：\n1. [题目]\nA. B. C. D.\n答案：X｜解析：[一句话]';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div style="padding:12px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px"><div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">🎯 同类练习题</div><div style="font-size:13.5px;line-height:1.85;white-space:pre-wrap">'+esc(txt)+'</div></div>';
  }catch(e){
    aiEl.innerHTML='<div style="padding:12px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232">❌ '+esc(e.message)+'</div>';
  }
}

// ── AI CALL ──────────────────────────────────────────────
async function callClaude(prompt){
  var key=getApiKey();
  if(!key) throw new Error('请先在云同步页面设置 Claude API Key');
  var resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
      'x-api-key':key
    },
    body:JSON.stringify({
      model:'claude-haiku-4-5',
      max_tokens:1024,
      system:'你是PCE（Pan-Canada针灸考试）辅导专家，回答简洁精准，用中文。',
      messages:[{role:'user',content:prompt}]
    })
  });
  if(!resp.ok){
    var err=await resp.json().catch(function(){return {};});
    throw new Error('API错误 '+resp.status+(err.error?': '+err.error.message:''));
  }
  var d=await resp.json();
  return (d.content&&d.content[0]&&d.content[0].text)||'（无响应）';
}

function renderAI(el, txt){
  var CORE='【背诵核心句】';
  var ci=txt.indexOf(CORE);
  var core=ci>=0?txt.slice(ci+CORE.length):'';
  var ni=core.indexOf('【');if(ni>=0)core=core.slice(0,ni);core=core.trim();
  var main=ci>=0?txt.slice(0,ci).trim():txt.trim();
  var html='<div style="margin-top:10px;padding:14px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px">'
    +'<div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">🤖 AI解析</div>'
    +'<div style="font-size:13.5px;line-height:1.85;white-space:pre-wrap;color:#18180f">'+esc(main)+'</div></div>';
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
    list.innerHTML='<div class="card"><div class="sub">复习库暂无内容。答题后错题和「不会」的题会自动出现在这里。</div></div>';
    return;
  }
  if(dkEntries.length){
    var cats={};
    dkEntries.forEach(function(e){
      var cat=guessCategory(e.q.body);
      if(!cats[cat])cats[cat]=[];
      cats[cat].push(e);
    });
    var h='<div class="card"><div class="row"><div class="title">❓ 不会的题 — 归纳分析</div>'
      +'<span class="sub spacer">共 '+dkEntries.length+' 道</span></div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:12px 0">';
    Object.keys(cats).forEach(function(catName){
      h+='<div style="background:#fff3cd;border:1px solid #f5d9a0;border-radius:8px;padding:12px;text-align:center">'
        +'<div style="font-size:14px;font-weight:600;margin-bottom:4px">'+esc(catName)+'</div>'
        +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+cats[catName].length+' 道</div>'
        +'<button class="btn small blue" onclick="genSimilarCat(\''+encodeURIComponent(catName)+'\')">生成练习题</button>'
        +'</div>';
    });
    h+='</div><div>';
    dkEntries.forEach(function(e){ h+=reviewItemHTML(e,'dk'); });
    h+='</div></div>';
    list.innerHTML+=h;
  }
  if(wrongEntries.length){
    var h2='<div class="card"><div class="row"><div class="title">✗ 错题库</div>'
      +'<span class="sub spacer">共 '+wrongEntries.length+' 道</span>'
      +'<button class="btn blue small" onclick="analyzeAllWrong()">AI全部解析</button></div><div>';
    wrongEntries.forEach(function(e){ h2+=reviewItemHTML(e,'wrong'); });
    h2+='</div></div>';
    list.innerHTML+=h2;
  }
}

function reviewItemHTML(entry,type){
  var q=entry.q, myAns=entry.myAns||'?';
  var preview=q.body.replace(/\n/g,' ').slice(0,55);
  var tag=type==='dk'
    ?'<span style="background:#fff3cd;color:#c47a1a;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;flex-shrink:0">❓不会</span>'
    :'<span style="background:#fdeaea;color:#b83232;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;flex-shrink:0">✗ 我选'+myAns+'</span>';
  var borderColor = type==='dk' ? '#f0d060' : '#f5c5c5';
  var headerBg = type==='dk' ? '#fff8e6' : '#fff2f2';
  return '<div style="border:2px solid '+borderColor+';border-radius:8px;overflow:hidden;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:'+headerBg+';cursor:pointer" onclick="toggleRI(\''+q.id+'\')">'
    +'<span style="font-size:13px;font-weight:700;min-width:36px">#'+(q.num||'?')+'</span>'
    +'<span style="font-size:13px;color:#6b6860;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(preview)+'</span>'
    +tag
    +'<button class="btn small blue" style="padding:3px 10px;font-size:12px;flex-shrink:0" onclick="event.stopPropagation();revAnalyze(\''+q.id+'\')">🔍 解析</button>'
    +'</div>'
    +'<div id="rib-'+q.id+'" style="display:none;padding:14px 16px;background:#fff">'
    +(q.caseText?'<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;white-space:pre-wrap">📋 '+esc(q.caseText)+'</div>':'')
    +'<div style="font-size:14px;line-height:1.8;white-space:pre-wrap;margin-bottom:10px">'+esc(q.body)+'</div>'
    +'<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">'
    +q.opts.map(function(o){
      var cls=(o.letter===(q.answer||''))?'background:#e8f5ed;color:#2e7d52;font-weight:600':(o.letter===myAns?'background:#fdeaea;color:#b83232':'');
      return '<div style="font-size:13px;padding:5px 10px;border-radius:5px;'+cls+'">'+o.letter+'. '+esc(o.text)
        +(o.letter===q.answer?' ✓ 正确':'')+(o.letter===myAns&&o.letter!==q.answer?' ← 我选':'')+'</div>';
    }).join('')
    +'</div>'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn small blue" onclick="revAnalyze(\''+q.id+'\')">🔍 AI解析</button>'
    +'<button class="btn small" onclick="revSimilar(\''+q.id+'\')">✨ 同类题</button>'
    +'</div>'
    +'<div id="ai-'+q.id+'"></div>'
    +'</div></div>';
}

function toggleRI(id){
  var b=document.getElementById('rib-'+id);
  if(b) b.style.display=b.style.display==='none'?'block':'none';
}

function guessCategory(body){
  var kws=[
    ['\u9488\u523a\u624b\u6cd5','\u8865\u6cfb','\u5f97\u6c14'],
    ['\u7ecf\u7edc','\u7ecf\u8109','\u7edc\u8109','\u5947\u7ecf'],
    ['\u8150\u7a74','\u53d6\u7a74','\u4e3b\u6cbb','\u7a74\u4f4d'],
    ['\u4e94\u884c','\u76f8\u751f','\u76f8\u514b'],
    ['\u810f\u8154','\u5fc3\u810f','\u809d\u810f','\u813e\u810f','\u80ba\u810f','\u8086\u810f','\u4e09\u7126'],
    ['\u75c5\u56e0','\u75c5\u673a','\u8bc1\u5019','\u8fa8\u8bc1'],
    ['\u6d88\u6bd2','\u706d\u83cc','\u538b\u668f','\u536b\u751f'],
    ['\u897f\u533b','\u89e3\u5256','\u795e\u7ecf'],
    ['\u836f\u7269','\u4e2d\u836f','\u65b9\u5242'],
    ['\u5987\u79d1','\u513f\u79d1','\u4ea7\u540e','\u6708\u7ecf']
  ];
  var labels=['\u9488\u523a\u624b\u6cd5','\u7ecf\u7edc\u5b66','\u8150\u7a74\u5b66','\u4e94\u884c\u5b66\u8bf4','\u810f\u8154\u7406\u8bba','\u75c5\u56e0\u75c5\u673a','\u6d88\u6bd2\u536b\u751f','\u897f\u533b\u57fa\u7840','\u4e2d\u836f\u65b9\u5242','\u5987\u5150\u79d1'];
  for(var i=0;i<kws.length;i++){
    if(kws[i].some(function(k){return body.indexOf(k)>=0;})) return labels[i];
  }
  return '\u5176\u4ed6';
}

function clearReview(){
  if(!confirm('\u786e\u5b9a\u6e05\u7a7a\u5168\u90e8\u590d\u4e60\u5e93\uff1f')) return;
  DB.wrongMap={}; DB.dkMap={}; saveDB(); renderHome(); renderReview();
  showToast('\u5df2\u6e05\u7a7a\u590d\u4e60\u5e93');
}

async function revAnalyze(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry) return;
  var q=entry.q, myAns=entry.myAns||'\u672a\u9009';
  var b=document.getElementById('rib-'+qid);
  if(b) b.style.display='block';
  var aiEl=document.getElementById('ai-'+qid);
  if(!aiEl) return;
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;margin-top:8px">\ud83e\udd16 AI\u89e3\u6790\u4e2d\u2026</div>';
  var prompt='\u8bf7\u5206\u6790\u4ee5\u4e0bPCE\u9488\u7078\u8003\u8bd5\u9898\u76ee\uff1a\n\n'
    +'\u9898\u76ee\uff1a'+q.body+'\n\u9009\u9879\uff1a\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')
    +'\n\u6b63\u786e\u7b54\u6848\uff1a'+(q.answer||'\u672a\u77e5')+'\n\u5b66\u751f\u9009\u62e9\uff1a'+myAns
    +'\n\n\u8bf7\u63d0\u4f9b\uff1a\n\u3010\u9519\u8bef\u539f\u56e0\u3011\uff081-2\u53e5\uff09\n\u3010\u89e3\u9898\u903b\u8f91\u3011\uff082-3\u53e5\uff09\n\u3010\u6838\u5fc3\u77e5\u8bc6\u70b9\u3011\uff082-3\u53e5\uff09\n\u3010\u80cc\u8a35\u6838\u5fc3\u53e5\u30112-4\u53e5\u53e3\u8bc0';
  try{
    var txt=await callClaude(prompt);
    entry.analysis=txt; saveDB();
    renderAI(aiEl,txt);
  }catch(e){
    aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;margin-top:8px">\u274c '+esc(e.message)+'</div>';
  }
}

async function revSimilar(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry) return;
  var q=entry.q;
  var aiEl=document.getElementById('ai-'+qid);
  if(!aiEl) return;
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;margin-top:8px">\u2728 \u751f\u6210\u4e2d\u2026</div>';
  var prompt='\u6839\u636e\u4ee5\u4e0bPCE\u9488\u7078\u8003\u8bd5\u9898\u76ee\uff0c\u751f\u62103\u9053\u540c\u77e5\u8bc6\u70b9\u7ec3\u4e60\u9898\uff1a\n\n'
    +'\u539f\u9898\uff1a'+q.body+'\n\u9009\u9879\uff1a'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')
    +'\n\n\u8981\u6c42\uff1a4\u90091\u5355\u9009\uff0c\u6807\u6ce8\u7b54\u6848\uff0c1\u53e5\u89e3\u6790\u3002\u4e2d\u6587\uff0c\u7a74\u4f4d\u4fdd\u7559\u82f1\u6587\u7f29\u5199\u3002\n\u683c\u5f0f\uff1a\n1. [\u9898\u76ee]\nA. B. C. D.\n\u7b54\u6848\uff1aX\uff5c\u89e3\u6790\uff1a[\u4e00\u53e5\u8bdd]';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;margin-top:8px"><div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:6px">\ud83c\udfaf \u540c\u7c7b\u7ec3\u4e60\u9898</div><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">'+esc(txt)+'</div></div>';
  }catch(e){
    aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;margin-top:8px">\u274c \u751f\u6210\u5931\u8d25</div>';
  }
}

async function analyzeAllWrong(){
  var entries=Object.values(DB.wrongMap).filter(function(e){return !e.analysis;}).slice(0,6);
  if(!entries.length){showToast('\u9519\u9898\u5df2\u5168\u90e8\u89e3\u6790\uff01');return;}
  showToast('\u6b63\u5728\u89e3\u6790 '+entries.length+' \u9053\u9519\u9898\u2026',10000);
  for(var i=0;i<entries.length;i++){
    await revAnalyze(entries[i].q.id);
    await new Promise(function(r){setTimeout(r,500);});
  }
  showToast('\u89e3\u6790\u5b8c\u6210\uff01');
}

async function genSimilarCat(enc){
  var catName=decodeURIComponent(enc);
  var entries=Object.values(DB.dkMap).filter(function(e){return guessCategory(e.q.body)===catName;});
  if(!entries.length){showToast('\u6ca1\u6709\u8be5\u7c7b\u522b\u7684\u9898\u76ee');return;}
  showToast('\u6b63\u5728\u751f\u6210\u300c'+catName+'\u300d\u7ec3\u4e60\u9898\u2026',8000);
  var samples=entries.slice(0,3).map(function(e){return '- '+e.q.body.slice(0,60);}).join('\n');
  var prompt='\u6839\u636ePCE\u9488\u7078\u8003\u8bd5\u300c'+catName+'\u300d\u7c7b\u522b\u7684\u9519\u9898\uff0c\u751f\u62105\u9053\u540c\u7c7b\u7ec3\u4e60\u9898\u3002\n\u5b66\u751f\u9519\u9898\u6837\u672c\uff1a\n'+samples+'\n\n\u8981\u6c42\uff1a\u4e25\u683cPCE\u98ce\u683c\uff0c4\u90091\uff0c\u6807\u6ce8\u7b54\u6848\uff0c\u4e2d\u82f1\u6587\u6df7\u6392\u3002\n\u683c\u5f0f\uff1a\n1. [\u9898\u76ee]\nA. B. C. D.\n\u7b54\u6848\uff1aX\uff5c\u89e3\u6790\uff1a[\u4e00\u53e5\u8bdd]';
  try{
    var txt=await callClaude(prompt);
    var div=document.createElement('div'); div.className='card';
    div.innerHTML='<div class="title">\ud83c\udfaf \u300c'+esc(catName)+'\u300d\u540c\u7c7b\u7ec3\u4e60\u9898</div>'
      +'<div style="white-space:pre-wrap;font-size:13.5px;line-height:1.85;margin-top:10px">'+esc(txt)+'</div>';
    document.getElementById('review-list').prepend(div);
    window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){ showToast('\u751f\u6210\u5931\u8d25: '+e.message); }
}

// ── PRINT ─────────────────────────────────────────────────
function printReport(){
  var wrong=Object.values(DB.wrongMap);
  var dk=Object.values(DB.dkMap);
  if(!wrong.length&&!dk.length){showToast('\u6682\u65e0\u9519\u9898\u6216\u4e0d\u4f1a\u7684\u9898');return;}
  var w=window.open('','_blank');
  if(!w){showToast('\u5f39\u7a97\u88ab\u62e6\u622a\uff0c\u8bf7\u5141\u8bb8\u5f39\u7a97');return;}
  var h=['<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PCE\u590d\u4e60\u62a5\u544a</title>',
    '<style>body{font-family:-apple-system,"PingFang SC",sans-serif;padding:2cm;color:#18180f;font-size:11pt;line-height:1.7}',
    'h1{font-size:20pt;font-weight:700;margin-bottom:8px}.meta{color:#666;margin-bottom:2rem;border-bottom:2px solid #ddd;padding-bottom:1rem}',
    '.sh{font-size:13pt;font-weight:700;padding:7px 14px;border-radius:6px;margin:2rem 0 1rem}',
    '.sw{background:#fdeaea;color:#b83232;border-left:5px solid #b83232}.sdk{background:#fff3cd;color:#c47a1a;border-left:5px solid #c47a1a}',
    '.qb{margin-bottom:1.5rem;padding:1rem;border-radius:8px;page-break-inside:avoid}',
    '.qb.w{background:#fff9f9;border:1px solid #f5c5c5;border-left:5px solid #b83232}',
    '.qb.d{background:#fffdf0;border:1px solid #f5d9a0;border-left:5px solid #c47a1a}',
    '.qn{font-size:9.5pt;color:#888;margin-bottom:3px;font-weight:600}',
    '.qt{font-size:11.5pt;white-space:pre-wrap;margin-bottom:10px;font-weight:500}',
    '.opt{font-size:10.5pt;padding:3px 8px;border-radius:4px;margin-bottom:2px;display:block}',
    '.oc{background:#e8f5ed;color:#2e7d52;font-weight:700}.ow{background:#fdeaea;color:#b83232}',
    '.ai{background:#f0ebff;border:1px solid #d4c9f5;padding:8px 12px;border-radius:6px;margin-top:8px;font-size:10pt;white-space:pre-wrap}',
    '.co{background:#fffbe6;border:1px solid #f0d060;padding:8px 12px;border-radius:6px;margin-top:6px}',
    '.nopr{position:fixed;top:1rem;right:1rem;display:flex;gap:8px}@media print{.nopr{display:none}}',
    '</style></head><body>'];
  h.push('<div class="nopr"><button onclick="window.print()" style="padding:10px 22px;background:#18180f;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600">\ud83d\udda8 \u6253\u5370/\u4fdd\u5b58PDF</button>');
  h.push('<button onclick="window.close()" style="padding:10px 16px;background:#f0efe9;border:1px solid #ccc;border-radius:8px;font-size:14px;cursor:pointer">\u5173\u95ed</button></div>');
  h.push('<h1>PCE \u9488\u7078\u590d\u4e60\u62a5\u544a</h1>');
  h.push('<div class="meta">\u751f\u6210\u65f6\u95f4\uff1a'+new Date().toLocaleString('zh-CN')+' | \u9519\u9898 '+wrong.length+' \u9053 | \u4e0d\u4f1a '+dk.length+' \u9053</div>');

  function rq(e,type){
    var q=e.q,my=e.myAns||'?',an=e.analysis||'';
    var out='<div class="qb '+(type==='wrong'?'w':'d')+'">';
    out+='<div class="qn">\u9898\u53f7 #'+(q.num||'?')+' | '+esc(e.batchName||'')+'</div>';
    if(q.caseText)out+='<div style="background:#fffbe6;border:1px solid #f0d060;padding:7px;border-radius:5px;margin-bottom:8px;font-size:10pt;white-space:pre-wrap">\ud83d\udccb '+esc(q.caseText)+'</div>';
    out+='<div class="qt">'+esc(q.body)+'</div>';
    q.opts.forEach(function(o){
      var cls=(o.letter===(q.answer||''))?'oc':(o.letter===my?'ow':'');
      out+='<span class="opt '+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===q.answer?' \u2713 \u6b63\u786e':'')+(o.letter===my&&o.letter!==q.answer?' \u2190 \u6211\u9009':'')+'</span>';
    });
    if(an){
      var CORE='\u3010\u80cc\u8a35\u6838\u5fc3\u53e5\u3011';
      var ci=an.indexOf(CORE),core=ci>=0?an.slice(ci+CORE.length):'';
      var ni=core.indexOf('\u3010');if(ni>=0)core=core.slice(0,ni);core=core.trim();
      var main=ci>=0?an.slice(0,ci).trim():an.trim();
      out+='<div class="ai"><b>\ud83e\udd16 AI\u89e3\u6790</b><br>'+esc(main)+'</div>';
      if(core){
        out+='<div class="co"><b>\ud83d\udccc \u80cc\u8a35\u6838\u5fc3\u53e5</b><br>';
        core.split('\n').filter(function(s){return s.trim();}).forEach(function(s){
          out+='<div style="padding:2px 0;border-bottom:1px dashed #f0d060">'+esc(s.replace(/^[-\u2022\d.、,]+\s*/,''))+'</div>';
        });
        out+='</div>';
      }
    }
    out+='</div>';
    return out;
  }

  if(wrong.length){
    h.push('<div class="sh sw">\u2717 \u9519\u9898\uff08'+wrong.length+'\u9053\uff09</div>');
    wrong.forEach(function(e){h.push(rq(e,'wrong'));});
  }
  if(dk.length){
    h.push('<div class="sh sdk">\u2753 \u4e0d\u4f1a\u7684\u9898\uff08'+dk.length+'\u9053\uff09</div>');
    dk.forEach(function(e){h.push(rq(e,'dk'));});
  }
  h.push('</body></html>');
  w.document.write(h.join(''));
  w.document.close();
}

function downloadCSV(){
  var csv='\u9898\u53f7,\u9898\u76ee,\u6211\u9009,\u6b63\u786e\u7b54\u6848,\u7ed3\u679c\n';
  QZ.qs.forEach(function(q,i){
    var my=QZ.ans[i]||'\u2014',ans=q.answer||'\u2014';
    var res=q.answer&&my!=='\u2014'?(my.toUpperCase()===q.answer.toUpperCase()?'\u6b63\u786e':'\u9519\u8bef'):'\u2014';
    csv+=(q.num||i+1)+',"'+q.body.replace(/"/g,'""').replace(/\n/g,' ')+'",'+my+','+ans+','+res+'\n';
  });
  var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='\u7b54\u9898\u7ed3\u679c.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── MOCK ──────────────────────────────────────────────────
function renderMockSetup(){
  var total=DB.batches.reduce(function(s,b){return s+b.questions.length;},0);
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="title">\u6a21\u62df\u8003\u8bd5</div><div class="sub">\u4eff Pan Canada \u9488\u7078\u8003\u8bd5 \u2014 125\u9898 / 2.5\u5c0f\u65f6</div>'
    +'<div class="grid">'
    +'<div class="stat"><div class="k">\u9898\u76ee\u6570\u91cf</div><div class="v">125</div></div>'
    +'<div class="stat"><div class="k">\u8003\u8bd5\u65f6\u957f</div><div class="v">2.5h</div></div>'
    +'<div class="stat"><div class="k">\u53ef\u7528\u9898\u76ee</div><div class="v">'+total+'</div></div>'
    +'</div>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:1rem">'
    +'<input type="checkbox" id="mock-wrong-cb"> \u9519\u9898\u52a0\u500d\u51fa\u73b0'
    +'</label>'
    +'<button class="btn primary" onclick="startMock()">\u5f00\u59cb\u6a21\u62df\u8003\u8bd5</button></div>';
}

var MK={qs:[],ans:[],cur:0,start:0,interval:null};

function startMock(){
  var allQs=[];
  DB.batches.forEach(function(b){allQs=allQs.concat(b.questions);});
  if(!allQs.length){alert('\u8bf7\u5148\u5bfc\u5165\u9898\u76ee\u3002');return;}
  var pool=allQs.slice();
  var cb=document.getElementById('mock-wrong-cb');
  if(cb&&cb.checked){
    var wids=Object.keys(DB.wrongMap);
    pool=pool.concat(allQs.filter(function(q){return wids.indexOf(q.id)>=0;}));
  }
  pool=shuffle(pool).slice(0,125);
  MK={qs:pool,ans:new Array(pool.length).fill(null),cur:0,start:Date.now(),interval:null};
  renderMockQ();
}

function renderMockQ(){
  var q=MK.qs[MK.cur];
  var answered=MK.ans.filter(function(a){return !!a;}).length;
  clearInterval(MK.interval);
  var rem=150*60-Math.round((Date.now()-MK.start)/1000);
  if(rem<=0){finishMock();return;}

  var optsHTML=q.opts.map(function(o){
    var sel=MK.ans[MK.cur]===o.letter?' sel':'';
    return '<button class="opt'+sel+'" onclick="mockPick(\''+o.letter+'\')">'
      +'<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span></button>';
  }).join('');

  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="qtop"><div><div class="qcount">\u7b2c <strong>'+(MK.cur+1)+'</strong> / '+MK.qs.length+' \u9898</div>'
    +'<div class="sub">\u5df2\u7b54 '+answered+' \u9898</div></div>'
    +'<div id="mock-timer" class="timer spacer green"></div></div>'
    +(q.caseText?'<div id="casebox" style="display:block;background:#fffbe6;border:1.5px solid #f0d060;border-radius:8px;padding:12px 16px;margin-bottom:1rem;font-size:14px;line-height:1.8;white-space:pre-wrap"><div style="font-size:11px;font-weight:700;color:#8a6000;margin-bottom:6px">📋 \u75c5\u4f8b\u8d44\u6599</div>'+esc(q.caseText)+'</div>':'')
    +'<div class="qbody">'+esc(q.body)+'</div>'
    +'<div class="opts">'+optsHTML+'</div>'
    +'<div class="row actions">'
    +'<button class="btn small" onclick="mPrev()">\u2190 \u4e0a\u4e00\u9898</button>'
    +'<button class="btn small primary" onclick="mNext()">\u4e0b\u4e00\u9898 \u2192</button>'
    +'<button class="btn small red spacer" onclick="finishMock()">\u4ea4\u5377</button>'
    +'</div></div>';

  MK.interval=setInterval(function(){
    var el=document.getElementById('mock-timer');
    if(!el){clearInterval(MK.interval);return;}
    var r=150*60-Math.round((Date.now()-MK.start)/1000);
    if(r<=0){clearInterval(MK.interval);finishMock();return;}
    var h=Math.floor(r/3600),m=Math.floor((r%3600)/60),s=r%60;
    el.textContent=h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;
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
  var h=Math.floor(elapsed/3600),m=Math.floor((elapsed%3600)/60),s=elapsed%60;
  var timeStr=(h?h+'h ':'')+m+'m '+s+'s';
  var correct=0,wrong=0;
  var withAns=MK.qs.filter(function(q){return !!q.answer;}).length;
  var rows='';
  MK.qs.forEach(function(q,i){
    var my=MK.ans[i],hasAns=!!q.answer;
    var ok=hasAns&&my&&my.toUpperCase()===(q.answer||'').toUpperCase();
    if(ok)correct++;
    if(hasAns&&my&&!ok){wrong++;DB.wrongMap[q.id]={q:q,batchId:'mock',batchName:'\u6a21\u62df\u8003\u8bd5',myAns:my};}
    var prev=q.body.replace(/\n/g,' ').slice(0,40);
    rows+='<tr><td>'+(i+1)+'</td><td>'+esc(prev)+'</td>'
      +'<td>'+(my||'\u2014')+'</td><td>'+(hasAns?'<b>'+q.answer+'</b>':'\u2014')+'</td>'
      +'<td>'+(hasAns&&my?(ok?'<span style="color:green">\u2713</span>':'<span style="color:red">\u2717</span>'):'\u2014')+'</td></tr>';
  });
  saveDB(); renderHome();
  var rate=withAns?Math.round(correct/withAns*100):0;
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="title">\u6a21\u62df\u8003\u8bd5\u7ed3\u679c</div>'
    +'<div class="grid">'
    +'<div class="stat"><div class="k">\u603b\u9898</div><div class="v">'+MK.qs.length+'</div></div>'
    +'<div class="stat"><div class="k">\u7b54\u5bf9</div><div class="v" style="color:green">'+correct+'</div></div>'
    +'<div class="stat"><div class="k">\u7b54\u9519</div><div class="v" style="color:red">'+wrong+'</div></div>'
    +'<div class="stat"><div class="k">\u6b63\u786e\u7387</div><div class="v">'+rate+'%</div></div>'
    +'<div class="stat"><div class="k">\u7528\u65f6</div><div class="v">'+timeStr+'</div></div>'
    +'<div class="stat"><div class="k">PCE\u9884\u4f30</div><div class="v">'+(rate>=70?'\ud83d\udfe2 \u901a\u8fc7':'\ud83d\udd34 \u9700\u52a0\u5f3a')+'</div></div>'
    +'</div>'
    +'<div class="row mt"><button class="btn primary" onclick="renderMockSetup()">\u518d\u8003\u4e00\u6b21</button>'
    +'<button class="btn" onclick="showPage(\'review\');renderReview()">\u67e5\u770b\u9519\u9898</button></div>'
    +'<div class="tablewrap"><table><thead><tr><th>\u9898\u53f7</th><th>\u9898\u76ee</th><th>\u6211\u9009</th><th>\u7b54\u6848</th><th>\u7ed3\u679c</th></tr></thead>'
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
  if(!DB.batches.length){list.innerHTML='<div class="sub">\u5bfc\u5165\u540e\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002</div>';return;}
  list.innerHTML='';
  DB.batches.slice().reverse().forEach(function(b){
    var p=b.progress;
    var done=p.answers.filter(function(a){return a&&a!=='skip';}).length;
    var prog=Math.round(done/b.questions.length*100);
    var div=document.createElement('div'); div.className='batch-row';
    div.innerHTML='<span class="batch-name">'+esc(b.name)+'</span>'
      +'<span class="batch-meta">'+b.questions.length+'\u9898 '+prog+'%</span>';
    [
      {t:'\u7ee7\u7eed',fn:function(){startBatch(b.id,false);}},
      {t:'\u91cd\u6765',fn:function(){
        if(!confirm('\u4ece\u7b2c\u4e00\u9898\u91cd\u65b0\u5f00\u59cb\u201c'+b.name+'\u201d\uff1f'))return;
        b.progress={idx:0,answers:new Array(b.questions.length).fill(null),dk:{}}; saveDB(); startBatch(b.id,true);
      }},
      {t:'\u6539\u540d',fn:function(){
        var n=prompt('\u4fee\u6539\u540d\u79f0\uff1a',b.name); if(!n)return;
        b.name=n.trim(); saveDB(); renderHome();
      }},
      {t:'\u5220\u9664',fn:function(){
        if(!confirm('\u786e\u5b9a\u5220\u9664\uff1f'))return;
        DB.batches=DB.batches.filter(function(x){return x.id!==b.id;}); saveDB(); renderHome();
      }}
    ].forEach(function(item){
      var btn=document.createElement('button'); btn.className='btn small'; btn.textContent=item.t;
      btn.addEventListener('click',item.fn); div.appendChild(btn);
    });
    list.appendChild(div);
  });
  document.getElementById('mock-avail')||0;
}

// ── FIREBASE ──────────────────────────────────────────────
function saveFirebaseConfig(){
  var raw=document.getElementById('firebase-config').value.trim();
  if(!raw){showToast('\u8bf7\u7c98\u8d34 Firebase \u914d\u7f6e');return;}
  try{
    var cfg=JSON.parse(raw);
    localStorage.setItem('firebase_cfg',JSON.stringify(cfg));
    showToast('\u2713 \u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u8bf7\u5237\u65b0\u9875\u9762\u540e\u767b\u5f55');
  }catch(e){showToast('JSON\u683c\u5f0f\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5');}
}
function loadFirebaseConfigToBox(){
  var s=localStorage.getItem('firebase_cfg');
  if(s) document.getElementById('firebase-config').value=JSON.stringify(JSON.parse(s),null,2);
  else showToast('\u5c1a\u672a\u4fdd\u5b58\u914d\u7f6e');
}
(function(){
  var cfg=localStorage.getItem('firebase_cfg'); if(!cfg)return;
  var config; try{config=JSON.parse(cfg);}catch(e){return;}
  function load(url,cb){var s=document.createElement('script');s.src=url;s.onload=cb;document.head.appendChild(s);}
  load('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',function(){
    load('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',function(){
      load('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',function(){
        try{if(!firebase.apps.length)firebase.initializeApp(config);document.getElementById('cloud-status').textContent='Firebase \u5df2\u8fde\u63a5\uff0c\u8bf7\u767b\u5f55\u3002';}catch(e){}
      });
    });
  });
})();
function initCloudInputs() {
  var savedEmail = localStorage.getItem('cloud_email');
  if (savedEmail) {
    var el = document.getElementById('cloud-email');
    if (el) el.value = savedEmail;
  }
  // Auto-save email on change
  var emailEl = document.getElementById('cloud-email');
  if (emailEl) {
    emailEl.addEventListener('change', function(){
      localStorage.setItem('cloud_email', this.value.trim());
    });
  }
  // Try auto-login if token exists
  setTimeout(function(){
    if (typeof firebase !== 'undefined') {
      firebase.auth().onAuthStateChanged(function(user){
        var st = document.getElementById('cloud-status');
        if (user && st) st.textContent = '✓ 已登录：' + user.email;
      });
    }
  }, 2000);
}
function cloudRegister(){
  var email=document.getElementById('cloud-email').value.trim();
  var pass=document.getElementById('cloud-pass').value;
  if (email) localStorage.setItem('cloud_email', email);
  if(typeof firebase==='undefined'){showToast('\u8bf7\u5148\u4fdd\u5b58Firebase\u914d\u7f6e\u5e76\u5237\u65b0');return;}
  firebase.auth().createUserWithEmailAndPassword(email,pass)
    .then(function(){document.getElementById('cloud-status').textContent='\u2713 \u6ce8\u518c\u6210\u529f\uff0c\u5df2\u767b\u5f55\uff1a'+email;})
    .catch(function(e){document.getElementById('cloud-status').textContent='\u6ce8\u518c\u5931\u8d25\uff1a'+e.message;});
}
function cloudLogin(){
  var email=document.getElementById('cloud-email').value.trim();
  var pass=document.getElementById('cloud-pass').value;
  if(typeof firebase==='undefined'){showToast('\u8bf7\u5148\u4fdd\u5b58Firebase\u914d\u7f6e\u5e76\u5237\u65b0');return;}
  firebase.auth().signInWithEmailAndPassword(email,pass)
    .then(function(){document.getElementById('cloud-status').textContent='\u2713 \u5df2\u767b\u5f55\uff1a'+email;})
    .catch(function(e){document.getElementById('cloud-status').textContent='\u767b\u5f55\u5931\u8d25\uff1a'+e.message;});
}
function cloudLogout(){
  if(typeof firebase==='undefined')return;
  firebase.auth().signOut().then(function(){document.getElementById('cloud-status').textContent='\u5df2\u9000\u51fa\u3002';});
}
function cloudUpload(){
  if(typeof firebase==='undefined'){showToast('\u8bf7\u5148\u914d\u7f6e\u5e76\u767b\u5f55Firebase');return;}
  var user=firebase.auth().currentUser; if(!user){showToast('\u8bf7\u5148\u767b\u5f55');return;}
  firebase.firestore().collection('users').doc(user.uid).set({db:JSON.stringify(DB)})
    .then(function(){showToast('\u2713 \u6570\u636e\u5df2\u4e0a\u4f20\u5230\u4e91\u7aef');})
    .catch(function(e){showToast('\u4e0a\u4f20\u5931\u8d25\uff1a'+e.message);});
}
function cloudDownload(){
  if(typeof firebase==='undefined'){showToast('\u8bf7\u5148\u914d\u7f6e\u5e76\u767b\u5f55Firebase');return;}
  var user=firebase.auth().currentUser; if(!user){showToast('\u8bf7\u5148\u767b\u5f55');return;}
  firebase.firestore().collection('users').doc(user.uid).get()
    .then(function(doc){
      if(!doc.exists){showToast('\u4e91\u7aef\u6682\u65e0\u6570\u636e');return;}
      DB=JSON.parse(doc.data().db); saveDB(); renderHome();
      showToast('\u2713 \u5df2\u4ece\u4e91\u7aef\u4e0b\u8f7d\u6570\u636e');
    })
    .catch(function(e){showToast('\u4e0b\u8f7d\u5931\u8d25\uff1a'+e.message);});
}

// ── UTILS ─────────────────────────────────────────────────
function shuffle(a){ return a.slice().sort(function(){return Math.random()-.5;}); }

// ── INIT ──────────────────────────────────────────────────
renderHome();
// Init key inputs after DOM ready
setTimeout(function(){
  initApiKeyInput();
  initCloudInputs();
  // Show bottom nav on mobile
  var bn = document.getElementById('bottom-nav');
  if (bn && window.innerWidth <= 640) {
    bn.style.display = 'flex';
    // Add padding to main to avoid overlap
    var main = document.querySelector('main');
    if (main) main.style.paddingBottom = '80px';
  }
}, 100);
