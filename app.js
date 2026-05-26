// PCE 针灸答题器 — app.js FINAL
// All features: resume quiz, back buttons, AI analysis everywhere, notes, highlight, batch ops, auto-advance, timer stop, auto-login

// ═══════════════════════════════════════════════════════
// DB
// ═══════════════════════════════════════════════════════
var DBKEY = 'pce_db_v5';
var DB = (function(){
  try { return JSON.parse(localStorage.getItem(DBKEY)) || makeDB(); }
  catch(e) { return makeDB(); }
})();
function makeDB() {
  return { batches:[], wrongMap:{}, dkMap:{}, stats:{done:0,correct:0}, analysisCache:{}, notes:[], starMap:{}, answerKeys:{}, lastPos:null, hlCache:{}, studyPages:[], qNotes:{} };
}
function saveDB() { try { localStorage.setItem(DBKEY, JSON.stringify(DB)); } catch(e){} }

// migrate old keys
['analysisCache','notes','starMap','answerKeys','hlCache','qNotes'].forEach(function(k){ if(!DB[k]) DB[k] = k==='notes'?[]:({}); });
if(!DB.studyPages) DB.studyPages=[];
if(DB.lastPos===undefined) DB.lastPos=null;
// Re-fix caseText for existing batches: clear wrong case assignments beyond range
(function fixCaseRanges(){
  DB.batches.forEach(function(batch){
    // Build a map of caseText ranges from questions that have caseText
    // Find all distinct caseText values and their number ranges
    var caseRanges = []; // [{lo, hi, text}]
    batch.questions.forEach(function(q){
      if(!q.caseText) return;
      var rm = q.caseText.match(/(\d{1,4})\s*[-–~]\s*(\d{1,4})/);
      if(rm){
        var lo=parseInt(rm[1]), hi=parseInt(rm[2]);
        // Only keep if not already recorded
        var found=caseRanges.some(function(r){return r.lo===lo&&r.hi===hi;});
        if(!found) caseRanges.push({lo:lo,hi:hi,text:q.caseText});
      }
    });
    if(!caseRanges.length) return;
    // Re-assign caseText: clear questions outside their range
    batch.questions.forEach(function(q){
      if(!q.caseText) return;
      var rm = q.caseText.match(/(\d{1,4})\s*[-–~]\s*(\d{1,4})/);
      if(rm){
        var lo=parseInt(rm[1]), hi=parseInt(rm[2]);
        if(q.num<lo || q.num>hi){
          q.caseText=null; // clear wrong assignment
        }
      }
    });
  });
  saveDB();
})();
// migrate from v4 if v5 is empty
(function(){
  if(DB.batches.length===0){
    try{
      var old=JSON.parse(localStorage.getItem('pce_db_v4'));
      if(old&&old.batches&&old.batches.length){
        DB.batches=old.batches; DB.wrongMap=old.wrongMap||{}; DB.dkMap=old.dkMap||{};
        DB.stats=old.stats||{done:0,correct:0}; DB.analysisCache=old.analysisCache||{};
        DB.notes=old.notes||[]; DB.starMap=old.starMap||{};
        localStorage.setItem('pce_db_v5',JSON.stringify(DB));
      }
    }catch(e){}
  }
})();

// ═══════════════════════════════════════════════════════
// API KEY — auto-saved, never ask again
// ═══════════════════════════════════════════════════════
function getApiKey() { return localStorage.getItem('claude_api_key') || ''; }
function saveApiKey() {
  var inp = document.getElementById('api-key-input'), st = document.getElementById('api-key-status');
  if (!inp) return;
  var k = inp.value.trim();
  if (!k) { if(st) st.textContent='请输入 Key'; return; }
  localStorage.setItem('claude_api_key', k);
  if(st) st.textContent='✓ 已保存';
  showToast('✓ API Key 已保存，以后自动使用');
}
function initApiKeyInput() {
  var inp = document.getElementById('api-key-input'); if (!inp) return;
  var saved = getApiKey();
  if (saved) inp.value = saved;
  var st = document.getElementById('api-key-status');
  if (saved && st) st.textContent = '✓ Key 已自动加载，无需重新输入';
  inp.addEventListener('input', function(){
    clearTimeout(inp._t);
    inp._t = setTimeout(function(){
      var k = inp.value.trim();
      if (k.length > 10) { localStorage.setItem('claude_api_key', k); if(st) st.textContent='✓ 已自动保存'; }
    }, 800);
  });
}

// ═══════════════════════════════════════════════════════
// NAVIGATION with back-stack
// ═══════════════════════════════════════════════════════
var _pageStack = ['home'];
function showPage(name) {
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var pg = document.getElementById(name);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  var tab = document.querySelector('.tab[data-page="'+name+'"]');
  if (tab) tab.classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
}
function navTo(name) {
  if (_pageStack[_pageStack.length-1] !== name) _pageStack.push(name);
  showPage(name);
}
function navBack() {
  if (_pageStack.length > 1) _pageStack.pop();
  showPage(_pageStack[_pageStack.length-1]);
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){
    _pageStack = [t.dataset.page];
    showPage(t.dataset.page);
    if (t.dataset.page === 'notes') renderNotes();
    if (t.dataset.page === 'review') renderReview();
    if (t.dataset.page === 'mock') renderMockSetup();
  });
});

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
function showToast(msg, dur) {
  var el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = 'show';
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.className=''; }, dur||2500);
}

// ═══════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════
(function(){
  var fi = document.getElementById('file-input');
  if (fi) fi.addEventListener('change', function(e){
    var file = e.target.files[0]; if (!file) return;
    var r = new FileReader();
    r.onload = function(ev){
      document.getElementById('raw').value = ev.target.result;
      document.getElementById('upload-status').textContent = '✓ ' + file.name;
    };
    r.readAsText(file, 'utf-8');
  });
})();

// ═══════════════════════════════════════════════════════
// PARSER
// ═══════════════════════════════════════════════════════
function parseQ(raw) {
  raw = raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-65248);})
    .replace(/）/g,')').replace(/（/g,'(').replace(/。/g,'.').replace(/　/g,' ');
  var lines = raw.split('\n').map(function(l){return l.trim();});
  var qRe   = /^[(\[]?\s*(\d{1,4})\s*[).、]\s*(.*)/;
  var optRe = /^([A-Ea-e])\s*[).、：:]\s*(.+)/;
  var inRe  = /([A-Ea-e])\s*[).]\s*(.+?)(?=\s{2,}[A-Ea-e]\s*[).]|$)/g;
  var ansRe = /[\u3010\[]?[\u7b54\u6848Aa][\u6848nswer]*[\uff1a:]\s*([A-Ea-e])[\u3011\]]?/i;
  // Case keywords
  var caseKw = /根据以下|根据下列|以下病例|基于以下|以下案例|以下情况|病案|following case|following scenario/i;
  // Range line: "208-215 基于以下病案：" — number range + case keyword
  var rangeRe = /^(\d{1,4})\s*[-–~]\s*(\d{1,4})[^\n]*(基于|根据|以下|病例|病案|案例|following)/i;
  function isCN(q){return /[\u4e00-\u9fff]/.test(q.body);}

  // ── STEP 1: Pre-scan to find all case blocks ──────────
  // caseBlocks: [{lo, hi, text}]  hi=null means "until next case"
  var caseBlocks = [];
  for(var i=0;i<lines.length;i++){
    var l=lines[i]; if(!l) continue;
    // Range header: "208-215 基于以下病案"
    var rm=l.match(rangeRe);
    if(rm){
      var lo=parseInt(rm[1]), hi=parseInt(rm[2]);
      // Collect case body: everything after this line until next question-like line
      var bodyLines=[l], j=i+1;
      while(j<lines.length){
        var nl=lines[j];
        // Stop if we hit a line that looks like a new question (num + option pattern later)
        // But DON'T stop just because a line starts with a number — case text can have numbers
        // Stop at: optRe line, or ansRe line, or another rangeRe line
        if(!nl){j++;continue;}
        if(nl.match(rangeRe)) break;        // another case range
        if(nl.match(optRe)) break;          // options starting = first question's options
        if(nl.match(ansRe)) break;
        // If line matches qRe AND the number is within our range → it's the first question, stop
        var qm2=nl.match(qRe);
        if(qm2&&parseInt(qm2[1])>=lo) break;
        bodyLines.push(nl); j++;
      }
      caseBlocks.push({lo:lo, hi:hi, text:bodyLines.join('\n').trim()});
      i=j-1; continue;
    }
    // Pure keyword line (no range): "根据以下病例..."
    if(caseKw.test(l)&&!l.match(qRe)){
      var bodyLines=[l], j=i+1;
      while(j<lines.length&&lines[j]&&!lines[j].match(qRe)&&!lines[j].match(rangeRe)){
        bodyLines.push(lines[j]); j++;
      }
      // Peek at first question number after this block to infer range start
      var firstQ=null;
      if(j<lines.length){ var qm3=lines[j].match(qRe); if(qm3) firstQ=parseInt(qm3[1]); }
      caseBlocks.push({lo:firstQ, hi:null, text:bodyLines.join('\n').trim()});
      i=j-1; continue;
    }
  }

  // ── STEP 2: Parse questions normally ──────────────────
  var blocks=[], curQ=null;
  // Reset and re-scan, now skipping lines consumed by case detection
  // We need a clean pass — rebuild lines without case header lines
  // Actually easier: just do a normal parse pass and skip rangeRe / pure caseKw lines
  var i2=0;
  var rawLines=raw.split('\n').map(function(l){return l.trim();});
  while(i2<rawLines.length){
    var l=rawLines[i2]; i2++;
    if(!l) continue;
    if(/^请为|^please select/i.test(l)&&l.length<60) continue;
    // Skip range headers and pure case keyword lines (already extracted above)
    if(l.match(rangeRe)){ while(i2<rawLines.length&&rawLines[i2]&&!rawLines[i2].match(qRe)&&!rawLines[i2].match(rangeRe)) i2++; continue; }
    if(caseKw.test(l)&&!l.match(qRe)){ while(i2<rawLines.length&&rawLines[i2]&&!rawLines[i2].match(qRe)&&!rawLines[i2].match(rangeRe)) i2++; continue; }
    var am=l.match(ansRe); if(am&&curQ){curQ.answer=am[1].toUpperCase();continue;}
    var qm=l.match(qRe);
    if(qm){
      var qnum=parseInt(qm[1]), qbody=qm[2].trim();
      if(!qbody){
        while(i2<rawLines.length&&!rawLines[i2].trim()) i2++;
        if(i2<rawLines.length&&!rawLines[i2].match(optRe)&&!rawLines[i2].match(ansRe)){
          qbody=rawLines[i2].trim(); i2++;
        }
      }
      if(!qbody) continue;
      if(curQ&&curQ.opts.length>=2&&isCN(curQ)) blocks.push(curQ);
      curQ={num:qnum,body:qbody,opts:[],answer:null,id:uid(),caseText:null};
      continue;
    }
    if(!curQ) continue;
    // Format: "A：xxx B：xxx C：xxx" with Chinese colon — check FIRST
    if(/[A-Ea-e]\s*[：:][^A-Ea-e]{1,30}[A-Ea-e]\s*[：:]/.test(l)){
      var cnOptRe=/([A-Ea-e])\s*[：:]\s*(.+?)(?=\s*[A-Ea-e]\s*[：:]|$)/g;
      var found2=[],m3; cnOptRe.lastIndex=0;
      while((m3=cnOptRe.exec(l))!==null){
        var txt=m3[2].trim(); if(txt) found2.push({letter:m3[1].toUpperCase(),text:txt});
      }
      if(found2.length>=2){curQ.opts.push.apply(curQ.opts,found2);continue;}
    }
    var om=l.match(optRe); if(om){curQ.opts.push({letter:om[1].toUpperCase(),text:om[2].trim()});continue;}
    if(/[A-Ea-e]\s*[).]/.test(l)){
      var found=[],m2; inRe.lastIndex=0;
      while((m2=inRe.exec(l))!==null) found.push({letter:m2[1].toUpperCase(),text:m2[2].trim()});
      if(found.length>=2){curQ.opts.push.apply(curQ.opts,found);continue;}
    }
    if(curQ.opts.length>=2){
      if(/^[\u4e00-\u9fff]/.test(l)&&l.length<80) continue;
      if(l.length<80&&!/\d/.test(l)) continue;
    } else if(curQ.opts.length===0){ curQ.body+='\n'+l; }
    else { curQ.opts[curQ.opts.length-1].text+=' '+l; }
  }
  if(curQ&&curQ.opts.length>=2&&isCN(curQ)) blocks.push(curQ);

  // ── STEP 3: Assign case text to questions ─────────────
  // For each question, find matching case block by question number
  blocks.forEach(function(q){
    for(var ci=0;ci<caseBlocks.length;ci++){
      var cb=caseBlocks[ci];
      if(cb.lo===null) continue; // no range info, skip for now
      if(cb.hi!==null){
        // Explicit range: e.g. 208-215
        if(q.num>=cb.lo&&q.num<=cb.hi){ q.caseText=cb.text; return; }
      } else {
        // Range start only: propagate from lo until next case block starts
        var nextLo=Infinity;
        for(var ci2=ci+1;ci2<caseBlocks.length;ci2++){
          if(caseBlocks[ci2].lo!==null){ nextLo=caseBlocks[ci2].lo; break; }
        }
        if(q.num>=cb.lo&&q.num<nextLo){ q.caseText=cb.text; return; }
      }
    }
    // Fallback: assign no-range case blocks based on position
    for(var ci3=0;ci3<caseBlocks.length;ci3++){
      if(caseBlocks[ci3].lo===null){
        // Assign to questions that come right after this block (no explicit range)
        // Only if question has no case yet
        // Skip — handled by pendingCase fallback below
      }
    }
  });

  // Fallback: assign null-lo caseBlocks to questions sequentially
  var pendingNullCase=null;
  var nullCaseCi=0;
  var nullCases=caseBlocks.filter(function(c){return c.lo===null;});
  // For null-lo cases, find which questions they precede by position in blocks array
  // Use a second pass with original line order
  if(nullCases.length){
    // Re-scan raw to map null-lo cases to question numbers
    var scanI=0, nullCI=0;
    var rawL2=raw.split('\n').map(function(l){return l.trim();});
    var nullCaseAssigned=false;
    var currentNullCase=null;
    var currentNullCaseNextQ=null;
    // Find for each null-lo case: the first question number after it
    nullCases.forEach(function(nc,nci){
      // Find position of this case text in rawL2
      for(var ri=0;ri<rawL2.length;ri++){
        if(caseKw.test(rawL2[ri])&&!rawL2[ri].match(qRe)){
          // Found a case keyword line — find next question
          for(var ri2=ri+1;ri2<rawL2.length;ri2++){
            var qm4=rawL2[ri2].match(qRe);
            if(qm4){ nc.lo=parseInt(qm4[1]); break; }
          }
          break;
        }
      }
    });
    // Now re-run assignment for null-lo cases that now have lo
    blocks.forEach(function(q){
      if(q.caseText) return; // already assigned
      for(var ci4=0;ci4<caseBlocks.length;ci4++){
        var cb=caseBlocks[ci4];
        if(cb.lo===null) continue;
        if(cb.hi!==null){
          if(q.num>=cb.lo&&q.num<=cb.hi){ q.caseText=cb.text; return; }
        } else {
          var nextLo2=Infinity;
          for(var ci5=ci4+1;ci5<caseBlocks.length;ci5++){
            if(caseBlocks[ci5].lo!==null){ nextLo2=caseBlocks[ci5].lo; break; }
          }
          if(q.num>=cb.lo&&q.num<nextLo2){ q.caseText=cb.text; return; }
        }
      }
    });
  }

  return blocks;
}
function uid(){return Math.random().toString(36).slice(2,10);}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ═══════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════
function importQuestions(start) {
  var raw = document.getElementById('raw').value.trim();
  var name = document.getElementById('batch-name').value.trim();
  var msg = document.getElementById('import-msg'); msg.textContent=''; msg.style.color='';
  if(!raw){msg.textContent='请先粘贴题目。';msg.style.color='red';return;}
  var qs = parseQ(raw);
  if(!qs.length){msg.textContent='未识别到题目，请检查格式。';msg.style.color='red';return;}
  var bname = name || ('批次'+(DB.batches.length+1)+' — '+new Date().toLocaleDateString('zh-CN'));
  var batch = {id:uid(), name:bname, date:Date.now(), questions:qs, progress:{idx:0, answers:new Array(qs.length).fill(null), dk:{}}};
  DB.batches.push(batch); saveDB(); renderHome();
  msg.textContent='✓ 导入 '+qs.length+' 道题 → "'+bname+'"'; msg.style.color='green';
  document.getElementById('raw').value=''; document.getElementById('batch-name').value='';
  if(start) setTimeout(function(){ showBatchDetail(batch.id); }, 400);
}

