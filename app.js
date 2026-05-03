// ═══════════════════════════════════════════════════════
// PCE 针灸答题器 — app.js
// 适配 rosaria12-2026/testapp1 的 index.html
// 新增：AI解析、计时器暂停、不会题归纳分析
// ═══════════════════════════════════════════════════════

// ── DB ──────────────────────────────────────────────────
var DBKEY = 'pce_db_v4';
var DB = loadDB();
function loadDB() {
  try { return JSON.parse(localStorage.getItem(DBKEY)) || makeDB(); }
  catch(e) { return makeDB(); }
}
function makeDB() {
  return { batches:[], wrongMap:{}, dkMap:{}, stats:{done:0,correct:0} };
}
function saveDB() {
  try { localStorage.setItem(DBKEY, JSON.stringify(DB)); } catch(e) {}
}

// ── NAVIGATION ──────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var pg = document.getElementById(name);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  var tab = document.querySelector('.tab[data-page="'+name+'"]');
  if (tab) tab.classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){ showPage(t.dataset.page); });
});

// ── TOAST ────────────────────────────────────────────────
function showToast(msg, dur) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show';
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.className = ''; }, dur||2500);
}

// ── FILE UPLOAD ──────────────────────────────────────────
var fileInput = document.getElementById('file-input');
if (fileInput) {
  fileInput.addEventListener('change', function(e){
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      document.getElementById('raw').value = ev.target.result;
      document.getElementById('upload-status').textContent = '✓ 已读取：' + file.name;
    };
    reader.readAsText(file, 'utf-8');
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
  // 答案识别：【答案：A】 Answer: A  答案：A
  var ansRe = /[\u3010\[]?[\u7b54\u6848Aa][\u6848nswer]*[\uff1a:]\s*([A-Ea-e])[\u3011\]]?/i;
  // 病例资料识别
  var caseRe = /\u6839\u636e\u4ee5\u4e0b|\u6839\u636e\u4e0b\u5217|\u4ee5\u4e0b\u75c5\u4f8b|following case|following scenario/i;

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

    var am = l.match(ansRe);
    if (am && curQ){ curQ.answer=am[1].toUpperCase(); continue; }

    var qm = l.match(qRe);
    if (qm){ push(); curQ={num:parseInt(qm[1]),body:qm[2].trim(),opts:[],answer:null,id:uid(),caseText:null}; continue; }
    if (!curQ) continue;

    var om = l.match(optRe);
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

  // 传播病例到同组题目
  blocks.forEach(function(q){
    if (!q.caseText) return;
    var rm = q.caseText.match(/(\d{1,4})\s*[-\u2013~]\s*(\d{1,4})/);
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
  if (!raw){ msg.textContent='请先粘贴题目。'; msg.style.color='var(--red,#b83232)'; return; }
  var qs = parseQ(raw);
  if (!qs.length){ msg.textContent='未识别到题目，请检查格式。'; msg.style.color='var(--red,#b83232)'; return; }
  var bname = name || ('批次'+(DB.batches.length+1)+' — '+new Date().toLocaleDateString('zh-CN'));
  var batch = {id:uid(),name:bname,date:Date.now(),questions:qs,
    progress:{idx:0,answers:new Array(qs.length).fill(null),dk:{}}};
  DB.batches.push(batch); saveDB(); renderHome();
  msg.textContent='✓ 导入 '+qs.length+' 道题 → "'+bname+'"';
  msg.style.color='var(--green,#2e7d52)';
  document.getElementById('raw').value='';
  document.getElementById('batch-name').value='';
  if (start) setTimeout(function(){ startBatch(batch.id,false); },400);
}

// ── QUIZ ENGINE ──────────────────────────────────────────
var CIRC = 2*Math.PI*23;
var QZ = {batch:null,qs:[],ans:[],dk:{},cur:0,sel:null,tmr:null,tLeft:60,tMax:60,paused:false,_st:null};

function resumeQuiz(){
  var batch=null;
  for(var i=0;i<DB.batches.length;i++){
    var b=DB.batches[i],p=b.progress;
    for(var j=0;j<b.questions.length;j++){ if(!p.answers[j]){batch=b;break;} }
    if(batch) break;
  }
  if(!batch){ alert(DB.batches.length?'所有批次已全部作答完毕！':'请先导入题目。'); return; }
  startBatch(batch.id,false);
}

function startFirstBatch(fromStart){
  if(!DB.batches.length){alert('请先导入题目。');return;}
  var batch=DB.batches[0];
  if(fromStart){
    if(!confirm('从第一题重新开始"'+batch.name+'"？')) return;
    batch.progress={idx:0,answers:new Array(batch.questions.length).fill(null),dk:{}};
    saveDB();
  }
  startBatch(batch.id,fromStart);
}

function startBatch(batchId,fromStart){
  var batch=null;
  for(var i=0;i<DB.batches.length;i++){ if(DB.batches[i].id===batchId){batch=DB.batches[i];break;} }
  if(!batch) return;
  var tMax=parseInt(document.getElementById('limit').value)||60;
  var p=batch.progress;
  QZ={
    batch:batch,qs:batch.questions,
    ans:fromStart?new Array(batch.questions.length).fill(null):p.answers.slice(),
    dk:fromStart?{}:(p.dk||{}),
    cur:fromStart?0:(p.idx||0),
    sel:null,tmr:null,tLeft:tMax,tMax:tMax,paused:false,_st:null
  };
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

  // 病例资料
  var cb=document.getElementById('casebox'); cb.innerHTML='';
  if(q.caseText){
    cb.innerHTML='<div class="case-title">📋 病例资料（本题组共用）</div>'
      +'<div class="case-text">'+esc(q.caseText)+'</div>';
    cb.style.display='block';
  } else { cb.style.display='none'; }

  // 不会按钮状态
  var dkbtn=document.getElementById('dkbtn');
  dkbtn.classList.toggle('on',!!QZ.dk[i]);

  // 选项
  var optsEl=document.getElementById('opts'); optsEl.innerHTML='';
  q.opts.forEach(function(o){
    var btn=document.createElement('button'); btn.className='opt';
    btn.innerHTML='<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span>';
    var prev=QZ.ans[i];
    if(prev&&prev!=='skip'&&prev===o.letter){ btn.classList.add('sel'); QZ.sel=prev; }
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

// ── TIMER (带暂停) ────────────────────────────────────────
function startTimer(){
  var timerEl=document.getElementById('timer');
  if(QZ.tMax===0){ timerEl.textContent='∞'; timerEl.className='timer spacer'; return; }
  QZ.tLeft=QZ.tMax; updTimer();
  QZ.tmr=setInterval(function(){
    if(QZ.paused) return;
    QZ.tLeft--; updTimer();
    if(QZ.tLeft<=0){ clearInterval(QZ.tmr); autoSave(QZ.cur,QZ.sel||'skip'); advanceQ(); }
  },1000);
}

function updTimer(){
  var el=document.getElementById('timer');
  var pct=QZ.tLeft/QZ.tMax;
  el.textContent=QZ.paused?('⏸ '+QZ.tLeft):QZ.tLeft;
  el.className='timer spacer'+(QZ.paused?' paused':pct>.5?' green':pct>.2?' orange':' red');
}

// 点击计时器暂停/继续
document.getElementById('timer').addEventListener('click',function(){
  if(QZ.tMax===0) return;
  QZ.paused=!QZ.paused;
  updTimer();
  if(!QZ.paused) showToast('继续计时');
  else showToast('⏸ 已暂停，点击继续');
});

function nextQ(){ clearInterval(QZ.tmr); autoSave(QZ.cur,QZ.sel||'skip'); advanceQ(); }
function skipQ(){ clearInterval(QZ.tmr); autoSave(QZ.cur,'skip'); QZ.sel=null; advanceQ(); }
function prevQ(){
  clearInterval(QZ.tmr);
  if(QZ.sel) autoSave(QZ.cur,QZ.sel);
  if(QZ.cur>0){ QZ.cur--; loadQ(QZ.cur); }
}
function toggleDK(){
  QZ.dk[QZ.cur]=!QZ.dk[QZ.cur];
  document.getElementById('dkbtn').classList.toggle('on',!!QZ.dk[QZ.cur]);
  autoSave(QZ.cur,QZ.sel||QZ.ans[QZ.cur]||'skip');
  if(QZ.dk[QZ.cur]) showToast('已标记「不会」，将加入专项复习');
  else showToast('已取消「不会」标记');
}
function advanceQ(){
  if(QZ.cur+1>=QZ.qs.length){ finishQuiz(); return; }
  QZ.cur++; loadQ(QZ.cur);
}
function finishQuiz(){
  clearInterval(QZ.tmr);
  for(var i=0;i<QZ.ans.length;i++){ if(!QZ.ans[i]) QZ.ans[i]='skip'; }
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
      if(ok){ DB.stats.correct=(DB.stats.correct||0)+1; delete DB.wrongMap[q.id]; }
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
    if(ok) correct++; if(bad) wrong++; if(dk) dkCount++;
    var preview=q.body.replace(/\n/g,' ').slice(0,40);
    var tr=document.createElement('tr');
    tr.style.cursor='pointer';
    tr.title='点击查看详情与AI解析';
    (function(qid,idx){ tr.addEventListener('click',function(){ openDetailModal(qid,idx); }); })(q.id,i);
    tr.innerHTML='<td><strong>'+(q.num||i+1)+'</strong></td>'
      +'<td>'+esc(preview)+(dk?'<span class="dk-tag">❓</span>':'')+'</td>'
      +'<td>'+(my&&my!=='skip'?my:'—')+'</td>'
      +'<td>'+(hasAns?'<b>'+q.answer+'</b>':'—')+'</td>'
      +'<td>'+(hasAns&&my&&my!=='skip'?(ok?'<span class="greentext">✓</span>':'<span class="redtext">✗</span>'):'—')+'</td>'
      +'<td><button class="btn small blue" onclick="event.stopPropagation();openDetailModal(\''+q.id+'\','+i+')" style="padding:3px 10px;font-size:12px">解析</button></td>';
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
    var key=keyMap[i];if(!key) return;
    q.answer=key;updated++;
    var my=QZ.ans[i];
    if(my&&my!=='skip'&&my.toUpperCase()===key) correct++;
  });
  showResultPage();
  msg=document.getElementById('key-msg');
  msg.textContent='✓ 已对比 '+updated+' 题，答对 '+correct+' 题。';
  msg.style.color='var(--green,#2e7d52)';
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

  // 不会题归纳分析卡片
  if(dkEntries.length){
    var cats={};
    dkEntries.forEach(function(e){
      var cat=guessCategory(e.q.body);
      if(!cats[cat]) cats[cat]=[];
      cats[cat].push(e);
    });
    var catHTML='<div class="card"><div class="row"><div class="title">❓ 不会的题 — 归纳分析</div>'
      +'<span class="sub spacer">共 '+dkEntries.length+' 道</span>'
      +'<button class="btn blue small" onclick="aiAnalyzeAllDK()">AI全部解析</button></div>'
      +'<div class="dk-cats">';
    Object.keys(cats).forEach(function(catName){
      var items=cats[catName];
      catHTML+='<div class="dk-cat-card">'
        +'<div class="dk-cat-name">'+esc(catName)+'</div>'
        +'<div class="dk-cat-count">'+items.length+' 道</div>'
        +'<button class="btn small blue" onclick="genSimilarByCategory(\''+encodeURIComponent(catName)+'\')">生成同类练习</button>'
        +'</div>';
    });
    catHTML+='</div>';
    // 列出所有不会题
    catHTML+='<div class="review-items">';
    dkEntries.forEach(function(e){
      catHTML+=reviewItemHTML(e,'dk');
    });
    catHTML+='</div></div>';
    list.innerHTML+=catHTML;
  }

  // 错题区
  if(wrongEntries.length){
    var wrongHTML='<div class="card"><div class="row"><div class="title">✗ 错题库</div>'
      +'<span class="sub spacer">共 '+wrongEntries.length+' 道</span>'
      +'<button class="btn blue small" onclick="aiAnalyzeAllWrong()">AI全部解析</button></div>'
      +'<div class="review-items">';
    wrongEntries.forEach(function(e){ wrongHTML+=reviewItemHTML(e,'wrong'); });
    wrongHTML+='</div></div>';
    list.innerHTML+=wrongHTML;
  }
}

function reviewItemHTML(entry,type){
  var q=entry.q, myAns=entry.myAns||'?';
  var preview=q.body.replace(/\n/g,' ').slice(0,55);
  var tagHTML=type==='dk'
    ?'<span class="dk-tag">❓不会</span>'
    :'<span class="wrong-tag">✗ 我选'+myAns+'</span>';
  return '<div class="review-item" id="ri-'+q.id+'">'
    +'<div class="ri-head" onclick="toggleReviewItem(\''+q.id+'\')">'
    +'<span class="ri-num">#'+(q.num||'?')+'</span>'
    +'<span class="ri-prev">'+esc(preview)+'</span>'
    +tagHTML
    +'<button class="btn small blue" onclick="event.stopPropagation();document.getElementById(\'rib-'+q.id+'\').style.display=\'block\';revAnalyze(\''+q.id+'\')" style="flex-shrink:0;margin-left:auto">🔍 解析</button>'
    +'</div>'
    +'<div class="ri-body" id="rib-'+q.id+'" style="display:none">'
    +(q.caseText?'<div class="case-mini">📋 '+esc(q.caseText)+'</div>':'')
    +'<div class="ri-qtext">'+esc(q.body)+'</div>'
    +'<div class="ri-opts">'+q.opts.map(function(o){
      var cls=(o.letter===(q.answer||''))?'correct':(o.letter===myAns?'wrong':'');
      return '<div class="ri-opt '+cls+'">'+o.letter+'. '+esc(o.text)
        +(o.letter===q.answer?' ✓ 正确':'')
        +(o.letter===myAns&&o.letter!==q.answer?' ← 我选':'')+'</div>';
    }).join('')+'</div>'
    +'<div class="ri-actions">'
    +'<button class="btn small blue" onclick="revAnalyze(\''+q.id+'\')" >🔍 AI解析</button>'
    +'<button class="btn small" onclick="revSimilar(\''+q.id+'\')" >✨ 同类题</button>'
    +'</div>'
    +'<div id="ai-'+q.id+'"></div>'
    +'</div></div>';
}

function toggleReviewItem(id){
  var body=document.getElementById('rib-'+id);
  if(body) body.style.display=body.style.display==='none'?'block':'none';
}

function guessCategory(body){
  var kws=[
    ['\u9488\u523a\u624b\u6cd5','\u8865\u6cfb','\u63d0\u63d2','\u634d\u8f6c','\u5f97\u6c14'],['\u7ecf\u7edc','\u7ecf\u8109','\u7edc\u8109','\u5947\u7ecf','\u516b\u8109'],
    ['\u8150\u7a74','\u53d6\u7a74','\u5b9a\u4f4d','\u4e3b\u6cbb','\u7a74\u4f4d'],['\u4e94\u884c','\u76f8\u751f','\u76f8\u514b','\u751f\u514b'],
    ['\u810f\u8154','\u5fc3','\u809d','\u813e','\u80ba','\u8086','\u80c3','\u80c6','\u819a\u80f1','\u4e09\u7126'],['\u75c5\u56e0','\u75c5\u673a','\u8bc1\u5019','\u8fa8\u8bc1'],
    ['\u6d88\u6bd2','\u706d\u83cc','\u611f\u67d3','\u536b\u751f'],['\u897f\u533b','\u89e3\u5256','\u795e\u7ecf','\u808c\u8089','\u9aa8'],['\u836f\u7269','\u4e2d\u836f','\u914d\u4f0d','\u65b9\u5242'],
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

// ── AI ────────────────────────────────────────────────────
async function callClaude(prompt){
  var key=getApiKey();
  if(!key){
    throw new Error('请先在云同步页面设置 Claude API Key');
  }
  var resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
      'x-api-key':key
    },
    body:JSON.stringify({
      model:'claude-sonnet-4-20250514',
      max_tokens:1024,
      system:'你是PCE（Pan-Canada针灸考试）辅导专家，回答简洁精准，用中文。',
      messages:[{role:'user',content:prompt}]
    })
  });
  if(!resp.ok) throw new Error('API错误 '+resp.status);
  var d=await resp.json();
  return (d.content&&d.content[0]&&d.content[0].text)||'(无响应)';
}

function renderAI(el,txt){
  var CORE_KEY='\u3010\u80cc\u8a35\u6838\u5fc3\u53e5\u3011';
  var BRACKET='\u3010';
  var coreIdx=txt.indexOf(CORE_KEY);
  var core=coreIdx>=0?txt.slice(coreIdx+CORE_KEY.length):'';
  var ni=core.indexOf(BRACKET); if(ni>=0) core=core.slice(0,ni); core=core.trim();
  var main=coreIdx>=0?txt.slice(0,coreIdx).trim():txt.trim();
  var html='<div class="ai-box"><div class="ai-title">\ud83e\udd16 AI\u89e3\u6790</div><div class="ai-body">'+esc(main)+'</div></div>';
  if(core){
    var lines=core.split('\n').filter(function(s){return s.trim();});
    html+='<div class="core-box"><div class="core-title">\ud83d\udccc \u80cc\u8a35\u6838\u5fc3\u53e5</div>'
      +lines.map(function(s){return '<div class="core-item">'+esc(s.replace(/^[-\u2022\d.、,]+\s*/,''))+'</div>';}).join('')+'</div>';
  }
  el.innerHTML=html;
}

async function revAnalyze(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry) return;
  var q=entry.q, myAns=entry.myAns||'\u672a\u9009';
  var aiEl=document.getElementById('ai-'+qid);
  aiEl.innerHTML='<div class="ai-box loading">\ud83e\udd16 AI\u89e3\u6790\u4e2d\u2026</div>';
  var prompt='\u8bf7\u5206\u6790\u4ee5\u4e0bPCE\u9488\u7078\u8003\u8bd5\u9898\u76ee\uff1a\n\n'
    +'\u9898\u76ee\uff1a'+q.body+'\n\u9009\u9879\uff1a\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')
    +'\n\u6b63\u786e\u7b54\u6848\uff1a'+(q.answer||'\u672a\u77e5')+'\n\u5b66\u751f\u9009\u62e9\uff1a'+myAns
    +'\n\n\u8bf7\u63d0\u4f9b\uff1a\n\u3010\u9519\u8bef\u539f\u56e0\u3011\u4e3a\u4ec0\u4e48\u5bb9\u6613\u9009\u9519\uff081-2\u53e5\uff09\n\u3010\u89e3\u9898\u903b\u8f91\u3011\u6b63\u786e\u601d\u7ef4\u8def\u5f842-3\u53e5\uff09\n\u3010\u6838\u5fc3\u77e5\u8bc6\u70b9\u3011\u5fc5\u987b\u638c\u63e1\u7684\u539f\u7406\uff082-3\u53e5\uff09\n\u3010\u80cc\u8a35\u6838\u5fc3\u53e5\u30112-4\u53e5\u7b80\u6d01\u53e3\u8bc0\uff0c\u6717\u6717\u4e0a\u53e3';
  try{
    var txt=await callClaude(prompt);
    entry.analysis=txt; saveDB();
    renderAI(aiEl,txt);
  }catch(e){
    aiEl.innerHTML='<div class="ai-box"><div style="color:#b83232">\u274c '+esc(e.message)+'</div></div>';
  }
}

async function revSimilar(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry) return;
  var q=entry.q;
  var aiEl=document.getElementById('ai-'+qid);
  aiEl.innerHTML='<div class="ai-box loading">\u2728 \u751f\u6210\u540c\u7c7b\u9898\u4e2d\u2026</div>';
  var prompt='\u6839\u636e\u4ee5\u4e0bPCE\u9488\u7078\u8003\u8bd5\u9898\u76ee\uff0c\u751f\u62103\u9053\u540c\u77e5\u8bc6\u70b9\u7ec3\u4e60\u9898\uff1a\n\n'
    +'\u539f\u9898\uff1a'+q.body+'\n\u9009\u9879\uff1a'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')
    +'\n\n\u8981\u6c42\uff1a4\u90091\u5355\u9009\uff0c\u6807\u6ce8\u7b54\u6848\uff0c1\u53e5\u89e3\u6790\u3002\u4e2d\u6587\uff0c\u7a74\u4f4d\u4fdd\u7559\u82f1\u6587\u7f29\u5199\u3002\n\u683c\u5f0f\uff1a\n1. [\u9898\u76ee]\nA. B. C. D.\n\u7b54\u6848\uff1aX\uff5c\u89e3\u6790\uff1a[\u4e00\u53e5\u8bdd]';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div class="ai-box"><div class="ai-title">\ud83c\udfaf \u540c\u7c7b\u7ec3\u4e60\u9898</div><div class="ai-body">'+esc(txt)+'</div></div>';
  }catch(e){
    aiEl.innerHTML='<div class="ai-box"><div style="color:#b83232">\u274c \u751f\u6210\u5931\u8d25</div></div>';
  }
}

