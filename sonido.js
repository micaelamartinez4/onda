"use strict";

const AJUSTES = {
  piso: 0.01,        // volumen: apenas por arriba del ruido que hay en silencio
  techo: 0.2,        // volumen de un sonido fuerte
  suavizado: 0.2,    // 1 no suaviza, 0.05 suaviza mucho
  graveHz: 110,      // la frecuencia que corresponde a la altura más baja
  agudoHz: 450,      // la frecuencia que corresponde a la altura más alta
  espera: 150,       // ms que se mantiene la altura si el sonido se corta un instante
};

const MIN_HZ = 70;      // el espectro se mira solo entre estas dos frecuencias
const MAX_HZ = 1200;

let microfono, amplitud, analizador;
let abierto = false;
let alturaSuave = 0.5;  // se guarda de un cuadro al otro, como en el ejemplo 04
let sonabaAntes = false;
let ultimaVoz = 0;

// Va adentro de un gesto de la persona (un clic o un toque).
function abrirSonido(alFallar) {
  if (abierto) return;
  microfono = new p5.AudioIn();
  microfono.disconnect();                 // no queremos escucharnos
  amplitud = new p5.Amplitude();
  microfono.connect(amplitud);
  analizador = new p5.FFT();
  microfono.connect(analizador);
  userStartAudio();
  microfono.start(undefined, () => {      // si el navegador o el sistema lo niegan
    abierto = false;
    if (alFallar) alFallar();
  });
  abierto = true;
}

// La frecuencia (en Hz) de la barra más fuerte del espectro. Se toma el primer
// pico fuerte de grave a agudo, para no saltar a un armónico de la voz.
function frecuenciaDominante(espectro) {
  const hzPorPosicion = getAudioContext().sampleRate / 2 / espectro.length;
  const desde = Math.max(1, Math.floor(MIN_HZ / hzPorPosicion));
  const hasta = Math.min(espectro.length - 2, Math.ceil(MAX_HZ / hzPorPosicion));
  let mayor = 0;
  for (let i = desde; i <= hasta; i++) mayor = Math.max(mayor, espectro[i]);
  if (mayor <= 0) return null;
  for (let i = desde; i <= hasta; i++) {
    if (espectro[i] >= 0.6 * mayor && espectro[i] >= espectro[i - 1] && espectro[i] >= espectro[i + 1]) {
      const a = espectro[i - 1], b = espectro[i], c = espectro[i + 1];
      const d = a - 2 * b + c;
      return (i + (d !== 0 ? (0.5 * (a - c)) / d : 0)) * hzPorPosicion;
    }
  }
  return null;
}


function leerSonido() {
  const vacio = { abierto, nivel: 0, ajustado: 0, hayVoz: false, hz: null, altura: null };
  if (!abierto) return vacio;

  const nivel = amplitud.getLevel();
  const ajustado = map(nivel, AJUSTES.piso, AJUSTES.techo, 0, 1, true);
  const espectro = analizador.analyze();      // se pide siempre, haya sonido o no
  const hz = ajustado > 0.03 ? frecuenciaDominante(espectro) : null;
  const ahora = millis();

  let altura = null;
  if (hz !== null) {
    // Las notas se perciben en escala logarítmica: cada octava mide lo mismo.
    const objetivo = map(Math.log2(hz), Math.log2(AJUSTES.graveHz), Math.log2(AJUSTES.agudoHz), 0, 1, true);
    alturaSuave = sonabaAntes ? lerp(alturaSuave, objetivo, AJUSTES.suavizado) : objetivo;
    sonabaAntes = true;
    ultimaVoz = ahora;
    altura = alturaSuave;
  } else if (sonabaAntes && ahora - ultimaVoz < AJUSTES.espera) {
    altura = alturaSuave;
  } else {
    sonabaAntes = false;
  }
  return { abierto, nivel, ajustado, hayVoz: hz !== null, hz, altura };
}
