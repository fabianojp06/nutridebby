// P08-03 (RNF-01, RNF-02, D4): 100 VUs — 70 pacientes, 25 nutricionistas (20 no roteiro do painel e 5 abrindo fichas,
// Plano 18, CS-263), 5 visitantes da página pública.
// docker run --rm -u "$(id -u):$(id -g)" --network host -v "$PWD/test/carga:/carga" -e BASE_URL=http://127.0.0.1:3200 grafana/k6:2.3.0 run /carga/cenario.js
// Roteiro: docs/operacao/carga.md. As sessões vêm de test/carga/.sessoes.json (seed.ts; fora do git).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3200';
const S = JSON.parse(open('./.sessoes.json'));
const pacientes = new SharedArray('pacientes', () => S.pacientes);
const nutris = new SharedArray('nutris', () => S.nutris);
const slugs = new SharedArray('slugs', () => S.slugs);

// 429 é esperado em alguns envios (MAX_ENVIOS do diário, limite do push): não conta como falha
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

// Toda rota que o cenário chama (tag `nome`: caminho sem query, UUID → `:id`, slug → `:slug`). Rota nova entra aqui;
// a que faltar derruba a iteração (sem linha no resumo, a "pior rota" sairia errada).
const ROTAS = [
  '/p/inicio', '/p/jornada', '/p/plano', '/p/agenda', '/p/conteudos', '/p/conteudos/:id', '/p/diario',
  '/painel', '/painel/agenda', '/painel/pacientes', '/painel/pacientes/:id', '/painel/pacientes/:id/antropometria', '/painel/conteudos',
  '/painel/pacientes/:id/perfil', '/painel/pacientes/:id/app',
  '/n/:slug',
  '/api/p/acesso', '/api/p/push', '/api/painel/planos/:id', '/api/painel/planos/:id/revisao', '/api/painel/alimentos',
  // Plano 26 (CS-483): as seis seções dos Relatórios
  '/painel/relatorios', '/painel/relatorios/atendimentos', '/painel/relatorios/planos', '/painel/relatorios/agenda',
  '/painel/relatorios/financeiro', '/painel/relatorios/ranking',
];
const STATUS_PUSH = [204, 409, 429]; // 204 inscrito; 409 inscrição de outra conta (falha: não deveria acontecer); 429 limite da T6

