
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let profile=null,currentPath="",selected=null,csrf=null,passwordNeedsReview=false,driveParentId=null,driveStack=[],driveSelected=null;

const api=async(url,opt={})=>{
  const headers={...(opt.headers||{})};
  if(!(opt.body instanceof FormData)) headers["Content-Type"]="application/json";
  if(csrf && opt.method && !["GET","HEAD"].includes(opt.method.toUpperCase())) headers["X-CSRF-Token"]=csrf;
  const r=await fetch(url,{...opt,headers});
  const txt=await r.text(); let data={}; try{data=txt?JSON.parse(txt):{}}catch{data=txt}
  if(r.status===401){ $("#app")?.classList.add("hidden"); $("#login")?.classList.remove("hidden"); }
  if(!r.ok) throw new Error(data?.error||"Error");
  return data;
};
const toast=t=>{const el=$("#toast");el.textContent=t;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2300)}
const status=t=>$("#statusText").textContent=t;
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const human=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(1)} GB`;
const baseName=p=>p.split("/").pop();

function faceState(type,ms=1100){
  const map={search:["⌕","Buscando"],folder:["▦","Organizando"],memory:["✦","Guardando"],trash:["⌫","Moviendo"],zip:["◫","Comprimiendo"],rename:["✎","Renombrando"],upload:["↑","Guardando"],think:["◌","Pensando"]};
  const [ic,label]=map[type]||["✦","Pensando"];
  $("#orbIcon").textContent=ic;$("#orb").classList.add("mode");status(label);
  setTimeout(()=>{$("#orb").classList.remove("mode");status("Listo")},ms);
}
function speak(t){
  if(!t)return;$("#speech").textContent=t;
  if(profile && profile.voiceEnabled===false)return;
  if(!("speechSynthesis" in window))return;
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang="es-ES";u.rate=.96;
  u.onstart=()=>{$("#orb").classList.add("talking");status("Hablando")};
  u.onend=()=>{$("#orb").classList.remove("talking");status("Listo")};
  u.onerror=()=>{$("#orb").classList.remove("talking");status("Listo")};
  speechSynthesis.speak(u);
}
$("#speakBtn").onclick=()=>speak($("#speakText").value||"Estoy aquí.");

function showSheet(html){
  $("#sheetBody").innerHTML=html;$("#sheetBackdrop").classList.remove("hidden");
  setTimeout(()=>$("#sheetBody input, #sheetBody textarea, #sheetBody select")?.focus(),60);
}
function closeSheet(){ $("#sheetBackdrop").classList.add("hidden"); $("#sheetBody").innerHTML=""; }
$("#sheetBackdrop").addEventListener("click",e=>{if(e.target===$("#sheetBackdrop"))closeSheet()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeSheet();$("#contextMenu").classList.add("hidden")}});
function progress(title,text="Cerebro está trabajando con tus archivos."){
  $("#progressTitle").textContent=title;$("#progressText").textContent=text;$("#progressOverlay").classList.remove("hidden");
}
function endProgress(){ $("#progressOverlay").classList.add("hidden"); }

async function boot(){
  const s=await api("/api/session"); csrf=s.csrf||null; passwordNeedsReview=!!s.passwordNeedsReview;
  if(!s.authenticated)return;
  $("#login").classList.add("hidden");
  if(s.onboarding){$("#onboarding").classList.remove("hidden");return}
  profile=s.profile;startApp();
}
$("#loginBtn").onclick=async()=>{
  try{
    const d=await api("/api/login",{method:"POST",body:JSON.stringify({password:$("#password").value})});csrf=d.csrf;
    $("#login").classList.add("hidden"); const s=await api("/api/session");csrf=s.csrf;passwordNeedsReview=!!s.passwordNeedsReview;
    if(s.onboarding)$("#onboarding").classList.remove("hidden");else{profile=s.profile;startApp()}
  }catch(e){$("#loginMsg").textContent=e.message}
};
$("#password").onkeydown=e=>{if(e.key==="Enter")$("#loginBtn").click()};

$("#saveOnboarding").onclick=async()=>{
  profile=await api("/api/profile",{method:"POST",body:JSON.stringify({
    name:$("#obName").value.trim()||"Usuario",callName:$("#obCall").value.trim()||$("#obName").value.trim()||"Usuario",
    brainName:$("#obBrain").value.trim()||"Cerebro",personality:$("#obPersonality").value,style:$("#obStyle").value.trim()
  })});
  $("#onboarding").classList.add("hidden");startApp();speak(`Encantado, ${profile.callName}. Ya estoy listo.`);
};
function startApp(){
  $("#app").classList.remove("hidden");$("#hello").textContent=`Hola, ${profile.callName||profile.name}.`;$("#brainName").textContent=profile.brainName||"Cerebro";
  $("#setName").value=profile.name||"";$("#setCall").value=profile.callName||"";$("#setBrain").value=profile.brainName||"";$("#setStyle").value=profile.style||"";
  $("#setVoice").checked=profile.voiceEnabled!==false;$("#setMotion").checked=!!profile.reduceMotion;
  $("#accountName").textContent=profile.callName||profile.name||"Usuario";
  $("#avatarLetter").textContent=(profile.callName||profile.name||"U").trim().charAt(0).toUpperCase();
  $("#passwordReview").classList.toggle("hidden",!passwordNeedsReview);
  document.documentElement.classList.toggle("reduce-motion",!!profile.reduceMotion);
  loadFiles();loadMemory();loadTrash();
}
function switchView(name){
  $$(".view").forEach(v=>v.classList.add("hidden"));$(`#view-${name}`).classList.remove("hidden");
  $$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="files")loadFiles();if(name==="drive")loadDrive();if(name==="memory")loadMemory();if(name==="trash")loadTrash();if(name==="activity")loadJournal();
}
window.switchView=switchView;$$("[data-view]").forEach(b=>b.onclick=()=>switchView(b.dataset.view));

