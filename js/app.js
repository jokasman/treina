// Interface da app Treina.
import * as db from './db.js';
import * as drive from './drive.js';
import * as som from './som.js';
import { lerCadencia, eventosPreparacao, eventosRepeticao, duracaoRepeticao, eventoAtual, NOMES_FASE } from './core/cadencia.js';
import {
  estadoInicial, normalizarEstado, guardarPerfil, receberProposta, alteracoesProposta, aplicarProposta,
  descartarProposta, decisaoDesfazivel, desfazerDecisao, terminarSessao, apagarItem, registarPeso, fundir, paraSincronizar,
} from './core/estado.js';
import {
  OBJETIVOS, SEXO, LOCAIS, MATERIAL, EXPERIENCIA, LIMITACOES, DURACOES, rotulo, validarPerfil, valorLegivel,
} from './core/perfil.js';
import { fmtAlvo, fmtReps, etiquetasExercicio, blocosDoDia } from './core/plano.js';
import {
  ESFORCOS, proximoDia, ultimoDesempenho, novaSessao, novaSerie, fmtSerie, ordenarSessoes, seriesFeitas,
  treinosNaSemana, evolucaoExercicio, nomesExercicios, rotuloEsforco,
} from './core/treino.js';
import { tendencia, estadoPeso } from './core/peso.js';
import { construirMensagem, linkClaude, lerResposta } from './core/pt.js';
import { hojeIso, fmtData, fmtNum, fmtCarga, fmtTempo, lerNumero, lerTempo, diasEntre, somarDias } from './core/util.js';

// ---------------------------------------------------------------- estado

let estado = estadoInicial();
const ui = {
  modoPT: null,
  pedidoPT: '',
  incluirHist: true,
  resposta: '',
  errosResposta: [],
  exercicio: null,
  sync: 'parado', // parado | a-sincronizar | ok | erro | pendente
  syncErro: '',
  instalar: null,
};
let timer = null; // { fim, total, rotulo }
let wakeLock = null;

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const main = $('#conteudo');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let gravarPendente = null;
function persistir(atraso = 0) {
  clearTimeout(gravarPendente);
  gravarPendente = setTimeout(() => db.gravarEstado(estado).catch((e) => toast(`Erro a gravar: ${e.message}`)), atraso);
}

/** Altera o estado, grava, volta a desenhar e agenda a sincronização. */
function mudar(fn, { desenhar = true, sync = true } = {}) {
  estado = fn(estado);
  estado.atualizadoEm = Date.now();
  persistir();
  if (desenhar) render();
  if (sync) agendarSync();
}

// ---------------------------------------------------------------- utilitários de UI

let toastTimer = null;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function ir(rota) {
  if (location.hash === `#${rota}`) render();
  else location.hash = rota;
}

