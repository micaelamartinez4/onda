"use strict";

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Server } = require("socket.io");
const { H, R, VX, LARGO, construirNivel, chocan } = require("./nivel.js");

function leer(nombre) {
  for (const carpeta of [__dirname, path.join(__dirname, "..")]) {
    const ruta = path.join(carpeta, nombre);
    if (fs.existsSync(ruta)) {
      return fs.readFileSync(ruta);
    }
  }
  throw new Error(`Falta ${nombre}: copialo junto a servidor.js`);
}

// Solo se entregan estos archivos (así no se filtran la clave ni el servidor).
const JS = "text/javascript; charset=utf-8";
const PUBLICOS = {
  "/index.html": "text/html; charset=utf-8",
  "/estilos.css": "text/css; charset=utf-8",
  "/juego.js": JS,
  "/nivel.js": JS,
  "/sonido.js": JS,
  "/p5.min.js": JS,
  "/p5.sound.min.js": JS,
};

// La carpeta "presentacion" se entrega entera (html, css, js, imágenes, fuentes).
const TIPOS_PRESENTACION = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": JS,
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2",
  ".mp4": "video/mp4", ".pdf": "application/pdf",
};
function tipoDe(pedido) {
  if (PUBLICOS[pedido]) {
    return PUBLICOS[pedido];
  }
  if (pedido.startsWith("/presentacion/") && !pedido.includes("..")) {
    return TIPOS_PRESENTACION[path.extname(pedido).toLowerCase()];
  }
  return undefined;
}

const servidor = https.createServer(
  { key: leer("clave.pem"), cert: leer("certificado.pem") },
  (peticion, respuesta) => {
    let ruta = new URL(peticion.url, "https://localhost").pathname;
    try {
      ruta = decodeURIComponent(ruta);      // "pop_up%20microfono.png" -> "pop_up microfono.png"
    } catch {
      ruta = "/";
    }
    const pedido = ruta === "/" ? "/index.html" : ruta;
    const tipo = tipoDe(pedido);
    const archivo = [__dirname, path.join(__dirname, "..")]
      .map((carpeta) => path.join(carpeta, pedido))
      .find((ruta) => fs.existsSync(ruta));
    if (!tipo || !archivo) {
      respuesta.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      respuesta.end(`No existe ${pedido}` + (tipo ? ": copialo a la carpeta del juego" : ""));
      return;
    }
    respuesta.writeHead(200, { "Content-Type": tipo });
    fs.createReadStream(archivo).pipe(respuesta);
  },
);

const io = new Server(servidor);

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------
const TICK = 30;                 // simulaciones por segundo
const JUGADORES_MAX = 4;
const VMAX = 430;                // velocidad vertical máxima (px/s)
const HUNDE = 90;                // si no hay sonido, cae despacio (px/s)
const CUENTA = 3;                // segundos de cuenta regresiva
// Dificultad: cuánto más rápido avanza la pelota (1 es la velocidad base).
const DIFICULTADES = { facil: 1, normal: 1.35, dificil: 1.8, extremo: 2.4 };
const NITRO_MULT = 1.8;          // velocidad con nitro
const NITRO_MS = 3500;           // cuánto dura el nitro
const ESPERA_TRAS_PRIMERO_MS = 40000;
const LIMITE_MS = 240000;

// Una sala es una carrera. Fases: espera, cuenta, carrera, final.
const salas = new Map();

function salaDe(nombre) {
  if (!salas.has(nombre)) {
    salas.set(nombre, {
      fase: "espera",
      dificultad: "facil",
      jugadores: new Map(),   // id de conexión -> jugador
      nivel: null,
      nitroDe: null,          // quién se llevó la estrella
      reloj: null,
      temporizador: null,
      t0: 0,
      tPrimero: 0,
    });
  }
  return salas.get(nombre);
}

const esNombreDeSala = (n) => typeof n === "string" && n.length > 0 && n.length <= 12;
const esApodo = (a) => typeof a === "string" && a.trim().length > 0 && a.trim().length <= 16;
const normalizar = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function publicarEstado(nombre, s) {
  io.to(nombre).emit("estado", {
    fase: s.fase,
    dificultad: s.dificultad,
    jugadores: [...s.jugadores.values()].map((j) => ({ apodo: j.apodo, color: j.color, listo: j.listo })),
  });
}


