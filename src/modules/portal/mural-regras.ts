import { inicioDoDia, paraInstante, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { horaComFuso, quandoRelativo, quandoRelativoComFuso, separadorDoDia } from './datas-portal';
import { rotuloDaRefeicao, type RespostaDoDiario } from './diario-constantes';

/**
 * Plano 16 (§4.3): o mural "Hoje" é LEITURA — nenhuma tabela, nenhuma mensagem (spec C, D24 = b). Esta função pura decide
 * os itens, a ordem, os textos, a autoria e quais respostas aparecem; `muralDoPaciente` (mural.ts) só busca as fontes.
 * Autoria (RN-194, C-197): só o texto que a nutricionista escreveu leva a voz dela; o resto é do app do consultório, em
 * 3ª pessoa ou impessoal, sem elogio, conselho ou ordem. Textos em rascunho até a Debby revisar (G-D10 ★).
 */
export const JANELA_MURAL_DIAS = 7; // RN-195
export const MAX_ITENS_MURAL = 40; // RN-195
export const ANTECEDENCIA_REFEICAO_MIN = 90; // RN-196
export const MAX_CONTEUDOS_NO_MURAL = 3; // RN-199
/** Teto da leitura do diário no mural (7 dias × 10 registros = 70; folga para os comentários). */
export const LIMITE_DIARIO_NO_MURAL = 100;

export const MSG_MURAL = {
  // correção da revisão do plano (normas, LGPD art. 6º, VI): o diário É visto por ela — o rodapé não pode dizer o contrário
  rodape: 'Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. Este app não é um canal de conversa e não tem prazo de resposta. Dúvidas: anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192.',
  vazio: 'Nada por aqui ainda. Quando sua nutricionista publicar seu plano, suas refeições aparecem aqui.',
  /** Plano publicado e nada no mural (antes dos 90 min da 1ª refeição, ou refeições sem horário): nunca dizer que ela não publicou. */
  nadaAgora: 'Nada para agora. Suas refeições aparecem aqui perto do horário de cada uma.',
  verTodoDiario: 'Ver todo o diário',
  diasAnteriores: 'Dias anteriores',
  /** Autor VISÍVEL de cada item (RN-194, §11.1): o lado do balão não basta. O comentário da nutricionista usa o rótulo próprio. */
  autor: { voce: 'Você', consultorio: 'Aviso do app' },
  /** RN-194: rótulo montado pelo sistema em 3ª pessoa; diz a qual registro o comentário se refere (o texto dela vem verbatim). */
  nutricionistaComentou: (sobre: string) => `Sua nutricionista comentou seu registro (${sobre})`,
  saudacao: (s: string, nome: string) => (nome ? `${s}, ${nome}.` : `${s}.`),
  refeicaoAntes: (hora: string, nome: string, resumo: string) => `Próxima refeição às ${hora} — ${resumo ? `${nome}: ${resumo}` : nome}.`,
  refeicaoDepois: (nome: string, hora: string, resumo: string) => `${nome} das ${hora}${resumo ? `: ${resumo}` : ''}.`,
  exame: (nome: string, situacao: string) => `${nome}: ${situacao}`,
  consulta: (quando: string, modalidade: string) => `Sua próxima consulta: ${quando} (${modalidade}).`,
  planoNovo: 'Seu novo plano alimentar está disponível.',
  conteudo: (titulo: string) => `Novo conteúdo: ${titulo}`,
  documentos: (n: number) => (n === 1 ? 'Você tem 1 documento novo.' : `Você tem ${n} documentos novos.`),
  botoes: {
    verRefeicao: 'Ver a refeição',
    verDiario: 'Ver no diário',
    verExames: 'Ver meus exames',
    verConsulta: 'Ver a consulta',
    confirmar: 'Confirmar presença',
    verPlano: 'Ver o plano',
    abrir: 'Abrir',
    verDocumentos: 'Ver documentos',
  },
} as const;

export type FotoDoRegistro = { estado: 'sem_foto' | 'processando' | 'falhou' } | { estado: 'pronta'; caminho: string };

export type FontesDoMural = {
  primeiroNome: string;
  plano: { publicadoEm: Date | null; refeicoes: readonly { id: string; nome: string; horario: string; itens: readonly { nome: string }[] }[] } | null;
  diario: readonly {
    id: string;
    dataHora: Date;
    refeicao: string;
    texto: string | null;
    foto: FotoDoRegistro;
    resposta: RespostaDoDiario | null;
    refeicaoDoPlano: string | null;
    comentario: string | null;
    comentadoEm: Date | null;
  }[];
  /**
   * `situacao` = o texto de situacaoParaPaciente (o mesmo de /p/exames). `mudouEm` = quando a situação mudou DEPOIS do envio
   * (revisão, expiração, falha); para "processando" e "recebido", igual a `enviadoEm` (o processamento não é mudança).
   */
  envios: readonly { id: string; nome: string | null; enviadoEm: Date; mudouEm: Date; situacao: string }[];
  consulta: { id: string; inicio: Date; modalidade: 'presencial' | 'online'; podeConfirmar: boolean } | null;
  conteudos: readonly { id: string; titulo: string; publicadoEm: Date }[];
  documentosNovos: number;
};

type Hora = { semFuso: string; comFuso: string };
type Base = { chave: string; quando: Date; /** null: item sem hora própria (D13). */ hora: Hora | null };
export type ItemDoMural =
  | (Base & { tipo: 'refeicao'; autor: 'consultorio'; texto: string; refeicaoId: string; respondida: boolean })
  | (Base & { tipo: 'registro'; autor: 'voce'; refeicao: string; resposta: RespostaDoDiario | null; texto: string | null; foto: FotoDoRegistro })
  | (Base & { tipo: 'comentario'; autor: 'nutricionista'; /** "Almoço · 12:30, hoje às 12:41" */ sobre: string; texto: string })
  | (Base & { tipo: 'exame'; autor: 'consultorio'; texto: string })
  | (Base & { tipo: 'consulta'; autor: 'consultorio'; consultaId: string; texto: Hora; podeConfirmar: boolean })
  | (Base & { tipo: 'plano'; autor: 'consultorio'; texto: string })
  | (Base & { tipo: 'conteudo'; autor: 'consultorio'; conteudoId: string; titulo: string; texto: string })
  | (Base & { tipo: 'documentos'; autor: 'consultorio'; texto: string });

export type Mural = { primeiroNome: string; hoje: ItemDoMural[]; anteriores: { dia: string; rotulo: string; itens: ItemDoMural[] }[]; vazio: boolean; /** sem plano publicado: o texto "Nada por aqui ainda…" só vale aqui */ semPlano: boolean };

const minuscula = (s: string) => s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1);