async function loadFiles(){
  const d=await api(`/api/files?path=${encodeURIComponent(currentPath)}`);
  $("#crumb").textContent=currentPath?`Archivo / ${currentPath}`:"Archivo";
  $("#fileGrid").innerHTML=d.items.length?d.items.map(x=>`
    <div class="file-card" tabindex="0" data-path="${esc(x.path)}" data-kind="${x.kind}">
      <div class="ico">${x.kind==="folder"?"▦":fileIcon(x.ext)}</div><b>${esc(x.name)}</b>
      <small>${x.kind==="folder"?"Carpeta":human(x.size)}</small>
    </div>`).join(""):`<div style="color:#7f8a9b;padding:24px">Esta carpeta está vacía.</div>`;
  $$(".file-card").forEach(card=>{
    card.onclick=()=>{$$(".file-card").forEach(x=>x.classList.remove("selected"));card.classList.add("selected");selected={path:card.dataset.path,kind:card.dataset.kind}};
    card.ondblclick=()=>{if(card.dataset.kind==="folder"){currentPath=card.dataset.path;loadFiles()}else location.href=`/api/download?path=${encodeURIComponent(card.dataset.path)}`};
    card.oncontextmenu=e=>{e.preventDefault();showContext(e.clientX,e.clientY,card.dataset.path,card.dataset.kind)}
  });
}
function fileIcon(ext){
  if(["png","jpg","jpeg","gif","webp","tif","tiff","svg"].includes(ext))return "▧";
  if(["psd","ai","indd","eps"].includes(ext))return "◆";
  if(["pdf"].includes(ext))return "▤";
  if(["zip","rar","7z"].includes(ext))return "◫";
  return "◧";
}
$("#refreshBtn").onclick=loadFiles;
$("#upBtn").onclick=()=>{if(!currentPath)return;const p=currentPath.split("/");p.pop();currentPath=p.join("/");loadFiles()};

$("#newFolderBtn").onclick=()=>showSheet(`
  <div class="eyebrow">NUEVA CARPETA</div><h3>Crear carpeta</h3><p>Se creará dentro de <b>${esc(currentPath||"Archivo")}</b>.</p>
  <input id="sheetName" placeholder="Nombre de la carpeta">
  <div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="createFolder()">Crear</button></div>`);
window.closeSheet=closeSheet;
window.createFolder=async()=>{
  const name=$("#sheetName").value.trim();if(!name)return;
  try{await api("/api/folders",{method:"POST",body:JSON.stringify({path:currentPath,name})});closeSheet();faceState("folder");toast("Carpeta creada");loadFiles()}catch(e){toast(e.message)}
};