// ═══════════════════════════════════════════════════════
// BATCH DETAIL — full question list with all ops
// ═══════════════════════════════════════════════════════
function showBatchDetail(batchId) {
  var batch=null;
  for(var i=0;i<DB.batches.length;i++){ if(DB.batches[i].id===batchId){batch=DB.batches[i];break;} }
  if(!batch) return;
  var p = batch.progress, resumeIdx=0;
  for(var j=0;j<p.answers.length;j++){ if(!p.answers[j]){resumeIdx=j;break;} }
  var allDone = p.answers.every(function(a){return !!a;});
  var done = p.answers.filter(function(a){return a&&a!=='skip';}).length;
  var prog = Math.round(done/batch.questions.length*100);

  var html = '<div class="card">'
    +'<div class="row" style="flex-wrap:wrap;gap:8px">'
    +'<button class="btn" onclick="navBack()">← 返回</button>'
    +'<div class="title spacer" style="margin-left:8px">'+esc(batch.name)+'</div>'
    +'<button class="btn small" onclick="renameBatch(\''+batchId+'\')">✏️ 改名</button>'
    +'<button class="btn small red" onclick="deleteBatch(\''+batchId+'\')">🗑 删除批次</button>'
    +'</div>'
    +'<div class="sub" style="margin:6px 0">共 '+batch.questions.length+' 题 · 已答 '+done+' ('+prog+'%) · 点任意行从该题开始</div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap">'
    +'<button class="btn primary" onclick="startBatchFrom(\''+batchId+'\','+resumeIdx+')">'+(allDone?'🔄 从头重做':'▶ 继续第'+(resumeIdx+1)+'题')+'</button>'
    +'<button class="btn" onclick="startBatchFrom(\''+batchId+'\',0)">从第1题开始</button>'
    +'</div>'
    +'<div class="row" style="margin-top:8px;align-items:center;gap:6px">'
    +'<span style="font-size:13px;color:#666">跳到第</span>'
    +'<input id="goto-q-inp-'+batchId+'" type="number" min="1" max="'+batch.questions.length+'" placeholder="题号" style="width:80px;padding:6px 8px;border:1.5px solid #d0cec8;border-radius:6px;font-size:14px;text-align:center">'
    +'<span style="font-size:13px;color:#666">题</span>'
    +'<button class="btn blue small" onclick="gotoQuestion(\''+batchId+'\')">跳转开始</button>'
    +'</div></div>'

    +'<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="padding:10px 12px;background:#f0efe9;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #ddd">'
    +'<input type="checkbox" id="batch-cb-all" onchange="batchSelectAll(this.checked)" style="width:15px;height:15px"><span style="font-size:12px;color:#666">全选</span>'
    +'<button class="btn small red" onclick="batchDeleteSelected(\''+batchId+'\')">🗑 删除选中</button>'
    +'<button class="btn small" onclick="batchStarSelected(\''+batchId+'\')">⭐ 打星</button>'
    +'<button class="btn small blue" onclick="batchToNotes(\''+batchId+'\')">📝 存入笔记</button>'
    +'<button class="btn small purple" onclick="batchAISummary(\''+batchId+'\')">🤖 AI整理复习</button>'
    +'</div>'
    +'<div class="tablewrap" style="margin:0"><table style="width:100%;border-collapse:collapse">'
    +'<thead><tr style="background:#f8f7f3;font-size:12px">'
    +'<th style="padding:7px 10px;width:32px"></th>'
    +'<th style="padding:7px 10px;width:48px;text-align:left">题号</th>'
    +'<th style="padding:7px 10px;text-align:left">题目</th>'
    +'<th style="padding:7px 10px;width:38px;text-align:center">我选</th>'
    +'<th style="padding:7px 10px;width:38px;text-align:center">答案</th>'
    +'<th style="padding:7px 10px;width:44px;text-align:center">结果</th>'
    +'<th style="padding:7px 10px;width:48px;text-align:center">解析</th>'
    +'</tr></thead><tbody>';

  batch.questions.forEach(function(q,i){
    var my=p.answers[i], hasAns=!!q.answer;
    var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();
    var bad=hasAns&&my&&my!=='skip'&&!ok;
    var dk=!!(p.dk&&p.dk[i]);
    var isStar=!!DB.starMap[q.id];
    // DK rows get strong yellow highlight
    var rowBg = dk?'#fff3cd' : ok?'#f0fff4' : bad?'#fff5f5' : '';
    var result = !my?'<span style="color:#ccc">—</span>'
      : my==='skip'?'<span style="color:#aaa;font-size:11px">跳</span>'
      : !hasAns?'<span style="color:#aaa">?</span>'
      : ok?'<span style="color:#2e7d52;font-weight:700">✓</span>'
      : '<span style="color:#b83232;font-weight:700">✗</span>';
    html += '<tr style="border-top:1px solid #eee;background:'+rowBg+'" onclick="startBatchFrom(\''+batchId+'\','+i+')" style="cursor:pointer">'
      +'<td style="padding:7px 10px;text-align:center" onclick="event.stopPropagation()">'
      +'<input type="checkbox" class="batch-cb" data-qid="'+q.id+'" data-idx="'+i+'" style="width:14px;height:14px"></td>'
      +'<td style="padding:7px 10px;font-weight:700;font-size:13px;cursor:pointer">'
      +(isStar?'⭐ ':'')+(dk?'<span style="color:#c47a1a">❓</span> ':'')+(q.num||i+1)+'</td>'
      +'<td style="padding:7px 10px;font-size:13px;color:#333;cursor:pointer">'
      +esc((function(b){ var s=b.replace(/\n/g,' ').replace(/\s+/g,' ').trim(); return s.length>80?s.slice(0,80)+'…':s; })(q.body))+'</td>'
      +'<td style="padding:7px 10px;text-align:center;font-size:13px">'+(my&&my!=='skip'?my:'—')+'</td>'
      +'<td style="padding:7px 10px;text-align:center;font-size:13px">'+(hasAns?'<b>'+q.answer+'</b>':'—')+'</td>'
      +'<td style="padding:7px 10px;text-align:center">'+result+'</td>'
      +'<td style="padding:7px 10px;text-align:center" onclick="event.stopPropagation()">'
      +'<button class="btn small blue" style="padding:3px 8px;font-size:11px" data-qid="'+q.id+'" data-bid="'+batchId+'" data-idx="'+i+'" onclick="openModalFromBatch(this.dataset.qid,this.dataset.bid,parseInt(this.dataset.idx))">解析</button></td>'
      +'</tr>';
  });
  html += '</tbody></table></div></div>';
  html += backBtn();

  var dp = document.getElementById('batch-detail');
  if(!dp){ dp=document.createElement('section'); dp.id='batch-detail'; dp.className='page'; document.querySelector('main').appendChild(dp); }
  dp.innerHTML = html;
  navTo('batch-detail');
}

function renameBatch(batchId){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}}
  if(!batch)return;
  var n=prompt('修改批次名称：',batch.name); if(!n||!n.trim())return;
  batch.name=n.trim(); saveDB(); renderHome(); showBatchDetail(batchId);
}
function deleteBatch(batchId){
  if(!confirm('确定删除整个批次？此操作不可撤销。'))return;
  DB.batches=DB.batches.filter(function(b){return b.id!==batchId;}); saveDB(); renderHome(); navBack();
}
function batchSelectAll(c){ document.querySelectorAll('.batch-cb').forEach(function(cb){cb.checked=c;}); }
function getSelectedBatchItems(){ var items=[]; document.querySelectorAll('.batch-cb:checked').forEach(function(cb){items.push({qid:cb.dataset.qid,idx:parseInt(cb.dataset.idx)});}); return items; }

function batchDeleteSelected(batchId){
  var items=getSelectedBatchItems(); if(!items.length){showToast('请先勾选题目');return;}
  if(!confirm('确定删除选中的 '+items.length+' 道题？'))return;
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var dels=items.map(function(x){return x.idx;});
  batch.questions=batch.questions.filter(function(q,i){return dels.indexOf(i)<0;});
  batch.progress={idx:0,answers:new Array(batch.questions.length).fill(null),dk:{}}; saveDB(); showBatchDetail(batchId); showToast('已删除 '+items.length+' 题');
}
function batchStarSelected(batchId){
  var items=getSelectedBatchItems(); if(!items.length){showToast('请先勾选题目');return;}
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  items.forEach(function(x){ var q=batch.questions[x.idx]; if(q) DB.starMap[q.id]=!DB.starMap[q.id]; });
  saveDB(); showBatchDetail(batchId); showToast('已切换星号');
}
function batchToNotes(batchId){
  var items=getSelectedBatchItems(); if(!items.length){showToast('请先勾选题目');return;}
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var added=0;
  items.forEach(function(x){
    var q=batch.questions[x.idx]; if(!q)return;
    if(!DB.notes.some(function(n){return n.qid===q.id&&n.type==='question';})){
      DB.notes.push({id:uid(),qid:q.id,type:'question',title:'#'+(q.num||x.idx+1)+' '+q.body.slice(0,40),content:q.body,opts:q.opts,answer:q.answer,batchName:batch.name,ts:Date.now(),analysis:DB.analysisCache[q.id]||''});
      added++;
    }
  });
  saveDB(); showToast('已存入笔记 '+added+' 道题');
}
async function batchAISummary(batchId){
  var items=getSelectedBatchItems(); if(!items.length){showToast('请先勾选题目');return;}
  if(items.length>20){showToast('每次最多选20题，请减少勾选');return;}
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var qs=items.map(function(x){return batch.questions[x.idx];}).filter(Boolean);
  showToast('🤖 AI整理中，约15秒…',20000);
  var prompt='请把以下PCE针灸考试题目整理成简洁背诵/复习笔记：\n\n'
    +qs.map(function(q,i){return (i+1)+'. '+q.body+'\n答案：'+(q.answer||'?')+(DB.analysisCache[q.id]?'\n解析：'+DB.analysisCache[q.id].slice(0,150):'');}).join('\n\n')
    +'\n\n要求：按知识点归类，用表格对比混淆点，每点一句口诀，适合考前速览';
  try{
    var txt=await callClaude(prompt,4096);
    DB.notes.push({id:uid(),type:'ai-summary',title:'AI复习笔记 — '+batch.name+'('+qs.length+'题)',content:txt,ts:Date.now()});
    saveDB(); showToast('✓ AI复习笔记已存入笔记本'); navTo('notes'); renderNotes();
  }catch(e){showToast('生成失败：'+e.message);}
}

// ═══════════════════════════════════════════════════════
// QUIZ — auto-advance on pick, timer stop = no auto-jump
// ═══════════════════════════════════════════════════════
var QZ = {batch:null,qs:[],ans:[],dk:{},cur:0,sel:null,tmr:null,tLeft:60,tMax:60,paused:false,stopped:false,_autoNext:null,returnToBatchId:null};

function resumeQuiz(){
  if(!DB.batches.length){ showToast('请先导入题目。'); return; }
  // First: use saved last position if available
  if(DB.lastPos && DB.lastPos.batchId && DB.lastPos.idx!=null){
    var lb=null; for(var x=0;x<DB.batches.length;x++){if(DB.batches[x].id===DB.lastPos.batchId){lb=DB.batches[x];break;}}
    if(lb){ startBatchFrom(DB.lastPos.batchId, DB.lastPos.idx); return; }
  }
  // Fallback: find first unanswered question
  var batch=null, resumeIdx=0;
  for(var i=0;i<DB.batches.length;i++){
    var b=DB.batches[i], p=b.progress, found=false;
    for(var j=0;j<b.questions.length;j++){ if(!p.answers[j]){ resumeIdx=j; found=true; break; } }
    if(found){ batch=b; break; }
  }
  if(!batch){
    // All answered: go to last batch, last question
    batch=DB.batches[DB.batches.length-1];
    resumeIdx=batch.questions.length-1;
  }
  startBatchFrom(batch.id, resumeIdx);
}

function startFirstBatch(){ if(!DB.batches.length){showToast('请先导入题目');return;} showBatchDetail(DB.batches[0].id); }

function startBatch(batchId, fromStart){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  if(fromStart){
    // Save first-time answers before resetting (for comparison)
    var prev = batch.progress.answers||[];
    var hasAnswers = prev.some(function(a){return a&&a!=='skip';});
    if(hasAnswers && !batch.progress.firstAnswers){
      batch.progress.firstAnswers = prev.slice(); // save first attempt
    }
    batch.progress={idx:0, answers:new Array(batch.questions.length).fill(null), dk:{},
      firstAnswers: batch.progress.firstAnswers||null};
    saveDB();
    startBatchFrom(batchId, 0);
    return;
  }
  var p=batch.progress;
  // Use saved lastPos for this batch if available
  if(DB.lastPos && DB.lastPos.batchId===batchId && DB.lastPos.idx!=null){
    startBatchFrom(batchId, DB.lastPos.idx);
    return;
  }
  // Otherwise find first unanswered
  var resumeIdx=-1;
  for(var j=0;j<p.answers.length;j++){ if(!p.answers[j]){ resumeIdx=j; break; } }
  // If all answered, go to last question
  if(resumeIdx<0) resumeIdx=batch.questions.length-1;
  startBatchFrom(batchId, resumeIdx);
}

function gotoQuestion(batchId){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var inp=document.getElementById('goto-q-inp-'+batchId);
  if(!inp){showToast('请输入题号');return;}
  var qnum=parseInt(inp.value);
  if(!qnum||qnum<1){showToast('请输入有效题号');return;}
  // Find by question number (q.num), fallback to position
  var idx=-1;
  for(var j=0;j<batch.questions.length;j++){
    if(batch.questions[j].num===qnum){idx=j;break;}
  }
  if(idx<0){
    // Fallback: treat as 1-based position
    idx=qnum-1;
    if(idx<0||idx>=batch.questions.length){showToast('题号超出范围 (1–'+batch.questions.length+')');return;}
  }
  startBatchFrom(batchId, idx);
}

function startBatchFrom(batchId, fromIdx){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var tMax = parseInt(document.getElementById('limit').value)||60;
  var p = batch.progress, prevAns = p.answers[fromIdx];
  QZ = {batch:batch, qs:batch.questions, ans:p.answers.slice(),
    dk:p.dk ? JSON.parse(JSON.stringify(p.dk)) : {},
    cur:fromIdx, sel:(prevAns&&prevAns!=='skip')?prevAns:null,
    tmr:null, tLeft:tMax, tMax:tMax, paused:false, stopped:false, _autoNext:null, returnToBatchId:batchId};
  document.getElementById('q-batch').textContent = batch.name;
  document.getElementById('q-total').textContent = batch.questions.length;
  navTo('quiz'); loadQ(QZ.cur);
}

function loadQ(i){
  clearInterval(QZ.tmr); clearTimeout(QZ._autoNext);
  QZ.stopped=false; QZ.paused=false;
  var q = QZ.qs[i];
  document.getElementById('q-num').textContent = q.num||(i+1);
  document.getElementById('qbar').style.width = (i/QZ.qs.length*100)+'%';
  document.getElementById('qbody').textContent = q.body;
  var cb = document.getElementById('casebox'); cb.innerHTML='';
  if(q.caseText){ cb.innerHTML='<div class="case-title">📋 病例资料（共用）</div><div class="case-text">'+esc(q.caseText)+'</div>'; cb.style.display='block'; }
  else cb.style.display='none';
  var prev = QZ.ans[i]; QZ.sel = (prev&&prev!=='skip')?prev:null;
  var optsEl = document.getElementById('opts'); optsEl.innerHTML='';
  q.opts.forEach(function(o){
    var btn = document.createElement('button'); btn.className='opt';
    btn.innerHTML='<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span>';
    if(QZ.sel&&QZ.sel===o.letter) btn.classList.add('sel');
    btn.addEventListener('click',(function(letter,b){return function(){pickOpt(letter,b);};})(o.letter,btn));
    optsEl.appendChild(btn);
  });
  rebuildActions(); startTimer();
}

function rebuildActions(){
  var el = document.querySelector('#quiz .actions'); if(!el) return;
  el.innerHTML = '<button class="btn small" onclick="prevQ()">← 上一题</button>'
    +'<button class="btn small" onclick="skipQ()">跳过</button>'
    +'<button class="btn small orange" id="dkbtn" onclick="toggleDK()">不会</button>'
    +'<button class="btn small primary" onclick="nextQ()">确认/下一题 →</button>'
    +'<button class="btn small blue" onclick="openQuizAI()">🔍 AI解析</button>'
    +(QZ.returnToBatchId?'<button class="btn small" onclick="goBackToBatch()">📋 列表</button>':'')
    +'<button class="btn small red spacer" onclick="finishQuiz()">结束</button>';
  var db = document.getElementById('dkbtn'); if(db) db.classList.toggle('on',!!QZ.dk[QZ.cur]);
}

// Open AI modal for current quiz question
function openQuizAI(){
  if(!QZ.qs||!QZ.qs[QZ.cur]) return;
  openModal(QZ.qs[QZ.cur].id, QZ.cur);
}

function goBackToBatch(){ clearInterval(QZ.tmr); clearTimeout(QZ._autoNext); if(QZ.sel) autoSave(QZ.cur,QZ.sel); showBatchDetail(QZ.returnToBatchId); }

// Auto-advance 700ms after picking — but ONLY if timer not stopped
function pickOpt(l,btn){
  QZ.sel=l;
  document.querySelectorAll('#opts .opt').forEach(function(b){b.classList.remove('sel');});
  btn.classList.add('sel');
  autoSave(QZ.cur,l);
  clearTimeout(QZ._autoNext);
  if(!QZ.stopped){
    QZ._autoNext = setTimeout(function(){
      if(QZ.sel===l){ clearInterval(QZ.tmr); advanceQ(); }
    },700);
  }
}
function autoSave(i,ans){
  QZ.ans[i]=ans;
  QZ.batch.progress.answers=QZ.ans;
  QZ.batch.progress.idx=QZ.cur;
  QZ.batch.progress.dk=QZ.dk;
  // Save last played position for resumeQuiz
  DB.lastPos={batchId:QZ.batch.id, idx:QZ.cur};
  saveDB();
}

// ═══════════════════════════════════════════════════════
// TIMER — click once to pause, click again to stop (no auto-jump)
// ═══════════════════════════════════════════════════════
function startTimer(){
  var el = document.getElementById('timer');
  if(QZ.tMax===0){ el.textContent='∞'; el.className='timer spacer'; return; }
  QZ.tLeft=QZ.tMax; QZ.stopped=false; QZ.paused=false; updTimer();
  QZ.tmr = setInterval(function(){
    if(QZ.paused||QZ.stopped) return;
    QZ.tLeft--; updTimer();
    if(QZ.tLeft<=0){ clearInterval(QZ.tmr); if(!QZ.stopped){ autoSave(QZ.cur,QZ.sel||'skip'); advanceQ(); } }
  },1000);
}
function updTimer(){
  var el = document.getElementById('timer'); if(!el) return;
  if(QZ.stopped){ el.textContent='⏹ 点击重启'; el.className='timer spacer paused'; return; }
  var pct=QZ.tLeft/QZ.tMax;
  el.textContent = QZ.paused?('⏸ '+QZ.tLeft+' 再点停止'):QZ.tLeft;
  el.className = 'timer spacer'+(QZ.paused?' paused':pct>.5?' green':pct>.2?' orange':' red');
}
document.getElementById('timer').addEventListener('click',function(){
  if(QZ.tMax===0) return;
  if(QZ.stopped){
    QZ.stopped=false; QZ.paused=false; QZ.tLeft=QZ.tMax; updTimer();
    clearInterval(QZ.tmr);
    QZ.tmr=setInterval(function(){ if(QZ.paused||QZ.stopped)return; QZ.tLeft--;updTimer(); if(QZ.tLeft<=0){clearInterval(QZ.tmr);if(!QZ.stopped){autoSave(QZ.cur,QZ.sel||'skip');advanceQ();}} },1000);
    showToast('计时重新开始'); return;
  }
  if(!QZ.paused){ QZ.paused=true; updTimer(); showToast('⏸ 已暂停，再点彻底停止（不自动跳题）'); }
  else { QZ.stopped=true; QZ.paused=false; clearTimeout(QZ._autoNext); clearInterval(QZ.tmr); updTimer(); showToast('⏹ 计时已停止，不会自动跳题'); }
});

