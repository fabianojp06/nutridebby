import { describe, expect, it } from 'vitest';
import { comporMural, MAX_ITENS_MURAL, MSG_MURAL, resumoDaRefeicao, saudacao, type FontesDoMural, type ItemDoMural } from './mural-regras';

const SP = 'America/Sao_Paulo';
const AGORA = new Date('2026-10-08T14:05:00Z'); // quinta, 11:05 em São Paulo
const sp = (dataHora: string) => new Date(`${dataHora}-03:00`); // instante a partir do relógio de SP

const ALMOCO = { id: 'r-almoco', nome: 'Almoço', horario: '12:30', itens: [{ nome: 'Arroz integral' }, { nome: 'feijão' }, { nome: 'frango grelhado' }, { nome: 'salada' }] };
const CAFE = { id: 'r-cafe', nome: 'Café da manhã', horario: '07:00', itens: [{ nome: 'Pão integral' }] };
const JANTAR = { id: 'r-jantar', nome: 'Jantar', horario: '19:30', itens: [{ nome: 'Sopa' }] };
const CEIA = { id: 'r-ceia', nome: 'Ceia', horario: '', itens: [{ nome: 'Chá' }] };

const vazio = (): FontesDoMural => ({ primeiroNome: 'Marina', plano: null, diario: [], envios: [], consulta: null, conteudos: [], documentosNovos: 0 });
const todos = (m: ReturnType<typeof comporMural>): ItemDoMural[] => [...m.anteriores.flatMap((d) => d.itens), ...m.hoje];
const textoDe = (i: ItemDoMural) => (!('texto' in i) || i.texto === null ? '' : typeof i.texto === 'string' ? i.texto : i.texto.semFuso);