$("#newProjectBtn").onclick=()=>showSheet(`
  <div class="eyebrow">NUEVO PROYECTO</div><h3>Crear estructura profesional</h3>
  <p>Cerebro creará las carpetas de administración, referencias, bocetos, originales, recursos, versiones, exportaciones, entrega y archivo.</p>
  <input id="prName" placeholder="Nombre del proyecto">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"><input id="prCode" placeholder="Código, ej. GC26"><select id="prType"><option>Ilustracion</option><option>Branding</option><option>Editorial</option><option>Publicidad</option><option>Web-UI</option><option>Animacion</option><option>Fotografia</option><option>Video</option></select></div>
  <input id="prClient" placeholder="Cliente / Personal" style="margin-top:8px">
  <div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="createProject()">Crear proyecto</button></div>`);
window.createProject=async()=>{
  const name=$("#prName").value.trim();if(!name)return;
  progress("Creando proyecto","Preparando una estructura limpia y reutilizable.");
  try{
    const d=await api("/api/projects",{method:"POST",body:JSON.stringify({path:currentPath,name,code:$("#prCode").value||"PRJ",type:$("#prType").value,client:$("#prClient").value||"Personal"})});
    closeSheet();currentPath=d.path;await loadFiles();faceState("folder");toast("Proyecto creado");speak(`Proyecto ${name} preparado.`);
  }catch(e){toast(e.message)}finally{endProgress()}
};

async function uploadFiles(files){
  if(!files.length)return;progress("Guardando archivos",`${files.length} elemento(s) hacia ${currentPath||"Archivo"}.`);faceState("upload",1800);
  const fd=new FormData();fd.append("path",currentPath);files.forEach(f=>fd.append("files",f));
  try{
    const r=await fetch("/api/upload",{method:"POST",headers:{"X-CSRF-Token":csrf},body:fd});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"Error");
    toast(`${d.saved.length} archivo(s) guardados`);await loadFiles();
  }catch(e){toast(e.message)}finally{endProgress()}
}
$("#uploadInput").onchange=e=>uploadFiles([...e.target.files]);
const dz=$("#dropzone");
["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag")}));
dz.addEventListener("drop",e=>uploadFiles([...e.dataTransfer.files]));

function showContext(x,y,p,kind){
  selected={path:p,kind};const m=$("#contextMenu");m.innerHTML=`
    ${kind==="folder"?`<button onclick="ctxOpen()">Abrir</button><button onclick="ctxArchive()">Comprimir y archivar…</button><button onclick="ctxProfessionalRename()">Renombrado profesional…</button>`:`<button onclick="ctxDownload()">Dar / descargar</button>`}
    <button onclick="ctxRename()">Renombrar…</button><button onclick="ctxMove()">Mover…</button><button class="danger" onclick="ctxTrash()">Mover a papelera…</button>`;
  m.style.left=Math.min(x,innerWidth-230)+"px";m.style.top=Math.min(y,innerHeight-280)+"px";m.classList.remove("hidden");
}
document.addEventListener("click",e=>{if(!e.target.closest("#contextMenu"))$("#contextMenu").classList.add("hidden")});
window.ctxOpen=()=>{currentPath=selected.path;loadFiles()};
window.ctxDownload=()=>location.href=`/api/download?path=${encodeURIComponent(selected.path)}`;
window.ctxRename=()=>{
  showSheet(`<div class="eyebrow">RENOMBRAR</div><h3>${esc(baseName(selected.path))}</h3><input id="renameValue" value="${esc(baseName(selected.path))}">
  <div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="applyRename()">Renombrar</button></div>`)
};
window.applyRename=async()=>{try{await api("/api/rename",{method:"POST",body:JSON.stringify({path:selected.path,newName:$("#renameValue").value})});closeSheet();faceState("rename");toast("Renombrado");loadFiles()}catch(e){toast(e.message)}};
window.ctxMove=()=>{
  showSheet(`<div class="eyebrow">MOVER</div><h3>Mover ${esc(baseName(selected.path))}</h3><p>Escribe la ruta de destino dentro de Archivo.</p><input id="moveDest" value="${esc(currentPath)}" placeholder="Ej. Clientes/Grupo Colon">
  <div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="applyMove()">Mover</button></div>`)
};
window.applyMove=async()=>{try{await api("/api/move",{method:"POST",body:JSON.stringify({path:selected.path,destination:$("#moveDest").value})});closeSheet();faceState("folder");toast("Movido");loadFiles()}catch(e){toast(e.message)}};
window.ctxTrash=()=>showSheet(`<div class="eyebrow">PAPELERA</div><h3>Mover a papelera</h3><p><b>${esc(baseName(selected.path))}</b> dejará de aparecer aquí, pero podrás recuperarlo desde Papelera.</p>
<div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="danger" onclick="applyTrash()">Mover a papelera</button></div>`);
window.applyTrash=async()=>{try{await api("/api/trash",{method:"POST",body:JSON.stringify({path:selected.path})});closeSheet();faceState("trash");toast("En papelera");loadFiles();loadTrash()}catch(e){toast(e.message)}};