// Plano 23 (CS-402): a tag própria do Mês com marcadores (a rota é /painel/agenda, que já está em ROTAS sem query)
const MES_COM_MARCADORES = '/painel/agenda (mês com marcadores)';
const rampa = (alvo) => [{ duration: '2m', target: alvo }, { duration: '10m', target: alvo }, { duration: '1m', target: 0 }];
export const options = {
  scenarios: {
    paciente: { executor: 'ramping-vus', exec: 'paciente', stages: rampa(70) },
    nutri: { executor: 'ramping-vus', exec: 'nutri', stages: rampa(20) },
    ficha: { executor: 'ramping-vus', exec: 'ficha', stages: rampa(5) }, // Plano 18 (CS-263): tirados dos 25 da nutricionista
    publico: { executor: 'ramping-vus', exec: 'publico', stages: rampa(5) },
    // Plano 26 (CS-483): 3 nutricionistas abrindo os Relatórios, além dos 100 (a divisão dos 25 da nutricionista é revista
    // na rodada do fechamento do PR 1)
    relatorios: { executor: 'ramping-vus', exec: 'relatorios', stages: rampa(3) },
    // Plano 23 (CS-402): 5 nutricionistas a mais, só no Mês com os marcadores ligados (a rodada passa a 105 VUs)
    mes: { executor: 'ramping-vus', exec: 'mesComMarcadores', stages: rampa(5) },
  },
  thresholds: {
    // O resumo do k6 (tela e --summary-export) só mostra a sub-métrica que tem threshold: `[]` cria a linha sem meta.
    // Uma linha por rota (a "pior rota (p95)" do relatório) e uma por status do push (204/409/429).
    ...Object.fromEntries(ROTAS.map((r) => [`http_req_duration{nome:${r}}`, []])),
    ...Object.fromEntries(STATUS_PUSH.map((s) => [`http_reqs{nome:/api/p/push,status:${s}}`, []])),
    'http_req_duration{tipo:api}': ['p(95)<300'], // RNF-01 (Route Handlers)
    'http_req_duration{tipo:pagina}': ['p(95)<800'], // D4 (páginas)
    'http_req_duration{tipo:pagina,area:p}': ['p(95)<800'], // S-7: p95 só das páginas /p/* (portal do paciente)
    'http_req_duration{nome:/api/p/push}': ['p(95)<300'], // B-8: app_soltar_endpoint_push com 50 tenants (linha própria no resumo)
    // Plano 18 (CS-263, RNF-260): o Início da ficha (as seções do registro, o cabeçalho e o cartão "No app") na meta das
    // páginas; depois do `...ROTAS` acima, que criou a linha sem meta
    'http_req_duration{nome:/painel/pacientes/:id}': ['p(95)<800'],
    // Plano 26 (CS-483, RNF-01): cada seção dos Relatórios abre com p95 ≤ 800 ms (tag `scenario` do próprio k6)
    'http_req_duration{scenario:relatorios}': ['p(95)<800'],
    // Plano 23 (CS-402, RNF-400): o Mês com 300 pacientes, 2.000 consultas no ano e os marcadores ligados (linha própria)
    [`http_req_duration{nome:${MES_COM_MARCADORES}}`]: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

const nome = (url) => {
  const n = url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/^\/n\/[^/]+$/, '/n/:slug');
  if (!ROTAS.includes(n)) throw new Error(`rota fora de ROTAS (cenario.js): ${n}`);
  return n;
};
// area: primeiro segmento do caminho (p = portal do paciente, painel, n = página pública) — o S-7 lê `area:p`
const pagina = (url, cookie) => {
  const r = http.get(`${BASE}${url}`, { headers: { cookie }, redirects: 0, tags: { tipo: 'pagina', area: url.split('/')[1], nome: nome(url) } });
  check(r, { 'página 200 (sessão válida)': (x) => x.status === 200 });
  return r;
};
const api = (metodo, url, cookie, corpo = null) => {
  const headers = corpo === null ? { cookie } : { cookie, 'content-type': 'application/json' };
  const r = http.request(metodo, `${BASE}${url}`, corpo === null ? null : JSON.stringify(corpo), { headers, tags: { tipo: 'api', nome: nome(url) } });
  check(r, { 'api 2xx/429': (x) => (x.status >= 200 && x.status < 300) || x.status === 429 });
  return r;
};
const pausa = () => sleep(1 + Math.random() * 2);

export function paciente() {
  const p = pacientes[(__VU * 7 + __ITER) % pacientes.length];
  api('POST', '/api/p/acesso', p.cookie); // N14: uma "abertura" do app
  api('POST', '/api/p/push?sincronizar=1', p.cookie, p.inscricao); // B-8: a sincronização da abertura (204; 429 = limite da T6)
  // Plano 16 (RNF-190, PM-G11): a Jornada logo depois de Hoje, como o paciente faz (p95 de /p/inicio e /p/jornada no runbook)
  for (const url of ['/p/inicio', '/p/jornada', '/p/plano', '/p/agenda', '/p/conteudos', '/p/conteudos?busca=aveia', '/p/conteudos?etiqueta=sem%20lactose', `/p/conteudos/${p.conteudo}`, '/p/diario']) {
    pagina(url, p.cookie);
    pausa();
  }
}

export function nutri() {
  const n = nutris[(__VU + __ITER) % nutris.length];
  const pid = n.pacientes[__ITER % n.pacientes.length];
  for (const url of ['/painel', '/painel/agenda', '/painel/pacientes', `/painel/pacientes/${pid}`, `/painel/pacientes/${pid}/antropometria`, '/painel/conteudos']) {
    pagina(url, n.cookie);
    pausa();
  }
  if (n.planos.length) {
    const plano = n.planos[__ITER % n.planos.length];
    api('GET', `/api/painel/planos/${plano.id}`, n.cookie);
    api('GET', `/api/painel/planos/${plano.id}/revisao?paciente=${plano.paciente}`, n.cookie); // D7: sem ?paciente=, 404
  }
  api('GET', '/api/painel/alimentos?q=arroz', n.cookie);
  pausa();
}

// Plano 18 (CS-263, RNF-260): "abrir a ficha" — da lista ao Início de um paciente (as seções do registro numa transação,
// o cabeçalho com a última avaliação e o cartão "No app do paciente", contado no contexto do paciente), o Perfil (o
// cadastro complementar da semente, com a leitura auditada) e a visão "No app". Pacientes variados a cada iteração (os
// 50 da sessão da nutricionista, como a semente os deixa: com e sem cadastro, com plano publicado (os 6 primeiros) e com o
// registro clínico das seções — antropometria, gasto energético, anamneses, atendimentos, exames, envios e documentos —,
// 1 em 10 sem nenhum registro; a agenda (`appointments`) não é seção do Início)
export function ficha() {
  const n = nutris[(__VU * 3 + __ITER) % nutris.length];
  const pid = n.pacientes[(__VU * 11 + __ITER * 7) % n.pacientes.length];
  for (const url of ['/painel/pacientes', `/painel/pacientes/${pid}`, `/painel/pacientes/${pid}/perfil`, `/painel/pacientes/${pid}/app`]) {
    pagina(url, n.cookie);
    pausa();
  }
}

export function publico() {
  pagina(`/n/${slugs[__ITER % slugs.length]}`, '');
  pausa();
}

// Plano 26 (CS-483, RN-496): as seis seções dos Relatórios (agregação no SQL, uma transação por seção) sobre os 12 meses
// de agenda e de Financeiro da semente (`semearRelatorios`), no período padrão e num período escolhido; o Ranking pelos
// dois critérios. Só leitura: a tela não grava `audit_log` (RN-493); o CSV e a impressão ficam fora (gravam `exportar`).
export function relatorios() {
  const n = nutris[(__VU * 5 + __ITER) % nutris.length];
  const periodo = __ITER % 2 ? '?de=2026-03&ate=2026-08' : '';
  for (const url of ['/painel/relatorios', '/painel/relatorios/atendimentos', '/painel/relatorios/planos', '/painel/relatorios/agenda', '/painel/relatorios/financeiro', '/painel/relatorios/ranking']) {
    pagina(`${url}${periodo}`, n.cookie);
    pausa();
  }
  pagina(`/painel/relatorios/ranking?por=receita${periodo ? `&${periodo.slice(1)}` : ''}`, n.cookie);
  pausa();
}

// Plano 23 (CS-402, RNF-400): o Mês do mês corrente e do anterior, com "Aniversários" e "Previsões de retorno" na URL (a
// previsão só conta quando a T9 ligar o marcador; até lá, o parâmetro é lido e ignorado). Tag própria, fora de `nome()`.
export function mesComMarcadores() {
  const n = nutris[(__VU * 5 + __ITER) % nutris.length];
  for (const data of ['', `&data=${new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10)}`]) {
    const r = http.get(`${BASE}/painel/agenda?visao=mes&aniversario=1&retorno=1${data}`, { headers: { cookie: n.cookie }, redirects: 0, tags: { tipo: 'pagina', area: 'painel', nome: MES_COM_MARCADORES } });
    check(r, { 'página 200 (sessão válida)': (x) => x.status === 200 });
    pausa();
  }
}

// Fumaça (`--vus 3 --duration 30s` na linha de comando troca os cenários por um só, que roda o `default`): os quatro perfis
export default function fumaca() {
  paciente();
  nutri();
  ficha();
  publico();
  relatorios(); // Plano 26
  mesComMarcadores();
}