function nextQ(){ clearInterval(QZ.tmr); clearTimeout(QZ._autoNext); autoSave(QZ.cur,QZ.sel||'skip'); advanceQ(); }
function skipQ(){ clearInterval(QZ.tmr); clearTimeout(QZ._autoNext); autoSave(QZ.cur,'skip'); QZ.sel=null; advanceQ(); }
function prevQ(){ clearInterval(QZ.tmr); clearTimeout(QZ._autoNext); if(QZ.sel) autoSave(QZ.cur,QZ.sel); if(QZ.cur>0){QZ.cur--;loadQ(QZ.cur);}else showToast('已是第一题'); }
function toggleDK(){ QZ.dk[QZ.cur]=!QZ.dk[QZ.cur]; var db=document.getElementById('dkbtn'); if(db) db.classList.toggle('on',!!QZ.dk[QZ.cur]); autoSave(QZ.cur,QZ.sel||QZ.ans[QZ.cur]||'skip'); showToast(QZ.dk[QZ.cur]?'已标记「不会」':'已取消标记'); }
function advanceQ(){ if(QZ.cur+1>=QZ.qs.length){finishQuiz();return;} QZ.cur++; loadQ(QZ.cur); }
function finishQuiz(){
  clearInterval(QZ.tmr); clearTimeout(QZ._autoNext);
  for(var i=0;i<QZ.ans.length;i++){if(!QZ.ans[i])QZ.ans[i]='skip';}
  autoSave(QZ.cur,QZ.ans[QZ.cur]); commitResults();
  // Show result then offer to go back to batch
  showResultPage();
}
function commitResults(){
  var batch=QZ.batch;
  for(var i=0;i<QZ.qs.length;i++){
    var q=QZ.qs[i],my=QZ.ans[i]; if(!my||my==='skip') continue;
    DB.stats.done=(DB.stats.done||0)+1;
    if(q.answer){ var ok=my.toUpperCase()===q.answer.toUpperCase(); if(ok){DB.stats.correct=(DB.stats.correct||0)+1;delete DB.wrongMap[q.id];}else DB.wrongMap[q.id]={q:q,batchId:batch.id,batchName:batch.name,myAns:my}; }
    if(QZ.dk[i]) DB.dkMap[q.id]={q:q,batchId:batch.id,batchName:batch.name};
    else if(q.answer&&my.toUpperCase()===(q.answer||'').toUpperCase()) delete DB.dkMap[q.id];
  }
  saveDB(); renderHome();
}

// ═══════════════════════════════════════════════════════
// RESULT PAGE
// ═══════════════════════════════════════════════════════
function showResultPage(){
  var batch=QZ.batch;
  document.getElementById('result-batch').textContent=batch.name;
  var withAns=QZ.qs.filter(function(q){return !!q.answer;}).length, correct=0, wrong=0, dkCount=0;
  var tbody=document.getElementById('result-table'); tbody.innerHTML='';
  // Auto-fill correct answer text into qNotes for questions with answers
  if(!DB.qNotes) DB.qNotes={};
  QZ.qs.forEach(function(q){
    if(q.answer && !DB.qNotes[q.id]){
      var correctOpt = q.opts.find(function(o){return o.letter===q.answer.toUpperCase();});
      if(correctOpt) DB.qNotes[q.id] = q.answer+'. '+correctOpt.text;
    }
  });
  saveDB();

  QZ.qs.forEach(function(q,i){
    var my=QZ.ans[i], hasAns=!!q.answer;
    var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();
    var dk=!!QZ.dk[i];
    if(ok)correct++; if(hasAns&&my&&my!=='skip'&&!ok)wrong++; if(dk)dkCount++;
    var firstAns = (QZ.batch&&QZ.batch.progress&&QZ.batch.progress.firstAnswers) ? QZ.batch.progress.firstAnswers[i] : null;
    var tr=document.createElement('tr'); tr.style.cursor='pointer';
    var rowBg = dk?'#fff3cd' : (hasAns&&my&&my!=='skip'?(ok?'#f0fff4':'#fff5f5'):'');
    tr.style.background=rowBg;
    (function(qid,idx){ tr.addEventListener('click',function(){openModal(qid,idx);}); })(q.id,i);
    tr.innerHTML='<td><strong>'+(q.num||i+1)+'</strong>'+(DB.starMap[q.id]?' ⭐':'')+'</td>'
      +'<td>'+esc(q.body.replace(/\n/g,' ').slice(0,38))+(dk?' <b style="color:#c47a1a">❓</b>':'')+'</td>'
      +'<td style="font-weight:600;color:#1a4fa0">'+(my&&my!=='skip'?my:'<span style="color:#bbb">—</span>')
      +(firstAns&&firstAns!=='skip'&&firstAns!==my?'<br><span style="font-size:10px;color:#aaa">初：'+firstAns+'</span>':'')+'</td>'
      +'<td style="font-weight:700">'+(hasAns?'<span style="color:'+(ok?'#2e7d52':'#b83232')+'">'+q.answer+'</span>':'<span style="color:#bbb">—</span>')+'</td>'
      +'<td>'+(hasAns&&my&&my!=='skip'?(ok?'<span style="color:#2e7d52;font-size:16px">✓</span>':'<span style="color:#b83232;font-size:16px">✗</span>'):'<span style="color:#bbb">—</span>')+'</td>'
      +'<td onclick="event.stopPropagation()" data-qid="'+q.id+'" style="min-width:160px;max-width:280px">'+'<div style="display:flex;flex-direction:column;gap:4px">'+'<button class="btn small blue" style="padding:2px 6px;font-size:11px" onclick="event.stopPropagation();openModal(\''+q.id+'\','+i+')">解析</button>'+'<div class="qnote-display" style="font-size:12px;color:#b83232;background:#fff3cd;padding:5px 8px;border-radius:6px;cursor:pointer;white-space:pre-wrap;word-break:break-all;line-height:1.5;border:1px solid #f0d060;display:'+(DB.qNotes&&DB.qNotes[q.id]?'block':'none')+'" onclick="event.stopPropagation();editQNote(\''+q.id+'\')">📌 '+(DB.qNotes&&DB.qNotes[q.id]?esc(DB.qNotes[q.id]):'')+'</div>'+'<button class="btn small qnote-btn" style="padding:2px 5px;font-size:10px;color:#888;align-self:flex-start" onclick="event.stopPropagation();editQNote(\''+q.id+'\')">'+(DB.qNotes&&DB.qNotes[q.id]?'✏️ 改':'＋ 标注')+'</button>'+'</div></td>';
    tbody.appendChild(tr);
  });
  document.getElementById('rs-total').textContent=QZ.qs.length;
  document.getElementById('rs-ok').textContent=correct;
  document.getElementById('rs-bad').textContent=wrong;
  document.getElementById('rs-dk').textContent=dkCount;
  document.getElementById('rs-rate').textContent=withAns?Math.round(correct/withAns*100)+'%':'—';
  // Auto-load saved answer key for this batch
  var savedKey = (QZ.batch && DB.answerKeys) ? (DB.answerKeys[QZ.batch.id]||'') : '';
  document.getElementById('answer-key').value=savedKey;
  if(savedKey){
    document.getElementById('key-msg').textContent='（已自动加载上次答案 — 直接点"核对"即可）';
    document.getElementById('key-msg').style.color='#2e7d52';
  } else {
    document.getElementById('key-msg').textContent='';
  }
  // Add back-to-batch button — only once, remove old one first
  var batchId = QZ.returnToBatchId;
  setTimeout(function(){
    // Remove any previous banners (prevents duplicates)
    var old = document.getElementById('result-done-banner');
    if(old) old.parentNode.removeChild(old);
    if(!batchId) return;
    var r=document.getElementById('result'); if(!r) return;
    var btn=document.createElement('div');
    btn.id='result-done-banner';
    btn.style.cssText='padding:12px 16px;background:#e8f5ed;border:1px solid #b8dfc8;border-radius:8px;margin:0 0 12px 0;display:flex;align-items:center;gap:12px';
    var bBtn=document.createElement('button');bBtn.className='btn primary';bBtn.textContent='📋 回到题目列表';
    (function(bid){bBtn.addEventListener('click',function(){showBatchDetail(bid);});})(batchId);
    btn.innerHTML='<span style="font-size:14px;flex:1">✓ 答题完成！</span>';
    btn.appendChild(bBtn);
    // Insert after the first card (result stats card), not before everything
    var firstCard = r.querySelector('.card');
    if(firstCard) firstCard.parentNode.insertBefore(btn, firstCard.nextSibling);
    else r.insertBefore(btn, r.firstChild);
  },50);
  navTo('result');
}

function compareKey(){
  var raw=document.getElementById('answer-key').value.trim(), msg=document.getElementById('key-msg');
  if(!raw){msg.textContent='请先粘贴答案。';return;}

  var keyByNum={};  // qNum -> letter,  e.g. {141:'D', 142:'C'}
  var keyByPos={};  // position -> letter, for pure letter string fallback

  // Format 1: pure letter string e.g. "ACBDE..."
  if(/^\s*[A-Ea-e]+\s*$/.test(raw.replace(/\s/g,''))){
    raw.replace(/\s/g,'').split('').forEach(function(c,i){keyByPos[i]=c.toUpperCase();});
  } else {
    // Format 2: "141. d  142. c  143. e" — tab/space/newline separated
    // Match all (number, letter) pairs anywhere in the text
    var pairRe=/(\d{1,4})\s*[.、]?\s*([A-Ea-e])(?=[^A-Za-z]|$)/gi, m;
    while((m=pairRe.exec(raw))!==null){
      keyByNum[parseInt(m[1])]=m[2].toUpperCase();
    }
  }

  if(!Object.keys(keyByNum).length && !Object.keys(keyByPos).length){
    msg.textContent='未能识别答案格式，请检查。'; msg.style.color='red'; return;
  }

  var updated=0, correct=0, notFound=0;
  QZ.qs.forEach(function(q,i){
    var key;
    if(Object.keys(keyByNum).length){
      // Match by question number
      key = keyByNum[q.num];
      if(!key){ notFound++; return; }
    } else {
      // Match by position
      key = keyByPos[i]; if(!key) return;
    }
    q.answer=key; updated++;
    var my=QZ.ans[i];
    if(my&&my!=='skip'&&my.toUpperCase()===key) correct++;
  });

  // Save answer key for this batch so it auto-loads next time
  if(QZ.batch){ saveAnswerKeyForBatch(QZ.batch.id, raw); }

  showResultPage();
  var note = notFound>0?' ('+notFound+'题题号未匹配，请检查题号是否一致)':'';
  msg.textContent='✓ 已对比 '+updated+' 题，答对 '+correct+' 题'+note+'。';
  msg.style.color='green';
}

// Per-batch answer key storage
function saveAnswerKeyForBatch(batchId, raw){
  if(!DB.answerKeys) DB.answerKeys={};
  DB.answerKeys[batchId]=raw; saveDB();
  showToast('✓ 答案已保存，下次自动加载');
}
function loadAnswerKeyForBatch(batchId){
  if(!DB.answerKeys) return '';
  return DB.answerKeys[batchId]||'';
}

// ═══════════════════════════════════════════════════════
// MODAL — AI analysis + highlight + notes + chat
// ═══════════════════════════════════════════════════════
var _mQid=null, _mIdx=null, _aiChat=[];

