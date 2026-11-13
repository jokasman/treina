// Sessões de treino: preparar a sessão a partir do plano, histórico e resumos.
import { uid, hojeIso, norm, fmtNum, fmtTempo, somarDias, isoParaData } from './util.js';

export const ESFORCOS = [
  ['facil', 'Fácil', '😌'],
  ['bom', 'Bom', '🙂'],
  ['dificil', 'Difícil', '😤'],
  ['falhei', 'Falhei', '❌'],
];

export function rotuloEsforco(v) {
  return ESFORCOS.find(([k]) => k === v)?.[1] ?? '';
}

/** Sessões terminadas, da mais recente para a mais antiga. */
export function ordenarSessoes(sessoes) {
  return [...(sessoes || [])].sort((a, b) => (b.data.localeCompare(a.data)) || ((b.fim || 0) - (a.fim || 0)));
}

/** Índice do próximo dia do plano, a seguir ao último dia treinado. */
export function proximoDia(plano, sessoes) {
  if (!plano?.dias?.length) return 0;
  const ultima = ordenarSessoes(sessoes).find((s) => plano.dias.some((d) => norm(d.nome) === norm(s.diaNome)));
  if (!ultima) return 0;
  const i = plano.dias.findIndex((d) => norm(d.nome) === norm(ultima.diaNome));
  return (i + 1) % plano.dias.length;
}

/** Última vez que um exercício foi feito: { data, series } ou null. */
export function ultimoDesempenho(nome, sessoes, excluirId = null) {
  const alvo = norm(nome);
  for (const s of ordenarSessoes(sessoes)) {
    if (s.id === excluirId) continue;
    const ex = s.exercicios.find((e) => norm(e.nome) === alvo);
    const feitas = ex?.series.filter((x) => x.feita) ?? [];
    if (feitas.length) return { data: s.data, series: feitas };
  }
  return null;
}

/** Prepara uma sessão nova para um dia do plano, com as cargas do plano. */
export function novaSessao(plano, indiceDia, agora = new Date()) {
  const dia = plano.dias[indiceDia];
  return {
    id: uid(),
    data: hojeIso(agora),
    inicio: agora.getTime(),
    fim: null,
    planoNome: plano.nome,
    diaNome: dia.nome,
    notas: '',
    exercicios: dia.exercicios.map((ex) => ({
      nome: ex.nome,
      alvo: { ...ex },
      nota: '',
      series: Array.from({ length: ex.series }, () => novaSerie(ex)),
    })),
  };
}

export function novaSerie(ex) {
  return {
    reps: null,
    carga: ex.carga ?? null,
    tempo: ex.repsMin == null ? ex.tempo ?? null : null,
    esforco: null,
    feita: false,
  };
}

export function fmtSerie(s) {
  const partes = [];
  if (s.reps != null) partes.push(s.carga != null ? `${fmtNum(s.carga)} kg × ${s.reps}` : `${s.reps} reps`);
  else if (s.tempo != null) partes.push(fmtTempo(s.tempo));
  else partes.push('feita');
  if (s.esforco) partes.push(`(${rotuloEsforco(s.esforco).toLowerCase()})`);
  return partes.join(' ');
}

/** Resumo de uma sessão em texto, para enviar ao PT. */
export function resumoSessao(s) {
  const linhas = [];
  const minutos = s.fim && s.inicio ? Math.round((s.fim - s.inicio) / 60000) : 0;
  const dur = minutos ? ` · ${minutos} min` : '';
  linhas.push(`${s.data} · ${s.diaNome}${dur}`);
  for (const ex of s.exercicios) {
    const feitas = ex.series.filter((x) => x.feita);
    const desc = feitas.length ? feitas.map(fmtSerie).join(', ') : 'não feito';
    linhas.push(`  - ${ex.nome}: ${desc}${ex.nota ? ` — nota: ${ex.nota}` : ''}`);
  }
  if (s.notas) linhas.push(`  Notas: ${s.notas}`);
  return linhas.join('\n');
}

export function seriesFeitas(s) {
  return s.exercicios.reduce((n, ex) => n + ex.series.filter((x) => x.feita).length, 0);
}

export function volumeSessao(s) {
  let v = 0;
  for (const ex of s.exercicios) for (const x of ex.series) if (x.feita && x.reps && x.carga) v += x.reps * x.carga;
  return v;
}

/** Segunda-feira da semana da data ISO. */
export function inicioSemana(iso) {
  const d = isoParaData(iso);
  const dia = (d.getDay() + 6) % 7;
  return somarDias(iso, -dia);
}

export function treinosNaSemana(sessoes, hoje = hojeIso()) {
  const ini = inicioSemana(hoje);
  return (sessoes || []).filter((s) => s.data >= ini && s.data <= hoje).length;
}

/** Melhor série (maior carga, depois mais reps) de um exercício em cada sessão. */
export function evolucaoExercicio(nome, sessoes) {
  const alvo = norm(nome);
  const pontos = [];
  for (const s of [...(sessoes || [])].sort((a, b) => a.data.localeCompare(b.data))) {
    const ex = s.exercicios.find((e) => norm(e.nome) === alvo);
    if (!ex) continue;
    let melhor = null;
    for (const x of ex.series) {
      if (!x.feita || x.reps == null) continue;
      if (!melhor || (x.carga ?? 0) > (melhor.carga ?? 0) || ((x.carga ?? 0) === (melhor.carga ?? 0) && x.reps > melhor.reps)) melhor = x;
    }
    if (melhor) pontos.push({ data: s.data, carga: melhor.carga, reps: melhor.reps });
  }
  return pontos;
}

export function nomesExercicios(sessoes) {
  const vistos = new Map();
  for (const s of sessoes || []) for (const ex of s.exercicios) if (!vistos.has(norm(ex.nome))) vistos.set(norm(ex.nome), ex.nome);
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt'));
}
