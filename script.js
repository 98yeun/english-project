
// ── STATE ──
const A = {
  passages:[], questions:[], answers:{}, log:{},
  // 날짜별 누적 기록: { "2026-5-27": { passages:[...], qaSets:[{questions,answers}] } }
  history:{},
  quizItems:[],
  calY:new Date().getFullYear(), calM:new Date().getMonth(),
  selDay:null,
  shIdx:null, shSent:0,
  shRec:null, shUrl:null, shBlob:null, shRecOn:false,
  qaRecs:{}, qaUrls:{}, qaRecOn:{},
  qaNatural:{}, qaPronRecs:{}, qaPronBlobs:{}, qaPronUrls:{}, qaPronOn:{}
};

function persist(){try{localStorage.setItem('eapp',JSON.stringify({passages:A.passages,questions:A.questions,answers:A.answers,log:A.log,history:A.history}))}catch(e){}}
function restore(){try{const d=JSON.parse(localStorage.getItem('eapp')||'{}');['passages','questions','answers','log','history'].forEach(k=>{if(d[k])A[k]=d[k]})}catch(e){}}
restore();

function addLog(type,txt){
  const k=todayKey();
  if(!A.log[k])A.log[k]=[];
  A.log[k].push({type,txt,time:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})});
  persist();
}
function todayKey(){const t=new Date();return`${t.getFullYear()}-${t.getMonth()+1}-${t.getDate()}`}

// ── API KEY ──
function getKey(){return localStorage.getItem('eappKey')||''}
function saveKey(){
  const v=document.getElementById('key-inp').value.trim();
  if(!v.startsWith('sk-')){
    setKeyMsg('❌ sk- 로 시작하는 OpenAI API 키를 입력해주세요','var(--red)');return;
  }
  localStorage.setItem('eappKey',v);
  setKeyMsg('✓ 저장됐어요! 모든 AI 기능은 GPT로 동작해요','var(--green)');
  document.getElementById('key-card').classList.add('ok');
}
function setKeyMsg(t,c){const el=document.getElementById('key-msg');el.textContent=t;el.style.color=c}

// ── OPENAI API ──
async function openaiText(prompt, opts={}){
  const key=getKey();
  if(!key){alert('먼저 OpenAI API 키를 입력하고 저장해주세요');throw new Error('no key')}
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify({
      model: opts.model || 'gpt-4.1-mini',
      input: prompt,
      temperature: opts.temperature ?? 0.3
    })
  });
  if(!r.ok){let msg=r.statusText;try{const e=await r.json();msg=e.error?.message||msg}catch(_){ } throw new Error(msg)}
  const d=await r.json();
  return d.output_text || (d.output||[]).flatMap(o=>o.content||[]).map(c=>c.text||'').join('') || '';
}

async function openaiFile(file,prompt){
  const key=getKey();
  if(!key){alert('먼저 OpenAI API 키를 입력하고 저장해주세요');throw new Error('no key')}
  const dataUrl=await toDataUrl(file);
  const isPdf=(file.type||'').includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
  const content=[{type:'input_text',text:prompt}];
  if(isPdf){
    content.push({type:'input_file',filename:file.name||'upload.pdf',file_data:dataUrl});
  }else{
    content.push({type:'input_image',image_url:dataUrl});
  }
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify({model:'gpt-4.1-mini',input:[{role:'user',content}],temperature:0.1})
  });
  if(!r.ok){let msg=r.statusText;try{const e=await r.json();msg=e.error?.message||msg}catch(_){ } throw new Error(msg)}
  const d=await r.json();
  return d.output_text || (d.output||[]).flatMap(o=>o.content||[]).map(c=>c.text||'').join('') || '';
}

async function toDataUrl(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=()=>rej(new Error('file read fail'));
    r.readAsDataURL(file);
  });
}

async function transcribeAudio(blob){
  const key=getKey();
  if(!key){alert('먼저 OpenAI API 키를 입력하고 저장해주세요');throw new Error('no key')}
  const fd=new FormData();
  fd.append('model','whisper-1');
  fd.append('file',blob,'shadowing.webm');
  fd.append('language','en');
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{'Authorization':'Bearer '+key},body:fd});
  if(!r.ok){let msg=r.statusText;try{const e=await r.json();msg=e.error?.message||msg}catch(_){ } throw new Error(msg)}
  const d=await r.json();
  return d.text||'';
}