function openModal(qid,idx){
  var q=(QZ.qs&&QZ.qs[idx])||null;
  if(!q){var e=DB.wrongMap[qid]||DB.dkMap[qid];if(e)q=e.q;}
  if(!q) return;
  _mQid=qid; _mIdx=idx; _aiChat=[];
  var my=QZ.ans?QZ.ans[idx]:null, hasAns=!!q.answer;
  var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();
  document.getElementById('m-title').textContent='第 '+(q.num||idx+1)+' 题'+(DB.starMap[q.id]?' ⭐':'');
  var content=document.getElementById('m-content');

  var html='';
  if(q.caseText) html+='<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;white-space:pre-wrap;user-select:text">📋 病例资料<br>'+esc(q.caseText)+'</div>';

  // Selectable question body
  html+='<div id="modal-qbody" style="font-size:15px;line-height:1.9;margin-bottom:12px;white-space:pre-wrap;user-select:text;cursor:text;padding:8px;background:#f8f7f3;border-radius:6px">'+esc(q.body)+'</div>';

  // Options (also selectable text)
  html+='<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">';
  q.opts.forEach(function(o){
    var isCorrect=o.letter===(q.answer||''), isMy=my&&o.letter===my&&!isCorrect;
    var bg=isCorrect?'background:#e8f5ed;border-color:#2e7d52':isMy?'background:#fdeaea;border-color:#b83232':'';
    html+='<div style="padding:9px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;'+bg+';user-select:text">'
      +o.letter+'. '+esc(o.text)+(isCorrect?' <b style="color:#2e7d52">✓ 正确</b>':'')+(isMy?' <b style="color:#b83232">← 我选</b>':'')+'</div>';
  });
  html+='</div>';
  if(hasAns&&my&&my!=='skip') html+='<div style="margin-bottom:10px;font-size:14px;font-weight:600;color:'+(ok?'#2e7d52':'#b83232')+'">'+(ok?'✓ 答对了':'✗ 答错了 — 我选 '+my+'，正确是 '+q.answer)+'</div>';

  // Highlight / notes toolbar
  html+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap;padding:8px 10px;background:#f5f3ee;border-radius:8px">'
    +'<span style="font-size:11px;color:#888;flex-shrink:0">选中文字后：</span>'
    +'<button class="btn small" style="background:#FFE066;color:#333;border:1px solid #f0c040;font-weight:700" onclick="hlSelected(\'yellow\')">🖊 高亮</button>'
    +'<button class="btn small" style="background:#FF6B6B;color:#fff;border:none;font-weight:700" onclick="hlSelected(\'red\')">🔴 红色标注</button>'
    +'<button class="btn small" style="background:#fff;color:#333;border-bottom:2.5px solid #333;font-weight:700" onclick="hlSelected(\'underline\')"><u>U</u> 划线</button>'
    +'<button class="btn small" style="background:#fff;color:#333;border:1px solid #aaa;font-weight:700" onclick="hlSelected(\'bold\')"><b>B</b> 粗体</button>'
    +'<button class="btn small" style="background:#f5f5f5;color:#555;border:1px solid #ccc" onclick="undoHighlight()">↩ 撤销</button>'
    +'<button class="btn small blue" onclick="saveSelToNote()">📝 选中→笔记</button>'
    +'<button class="btn small" onclick="addWholeQToNote()">📌 整题→笔记</button>'
    +'</div>';

  // AI section
  html+='<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">'
    +'<button class="btn blue small" onclick="doAnalyze()">🔍 AI解析此题</button>'
    +'<button class="btn small" onclick="doSimilar()">✨ 同类题</button>'
    +'</div>'
    +'<div id="modal-ai-area"></div>';

  // Annotation box — syncs with result table
  html+='<div style="margin-top:12px;padding:10px 12px;background:#fffbe6;border:1px solid #f0d060;border-radius:8px">'
    +'<div style="font-size:12px;font-weight:700;color:#8a6000;margin-bottom:6px">📌 我的标注（与总表同步）</div>'
    +'<textarea id="modal-qnote" placeholder="例如：更正为C / 答案有疑问 / 考点备注…" '
    +'style="width:100%;min-height:60px;padding:8px;border:1px solid #f0d060;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;background:#fffdf5"'
    +'oninput="saveModalQNote()"></textarea>'
    +'</div>';

  // Chat — always visible
  html+='<div style="margin-top:14px;border-top:2px solid #e8e4f8;padding-top:12px">'
    +'<div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">💬 与AI对话（追问、深究）</div>'
    +'<div id="chat-messages" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;margin-bottom:8px"></div>'
    +'<div style="display:flex;gap:6px;align-items:flex-end">'
    +'<textarea id="chat-input" placeholder="例如：为什么不选B？这个穴位怎么记？" style="flex:1;min-height:52px;max-height:120px;padding:8px;border:1.5px solid #d4c9f5;border-radius:8px;font-size:13px;resize:vertical"></textarea>'
    +'<button class="btn blue small" onclick="sendChat()" style="align-self:flex-end;padding:8px 14px">发送</button>'
    +'</div>'
    +'<div style="font-size:10px;color:#bbb;margin-top:3px">Enter 发送 · Shift+Enter 换行</div>'
    +'</div>';

  content.innerHTML=html;

  // Load existing qNote into textarea
  setTimeout(function(){
    var ta=document.getElementById('modal-qnote');
    if(ta&&DB.qNotes&&DB.qNotes[qid]) ta.value=DB.qNotes[qid];
  },50);

  // Restore highlighted content if available
  if(DB.hlCache && DB.hlCache[qid] && DB.hlCache[qid].qbody){
    var qbEl=document.getElementById('modal-qbody');
    if(qbEl) qbEl.innerHTML=DB.hlCache[qid].qbody;
  }
  // Load cached AI analysis
  var cached = DB.analysisCache[qid] || ((DB.wrongMap[qid]||DB.dkMap[qid]||{}).analysis) || null;
  if(cached){
    renderAI(document.getElementById('modal-ai-area'), cached);
    _aiChat=[
      {role:'user', content:'PCE题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'?')+'\n我选：'+(my||'未选')},
      {role:'assistant', content:cached}
    ];
  }
  document.getElementById('modal-bg').style.display='flex';

  // Auto-append selected text to annotation box on mouseup
  var mc = document.getElementById('m-content');
  if(mc){
    var _lastSel = '';
    mc._selHandler = function(){
      setTimeout(function(){
        var sel = window.getSelection();
        if(!sel || sel.toString().trim()==='') return;
        var selText = sel.toString().trim();
        if(selText.length<2) return;
        if(!mc.contains(sel.anchorNode)) return;
        if(selText === _lastSel) return; // same selection, ignore
        _lastSel = selText;
        var ta = document.getElementById('modal-qnote');
        if(ta){
          var existing = ta.value;
          var parts = existing ? existing.split(' / ') : [];
          if(parts.indexOf(selText)>=0) return;
          ta.value = existing ? existing + ' / ' + selText : selText;
          saveModalQNote();
          showToast('✓ 已追加到标注框');
        }
        // Reset after 1s so same text can be added again later if needed
        setTimeout(function(){ _lastSel=''; }, 1000);
      }, 200);
    };
    mc.addEventListener('mouseup', mc._selHandler);
    mc.addEventListener('touchend', mc._selHandler);
  }
}
function closeModal(){
  // Save current highlighted content before closing
  if(_mQid){
    var qb=document.getElementById('modal-qbody');
    if(qb&&qb.innerHTML){ if(!DB.hlCache)DB.hlCache={}; DB.hlCache[_mQid]={qbody:qb.innerHTML}; saveDB(); }
  }
  document.getElementById('modal-bg').style.display='none';
}

// Save annotation from modal — syncs to result table WITHOUT re-rendering page
function saveModalQNote(){
  if(!_mQid) return;
  var ta=document.getElementById('modal-qnote'); if(!ta) return;
  if(!DB.qNotes) DB.qNotes={};
  var val=ta.value.trim();
  if(val) DB.qNotes[_mQid]=val;
  else delete DB.qNotes[_mQid];
  saveDB();
  // Only update the specific row in result table, don't re-render whole page
  updateQNoteInTable(_mQid);
}

function updateQNoteInTable(qid){
  // Find all note cells in result table and update just the annotation part
  var rows = document.querySelectorAll('#result-table tr');
  rows.forEach(function(tr){
    // Find the row that matches this qid by its onclick
    var noteVal = DB.qNotes&&DB.qNotes[qid] ? DB.qNotes[qid] : '';
    // Check if this row is for our qid (via data attribute or by scanning)
    var noteCell = tr.querySelector('td[data-qid="'+qid+'"]');
    if(noteCell){
      var noteDiv = noteCell.querySelector('.qnote-display');
      var editBtn = noteCell.querySelector('.qnote-btn');
      if(noteDiv){
        if(noteVal){
          noteDiv.style.display='block';
          noteDiv.textContent='📌 '+noteVal;
        } else {
          noteDiv.style.display='none';
        }
      }
      if(editBtn) editBtn.textContent = noteVal ? '✏️ 改' : '＋ 标注';
    }
  });
}

// Open modal from batch detail page (no active quiz session)
function openModalFromBatch(qid, batchId, idx){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var q=batch.questions[idx]; if(!q)return;
  var p=batch.progress;
  // Temporarily set QZ context so AI analysis works
  _mQid=qid; _mIdx=idx; _aiChat=[];
  var my=p.answers[idx], hasAns=!!q.answer;
  var ok=hasAns&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();
  document.getElementById('m-title').textContent='第 '+(q.num||idx+1)+' 题'+(DB.starMap[q.id]?' ⭐':'');
  var content=document.getElementById('m-content');
  var html='';
  if(q.caseText) html+='<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;white-space:pre-wrap;user-select:text">📋 病例资料<br>'+esc(q.caseText)+'</div>';
  html+='<div style="font-size:15px;line-height:1.9;margin-bottom:12px;white-space:pre-wrap;user-select:text;cursor:text;padding:8px;background:#f8f7f3;border-radius:6px">'+esc(q.body)+'</div>';
  html+='<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">';
  q.opts.forEach(function(o){
    var isCorrect=o.letter===(q.answer||''), isMy=my&&o.letter===my&&!isCorrect;
    var bg=isCorrect?'background:#e8f5ed;border-color:#2e7d52':isMy?'background:#fdeaea;border-color:#b83232':'';
    html+='<div style="padding:9px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;'+bg+';user-select:text">'+o.letter+'. '+esc(o.text)+(isCorrect?' <b style="color:#2e7d52">✓ 正确</b>':'')+(isMy?' <b style="color:#b83232">← 我选</b>':'')+'</div>';
  });
  html+='</div>';
  if(hasAns&&my&&my!=='skip') html+='<div style="margin-bottom:10px;font-size:14px;font-weight:600;color:'+(ok?'#2e7d52':'#b83232')+'">'+(ok?'✓ 答对了':'✗ 答错了 — 我选 '+my+'，正确是 '+q.answer)+'</div>';
  html+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap;padding:8px 10px;background:#f5f3ee;border-radius:8px">'
    +'<span style="font-size:11px;color:#888;flex-shrink:0">选中文字后：</span>'
    +'<button class="btn small" style="background:#FFE066;color:#333;border:1px solid #f0c040;font-weight:700" onclick="hlSelected(\'yellow\')">🖊 高亮</button>'
    +'<button class="btn small" style="background:#FF6B6B;color:#fff;border:none;font-weight:700" onclick="hlSelected(\'red\')">🔴 红色</button>'
    +'<button class="btn small" style="background:#fff;color:#333;border-bottom:2.5px solid #333;font-weight:700" onclick="hlSelected(\'underline\')"><u>U</u> 划线</button>'
    +'<button class="btn small" style="background:#fff;color:#333;border:1px solid #aaa;font-weight:700" onclick="hlSelected(\'bold\')"><b>B</b> 粗体</button>'
    +'<button class="btn small" style="background:#f5f5f5;color:#555;border:1px solid #ccc" onclick="undoHighlight()">↩ 撤销</button>'
    +'<button class="btn small blue" onclick="saveSelToNote()">📝 存入笔记</button>'
    +'<button class="btn small" onclick="addWholeQToNote()">📌 整题→笔记</button>'
    +'</div>';
  html+='<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">'
    +'<button class="btn blue small" onclick="doAnalyzeFromBatch(\''+qid+'\',\''+batchId+'\','+idx+')">🔍 AI解析此题</button>'
    +'<button class="btn small" onclick="doSimilarFromBatch(\''+qid+'\',\''+batchId+'\','+idx+')">✨ 同类题</button>'
    +'</div>'
    +'<div id="modal-ai-area"></div>';
  // Chat always visible
  html+='<div style="margin-top:14px;border-top:2px solid #e8e4f8;padding-top:12px">'
    +'<div style="font-size:12px;font-weight:700;color:#6040b0;margin-bottom:8px">💬 与AI对话（追问、深究）</div>'
    +'<div id="chat-messages" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;margin-bottom:8px"></div>'
    +'<div style="display:flex;gap:6px;align-items:flex-end">'
    +'<textarea id="chat-input" placeholder="例如：为什么不选B？这个穴位怎么记？" style="flex:1;min-height:52px;max-height:120px;padding:8px;border:1.5px solid #d4c9f5;border-radius:8px;font-size:13px;resize:vertical"></textarea>'
    +'<button class="btn blue small" onclick="sendChat()" style="align-self:flex-end;padding:8px 14px">发送</button>'
    +'</div>'
    +'<div style="font-size:10px;color:#bbb;margin-top:3px">Enter 发送 · Shift+Enter 换行</div>'
    +'</div>';
  content.innerHTML=html;
  // Load cached analysis
  var cached=DB.analysisCache[qid]||((DB.wrongMap[qid]||DB.dkMap[qid]||{}).analysis)||null;
  if(cached){
    renderAI(document.getElementById('modal-ai-area'),cached);
    _aiChat=[
      {role:'user',content:'PCE题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'?')+'\n我选：'+(my||'未选')},
      {role:'assistant',content:cached}
    ];
  }
  document.getElementById('modal-bg').style.display='flex';
}

async function doAnalyzeFromBatch(qid,batchId,idx){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var q=batch.questions[idx]; if(!q)return;
  var my=(batch.progress.answers[idx])||'未选';
  _mQid=qid; _mIdx=idx;
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px">🤖 AI解析中…</div>';
  var prompt='分析PCE针灸考试题目（要求简洁）：\n\n题目：'+q.body+'\n选项：\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')+'\n正确答案：'+(q.answer||'?')+'\n学生选择：'+my+'\n\n请按以下格式输出：\n【解题逻辑】2-3句说明正确答案推导思路\n【混淆点】用Markdown表格对比容易混淆的选项\n【一句话记忆】最精简的记忆口诀';
  try{
    var txt=await callClaude(prompt);
    DB.analysisCache[qid]=txt;
    var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(entry) entry.analysis=txt;
    saveDB(); renderAI(aiEl,txt);
    _aiChat=[{role:'user',content:'PCE题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'?')+'\n学生选：'+my},{role:'assistant',content:txt}];
  }catch(e){ aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px">❌ '+esc(e.message)+'</div>'; }
}

async function doSimilarFromBatch(qid,batchId,idx){
  var batch=null; for(var i=0;i<DB.batches.length;i++){if(DB.batches[i].id===batchId){batch=DB.batches[i];break;}} if(!batch)return;
  var q=batch.questions[idx]; if(!q)return;
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px">✨ 生成同类题中…</div>';
  var prompt='根据PCE针灸题目生成3道同知识点练习题：\n原题：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')+'\n\n要求：4选1，标注答案，1句解析，中文，穴位保留英文缩写。\n格式：\n1. 题目\nA. B. C. D.\n答案：X | 解析：一句话';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px"><div style="font-size:11px;font-weight:700;color:#6040b0;margin-bottom:6px">🎯 同类练习题</div><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">'+esc(txt)+'</div></div>';
  }catch(e){ aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px">❌ '+esc(e.message)+'</div>'; }
}

// ═══════════════════════════════════════════════════════
// HIGHLIGHT — yellow, red, underline, bold
// ═══════════════════════════════════════════════════════
function hlSelected(type){
  var sel=window.getSelection();
  if(!sel||sel.rangeCount===0||sel.toString().trim()===''){showToast('请先选中文字');return;}
  try{
    var range=sel.getRangeAt(0), span=document.createElement('span');
    if(type==='yellow') span.style.cssText='background:#FFE066;border-radius:2px;padding:0 1px';
    else if(type==='red') span.style.cssText='background:#FF6B6B;color:#fff;border-radius:2px;padding:0 1px';
    else if(type==='underline') span.style.cssText='text-decoration:underline;text-underline-offset:2px;text-decoration-color:#333';
    else if(type==='bold') span.style.cssText='font-weight:700';
    span.dataset.hlType = type;
    range.surroundContents(span);
    _hlUndo.push(span);
    sel.removeAllRanges();
    showToast('已标注，点「↩ 撤销」可取消');
  }catch(e){ showToast('选中跨越多个区域，请重新选择一段文字'); }
}
// Undo stack for highlights
var _hlUndo = [];

function undoHighlight(){
  if(!_hlUndo.length){ showToast('没有可撤销的标注'); return; }
  var span = _hlUndo.pop();
  try{
    var parent = span.parentNode;
    if(!parent){ showToast('已无法撤销（可能已关闭弹窗）'); return; }
    while(span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    showToast('✓ 已撤销最后一次标注');
  }catch(e){ showToast('撤销失败'); }
}

function saveSelToNote(){
  var sel=window.getSelection(); if(!sel||sel.toString().trim()===''){showToast('请先选中文字');return;}
  var text=sel.toString().trim();
  var q=(QZ.qs&&QZ.qs[_mIdx])||null; if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;}
  DB.notes.push({id:uid(),type:'excerpt',qid:_mQid,title:(q?'#'+(q.num||_mIdx+1)+' 摘录':'摘录'),content:text,ts:Date.now()});
  saveDB(); sel.removeAllRanges(); showToast('✓ 已存入笔记');
}
function addWholeQToNote(){
  var q=(QZ.qs&&QZ.qs[_mIdx])||null; if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;} if(!q){showToast('未找到题目');return;}
  if(DB.notes.some(function(n){return n.qid===q.id&&n.type==='question';})){showToast('此题已在笔记中');return;}
  DB.notes.push({id:uid(),qid:q.id,type:'question',title:'#'+(q.num||_mIdx+1)+' '+q.body.slice(0,40),content:q.body,opts:q.opts,answer:q.answer,batchName:(QZ.batch?QZ.batch.name:''),ts:Date.now(),analysis:DB.analysisCache[q.id]||''});
  saveDB(); showToast('✓ 整题已存入笔记');
}

// ═══════════════════════════════════════════════════════
// AI ANALYSIS — simplified: 解题逻辑 + 混淆点表格 + 一句话记忆
// ═══════════════════════════════════════════════════════
async function doAnalyze(){
  var q=(QZ.qs&&QZ.qs[_mIdx])||null; if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;} if(!q)return;
  var my=QZ.ans?(QZ.ans[_mIdx]||'未选'):'未选';
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px">🤖 AI解析中…</div>';
  var prompt='分析PCE针灸考试题目（要求简洁）：\n\n题目：'+q.body+'\n选项：\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')+'\n正确答案：'+(q.answer||'?')+'\n学生选择：'+my
    +'\n\n请按以下格式输出：\n【解题逻辑】2-3句说明正确答案推导思路\n【混淆点】用Markdown表格对比容易混淆的选项\n【一句话记忆】最精简的记忆口诀';
  try{
    var txt=await callClaude(prompt);
    DB.analysisCache[_mQid]=txt;
    var entry=DB.wrongMap[_mQid]||DB.dkMap[_mQid]; if(entry) entry.analysis=txt;
    saveDB(); renderAI(aiEl,txt);
    _aiChat=[
      {role:'user',content:'PCE题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'?')+'\n学生选：'+my},
      {role:'assistant',content:txt}
    ];
  }catch(e){ aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px">❌ '+esc(e.message)+'</div>'; }
}

async function doSimilar(){
  var q=(QZ.qs&&QZ.qs[_mIdx])||null; if(!q){var e=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e)q=e.q;} if(!q)return;
  var aiEl=document.getElementById('modal-ai-area');
  aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px">✨ 生成同类题中…</div>';
  var prompt='根据PCE针灸题目生成3道同知识点练习题：\n原题：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')+'\n\n要求：4选1，标注答案，1句解析，中文，穴位保留英文缩写。\n格式：\n1. 题目\nA. B. C. D.\n答案：X | 解析：一句话';
  try{
    var txt=await callClaude(prompt);
    aiEl.innerHTML='<div style="padding:10px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px"><div style="font-size:11px;font-weight:700;color:#6040b0;margin-bottom:6px">🎯 同类练习题</div><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">'+esc(txt)+'</div></div>';
  }catch(e){ aiEl.innerHTML='<div style="padding:10px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px">❌ '+esc(e.message)+'</div>'; }
}

function renderAI(el,txt){
  if(!el) return;
  var html='<div style="margin-top:10px;padding:12px 14px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px">'
    +'<div style="font-size:11px;font-weight:700;color:#6040b0;margin-bottom:8px">🤖 AI解析</div>';
  var parts=txt.split(/(【[^】]+】)/);
  for(var i=0;i<parts.length;i++){
    var part=parts[i];
    if(/^【[^】]+】$/.test(part)){
      var label=part.slice(1,-1);
      var colorMap={'解题逻辑':'#2e7d52','混淆点':'#b83232','一句话记忆':'#8a6000','错误原因':'#b83232','正确思路':'#2e7d52','核心知识点':'#1a4fa0'};
      var color=colorMap[label]||'#6040b0';
      var body=(parts[i+1]||'').trim(); i++;
      html+='<div style="font-size:11px;font-weight:700;color:'+color+';margin:10px 0 4px;letter-spacing:.3px">▌ '+esc(label)+'</div>';
      if(label==='一句话记忆'){
        html+='<div style="padding:8px 12px;background:#fffbe6;border:1px solid #f0d060;border-radius:6px;font-size:14px;font-weight:700">📌 '+esc(body)+'</div>';
      } else if(body.indexOf('|')>=0){
        html+=mdTable(body);
      } else {
        html+='<div style="font-size:13px;line-height:1.7;color:#18180f;white-space:pre-wrap">'+esc(body)+'</div>';
      }
    } else { if(part.trim()) html+='<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;color:#18180f">'+esc(part.trim())+'</div>'; }
  }
  html+='</div>';
  el.innerHTML=html;
}

function mdTable(md){
  var lines=md.split('\n').filter(function(l){return l.trim()&&l.indexOf('|')>=0;});
  if(lines.length<2) return '<div style="font-size:13px;white-space:pre-wrap">'+esc(md)+'</div>';
  var html='<div style="overflow-x:auto;margin:4px 0"><table style="width:100%;border-collapse:collapse;font-size:12px">';
  var isHeader=true;
  lines.forEach(function(line){
    if(/^\|[-:\s|]+\|$/.test(line.trim())){isHeader=false;return;}
    var cells=line.split('|').filter(function(c,ci,a){return ci>0&&ci<a.length-1;});
    var tag=isHeader?'th':'td';
    var bg=isHeader?'background:#e8e4f8;font-weight:700;':cells[0]?'':'background:#f8f6ff;';
    html+='<tr>'+cells.map(function(c){return '<'+tag+' style="padding:5px 8px;border:1px solid #ddd;'+bg+'">'+esc(c.trim())+'</'+tag+'>';}).join('')+'</tr>';
    if(isHeader) isHeader=false;
  });
  html+='</table></div>';
  return html;
}

