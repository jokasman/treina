// Plano de treino: validação da proposta do PT, descrição e diferenças entre versões.
import { lerNumero, lerTempo, norm, fmtCarga, fmtTempo, letra } from './util.js';

export const LIMITES = {
  dias: 7,
  exercicios: 20,
  series: [1, 10],
  reps: [1, 100],
  carga: [0, 500],
  tempo: [1, 4 * 3600],
  descanso: [0, 900],
};

const texto = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));

function lerReps(e) {
  let min = lerNumero(e.repsMin);
  let max = lerNumero(e.repsMax);
  if (min == null && max == null && e.reps != null) {
    if (typeof e.reps === 'number') min = max = e.reps;
    else {
      const nums = String(e.reps).match(/\d+/g);
      if (nums) { min = Number(nums[0]); max = Number(nums[nums.length - 1]); }
    }
  }
  if (min == null && max != null) min = max;
  if (max == null && min != null) max = min;
  return [min == null ? null : Math.round(min), max == null ? null : Math.round(max)];
}

function lerCarga(v) {
  if (v == null || v === '') return { ok: true, valor: null };
  if (typeof v === 'string' && /corporal|bodyweight|sem carga|livre/i.test(v)) return { ok: true, valor: null };
  const n = lerNumero(v);
  return n == null ? { ok: false } : { ok: true, valor: Math.round(n * 100) / 100 };
}

export function validarExercicio(raw) {
  const erros = [];
  const e = raw && typeof raw === 'object' ? raw : {};
  const ex = { nome: texto(e.nome, 120) };
  if (!ex.nome) erros.push('falta o nome');

  const series = lerNumero(e.series);
  ex.series = series == null ? null : Math.round(series);
  if (ex.series == null) erros.push('falta o número de séries');
  else if (ex.series < LIMITES.series[0] || ex.series > LIMITES.series[1]) erros.push(`séries fora do intervalo (${ex.series})`);

  const [rmin, rmax] = lerReps(e);
  const tempo = e.tempo != null && e.tempo !== '' ? lerTempo(e.tempo) : null;
  if (rmin != null) {
    ex.repsMin = rmin;
    ex.repsMax = rmax;
    if (rmin < LIMITES.reps[0] || rmax > LIMITES.reps[1]) erros.push(`repetições fora do intervalo (${rmin}–${rmax})`);
    else if (rmin > rmax) erros.push(`repetições mínimas maiores que as máximas (${rmin}–${rmax})`);
  }
  if (tempo != null) {
    ex.tempo = tempo;
    if (tempo < LIMITES.tempo[0] || tempo > LIMITES.tempo[1]) erros.push(`tempo fora do intervalo (${tempo} s)`);
  } else if (e.tempo != null && e.tempo !== '') erros.push(`tempo inválido (${e.tempo})`);
  if (rmin == null && tempo == null) erros.push('faltam as repetições ou o tempo');

  const carga = lerCarga(e.carga);
  if (!carga.ok) erros.push(`carga inválida (${e.carga})`);
  else {
    ex.carga = carga.valor;
    if (ex.carga != null && (ex.carga < LIMITES.carga[0] || ex.carga > LIMITES.carga[1])) erros.push(`carga fora do intervalo (${ex.carga} kg)`);
  }

  if (e.descanso != null && e.descanso !== '') {
    const d = lerTempo(e.descanso);
    if (d == null) erros.push(`descanso inválido (${e.descanso})`);
    else if (d < LIMITES.descanso[0] || d > LIMITES.descanso[1]) erros.push(`descanso fora do intervalo (${d} s)`);
    else ex.descanso = d;
  }
  if (ex.descanso == null) ex.descanso = null;

  ex.notas = texto(e.notas);
  return { ex, erros };
}

/**
 * Valida e normaliza um plano vindo do PT.
 * Devolve { ok, erros, plano }. O plano só deve ser gravado se ok === true.
 */
export function validarPlano(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, erros: ['O plano não está no formato esperado.'], plano: null };
  }
  const erros = [];
  const plano = { nome: texto(raw.nome, 120) || 'Plano de treino', notas: texto(raw.notas, 3000), dias: [] };
  const dias = Array.isArray(raw.dias) ? raw.dias : [];
  if (!dias.length) erros.push('O plano não tem dias de treino.');
  if (dias.length > LIMITES.dias) erros.push(`O plano tem ${dias.length} dias de treino (máximo ${LIMITES.dias}).`);

  const nomesDias = new Set();
  dias.slice(0, LIMITES.dias).forEach((d, i) => {
    const nomeDia = texto(d?.nome, 80) || `Treino ${letra(i)}`;
    if (nomesDias.has(norm(nomeDia))) erros.push(`Há dois dias com o nome "${nomeDia}".`);
    nomesDias.add(norm(nomeDia));
    const dia = { nome: nomeDia, foco: texto(d?.foco, 120), exercicios: [] };
    const exs = Array.isArray(d?.exercicios) ? d.exercicios : [];
    if (!exs.length) erros.push(`${nomeDia}: não tem exercícios.`);
    if (exs.length > LIMITES.exercicios) erros.push(`${nomeDia}: tem ${exs.length} exercícios (máximo ${LIMITES.exercicios}).`);
    const nomesEx = new Set();
    exs.slice(0, LIMITES.exercicios).forEach((e, j) => {
      const { ex, erros: errosEx } = validarExercicio(e);
      const nomeEx = ex.nome || `exercício ${j + 1}`;
      errosEx.forEach((m) => erros.push(`${nomeDia} · ${nomeEx}: ${m}.`));
      if (ex.nome && nomesEx.has(norm(ex.nome))) erros.push(`${nomeDia}: o exercício "${ex.nome}" aparece duas vezes.`);
      nomesEx.add(norm(ex.nome));
      dia.exercicios.push(ex);
    });
    plano.dias.push(dia);
  });
  return { ok: erros.length === 0, erros, plano };
}

