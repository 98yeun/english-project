const $ = (id)=>document.getElementById(id);
const todayKey = () => new Date().toISOString().slice(0,10);
let state = JSON.parse(localStorage.getItem("cec_state") || "{}");
let recorder, audioChunks = [];
let currentShadowSentence = "";

function saveState(){ localStorage.setItem("cec_state", JSON.stringify(state)); renderCalendar(); renderTodayLog(); }
function apiKey(){ return localStorage.getItem("openai_api_key") || ""; }
function setStatus(id,msg){ $(id).textContent = msg || ""; }
function log(type,text){ state.logs ||= {}; state.logs[todayKey()] ||= []; state.logs[todayKey()].push(`[${type}] ${text}`); saveState(); }

document.addEventListener("DOMContentLoaded", ()=>{
  $("apiKeyInput").value = apiKey();
  if(apiKey()) $("keyStatus").classList.remove("hidden");
  $("saveKeyBtn").onclick = ()=>{ localStorage.setItem("openai_api_key",$("apiKeyInput").value.trim()); $("keyStatus").classList.remove("hidden"); };

  document.querySelectorAll(".bottom-nav button").forEach(btn=>{
    btn.onclick=()=>switchTab(btn.dataset.tab);
  });

  $("shadowFile").onchange = e => handleFileSelected(e.target.files[0], "shadow");
  $("qaFile").onchange = e => handleFileSelected(e.target.files[0], "qa");
  $("extractShadowBtn").onclick = extractShadowText;
  $("saveShadowBtn").onclick = saveShadowText;
  $("splitSentencesBtn").onclick = splitSentences;
  $("playAllBtn").onclick = playAllSentences;
  $("recordShadowBtn").onclick = startShadowRecording;
  $("stopShadowBtn").onclick = stopShadowRecording;

  $("extractQuestionsBtn").onclick = extractQuestions;
  $("makeQuestionCardsBtn").onclick = makeQuestionCards;
  $("generateQuizBtn").onclick = generateQuiz;

  $("shadowText").value = state.shadowText || "";
  renderCalendar(); renderTodayLog(); splitSentences(false);
  if(state.questions) renderQuestions(state.questions);
});

function switchTab(tab){
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
  $(`tab-${tab}`).classList.add("active");
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
}

function renderCalendar(){
  const cal=$("calendar"); cal.innerHTML="";
  const d=new Date(); const y=d.getFullYear(), m=d.getMonth();
  const days=new Date(y,m+1,0).getDate();
  for(let i=1;i<=days;i++){
    const key=`${y}-${String(m+1).padStart(2,"0")}-${String(i).padStart(2,"0")}`;
    const div=document.createElement("div"); div.className="day"+(state.logs?.[key]?.length?" done":""); div.textContent=i;
    div.onclick=()=>{ $("todayLog").textContent=(state.logs?.[key]||["기록 없음"]).join("\n"); };
    cal.appendChild(div);
  }
}
function renderTodayLog(){
  const arr=state.logs?.[todayKey()] || [];
  $("todayLog").textContent = arr.length ? arr.join("\n") : "아직 기록이 없어요.";
  $("todayLog").classList.toggle("empty", !arr.length);
}

async function openaiChat(messages, opts={}){
  if(!apiKey()) throw new Error("OpenAI API 키를 먼저 저장하세요.");
  const res = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${apiKey()}` },
    body:JSON.stringify({ model: opts.model || "gpt-4.1-mini", messages, temperature: opts.temperature ?? 0.3 })
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error?.message || "OpenAI API 오류");
  return data.choices?.[0]?.message?.content || "";
}

async function openaiTTS(text){
  if(!apiKey()) throw new Error("OpenAI API 키를 먼저 저장하세요.");
  const res = await fetch("https://api.openai.com/v1/audio/speech",{
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${apiKey()}` },
    body:JSON.stringify({ model:"gpt-4o-mini-tts", voice:"alloy", input:text, speed:0.92 })
  });
  if(!res.ok){ const t=await res.text(); throw new Error(t); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await audio.play();
}

async function transcribeAudio(blob){
  if(!apiKey()) throw new Error("OpenAI API 키를 먼저 저장하세요.");
  const fd = new FormData();
  fd.append("file", blob, "recording.webm");
  fd.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions",{
    method:"POST",
    headers:{ "Authorization":`Bearer ${apiKey()}` },
    body:fd
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data.error?.message || "음성인식 오류");
  return data.text || "";
}

async function handleFileSelected(file, target){
  if(!file) return;
  const statusId = target==="shadow" ? "shadowStatus" : "qaStatus";
  setStatus(statusId, `${file.name} 선택됨`);
  if(file.type.startsWith("text/")){
    const txt = await file.text();
    if(target==="shadow") $("shadowText").value = txt;
    else $("questionRaw").value = txt;
  } else if(file.type === "application/pdf"){
    setStatus(statusId, "PDF는 브라우저에서 직접 읽기 제한이 있을 수 있어요. 텍스트 복사가 가능하면 텍스트를 붙여넣는 방식이 가장 안정적입니다.");
  }
}

