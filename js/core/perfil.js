// Objetivos e perfil do utilizador: opções do formulário, validação e descrição para o PT.
import { lerNumero, norm, fmtData } from './util.js';

export const OBJETIVOS = [
  ['massa', 'Ganhar massa muscular'],
  ['forca', 'Ganhar força'],
  ['gordura', 'Perder gordura'],
  ['condicao', 'Melhorar a condição física'],
  ['resistencia', 'Resistência e corrida'],
  ['saude', 'Saúde, mobilidade e postura'],
];

export const ESPECIALIDADE = {
  massa: 'hipertrofia muscular',
  forca: 'treino de força',
  gordura: 'perda de gordura e recomposição corporal',
  condicao: 'condicionamento físico geral',
  resistencia: 'treino de resistência e corrida',
  saude: 'saúde, mobilidade e treino corretivo',
};

export const SEXO = [['m', 'Masculino'], ['f', 'Feminino'], ['x', 'Prefiro não dizer']];

export const LOCAIS = [['ginasio', 'Ginásio'], ['casa', 'Casa'], ['exterior', 'Ao ar livre'], ['misto', 'Misto']];

export const MATERIAL = [
  ['halteres', 'Halteres'],
  ['barra', 'Barra e discos'],
  ['banco', 'Banco'],
  ['kettlebell', 'Kettlebell'],
  ['elasticos', 'Elásticos'],
  ['barra_elevacoes', 'Barra de elevações'],
  ['trx', 'TRX ou argolas'],
  ['cardio', 'Passadeira ou bicicleta'],
  ['corda', 'Corda de saltar'],
  ['nenhum', 'Só peso corporal'],
];

export const EXPERIENCIA = [
  ['nenhuma', 'Nunca treinei'],
  ['iniciante', 'Iniciante (menos de 6 meses)'],
  ['intermedio', 'Intermédio (6 meses a 2 anos)'],
  ['avancado', 'Avançado (mais de 2 anos)'],
];

export const LIMITACOES = [
  ['ombro', 'Ombro'],
  ['joelho', 'Joelho'],
  ['lombar', 'Lombar'],
  ['cervical', 'Pescoço'],
  ['punho', 'Punho ou cotovelo'],
  ['anca', 'Anca'],
  ['tornozelo', 'Tornozelo'],
  ['coracao', 'Coração ou tensão arterial'],
];

export const DURACOES = [30, 45, 60, 75, 90];

// Definição de cada campo: usada na validação, nas diferenças e na mensagem para o PT.
export const CAMPOS = {
  objetivo: { rotulo: 'Objetivo', tipo: 'opcao', opcoes: OBJETIVOS },
  meta: { rotulo: 'Meta', tipo: 'texto', max: 300 },
  dataAlvo: { rotulo: 'Data alvo', tipo: 'data' },
  sexo: { rotulo: 'Sexo', tipo: 'opcao', opcoes: SEXO },
  idade: { rotulo: 'Idade', tipo: 'num', min: 10, max: 100, unidade: 'anos', inteiro: true },
  altura: { rotulo: 'Altura', tipo: 'num', min: 100, max: 250, unidade: 'cm', inteiro: true },
  pesoAtual: { rotulo: 'Peso atual', tipo: 'num', min: 30, max: 300, unidade: 'kg' },
  pesoAlvo: { rotulo: 'Peso alvo', tipo: 'num', min: 30, max: 300, unidade: 'kg' },
  diasSemana: { rotulo: 'Dias de treino por semana', tipo: 'num', min: 1, max: 7, inteiro: true },
  duracao: { rotulo: 'Duração de cada treino', tipo: 'num', min: 10, max: 240, unidade: 'min', inteiro: true },
  local: { rotulo: 'Local', tipo: 'opcao', opcoes: LOCAIS },
  material: { rotulo: 'Material disponível', tipo: 'multi', opcoes: MATERIAL },
  experiencia: { rotulo: 'Experiência', tipo: 'opcao', opcoes: EXPERIENCIA },
  limitacoes: { rotulo: 'Limitações ou lesões', tipo: 'multi', opcoes: LIMITACOES },
  notas: { rotulo: 'Notas', tipo: 'texto', max: 2000 },
};

