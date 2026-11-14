// Comunicação com o PT (agente de IA): mensagem enviada e leitura da resposta.
import { ESPECIALIDADE, OBJETIVOS, rotulo, descreverPerfil, validarPerfil } from './perfil.js';
import { validarPlano } from './plano.js';
import { ordenarSessoes, resumoSessao } from './treino.js';
import { estadoPeso, tendencia } from './peso.js';
import { hojeIso, fmtNum, fmtData } from './util.js';
import { CLAUDE_NOVA_CONVERSA, LIMITE_LINK } from '../config.js';

export const MARCA_BLOCO = 'treina';

const FORMATO = `{
  "resumo": "Uma frase sobre o que propões ou mudaste",
  "plano": {
    "nome": "Nome do plano",
    "aquecimento": "Como aquecer antes de cada treino",
    "progressao": "Regra para subir cargas ou repetições",
    "notas": "Outras indicações gerais (semanas de descarga, etc.)",
    "dias": [
      {
        "nome": "Treino A",
        "foco": "Corpo inteiro",
        "notas": "Indicações só deste dia (opcional)",
        "exercicios": [
          {
            "nome": "Agachamento goblet",
            "series": 3, "repsMin": 8, "repsMax": 12,
            "carga": 16, "descanso": 90,
            "cadencia": "3-1-1-0", "rir": 2,
            "execucao": "Haltere junto ao peito, pés à largura dos ombros; desce com o tronco direito até as coxas ficarem paralelas ao chão e sobe a empurrar o chão.",
            "dicas": "Joelhos na direção dos pés; calcanhares sempre no chão",
            "maisFacil": "Agachamento para um banco",
            "maisDificil": "Agachamento búlgaro"
          },
          {
            "nome": "Elevação lateral com elástico",
            "series": 3, "repsMin": 12, "repsMax": 15,
            "carga": null, "resistencia": "elástico médio", "unilateral": true,
            "grupo": "Supersérie 1", "descanso": 45
          },
          { "nome": "Flexões", "series": 3, "repsMin": 8, "repsMax": 12, "carga": null, "grupo": "Supersérie 1", "descanso": 45 },
          { "nome": "Prancha", "series": 3, "tempo": 45, "carga": null, "descanso": 60 }
        ]
      }
    ]
  },
  "perfil": { "pesoAlvo": 78 }
}`;

/** JSON do plano sem campos vazios (mensagem mais curta e legível para o PT). */
function planoJson(plano) {
  return JSON.stringify(plano, (k, v) => {
    if (k === 'aprovadoEm') return undefined;
    if (k === 'carga') return v;
    return v === '' || v === false || v === null ? undefined : v;
  }, 2);
}

function instrucoes(perfil) {
  const esp = ESPECIALIDADE[perfil?.objetivo] || 'treino físico';
  return `És o meu personal trainer, especialista em ${esp}. Falo contigo através da app Treina, que guarda o meu plano e registo dos treinos.

Regras:
1. Responde em português de Portugal, de forma clara e prática.
2. Baseia-te só nos dados abaixo. Não inventes treinos, cargas ou pesos que não estejam aqui. Se te faltar informação importante, pergunta antes de decidir.
3. Respeita as minhas limitações. Se eu falar de dor, lesão ou sintomas, recomenda que consulte um profissional de saúde.
4. Sempre que criares ou alterares o plano ou o meu perfil, termina a resposta com UM ÚNICO bloco de código marcado como \`\`\`${MARCA_BLOCO}, com JSON válido (sem comentários) neste formato:

\`\`\`${MARCA_BLOCO}
${FORMATO}
\`\`\`

   - "plano" é sempre o PLANO COMPLETO (todos os dias e exercícios), não só o que muda. Omite "plano" se não o alteraste.
   - "perfil" só tem os campos do perfil que mudam (por exemplo pesoAlvo, dataAlvo, diasSemana, duracao, meta, notas). Omite-o se nada mudou.
   - Usa "repsMin"/"repsMax" para exercícios por repetições ou "tempo" (em segundos) para exercícios por tempo.
   - "carga" em kg (número) ou null. Se a resistência não for em kg (elástico, mochila, máquina sem números…), usa "carga": null e descreve-a em "resistencia".
   - "descanso" em segundos. "cadencia" no formato excêntrica-pausa-concêntrica-pausa (ex.: "3-1-1-0"). "rir" = repetições em reserva (0 a 5).
   - "unilateral": true quando as repetições são por lado (faz-se um lado e depois o outro).
   - "grupo": o mesmo texto em exercícios seguidos feitos em supersérie ou circuito (ex.: "Supersérie 1", "Circuito A"). A app mostra-os juntos.
   - "execucao": como fazer o movimento. "dicas": pontos-chave curtos. "maisFacil" / "maisDificil": variantes para regredir ou progredir.
   - Usa SEMPRE estes campos próprios. "notas" é só para o que não cabe em nenhum deles. No plano, usa "aquecimento" e "progressao" em vez de pôr isso em "notas".
   - Todos os campos, exceto nome, séries e repetições/tempo, são opcionais: omite os que não se aplicam.
   - Mantém os mesmos nomes de dias e exercícios quando não mudam, para eu ver bem as diferenças.
5. Se a tua resposta não mudar o plano nem o perfil, não incluas o bloco.
6. Vou rever as alterações na app antes de as aplicar.`;
}