async function playOpenAITTS(text, statusId){
  const key=getKey();
  if(!key){alert('OpenAI API 키를 먼저 저장해주세요');return;}
  const st=statusId?document.getElementById(statusId):null;
  if(st)st.textContent='GPT 음성 생성 중...';
  try{
    let r=await fetch('https://api.openai.com/v1/audio/speech',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({
        model:'gpt-4o-mini-tts',
        voice:'nova',
        input:text,
        speed:0.92,
        instructions:'Read this as a natural native English speaker and teacher. Use clear intonation, natural linking, and a slightly slower pace suitable for shadowing practice.'
      })
    });
    if(!r.ok){
      r=await fetch('https://api.openai.com/v1/audio/speech',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({model:'tts-1',voice:'nova',input:text,speed:0.92})
      });
    }
    if(!r.ok)throw new Error('TTS failed');
    const blob=await r.blob();
    const audio=new Audio(URL.createObjectURL(blob));
    if(st)st.textContent='재생 중...';
    audio.onended=()=>{if(st)st.textContent='완료'};
    await audio.play();
  }catch(e){
    if(st)st.textContent='기본 TTS로 재생 중...';
    if(window.speechSynthesis){
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text);
      u.lang='en-US'; u.rate=0.88;
      u.onend=()=>{if(st)st.textContent='완료'};
      window.speechSynthesis.speak(u);
    }else{
      if(st)st.textContent='음성 재생 실패';
    }
  }
}

// ── TABS ──
const PANELS=['cal','sh','qa','qz'];
function goTab(id,i){
  PANELS.forEach(p=>document.getElementById('p-'+p).classList.remove('on'));
  document.querySelectorAll('.tab').forEach((t,j)=>t.classList.toggle('on',j===i));
  document.getElementById('p-'+id).classList.add('on');
  document.getElementById('content').scrollTop=0;
  if(id==='cal'){renderCal();updateStats()}
  if(id==='sh')renderPassages();
  if(id==='qa')renderQA();
}

// ── STATS ──
function updateStats(){
  document.getElementById('s-pass').textContent=A.passages.length;
  document.getElementById('s-ans').textContent=Object.values(A.answers).filter(v=>v&&v.trim()).length;
  const sc=Object.values(A.log).flat().filter(l=>l.type==='quiz').map(l=>parseInt(l.txt)||0);
  document.getElementById('s-score').textContent=sc.length?Math.max(...sc)+'점':'-';
}

