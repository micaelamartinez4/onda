"use strict";

(function (raiz) {
  const H = 540;          // alto del mundo
  const R = 18;           // radio de cada jugador
  const VX = 190;         // velocidad hacia adelante (px/s)
  const LARGO = 11250;    // la meta
  const ESP = 36;         // separación entre las bolitas de una columna
  const NBOLAS = 24;      // bolitas por columna
const NDIAG = 24;       // barras por columna diagonal (obstáculo 6)
const PASO = 36;        // separación (en vertical) entre las barras de una diagonal
const LBARRA = 30;      // largo (en vertical) de cada barra de la diagonal

  const azar = (a, b) => a + Math.random() * (b - a);
  const color = () => Math.floor(Math.random() * 4);
  function mezclar(v) {
    for (let i = v.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [v[i], v[j]] = [v[j], v[i]];
    }
    return v;
  }

  // --- Posiciones en el tiempo ---------------------------------------------
  const oscila = (t, per, fase) => Math.sin((2 * Math.PI * t) / per + fase);

  // Obstáculo 2: ocho barras (4 colores, cada una repetida al frente) que giran.
  const espinas = (e, t) => Array.from({ length: 8 }, (_, i) => {
    const a = e.fase + e.vel * t + (i * Math.PI) / 4;
    return { c: e.cols[i % 4], x2: e.x + Math.cos(a) * e.largo, y2: e.y + Math.sin(a) * e.largo };
  });

  // Obstáculo 3: la columna sube y baja; todas las bolitas son iguales y
  // mantienen la misma distancia entre sí.
  const centroColumna = (c, t) => H / 2 + c.amp * oscila(t, c.per, c.fase);
  const radioBola = () => 13;

  // Obstáculo 4: los bloques suben y bajan pero nunca cierran el medio.
  const pistonAlto = (p, t) => p.min + (p.max - p.min) * (0.5 + 0.5 * oscila(t, p.per, p.fase));

  // Obstáculo 5: barras de una onda de sonido que cambian de alto "al azar".
  const barraAlto = (b, t) => H * (0.3 + 0.45 * (0.5 + 0.25 * Math.sin(b.f1 * t + b.p1) + 0.25 * Math.sin(b.f2 * t + b.p2)));

  // Obstáculo 6: igual que el 3, pero la columna es una diagonal hecha de barras.
  // Sube y baja con el mismo movimiento (centroColumna). La barra k va de
  // (x1, y1) a (x2, y2); "inc" es cuánto se corre en x por cada px en y.
  function barraDiag(d, k, t) {
    const y0 = centroColumna(d, t);
    const u1 = (k - NDIAG / 2) * PASO, u2 = u1 + LBARRA;
    const x1 = d.x + d.inc * u1, y1 = y0 + u1, x2 = d.x + d.inc * u2, y2 = y0 + u2;
    // También como rectángulo: centro, ángulo y largo (lo usan el dibujo y la colisión).
    return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, a: Math.atan2(y2 - y1, x2 - x1), l: Math.hypot(x2 - x1, y2 - y1) };
  }
  const alcanceDiag = (d) => Math.abs(d.inc) * (NDIAG * PASO) / 2 + d.ancho + R;

  // --- Colisiones ----------------------------------------------------------
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
  }
  function enRect(px, py, r, x, y, w, h) {
    const cx = Math.max(x, Math.min(px, x + w)), cy = Math.max(y, Math.min(py, y + h));
    return (px - cx) ** 2 + (py - cy) ** 2 < r * r;
  }

  // ¿Choca un jugador de color c en (x, y) en el instante t? Los obstáculos
  // de su mismo color se atraviesan.
  function chocan(nv, x, y, c, t) {
    const r = R * 0.9;
    for (const q of nv.rects) {
      if (q.c !== c && enRect(x, y, r, q.x, q.y, q.w, q.h)) return true;
    }
    for (const e of nv.estrellas) {
      if (Math.abs(x - e.x) > e.largo + e.ancho + R) continue;
      for (const s of espinas(e, t)) {
        if (s.c !== c && distSeg(x, y, e.x, e.y, s.x2, s.y2) < r + e.ancho / 2) return true;
      }
    }
    for (const col of nv.columnas) {
      if (Math.abs(x - col.x) > 40) continue;
      const y0 = centroColumna(col, t);
      for (let k = 0; k < NBOLAS; k++) {
        if (col.cols[k] === c) continue;
        if (Math.hypot(x - col.x, y - (y0 + (k - (NBOLAS - 1) / 2) * ESP)) < r + radioBola(k)) return true;
      }
    }
    for (const p of nv.pistones) {
      if (p.c === c || Math.abs(x - (p.x + p.w / 2)) > p.w / 2 + R) continue;
      const h = pistonAlto(p, t);
      if (enRect(x, y, r, p.x, p.lado === 0 ? 0 : H - h, p.w, h)) return true;
    }
    for (const b of nv.barras) {
      if (b.c === c || Math.abs(x - b.x) > b.w / 2 + R) continue;
      const h = barraAlto(b, t);
      if (distSeg(x, y, b.x, H / 2 - h / 2 + b.w / 2, b.x, H / 2 + h / 2 - b.w / 2) < r + b.w / 2) return true;
    }
    for (const d of nv.diagonales) {
      if (Math.abs(x - d.x) > alcanceDiag(d)) continue;
      for (let k = 0; k < NDIAG; k++) {
        if (d.cols[k] === c) continue;
        const s = barraDiag(d, k, t);
        // Se lleva el punto al sistema de la barra (que está girada) y se prueba como rectángulo.
        const dx = x - s.cx, dy = y - s.cy, co = Math.cos(s.a), si = Math.sin(s.a);
        if (enRect(dx * co + dy * si, -dx * si + dy * co, r, -s.l / 2, -d.ancho / 2, s.l, d.ancho)) return true;
      }
    }
    return false;
  }

  // --- El mapa (mapa.pdf) --------------------------------------------------
  function construirNivel() {
    const rects = [], estrellas = [], columnas = [], pistones = [], barras = [], diagonales = [];
    const checks = [600, 2700, 4050, 6250, 8050, 10150];

    // 1. Puerta: tamaño fijo, solo cambia el lugar de cada color.
    mezclar([0, 1, 2, 3]).forEach((c, i) =>
      rects.push({ x: 450, y: (i * H) / 4, w: 36, h: H / 4, c }));

    // 2. Estrellas que giran: arriba, abajo, arriba (su lugar es fijo).
    [[1050, H], [1650, 0], [2250, H]].forEach(([x, y], i) => estrellas.push({
      x, y, largo: 290, ancho: 26, vel: (i % 2 ? -1 : 1) * azar(0.55, 0.8),
      fase: azar(0, 6.28), cols: mezclar([0, 1, 2, 3]),
    }));

    // 3. Columnas de bolitas que suben y bajan intercaladas.
    // Los cuatro colores se repiten en tramos de 3 bolitas a lo largo de toda la
    // columna: así, suba o baje, siempre hay un tramo de cada color a la vista.
    const cadena = () => {
      const c = mezclar([0, 1, 2, 3]);
      return [...c, ...c].flatMap((col) => [col, col, col]);
    };
    [3000, 3380, 3760].forEach((x, i) => columnas.push({
      x, amp: 100, per: 4.2, fase: i % 2 ? Math.PI : 0, cols: cadena(),
    }));

    // 4. Bloques anchos y rápidos que presionan desde arriba y desde abajo; el
    // espacio del medio (90 px) siempre queda libre.
    [4400, 4820, 5240, 5660].forEach((x, i) => {
      const comun = { w: 160, min: 70, max: H / 2 - 45 };
      const arriba = color();
      pistones.push({ ...comun, x, lado: 0, c: arriba, per: azar(1.3, 1.9), fase: i * 1.3 });
      pistones.push({ ...comun, x: x + 180, lado: 1, c: (arriba + 1 + Math.floor(Math.random() * 3)) % 4, per: azar(1.3, 1.9), fase: i * 1.3 + 2 });
    });

    // 5. Onda de sonido: 11 barras iguales que cambian de alto (la primera y la
    // última también), sin dos del mismo color seguidas.
    let anterior = -1;
    for (let i = 0; i < 11; i++) {
      let c = color();
      while (c === anterior) c = color();
      anterior = c;
      barras.push({
        x: 6600 + i * 120, w: 56, c,
        f1: azar(1.4, 3.2), p1: azar(0, 6.28), f2: azar(3, 5.5), p2: azar(0, 6.28),
      });
    }

    // 6. Diagonales de barras que suben y bajan intercaladas (como el 3). Todas
    // tienen la misma inclinación, así nunca se cruzan entre sí. Los colores se
    // repiten en tramos de 3 barras, como en las columnas de bolitas.
    [8500, 8880, 9260, 9640].forEach((x, i) => diagonales.push({
      x, inc: 0.8, ancho: 24, amp: 100, per: 4.2, fase: i % 2 ? Math.PI : 0, cols: cadena(),
    }));

    // La estrella blanca: nitro para quien la agarre primero.
    const nitro = { x: 10500, y: H / 2, r: 28 };

    return { rects, estrellas, columnas, pistones, barras, diagonales, checks, nitro };
  }

  const api = {
    H, R, VX, LARGO, ESP, NBOLAS, NDIAG, construirNivel, chocan,
    espinas, centroColumna, radioBola, pistonAlto, barraAlto, barraDiag, alcanceDiag,
  };
  if (typeof module !== "undefined") {
    module.exports = api;
  } else {
    raiz.NIVEL = api;
  }
})(typeof window !== "undefined" ? window : globalThis);