async function genSimilarByCategory(catEncoded){
  var catName=decodeURIComponent(catEncoded);
  var dkEntries=Object.values(DB.dkMap).filter(function(e){return guessCategory(e.q.body)===catName;});
  if(!dkEntries.length){showToast('\u6ca1\u6709\u8be5\u7c7b\u522b\u7684\u9898\u76ee');return;}
  var samples=dkEntries.slice(0,3).map(function(e){return '- '+e.q.body.slice(0,60);}).join('\n');
  showToast('\u6b63\u5728\u751f\u6210\u300c'+catName+'\u300d\u7ec3\u4e60\u9898\u2026',8000);
  var prompt='\u6839\u636ePCE\u9488\u7078\u8003\u8bd5\u300c'+catName+'\u300d\u7c7b\u522b\u7684\u9519\u9898\uff0c\u751f\u62105\u9053\u540c\u7c7b\u7ec3\u4e60\u9898\u3002\n\n\u5b66\u751f\u9519\u9898\u6837\u672c\uff1a\n'+samples+'\n\n\u8981\u6c42\uff1a\u4e25\u683cPCE\u98ce\u683c\uff0c4\u90091\uff0c\u6807\u6ce8\u7b54\u6848\uff0c\u4e2d\u82f1\u6587\u6df7\u6392\uff0c\u7a74\u4f4d\u4fdd\u7559\u82f1\u6587\u7f29\u5199\u3002\n\u683c\u5f0f\uff1a\n1. [\u9898\u76ee]\nA. B. C. D.\n\u7b54\u6848\uff1aX\uff5c\u89e3\u6790\uff1a[\u4e00\u53e5\u8bdd]';
  try{
    var txt=await callClaude(prompt);
    var div=document.createElement('div'); div.className='card';
    div.innerHTML='<div class="row"><div class="title">\ud83c\udfaf \u300c'+esc(catName)+'\u300d\u540c\u7c7b\u7ec3\u4e60\u9898</div></div>'
      +'<div class="ai-body" style="white-space:pre-wrap">'+esc(txt)+'</div>';
    document.getElementById('review-list').prepend(div);
    window.scrollTo({top:0,behavior:'smooth'});
    showToast('\u5df2\u751f\u6210\u300c'+catName+'\u300d\u7ec3\u4e60\u9898');
  }catch(e){
    showToast('\u751f\u6210\u5931\u8d25: '+e.message);
  }
}