function iniciarCarrera(nombre, s) {
  if (s.fase !== "espera" && s.fase !== "final") {
    return;
  }
  s.fase = "cuenta";
  s.nivel = construirNivel();
  s.nitroDe = null;
  s.tPrimero = 0;
  for (const p of s.jugadores.values()) {
    Object.assign(p, {
      x: 0, y: H / 2, cpX: 0, cpIdx: -1, alt: null, altT: 0,
      errores: 0, tFin: null, nitroHasta: 0, listo: false,
    });
  }
  io.to(nombre).emit("nivel", { nivel: s.nivel });
  publicarEstado(nombre, s);

  let n = CUENTA;
  const contar = () => {
    io.to(nombre).emit("cuenta", n);
    if (n === 0) {
      s.fase = "carrera";
      s.t0 = Date.now();
      s.reloj = setInterval(() => paso(nombre, s), 1000 / TICK);
      publicarEstado(nombre, s);
      return;
    }
    n -= 1;
    s.temporizador = setTimeout(contar, 1000);
  };
  contar();
}

function paso(nombre, s) {
  const dt = 1 / TICK;
  const ahora = Date.now();
  const t = (ahora - s.t0) / 1000;      // tiempo de la carrera
  const nv = s.nivel;
  const factor = DIFICULTADES[s.dificultad];
  const vmax = VMAX * (1 + (factor - 1) * 0.5);   // un poco más ágil en los niveles rápidos

  for (const [id, p] of s.jugadores) {
    if (p.tFin !== null) {
      continue;
    }
    p.x += VX * factor * (ahora < p.nitroHasta ? NITRO_MULT : 1) * dt;

    // Altura: sonido agudo = arriba, grave = abajo, silencio = cae despacio.
    const alt = ahora - p.altT < 300 ? p.alt : null;
    if (alt !== null) {
      const meta = 30 + (1 - alt) * (H - 60);
      p.y += Math.max(-vmax * dt, Math.min(vmax * dt, meta - p.y));
    } else {
      p.y += HUNDE * dt;
    }
    p.y = Math.max(R, Math.min(H - R, p.y));

    while (p.cpIdx + 1 < nv.checks.length && p.x >= nv.checks[p.cpIdx + 1]) {
      p.cpIdx += 1;
      p.cpX = nv.checks[p.cpIdx];
      io.to(id).emit("checkpoint");
    }

    // La estrella final es solo para quien la agarre primero.
    if (s.nitroDe === null && Math.hypot(p.x - nv.nitro.x, p.y - nv.nitro.y) < R + nv.nitro.r) {
      s.nitroDe = p.apodo;
      p.nitroHasta = ahora + NITRO_MS;
      io.to(nombre).emit("nitro", { apodo: p.apodo });
    }

    if (chocan(nv, p.x, p.y, p.color, t)) {
      p.errores += 1;
      p.x = p.cpX;
      p.y = H / 2;
      p.nitroHasta = 0;
      io.to(nombre).emit("golpe", { apodo: p.apodo });
    } else if (p.x >= LARGO) {
      p.x = LARGO;
      p.tFin = t;
    }
  }

  const todos = [...s.jugadores.values()];
  if (!s.tPrimero && todos.some((p) => p.tFin !== null)) {
    s.tPrimero = ahora;
  }
  io.to(nombre).emit("tick", {
    t,
    j: todos.map((p) => ({
      n: p.apodo, x: Math.round(p.x), y: Math.round(p.y), c: p.color,
      f: p.tFin !== null, z: ahora < p.nitroHasta,
    })),
  });

  if (todos.every((p) => p.tFin !== null)
    || (s.tPrimero && ahora - s.tPrimero > ESPERA_TRAS_PRIMERO_MS)
    || ahora - s.t0 > LIMITE_MS) {
    terminar(nombre, s);
  }
}