// ═══════════════════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════════════════
async function sendChat(){
  var input=document.getElementById('chat-input'), msg=input?input.value.trim():''; if(!msg)return; input.value='';
  var chatEl=document.getElementById('chat-messages'); if(!chatEl)return;
  appendMsg(chatEl,'user',msg);
  var q=(QZ.qs&&QZ.qs[_mIdx])||null; if(!q){var e2=DB.wrongMap[_mQid]||DB.dkMap[_mQid];if(e2)q=e2.q;}
  if(_aiChat.length===0&&q){
    _aiChat=[{role:'user',content:'PCE题目：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('；')+'\n正确答案：'+(q.answer||'?')},{role:'assistant',content:'好的，请问你有什么问题？'}];
  }
  _aiChat.push({role:'user',content:msg});
  var tid='t-'+uid();
  var td=document.createElement('div'); td.id=tid; td.style.cssText='align-self:flex-start;background:#f0ebff;border:1px solid #d4c9f5;padding:7px 10px;border-radius:10px;font-size:13px;color:#6040b0';
  td.textContent='🤖 思考中…'; chatEl.appendChild(td); chatEl.scrollTop=chatEl.scrollHeight;
  try{
    var resp=await callClaudeChat(_aiChat,'你是PCE（Pan-Canada针灸考试）辅导专家，用中文简洁回答，帮学生理解解题逻辑和中医知识点。');
    var te=document.getElementById(tid); if(te)te.remove();
    appendMsg(chatEl,'assistant',resp); _aiChat.push({role:'assistant',content:resp}); chatEl.scrollTop=chatEl.scrollHeight;
  }catch(err){ var te2=document.getElementById(tid); if(te2)te2.remove(); appendMsg(chatEl,'error','❌ '+err.message); }
}
function appendMsg(c,role,text){
  var d=document.createElement('div'), isU=role==='user', isE=role==='error';
  d.style.cssText='align-self:'+(isU?'flex-end':'flex-start')+';max-width:90%;background:'+(isU?'#1a4fa0':isE?'#fdeaea':'#f0ebff')+';color:'+(isU?'#fff':isE?'#b83232':'#18180f')+';border:1px solid '+(isU?'transparent':isE?'#f5c5c5':'#d4c9f5')+';padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word';
  d.textContent=text; c.appendChild(d);
}
document.addEventListener('keydown',function(e){
  var inp=document.getElementById('chat-input');
  if(inp&&document.activeElement===inp&&e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); }
});

// ═══════════════════════════════════════════════════════
// AI CALLS
// ═══════════════════════════════════════════════════════
async function callClaude(prompt){ return callClaudeChat([{role:'user',content:prompt}],'你是PCE（Pan-Canada针灸考试）辅导专家，回答简洁精准，用中文。'); }
async function callClaudeChat(messages,system){
  var key=getApiKey(); if(!key) throw new Error('请先在「云同步」页面设置 Claude API Key');
  var resp=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true','x-api-key':key},
    body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:1024,system:system||'你是PCE针灸考试辅导专家，用中文。',messages:messages})
  });
  if(!resp.ok){var err=await resp.json().catch(function(){return{};});throw new Error('API '+resp.status+(err.error?': '+err.error.message:''));}
  var d=await resp.json(); return (d.content&&d.content[0]&&d.content[0].text)||'（无响应）';
}

// ═══════════════════════════════════════════════════════
// NOTES PAGE — full featured
// ═══════════════════════════════════════════════════════
function renderNotes(){
  var np=document.getElementById('notes'); if(!np)return;
  if(!DB.notes.length){
    np.innerHTML='<div class="card"><div class="row"><button class="btn" onclick="navBack()">← 返回</button><div class="title spacer" style="margin-left:10px">📝 笔记本</div></div>'
      +'<div class="sub" style="margin-top:8px">笔记本为空。在题目解析弹窗中选中文字或整题存入笔记。</div></div>'+backBtn();
    return;
  }
  var html='<div class="card">'
    +'<div class="row"><button class="btn" onclick="navBack()">← 返回</button><div class="title spacer" style="margin-left:10px">📝 笔记本</div></div>'
    +'<div class="sub" style="margin:4px 0">共 '+DB.notes.length+' 条 · 勾选后可批量操作</div>'
    +'<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px;align-items:center">'
    +'<input type="checkbox" id="note-cb-all" onchange="noteSelectAll(this.checked)" style="width:14px;height:14px">'
    +'<label for="note-cb-all" style="font-size:12px;color:#666;cursor:pointer">全选</label>'
    +'<button class="btn small" onclick="noteSelectAll(false)">全不选</button>'
    +'<button class="btn small red" onclick="deleteSelectedNotes()">🗑 删除选中</button>'
    +'<button class="btn purple" onclick="openAISumDialog()">🤖 AI整理选中笔记</button>'
    +'<button class="btn blue small" onclick="exportNotesPDF()">📄 导出PDF</button>'
    +'</div>'
    // AI summarize dialog
    +'<div id="ai-sum-box" style="display:none;margin-top:10px;padding:14px;background:#f0ebff;border:1px solid #d4c9f5;border-radius:10px">'
    +'<div style="font-size:13px;font-weight:700;color:#6040b0;margin-bottom:10px">🤖 AI整理设置（可修改）</div>'
    +'<textarea id="ai-sum-prompt" style="width:100%;min-height:90px;padding:8px;border:1px solid #d4c9f5;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box">按知识点归类整理；错误频率高的重点标注；混淆点用Markdown表格对比；每个知识点提炼一句核心金句口诀；整体结构清晰，适合考前速览</textarea>'
    +'<div class="row" style="margin-top:8px;gap:6px">'
    +'<button class="btn primary" onclick="doAISummarize()">🚀 开始整理</button>'
    +'<button class="btn small" onclick="document.getElementById(\'ai-sum-box\').style.display=\'none\'">取消</button>'
    +'</div></div></div>';

  DB.notes.slice().reverse().forEach(function(note){
    var typeLabel=note.type==='question'?'📖 题目':note.type==='excerpt'?'✂️ 摘录':note.type==='ai-summary'?'🤖 AI整理':'📝 笔记';
    var typeColor=note.type==='question'?'#1a4fa0':note.type==='excerpt'?'#2e7d52':note.type==='ai-summary'?'#6040b0':'#555';
    html+='<div class="card" style="padding:12px 14px" id="note-'+note.id+'">'
      +'<div class="row" style="margin-bottom:8px;flex-wrap:wrap;gap:6px">'
      +'<input type="checkbox" class="note-cb" data-nid="'+note.id+'" style="width:14px;height:14px;flex-shrink:0;margin-right:2px">'
      +'<span style="font-size:11px;font-weight:700;color:'+typeColor+';background:'+typeColor+'18;padding:2px 8px;border-radius:8px;flex-shrink:0">'+typeLabel+'</span>'
      +'<span style="font-size:13px;font-weight:600;flex:1;min-width:100px">'+esc(note.title)+'</span>'
      +'<span style="font-size:11px;color:#aaa">'+new Date(note.ts).toLocaleDateString('zh-CN')+'</span>'
      +'<button class="btn small red" style="padding:2px 8px;font-size:11px" onclick="deleteNote(\''+note.id+'\')">删除</button>'
      +'</div>';
    if(note.type==='question'){
      html+='<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;margin-bottom:8px;padding:8px;background:#f8f7f3;border-radius:6px">'+esc(note.content)+'</div>';
      if(note.opts&&note.opts.length){
        html+='<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px">';
        note.opts.forEach(function(o){ var cls=(o.letter===(note.answer||''))?'background:#e8f5ed;color:#2e7d52;font-weight:600':''; html+='<div style="font-size:12px;padding:3px 8px;border-radius:4px;'+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===note.answer?' ✓':'')+'</div>'; });
        html+='</div>';
      }
      // AI解析区域 — 显示完整内容，可滚动，有「重新解析」按钮
      var cachedAI = (note.qid && DB.analysisCache[note.qid]) || note.analysis || '';
      html+='<div id="note-ai-'+note.id+'" style="margin-top:6px">';
      if(cachedAI){
        html+='<div style="background:#f0ebff;border:1px solid #d4c9f5;border-radius:8px;padding:10px 12px">'
          +'<div style="font-size:11px;font-weight:700;color:#6040b0;margin-bottom:6px">🤖 AI解析</div>'
          +'<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;color:#18180f;max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch">'+esc(cachedAI)+'</div>'
          +'<div style="margin-top:8px;display:flex;gap:6px">'
          +'<button class="btn small blue" data-nid="'+note.id+'" data-qid="'+note.qid+'" onclick="refreshNoteAI(this.dataset.nid,this.dataset.qid)" style="font-size:11px">🔄 重新解析</button>'
          +'</div></div>';
      } else {
        html+='<button class="btn small blue" data-nid="'+note.id+'" data-qid="'+note.qid+'" onclick="runNoteAI(this.dataset.nid,this.dataset.qid)" style="font-size:11px;padding:4px 10px">🔍 AI解析此题</button>';
      }
      html+='</div>';
    } else if(note.type==='ai-summary'){
      // AI整理结果 — 完整显示，可滚动
      html+='<div style="background:#f0ebff;border:1px solid #d4c9f5;border-radius:8px;padding:12px;max-height:400px;overflow-y:auto;-webkit-overflow-scrolling:touch">'
        +'<div style="font-size:13px;line-height:1.8;white-space:pre-wrap;color:#18180f">'+esc(note.content)+'</div>'
        +'</div>';
    } else {
      html+='<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;padding:8px;background:#f8f7f3;border-radius:6px">'+esc(note.content)+'</div>';
    }
    // Per-note AI chat
    html+='<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px">'
      +'<button class="btn small blue" onclick="toggleNoteChat(\''+note.id+'\')" style="font-size:11px;padding:3px 10px">💬 问AI</button>'
      +'<div id="nchat-'+note.id+'" style="display:none;margin-top:8px">'
      +'<div id="nchat-msgs-'+note.id+'" style="max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;margin-bottom:6px"></div>'
      +'<div style="display:flex;gap:6px">'
      +'<input id="nchat-inp-'+note.id+'" placeholder="关于这条笔记追问AI…" style="flex:1;padding:6px 8px;border:1px solid #d4c9f5;border-radius:6px;font-size:12px">'
      +'<button class="btn small blue" onclick="sendNoteChat(\''+note.id+'\')" style="font-size:11px">发</button>'
      +'</div>'
      +'<div style="font-size:10px;color:#bbb;margin-top:2px">Enter发送</div>'
      +'</div></div>';
    html+='</div>';
  });
  html+=backBtn();
  np.innerHTML=html;
}

function noteSelectAll(c){ document.querySelectorAll('.note-cb').forEach(function(cb){cb.checked=c;}); }
function toggleNoteChat(nid){ var el=document.getElementById('nchat-'+nid); if(el) el.style.display=el.style.display==='none'?'block':'none'; }

async function sendNoteChat(nid){
  var note=DB.notes.find(function(n){return n.id===nid;}); if(!note)return;
  var inp=document.getElementById('nchat-inp-'+nid), msg=inp?inp.value.trim():''; if(!msg)return; inp.value='';
  var msgs=document.getElementById('nchat-msgs-'+nid); if(!msgs)return;
  appendMsg(msgs,'user',msg);
  var td=document.createElement('div'); td.style.cssText='align-self:flex-start;background:#f0ebff;padding:5px 8px;border-radius:8px;font-size:12px;color:#6040b0';
  td.textContent='思考中…'; msgs.appendChild(td); msgs.scrollTop=msgs.scrollHeight;
  try{
    var resp=await callClaudeChat([{role:'user',content:'笔记内容：'+note.content.slice(0,500)+'\n\n问题：'+msg}],'你是PCE针灸考试辅导专家，根据笔记内容回答，中文简洁。');
    td.remove(); appendMsg(msgs,'assistant',resp); msgs.scrollTop=msgs.scrollHeight;
  }catch(e){ td.remove(); appendMsg(msgs,'error','❌ '+e.message); }
}
function deleteNote(nid){ if(!confirm('删除这条笔记？'))return; DB.notes=DB.notes.filter(function(n){return n.id!==nid;}); saveDB(); renderNotes(); }