window.ctxArchive=()=>showSheet(`<div class="eyebrow">ARCHIVAR PROYECTO</div><h3>${esc(baseName(selected.path))}</h3><p>Crearé un ZIP de archivo y calcularé una huella SHA-256 para comprobar su integridad.</p>
<div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="applyArchive()">Crear archivo ZIP</button></div>`);
window.applyArchive=async()=>{
  progress("Comprimiendo proyecto","Esto puede tardar si el proyecto contiene muchos originales.");
  try{
    const r=await fetch("/api/archive",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf},body:JSON.stringify({path:selected.path})});
    if(!r.ok){const d=await r.json();throw new Error(d.error)}
    const sha=r.headers.get("X-Cerebro-SHA256")||"";const blob=await r.blob();
    const cd=r.headers.get("content-disposition")||"";const m=/filename="?([^";]+)"?/.exec(cd);const name=m?.[1]||"proyecto.zip";
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    closeSheet();faceState("zip");toast(`ZIP preparado · SHA ${sha.slice(0,10)}…`);
  }catch(e){toast(e.message)}finally{endProgress()}
};

window.ctxProfessionalRename=()=>showSheet(`<div class="eyebrow">RENOMBRADO PROFESIONAL</div><h3>Primero lo revisamos</h3><p>No cambiaré nada hasta enseñarte la previsualización.</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input id="rpCode" value="PRJ" placeholder="Código"><input id="rpType" value="ILUS" placeholder="Tipo"></div>
<div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="previewProfessionalRename()">Previsualizar</button></div>`);
window.previewProfessionalRename=async()=>{
  progress("Analizando nombres","Preparando el plan sin modificar tus archivos.");
  try{
    const d=await api("/api/rename-project/preview",{method:"POST",body:JSON.stringify({path:selected.path,code:$("#rpCode").value,type:$("#rpType").value})});
    endProgress();
    const rows=d.plan.length?d.plan.map(x=>`<div class="preview-row"><code>${esc(x.from)}</code><div class="arrow">→</div><code>${esc(x.to)}</code></div>`).join(""):`<p>No hace falta cambiar ningún archivo.</p>`;
    showSheet(`<div class="eyebrow">PREVISUALIZACIÓN</div><h3>${d.plan.length} cambio(s)</h3><p>Se guardará además un <b>RENAME_MANIFEST.json</b> con el mapa nombre anterior → nuevo.</p><div class="preview-list">${rows}</div>
    <div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button>${d.plan.length?`<button class="primary" onclick="applyProfessionalRename('${esc(d.code)}','${esc(d.type)}')">Aplicar cambios</button>`:""}</div>`);
  }catch(e){endProgress();toast(e.message)}
};
window.applyProfessionalRename=async(code,type)=>{
  progress("Renombrando con seguridad","Uso un proceso en dos fases para evitar colisiones y poder revertir si algo falla.");
  try{
    const d=await api("/api/rename-project/apply",{method:"POST",body:JSON.stringify({path:selected.path,code,type})});
    closeSheet();faceState("rename",1500);toast(`${d.changed.length} archivo(s) renombrados`);await loadFiles();
  }catch(e){toast(e.message)}finally{endProgress()}
};

