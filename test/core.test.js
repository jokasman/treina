import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lerNumero, lerTempo, norm, fmtTempo, somarDias, diasEntre } from '../js/core/util.js';
import { validarPerfil, diffPerfil, descreverPerfil } from '../js/core/perfil.js';
import { validarPlano, diffPlanos, fmtAlvo } from '../js/core/plano.js';
import { construirMensagem, lerResposta, encontrarBloco, linkClaude } from '../js/core/pt.js';
import {
  estadoInicial, receberProposta, aplicarProposta, desfazerDecisao, decisaoDesfazivel,
  alteracoesProposta, fundir, registarPeso, apagarItem, terminarSessao, normalizarEstado,
} from '../js/core/estado.js';
import { proximoDia, ultimoDesempenho, novaSessao, resumoSessao, treinosNaSemana, evolucaoExercicio } from '../js/core/treino.js';
import { tendencia, ritmoSemanal, estadoPeso } from '../js/core/peso.js';

const planoBase = () => ({
  nome: 'Força 3x',
  notas: 'Aquecer 10 min.',
  dias: [
    { nome: 'Treino A', foco: 'Corpo inteiro', exercicios: [
      { nome: 'Agachamento', series: 3, repsMin: 5, repsMax: 5, carga: 60, descanso: 180 },
      { nome: 'Supino', series: 3, repsMin: 5, repsMax: 8, carga: 50, descanso: 150 },
    ] },
    { nome: 'Treino B', foco: 'Corpo inteiro', exercicios: [
      { nome: 'Peso morto', series: 1, repsMin: 5, repsMax: 5, carga: 80, descanso: 180 },
      { nome: 'Prancha', series: 3, tempo: 45, carga: null, descanso: 60 },
    ] },
  ],
});

// ---------- util ----------

test('lerNumero aceita vírgula e unidades', () => {
  assert.equal(lerNumero('62,5 kg'), 62.5);
  assert.equal(lerNumero(40), 40);
  assert.equal(lerNumero('abc'), null);
  assert.equal(lerNumero(null), null);
});

test('lerTempo entende vários formatos', () => {
  assert.equal(lerTempo(90), 90);
  assert.equal(lerTempo('90 s'), 90);
  assert.equal(lerTempo('2 min'), 120);
  assert.equal(lerTempo('1:30'), 90);
  assert.equal(lerTempo('1 min 30 s'), 90);
  assert.equal(lerTempo('20 minutos'), 1200);
  assert.equal(lerTempo('x'), null);
});

test('formatação e datas', () => {
  assert.equal(fmtTempo(45), '45 s');
  assert.equal(fmtTempo(90), '1 min 30 s');
  assert.equal(fmtTempo(1200), '20 min');
  assert.equal(norm('  Elevação  Lateral '), 'elevacao lateral');
  assert.equal(somarDias('2026-02-27', 3), '2026-03-02');
  assert.equal(diasEntre('2026-01-01', '2026-01-15'), 14);
});

// ---------- perfil ----------

test('validarPerfil normaliza opções por nome e por chave', () => {
  const { perfil, erros } = validarPerfil({ objetivo: 'Perder gordura', diasSemana: '4', material: ['halteres', 'Banco'], pesoAlvo: '78,5', desconhecido: 1 });
  assert.deepEqual(erros, []);
  assert.equal(perfil.objetivo, 'gordura');
  assert.equal(perfil.diasSemana, 4);
  assert.deepEqual(perfil.material, ['halteres', 'banco']);
  assert.equal(perfil.pesoAlvo, 78.5);
  assert.ok(!('desconhecido' in perfil));
});

test('validarPerfil rejeita valores fora do intervalo e opções desconhecidas', () => {
  const { erros } = validarPerfil({ diasSemana: 9, objetivo: 'voar', dataAlvo: 'amanhã' });
  assert.equal(erros.length, 3);
});

test('validarPerfil completo exige campos essenciais', () => {
  const { erros } = validarPerfil({ objetivo: 'massa' }, { parcial: false });
  assert.equal(erros.length, 2);
});

