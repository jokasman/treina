// Sinais sonoros da cadência, gerados com Web Audio.
// Não usa <audio> nem Media Session: são sons curtos gerados na hora, que no Android se sobrepõem
// à música de outras apps (Spotify) em vez de a pausar.

const PREF = 'treina.som';
const PADRAO = { volume: 70, preparacao: 5 };

export function preferencias() {
  try { return { ...PADRAO, ...(JSON.parse(localStorage.getItem(PREF)) || {}) }; } catch { return { ...PADRAO }; }
}

export function gravarPreferencias(p) {
  const atual = { ...preferencias(), ...p };
  atual.volume = Math.min(100, Math.max(0, Math.round(Number(atual.volume) || 0)));
  atual.preparacao = Math.min(30, Math.max(0, Math.round(Number(atual.preparacao) || 0)));
  try { localStorage.setItem(PREF, JSON.stringify(atual)); } catch { /* opcional */ }
  if (mestre) mestre.gain.value = ganho(atual.volume);
  return atual;
}

// Som de cada tipo de sinal: frequência (Hz), duração (s), forma de onda e intensidade relativa.
const SONS = {
  'prep': { f: 660, d: 0.09, onda: 'triangle', v: 0.8 },
  'prep-ultimo': { f: 990, d: 0.12, onda: 'triangle', v: 0.9 },
  'desce': { f: 392, d: 0.2, onda: 'square', v: 0.55 },
  'desce-seg': { f: 392, d: 0.08, onda: 'triangle', v: 0.8 },
  'sobe': { f: 880, d: 0.2, onda: 'square', v: 0.5 },
  'sobe-seg': { f: 880, d: 0.08, onda: 'triangle', v: 0.75 },
  'pausa': { f: 587, d: 0.05, onda: 'sine', v: 0.7 },
  'pausa-seg': { f: 587, d: 0.04, onda: 'sine', v: 0.5 },
  'fim': { f: 1046, d: 0.14, onda: 'triangle', v: 0.9 },
  'fim-2': { f: 1318, d: 0.25, onda: 'triangle', v: 0.9 },
};

let ctx = null;
let mestre = null;
let agendados = [];
let suspenderTimer = null;

const ganho = (volume) => (volume / 100) ** 2;

/** Tem de ser chamado num toque do utilizador (regra dos browsers para áudio). */
export async function preparar() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Este browser não permite sinais sonoros.');
    ctx = new AC({ latencyHint: 'interactive' });
    mestre = ctx.createGain();
    mestre.gain.value = ganho(preferencias().volume);
    mestre.connect(ctx.destination);
  }
  clearTimeout(suspenderTimer);
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

export function agora() {
  return ctx ? ctx.currentTime : 0;
}

function tocar(nome, quando) {
  const s = SONS[nome];
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = s.onda;
  osc.frequency.value = s.f;
  env.gain.setValueAtTime(0, quando);
  env.gain.linearRampToValueAtTime(s.v, quando + 0.005);
  env.gain.setValueAtTime(s.v, quando + s.d * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, quando + s.d);
  osc.connect(env).connect(mestre);
  osc.start(quando);
  osc.stop(quando + s.d + 0.02);
  agendados.push(osc);
  osc.onended = () => { agendados = agendados.filter((o) => o !== osc); };
}

function somDoEvento(e) {
  if (e.tipo === 'prep') return [e.resta === 1 ? 'prep-ultimo' : 'prep'];
  if (e.tipo === 'fim') return ['fim'];
  const base = e.fase === 'desce' ? 'desce' : e.fase === 'sobe' ? 'sobe' : 'pausa';
  return [e.tipo === 'fase' ? base : `${base}-seg`];
}

/** Agenda todos os sinais de uma sequência. Devolve o instante (relógio de áudio) em que começa. */
export function tocarSequencia(eventos, atraso = 0.15) {
  parar();
  const inicio = ctx.currentTime + atraso;
  for (const e of eventos) {
    for (const nome of somDoEvento(e)) tocar(nome, inicio + e.t);
    if (e.tipo === 'fim') tocar('fim-2', inicio + e.t + 0.18);
  }
  return inicio;
}

/** Amostra de todos os sons, para testar o volume. */
export function testar() {
  parar();
  const t = ctx.currentTime + 0.1;
  ['prep', 'prep-ultimo', 'desce', 'desce-seg', 'sobe', 'sobe-seg', 'pausa'].forEach((n, i) => tocar(n, t + i * 0.45));
  tocar('fim', t + 7 * 0.45);
  tocar('fim-2', t + 7 * 0.45 + 0.18);
  adormecer(5);
}

/** Pára todos os sinais agendados. */
export function parar() {
  for (const o of agendados) {
    try { o.stop(); } catch { /* já parou */ }
  }
  agendados = [];
}

/** Suspende o áudio quando não está a ser usado (poupa bateria e liberta o som do telemóvel). */
export function adormecer(segundos = 1) {
  clearTimeout(suspenderTimer);
  suspenderTimer = setTimeout(() => { if (ctx && !agendados.length) ctx.suspend().catch(() => {}); }, segundos * 1000);
}