function blocoPeso(estado, hoje) {
  const pesos = estado.pesos || [];
  if (!pesos.length) return null;
  const t = tendencia(pesos).slice(-10);
  const linhas = t.map((p) => `${p.data}: ${fmtNum(p.kg)} kg (média 7 dias ${fmtNum(p.media)} kg)`);
  const st = estadoPeso({ pesos, pesoAlvo: estado.perfil?.pesoAlvo, dataAlvo: estado.perfil?.dataAlvo, hoje });
  if (st.ritmo != null) linhas.push(`Ritmo das últimas 4 semanas: ${st.ritmo > 0 ? '+' : ''}${fmtNum(st.ritmo)} kg/semana`);
  if (st.ritmoNecessario != null) linhas.push(`Ritmo necessário para a meta: ${st.ritmoNecessario > 0 ? '+' : ''}${fmtNum(st.ritmoNecessario)} kg/semana`);
  if (st.previsao) linhas.push(`Previsão para atingir o peso alvo: ${fmtData(st.previsao, { ano: true })}`);
  return linhas.join('\n');
}

/**
 * Constrói a mensagem para o PT.
 * modo: 'criar' (plano inicial), 'rever' (alterar a proposta em discussão) ou 'conversa'.
 */
export function construirMensagem({ modo, estado, pedido = '', incluirHistorico = true, hoje = hojeIso() }) {
  const p = [];
  p.push(`[Treina · ${fmtData(hoje, { ano: true, semana: true })}]`);
  p.push(instrucoes(estado.perfil));

  p.push('## O meu perfil e objetivos');
  const linhas = descreverPerfil(estado.perfil);
  p.push(linhas.length ? linhas.map((l) => `- ${l}`).join('\n') : '(ainda não preenchido)');

  const plano = modo === 'rever' && estado.proposta ? estado.proposta.plano : estado.plano;
  if (modo === 'rever' && estado.proposta) {
    p.push('## Proposta de plano em discussão (ainda não aprovada)');
    p.push('```json\n' + planoJson(estado.proposta.plano) + '\n```');
    if (estado.plano) p.push('(Tenho também um plano ativo; esta proposta vai substituí-lo quando eu a aprovar.)');
  } else if (plano) {
    p.push('## Plano ativo');
    p.push('```json\n' + planoJson(plano) + '\n```');
  } else {
    p.push('## Plano\nAinda não tenho plano.');
  }

  if (incluirHistorico) {
    const sessoes = ordenarSessoes(estado.sessoes).slice(0, 10);
    if (sessoes.length) {
      p.push(`## Últimos treinos registados (${sessoes.length}, do mais recente para o mais antigo)`);
      p.push(sessoes.map(resumoSessao).join('\n'));
    } else if (estado.plano) {
      p.push('## Treinos registados\nAinda nenhum.');
    }
    const peso = blocoPeso(estado, hoje);
    if (peso) p.push('## Peso corporal (últimos registos)\n' + peso);
    const dec = [...(estado.decisoes || [])].sort((a, b) => b.em - a.em).slice(0, 5);
    if (dec.length) {
      p.push('## Decisões anteriores (mais recentes primeiro)');
      p.push(dec.map((d) => `- ${new Date(d.em).toISOString().slice(0, 10)}: ${d.resumo}`).join('\n'));
    }
  }

  p.push('## O meu pedido');
  const pedidoLimpo = pedido.trim();
  if (modo === 'criar') {
    p.push(pedidoLimpo || 'Cria o meu plano de treino inicial com base no meu perfil e objetivos. Explica as tuas escolhas de forma breve.');
  } else if (modo === 'rever') {
    p.push(pedidoLimpo || 'Quero ajustar esta proposta. Pergunta-me o que preciso de mudar.');
  } else {
    p.push(pedidoLimpo || '(Escrevo a seguir.)');
  }
  return p.join('\n\n');
}

