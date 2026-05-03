const DBKEY='lou_pce_quiz_cloud_v1';
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "pce-quiz-e18a8.firebaseapp.com",
  projectId: "pce-quiz-e18a8",
  storageBucket: "pce-quiz-e18a8.firebasestorage.app",
  messagingSenderId: "688362163182",
  appId: "1:688362163182:web:b635ff25466345752bdcff",
  measurementId: "G-K5150P19W6"
};
const FIREBASE_CONFIG_KEY='lou_pce_firebase_config';
let DB=loadDB();
let Q={batchId:null,questions:[],idx:0,answers:[],dk:{},selected:null,timer:null,left:0,limit:60,mode:'normal',mockStart:null};
let firebaseState={app:null,auth:null,db:null,user:null,ready:false};

function freshDB(){return{batches:[],wrong:{},dk:{},attempts:{}}}
function loadDB(){try{return JSON.parse(localStorage.getItem(DBKEY))||freshDB()}catch(e){return freshDB()}}
function saveDB(){localStorage.setItem(DBKEY,JSON.stringify(DB))}
function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function normalize(s){return String(s||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).replace(/[）]/g,')').replace(/[（]/g,'(').replace(/[。]/g,'.').replace(/　/g,' ')}
function toast(msg){let t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}

function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  if(id==='home')renderHome();
  if(id==='review')renderReview();
  if(id==='mock')renderMockSetup();
  if(id==='cloud')updateCloudStatus();
}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showPage(b.dataset.page));

function renderHome(){
  let total=DB.batches.reduce((n,b)=>n+b.questions.length,0), done=0, ok=0;
  Object.values(DB.attempts||{}).forEach(a=>{done+=a.answered||0;ok+=a.correct||0});
  byId('st-total').textContent=total;
  byId('st-done').textContent=done;
  byId('st-wrong').textContent=Object.keys(DB.wrong||{}).length;
  byId('st-dk').textContent=Object.keys(DB.dk||{}).length;
  byId('st-rate').textContent=done?Math.round(ok/done*100)+'%':'--';
  let box=byId('batch-list');box.innerHTML='';
  if(!DB.batches.length){box.innerHTML='<div class="empty"><strong>暂无题目</strong>先导入一套卷子，别让考试追着你跑。</div>';return}
  DB.batches.slice().reverse().forEach(b=>{
    let answered=(b.progress?.answers||[]).filter(Boolean).length;
    let row=document.createElement('div');row.className='batch';
    row.innerHTML=`<div class="batch-name">${esc(b.name)}</div><span class="badge blue">${b.questions.length}题</span><span class="badge">已答 ${answered}</span><button class="btn small primary">开始/继续</button><button class="btn small">重做</button><button class="btn small red">删除</button>`;
    let btns=row.querySelectorAll('button');
    btns[0].onclick=()=>startBatch(b.id,false);
    btns[1].onclick=()=>startBatch(b.id,true);
    btns[2].onclick=()=>deleteBatch(b.id);
    box.appendChild(row)
  })
}
function deleteBatch(id){
  if(!confirm('删除这个批次？错题库里来自这个批次的题也会一起清理。'))return;
  DB.batches=DB.batches.filter(b=>b.id!==id);
  for(const k of Object.keys(DB.wrong||{})){if(DB.wrong[k].batchId===id)delete DB.wrong[k]}
  for(const k of Object.keys(DB.dk||{})){if(DB.dk[k].batchId===id)delete DB.dk[k]}
  delete DB.attempts[id];saveDB();renderHome()
}