test('diffPerfil e descreverPerfil', () => {
  const d = diffPerfil({ pesoAlvo: 80, diasSemana: 3 }, { pesoAlvo: 78, diasSemana: 3 });
  assert.equal(d.length, 1);
  assert.match(d[0].texto, /Peso alvo: 80 kg → 78 kg/);
  assert.ok(descreverPerfil({ objetivo: 'forca', limitacoes: ['joelho'] }).includes('Limitações ou lesões: Joelho'));
});

// ---------- plano ----------

test('validarPlano aceita um plano correto', () => {
  const r = validarPlano(planoBase());
  assert.equal(r.ok, true, r.erros.join('\n'));
  assert.equal(r.plano.dias[1].exercicios[1].tempo, 45);
  assert.equal(r.plano.dias[1].exercicios[1].carga, null);
});

test('validarPlano tolera formatos comuns de modelos', () => {
  const r = validarPlano({ dias: [{ nome: 'Dia 1', exercicios: [
    { nome: 'Remada', series: '4', reps: '8-12', carga: '32,5 kg', descanso: '2 min' },
    { nome: 'Flexões', series: 3, reps: 15, carga: 'peso corporal' },
    { nome: 'Bicicleta', series: 1, tempo: '20 min' },
  ] }] });
  assert.equal(r.ok, true, r.erros.join('\n'));
  const [remada, flexoes, bici] = r.plano.dias[0].exercicios;
  assert.deepEqual([remada.series, remada.repsMin, remada.repsMax, remada.carga, remada.descanso], [4, 8, 12, 32.5, 120]);
  assert.equal(flexoes.carga, null);
  assert.equal(flexoes.repsMin, 15);
  assert.equal(bici.tempo, 1200);
  assert.equal(r.plano.nome, 'Plano de treino');
});

test('validarPlano deteta erros', () => {
  const r = validarPlano({ dias: [
    { nome: 'A', exercicios: [
      { nome: 'Supino', series: 0, repsMin: 12, repsMax: 8, carga: 'muito' },
      { series: 3, repsMin: 8 },
      { nome: 'Remo', series: 3 },
    ] },
    { nome: 'a', exercicios: [] },
  ] });
  assert.equal(r.ok, false);
  const t = r.erros.join('\n');
  assert.match(t, /séries fora do intervalo/);
  assert.match(t, /mínimas maiores/);
  assert.match(t, /carga inválida/);
  assert.match(t, /falta o nome/);
  assert.match(t, /faltam as repetições ou o tempo/);
  assert.match(t, /dois dias com o nome/);
  assert.match(t, /não tem exercícios/);
  assert.equal(validarPlano(null).ok, false);
  assert.equal(validarPlano({}).ok, false);
});

test('diffPlanos descreve o que muda', () => {
  const a = validarPlano(planoBase()).plano;
  const b = structuredClone(a);
  b.dias[0].exercicios[1].carga = 52.5;
  b.dias[0].exercicios.push({ nome: 'Remada', series: 3, repsMin: 8, repsMax: 10, carga: 40, descanso: 90, notas: '' });
  b.dias[1].exercicios.splice(1, 1);
  b.dias.push({ nome: 'Treino C', foco: '', exercicios: [{ nome: 'Corrida', series: 1, tempo: 1200, carga: null, descanso: null, notas: '' }] });
  const d = diffPlanos(a, b).map((x) => `${x.tipo}: ${x.texto}`);
  assert.ok(d.some((t) => t.includes('Supino: carga 50 kg → 52,5 kg')), d.join('\n'));
  assert.ok(d.some((t) => t.startsWith('adicionado: Treino A · Remada')), d.join('\n'));
  assert.ok(d.some((t) => t === 'removido: Treino B · Prancha'), d.join('\n'));
  assert.ok(d.some((t) => t.startsWith('adicionado: Novo dia: Treino C')), d.join('\n'));
  assert.deepEqual(diffPlanos(a, structuredClone(a)), []);
  assert.equal(diffPlanos(null, a)[0].tipo, 'novo');
});