$("#saveMemory").onclick=async()=>{
  const text=$("#memText").value.trim();if(!text)return;
  await api("/api/memory",{method:"POST",body:JSON.stringify({type:$("#memType").value,text,tags:$("#memTags").value.split(",").map(x=>x.trim()).filter(Boolean)})});
  $("#memText").value="";$("#memTags").value="";faceState("memory");loadMemory();speak("Guardado en mi memoria.");
};
async function loadMemory(){
  const arr=await api("/api/memory");
  $("#memoryList").innerHTML=arr.length?arr.map(x=>`<div class="item"><div class="item-row"><div><span class="tag">${esc(x.type)}</span>${(x.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}<div style="margin-top:8px">${esc(x.text)}</div></div><button onclick="deleteMemory('${x.id}')">Eliminar…</button></div></div>`).join(""):`<div style="color:#7f8a9b">Todavía no hay recuerdos.</div>`;
}
window.deleteMemory=id=>showSheet(`<div class="eyebrow">MEMORIA</div><h3>Eliminar recuerdo</h3><p>Esta acción elimina esta nota de la memoria del Cerebro.</p><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="danger" onclick="applyDeleteMemory('${id}')">Eliminar</button></div>`);
window.applyDeleteMemory=async id=>{await api(`/api/memory/${id}`,{method:"DELETE"});closeSheet();toast("Recuerdo eliminado");loadMemory()};

async function performSearch(q){
  if(!q)return;faceState("search",900);switchView("search");$("#searchInput").value=q;
  const d=await api(`/api/search?q=${encodeURIComponent(q)}`);
  const files=(d.files||[]).map(x=>`<div class="item"><div class="item-row"><div><span class="tag">${x.kind}</span><b>${esc(x.name)}</b><small style="display:block">${esc(x.path)}</small></div>${x.kind==="file"?`<button onclick="location.href='/api/download?path=${encodeURIComponent(x.path)}'">Dar</button>`:`<button onclick="openSearchFolder('${esc(x.path)}')">Abrir</button>`}</div></div>`).join("");
  const mem=(d.memory||[]).map(x=>`<div class="item"><span class="tag">${esc(x.type)}</span>${esc(x.text)}</div>`).join("");
  $("#searchResults").innerHTML=(files+mem)||`<div style="color:#7f8a9b">No he encontrado coincidencias.</div>`;
}
$("#searchBtn").onclick=()=>performSearch($("#searchInput").value.trim());
$("#searchInput").onkeydown=e=>{if(e.key==="Enter")$("#searchBtn").click()};
window.openSearchFolder=p=>{currentPath=p;switchView("files")};

async function loadTrash(){
  const arr=await api("/api/trash");
  $("#trashList").innerHTML=arr.length?arr.map(x=>`<div class="item"><div class="item-row"><div><span class="tag">${x.kind||"elemento"}</span><b>${esc(x.originalPath)}</b><small style="display:block">${new Date(x.trashedAt).toLocaleString()}</small></div><div><button onclick="restoreTrash('${x.id}')">Restaurar</button> <button onclick="askDeleteTrash('${x.id}','${esc(x.originalPath)}')">Borrar…</button></div></div></div>`).join(""):`<div style="color:#7f8a9b">Papelera vacía.</div>`;
}
window.restoreTrash=async id=>{try{await api("/api/trash/restore",{method:"POST",body:JSON.stringify({id})});toast("Restaurado");loadTrash();loadFiles()}catch(e){toast(e.message)}};
window.askDeleteTrash=(id,name)=>showSheet(`<div class="eyebrow">BORRADO DEFINITIVO</div><h3>Esto no se puede deshacer</h3><p><b>${name}</b> se eliminará de forma permanente.</p><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="danger" onclick="deleteTrash('${id}')">Borrar definitivamente</button></div>`);
window.deleteTrash=async id=>{try{await api("/api/trash/delete",{method:"POST",body:JSON.stringify({id})});closeSheet();toast("Eliminado definitivamente");loadTrash()}catch(e){toast(e.message)}};

async function loadJournal(){
  const arr=await api("/api/journal");
  $("#journalList").innerHTML=arr.length?arr.map(x=>`<div class="item"><div class="item-row"><div><b>${esc(actionLabel(x.action))}</b><small style="display:block">${new Date(x.at).toLocaleString()}</small></div><span class="tag">${esc(x.action)}</span></div></div>`).join(""):`<div style="color:#7f8a9b">Todavía no hay actividad.</div>`;
}
function actionLabel(a){return ({folder_created:"Carpeta creada",project_created:"Proyecto creado",files_uploaded:"Archivos guardados",renamed:"Elemento renombrado",moved:"Elemento movido",trashed:"Enviado a papelera",restored:"Restaurado",deleted_forever:"Borrado definitivo",batch_renamed:"Renombrado profesional",archived:"Proyecto archivado",memory_added:"Recuerdo guardado",memory_deleted:"Recuerdo eliminado",profile_updated:"Perfil actualizado",password_changed:"Contraseña cambiada",login_ok:"Acceso correcto",login_failed:"Intento de acceso fallido"})[a]||a}