async function aiAnalyzeAllWrong(){
  var entries=Object.values(DB.wrongMap).filter(function(e){return !e.analysis;}).slice(0,8);
  if(!entries.length){showToast('\u9519\u9898\u5df2\u5168\u90e8\u89e3\u6790\uff01');return;}
  showToast('\u6b63\u5728\u89e3\u6790 '+entries.length+' \u9053\u9519\u9898\u2026',10000);
  for(var i=0;i<entries.length;i++){
    var body=document.getElementById('rib-'+entries[i].q.id);
    if(body) body.style.display='block';
    await revAnalyze(entries[i].q.id);
    await new Promise(function(r){setTimeout(r,600);});
  }
  showToast('\u89e3\u6790\u5b8c\u6210\uff01');
}

async function aiAnalyzeAllDK(){
  var entries=Object.values(DB.dkMap).filter(function(e){return !e.analysis;}).slice(0,8);
  if(!entries.length){showToast('\u4e0d\u4f1a\u9898\u5df2\u5168\u90e8\u89e3\u6790\uff01');return;}
  showToast('\u6b63\u5728\u89e3\u6790 '+entries.length+' \u9053\u4e0d\u4f1a\u9898\u2026',10000);
  for(var i=0;i<entries.length;i++){
    var body=document.getElementById('rib-'+entries[i].q.id);
    if(body) body.style.display='block';
    await revAnalyze(entries[i].q.id);
    await new Promise(function(r){setTimeout(r,600);});
  }
  showToast('\u89e3\u6790\u5b8c\u6210\uff01');
}

