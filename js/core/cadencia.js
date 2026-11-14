// Cadência: leitura do formato "descida-pausa-subida-pausa" e sequência de sinais sonoros.

export const FASES = ['desce', 'pausa-baixo', 'sobe', 'pausa-cima'];

export const NOMES_FASE = {
  'desce': 'Desce',
  'pausa-baixo': 'Pausa em baixo',
  'sobe': 'Sobe',
  'pausa-cima': 'Pausa em cima',
};

// Duração atribuída a uma fase explosiva ("X").
export const EXPLOSIVA = 0.5;

/**
 * Lê uma cadência como "2-0-1-1", "3-1-X-0", "2:0:1" ou "4 0 2 0".
 * Devolve [{ fase, s, explosiva }] (só as fases com duração) ou null se não for válida.
 */
export function lerCadencia(texto) {
  if (texto == null) return null;
  const partes = String(texto).trim().split(/\s*[-:/–\s]\s*/).filter(Boolean);
  if (partes.length < 3 || partes.length > 4) return null;
  const fases = [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i].replace(',', '.');
    let s;
    let explosiva = false;
    if (/^x$/i.test(p)) { s = EXPLOSIVA; explosiva = true; }
    else if (/^\d+(\.\d+)?$/.test(p)) s = Number(p);
    else return null;
    if (s > 15) return null;
    if (s > 0) fases.push({ fase: FASES[i], s, explosiva });
  }
  return fases.length ? fases : null;
}

/** Duração de uma repetição, em segundos. */
export function duracaoRepeticao(fases) {
  return fases.reduce((t, f) => t + f.s, 0);
}

/** Sinais da contagem de preparação: um por segundo, começando em t = 0. */
export function eventosPreparacao(preparacao) {
  const n = Math.max(0, Math.round(preparacao || 0));
  return Array.from({ length: n }, (_, i) => ({ t: i, tipo: 'prep', resta: n - i }));
}

/**
 * Sinais de uma repetição que começa no instante `inicio`.
 * Cada segundo de cada fase tem o seu sinal; o primeiro segundo da fase tem o sinal de início de fase.
 */
export function eventosRepeticao(fases, rep, inicio) {
  const eventos = [];
  let t = inicio;
  for (const f of fases) {
    const total = Math.ceil(f.s);
    eventos.push({ t, tipo: 'fase', fase: f.fase, rep, segundo: 1, total });
    for (let k = 1; k < f.s; k++) eventos.push({ t: t + k, tipo: 'segundo', fase: f.fase, rep, segundo: k + 1, total });
    t += f.s;
  }
  return eventos;
}

/**
 * Sequência finita para `reps` repetições (a app usa as funções acima para tocar sem fim).
 * Eventos: { t, tipo: 'prep' | 'fase' | 'segundo' | 'fim', fase?, rep?, segundo?, total?, resta? }
 */
export function sequenciaCadencia({ fases, reps, preparacao = 0 }) {
  const eventos = eventosPreparacao(preparacao);
  let t = eventos.length;
  const dur = duracaoRepeticao(fases);
  for (let rep = 1; rep <= reps; rep++) {
    eventos.push(...eventosRepeticao(fases, rep, t));
    t += dur;
  }
  eventos.push({ t, tipo: 'fim', rep: reps });
  return { eventos, duracao: t };
}

/** Último evento que já aconteceu no instante `t` (para mostrar no ecrã). */
export function eventoAtual(eventos, t) {
  let atual = null;
  for (const e of eventos) {
    if (e.tipo === 'alvo') continue; // marca sonora, não muda o que se mostra
    if (e.t <= t + 1e-6) atual = e;
    else break;
  }
  return atual;
}