$("#saveSettings").onclick=async()=>{
  profile=await api("/api/profile",{method:"POST",body:JSON.stringify({name:$("#setName").value,callName:$("#setCall").value,brainName:$("#setBrain").value,style:$("#setStyle").value,voiceEnabled:$("#setVoice").checked,reduceMotion:$("#setMotion").checked})});
  $("#hello").textContent=`Hola, ${profile.callName||profile.name}.`;$("#brainName").textContent=profile.brainName||"Cerebro";toast("Ajustes guardados");
};
$("#changePassword").onclick=async()=>{try{await api("/api/password",{method:"POST",body:JSON.stringify({password:$("#newPassword").value})});$("#newPassword").value="";passwordNeedsReview=false;$("#passwordReview").classList.add("hidden");toast("Contraseña actualizada")}catch(e){toast(e.message)}};

async function runCommand(raw){
  const cmd=raw.trim();if(!cmd)return;faceState("think",700);
  let m;
  if((m=cmd.match(/^(?:crea|crear)\s+(?:una\s+)?carpeta\s+(.+)$/i))){
    const name=m[1].trim();await api("/api/folders",{method:"POST",body:JSON.stringify({path:currentPath,name})});switchView("files");await loadFiles();toast(`Carpeta ${name} creada`);speak(`He creado la carpeta ${name}.`);return;
  }
  if((m=cmd.match(/^(?:busca|buscar|encuentra)\s+(.+)$/i))){await performSearch(m[1]);return}
  if((m=cmd.match(/^(?:guarda|guardar)\s+(?:una\s+)?(?:idea|nota)\s*:?\s*(.+)$/i))){
    await api("/api/memory",{method:"POST",body:JSON.stringify({type:/idea/i.test(cmd)?"idea":"nota",text:m[1],tags:[]})});await loadMemory();faceState("memory");toast("Guardado en memoria");speak("Lo guardo.");return;
  }
  speak("Todavía no ejecuto esa orden automáticamente. Puedes usar Archivos, Buscar o Memoria, y seguiré aprendiendo nuevas acciones.");
}
$("#commandBtn").onclick=()=>runCommand($("#commandInput").value).catch(e=>toast(e.message));
$("#commandInput").onkeydown=e=>{if(e.key==="Enter")$("#commandBtn").click()};

boot().catch(()=>{});


$("#downloadDiagnostics").onclick=async()=>{
  try{
    progress("Preparando diagnóstico","Recojo versión, estructura, actividad y estado general sin incluir tu contraseña.");
    const r=await fetch("/api/diagnostics/export");
    if(!r.ok) throw new Error("No se pudo crear el diagnóstico");
    const blob=await r.blob();
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="CEREBRO-DIAGNOSTICO-v3.0.0.json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    toast("Diagnóstico preparado");
  }catch(e){toast(e.message)}finally{endProgress()}
};

$("#accountChip").onclick=()=>switchView("settings");


async function driveStatus(){
  const s=await api("/api/cloud/drive/status");
  const card=$("#driveStatusCard");
  if(!s.configured){
    card.innerHTML=`<div class="cloud-user"><b>Google Drive aún no está preparado</b><small>El propietario de CEREBRO debe completar una configuración única.</small></div><span class="cloud-pill off">Sin configurar</span>`;
    $("#driveConnectBtn").textContent="Configurar Drive";
    return s;
  }
  if(!s.connected){
    card.innerHTML=`<div class="cloud-user"><b>Conecta tu Google Drive</b><small>Solo tendrás que elegir tu cuenta y aceptar.</small></div><span class="cloud-pill off">Desconectado</span>`;
    $("#driveConnectBtn").textContent="Conectar Drive";
    return s;
  }
  const q=s.storageQuota||{}, limit=Number(q.limit||0), usage=Number(q.usage||0);
  const usageText=limit?`${human(usage)} de ${human(limit)}`:(usage?human(usage):"");
  card.innerHTML=`<div class="cloud-user"><b>${esc(s.user?.displayName||"Google Drive")}</b><small>${esc(s.user?.emailAddress||"")} ${usageText?`· ${usageText}`:""}</small></div><span class="cloud-pill">● Conectado</span>`;
  $("#driveConnectBtn").textContent="Desconectar";
  if(!driveParentId) driveParentId=s.rootId;
  return s;
}