// ── MODAL (题目详情) ──────────────────────────────────────
function openDetailModal(qid,idx){
  var q=(QZ.qs&&QZ.qs[idx])||null;
  if(!q){var e=DB.wrongMap[qid]||DB.dkMap[qid];if(e)q=e.q;}
  if(!q) return;
  var my=QZ.ans?QZ.ans[idx]:null;
  var hasAns=!!q.answer;
  var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();

  document.getElementById('m-title').textContent='\u7b2c '+(q.num||idx+1)+' \u9898';
  var content=document.getElementById('m-content');

  var html='';
  if(q.caseText) html+='<div class="case-mini">\ud83d\udccb \u75c5\u4f8b\u8d44\u6599<br>'+esc(q.caseText)+'</div>';
  html+='<div class="ri-qtext">'+esc(q.body)+'</div>';
  html+='<div class="ri-opts">'+q.opts.map(function(o){
    var cls=(o.letter===(q.answer||''))?'correct':(my&&o.letter===my&&o.letter!==q.answer?'wrong':'');
    return '<div class="ri-opt '+cls+'">'+o.letter+'. '+esc(o.text)
      +(o.letter===q.answer?' \u2713 \u6b63\u786e':'')
      +(my&&o.letter===my&&o.letter!==q.answer?' \u2190 \u6211\u9009':'')+'</div>';
  }).join('')+'</div>';

  if(hasAns&&my&&my!=='skip'){
    html+='<div class="verdict '+(ok?'greentext':'redtext')+'">'+(ok?'\u2713 \u7b54\u5bf9\u4e86':'\u2717 \u7b54\u9519 \u2014 \u6211\u9009 '+my+'\uff0c\u6b63\u786e\u662f '+q.answer)+'</div>';
  }

  html+='<div class="row mt">'
    +'<button class="btn blue small" onclick="modalAnalyze(\''+qid+'\','+idx+')">🔍 AI解析此题</button>'
    +'<button class="btn small" onclick="modalSimilar(\''+qid+'\','+idx+')">✨ 生成同类题</button>'
    +'</div>';
  html+='<div id="modal-ai-'+qid+'"></div>';

  // 如果有缓存解析直接显示
  var cached=DB.wrongMap[qid]||DB.dkMap[qid];
  if(cached&&cached.analysis){
    html+='<!-- cached -->';
  }

  content.innerHTML=html;

  if(cached&&cached.analysis){
    renderAI(document.getElementById('modal-ai-'+qid),cached.analysis);
  }

  document.getElementById('modal-bg').style.display='flex';
}