export function rotulo(opcoes, valor) {
  return opcoes.find(([v]) => v === valor)?.[1] ?? valor;
}

function lerOpcao(opcoes, v) {
  if (v == null || v === '') return undefined;
  const n = norm(v);
  const achada = opcoes.find(([chave, nome]) => chave === v || norm(chave) === n || norm(nome) === n);
  return achada ? achada[0] : null;
}

/**
 * Valida um perfil (completo ou parcial). Só aceita campos conhecidos.
 * Devolve { perfil, erros } com os valores normalizados.
 */
export function validarPerfil(raw, { parcial = true } = {}) {
  const erros = [];
  const perfil = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { perfil, erros: ['O perfil não é um objeto.'] };
  }
  for (const [chave, valor] of Object.entries(raw)) {
    const def = CAMPOS[chave];
    if (!def) continue; // campos desconhecidos são ignorados
    if (valor == null || valor === '') {
      if (def.tipo === 'num' || def.tipo === 'data' || def.tipo === 'texto') perfil[chave] = null;
      continue;
    }
    switch (def.tipo) {
      case 'texto':
        perfil[chave] = String(valor).slice(0, def.max);
        break;
      case 'data': {
        const s = String(valor).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) perfil[chave] = s;
        else erros.push(`${def.rotulo}: data inválida (${valor}).`);
        break;
      }
      case 'num': {
        let n = lerNumero(valor);
        if (n == null) { erros.push(`${def.rotulo}: não é um número (${valor}).`); break; }
        if (def.inteiro) n = Math.round(n);
        if (n < def.min || n > def.max) { erros.push(`${def.rotulo}: ${n} está fora do intervalo ${def.min}–${def.max}.`); break; }
        perfil[chave] = n;
        break;
      }
      case 'opcao': {
        const o = lerOpcao(def.opcoes, valor);
        if (o) perfil[chave] = o;
        else erros.push(`${def.rotulo}: opção desconhecida (${valor}).`);
        break;
      }
      case 'multi': {
        const lista = Array.isArray(valor) ? valor : [valor];
        const out = [];
        for (const v of lista) {
          const o = lerOpcao(def.opcoes, v);
          if (o) { if (!out.includes(o)) out.push(o); }
          else erros.push(`${def.rotulo}: opção desconhecida (${v}).`);
        }
        perfil[chave] = out;
        break;
      }
    }
  }
  if (!parcial) {
    if (!perfil.objetivo) erros.push('Escolhe um objetivo.');
    if (!perfil.diasSemana) erros.push('Indica quantos dias por semana podes treinar.');
    if (!perfil.experiencia) erros.push('Indica a tua experiência.');
  }
  return { perfil, erros };
}

export function valorLegivel(chave, v) {
  const def = CAMPOS[chave];
  if (!def) return String(v);
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  switch (def.tipo) {
    case 'opcao': return rotulo(def.opcoes, v);
    case 'multi': return v.map((x) => rotulo(def.opcoes, x)).join(', ');
    case 'num': return `${String(v).replace('.', ',')}${def.unidade ? ' ' + def.unidade : ''}`;
    case 'data': return fmtData(v, { ano: true });
    default: return String(v);
  }
}

/** Linhas "Rótulo: valor" para os campos preenchidos. */
export function descreverPerfil(p) {
  if (!p) return [];
  const linhas = [];
  for (const chave of Object.keys(CAMPOS)) {
    const v = p[chave];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    linhas.push(`${CAMPOS[chave].rotulo}: ${valorLegivel(chave, v)}`);
  }
  return linhas;
}

/** Diferenças entre dois perfis, em texto. Só considera os campos presentes em `novo`. */
export function diffPerfil(antigo, novo) {
  const out = [];
  for (const chave of Object.keys(novo || {})) {
    if (!CAMPOS[chave]) continue;
    const a = antigo?.[chave] ?? null;
    const b = novo[chave] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ tipo: 'alterado', texto: `${CAMPOS[chave].rotulo}: ${valorLegivel(chave, a)} → ${valorLegivel(chave, b)}` });
  }
  return out;
}
