import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCadencia, sequenciaCadencia, eventoAtual, duracaoRepeticao, eventosPreparacao, eventosRepeticao, EXPLOSIVA } from '../js/core/cadencia.js';

test('lerCadencia aceita os formatos comuns', () => {
  assert.deepEqual(lerCadencia('2-0-1-1'), [
    { fase: 'desce', s: 2, explosiva: false },
    { fase: 'sobe', s: 1, explosiva: false },
    { fase: 'pausa-cima', s: 1, explosiva: false },
  ]);
  assert.deepEqual(lerCadencia('3-1-X-0').map((f) => [f.fase, f.s, f.explosiva]), [['desce', 3, false], ['pausa-baixo', 1, false], ['sobe', EXPLOSIVA, true]]);
  assert.equal(lerCadencia('2:0:1').length, 2);
  assert.equal(lerCadencia('4 0 2 0').length, 2);
  assert.equal(lerCadencia('2–0–1–0').length, 2);
  assert.equal(duracaoRepeticao(lerCadencia('3-1-2-0')), 6);
});

test('lerCadencia rejeita o que não é cadência', () => {
  for (const t of [null, '', 'lenta', '2-1', '1-2-3-4-5', '2-a-1-1', '0-0-0-0', '20-0-1-0']) assert.equal(lerCadencia(t), null, String(t));
});

test('sequência: preparação, um sinal por segundo e fim', () => {
  const { eventos, duracao } = sequenciaCadencia({ fases: lerCadencia('4-0-2-1'), reps: 2, preparacao: 3 });
  assert.equal(duracao, 3 + 2 * 7);
  const prep = eventos.filter((e) => e.tipo === 'prep');
  assert.deepEqual(prep.map((e) => [e.t, e.resta]), [[0, 3], [1, 2], [2, 1]]);
  // 1.ª repetição: descida de 4 s → sinal em 3, 4, 5, 6
  const descida = eventos.filter((e) => e.rep === 1 && e.fase === 'desce');
  assert.deepEqual(descida.map((e) => [e.t, e.tipo, e.segundo, e.total]), [[3, 'fase', 1, 4], [4, 'segundo', 2, 4], [5, 'segundo', 3, 4], [6, 'segundo', 4, 4]]);
  const subida = eventos.filter((e) => e.rep === 1 && e.fase === 'sobe');
  assert.deepEqual(subida.map((e) => e.t), [7, 8]);
  assert.deepEqual(eventos.filter((e) => e.rep === 1 && e.fase === 'pausa-cima').map((e) => e.t), [9]);
  assert.equal(eventos.filter((e) => e.rep === 2 && e.tipo === 'fase')[0].t, 10);
  assert.deepEqual(eventos.at(-1), { t: 17, tipo: 'fim', rep: 2 });
  // tempos sempre crescentes
  for (let i = 1; i < eventos.length; i++) assert.ok(eventos[i].t >= eventos[i - 1].t);
});

test('sequência sem preparação e com fase explosiva', () => {
  const { eventos, duracao } = sequenciaCadencia({ fases: lerCadencia('2-0-X-0'), reps: 1, preparacao: 0 });
  assert.equal(duracao, 2.5);
  assert.deepEqual(eventos.map((e) => [e.t, e.tipo, e.fase ?? '']), [[0, 'fase', 'desce'], [1, 'segundo', 'desce'], [2, 'fase', 'sobe'], [2.5, 'fim', '']]);
});

test('eventoAtual', () => {
  const { eventos } = sequenciaCadencia({ fases: lerCadencia('2-0-1-0'), reps: 1, preparacao: 2 });
  assert.equal(eventoAtual(eventos, -1), null);
  assert.equal(eventoAtual(eventos, 0.5).tipo, 'prep');
  assert.equal(eventoAtual(eventos, 2.2).fase, 'desce');
  assert.equal(eventoAtual(eventos, 4.1).fase, 'sobe');
  assert.equal(eventoAtual(eventos, 9).tipo, 'fim');
});

test('repetições geradas uma a uma encaixam sem falhas (tocar sem fim)', () => {
  const fases = lerCadencia('3-1-2-0');
  const dur = duracaoRepeticao(fases);
  const prep = eventosPreparacao(5);
  assert.deepEqual(prep.map((e) => e.resta), [5, 4, 3, 2, 1]);
  let t = prep.length;
  const todos = [...prep];
  for (let rep = 1; rep <= 20; rep++) { todos.push(...eventosRepeticao(fases, rep, t)); t += dur; }
  // um sinal por segundo, sem buracos nem repetições
  assert.deepEqual(todos.map((e) => e.t), Array.from({ length: 5 + 20 * 6 }, (_, i) => i));
  assert.equal(todos.at(-1).rep, 20);
  assert.equal(eventoAtual([...todos, { t: 11, tipo: 'alvo', rep: 1 }], 11.2).tipo, 'fase');
});