function closeModal(){ document.getElementById('modal-bg').style.display='none'; }

async function modalAnalyze(qid,idx){
  var q=(QZ.qs&&QZ.qs[idx])||null;
  if(!q){var e=DB.wrongMap[qid]||DB.dkMap[qid];if(e)q=e.q;}
  if(!q) return;
  var my=QZ.ans?(QZ.ans[idx]||'\u672a\u9009'):'\u672a\u9009';
  var aiEl=document.getElementById('modal-ai-'+qid);
  if(!aiEl) return;
  aiEl.innerHTML='<div class="ai-box loading">\ud83e\udd16 AI\u89e3\u6790\u4e2d\u2026</div>';
  var prompt='\u8bf7\u5206\u6790\u4ee5\u4e0bPCE\u9488\u7078\u8003\u8bd5\u9898\u76ee\uff1a\n\n'
    +'\u9898\u76ee\uff1a'+q.body+'\n\u9009\u9879\uff1a\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')
    +'\n\u6b63\u786e\u7b54\u6848\uff1a'+(q.answer||'\u672a\u77e5')+'\n\u5b66\u751f\u9009\u62e9\uff1a'+my
    +'\n\n\u8bf7\u63d0\u4f9b\uff1a\n\u3010\u9519\u8bef\u539f\u56e0\u3011\uff081-2\u53e5\uff09\n\u3010\u89e3\u9898\u903b\u8f91\u3011\uff082-3\u53e5\uff09\n\u3010\u6838\u5fc3\u77e5\u8bc6\u70b9\u3011\uff082-3\u53e5\uff09\n\u3010\u80cc\u8a35\u6838\u5fc3\u53e5\u30112-4\u53e5\u7b80\u6d01\u53e3\u8bc0';
  try{
    var txt=await callClaude(prompt);
    var entry=DB.wrongMap[qid]||DB.dkMap[qid];
    if(entry){entry.analysis=txt;saveDB();}
    renderAI(aiEl,txt);
  }catch(e){
    aiEl.innerHTML='<div class="ai-box"><div style="color:#b83232">\u274c '+esc(e.message)+'</div></div>';
  }
}

async function modalSimilar(qid,idx){
  var q=(QZ.qs&&QZ.qs[idx])||null;
  if(!q){var e=DB.wrongMap[qid]||DB.dkMap[qid];if(e)q=e.q;}
  if(!q) return;
  var aiEl=document.getElementById('modal-ai-'+qid);
  if(!aiEl) return;
  aiEl.innerHTML='<div class="ai-box loading">\u2728 \u751f\u6210\u540c\u7c7b\u9898\u4e2d\u2026</div>';
  var prompt='\u6839\u636e\u4ee5\u4e0bPCE\u9488\u7078\u8003\u8bd5\u9898\u76ee\uff0c\u751f\u62103\u9053\u540c\u77e5\u8bc6\u70b9\u7ec3\u4e60\u9898\uff1a\n\n'
    +'\u539f\u9898\uff1a'+q.body+'\n\u9009\u9879\uff1a'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')
    +'\n\n\u8981\u6c42\uff1a4\u90091\u5355\u9009\uff0c\u6807\u6ce8\u7b54\u6848\uff0c1\u53e5\u89e3\u6790\u3002\u4e2d\u6587\uff0c\u7a74\u4f4d\u4fdd\u7559\u82f1\u6587\u7f29\u5199\u3002\n\u683c\u5f0f\uff1a\n1. [\u9898\u76ee]\nA. B. C. D.\n\u7b54\u6848\uff1aX\uff5c\u89e3\u6790\uff1a[\u4e00\u53e5\u8bdd]';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div class="ai-box"><div class="ai-title">\ud83c\udfaf \u540c\u7c7b\u7ec3\u4e60\u9898</div><div class="ai-body">'+esc(txt)+'</div></div>';
  }catch(e){
    aiEl.innerHTML='<div class="ai-box"><div style="color:#b83232">\u274c \u751f\u6210\u5931\u8d25</div></div>';
  }
}