async function loadDrive(){
  try{
    const s=await driveStatus();
    if(!s.connected){$("#driveGrid").innerHTML="";return}
    const d=await api(`/api/cloud/drive/list${driveParentId?`?parentId=${encodeURIComponent(driveParentId)}`:""}`);
    driveParentId=d.parentId;
    $("#driveCrumb").textContent="Google Drive · CEREBRO"+(driveStack.length?" / "+driveStack.map(x=>x.name).join(" / "):"");
    $("#driveGrid").innerHTML=d.items.length?d.items.map(x=>`
      <div class="file-card" data-id="${esc(x.id)}" data-name="${esc(x.name)}" data-kind="${x.mimeType==="application/vnd.google-apps.folder"?"folder":"file"}">
        <div class="ico">${x.mimeType==="application/vnd.google-apps.folder"?"▦":"◧"}</div>
        <b>${esc(x.name)}</b><small>${x.mimeType==="application/vnd.google-apps.folder"?"Carpeta":human(Number(x.size||0))}</small>
      </div>`).join(""):`<div style="color:#7f8a9b;padding:24px">Tu carpeta CEREBRO de Drive está vacía.</div>`;
    $$("#driveGrid .file-card").forEach(card=>{
      card.onclick=()=>{$$("#driveGrid .file-card").forEach(x=>x.classList.remove("selected"));card.classList.add("selected");driveSelected={id:card.dataset.id,name:card.dataset.name,kind:card.dataset.kind}};
      card.ondblclick=()=>{if(card.dataset.kind==="folder"){driveStack.push({id:driveParentId,name:card.dataset.name});driveParentId=card.dataset.id;loadDrive()}else location.href=`/api/cloud/drive/download?fileId=${encodeURIComponent(card.dataset.id)}`};
      card.oncontextmenu=e=>{e.preventDefault();showDriveContext(e.clientX,e.clientY,{id:card.dataset.id,name:card.dataset.name,kind:card.dataset.kind})}
    });
  }catch(e){toast(e.message)}
}

$("#driveConnectBtn").onclick=async()=>{
  try{
    const s=await api("/api/cloud/drive/status");
    if(!s.configured){
      const setup=await api("/api/cloud/drive/setup");
      showSheet(`<div class="eyebrow">CONFIGURACIÓN ÚNICA</div><h3>Preparar Google Drive</h3>
      <p>Esto solo lo hace quien instala CEREBRO. Después cada usuario verá únicamente “Conectar Drive”.</p>
      <div class="item"><small>Redirect URI</small><div style="word-break:break-all;margin-top:6px">${esc(setup.redirectUri)}</div></div>
      <p>Variables privadas necesarias en el servidor:</p><div class="item">${setup.requiredEnv.map(x=>`<code>${esc(x)}</code>`).join("<br>")}</div>
      <div class="sheet-actions"><button onclick="closeSheet()">Cerrar</button></div>`);
      return;
    }
    if(s.connected){
      showSheet(`<div class="eyebrow">GOOGLE DRIVE</div><h3>Desconectar Drive</h3><p>Los archivos seguirán en Google Drive. CEREBRO solo eliminará su autorización guardada.</p><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="danger" onclick="disconnectDrive()">Desconectar</button></div>`);
      return;
    }
    const d=await api("/api/cloud/drive/connect",{method:"POST",body:"{}"});
    location.href=d.url;
  }catch(e){toast(e.message)}
};
window.disconnectDrive=async()=>{await api("/api/cloud/drive/disconnect",{method:"POST",body:"{}"});driveParentId=null;driveStack=[];closeSheet();loadDrive();toast("Drive desconectado")};

$("#driveBackBtn").onclick=()=>{
  if(!driveStack.length)return;
  const prev=driveStack.pop();driveParentId=prev.id;loadDrive();
};
$("#driveRefreshBtn").onclick=loadDrive;
$("#driveNewFolderBtn").onclick=()=>showSheet(`<div class="eyebrow">DRIVE</div><h3>Nueva carpeta</h3><input id="driveFolderName" placeholder="Nombre"><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="createDriveFolder()">Crear</button></div>`);
window.createDriveFolder=async()=>{const name=$("#driveFolderName").value.trim();if(!name)return;await api("/api/cloud/drive/folder",{method:"POST",body:JSON.stringify({name,parentId:driveParentId})});closeSheet();faceState("folder");loadDrive();toast("Carpeta creada en Drive")};

