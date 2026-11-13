# Treina

App web (PWA) de treino em que o **personal trainer é um agente de IA** (o Claude). O PT define e ajusta o plano; a app guarda o plano em tabelas fixas, regista os treinos sem IA e mostra o progresso. Os dados ficam no telemóvel e, opcionalmente, numa pasta privada da app no Google Drive.

Endereço: **https://jokasman.github.io/treina**

## Como funciona

1. **Objetivos**: escolhes o objetivo, a meta, a disponibilidade, o local, o material, a experiência e as limitações, e escreves notas livres para o resto.
2. **Plano pelo PT**: a app prepara uma mensagem com o perfil, o plano, o histórico e o pedido. Partilhas para o Claude (menu de partilha do Android), abres por link ou copias.
3. **Resposta do PT**: no Claude, partilhas a resposta para a **Treina** (a app aparece no menu de partilha quando instalada) ou copias e tocas em **Colar resposta**.
4. **Revisão**: a app valida o bloco de dados do PT, mostra exatamente o que muda e só grava quando aprovas. Podes pedir alterações por texto até gostares do plano.
5. **Treino**: ecrã próprio, sem IA. Registas as repetições e a carga e tocas no emoji do esforço; a série fica registada e o descanso arranca.
6. **Decisões**: cada alteração aprovada fica no histórico de decisões do PT e pode ser desfeita.

### Formato da resposta do PT

O PT termina as respostas que mudam alguma coisa com um bloco ` ```treina ` com JSON:

```json
{
  "resumo": "Subida de carga no supino",
  "plano": {
    "nome": "Recomposição 4x",
    "notas": "Indicações gerais",
    "dias": [
      { "nome": "Superior A", "foco": "Peito e costas", "exercicios": [
        { "nome": "Supino com halteres", "series": 3, "repsMin": 8, "repsMax": 12, "carga": 24, "descanso": 90, "notas": "" },
        { "nome": "Prancha", "series": 3, "tempo": 40, "carga": null, "descanso": 45 }
      ] }
    ]
  },
  "perfil": { "pesoAlvo": 79 }
}
```

`plano` é sempre o plano completo; `perfil` só traz os campos que mudam. A app valida limites (séries, repetições, cargas, tempos), nomes repetidos e campos em falta antes de mostrar a proposta.

## Estrutura

```
index.html, manifest.webmanifest, sw.js   PWA (instalável, offline, destino de partilha)
css/app.css                              estilos (tema claro/escuro)
js/app.js                                ecrãs e interação
js/db.js                                 IndexedDB
js/drive.js                              login Google e Google Drive (appDataFolder)
js/config.js                             ID do cliente OAuth e constantes
js/core/                                 lógica pura e testada
  perfil.js   objetivos e validação do perfil
  plano.js    validação do plano e diferenças entre versões
  pt.js       mensagem para o PT e leitura da resposta
  estado.js   propostas, decisões, desfazer, fusão com o Drive
  treino.js   sessões, próximo dia, histórico
  peso.js     média de 7 dias, ritmo e previsão
test/                                    testes (node --test)
```

Sem dependências nem passo de build.

## Desenvolvimento

```sh
npm test           # testes da lógica
npm run serve      # http://localhost:8080
```

## Publicação

O workflow `.github/workflows/pages.yml` corre os testes e publica no GitHub Pages a cada push para `main`. Em **Settings → Pages**, a origem tem de ser **GitHub Actions**.

## Google Drive

Projeto Google Cloud **Treina**, com a Google Drive API ativa e um cliente OAuth do tipo "Aplicação Web" com as origens `https://jokasman.github.io` e `http://localhost:8080`. A app pede só o âmbito `drive.appdata`: vê apenas a sua própria pasta privada no Drive, não os outros ficheiros.