// ── PRINT / PDF ───────────────────────────────────────────
function printReport(){
  var wrongEntries=Object.values(DB.wrongMap);
  var dkEntries=Object.values(DB.dkMap);
  if(!wrongEntries.length&&!dkEntries.length){showToast('\u8bbe\u6709\u9519\u9898\u6216\u4e0d\u4f1a\u7684\u9898');return;}

  var w=window.open('','_blank');
  if(!w){showToast('\u5f39\u7a97\u88ab\u62e6\u622a\uff0c\u8bf7\u5141\u8bb8\u5f39\u7a97');return;}

  var h=['<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PCE\u590d\u4e60\u62a5\u544a</title><style>',
    'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:2cm;color:#18180f;font-size:11pt;line-height:1.7}',
    'h1{font-size:20pt;font-weight:700;margin-bottom:8px}',
    '.meta{font-size:11pt;color:#666;margin-bottom:2rem;border-bottom:2px solid #ddd;padding-bottom:1rem}',
    '.sh{font-size:13pt;font-weight:700;padding:7px 14px;border-radius:6px;margin:2rem 0 1rem}',
    '.sw{background:#fdeaea;color:#b83232;border-left:5px solid #b83232}',
    '.sdk{background:#fff3cd;color:#c47a1a;border-left:5px solid #c47a1a}',
    '.qb{margin-bottom:1.5rem;padding:1rem 1.2rem;border-radius:8px;page-break-inside:avoid}',
    '.qb.wrong{background:#fff9f9;border:1px solid #f5c5c5;border-left:5px solid #b83232}',
    '.qb.dk{background:#fffdf0;border:1px solid #f5d9a0;border-left:5px solid #c47a1a}',
    '.qnum{font-size:9.5pt;color:#888;margin-bottom:3px;font-weight:600}',
    '.qtext{font-size:11.5pt;white-space:pre-wrap;margin-bottom:10px;font-weight:500}',
    '.opt{font-size:10.5pt;padding:4px 10px;border-radius:4px;margin-bottom:3px;display:block}',
    '.oc{background:#e8f5ed;color:#2e7d52;font-weight:700}.ow{background:#fdeaea;color:#b83232}',
    '.ai-box{background:#f0ebff;border:1px solid #d4c9f5;padding:10px 13px;border-radius:6px;margin-top:10px;font-size:10pt;white-space:pre-wrap}',
    '.ai-title{font-size:9.5pt;font-weight:700;color:#6040b0;margin-bottom:5px}',
    '.core-box{background:#fffbe6;border:1px solid #f0d060;padding:9px 13px;border-radius:6px;margin-top:7px}',
    '.core-title{font-size:9.5pt;font-weight:700;color:#8a6000;margin-bottom:5px}',
    '.core-item{font-size:10.5pt;padding:3px 0;border-bottom:1px dashed #f0d060}',
    '.core-item:last-child{border-bottom:none}',
    '.nopr{position:fixed;top:1rem;right:1rem;display:flex;gap:8px}',
    '@media print{.nopr{display:none}}',
    '</style></head><body>'];

  h.push('<div class="nopr">');
  h.push('<button onclick="window.print()" style="padding:10px 22px;background:#18180f;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600">\ud83d\udda8 \u6253\u5370/\u4fdd\u5b58PDF</button>');
  h.push('<button onclick="window.close()" style="padding:10px 16px;background:#f0efe9;border:1px solid #ccc;border-radius:8px;font-size:14px;cursor:pointer">\u5173\u95ed</button>');
  h.push('</div>');
  h.push('<h1>PCE \u9488\u7078\u590d\u4e60\u62a5\u544a</h1>');
  h.push('<div class="meta">\u751f\u6210\u65f6\u95f4\uff1a'+new Date().toLocaleString('zh-CN')
    +' &nbsp;|\u00a0\u9519\u9898 '+wrongEntries.length+' \u9053 &nbsp;|\u00a0\u4e0d\u4f1a '+dkEntries.length+' \u9053</div>');

  function renderQBlock(entry,type){
    var q=entry.q,my=entry.myAns||'?',an=entry.analysis||'';
    var out=['<div class="qb '+type+'">'];
    out.push('<div class="qnum">\u9898\u53f7 #'+(q.num||'?')+' | '+esc(entry.batchName||'')+'</div>');
    if(q.caseText) out.push('<div style="background:#fffbe6;border:1px solid #f0d060;padding:8px;border-radius:5px;margin-bottom:8px;font-size:10pt;white-space:pre-wrap">\ud83d\udccb \u75c5\u4f8b\u8d44\u6599\n'+esc(q.caseText)+'</div>');
    out.push('<div class="qtext">'+esc(q.body)+'</div>');
    q.opts.forEach(function(o){
      var cls=(o.letter===(q.answer||''))?'oc':(o.letter===my?'ow':'');
      out.push('<span class="opt '+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===q.answer?' \u2713 \u6b63\u786e':'')+(o.letter===my&&o.letter!==q.answer?' \u2190 \u6211\u9009':'')+'</span>');
    });
    if(an){
      var CORE_KEY='\u3010\u80cc\u8a35\u6838\u5fc3\u53e5\u3011';
      var BRACKET='\u3010';
      var ci=an.indexOf(CORE_KEY);
      var core=ci>=0?an.slice(ci+CORE_KEY.length):'';
      var ni=core.indexOf(BRACKET);if(ni>=0)core=core.slice(0,ni);core=core.trim();
      var mainAn=ci>=0?an.slice(0,ci).trim():an.trim();
      out.push('<div class="ai-box"><div class="ai-title">\ud83e\udd16 AI\u89e3\u6790</div>'+esc(mainAn)+'</div>');
      if(core){
        var lines=core.split('\n').filter(function(s){return s.trim();});
        out.push('<div class="core-box"><div class="core-title">\ud83d\udccc \u80cc\u8a35\u6838\u5fc3\u53e5</div>');
        lines.forEach(function(s){out.push('<div class="core-item">'+esc(s.replace(/^[-\u2022\d.、,]+\s*/,''))+'</div>');});
        out.push('</div>');
      }
    }
    out.push('</div>');
    return out.join('');
  }

  if(wrongEntries.length){
    h.push('<div class="sh sw">\u2717 \u9519\u9898\uff08'+wrongEntries.length+'\u9053\uff09</div>');
    wrongEntries.forEach(function(e){h.push(renderQBlock(e,'wrong'));});
  }
  if(dkEntries.length){
    h.push('<div class="sh sdk">\u2753 \u4e0d\u4f1a\u7684\u9898\uff08'+dkEntries.length+'\u9053\uff09</div>');
    dkEntries.forEach(function(e){h.push(renderQBlock(e,'dk'));});
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

// ── MOCK EXAM ─────────────────────────────────────────────
function renderMockSetup(){
  var total=DB.batches.reduce(function(s,b){return s+b.questions.length;},0);
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="title">\u6a21\u62df\u8003\u8bd5</div>'
    +'<div class="sub">\u4eff Pan Canada \u9488\u7078\u8003\u8bd5 \u2014 125\u9898 / 2.5\u5c0f\u65f6</div>'
    +'<div class="grid">'
    +'<div class="stat"><div class="k">\u9898\u76ee\u6570\u91cf</div><div class="v">125</div></div>'
    +'<div class="stat"><div class="k">\u8003\u8bd5\u65f6\u957f</div><div class="v">2.5h</div></div>'
    +'<div class="stat"><div class="k">\u53ef\u7528\u9898\u76ee</div><div class="v">'+total+'</div></div>'
    +'</div>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:1rem">'
    +'<input type="checkbox" id="mock-wrong-cb"> \u9519\u9898\u52a0\u500d\u51fa\u73b0\uff08\u5f3a\u5316\u8584\u5f31\u70b9\uff09'
    +'</label>'
    +'<button class="btn primary" onclick="startMock()">\u5f00\u59cb\u6a21\u62df\u8003\u8bd5</button>'
    +'</div>';
}

var MK={qs:[],ans:[],cur:0,start:0,interval:null};

function startMock(){
  var allQs=[];
  DB.batches.forEach(function(b){allQs=allQs.concat(b.questions);});
  if(!allQs.length){alert('\u8bf7\u5148\u5bfc\u5165\u9898\u76ee\u3002');return;}
  var pool=allQs.slice();
  var wrongCb=document.getElementById('mock-wrong-cb');
  if(wrongCb&&wrongCb.checked){
    var wids=Object.keys(DB.wrongMap);
    var wrongQs=allQs.filter(function(q){return wids.indexOf(q.id)>=0;});
    pool=pool.concat(wrongQs);
  }
  pool=shuffle(pool).slice(0,125);
  MK={qs:pool,ans:new Array(pool.length).fill(null),cur:0,start:Date.now(),interval:null};
  renderMockExam();
}

function renderMockExam(){
  var q=MK.qs[MK.cur];
  var answered=MK.ans.filter(function(a){return !!a;}).length;
  var elapsed=Math.round((Date.now()-MK.start)/1000);
  var rem=150*60-elapsed;
  var h=Math.floor(rem/3600),m=Math.floor((rem%3600)/60),s=rem%60;
  var timeStr=h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;

  clearInterval(MK.interval);
  MK.interval=setInterval(function(){
    var el=document.getElementById('mock-timer');
    if(el){
      var e2=Math.round((Date.now()-MK.start)/1000);
      var r=150*60-e2; if(r<=0){clearInterval(MK.interval);finishMock();return;}
      var hh=Math.floor(r/3600),mm=Math.floor((r%3600)/60),ss=r%60;
      el.textContent=hh+':'+(mm<10?'0':'')+mm+':'+(ss<10?'0':'')+ss;
    }
  },1000);

  var optsHTML=q.opts.map(function(o){
    var sel=MK.ans[MK.cur]===o.letter?' sel':'';
    return '<button class="opt'+sel+'" onclick="mockPick(\''+o.letter+'\')">'
      +'<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span></button>';
  }).join('');

  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="qtop">'
    +'<div><div class="qcount">\u7b2c <strong>'+(MK.cur+1)+'</strong> / '+MK.qs.length+' \u9898</div>'
    +'<div class="sub">\u5df2\u7b54 '+answered+' \u9898</div></div>'
    +'<div id="mock-timer" class="timer spacer green">'+timeStr+'</div>'
    +'</div>'
    +(q.caseText?'<div id="casebox" class="case" style="display:block"><div class="case-title">\ud83d\udccb \u75c5\u4f8b\u8d44\u6599</div><div class="case-text">'+esc(q.caseText)+'</div></div>':'')
    +'<div class="qbody">'+esc(q.body)+'</div>'
    +'<div class="opts">'+optsHTML+'</div>'
    +'<div class="row actions">'
    +'<button class="btn small" onclick="mockPrev()">\u2190 \u4e0a\u4e00\u9898</button>'
    +'<button class="btn small primary" onclick="mockNext()">\u4e0b\u4e00\u9898 \u2192</button>'
    +'<button class="btn small red spacer" onclick="finishMock()">\u4ea4\u5377</button>'
    +'</div></div>';
}

function mockPick(l){
  MK.ans[MK.cur]=l;
  document.querySelectorAll('#mock-area .opt').forEach(function(b){b.classList.remove('sel');});
  document.querySelectorAll('#mock-area .opt').forEach(function(b){
    if(b.querySelector('.opt-letter')&&b.querySelector('.opt-letter').textContent===l) b.classList.add('sel');
  });
}
function mockPrev(){ if(MK.cur>0){MK.cur--;renderMockExam();} }
function mockNext(){ if(MK.cur<MK.qs.length-1){MK.cur++;renderMockExam();}else finishMock(); }

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
    if(ok) correct++;
    if(hasAns&&my&&!ok){wrong++;DB.wrongMap[q.id]={q:q,batchId:'mock',batchName:'\u6a21\u62df\u8003\u8bd5',myAns:my};}
    var prev=q.body.replace(/\n/g,' ').slice(0,40);
    rows+='<tr><td>'+(i+1)+'</td><td>'+esc(prev)+'</td>'
      +'<td>'+(my||'\u2014')+'</td>'
      +'<td>'+(hasAns?'<b>'+q.answer+'</b>':'\u2014')+'</td>'
      +'<td>'+(hasAns&&my?(ok?'<span class="greentext">\u2713</span>':'<span class="redtext">\u2717</span>'):'\u2014')+'</td></tr>';
  });
  saveDB(); renderHome();
  var rate=withAns?Math.round(correct/withAns*100):0;
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="title">\u6a21\u62df\u8003\u8bd5\u7ed3\u679c</div>'
    +'<div class="grid">'
    +'<div class="stat"><div class="k">\u603b\u9898</div><div class="v">'+MK.qs.length+'</div></div>'
    +'<div class="stat"><div class="k">\u7b54\u5bf9</div><div class="v greentext">'+correct+'</div></div>'
    +'<div class="stat"><div class="k">\u7b54\u9519</div><div class="v redtext">'+wrong+'</div></div>'
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
  if(!DB.batches.length){
    list.innerHTML='<div class="sub">\u5bfc\u5165\u540e\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002</div>';
    return;
  }
  list.innerHTML='';
  DB.batches.slice().reverse().forEach(function(b){
    var p=b.progress;
    var done=p.answers.filter(function(a){return a&&a!=='skip';}).length;
    var prog=Math.round(done/b.questions.length*100);
    var div=document.createElement('div'); div.className='batch-row';
    div.innerHTML='<span class="batch-name">'+esc(b.name)+'</span>'
      +'<span class="batch-meta">'+b.questions.length+'\u9898 '+prog+'%</span>';
    var btns=[
      {label:'\u7ee7\u7eed',fn:function(){startBatch(b.id,false);}},
      {label:'\u91cd\u6765',fn:function(){
        if(!confirm('\u4ece\u7b2c\u4e00\u9898\u91cd\u65b0\u5f00\u59cb\u201c'+b.name+'\u201d\uff1f')) return;
        b.progress={idx:0,answers:new Array(b.questions.length).fill(null),dk:{}};
        saveDB(); startBatch(b.id,true);
      }},
      {label:'\u6539\u540d',fn:function(){
        var n=prompt('\u4fee\u6539\u6279\u6b21\u540d\u79f0\uff1a',b.name);
        if(n===null) return; var t=n.trim(); if(!t) return;
        b.name=t; saveDB(); renderHome();
      }},
      {label:'\u7ba1\u7406\u9898\u76ee',fn:function(){ openManageModal(b.id); }},
      {label:'\u5220\u9664',fn:function(){
        if(!confirm('\u786e\u5b9a\u5220\u9664\u6b64\u6279\u6b21\uff1f')) return;
        DB.batches=DB.batches.filter(function(x){return x.id!==b.id;});
        saveDB(); renderHome();
      }}
    ];
    btns.forEach(function(item){
      var btn=document.createElement('button'); btn.className='btn small'; btn.textContent=item.label;
      btn.addEventListener('click',item.fn); div.appendChild(btn);
    });
    list.appendChild(div);
  });
}