export function fmtReps(ex) {
  if (ex.repsMin == null) return '';
  return ex.repsMin === ex.repsMax ? `${ex.repsMin}` : `${ex.repsMin}–${ex.repsMax}`;
}

/** "3 × 8–10 · 40 kg" ou "1 × 20 min". */
export function fmtAlvo(ex) {
  const partes = [];
  const volume = ex.repsMin != null ? fmtReps(ex) : fmtTempo(ex.tempo);
  partes.push(`${ex.series} × ${volume}`);
  if (ex.repsMin != null && ex.tempo != null) partes.push(fmtTempo(ex.tempo));
  if (ex.carga != null || ex.repsMin != null) partes.push(fmtCarga(ex.carga));
  return partes.join(' · ');
}

export function descreverExercicio(ex) {
  let t = `${ex.nome}: ${fmtAlvo(ex)}`;
  if (ex.descanso != null) t += ` · descanso ${fmtTempo(ex.descanso)}`;
  if (ex.notas) t += ` (${ex.notas})`;
  return t;
}

const CAMPOS_EX = [
  ['series', 'séries', (v) => String(v)],
  ['repsMin', 'repetições', null],
  ['tempo', 'tempo', (v) => (v == null ? '—' : fmtTempo(v))],
  ['carga', 'carga', (v) => fmtCarga(v)],
  ['descanso', 'descanso', (v) => (v == null ? '—' : fmtTempo(v))],
  ['notas', 'notas', (v) => (v ? `"${v}"` : '—')],
];

function diffExercicio(dia, a, b) {
  const mud = [];
  for (const [campo, nome, fmt] of CAMPOS_EX) {
    if (campo === 'repsMin') {
      if (a.repsMin !== b.repsMin || a.repsMax !== b.repsMax) {
        mud.push(`repetições ${fmtReps(a) || '—'} → ${fmtReps(b) || '—'}`);
      }
      continue;
    }
    const va = a[campo] ?? null;
    const vb = b[campo] ?? null;
    if (va !== vb) mud.push(`${nome} ${fmt(va)} → ${fmt(vb)}`);
  }
  return mud.length ? [{ tipo: 'alterado', texto: `${dia} · ${b.nome}: ${mud.join('; ')}` }] : [];
}

/**
 * Lista legível do que muda de `antes` para `depois`.
 * Cada item: { tipo: 'novo' | 'adicionado' | 'removido' | 'alterado', texto }.
 */
export function diffPlanos(antes, depois) {
  if (!depois) return [];
  if (!antes) {
    const n = depois.dias.reduce((s, d) => s + d.exercicios.length, 0);
    return [{ tipo: 'novo', texto: `Plano novo: ${depois.dias.length} dias de treino, ${n} exercícios.` }];
  }
  const out = [];
  if (antes.nome !== depois.nome) out.push({ tipo: 'alterado', texto: `Nome do plano: "${antes.nome}" → "${depois.nome}"` });
  if ((antes.notas || '') !== (depois.notas || '')) out.push({ tipo: 'alterado', texto: 'Indicações gerais do plano alteradas.' });

  const total = Math.max(antes.dias.length, depois.dias.length);
  for (let i = 0; i < total; i++) {
    const da = antes.dias[i];
    const db = depois.dias[i];
    if (!da) {
      out.push({ tipo: 'adicionado', texto: `Novo dia: ${db.nome} (${db.exercicios.length} exercícios)` });
      continue;
    }
    if (!db) {
      out.push({ tipo: 'removido', texto: `Dia removido: ${da.nome}` });
      continue;
    }
    if (da.nome !== db.nome) out.push({ tipo: 'alterado', texto: `Dia ${i + 1}: "${da.nome}" → "${db.nome}"` });
    if ((da.foco || '') !== (db.foco || '')) out.push({ tipo: 'alterado', texto: `${db.nome}: foco "${da.foco || '—'}" → "${db.foco || '—'}"` });

    const mapaA = new Map(da.exercicios.map((e) => [norm(e.nome), e]));
    const mapaB = new Map(db.exercicios.map((e) => [norm(e.nome), e]));
    for (const e of db.exercicios) {
      const anterior = mapaA.get(norm(e.nome));
      if (!anterior) out.push({ tipo: 'adicionado', texto: `${db.nome} · ${descreverExercicio(e)}` });
      else out.push(...diffExercicio(db.nome, anterior, e));
    }
    for (const e of da.exercicios) {
      if (!mapaB.has(norm(e.nome))) out.push({ tipo: 'removido', texto: `${db.nome} · ${e.nome}` });
    }
    const ordemA = da.exercicios.map((e) => norm(e.nome)).filter((n) => mapaB.has(n));
    const ordemB = db.exercicios.map((e) => norm(e.nome)).filter((n) => mapaA.has(n));
    if (ordemA.join('|') !== ordemB.join('|')) out.push({ tipo: 'alterado', texto: `${db.nome}: ordem dos exercícios alterada` });
  }
  return out;
}
