"use strict";

const socket = io();
const { H, R, LARGO, ESP, NBOLAS, NDIAG, centroColumna, radioBola, pistonAlto, barraAlto, espinas, barraDiag, alcanceDiag } = NIVEL;

const ANCHO = 960;
const HEX = ["#e84833", "#d4ff00", "#6a00ff", "#ff3a9f"];   // rojo, lima, violeta, rosa
const COLORES_RGB = [[232, 72, 51], [212, 255, 0], [106, 0, 255], [255, 58, 159]];
const NOMBRES = ["rojo", "lima", "violeta", "rosa"];
const DIFICULTADES = ["facil", "normal", "dificil", "extremo"];
const ROTULO_DIF = { facil: "FÁCIL", normal: "MEDIO", dificil: "DIFÍCIL", extremo: "EXTREMO" };

const $ = (id) => document.getElementById(id);
const SECCIONES = ["entrada", "espera", "juego", "final"];
const mostrar = (id) => {
  SECCIONES.forEach((s) => { $(s).hidden = s !== id; });
  if (id !== "espera") cerrarPopMic();
};

let miApodo = null;
let lobby = [];                 // [{ apodo, color, listo }]
let dificultad = "facil";
let nivel = null;
let enJuego = false;
let nitroTomada = false;
let reloj = { t: 0, desde: 0 }; // tiempo de la carrera que informó el servidor
const vivos = new Map();        // apodo -> estado dibujado
let anuncio = { texto: "", hasta: 0 };
let destello = 0;

const anunciar = (texto, ms) => { anuncio = { texto, hasta: performance.now() + ms }; };
const tCarrera = () => (reloj.desde ? reloj.t + (performance.now() - reloj.desde) / 1000 : 0);

// ---------------------------------------------------------------------------
// Ajuste a la voz de cada persona (como el punto 6.2 de la clase, en pasadas)
// ---------------------------------------------------------------------------
try {
  const g = JSON.parse(localStorage.getItem("ajustesVoz"));
  if (g && g.agudoHz > g.graveHz && g.piso > 0) {
    Object.assign(AJUSTES, { piso: g.piso, graveHz: g.graveHz, agudoHz: g.agudoHz });
  }
} catch { /* sin almacenamiento: quedan los valores de AJUSTES */ }

let muestras = null;            // mientras se mide, draw() va guardando lo que lee
const medir = (ms) => new Promise((resolver) => {
  muestras = [];
  setTimeout(() => { const m = muestras; muestras = null; resolver(m); }, ms);
});
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const mediana = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
const estadoMic = (texto) => { $("estado-mic").textContent = texto; };

// Mide durante ms y muestra la cuenta regresiva (3, 2, 1) junto al texto.
async function medirContando(ms) {
  const fin = performance.now() + ms;
  const mostrarN = () => { $("cuenta-cal").textContent = String(Math.ceil(Math.max(0, fin - performance.now()) / 1000) || ""); };
  mostrarN();
  const id = setInterval(mostrarN, 150);
  const m = await medir(ms);
  clearInterval(id);
  $("cuenta-cal").textContent = "";
  return m;
}

// ---------------------------------------------------------------------------
// Pop-up del micrófono
// ---------------------------------------------------------------------------
const TEXTO_MIC_INICIAL = "Activá el micrófono y calibrá tu voz.";
let micPedido = false;          // ya se intentó abrir el micrófono
let calibrando = false;
let focoPrevio = null;

function abrirMic() {
  micPedido = true;
  abrirSonido(() => {
    micPedido = false;
    estadoMic("No se pudo usar el micrófono. Revisá el permiso del navegador.");
  });
}

function abrirPopMic() {
  focoPrevio = document.activeElement;
  if (!calibrando) estadoMic(TEXTO_MIC_INICIAL);
  // El pop-up toma el color del jugador (rojo, lima, violeta o rosa).
  const yo = lobby.find((j) => j.apodo === miApodo);
  if (yo) {
    $("pop-mic").style.setProperty("--acento", HEX[yo.color]);
    $("pop-mic").style.setProperty("--sobre", yo.color === 2 ? "#ffffff" : "#000000");
  }
  $("pop-mic").hidden = false;
  $("btn-mic").focus();
}

function cerrarPopMic() {
  if ($("pop-mic").hidden) return;
  $("pop-mic").hidden = true;
  if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
}