async function uploadDriveFiles(files){
  if(!files.length)return;progress("Subiendo a Drive",`${files.length} archivo(s).`);
  try{
    const fd=new FormData();fd.append("parentId",driveParentId||"");files.forEach(f=>fd.append("files",f));
    const r=await fetch("/api/cloud/drive/upload",{method:"POST",headers:{"X-CSRF-Token":csrf},body:fd});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"Error");
    toast(`${d.saved.length} archivo(s) en Drive`);loadDrive();
  }catch(e){toast(e.message)}finally{endProgress()}
}
$("#driveUploadInput").onchange=e=>uploadDriveFiles([...e.target.files]);
const ddz=$("#driveDropzone");
["dragenter","dragover"].forEach(ev=>ddz.addEventListener(ev,e=>{e.preventDefault();ddz.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>ddz.addEventListener(ev,e=>{e.preventDefault();ddz.classList.remove("drag")}));
ddz.addEventListener("drop",e=>uploadDriveFiles([...e.dataTransfer.files]));

function showDriveContext(x,y,item){
  driveSelected=item;const m=$("#contextMenu");
  m.innerHTML=`${item.kind==="folder"?`<button onclick="driveOpenSelected()">Abrir</button>`:`<button onclick="driveDownloadSelected()">Descargar</button>`}
  <button onclick="driveRenameSelected()">Renombrar…</button><button onclick="driveMoveSelected()">Mover por ID…</button><button class="danger" onclick="driveTrashSelected()">Mover a papelera…</button>`;
  m.style.left=Math.min(x,innerWidth-230)+"px";m.style.top=Math.min(y,innerHeight-250)+"px";m.classList.remove("hidden");
}
window.driveOpenSelected=()=>{driveStack.push({id:driveParentId,name:driveSelected.name});driveParentId=driveSelected.id;loadDrive()};
window.driveDownloadSelected=()=>location.href=`/api/cloud/drive/download?fileId=${encodeURIComponent(driveSelected.id)}`;
window.driveRenameSelected=()=>showSheet(`<div class="eyebrow">DRIVE</div><h3>Renombrar</h3><input id="driveRenameValue" value="${esc(driveSelected.name)}"><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="applyDriveRename()">Renombrar</button></div>`);
window.applyDriveRename=async()=>{await api("/api/cloud/drive/rename",{method:"POST",body:JSON.stringify({fileId:driveSelected.id,name:$("#driveRenameValue").value})});closeSheet();loadDrive();toast("Renombrado en Drive")};
window.driveMoveSelected=()=>showSheet(`<div class="eyebrow">DRIVE</div><h3>Mover elemento</h3><p>Para esta primera versión usa el ID de la carpeta de destino. En la siguiente iteración lo sustituiremos por un selector visual.</p><input id="driveMoveParent" placeholder="ID carpeta destino"><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="primary" onclick="applyDriveMove()">Mover</button></div>`);
window.applyDriveMove=async()=>{await api("/api/cloud/drive/move",{method:"POST",body:JSON.stringify({fileId:driveSelected.id,parentId:$("#driveMoveParent").value})});closeSheet();loadDrive();toast("Movido en Drive")};
window.driveTrashSelected=()=>showSheet(`<div class="eyebrow">DRIVE</div><h3>Mover a papelera</h3><p>${esc(driveSelected.name)} irá a la papelera de Google Drive.</p><div class="sheet-actions"><button onclick="closeSheet()">Cancelar</button><button class="danger" onclick="applyDriveTrash()">Papelera</button></div>`);
window.applyDriveTrash=async()=>{await api("/api/cloud/drive/trash",{method:"POST",body:JSON.stringify({fileId:driveSelected.id})});closeSheet();loadDrive();toast("En papelera de Drive")};

if(new URLSearchParams(location.search).get("drive")==="connected"){
  history.replaceState({}, "", location.pathname);
  setTimeout(()=>{switchView("drive");toast("Google Drive conectado");},300);
}