// ── CALENDAR ──
function renderCal(){
  const y=A.calY,m=A.calM;
  document.getElementById('cal-mo').textContent=`${y}년 ${m+1}월`;
  const first=new Date(y,m,1).getDay(), days=new Date(y,m+1,0).getDate();
  const t=new Date(); let h='';
  for(let i=0;i<first;i++)h+=`<div class="cal-d empty"></div>`;
  for(let d=1;d<=days;d++){
    const k=`${y}-${m+1}-${d}`;
    const today=t.getFullYear()===y&&t.getMonth()===m&&t.getDate()===d;
    const hasDot=A.log[k]&&A.log[k].length;
    const sel=A.selDay===k;
    h+=`<div class="cal-d${today?' today':''}${sel?' sel':''}${hasDot?' dot':''}" onclick="selDay('${k}',${d})">${d}</div>`;
  }
  document.getElementById('cal-grid').innerHTML=h;
}
function chMonth(d){A.calM+=d;if(A.calM>11){A.calM=0;A.calY++}if(A.calM<0){A.calM=11;A.calY--}renderCal()}
function selDay(k,d){
  A.selDay=k; renderCal();
  document.getElementById('log-title').innerHTML=`<i class="ti ti-clipboard-list"></i>${A.calY}년 ${A.calM+1}월 ${d}일 복습`;
  const hist=A.history[k];
  const logs=A.log[k]||[];
  if(!hist&&!logs.length){
    document.getElementById('log-body').innerHTML='<div class="empty" style="padding:16px 0"><i class="ti ti-mood-empty"></i><p>이 날은 학습 기록이 없어요</p></div>';
    return;
  }
  let html='';

  // 쉐도잉 지문 복습
  if(hist&&hist.passages&&hist.passages.length){
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:8px;display:flex;align-items:center;gap:6px"><i class="ti ti-microphone"></i>쉐도잉 지문 (${hist.passages.length}개)</div>`;
    hist.passages.forEach((p,pi)=>{
      html+=`<div style="background:var(--bg1);border-radius:var(--rmd);padding:12px;margin-bottom:8px;border:0.5px solid var(--br)">
        <div style="font-size:13px;font-weight:600;color:var(--tx0);margin-bottom:6px">${p.title}</div>
        <div style="font-size:12px;color:var(--tx1);line-height:1.8;white-space:pre-wrap">${p.text}</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // 문제 & 답변 복습
  if(hist&&hist.qaSets&&hist.qaSets.length){
    hist.qaSets.forEach((set,si)=>{
      html+=`<div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--purple);margin-bottom:8px;display:flex;align-items:center;gap:6px"><i class="ti ti-message-dots"></i>문제 답변${hist.qaSets.length>1?' '+(si+1):''}${set.uploadTime?' · '+set.uploadTime:''}</div>`;
      set.questions.forEach((q,qi)=>{
        const ans=set.answers[qi]||'';
        html+=`<div style="background:var(--bg1);border-radius:var(--rmd);padding:12px;margin-bottom:8px;border:0.5px solid var(--br)">
          <div style="font-size:12px;font-weight:600;color:var(--purple);margin-bottom:4px"><span style="background:var(--purple1);padding:1px 7px;border-radius:10px">Q${qi+1}</span></div>
          <div style="font-size:13px;color:var(--tx0);margin-bottom:6px;line-height:1.6">${q}</div>
          ${ans
            ?`<div style="font-size:12px;color:var(--tx2);margin-bottom:2px">내 답변</div><div style="font-size:13px;color:var(--tx0);background:var(--bg0);border-radius:6px;padding:8px 10px;border:0.5px solid var(--br);line-height:1.6">${ans}</div>`
            :`<div style="font-size:12px;color:var(--tx2);font-style:italic">답변 없음</div>`
          }
        </div>`;
      });
      html+=`</div>`;
    });
  }

  // 활동 로그 (간단 요약)
  if(logs.length){
    const map={shadowing:['b-blue','쉐도잉'],qa:['b-purple','문제답변'],quiz:['b-green','퀴즈']};
    html+=`<div style="margin-top:4px"><div style="font-size:12px;font-weight:700;color:var(--tx2);margin-bottom:6px">활동 기록</div>
      <div class="log-wrap">${logs.map(l=>{
        const[cls,lbl]=map[l.type]||['b-amber',l.type];
        return`<div class="log-item"><div class="log-meta"><span class="badge ${cls}">${lbl}</span><span style="color:var(--tx2)">${l.time}</span></div><div class="log-txt">${l.txt}</div></div>`;
      }).join('')}</div></div>`;
  }

  document.getElementById('log-body').innerHTML=html;
}