// Run AI analysis for a note's question (no cached analysis yet)
async function runNoteAI(noteId, qid){
  var note=DB.notes.find(function(n){return n.id===noteId;}); if(!note)return;
  var el=document.getElementById('note-ai-'+noteId); if(!el)return;
  el.innerHTML='<div style="padding:8px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px">🤖 解析中…</div>';
  var prompt='分析PCE针灸考试题目（要求简洁）：\n\n题目：'+note.content+'\n选项：\n'+(note.opts?note.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n'):'（无选项）')+'\n正确答案：'+(note.answer||'?')+'\n\n请按以下格式输出：\n【解题逻辑】2-3句说明正确答案推导思路\n【混淆点】用Markdown表格对比容易混淆的选项\n【一句话记忆】最精简的记忆口诀';
  try{
    var txt=await callClaude(prompt);
    if(qid) DB.analysisCache[qid]=txt;
    note.analysis=txt; saveDB();
    el.innerHTML='<div style="background:#f0ebff;border:1px solid #d4c9f5;border-radius:8px;padding:10px 12px">'
      +'<div style="font-size:11px;font-weight:700;color:#6040b0;margin-bottom:6px">🤖 AI解析</div>'
      +'<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;color:#18180f;max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch">'+esc(txt)+'</div>'
      +'<div style="margin-top:8px"><button class="btn small blue" data-nid="'+noteId+'" data-qid="'+qid+'" onclick="refreshNoteAI(this.dataset.nid,this.dataset.qid)" style="font-size:11px">🔄 重新解析</button></div>'
      +'</div>';
  }catch(e){
    el.innerHTML='<div style="padding:8px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px">❌ '+esc(e.message)+'</div>'
      +'<button class="btn small blue" data-nid="'+noteId+'" data-qid="'+qid+'" onclick="runNoteAI(this.dataset.nid,this.dataset.qid)" style="font-size:11px;margin-top:6px">重试</button>';
  }
}

// Re-run AI analysis for a note that already has analysis
async function refreshNoteAI(noteId, qid){
  var note=DB.notes.find(function(n){return n.id===noteId;}); if(!note)return;
  // Clear cache to force re-run
  if(qid) delete DB.analysisCache[qid];
  note.analysis=''; saveDB();
  await runNoteAI(noteId, qid);
}
function deleteSelectedNotes(){
  var checked=document.querySelectorAll('.note-cb:checked'); if(!checked.length){showToast('请先勾选');return;}
  if(!confirm('删除选中的 '+checked.length+' 条笔记？'))return;
  var nids=[]; checked.forEach(function(cb){nids.push(cb.dataset.nid);}); DB.notes=DB.notes.filter(function(n){return nids.indexOf(n.id)<0;}); saveDB(); renderNotes(); showToast('已删除 '+nids.length+' 条');
}
function openAISumDialog(){ var b=document.getElementById('ai-sum-box'); if(b) b.style.display=b.style.display==='none'||!b.style.display?'block':'none'; }
async function doAISummarize(){
  var checked=document.querySelectorAll('.note-cb:checked');
  var toProcess=[];
  if(checked.length){ checked.forEach(function(cb){var n=DB.notes.find(function(x){return x.id===cb.dataset.nid;});if(n)toProcess.push(n);}); }
  else { toProcess=DB.notes.filter(function(n){return n.type!=='ai-summary';}); }
  if(!toProcess.length){showToast('请先勾选笔记，或确保笔记本有内容');return;}
  var promptEl=document.getElementById('ai-sum-prompt'), userPrompt=promptEl?promptEl.value.trim():'';
  var box=document.getElementById('ai-sum-box'); if(box) box.style.display='none';
  showToast('🤖 AI整理中，约15秒…',20000);
  // Build compressed content — each note as one line to fit more notes
  var content=toProcess.map(function(n,i){
    var c=(i+1)+'. '+n.title;
    // For question notes, include answer and key analysis only
    if(n.type==='question'){
      if(n.answer) c+=' [答案:'+n.answer+']';
      var ai=DB.analysisCache[n.qid]||n.analysis||'';
      if(ai){
        // Extract just the 一句话记忆 if available
        var mem=ai.match(/【一句话记忆】([^【]+)/); 
        var logic=ai.match(/【解题逻辑】([^【]+)/);
        if(mem) c+=' 记忆：'+mem[1].trim().slice(0,80);
        else if(logic) c+=' 逻辑：'+logic[1].trim().slice(0,80);
        else c+=' '+ai.slice(0,100);
      }
      // Include question body briefly
      c+=' | 题：'+n.content.slice(0,60).replace(/\n/g,' ');
    } else {
      c+=' | '+n.content.slice(0,100).replace(/\n/g,' ');
    }
    return c;
  }).join('\n');
  var instr=userPrompt||'按知识点归类整理；错误频率高的重点标注；混淆点用Markdown表格对比；每个知识点提炼一句核心金句口诀；整体结构清晰，适合考前速览';
  var prompt='请将以下'+toProcess.length+'条PCE针灸考试笔记整理成完整复习资料（必须覆盖全部'+toProcess.length+'条）：\n\n'+content+'\n\n整理要求：'+instr+'\n\n注意：输出要完整，涵盖所有知识点，不要省略。';
  try{
    var txt=await callClaude(prompt,8000);
    var sumId=uid();
    DB.notes.push({id:sumId,type:'ai-summary',title:'AI复习笔记('+toProcess.length+'条) — '+new Date().toLocaleDateString('zh-CN'),content:txt,ts:Date.now()});
    saveDB(); renderNotes(); showToast('✓ AI复习笔记已生成！可在笔记里💬追问AI');
    setTimeout(function(){var el=document.getElementById('note-'+sumId);if(el)el.scrollIntoView({behavior:'smooth'});},300);
  }catch(e){showToast('生成失败：'+e.message);}
}

function exportNotesPDF(){
  var checked=document.querySelectorAll('.note-cb:checked');
  var toExport=[];
  if(checked.length){ checked.forEach(function(cb){var n=DB.notes.find(function(x){return x.id===cb.dataset.nid;});if(n)toExport.push(n);}); }
  else toExport=DB.notes.slice();
  if(!toExport.length){showToast('暂无笔记');return;}
  var w=window.open('','_blank'); if(!w){showToast('弹窗被拦截');return;}
  var css='body{font-family:-apple-system,"PingFang SC",sans-serif;padding:1.5cm 2cm;color:#18180f;font-size:11pt;line-height:1.7}'
    +'h1{font-size:16pt;font-weight:700}h2{font-size:13pt;margin-top:1.5rem;padding:5px 10px;background:#e8e4f8;border-radius:4px}'
    +'.card{margin-bottom:1.5rem;padding:12px;border-radius:6px;border:1px solid #ddd;page-break-inside:avoid}'
    +'.tag{font-size:9pt;font-weight:700;padding:2px 8px;border-radius:8px;margin-right:8px}'
    +'.q{font-size:11pt;white-space:pre-wrap;font-weight:500;margin-bottom:8px}'
    +'.opt{font-size:10pt;padding:2px 6px;border-radius:3px;margin-bottom:1px}'
    +'.oc{background:#e8f5ed;color:#2e7d52;font-weight:700}'
    +'.ai{background:#f0ebff;padding:8px;border-radius:5px;font-size:10pt;white-space:pre-wrap;margin-top:6px}'
    +'table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:4px 0}td,th{border:1px solid #ddd;padding:4px 7px}th{background:#e8e4f8}'
    +'.nopr{position:fixed;top:1rem;right:1rem;display:flex;gap:8px}@media print{.nopr{display:none}}';
  var body='<div class="nopr"><button onclick="window.print()" style="padding:10px 20px;background:#18180f;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600">🖨 打印/PDF</button><button onclick="window.close()" style="padding:10px 14px;background:#f0efe9;border:1px solid #ccc;border-radius:8px;font-size:13px;cursor:pointer">关闭</button></div>'
    +'<h1>PCE 针灸复习笔记</h1><p style="color:#888;font-size:10pt">生成：'+new Date().toLocaleString('zh-CN')+' | 共 '+toExport.length+' 条</p><hr>';
  toExport.forEach(function(note){
    var typeLabel=note.type==='question'?'📖 题目':note.type==='excerpt'?'✂️ 摘录':note.type==='ai-summary'?'🤖 AI整理':'📝 笔记';
    body+='<div class="card"><p><span class="tag" style="background:#e8e4f8">'+typeLabel+'</span><b>'+esc(note.title)+'</b></p>';
    if(note.type==='question'){
      body+='<div class="q">'+esc(note.content)+'</div>';
      if(note.opts) note.opts.forEach(function(o){body+='<div class="opt '+(o.letter===(note.answer||'')?'oc':'')+'">'+o.letter+'. '+esc(o.text)+(o.letter===note.answer?' ✓':'')+'</div>';});
      if(note.analysis) body+='<div class="ai"><b>AI解析：</b>'+esc(note.analysis)+'</div>';
    } else { body+='<div class="q">'+esc(note.content)+'</div>'; }
    body+='</div>';
  });
  w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PCE笔记</title><style>'+css+'</style></head><body>'+body+'</body></html>');
  w.document.close();
}

// ═══════════════════════════════════════════════════════
// REVIEW — with back button and PDF export
// ═══════════════════════════════════════════════════════
function renderReview(){
  var list=document.getElementById('review-list'); list.innerHTML='';
  var wrongEntries=Object.values(DB.wrongMap), dkEntries=Object.values(DB.dkMap).filter(function(e){return !DB.wrongMap[e.q.id];});
  if(!wrongEntries.length&&!dkEntries.length){
    list.innerHTML='<div class="card"><div class="row"><button class="btn" onclick="navBack()">← 返回</button><div class="title spacer" style="margin-left:10px">复习库</div></div>'
      +'<div class="sub" style="margin-top:8px">复习库暂无内容。</div></div>'+backBtn();
    return;
  }
  var ctrl='<div class="card"><div class="row"><button class="btn" onclick="navBack()">← 返回</button><div class="title spacer" style="margin-left:10px">复习库</div></div>'
    +'<div class="row" style="margin-top:10px;flex-wrap:wrap;gap:6px">'
    +'<button class="btn small" onclick="rvSelectAll(true)">全选</button>'
    +'<button class="btn small" onclick="rvSelectAll(false)">全不选</button>'
    +'<button class="btn purple" onclick="printSelectedPDF()">📄 生成PDF</button>'
    +'<button class="btn red spacer" onclick="clearReview()">清空复习库</button>'
    +'</div></div>';
  list.innerHTML=ctrl;
  if(dkEntries.length){ var h='<div class="card"><div class="row"><div class="title">❓ 不会的题</div><span class="sub spacer">共 '+dkEntries.length+' 道</span></div><div>'; dkEntries.forEach(function(e){h+=rvItemHTML(e,'dk');}); h+='</div></div>'; list.innerHTML+=h; }
  if(wrongEntries.length){ var h2='<div class="card"><div class="row"><div class="title">✗ 错题库</div><span class="sub spacer">共 '+wrongEntries.length+' 道</span><button class="btn blue small" onclick="analyzeAllWrong()">AI全部解析</button></div><div>'; wrongEntries.forEach(function(e){h2+=rvItemHTML(e,'wrong');}); h2+='</div></div>'; list.innerHTML+=h2; }
  list.innerHTML+=backBtn();
}
function rvItemHTML(entry,type){
  var q=entry.q, myAns=entry.myAns||'?', preview=q.body.replace(/\n/g,' ').slice(0,55);
  var tag=type==='dk'?'<span style="background:#fff3cd;color:#c47a1a;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0">❓不会</span>':'<span style="background:#fdeaea;color:#b83232;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;flex-shrink:0">✗ 我选'+myAns+'</span>';
  return '<div style="border:1px solid #dddbd3;border-radius:8px;overflow:hidden;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f0efe9">'
    +'<input type="checkbox" class="rv-cb" data-qid="'+q.id+'" style="width:14px;height:14px;flex-shrink:0">'
    +'<span style="font-size:13px;font-weight:700;min-width:30px;cursor:pointer" onclick="toggleRV(\''+q.id+'\')">'+((DB.starMap[q.id]?'⭐':'')+'#'+(q.num||'?'))+'</span>'
    +'<span style="font-size:13px;color:#6b6860;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="toggleRV(\''+q.id+'\')">'+esc(preview)+'</span>'
    +tag+'<button class="btn small blue" style="padding:3px 8px;font-size:11px;flex-shrink:0" onclick="rvAnalyze(\''+q.id+'\')">🔍 解析</button>'
    +'</div>'
    +'<div id="rvb-'+q.id+'" style="display:none;padding:12px 14px;background:#fff">'
    +(q.caseText?'<div style="background:#fffbe6;border:1px solid #f0d060;border-radius:5px;padding:7px;margin-bottom:7px;font-size:12px;white-space:pre-wrap">📋 '+esc(q.caseText)+'</div>':'')
    +'<div style="font-size:14px;line-height:1.8;white-space:pre-wrap;margin-bottom:10px">'+esc(q.body)+'</div>'
    +'<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px">'
    +q.opts.map(function(o){var cls=(o.letter===(q.answer||''))?'background:#e8f5ed;color:#2e7d52;font-weight:600':(o.letter===myAns?'background:#fdeaea;color:#b83232':'');return '<div style="font-size:13px;padding:5px 8px;border-radius:4px;'+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===q.answer?' ✓':'')+(o.letter===myAns&&o.letter!==q.answer?' ← 我选':'')+'</div>';}).join('')
    +'</div><div style="display:flex;gap:6px"><button class="btn small blue" onclick="rvAnalyze(\''+q.id+'\')">🔍 AI解析</button><button class="btn small" onclick="rvSimilar(\''+q.id+'\')">✨ 同类题</button></div>'
    +'<div id="rv-ai-'+q.id+'"></div>'
    +'</div></div>';
}
function rvSelectAll(c){ document.querySelectorAll('.rv-cb').forEach(function(cb){cb.checked=c;}); }
function toggleRV(id){ var b=document.getElementById('rvb-'+id); if(b) b.style.display=b.style.display==='none'?'block':'none'; }
function clearReview(){ if(!confirm('确定清空全部复习库？'))return; DB.wrongMap={}; DB.dkMap={}; saveDB(); renderHome(); renderReview(); showToast('已清空'); }

async function rvAnalyze(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry)return;
  var q=entry.q, myAns=entry.myAns||'未选';
  var b=document.getElementById('rvb-'+qid); if(b) b.style.display='block';
  var aiEl=document.getElementById('rv-ai-'+qid); if(!aiEl)return;
  var cached=DB.analysisCache[qid]||entry.analysis||null; if(cached){renderAI(aiEl,cached);return;}
  aiEl.innerHTML='<div style="padding:8px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px;margin-top:8px">🤖 解析中…</div>';
  var prompt='分析PCE针灸题目：\n题目：'+q.body+'\n选项：\n'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join('\n')+'\n正确答案：'+(q.answer||'?')+'\n学生选：'+myAns+'\n\n格式：\n【解题逻辑】推导思路2-3句\n【混淆点】Markdown表格对比选项\n【一句话记忆】口诀';
  try{ var txt=await callClaude(prompt); DB.analysisCache[qid]=txt; entry.analysis=txt; saveDB(); renderAI(aiEl,txt); }
  catch(e){ aiEl.innerHTML='<div style="padding:8px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px;margin-top:8px">❌ '+esc(e.message)+'</div>'; }
}
async function rvSimilar(qid){
  var entry=DB.wrongMap[qid]||DB.dkMap[qid]; if(!entry)return; var q=entry.q;
  var aiEl=document.getElementById('rv-ai-'+qid); if(!aiEl)return;
  aiEl.innerHTML='<div style="padding:8px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;color:#6040b0;font-size:13px;margin-top:8px">✨ 生成中…</div>';
  var prompt='根据PCE题生成3道同类练习题：\n原题：'+q.body+'\n选项：'+q.opts.map(function(o){return o.letter+'. '+o.text;}).join(' | ')+'\n要求：4选1，标注答案，1句解析，中文。\n格式：\n1. 题目\nA. B. C. D.\n答案：X | 解析：一句话';
  try{ var txt=await callClaude(prompt); aiEl.innerHTML='<div style="padding:8px;background:#f8f6ff;border:1px solid #d4c9f5;border-radius:8px;margin-top:8px"><div style="font-size:11px;font-weight:700;color:#6040b0;margin-bottom:4px">🎯 同类练习题</div><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">'+esc(txt)+'</div></div>'; }
  catch(e){ aiEl.innerHTML='<div style="padding:8px;background:#fdeaea;border:1px solid #f5c5c5;border-radius:8px;color:#b83232;font-size:13px;margin-top:8px">❌ 生成失败</div>'; }
}
async function analyzeAllWrong(){
  var entries=Object.values(DB.wrongMap).filter(function(e){return !e.analysis&&!DB.analysisCache[e.q.id];}).slice(0,6);
  if(!entries.length){showToast('错题已全部解析！');return;}
  showToast('正在解析 '+entries.length+' 道错题…',12000);
  for(var i=0;i<entries.length;i++){ await rvAnalyze(entries[i].q.id); await new Promise(function(r){setTimeout(r,400);}); }
  showToast('解析完成！');
}

// ─── PDF export for review ─────────────────────────────
function printSelectedPDF(){
  var checked=document.querySelectorAll('.rv-cb:checked');
  if(!checked.length){showToast('请先勾选题目');return;}
  var entries=[]; checked.forEach(function(cb){var e=DB.wrongMap[cb.dataset.qid]||DB.dkMap[cb.dataset.qid];if(e)entries.push(e);});
  if(!entries.length){showToast('未找到数据');return;}
  generateReviewPDF(entries);
}
function printReport(){
  var entries=Object.values(DB.wrongMap).concat(Object.values(DB.dkMap));
  if(!entries.length){showToast('暂无错题');return;}
  generateReviewPDF(entries);
}
function generateReviewPDF(entries){
  var w=window.open('','_blank'); if(!w){showToast('弹窗被拦截');return;}
  var css='body{font-family:-apple-system,"PingFang SC",sans-serif;padding:1.5cm 2cm;color:#18180f;font-size:11pt;line-height:1.7}'
    +'h1{font-size:16pt;font-weight:700}.qb{margin-bottom:1.5rem;padding:12px;border-radius:8px;page-break-inside:avoid}'
    +'.qb.w{background:#fff9f9;border-left:5px solid #b83232;border:1px solid #f5c5c5}'
    +'.qb.d{background:#fffdf0;border-left:5px solid #c47a1a;border:1px solid #f5d9a0}'
    +'.qn{font-size:9pt;color:#888;margin-bottom:4px}.qt{font-size:11pt;white-space:pre-wrap;font-weight:500;margin-bottom:8px}'
    +'.opt{font-size:10pt;padding:2px 7px;border-radius:3px;margin-bottom:2px;display:block}'
    +'.oc{background:#e8f5ed;color:#2e7d52;font-weight:700}.ow{background:#fdeaea;color:#b83232}'
    +'.ai{background:#f0ebff;padding:8px 10px;border-radius:5px;font-size:10pt;white-space:pre-wrap;margin-top:8px}'
    +'table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:4px 0}td,th{border:1px solid #ddd;padding:4px 7px}th{background:#e8e4f8}'
    +'.nopr{position:fixed;top:1rem;right:1rem;display:flex;gap:8px}@media print{.nopr{display:none}}';
  var body='<div class="nopr"><button onclick="window.print()" style="padding:10px 20px;background:#18180f;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600">🖨 打印/PDF</button><button onclick="window.close()" style="padding:10px 14px;background:#f0efe9;border:1px solid #ccc;border-radius:8px;font-size:13px;cursor:pointer">关闭</button></div>'
    +'<h1>PCE 针灸复习报告</h1><p style="color:#888;font-size:10pt">'+new Date().toLocaleString('zh-CN')+' | 共 '+entries.length+' 道题</p><hr>';
  entries.forEach(function(e){
    var q=e.q, my=e.myAns||'?', isW=!!DB.wrongMap[q.id];
    var an=DB.analysisCache[q.id]||e.analysis||'';
    var out='<div class="qb '+(isW?'w':'d')+'">';
    out+='<div class="qn">#'+(q.num||'?')+' | '+esc(e.batchName||'')+(isW?' | ✗ 错误':' | ❓ 不会')+'</div>';
    if(q.caseText) out+='<div style="background:#fffbe6;border:1px solid #f0d060;padding:6px;border-radius:4px;margin-bottom:6px;font-size:9.5pt;white-space:pre-wrap">📋 '+esc(q.caseText)+'</div>';
    out+='<div class="qt">'+esc(q.body)+'</div>';
    q.opts.forEach(function(o){ var cls=(o.letter===(q.answer||''))?'oc':(o.letter===my?'ow':''); out+='<span class="opt '+cls+'">'+o.letter+'. '+esc(o.text)+(o.letter===q.answer?' ✓':'')+(o.letter===my&&o.letter!==q.answer?' ←我选':'')+'</span>'; });
    if(an) out+='<div class="ai"><b>🤖 AI解析</b><br>'+esc(an)+'</div>';
    else out+='<div style="padding:6px;border:1px dashed #ddd;border-radius:4px;font-size:9.5pt;color:#aaa;margin-top:6px">（暂无AI解析）</div>';
    out+='</div>'; body+=out;
  });
  w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PCE复习报告</title><style>'+css+'</style></head><body>'+body+'</body></html>');
  w.document.close();
}