$("cerrar-mic").addEventListener("click", cerrarPopMic);
$("pop-mic").addEventListener("click", (e) => { if (e.target === $("pop-mic")) cerrarPopMic(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarPopMic(); });

async function calibrar() {
  if (calibrando) return;
  if (!micPedido) {                              // el permiso tapa la medición: primero se acepta
    abrirMic();
    estadoMic("Aceptá el permiso del navegador y tocá CALIBRAR otra vez.");
    return;
  }
  calibrando = true;
  $("btn-mic").disabled = $("btn-calibrar").disabled = true;
  try {
    // Pasada 1: 3 segundos de silencio. El piso va apenas por arriba del valor
    // más alto que apareció en silencio.
    estadoMic("Mantené silencio por 3 segundos");
    let m = await medirContando(3000);
    AJUSTES.piso = Math.max(...m.map((s) => s.nivel), 0) * 1.3 + 0.003;

    // Pasadas 2 y 3: 3 segundos de sonido agudo y 3 de sonido grave.
    const hzs = [];
    for (const texto of ["Hacé un sonido agudo por 3 segundos", "Ahora un sonido grave por 3 segundos"]) {
      estadoMic(texto);
      await pausa(600);
      m = (await medirContando(3000)).filter((s) => s.hz).map((s) => s.hz);
      if (m.length < 15) {
        estadoMic("No te escuché bien. Probá de nuevo, más cerca del micrófono.");
        return;
      }
      hzs.push(mediana(m));
    }
    let [lo, hi] = [Math.min(...hzs), Math.max(...hzs)];
    if (hi / lo < 1.5) {                           // rango muy corto: se ensancha
      const centro = Math.sqrt(lo * hi);
      [lo, hi] = [centro / 1.3, centro * 1.3];
    }
    Object.assign(AJUSTES, { graveHz: lo, agudoHz: hi });
    try {
      localStorage.setItem("ajustesVoz", JSON.stringify({ piso: AJUSTES.piso, graveHz: lo, agudoHz: hi }));
    } catch { /* sin almacenamiento */ }
    estadoMic(`¡Listo! Rango de ${Math.round(lo)} a ${Math.round(hi)} Hz. Probá cantando: la barra sube con los agudos.`);
  } finally {
    calibrando = false;
    $("btn-mic").disabled = $("btn-calibrar").disabled = false;
  }
}

$("btn-mic").addEventListener("click", () => {
  abrirMic();
  estadoMic("Micrófono abierto con valores estándar. Si no te sigue bien, calibrá tu voz.");
});
$("btn-calibrar").addEventListener("click", calibrar);

// Prueba con teclado, sin micrófono.
let alturaTec = 0.5, usandoTeclas = false;
let ultimoSonido = { altura: null, ajustado: 0 };
const alturaEfectiva = () => (ultimoSonido.altura !== null ? ultimoSonido.altura : (usandoTeclas ? alturaTec : null));
window.addEventListener("keydown", (e) => {
  if (enJuego && (e.key === "ArrowUp" || e.key === "ArrowDown")) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Inicio: apodo y sala
// ---------------------------------------------------------------------------
$("datos-entrada").addEventListener("submit", (e) => {
  e.preventDefault();
  $("aviso").textContent = "";
  socket.emit("entrar", { apodo: $("apodo").value, sala: $("sala").value });
});

socket.on("rechazo", (motivo) => { $("aviso").textContent = motivo; });

socket.on("entro", ({ sala, apodo }) => {
  miApodo = apodo;
  $("nombre-sala").textContent = sala;
  mostrar("espera");
});

// Salir de la sala y volver al inicio.
$("btn-salir").addEventListener("click", () => {
  socket.emit("salir");
  miApodo = null;
  lobby = [];
  $("aviso").textContent = "";
  mostrar("entrada");
});

// ---------------------------------------------------------------------------
// Sala de espera: cuatro perfiles (uno por color) que se prenden al entrar alguien
// ---------------------------------------------------------------------------
const PERFILES = [...document.querySelectorAll("#perfiles .perfil")];

function pintarPerfiles(bloqueada) {
  PERFILES.forEach((el, c) => {
    const j = lobby.find((q) => q.color === c);
    const mio = Boolean(j) && j.apodo === miApodo;
    el.classList.toggle("presente", Boolean(j));
    el.classList.toggle("mio", mio);
    el.classList.toggle("listo", Boolean(j && j.listo));
    el.querySelector(".apodo").textContent = j ? j.apodo.toUpperCase() : `JUGADOR ${c + 1}`;
    el.querySelector(".rotulo").textContent = j ? `JUGADOR ${c + 1}${mio ? " · VOS" : ""}` : "";

    // Solo en mi propio perfil: el micrófono y el botón de listo/cancelar.
    const mic = el.querySelector(".mic");
    mic.disabled = !mio;
    mic.setAttribute("aria-label", mio ? "Configurar mi micrófono" : "Micrófono");
    const toggle = el.querySelector(".toggle");
    toggle.hidden = !mio;
    toggle.disabled = bloqueada;
    toggle.firstElementChild.textContent = j && j.listo ? "CANCELAR" : "ESTOY LISTO";

    // En los demás, solo el estado.
    const txt = el.querySelector(".estado-txt");
    txt.hidden = mio;
    txt.textContent = !j ? "ESPERANDO" : j.listo ? "LISTO" : "NO LISTO";
  });
}

socket.on("estado", ({ jugadores, fase, dificultad: dif }) => {
  lobby = jugadores;
  dificultad = dif;
  const bloqueada = fase === "cuenta" || fase === "carrera";

  const pildora = $("btn-dificultad");
  pildora.textContent = `DIFICULTAD: ${ROTULO_DIF[dif]}`;
  pildora.dataset.nivel = dif;
  pildora.disabled = bloqueada;

  pintarPerfiles(bloqueada);

  const listos = jugadores.filter((j) => j.listo).length;
  const todos = jugadores.length > 0 && listos === jugadores.length;
  $("empezar").disabled = bloqueada || !todos;
  $("aviso-espera").textContent = todos || bloqueada ? "" : `Listos: ${listos} de ${jugadores.length}. La carrera empieza cuando todos estén listos.`;
});

$("btn-dificultad").addEventListener("click", () => {
  const siguiente = DIFICULTADES[(DIFICULTADES.indexOf(dificultad) + 1) % DIFICULTADES.length];
  socket.emit("dificultad", siguiente);
});

PERFILES.forEach((el) => {
  el.querySelector(".mic").addEventListener("click", abrirPopMic);
  el.querySelector(".toggle").addEventListener("click", () => {
    const yo = lobby.find((j) => j.apodo === miApodo);
    if (yo) socket.emit("listo", !yo.listo);
  });
});

// La carrera ocupa toda la pantalla: además del estilo, se pide pantalla completa
// (hace falta un gesto de la persona, por eso va en el clic).
$("empezar").addEventListener("click", () => {
  const pantalla = document.documentElement.requestFullscreen?.();
  if (pantalla) pantalla.catch(() => { /* el navegador no lo permite: queda ocupando la ventana */ });
  socket.emit("empezar");
});
// Al terminar la carrera se sale de la pantalla completa.
socket.on("final", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); });

socket.on("nivel", (datos) => {
  nivel = datos.nivel;
  nitroTomada = false;
  reloj = { t: 0, desde: 0 };
  vivos.clear();
  for (const j of lobby) {
    vivos.set(j.apodo, { x: 0, y: H / 2, px: 0, py: H / 2, c: j.color, f: false, z: false, hist: [], flash: 0 });
  }
  enJuego = true;
  destello = 0;
  mostrar("juego");
  anunciar("¡Preparate!", 1500);
});

socket.on("cuenta", (n) => anunciar(n > 0 ? String(n) : "¡YA!", 900));

socket.on("tick", ({ t, j }) => {
  reloj = { t, desde: performance.now() };
  const presentes = new Set(j.map((q) => q.n));
  for (const apodo of vivos.keys()) if (!presentes.has(apodo)) vivos.delete(apodo);
  for (const q of j) {
    let v = vivos.get(q.n);
    if (!v) {
      v = { px: q.x, py: q.y, hist: [], flash: 0 };
      vivos.set(q.n, v);
    }
    Object.assign(v, { x: q.x, y: q.y, c: q.c, f: q.f, z: q.z });
  }
});

socket.on("golpe", ({ apodo }) => {
  const v = vivos.get(apodo);
  if (v) v.flash = frameCount + 24;
  if (apodo === miApodo) {
    destello = 1;
    anunciar("¡Chocaste! Volvés al checkpoint", 1500);
  }
});

socket.on("checkpoint", () => anunciar("✔ Checkpoint", 1200));

socket.on("nitro", ({ apodo }) => {
  nitroTomada = true;
  anunciar(apodo === miApodo ? "⚡ ¡NITRO!" : `⚡ ${apodo} agarró el nitro`, 1800);
});

// ---------------------------------------------------------------------------
// Tabla de posiciones
// ---------------------------------------------------------------------------
const formatoTiempo = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}´`;
function celda(tag, clase, texto) {
  const el = document.createElement(tag);
  el.className = clase;
  el.textContent = texto;
  return el;
}

socket.on("final", ({ ranking }) => {
  enJuego = false;
  const lista = $("final-ranking");
  lista.replaceChildren();
  ranking.forEach((r, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--color", HEX[r.color]);
    li.style.setProperty("--i", i);
    const llego = r.tiempo !== null;
    const tiempo = celda("span", llego ? "t" : "t dnf", llego ? formatoTiempo(r.tiempo) : "No llegó");
    const nick = celda("span", "nick", r.apodo);
    li.append(tiempo, celda("span", "ch", String(r.errores)), nick, celda("span", "pos", `${i + 1}°`));
    lista.append(li);
  });
  mostrar("final");
});

$("jugar-otra").addEventListener("click", () => mostrar("espera"));

// ---------------------------------------------------------------------------
// Dibujo (p5.js)
// ---------------------------------------------------------------------------
function setup() {
  createCanvas(ANCHO, H).parent("lienzo");
  pixelDensity(1);
  frameRate(60);
  textFont("system-ui, sans-serif");
}

// Como en la clase: durante la carrera el micrófono también se abre con el primer clic.
// En la sala se activa desde el pop-up (ícono del micrófono de tu perfil).
function mouseReleased() {
  if (enJuego) abrirMic();
}

function draw() {
  // Teclado de prueba.
  const dt = deltaTime / 1000;
  if (keyIsDown(UP_ARROW)) { alturaTec = Math.min(1, alturaTec + 1.2 * dt); usandoTeclas = true; }
  if (keyIsDown(DOWN_ARROW)) { alturaTec = Math.max(0, alturaTec - 1.2 * dt); usandoTeclas = true; }

  // El sonido se lee en todos los cuadros: el suavizado lo necesita.
  const sonido = leerSonido();
  ultimoSonido = sonido;
  if (sonido.altura !== null) usandoTeclas = false;
  if (muestras) muestras.push(sonido);

  // La altura es estado: sale unas veinte veces por segundo.
  if (frameCount % 3 === 0) {
    $("medidor-volumen").value = sonido.ajustado * 100;
    $("medidor").value = (alturaEfectiva() ?? 0) * 100;
    if (enJuego) socket.emit("altura", alturaEfectiva());
  }

  if (!enJuego || !nivel) return;
  background(0);

  const yo = vivos.get(miApodo);
  for (const v of vivos.values()) {
    if (Math.abs(v.x - v.px) > 150) {            // vuelta al checkpoint: sin deslizar
      v.px = v.x;
      v.py = v.y;
      v.hist = [];
    } else {
      v.px += (v.x - v.px) * 0.35;
      v.py += (v.y - v.py) * 0.5;
    }
    v.hist.push({ x: v.px, y: v.py });
    if (v.hist.length > 36) v.hist.shift();
  }

  const camX = (yo ? yo.px : 0) - 230;
  const t = tCarrera();
  fondo(camX);
  checkpoints(camX);
  obstaculos(camX, yo, t);
  nitro(camX);
  meta(camX);
  for (const [apodo, v] of vivos) if (apodo !== miApodo) jugador(apodo, v, camX, false);
  if (yo) jugador(miApodo, yo, camX, true);
  interfaz(yo);
}

function fondo(camX) {
  stroke(255, 255, 255, 14);
  strokeWeight(1);
  for (let x = -((camX % 120) + 120) % 120; x < ANCHO; x += 120) line(x, 0, x, H);
}

function checkpoints(camX) {
  for (const cx of nivel.checks) {
    const x = cx - camX;
    if (x < -40 || x > ANCHO + 40) continue;
    stroke(255);
    strokeWeight(3);
    line(x, 30, x, H / 2 - 62);
    line(x, H / 2 + 62, x, H - 30);
    push();
    translate(x, H / 2);
    rotate(-HALF_PI);
    noStroke();
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(20);
    textStyle(BOLD);
    text("CHECKPOINT", 0, 0);
    pop();
  }
}

// Todos los obstáculos de color: los del color propio llevan un borde blanco
// porque se pueden atravesar.
function obstaculos(camX, yo, t) {
  const propio = (c) => yo && c === yo.c;
  strokeCap(ROUND);

  // 1. Puerta
  for (const r of nivel.rects) {
    const x = r.x - camX;
    if (x > ANCHO || x + r.w < 0) continue;
    noStroke();
    fill(HEX[r.c]);
    rect(x, r.y, r.w, r.h);
    if (propio(r.c)) { noFill(); stroke(255); strokeWeight(2); rect(x + 1, r.y + 1, r.w - 2, r.h - 2); }
  }

  // 2. Estrellas que giran
  for (const e of nivel.estrellas) {
    const x = e.x - camX;
    if (x < -e.largo - 40 || x > ANCHO + e.largo + 40) continue;
    const barras = espinas(e, t);
    for (const s of barras) {
      if (!propio(s.c)) continue;
      stroke(255);
      strokeWeight(e.ancho + 5);
      line(x, e.y, s.x2 - camX, s.y2);
    }
    for (const s of barras) {
      stroke(HEX[s.c]);
      strokeWeight(e.ancho);
      line(x, e.y, s.x2 - camX, s.y2);
    }
    noStroke();
    fill(255);
    circle(x, e.y, e.ancho + 10);
  }

  // 3. Columnas de bolitas que suben y bajan
  for (const c of nivel.columnas) {
    const x = c.x - camX;
    if (x < -40 || x > ANCHO + 40) continue;
    const y0 = centroColumna(c, t);
    for (let k = 0; k < NBOLAS; k++) {
      const y = y0 + (k - (NBOLAS - 1) / 2) * ESP;
      if (y < -20 || y > H + 20) continue;
      fill(HEX[c.cols[k]]);
      if (propio(c.cols[k])) { stroke(255); strokeWeight(2); } else { noStroke(); }
      circle(x, y, radioBola(k) * 2);
    }
  }

  // 4. Bloques que suben y bajan
  for (const p of nivel.pistones) {
    const x = p.x - camX;
    if (x > ANCHO || x + p.w < 0) continue;
    const h = pistonAlto(p, t);
    fill(HEX[p.c]);
    if (propio(p.c)) { stroke(255); strokeWeight(2); } else { noStroke(); }
    rect(x, p.lado === 0 ? 0 : H - h, p.w, h);
  }

  // 5. Onda de sonido
  for (const b of nivel.barras) {
    const x = b.x - b.w / 2 - camX;
    if (x > ANCHO || x + b.w < 0) continue;
    const h = barraAlto(b, t);
    fill(HEX[b.c]);
    if (propio(b.c)) { stroke(255); strokeWeight(2); } else { noStroke(); }
    rect(x, H / 2 - h / 2, b.w, h, b.w / 2);
  }

  // 6. Diagonales de barras que suben y bajan
  rectMode(CENTER);
  for (const d of nivel.diagonales) {
    const x = d.x - camX, alcance = alcanceDiag(d);
    if (x < -alcance || x > ANCHO + alcance) continue;
    const barras = Array.from({ length: NDIAG }, (_, k) => ({ c: d.cols[k], ...barraDiag(d, k, t) }));
    for (const s of barras) {
      if (s.y2 < -20 || s.y1 > H + 20) continue;
      push();
      translate(s.cx - camX, s.cy);
      rotate(s.a);
      fill(HEX[s.c]);
      if (propio(s.c)) { stroke(255); strokeWeight(2); } else { noStroke(); }
      rect(0, 0, s.l, d.ancho, 8);          // esquinas redondeadas
      pop();
    }
  }
  rectMode(CORNER);
}

// La estrella blanca del final: nitro para quien la agarre primero.
function nitro(camX) {
  if (nitroTomada) return;
  const n = nivel.nitro, x = n.x - camX;
  if (x < -60 || x > ANCHO + 60) return;
  const r = n.r * (1 + 0.12 * Math.sin(frameCount * 0.12));
  noStroke();
  fill(255, 255, 255, 40);
  circle(x, n.y, r * 2.6);
  fill(255);
  beginShape();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + frameCount * 0.01;
    const d = i % 2 ? r * 0.28 : r;
    vertex(x + Math.cos(a) * d, n.y + Math.sin(a) * d);
  }
  endShape(CLOSE);
}

function meta(camX) {
  const x = LARGO - camX;
  if (x > ANCHO + 40) return;
  noStroke();
  for (let i = 0; i < H / 30; i++) {
    fill(i % 2 ? 255 : 30);
    rect(x, i * 30, 30, 30);
  }
  fill(255);
  textAlign(LEFT, CENTER);
  textSize(18);
  text("META", x + 40, H / 2);
}

function jugador(apodo, v, camX, soyYo) {
  const ctx = drawingContext;
  const [r, g, b] = COLORES_RGB[v.c];
  ctx.save();
  ctx.globalAlpha = soyYo ? 1 : 0.8;
  if (v.z) { ctx.shadowBlur = 30; ctx.shadowColor = "white"; }   // nitro

  // Estela con degradé que se desvanece hacia atrás.
  if (v.hist.length > 2) {
    const p0 = v.hist[0], p1 = v.hist[v.hist.length - 1];
    const grad = ctx.createLinearGradient(p0.x - camX, 0, p1.x - camX, 0);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = R * (v.z ? 2.4 : 1.9);
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.beginPath();
    v.hist.forEach((p, i) => (i ? ctx.lineTo(p.x - camX, p.y) : ctx.moveTo(p.x - camX, p.y)));
    ctx.stroke();
  }
  ctx.restore();

  const x = v.px - camX;
  fill(frameCount < v.flash && frameCount % 6 < 3 ? 255 : color(HEX[v.c]));
  if (soyYo) { stroke(255); strokeWeight(3); } else { noStroke(); }
  circle(x, v.py, R * 2);
  noStroke();
  fill(255);
  textAlign(CENTER, BOTTOM);
  textSize(13);
  text(soyYo ? `${apodo} (vos)` : apodo, x, v.py - R - 6);
}

function interfaz(yo) {
  // Progreso de todos.
  stroke(255, 255, 255, 90);
  strokeWeight(2);
  line(50, 16, ANCHO - 50, 16);
  noStroke();
  for (const [apodo, v] of vivos) {
    fill(HEX[v.c]);
    circle(50 + (ANCHO - 100) * Math.min(1, v.x / LARGO), 16, apodo === miApodo ? 14 : 10);
  }

  // Medidor de tu sonido y línea guía de la altura pedida.
  const alt = alturaEfectiva();
  fill(255, 255, 255, 40);
  rect(14, 30, 8, H - 60, 4);
  fill(255);
  textSize(11);
  textAlign(LEFT, TOP);
  text("agudo", 28, 28);
  textAlign(LEFT, BOTTOM);
  text("grave", 28, H - 28);
  if (alt !== null) {
    const ya = 30 + (1 - alt) * (H - 60);
    stroke(255, 255, 255, 45);
    strokeWeight(1);
    line(0, ya, ANCHO, ya);
    noStroke();
    fill(255);
    circle(18, ya, 14);
  }

  if (yo) {
    noStroke();
    fill(HEX[yo.c]);
    textAlign(LEFT, TOP);
    textSize(15);
    text(`Sos ${NOMBRES[yo.c].toUpperCase()}`, 50, 32);
    if (yo.f) {
      fill(255);
      textAlign(CENTER, CENTER);
      textSize(28);
      text("¡Llegaste! Esperando a los demás…", ANCHO / 2, H / 2);
    }
  }

  if (performance.now() < anuncio.hasta) {
    noStroke();
    fill(255);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(anuncio.texto.length <= 4 ? 90 : 28);
    text(anuncio.texto, ANCHO / 2, H / 2 - 120);
    textStyle(NORMAL);
  }

  if (destello > 0) {
    noStroke();
    fill(255, 0, 0, destello * 90);
    rect(0, 0, ANCHO, H);
    destello = Math.max(0, destello - 0.06);
  }
}

// Si p5 o p5.sound no se cargaron, no hay lienzo ni micrófono: se avisa.
window.addEventListener("load", () => {
  if (typeof p5 === "undefined" || !p5.AudioIn || typeof abrirSonido === "undefined") {
    $("aviso-libs").hidden = false;
    $("aviso-libs").textContent = "No se cargaron p5.js, p5.sound o sonido.js. Copiá p5.min.js y p5.sound.min.js a la carpeta del juego (o revisá la conexión a internet) y recargá.";
  }
});