describe('comporMural (RN-193 a RN-201)', () => {
  it('refeição que vem aí: 90 min antes, texto do app do consultório, "Comi assim"; a primeira do dia leva a saudação', () => {
    const f = { ...vazio(), plano: { publicadoEm: sp('2026-09-01T10:00'), refeicoes: [CAFE, ALMOCO, JANTAR, CEIA] } };
    const m = comporMural(f, AGORA, SP);
    const refeicoes = m.hoje.filter((i) => i.tipo === 'refeicao');
    expect(refeicoes.map(textoDe)).toEqual([
      'Bom dia, Marina. Café da manhã das 07:00: pão integral.',
      'Próxima refeição às 12:30 — Almoço: arroz integral, feijão, frango grelhado e salada.',
    ]);
    // jantar às 19:30 só aparece às 18:00; a ceia sem horário nunca aparece (RN-196)
    expect(textoDe(refeicoes[1])).not.toMatch(/nutricionista/i);
    expect(refeicoes.every((i) => i.autor === 'consultorio')).toBe(true);
    expect(refeicoes[1]).toMatchObject({ refeicaoId: 'r-almoco', respondida: false, hora: { semFuso: '12:30', comFuso: '12:30' } });
    const as18 = comporMural(f, sp('2026-10-08T18:00'), SP).hoje.filter((i) => i.tipo === 'refeicao');
    expect(as18.map((i) => (i.tipo === 'refeicao' ? i.refeicaoId : ''))).toEqual(['r-cafe', 'r-almoco', 'r-jantar']);
  });

  it('a resposta de hoje esconde o "Comi assim" daquela refeição; a de ontem não', () => {
    const resp = (dataHora: string) => ({ id: dataHora, dataHora: sp(dataHora), refeicao: 'Almoço', texto: null, foto: { estado: 'sem_foto' as const }, resposta: 'como_no_plano' as const, refeicaoDoPlano: 'Almoço · 12:30', comentario: null, comentadoEm: null });
    const base = { ...vazio(), plano: { publicadoEm: null, refeicoes: [ALMOCO] } };
    const ontem = comporMural({ ...base, diario: [resp('2026-10-07T12:40')] }, AGORA, SP).hoje.find((i) => i.tipo === 'refeicao');
    expect(ontem).toMatchObject({ respondida: false });
    const hoje = comporMural({ ...base, diario: [resp('2026-10-08T10:00')] }, AGORA, SP).hoje.find((i) => i.tipo === 'refeicao');
    expect(hoje).toMatchObject({ respondida: true });
  });

  it('diário: balão "Você" com a resposta e a refeição do plano; comentário da nutricionista com a voz dela, verbatim', () => {
    const f = {
      ...vazio(),
      diario: [
        { id: 'e1', dataHora: sp('2026-10-08T08:10'), refeicao: 'Café da manhã', texto: 'Pão com ovo', foto: { estado: 'sem_foto' as const }, resposta: null, refeicaoDoPlano: null, comentario: 'Ótima combinação!', comentadoEm: sp('2026-10-08T09:15') },
      ],
    };
    const m = comporMural(f, AGORA, SP);
    expect(m.hoje.map((i) => [i.tipo, i.autor])).toEqual([['registro', 'voce'], ['comentario', 'nutricionista']]);
    expect(m.hoje[1]).toMatchObject({ texto: 'Ótima combinação!', hora: { semFuso: '09:15' } });
  });

  it('exame: envio de hoje e mudança de situação em 7 dias (o texto de SITUACAO vem pronto); envio antigo sem mudança não entra', () => {
    const f = {
      ...vazio(),
      envios: [
        { id: 'x1', nome: 'Hemograma', enviadoEm: sp('2026-10-08T09:00'), mudouEm: sp('2026-10-08T09:00'), situacao: 'Aguardando sua nutricionista' },
        { id: 'x2', nome: 'Glicemia', enviadoEm: sp('2026-10-01T09:00'), mudouEm: sp('2026-10-07T16:00'), situacao: 'Não aceito: Imagem ilegível' },
        // recebido (só processado): mudouEm = enviadoEm (muralDoPaciente, T6) — o processamento não conta como mudança
        { id: 'x3', nome: 'Ferritina', enviadoEm: sp('2026-10-02T09:00'), mudouEm: sp('2026-10-02T09:00'), situacao: 'Aguardando sua nutricionista' },
      ],
    };
    const m = comporMural(f, AGORA, SP);
    expect(m.hoje.map(textoDe)).toEqual(['Hemograma: Aguardando sua nutricionista']);
    expect(m.anteriores).toEqual([{ dia: '2026-10-07', rotulo: 'Ontem', itens: [expect.objectContaining({ texto: 'Glicemia: Não aceito: Imagem ilegível' })] }]);
  });

  it('consulta nos próximos 7 dias (com e sem a sigla), "Confirmar presença" só se pode; fora dos 7 dias não entra', () => {
    const consulta = { id: 'c1', inicio: sp('2026-10-09T14:00'), modalidade: 'online' as const, podeConfirmar: true };
    const item = comporMural({ ...vazio(), consulta }, AGORA, SP).hoje[0];
    expect(item).toMatchObject({
      tipo: 'consulta',
      consultaId: 'c1',
      podeConfirmar: true,
      hora: null,
      texto: { semFuso: 'Sua próxima consulta: amanhã, 14:00 (online).', comFuso: 'Sua próxima consulta: amanhã, 14:00 (horário de Brasília) (online).' },
    });
    expect(comporMural({ ...vazio(), consulta: { ...consulta, inicio: sp('2026-10-16T14:00') } }, AGORA, SP).vazio).toBe(true);
  });

  it('plano novo (7 dias), conteúdo novo (até 3, 7 dias) e documentos novos; o plano antigo não', () => {
    const f = {
      ...vazio(),
      plano: { publicadoEm: sp('2026-10-06T10:00'), refeicoes: [] },
      conteudos: [1, 2, 3, 4].map((n) => ({ id: `k${n}`, titulo: `Lanches ${n}`, publicadoEm: sp(`2026-10-0${n + 3}T08:00`) })),
      documentosNovos: 1,
    };
    const textos = todos(comporMural(f, AGORA, SP)).map(textoDe);
    expect(textos).toContain('Seu novo plano alimentar está disponível.');
    expect(textos).toContain('Você tem 1 documento novo.');
    expect(textos.filter((t) => t.startsWith('Novo conteúdo: '))).toHaveLength(3);
    expect(comporMural({ ...vazio(), plano: { publicadoEm: sp('2026-09-20T10:00'), refeicoes: [] } }, AGORA, SP).vazio).toBe(true);
    expect(MSG_MURAL.documentos(2)).toBe('Você tem 2 documentos novos.');
  });

  it('autoria (RN-194, C-197): só o comentário é da nutricionista; nenhum texto do sistema fala por ela nem diz "IA"', () => {
    const f: FontesDoMural = {
      ...vazio(),
      plano: { publicadoEm: sp('2026-10-08T07:00'), refeicoes: [CAFE, ALMOCO] },
      diario: [{ id: 'e1', dataHora: sp('2026-10-08T08:00'), refeicao: 'Café da manhã', texto: 'ok', foto: { estado: 'sem_foto' }, resposta: null, refeicaoDoPlano: null, comentario: 'Boa!', comentadoEm: sp('2026-10-08T08:30') }],
      envios: [{ id: 'x1', nome: null, enviadoEm: sp('2026-10-08T09:00'), mudouEm: sp('2026-10-08T09:00'), situacao: 'Processando…' }],
      consulta: { id: 'c1', inicio: sp('2026-10-09T14:00'), modalidade: 'presencial', podeConfirmar: false },
      conteudos: [{ id: 'k1', titulo: 'Rótulos', publicadoEm: sp('2026-10-08T06:00') }],
      documentosNovos: 2,
    };
    for (const i of todos(comporMural(f, AGORA, SP))) {
      if (i.autor === 'nutricionista') expect(i.tipo).toBe('comentario');
      else expect(textoDe(i)).not.toMatch(/^Sua nutricionista|\bIA\b/);
    }
    // o comentário diz a qual registro se refere (o texto dela continua verbatim)
    expect(todos(comporMural(f, AGORA, SP)).find((i) => i.tipo === 'comentario')).toMatchObject({ sobre: 'Café da manhã, hoje às 08:00', texto: 'Boa!' });
    expect(MSG_MURAL.nutricionistaComentou('Café da manhã, hoje às 08:00')).toBe('Sua nutricionista comentou seu registro (Café da manhã, hoje às 08:00)');
  });

  it('janela e ordem (RN-195): hoje em ordem crescente; dias anteriores por dia; no máximo 40 itens, os mais antigos saem; vazio', () => {
    const diario = Array.from({ length: 45 }, (_, k) => ({
      id: `e${k}`,
      dataHora: new Date(sp('2026-10-01T08:00').getTime() + k * 3 * 3600_000),
      refeicao: 'Outro',
      texto: `r${k}`,
      foto: { estado: 'sem_foto' as const },
      resposta: null,
      refeicaoDoPlano: null,
      comentario: null,
      comentadoEm: null,
    }));
    const m = comporMural({ ...vazio(), diario }, AGORA, SP);
    const lista = todos(m);
    expect(lista).toHaveLength(MAX_ITENS_MURAL);
    expect(lista.map((i) => i.quando.getTime())).toEqual([...lista.map((i) => i.quando.getTime())].sort((a, b) => a - b));
    expect(lista[0]).toMatchObject({ chave: 'registro:e5' }); // e0 a e4 saíram
    // o último registro (e44) é de 06/10 20:00: nenhum de ontem nem de hoje
    expect(m.anteriores.map((d) => d.rotulo)).toEqual(['Qui, 1 out', 'Sex, 2 out', 'Sáb, 3 out', 'Dom, 4 out', 'Seg, 5 out', 'Ter, 6 out']);
    expect(m.hoje).toEqual([]);
    expect(comporMural(vazio(), AGORA, SP)).toEqual({ primeiroNome: 'Marina', hoje: [], anteriores: [], vazio: true, semPlano: true, semRefeicaoHoje: false });
    // plano publicado e nada para agora (05:00, primeira refeição às 08:00): vazio, mas NÃO "sem plano" (o texto não diz que ela não publicou)
    const cedo = comporMural({ ...vazio(), plano: { publicadoEm: sp('2026-09-20T10:00'), refeicoes: [{ id: 'r-cafe', nome: 'Café da manhã', horario: '08:00', itens: [{ nome: 'Pão' }] }] } }, sp('2026-10-08T05:00'), SP);
    expect(cedo).toMatchObject({ vazio: true, semPlano: false });
    expect(cedo.semRefeicaoHoje).toBe(false); // há refeição hoje, só não é hora
    // Plano 19 (RN-247 b): plano publicado sem refeição que vale hoje (muralDoPaciente já filtra pelo dia)
    expect(comporMural({ ...vazio(), plano: { publicadoEm: sp('2026-09-20T10:00'), refeicoes: [] } }, sp('2026-10-08T05:00'), SP)).toMatchObject({ vazio: true, semPlano: false, semRefeicaoHoje: true });
  });

  it('virada do dia (Review Focus 3): às 23:30, a refeição das 00:30 é a de hoje (já passou), nunca a "próxima" de amanhã; o registro de ontem às 23:59 fica em "Ontem"', () => {
    const f = { ...vazio(), plano: { publicadoEm: null, refeicoes: [{ id: 'r0', nome: 'Ceia', horario: '00:30', itens: [] }] } };
    expect(comporMural(f, sp('2026-10-08T23:30'), SP).hoje).toEqual([expect.objectContaining({ texto: 'Boa noite, Marina. Ceia das 00:30.', quando: sp('2026-10-08T00:30') })]);
    // às 00:10 a das 00:30 já é a próxima (de hoje): 20 min antes, dentro dos 90
    expect(comporMural(f, sp('2026-10-09T00:10'), SP).hoje).toEqual([expect.objectContaining({ texto: 'Boa noite, Marina. Próxima refeição às 00:30 — Ceia.' })]);
    const reg = { id: 'e1', dataHora: sp('2026-10-07T23:59'), refeicao: 'Ceia', texto: 'chá', foto: { estado: 'sem_foto' as const }, resposta: null, refeicaoDoPlano: null, comentario: null, comentadoEm: null };
    const m = comporMural({ ...vazio(), diario: [reg] }, sp('2026-10-08T00:01'), SP);
    expect(m.hoje).toEqual([]);
    expect(m.anteriores[0].rotulo).toBe('Ontem');
  });

  it('resumo e saudação', () => {
    expect(resumoDaRefeicao([{ nome: 'Arroz, integral, cozido' }])).toBe('arroz, integral, cozido');
    expect(resumoDaRefeicao([{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }, { nome: 'D' }, { nome: 'E' }])).toBe('a, b, c e d');
    expect(resumoDaRefeicao([])).toBe('');
    expect([saudacao(4 * 60 + 59), saudacao(5 * 60), saudacao(11 * 60 + 59), saudacao(12 * 60), saudacao(17 * 60 + 59), saudacao(18 * 60)]).toEqual([
      'Boa noite', 'Bom dia', 'Bom dia', 'Boa tarde', 'Boa tarde', 'Boa noite',
    ]);
  });
});

describe('Plano 15 (D34, §7.8): o rodapé do mural com a IA Nutri', () => {
  it('não diz mais "Este app não é um canal de conversa" sem ressalva: o mural não é conversa com a nutricionista; a IA Nutri, quando liberada, é um programa', () => {
    expect(MSG_MURAL.rodape).not.toContain('canal de conversa');
    expect(MSG_MURAL.rodape).toBe(
      'Seus registros do diário ficam visíveis para sua nutricionista, que pode comentar quando os ler. O mural não é uma conversa com a sua nutricionista e não tem prazo de resposta. A IA Nutri, quando liberada, é um programa e responde só sobre o seu plano. Dúvidas: anote para a consulta ou use os contatos do consultório. Em emergência, ligue 192.',
    );
  });
});