function terminar(nombre, s) {
  clearInterval(s.reloj);
  clearTimeout(s.temporizador);
  s.reloj = null;
  s.fase = "final";
  for (const p of s.jugadores.values()) {
    p.listo = false;      // al volver a la sala, todos deben confirmar de nuevo
  }
  const ranking = [...s.jugadores.values()]
    .sort((a, b) => (a.tFin ?? Infinity) - (b.tFin ?? Infinity) || b.x - a.x)
    .map((p) => ({
      apodo: p.apodo,
      color: p.color,
      tiempo: p.tFin,
      errores: p.errores,
      progreso: Math.round((100 * p.x) / LARGO),
    }));
  io.to(nombre).emit("final", { ranking });
  publicarEstado(nombre, s);
}

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  let sala = null;
  const actual = () => (sala === null ? undefined : salas.get(sala));

  socket.on("entrar", (datos) => {
    if (sala !== null) {
      return;
    }
    if (datos === null || typeof datos !== "object"
      || !esNombreDeSala(datos.sala) || !esApodo(datos.apodo)) {
      socket.emit("rechazo", "Los datos de entrada no son válidos.");
      return;
    }
    const apodo = datos.apodo.trim();
    const s = salaDe(datos.sala);
    const jugadores = [...s.jugadores.values()];

    let motivo = "";
    if (jugadores.length >= JUGADORES_MAX) {
      motivo = "La sala está llena (máximo 4 jugadores).";
    } else if (s.fase === "cuenta" || s.fase === "carrera") {
      motivo = "Hay una carrera en curso: esperá a que termine.";
    } else if (jugadores.some((j) => normalizar(j.apodo) === normalizar(apodo))) {
      motivo = "Ese apodo ya está en uso en la sala.";
    }
    if (motivo) {
      socket.emit("rechazo", motivo);
      if (s.jugadores.size === 0) {
        salas.delete(datos.sala);
      }
      return;
    }

    // Cada jugador recibe un color distinto, que conserva toda la partida.
    const color = [0, 1, 2, 3].find((c) => !jugadores.some((j) => j.color === c));
    sala = datos.sala;
    socket.join(sala);
    s.jugadores.set(socket.id, {
      apodo, color, x: 0, y: H / 2, cpX: 0, cpIdx: -1, alt: null, altT: 0,
      errores: 0, tFin: null, nitroHasta: 0, listo: false,
    });
    socket.emit("entro", { sala, apodo });
    publicarEstado(sala, s);
  });

  // La dificultad se elige en la sala de espera o al terminar una carrera.
  socket.on("dificultad", (valor) => {
    const s = actual();
    if (!s || (s.fase !== "espera" && s.fase !== "final")
      || typeof valor !== "string" || !Object.hasOwn(DIFICULTADES, valor)) {
      return;
    }
    s.dificultad = valor;
    publicarEstado(sala, s);
  });

  // Cada jugador marca si está listo; la carrera arranca cuando lo están todos.
  socket.on("listo", (valor) => {
    const s = actual();
    const p = s?.jugadores.get(socket.id);
    if (!p || (s.fase !== "espera" && s.fase !== "final") || typeof valor !== "boolean") {
      return;
    }
    p.listo = valor;
    publicarEstado(sala, s);
  });

  socket.on("empezar", () => {
    const s = actual();
    if (s && s.jugadores.size > 0 && [...s.jugadores.values()].every((j) => j.listo)) {
      iniciarCarrera(sala, s);
    }
  });

  // Estado: la altura pedida por el sonido, 0 (grave) a 1 (agudo), o null si
  // no hay sonido. Todo lo que no sea un número se toma como "sin sonido".
  socket.on("altura", (valor) => {
    const p = actual()?.jugadores.get(socket.id);
    if (!p) {
      return;
    }
    p.alt = typeof valor === "number" && Number.isFinite(valor)
      ? Math.max(0, Math.min(1, valor))
      : null;
    p.altT = Date.now();
  });

  // Sale de la sala (desde el botón o al desconectarse).
  const salir = () => {
    const s = actual();
    if (!s) {
      return;
    }
    const nombre = sala;
    s.jugadores.delete(socket.id);
    socket.leave(nombre);
    sala = null;
    if (s.jugadores.size === 0) {
      clearInterval(s.reloj);
      clearTimeout(s.temporizador);
      salas.delete(nombre);
      return;
    }
    if (s.fase === "carrera" && [...s.jugadores.values()].every((p) => p.tFin !== null)) {
      terminar(nombre, s);
      return;
    }
    publicarEstado(nombre, s);
  };

  socket.on("salir", salir);
  socket.on("disconnect", salir);
});

servidor.listen(3000, () => {
  console.log("Voz Flappy. En esta máquina: https://localhost:3000");
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const interfaz of interfaces) {
      if (interfaz.family === "IPv4" && !interfaz.internal) {
        console.log(`Desde otro dispositivo: https://${interfaz.address}:3000`);
      }
    }
  }
});