// ═══════════════════════════════════════════════════════
// MOCK — weighted, deliberate practice
// ═══════════════════════════════════════════════════════
function renderMockSetup(){
  var total=DB.batches.reduce(function(s,b){return s+b.questions.length;},0);
  var wc=Object.keys(DB.wrongMap).length, dc=Object.keys(DB.dkMap).length;
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="row"><button class="btn" onclick="navBack()">← 返回</button><div class="title spacer" style="margin-left:10px">模拟考试</div></div>'
    +'<div class="sub">仿 Pan Canada 针灸考试 — 125题 / 2.5小时</div>'
    +'<div class="grid" style="margin-top:12px">'
    +'<div class="stat"><div class="k">可用题目</div><div class="v">'+total+'</div></div>'
    +'<div class="stat"><div class="k">错题</div><div class="v redtext">'+wc+'</div></div>'
    +'<div class="stat"><div class="k">不会</div><div class="v orangetext">'+dc+'</div></div>'
    +'</div>'
    +'<div style="margin:12px 0;padding:12px;background:#fff8f0;border:1px solid #f5d9a0;border-radius:8px">'
    +'<div style="font-size:13px;font-weight:700;margin-bottom:8px">🎯 刻意练习设置</div>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:6px"><input type="checkbox" id="mock-wrong-cb" checked> 错题加权（出现概率×3）</label>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:6px"><input type="checkbox" id="mock-dk-cb" checked> 不会题加权（概率×2）</label>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:6px"><input type="checkbox" id="mock-only-weak-cb"> 只考错题/不会题（专项突破，打乱）</label>'
    +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="mock-ordered-cb"> 错题/不会题按原题号顺序（不打乱）</label>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="sub">题目数量：</span><input id="mock-count" type="number" min="10" max="500" value="125" class="tiny"><span class="sub">题（0=全部）</span></div>'
    +'<button class="btn primary" onclick="startMock()">开始模拟考试</button></div>'
    +backBtn();
}
var MK={qs:[],ans:[],cur:0,start:0,interval:null};
function startMock(){
  var allQs=[]; DB.batches.forEach(function(b){allQs=allQs.concat(b.questions);}); if(!allQs.length){alert('请先导入题目。');return;}
  var onlyWeak=document.getElementById('mock-only-weak-cb')&&document.getElementById('mock-only-weak-cb').checked;
  var useWrong=document.getElementById('mock-wrong-cb')&&document.getElementById('mock-wrong-cb').checked;
  var useDk=document.getElementById('mock-dk-cb')&&document.getElementById('mock-dk-cb').checked;
  var count=parseInt((document.getElementById('mock-count')||{}).value)||125;
  var wids=Object.keys(DB.wrongMap), dids=Object.keys(DB.dkMap), pool;
  if(onlyWeak){ pool=allQs.filter(function(q){return wids.indexOf(q.id)>=0||dids.indexOf(q.id)>=0;}); if(!pool.length){alert('错题库和不会题库都是空的。');return;} }
  else{ pool=allQs.slice(); if(useWrong) allQs.filter(function(q){return wids.indexOf(q.id)>=0;}).forEach(function(q){pool.push(q);pool.push(q);}); if(useDk) allQs.filter(function(q){return dids.indexOf(q.id)>=0;}).forEach(function(q){pool.push(q);}); }
  var ordered = document.getElementById('mock-ordered-cb')&&document.getElementById('mock-ordered-cb').checked;
  if(ordered){
    // Sort by original question number
    pool = pool.filter(function(q){return wids.indexOf(q.id)>=0||dids.indexOf(q.id)>=0;});
    pool.sort(function(a,b){return (a.num||0)-(b.num||0);});
  } else {
    pool = shuffle(pool);
  }
  if(count>0) pool=pool.slice(0,count);
  MK={qs:pool,ans:new Array(pool.length).fill(null),cur:0,start:Date.now(),interval:null}; renderMockQ();
}
function renderMockQ(){
  var q=MK.qs[MK.cur], answered=MK.ans.filter(function(a){return !!a;}).length;
  clearInterval(MK.interval);
  var rem=150*60-Math.round((Date.now()-MK.start)/1000); if(rem<=0){finishMock();return;}
  var isW=!!DB.wrongMap[q.id], isDk=!!DB.dkMap[q.id];
  var badge=isW?'<span style="background:#fdeaea;color:#b83232;font-size:11px;padding:2px 7px;border-radius:8px;margin-left:6px">⚠ 曾错</span>':isDk?'<span style="background:#fff3cd;color:#c47a1a;font-size:11px;padding:2px 7px;border-radius:8px;margin-left:6px">❓ 不会</span>':'';
  var opts=q.opts.map(function(o){var sel=MK.ans[MK.cur]===o.letter?' sel':'';return '<button class="opt'+sel+'" onclick="mockPick(\''+o.letter+'\')">'+'<span class="opt-letter">'+o.letter+'</span><span>'+esc(o.text)+'</span></button>';}).join('');
  document.getElementById('mock-area').innerHTML='<div class="card">'
    +'<div class="qtop"><div><div class="qcount">第 <strong>'+(MK.cur+1)+'</strong> / '+MK.qs.length+' 题'+badge+'</div><div class="sub">已答 '+answered+'</div></div>'
    +'<div id="mock-timer" class="timer spacer green"></div></div>'
    +(q.caseText?'<div style="background:#fffbe6;border:1.5px solid #f0d060;border-radius:8px;padding:12px;margin-bottom:1rem;font-size:14px;line-height:1.8;white-space:pre-wrap"><div style="font-size:11px;font-weight:700;color:#8a6000;margin-bottom:4px">📋 病例资料</div>'+esc(q.caseText)+'</div>':'')
    +'<div class="qbody">'+esc(q.body)+'</div><div class="opts">'+opts+'</div>'
    +'<div class="row actions"><button class="btn small" onclick="mPrev()">← 上一题</button><button class="btn small primary" onclick="mNext()">下一题 →</button><button class="btn small red spacer" onclick="finishMock()">交卷</button></div></div>';
  MK.interval=setInterval(function(){ var el=document.getElementById('mock-timer'); if(!el){clearInterval(MK.interval);return;} var r=150*60-Math.round((Date.now()-MK.start)/1000); if(r<=0){clearInterval(MK.interval);finishMock();return;} var hh=Math.floor(r/3600),mm=Math.floor((r%3600)/60),ss=r%60; el.textContent=hh+':'+(mm<10?'0':'')+mm+':'+(ss<10?'0':'')+ss; },1000);
}
function mockPick(l){ MK.ans[MK.cur]=l; document.querySelectorAll('#mock-area .opt').forEach(function(b){var lt=b.querySelector('.opt-letter');if(lt)b.classList.toggle('sel',lt.textContent===l);}); }
function mPrev(){ if(MK.cur>0){clearInterval(MK.interval);MK.cur--;renderMockQ();} }
function mNext(){ clearInterval(MK.interval); if(MK.cur<MK.qs.length-1){MK.cur++;renderMockQ();}else finishMock(); }
function finishMock(){
  clearInterval(MK.interval);
  var elapsed=Math.round((Date.now()-MK.start)/1000),hh=Math.floor(elapsed/3600),mm=Math.floor((elapsed%3600)/60),ss=elapsed%60;
  var timeStr=(hh?hh+'h ':'')+mm+'m '+ss+'s', correct=0, wrong=0, withAns=MK.qs.filter(function(q){return !!q.answer;}).length, rows='';
  MK.qs.forEach(function(q,i){
    var my=MK.ans[i],hasAns=!!q.answer,ok=hasAns&&my&&my.toUpperCase()===(q.answer||'').toUpperCase();
    if(ok)correct++; if(hasAns&&my&&!ok){wrong++;DB.wrongMap[q.id]={q:q,batchId:'mock',batchName:'模拟考试',myAns:my};}
    rows+='<tr><td>'+(i+1)+'</td><td>'+esc(q.body.replace(/\n/g,' ').slice(0,40))+'</td><td>'+(my||'—')+'</td><td>'+(hasAns?'<b>'+q.answer+'</b>':'—')+'</td><td>'+(hasAns&&my?(ok?'<span style="color:green">✓</span>':'<span style="color:red">✗</span>'):'—')+'</td></tr>';
  });
  saveDB(); renderHome(); var rate=withAns?Math.round(correct/withAns*100):0;
  document.getElementById('mock-area').innerHTML='<div class="card"><div class="title">模拟考试结果</div>'
    +'<div class="grid"><div class="stat"><div class="k">总题</div><div class="v">'+MK.qs.length+'</div></div><div class="stat"><div class="k">答对</div><div class="v" style="color:green">'+correct+'</div></div><div class="stat"><div class="k">答错</div><div class="v redtext">'+wrong+'</div></div><div class="stat"><div class="k">正确率</div><div class="v">'+rate+'%</div></div><div class="stat"><div class="k">用时</div><div class="v">'+timeStr+'</div></div><div class="stat"><div class="k">PCE预估</div><div class="v">'+(rate>=70?'🟢 通过':'🔴 需加强')+'</div></div></div>'
    +(rate<70?'<div style="margin:10px 0;padding:10px;background:#fff8f0;border:1px solid #f5d9a0;border-radius:8px;font-size:13px">建议：正确率 '+rate+'%，PCE约70%通过。重点AI解析错题，反复练习不会题。</div>':'')
    +'<div class="row mt"><button class="btn primary" onclick="renderMockSetup()">再考一次</button><button class="btn" onclick="navTo(\'review\');renderReview()">查看错题</button></div>'
    +'<div class="tablewrap"><table><thead><tr><th>题号</th><th>题目</th><th>我选</th><th>答案</th><th>结果</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'
    +backBtn();
}