/** RN-196: os nomes dos itens principais (sem substituições), até 4, com vírgula e "e"; sem quantidade (ela fica na refeição aberta). */
export function resumoDaRefeicao(itens: readonly { nome: string }[]): string {
  const nomes = itens.slice(0, 4).map((i) => minuscula(i.nome.trim())).filter(Boolean);
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** RN-196: "Bom dia" de 05:00 a 11:59, "Boa tarde" de 12:00 a 17:59, "Boa noite" no resto (minutos desde 00:00 no fuso). */
export function saudacao(minutosDoDia: number): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  if (minutosDoDia >= 5 * 60 && minutosDoDia < 12 * 60) return 'Bom dia';
  if (minutosDoDia >= 12 * 60 && minutosDoDia < 18 * 60) return 'Boa tarde';
  return 'Boa noite';
}

export function comporMural(f: FontesDoMural, agora: Date, fuso: string): Mural {
  const p = partesNoFuso(agora, fuso);
  const hoje = p.data;
  const inicioHoje = inicioDoDia(hoje, fuso);
  const inicioJanela = inicioDoDia(somarDias(hoje, -JANELA_MURAL_DIAS), fuso);
  const hora = (d: Date) => horaComFuso(d, fuso);
  // o comentário diz a qual registro se refere (pode cair longe dele no mural): "Almoço · 12:30, hoje às 12:41"
  const sobreORegistro = (e: FontesDoMural['diario'][number]) => {
    const dia = partesNoFuso(e.dataHora, fuso).data;
    const quando = dia === hoje ? 'hoje' : separadorDoDia(dia, hoje).toLocaleLowerCase('pt-BR');
    return `${e.refeicaoDoPlano ?? e.refeicao}, ${quando} às ${hora(e.dataHora).semFuso}`;
  };
  const itens: ItemDoMural[] = [];

  // RN-196 / RN-197: refeições de hoje com horário, a partir de 90 min antes; a resposta de hoje esconde o "Comi assim"
  const respondidasHoje = new Set(f.diario.flatMap((e) => (e.resposta && e.refeicaoDoPlano && e.dataHora >= inicioHoje ? [e.refeicaoDoPlano] : [])));
  const comHorario = (f.plano?.refeicoes ?? []).filter((r) => /^\d{2}:\d{2}$/.test(r.horario)).sort((a, b) => a.horario.localeCompare(b.horario));
  comHorario.forEach((r, i) => {
    const [h, m] = r.horario.split(':').map(Number);
    const minutos = h * 60 + m;
    if (p.minutos < minutos - ANTECEDENCIA_REFEICAO_MIN) return;
    const resumo = resumoDaRefeicao(r.itens);
    const corpo = p.minutos < minutos ? MSG_MURAL.refeicaoAntes(r.horario, r.nome, resumo) : MSG_MURAL.refeicaoDepois(r.nome, r.horario, resumo);
    itens.push({
      chave: `refeicao:${r.id}`,
      tipo: 'refeicao',
      autor: 'consultorio',
      quando: paraInstante(hoje, r.horario, fuso) ?? agora,
      // Desvio 3: a hora do plano é relógio de parede (sem a sigla do fuso)
      hora: { semFuso: r.horario, comFuso: r.horario },
      texto: i === 0 ? `${MSG_MURAL.saudacao(saudacao(p.minutos), f.primeiroNome)} ${corpo}` : corpo,
      refeicaoId: r.id,
      respondida: respondidasHoje.has(rotuloDaRefeicao(r.nome, r.horario)),
    });
  });

  for (const e of f.diario) {
    if (e.dataHora >= inicioJanela)
      itens.push({ chave: `registro:${e.id}`, tipo: 'registro', autor: 'voce', quando: e.dataHora, hora: hora(e.dataHora), refeicao: e.refeicaoDoPlano ?? e.refeicao, resposta: e.resposta, texto: e.texto, foto: e.foto });
    if (e.comentario && e.comentadoEm && e.comentadoEm >= inicioJanela)
      itens.push({ chave: `comentario:${e.id}`, tipo: 'comentario', autor: 'nutricionista', quando: e.comentadoEm, hora: hora(e.comentadoEm), sobre: sobreORegistro(e), texto: e.comentario });
  }

  // RN-199: envio de hoje, ou mudança de situação depois do envio nos últimos 7 dias (o processamento não conta)
  for (const e of f.envios) {
    const mudou = e.mudouEm.getTime() > e.enviadoEm.getTime() && e.mudouEm >= inicioJanela;
    if (e.enviadoEm < inicioHoje && !mudou) continue;
    const quando = mudou ? e.mudouEm : e.enviadoEm;
    itens.push({ chave: `exame:${e.id}`, tipo: 'exame', autor: 'consultorio', quando, hora: hora(quando), texto: MSG_MURAL.exame(nomeDoEnvio(e.nome, formatarDataNoFuso(e.enviadoEm, fuso)), e.situacao) });
  }

  // D13: a consulta dos próximos 7 dias e os documentos novos entram em Hoje na hora da leitura, sem hora própria
  const c = f.consulta;
  if (c && c.inicio.getTime() <= agora.getTime() + JANELA_MURAL_DIAS * 86_400_000) {
    itens.push({
      chave: `consulta:${c.id}`,
      tipo: 'consulta',
      autor: 'consultorio',
      quando: agora,
      hora: null,
      consultaId: c.id,
      texto: { semFuso: MSG_MURAL.consulta(quandoRelativo(c.inicio, agora, fuso), c.modalidade), comFuso: MSG_MURAL.consulta(quandoRelativoComFuso(c.inicio, agora, fuso), c.modalidade) },
      podeConfirmar: c.podeConfirmar,
    });
  }
  if (f.plano?.publicadoEm && f.plano.publicadoEm >= inicioJanela)
    itens.push({ chave: 'plano', tipo: 'plano', autor: 'consultorio', quando: f.plano.publicadoEm, hora: hora(f.plano.publicadoEm), texto: MSG_MURAL.planoNovo });
  for (const k of f.conteudos.filter((x) => x.publicadoEm >= inicioJanela).slice(0, MAX_CONTEUDOS_NO_MURAL))
    itens.push({ chave: `conteudo:${k.id}`, tipo: 'conteudo', autor: 'consultorio', quando: k.publicadoEm, hora: hora(k.publicadoEm), conteudoId: k.id, titulo: k.titulo, texto: MSG_MURAL.conteudo(k.titulo) });
  if (f.documentosNovos > 0) itens.push({ chave: 'documentos', tipo: 'documentos', autor: 'consultorio', quando: agora, hora: null, texto: MSG_MURAL.documentos(f.documentosNovos) });

  const ordenados = itens
    .filter((i) => i.quando >= inicioJanela)
    .sort((a, b) => a.quando.getTime() - b.quando.getTime() || a.chave.localeCompare(b.chave))
    .slice(-MAX_ITENS_MURAL);
  const porDia = new Map<string, ItemDoMural[]>();
  for (const i of ordenados) {
    if (i.quando >= inicioHoje) continue;
    const dia = partesNoFuso(i.quando, fuso).data;
    porDia.set(dia, [...(porDia.get(dia) ?? []), i]);
  }
  return {
    primeiroNome: f.primeiroNome,
    hoje: ordenados.filter((i) => i.quando >= inicioHoje),
    anteriores: [...porDia].map(([dia, lista]) => ({ dia, rotulo: separadorDoDia(dia, hoje), itens: lista })),
    vazio: ordenados.length === 0,
    semPlano: f.plano === null,
  };
}