function rotaAtual() {
  const [rota, param] = location.hash.replace(/^#\/?/, '').split('/');
  return [rota || 'hoje', param ? decodeURIComponent(param) : null];
}

const card = (html, cls = '') => `<section class="card ${cls}">${html}</section>`;
const vazio = (titulo, texto, botao = '') => card(`<h2>${titulo}</h2><p class="muted">${texto}</p>${botao}`, 'vazio');

function opcoesRadio(nome, opcoes, valor, { obrigatorio = false } = {}) {
  return `<div class="chips">${opcoes.map(([v, r]) => `
    <label class="chip"><input type="radio" name="${nome}" value="${esc(v)}" ${String(valor) === String(v) ? 'checked' : ''} ${obrigatorio ? 'required' : ''}><span>${esc(r)}</span></label>`).join('')}</div>`;
}

function opcoesMulti(nome, opcoes, valores = []) {
  return `<div class="chips">${opcoes.map(([v, r]) => `
    <label class="chip"><input type="checkbox" name="${nome}" value="${esc(v)}" ${valores.includes(v) ? 'checked' : ''}><span>${esc(r)}</span></label>`).join('')}</div>`;
}

// ---------------------------------------------------------------- gráficos (SVG simples)

function grafico(series, { altura = 150, sufixo = '' } = {}) {
  const todos = series.flatMap((s) => s.pontos);
  if (todos.length < 2) return '<p class="muted pequeno">Ainda há poucos registos para o gráfico.</p>';
  const L = 320; const A = altura; const m = { e: 34, d: 8, c: 10, b: 20 };
  const datas = todos.map((p) => p.data).sort();
  const d0 = datas[0]; const dn = Math.max(1, diasEntre(d0, datas[datas.length - 1]));
  let min = Math.min(...todos.map((p) => p.y)); let max = Math.max(...todos.map((p) => p.y));
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const pad = (max - min) * 0.1; min -= pad; max += pad;
  const x = (d) => m.e + (diasEntre(d0, d) / dn) * (L - m.e - m.d);
  const y = (v) => m.c + (1 - (v - min) / (max - min)) * (A - m.c - m.b);
  const grelha = [min + pad, (min + max) / 2, max - pad].map((v) =>
    `<line x1="${m.e}" x2="${L - m.d}" y1="${y(v)}" y2="${y(v)}" class="g-grelha"/><text x="${m.e - 4}" y="${y(v) + 3}" class="g-eixo" text-anchor="end">${fmtNum(v, 1)}${sufixo}</text>`).join('');
  const desenho = series.map((s) => {
    const pts = s.pontos.map((p) => `${x(p.data).toFixed(1)},${y(p.y).toFixed(1)}`);
    if (s.tipo === 'pontos') return s.pontos.map((p) => `<circle cx="${x(p.data)}" cy="${y(p.y)}" r="2.5" class="${s.classe}"/>`).join('');
    return `<polyline points="${pts.join(' ')}" class="${s.classe}" fill="none"/>`;
  }).join('');
  const rotulos = `<text x="${m.e}" y="${A - 4}" class="g-eixo">${fmtData(d0)}</text><text x="${L - m.d}" y="${A - 4}" class="g-eixo" text-anchor="end">${fmtData(datas[datas.length - 1])}</text>`;
  return `<svg viewBox="0 0 ${L} ${A}" class="grafico" role="img">${grelha}${desenho}${rotulos}</svg>`;
}

// ---------------------------------------------------------------- vistas

function vistaHoje() {
  const p = estado.perfil;
  const partes = [];

  if (drive.ligado() && !drive.temToken() && ui.sync !== 'a-sincronizar') {
    partes.push(`<button class="aviso" data-acao="drive-sync">☁️ Toca para sincronizar com o Google Drive</button>`);
  }

  if (estado.sessaoAtual) {
    partes.push(card(`<h2>Treino em curso</h2><p>${esc(estado.sessaoAtual.diaNome)} · ${seriesFeitas(estado.sessaoAtual)} séries registadas</p>
      <a class="btn primario" href="#treino">Continuar treino</a>`, 'destaque'));
  }

  if (!p) {
    partes.push(card(`<h2>Bem-vindo à Treina 👋</h2>
      <p>O teu personal trainer é um agente de IA. Começa por definir os teus objetivos; depois o PT cria o teu plano.</p>
      <a class="btn primario" href="#objetivos">Definir objetivos</a>`, 'destaque'));
    return { titulo: 'Treina', html: partes.join('') };
  }

  if (estado.proposta) {
    partes.push(card(`<h2>📩 Proposta do PT por rever</h2><p>${esc(estado.proposta.resumo || 'O PT enviou alterações ao teu plano.')}</p>
      <a class="btn primario" href="#proposta">Ver proposta</a>`, 'destaque'));
  } else if (!estado.plano) {
    partes.push(card(`<h2>Próximo passo: pedir o plano ao PT</h2>
      <p>Os teus objetivos estão definidos. Envia-os ao PT para ele criar o teu plano de treino.</p>
      <button class="btn primario" data-acao="pt-criar">Pedir plano ao PT</button>`, 'destaque'));
  }

  const plano = estado.plano;
  if (plano && !estado.sessaoAtual) {
    const i = proximoDia(plano, estado.sessoes);
    const dia = plano.dias[i];
    partes.push(card(`
      <div class="linha-topo"><h2>Próximo treino</h2><span class="etiqueta">${esc(dia.nome)}</span></div>
      ${dia.foco ? `<p class="muted">${esc(dia.foco)}</p>` : ''}
      <ul class="lista-ex">${dia.exercicios.map((e) => `<li><span>${esc(e.nome)}</span><span class="muted">${esc(fmtAlvo(e))}</span></li>`).join('')}</ul>
      <button class="btn primario largo" data-acao="comecar-treino" data-dia="${i}">Começar ${esc(dia.nome)}</button>
      ${plano.dias.length > 1 ? `<div class="outros-dias"><span class="muted pequeno">Ou outro dia:</span>${plano.dias.map((d, j) => j === i ? '' : `<button class="chip-btn" data-acao="comecar-treino" data-dia="${j}">${esc(d.nome)}</button>`).join('')}</div>` : ''}
    `));
  }

  // Semana e objetivo
  const feitos = treinosNaSemana(estado.sessoes);
  const meta = p.diasSemana || 0;
  const resumoObj = [rotulo(OBJETIVOS, p.objetivo), p.meta].filter(Boolean).map(esc).join(' · ');
  let prazo = '';
  if (p.dataAlvo) {
    const d = diasEntre(hojeIso(), p.dataAlvo);
    prazo = d >= 0 ? `<p class="muted pequeno">Faltam ${d} dias (${fmtData(p.dataAlvo, { ano: true })})</p>` : `<p class="muted pequeno">A data alvo já passou (${fmtData(p.dataAlvo, { ano: true })}).</p>`;
  }
  partes.push(card(`
    <h2>Esta semana</h2>
    <div class="progresso-semana">${Array.from({ length: Math.max(meta, feitos) }, (_, k) => `<span class="${k < feitos ? 'feito' : ''}"></span>`).join('')}</div>
    <p>${feitos} de ${meta} treinos</p>
    <hr><h3>Objetivo</h3><p>${resumoObj}</p>${prazo}
  `));

  partes.push(cartaoPeso());
  partes.push(`<a class="btn secundario largo" href="#pt">💬 Falar com o PT</a>`);
  return { titulo: 'Treina', html: partes.join('') };
}

function textoEstadoPeso(st) {
  const r = st.ritmo != null ? `${st.ritmo > 0 ? '+' : ''}${fmtNum(st.ritmo)} kg/semana` : null;
  switch (st.estado) {
    case 'sem-dados': return 'Ainda sem registos.';
    case 'sem-meta': return `Média: ${fmtNum(st.atual)} kg${r ? ` · ${r}` : ''}`;
    case 'atingido': return `🎉 Meta atingida! Média: ${fmtNum(st.atual)} kg`;
    case 'a-calcular': return `Média: ${fmtNum(st.atual)} kg · faltam ${fmtNum(Math.abs(st.falta))} kg. O ritmo aparece com uma semana de registos.`;
    case 'sentido-errado': return `⚠️ Média: ${fmtNum(st.atual)} kg · ${r} — no sentido contrário à meta.`;
    case 'atrasado': return `⚠️ Média: ${fmtNum(st.atual)} kg · ${r} · chegas à meta a ${fmtData(st.previsao, { ano: true })}, depois da data alvo.${st.ritmoNecessario != null ? ` Precisas de ${fmtNum(st.ritmoNecessario)} kg/semana.` : ''}`;
    case 'no-ritmo': return `✅ Média: ${fmtNum(st.atual)} kg · ${r} · previsão: ${fmtData(st.previsao, { ano: true })}`;
    default: return '';
  }
}

function cartaoPeso() {
  const p = estado.perfil || {};
  const hoje = hojeIso();
  const registoHoje = estado.pesos.find((x) => x.data === hoje);
  const st = estadoPeso({ pesos: estado.pesos, pesoAlvo: p.pesoAlvo, dataAlvo: p.dataAlvo });
  return card(`
    <h2>Peso</h2>
    <form data-form="peso" class="form-linha">
      <input type="hidden" name="data" value="${hoje}">
      <input name="kg" inputmode="decimal" placeholder="Peso de hoje (kg)" value="${registoHoje ? fmtNum(registoHoje.kg) : ''}" aria-label="Peso de hoje em kg">
      <button class="btn primario">${registoHoje ? 'Atualizar' : 'Registar'}</button>
    </form>
    <p class="pequeno">${esc(textoEstadoPeso(st))}${p.pesoAlvo ? ` <span class="muted">· alvo ${fmtNum(p.pesoAlvo)} kg</span>` : ''}</p>
  `);
}

function vistaObjetivos() {
  const p = estado.perfil || {};
  const html = `
  <form data-form="objetivos" class="form" novalidate>
    ${card(`<h2>Qual é o teu objetivo principal?</h2>${opcoesRadio('objetivo', OBJETIVOS, p.objetivo, { obrigatorio: true })}
      <label class="campo"><span>A tua meta em concreto</span><input name="meta" maxlength="300" value="${esc(p.meta)}" placeholder="Ex.: perder 8 kg, correr 10 km, fazer 10 elevações"></label>
      <label class="campo"><span>Até quando?</span><input type="date" name="dataAlvo" value="${esc(p.dataAlvo)}" min="${hojeIso()}"></label>`)}
    ${card(`<h2>Sobre ti</h2>
      <div class="grelha-2">
        <label class="campo"><span>Idade</span><input name="idade" inputmode="numeric" value="${esc(p.idade)}" placeholder="anos"></label>
        <label class="campo"><span>Altura</span><input name="altura" inputmode="numeric" value="${esc(p.altura)}" placeholder="cm"></label>
        <label class="campo"><span>Peso atual</span><input name="pesoAtual" inputmode="decimal" value="${esc(p.pesoAtual != null ? fmtNum(p.pesoAtual) : '')}" placeholder="kg"></label>
        <label class="campo"><span>Peso alvo</span><input name="pesoAlvo" inputmode="decimal" value="${esc(p.pesoAlvo != null ? fmtNum(p.pesoAlvo) : '')}" placeholder="kg (opcional)"></label>
      </div>
      <p class="rotulo">Sexo</p>${opcoesRadio('sexo', SEXO, p.sexo)}
      <p class="rotulo">Experiência</p>${opcoesRadio('experiencia', EXPERIENCIA, p.experiencia, { obrigatorio: true })}`)}
    ${card(`<h2>Disponibilidade</h2>
      <p class="rotulo">Dias de treino por semana</p>${opcoesRadio('diasSemana', [1, 2, 3, 4, 5, 6, 7].map((n) => [n, String(n)]), p.diasSemana, { obrigatorio: true })}
      <p class="rotulo">Duração de cada treino</p>${opcoesRadio('duracao', DURACOES.map((n) => [n, `${n} min`]), p.duracao)}
      <p class="rotulo">Onde treinas</p>${opcoesRadio('local', LOCAIS, p.local)}
      <p class="rotulo">Material disponível <span class="muted">(se não for ginásio)</span></p>${opcoesMulti('material', MATERIAL, p.material || [])}`)}
    ${card(`<h2>Limitações ou lesões</h2>${opcoesMulti('limitacoes', LIMITACOES, p.limitacoes || [])}`)}
    ${card(`<h2>Notas para o PT</h2>
      <p class="muted pequeno">Tudo o que não deu para escolher acima: horários, dias preferidos, desportos que praticas, exercícios de que gostas ou não, lesões antigas, medicação…</p>
      <textarea name="notas" rows="6" maxlength="2000">${esc(p.notas)}</textarea>`)}
    <div id="erros-objetivos"></div>
    <button class="btn primario largo">Guardar objetivos</button>
  </form>`;
  return { titulo: 'Objetivos', html, voltar: estado.perfil ? '#mais' : null };
}

function modoPT() {
  if (ui.modoPT) return ui.modoPT;
  if (estado.proposta) return 'rever';
  if (!estado.plano) return 'criar';
  return 'conversa';
}

function mensagemPT() {
  return construirMensagem({ modo: modoPT(), estado, pedido: ui.pedidoPT, incluirHistorico: ui.incluirHist });
}

function vistaPT() {
  if (!estado.perfil) return { titulo: 'PT', html: vazio('Primeiro os objetivos', 'O PT precisa de conhecer os teus objetivos.', '<a class="btn primario" href="#objetivos">Definir objetivos</a>') };
  const modo = modoPT();
  const modos = [['conversa', 'Conversa']];
  if (estado.proposta) modos.unshift(['rever', 'Rever proposta']);
  if (!estado.plano && !estado.proposta) modos.unshift(['criar', 'Criar plano']);
  const sugestoes = {
    criar: 'Opcional: algo a acrescentar ao pedido (ex.: "prefiro treinar de manhã")',
    rever: 'O que queres mudar na proposta? (ex.: "tira o agachamento, tenho dor no joelho")',
    conversa: 'Escreve ao PT (ex.: "a máquina de remo está sempre ocupada, troca por outro exercício")',
  };
  const msg = mensagemPT();
  const link = linkClaude(msg);
  const html = `
    ${card(`
      <h2>1. Enviar ao PT</h2>
      ${modos.length > 1 ? `<div class="segmentos">${modos.map(([m, r]) => `<button class="${m === modo ? 'ativo' : ''}" data-acao="pt-modo" data-modo="${m}">${r}</button>`).join('')}</div>` : ''}
      <textarea data-ui="pedidoPT" rows="4" placeholder="${esc(sugestoes[modo])}">${esc(ui.pedidoPT)}</textarea>
      <label class="interruptor"><input type="checkbox" data-ui="incluirHist" ${ui.incluirHist ? 'checked' : ''}><span>Incluir treinos, peso e decisões anteriores</span></label>
      <button class="btn primario largo" data-acao="pt-partilhar">Partilhar com o Claude</button>
      <div class="botoes-2">
        <button class="btn secundario" data-acao="pt-abrir" ${link ? '' : 'disabled'}>Abrir no Claude</button>
        <button class="btn secundario" data-acao="pt-copiar">Copiar mensagem</button>
      </div>
      ${link ? '' : '<p class="muted pequeno">A mensagem é longa demais para abrir por link. Usa Partilhar ou Copiar.</p>'}
      <details><summary>Ver a mensagem completa</summary><pre id="previa-pt">${esc(msg)}</pre></details>
    `)}
    ${card(`
      <h2>2. Trazer a resposta do PT</h2>
      <p class="muted pequeno">No Claude, partilha a resposta do PT e escolhe <strong>Treina</strong>. Ou copia-a e toca em Colar.</p>
      <button class="btn primario largo" data-acao="colar-resposta">📋 Colar resposta</button>
      <textarea data-ui="resposta" rows="4" placeholder="…ou cola aqui a resposta do PT">${esc(ui.resposta)}</textarea>
      <button class="btn secundario largo" data-acao="ler-resposta">Ler resposta</button>
      ${ui.errosResposta.length ? `<div class="erro"><strong>Não consegui aplicar esta resposta:</strong><ul>${ui.errosResposta.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        <p class="pequeno">Pede ao PT para corrigir e enviar de novo o bloco <code>treina</code>.</p>
        <button class="btn secundario" data-acao="pt-pedir-correcao">Copiar pedido de correção</button></div>` : ''}
    `)}`;
  return { titulo: 'Falar com o PT', html };
}

function iconeAlteracao(tipo) {
  return { novo: '✦', adicionado: '+', removido: '−', alterado: '~' }[tipo] || '•';
}

function htmlComoFazer(e) {
  const partes = [];
  if (e.execucao) partes.push(`<p>${esc(e.execucao)}</p>`);
  if (e.maisFacil) partes.push(`<p><span class="rot">Mais fácil:</span> ${esc(e.maisFacil)}</p>`);
  if (e.maisDificil) partes.push(`<p><span class="rot">Mais difícil:</span> ${esc(e.maisDificil)}</p>`);
  if (e.notas) partes.push(`<p><span class="rot">Notas:</span> ${esc(e.notas)}</p>`);
  if (!partes.length) return '';
  return `<details class="como-fazer"><summary>${e.execucao ? 'Como fazer' : 'Mais informação'}</summary>${partes.join('')}</details>`;
}

/** Cabeçalho comum de um exercício: nome, alvo, etiquetas e dicas. */
function htmlCabExercicio(e, tag = 'strong') {
  const etq = etiquetasExercicio(e);
  return `
    <div class="ex-nome"><${tag}>${esc(e.nome)}</${tag}></div>
    <div class="ex-alvo">${esc(fmtAlvo(e))}</div>
    ${etq.length ? `<div class="ex-tags">${etq.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    ${e.dicas ? `<p class="ex-dicas">💡 ${esc(e.dicas)}</p>` : ''}`;
}

function htmlSecao(titulo, texto) {
  return texto ? `<div class="secao-plano"><h3>${titulo}</h3><p>${esc(texto)}</p></div>` : '';
}

function htmlPlano(plano) {
  return `
    ${htmlSecao('🔥 Aquecimento', plano.aquecimento)}
    ${htmlSecao('📈 Progressão', plano.progressao)}
    ${htmlSecao('📝 Indicações gerais', plano.notas)}
    ${plano.dias.map((d) => `
      <div class="dia">
        <h3 class="dia-titulo">${esc(d.nome)}${d.foco ? ` <span class="muted">· ${esc(d.foco)}</span>` : ''}</h3>
        ${d.notas ? `<p class="muted pequeno">${esc(d.notas)}</p>` : ''}
        ${blocosDoDia(d).map((b) => {
          const itens = b.itens.map(({ ex }) => `<li class="ex">${htmlCabExercicio(ex)}${htmlComoFazer(ex)}</li>`).join('');
          return b.grupo && b.itens.length > 1
            ? `<div class="grupo"><div class="grupo-titulo">🔁 ${esc(b.grupo)} <span class="muted">· alterna os exercícios, descansa no fim da volta</span></div><ul class="lista-ex2">${itens}</ul></div>`
            : `<ul class="lista-ex2">${itens}</ul>`;
        }).join('')}
      </div>`).join('')}`;
}

/** Plano com indicações escritas nas notas em vez dos campos próprios (planos antigos). */
function planoPorOrganizar(plano) {
  return plano.dias.some((d) => d.exercicios.some((e) => (e.notas || '').length > 120 && !e.execucao));
}

function vistaProposta() {
  const pr = estado.proposta;
  if (!pr) return { titulo: 'Proposta', html: vazio('Sem propostas', 'Não há nenhuma proposta do PT por rever.', '<a class="btn primario" href="#pt">Falar com o PT</a>') };
  const alt = alteracoesProposta(estado);
  const novo = !estado.plano && pr.plano;
  const html = `
    ${card(`
      <p class="muted pequeno">Recebida ${fmtData(hojeIso(new Date(pr.em)), { semana: true })}</p>
      <h2>${esc(pr.resumo || (novo ? 'Plano proposto pelo PT' : 'Alterações propostas pelo PT'))}</h2>
      ${alt.length ? `<ul class="alteracoes">${alt.map((a) => `<li class="alt-${a.tipo}"><span>${iconeAlteracao(a.tipo)}</span>${esc(a.texto)}</li>`).join('')}</ul>`
        : '<p class="muted">A proposta é igual ao que já tens.</p>'}
      <button class="btn primario largo" data-acao="aprovar-proposta">${novo ? '✓ Aprovar plano' : '✓ Aplicar alterações'}</button>
      <div class="botoes-2">
        <button class="btn secundario" data-acao="rever-proposta">✎ Pedir alterações</button>
        <button class="btn perigo-texto" data-acao="descartar-proposta">Descartar</button>
      </div>
    `, 'destaque')}
    ${pr.plano ? card(`<h2>${esc(pr.plano.nome)}</h2>${htmlPlano(pr.plano)}`) : ''}`;
  return { titulo: 'Proposta do PT', html, voltar: '#hoje' };
}

function vistaPlano() {
  const plano = estado.plano;
  if (!plano) {
    return {
      titulo: 'Plano',
      html: estado.proposta
        ? vazio('Plano por aprovar', 'O PT enviou uma proposta. Revê-a e aprova quando estiveres satisfeito.', '<a class="btn primario" href="#proposta">Ver proposta</a>')
        : vazio('Ainda sem plano', 'O teu plano é criado pelo PT a partir dos teus objetivos.', estado.perfil ? '<button class="btn primario" data-acao="pt-criar">Pedir plano ao PT</button>' : '<a class="btn primario" href="#objetivos">Definir objetivos</a>'),
    };
  }
  const desfazivel = decisaoDesfazivel(estado);
  const decisoes = [...estado.decisoes].sort((a, b) => b.em - a.em);
  const html = `
    ${estado.proposta ? `<a class="aviso" href="#proposta">📩 Há uma proposta do PT por rever</a>` : ''}
    ${planoPorOrganizar(plano) ? card(`<h2>Organizar o plano</h2><p class="pequeno">Este plano tem muitas indicações nas notas. Pede ao PT para as passar para os campos próprios (execução, dicas, cadência, superséries…).</p>
      <button class="btn primario largo" data-acao="pt-organizar">Pedir ao PT para organizar</button>`, 'destaque') : ''}
    ${card(`<h2>${esc(plano.nome)}</h2>${plano.aprovadoEm ? `<p class="muted pequeno">Aprovado a ${fmtData(hojeIso(new Date(plano.aprovadoEm)), { ano: true })}</p>` : ''}${htmlPlano(plano)}
      <a class="btn secundario largo" href="#pt">💬 Falar com o PT sobre o plano</a>`)}
    ${card(`<h2>Decisões do PT</h2>
      ${decisoes.length ? `<ul class="decisoes">${decisoes.map((d) => `
        <li><div class="linha-topo"><strong>${esc(d.resumo)}</strong><span class="muted pequeno">${fmtData(hojeIso(new Date(d.em)), { ano: true })}</span></div>
          ${d.alteracoes?.length ? `<details><summary>${d.alteracoes.length} alteraç${d.alteracoes.length === 1 ? 'ão' : 'ões'}</summary><ul>${d.alteracoes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
          ${desfazivel?.id === d.id ? `<button class="btn perigo-texto pequeno" data-acao="desfazer" data-id="${d.id}">Desfazer esta decisão</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Ainda sem decisões.</p>'}`)}`;
  return { titulo: 'Plano', html };
}

function vistaTreino() {
  const s = estado.sessaoAtual;
  if (!s) return { titulo: 'Treino', html: vazio('Nenhum treino em curso', 'Começa um treino a partir do ecrã Hoje.', '<a class="btn primario" href="#hoje">Ir para Hoje</a>') };
  const html = `
    <p class="muted pequeno">${esc(s.planoNome)} · começou às ${new Date(s.inicio).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</p>
    ${s.exercicios.map((ex, i) => {
      const a = ex.alvo;
      const porTempo = a.repsMin == null;
      const ultimo = ultimoDesempenho(ex.nome, estado.sessoes);
      return card(`
        ${a.grupo ? `<div class="grupo-titulo">🔁 ${esc(a.grupo)}</div>` : ''}
        ${htmlCabExercicio(a, 'h2')}
        ${a.repsMin != null && lerCadencia(a.cadencia) ? `<button class="btn-cadencia" data-acao="cadencia" data-ex="${i}">🔊 Tocar cadência ${esc(a.cadencia)} · alvo ${a.repsMax} reps${a.unilateral ? ' (um lado)' : ''}</button>` : ''}
        ${htmlComoFazer(a)}
        ${ultimo ? `<p class="pequeno ultimo">Última vez (${fmtData(ultimo.data)}): ${ultimo.series.map((x) => esc(fmtSerie({ ...x, esforco: null }))).join(', ')}</p>` : ''}
        <div class="series">
          <div class="serie cab"><span>#</span><span>${porTempo ? 'Tempo (s)' : 'Reps'}${a.unilateral ? ' /lado' : ''}</span><span>Carga (kg)</span><span>Como foi?</span></div>
          ${ex.series.map((x, j) => `
            <div class="serie ${x.feita ? 'feita' : ''}">
              <span class="num">${j + 1}</span>
              ${porTempo
                ? `<input data-campo="tempo" data-ex="${i}" data-serie="${j}" inputmode="numeric" value="${x.tempo ?? ''}" placeholder="${a.tempo ?? ''}" aria-label="Tempo da série ${j + 1}">`
                : `<input data-campo="reps" data-ex="${i}" data-serie="${j}" inputmode="numeric" value="${x.reps ?? ''}" placeholder="${esc(fmtReps(a))}" aria-label="Repetições da série ${j + 1}">`}
              <input data-campo="carga" data-ex="${i}" data-serie="${j}" inputmode="decimal" value="${x.carga != null ? fmtNum(x.carga) : ''}" placeholder="—" aria-label="Carga da série ${j + 1}">
              <span class="esforcos">${ESFORCOS.map(([v, r, emoji]) => `<button class="esf ${x.feita && x.esforco === v ? 'ativo' : ''}" data-acao="esforco" data-ex="${i}" data-serie="${j}" data-valor="${v}" title="${r}" aria-label="${r}">${emoji}</button>`).join('')}</span>
            </div>`).join('')}
        </div>
        <div class="botoes-serie">
          <button class="chip-btn" data-acao="add-serie" data-ex="${i}">+ série</button>
          ${ex.series.length > 1 ? `<button class="chip-btn" data-acao="rem-serie" data-ex="${i}">− série</button>` : ''}
        </div>
        <input class="nota-ex" data-campo="nota" data-ex="${i}" value="${esc(ex.nota)}" placeholder="Nota para o PT (dor, máquina ocupada…)">
      `);
    }).join('')}
    ${card(`<h2>Notas do treino</h2><textarea data-campo="notas-sessao" rows="3" placeholder="Como te sentiste? Dormiste bem?">${esc(s.notas)}</textarea>
      <button class="btn primario largo" data-acao="terminar-treino">Terminar treino</button>
      <button class="btn perigo-texto largo" data-acao="cancelar-treino">Cancelar treino</button>`)}
    <p class="muted pequeno centro">Toca no emoji depois de cada série: regista a série e arranca o descanso.</p>`;
  return { titulo: s.diaNome, html, voltar: '#hoje' };
}

function vistaSessao(id) {
  const s = estado.sessoes.find((x) => x.id === id);
  if (!s) return { titulo: 'Treino', html: vazio('Treino não encontrado', '', '<a class="btn primario" href="#progresso">Voltar</a>'), voltar: '#progresso' };
  const minutos = s.fim && s.inicio ? Math.round((s.fim - s.inicio) / 60000) : 0;
  const dur = minutos ? `${minutos} min` : '';
  const html = `
    ${card(`<p class="muted">${fmtData(s.data, { ano: true, semana: true })}${dur ? ` · ${dur}` : ''} · ${seriesFeitas(s)} séries</p>
      ${s.exercicios.map((ex) => {
        const feitas = ex.series.filter((x) => x.feita);
        return `<div class="ex-hist"><strong>${esc(ex.nome)}</strong> <span class="muted pequeno">alvo ${esc(fmtAlvo(ex.alvo))}</span>
          <div>${feitas.length ? feitas.map((x) => `<span class="serie-hist">${esc(fmtSerie(x))}</span>`).join('') : '<span class="muted">não feito</span>'}</div>
          ${ex.nota ? `<p class="pequeno">📝 ${esc(ex.nota)}</p>` : ''}</div>`;
      }).join('')}
      ${s.notas ? `<p class="notas">${esc(s.notas)}</p>` : ''}
      <button class="btn primario largo" data-acao="contar-pt" data-id="${s.id}">💬 Contar ao PT como correu</button>
      <button class="btn perigo-texto largo" data-acao="apagar-sessao" data-id="${s.id}">Apagar este treino</button>`)}`;
  return { titulo: s.diaNome, html, voltar: '#progresso' };
}

function vistaProgresso() {
  const p = estado.perfil || {};
  const t = tendencia(estado.pesos).filter((x) => x.data >= somarDias(hojeIso(), -120));
  const st = estadoPeso({ pesos: estado.pesos, pesoAlvo: p.pesoAlvo, dataAlvo: p.dataAlvo });
  const nomes = nomesExercicios(estado.sessoes);
  const exSel = ui.exercicio && nomes.includes(ui.exercicio) ? ui.exercicio : nomes[0];
  const evo = exSel ? evolucaoExercicio(exSel, estado.sessoes) : [];
  const sessoes = ordenarSessoes(estado.sessoes);
  const pesosRecentes = [...estado.pesos].reverse().slice(0, 8);

  const html = `
    ${card(`<h2>Peso</h2>
      ${grafico([
        { pontos: t.map((x) => ({ data: x.data, y: x.kg })), tipo: 'pontos', classe: 'g-ponto' },
        { pontos: t.map((x) => ({ data: x.data, y: x.media })), classe: 'g-linha' },
      ])}
      <p class="pequeno">${esc(textoEstadoPeso(st))}</p>
      <form data-form="peso" class="form-linha">
        <input type="date" name="data" value="${hojeIso()}" max="${hojeIso()}" aria-label="Data">
        <input name="kg" inputmode="decimal" placeholder="kg" aria-label="Peso em kg">
        <button class="btn primario">Registar</button>
      </form>
      ${pesosRecentes.length ? `<details><summary>Últimos registos</summary><ul class="lista-simples">${pesosRecentes.map((x) => `<li><span>${fmtData(x.data, { semana: true })}</span><span>${fmtNum(x.kg)} kg</span><button class="x" data-acao="apagar-peso" data-id="${x.id}" aria-label="Apagar">✕</button></li>`).join('')}</ul></details>` : ''}`)}
    ${card(`<h2>Evolução por exercício</h2>
      ${nomes.length ? `<select data-ui="exercicio">${nomes.map((n) => `<option ${n === exSel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        ${evo.some((x) => x.carga != null)
          ? grafico([{ pontos: evo.filter((x) => x.carga != null).map((x) => ({ data: x.data, y: x.carga })), classe: 'g-linha' }, { pontos: evo.filter((x) => x.carga != null).map((x) => ({ data: x.data, y: x.carga })), tipo: 'pontos', classe: 'g-ponto' }], { sufixo: '' })
          : grafico([{ pontos: evo.map((x) => ({ data: x.data, y: x.reps })), classe: 'g-linha' }])}
        <p class="muted pequeno">${evo.length ? `Melhor série recente: ${esc(fmtSerie({ ...evo[evo.length - 1], esforco: null }))}` : ''}</p>`
        : '<p class="muted">Regista treinos para ver a evolução.</p>'}`)}
    ${card(`<h2>Histórico de treinos</h2>
      ${sessoes.length ? `<ul class="lista-simples links">${sessoes.map((s) => `<li><a href="#sessao/${encodeURIComponent(s.id)}"><span>${fmtData(s.data, { semana: true })} · ${esc(s.diaNome)}</span><span class="muted">${seriesFeitas(s)} séries ›</span></a></li>`).join('')}</ul>`
        : '<p class="muted">Ainda não registaste treinos.</p>'}`)}`;
  return { titulo: 'Progresso', html };
}

function vistaMais() {
  const ligado = drive.ligado();
  const ultima = drive.ultimaSincronizacao();
  const estadoSync = {
    'a-sincronizar': 'A sincronizar…',
    ok: `Sincronizado${ultima ? ` às ${new Date(ultima).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
    erro: `Erro: ${ui.syncErro}`,
    pendente: 'Toca em Sincronizar para entrar outra vez.',
    parado: ultima ? `Última sincronização: ${new Date(ultima).toLocaleString('pt-PT')}` : 'Ainda não sincronizado.',
  }[ui.sync];
  const html = `
    ${card(`<h2>Objetivos</h2>
      ${estado.perfil ? `<ul class="lista-simples">${['objetivo', 'meta', 'dataAlvo', 'diasSemana', 'duracao', 'local', 'experiencia', 'limitacoes'].filter((k) => estado.perfil[k] != null && estado.perfil[k] !== '' && !(Array.isArray(estado.perfil[k]) && !estado.perfil[k].length)).map((k) => `<li><span class="muted">${esc(rotuloCampo(k))}</span><span>${esc(valorLegivel(k, estado.perfil[k]))}</span></li>`).join('')}</ul>` : ''}
      <a class="btn secundario largo" href="#objetivos">Editar objetivos</a>
      <p class="muted pequeno">Se mudares os objetivos, fala com o PT para ele ajustar o plano.</p>`)}
    ${card(`<h2>Google Drive</h2>
      ${ligado ? `<p>Os teus dados são guardados numa pasta privada da Treina no teu Drive.</p><p class="pequeno ${ui.sync === 'erro' ? 'texto-erro' : 'muted'}">${esc(estadoSync)}</p>
          <div class="botoes-2"><button class="btn primario" data-acao="drive-sync">Sincronizar agora</button><button class="btn secundario" data-acao="drive-sair">Desligar</button></div>`
        : `<p>Liga a tua conta Google para guardar os treinos no Drive e usá-los noutros dispositivos.</p>
          ${ui.sync === 'erro' ? `<p class="pequeno texto-erro">${esc(ui.syncErro)}</p>` : ''}
          <button class="btn primario largo" data-acao="drive-ligar">Entrar com Google</button>`}`)}
    ${card(`<h2>Sinais sonoros da cadência</h2>
      <p class="muted pequeno">Um sinal por segundo em cada fase: grave a descer, agudo a subir, clique nas pausas. Os sinais sobrepõem-se à música.</p>
      <label class="campo"><span>Volume dos sinais: <strong id="vol-valor">${som.preferencias().volume}%</strong></span>
        <input type="range" min="0" max="100" step="5" value="${som.preferencias().volume}" data-ui="volume"></label>
      <label class="campo"><span>Tempo de preparação antes da 1.ª repetição (segundos)</span>
        <input inputmode="numeric" value="${som.preferencias().preparacao}" data-ui="preparacao"></label>
      <button class="btn secundario largo" data-acao="som-testar">▶ Testar sons</button>`)}
    ${card(`<h2>Cópia de segurança</h2>
      <div class="botoes-2"><button class="btn secundario" data-acao="exportar">Exportar</button>
      <label class="btn secundario">Importar<input type="file" accept="application/json,.json" data-acao-ficheiro="importar" hidden></label></div>
      <p class="muted pequeno">Importar junta a cópia com os dados atuais.</p>`)}
    ${ui.instalar ? card(`<h2>Instalar</h2><p>Instala a Treina no ecrã principal para a usares como uma app e para aparecer no menu de partilha.</p><button class="btn primario largo" data-acao="instalar">Instalar app</button>`) : ''}
    ${card(`<h2>Dados</h2><button class="btn perigo largo" data-acao="apagar-tudo">Apagar todos os dados deste dispositivo</button>
      <p class="muted pequeno">Não apaga a cópia no Google Drive.</p>`)}
    <p class="muted pequeno centro">Treina · os teus dados ficam no teu telemóvel e no teu Google Drive.</p>`;
  return { titulo: 'Mais', html };
}

function rotuloCampo(k) {
  return { objetivo: 'Objetivo', meta: 'Meta', dataAlvo: 'Data alvo', diasSemana: 'Dias por semana', duracao: 'Duração', local: 'Local', experiencia: 'Experiência', limitacoes: 'Limitações' }[k] || k;
}

const VISTAS = {
  hoje: vistaHoje,
  objetivos: vistaObjetivos,
  pt: vistaPT,
  proposta: vistaProposta,
  plano: vistaPlano,
  treino: vistaTreino,
  sessao: vistaSessao,
  progresso: vistaProgresso,
  mais: vistaMais,
};

const SEPARADOR = { hoje: 'hoje', treino: 'hoje', plano: 'plano', proposta: 'plano', pt: 'pt', progresso: 'progresso', sessao: 'progresso', mais: 'mais', objetivos: 'mais' };

function render() {
  const [rota, param] = rotaAtual();
  const vista = VISTAS[rota] || vistaHoje;
  const { titulo, html, voltar } = vista(param);
  $('#titulo').textContent = titulo;
  const bVoltar = $('#voltar');
  bVoltar.hidden = !voltar;
  if (voltar) bVoltar.href = voltar;
  main.innerHTML = html;
  const sep = SEPARADOR[rota] || 'hoje';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.sep === sep));
  const sync = $('#sync');
  sync.hidden = !drive.ligado();
  sync.dataset.estado = ui.sync;
  sync.title = ui.sync === 'erro' ? ui.syncErro : 'Sincronizar';
  if (rota === 'treino' && estado.sessaoAtual) pedirEcraLigado(); else { largarEcra(); pararCadencia(); }
  if (rota === 'mais') drive.preparar();
  desenharTimer();
}

// ---------------------------------------------------------------- treino: descanso e ecrã ligado

async function pedirEcraLigado() {
  try { if (!wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* opcional */ }
}
function largarEcra() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }

let intervaloTimer = null;
function iniciarTimer(segundos, rotuloTimer) {
  pararCadencia();
  timer = { fim: Date.now() + segundos * 1000, total: segundos, rotulo: rotuloTimer };
  clearInterval(intervaloTimer);
  intervaloTimer = setInterval(desenharTimer, 250);
  desenharTimer();
}

function pararTimer() {
  timer = null;
  clearInterval(intervaloTimer);
  desenharTimer();
}

function desenharTimer() {
  const el = $('#timer');
  if (!timer) { el.hidden = true; return; }
  const resta = Math.max(0, Math.ceil((timer.fim - Date.now()) / 1000));
  el.hidden = false;
  el.classList.toggle('fim', resta === 0);
  $('#timer-tempo').textContent = resta === 0 ? 'Bora! 💪' : `${Math.floor(resta / 60)}:${String(resta % 60).padStart(2, '0')}`;
  $('#timer-rotulo').textContent = resta === 0 ? 'Descanso terminado' : `Descanso · ${timer.rotulo}`;
  $('#timer-barra').style.width = `${(1 - resta / timer.total) * 100}%`;
  if (resta === 0 && !timer.avisado) {
    timer.avisado = true;
    try { navigator.vibrate?.([250, 120, 250]); } catch { /* opcional */ }
    setTimeout(() => { if (timer?.avisado) pararTimer(); }, 8000);
  }
}

// ---------------------------------------------------------------- treino: cadência com sinais sonoros

let cadencia = null; // { nome, cadencia, alvo, fases, duracao, inicio, eventos, proxRep, proxT }
let intervaloCadencia = null;
const ANTECEDENCIA = 8; // segundos de sinais agendados à frente

async function iniciarCadencia(i) {
  const ex = estado.sessaoAtual?.exercicios[i];
  const fases = ex && lerCadencia(ex.alvo.cadencia);
  if (!fases) return;
  pararTimer();
  pararCadencia();
  await som.preparar();
  const prep = eventosPreparacao(som.preferencias().preparacao);
  const inicio = som.iniciarRelogio();
  som.agendar(prep, inicio);
  cadencia = {
    nome: ex.nome, cadencia: ex.alvo.cadencia, alvo: ex.alvo.repsMax || ex.alvo.repsMin || 10,
    fases, duracao: duracaoRepeticao(fases), inicio, eventos: prep, proxRep: 1, proxT: prep.length,
  };
  $('#cadencia [data-ui="volume"]').value = som.preferencias().volume;
  agendarMaisCadencia();
  intervaloCadencia = setInterval(() => { agendarMaisCadencia(); desenharCadencia(); }, 50);
  desenharCadencia();
}

/** Vai agendando repetições à frente, sem fim, até o utilizador parar. */
function agendarMaisCadencia() {
  const c = cadencia;
  if (!c) return;
  const t = som.agora() - c.inicio;
  while (c.proxT < t + ANTECEDENCIA) {
    const novos = eventosRepeticao(c.fases, c.proxRep, c.proxT);
    if (c.proxRep === c.alvo) novos.push({ t: c.proxT + c.duracao, tipo: 'alvo', rep: c.alvo });
    som.agendar(novos, c.inicio);
    c.eventos.push(...novos);
    c.proxT += c.duracao;
    c.proxRep += 1;
  }
  // Mantém só os eventos recentes (a lista cresceria sem limite).
  const corte = c.eventos.findIndex((e) => e.t > t - 5);
  if (corte > 50) c.eventos.splice(0, corte - 1);
}

function pararCadencia() {
  if (!cadencia) return;
  som.parar();
  som.adormecer();
  cadencia = null;
  clearInterval(intervaloCadencia);
  desenharCadencia();
}

function desenharCadencia() {
  const el = $('#cadencia');
  if (!cadencia) { el.hidden = true; return; }
  el.hidden = false;
  const t = som.agora() - cadencia.inicio;
  const e = eventoAtual(cadencia.eventos, t);
  const fase = $('#cad-fase');
  const seg = $('#cad-seg');
  $('#cad-rotulo').textContent = `${cadencia.nome} · ${cadencia.cadencia}`;
  el.dataset.fase = e?.fase || 'prep';
  el.dataset.extra = e?.rep > cadencia.alvo ? 'sim' : 'nao';
  if (!e || e.tipo === 'prep') {
    fase.textContent = 'Prepara-te';
    seg.textContent = e ? String(e.resta) : '';
    $('#cad-rep').textContent = `Alvo: ${cadencia.alvo} repetições`;
  } else {
    const seta = { desce: '⬇', sobe: '⬆' }[e.fase] || '⏸';
    fase.textContent = `${seta} ${NOMES_FASE[e.fase]}`;
    seg.textContent = e.total > 1 ? `${e.segundo} / ${e.total}` : '';
    $('#cad-rep').textContent = e.rep > cadencia.alvo
      ? `Repetição ${e.rep} · +${e.rep - cadencia.alvo} além do alvo (${cadencia.alvo})`
      : `Repetição ${e.rep} de ${cadencia.alvo}`;
  }
}

// ---------------------------------------------------------------- PT: enviar e receber

async function partilharComClaude() {
  const msg = mensagemPT();
  if (navigator.share) {
    try {
      await navigator.share({ text: msg });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  if (await copiar(msg)) toast('Mensagem copiada. Abre o Claude e cola numa conversa nova.');
}

function processarResposta(texto, { origem = 'colar' } = {}) {
  const r = lerResposta(texto);
  if (!r.ok) {
    ui.resposta = texto;
    ui.errosResposta = r.erros;
    ir('pt');
    if (origem === 'partilha') toast('A resposta recebida tem problemas. Vê os detalhes.');
    return;
  }
  ui.resposta = '';
  ui.errosResposta = [];
  ui.pedidoPT = '';
  ui.modoPT = null;
  mudar((e) => receberProposta(e, r), { desenhar: false });
  ir('proposta');
  toast('Resposta do PT recebida. Revê as alterações.');
}

/** Texto recebido através do menu de partilha do Android (share target). */
function receberPartilha() {
  const q = new URLSearchParams(location.search);
  if (!q.has('text') && !q.has('title') && !q.has('url')) return false;
  const texto = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n\n');
  history.replaceState(null, '', location.pathname + location.hash);
  if (texto.trim()) {
    processarResposta(texto, { origem: 'partilha' });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- sincronização

let syncTimer = null;
let aSincronizar = false;
function agendarSync() {
  if (!drive.ligado()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sincronizar({ interativo: false }), 2500);
}

async function sincronizar({ interativo }) {
  if (aSincronizar) return;
  if (!drive.temToken()) {
    if (!interativo) { if (drive.ligado()) { ui.sync = 'pendente'; atualizarSync(); } return; }
  }
  aSincronizar = true;
  try {
    if (!drive.temToken()) await drive.entrar();
    ui.sync = 'a-sincronizar';
    atualizarSync();
    const { id, dados } = await drive.descarregar();
    if (dados) estado = fundir(estado, dados);
    await db.gravarEstado(estado);
    await drive.carregar(paraSincronizar(estado), id);
    ui.sync = 'ok';
    ui.syncErro = '';
    if (dados) render(); // os dados do Drive podem ter mudado o ecrã
  } catch (e) {
    ui.sync = 'erro';
    ui.syncErro = e.message;
    if (interativo) toast(e.message);
  } finally {
    aSincronizar = false;
    atualizarSync();
  }
}

function atualizarSync() {
  const [rota] = rotaAtual();
  // Não redesenhar o ecrã do treino (perderia o foco nos campos).
  if (rota === 'mais' || rota === 'hoje') render();
  else {
    const s = $('#sync');
    s.hidden = !drive.ligado();
    s.dataset.estado = ui.sync;
  }
}

// ---------------------------------------------------------------- ações

const ACOES = {
  'pt-criar': () => { ui.modoPT = 'criar'; ir('pt'); },
  'pt-organizar': () => {
    ui.modoPT = 'conversa';
    ui.pedidoPT = 'Reorganiza o plano ativo usando os campos próprios do formato (aquecimento, progressao, execucao, dicas, cadencia, rir, grupo, unilateral, resistencia, maisFacil, maisDificil), tirando essa informação das notas. Não alteres exercícios, séries, repetições, cargas nem descansos. Envia o plano completo no bloco treina.';
    ir('pt');
  },
  'pt-modo': (el) => { ui.modoPT = el.dataset.modo; render(); },
  'pt-partilhar': () => partilharComClaude(),
  'pt-abrir': () => {
    const url = linkClaude(mensagemPT());
    if (url) window.open(url, '_blank', 'noopener');
  },
  'pt-copiar': async () => { if (await copiar(mensagemPT())) toast('Mensagem copiada. Cola-a numa conversa nova no Claude.'); },
  'pt-pedir-correcao': async () => {
    const t = `A app Treina não conseguiu aplicar a tua resposta por estes motivos:\n${ui.errosResposta.map((e) => `- ${e}`).join('\n')}\n\nCorrige e envia de novo o bloco \`\`\`treina com o plano completo em JSON válido.`;
    if (await copiar(t)) toast('Pedido copiado. Cola-o na conversa com o PT.');
  },
  'colar-resposta': async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) { toast('A área de transferência está vazia.'); return; }
      processarResposta(t);
    } catch {
      toast('Não consegui ler a área de transferência. Cola a resposta no campo abaixo.');
      $('[data-ui="resposta"]')?.focus();
    }
  },
  'ler-resposta': () => processarResposta($('[data-ui="resposta"]').value),
  'aprovar-proposta': () => {
    const novo = !estado.plano;
    mudar((e) => aplicarProposta(e));
    toast(novo ? 'Plano aprovado. Bons treinos! 💪' : 'Alterações aplicadas.');
    ir(novo ? 'hoje' : 'plano');
  },
  'rever-proposta': () => { ui.modoPT = 'rever'; ir('pt'); },
  'descartar-proposta': () => {
    if (!confirm('Descartar esta proposta do PT?')) return;
    mudar((e) => descartarProposta(e));
    ir('hoje');
  },
  desfazer: (el) => {
    if (!confirm('Desfazer esta decisão e repor o plano anterior?')) return;
    mudar((e) => desfazerDecisao(e, el.dataset.id));
    toast('Decisão desfeita.');
  },
  'comecar-treino': (el) => {
    const i = Number(el.dataset.dia);
    mudar((e) => ({ ...e, sessaoAtual: novaSessao(e.plano, i) }), { desenhar: false, sync: false });
    ir('treino');
  },
  esforco: (el) => {
    const i = Number(el.dataset.ex); const j = Number(el.dataset.serie); const v = el.dataset.valor;
    const ex = estado.sessaoAtual.exercicios[i];
    const s = ex.series[j];
    if (s.feita && s.esforco === v) {
      s.feita = false; s.esforco = null;
    } else {
      const eraFeita = s.feita;
      s.feita = true; s.esforco = v;
      if (ex.alvo.repsMin != null && s.reps == null) s.reps = v === 'falhei' ? null : ex.alvo.repsMax;
      if (ex.alvo.repsMin == null && s.tempo == null) s.tempo = ex.alvo.tempo ?? null;
      const exs = estado.sessaoAtual.exercicios;
      const ultima = i === exs.length - 1 && j === ex.series.length - 1;
      const seguinte = exs[i + 1];
      const emGrupo = ex.alvo.grupo && seguinte?.alvo.grupo && seguinte.alvo.grupo === ex.alvo.grupo;
      if (!eraFeita && emGrupo) toast(`${ex.alvo.grupo}: passa já para ${seguinte.nome}`);
      else if (!eraFeita && !ultima) iniciarTimer(ex.alvo.descanso ?? 90, ex.alvo.grupo || ex.nome);
    }
    mudar((e) => e, { sync: false });
  },
  'add-serie': (el) => {
    const ex = estado.sessaoAtual.exercicios[Number(el.dataset.ex)];
    const ult = ex.series[ex.series.length - 1];
    ex.series.push({ ...novaSerie(ex.alvo), carga: ult?.carga ?? ex.alvo.carga ?? null });
    mudar((e) => e, { sync: false });
  },
  'rem-serie': (el) => {
    const ex = estado.sessaoAtual.exercicios[Number(el.dataset.ex)];
    if (ex.series.length > 1) ex.series.pop();
    mudar((e) => e, { sync: false });
  },
  'terminar-treino': () => {
    const n = seriesFeitas(estado.sessaoAtual);
    if (!n && !confirm('Não registaste nenhuma série. Terminar mesmo assim?')) return;
    const id = estado.sessaoAtual.id;
    pararTimer();
    pararCadencia();
    mudar((e) => terminarSessao(e), { desenhar: false });
    toast('Treino guardado. 💪');
    ir(`sessao/${encodeURIComponent(id)}`);
  },
  'cancelar-treino': () => {
    if (!confirm('Cancelar este treino? O que registaste nele perde-se.')) return;
    pararTimer();
    mudar((e) => ({ ...e, sessaoAtual: null }), { desenhar: false, sync: false });
    ir('hoje');
  },
  'timer-mais': () => { if (timer) { timer.fim += 15000; timer.total += 15; timer.avisado = false; desenharTimer(); } },
  'timer-saltar': () => pararTimer(),
  cadencia: (el) => iniciarCadencia(Number(el.dataset.ex)),
  'cadencia-parar': () => pararCadencia(),
  'som-testar': async () => { await som.preparar(); som.testar(); },
  'contar-pt': (el) => {
    const s = estado.sessoes.find((x) => x.id === el.dataset.id);
    ui.modoPT = 'conversa';
    ui.incluirHist = true;
    ui.pedidoPT = `Acabei o treino "${s.diaNome}" de ${fmtData(s.data, { semana: true })} (está no histórico acima). Analisa como correu e diz-me se devo ajustar alguma coisa no plano.`;
    ir('pt');
  },
  'apagar-sessao': (el) => {
    if (!confirm('Apagar este treino do histórico?')) return;
    mudar((e) => apagarItem(e, 'sessoes', el.dataset.id), { desenhar: false });
    ir('progresso');
  },
  'apagar-peso': (el) => {
    mudar((e) => apagarItem(e, 'pesos', el.dataset.id));
  },
  'drive-ligar': () => sincronizar({ interativo: true }),
  'drive-sync': () => sincronizar({ interativo: true }),
  'drive-sair': () => {
    if (!confirm('Desligar o Google Drive neste dispositivo? Os dados ficam no telemóvel e no Drive.')) return;
    drive.sair();
    ui.sync = 'parado';
    render();
  },
  exportar: () => {
    const blob = new Blob([JSON.stringify(paraSincronizar(estado), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `treina-${hojeIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  instalar: async () => {
    if (!ui.instalar) return;
    ui.instalar.prompt();
    await ui.instalar.userChoice;
    ui.instalar = null;
    render();
  },
  'apagar-tudo': async () => {
    if (!confirm('Apagar todos os dados da Treina neste dispositivo?')) return;
    if (!confirm('Tens a certeza? Esta ação não se pode desfazer.')) return;
    await db.apagarTudo();
    estado = estadoInicial();
    render();
    toast('Dados apagados.');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-acao]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = ACOES[el.dataset.acao];
  if (!fn) return;
  ev.preventDefault();
  Promise.resolve(fn(el, ev)).catch((e) => toast(e.message));
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.ui === 'pedidoPT') {
    ui.pedidoPT = el.value;
    const pre = $('#previa-pt');
    if (pre) pre.textContent = mensagemPT();
    const abrir = $('[data-acao="pt-abrir"]');
    if (abrir) abrir.disabled = !linkClaude(mensagemPT());
    return;
  }
  if (el.dataset.ui === 'resposta') { ui.resposta = el.value; return; }
  if (el.dataset.ui === 'volume') {
    const { volume } = som.gravarPreferencias({ volume: el.value });
    document.querySelectorAll('[data-ui="volume"]').forEach((x) => { if (x !== el) x.value = volume; });
    const v = $('#vol-valor');
    if (v) v.textContent = `${volume}%`;
    return;
  }
  if (el.dataset.ui === 'preparacao') {
    const n = lerNumero(el.value);
    if (n != null) som.gravarPreferencias({ preparacao: n });
    return;
  }
  const campo = el.dataset.campo;
  const s = estado.sessaoAtual;
  if (!campo || !s) return;
  if (campo === 'notas-sessao') s.notas = el.value;
  else if (campo === 'nota') s.exercicios[Number(el.dataset.ex)].nota = el.value;
  else {
    const serie = s.exercicios[Number(el.dataset.ex)].series[Number(el.dataset.serie)];
    if (campo === 'reps') { const n = lerNumero(el.value); serie.reps = n == null ? null : Math.round(n); }
    if (campo === 'carga') serie.carga = lerNumero(el.value);
    if (campo === 'tempo') serie.tempo = lerTempo(el.value);
  }
  estado.atualizadoEm = Date.now();
  persistir(400);
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.dataset.ui === 'incluirHist') { ui.incluirHist = el.checked; render(); return; }
  if (el.dataset.ui === 'exercicio') { ui.exercicio = el.value; render(); return; }
  if (el.dataset.acaoFicheiro === 'importar' && el.files?.[0]) {
    try {
      const dados = JSON.parse(await el.files[0].text());
      if (!dados || typeof dados !== 'object' || !('versao' in dados)) throw new Error('O ficheiro não é uma cópia de segurança da Treina.');
      mudar((e) => fundir(e, normalizarEstado(dados)));
      toast('Cópia de segurança importada.');
    } catch (e) {
      toast(e.message.startsWith('O ficheiro') ? e.message : 'Não consegui ler o ficheiro.');
    }
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  const fd = new FormData(form);
  if (form.dataset.form === 'peso') {
    const kg = lerNumero(fd.get('kg'));
    if (kg == null || kg < 30 || kg > 300) { toast('Indica um peso válido (em kg).'); return; }
    const data = fd.get('data') || hojeIso();
    mudar((e) => registarPeso(e, data, Math.round(kg * 10) / 10));
    toast('Peso registado.');
    return;
  }
  if (form.dataset.form === 'objetivos') {
    const raw = {};
    for (const k of ['objetivo', 'meta', 'dataAlvo', 'sexo', 'idade', 'altura', 'pesoAtual', 'pesoAlvo', 'diasSemana', 'duracao', 'local', 'experiencia', 'notas']) {
      const v = fd.get(k);
      raw[k] = v == null ? null : String(v).trim();
    }
    raw.material = fd.getAll('material');
    raw.limitacoes = fd.getAll('limitacoes');
    const { perfil, erros } = validarPerfil(raw, { parcial: false });
    if (erros.length) {
      $('#erros-objetivos').innerHTML = `<div class="erro"><ul>${erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
      $('#erros-objetivos').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const primeiro = !estado.perfil;
    mudar((e) => {
      let n = guardarPerfil(e, { ...(e.perfil || {}), ...perfil });
      if (perfil.pesoAtual && !e.pesos.some((x) => x.data === hojeIso())) n = registarPeso(n, hojeIso(), perfil.pesoAtual);
      return n;
    }, { desenhar: false });
    if (primeiro || !estado.plano) {
      ui.modoPT = estado.proposta ? 'rever' : 'criar';
      toast('Objetivos guardados. Agora envia-os ao PT.');
      ir('pt');
    } else {
      toast('Objetivos guardados. Fala com o PT para ajustar o plano.');
      ir('hoje');
    }
  }
});

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.instalar = e; if (rotaAtual()[0] === 'mais') render(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (rotaAtual()[0] === 'treino' && estado.sessaoAtual) pedirEcraLigado();
    desenharTimer();
  } else if (gravarPendente) {
    db.gravarEstado(estado).catch(() => {});
  }
});

// ---------------------------------------------------------------- arranque

async function iniciar() {
  try {
    estado = normalizarEstado(await db.lerEstado());
  } catch {
    toast('Não foi possível ler os dados guardados neste dispositivo.');
  }
  db.pedirPersistencia();
  if (!receberPartilha()) render();
  if (drive.ligado()) drive.preparar();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

iniciar();