// ── MANAGE BATCH MODAL ────────────────────────────────────
function openManageModal(batchId){
  var batch=DB.batches.find(function(b){return b.id===batchId;});
  if(!batch) return;
  document.getElementById('m-title').textContent='\u7ba1\u7406\u9898\u76ee \u2014 '+batch.name;
  var content=document.getElementById('m-content');

  function renderList(filter){
    var rows='';
    batch.questions.forEach(function(q,idx){
      if(filter&&q.body.toLowerCase().indexOf(filter.toLowerCase())<0) return;
      var preview=q.body.replace(/\n/g,' ').slice(0,60);
      rows+='<div class="mgr-row" id="mgr-'+idx+'">'
        +'<input type="checkbox" id="mc-'+idx+'" data-idx="'+idx+'" onchange="this.closest(\'.mgr-row\').style.background=this.checked?\'#fdeaea\':\'#fff\'">'
        +'<span class="ri-num">#'+(q.num||idx+1)+'</span>'
        +(q.answer?'<span style="color:#2e7d52;font-size:11px">\u7b54:'+q.answer+'</span>':'')
        +'<span class="ri-prev">'+esc(preview)+'</span>'
        +'</div>';
    });
    content.querySelector('#mgr-list').innerHTML=rows||'<div class="sub">\u6ca1\u6709\u5339\u914d\u9898\u76ee</div>';
    content.querySelector('#mgr-count').textContent='\u5171 '+batch.questions.length+' \u9053';
  }

  content.innerHTML='<div class="row">'
    +'<button class="btn small" onclick="this.closest(\'#m-content\').querySelectorAll(\'input[type=checkbox]\').forEach(function(c){c.checked=true;c.closest(\'.mgr-row\').style.background=\'#fdeaea\';})">\u5168\u9009</button>'
    +'<button class="btn small" onclick="this.closest(\'#m-content\').querySelectorAll(\'input[type=checkbox]\').forEach(function(c){c.checked=false;c.closest(\'.mgr-row\').style.background=\'#fff\';})">\u5168\u4e0d\u9009</button>'
    +'<button class="btn small red" onclick="doDeleteSel(\''+batchId+'\')">\u5220\u9664\u6240\u9009</button>'
    +'<span id="mgr-count" class="sub spacer"></span>'
    +'</div>'
    +'<input placeholder="\u641c\u7d22\u9898\u76ee\u5185\u5bb9\u2026" class="full mt" oninput="(function(v){document.querySelector(\'#mgr-list\') && (function(){'+
    'var rows=document.querySelectorAll(\'.mgr-row\');rows.forEach(function(r){var t=r.querySelector(\'.ri-prev\');r.style.display=(!v||t.textContent.toLowerCase().indexOf(v.toLowerCase())>=0)?\'flex\':\'none\';});})();})(this.value)">'
    +'<div id="mgr-list" class="mt"></div>';

  renderList('');
  document.getElementById('modal-bg').style.display='flex';
}