function parseQuestions(raw){
  raw=normalize(raw);let lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);
  const qRe=/^[(\[]?\s*(\d{1,4})\s*[).、]\s*(.+)$/;
  const optRe=/^([A-Ha-h])\s*[).、]\s*(.+)$/;
  const ansRe=/(?:答案|Answer|Ans)\s*[:：]?\s*([A-Ha-h])/i;
  const caseRe=/(使用以下信息|使用下列信息|根据以下|根据下列|以下病例|following case|following information|case scenario)/i;
  let qs=[],cur=null,pendingCase='';
  function push(){if(cur&&cur.opts.length>=2){cur.body=cur.body.trim();cur.opts=cur.opts.filter(o=>o.text.trim());qs.push(cur)}}
  for(let i=0;i<lines.length;i++){
    let l=lines[i];let am=l.match(ansRe);if(am&&cur){cur.answer=am[1].toUpperCase();continue}
    if(caseRe.test(l)&&!qRe.test(l)){let c=[l];let j=i+1;while(j<lines.length&&!qRe.test(lines[j])){c.push(lines[j]);j++}pendingCase=c.join('\n');i=j-1;continue}
    let qm=l.match(qRe);if(qm){push();cur={id:uid(),num:parseInt(qm[1],10),body:qm[2],opts:[],answer:null,caseText:pendingCase||''};continue}
    if(!cur)continue;
    let om=l.match(optRe);if(om){cur.opts.push({letter:om[1].toUpperCase(),text:om[2].trim()});continue}
    let inline=[...l.matchAll(/([A-Ha-h])\s*[).、]\s*([^A-Ha-h]+?)(?=\s+[A-Ha-h]\s*[).、]|$)/g)].map(m=>({letter:m[1].toUpperCase(),text:m[2].trim()}));
    if(inline.length>=2){cur.opts.push(...inline);continue}
    if(cur.opts.length===0)cur.body+='\n'+l;else cur.opts[cur.opts.length-1].text+=' '+l;
  }
  push();return qs;
}

function importQuestions(start){
  let raw=byId('raw').value.trim(),msg=byId('import-msg');
  if(!raw){msg.textContent='先粘贴或上传题目。';msg.style.color='var(--red)';return}
  let qs=parseQuestions(raw);
  if(!qs.length){msg.textContent='没有识别到题目。检查题号/选项格式。';msg.style.color='var(--red)';return}
  let name=byId('batch-name').value.trim()||('批次 '+(DB.batches.length+1)+' - '+new Date().toLocaleDateString('zh-CN'));
  let b={id:uid(),name,date:Date.now(),questions:qs,progress:{idx:0,answers:Array(qs.length).fill(null),dk:{}}};
  DB.batches.push(b);saveDB();
  byId('raw').value='';byId('batch-name').value='';
  msg.textContent='已导入 '+qs.length+' 道题：'+name;msg.style.color='var(--green)';
  renderHome();if(start)setTimeout(()=>startBatch(b.id,true),300)
}

