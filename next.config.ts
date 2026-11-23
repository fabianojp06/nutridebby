import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';
import { CABECALHOS_SEGURANCA } from './src/lib/csp';

const nextConfig: NextConfig = {
  // pg-boss é biblioteca de servidor com SQL próprio; o `pg` já é externo por padrão no Next
  serverExternalPackages: ['pg-boss'],
  poweredByHeader: false, // P08-05: sem "x-powered-by: Next.js"
  headers: async () => [
    // P08-05 / RNF-06 (D8): todas as rotas, inclusive /api (a CSP de documento vem do proxy). Fica ANTES das regras
    // de convite/consulta: para a mesma chave, a última regra que casa vence.
    { source: '/:path*', headers: CABECALHOS_SEGURANCA },
    // M7: o token do convite está na URL; além da <meta name="referrer"> da página, o cabeçalho
    // vale desde a primeira resposta (inclusive para recursos pedidos antes do <head> ser lido).
    { source: '/convite/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // D20: o token do link da consulta também está na URL
    { source: '/consulta/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // RN-158: o token do link do documento está na URL, e a página e as rotas dele mostram dado de saúde (nada em cache)
    { source: '/documento/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
    { source: '/api/documento/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
    // Plano 14A (US-107): o token do link da autorização de IA está na URL (nada em cache, nunca como Referer)
    { source: '/autorizacao-ia/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
    { source: '/api/autorizacao-ia/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
    // RN-156: o código de verificação está na URL (/v/<código>)
    { source: '/v/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // O cabeçalho do next.config vence o do Route Handler (send-response.js só põe o do handler se a chave ainda não
    // existir): sem esta regra, o 'no-referrer' de /api/arquivos (URL assinada na query) virava o global.
    { source: '/api/arquivos', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // Plano 26 (RN-494, RN-495): a impressão e o CSV dos Relatórios trazem números do consultório e, no Ranking, nomes de
    // pacientes — nada em cache (a rota do CSV também manda o cabeçalho; aqui vale desde a primeira resposta)
    { source: '/painel/relatorios/imprimir', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    { source: '/api/painel/relatorios/csv', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    // Plano 23 (AG-D71, RN-419): a impressão da agenda tem nome de pacientes e grava um "exportar" a cada render — nada em cache
    { source: '/painel/agenda/imprimir', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    // Plano 23 (AG-D71, AG-D42): o token do pedido da pessoa nova está na URL do link "Desistir do pedido" (nada em cache,
    // nunca como Referer)
    { source: '/n/:slug/pedido/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
    { source: '/api/n/:slug/pedido/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
  ],
};

export default withSerwist(nextConfig);