function doDeleteSel(batchId){
  var batch=DB.batches.find(function(b){return b.id===batchId;});
  if(!batch) return;
  var toDelete=[];
  document.querySelectorAll('#mgr-list input[type=checkbox]').forEach(function(c){
    if(c.checked) toDelete.push(parseInt(c.dataset.idx));
  });
  if(!toDelete.length){alert('\u8bf7\u5148\u52fe\u9009\u8981\u5220\u9664\u7684\u9898\u76ee');return;}
  if(!confirm('\u786e\u5b9a\u5220\u9664\u6240\u9009\u7684 '+toDelete.length+' \u9053\u9898\u76ee\uff1f')) return;
  toDelete.sort(function(a,b){return b-a;});
  toDelete.forEach(function(idx){
    var q=batch.questions[idx];
    if(q){delete DB.wrongMap[q.id];delete DB.dkMap[q.id];}
    batch.questions.splice(idx,1);
  });
  batch.progress={idx:0,answers:new Array(batch.questions.length).fill(null),dk:{}};
  saveDB(); renderHome(); closeModal();
  showToast('\u5df2\u5220\u9664 '+toDelete.length+' \u9053\u9898\u76ee');
}

// ── FIREBASE CLOUD SYNC ───────────────────────────────────
// (保留原有逻辑框架，具体Firebase调用由用户配置)
function saveApiKey(){
  var key=document.getElementById('api-key-input').value.trim();
  if(!key){showToast('请输入 API Key');return;}
  localStorage.setItem('claude_api_key',key);
  showToast('✓ Claude API Key 已保存');
}
function saveFirebaseConfig(){
  var raw=document.getElementById('firebase-config').value.trim();
  if(!raw){showToast('请粘贴 Firebase 配置');return;}
  try{
    var cfg=JSON.parse(raw);
    localStorage.setItem('firebase_cfg',JSON.stringify(cfg));
    showToast('✓ 配置已保存，请刷新页面后登录');
  }catch(e){showToast('JSON格式错误，请检查');}
}
function loadFirebaseConfigToBox(){
  var s=localStorage.getItem('firebase_cfg');
  if(s) document.getElementById('firebase-config').value=JSON.stringify(JSON.parse(s),null,2);
  else showToast('尚未保存配置');
}

// Firebase 动态加载（如果已配置）
(function(){
  var cfg=localStorage.getItem('firebase_cfg');
  if(!cfg) return;
  var config; try{config=JSON.parse(cfg);}catch(e){return;}
  var script1=document.createElement('script');
  script1.src='https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
  script1.onload=function(){
    var script2=document.createElement('script');
    script2.src='https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js';
    script2.onload=function(){
      var script3=document.createElement('script');
      script3.src='https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js';
      script3.onload=function(){
        try{
          if(!firebase.apps.length) firebase.initializeApp(config);
          document.getElementById('cloud-status').textContent='Firebase 已连接，请登录。';
        }catch(e){}
      };
      document.head.appendChild(script3);
    };
    document.head.appendChild(script2);
  };
  document.head.appendChild(script1);
})();

function cloudRegister(){
  var email=document.getElementById('cloud-email').value.trim();
  var pass=document.getElementById('cloud-pass').value;
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
  if(typeof firebase==='undefined') return;
  firebase.auth().signOut().then(function(){document.getElementById('cloud-status').textContent='已退出。';});
}
function cloudUpload(){
  if(typeof firebase==='undefined'){showToast('请先配置并登录Firebase');return;}
  var user=firebase.auth().currentUser;
  if(!user){showToast('请先登录');return;}
  firebase.firestore().collection('users').doc(user.uid).set({db:JSON.stringify(DB)})
    .then(function(){showToast('✓ 数据已上传到云端');})
    .catch(function(e){showToast('上传失败：'+e.message);});
}
function cloudDownload(){
  if(typeof firebase==='undefined'){showToast('请先配置并登录Firebase');return;}
  var user=firebase.auth().currentUser;
  if(!user){showToast('请先登录');return;}
  firebase.firestore().collection('users').doc(user.uid).get()
    .then(function(doc){
      if(!doc.exists){showToast('云端暂无数据');return;}
      var data=JSON.parse(doc.data().db);
      DB=data; saveDB(); renderHome();
      showToast('✓ 已从云端下载数据');
    })
    .catch(function(e){showToast('下载失败：'+e.message);});
}

// ── UTILS ─────────────────────────────────────────────────
function shuffle(a){ return a.slice().sort(function(){return Math.random()-.5;}); }

// ── API KEY ──────────────────────────────────────────────
function getApiKey(){
  return localStorage.getItem('claude_api_key')||'';
}

// ── INIT ──────────────────────────────────────────────────
renderHome();
