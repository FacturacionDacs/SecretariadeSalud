(() => {
  "use strict";

  // ===================================================================================
  // SISTEMA DE LICENCIA (vencimiento + bloqueo por equipo + acceso). Importante: esto es
  // una app estática sin servidor, así que ninguna de estas protecciones es infranqueable
  // para alguien con conocimientos técnicos que abra las herramientas de desarrollador del
  // navegador — son una barrera razonable contra copiado/uso casual, no seguridad real.
  //
  // - Vencimiento: fecha fija; pasada esa fecha, el sistema no abre en ningún equipo.
  // - Bloqueo por equipo: la primera vez que se abre en un computador, genera un "código de
  //   solicitud" único de ese equipo (huella del navegador/SO/pantalla). Para activarse ahí
  //   hace falta un "código de activación" que solo se puede generar con el archivo aparte
  //   generador_codigos_admin.html (que queda solo en poder del administrador, con el mismo
  //   secreto). Una vez activado, ese mismo equipo no vuelve a pedirlo. Si los archivos se
  //   copian a otro computador, ese otro pedirá su propio código de activación nuevo.
  // - Las contraseñas de acceso no están en texto plano: se comparan por huella SHA-256.
  // ===================================================================================
  const LICENSE_EXPIRATION = new Date("2026-10-05T23:59:59");
  // Debe ser EXACTAMENTE el mismo secreto que en generador_codigos_admin.html. Si se cambia
  // aquí, hay que cambiarlo también allá (y todas las activaciones previas dejan de sumar
  // — porque el código esperado para cada equipo depende de este valor).
  const LICENSE_SECRET = "c2655947a4bf2fedbde84e8c78d5a9606a1dd276cf75342c";
  // SHA-256 de las contraseñas reales (no se guarda el texto plano en el código).
  const VALID_LOGIN_HASHES = [
    {user:"admin", hash:"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"},
    {user:"root", hash:"2e3c3c0a213b09f4e83239e54ba1f87d069149208bf308337e3191568335c937"}
  ];

  // Respaldo sin Web Crypto (FNV-1a, no criptográfico) por si crypto.subtle no está disponible
  // en este contexto (pasa a veces al abrir un archivo local con doble clic en algunos
  // navegadores). Sin esto, la app quedaría bloqueada por completo si eso ocurre.
  function simpleHashHex(text){
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i=0;i<text.length;i++){
      const c = text.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    const hex = n => (n>>>0).toString(16).padStart(8,"0");
    return (hex(h1)+hex(h2)+hex(h1^h2)+hex(h1+h2)).repeat(2).slice(0,64);
  }

  async function sha256Hex(text){
    if (window.crypto?.subtle?.digest){
      try{
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
      }catch{ /* cae al respaldo */ }
    }
    return simpleHashHex(text);
  }

  async function hmacCode(message, secret){
    if (window.crypto?.subtle?.importKey){
      try{
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
        const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
        const hex = Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("");
        return hex.slice(0,16).toUpperCase().match(/.{1,4}/g).join("-");
      }catch{ /* cae al respaldo */ }
    }
    const hex = await sha256Hex(message+"::"+secret);
    return hex.slice(0,16).toUpperCase().match(/.{1,4}/g).join("-");
  }

  async function computeDeviceFingerprint(){
    const parts = [
      navigator.userAgent, navigator.language, String(navigator.hardwareConcurrency||""),
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "", String(navigator.deviceMemory||"")
    ];
    try{
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      ctx.textBaseline = "top"; ctx.font = "14px Arial";
      ctx.fillText("RIPS0948-fp-\u2611", 2, 2);
      parts.push(c.toDataURL());
    }catch{}
    return sha256Hex(parts.join("||"));
  }

  // ---- Deterrentes de inspección: clic derecho, copiar/seleccionar, atajos de devtools ----
  // (De nuevo: disuaden el uso casual, no detienen a quien sepa lo que hace.)
  document.addEventListener("contextmenu", e=>e.preventDefault());
  document.addEventListener("selectstart", e=>{ if (!e.target.closest("input,textarea")) e.preventDefault(); });
  document.addEventListener("copy", e=>{ if (!e.target.closest("input,textarea")) e.preventDefault(); });
  document.addEventListener("keydown", e=>{
    const k = (e.key||"").toLowerCase();
    const blocked = e.key === "F12"
      || ((e.ctrlKey||e.metaKey) && e.shiftKey && (k==="i"||k==="j"||k==="c"))
      || ((e.ctrlKey||e.metaKey) && k==="u");
    if (blocked){ e.preventDefault(); e.stopPropagation(); }
  });
  // Aviso (no bloqueo duro, para no romper la app a usuarios legítimos con ventanas angostas
  // o barras de extensiones) si el tamaño ventana-vs-viewport sugiere herramientas abiertas.
  (function devtoolsHint(){
    const banner = document.createElement("div");
    banner.id = "devtoolsHint";
    banner.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#3a1212;color:#ffd6d6;font:700 12px/1.4 system-ui;padding:8px 14px;text-align:center;display:none";
    banner.textContent = "⚠ Este sistema no está autorizado para verse con herramientas de desarrollador abiertas.";
    document.body.appendChild(banner);
    setInterval(()=>{
      const open = (window.outerWidth-window.innerWidth>220) || (window.outerHeight-window.innerHeight>220);
      banner.style.display = open ? "block" : "none";
    }, 1200);
  })();

  (async function initAccessControl(){
    const overlay = document.getElementById("loginOverlay");
    const shell = document.getElementById("appShell");
    const form = document.getElementById("loginForm");
    const card = form?.closest(".login-card");
    const userInput = document.getElementById("loginUser");
    const passInput = document.getElementById("loginPass");
    const errorMsg = document.getElementById("loginError");
    const logoutBtn = document.getElementById("btnLogout");
    const toggleBtn = document.getElementById("btnTogglePass");
    const submitBtn = document.getElementById("btnLoginSubmit");
    const submitLabel = submitBtn?.querySelector(".login-submit-label");
    const spinner = submitBtn?.querySelector(".login-spinner");
    if (!overlay || !shell || !form) return;

    function showApp(){
      overlay.hidden = true; shell.hidden = false;
      const nameEl = document.getElementById("topUserName");
      if (nameEl) nameEl.textContent = sessionStorage.getItem("rips0948:authUser") || "Usuario";
      applyLockState(sessionStorage.getItem("rips0948:systemLocked") === "1");
    }
    function showLogin(){ shell.hidden = true; overlay.hidden = false; userInput?.focus(); }

    // 1) Vencimiento: bloquea TODO, sin importar el equipo, pasada la fecha límite.
    if (new Date() > LICENSE_EXPIRATION){
      document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0c2540;color:#fff;font-family:system-ui;text-align:center;padding:24px">
        <div><div style="font-size:40px;margin-bottom:10px">⏳</div><h1 style="margin:0 0 8px;font-size:20px">Sistema vencido</h1>
        <p style="color:#9fb2ca;max-width:360px;margin:0 auto">Este sistema dejó de estar disponible el ${LICENSE_EXPIRATION.toLocaleDateString("es-CO")}. Contacta al administrador si necesitas seguir usándolo.</p></div>
      </div>`;
      return;
    }

    // 2) Bloqueo por equipo: si este navegador no está activado, pide el código.
    const fingerprint = await computeDeviceFingerprint();
    const requestCode = fingerprint.slice(0,16).toUpperCase().match(/.{1,4}/g).join("-");
    const alreadyActivated = localStorage.getItem("rips0948:deviceFingerprint") === fingerprint
      && localStorage.getItem("rips0948:deviceActivated") === "1";

    if (!alreadyActivated){
      overlay.hidden = false; shell.hidden = true;
      form.innerHTML = `
        <div class="login-mark">🔒</div>
        <h1>Activar este equipo</h1>
        <p>Este sistema solo puede usarse en un equipo autorizado. Envía este código al administrador y pégale aquí el código de activación que te dé.</p>
        <label class="input-field" style="background:#eef2f7"><span class="input-icon">🖥</span><input readonly value="${requestCode}" style="font-family:monospace;font-weight:700;letter-spacing:.5px"></label>
        <label class="input-field"><span class="input-icon">🔑</span><input id="activationCodeInput" type="text" placeholder="Código de activación" autocomplete="off" style="font-family:monospace;text-transform:uppercase;letter-spacing:.5px"></label>
        <p id="activationError" class="login-error" hidden>⚠ Código incorrecto. Verifica que lo copiaste completo.</p>
        <button type="button" id="btnActivate" class="btn btn-primary login-submit"><span>Activar equipo</span></button>
        <div class="login-footer"><span class="login-status-dot"></span> Un solo equipo por activación</div>`;
      const codeInput = document.getElementById("activationCodeInput");
      const actError = document.getElementById("activationError");
      document.getElementById("btnActivate").addEventListener("click", async ()=>{
        const entered = (codeInput.value||"").trim().toUpperCase();
        const expected = await hmacCode(requestCode, LICENSE_SECRET);
        if (entered === expected){
          localStorage.setItem("rips0948:deviceFingerprint", fingerprint);
          localStorage.setItem("rips0948:deviceActivated", "1");
          location.reload();
        } else {
          actError.hidden = false;
          card?.classList.remove("shake"); void card?.offsetWidth; card?.classList.add("shake");
        }
      });
      return; // no sigue al login normal hasta activar.
    }

    // 3) Login normal (usuario/contraseña, comparadas por huella SHA-256).
    if (sessionStorage.getItem("rips0948:auth") === "1") showApp(); else showLogin();

    toggleBtn?.addEventListener("click", ()=>{
      const show = passInput.type === "password";
      passInput.type = show ? "text" : "password";
      toggleBtn.textContent = show ? "🙈" : "👁";
      toggleBtn.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
      passInput.focus();
    });

    form.addEventListener("submit", (e)=>{
      e.preventDefault();
      const u = (userInput?.value || "").trim();
      const p = passInput?.value || "";
      if (submitBtn) submitBtn.disabled = true;
      if (submitLabel) submitLabel.textContent = "Verificando…";
      if (spinner) spinner.hidden = false;

      sha256Hex(p).then(pHash=>{
        setTimeout(()=>{
          if (VALID_LOGIN_HASHES.some(c => c.user === u && c.hash === pHash)){
            sessionStorage.setItem("rips0948:auth","1");
            sessionStorage.setItem("rips0948:authUser", u);
            errorMsg.hidden = true;
            showApp();
          } else {
            errorMsg.hidden = false;
            passInput.value = "";
            passInput.focus();
            card?.classList.remove("shake");
            void card?.offsetWidth;
            card?.classList.add("shake");
          }
          if (submitBtn) submitBtn.disabled = false;
          if (submitLabel) submitLabel.textContent = "Ingresar";
          if (spinner) spinner.hidden = true;
        }, 380);
      });
    });

    logoutBtn?.addEventListener("click", ()=>{
      sessionStorage.removeItem("rips0948:auth");
      sessionStorage.removeItem("rips0948:authUser");
      sessionStorage.removeItem("rips0948:systemLocked");
      location.reload();
    });

    // Bloqueo manual: un clic marca el sistema como "Inactivo" (rojo) y bloquea todo con un
    // overlay hasta que se vuelva a marcar como "Activo" (verde). Se recuerda mientras dure
    // la pestaña (sessionStorage), así que si recargan estando bloqueado, sigue bloqueado.
    const lockOverlay = document.getElementById("lockOverlay");
    const toggleActiveBtn = document.getElementById("btnToggleActive");
    const unlockBtn = document.getElementById("btnUnlockSystem");

    function applyLockState(locked){
      if (lockOverlay) lockOverlay.hidden = !locked;
      if (toggleActiveBtn){
        toggleActiveBtn.classList.toggle("status-toggle-active", !locked);
        toggleActiveBtn.classList.toggle("status-toggle-inactive", locked);
        const label = toggleActiveBtn.querySelector(".status-toggle-label");
        if (label) label.textContent = locked ? "Inactivo" : "Activo";
        toggleActiveBtn.title = locked ? "Clic para reactivar el sistema" : "Clic para bloquear el sistema";
      }
    }

    toggleActiveBtn?.addEventListener("click", ()=>{
      const nowLocked = !(sessionStorage.getItem("rips0948:systemLocked") === "1");
      sessionStorage.setItem("rips0948:systemLocked", nowLocked ? "1" : "0");
      applyLockState(nowLocked);
    });
    unlockBtn?.addEventListener("click", ()=>{
      sessionStorage.setItem("rips0948:systemLocked", "0");
      applyLockState(false);
    });
  })();


  // Reglas por defecto: campos de valor monetario que siempre deben ser numéricos, sin
  // importar el grupo de servicio. Solo se aplican la primera vez que se usa el dashboard
  // (si el usuario ya guardó su propia parametrización, o la restableció, no se sobrescribe).
  // Todo sigue siendo editable desde el panel de Parametrización: esta es solo la semilla inicial.
  const DEFAULT_FIELD_RULES = {
    "medicamentos|vrDispensacion": {required:false, type:"numeric"},
    "otrosServicios|vrDispensacion": {required:false, type:"numeric"}
  };
  function loadFieldRules(){
    try{
      const raw = localStorage.getItem("rips0948:fieldRules");
      if (raw === null){
        // Primera vez que se usa el dashboard en este navegador: sembrar los valores por defecto.
        try{ localStorage.setItem("rips0948:fieldRules", JSON.stringify(DEFAULT_FIELD_RULES)); }catch{}
        return new Map(Object.entries(DEFAULT_FIELD_RULES));
      }
      return new Map(Object.entries(JSON.parse(raw)));
    }catch{ return new Map(Object.entries(DEFAULT_FIELD_RULES)); }
  }

  // Indicadores del "ANALISIS CUANTITATIVO DE LOS RIPS Y LA PRODUCION DEL DECRETO 2193" /
  // "TOTAL CONSULTA DE 1°..." — cada concepto se calcula contando registros de un grupo
  // (consultas/procedimientos) cuyo código esté en la lista configurada. Los códigos por
  // defecto se dedujeron comparando contra la plantilla PDF real que se compartió (coinciden
  // exacto en 4 de 6). "sesionesOdontologicas" y "tratamientosTerminados" quedan en 0/manual
  // hasta confirmar el criterio exacto — no se debe adivinar en un informe regulado.
  // Listas de códigos capturadas de las tablas de referencia reales (CodCUPSOdont.xlsx).
  const CODES_SESIONES_ODONTOLOGICAS = ["248200","240300","245200","237200","997105","768801","761201","761301","761302","242205","242204","241104","761101","761102","241200","241102","241103","241101","237901","248100","242202","231500","247100","247202","247201","247300","232300","234104","234101","234103","234102","234201","234302","234301","234402","234401","763902","249100","766205","766402","766605","766606","766607","243501","242201","237401","760902","240200","997301","240400","762105","243303","243302","243301","244102","244101","762104","762103","762102","762101","243102","243101","243104","243103","243106","243107","243109","243108","243105","762301","237902","973400","973300","973600","973500","247403","247401","247402","768001","768002","237603","237602","237601","766701","243400","763104","763103","763903","237800","236100","236200","236300","768110","768101","768500","768200","234105","768600","766970","763101","763102","764101","764201","244108","248800","765101","765105","765202","765201","243502","766100","766903","766301","766303","766302","766403","766201","766203","766902","766601","766501","766603","766604","760901","766202","766602","766401","234203","242103","242102","242101","242300","237501","237502","237102","237101","237703","237702","237701","232401","234202","232403","764301","764303","764302","764304","764305","232402","767901","767202","767201","767601","767903","767905","767904","767902","767401","767402","767403","767404","767203","767604","767603","767907","767602","767701","767703","767702","767908","768401","767301","767302","767303","767304","767503","767801","767502","767802","768301","768302","767501","767605","767705","767706","765302","765301","245100","235100","765401","248400","234204","234303","242400","243110","244109","244103","244106","244105","244107","244104","762201","764401","763901","762202","764402","233100","233200","768702","768902","768901","768701","764601","760102","760101","760103","766901","972200","243203","243202","243201","237306","237302","237303","237305","237304","237301","997106","997103","997104","235200"];

  const INDICATOR_DEFS = [
    {key:"consultaValoracion", label:"10_346 Total de consultas de odontología realizadas (valoración)", group:"consultas", field:"codConsulta", defaultCodes:["890203","890703"], ageMin:null, ageMax:null},
    {key:"sesionesOdontologicas", label:"11_751 Número de sesiones de odontología realizadas", group:"procedimientos", field:"codProcedimiento", defaultCodes:CODES_SESIONES_ODONTOLOGICAS, ageMin:null, ageMax:null},
    {key:"tratamientosTerminados", label:"12_429 Total de tratamientos terminados (Paciente terminado)", group:"procedimientos", field:"codProcedimiento", defaultCodes:[], ageMin:null, ageMax:null},
    {key:"sellantesAplicados", label:"13_347 Sellantes aplicados", group:"procedimientos", field:"codProcedimiento", defaultCodes:["997101","997102","997107"], ageMin:3, ageMax:15},
    {key:"superficiesObturadas", label:"14_348 Superficies obturadas (cualquier material)", group:"procedimientos", field:"codProcedimiento", defaultCodes:["232100","232101","232102","232103","232104","232200","232201"], ageMin:null, ageMax:null},
    {key:"exodoncias", label:"15_349 Exodoncias (cualquier tipo)", group:"procedimientos", field:"codProcedimiento", defaultCodes:["230100","230101","230102","230103","230200","230201","230202","230203"], ageMin:null, ageMax:null}
  ];
  function loadIndicatorAges(){
    try{
      const raw = localStorage.getItem("rips0948:indicatorAges");
      const saved = raw ? JSON.parse(raw) : {};
      const out = {};
      INDICATOR_DEFS.forEach(d=>{ out[d.key] = saved[d.key] || {min:d.ageMin, max:d.ageMax}; });
      return out;
    }catch{
      const out = {}; INDICATOR_DEFS.forEach(d=>out[d.key]={min:d.ageMin,max:d.ageMax}); return out;
    }
  }
  function loadIndicatorCodes(){
    try{
      const raw = localStorage.getItem("rips0948:indicatorCodes");
      const saved = raw ? JSON.parse(raw) : {};
      const out = {};
      INDICATOR_DEFS.forEach(d=>{ out[d.key] = Array.isArray(saved[d.key]) ? saved[d.key] : d.defaultCodes; });
      return out;
    }catch{
      const out = {}; INDICATOR_DEFS.forEach(d=>out[d.key]=d.defaultCodes); return out;
    }
  }
  function loadDec2193(){
    try{
      const raw = localStorage.getItem("rips0948:dec2193");
      const saved = raw ? JSON.parse(raw) : {};
      const out = {};
      INDICATOR_DEFS.forEach(d=>{ out[d.key] = Number(saved[d.key]) || 0; });
      return out;
    }catch{
      const out = {}; INDICATOR_DEFS.forEach(d=>out[d.key]=0); return out;
    }
  }
  // Valor manual por indicador: para cuando no hay fórmula/código confiable (ej. 12_429), se
  // puede escribir el número a mano en vez de calcularlo. Si tiene valor manual, ese manda
  // sobre el cálculo por códigos; "bloqueado" solo evita ediciones accidentales del campo.
  function loadIndicatorManual(){
    try{
      const raw = localStorage.getItem("rips0948:indicatorManual");
      const saved = raw ? JSON.parse(raw) : {};
      const out = {};
      INDICATOR_DEFS.forEach(d=>{ out[d.key] = saved[d.key] && typeof saved[d.key]==="object" ? saved[d.key] : {value:null,locked:false}; });
      return out;
    }catch{
      const out = {}; INDICATOR_DEFS.forEach(d=>out[d.key]={value:null,locked:false}); return out;
    }
  }

  // ===== Tabla 2 del informe: INFORME DEPURADO DE SALUD ORAL (desglose por CUPS y edad) =====
  const AGE_COLUMNS = ["3 A 5","6 A 15","<= 17","> 12","Toda Edad"];
  const DEFAULT_AGE_BREAKDOWN_ROWS = [
    {code:"997107", group:"procedimientos", field:"codProcedimiento", label:"De 3 a 15 años", column:"3 A 5", ageMin:3, ageMax:15},
    {code:"997106", group:"procedimientos", field:"codProcedimiento", label:"Hasta los 17 años", column:"<= 17", ageMin:0, ageMax:17},
    {code:"997301", group:"procedimientos", field:"codProcedimiento", label:"Mayores de 12 años", column:"> 12", ageMin:13, ageMax:130},
    {code:"997002", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"997001", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"990203", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"232102", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"230202", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"230102", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"230101", group:"procedimientos", field:"codProcedimiento", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"890703", group:"consultas", field:"codConsulta", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"890303", group:"consultas", field:"codConsulta", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null},
    {code:"890203", group:"consultas", field:"codConsulta", label:"Todas las edades", column:"Toda Edad", ageMin:null, ageMax:null}
  ];
  function loadAgeBreakdownRows(){
    try{
      const raw = localStorage.getItem("rips0948:ageBreakdownRows");
      return raw ? JSON.parse(raw) : DEFAULT_AGE_BREAKDOWN_ROWS.map(r=>({...r}));
    }catch{ return DEFAULT_AGE_BREAKDOWN_ROWS.map(r=>({...r})); }
  }

  // Estilos disponibles para el PDF del informe: cada uno define colores, si dibuja rejilla
  // completa o solo una línea bajo el encabezado, si el título de cada sección va sobre una
  // banda de color o como texto plano, y la tipografía. "default" es el que ya venía usando
  // el sistema (Corporativo Azul con rejilla). El resto son las variantes que se mostraron
  // como opciones para elegir.
  const REPORT_STYLES = {
    default: {label:"Predeterminado (Idéntico a la plantilla oficial)", accent:[0,0,0], headerFill:"none", showGrid:false, stripe:null, total:[240,240,240], grid:[0,0,0], sectionMode:"text", font:"helvetica"},
    B: {label:"B - Minimalista Blanco y Negro", accent:[0,0,0], headerFill:"none", showGrid:false, stripe:null, total:[240,240,240], grid:[0,0,0], sectionMode:"text", font:"times"},
    C: {label:"C - Institucional Verde Salud", accent:[21,92,62], headerFill:"dark", showGrid:true, stripe:[230,242,236], total:[201,230,216], grid:[195,214,205], sectionMode:"band", font:"helvetica"},
    D: {label:"D - Clásico Formal Gris", accent:[0,0,0], headerFill:"light", showGrid:true, stripe:[247,247,247], total:[220,220,220], grid:[153,153,153], sectionMode:"text", font:"helvetica"},
    E: {label:"E - Documento Limpio (sin líneas)", accent:[30,55,88], headerFill:"none", showGrid:false, stripe:null, total:[232,238,246], grid:[30,55,88], sectionMode:"text", font:"helvetica"},
    F: {label:"F - Cebra Suave (sin líneas)", accent:[30,55,88], headerFill:"none", showGrid:false, stripe:[241,244,248], total:[232,238,246], grid:[30,55,88], sectionMode:"text", font:"helvetica"},
    G: {label:"G - Banda de Color, sin rejilla", accent:[138,21,56], headerFill:"none", showGrid:false, stripe:[251,239,242], total:[248,222,229], grid:[138,21,56], sectionMode:"band", font:"helvetica"},
    H: {label:"H - Tipográfico Puro (serif, sin líneas)", accent:[34,34,34], headerFill:"none", showGrid:false, stripe:null, total:[240,240,240], grid:[34,34,34], sectionMode:"text", font:"times"},
    I: {label:"I - Corporativo Azul (banda + cebra)", accent:[30,55,88], headerFill:"dark", showGrid:true, stripe:[232,238,246], total:[214,225,240], grid:[200,206,215], sectionMode:"band", font:"helvetica"}
  };

  const state = {
    files: [],
    users: [],
    serviceRows: [],
    codeSummary: [],
    findings: [],
    selectedSameFileKeep: new Map(),
    dialogFile: null,
    ignoredFiles: [],
    sameFileDuplicates: [],
    fieldRules: loadFieldRules(),
    orgConfig: loadOrgConfig(),
    detectedEntities: [],
    indicatorCodes: loadIndicatorCodes(),
    indicatorAges: loadIndicatorAges(),
    indicatorManual: loadIndicatorManual(),
    dec2193: loadDec2193(),
    ageBreakdownRows: loadAgeBreakdownRows()
  };

  const SERVICE_KEYS = ["consultas","procedimientos","urgencias","hospitalizacion","recienNacidos","medicamentos","otrosServicios"];
  const LABELS = window.RIPS_CATALOGS?.serviceLabels || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    fileInput:$("fileInput"), folderInput:$("folderInput"), dropzone:$("dropzone"), btnClear:$("btnClear"),
    mFiles:$("mFiles"), mUsers:$("mUsers"), mServices:$("mServices"), mDuplicates:$("mDuplicates"), mErrors:$("mErrors"),
    pregnancyTotal:$("pregnancyTotal"), pregnancyBody:$("pregnancyBody"),
    mFilesDetail:$("mFilesDetail"), mUniqueUsers:$("mUniqueUsers"), mServiceTypes:$("mServiceTypes"), mInvalidFiles:$("mInvalidFiles"),
    serviceBars:$("serviceBars"), validationDonut:$("validationDonut"), validPct:$("validPct"), lOk:$("lOk"), lWarn:$("lWarn"), lErr:$("lErr"),
    topCodesBody:$("topCodesBody"), topCodeSearch:$("topCodeSearch"), filesBody:$("filesBody"), fileCountLabel:$("fileCountLabel"),
    usersBody:$("usersBody"), userSearch:$("userSearch"), servicesBody:$("servicesBody"), serviceFilter:$("serviceFilter"), serviceSearch:$("serviceSearch"),
    errorsList:$("errorsList"), severityFilter:$("severityFilter"),
    sameFileDuplicatesList:$("sameFileDuplicatesList"), btnRemoveAllSameFile:$("btnRemoveAllSameFile"),
    fieldRulesGroups:$("fieldRulesGroups"), fieldRulesFilter:$("fieldRulesFilter"), btnResetFieldRules:$("btnResetFieldRules"),
    cfgOrgName:$("cfgOrgName"), cfgOrgNit:$("cfgOrgNit"), btnConvertAllTxt:$("btnConvertAllTxt"),
    cfgTrimestre:$("cfgTrimestre"), cfgYear:$("cfgYear"), cfgSignerName:$("cfgSignerName"), cfgReportStyle:$("cfgReportStyle"),
    btnPickSaveFolder:$("btnPickSaveFolder"), cfgSaveFolderLabel:$("cfgSaveFolderLabel"), dec2193FileInput:$("dec2193FileInput"), btnGenerateAllHospitals:$("btnGenerateAllHospitals"),
    btnPickDifferentFolder:$("btnPickDifferentFolder"),
    btnCompareTrimesters:$("btnCompareTrimesters"), trimesterCompareResults:$("trimesterCompareResults"), cfgExcludeRepeated:$("cfgExcludeRepeated"),
    btnClearDec2193:$("btnClearDec2193"),
    reportFileNamePreview:$("reportFileNamePreview"), btnDownloadReportPdf:$("btnDownloadReportPdf"), detectedEntities:$("detectedEntities"),
    indicatorConfigList:$("indicatorConfigList"), dec2193List:$("dec2193List"),
    ignoredFilesPanel:$("ignoredFilesPanel"), ignoredCountLabel:$("ignoredCountLabel"), ignoredFilesBody:$("ignoredFilesBody"),
    dupBadge:$("dupBadge"), errorBadge:$("errorBadge"), btnExportCsv:$("btnExportCsv"),
    jsonDialog:$("jsonDialog"), dialogTitle:$("dialogTitle"), dialogMeta:$("dialogMeta"), jsonPreview:$("jsonPreview"), btnDownloadJson:$("btnDownloadJson"),
    toast:$("toast"), pageTitle:$("pageTitle"), pageSubtitle:$("pageSubtitle"),
    uploadProgress:$("uploadProgress"), uploadProgressLabel:$("uploadProgressLabel"), uploadProgressPct:$("uploadProgressPct"), uploadProgressFill:$("uploadProgressFill"), uploadProgressFile:$("uploadProgressFile"),
    btnFixAll:$("btnFixAll"), btnDownloadCorrected:$("btnDownloadCorrected"), mAutoFixable:$("mAutoFixable"), mManualFix:$("mManualFix"),
    scConsultas:$("scConsultas"), scProcedimientos:$("scProcedimientos"), scUrgencias:$("scUrgencias"),
    scHospitalizacion:$("scHospitalizacion"), scRecienNacidos:$("scRecienNacidos"), scMedicamentos:$("scMedicamentos"), scOtrosServicios:$("scOtrosServicios")
  };

  const viewMeta = {
    dashboard:["Dashboard","Resumen de archivos RIPS cargados"],
    files:["Archivos","RIPS JSON procesados en esta sesión"],
    users:["Usuarios","Identificaciones y servicios asociados"],
    services:["Servicios","Consolidado por tipo, código y cantidad"],
    duplicates:["Repetidos","Decide qué usuario repetido conservar o eliminar"],
    errors:["Validación","Estructura JSON, RIPS y consistencia"],
    params:["Parametrización","Reglas propias por campo"],
    config:["Configuración","Entidad, periodo e indicadores del informe"]
  };

  const DROPZONE_VIEWS = new Set(["dashboard","services"]);
  function updateUploadZoneVisibility(view){
    const show = DROPZONE_VIEWS.has(view);
    if (els.dropzone) els.dropzone.hidden = !show;
    if (els.uploadProgress && !show) els.uploadProgress.hidden = true;
  }

  document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("active", x===btn));
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    $("view-"+view).classList.add("active");
    els.pageTitle.textContent = viewMeta[view][0];
    els.pageSubtitle.textContent = viewMeta[view][1];
    updateUploadZoneVisibility(view);
  }));
  updateUploadZoneVisibility("dashboard");

  document.querySelectorAll("[data-service-card]").forEach(card => card.addEventListener("click", () => {
    if (card.disabled || card.classList.contains("disabled")) return;
    const type = card.dataset.serviceCard;
    openServiceDetail(type);
  }));

  els.fileInput.addEventListener("change", e => loadFiles([...e.target.files]));
  els.folderInput.addEventListener("change", e => loadFiles([...e.target.files]));
  ["dragenter","dragover"].forEach(ev => els.dropzone.addEventListener(ev, e => {e.preventDefault(); els.dropzone.classList.add("dragover")}));
  ["dragleave","drop"].forEach(ev => els.dropzone.addEventListener(ev, e => {e.preventDefault(); els.dropzone.classList.remove("dragover")}));
  els.dropzone.addEventListener("drop", e => loadFiles([...e.dataTransfer.files]));
  els.btnClear.addEventListener("click", clearAll);
  els.topCodeSearch.addEventListener("input", renderTopCodes);
  els.userSearch.addEventListener("input", renderUsers);
  els.serviceSearch.addEventListener("input", renderServices);
  els.serviceFilter.addEventListener("change", renderServices);
  els.severityFilter.addEventListener("change", renderFindings);
  els.btnFixAll.addEventListener("click", fixAllSafe);
  els.btnDownloadCorrected.addEventListener("click", downloadCorrectedFiles);
  els.btnRemoveAllSameFile.addEventListener("click", removeAllSameFileDuplicates);
  els.fieldRulesFilter?.addEventListener("input", renderFieldRules);
  els.btnResetFieldRules?.addEventListener("click", ()=>{
    if (!state.fieldRules.size) return toast("No hay parametrización personalizada para restablecer");
    state.fieldRules.clear();
    saveFieldRules();
    revalidateAll();
    toast("Parametrización restablecida");
  });
  els.cfgOrgName?.addEventListener("input", ()=>{ state.orgConfig.name = els.cfgOrgName.value; saveOrgConfig(); renderOrgConfig(); });
  els.cfgOrgNit?.addEventListener("input", ()=>{ state.orgConfig.nit = els.cfgOrgNit.value; saveOrgConfig(); });
  els.cfgTrimestre?.addEventListener("change", ()=>{ state.orgConfig.trimestre = els.cfgTrimestre.value; saveOrgConfig(); renderOrgConfig(); });
  els.cfgYear?.addEventListener("input", ()=>{ state.orgConfig.year = els.cfgYear.value; saveOrgConfig(); renderOrgConfig(); });
  els.cfgSignerName?.addEventListener("input", ()=>{ state.orgConfig.signerName = els.cfgSignerName.value; saveOrgConfig(); renderOrgConfig(); });
  els.cfgReportStyle?.addEventListener("change", ()=>{ state.orgConfig.reportStyle = els.cfgReportStyle.value; saveOrgConfig(); });
  els.btnClearDec2193?.addEventListener("click", clearDec2193Only);
  els.dec2193FileInput?.addEventListener("change", (e)=>{
    const file = e.target.files?.[0];
    if (file) loadDec2193File(file);
    e.target.value = "";
  });
  els.btnPickSaveFolder?.addEventListener("click", pickSaveFolder);
  els.btnPickDifferentFolder?.addEventListener("click", ()=>{ pendingDirHandle = null; pickSaveFolder(); });
  els.btnGenerateAllHospitals?.addEventListener("click", generateAllHospitals);
  els.btnCompareTrimesters?.addEventListener("click", async ()=>{
    const data = await compareWithPreviousTrimesters();
    if (data) renderTrimesterCompareResults(data);
  });
  els.btnDownloadReportPdf?.addEventListener("click", downloadReportPdf);
  els.btnConvertAllTxt?.addEventListener("click", downloadTxtGroupedForAllFiles);
  els.btnExportCsv.addEventListener("click", exportServicesCsv);
  els.btnDownloadJson.addEventListener("click", () => {
    if (state.dialogFile) downloadBlob(state.dialogFile.name, JSON.stringify(state.dialogFile.data,null,2), "application/json");
  });

  // Archivos Respuesta del Ministerio (CUV): resultado de validación que devuelve la
  // plataforma, no un RIPS. No siempre traen exactamente los mismos campos (por ejemplo,
  // algunas variantes no incluyen "ResultadosValidacion"), así que se reconocen por
  // "CodigoUnicoValidacion" (campo muy característico de esta respuesta, prácticamente
  // no aparece en un RIPS) o por coincidencia de al menos dos de los otros campos típicos.
  // Esta clasificación se resuelve ANTES de validar como RIPS, así nunca se reporta
  // como error de RIPS: el archivo simplemente se cuenta como CUV, no como RIPS.
  const CUV_MARKER_FIELDS = ["ProcesoId","ResultState","ResultadosValidacion","RutaArchivos","ModalidadPago","FechaRadicacion","Modulo"];
  function isCuvResponseFile(d){
    if (!isObject(d)) return false;
    if (Array.isArray(d.usuarios)) return false; // si trae usuarios[], trátalo como RIPS.
    if ("CodigoUnicoValidacion" in d) return true;
    const matches = CUV_MARKER_FIELDS.filter(k => k in d).length;
    return matches >= 2;
  }

  async function loadFiles(files){
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith(".json"));
    if (!jsonFiles.length) return toast("No se encontraron archivos .json");

    let ignoredCount = 0;
    const total = jsonFiles.length;
    showUploadProgress(total);
    for (let idx=0; idx<jsonFiles.length; idx++){
      const file = jsonFiles[idx];
      setUploadProgress(idx, total, file.name);
      const entry = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        name:file.webkitRelativePath || file.name,
        shortName:file.name,
        size:file.size,
        data:null,
        rawText:"",
        parseError:null,
        findings:[],
        users:[],
        servicesCount:0,
        correctionsApplied:0,
        status:"OK"
      };
      try{
        const text = await file.text();
        entry.rawText = text;
        entry.data = JSON.parse(text);
        if (isCuvResponseFile(entry.data)){
          ignoredCount++;
          state.ignoredFiles.push({name:entry.name, shortName:entry.shortName, motivo:"Archivo Respuesta del Ministerio (CUV), no es un RIPS."});
          setUploadProgress(idx+1, total, file.name);
          continue;
        }
        validateRips(entry);
        extractUsersAndServices(entry);
      }catch(err){
        entry.parseError = err.message;
        addFinding(entry,"ERROR","JSON_INVALIDO","El archivo no contiene JSON válido.", "$", err.message);
      }
      state.files.push(entry);
      setUploadProgress(idx+1, total, file.name);
      // Cede el hilo para que el navegador pueda pintar el avance de la barra.
      await new Promise(r => requestAnimationFrame(r));
    }
    rebuild();
    hideUploadProgress();
    const processed = jsonFiles.length - ignoredCount;
    toast(ignoredCount
      ? `${processed} archivo(s) procesado(s) · ${ignoredCount} archivo(s) de respuesta CUV omitido(s)`
      : `${processed} archivo(s) procesado(s)`);
  }

  function showUploadProgress(total){
    els.uploadProgress.hidden = false;
    els.uploadProgressLabel.textContent = `Procesando 0 de ${total} archivo(s)…`;
    els.uploadProgressPct.textContent = "0%";
    els.uploadProgressFill.style.width = "0%";
    els.uploadProgressFile.textContent = "";
  }

  function setUploadProgress(done, total, currentName){
    const pct = total ? Math.round((done/total)*100) : 0;
    els.uploadProgressLabel.textContent = `Procesando ${done} de ${total} archivo(s)…`;
    els.uploadProgressPct.textContent = `${pct}%`;
    els.uploadProgressFill.style.width = `${pct}%`;
    els.uploadProgressFile.textContent = done < total ? `Leyendo: ${currentName}` : `Completado: ${currentName}`;
  }

  function hideUploadProgress(){
    setTimeout(() => { els.uploadProgress.hidden = true; }, 500);
  }


  function validateRips(entry){
    const d = entry.data;
    if (!isObject(d)){
      addFinding(entry,"ERROR","RAIZ_INVALIDA","La raíz del RIPS debe ser un objeto JSON.", "$");
      return;
    }

    // Validación estructural base para RIPS JSON FEV-RIPS.
    requireField(entry,d,"numDocumentoIdObligado","$.numDocumentoIdObligado","Número de documento del obligado","root");
    if (!("numFactura" in d) && !("numNota" in d)){
      addFinding(entry,"ERROR","FACTURA_AUSENTE","Debe existir numFactura o la identificación de nota aplicable.", "$.numFactura");
    }
    if (!Array.isArray(d.usuarios)){
      const fixType = isObject(d.usuarios) ? "WRAP_USUARIOS_ARRAY" : null;
      addFinding(entry,"ERROR","USUARIOS_INVALIDO","El campo usuarios debe existir y ser un arreglo.","$.usuarios","",fixType);
      return;
    }
    if (d.usuarios.length === 0){
      addFinding(entry,"ERROR","USUARIOS_VACIO","El RIPS no contiene usuarios.", "$.usuarios");
    }
    // Estructura raíz del RIPS contra la referencia capturada de los archivos de ejemplo.
    if (window.RIPS_SCHEMA?.root) checkSchemaKeys(entry,d,window.RIPS_SCHEMA.root,"$","la raíz del RIPS",{scope:"root"});
    checkFieldRules(entry,d,"$","root");
    // Usuarios realmente repetidos dentro del mismo archivo: mismo tipo + número de documento.
    const duplicateMap = new Map();
    d.usuarios.forEach((u,i) => {
      const tipo = clean(u?.tipoDocumentoIdentificacion);
      const doc = clean(u?.numDocumentoIdentificacion);
      if (!doc) return;
      const key = `${tipo}|${doc}`;
      if (!duplicateMap.has(key)) duplicateMap.set(key, []);
      duplicateMap.get(key).push({u,i,line:findUserLine(entry,u,i)});
    });
    for (const [key, rows] of duplicateMap.entries()) {
      if (rows.length < 2) continue;
      const [tipo, doc] = key.split("|");
      const detail = rows.map(r => `$.usuarios[${r.i}]${r.line ? ` línea ${r.line}` : ""}`).join(" y ");
      addFinding(entry,"ALERTA","USUARIO_REPETIDO",`El usuario ${tipo || ""} ${doc} está repetido dentro del mismo RIPS.`, "$.usuarios", detail);
    }

    d.usuarios.forEach((u,i) => validateUser(entry,u,i));

    // Consistencia de consecutivos de usuario dentro del mismo archivo.
    const consecutivos = d.usuarios.map(u => String(u?.consecutivo ?? "")).filter(Boolean);
    const rep = consecutivos.filter((x,i,a)=>a.indexOf(x)!==i);
    if (rep.length) addFinding(entry,"ERROR","CONSECUTIVO_USUARIO_REPETIDO","Hay consecutivos de usuario repetidos dentro del mismo RIPS.","$.usuarios[].consecutivo", [...new Set(rep)].join(", "), "RENUMBER_USER_CONSECUTIVOS");
  }

  function validateUser(entry,u,i){
    const p = `$.usuarios[${i}]`;
    if (!isObject(u)){ addFinding(entry,"ERROR","USUARIO_INVALIDO","Cada usuario debe ser un objeto.",p); return; }

    ["tipoDocumentoIdentificacion","numDocumentoIdentificacion","tipoUsuario","fechaNacimiento","codSexo"].forEach(k =>
      requireField(entry,u,k,`${p}.${k}`,k,"usuario")
    );
    checkDateFields(entry,u,p,{userIndex:i});
    // Estructura del usuario contra la referencia capturada de los archivos de ejemplo.
    if (window.RIPS_SCHEMA?.usuario) checkSchemaKeys(entry,u,window.RIPS_SCHEMA.usuario,p,"usuario",{scope:"usuario",userIndex:i});
    checkFieldRules(entry,u,p,"usuario");
    if (!isParametrized("usuario","consecutivo") && (!("consecutivo" in u) || u.consecutivo === null || u.consecutivo === "")) {
      addFinding(entry,"ERROR","CONSECUTIVO_USUARIO_VACIO","Falta el consecutivo del usuario.",`${p}.consecutivo`,"","ASSIGN_USER_CONSECUTIVO",{userIndex:i});
    }

    if (!isObject(u.servicios)){
      addFinding(entry,"ERROR","SERVICIOS_INVALIDO","El usuario debe contener el objeto servicios.",`${p}.servicios`);
      return;
    }
    checkServiceGroupNames(entry,u,i);

    const present = SERVICE_KEYS.filter(k => Array.isArray(u.servicios[k]) && u.servicios[k].length);
    if (!present.length){
      addFinding(entry,"ALERTA","USUARIO_SIN_SERVICIOS","El usuario no contiene registros en los grupos de servicios reconocidos.",`${p}.servicios`);
    }

    for (const key of SERVICE_KEYS){
      if (key in u.servicios && !Array.isArray(u.servicios[key])){
        const canWrap = isObject(u.servicios[key]);
        addFinding(entry,"ERROR","TIPO_SERVICIO_INVALIDO",`${key} debe ser un arreglo.`,`${p}.servicios.${key}`,"",canWrap?"WRAP_SERVICE_ARRAY":null,canWrap?{userIndex:i,serviceKey:key}:null);
      }
    }

    // Chequeos de campos esenciales por registro de servicio.
    checkServiceArray(entry,u,i,"consultas",["codConsulta","fechaInicioAtencion","numAutorizacion","codDiagnosticoPrincipal"]);
    checkServiceArray(entry,u,i,"procedimientos",["codProcedimiento","fechaInicioAtencion","numAutorizacion"]);
    checkServiceArray(entry,u,i,"medicamentos",["codTecnologiaSalud","nomTecnologiaSalud","cantidadMedicamento"]);
    checkServiceArray(entry,u,i,"otrosServicios",["codTecnologiaSalud","nomTecnologiaSalud","cantidadOS"]);

    // Fechas: se revisan en TODOS los grupos de servicio presentes (incluye urgencias,
    // hospitalización y recién nacidos, que no tienen chequeo de campos propio arriba).
    SERVICE_KEYS.forEach(key=>{
      const arr = u.servicios?.[key];
      if (!Array.isArray(arr)) return;
      arr.forEach((row,ri)=>{
        if (isObject(row)) {
          checkDateFields(entry,row,`$.usuarios[${i}].servicios.${key}[${ri}]`,{userIndex:i,serviceKey:key,rowIndex:ri});
          const expected = window.RIPS_SCHEMA?.servicios?.[key];
          if (expected) checkSchemaKeys(entry,row,expected,`$.usuarios[${i}].servicios.${key}[${ri}]`,`servicios.${key}`,{scope:"servicio",userIndex:i,serviceKey:key,rowIndex:ri});
          checkFieldRules(entry,row,`$.usuarios[${i}].servicios.${key}[${ri}]`,key);
        }
      });
    });

    // Cada registro de servicio (consulta, procedimiento, etc.) debe tener su propio
    // consecutivo dentro de su grupo, igual que los usuarios no pueden compartir consecutivo.
    checkServiceConsecutivos(entry,u,i);
  }

  function checkServiceConsecutivos(entry,u,ui){
    SERVICE_KEYS.forEach(key=>{
      const arr = u.servicios?.[key];
      if (!Array.isArray(arr) || arr.length < 2) return;
      const consecutivos = arr.map(r => String(r?.consecutivo ?? "")).filter(Boolean);
      const rep = consecutivos.filter((x,i,a)=>a.indexOf(x)!==i);
      if (rep.length){
        addFinding(entry,"ERROR","CONSECUTIVO_SERVICIO_REPETIDO",
          `Hay registros de ${LABELS[key]||key} con el mismo consecutivo dentro del mismo usuario.`,
          `$.usuarios[${ui}].servicios.${key}[].consecutivo`,
          [...new Set(rep)].join(", "),
          "RENUMBER_SERVICE_CONSECUTIVOS",
          {userIndex:ui, serviceKey:key});
      }
    });
  }

  function checkServiceArray(entry,u,ui,key,keys){
    const arr = u.servicios?.[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((row,ri)=>{
      if (!isObject(row)){
        addFinding(entry,"ERROR","REGISTRO_SERVICIO_INVALIDO",`Registro inválido en ${key}.`,`$.usuarios[${ui}].servicios.${key}[${ri}]`);
        return;
      }
      // Solo exigimos algunos campos cuando son canónicos y el registro existe.
      const codeField = codeFieldFor(key,row);
      if (["consultas","procedimientos"].includes(key) && !codeField.value && !isParametrized(key,codeField.field)){
        addFinding(entry,"ERROR","CODIGO_SERVICIO_AUSENTE",`Falta el código principal del servicio ${key}.`,`$.usuarios[${ui}].servicios.${key}[${ri}].${codeField.field}`);
      }
      if (!isParametrized(key,"consecutivo") && "consecutivo" in row && (row.consecutivo === null || row.consecutivo === "")){
        addFinding(entry,"ALERTA","CONSECUTIVO_SERVICIO_VACIO",`Consecutivo vacío en ${key}.`,`$.usuarios[${ui}].servicios.${key}[${ri}].consecutivo`,"","ASSIGN_SERVICE_CONSECUTIVO",{userIndex:ui,serviceKey:key,rowIndex:ri});
      }
    });
  }


  function findUserLine(entry, user, userIndex){
    if (!entry?.rawText || !user) return null;
    const doc = clean(user.numDocumentoIdentificacion);
    if (!doc) return null;
    const escaped = doc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\"numDocumentoIdentificacion\"\\s*:\s*\"${escaped}\"`, "g");
    const matches = [...entry.rawText.matchAll(re)];
    if (!matches.length) return null;
    // Si el mismo documento aparece varias veces, usa la aparición correspondiente al orden del usuario.
    const sameBefore = entry.data?.usuarios?.slice(0, userIndex + 1).filter(u => clean(u?.numDocumentoIdentificacion) === doc).length || 1;
    const match = matches[Math.min(sameBefore - 1, matches.length - 1)];
    if (!match || match.index == null) return null;
    return entry.rawText.slice(0, match.index).split(/\r?\n/).length;
  }

  // Si el usuario ya parametrizó un campo (le puso una regla propia en el panel de
  // Parametrización), esa configuración manda: se deja de aplicar la regla fija por defecto
  // para ese campo y checkFieldRules() queda como única fuente de verdad para él, así no se
  // muestra duplicado ni contradicho en Validación.
  function isParametrized(scope,field){
    return scope != null && state.fieldRules.has(ruleKey(scope,field));
  }

  function requireField(entry,obj,key,path,label,scope){
    if (isParametrized(scope,key)) return true;
    if (!(key in obj) || obj[key] === null || obj[key] === ""){
      addFinding(entry,"ERROR","CAMPO_OBLIGATORIO",`Falta ${label}.`,path);
      return false;
    }
    return true;
  }

  function addFinding(entry,severity,code,message,path,detail="",fixType=null,fixPayload=null){
    const f = {id:`${entry.id}:${entry.findings.length}:${code}`,fileId:entry.id,file:entry.name,severity,code,message,path,detail,fixType,fixPayload};
    entry.findings.push(f);
    if (severity==="ERROR") entry.status="ERROR";
    else if (severity==="ALERTA" && entry.status==="OK") entry.status="ALERTA";
  }

  function countUserServices(u){
    return SERVICE_KEYS.reduce((sum,k)=> sum + (Array.isArray(u?.servicios?.[k]) ? u.servicios[k].length : 0), 0);
  }

  function extractUsersAndServices(entry){
    if (!entry.data || !Array.isArray(entry.data.usuarios)) return;
    const factura = entry.data.numFactura || entry.data.numNota || "—";

    entry.data.usuarios.forEach((u,ui)=>{
      if (!isObject(u)) return;
      const doc = String(u?.numDocumentoIdentificacion ?? "").trim();
      const userKey = `${u?.tipoDocumentoIdentificacion||""}|${doc}`;
      let serviceCount = 0;

      SERVICE_KEYS.forEach(type=>{
        const arr = u?.servicios?.[type];
        if (!Array.isArray(arr)) return;
        arr.forEach((row,ri)=>{
          serviceCount++;
          entry.servicesCount++;
          const codeObj = codeFieldFor(type,row || {});
          const name = nameFieldFor(type,row || {});
          const value = valueFieldFor(type,row || {});
          state.serviceRows.push({
            fileId:entry.id,file:entry.name,factura,userKey,doc,userIndex:ui,type,
            typeLabel:LABELS[type]||type,code:clean(codeObj.value)||"—",name:clean(name)||"—",
            value:Number(value)||0,rowIndex:ri,raw:row
          });
        });
      });

      const user = {
        id:`${entry.id}:${ui}`,fileId:entry.id,file:entry.name,factura,index:ui,
        tipo:clean(u?.tipoDocumentoIdentificacion)||"—",doc:doc||"—",key:userKey,
        consecutivo:clean(u?.consecutivo)||"—",services:serviceCount,line:findUserLine(entry,u,ui),raw:u,
        edad:calculateAge(u?.fechaNacimiento)
      };
      entry.users.push(user);
      state.users.push(user);
    });
  }

  function codeFieldFor(type,row){
    const candidates = {
      consultas:["codConsulta","codTecnologiaSalud","codigo"],
      procedimientos:["codProcedimiento","codTecnologiaSalud","codigo"],
      urgencias:["codDiagnosticoPrincipal","codigo"],
      hospitalizacion:["codDiagnosticoPrincipal","codigo"],
      recienNacidos:["codDiagnosticoPrincipal","codigo"],
      medicamentos:["codTecnologiaSalud","codMedicamento","codigo"],
      otrosServicios:["codTecnologiaSalud","codigo"]
    }[type] || ["codigo"];
    for (const field of candidates) if (row?.[field] !== undefined && row[field] !== null && row[field] !== "") return {field,value:row[field]};
    return {field:candidates[0],value:""};
  }

  function nameFieldFor(type,row){
    // Para Consultas y Procedimientos, resolver primero el nombre oficial desde la tabla CUPS suministrada.
    if (type === "consultas" || type === "procedimientos") {
      const code = clean(codeFieldFor(type,row).value);
      if (code && window.CUPS_CATALOG?.[code]) return window.CUPS_CATALOG[code];
    }
    // Para Urgencias, Hospitalización y Recién nacidos, el código principal es un diagnóstico
    // CIE-10 (codDiagnosticoPrincipal): resolver el nombre desde la tabla CIE-10 suministrada.
    if (type === "urgencias" || type === "hospitalizacion" || type === "recienNacidos") {
      const code = clean(codeFieldFor(type,row).value);
      if (code && window.CIE10_CATALOG?.[code]) return window.CIE10_CATALOG[code];
    }
    const candidates = ["nomTecnologiaSalud","nombreTecnologiaSalud","nombre","descripcion","nomServicio","nombreServicio"];
    for (const k of candidates) if (row?.[k]) return row[k];
    return window.RIPS_CATALOGS?.codeNameFallback?.[type] || "Código no encontrado en tabla de referencia";
  }

  function valueFieldFor(type,row){
    const candidates = ["vrServicio","vrUnitMedicamento","vrUnitOS","vrUnitario","valorServicio","valor"];
    for (const k of candidates) if (row?.[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    return 0;
  }

  function rebuild(){
    state.findings = state.files.flatMap(f=>f.findings);
    buildDuplicates();
    buildCodeSummary();
    detectEntityFromNit();
    persistLightState();
    renderAll();
  }

  // Detecta automáticamente el nombre de la entidad/hospital a partir del NIT
  // (numDocumentoIdObligado) de los RIPS cargados, buscando en window.ENTITY_CATALOG
  // (tabla Excel NIT -> Nombre que subas). Si hay una sola entidad y el nombre en
  // Configuración está vacío, lo completa solo; si no, deja la lista para que elijas.
  function detectEntityFromNit(){
    const nits = new Set();
    state.files.forEach(f=>{ const nit = clean(f.data?.numDocumentoIdObligado); if (nit) nits.add(nit); });
    state.detectedEntities = [...nits].map(nit=>({nit, name: window.ENTITY_CATALOG?.[nit] || null}));
    const matches = state.detectedEntities.filter(e=>e.name);
    if (matches.length === 1 && !state.orgConfig.name){
      state.orgConfig.name = matches[0].name;
      state.orgConfig.nit = matches[0].nit;
      saveOrgConfig();
    }
  }

  function buildDuplicates(){
    const groups = new Map();
    state.users.forEach(u=>{
      if (!u.doc || u.doc==="—") return;
      if (!groups.has(u.key)) groups.set(u.key,[]);
      groups.get(u.key).push(u);
    });

    // "Repetido" es únicamente dentro del mismo archivo. Que un usuario aparezca en varios
    // archivos distintos (varias facturas/fechas de atención) es normal y NO cuenta aquí.
    const sameFile = [];
    for (const [key, rows] of groups.entries()){
      const byFile = new Map();
      rows.forEach(r=>{ if(!byFile.has(r.fileId)) byFile.set(r.fileId,[]); byFile.get(r.fileId).push(r); });
      for (const [fileId, fileRows] of byFile.entries()){
        if (fileRows.length > 1) sameFile.push({key, fileId, file:fileRows[0].file, rows:fileRows});
      }
    }

    state.sameFileDuplicates = sameFile;
    state.sameFileDuplicates.forEach(g=>{
      const gKey = `${g.fileId}::${g.key}`;
      if (!state.selectedSameFileKeep.has(gKey)) state.selectedSameFileKeep.set(gKey, bestServiceRow(g.rows).id);
    });
  }

  function bestServiceRow(rows){
    return rows.reduce((best,r)=> r.services>best.services ? r : best, rows[0]);
  }

  function buildCodeSummary(){
    const map = new Map();
    state.serviceRows.forEach(r=>{
      const key=`${r.type}|${r.code}|${r.name}`;
      if (!map.has(key)) map.set(key,{type:r.type,typeLabel:r.typeLabel,code:r.code,name:r.name,count:0,value:0,users:new Set(),files:new Set()});
      const x=map.get(key); x.count++; x.value+=r.value; x.users.add(r.userKey); x.files.add(r.fileId);
    });
    state.codeSummary=[...map.values()].map(x=>({...x,userCount:x.users.size,fileCount:x.files.size})).sort((a,b)=>b.count-a.count);
  }

  function renderAll(){
    renderMetrics(); renderServiceCards(); renderServiceBars(); renderValidation(); renderTopCodes(); renderFiles(); renderIgnoredFiles(); renderUsers(); renderServices(); renderSameFileDuplicates(); renderCorrectionSummary(); renderFindings(); renderFieldRules(); renderOrgConfig(); renderPregnancyControls(); updateFilters();
  }

  function renderIgnoredFiles(){
    const n = state.ignoredFiles.length;
    els.ignoredFilesPanel.hidden = n === 0;
    els.ignoredCountLabel.textContent = `${n} archivo(s)`;
    els.ignoredFilesBody.innerHTML = state.ignoredFiles.map(f=>`<tr><td><strong>${esc(f.shortName)}</strong><br><small>${esc(f.name)}</small></td><td><span class="pill cuv">CUV</span></td><td>${esc(f.motivo)}</td></tr>`).join("");
  }

  function renderMetrics(){
    const uniqueUsers = new Set(state.users.map(u=>u.key).filter(Boolean)).size;
    const invalidFiles = state.files.filter(f=>f.status!=="OK").length;
    const serviceTypes = new Set(state.serviceRows.map(r=>r.type)).size;
    els.mFiles.textContent=state.files.length;
    const ignoredNote = state.ignoredFiles.length?` · ${state.ignoredFiles.length} respuesta(s) CUV omitida(s)`:"";
    els.mFilesDetail.textContent=(state.files.length?`${formatBytes(state.files.reduce((a,f)=>a+f.size,0))} cargados`:"Sin archivos cargados")+ignoredNote;
    els.mUsers.textContent=state.users.length; els.mUniqueUsers.textContent=`${uniqueUsers} identificaciones únicas`;
    els.mServices.textContent=state.serviceRows.length; els.mServiceTypes.textContent=`${serviceTypes} tipos encontrados`;
    const totalDup = state.sameFileDuplicates.length;
    els.mDuplicates.textContent=totalDup;
    els.mErrors.textContent=state.findings.length; els.mInvalidFiles.textContent=`${invalidFiles} archivos con hallazgos`;
    toggleBadge(els.dupBadge,totalDup); toggleBadge(els.errorBadge,state.findings.length);
  }

  function renderServiceCards(){
    const counts = {};
    state.serviceRows.forEach(r => counts[r.type] = (counts[r.type] || 0) + 1);

    document.querySelectorAll("[data-service-card]").forEach(card => {
      const type = card.dataset.serviceCard;
      const count = counts[type] || 0;
      const target = card.querySelector("[data-service-count]") || card.querySelector("strong");
      const hint = card.querySelector("small");
      if (target) target.textContent = count;
      card.disabled = count === 0;
      card.classList.toggle("disabled", count === 0);
      if (hint) hint.textContent = count > 0 ? "Ver códigos y cantidades" : "Sin información";
    });
  }

  // Controles de embarazo: toma el campo numConsultasCPrenatal de cada registro del grupo
  // Recién nacidos (N09 en la estructura oficial) — es el conteo oficial de RIPS de cuántos
  // controles prenatales tuvo la paciente antes de ese parto.
  function buildPregnancyControls(){
    const rows = [];
    let total = 0;
    state.files.forEach(entry=>{
      const d = entry.data;
      if (!isObject(d) || !Array.isArray(d.usuarios)) return;
      d.usuarios.forEach(u=>{
        if (!isObject(u)) return;
        const arr = u.servicios?.recienNacidos;
        if (!Array.isArray(arr)) return;
        arr.forEach(row=>{
          if (!isObject(row)) return;
          const n = Number(row.numConsultasCPrenatal);
          if (isNaN(n)) return;
          rows.push({
            tipo: clean(u.tipoDocumentoIdentificacion)||"—",
            doc: clean(u.numDocumentoIdentificacion)||"—",
            controles: n,
            factura: d.numFactura || d.numNota || "—",
            file: entry.shortName
          });
          total += n;
        });
      });
    });
    rows.sort((a,b)=>b.controles-a.controles);
    return {rows, total};
  }

  function renderPregnancyControls(){
    if (!els.pregnancyBody) return;
    const {rows, total} = buildPregnancyControls();
    if (els.pregnancyTotal) els.pregnancyTotal.textContent = `${total} control(es) en total`;
    els.pregnancyBody.innerHTML = rows.length
      ? rows.map(r=>`<tr><td><strong>${esc(r.doc)}</strong></td><td>${esc(r.tipo)}</td><td>${r.controles}</td><td>${esc(r.factura)}</td><td>${esc(r.file)}</td></tr>`).join("")
      : '<tr><td colspan="5" class="empty-cell">No se encontraron registros de Recién nacidos con controles prenatales.</td></tr>';
  }

  function openServiceDetail(type){
    document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("active", x.dataset.view === "services"));
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    $("view-services").classList.add("active");
    els.pageTitle.textContent = LABELS[type] || type;
    els.pageSubtitle.textContent = `Códigos, nombres y cantidades de ${LABELS[type] || type}`;
    updateFilters();
    els.serviceFilter.value = type;
    els.serviceSearch.value = "";
    renderServices();
  }

  function renderServiceBars(){
    const counts = {};
    state.serviceRows.forEach(r=>counts[r.type]=(counts[r.type]||0)+1);
    const rows = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    if (!rows.length){els.serviceBars.innerHTML='<div class="empty-state">Carga uno o más JSON para comenzar.</div>';return}
    const max=Math.max(...rows.map(x=>x[1]));
    els.serviceBars.innerHTML=rows.map(([k,v])=>`<div class="bar-row"><span>${esc(LABELS[k]||k)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,v/max*100)}%"></div></div><strong class="bar-value">${v}</strong></div>`).join("");
  }

  function renderValidation(){
    const ok=state.files.filter(f=>f.status==="OK").length, warn=state.files.filter(f=>f.status==="ALERTA").length, err=state.files.filter(f=>f.status==="ERROR").length;
    const total=Math.max(1,state.files.length), okP=ok/total*100, warnP=warn/total*100;
    els.validationDonut.style.setProperty("--ok",okP); els.validationDonut.style.setProperty("--warn",warnP); els.validationDonut.style.setProperty("--err",100-okP-warnP);
    els.validPct.textContent=state.files.length?`${Math.round(okP)}%`:"0%"; els.lOk.textContent=ok; els.lWarn.textContent=warn; els.lErr.textContent=err;
  }

  function renderTopCodes(){
    const q=els.topCodeSearch.value.toLowerCase().trim();
    const rows=state.codeSummary.filter(x=>!q||`${x.typeLabel} ${x.code} ${x.name}`.toLowerCase().includes(q)).slice(0,30);
    els.topCodesBody.innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(x.typeLabel)}</td><td><strong>${esc(x.code)}</strong></td><td>${esc(x.name)}</td><td><strong>${x.count}</strong></td></tr>`).join(""):'<tr><td colspan="4" class="empty-cell">Sin información para mostrar.</td></tr>';
  }

  function renderFiles(){
    els.fileCountLabel.textContent=`${state.files.length} archivo(s)`;
    els.filesBody.innerHTML=state.files.length?state.files.map(f=>`<tr>
      <td><strong>${esc(f.shortName)}</strong><br><small>${esc(f.name)}</small></td>
      <td>${esc(f.data?.numFactura||f.data?.numNota||"—")}</td><td>${f.users.length}</td><td>${f.servicesCount}</td>
      <td>${statusPill(f.status)}</td>
      <td><button class="btn btn-secondary btn-sm" data-open-file="${f.id}">Ver JSON</button> <button class="btn btn-secondary btn-sm" data-txt-file="${f.id}">⇩ TXT</button></td>
    </tr>`).join(""):'<tr><td colspan="6" class="empty-cell">No hay archivos cargados.</td></tr>';
    document.querySelectorAll("[data-open-file]").forEach(b=>b.addEventListener("click",()=>openFile(b.dataset.openFile)));
    document.querySelectorAll("[data-txt-file]").forEach(b=>b.addEventListener("click",()=>downloadTxtForFileId(b.dataset.txtFile)));
  }

  function renderUsers(){
    const q=els.userSearch.value.toLowerCase().trim();
    const rows=state.users.filter(u=>!q||`${u.doc} ${u.tipo} ${u.file} ${u.factura}`.toLowerCase().includes(q));
    els.usersBody.innerHTML=rows.length?rows.map(u=>`<tr><td><strong>${esc(u.doc)}</strong></td><td>${esc(u.tipo)}</td><td>${u.edad===null?"—":u.edad}</td><td>${esc(u.consecutivo)}</td><td>${u.services}</td><td>${esc(u.factura)}</td><td>${esc(u.file)}</td></tr>`).join(""):'<tr><td colspan="7" class="empty-cell">No hay usuarios cargados.</td></tr>';
  }

  function renderServices(){
    const q=els.serviceSearch.value.toLowerCase().trim(), type=els.serviceFilter.value;
    const rows=state.codeSummary.filter(x=>(!type||x.type===type)&&(!q||`${x.typeLabel} ${x.code} ${x.name}`.toLowerCase().includes(q)));
    els.servicesBody.innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(x.typeLabel)}</td><td><strong>${esc(x.code)}</strong></td><td>${esc(x.name)}</td><td>${x.count}</td></tr>`).join(""):'<tr><td colspan="4" class="empty-cell">No hay servicios cargados.</td></tr>';
  }

  function renderSameFileDuplicates(){
    if(!state.sameFileDuplicates.length){els.sameFileDuplicatesList.innerHTML='<div class="empty-state panel">No se detectaron usuarios repetidos dentro de un mismo archivo.</div>';return}
    els.sameFileDuplicatesList.innerHTML=state.sameFileDuplicates.map((g,gi)=>{
      const gKey=`${g.fileId}::${g.key}`;
      const keepId=state.selectedSameFileKeep.get(gKey);
      return `<article class="dup-card">
      <div class="dup-head"><div><strong>${esc(g.rows[0].tipo)} ${esc(g.rows[0].doc)}</strong><p>${g.rows.length} veces en <strong>${esc(g.file)}</strong></p></div><span class="pill warn">REPETIDO EN EL MISMO ARCHIVO</span></div>
      <div class="dup-options">${g.rows.map(u=>`<label class="dup-option ${keepId===u.id?"selected":""}">
        <input type="radio" name="samefile-${gi}" value="${u.id}" data-samefile-key="${escAttr(gKey)}" ${keepId===u.id?"checked":""}>
        <span>usuarios[${u.index}] · ${u.services} servicio(s) · consecutivo ${esc(u.consecutivo)}${u.line?` · línea ${u.line}`:""}</span>
        <span>${keepId===u.id?'<span class="pill ok">CONSERVAR</span>':'<span class="pill">QUITAR</span>'}</span>
      </label>`).join("")}</div>
      <div class="dup-actions"><button class="btn btn-primary btn-sm" data-apply-samefile="${escAttr(gKey)}">Quitar duplicado(s) de este archivo</button></div>
    </article>`;
    }).join("");
    document.querySelectorAll("[data-samefile-key]").forEach(r=>r.addEventListener("change",()=>{
      state.selectedSameFileKeep.set(r.dataset.samefileKey,r.value); renderSameFileDuplicates();
    }));
    document.querySelectorAll("[data-apply-samefile]").forEach(b=>b.addEventListener("click",()=>{
      applySameFileDuplicate(b.dataset.applySamefile);
    }));
  }

  // Campo de fecha que identifica cuándo ocurrió cada tipo de servicio; junto con el código
  // principal (codeFieldFor) forma la "firma" que decide si dos registros son el MISMO
  // servicio (mismo código y misma fecha/hora exacta) o servicios distintos que deben conservarse.
  const SERVICE_DATE_FIELD = {
    consultas:"fechaInicioAtencion", procedimientos:"fechaInicioAtencion",
    urgencias:"fechaInicioAtencion", hospitalizacion:"fechaInicioAtencion",
    recienNacidos:"fechaNacimiento", medicamentos:"fechaDispensAdmon",
    otrosServicios:"fechaSuministroTecnologia"
  };
  function serviceSignature(type,row){
    const code = clean(codeFieldFor(type,row).value);
    const date = clean(row?.[SERVICE_DATE_FIELD[type]]);
    return `${code}||${date}`;
  }

  // Al quitar un usuario duplicado dentro del mismo archivo, en vez de descartar todos sus
  // servicios, se fusionan dentro del usuario que se conserva los que sean genuinamente
  // distintos (código o fecha/hora distintos); solo se descartan los que sean el mismo
  // servicio exacto (mismo código Y misma fecha/hora) porque esos sí son el duplicado real.
  function mergeDuplicateUserServices(keepUser, discardUsers){
    let merged = 0;
    SERVICE_KEYS.forEach(type=>{
      const keepArr = Array.isArray(keepUser.servicios?.[type]) ? keepUser.servicios[type] : [];
      const seen = new Set(keepArr.map(r=>serviceSignature(type,r)));
      discardUsers.forEach(du=>{
        const discardArr = du?.servicios?.[type];
        if (!Array.isArray(discardArr)) return;
        discardArr.forEach(row=>{
          if (!isObject(row)) return;
          const sig = serviceSignature(type,row);
          if (seen.has(sig)) return; // mismo código y misma fecha/hora: es el duplicado real, se descarta.
          if (!isObject(keepUser.servicios)) keepUser.servicios = {};
          if (!Array.isArray(keepUser.servicios[type])) keepUser.servicios[type] = [];
          keepUser.servicios[type].push(row);
          seen.add(sig);
          merged++;
        });
      });
    });
    return merged;
  }

  function applySameFileDuplicate(gKey){
    const [fileId, key] = splitGroupKey(gKey);
    const group = state.sameFileDuplicates.find(g=>g.fileId===fileId && g.key===key);
    const entry = state.files.find(f=>f.id===fileId);
    if (!group || !entry?.data || !Array.isArray(entry.data.usuarios)) return;
    const keepId = state.selectedSameFileKeep.get(gKey) || bestServiceRow(group.rows).id;
    const keepRow = group.rows.find(r=>r.id===keepId);
    const discardRows = group.rows.filter(r=>r.id!==keepId);
    if (!keepRow || !discardRows.length) return toast("No hay nada para quitar en este grupo");
    const keepUser = entry.data.usuarios[keepRow.index];
    const discardUsers = discardRows.map(r=>entry.data.usuarios[r.index]);
    const merged = isObject(keepUser) ? mergeDuplicateUserServices(keepUser, discardUsers) : 0;
    const removeIndexes = new Set(discardRows.map(r=>r.index));
    entry.data.usuarios = entry.data.usuarios.filter((u,i)=>!removeIndexes.has(i));
    entry.correctionsApplied = (entry.correctionsApplied||0)+1;
    entry.rawText = JSON.stringify(entry.data,null,2);
    revalidateAll();
    toast(merged
      ? `Usuario duplicado eliminado de ${entry.shortName} · ${merged} servicio(s) distinto(s) conservado(s)`
      : `Usuario duplicado eliminado de ${entry.shortName}`);
  }

  function removeAllSameFileDuplicates(){
    if (!state.sameFileDuplicates.length) return toast("No hay usuarios repetidos dentro del mismo archivo");
    let removed = 0, merged = 0;
    // Se agrupa por archivo para no invalidar índices al remover más de un grupo del mismo archivo en la misma pasada.
    const byFile = new Map();
    state.sameFileDuplicates.forEach(g=>{ if(!byFile.has(g.fileId)) byFile.set(g.fileId,[]); byFile.get(g.fileId).push(g); });
    for (const [fileId, groups] of byFile.entries()){
      const entry = state.files.find(f=>f.id===fileId);
      if (!entry?.data || !Array.isArray(entry.data.usuarios)) continue;
      const removeIndexes = new Set();
      groups.forEach(g=>{
        const gKey = `${g.fileId}::${g.key}`;
        const keepId = state.selectedSameFileKeep.get(gKey) || bestServiceRow(g.rows).id;
        const keepRow = g.rows.find(r=>r.id===keepId);
        const discardRows = g.rows.filter(r=>r.id!==keepId);
        if (!keepRow || !discardRows.length) return;
        const keepUser = entry.data.usuarios[keepRow.index];
        const discardUsers = discardRows.map(r=>entry.data.usuarios[r.index]);
        if (isObject(keepUser)) merged += mergeDuplicateUserServices(keepUser, discardUsers);
        discardRows.forEach(r=>removeIndexes.add(r.index));
      });
      if (!removeIndexes.size) continue;
      entry.data.usuarios = entry.data.usuarios.filter((u,i)=>!removeIndexes.has(i));
      entry.correctionsApplied = (entry.correctionsApplied||0)+1;
      entry.rawText = JSON.stringify(entry.data,null,2);
      removed += removeIndexes.size;
    }
    revalidateAll();
    toast(`${removed} usuario(s) duplicado(s) eliminado(s)${merged?` · ${merged} servicio(s) distinto(s) conservado(s)`:""}`);
  }

  function splitGroupKey(gKey){
    const idx = gKey.indexOf("::");
    return [gKey.slice(0,idx), gKey.slice(idx+2)];
  }

  function renderCorrectionSummary(){
    const auto = state.findings.filter(f=>!!f.fixType).length;
    const manual = state.findings.length - auto;
    els.mAutoFixable.textContent = auto;
    els.mManualFix.textContent = manual;
    els.btnFixAll.disabled = auto === 0;
    els.btnDownloadCorrected.disabled = !state.files.some(f=>f.data && f.correctionsApplied>0);
  }

  function renderFindings(){
    const sev=els.severityFilter.value;
    const rows=state.findings.filter(f=>!sev||f.severity===sev);
    els.errorsList.innerHTML=rows.length?rows.map(f=>`<div class="validation-item ${f.severity.toLowerCase()}">
      <span class="sev">${f.severity}</span>
      <div><strong>${esc(f.code)} · ${esc(f.message)}</strong><p>${esc(f.file)}${f.detail?` · ${esc(f.detail)}`:""}</p>${f.fixType?'<span class="fix-note">Corrección automática disponible</span>':'<span class="manual-note">Revisión manual</span>'}</div>
      <span class="validation-path">${esc(f.path)}</span>
      <div class="validation-actions">${f.fixType?`<button class="btn btn-primary btn-sm" data-fix-id="${escAttr(f.id)}">✓ Corregir</button>`:'<span class="manual-note">No automatizable</span>'}</div>
    </div>`).join(""):'<div class="empty-state">Sin hallazgos.</div>';
    document.querySelectorAll("[data-fix-id]").forEach(btn=>btn.addEventListener("click",()=>fixOne(btn.dataset.fixId)));
  }

  function fixOne(id){
    const finding = state.findings.find(f=>f.id===id);
    if (!finding || !finding.fixType) return;
    const changed = applyCorrection(finding);
    if (!changed) return toast("No fue posible aplicar esta corrección automáticamente");
    revalidateAll();
    toast("Corrección aplicada y RIPS revalidado");
  }

  function fixAllSafe(){
    if (!state.findings.some(f=>!!f.fixType)) return toast("No hay hallazgos autocorregibles");
    let changed=0, pass=0;
    while(pass<8){
      const fixable=[...state.findings].filter(f=>!!f.fixType);
      if(!fixable.length) break;
      let changedThisPass=0;
      for(const f of fixable){ if(applyCorrection(f,true)){ changed++; changedThisPass++; } }
      if(!changedThisPass) break;
      revalidateAll();
      pass++;
    }
    toast(`${changed} corrección(es) automáticas aplicadas en ${pass} pasada(s)`);
  }

  function applyCorrection(finding, silent=false){
    const entry = state.files.find(x=>x.id===finding.fileId);
    if (!entry?.data) return false;
    const p = finding.fixPayload || {};
    let changed=false;

    switch(finding.fixType){
      case "WRAP_USUARIOS_ARRAY":
        if (isObject(entry.data.usuarios)) { entry.data.usuarios=[entry.data.usuarios]; changed=true; }
        break;
      case "WRAP_SERVICE_ARRAY": {
        const u=entry.data.usuarios?.[p.userIndex];
        const current=u?.servicios?.[p.serviceKey];
        if (u?.servicios && isObject(current)) { u.servicios[p.serviceKey]=[current]; changed=true; }
        break;
      }
      case "ASSIGN_USER_CONSECUTIVO": {
        const u=entry.data.usuarios?.[p.userIndex];
        if (u && (u.consecutivo===null || u.consecutivo==="" || u.consecutivo===undefined)) { u.consecutivo=p.userIndex+1; changed=true; }
        break;
      }
      case "RENUMBER_USER_CONSECUTIVOS":
        if (Array.isArray(entry.data.usuarios)) { entry.data.usuarios.forEach((u,i)=>{ if(isObject(u)) u.consecutivo=i+1; }); changed=true; }
        break;
      case "RENUMBER_SERVICE_CONSECUTIVOS": {
        const arr=entry.data.usuarios?.[p.userIndex]?.servicios?.[p.serviceKey];
        if (Array.isArray(arr)) { arr.forEach((row,i)=>{ if(isObject(row)) row.consecutivo=i+1; }); changed=true; }
        break;
      }
      case "ASSIGN_SERVICE_CONSECUTIVO": {
        const arr=entry.data.usuarios?.[p.userIndex]?.servicios?.[p.serviceKey];
        const row=arr?.[p.rowIndex];
        if (Array.isArray(arr) && row && (row.consecutivo===null || row.consecutivo==="" || row.consecutivo===undefined)) {
          const used=new Set(arr.map(x=>Number(x?.consecutivo)).filter(Number.isFinite));
          let n=1; while(used.has(n)) n++;
          row.consecutivo=n; changed=true;
        }
        break;
      }
      case "PAD_DATE_FIELD": {
        const target = resolveDateTarget(entry,p);
        if (target && p.normalized) { target.obj[p.field]=p.normalized; changed=true; }
        break;
      }
      case "EDIT_DATE_FIELD": {
        // El sistema no puede adivinar con seguridad qué quiso decir una fecha estructuralmente
        // inválida (ej. "2026-0-22"), así que en corrección individual se pide el valor correcto;
        // en corrección masiva (silent) se omite para no interrumpir con varios cuadros de diálogo.
        if (silent) break;
        const target = resolveDateTarget(entry,p);
        if (!target) break;
        const current = target.obj[p.field];
        const input = window.prompt(`Corrige el campo "${p.field}" (formato AAAA-MM-DD o AAAA-MM-DD HH:MM):`, current);
        if (input===null) break;
        const info = analyzeDateStr(input);
        if (!info.valid){ toast(`Fecha inválida: ${info.reason}`); break; }
        target.obj[p.field]=info.normalized; changed=true;
        break;
      }
      case "RENAME_FIELD_KEY": {
        const target = resolveSchemaTarget(entry,p);
        if (isObject(target) && p.oldKey in target && !(p.newKey in target)) {
          target[p.newKey]=target[p.oldKey]; delete target[p.oldKey]; changed=true;
        }
        break;
      }
      case "ADD_MISSING_FIELD": {
        const target = resolveSchemaTarget(entry,p);
        if (isObject(target) && !(p.key in target)) { target[p.key]=null; changed=true; }
        break;
      }
      case "REMOVE_UNKNOWN_FIELD": {
        // Quitar un campo desconocido puede perder datos, así que solo se aplica con
        // corrección individual (no en la corrección masiva/silenciosa).
        if (silent) break;
        const target = resolveSchemaTarget(entry,p);
        if (isObject(target) && p.key in target) { delete target[p.key]; changed=true; }
        break;
      }
      case "RENAME_SERVICE_GROUP": {
        const u = entry.data.usuarios?.[p.userIndex];
        if (isObject(u?.servicios) && p.oldKey in u.servicios && !(p.newKey in u.servicios)) {
          u.servicios[p.newKey]=u.servicios[p.oldKey]; delete u.servicios[p.oldKey]; changed=true;
        }
        break;
      }
    }
    if (changed) {
      entry.correctionsApplied=(entry.correctionsApplied||0)+1;
      entry.rawText=JSON.stringify(entry.data,null,2);
    }
    return changed;
  }

  function revalidateAll(){
    state.users=[]; state.serviceRows=[]; state.codeSummary=[]; state.findings=[]; state.sameFileDuplicates=[];
    for (const entry of state.files){
      entry.findings=[]; entry.users=[]; entry.servicesCount=0; entry.status="OK";
      if (entry.data) {
        entry.rawText=JSON.stringify(entry.data,null,2);
        validateRips(entry);
        extractUsersAndServices(entry);
      } else if (entry.parseError) {
        addFinding(entry,"ERROR","JSON_INVALIDO","El archivo no contiene JSON válido.","$",entry.parseError);
      }
    }
    rebuild();
  }

  function downloadCorrectedFiles(){
    const rows=state.files.filter(f=>f.data && f.correctionsApplied>0);
    if(!rows.length) return toast("Todavía no hay archivos corregidos");
    const entries=rows.map(f=>({
      name:`${f.shortName.replace(/\.json$/i,"")}_CORREGIDO.json`,
      text:JSON.stringify(f.data,null,2)
    }));
    const zip=createStoredZip(entries);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(zip);
    a.download="RIPS_CORREGIDOS_LOTE.zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    toast(`${rows.length} archivo(s) corregido(s) empaquetados en un ZIP`);
  }

  function createStoredZip(entries){
    const encoder=new TextEncoder();
    const locals=[], centrals=[];
    let offset=0;
    const now=new Date();
    const dosTime=((now.getHours()&31)<<11)|((now.getMinutes()&63)<<5)|((Math.floor(now.getSeconds()/2))&31);
    const dosDate=(((now.getFullYear()-1980)&127)<<9)|(((now.getMonth()+1)&15)<<5)|(now.getDate()&31);

    for(const entry of entries){
      const name=encoder.encode(entry.name);
      const data=encoder.encode(entry.text);
      const crc=crc32(data);
      const local=new Uint8Array(30+name.length+data.length);
      const lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true); lv.setUint16(4,20,true); lv.setUint16(6,0x0800,true); lv.setUint16(8,0,true);
      lv.setUint16(10,dosTime,true); lv.setUint16(12,dosDate,true); lv.setUint32(14,crc,true); lv.setUint32(18,data.length,true); lv.setUint32(22,data.length,true);
      lv.setUint16(26,name.length,true); lv.setUint16(28,0,true); local.set(name,30); local.set(data,30+name.length);
      locals.push(local);

      const central=new Uint8Array(46+name.length);
      const cv=new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x0800,true); cv.setUint16(10,0,true);
      cv.setUint16(12,dosTime,true); cv.setUint16(14,dosDate,true); cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true);
      cv.setUint16(28,name.length,true); cv.setUint16(30,0,true); cv.setUint16(32,0,true); cv.setUint16(34,0,true); cv.setUint16(36,0,true); cv.setUint32(38,0,true); cv.setUint32(42,offset,true);
      central.set(name,46); centrals.push(central); offset+=local.length;
    }

    const centralSize=centrals.reduce((a,x)=>a+x.length,0);
    const end=new Uint8Array(22); const ev=new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true); ev.setUint16(4,0,true); ev.setUint16(6,0,true); ev.setUint16(8,entries.length,true); ev.setUint16(10,entries.length,true);
    ev.setUint32(12,centralSize,true); ev.setUint32(16,offset,true); ev.setUint16(20,0,true);
    return new Blob([...locals,...centrals,end],{type:"application/zip"});
  }

  function crc32(bytes){
    let crc=0xffffffff;
    for(let i=0;i<bytes.length;i++){
      crc^=bytes[i];
      for(let j=0;j<8;j++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^0xffffffff)>>>0;
  }

  function updateFilters(){
    const selected=els.serviceFilter.value;
    const types=[...new Set(state.serviceRows.map(r=>r.type))].sort();
    els.serviceFilter.innerHTML='<option value="">Todos los servicios</option>'+types.map(t=>`<option value="${escAttr(t)}">${esc(LABELS[t]||t)}</option>`).join("");
    if(types.includes(selected)) els.serviceFilter.value=selected;
  }

  function openFile(id){
    const f=state.files.find(x=>x.id===id); if(!f)return;
    state.dialogFile=f; els.dialogTitle.textContent=f.shortName; els.dialogMeta.textContent=`${f.users.length} usuario(s) · ${f.servicesCount} servicio(s) · ${f.findings.length} hallazgo(s)`;
    els.jsonPreview.textContent=f.data?JSON.stringify(f.data,null,2):`ERROR JSON\n${f.parseError}`;
    els.btnDownloadJson.disabled=!f.data;
    els.jsonDialog.showModal();
  }

  function exportServicesCsv(){
    if(!state.codeSummary.length)return toast("No hay servicios para exportar");
    const rows=[["TIPO_SERVICIO","CODIGO","NOMBRE_DESCRIPCION","CANTIDAD","USUARIOS","ARCHIVOS","VALOR_TOTAL"]];
    state.codeSummary.forEach(x=>rows.push([x.typeLabel,x.code,x.name,x.count,x.userCount,x.fileCount,x.value]));
    const csv="\ufeff"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n");
    downloadBlob("resumen_rips_0948.csv",csv,"text/csv;charset=utf-8");
  }

  // ===== Configuración (nombre del hospital/centro de salud, NIT) =====
  // Se usa para nombrar y organizar los archivos generados (TXT, PDF): por trimestre y por
  // el nombre de la institución, tal como se pidió.
  function loadOrgConfig(){
    try{
      const raw = localStorage.getItem("rips0948:orgConfig");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed){
        if (parsed.signerName === undefined) parsed.signerName = "MARILUZ CABRERA";
        if (parsed.reportStyle === undefined) parsed.reportStyle = "default";
        return parsed;
      }
      return {name:"", nit:"", trimestre:"1", year:String(new Date().getFullYear()), reportName:"", signerName:"MARILUZ CABRERA", reportStyle:"default"};
    }catch{ return {name:"", nit:"", trimestre:"1", year:String(new Date().getFullYear()), reportName:"", signerName:"MARILUZ CABRERA", reportStyle:"default"}; }
  }
  function saveOrgConfig(){
    try{ localStorage.setItem("rips0948:orgConfig", JSON.stringify(state.orgConfig)); }catch{}
  }
  function saveIndicatorCodes(){
    try{ localStorage.setItem("rips0948:indicatorCodes", JSON.stringify(state.indicatorCodes)); }catch{}
  }
  function saveIndicatorAges(){
    try{ localStorage.setItem("rips0948:indicatorAges", JSON.stringify(state.indicatorAges)); }catch{}
  }
  function saveDec2193(){
    try{ localStorage.setItem("rips0948:dec2193", JSON.stringify(state.dec2193)); }catch{}
  }
  function saveIndicatorManual(){
    try{ localStorage.setItem("rips0948:indicatorManual", JSON.stringify(state.indicatorManual)); }catch{}
  }
  // Cuenta, en TODOS los RIPS cargados, cuántos registros de "group" (consultas/procedimientos)
  // tienen su código principal ("field") dentro de la lista "codes" configurada, y —si se dio
  // un rango de edad— cuyo usuario tenga esa edad (calculada desde fechaNacimiento) dentro del
  // rango [ageMin, ageMax] inclusive. Sin rango, no se filtra por edad (todas las edades).
  function countByCodes(group, field, codes, ageRange){
    if (!Array.isArray(codes) || !codes.length) return 0;
    const set = new Set(codes.map(c=>String(c).trim()).filter(Boolean));
    if (!set.size) return 0;
    const hasAgeFilter = ageRange && (ageRange.min!=null || ageRange.max!=null);
    let count = 0;
    state.files.forEach(entry=>{
      const d = entry.data;
      if (!isObject(d) || !Array.isArray(d.usuarios)) return;
      d.usuarios.forEach(u=>{
        if (!isObject(u)) return;
        if (hasAgeFilter){
          const edad = calculateAge(u.fechaNacimiento);
          if (edad===null) return;
          if (ageRange.min!=null && edad < Number(ageRange.min)) return;
          if (ageRange.max!=null && edad > Number(ageRange.max)) return;
        }
        const arr = u.servicios?.[group];
        if (!Array.isArray(arr)) return;
        arr.forEach(row=>{
          if (isObject(row) && set.has(clean(row[field]))) count++;
        });
      });
    });
    return count;
  }
  function computeIndicators(){
    const values = {};
    INDICATOR_DEFS.forEach(d=>{
      const manual = state.indicatorManual[d.key];
      if (manual && manual.value !== null && manual.value !== undefined && manual.value !== ""){
        values[d.key] = Number(manual.value) || 0;
      } else {
        values[d.key] = countByCodes(d.group, d.field, state.indicatorCodes[d.key], state.indicatorAges[d.key]);
      }
    });
    return values;
  }
  function renderOrgConfig(){
    if (els.cfgOrgName) els.cfgOrgName.value = state.orgConfig.name || "";
    if (els.cfgOrgNit) els.cfgOrgNit.value = state.orgConfig.nit || "";
    if (els.cfgTrimestre) els.cfgTrimestre.value = state.orgConfig.trimestre || "1";
    if (els.cfgYear) els.cfgYear.value = state.orgConfig.year || new Date().getFullYear();
    if (els.cfgSignerName) els.cfgSignerName.value = state.orgConfig.signerName || "";
    if (els.cfgReportStyle) els.cfgReportStyle.value = state.orgConfig.reportStyle || "default";
    if (els.reportFileNamePreview) els.reportFileNamePreview.textContent = "Se guardará como: " + buildReportFileName();
    renderIndicatorConfig();
    renderDetectedEntities();
  }

  function renderDetectedEntities(){
    if (!els.detectedEntities) return;
    const list = state.detectedEntities || [];
    if (!list.length){ els.detectedEntities.innerHTML = ""; return; }
    els.detectedEntities.innerHTML = `<div class="panel" style="margin-top:12px">
      <p style="font-size:12px;font-weight:800;margin-bottom:8px">Entidad detectada por NIT en los RIPS cargados:</p>
      ${list.map(e=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px">
        <span>NIT <strong>${esc(e.nit)}</strong> → ${e.name?esc(e.name):'<span style="color:var(--muted)">no está en el catálogo (sube el Excel con esa tabla)</span>'}</span>
        ${e.name?`<button class="btn btn-secondary btn-sm" data-apply-entity="${escAttr(e.nit)}" data-apply-entity-name="${escAttr(e.name)}">Usar este nombre</button>`:""}
      </div>`).join("")}
    </div>`;
    document.querySelectorAll("[data-apply-entity]").forEach(b=>b.addEventListener("click",()=>{
      state.orgConfig.name = b.dataset.applyEntityName;
      state.orgConfig.nit = b.dataset.applyEntity;
      saveOrgConfig();
      renderOrgConfig();
      toast(`Hospital configurado: ${b.dataset.applyEntityName}`);
    }));
  }
  function renderIndicatorConfig(){
    if (!els.indicatorConfigList) return;
    const values = computeIndicators();
    els.indicatorConfigList.innerHTML = INDICATOR_DEFS.map(d=>{
      const codes = (state.indicatorCodes[d.key]||[]).join(", ");
      const needsConfirm = !state.indicatorCodes[d.key]?.length;
      const age = state.indicatorAges[d.key] || {min:null,max:null};
      const manual = state.indicatorManual[d.key] || {value:null,locked:false};
      const isManual = manual.value !== null && manual.value !== undefined && manual.value !== "";
      return `<div class="field-rule-row" style="grid-template-columns:minmax(0,1.2fr) 1fr 60px 60px 90px 150px">
        <div class="field-rule-name"><strong>${esc(d.label)}</strong><span>${LABELS[d.group]||d.group} · campo ${esc(d.field)}${needsConfirm?' · <span style="color:#ad3838">falta confirmar código</span>':""}</span></div>
        <input class="input" style="font-size:11px" type="text" placeholder="Códigos separados por coma" value="${escAttr(codes)}" data-indicator-codes="${escAttr(d.key)}" ${manual.locked?"disabled":""}>
        <input class="input" style="font-size:11px" type="number" placeholder="Edad mín" value="${age.min??""}" data-indicator-age-min="${escAttr(d.key)}" ${manual.locked?"disabled":""}>
        <input class="input" style="font-size:11px" type="number" placeholder="Edad máx" value="${age.max??""}" data-indicator-age-max="${escAttr(d.key)}" ${manual.locked?"disabled":""}>
        <input class="input" style="font-size:11px" type="number" placeholder="Manual" value="${manual.value??""}" data-manual-value="${escAttr(d.key)}" ${manual.locked?"disabled":""} title="Escribe el valor a mano; si lo escribes, reemplaza el cálculo automático">
        <div style="display:flex;align-items:center;gap:4px">
          <button type="button" class="icon-btn-sm" data-manual-edit="${escAttr(d.key)}" title="Editar / desbloquear">✎</button>
          <button type="button" class="icon-btn-sm" data-manual-delete="${escAttr(d.key)}" title="Eliminar valor manual (vuelve a automático)">🗑</button>
          <button type="button" class="icon-btn-sm ${manual.locked?"locked":""}" data-manual-lock="${escAttr(d.key)}" title="${manual.locked?"Desbloquear":"Bloquear"}">${manual.locked?"🔒":"🔓"}</button>
          <span class="pill" style="margin-left:2px">${isManual?"MANUAL":"AUTO"}: <strong>${values[d.key]}</strong></span>
        </div>
      </div>`;
    }).join("");
    document.querySelectorAll("[data-indicator-codes]").forEach(inp=>inp.addEventListener("change",()=>{
      const key = inp.dataset.indicatorCodes;
      state.indicatorCodes[key] = inp.value.split(",").map(s=>s.trim()).filter(Boolean);
      saveIndicatorCodes();
      renderIndicatorConfig();
    }));
    document.querySelectorAll("[data-indicator-age-min],[data-indicator-age-max]").forEach(inp=>inp.addEventListener("change",()=>{
      const key = inp.dataset.indicatorAgeMin || inp.dataset.indicatorAgeMax;
      const current = state.indicatorAges[key] || {min:null,max:null};
      const val = inp.value===""?null:Number(inp.value);
      if (inp.dataset.indicatorAgeMin) current.min = val; else current.max = val;
      state.indicatorAges[key] = current;
      saveIndicatorAges();
      renderIndicatorConfig();
    }));
    document.querySelectorAll("[data-manual-value]").forEach(inp=>inp.addEventListener("change",()=>{
      const key = inp.dataset.manualValue;
      const current = state.indicatorManual[key] || {value:null,locked:false};
      current.value = inp.value===""?null:Number(inp.value);
      state.indicatorManual[key] = current;
      saveIndicatorManual();
      renderIndicatorConfig();
    }));
    document.querySelectorAll("[data-manual-edit]").forEach(btn=>btn.addEventListener("click",()=>{
      const key = btn.dataset.manualEdit;
      const current = state.indicatorManual[key] || {value:null,locked:false};
      current.locked = false;
      state.indicatorManual[key] = current;
      saveIndicatorManual();
      renderIndicatorConfig();
      setTimeout(()=>document.querySelector(`[data-manual-value="${key}"]`)?.focus(), 0);
    }));
    document.querySelectorAll("[data-manual-delete]").forEach(btn=>btn.addEventListener("click",()=>{
      const key = btn.dataset.manualDelete;
      state.indicatorManual[key] = {value:null,locked:false};
      saveIndicatorManual();
      renderIndicatorConfig();
    }));
    document.querySelectorAll("[data-manual-lock]").forEach(btn=>btn.addEventListener("click",()=>{
      const key = btn.dataset.manualLock;
      const current = state.indicatorManual[key] || {value:null,locked:false};
      current.locked = !current.locked;
      state.indicatorManual[key] = current;
      saveIndicatorManual();
      renderIndicatorConfig();
    }));
    if (els.dec2193List){
      els.dec2193List.innerHTML = INDICATOR_DEFS.map(d=>`<div class="field-rule-row" style="grid-template-columns:minmax(0,1.6fr) 140px">
        <div class="field-rule-name"><strong>${esc(d.label)}</strong></div>
        <input class="input" style="font-size:11px" type="number" value="${state.dec2193[d.key]||0}" data-dec2193="${escAttr(d.key)}">
      </div>`).join("");
      document.querySelectorAll("[data-dec2193]").forEach(inp=>inp.addEventListener("change",()=>{
        state.dec2193[inp.dataset.dec2193] = Number(inp.value)||0;
        saveDec2193();
      }));
    }
  }
  // Nombre exacto pedido: "MC 2° Trim26RIPSJsonrRes948 vs ProDec219 Items Odontologia NOMBRE.pdf"
  // El trimestre (1°-4°) y el año se toman de Configuración, no se calculan solos.
  function buildReportFileName(){
    const trimestre = state.orgConfig.trimestre || "1";
    const yy = String(state.orgConfig.year || new Date().getFullYear()).slice(-2);
    const nombre = (state.orgConfig.name || "").trim();
    return `MC ${trimestre}° Trim${yy}RIPSJsonrRes948 vs ProDec219 Items Odontologia ${nombre}.pdf`;
  }

  // ===== Convertidor RIPS JSON -> TXT (un archivo delimitado por comas por grupo) =====
  // Un usuario no puede repetirse, así que cada fila de servicio queda vinculada a su
  // usuario por tipo+número de documento, además del obligado/factura del archivo.
  const SERVICE_TXT_CODE = {consultas:"AC",procedimientos:"AP",urgencias:"AU",hospitalizacion:"AH",recienNacidos:"AN",medicamentos:"AM",otrosServicios:"AT"};
  const TXT_CODE_ORDER = ["CT","US","AC","AP","AU","AH","AN","AM","AT"];
  function txtCell(v){
    if (v===null || v===undefined) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }
  function quarterLabel(dateStr){
    const m = String(dateStr||"").match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    return `T${Math.ceil(Number(m[2])/3)}-${m[1]}`;
  }
  function representativeQuarter(entry){
    const d = entry.data;
    if (!isObject(d) || !Array.isArray(d.usuarios)) return null;
    for (const u of d.usuarios){
      if (!isObject(u)) continue;
      for (const key of SERVICE_KEYS){
        const arr = u.servicios?.[key];
        if (!Array.isArray(arr)) continue;
        for (const row of arr){
          const q = quarterLabel(row?.[SERVICE_DATE_FIELD[key]]);
          if (q) return q;
        }
      }
    }
    return null;
  }
  function fileBaseName(entry){
    const org = safeFile(state.orgConfig?.name || "");
    const trimestre = state.orgConfig?.trimestre || "1";
    const yy = String(state.orgConfig?.year || new Date().getFullYear()).slice(-2);
    const q = `${trimestre}Trim${yy}`;
    const factura = safeFile(entry.data?.numFactura || entry.data?.numNota || entry.shortName.replace(/\.json$/i,""));
    return [org, q, factura].filter(Boolean).join("_");
  }
  // Estructura oficial exacta de salida TXT por grupo (ESDTRUCTURA_DE_SALIDA_JSON.xlsx):
  // [nombre de columna oficial, de dónde sale el dato, campo]. "root" = raíz del RIPS JSON,
  // "usuario" = objeto usuario, "row" = el registro de servicio (o el propio usuario para US).
  const TXT_LAYOUTS = {
    US: [
      ["U01_NumFactura","root","numFactura"],["U02_TipDocIdent","usuario","tipoDocumentoIdentificacion"],
      ["U03_NumDocIdent","usuario","numDocumentoIdentificacion"],["U04_TipoUuario","usuario","tipoUsuario"],
      ["U05_FechaNaci","usuario","fechaNacimiento"],["U06_CodSexo","usuario","codSexo"],
      ["U07_CodPaisResid","usuario","codPaisResidencia"],["U08_CodMunResiD","usuario","codMunicipioResidencia"],
      ["U09_CodZonaTerriResid","usuario","codZonaTerritorialResidencia"],["U10_Incapacidad","usuario","incapacidad"],
      ["U11_Consecutivo","usuario","consecutivo"],["U12_CodPaisOrigen","usuario","codPaisOrigen"]
    ],
    AC: [
      ["C01_NumFactura","root","numFactura"],["C02_CodPres_REPS","row","codPrestador"],
      ["C03_US_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["C04_US_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["C05_FechaIniAten","row","fechaInicioAtencion"],["C06_NumAuto","row","numAutorizacion"],
      ["C07_CodCUPS","row","codConsulta"],["C08_ModaGrupoServTecSal","row","modalidadGrupoServicioTecSal"],
      ["C09_GrupoServi","row","grupoServicios"],["C10_codServicio","row","codServicio"],
      ["C11_finaTecSalud","row","finalidadTecnologiaSalud"],["C12_causaMotivoAtencion","row","causaMotivoAtencion"],
      ["C13_CodDiagnosPrin","row","codDiagnosticoPrincipal"],["C23_CodDiagnosPrinCIE11","row","codDiagnosticoPrincipalCIE11"],
      ["C24_NomDiagnosPrinCIE11","row","nomCodDiagnosticoPrincipalCIE11"],["C14_codDiagnoRelCio1","row","codDiagnosticoRelacionado1"],
      ["C25_codDiagnosticoRelCionado1CIE11","row","codDiagnosticoRelacionado1CIE11"],["C26_NomDiagnosticoRelCionado1CIE11","row","nomCodDiagnosticoRelacionado1CIE11"],
      ["C15_codDiagnosticoRelCionado2","row","codDiagnosticoRelacionado2"],["C27_codDiagnosticoRelCionado2CIE11","row","codDiagnosticoRelacionado2CIE11"],
      ["C28_NomDiagnosticoRelCionado2CIE11","row","nomCodDiagnosticoRelacionado2CIE11"],["C16_codDiagnosticoRelCionado3","row","codDiagnosticoRelacionado3"],
      ["C29_codDiagnosticoRelCionado3CIE11","row","codDiagnosticoRelacionado3CIE11"],["C30_NomDiagnosticoRelCionado2CIE11","row","nomCodDiagnosticoRelacionado3CIE11"],
      ["C17_tipoDiagnosticoPrincipal","row","tipoDiagnosticoPrincipal"],["C18_tipoDocidentif","row","tipoDocumentoIdentificacion"],
      ["C19_NroDocIdent","row","numDocumentoIdentificacion"],["C20_vrServicio","row","vrServicio"],
      ["C21_conceptoRecaudo","row","conceptoRecaudo"],["C22_VrPagoModerador","row","valorPagoModerador"],
      ["C23_numFEVPagoModerador","row","numFEVPagoModerador"],["C25_CodigoVIDA","row","codigoVIDA"],
      ["C24_Consecutivo","row","consecutivo"]
    ],
    AH: [
      ["H01_NumFactura","root","numFactura"],["H02_CodPrestador","row","codPrestador"],
      ["H03_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["H04_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["H05_ViaIngreServiSalud","row","viaIngresoServicioSalud"],["H06_FechInicAtencion","row","fechaInicioAtencion"],
      ["H07_NumAuto","row","numAutorizacion"],["H08_CausaMotiAtenc","row","causaMotivoAtencion"],
      ["H09_CodDiagnosPrinIng","row","codDiagnosticoPrincipal"],["H16_CodDiagnosPrinIngCIE11","row","codDiagnosticoPrincipalCIE11"],
      ["H17_NomDiagnosPrinIngCIE11","row","nomCodDiagnosticoPrincipalCIE11"],["H10_CodDiagnosPrinEgre","row","codDiagnosticoPrincipalE"],
      ["H18_CodDiagnosPrinEgreCIE11","row","codDiagnosticoPrincipalECIE11"],["H19_NomDiagnosPrinEgreCIE11","row","nomCodDiagnosticoPrincipalECIE11"],
      ["H11_CodDiagnosRelaE1","row","codDiagnosticoRelacionadoE1"],["H20_CodDiagnosRelaEgre1CIE11","row","codDiagnosticoRelacionadoE1CIE11"],
      ["H21_NomDiagnosRelaEgre1CIE11","row","nomCodDiagnosticoRelacionadoE1CIE11"],["H12_CodDiagnosRelaE2","row","codDiagnosticoRelacionadoE2"],
      ["H22_CodDiagnosRelaEgre2CIE11","row","codDiagnosticoRelacionadoE2CIE11"],["H23_NomDiagnosRelaEgre2CIE11","row","nomCodDiagnosticoRelacionadoE2CIE11"],
      ["H13_CodDiagnosRelaE3","row","codDiagnosticoRelacionadoE3"],["H24_CodDiagnosRelaEgre3CIE11","row","codDiagnosticoRelacionadoE3CIE11"],
      ["H25_NomDiagnosRelaEgre3CIE11","row","nomCodDiagnosticoRelacionadoE3CIE11"],["H14_CodCompli","row","codComplicacion"],
      ["H26_CodComplicacionCIE11","row","codComplicacionCIE11"],["H27_NomComplicacionCIE11","row","nomCodComplicacionCIE11"],
      ["H15_CondiDestinoUSEgreso","row","condicionDestinoUsuarioEgreso"],["H16_CodDiagnosCausaMuerte","row","codDiagnosticoCausaMuerte"],
      ["H28_CodDiagnosCausaMuerteCIE11","row","codDiagnosticoCausaMuerteCIE11"],["H29_NomdDiagnosCausaMuerteCIE11","row","nomCodDiagnosticoCausaMuerteCIE11"],
      ["H17_FechaEgreso","row","fechaEgreso"],["H30_CodigoVIDA","row","codigoVIDA"],["H18_Consecutivo","row","consecutivo"]
    ],
    AM: [
      ["M01_NumFactura","root","numFactura"],["M02_CodPrestador","row","codPrestador"],
      ["M03_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["M04_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["M06_IdMIPRES","row","idMIPRES"],["M07_fechaDispensAdmon","row","fechaDispensAdmon"],
      ["M08_CodDiagPrinc","row","codDiagnosticoPrincipal"],["M24_CodDiagPrincCIE11","row","codDiagnosticoPrincipalCIE11"],
      ["M25_NomDiagPrincCIE11","row","nomCodDiagnosticoPrincipalCIE11"],["M09_CodDiagRelac","row","codDiagnosticoRelacionado"],
      ["M26_CodDiagRelacCIE11","row","codDiagnosticoRelacionadoCIE11"],["M27_NomDiagRelacCIE11","row","nomCodDiagnosticoRelacionadoCIE11"],
      ["M10_TipoMedicamento","row","tipoMedicamento"],["M11_CodTecnologiaSalud","row","codTecnologiaSalud"],
      ["M12_NroTecnologiaSalud","row","nomTecnologiaSalud"],["M13_ConcentracionMedicamento","row","concentracionMedicamento"],
      ["M14_UnidadMedida","row","unidadMedida"],["M15_FormaFarmaceutica","row","formaFarmaceutica"],
      ["M16_UnidadMinDispensa","row","unidadMinDispensa"],["M17_CantiMedicamento","row","cantidadMedicamento"],
      ["M18_DiasTratamiento","row","diasTratamiento"],["M19_TipoDocuIdent","row","tipoDocumentoIdentificacion"],
      ["M20_NumDocIdent","row","numDocumentoIdentificacion"],["M21_vrUnitMedicamento","row","vrUnitMedicamento"],
      ["M31_VrDispensacion","row","vrDispensacion"],["M22_vrServicio","row","vrServicio"],
      ["M23_conceptoRecaudo","row","conceptoRecaudo"],["M25_valorPagoModerador","row","valorPagoModerador"],
      ["M26_umFEVPagoModerador","row","numFEVPagoModerador"],["M29_codigoVIDA","row","codigoVIDA"],
      ["M27_consecutivo","row","consecutivo"]
    ],
    AN: [
      ["N01_NumFactura","root","numFactura"],["N02_CodPrestador","row","codPrestador"],
      ["N03_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["N04_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["N05_TipDocIdentRN","row","tipoDocumentoIdentificacion"],["N06_NumDocIdentRN","row","numDocumentoIdentificacion"],
      ["N07_FechaNacimiento","row","fechaNacimiento"],["N08_EdadGestacional","row","edadGestacional"],
      ["N09_NroConsuPrenatal","row","numConsultasCPrenatal"],["N10_CodSexoRN","row","codSexoBiologico"],
      ["N11_Peso","row","peso"],["N12_CodDiagnosPrin","row","codDiagnosticoPrincipal"],
      ["N14_CodDiagnosPrinCIE11","row","codDiagnosticoPrincipalCIE11"],["N15_NomDiagnosPrinCIE11","row","nomCodDiagnosticoPrincipalCIE11"],
      ["N13_CondiDestinoUSEgreso","row","condicionDestinoUsuarioEgreso"],["N14_CodDiagCausaMuerte","row","codDiagnosticoCausaMuerte"],
      ["N16_CodDiagCausaMuerteCIE11","row","codDiagnosticoCausaMuerteCIE11"],["N15_FechaEgreso","row","fechaEgreso"],
      ["N18_codigoVIDA","row","codigoVIDA"],["N16_Consecutivo","row","consecutivo"]
    ],
    AP: [
      ["P01_NumFactura","root","numFactura"],["P02_CodPrestador","row","codPrestador"],
      ["P03_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["P04_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["P05_FechInicioAten","row","fechaInicioAtencion"],["P06_idMIPRES","row","idMIPRES"],
      ["P07_NumAuto","row","numAutorizacion"],["P08_CodCUPS","row","codProcedimiento"],
      ["P09_ViaIngresoServSalud","row","viaIngresoServicioSalud"],["P10_ModaGrupoServTecSal","row","modalidadGrupoServicioTecSal"],
      ["P11_GrupoServi","row","grupoServicios"],["P12_codServicio","row","codServicio"],
      ["P13_finaTecSalud","row","finalidadTecnologiaSalud"],["P14_tipoDocidentif","row","tipoDocumentoIdentificacion"],
      ["P15_NroDocIdent","row","numDocumentoIdentificacion"],["P16_CodDiagnosPrin","row","codDiagnosticoPrincipal"],
      ["P21_CodDiagnosPrinCIE11","row","codDiagnosticoPrincipalCIE11"],["P22_NomDiagnoPinCIE11","row","nomCodDiagnosticoPrincipalCIE11"],
      ["P17_CodDiagnoRelacio","row","codDiagnosticoRelacionado"],["P23_codDiagnosticoRelCionado1CIE11","row","codDiagnosticoRelacionadoCIE11"],
      ["P24_NomDiagnosticoRelCionado1CIE11","row","nomCodDiagnosticoRelacionadoCIE11"],["P18_CodComplicacion","row","codComplicacion"],
      ["P25_CodComplicacionCIE11","row","codComplicacionCIE11"],["P26_NomComplicacionCIE10","row","nomCodComplicacionCIE11"],
      ["P19_VrServicio","row","vrServicio"],["P20_conceptoRecaudo","row","conceptoRecaudo"],
      ["P21_valorPagoModerador","row","valorPagoModerador"],["P22_numFEVPagoModerador","row","numFEVPagoModerador"],
      ["P27_CodigoVIDA","row","codigoVIDA"],["P23_Consecutivo","row","consecutivo"]
    ],
    AT: [
      ["S01_NumFactura","root","numFactura"],["S02_CodPres_REPS","row","codPrestador"],
      ["S03_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["S04_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["S05_NroAuto","row","numAutorizacion"],["S06_IdMIPRES","row","idMIPRES"],
      ["S07_FechaSuministroTec","row","fechaSuministroTecnologia"],["S08_tipoOS","row","tipoOS"],
      ["S09_codTecnologiaSalud","row","codTecnologiaSalud"],["S10_nomTecnologiaSalud","row","nomTecnologiaSalud"],
      ["S11_cantidadOS","row","cantidadOS"],["S12_tipoDocumentoIdentificacion","row","tipoDocumentoIdentificacion"],
      ["S13_NroDocIdent","row","numDocumentoIdentificacion"],["S14_vrUnitOS","row","vrUnitOS"],
      ["S18_vrDispensacion","row","vrDispensacion"],["S15_vrServicio","row","vrServicio"],
      ["S16_conceptoRecaudo","row","conceptoRecaudo"],["S17_valorPagoModerador","row","valorPagoModerador"],
      ["S18_NroFEVPagoModerador","row","numFEVPagoModerador"],["S17_codigoVIDA","row","codigoVIDA"],
      ["S19_Consecutivo","row","consecutivo"]
    ],
    AU: [
      ["R01_NumFactura","root","numFactura"],["R02_CodPrestador","row","codPrestador"],
      ["R03_TipDocIdent","usuario","tipoDocumentoIdentificacion"],["R04_NumDocIdent","usuario","numDocumentoIdentificacion"],
      ["R05_FechInicioAten","row","fechaInicioAtencion"],["R06_causaMotivoAtencion","row","causaMotivoAtencion"],
      ["R07_CodDiagnosPrinIng","row","codDiagnosticoPrincipal"],["R13_CodDiagnosPrinIngCIE11","row","codDiagnosticoPrincipalCIE11"],
      ["R14_NomDiagnosPrinIngCIE11","row","nomCodDiagnosticoPrincipalCIE11"],["R08_CodDiagnosPrinEgre","row","codDiagnosticoPrincipalE"],
      ["R15_CodDiagnosPrinEgreCIE11","row","codDiagnosticoPrincipalECIE11"],["R16_NomDiagnosPrinEgreCIE11","row","nomCodDiagnosticoPrincipalECIE11"],
      ["R09_CodDiagnosRelaE1","row","codDiagnosticoRelacionadoE1"],["R17_CodDiagnosRelaE1CIE11","row","codDiagnosticoRelacionadoE1CIE11"],
      ["R18_NomDiagnosRelaE1CIE11","row","nomCodDiagnosticoRelacionadoE1CIE11"],["R10_CodDiagnosRelaE2","row","codDiagnosticoRelacionadoE2"],
      ["R19_CodDiagnosRelaE2CIE11","row","codDiagnosticoRelacionadoE2CIE11"],["R20_NomDiagnosRelaE2CIE11","row","nomCodDiagnosticoRelacionadoE2CIE11"],
      ["R11_CodDiagnosRelaE3","row","codDiagnosticoRelacionadoE3"],["R21_CodDiagnosRelaE3CIE11","row","codDiagnosticoRelacionadoE3CIE11"],
      ["R22_NomDiagnosRelaE3CIE11","row","nomCodDiagnosticoRelacionadoE3CIE11"],["R12_CondiDestinoUSEgreso","row","condicionDestinoUsuarioEgreso"],
      ["R13_CodDiagnosCausaMuerte","row","codDiagnosticoCausaMuerte"],["R23_CodDiagnosCausaMuerteCIE11","row","codDiagnosticoCausaMuerteCIE11"],
      ["R24_NomDiagnosCausaMuerteCIE11","row","nomCodDiagnosticoCausaMuerteCIE11"],["R14_fechaEgreso","row","fechaEgreso"],
      ["R25_CodigoVIDA","row","codigoVIDA"],["R15_Consecutivo","row","consecutivo"]
    ],
    CT: [
      ["T01_numDocumentoIdObligado","root","numDocumentoIdObligado"],["T02_NumFactura","root","numFactura"],
      ["T03_TipoNota","root","tipoNota"],["T04_numNota","root","numNota"]
    ]
  };
  const GROUP_TO_TXT_CODE = {consultas:"AC",procedimientos:"AP",urgencias:"AU",hospitalizacion:"AH",recienNacidos:"AN",medicamentos:"AM",otrosServicios:"AT"};
  function resolveLayoutValue(source,path,ctx){
    if (source==="root") return ctx.d?.[path];
    if (source==="usuario") return ctx.u?.[path];
    if (source==="row") return ctx.row?.[path];
    return "";
  }

  // Arma, para un RIPS ya cargado, las filas (como arreglos, sin unir) de cada grupo de la
  // resolución (US, AC, AP, AU, AH, AN, AM, AT, CT), siguiendo exactamente la estructura
  // oficial de salida (ESDTRUCTURA_DE_SALIDA_JSON.xlsx). Incluye la fila de encabezado con
  // los nombres de columna oficiales (U01_NumFactura, C01_NumFactura, etc.) primero.
  function buildRowsByCode(entry){
    const d = entry.data;
    const rowsByCode = {};
    if (!isObject(d) || !Array.isArray(d.usuarios)) return rowsByCode;

    const usRows = [TXT_LAYOUTS.US.map(([label])=>label)];
    d.usuarios.forEach(u=>{
      if (!isObject(u)) return;
      usRows.push(TXT_LAYOUTS.US.map(([,source,path])=>txtCell(resolveLayoutValue(source,path,{d,u}))));
    });
    if (usRows.length > 1) rowsByCode.US = usRows;

    SERVICE_KEYS.forEach(key=>{
      const code = GROUP_TO_TXT_CODE[key];
      const layout = TXT_LAYOUTS[code];
      if (!layout) return;
      const rows = [layout.map(([label])=>label)];
      d.usuarios.forEach(u=>{
        if (!isObject(u)) return;
        const arr = u.servicios?.[key];
        if (!Array.isArray(arr)) return;
        arr.forEach(row=>{
          if (!isObject(row)) return;
          rows.push(layout.map(([,source,path])=>txtCell(resolveLayoutValue(source,path,{d,u,row}))));
        });
      });
      if (rows.length > 1) rowsByCode[code] = rows;
    });

    // CT: una sola fila por archivo con los campos de la raíz del RIPS.
    rowsByCode.CT = [
      TXT_LAYOUTS.CT.map(([label])=>label),
      TXT_LAYOUTS.CT.map(([,source,path])=>txtCell(resolveLayoutValue(source,path,{d})))
    ];

    return rowsByCode;
  }

  // Un archivo TXT por grupo (para quien necesite la separación clásica AC/AP/AU/...).
  function buildTxtFiles(entry){
    const rowsByCode = buildRowsByCode(entry);
    const files = {};
    Object.entries(rowsByCode).forEach(([code,rows])=>{ files[code] = rows.map(r=>r.join(",")).join("\r\n"); });
    return files;
  }

  async function ensureJsPDF(){
    if (window.jspdf?.jsPDF && window.jspdf?.jsPDF?.API?.autoTable) return true;
    toast("Cargando generador de PDF...");
    try{
      if (!window.jspdf?.jsPDF){
        await new Promise((resolve,reject)=>{
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (!window.jspdf?.jsPDF?.API?.autoTable){
        await new Promise((resolve,reject)=>{
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      return !!window.jspdf?.jsPDF;
    }catch{ return false; }
  }

  // Corta el texto a una sola línea si no cabe en el ancho dado (sin "...", igual que la
  // plantilla oficial: los nombres largos de procedimiento se ven truncados tal cual, no se
  // parten en 2 líneas ni se reduce la letra a algo ilegible).
  function truncateToWidth(doc, text, maxWidth){
    text = String(text ?? "");
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(t) > maxWidth) t = t.slice(0, -1);
    return t;
  }

  function todayDMY(){
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }

  // Reporte PDF: sigue la plantilla real compartida ("ANALISIS CUANTITATIVO DE LOS RIPS Y LA
  // PRODUCION DEL DECRETO 2193"), con sus 3 tablas: conceptos, desglose por CUPS/edad, y
  // totales de consulta 1ª/control/sesiones.
  function saveAgeBreakdownRows(){
    try{ localStorage.setItem("rips0948:ageBreakdownRows", JSON.stringify(state.ageBreakdownRows)); }catch{}
  }
  function codeName(field, code){
    if (field==="codConsulta" || field==="codProcedimiento") return window.CUPS_CATALOG?.[code] || code;
    return code;
  }
  function buildAgeBreakdownData(){
    const rows = state.ageBreakdownRows.map(r=>{
      const count = countByCodes(r.group, r.field, [r.code], {min:r.ageMin, max:r.ageMax});
      const cols = AGE_COLUMNS.map(c => c===r.column ? count : 0);
      return {code:r.code, name: codeName(r.field, r.code), label:r.label, cols, total: count};
    }).filter(r=>r.total>0);
    const grandTotal = rows.reduce((a,r)=>a+r.total,0);
    return {rows, grandTotal};
  }

  // ===== Tabla 3: TOTAL CONSULTA DE 1°, CONTROL Y SESIONES ODONTOLOGICAS =====
  // índice de procedimientos por consulta odontológica = sesiones / (primera vez + control),
  // sin contar las consultas de urgencias en el denominador (confirmado con los valores reales
  // de la plantilla: 137 / (130+39) = 0.81).
  function buildConsultaTypesData(){
    const primeraVez = countByCodes("consultas","codConsulta",["890203"], null);
    const control = countByCodes("consultas","codConsulta",["890303"], null);
    const urgencias = countByCodes("consultas","codConsulta",["890703"], null);
    const totalAtenciones = primeraVez + control + urgencias;
    const sesiones = computeIndicators().sesionesOdontologicas;
    const denom = primeraVez + control;
    const indice = denom>0 ? sesiones/denom : 0;
    return {primeraVez, control, urgencias, totalAtenciones, sesiones, indice};
  }

  async function downloadReportPdf(){
    if (!state.files.length) return toast("No hay archivos cargados para generar el reporte");
    if (!(await ensureJsPDF())) return toast("No se pudo cargar el generador de PDF (revisa tu conexión a internet)");

    // Si corresponde, quita del PDF los usuarios ya reportados en trimestres anteriores
    // (2° vs 1°, 3° vs 1°+2°, 4° vs 1°+2°+3°) — sin tocar lo que está cargado en pantalla.
    const { files: reportFiles, removedCount } = await filterAlreadySeenUsers(state.files);
    const originalFilesForPdf = state.files;
    state.files = reportFiles;

    const { jsPDF } = window.jspdf;
    const preset = REPORT_STYLES[state.orgConfig.reportStyle] || REPORT_STYLES.default;
    // Tamaño oficio (216 x 330 mm), para que quepa toda la información sin saltar de página.
    const doc = new jsPDF({unit:"mm", format:[216,330]});
    doc.setFont(preset.font, "normal");
    doc.setTextColor(0,0,0);
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 12;
    const contentWidth = pageWidth - marginX*2;
    const center = pageWidth/2;
    const entityName = state.orgConfig.name || "—";
    const trimestreLabel = `${state.orgConfig.trimestre||"1"}° TRIMESTRE DE ${state.orgConfig.year||new Date().getFullYear()} RIPS-Json Res 1884-2024`;
    const fecha = todayDMY();
    let y = 10;

    const ACCENT = preset.accent, STRIPE = preset.stripe, TOTAL = preset.total, GRID_LINE = preset.grid;
    const headerFillMode = preset.headerFill; // "dark" | "light" | "none"
    const headerFillColor = headerFillMode==="dark" ? ACCENT : headerFillMode==="light" ? [235,235,235] : null;
    const headerTextColor = headerFillMode==="dark" ? [255,255,255] : ACCENT;

    // Título de sección: banda de color sólido (sectionMode "band") o texto plano centrado
    // en el color de acento (sectionMode "text"), según el estilo elegido.
    function sectionTitle(text1, text2, yy){
      if (preset.sectionMode === "band"){
        const bandH = text2 ? 13 : 8;
        doc.setFillColor(...ACCENT);
        doc.rect(marginX, yy-5.5, contentWidth, bandH, "F");
        doc.setTextColor(255,255,255);
        doc.setFont(preset.font,"bold");
        doc.setFontSize(10);
        doc.text(text1, center, yy, {align:"center"});
        if (text2){ doc.setFontSize(9.5); doc.text(text2, center, yy+5.5, {align:"center"}); }
        doc.setTextColor(0,0,0);
        doc.setFont(preset.font,"normal");
        return yy - 5.5 + bandH + 5;
      }
      doc.setFont(preset.font,"bold");
      doc.setFontSize(10);
      doc.setTextColor(...ACCENT);
      doc.text(text1, center, yy, {align:"center"});
      if (text2) doc.text(text2, center, yy+5, {align:"center"});
      doc.setTextColor(0,0,0);
      doc.setFont(preset.font,"normal");
      return yy + (text2?5:0) + 7;
    }

    // Encabezado oficial (Gobernación del Magdalena / Secretaria Seccional de Salud).
    if (window.REPORT_HEADER_IMAGE){
      const headerW = contentWidth;
      const headerH = headerW * (window.REPORT_HEADER_IMAGE_RATIO || 0.16);
      try{ doc.addImage(window.REPORT_HEADER_IMAGE, "JPEG", marginX, y, headerW, headerH); y += headerH + 5; }catch{ y += 2; }
    }

    doc.setFont(preset.font,"bolditalic");
    doc.setFontSize(11);
    doc.text("ANALISIS CUANTITATIVO DE LOS RIPS Y LA PRODUCION DEL DECRETO 2193", center, y, {align:"center"}); y+=4.6;
    doc.text("CONCEPTOS PARA EL AREA CALIDAD", center, y, {align:"center"}); y+=4.6;
    doc.text(entityName, center, y, {align:"center"}); y+=4.6;
    doc.setFontSize(9);
    doc.text(trimestreLabel, center, y, {align:"center"}); y+=4.6;
    doc.setFont(preset.font,"italic");
    doc.text(`Fecha de Elaboración: ${fecha}`, marginX, y); y+=5;
    doc.setFont(preset.font,"normal");

    const values = computeIndicators();
    const body = INDICATOR_DEFS.map(d=>{
      const ripsVal = values[d.key];
      const dec = state.dec2193[d.key] || 0;
      return [d.label, String(ripsVal), String(dec), String(ripsVal-dec)];
    });
    doc.autoTable({
      startY: y,
      head: [["Concepto","RIPS Json.4","Dec2193","Diferecia"]],
      body,
      theme: preset.showGrid ? "striped" : "plain",
      styles: {font:preset.font, fontSize:8, cellPadding:{top:1.4,bottom:1.4,left:2.5,right:2.5}, lineColor:GRID_LINE, lineWidth:preset.showGrid?0.1:0, textColor:[20,20,20], valign:"middle"},
      headStyles: {fillColor: headerFillColor || false, textColor:headerTextColor, fontStyle:"bold", halign:"center", lineWidth: preset.showGrid?0.1:{top:0,left:0,right:0,bottom:0.3}, lineColor:GRID_LINE},
      alternateRowStyles: STRIPE ? {fillColor:STRIPE} : undefined,
      columnStyles: {0:{cellWidth:contentWidth-3*24}, 1:{halign:"right",cellWidth:24}, 2:{halign:"right",cellWidth:24}, 3:{halign:"right",cellWidth:24}},
      margin: {left:marginX, right:marginX}
    });

    // Tabla 2: INFORME DEPURADO DE SALUD ORAL (desglose por CUPS y edad)
    let y2 = sectionTitle("INFORME DEPURADO DE SALUD ORAL PRESENTADO EN EL", "TRIMESTRE Y REPORTADOS EN LOS RIPS_JSON", (doc.lastAutoTable?.finalY || y+20) + 9);
    doc.setFontSize(8); doc.setFont(preset.font,"bold");
    const ageData = buildAgeBreakdownData();
    doc.text(`Total del Serv.:  ${ageData.grandTotal}`, marginX+contentWidth, y2-2, {align:"right"});
    doc.setFont(preset.font,"normal");
    // Ancho de columna: PROCEDIMIENTO se ensancha bastante para que el nombre se vea completo;
    // solo se envuelve a una segunda línea en el caso raro de que ni así quepa. Relleno
    // reducido para que las filas queden más juntas.
    const T2_COL = {code:13, name:82, edad:24, num:9.5, todaEdad:14, total:11.5};
    doc.setFont(preset.font,"normal"); doc.setFontSize(7.6);
    doc.autoTable({
      startY: y2+2,
      head: [["CodCUPS","PROCEDIMIENTO","Edad del Serv", ...AGE_COLUMNS, "TOTAL"]],
      body: ageData.rows.map(r=>[
        r.code,
        r.name,
        r.label,
        ...r.cols.map(String), String(r.total)
      ]),
      theme: preset.showGrid ? "striped" : "plain",
      styles: {font:preset.font, fontSize:7.6, cellPadding:{top:1.0,bottom:1.0,left:1.6,right:1.6}, lineColor:GRID_LINE, lineWidth:preset.showGrid?0.1:0, textColor:[20,20,20], valign:"middle"},
      headStyles: {fillColor: headerFillColor || false, textColor:headerTextColor, fontStyle:"bold", halign:"center", fontSize:6.6, lineWidth: preset.showGrid?0.1:{top:0,left:0,right:0,bottom:0.3}, lineColor:GRID_LINE},
      alternateRowStyles: STRIPE ? {fillColor:STRIPE} : undefined,
      columnStyles: {
        0:{cellWidth:T2_COL.code, halign:"center"}, 1:{cellWidth:T2_COL.name}, 2:{cellWidth:T2_COL.edad},
        3:{halign:"right",cellWidth:T2_COL.num},4:{halign:"right",cellWidth:T2_COL.num},5:{halign:"right",cellWidth:T2_COL.num},6:{halign:"right",cellWidth:T2_COL.num},7:{halign:"right",cellWidth:T2_COL.todaEdad},
        8:{halign:"right", cellWidth:T2_COL.total, fontStyle:"bold"}
      },
      margin: {left:marginX, right:marginX}
    });

    // Tabla 3: TOTAL CONSULTA DE 1°, CONTROL Y SESIONES ODONTOLOGICAS
    let y3 = sectionTitle("TOTAL CONSULTA DE 1°, TOTAL CONSULTA CONTROL", "Y TOTAL SESIONES ODONTOLOGICAS", (doc.lastAutoTable?.finalY || y2+40) + 9);
    const ct = buildConsultaTypesData();
    doc.autoTable({
      startY: y3+2,
      body: [
        ["CONSULTA DE PRIMERA VEZ POR ODONTOLOGIA GENERAL", String(ct.primeraVez)],
        ["CONSULTA DE CONTROL O DE SEGUIMIENTO POR ODONTOLOGIA", String(ct.control)],
        ["CONSULTA DE URGENCIAS POR ODONTOLOGIA GENERAL", String(ct.urgencias)],
        [{content:"Total Atenciones", styles:{fontStyle:"bold", fillColor:TOTAL}}, {content:String(ct.totalAtenciones), styles:{fontStyle:"bold", fillColor:TOTAL}}],
        ["Número de sesiones de odontología realizadas", String(ct.sesiones)],
        [{content:"índice de procedimientos por consulta odontológica", styles:{fontStyle:"bold", fillColor:TOTAL}}, {content:ct.indice.toFixed(2), styles:{fontStyle:"bold", fillColor:TOTAL}}]
      ],
      theme: preset.showGrid ? "grid" : "plain",
      styles: {font:preset.font, fontSize:8, cellPadding:{top:1.4,bottom:1.4,left:2.5,right:2.5}, lineColor:GRID_LINE, lineWidth:preset.showGrid?0.1:0, textColor:[20,20,20]},
      columnStyles: {0:{cellWidth:contentWidth-30},1:{halign:"right",cellWidth:30}},
      margin: {left:marginX, right:marginX},
      didParseCell: (data)=>{
        if (!preset.showGrid && (data.row.index===3 || data.row.index===5)){
          data.cell.styles.lineWidth = {top:0.3, bottom:0.3, left:0, right:0};
          data.cell.styles.lineColor = ACCENT;
        }
      }
    });

    // Pie: nota legal y firma, tal como en la plantilla de referencia. Las posiciones de la
    // nota legal / cierre / "Generado" se calculan en cadena con getTextDimensions (medida
    // real de jsPDF), no a mano, para que nunca se traslapen sin importar cuánto ocupen las
    // tablas de arriba.
    let yFoot = (doc.lastAutoTable?.finalY || y3+30) + 5;
    doc.setFont(preset.font,"bold"); doc.setFontSize(7.5);
    doc.text(`V.b ${state.orgConfig.signerName || "MARILUZ CABRERA"}`, pageWidth-marginX, yFoot, {align:"right"});
    doc.setFont(preset.font,"normal");
    doc.text("Profesional Universitario", pageWidth-marginX, yFoot+4, {align:"right"});

    doc.setFont(preset.font,"italic"); doc.setFontSize(6.3);
    const legal = "En el Área de Planeación y Asistencia Municipal se reciben como soporte de la producción del Decreto 2193 de 2004 los RIPS en formato JSON correspondientes al período reportado. Posterior a la aplicación del mecanismo único de validación, deberá incluirse como soporte el CUV (Código Único de Validación); estos serán cuantificados y comparados. De conformidad con la Resolución 084 de 2021, artículo 6 \"Consistencia de los campos de datos adicionales del sector salud de la factura electrónica de venta\", la información contenida en los campos de datos señalados en el artículo 3 de la mencionada resolución deberá ser consistente con la representación gráfica de la factura electrónica de venta y con la información reportada en los RIPS que la soportan, en lo que aplique. Si no se presentan diferencias, la información será cargada en el SIHO con el respectivo visto bueno. No obstante, no es responsabilidad ni competencia de esta Dependencia verificar la calidad ni la veracidad de los datos suministrados.";
    const legalLines = doc.splitTextToSize(legal, contentWidth);
    const legalY = yFoot+7;
    doc.text(legalLines, marginX, legalY);
    const legalH = doc.getTextDimensions(legalLines).h;

    doc.setFont(preset.font,"bolditalic"); doc.setFontSize(6.5);
    const closing = "La fecha máxima para la entrega de los RIPS en formato JSON será la establecida para la sustentación financiera de cada E.S.E., según la circular expedida trimestralmente por esta Secretaría.";
    const closingLines = doc.splitTextToSize(closing, contentWidth);
    const closingY = legalY + legalH + 2;
    doc.text(closingLines, marginX, closingY);
    const closingH = doc.getTextDimensions(closingLines).h;

    doc.setFont(preset.font,"normal"); doc.setFontSize(7);
    const generadoY = closingY + closingH + 4;
    doc.text(`Generado: ${new Date().toLocaleString("es-CO")}`, marginX, generadoY);

    if (doc.internal.getNumberOfPages() > 1){
      console.warn("El PDF quedó en más de 1 página; revisar espaciados de downloadReportPdf().");
    }
    const filename = buildReportFileName();
    const pdfBlob = doc.output("blob");
    const savedToFolder = await deliverFile(pdfBlob, filename);
    if (savedToFolder){
      await saveTrimesterRegistry(originalFilesForPdf); // todos los cargados, sin filtrar.
      await saveUniqueUsersRegistry(reportFiles); // los que quedan tras el cruce entre trimestres.
    }
    state.files = originalFilesForPdf;
    const excludedNote = removedCount ? ` · ${removedCount} usuario(s) excluido(s) por repetirse con trimestres anteriores` : "";
    toast((savedToFolder ? `PDF guardado en la carpeta (${preset.label}): ${filename}` : `PDF descargado (${preset.label}): ${filename}`) + excludedNote);
  }

  async function ensureJsZip(){
    if (window.JSZip) return true;
    toast("Cargando empaquetador ZIP...");
    try{
      await new Promise((resolve,reject)=>{
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      return !!window.JSZip;
    }catch{ return false; }
  }

  async function ensureXLSX(){
    if (window.XLSX) return true;
    toast("Cargando lector de Excel...");
    try{
      await new Promise((resolve,reject)=>{
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      return !!window.XLSX;
    }catch{ return false; }
  }

  // Carga el archivo de Producción Decreto 2193 (Excel o TXT) y llena automáticamente la
  // columna "Dec2193" de los 6 conceptos, buscando en cualquier hoja del Excel una fila cuyo
  // primer texto empiece con el código del concepto (ej. "10_346", "11_751"...), tomando el
  // valor de la columna que diga "Dec2193" (o, si no la encuentra, la última columna numérica
  // de esa fila). Si es un .txt, lo interpreta como texto delimitado por comas o tabulaciones.
  function conceptCode(label){
    const m = String(label||"").match(/^(\d{1,2}_\d{3})/);
    return m ? m[1] : null;
  }

  function matchDec2193FromRows(rows){
    // Soporta 2 formatos de archivo:
    // A) Resumen ya calculado por concepto: una fila por concepto, primera celda con texto
    //    tipo "10_346 Total de consultas..." y una columna "Dec2193".
    // B) Datos crudos del sistema (una fila por cada concepto de TODO el Decreto 2193, con
    //    columnas "conc_codigo" y "total"): se toma el "total" de la fila cuyo conc_codigo
    //    coincide con el número después del guion bajo de nuestros 6 conceptos (ej. "10_346"
    //    -> conc_codigo 346).
    const found = {};
    let entityName = null;
    let dec2193Col = null;
    let concCodigoCol = null;
    let totalCol = null;
    let nombreCol = null;

    const suffixMap = {};
    INDICATOR_DEFS.forEach(d=>{
      const code = conceptCode(d.label);
      if (code){ const parts = code.split("_"); suffixMap[parts[1]] = d.key; }
    });

    for (const row of rows){
      if (!Array.isArray(row)) continue;
      const rowText = row.map(c=>String(c??"").trim());

      if (dec2193Col===null){ const idx = rowText.findIndex(c=>/^dec\s*2193$/i.test(c)); if (idx>=0) dec2193Col = idx; }
      if (concCodigoCol===null){ const idx = rowText.findIndex(c=>/^conc[_\s]?codigo$/i.test(c)); if (idx>=0) concCodigoCol = idx; }
      if (totalCol===null){ const idx = rowText.findIndex(c=>/^total$/i.test(c)); if (idx>=0) totalCol = idx; }
      if (nombreCol===null){ const idx = rowText.findIndex(c=>/^nombre$/i.test(c)); if (idx>=0) nombreCol = idx; }

      const isHeaderRow = rowText.some(c=>/^dec\s*2193$/i.test(c))
        || (rowText.some(c=>/^conc[_\s]?codigo$/i.test(c)) && rowText.some(c=>/^total$/i.test(c)));
      if (isHeaderRow) continue;

      // Formato B: datos crudos por conc_codigo + total.
      if (concCodigoCol!==null && totalCol!==null){
        const key = suffixMap[rowText[concCodigoCol]];
        if (key){
          const num = Number(row[totalCol]);
          if (!isNaN(num)) found[key] = num;
        }
        if (!entityName && nombreCol!==null && rowText[nombreCol]) entityName = rowText[nombreCol];
        continue;
      }

      // Formato A: resumen ya calculado por concepto.
      const firstCell = rowText[0] || "";
      if (!entityName && firstCell && !conceptCode(firstCell) && !/concepto/i.test(firstCell) && rowText.slice(1).every(c=>!c)){
        entityName = firstCell; // fila con solo el nombre de la entidad, como A1 en la plantilla.
      }
      const code = conceptCode(firstCell);
      if (!code) continue;
      INDICATOR_DEFS.forEach(d=>{
        if (!d.label.startsWith(code)) return;
        let val;
        if (dec2193Col!==null && row[dec2193Col]!==undefined) val = row[dec2193Col];
        else {
          for (let i=row.length-1;i>=1;i--){ if (row[i]!==undefined && row[i]!==null && row[i]!=="" && !isNaN(Number(row[i]))){ val = row[i]; break; } }
        }
        const num = Number(val);
        if (!isNaN(num)) found[d.key] = num;
      });
    }
    return {found, entityName};
  }

  async function loadDec2193File(file){
    const name = file.name.toLowerCase();
    let allRows = [];
    if (name.endsWith(".txt") || name.endsWith(".csv")){
      const text = await file.text();
      allRows = text.split(/\r?\n/).map(line=>line.split(/\t|;|,/));
    } else {
      if (!(await ensureXLSX())) return toast("No se pudo cargar el lector de Excel (revisa tu conexión a internet)");
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, {type:"array"});
      wb.SheetNames.forEach(sheetName=>{
        const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:""});
        allRows = allRows.concat(rows);
      });
    }
    const {found, entityName} = matchDec2193FromRows(allRows);
    const keysFound = Object.keys(found);
    if (!keysFound.length) return toast("No encontré ninguno de los 6 conceptos en ese archivo. Revisa que traiga los códigos (10_346, 11_751, etc.) y la columna Dec2193.");
    keysFound.forEach(k=>{ state.dec2193[k] = found[k]; });
    saveDec2193();
    if (entityName && !state.orgConfig.name){ state.orgConfig.name = entityName; saveOrgConfig(); }
    renderIndicatorConfig();
    renderOrgConfig();
    toast(`Dec2193 cargado: ${keysFound.length} de 6 conceptos actualizados desde ${file.name}`);
  }

  // Nombre base para el lote completo (varios RIPS juntos): hospital + trimestre + año,
  // sin número de factura, ya que agrupa todos los archivos cargados.
  function batchBaseName(){
    const org = safeFile(state.orgConfig?.name || "");
    const trimestre = state.orgConfig?.trimestre || "1";
    const yy = String(state.orgConfig?.year || new Date().getFullYear()).slice(-2);
    return [org, `${trimestre}Trim${yy}`].filter(Boolean).join("_");
  }

  // Junta las filas de TODOS los RIPS cargados, agrupadas por código (US, AC, AP, AU, AH,
  // AN, AM, AT, CT) — es decir, UN SOLO US con todos los usuarios de todos los archivos,
  // UN SOLO AC con todas las consultas de todos los archivos, y así con cada grupo.
  function buildBatchRowsByCode(entries){
    const combined = {};
    entries.forEach(entry=>{
      const perFile = buildRowsByCode(entry);
      Object.entries(perFile).forEach(([code,rows])=>{
        if (!combined[code]) combined[code] = [];
        // La primera fila de "rows" es el encabezado (nombres de columna); se conserva una
        // sola vez al combinar varios archivos, no repetido por cada RIPS.
        const startIdx = combined[code].length === 0 ? 0 : 1;
        rows.slice(startIdx).forEach(r=>combined[code].push(r));
      });
    });
    return combined;
  }

  // Descarga UN solo archivo por cada grupo presente (un US.txt, un AC.txt, un AP.txt...),
  // consolidando todos los RIPS cargados, empacados juntos en un ZIP.
  async function downloadTxtGroupedForAllFiles(){
    if (!state.files.length) return toast("No hay archivos cargados");
    // Quita, si corresponde, los usuarios ya reportados en trimestres anteriores antes de
    // armar los TXT — así lo que se guarda en la carpeta nunca repite un usuario ya reportado.
    const { files: txtFiles, removedCount } = await filterAlreadySeenUsers(state.files);
    const combined = buildBatchRowsByCode(txtFiles);
    const codes = TXT_CODE_ORDER.filter(c=>combined[c]?.length);
    if (!codes.length) return toast("No hay datos para convertir a TXT (puede que todos los usuarios ya se hayan reportado en trimestres anteriores)");
    if (!(await ensureJsZip())) return toast("No se pudo cargar el empaquetador ZIP (revisa tu conexión a internet)");
    const zip = new window.JSZip();
    const base = batchBaseName();
    codes.forEach(code=>zip.file(`${code}.txt`, combined[code].map(r=>r.join(",")).join("\r\n")));
    const blob = await zip.generateAsync({type:"blob"});
    const saved = await deliverFile(blob, `${base}_RIPS_TXT.zip`);
    if (saved){
      await saveTrimesterRegistry(state.files); // todos los cargados, sin filtrar.
      await saveUniqueUsersRegistry(txtFiles); // los que quedan tras el cruce entre trimestres.
    }
    const excludedNote = removedCount ? ` · ${removedCount} usuario(s) excluido(s) por repetirse con trimestres anteriores` : "";
    toast((saved
      ? `ZIP guardado en la carpeta: ${base}_RIPS_TXT.zip (${codes.join(", ")}.txt)`
      : `Generado un ${codes.join(", ")}.txt con todos los registros de los ${txtFiles.length} archivo(s) cargados`) + excludedNote);
  }

  // Igual que arriba pero para un solo RIPS (un US.txt, un AC.txt... solo de esa factura).
  async function downloadTxtForFileId(fileId){
    const entry = state.files.find(f=>f.id===fileId);
    if (!entry) return;
    const { files: filtered, removedCount } = await filterAlreadySeenUsers([entry]);
    const filteredEntry = filtered[0];
    const files = buildTxtFiles(filteredEntry);
    const codes = Object.keys(files);
    if (!codes.length) return toast("Este archivo no tiene datos para convertir a TXT (puede que todos los usuarios ya se hayan reportado en trimestres anteriores)");
    if (!(await ensureJsZip())) return toast("No se pudo cargar el empaquetador ZIP (revisa tu conexión a internet)");
    const zip = new window.JSZip();
    const base = fileBaseName(filteredEntry);
    codes.forEach(code=>zip.file(`${code}.txt`, files[code]));
    const blob = await zip.generateAsync({type:"blob"});
    const saved = await deliverFile(blob, `${base}_RIPS_TXT.zip`);
    const excludedNote = removedCount ? ` · ${removedCount} usuario(s) excluido(s) por repetirse con trimestres anteriores` : "";
    toast((saved ? `ZIP guardado en la carpeta: ${base}_RIPS_TXT.zip` : `TXT generado: ${base}_RIPS_TXT.zip`) + excludedNote);
  }

  function downloadBlobFile(name, blob){
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  // ===== Carpeta de guardado (File System Access API: Chrome/Edge) =====
  // El usuario elige una carpeta una sola vez; a partir de ahí, los TXT y el PDF se guardan
  // directos ahí (sin diálogo de descarga), dentro de una subcarpeta por trimestre (ej.
  // "2Trim26"), que se crea sola si no existe. Se recuerda entre sesiones vía IndexedDB
  // (pendiente de volver a autorizar el permiso, por seguridad del navegador).
  let saveDirHandle = null;
  // Carpeta que ya quedó guardada de una sesión anterior pero cuyo permiso el navegador
  // pide volver a confirmar (por seguridad del navegador, no porque se haya "perdido" la
  // configuración) — se reconecta con un clic, sin tener que volver a buscar/navegar la
  // carpeta desde cero.
  let pendingDirHandle = null;

  function idbOpen(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open("rips0948_fs", 1);
      req.onupgradeneeded = ()=> req.result.createObjectStore("handles");
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }
  async function idbSaveDirHandle(handle){
    try{
      const db = await idbOpen();
      await new Promise((res,rej)=>{
        const tx = db.transaction("handles","readwrite");
        tx.objectStore("handles").put(handle,"saveFolder");
        tx.oncomplete = res; tx.onerror = ()=>rej(tx.error);
      });
    }catch{}
  }
  async function idbLoadDirHandle(){
    try{
      const db = await idbOpen();
      return await new Promise(res=>{
        const tx = db.transaction("handles","readonly");
        const req = tx.objectStore("handles").get("saveFolder");
        req.onsuccess = ()=>res(req.result||null);
        req.onerror = ()=>res(null);
      });
    }catch{ return null; }
  }

  function setSaveFolderButtonLabel(text){
    if (els.btnPickSaveFolder) els.btnPickSaveFolder.textContent = text;
  }

  async function pickSaveFolder(){
    // Si ya hay una carpeta configurada de antes y solo falta reconfirmar el permiso, se pide
    // ese permiso directo sobre ESA MISMA carpeta (aviso rápido del navegador) — no hay que
    // volver a navegar/buscarla. Así queda configurada una sola vez, de verdad.
    if (pendingDirHandle){
      try{
        const perm = await pendingDirHandle.requestPermission({mode:"readwrite"});
        if (perm === "granted"){
          saveDirHandle = pendingDirHandle;
          const name = saveDirHandle.name;
          pendingDirHandle = null;
          if (els.cfgSaveFolderLabel) els.cfgSaveFolderLabel.textContent = `Carpeta: ${name}`;
          setSaveFolderButtonLabel("📁 Elegir carpeta");
          toast(`Carpeta reconectada: ${name}`);
          return;
        }
      }catch{ /* si falla la reconexión, cae al selector normal de abajo */ }
    }
    if (!window.showDirectoryPicker){
      toast("Tu navegador no soporta elegir carpeta (usa Chrome o Edge). Los archivos se descargarán normal.");
      return;
    }
    try{
      const handle = await window.showDirectoryPicker();
      saveDirHandle = handle;
      pendingDirHandle = null;
      await idbSaveDirHandle(handle);
      if (els.cfgSaveFolderLabel) els.cfgSaveFolderLabel.textContent = `Carpeta: ${handle.name}`;
      setSaveFolderButtonLabel("📁 Elegir carpeta");
      toast(`Carpeta configurada: ${handle.name}. Se recuerda para la próxima vez — ya no hace falta volver a elegirla.`);
    }catch(e){
      if (e?.name !== "AbortError") toast("No se pudo seleccionar la carpeta.");
    }
  }

  async function restoreSaveFolder(){
    const handle = await idbLoadDirHandle();
    if (!handle || !els.cfgSaveFolderLabel) return;
    try{
      const perm = await handle.queryPermission({mode:"readwrite"});
      if (perm === "granted"){
        saveDirHandle = handle;
        els.cfgSaveFolderLabel.textContent = `Carpeta: ${handle.name}`;
      } else {
        // Ya está configurada, solo falta el visto bueno del navegador — un clic la reconecta.
        pendingDirHandle = handle;
        els.cfgSaveFolderLabel.textContent = `Carpeta configurada: ${handle.name} — pulsa "Reconectar carpeta" para seguir usándola`;
        setSaveFolderButtonLabel("🔄 Reconectar carpeta");
      }
    }catch{}
  }

  // Siempre se anida por hospital (usando el nombre configurado) y luego por trimestre:
  // {carpeta}/{Hospital}/{Trimestre}Trim{Año}/ — tanto al generar uno solo como "todos los
  // hospitales", para que la comparación entre trimestres encuentre siempre los registros en
  // el mismo lugar sin importar cómo se generaron.
  async function getTrimesterSubfolder(){
    const trimestre = state.orgConfig?.trimestre || "1";
    const yy = String(state.orgConfig?.year || new Date().getFullYear()).slice(-2);
    let root = saveDirHandle;
    if (state.orgConfig?.name) root = await root.getDirectoryHandle(safeFile(state.orgConfig.name), {create:true});
    return root.getDirectoryHandle(`${trimestre}Trim${yy}`, {create:true});
  }

  // Entrega un archivo: si hay carpeta elegida, lo guarda directo ahí (subcarpeta del
  // trimestre); si no, o si falla, cae de vuelta a la descarga normal del navegador.
  async function deliverFile(blob, filename){
    if (saveDirHandle){
      try{
        const folder = await getTrimesterSubfolder();
        const fileHandle = await folder.getFileHandle(filename, {create:true});
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      }catch(e){ console.error("No se pudo guardar en la carpeta:", e); }
    }
    downloadBlobFile(filename, blob);
    return false;
  }

  // Guarda un pequeño registro (documentos de usuarios de ese hospital en ese trimestre) en
  // la misma subcarpeta del trimestre, para poder comparar más adelante entre trimestres (ej.
  // detectar quién se repite del 1° al 2°, del 3° contra el 1°+2°, etc.). Se sobreescribe cada
  // vez que se vuelve a generar el reporte de ese hospital/trimestre.
  async function saveTrimesterRegistry(files){
    if (!saveDirHandle) return;
    try{
      const folder = await getTrimesterSubfolder();
      const docSet = new Set();
      (files||state.files).forEach(entry=>{
        const d = entry.data;
        if (!isObject(d) || !Array.isArray(d.usuarios)) return;
        d.usuarios.forEach(u=>{
          if (!isObject(u)) return;
          const doc = clean(u.numDocumentoIdentificacion);
          if (doc) docSet.add(`${clean(u.tipoDocumentoIdentificacion)}|${doc}`);
        });
      });
      const docs = [...docSet].sort();
      const registry = {
        generado: new Date().toISOString(),
        hospital: state.orgConfig.name || "",
        nit: state.orgConfig.nit || "",
        trimestre: state.orgConfig.trimestre || "1",
        anio: state.orgConfig.year || new Date().getFullYear(),
        totalUsuarios: docs.length,
        usuarios: docs
      };
      const fh = await folder.getFileHandle("_registro_usuarios.json", {create:true});
      const w = await fh.createWritable();
      await w.write(JSON.stringify(registry, null, 2));
      await w.close();
    }catch(e){ console.error("No se pudo guardar el registro de usuarios del trimestre:", e); }
  }

  // "_registro_usuarios_unicos.json": a diferencia de "_registro_usuarios.json" (que trae
  // TODOS los usuarios cargados de ese trimestre, sin filtrar), este trae solo los que
  // quedaron DESPUÉS de aplicar el cruce contra trimestres anteriores — es decir, los
  // realmente nuevos/únicos que se están reportando en este trimestre.
  async function saveUniqueUsersRegistry(files){
    if (!saveDirHandle) return;
    try{
      const folder = await getTrimesterSubfolder();
      const docSet = new Set();
      (files||state.files).forEach(entry=>{
        const d = entry.data;
        if (!isObject(d) || !Array.isArray(d.usuarios)) return;
        d.usuarios.forEach(u=>{
          if (!isObject(u)) return;
          const doc = clean(u.numDocumentoIdentificacion);
          if (doc) docSet.add(`${clean(u.tipoDocumentoIdentificacion)}|${doc}`);
        });
      });
      const docs = [...docSet].sort();
      const registry = {
        generado: new Date().toISOString(),
        hospital: state.orgConfig.name || "",
        nit: state.orgConfig.nit || "",
        trimestre: state.orgConfig.trimestre || "1",
        anio: state.orgConfig.year || new Date().getFullYear(),
        nota: "Usuarios únicos de este trimestre, después de excluir los que ya se habían reportado en trimestres anteriores del mismo año (cruce 2° vs 1°, 3° vs 1°+2°, 4° vs 1°+2°+3°).",
        totalUsuariosUnicos: docs.length,
        usuarios: docs
      };
      const fh = await folder.getFileHandle("_registro_usuarios_unicos.json", {create:true});
      const w = await fh.createWritable();
      await w.write(JSON.stringify(registry, null, 2));
      await w.close();
    }catch(e){ console.error("No se pudo guardar el registro de usuarios únicos:", e); }
  }

  // "Generar todos los hospitales": agrupa los RIPS ya cargados por NIT (numDocumentoIdObligado)
  // y, para cada uno, genera su PDF + TXT + registro de usuarios en su propia subcarpeta
  // (nombrada con el nombre del hospital) dentro de la carpeta de guardado elegida.
  async function generateAllHospitals(){
    if (!saveDirHandle) return toast("Primero elige una carpeta de guardado, arriba.");
    if (!state.files.length) return toast("No hay archivos cargados.");

    const groups = new Map();
    state.files.forEach(entry=>{
      const nit = clean(entry.data?.numDocumentoIdObligado) || "SIN_NIT";
      if (!groups.has(nit)) groups.set(nit, []);
      groups.get(nit).push(entry);
    });

    const originalFiles = state.files;
    const originalName = state.orgConfig.name;
    const originalNit = state.orgConfig.nit;
    let count = 0;
    for (const [nit, files] of groups.entries()){
      const hospitalName = window.ENTITY_CATALOG?.[nit] || nit;
      state.files = files;
      state.orgConfig.name = hospitalName;
      state.orgConfig.nit = nit;
      toast(`Generando reporte de: ${hospitalName}...`);
      try{
        await downloadReportPdf();
        await downloadTxtGroupedForAllFiles(); // ya guarda también los registros (completo y único) de este hospital/trimestre.
        count++;
      }catch(e){ console.error(`Error generando ${hospitalName}:`, e); }
    }
    state.files = originalFiles;
    state.orgConfig.name = originalName;
    state.orgConfig.nit = originalNit;
    renderAll();
    toast(`Listo: se generaron ${count} hospital(es), cada uno en su propia carpeta dentro de la que elegiste.`);
  }

  // Trimestres anteriores del mismo año a comparar, según el trimestre actual:
  // 2° -> [1]; 3° -> [1,2]; 4° -> [1,2,3]; 1° no tiene anteriores.
  function previousTrimesters(trimestre){
    const t = Number(trimestre);
    const arr = [];
    for (let i=1;i<t;i++) arr.push(i);
    return arr;
  }

  // Lee el registro de usuarios guardado (_registro_usuarios.json) de un trimestre anterior
  // ya generado, desde la misma carpeta de guardado elegida. Si no existe (nunca se generó
  // ese trimestre, o se generó en otra carpeta), devuelve null.
  async function readTrimesterRegistry(hospitalName, trimestre, anio){
    if (!saveDirHandle) return null;
    try{
      const hospitalFolder = await saveDirHandle.getDirectoryHandle(safeFile(hospitalName), {create:false});
      const yy = String(anio).slice(-2);
      const trimFolder = await hospitalFolder.getDirectoryHandle(`${trimestre}Trim${yy}`, {create:false});
      const fileHandle = await trimFolder.getFileHandle("_registro_usuarios.json", {create:false});
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text());
    }catch{ return null; }
  }

  // Compara los usuarios de los RIPS cargados ahora mismo (el trimestre "actual", según lo
  // configurado) contra los registros ya guardados de los trimestres anteriores del mismo año
  // para el mismo hospital: 2° vs 1°; 3° vs 1° y 2°; 4° vs 1°, 2° y 3°.
  async function compareWithPreviousTrimesters(){
    if (!saveDirHandle) return toast("Primero elige la carpeta de guardado donde se han estado guardando los registros por trimestre."), null;
    if (!state.files.length) return toast("No hay archivos cargados para comparar."), null;
    const hospitalName = state.orgConfig.name;
    if (!hospitalName) return toast("Configura el nombre del hospital primero."), null;
    const trimestreActual = Number(state.orgConfig.trimestre || "1");
    const anio = state.orgConfig.year || new Date().getFullYear();
    const prevList = previousTrimesters(trimestreActual);
    if (!prevList.length){ toast(`El ${trimestreActual}° trimestre no tiene trimestres anteriores en ${anio} para comparar.`); return null; }

    const currentDocs = new Set();
    state.files.forEach(entry=>{
      const d = entry.data;
      if (!isObject(d) || !Array.isArray(d.usuarios)) return;
      d.usuarios.forEach(u=>{
        if (!isObject(u)) return;
        const doc = clean(u.numDocumentoIdentificacion);
        if (doc) currentDocs.add(`${clean(u.tipoDocumentoIdentificacion)}|${doc}`);
      });
    });

    const results = [];
    const overlapUnion = new Set();
    for (const t of prevList){
      const reg = await readTrimesterRegistry(hospitalName, t, anio);
      if (!reg){ results.push({trimestre:t, encontrado:false}); continue; }
      const prevDocs = new Set(reg.usuarios||[]);
      const overlap = [...currentDocs].filter(d=>prevDocs.has(d));
      overlap.forEach(d=>overlapUnion.add(d));
      results.push({trimestre:t, encontrado:true, totalPrevio:prevDocs.size, repetidos:overlap.length, listaRepetidos:overlap});
    }

    return {trimestreActual, anio, hospitalName, totalActual:currentDocs.size, prevList, results, totalRepetidosUnion:overlapUnion.size, repetidosUnion:[...overlapUnion]};
  }

  function renderTrimesterCompareResults(data){
    if (!els.trimesterCompareResults) return;
    if (!data){ els.trimesterCompareResults.innerHTML = ""; return; }
    const rows = data.results.map(r=>{
      if (!r.encontrado) return `<tr><td>${r.trimestre}° Trim ${data.anio}</td><td colspan="4" style="color:#ad3838">No se encontró el registro guardado de ese trimestre en la carpeta elegida</td></tr>`;
      const docsPreview = r.listaRepetidos.slice(0,8).map(d=>esc(d.split("|")[1]||d)).join(", ") + (r.listaRepetidos.length>8 ? "…" : "");
      const diferencia = r.totalPrevio - r.repetidos;
      return `<tr><td>${r.trimestre}° Trim ${data.anio}</td><td>${r.totalPrevio}</td><td>${r.repetidos}</td><td><strong>${diferencia}</strong></td><td>${r.repetidos?docsPreview:"—"}</td></tr>`;
    }).join("");
    els.trimesterCompareResults.innerHTML = `<div class="panel" style="margin-top:10px">
      <p style="font-size:12px;font-weight:800;margin-bottom:8px">Comparación para ${esc(data.hospitalName)} — ${data.trimestreActual}° Trim ${data.anio} (${data.totalActual} usuario(s) cargados ahora) contra trimestres anteriores:</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Trimestre comparado</th><th>Usuarios en ese trimestre</th><th>Repetidos con el actual</th><th>Diferencia</th><th>Documentos repetidos (muestra)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p style="font-size:11px;color:var(--muted);margin-top:4px">Diferencia = usuarios de ese trimestre − repetidos con el actual (los que NO volvieron a aparecer ahora).</p>
      <p style="font-size:12px;margin-top:8px"><strong>${data.totalRepetidosUnion}</strong> de los ${data.totalActual} usuario(s) actuales ya habían aparecido en alguno de los trimestres anteriores comparados.</p>
    </div>`;
  }

  // Quita de los archivos (una copia, no toca lo cargado en pantalla) los usuarios que ya
  // aparecieron en algún trimestre anterior del mismo año para el mismo hospital: el 1° nunca
  // se filtra (no tiene anteriores); el 2° se filtra contra el 1°; el 3° contra el 1° y 2°; el
  // 4° contra el 1°, 2° y 3°. Así lo que se guarda en la carpeta (PDF y TXT) de cada trimestre
  // nunca repite un usuario que ya se reportó en uno anterior.
  async function filterAlreadySeenUsers(files){
    if (!els.cfgExcludeRepeated || !els.cfgExcludeRepeated.checked) return {files, removedCount:0, removedDocs:[]};
    const trimestre = Number(state.orgConfig.trimestre || "1");
    const anio = state.orgConfig.year || new Date().getFullYear();
    const hospitalName = state.orgConfig.name;
    const prevList = previousTrimesters(trimestre);
    if (!prevList.length || !hospitalName || !saveDirHandle) return {files, removedCount:0, removedDocs:[]};

    const seen = new Set();
    for (const t of prevList){
      const reg = await readTrimesterRegistry(hospitalName, t, anio);
      if (reg?.usuarios) reg.usuarios.forEach(d=>seen.add(d));
    }
    if (!seen.size) return {files, removedCount:0, removedDocs:[]};

    let removedCount = 0;
    const removedDocs = [];
    const filteredFiles = files.map(entry=>{
      const d = entry.data;
      if (!isObject(d) || !Array.isArray(d.usuarios)) return entry;
      const clone = JSON.parse(JSON.stringify(d)); // copia: nunca se modifica lo cargado en pantalla.
      const kept = [];
      clone.usuarios.forEach(u=>{
        const key = `${clean(u?.tipoDocumentoIdentificacion)}|${clean(u?.numDocumentoIdentificacion)}`;
        if (seen.has(key)){ removedCount++; removedDocs.push(key); }
        else kept.push(u);
      });
      clone.usuarios = kept;
      return {...entry, data: clone};
    });

    return {files: filteredFiles, removedCount, removedDocs};
  }

  async function clearAll(){
    if(!confirm("Se eliminarán los archivos procesados, el estado local y la caché de esta aplicación. ¿Continuar?")) return;
    toast("Limpiando caché...");
    state.files=[];state.users=[];state.serviceRows=[];state.codeSummary=[];state.findings=[];state.ignoredFiles=[];state.sameFileDuplicates=[];state.selectedSameFileKeep.clear();
    INDICATOR_DEFS.forEach(d=>{ state.dec2193[d.key] = 0; });
    state.detectedEntities = [];
    state.orgConfig.name = ""; state.orgConfig.nit = ""; state.orgConfig.trimestre = "1";
    state.orgConfig.year = String(new Date().getFullYear()); state.orgConfig.signerName = "MARILUZ CABRERA";
    els.fileInput.value="";els.folderInput.value="";
    try{localStorage.clear();sessionStorage.clear();}catch{}
    try{if("caches" in window){for(const k of await caches.keys()) await caches.delete(k)}}catch{}
    try{
      if(indexedDB?.databases){for(const db of await indexedDB.databases()) if(db.name) indexedDB.deleteDatabase(db.name)}
    }catch{}
    renderAll(); renderIndicatorConfig(); renderOrgConfig(); renderDetectedEntities(); toast("Datos y caché limpios");
  }

  function clearDec2193Only(){
    if (!confirm("¿Borrar los 6 valores de Dec2193 que se ven aquí? Esto no afecta los RIPS cargados.")) return;
    INDICATOR_DEFS.forEach(d=>{ state.dec2193[d.key] = 0; });
    saveDec2193();
    renderIndicatorConfig();
    toast("Valores Dec2193 borrados");
  }

  function persistLightState(){
    try{localStorage.setItem("rips0948:lastStats",JSON.stringify({files:state.files.length,users:state.users.length,services:state.serviceRows.length,at:new Date().toISOString()}))}catch{}
  }

  function statusPill(s){return s==="OK"?'<span class="pill ok">SIN ERRORES</span>':s==="ALERTA"?'<span class="pill warn">CON ALERTAS</span>':'<span class="pill err">CON ERRORES</span>'}
  function toggleBadge(el,n){el.textContent=n;el.classList.toggle("hidden",!n)}
  function isObject(v){return v && typeof v==="object" && !Array.isArray(v)}
  function clean(v){return v===undefined||v===null?"":String(v).trim()}
  // Analiza un valor de fecha RIPS (AAAA-MM-DD o AAAA-MM-DD HH:MM) y detecta estructura inválida
  // (mes/día/hora/minuto fuera de rango) o formato válido pero sin ceros a la izquierda.
  // Calcula la edad en años a partir de fechaNacimiento (AAAA-MM-DD...), usando la fecha de
  // hoy como referencia. Devuelve null si la fecha no es válida, para no inventar una edad.
  function calculateAge(fechaNacimiento, refDate){
    const info = analyzeDateStr(fechaNacimiento);
    if (!info.valid) return null;
    const [y,m,d] = info.normalized.split(" ")[0].split("-").map(Number);
    const ref = refDate ? new Date(refDate) : new Date();
    let age = ref.getFullYear() - y;
    const beforeBirthday = (ref.getMonth()+1 < m) || (ref.getMonth()+1===m && ref.getDate() < d);
    if (beforeBirthday) age--;
    return age>=0 && age<130 ? age : null;
  }

  function analyzeDateStr(raw){
    const s = clean(raw);
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/);
    if (!m) return {valid:false, reason:`formato inesperado, se espera AAAA-MM-DD o AAAA-MM-DD HH:MM (valor: "${s}")`};
    const [, y, mo, da, hh, mi] = m;
    const month = Number(mo), day = Number(da);
    if (month < 1 || month > 12) return {valid:false, reason:`el mes "${mo}" no es válido (debe ser 01-12)`};
    const daysInMonth = new Date(Number(y), month, 0).getDate();
    if (day < 1 || day > daysInMonth) return {valid:false, reason:`el día "${da}" no es válido para el mes ${mo}`};
    let hour=null, min=null;
    if (hh !== undefined){
      hour = Number(hh); min = Number(mi);
      if (hour < 0 || hour > 23) return {valid:false, reason:`la hora "${hh}" no es válida (debe ser 00-23)`};
      if (min < 0 || min > 59) return {valid:false, reason:`el minuto "${mi}" no es válido (debe ser 00-59)`};
    }
    const normalized = `${y}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`+(hh!==undefined?` ${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}`:"");
    return {valid:true, needsPad: normalized !== s, normalized};
  }
  // Recorre los campos que empiezan por "fecha" de un objeto (usuario o registro de servicio)
  // y reporta hallazgos de fecha inválida (requiere corrección manual con "Corregir") o
  // fecha válida pero sin ceros a la izquierda (se puede corregir automáticamente en lote).
  // Distancia de edición (Levenshtein), usada para detectar campos "mal escritos"
  // (ej. "codPrestaor" en vez de "codPrestador") y sugerir la corrección exacta.
  // Parametrización manual de campos: para cuando un campo hoy está en null (ej. codigoVIDA,
  // vrDispensacion) pero más adelante el RIPS podría exigirle valor y/o un tipo de dato
  // concreto. Solo se validan los campos que el usuario configuró explícitamente aquí; el
  // resto sigue funcionando igual que antes. Se guarda en localStorage para persistir.
  const FIELD_TYPE_OPTIONS = [
    {value:"any", label:"Cualquiera"},
    {value:"numeric", label:"Solo números"},
    {value:"alpha", label:"Solo letras"},
    {value:"alphanumeric", label:"Alfanumérico (letras y números)"},
    {value:"date", label:"Fecha (AAAA-MM-DD, ej. 2026-01-03)"},
    {value:"datetime", label:"Fecha y hora (AAAA-MM-DD HH:MM, ej. 2026-01-03 12:00)"}
  ];
  function ruleKey(scope,field){ return `${scope}|${field}`; }
  function saveFieldRules(){
    try{ localStorage.setItem("rips0948:fieldRules", JSON.stringify(Object.fromEntries(state.fieldRules.entries()))); }catch{}
  }
  function getFieldRule(scope,field){
    return state.fieldRules.get(ruleKey(scope,field)) || {required:false,type:"any"};
  }
  // Revisa los campos de un objeto (raíz, usuario o registro de servicio) contra las reglas
  // de parametrización configuradas para ese "scope". Solo actúa sobre campos con regla
  // explícita; el resto no se toca.
  function checkFieldRules(entry,obj,basePath,scope){
    if (!isObject(obj)) return;
    const prefix = `${scope}|`;
    for (const [ruleId, rule] of state.fieldRules.entries()){
      if (!ruleId.startsWith(prefix)) continue;
      const field = ruleId.slice(prefix.length);
      const val = obj[field];
      const isEmpty = val===null || val===undefined || val==="";
      if (rule.required && isEmpty){
        addFinding(entry,"ERROR","CAMPO_PARAMETRIZADO_VACIO",
          `El campo "${field}" debe tener valor según la parametrización configurada, pero está vacío, en null o no existe.`,
          `${basePath}.${field}`);
        continue;
      }
      if (!isEmpty && rule.type && rule.type!=="any"){
        const s = String(val);
        let ok=true, label="";
        if (rule.type==="numeric"){ ok=/^-?\d+(\.\d+)?$/.test(s); label="numérico"; }
        else if (rule.type==="alpha"){ ok=/^[A-Za-zÀ-ÿñÑ\s]+$/.test(s); label="solo letras"; }
        else if (rule.type==="alphanumeric"){ ok=/^[A-Za-z0-9]+$/.test(s); label="alfanumérico"; }
        else if (rule.type==="date"){
          const info = analyzeDateStr(s);
          ok = info.valid && !/ \d{2}:\d{2}$/.test(info.normalized);
          label = "una fecha válida en formato AAAA-MM-DD (ej. 2026-01-03)"+(info.valid?"":`: ${info.reason}`);
        }
        else if (rule.type==="datetime"){
          const info = analyzeDateStr(s);
          ok = info.valid && / \d{2}:\d{2}$/.test(info.normalized);
          label = "una fecha con hora válida en formato AAAA-MM-DD HH:MM (ej. 2026-01-03 12:00)"+(info.valid?"":`: ${info.reason}`);
        }
        if (!ok){
          addFinding(entry,"ERROR","CAMPO_PARAMETRIZADO_TIPO_INVALIDO",
            `El campo "${field}" debe ser ${label} según la parametrización configurada (valor actual: "${s}").`,
            `${basePath}.${field}`);
        }
      }
    }
  }
  // Busca un valor de ejemplo real ya cargado para mostrar en el panel de parametrización
  // (útil para ver de un vistazo qué campos están en null hoy, como pediste).
  function findExampleValue(scope,field){
    for (const entry of state.files){
      if (!entry.data) continue;
      if (scope==="root"){ if (field in entry.data) return entry.data[field]; continue; }
      const usuarios = entry.data.usuarios;
      if (!Array.isArray(usuarios)) continue;
      for (const u of usuarios){
        if (!isObject(u)) continue;
        if (scope==="usuario"){ if (field in u) return u[field]; continue; }
        const arr = u.servicios?.[scope];
        if (Array.isArray(arr)) for (const row of arr){ if (isObject(row) && field in row) return row[field]; }
      }
    }
    return undefined;
  }

  function renderFieldRules(){
    if (!els.fieldRulesGroups) return;
    const filter = (els.fieldRulesFilter?.value || "").trim().toLowerCase();
    const sections = [
      {scope:"root", label:"Raíz del RIPS", fields: window.RIPS_SCHEMA?.root || []},
      {scope:"usuario", label:"Usuario", fields: (window.RIPS_SCHEMA?.usuario || []).filter(f=>f!=="servicios")},
      ...SERVICE_KEYS.map(key=>({scope:key, label:LABELS[key]||key, fields: window.RIPS_SCHEMA?.servicios?.[key] || []}))
    ];

    els.fieldRulesGroups.innerHTML = sections.map(sec=>{
      const fields = sec.fields.filter(f=>!filter || f.toLowerCase().includes(filter));
      if (!fields.length) return "";
      const configuredCount = sec.fields.filter(f=>state.fieldRules.has(ruleKey(sec.scope,f))).length;
      const rows = fields.map(field=>{
        const rule = getFieldRule(sec.scope,field);
        const example = findExampleValue(sec.scope,field);
        const exampleLabel = example===undefined ? "sin datos cargados" : (example===null ? "null" : (example===""?"vacío":String(example)));
        return `<div class="field-rule-row">
          <div class="field-rule-name"><strong>${esc(field)}</strong><span>ejemplo actual: ${esc(exampleLabel)}</span></div>
          <select data-rule-scope="${escAttr(sec.scope)}" data-rule-field="${escAttr(field)}" data-rule-kind="required">
            <option value="0" ${!rule.required?"selected":""}>Puede estar vacío / null</option>
            <option value="1" ${rule.required?"selected":""}>Debe tener valor</option>
          </select>
          <select data-rule-scope="${escAttr(sec.scope)}" data-rule-field="${escAttr(field)}" data-rule-kind="type">
            ${FIELD_TYPE_OPTIONS.map(o=>`<option value="${o.value}" ${rule.type===o.value?"selected":""}>${esc(o.label)}</option>`).join("")}
          </select>
        </div>`;
      }).join("");
      return `<details class="panel schema-group"${filter||configuredCount?" open":""}>
        <summary>${esc(sec.label)} <span class="pill">${fields.length} campo(s)${configuredCount?` · ${configuredCount} parametrizado(s)`:""}</span></summary>
        <div class="field-rule-list">${rows}</div>
      </details>`;
    }).join("");

    document.querySelectorAll("[data-rule-scope]").forEach(sel=>sel.addEventListener("change",()=>{
      const scope=sel.dataset.ruleScope, field=sel.dataset.ruleField, kind=sel.dataset.ruleKind;
      const key = ruleKey(scope,field);
      const current = state.fieldRules.get(key) || {required:false,type:"any"};
      if (kind==="required") current.required = sel.value==="1";
      else current.type = sel.value;
      // Se guarda SIEMPRE lo que el usuario eligió, aunque sea igual al valor por defecto.
      // Antes, si quedaba en "puede estar vacío" + "cualquiera", se borraba la regla en vez de
      // guardarla, y eso hacía que el campo volviera a quedar "sin parametrizar": si ese campo
      // tenía una validación fija por defecto (obligatorio), esa validación se reactivaba sola
      // e ignoraba lo que el usuario acababa de configurar. Ahora la elección siempre manda.
      state.fieldRules.set(key,current);
      saveFieldRules();
      revalidateAll();
    }));
  }

  function levenshtein(a,b){
    a=String(a); b=String(b);
    const m=a.length, n=b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({length:m+1},()=>new Array(n+1).fill(0));
    for (let i=0;i<=m;i++) dp[i][0]=i;
    for (let j=0;j<=n;j++) dp[0][j]=j;
    for (let i=1;i<=m;i++)
      for (let j=1;j<=n;j++)
        dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j-1],dp[i-1][j],dp[i][j-1]);
    return dp[m][n];
  }

  // Compara las llaves de un objeto (raíz del RIPS, usuario, o un registro de servicio) contra
  // la estructura de referencia capturada de los RIPS "buenos" que se cargaron inicialmente.
  // Reporta: campos mal escritos (par muy cercano faltante+sobrante -> se puede renombrar solo),
  // campos faltantes (se pueden insertar con valor null) y campos desconocidos/sobrantes que no
  // pertenecen a esa estructura (revisión manual antes de quitarlos, por si acaso tienen datos).
  function checkSchemaKeys(entry,obj,expectedKeys,basePath,label,payloadBase){
    if (!isObject(obj) || !Array.isArray(expectedKeys) || !expectedKeys.length) return;
    let missing = expectedKeys.filter(k => !(k in obj));
    let extra = Object.keys(obj).filter(k => !expectedKeys.includes(k));

    const pairs = [];
    missing.forEach(mKey=>{
      let best=null, bestDist=Infinity;
      extra.forEach(eKey=>{ const d=levenshtein(mKey,eKey); if (d<bestDist){bestDist=d;best=eKey;} });
      if (best!==null && bestDist<=2 && bestDist<Math.max(mKey.length,best.length)) pairs.push({missing:mKey,extra:best,dist:bestDist});
    });
    pairs.sort((a,b)=>a.dist-b.dist);
    const usedExtra=new Set(), usedMissing=new Set(), confirmed=[];
    pairs.forEach(pr=>{
      if (usedExtra.has(pr.extra) || usedMissing.has(pr.missing)) return;
      usedExtra.add(pr.extra); usedMissing.add(pr.missing); confirmed.push(pr);
    });

    confirmed.forEach(pr=>{
      addFinding(entry,"ERROR","ESTRUCTURA_CAMPO_MAL_ESCRITO",
        `El campo "${pr.extra}" no existe en la estructura de referencia de ${label}; parece un error de escritura de "${pr.missing}".`,
        `${basePath}.${pr.extra}`, `valor actual: ${JSON.stringify(obj[pr.extra])}`,
        "RENAME_FIELD_KEY", {...payloadBase, oldKey:pr.extra, newKey:pr.missing});
    });

    missing.filter(k=>!usedMissing.has(k)).forEach(k=>{
      addFinding(entry,"ERROR","ESTRUCTURA_CAMPO_FALTANTE",
        `Falta el campo "${k}" según la estructura de referencia de ${label}.`,
        `${basePath}.${k}`, "", "ADD_MISSING_FIELD", {...payloadBase, key:k});
    });

    extra.filter(k=>!usedExtra.has(k)).forEach(k=>{
      addFinding(entry,"ERROR","ESTRUCTURA_CAMPO_DESCONOCIDO",
        `El campo "${k}" no pertenece a la estructura de referencia de ${label} (sobra o está mal escrito).`,
        `${basePath}.${k}`, `valor actual: ${JSON.stringify(obj[k])}`,
        "REMOVE_UNKNOWN_FIELD", {...payloadBase, key:k});
    });
  }

  // Detecta nombres de grupo de servicios mal escritos dentro de "servicios"
  // (ej. "consulta" en vez de "consultas"), sugiriendo o marcando el más parecido.
  function checkServiceGroupNames(entry,u,ui){
    if (!isObject(u.servicios)) return;
    Object.keys(u.servicios).forEach(key=>{
      if (SERVICE_KEYS.includes(key)) return;
      let best=null, bestDist=Infinity;
      SERVICE_KEYS.forEach(sk=>{ const d=levenshtein(key,sk); if (d<bestDist){bestDist=d;best=sk;} });
      if (best!==null && bestDist<=2){
        addFinding(entry,"ERROR","ESTRUCTURA_GRUPO_MAL_ESCRITO",
          `El grupo de servicios "${key}" no existe; parece un error de escritura de "${best}".`,
          `$.usuarios[${ui}].servicios.${key}`, "", "RENAME_SERVICE_GROUP", {userIndex:ui, oldKey:key, newKey:best});
      } else {
        addFinding(entry,"ERROR","ESTRUCTURA_GRUPO_DESCONOCIDO",
          `El grupo de servicios "${key}" no es un grupo reconocido de la estructura RIPS.`,
          `$.usuarios[${ui}].servicios.${key}`);
      }
    });
  }

  // Ubica el objeto real (raíz, usuario o registro de servicio) al que pertenece un hallazgo
  // de estructura, para poder leer/renombrar/insertar/quitar la llave indicada en el payload.
  function resolveSchemaTarget(entry,p){
    if (p.scope === "root") return entry.data;
    const u = entry.data?.usuarios?.[p.userIndex];
    if (!isObject(u)) return null;
    if (p.scope === "usuario") return u;
    if (p.scope === "servicio"){
      const row = u.servicios?.[p.serviceKey]?.[p.rowIndex];
      return isObject(row) ? row : null;
    }
    return null;
  }

  function checkDateFields(entry,obj,basePath,payloadBase){
    if (!isObject(obj)) return;
    Object.keys(obj).forEach(k=>{
      if (!/^fecha/i.test(k)) return;
      const val = obj[k];
      if (val===null || val===undefined || val==="") return;
      const info = analyzeDateStr(val);
      if (!info.valid){
        addFinding(entry,"ERROR","FECHA_INVALIDA",`El campo ${k} tiene una fecha con formato inválido: ${info.reason}.`,`${basePath}.${k}`,String(val),"EDIT_DATE_FIELD",{...payloadBase,field:k});
      } else if (info.needsPad){
        addFinding(entry,"ALERTA","FECHA_SIN_CEROS",`El campo ${k} tiene una fecha válida pero sin ceros a la izquierda.`,`${basePath}.${k}`,`${val} → ${info.normalized}`,"PAD_DATE_FIELD",{...payloadBase,field:k,normalized:info.normalized});
      }
    });
  }
  // Ubica el objeto real dentro de entry.data al que pertenece un hallazgo de fecha, para
  // poder leer/escribir el campo indicado en el payload (userIndex, y opcionalmente
  // serviceKey + rowIndex si la fecha está dentro de un registro de servicio).
  function resolveDateTarget(entry,p){
    const u = entry.data?.usuarios?.[p.userIndex];
    if (!isObject(u)) return null;
    if (p.serviceKey !== undefined && p.rowIndex !== undefined){
      const row = u.servicios?.[p.serviceKey]?.[p.rowIndex];
      return isObject(row) ? {obj:row} : null;
    }
    return {obj:u};
  }
  function esc(v){return clean(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
  function escAttr(v){return esc(v)}
  function safeFile(v){return String(v).replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,60)}
  function formatBytes(n){if(!n)return"0 B";const u=["B","KB","MB","GB"];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return`${n.toFixed(i?1:0)} ${u[i]}`}
  function currency(v){return new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(v||0)}
  function csvCell(v){const s=String(v??"");return `"${s.replace(/"/g,'""')}"`}
  function structuredCloneSafe(v){return window.structuredClone?structuredClone(v):JSON.parse(JSON.stringify(v))}
  function downloadBlob(name,text,type){const blob=new Blob([text],{type});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  let toastTimer; function toast(msg){els.toast.textContent=msg;els.toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.classList.remove("show"),2600)}
  renderAll();
  restoreSaveFolder();
})();