async function imageToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractTextFromImage(file, purpose){
  const dataUrl = await imageToDataUrl(file);
  return await openaiChat([{
    role:"user",
    content:[
      {type:"text", text: purpose==="question" ? "이미지에서 영어 질문만 번호별로 추출해줘. 설명 없이 질문만 한 줄씩." : "이미지에서 영어 지문 텍스트를 빠짐없이 추출해줘. 설명 없이 텍스트만."},
      {type:"image_url", image_url:{url:dataUrl}}
    ]
  }]);
}

async function extractShadowText(){
  try{
    const file = $("shadowFile").files[0];
    if(!file){ setStatus("shadowStatus","파일을 먼저 선택하세요."); return; }
    setStatus("shadowStatus","GPT가 텍스트를 추출 중...");
    let txt = "";
    if(file.type.startsWith("image/")) txt = await extractTextFromImage(file, "shadow");
    else txt = await file.text();
    $("shadowText").value = txt.trim();
    setStatus("shadowStatus","추출 완료");
    log("쉐도잉", "지문 텍스트 추출");
  }catch(e){ setStatus("shadowStatus","오류: "+e.message); }
}
function saveShadowText(){
  state.shadowText = $("shadowText").value.trim();
  saveState(); splitSentences(); log("쉐도잉","지문 저장");
  setStatus("shadowStatus","저장 완료");
}
function splitSentences(show=true){
  const text = $("shadowText").value.trim() || state.shadowText || "";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s=>s.trim()).filter(Boolean) || [];
  const list=$("sentenceList"); list.innerHTML="";
  sentences.forEach((s,i)=>{
    const div=document.createElement("div"); div.className="sentence"; div.textContent=s;
    div.onclick=()=>{ currentShadowSentence=s; document.querySelectorAll(".sentence").forEach(x=>x.classList.remove("active")); div.classList.add("active"); };
    const b=document.createElement("button"); b.textContent="듣기"; b.style.marginTop="8px"; b.onclick=(ev)=>{ ev.stopPropagation(); currentShadowSentence=s; openaiTTS(s).catch(err=>alert(err.message)); };
    div.appendChild(document.createElement("br")); div.appendChild(b); list.appendChild(div);
  });
  if(show && !sentences.length) alert("지문을 먼저 입력하세요.");
}
async function playAllSentences(){
  const text = $("shadowText").value.trim();
  if(!text) return alert("지문을 먼저 입력하세요.");
  await openaiTTS(text);
}

async function startRecording(){
  const stream = await navigator.mediaDevices.getUserMedia({audio:true});
  audioChunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = e => audioChunks.push(e.data);
  recorder.start();
}
async function startShadowRecording(){
  try{
    if(!currentShadowSentence) currentShadowSentence = $("shadowText").value.trim().split(/[.!?]/)[0] || "";
    if(!currentShadowSentence) return alert("먼저 문장을 선택하세요.");
    await startRecording();
    $("recordShadowBtn").disabled=true; $("stopShadowBtn").disabled=false;
  }catch(e){ alert("마이크 권한이 필요합니다: "+e.message); }
}
async function stopShadowRecording(){
  return new Promise(resolve=>{
    recorder.onstop = async ()=>{
      try{
        $("recordShadowBtn").disabled=false; $("stopShadowBtn").disabled=true;
        const blob = new Blob(audioChunks,{type:"audio/webm"});
        $("shadowFeedback").classList.remove("hidden");
        $("shadowFeedback").textContent = "음성 인식 및 발음 피드백 생성 중...";
        const transcript = await transcribeAudio(blob);
        const feedback = await pronunciationFeedback(currentShadowSentence, transcript);
        $("shadowFeedback").textContent = `인식된 문장:\n${transcript}\n\n${feedback}`;
        log("발음피드백", currentShadowSentence.slice(0,80));
        resolve();
      }catch(e){ $("shadowFeedback").textContent = "오류: "+e.message; }
    };
    recorder.stop();
  });
}

async function pronunciationFeedback(target, transcript){
  return await openaiChat([
    {role:"system", content:"You are an English pronunciation coach for a Korean learner. Give concise Korean feedback. Include pronunciation score out of 100, misheard words, rhythm/intonation feedback, and one clear practice tip."},
    {role:"user", content:`Target sentence:\n${target}\n\nLearner transcription:\n${transcript}`}
  ]);
}