function startBatch(id,restart){
  let b=DB.batches.find(x=>x.id===id);if(!b)return;
  let limit=parseInt(byId('limit').value,10);if(Number.isNaN(limit))limit=60;
  if(restart)b.progress={idx:0,answers:Array(b.questions.length).fill(null),dk:{}};
  Q={batchId:id,questions:b.questions,idx:b.progress.idx||0,answers:[...(b.progress.answers||Array(b.questions.length).fill(null))],dk:{...(b.progress.dk||{})},selected:null,timer:null,left:limit,limit,mode:'normal',mockStart:null};
  showPage('quiz');loadQuestion()
}
function resumeQuiz(){let b=DB.batches.find(x=>(x.progress?.answers||[]).filter(Boolean).length<x.questions.length)||DB.batches[0];if(!b){alert('先导入题目。');return}startBatch(b.id,false)}
function startFirstBatch(restart){let b=DB.batches[0];if(!b){alert('先导入题目。');return}startBatch(b.id,restart)}
function saveProgress(){let b=DB.batches.find(x=>x.id===Q.batchId);if(!b)return;b.progress={idx:Q.idx,answers:Q.answers,dk:Q.dk};saveDB()}
function loadQuestion(){
  clearInterval(Q.timer);let q=Q.questions[Q.idx];if(!q){alert('没有题目');return}
  Q.selected=Q.answers[Q.idx]&&Q.answers[Q.idx]!=='skip'?Q.answers[Q.idx]:null;
  byId('q-num').textContent=q.num;byId('q-total').textContent=Q.questions.length;
  byId('q-batch').textContent=Q.mode==='mock'?'模拟考试':((DB.batches.find(b=>b.id===Q.batchId)?.name)||'');
  byId('qbar').style.width=(Q.idx/Q.questions.length*100)+'%';
  let cb=byId('casebox');if(q.caseText){cb.style.display='block';cb.innerHTML='<b>病例资料</b>\n'+esc(q.caseText)}else cb.style.display='none';
  byId('qbody').textContent=q.body;
  let box=byId('opts');box.innerHTML='';
  q.opts.forEach(o=>{let btn=document.createElement('button');btn.className='opt'+(Q.selected===o.letter?' selected':'');btn.innerHTML=`<span class="letter">${o.letter}</span><span>${esc(o.text)}</span>`;btn.onclick=()=>{Q.selected=o.letter;Q.answers[Q.idx]=o.letter;saveProgress();loadOptionsOnly()};box.appendChild(btn)});
  byId('dkbtn').classList.toggle('active',!!Q.dk[Q.idx]);startTimer()
}
function loadOptionsOnly(){document.querySelectorAll('#opts .opt').forEach(btn=>btn.classList.toggle('selected',btn.querySelector('.letter').textContent===Q.selected))}
function startTimer(){let el=byId('timer');el.className='timer';if(Q.limit===0){el.textContent='不限时';return}Q.left=Q.limit;tick();Q.timer=setInterval(()=>{Q.left--;tick();if(Q.left<=0){clearInterval(Q.timer);if(!Q.answers[Q.idx])Q.answers[Q.idx]='skip';nextQ()}},1000)}
function tick(){let el=byId('timer');el.textContent=Q.left+'s';el.className='timer'+(Q.left<=10?' danger':Q.left<=20?' warn':'')}
function nextQ(){clearInterval(Q.timer);if(!Q.answers[Q.idx])Q.answers[Q.idx]=Q.selected||'skip';saveProgress();if(Q.idx>=Q.questions.length-1){finishQuiz();return}Q.idx++;saveProgress();loadQuestion()}
function prevQ(){clearInterval(Q.timer);if(Q.idx>0){Q.idx--;saveProgress();loadQuestion()}}
function skipQ(){Q.answers[Q.idx]='skip';nextQ()}
function toggleDK(){Q.dk[Q.idx]=!Q.dk[Q.idx];if(!Q.dk[Q.idx])delete Q.dk[Q.idx];saveProgress();byId('dkbtn').classList.toggle('active',!!Q.dk[Q.idx])}
function finishQuiz(){clearInterval(Q.timer);for(let i=0;i<Q.answers.length;i++)if(!Q.answers[i])Q.answers[i]='skip';saveProgress();commitAttempt();renderResult();showPage('result')}
function commitAttempt(){
  let b=DB.batches.find(x=>x.id===Q.batchId)||{id:'mock',name:'模拟考试'};let answered=0,correct=0;
  Q.questions.forEach((q,i)=>{let my=Q.answers[i];if(my&&my!=='skip')answered++;let ok=q.answer&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();if(ok)correct++;if(q.answer&&my&&my!=='skip'&&!ok)DB.wrong[q.id]={q,batchId:b.id,batchName:b.name,myAns:my};else if(ok)delete DB.wrong[q.id];if(Q.dk[i])DB.dk[q.id]={q,batchId:b.id,batchName:b.name,myAns:my};else if(ok)delete DB.dk[q.id]});
  DB.attempts[b.id]={answered,correct,last:Date.now()};saveDB()
}
function renderResult(){
  let total=Q.questions.length,ok=0,bad=0,dk=Object.keys(Q.dk).length,withAns=0;let tbody=byId('result-table');tbody.innerHTML='';
  byId('result-batch').textContent=Q.mode==='mock'?'模拟考试':(DB.batches.find(b=>b.id===Q.batchId)?.name||'');
  Q.questions.forEach((q,i)=>{let my=Q.answers[i]||'skip',has=!!q.answer;if(has)withAns++;let good=has&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();let wrong=has&&my!=='skip'&&!good;if(good)ok++;if(wrong)bad++;let tr=document.createElement('tr');tr.style.cursor='pointer';tr.onclick=()=>openQuestion(q,{myAns:my,batchName:byId('result-batch').textContent});tr.innerHTML=`<td><b>${q.num}</b></td><td>${esc(q.body.slice(0,70))}${Q.dk[i]?' <span class="badge orange">不会</span>':''}</td><td>${my==='skip'?'—':my}</td><td>${q.answer||'—'}</td><td>${has?(good?'<span class="badge green">对</span>':wrong?'<span class="badge red">错</span>':'<span class="badge">跳过</span>'):'<span class="badge">无答案</span>'}</td>`;tbody.appendChild(tr)});
  byId('rs-total').textContent=total;byId('rs-ok').textContent=ok;byId('rs-bad').textContent=bad;byId('rs-dk').textContent=dk;byId('rs-rate').textContent=withAns?Math.round(ok/withAns*100)+'%':'--';renderHome()
}
function compareKey(){
  let raw=byId('answer-key').value.trim();let msg=byId('key-msg');if(!raw){msg.textContent='先粘贴答案。';msg.style.color='var(--red)';return}
  let byNum={},byIndex={};if(/^[A-Ha-h\s]+$/.test(raw)&&raw.replace(/\s/g,'').length>=2){raw.replace(/\s/g,'').split('').forEach((c,i)=>byIndex[i]=c.toUpperCase())}else raw.split(/\n|;/).forEach(line=>{let m=line.match(/(\d{1,4})\s*[.、:：\-]?\s*([A-Ha-h])/);if(m)byNum[parseInt(m[1],10)]=m[2].toUpperCase()});
  let n=0;Q.questions.forEach((q,i)=>{let key=byNum[q.num]||byIndex[i];if(key){q.answer=key;n++}});
  saveProgress();commitAttempt();renderResult();msg.textContent='已更新/核对 '+n+' 题答案。';msg.style.color='var(--green)'
}
function renderReview(){
  let list=byId('review-list');list.innerHTML='';
  let items=[...Object.values(DB.wrong||{}).map(e=>({...e,type:'wrong'})),...Object.values(DB.dk||{}).filter(e=>!DB.wrong[e.q.id]).map(e=>({...e,type:'dk'}))];
  if(!items.length){list.innerHTML='<div class="card empty"><strong>复习库是空的</strong>这很好，但也可能是你还没开始刷。别装睡，起来做题。</div>';return}
  items.sort((a,b)=>(a.q.num||0)-(b.q.num||0));
  items.forEach(e=>{let c=document.createElement('div');c.className='card';c.style.cursor='pointer';c.onclick=()=>openQuestion(e.q,e);c.innerHTML=`<div class="row"><span class="badge ${e.type==='wrong'?'red':'orange'}">${e.type==='wrong'?'错题':'不会'}</span><b>题号 ${e.q.num}</b><span class="sub">${esc(e.batchName||'')}</span><button class="btn small spacer">查看</button></div><div class="mt">${esc(e.q.body.slice(0,140))}</div>`;list.appendChild(c)})
}
function clearReview(){if(!confirm('清空错题和不会题？'))return;DB.wrong={};DB.dk={};saveDB();renderReview();renderHome()}
function openQuestion(q,e={}){
  let html='';if(q.caseText)html+=`<div class="case" style="display:block"><b>病例资料</b>\n${esc(q.caseText)}</div>`;
  html+=`<div class="qbody">${esc(q.body)}</div><div class="opts">`;
  q.opts.forEach(o=>{let cls='opt';if(o.letter===q.answer)cls+=' selected';html+=`<div class="${cls}"><span class="letter">${o.letter}</span><span>${esc(o.text)}${o.letter===q.answer?' <b style="color:var(--green)">✓ 正确</b>':''}${o.letter===e.myAns&&o.letter!==q.answer?' <b style="color:var(--red)">← 我选</b>':''}</span></div>`});
  html+='</div>';html+=`<div class="explain"><b>核心判断：</b>\n正确答案：${q.answer||'未提供'}；你选：${e.myAns&&e.myAns!=='skip'?e.myAns:'—'}。</div>`;
  byId('m-title').textContent='题号 '+q.num;byId('m-content').innerHTML=html;byId('modal-bg').classList.add('open')
}
function closeModal(){byId('modal-bg').classList.remove('open')}
function renderMockSetup(){
  let area=byId('mock-area');let all=DB.batches.flatMap(b=>b.questions.map(q=>({q,b})));
  area.innerHTML=`<div class="card"><div class="title">模拟考试</div><div class="sub">默认最多抽 125 题；题库不足就抽全部。错题加权会提高薄弱题出现概率。</div><div class="grid"><div class="stat"><div class="k">可用题目</div><div class="v">${all.length}</div></div><div class="stat"><div class="k">考试题数</div><div class="v">${Math.min(125,all.length)}</div></div><div class="stat"><div class="k">建议时间</div><div class="v">2.5h</div></div></div><div class="row mt"><label class="sub"><input type="checkbox" id="mock-wrong" /> 错题加权抽取</label><button class="btn primary spacer" onclick="startMock()">开始模拟考</button></div></div>`
}
function startMock(){
  let all=DB.batches.flatMap(b=>b.questions.map(q=>q));if(!all.length){alert('先导入题目。');return}
  let pool=[...all];if(byId('mock-wrong')?.checked){Object.values(DB.wrong||{}).forEach(e=>{pool.push(e.q,e.q)})}
  pool=pool.sort(()=>Math.random()-.5).slice(0,Math.min(125,pool.length));
  Q={batchId:'mock',questions:pool,idx:0,answers:Array(pool.length).fill(null),dk:{},selected:null,timer:null,left:0,limit:0,mode:'mock',mockStart:Date.now()};
  showPage('quiz');loadQuestion()
}
function printReport(){
  let items=[...Object.values(DB.wrong||{}).map(e=>({...e,type:'错题'})),...Object.values(DB.dk||{}).filter(e=>!DB.wrong[e.q.id]).map(e=>({...e,type:'不会'}))];
  if(!items.length){alert('没有错题/不会题可以输出。');return}
  let w=window.open('','_blank');let html=`<html><head><title>PCE复习报告</title><style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",Arial,sans-serif;padding:32px;line-height:1.7;color:#222}.q{page-break-inside:avoid;border-left:5px solid #b73434;background:#fff8f8;padding:14px 18px;margin:0 0 18px;border-radius:8px}.dk{border-left-color:#c47a1a;background:#fffdf0}.tag{font-size:12px;font-weight:bold}.opt{padding:3px 0}.ok{color:#28744d;font-weight:bold}.bad{color:#b73434;font-weight:bold}pre{white-space:pre-wrap;font-family:inherit}</style></head><body><h1>PCE 针灸复习报告</h1><p>生成时间：${new Date().toLocaleString('zh-CN')} ｜ 共 ${items.length} 题</p>`;
  items.forEach(e=>{let q=e.q;html+=`<div class="q ${e.type==='不会'?'dk':''}"><div class="tag">${e.type} ｜ 题号 ${q.num} ｜ ${esc(e.batchName||'')}</div>${q.caseText?`<pre><b>病例资料</b>\n${esc(q.caseText)}</pre>`:''}<pre><b>${esc(q.body)}</b></pre>`;q.opts.forEach(o=>{html+=`<div class="opt ${o.letter===q.answer?'ok':''}">${o.letter}. ${esc(o.text)} ${o.letter===q.answer?'✓ 正确':''} ${o.letter===e.myAns&&o.letter!==q.answer?'<span class="bad">← 我选</span>':''}</div>`});html+=`<p>正确答案：<b>${q.answer||'未提供'}</b>；我选：<b>${e.myAns||'—'}</b></p></div>`});
  html+='</body></html>';w.document.write(html);w.document.close();w.focus();w.print()
}
function downloadCSV(){
  if(!Q.questions.length){alert('暂无答题结果');return}
  let rows=[['题号','题目','我选','答案','结果']];
  Q.questions.forEach((q,i)=>{let my=Q.answers[i]||'';let ok=q.answer&&my&&my!=='skip'&&my.toUpperCase()===q.answer.toUpperCase();rows.push([q.num,q.body.replace(/\n/g,' '),my,q.answer||'',q.answer?(ok?'对':'错/跳过'):'无答案'])});
  let csv='\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n');let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='PCE答题结果.csv';a.click()
}
byId('file-input').onchange=async e=>{let f=e.target.files[0];if(!f)return;byId('upload-status').textContent='正在读取 '+f.name+' ...';try{byId('raw').value=await f.text();byId('upload-status').textContent='读取完成：'+f.name;toast('文件读取完成')}catch(err){byId('upload-status').textContent='读取失败，请复制粘贴文本。'}};