// ── SHADOWING ──
async function uploadPassage(e){
  const file=e.target.files[0]; if(!file)return;
  show('sh-load'); hide('sh-ext');
  try{
    const txt=await openaiFile(file,'이 파일에서 영어 지문(본문 텍스트)만 추출해줘. 맨 첫 줄에 "제목: [제목]" 형식으로 제목 쓰고, 나머지는 본문만. 설명이나 주석 없이.');
    const lines=txt.trim().split('\n');
    let title=`지문 ${A.passages.length+1}`, body=txt.trim();
    if(lines[0].startsWith('제목:')){title=lines[0].replace('제목:','').trim();body=lines.slice(1).join('\n').trim()}
    document.getElementById('sh-title').value=title;
    document.getElementById('sh-text').value=body;
    show('sh-ext');
  }catch(err){alert('오류: '+err.message)}
  hide('sh-load'); e.target.value='';
}
function savePassage(){
  const text=document.getElementById('sh-text').value.trim();
  if(!text){alert('텍스트가 없어요');return}
  const title=document.getElementById('sh-title').value.trim()||`지문 ${A.passages.length+1}`;
  const passage={title,text,date:new Date().toLocaleDateString('ko-KR')};
  A.passages.push(passage);
  // 날짜별 history에도 저장
  const k=todayKey();
  if(!A.history[k])A.history[k]={passages:[],qaSets:[]};
  A.history[k].passages.push({title,text});
  persist(); hide('sh-ext');
  addLog('shadowing',`"${title}" 지문 저장`);
  renderPassages(); updateStats();
}
function renderPassages(){
  const list=document.getElementById('sh-list');
  document.getElementById('sh-empty').style.display=A.passages.length?'none':'';
  list.innerHTML=A.passages.map((p,i)=>`
    <div class="p-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div><div class="p-title">${p.title}</div><div class="p-date">${p.date}</div></div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn primary sm" onclick="startPractice(${i})"><i class="ti ti-microphone"></i>연습</button>
          <button class="btn danger sm" onclick="delPassage(${i})"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="p-preview">${p.text.substring(0,120)}${p.text.length>120?'...':''}</div>
    </div>`).join('');
}
function delPassage(i){
  if(confirm(`"${A.passages[i].title}"을 삭제할까요?`)){
    A.passages.splice(i,1); persist(); renderPassages(); updateStats();
    if(A.shIdx===i)closePractice();
  }
}
function startPractice(idx){
  A.shIdx=idx; A.shSent=0;
  const p=A.passages[idx];
  document.getElementById('prac-title').textContent=p.title;
  const sents=splitSents(p.text);
  document.getElementById('prac-sents').innerHTML=sents.map((s,i)=>`<span class="sent" id="s${i}" onclick="selSent(${i})">${s} </span>`).join('');
  selSent(0);
  show('sh-practice');
  document.getElementById('sh-practice').scrollIntoView({behavior:'smooth',block:'start'});
  addLog('shadowing',`"${p.title}" 쉐도잉 연습`);
}
function closePractice(){hide('sh-practice');window.speechSynthesis&&window.speechSynthesis.cancel();}
function splitSents(t){return t.match(/[^.!?]+[.!?]+/g)||[t]}
function selSent(i){
  A.shSent=i;
  document.querySelectorAll('.sent').forEach((el,j)=>el.classList.toggle('on',j===i));
  document.getElementById('tts-st').textContent=`문장 ${i+1} 선택됨`;
}
async function playSent(){
  const key=getKey();
  if(!key){alert('OpenAI API 키를 먼저 저장해주세요');return;}
  const sents=splitSents(A.passages[A.shIdx].text);
  const text=sents[A.shSent]||'';
  if(!text)return;
  const voice=document.getElementById('tts-voice').value;
  const speed=parseFloat(document.getElementById('tts-spd').value);
  document.getElementById('tts-st').textContent='GPT 음성 생성 중...';
  try{
    let r=await fetch('https://api.openai.com/v1/audio/speech',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({
        model:'gpt-4o-mini-tts',
        voice,
        input:text,
        speed,
        instructions:'Read naturally like a clear native English teacher. Use natural rhythm, intonation, linking, and moderate pacing for shadowing practice.'
      })
    });
    if(!r.ok){
      r=await fetch('https://api.openai.com/v1/audio/speech',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({model:'tts-1',voice,input:text,speed})
      });
    }
    if(!r.ok)throw new Error('TTS failed');
    const blob=await r.blob();
    const audio=new Audio(URL.createObjectURL(blob));
    document.getElementById('tts-st').textContent='재생 중...';
    audio.onended=()=>document.getElementById('tts-st').textContent='완료';
    audio.play();
  }catch(e){
    document.getElementById('tts-st').textContent='기본 TTS로 재생 중...';
    window.speechSynthesis && window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang='en-US'; u.rate=speed;
    u.onend=()=>document.getElementById('tts-st').textContent='완료';
    window.speechSynthesis.speak(u);
  }
}
async function toggleShRec(){
  const btn=document.getElementById('sh-rec');
  if(!A.shRecOn){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      A.shRec=new MediaRecorder(stream); const chunks=[];
      A.shRec.ondataavailable=e=>chunks.push(e.data);
      A.shRec.onstop=()=>{
        A.shBlob=new Blob(chunks,{type:'audio/webm'});
        A.shUrl=URL.createObjectURL(A.shBlob);
        document.getElementById('sh-play').classList.remove('hidden');
        document.getElementById('sh-fb-btn').classList.remove('hidden');
        document.getElementById('sh-fb').innerHTML='<div class="fb-box fb-imp">녹음 완료. “발음 피드백”을 누르면 GPT가 원문과 비교해 발음·억양을 분석합니다.</div>';
        stream.getTracks().forEach(t=>t.stop());
      };
      A.shRec.start(); A.shRecOn=true; A.shBlob=null;
      document.getElementById('sh-fb').innerHTML='';
      btn.classList.add('on'); btn.innerHTML='<span class="dot"></span>녹음 중지';
    }catch(e){alert('마이크 권한이 필요해요')}
  }else{
    A.shRec.stop(); A.shRecOn=false;
    btn.classList.remove('on'); btn.innerHTML='<i class="ti ti-microphone"></i>따라 말하기';
  }
}
function playShRec(){if(A.shUrl)new Audio(A.shUrl).play()}
async function analyzeShadowing(){
  if(!A.shBlob){alert('먼저 따라 말하기를 녹음해주세요');return;}
  const fb=document.getElementById('sh-fb');
  const sents=splitSents(A.passages[A.shIdx].text);
  const target=(sents[A.shSent]||'').trim();
  fb.innerHTML='<div class="loading"><div class="spin"></div>음성 인식 및 발음 피드백 작성 중...</div>';
  try{
    const transcript=await transcribeAudio(A.shBlob);
    const result=await openaiText(`You are an English pronunciation coach for a Korean learner. Give feedback in Korean, concise but specific.

Target sentence:
${target}

Learner transcript from speech recognition:
${transcript}

Return this format only:
점수: 0-100
인식된 문장: ...
좋은 점: ...
교정 포인트: ...
억양/리듬: ...
다시 연습할 표현: ...`);
    fb.innerHTML=`<div class="fb-box fb-good">${result.replace(/\n/g,'<br>')}</div>`;
    addLog('shadowing','발음 피드백 완료');
  }catch(e){
    fb.innerHTML=`<div class="fb-box fb-imp">발음 피드백 오류: ${e.message}</div>`;
  }
}

