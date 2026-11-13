// Estado da app e operações sobre ele (puras: recebem e devolvem o estado, sem DOM nem rede).
import { uid, clonar } from './util.js';
import { diffPlanos } from './plano.js';
import { diffPerfil } from './perfil.js';

export const VERSAO = 1;

export function estadoInicial() {
  return {
    versao: VERSAO,
    perfil: null, perfilEm: 0,
    plano: null, planoEm: 0,
    proposta: null, propostaEm: 0,
    sessoes: [],
    pesos: [],
    decisoes: [],
    apagados: {},
    sessaoAtual: null, // só local, não sincroniza
    atualizadoEm: 0,
  };
}

/** Garante que um estado lido (local, Drive ou cópia de segurança) tem todos os campos. */
export function normalizarEstado(e) {
  const base = estadoInicial();
  if (!e || typeof e !== 'object') return base;
  const out = { ...base, ...e };
  for (const k of ['sessoes', 'pesos', 'decisoes']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.apagados || typeof out.apagados !== 'object') out.apagados = {};
  return out;
}

export function guardarPerfil(estado, perfil, agora = Date.now()) {
  return { ...estado, perfil: { ...perfil }, perfilEm: agora };
}

/** Guarda a resposta validada do PT como proposta (ainda não aplicada). */
export function receberProposta(estado, resposta, agora = Date.now()) {
  const proposta = {
    id: uid(),
    em: agora,
    resumo: resposta.resumo || '',
    plano: resposta.plano || null,
    perfil: resposta.perfil || null,
  };
  return { ...estado, proposta, propostaEm: agora };
}

export function alteracoesProposta(estado) {
  const p = estado.proposta;
  if (!p) return [];
  const out = [];
  if (p.perfil) out.push(...diffPerfil(estado.perfil, p.perfil));
  if (p.plano) out.push(...diffPlanos(estado.plano, p.plano));
  return out;
}

/** Aplica a proposta: atualiza plano/perfil e regista a decisão do PT (com o estado anterior, para desfazer). */
export function aplicarProposta(estado, agora = Date.now()) {
  const p = estado.proposta;
  if (!p) return estado;
  const alteracoes = alteracoesProposta(estado).map((a) => a.texto);
  const decisao = {
    id: uid(),
    em: agora,
    origem: 'pt',
    resumo: p.resumo || (estado.plano ? 'Plano atualizado' : 'Plano inicial aprovado'),
    alteracoes,
    antes: { plano: clonar(estado.plano), perfil: clonar(estado.perfil) },
    depois: { plano: clonar(p.plano ?? estado.plano), perfil: clonar(p.perfil ? { ...estado.perfil, ...p.perfil } : estado.perfil) },
  };
  const out = { ...estado, proposta: null, propostaEm: agora, decisoes: [...estado.decisoes, decisao] };
  if (p.plano) { out.plano = { ...clonar(p.plano), aprovadoEm: agora }; out.planoEm = agora; }
  if (p.perfil) { out.perfil = { ...(estado.perfil || {}), ...clonar(p.perfil) }; out.perfilEm = agora; }
  return out;
}

export function descartarProposta(estado, agora = Date.now()) {
  return { ...estado, proposta: null, propostaEm: agora };
}

/** Só a decisão mais recente (que ainda não foi desfeita) pode ser desfeita. */
export function decisaoDesfazivel(estado) {
  const ord = [...estado.decisoes].sort((a, b) => b.em - a.em);
  const ultima = ord[0];
  return ultima && ultima.origem !== 'desfazer' ? ultima : null;
}

export function desfazerDecisao(estado, id, agora = Date.now()) {
  const d = decisaoDesfazivel(estado);
  if (!d || d.id !== id) return estado;
  const registo = {
    id: uid(),
    em: agora,
    origem: 'desfazer',
    resumo: `Desfeito: ${d.resumo}`,
    alteracoes: [],
    antes: { plano: clonar(estado.plano), perfil: clonar(estado.perfil) },
    depois: clonar(d.antes),
  };
  return {
    ...estado,
    plano: clonar(d.antes.plano), planoEm: agora,
    perfil: clonar(d.antes.perfil), perfilEm: agora,
    decisoes: [...estado.decisoes, registo],
  };
}

export function terminarSessao(estado, agora = Date.now()) {
  const s = estado.sessaoAtual;
  if (!s) return estado;
  const sessao = { ...clonar(s), fim: agora, atualizadoEm: agora };
  return { ...estado, sessaoAtual: null, sessoes: [...estado.sessoes, sessao] };
}

export function apagarItem(estado, lista, id, agora = Date.now()) {
  return {
    ...estado,
    [lista]: estado[lista].filter((x) => x.id !== id),
    apagados: { ...estado.apagados, [id]: agora },
  };
}

/** Regista o peso de um dia (substitui o registo do mesmo dia). */
export function registarPeso(estado, data, kg, agora = Date.now()) {
  const existente = estado.pesos.find((p) => p.data === data);
  const pesos = estado.pesos.filter((p) => p.data !== data);
  pesos.push({ id: existente?.id || uid(), data, kg, atualizadoEm: agora });
  pesos.sort((a, b) => a.data.localeCompare(b.data));
  return { ...estado, pesos };
}

function fundirLista(a = [], b = [], apagados = {}) {
  const mapa = new Map();
  for (const x of [...a, ...b]) {
    const atual = mapa.get(x.id);
    if (!atual || (x.atualizadoEm || x.em || 0) > (atual.atualizadoEm || atual.em || 0)) mapa.set(x.id, x);
  }
  return [...mapa.values()].filter((x) => !apagados[x.id]);
}

/**
 * Junta o estado local com o do Drive. Listas: união por id (respeitando o que foi apagado).
 * Perfil, plano e proposta: fica a versão alterada mais recentemente.
 */
export function fundir(local, remoto) {
  if (!remoto) return local;
  if (!local) return normalizarEstado(remoto);
  const L = normalizarEstado(local);
  const R = normalizarEstado(remoto);
  const apagados = { ...R.apagados };
  for (const [id, em] of Object.entries(L.apagados)) apagados[id] = Math.max(em, apagados[id] || 0);

  const out = { ...L, apagados };
  for (const k of ['perfil', 'plano', 'proposta']) {
    if ((R[`${k}Em`] || 0) > (L[`${k}Em`] || 0)) { out[k] = R[k]; out[`${k}Em`] = R[`${k}Em`]; }
  }
  out.sessoes = fundirLista(L.sessoes, R.sessoes, apagados).sort((a, b) => a.data.localeCompare(b.data) || (a.fim || 0) - (b.fim || 0));
  out.decisoes = fundirLista(L.decisoes, R.decisoes, apagados).sort((a, b) => a.em - b.em);
  // Pesos: um por dia; em caso de conflito fica o mais recente.
  const porDia = new Map();
  for (const p of fundirLista(L.pesos, R.pesos, apagados)) {
    const atual = porDia.get(p.data);
    if (!atual || (p.atualizadoEm || 0) > (atual.atualizadoEm || 0)) porDia.set(p.data, p);
  }
  out.pesos = [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data));
  out.sessaoAtual = L.sessaoAtual;
  out.atualizadoEm = Math.max(L.atualizadoEm || 0, R.atualizadoEm || 0);
  return out;
}

/** Estado a enviar para o Drive (sem a sessão em curso). */
export function paraSincronizar(estado) {
  const { sessaoAtual, ...resto } = estado;
  return resto;
}