function byId(id){return document.getElementById(id)}

// Cloud sync
function saveFirebaseConfig(){
  let raw=byId('firebase-config').value.trim();
  if(!raw){alert('先粘贴 Firebase config');return}
  try{let cfg=JSON.parse(raw);localStorage.setItem(FIREBASE_CONFIG_KEY,JSON.stringify(cfg));toast('Firebase 配置已保存');updateCloudStatus()}catch(e){alert('JSON格式不对，检查逗号和引号。')}
}
function loadFirebaseConfigToBox(){byId('firebase-config').value=localStorage.getItem(FIREBASE_CONFIG_KEY)||''}
function updateCloudStatus(){
  let el=byId('cloud-status');if(!el)return;
  let has=true;
  let user=firebaseState.user;
  el.innerHTML=(has?'Firebase配置：已保存。':'Firebase配置：未保存。')+'<br>'+(user?'当前登录：'+esc(user.email):'未登录。');
}
async function initFirebase(){
  if(firebaseState.ready)return firebaseState;

  
  let cfg = firebaseConfig;
  const appMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
  const authMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
  const fsMod=await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const app=appMod.initializeApp(cfg);
  const auth=authMod.getAuth(app);
  const db=fsMod.getFirestore(app);
  firebaseState={app,auth,db,user:auth.currentUser,ready:true,authMod,fsMod};
  authMod.onAuthStateChanged(auth,u=>{firebaseState.user=u;updateCloudStatus()});
  return firebaseState;
}
async function cloudRegister(){
  try{
    let s=await initFirebase();let email=byId('cloud-email').value.trim();let pass=byId('cloud-pass').value;
    await s.authMod.createUserWithEmailAndPassword(s.auth,email,pass);toast('注册成功');
  }catch(e){alert('注册失败：'+e.message)}
}
async function cloudLogin(){
  try{
    let s=await initFirebase();let email=byId('cloud-email').value.trim();let pass=byId('cloud-pass').value;
    await s.authMod.signInWithEmailAndPassword(s.auth,email,pass);toast('登录成功');
  }catch(e){alert('登录失败：'+e.message)}
}
async function cloudLogout(){
  try{let s=await initFirebase();await s.authMod.signOut(s.auth);toast('已退出')}catch(e){alert(e.message)}
}
async function cloudUpload(){
  try{
    let s=await initFirebase();if(!s.auth.currentUser)throw new Error('请先登录。');
    const ref=s.fsMod.doc(s.db,'pceQuizData',s.auth.currentUser.uid);
    await s.fsMod.setDoc(ref,{db:DB,updatedAt:new Date().toISOString()});
    toast('已上传到云端');
  }catch(e){alert('上传失败：'+e.message)}
}
async function cloudDownload(){
  try{
    let s=await initFirebase();if(!s.auth.currentUser)throw new Error('请先登录。');
    if(!confirm('从云端下载会覆盖本地数据，确定吗？'))return;
    const ref=s.fsMod.doc(s.db,'pceQuizData',s.auth.currentUser.uid);
    const snap=await s.fsMod.getDoc(ref);
    if(!snap.exists())throw new Error('云端还没有数据，请先上传。');
    DB=snap.data().db||freshDB();saveDB();renderHome();toast('已从云端下载');
  }catch(e){alert('下载失败：'+e.message)}
}

renderHome();