/** Link que abre uma conversa nova no Claude com o texto preenchido, ou null se for demasiado longo. */
export function linkClaude(texto) {
  const url = `${CLAUDE_NOVA_CONVERSA}?q=${encodeURIComponent(texto)}`;
  return url.length <= LIMITE_LINK ? url : null;
}

function semComentarios(json) {
  // Remove comentários // e /* */ fora de strings e vírgulas finais — erros comuns de modelos.
  let out = '';
  let emString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (emString) {
      out += c;
      if (c === '\\') { out += json[++i] ?? ''; continue; }
      if (c === '"') emString = false;
      continue;
    }
    if (c === '"') { emString = true; out += c; continue; }
    if (c === '/' && json[i + 1] === '/') { while (i < json.length && json[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && json[i + 1] === '*') { i = json.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function tentarJson(s) {
  for (const txt of [s, semComentarios(s)]) {
    try {
      const v = JSON.parse(txt);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch { /* tenta a seguir */ }
  }
  return null;
}

/** Objetos JSON de topo encontrados no texto (procura por chavetas equilibradas). */
function objetosSoltos(texto) {
  const out = [];
  for (let i = texto.indexOf('{'); i >= 0; i = texto.indexOf('{', i + 1)) {
    let nivel = 0;
    let emString = false;
    for (let j = i; j < texto.length; j++) {
      const c = texto[j];
      if (emString) {
        if (c === '\\') j++;
        else if (c === '"') emString = false;
        continue;
      }
      if (c === '"') emString = true;
      else if (c === '{') nivel++;
      else if (c === '}' && --nivel === 0) {
        const obj = tentarJson(texto.slice(i, j + 1));
        if (obj) { out.push(obj); i = j; }
        break;
      }
    }
  }
  return out;
}

const relevante = (o) => o && (o.plano || o.perfil || (Array.isArray(o.dias) && o.dias.length));

/** Encontra o bloco de dados na resposta do PT. Devolve o objeto ou null. */
export function encontrarBloco(texto) {
  const blocos = [...String(texto).matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const marcados = blocos.filter((m) => m[1].toLowerCase() === MARCA_BLOCO);
  const candidatos = [...marcados.reverse(), ...blocos.filter((m) => m[1].toLowerCase() !== MARCA_BLOCO).reverse()];
  for (const m of candidatos) {
    const obj = tentarJson(m[2].trim());
    if (relevante(obj)) return obj;
  }
  const soltos = objetosSoltos(String(texto)).filter(relevante);
  return soltos.length ? soltos[soltos.length - 1] : null;
}

/**
 * Lê a resposta do PT.
 * Devolve { ok, erros, resumo, plano, perfil } — plano/perfil já validados, ou um erro explicado.
 */
export function lerResposta(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { ok: false, erros: ['A resposta está vazia.'] };
  if (/^https?:\/\/\S+$/.test(t)) {
    return { ok: false, erros: ['Recebi só um link, não o texto da resposta. No Claude, copia a resposta do PT e usa "Colar resposta".'] };
  }
  let obj = encontrarBloco(t);
  if (!obj) {
    return { ok: false, erros: ['Não encontrei alterações ao plano nesta resposta. Se o PT mudou alguma coisa, pede-lhe: "Envia o bloco treina com o plano completo."'] };
  }
  if (!obj.plano && Array.isArray(obj.dias)) obj = { plano: obj };

  const erros = [];
  let plano = null;
  let perfil = null;
  if (obj.plano) {
    const r = validarPlano(obj.plano);
    if (r.ok) plano = r.plano;
    else erros.push(...r.erros);
  }
  if (obj.perfil) {
    const r = validarPerfil(obj.perfil);
    if (r.erros.length) erros.push(...r.erros.map((e) => `Perfil · ${e}`));
    else if (Object.keys(r.perfil).length) perfil = r.perfil;
  }
  if (erros.length) return { ok: false, erros };
  if (!plano && !perfil) return { ok: false, erros: ['O bloco do PT não tem plano nem alterações ao perfil.'] };
  return { ok: true, erros: [], resumo: String(obj.resumo || '').slice(0, 500), plano, perfil };
}

export function nomeObjetivo(perfil) {
  return perfil?.objetivo ? rotulo(OBJETIVOS, perfil.objetivo) : '';
}