test('fmtAlvo', () => {
  const p = validarPlano(planoBase()).plano;
  assert.equal(fmtAlvo(p.dias[0].exercicios[1]), '3 × 5–8 · 50 kg');
  assert.equal(fmtAlvo(p.dias[1].exercicios[1]), '3 × 45 s');
});

// ---------- PT: mensagem ----------

test('construirMensagem inclui instruções, perfil, plano, histórico e pedido', () => {
  let e = estadoInicial();
  e.perfil = { objetivo: 'forca', diasSemana: 3, experiencia: 'iniciante', notas: 'Treino de manhã' };
  e.plano = validarPlano(planoBase()).plano;
  e.sessoaAtual = null;
  e.sessaoAtual = novaSessao(e.plano, 0, new Date(2026, 10, 10, 8));
  e.sessaoAtual.exercicios[0].series[0] = { reps: 5, carga: 60, esforco: 'dificil', feita: true };
  e = terminarSessao(e, Date.UTC(2026, 10, 10, 9));
  e = registarPeso(e, '2026-11-10', 82.4);
  const m = construirMensagem({ modo: 'conversa', estado: e, pedido: 'Posso trocar o supino?', hoje: '2026-11-13' });
  assert.match(m, /especialista em treino de força/);
  assert.match(m, /```treina/);
  assert.match(m, /Objetivo: Ganhar força/);
  assert.match(m, /Notas: Treino de manhã/);
  assert.match(m, /## Plano ativo/);
  assert.match(m, /Agachamento: 60 kg × 5 \(difícil\)/);
  assert.match(m, /82,4 kg/);
  assert.match(m, /Posso trocar o supino\?$/);

  const semHist = construirMensagem({ modo: 'conversa', estado: e, incluirHistorico: false, hoje: '2026-11-13' });
  assert.doesNotMatch(semHist, /Últimos treinos/);
});

test('construirMensagem em modo criar sem plano e em modo rever', () => {
  const e = estadoInicial();
  e.perfil = { objetivo: 'massa', diasSemana: 4 };
  assert.match(construirMensagem({ modo: 'criar', estado: e }), /Cria o meu plano de treino inicial/);
  const r = receberProposta(e, { resumo: 'x', plano: validarPlano(planoBase()).plano });
  const m = construirMensagem({ modo: 'rever', estado: r, pedido: 'Menos dias' });
  assert.match(m, /Proposta de plano em discussão/);
  assert.match(m, /Menos dias$/);
});

test('linkClaude devolve null quando o texto é demasiado longo', () => {
  assert.match(linkClaude('olá'), /^https:\/\/claude\.ai\/new\?q=ol%C3%A1$/);
  assert.equal(linkClaude('x'.repeat(10000)), null);
});

// ---------- PT: resposta ----------

const resposta = (bloco, marca = 'treina') => `Aqui está o teu plano.\n\nExplicação...\n\n\`\`\`${marca}\n${bloco}\n\`\`\`\n\nBons treinos!`;

test('lerResposta lê o bloco treina', () => {
  const r = lerResposta(resposta(JSON.stringify({ resumo: 'Plano inicial', plano: planoBase() }, null, 2)));
  assert.equal(r.ok, true, (r.erros || []).join('\n'));
  assert.equal(r.resumo, 'Plano inicial');
  assert.equal(r.plano.dias.length, 2);
  assert.equal(r.perfil, null);
});

test('lerResposta aceita bloco json, comentários e vírgulas finais', () => {
  const bloco = `{
    // comentário
    "resumo": "Mais carga",
    "plano": ${JSON.stringify(planoBase())},
    "perfil": { "pesoAlvo": 78, },
  }`;
  const r = lerResposta(resposta(bloco, 'json'));
  assert.equal(r.ok, true, (r.erros || []).join('\n'));
  assert.equal(r.perfil.pesoAlvo, 78);
});

test('lerResposta encontra JSON sem bloco de código (texto copiado sem formatação)', () => {
  const r = lerResposta(`Combinado!\n${JSON.stringify({ resumo: 'só perfil', perfil: { diasSemana: 4 } })}\nAté já`);
  assert.equal(r.ok, true, (r.erros || []).join('\n'));
  assert.deepEqual(r.perfil, { diasSemana: 4 });
  assert.equal(r.plano, null);
});

test('lerResposta usa o último bloco treina quando há vários', () => {
  const p2 = planoBase();
  p2.nome = 'Versão 2';
  const t = resposta(JSON.stringify({ plano: planoBase() })) + resposta(JSON.stringify({ plano: p2 }));
  assert.equal(lerResposta(t).plano.nome, 'Versão 2');
});

test('lerResposta aceita um plano sem envelope', () => {
  const r = lerResposta(resposta(JSON.stringify(planoBase()), 'json'));
  assert.equal(r.ok, true);
  assert.equal(r.plano.nome, 'Força 3x');
});

test('lerResposta explica os problemas', () => {
  assert.match(lerResposta('').erros[0], /vazia/);
  assert.match(lerResposta('https://claude.ai/share/abc').erros[0], /só um link/);
  assert.match(lerResposta('Bom treino! Sem alterações.').erros[0], /Não encontrei/);
  const mau = lerResposta(resposta(JSON.stringify({ plano: { dias: [{ nome: 'A', exercicios: [{ nome: 'X', series: 50, repsMin: 5 }] }] } })));
  assert.equal(mau.ok, false);
  assert.match(mau.erros[0], /séries fora do intervalo/);
  assert.equal(encontrarBloco('```js\nconst a = 1;\n```'), null);
});

// ---------- estado ----------

test('aplicar proposta grava plano e perfil e regista a decisão; desfazer repõe', () => {
  let e = estadoInicial();
  e.perfil = { objetivo: 'gordura', pesoAlvo: 80, diasSemana: 3 };
  const p1 = validarPlano(planoBase()).plano;
  e = receberProposta(e, { resumo: 'Plano inicial', plano: p1 }, 1000);
  assert.equal(alteracoesProposta(e)[0].tipo, 'novo');
  e = aplicarProposta(e, 2000);
  assert.equal(e.proposta, null);
  assert.equal(e.plano.nome, 'Força 3x');
  assert.equal(e.decisoes.length, 1);

  const p2 = structuredClone(p1);
  p2.dias[0].exercicios[0].carga = 65;
  e = receberProposta(e, { resumo: 'Subir agachamento', plano: p2, perfil: { pesoAlvo: 78 } }, 3000);
  const alt = alteracoesProposta(e).map((a) => a.texto);
  assert.ok(alt.some((t) => /Peso alvo: 80 kg → 78 kg/.test(t)));
  assert.ok(alt.some((t) => /Agachamento: carga 60 kg → 65 kg/.test(t)));
  e = aplicarProposta(e, 4000);
  assert.equal(e.plano.dias[0].exercicios[0].carga, 65);
  assert.equal(e.perfil.pesoAlvo, 78);
  assert.equal(e.perfil.objetivo, 'gordura');
  assert.equal(e.decisoes.at(-1).alteracoes.length, 2);

  const d = decisaoDesfazivel(e);
  e = desfazerDecisao(e, d.id, 5000);
  assert.equal(e.plano.dias[0].exercicios[0].carga, 60);
  assert.equal(e.perfil.pesoAlvo, 80);
  assert.equal(decisaoDesfazivel(e), null);
  assert.equal(e.decisoes.at(-1).origem, 'desfazer');
});

test('fundir junta listas, respeita apagados e escolhe o plano mais recente', () => {
  let a = estadoInicial();
  let b = estadoInicial();
  a.plano = { nome: 'antigo', dias: [] }; a.planoEm = 10;
  b.plano = { nome: 'novo', dias: [] }; b.planoEm = 20;
  a.sessoes = [{ id: 's1', data: '2026-11-01', exercicios: [] }, { id: 's2', data: '2026-11-03', exercicios: [] }];
  b.sessoes = [{ id: 's1', data: '2026-11-01', exercicios: [] }, { id: 's3', data: '2026-11-02', exercicios: [] }];
  a = apagarItem(a, 'sessoes', 's2', 30);
  b.sessoes.push({ id: 's2', data: '2026-11-03', exercicios: [] });
  a = registarPeso(a, '2026-11-01', 80, 100);
  b = registarPeso(b, '2026-11-01', 79.5, 200);
  a.sessaoAtual = { id: 'em-curso' };
  const f = fundir(a, b);
  assert.equal(f.plano.nome, 'novo');
  assert.deepEqual(f.sessoes.map((s) => s.id), ['s1', 's3']);
  assert.equal(f.pesos.length, 1);
  assert.equal(f.pesos[0].kg, 79.5);
  assert.equal(f.sessaoAtual.id, 'em-curso');
  assert.deepEqual(fundir(a, null), a);
  assert.equal(normalizarEstado(null).versao, 1);
});

// ---------- treino ----------

test('próximo dia roda pelos dias do plano', () => {
  const p = validarPlano(planoBase()).plano;
  assert.equal(proximoDia(p, []), 0);
  assert.equal(proximoDia(p, [{ id: '1', data: '2026-11-01', diaNome: 'Treino A', exercicios: [] }]), 1);
  assert.equal(proximoDia(p, [
    { id: '1', data: '2026-11-01', diaNome: 'Treino A', exercicios: [] },
    { id: '2', data: '2026-11-03', diaNome: 'Treino B', exercicios: [] },
  ]), 0);
});

test('novaSessao, último desempenho, resumo e evolução', () => {
  const p = validarPlano(planoBase()).plano;
  const s = novaSessao(p, 0, new Date(2026, 10, 12));
  assert.equal(s.exercicios[0].series.length, 3);
  assert.equal(s.exercicios[0].series[0].carga, 60);
  s.exercicios[0].series[0] = { reps: 5, carga: 60, esforco: 'bom', feita: true };
  s.exercicios[0].series[1] = { reps: 5, carga: 62.5, esforco: 'dificil', feita: true };
  s.fim = s.inicio + 45 * 60000;
  const u = ultimoDesempenho('agachamento', [s]);
  assert.equal(u.series.length, 2);
  assert.equal(ultimoDesempenho('Supino', [s]), null);
  const r = resumoSessao(s);
  assert.match(r, /Treino A · 45 min/);
  assert.match(r, /Agachamento: 60 kg × 5 \(bom\), 62,5 kg × 5 \(difícil\)/);
  assert.match(r, /Supino: não feito/);
  assert.deepEqual(evolucaoExercicio('Agachamento', [s]), [{ data: '2026-11-12', carga: 62.5, reps: 5 }]);
  assert.equal(treinosNaSemana([s], '2026-11-13'), 1);
  assert.equal(treinosNaSemana([s], '2026-11-17'), 0);
});

// ---------- peso ----------

test('tendência, ritmo e estado da meta de peso', () => {
  const pesos = [];
  for (let i = 0; i < 21; i++) pesos.push({ data: somarDias('2026-10-01', i), kg: 90 - i * 0.1 });
  const t = tendencia(pesos);
  assert.equal(t[0].media, 90);
  const ritmo = ritmoSemanal(pesos, 28, '2026-10-21');
  assert.ok(Math.abs(ritmo - -0.7) < 0.01, String(ritmo));
  const st = estadoPeso({ pesos, pesoAlvo: 85, dataAlvo: '2027-06-01', hoje: '2026-10-21' });
  assert.equal(st.estado, 'no-ritmo');
  assert.ok(st.previsao < '2027-06-01');
  assert.equal(estadoPeso({ pesos, pesoAlvo: 85, dataAlvo: '2026-11-01', hoje: '2026-10-21' }).estado, 'atrasado');
  assert.equal(estadoPeso({ pesos, pesoAlvo: 95, hoje: '2026-10-21' }).estado, 'sentido-errado');
  assert.equal(estadoPeso({ pesos, pesoAlvo: 89, hoje: '2026-10-21' }).estado, 'atingido');
  assert.equal(estadoPeso({ pesos: [], pesoAlvo: 80 }).estado, 'sem-dados');
  assert.equal(estadoPeso({ pesos: pesos.slice(0, 2), pesoAlvo: 80, hoje: '2026-10-02' }).estado, 'a-calcular');
});