// ── Q&A ──
async function uploadQA(e){
  const file=e.target.files[0]; if(!file)return;
  show('qa-load');
  try{
    const raw=await openaiFile(file,'이 파일에서 모든 질문을 추출해서 JSON 배열로만 반환해줘. Warm Up과 Discussion Questions 모두. 번호 없이 질문 텍스트만. ["질문1","질문2",...] 형식. JSON만, 다른 텍스트 없이.');
    const qs=JSON.parse(raw.replace(/```json|```/g,'').trim());
    A.questions=qs; A.answers={}; persist();
    addLog('qa',`문제 ${qs.length}개 업로드`);
    // history에 새 QA 세트 추가
    const qk=todayKey();
    if(!A.history[qk])A.history[qk]={passages:[],qaSets:[]};
    A.history[qk].qaSets.push({questions:qs,answers:{},uploadTime:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})});
    persist();
    renderQA();
  }catch(err){alert('오류: '+err.message)}
  hide('qa-load'); e.target.value='';
}
function renderQA(){
  const list=document.getElementById('qa-list');
  document.getElementById('qa-empty').style.display=A.questions.length?'none':'';
  list.innerHTML=A.questions.map((q,i)=>`
    <div class="qa-block">
      <div class="q-text"><span class="badge b-purple" style="margin-right:6px">Q${i+1}</span>${q}</div>
      <textarea id="a${i}" placeholder="영어로 답변을 작성해 보세요..." onchange="saveAns(${i})">${A.answers[i]||''}</textarea>
      <div class="ans-row">
        <button class="rec-btn" id="qr${i}" onclick="toggleQARec(${i})"><i class="ti ti-microphone"></i>녹음</button>
        <button class="btn sm hidden" id="qp${i}" onclick="playQARec(${i})"><i class="ti ti-player-play"></i>듣기</button>
        <button class="btn sm" onclick="getFb(${i})" style="margin-left:auto"><i class="ti ti-sparkles"></i>AI 피드백</button>
      </div>
      <div id="fb${i}"></div>
    </div>`).join('');
}
function saveAns(i){
  const val=document.getElementById(`a${i}`).value;
  A.answers[i]=val;
  // history 최신 qaSet에도 반영
  const k=todayKey();
  if(A.history[k]&&A.history[k].qaSets.length){
    A.history[k].qaSets[A.history[k].qaSets.length-1].answers[i]=val;
  }
  persist();updateStats();addLog('qa',`Q${i+1} 답변 작성`);
}
async function toggleQARec(i){
  const btn=document.getElementById(`qr${i}`);
  if(!A.qaRecOn[i]){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      A.qaRecs[i]=new MediaRecorder(stream); const chunks=[];
      A.qaRecs[i].ondataavailable=e=>chunks.push(e.data);
      A.qaRecs[i].onstop=()=>{
        A.qaUrls[i]=URL.createObjectURL(new Blob(chunks,{type:'audio/webm'}));
        document.getElementById(`qp${i}`).classList.remove('hidden');
        stream.getTracks().forEach(t=>t.stop());
      };
      A.qaRecs[i].start(); A.qaRecOn[i]=true;
      btn.classList.add('on'); btn.innerHTML='<span class="dot"></span>녹음 중지';
    }catch(e){alert('마이크 권한이 필요해요')}
  }else{
    A.qaRecs[i].stop(); A.qaRecOn[i]=false;
    btn.classList.remove('on'); btn.innerHTML='<i class="ti ti-microphone"></i>녹음';
  }
}
function playQARec(i){if(A.qaUrls[i])new Audio(A.qaUrls[i]).play()}
async function getFb(i){
  const ans=(document.getElementById(`a${i}`).value||'').trim();
  if(!ans){alert('답변을 먼저 작성해주세요');return}
  const fb=document.getElementById(`fb${i}`);
  fb.innerHTML='<div class="loading"><div class="spin"></div>GPT 피드백 작성 중...</div>';
  try{
    const raw=await openaiText(`You are an English speaking coach for a Korean learner.
Give feedback in Korean and create one improved natural English answer for shadowing.
Return JSON only, no markdown.

Question: ${A.questions[i]}
Learner answer: ${ans}

JSON format:
{
  "good":"잘된 점 1문장",
  "improve":"개선점 1문장",
  "natural":"더 자연스럽고 짧은 영어 답변 1~2문장. The learner will listen and shadow this sentence.",
  "note":"발음/쉐도잉 팁 1문장"
}`);
    let data;
    try{data=JSON.parse(raw.replace(/```json|```/g,'').trim())}catch(_){
      data={good:'답변 의도는 잘 전달됐어요.',improve:'문장 연결과 표현을 조금 더 자연스럽게 다듬으면 좋아요.',natural:raw.split('\n').filter(Boolean).slice(-1)[0]||ans,note:'천천히 듣고 같은 리듬으로 따라 읽어보세요.'};
    }
    A.qaNatural[i]=data.natural;
    fb.innerHTML=`
      <div class="fb-box fb-good">
        <b>잘된 점:</b> ${escapeHtml(data.good||'좋아요.')}<br>
        <b>개선점:</b> ${escapeHtml(data.improve||'조금 더 자연스럽게 다듬을 수 있어요.')}<br>
        <b>더 자연스러운 표현:</b><br>
        <div class="native-sentence" id="nat${i}">${escapeHtml(data.natural||ans)}</div>
        <small>${escapeHtml(data.note||'듣고 같은 리듬으로 따라 읽어보세요.')}</small>
      </div>
      <div class="shadow-practice mini-practice">
        <div class="ans-row">
          <button class="btn sm" onclick="playQANatural(${i})"><i class="ti ti-volume"></i>문장 듣기</button>
          <button class="rec-btn" id="qpr${i}" onclick="toggleQAPronRec(${i})"><i class="ti ti-microphone"></i>따라 읽고 녹음</button>
          <button class="btn sm hidden" id="qpp${i}" onclick="playQAPronRec(${i})"><i class="ti ti-player-play"></i>내 녹음 듣기</button>
          <button class="btn sm hidden" id="qpfb${i}" onclick="analyzeQAPron(${i})"><i class="ti ti-sparkles"></i>발음 피드백</button>
        </div>
        <div class="small-status" id="qps${i}"></div>
        <div id="qpronfb${i}"></div>
      </div>`;
    addLog('qa',`Q${i+1} GPT 피드백 및 쉐도잉 문장 생성`);
  }catch(e){fb.innerHTML=`<div class="fb-box fb-imp">피드백 오류: ${escapeHtml(e.message||'오류가 발생했어요')}</div>`}
}