// ═══════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════
function renderHome(){
  var total=0; DB.batches.forEach(function(b){total+=b.questions.length;});
  document.getElementById('st-total').textContent=total;
  document.getElementById('st-done').textContent=DB.stats.done||0;
  document.getElementById('st-wrong').textContent=Object.keys(DB.wrongMap).length;
  document.getElementById('st-dk').textContent=Object.keys(DB.dkMap).length;
  var d=DB.stats.done||0, c=DB.stats.correct||0;
  document.getElementById('st-rate').textContent=d>0?Math.round(c/d*100)+'%':'--';
  var list=document.getElementById('batch-list');
  if(!DB.batches.length){list.innerHTML='<div class="sub">导入后会出现在这里。</div>';return;}
  list.innerHTML='';
  DB.batches.slice().reverse().forEach(function(b){
    var p=b.progress, done=p.answers.filter(function(a){return a&&a!=='skip';}).length;
    var prog=Math.round(done/b.questions.length*100);
    var div=document.createElement('div'); div.className='batch-row';
    div.innerHTML='<span class="batch-name" style="cursor:pointer;color:#1a4fa0;text-decoration:underline;font-weight:600" onclick="showBatchDetail(\''+b.id+'\')">'+esc(b.name)+'</span>'
      +'<span class="batch-meta">'+b.questions.length+'题 '+prog+'%</span>';
    [{t:'📋 题目',fn:function(){showBatchDetail(b.id);}},
     {t:'▶ 继续',fn:function(){startBatch(b.id,false);}},
     {t:'🔄 重来',fn:function(){if(!confirm('重新开始？'))return;b.progress={idx:0,answers:new Array(b.questions.length).fill(null),dk:{}};saveDB();startBatch(b.id,true);}},
     {t:'✏️ 改名',fn:function(){var n=prompt('修改名称：',b.name);if(!n)return;b.name=n.trim();saveDB();renderHome();}},
     {t:'🗑 删除',fn:function(){if(!confirm('确定删除批次？'))return;DB.batches=DB.batches.filter(function(x){return x.id!==b.id;});saveDB();renderHome();}}
    ].forEach(function(item){var btn=document.createElement('button');btn.className='btn small';btn.textContent=item.t;btn.addEventListener('click',item.fn);div.appendChild(btn);});
    list.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════
// BACK BUTTON HELPER — large, prominent
// ═══════════════════════════════════════════════════════
function backBtn(){
  return '<div style="margin-top:24px;padding:16px;text-align:center">'
    +'<button onclick="navBack()" style="padding:14px 40px;font-size:16px;font-weight:700;background:#f0efe9;border:2px solid #ccc;border-radius:12px;cursor:pointer;color:#333">⬆ 返回上一页</button>'
    +'</div>';
}

// ═══════════════════════════════════════════════════════
// FIREBASE + AUTO-LOGIN
// ═══════════════════════════════════════════════════════
function saveFirebaseConfig(){
  var raw=document.getElementById('firebase-config').value.trim(); if(!raw){showToast('请粘贴配置');return;}
  try{var cfg=JSON.parse(raw);localStorage.setItem('firebase_cfg',JSON.stringify(cfg));showToast('✓ 已保存，请刷新后自动登录');}
  catch(e){showToast('JSON格式错误');}
}
function loadFirebaseConfigToBox(){
  var s=localStorage.getItem('firebase_cfg');
  if(s) document.getElementById('firebase-config').value=JSON.stringify(JSON.parse(s),null,2);
  else showToast('尚未保存配置');
}
(function initFirebase(){
  var cfg=localStorage.getItem('firebase_cfg'); if(!cfg)return;
  var config; try{config=JSON.parse(cfg);}catch(e){return;}
  function load(url,cb){var s=document.createElement('script');s.src=url;s.onload=cb;document.head.appendChild(s);}
  load('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',function(){
    load('https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',function(){
      load('https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',function(){
        try{
          if(!firebase.apps.length) firebase.initializeApp(config);
          document.getElementById('cloud-status').textContent='Firebase 已连接，正在尝试自动登录…';
          // Auto-login with saved credentials
          firebase.auth().onAuthStateChanged(function(user){
            var st=document.getElementById('cloud-status');
            if(user){ if(st) st.textContent='✓ 已自动登录：'+user.email; }
            else {
              // Try auto-login with saved email/pass
              var savedEmail=localStorage.getItem('cloud_email');
              var savedPass=localStorage.getItem('cloud_pass_hint');
              if(savedEmail&&savedPass){
                firebase.auth().signInWithEmailAndPassword(savedEmail,savedPass)
                  .then(function(){ if(st) st.textContent='✓ 已自动登录：'+savedEmail; })
                  .catch(function(){ if(st) st.textContent='Firebase 已连接，请手动登录。'; });
              } else { if(st) st.textContent='Firebase 已连接，请登录。'; }
            }
          });
        }catch(e){}
      });
    });
  });
})();

function initCloudInputs(){
  // Auto-fill saved email
  var savedEmail=localStorage.getItem('cloud_email');
  if(savedEmail){ var el=document.getElementById('cloud-email'); if(el) el.value=savedEmail; }
  // Auto-fill API key
  var apiKey=getApiKey();
  var apiInp=document.getElementById('api-key-input'); if(apiInp&&apiKey) apiInp.value=apiKey;
  // Save email on change
  var emailEl=document.getElementById('cloud-email');
  if(emailEl) emailEl.addEventListener('change',function(){ localStorage.setItem('cloud_email',this.value.trim()); });
}

function cloudRegister(){
  var email=document.getElementById('cloud-email').value.trim(), pass=document.getElementById('cloud-pass').value;
  if(email) localStorage.setItem('cloud_email',email);
  if(typeof firebase==='undefined'){showToast('请先保存Firebase配置并刷新');return;}
  firebase.auth().createUserWithEmailAndPassword(email,pass)
    .then(function(){ document.getElementById('cloud-status').textContent='✓ 注册成功：'+email; })
    .catch(function(e){ document.getElementById('cloud-status').textContent='注册失败：'+e.message; });
}
function cloudLogin(){
  var email=document.getElementById('cloud-email').value.trim(), pass=document.getElementById('cloud-pass').value;
  if(email) localStorage.setItem('cloud_email',email);
  if(pass) localStorage.setItem('cloud_pass_hint',pass);
  if(typeof firebase==='undefined'){showToast('请先保存Firebase配置并刷新');return;}
  // Set persistence to LOCAL so login survives browser restarts
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(function(){
      return firebase.auth().signInWithEmailAndPassword(email,pass);
    })
    .then(function(){
      document.getElementById('cloud-status').textContent='✓ 已登录：'+email+' (已设为永久登录)';
      showToast('✓ 已登录，以后自动保持登录状态');
    })
    .catch(function(e){ document.getElementById('cloud-status').textContent='登录失败：'+e.message; });
}
function cloudLogout(){
  if(typeof firebase==='undefined')return;
  localStorage.removeItem('cloud_pass_hint');
  firebase.auth().signOut().then(function(){ document.getElementById('cloud-status').textContent='已退出。'; });
}
function cloudUpload(){
  if(typeof firebase==='undefined'){showToast('请先配置Firebase');return;}
  var user=firebase.auth().currentUser; if(!user){showToast('请先登录');return;}
  var bname='', qnum='';
  if(DB.lastPos && DB.lastPos.batchId){
    var lb=DB.batches.find(function(b){return b.id===DB.lastPos.batchId;});
    if(lb){ bname=lb.name; qnum='第'+(DB.lastPos.idx+1)+'题'; }
  }
  var col = firebase.firestore().collection('users').doc(user.uid).collection('data');
  showToast('上传中…',8000);

  var main = {
    batches:DB.batches, wrongMap:DB.wrongMap, dkMap:DB.dkMap,
    stats:DB.stats, starMap:DB.starMap, answerKeys:DB.answerKeys,
    lastPos:DB.lastPos, notes:DB.notes, qNotes:DB.qNotes||{}
  };
  var analysis = { analysisCache: DB.analysisCache };
  var studyPages = DB.studyPages||[];

  // Each study page = its own Firebase doc (incremental, no size limit)
  var studyUploads = studyPages.map(function(pg){
    var cleanText = (pg.text||'').replace(/src="data:[^"]{20,}"/g,'src="[图片仅本地]"');
    return col.doc('study_'+pg.id).set({id:pg.id, title:pg.title, ts:pg.ts, text:cleanText});
  });
  var studyIndex = col.doc('study_index').set({
    ids: studyPages.map(function(pg){return pg.id;}),
    ts: Date.now()
  });

  var total = Math.round((JSON.stringify(main).length+JSON.stringify(analysis).length)/1024);
  Promise.all([col.doc('main').set(main), col.doc('analysis').set(analysis), studyIndex].concat(studyUploads))
    .then(function(){
      showToast('✓ 已上传 '+total+'KB · 背诵页：'+studyPages.length+'个（各自独立）'+(bname?' · '+bname+' '+qnum:''),5000);
    }).catch(function(e){ showToast('上传失败：'+e.message); });
}

function cloudDownload(){
  if(typeof firebase==='undefined'){showToast('请先配置Firebase');return;}
  var user=firebase.auth().currentUser; if(!user){showToast('请先登录');return;}
  var col = firebase.firestore().collection('users').doc(user.uid).collection('data');
  showToast('下载中…',8000);

  Promise.all([col.doc('main').get(), col.doc('analysis').get(), col.doc('study_index').get()])
    .then(function(results){
      var mainDoc=results[0], analysisDoc=results[1], indexDoc=results[2];
      if(!mainDoc.exists){
        // Fallback old single-doc format
        return firebase.firestore().collection('users').doc(user.uid).get()
          .then(function(oldDoc){
            if(!oldDoc.exists){showToast('云端暂无数据');return;}
            DB=JSON.parse(oldDoc.data().db);
            ['analysisCache','notes','starMap','answerKeys','hlCache'].forEach(function(k){if(!DB[k])DB[k]=k==='notes'?[]:{};});
            if(!DB.studyPages) DB.studyPages=[];
            if(DB.lastPos===undefined) DB.lastPos=null;
            saveDB(); renderHome(); renderStudy();
            showToast('✓ 已下载（旧格式）');
          });
      }
      var m=mainDoc.data();
      DB.batches=m.batches||[]; DB.wrongMap=m.wrongMap||{}; DB.dkMap=m.dkMap||{};
      DB.stats=m.stats||{done:0,correct:0}; DB.starMap=m.starMap||{};
      DB.answerKeys=m.answerKeys||{}; DB.lastPos=m.lastPos||null; DB.notes=m.notes||[];
      DB.qNotes=m.qNotes||{};
      DB.analysisCache=analysisDoc.exists?(analysisDoc.data().analysisCache||{}):{};
      DB.hlCache={};

      // Download each study page individually
      var ids = indexDoc.exists?(indexDoc.data().ids||[]):[];
      var downloadStudyPages = ids.length>0
        ? Promise.all(ids.map(function(id){return col.doc('study_'+id).get();}))
            .then(function(pageDocs){
              return pageDocs.filter(function(d){return d.exists;}).map(function(d){return d.data();});
            })
        : col.doc('study').get().then(function(sd){  // fallback old study doc
            return sd.exists?(sd.data().studyPages||[]):[];
          });

      return downloadStudyPages.then(function(pages){
        DB.studyPages = pages;
        saveDB(); renderHome(); renderStudy();
        var bname='', qnum='';
        if(DB.lastPos && DB.lastPos.batchId){
          var lb=DB.batches.find(function(b){return b.id===DB.lastPos.batchId;});
          if(lb){ bname=lb.name; qnum='第'+(DB.lastPos.idx+1)+'题'; }
        }
        showToast('✓ 已下载'+(bname?' · 上次：'+bname+' '+qnum:''),5000);
      });
    }).catch(function(e){ showToast('下载失败：'+e.message); });
}

// ═══════════════════════════════════════════════════════
// QUESTION NOTES 标注
// ═══════════════════════════════════════════════════════
function editQNote(qid){
  if(!DB.qNotes) DB.qNotes={};
  var cur=DB.qNotes[qid]||'';
  var val=prompt('为这道题添加标注（例如：更正为C / 答案有疑问 / 留空则清除）：',cur);
  if(val===null) return;
  if(val.trim()===''){delete DB.qNotes[qid];showToast('已清除标注');}
  else{DB.qNotes[qid]=val.trim();showToast('✓ 已标注');}
  saveDB(); showResultPage();
}

// ═══════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════
function shuffle(a){return a.slice().sort(function(){return Math.random()-.5;});}
function downloadCSV(){
  var csv='题号,题目,我选,正确答案,结果\n';
  QZ.qs.forEach(function(q,i){ var my=QZ.ans[i]||'—',ans=q.answer||'—'; var res=q.answer&&my!=='—'?(my.toUpperCase()===q.answer.toUpperCase()?'正确':'错误'):'—'; csv+=(q.num||i+1)+',"'+q.body.replace(/"/g,'""').replace(/\n/g,' ')+'",'+my+','+ans+','+res+'\n'; });
  var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='答题结果.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ═══════════════════════════════════════════════════════
// 背诵页 STUDY PAGE
// ═══════════════════════════════════════════════════════
var _studyCurPage = null; // current page id being edited

function renderStudy(){
  var area = document.getElementById('study-area'); if(!area) return;
  if(!DB.studyPages) DB.studyPages=[];

  var html = '<div class="card">'
    +'<div class="row"><button class="btn" onclick="navBack()">← 返回</button>'
    +'<div class="title spacer" style="margin-left:10px">📚 背诵资料库</div>'
    +'<button class="btn primary" onclick="studyNewPage()">+ 新建页面</button>'
    +'</div>'
    +'<div class="sub" style="margin-top:4px">共 '+DB.studyPages.length+' 个页面 · 永久保存，除非你删除</div>'
    +'</div>';

  if(!DB.studyPages.length){
    html+='<div class="card"><div class="sub">还没有背诵页面。点「+ 新建页面」开始！</div></div>';
  } else {
    DB.studyPages.forEach(function(pg){
      html+='<div class="card" style="padding:12px 14px">'
        +'<div class="row" style="margin-bottom:8px;gap:8px;flex-wrap:wrap">'
        +'<span style="font-size:15px;font-weight:700;flex:1">'+esc(pg.title)+'</span>'
        +'<span style="font-size:11px;color:#aaa">'+new Date(pg.ts).toLocaleDateString('zh-CN')+'</span>'
        +'<button class="btn small primary" data-pid="'+pg.id+'" onclick="studyOpenPage(this.dataset.pid)">✏️ 编辑/查看</button>'
        +'<button class="btn small" data-pid="'+pg.id+'" onclick="studyRenamePage(this.dataset.pid)">✏️ 改名</button>'
        +'<button class="btn small red" data-pid="'+pg.id+'" onclick="studyDeletePage(this.dataset.pid)">删除</button>'
        +'</div>'
        // Preview first 100 chars
        +'<div style="font-size:13px;color:#666;overflow:hidden;max-height:40px;line-height:1.5">'+esc((pg.text||'').replace(/<[^>]+>/g,'').slice(0,120))+'</div>'
        +'</div>';
    });
  }
  html += backBtn();
  area.innerHTML = html;
}

function studyNewPage(){
  var title = prompt('页面名称（例如：穴位速记、经络口诀）：');
  if(!title||!title.trim()) return;
  var pg = {id:uid(), title:title.trim(), text:'', images:[], ts:Date.now()};
  DB.studyPages.push(pg);
  saveDB();
  studyOpenPage(pg.id);
}

function studyDeletePage(pgId){
  if(!confirm('确定删除这个背诵页面？')) return;
  DB.studyPages = DB.studyPages.filter(function(p){return p.id!==pgId;});
  saveDB(); renderStudy(); showToast('已删除');
}

function studyRenamePage(pgId){
  var pg=DB.studyPages.find(function(p){return p.id===pgId;}); if(!pg)return;
  var n=prompt('修改页面名称：',pg.title); if(!n||!n.trim())return;
  pg.title=n.trim(); saveDB(); renderStudy(); showToast('✓ 已改名');
}

function studyOpenPage(pgId){
  var pg = DB.studyPages.find(function(p){return p.id===pgId;});
  if(!pg) return;
  _studyCurPage = pgId;
  var area = document.getElementById('study-area');

  var html = '<div class="card">'
    +'<div class="row" style="gap:8px;flex-wrap:wrap">'
    +'<button class="btn" onclick="studySavePage();renderStudy()">← 返回</button>'
    +'<div class="title spacer" contenteditable="true" id="study-title-'+pgId+'" data-pid="'+pgId+'" '
    +'onblur="studySaveTitleInline(this.dataset.pid)" style="margin-left:8px;font-size:17px;outline:none;flex:1">'+esc(pg.title)+'</div>'
    +'<button class="btn primary" onclick="studySavePage()">💾 保存</button>'
    +'</div></div>'

    // Toolbar
    +'<div class="card" style="padding:10px 12px">'
    +'<div class="row" style="flex-wrap:wrap;gap:6px;align-items:center">'
    // Text formatting
    +'<button class="btn small" style="background:#FFE066;color:#333;border:1px solid #f0c040;font-weight:700" data-cmd="hilite" data-val="#FFE066" onclick="studyFormat(this.dataset.cmd,this.dataset.val)">🖊 黄色</button>'
    +'<button class="btn small" style="background:#FF6B6B;color:#fff;font-weight:700" data-cmd="hilite" data-val="#FF6B6B" onclick="studyFormat(this.dataset.cmd,this.dataset.val)">🔴 红色</button>'
    +'<button class="btn small" style="background:#90EE90;color:#333;font-weight:700" data-cmd="hilite" data-val="#90EE90" onclick="studyFormat(this.dataset.cmd,this.dataset.val)">🟢 绿色</button>'
    +'<button class="btn small" style="background:#87CEEB;color:#333;font-weight:700" data-cmd="hilite" data-val="#87CEEB" onclick="studyFormat(this.dataset.cmd,this.dataset.val)">🔵 蓝色</button>'
    +'<button class="btn small" style="font-weight:700;border:1px solid #aaa" onclick="studyFormat(\'bold\')"><b>B</b> 粗体</button>'
    +'<button class="btn small" style="border-bottom:2.5px solid #333;font-weight:700" onclick="studyFormat(\'underline\')"><u>U</u> 划线</button>'
    +'<button class="btn small" style="color:#b83232;font-weight:700;border:1px solid #f5c5c5" data-cmd="foreColor" data-val="#b83232" onclick="studyFormat(this.dataset.cmd,this.dataset.val)">A 红字</button>'
    +'<button class="btn small" style="background:#f5f5f5;color:#555;border:1px solid #ccc" onclick="studyUndo()">↩ 撤销</button>'
    +'<span style="width:1px;background:#ddd;height:20px;flex-shrink:0"></span>'
    // Font size
    +'<select onchange="studyFontSize(this.value)" style="padding:4px 6px;border:1px solid #ddd;border-radius:6px;font-size:12px">'
    +'<option value="">字号</option>'
    +'<option value="1">小</option><option value="3" selected>中</option><option value="5">大</option><option value="7">特大</option>'
    +'</select>'
    +'<span style="width:1px;background:#ddd;height:20px;flex-shrink:0"></span>'
    // Image and file upload
    +'<label class="btn small blue" style="cursor:pointer">📷 上载图片<input type="file" accept="image/*" style="display:none" onchange="studyInsertImage(event)"></label>'
    +'<label class="btn small" style="cursor:pointer">📄 上载文档<input type="file" accept=".txt,.md" style="display:none" onchange="studyInsertFile(event)"></label>'
    +'<button class="btn small" style="background:#fff;border:1px solid #aaa" onclick="studyPasteFromClipboard()">📋 粘贴</button>'
    +'<button class="btn small" style="background:#e8f0fe;color:#1a4fa0;border:1px solid #b8d0f0" onclick="studyInsertTable()">⊞ 插入表格</button>'
    +'</div></div>'

    // Sticky mini toolbar - always visible while editing
    +'<div id="study-float-toolbar" onmousedown="event.preventDefault()" style="position:sticky;top:0;z-index:99;background:#18180f;border-radius:0 0 10px 10px;padding:6px 10px;box-shadow:0 3px 12px rgba(0,0,0,0.3);display:flex;gap:4px;align-items:center;flex-wrap:wrap">'
    +'<button data-cmd="hilite" data-val="#FFE066" onclick="studyFormat(this.dataset.cmd,this.dataset.val)" style="background:#FFE066;color:#333;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700">黄</button>'
    +'<button data-cmd="hilite" data-val="#FF6B6B" onclick="studyFormat(this.dataset.cmd,this.dataset.val)" style="background:#FF6B6B;color:#fff;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700">红</button>'
    +'<button data-cmd="hilite" data-val="#90EE90" onclick="studyFormat(this.dataset.cmd,this.dataset.val)" style="background:#90EE90;color:#333;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700">绿</button>'
    +'<button data-cmd="hilite" data-val="#87CEEB" onclick="studyFormat(this.dataset.cmd,this.dataset.val)" style="background:#87CEEB;color:#333;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700">蓝</button>'
    +'<span style="color:#555;padding:0 2px">|</span>'
    +'<button onclick="studyFormat(\'bold\')" style="background:#333;color:#fff;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700">B</button>'
    +'<button onclick="studyFormat(\'underline\')" style="background:#333;color:#fff;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;text-decoration:underline">U</button>'
    +'<button data-cmd="foreColor" data-val="#b83232" onclick="studyFormat(this.dataset.cmd,this.dataset.val)" style="background:#333;color:#FF6B6B;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;font-weight:700">A</button>'
    +'<span style="color:#555;padding:0 2px">|</span>'
    +'<button onclick="studyUndo()" style="background:#333;color:#aaa;border:none;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer">↩</button>'
    +'</div>'

    // Editor
    +'<div class="card" style="padding:0">'
    +'<div id="study-editor" contenteditable="true" '
    +'style="min-height:500px;padding:20px;font-size:15px;line-height:1.8;outline:none;white-space:pre-wrap;word-break:break-word" '
    +'oninput="studyAutoSave()">'
    +pg.text
    +'</div></div>'
    + backBtn();

  // Fix contenteditable style conflict
  area.innerHTML = html;
  // Set editor to use formatted content
  var editor = document.getElementById('study-editor');
  if(editor){
    editor.style.webkitUserModify = '';
    editor.innerHTML = pg.text || '';
  }
  // Focus at end
  setTimeout(function(){
    var ed = document.getElementById('study-editor');
    if(ed){ ed.focus(); var r=document.createRange(),s=window.getSelection();r.selectNodeContents(ed);r.collapse(false);s.removeAllRanges();s.addRange(r); }
  },100);
}

function studyFormat(cmd, val){
  var ed = document.getElementById('study-editor'); if(!ed) return;
  ed.focus();
  if(cmd==='hilite') document.execCommand('hiliteColor',false,val);
  else if(cmd==='foreColor') document.execCommand('foreColor',false,val);
  else document.execCommand(cmd,false,val||null);
  studyAutoSave();
}
function studyFontSize(val){
  if(!val) return;
  var ed = document.getElementById('study-editor'); if(!ed) return;
  ed.focus(); document.execCommand('fontSize',false,val); studyAutoSave();
}
function studyUndo(){
  var ed = document.getElementById('study-editor'); if(!ed) return;
  ed.focus(); document.execCommand('undo',false,null);
  studyAutoSave();
}

function studyAutoSave(){
  if(!_studyCurPage) return;
  var pg = DB.studyPages.find(function(p){return p.id===_studyCurPage;}); if(!pg) return;
  var ed = document.getElementById('study-editor');
  if(ed) pg.text = ed.innerHTML;
  var titleEl = document.getElementById('study-title-'+_studyCurPage);
  if(titleEl) pg.title = titleEl.textContent.trim()||pg.title;
  pg.ts = Date.now();
  saveDB();
}

function studySavePage(){
  studyAutoSave();
  showToast('✓ 已保存');
}

// Float toolbar functions (kept for compatibility)
function studyShowFloatToolbar(){}
function studyHideFloatToolbar(){}

function studySaveTitleInline(pgId){
  var pg = DB.studyPages.find(function(p){return p.id===pgId;}); if(!pg) return;
  var el = document.getElementById('study-title-'+pgId);
  if(el&&el.textContent.trim()) pg.title=el.textContent.trim();
  saveDB();
}

function studyInsertImage(event){
  var file = event.target.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var ed = document.getElementById('study-editor'); if(!ed) return;
    ed.focus();
    // Insert image at cursor
    var img = document.createElement('img');
    img.src = e.target.result;
    img.style.cssText = 'max-width:100%;border-radius:8px;margin:8px 0;display:block';
    var sel = window.getSelection();
    if(sel&&sel.rangeCount){
      var range = sel.getRangeAt(0);
      range.collapse(false);
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else { ed.appendChild(img); }
    studyAutoSave();
    showToast('✓ 图片已插入');
  };
  reader.readAsDataURL(file);
  event.target.value=''; // reset input
}

function studyInsertFile(event){
  var file = event.target.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    var ed = document.getElementById('study-editor'); if(!ed) return;
    ed.focus();
    var text = e.target.result;
    var div = document.createElement('div');
    div.style.cssText = 'background:#f8f7f3;border:1px solid #ddd;border-radius:6px;padding:12px;margin:8px 0;white-space:pre-wrap;font-size:14px';
    div.textContent = '📄 '+file.name+'\n\n'+text;
    var sel = window.getSelection();
    if(sel&&sel.rangeCount){
      var range = sel.getRangeAt(0);
      range.collapse(false);
      range.insertNode(div);
      range.setStartAfter(div);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else { ed.appendChild(div); }
    studyAutoSave();
    showToast('✓ 文档已插入');
  };
  reader.readAsText(file,'utf-8');
  event.target.value='';
}

// 粘贴功能 — 支持文字、图片、富文本
async function studyPasteFromClipboard(){
  var ed = document.getElementById('study-editor'); if(!ed) return;
  ed.focus();
  try{
    // Try clipboard API first (modern browsers)
    var items = await navigator.clipboard.read();
    for(var i=0;i<items.length;i++){
      var item = items[i];
      if(item.types.indexOf('image/png')>=0||item.types.indexOf('image/jpeg')>=0){
        var imgType = item.types.find(function(t){return t.startsWith('image/');});
        var blob = await item.getType(imgType);
        var url = URL.createObjectURL(blob);
        var img = document.createElement('img');
        img.src = url; img.style.cssText='max-width:100%;border-radius:8px;margin:8px 0;display:block';
        insertNodeAtCursor(img); studyAutoSave();
        showToast('✓ 图片已粘贴'); return;
      }
      if(item.types.indexOf('text/html')>=0){
        var blob2 = await item.getType('text/html');
        var html2 = await blob2.text();
        document.execCommand('insertHTML',false,html2);
        studyAutoSave(); showToast('✓ 已粘贴（含格式）'); return;
      }
      if(item.types.indexOf('text/plain')>=0){
        var blob3 = await item.getType('text/plain');
        var txt = await blob3.text();
        document.execCommand('insertText',false,txt);
        studyAutoSave(); showToast('✓ 已粘贴'); return;
      }
    }
  }catch(e){
    // Fallback: use execCommand paste (works in most browsers)
    try{ document.execCommand('paste'); studyAutoSave(); showToast('✓ 已粘贴'); }
    catch(e2){ showToast('请直接用 Ctrl+V / ⌘+V 粘贴'); }
  }
}

function insertNodeAtCursor(node){
  var sel=window.getSelection();
  if(sel&&sel.rangeCount){
    var range=sel.getRangeAt(0);
    range.collapse(false);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else { document.getElementById('study-editor').appendChild(node); }
}

// 插入表格
function studyInsertTable(){
  var rows = parseInt(prompt('行数：','3')||'3');
  var cols = parseInt(prompt('列数：','3')||'3');
  if(!rows||!cols||rows<1||cols<1){showToast('行列数无效');return;}
  var html = '<table style="border-collapse:collapse;width:100%;margin:10px 0">';
  for(var r=0;r<rows;r++){
    html+='<tr>';
    for(var c=0;c<cols;c++){
      var isHeader = r===0;
      var tag = isHeader?'th':'td';
      var style = isHeader
        ? 'border:1px solid #aaa;padding:7px 10px;background:#e8e4f8;font-weight:700;text-align:center;min-width:60px'
        : 'border:1px solid #aaa;padding:7px 10px;min-width:60px;vertical-align:top';
      html+='<'+tag+' contenteditable="true" style="'+style+'">'+(isHeader?'标题'+(c+1):'')+'</'+tag+'>';
    }
    html+='</tr>';
  }
  html+='</table><p></p>';
  var ed = document.getElementById('study-editor'); if(!ed) return;
  ed.focus();
  document.execCommand('insertHTML',false,html);
  studyAutoSave();
  showToast('✓ 表格已插入（可直接点击单元格编辑）');
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
renderHome();
setTimeout(function(){ initApiKeyInput(); initCloudInputs(); }, 150);