async function extractQuestions(){
  try{
    const file=$("qaFile").files[0];
    setStatus("qaStatus","질문 추출 중...");
    let txt = $("questionRaw").value.trim();
    if(file){
      if(file.type.startsWith("image/")) txt = await extractTextFromImage(file, "question");
      else txt = await file.text();
    }
    $("questionRaw").value = txt;
    setStatus("qaStatus","질문 추출 완료");
  }catch(e){ setStatus("qaStatus","오류: "+e.message); }
}
function makeQuestionCards(){
  const qs = $("questionRaw").value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  state.questions = qs; saveState(); renderQuestions(qs); log("문제답변", `${qs.length}개 문제 생성`);
}
function renderQuestions(qs){
  const box=$("qaList"); box.innerHTML="";
  qs.forEach((q,i)=>{
    const card=document.createElement("div"); card.className="qa-card";
    card.innerHTML = `
      <div><span class="q-label">Q${i+1}</span><strong>${escapeHtml(q)}</strong></div>
      <textarea id="ans_${i}" placeholder="Write your answer in English...">${state.answers?.[i]?.answer || ""}</textarea>
      <div class="btn-grid">
        <button onclick="getAnswerFeedback(${i})">AI 피드백</button>
        <button onclick="playNatural(${i})">문장 듣기</button>
        <button onclick="recordQA(${i})">녹음 시작</button>
        <button onclick="stopQA(${i})" id="stopQA_${i}" disabled>녹음 종료</button>
      </div>
      <div id="fb_${i}" class="feedback ${state.answers?.[i]?.feedback ? "" : "hidden"}">${state.answers?.[i]?.feedback || ""}</div>
    `;
    box.appendChild(card);
  });
}
async function getAnswerFeedback(i){
  try{
    const q=state.questions[i]; const answer=$(`ans_${i}`).value.trim();
    if(!answer) return alert("답변을 먼저 작성하세요.");
    $(`fb_${i}`).classList.remove("hidden"); $(`fb_${i}`).textContent="GPT 피드백 생성 중...";
    const fb = await openaiChat([
      {role:"system", content:"You are a friendly but precise English writing coach for a Korean learner. Reply in Korean. Format: 잘된 점, 개선점, 더 자연스러운 표현. The natural expression must be one clear English answer sentence or short paragraph."},
      {role:"user", content:`Question: ${q}\nLearner answer: ${answer}`}
    ]);
    state.answers ||= {}; state.answers[i] = {answer, feedback:fb, natural:extractNatural(fb) || answer};
    saveState(); $(`fb_${i}`).textContent=fb; log("AI피드백", q.slice(0,80));
  }catch(e){ $(`fb_${i}`).textContent="오류: "+e.message; }
}
function extractNatural(fb){
  const lines = fb.split("\n").map(x=>x.trim()).filter(Boolean);
  const idx = lines.findIndex(x=>x.includes("자연") || x.toLowerCase().includes("natural"));
  if(idx>=0) return lines.slice(idx+1).join(" ").replace(/^[-:"'\s]+/,"").trim();
  return "";
}
async function playNatural(i){
  const txt = state.answers?.[i]?.natural || state.answers?.[i]?.answer || $(`ans_${i}`).value.trim();
  if(!txt) return alert("먼저 AI 피드백을 받거나 답변을 입력하세요.");
  await openaiTTS(txt);
}
async function recordQA(i){
  try{
    await startRecording(); window.currentQAIndex=i;
    document.querySelectorAll("[id^='stopQA_']").forEach(b=>b.disabled=true);
    $(`stopQA_${i}`).disabled=false;
  }catch(e){ alert("마이크 권한이 필요합니다: "+e.message); }
}
async function stopQA(i){
  recorder.onstop = async ()=>{
    const target = state.answers?.[i]?.natural || state.answers?.[i]?.answer || $(`ans_${i}`).value.trim();
    const fbDiv=$(`fb_${i}`); fbDiv.classList.remove("hidden"); fbDiv.textContent += "\n\n발음 피드백 생성 중...";
    try{
      const blob = new Blob(audioChunks,{type:"audio/webm"});
      const transcript = await transcribeAudio(blob);
      const pfb = await pronunciationFeedback(target, transcript);
      fbDiv.textContent += `\n\n[발음 피드백]\n인식된 문장: ${transcript}\n\n${pfb}`;
      log("문제답변 발음", state.questions[i].slice(0,80));
    }catch(e){ fbDiv.textContent += "\n오류: "+e.message; }
    $(`stopQA_${i}`).disabled=true;
  };
  recorder.stop();
}

async function generateQuiz(){
  try{
    const source = [
      state.shadowText || "",
      JSON.stringify(state.questions || []),
      JSON.stringify(state.answers || {})
    ].join("\n");
    if(!source.trim()) return alert("쉐도잉 지문이나 문제답변 기록이 필요해요.");
    $("quizList").innerHTML = "<div class='status'>GPT가 퀴즈 생성 중...</div>";
    const quiz = await openaiChat([
      {role:"system", content:"Create 5 short English learning quiz questions based on the learner's materials. Include answers. Reply in Korean and English mixed, concise."},
      {role:"user", content:source.slice(0,12000)}
    ]);
    $("quizList").innerHTML = `<div class="quiz-item">${escapeHtml(quiz).replace(/\n/g,"<br>")}</div>`;
    log("퀴즈","GPT 퀴즈 생성");
  }catch(e){ $("quizList").innerHTML = `<div class="feedback">오류: ${escapeHtml(e.message)}</div>`; }
}
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