function escapeHtml(str){return String(str||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function getQANaturalText(i){return A.qaNatural[i] || (document.getElementById(`nat${i}`)?.textContent||'').trim();}
function playQANatural(i){
  const text=getQANaturalText(i);
  if(!text){alert('먼저 AI 피드백을 받아주세요');return;}
  playOpenAITTS(text,`qps${i}`);
}
async function toggleQAPronRec(i){
  const btn=document.getElementById(`qpr${i}`);
  if(!A.qaPronOn[i]){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      A.qaPronRecs[i]=new MediaRecorder(stream); const chunks=[];
      A.qaPronRecs[i].ondataavailable=e=>chunks.push(e.data);
      A.qaPronRecs[i].onstop=()=>{
        A.qaPronBlobs[i]=new Blob(chunks,{type:'audio/webm'});
        A.qaPronUrls[i]=URL.createObjectURL(A.qaPronBlobs[i]);
        document.getElementById(`qpp${i}`)?.classList.remove('hidden');
        document.getElementById(`qpfb${i}`)?.classList.remove('hidden');
        const st=document.getElementById(`qps${i}`); if(st)st.textContent='녹음 완료. 발음 피드백을 눌러주세요.';
        stream.getTracks().forEach(t=>t.stop());
      };
      A.qaPronRecs[i].start(); A.qaPronOn[i]=true; A.qaPronBlobs[i]=null;
      btn.classList.add('on'); btn.innerHTML='<span class="dot"></span>녹음 중지';
      const st=document.getElementById(`qps${i}`); if(st)st.textContent='녹음 중...';
    }catch(e){alert('마이크 권한이 필요해요')}
  }else{
    A.qaPronRecs[i].stop(); A.qaPronOn[i]=false;
    btn.classList.remove('on'); btn.innerHTML='<i class="ti ti-microphone"></i>따라 읽고 녹음';
  }
}
function playQAPronRec(i){if(A.qaPronUrls[i])new Audio(A.qaPronUrls[i]).play()}
async function analyzeQAPron(i){
  const target=getQANaturalText(i);
  if(!target){alert('먼저 AI 피드백을 받아주세요');return;}
  if(!A.qaPronBlobs[i]){alert('먼저 따라 읽고 녹음해주세요');return;}
  const box=document.getElementById(`qpronfb${i}`);
  box.innerHTML='<div class="loading"><div class="spin"></div>음성 인식 및 발음 피드백 작성 중...</div>';
  try{
    const transcript=await transcribeAudio(A.qaPronBlobs[i]);
    const result=await openaiText(`You are an English pronunciation and intonation coach for a Korean learner.
Compare the target sentence and the learner transcript. Give concise feedback in Korean.

Target sentence:
${target}

Learner transcript from speech recognition:
${transcript}

Return this format only:
점수: 0-100
인식된 문장: ...
잘한 점: ...
교정 포인트: ...
억양/리듬: ...
다시 연습할 부분: ...`);
    box.innerHTML=`<div class="fb-box fb-good">${result.replace(/\n/g,'<br>')}</div>`;
    addLog('qa',`Q${i+1} 발음 피드백 완료`);
  }catch(e){box.innerHTML=`<div class="fb-box fb-imp">발음 피드백 오류: ${escapeHtml(e.message||'오류가 발생했어요')}</div>`}
}

// ── QUIZ ──
async function genQuiz(){
  const pt=A.passages.map(p=>p.text).join('\n---\n');
  const at=Object.entries(A.answers).filter(([,v])=>v&&v.trim()).map(([k,v])=>`Q${+k+1}: ${v}`).join('\n');
  if(!pt&&!at){alert('지문이나 작성한 답변이 있어야 퀴즈를 만들 수 있어요');return}
  show('qz-load'); hide('qz-empty'); hide('qz-list'); hide('qz-submit'); hide('qz-result');
  A.quizItems=[];
  try{
    const raw=await openaiText(`다음 영어 자료로 복습 퀴즈 10개 만들어줘.\n\n지문:\n${pt||'없음'}\n\n내 답변:\n${at||'없음'}\n\n유형 2가지 랜덤 혼합:\n1. translate: 영어문장을 한국어로 주고 영작\n2. fillblank: 영어문장에서 핵심단어를 _____로 빈칸 (hint 필드에 빈칸 단어의 한글 뜻을 넣어줘)\n\nJSON 배열만, 다른 텍스트 없이:\n[{"type":"translate","question":"한국어 문장","answer":"English answer","hint":""},{"type":"fillblank","question":"Sentence with _____ here.","answer":"missing word","hint":"힌트: 빠지다, 없어지다"}]\n정확히 10개.`);
    A.quizItems=JSON.parse(raw.replace(/```json|```/g,'').trim());
    renderQuiz(); addLog('quiz','퀴즈 시작');
  }catch(e){alert('퀴즈 생성 오류: '+e.message);show('qz-empty')}
  hide('qz-load');
}
function renderQuiz(){
  if(!A.quizItems.length)return;
  document.getElementById('qz-list').innerHTML=A.quizItems.map((it,i)=>`
    <div class="qz-item">
      <div class="qz-meta"><span class="badge ${it.type==='translate'?'b-blue':'b-teal'}">${it.type==='translate'?'한→영 번역':'빈칸 채우기'}</span>${i+1}/10</div>
      <div class="qz-q">${it.question}</div>
      ${it.type==='fillblank'&&it.hint?`<div style="font-size:12px;color:var(--amber);background:var(--amber1);border-radius:6px;padding:5px 10px;margin-bottom:8px;display:inline-block">💡 ${it.hint}</div>`:''}
      <input class="qz-inp" id="qi${i}" type="text" placeholder="${it.type==='translate'?'영어로 번역하세요...':'빈칸에 들어갈 단어나 표현을 쓰세요...'}">
      <div class="qz-fb" id="qf${i}"></div>
    </div>`).join('');
  show('qz-list'); show('qz-submit');
}
async function submitQuiz(){
  show('qz-load'); hide('qz-submit');
  let score=0;
  for(let i=0;i<A.quizItems.length;i++){
    const inp=(document.getElementById(`qi${i}`).value||'').trim();
    const ans=A.quizItems[i].answer;
    if(!inp){
      document.getElementById(`qi${i}`).classList.add('no');
      document.getElementById(`qf${i}`).innerHTML=`<span class="qz-fb no">✗ 정답: ${ans}</span>`;
      continue;
    }
    try{
      const r=await openaiText(`채점: 정답="${ans}", 학생답변="${inp}". 의미가 같거나 충분하면 "correct", 아니면 "wrong"만.`);
      const ok=r.trim().toLowerCase().includes('correct');
      if(ok)score++;
      const el=document.getElementById(`qi${i}`);
      el.classList.add(ok?'ok':'no'); el.disabled=true;
      document.getElementById(`qf${i}`).innerHTML=ok?`<span class="qz-fb ok">✓ 정답!</span>`:`<span class="qz-fb no">✗ 정답: ${ans}</span>`;
    }catch(e){}
  }
  hide('qz-load');
  const pct=Math.round(score/A.quizItems.length*100);
  document.getElementById('sc-num').textContent=`${score} / 10`;
  const msg=pct>=90?'🎉 완벽해요!':pct>=70?'👍 잘했어요!':pct>=50?'💪 조금만 더!':'📖 다시 복습해봐요';
  document.getElementById('sc-txt').textContent=`정답률 ${pct}% · ${msg}`;
  document.getElementById('sc-bar').style.width=pct+'%';
  show('qz-result');
  document.getElementById('qz-result').scrollIntoView({behavior:'smooth',block:'center'});
  addLog('quiz',`${score}/10 (${pct}%)`);
  updateStats();
}

// ── HELPERS ──
function show(id){document.getElementById(id).classList.remove('hidden')}
function hide(id){document.getElementById(id).classList.add('hidden')}

// ── INIT ──
const savedKey=getKey();
if(savedKey){
  document.getElementById('key-inp').value=savedKey;
  setKeyMsg('✓ OpenAI API 키가 저장되어 있어요','var(--green)');
  document.getElementById('key-card').classList.add('ok');
}
renderCal(); updateStats(); renderPassages(); renderQA();

// ── PWA SERVICE WORKER ──
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}
