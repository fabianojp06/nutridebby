import { describe, expect, it } from 'vitest';
import { detectarRisco, normalizar } from './sinais-risco';

describe('detectarRisco (RN-174, §7.4 item 1): o filtro determinístico antes de gravar e de chamar o provedor', () => {
  it.each([
    ['não aguento mais, quero sumir e me machucar', 'emergencia', 'risco_emergencia'],
    ['Às vezes penso em SUICÍDIO', 'emergencia', 'risco_emergencia'],
    ['estou com dor no peito e falta de ar depois do almoço', 'emergencia', 'sintoma_agudo'],
    ['vomitei sangue hoje', 'emergencia', 'sintoma_agudo'],
    ['depois do jantar eu vomito pra não engordar', 'transtorno_alimentar', 'risco_transtorno'],
    ['tomo laxante para emagrecer', 'transtorno_alimentar', 'risco_transtorno'],
    ['fico 3 dias sem comer', 'transtorno_alimentar', 'risco_transtorno'],
    ['odeio meu corpo', 'transtorno_alimentar', 'risco_transtorno'],
    // revisão da T6 (rodada 1): os exemplos da própria spec (§7.4 item 1) e as formas comuns do mesmo grupo
    ['tive um episódio de autolesão', 'emergencia', 'risco_emergencia'],
    ['já pensei em automutilação', 'emergencia', 'risco_emergencia'],
    ['tenho vontade de morrer', 'emergencia', 'risco_emergencia'],
    ['queria morrer', 'emergencia', 'risco_emergencia'],
    ['penso em morrer', 'emergencia', 'risco_emergencia'],
    ['estou pensando em se matar', 'emergencia', 'risco_emergencia'],
    ['vou acabar com a minha vida', 'emergencia', 'risco_emergencia'],
    ['me cortei ontem', 'emergencia', 'risco_emergencia'],
    ['tive vômito com sangue', 'emergencia', 'sintoma_agudo'],
    ['vomitei um pouco de sangue', 'emergencia', 'sintoma_agudo'],
    ['tive uma reação alérgica grave', 'emergencia', 'sintoma_agudo'],
    ['a garganta está fechando', 'emergencia', 'sintoma_agudo'],
    ['estou com dores no peito', 'emergencia', 'sintoma_agudo'],
    ['dor forte no peito', 'emergencia', 'sintoma_agudo'],
    ['sinto uma dor no meu peito', 'emergencia', 'sintoma_agudo'],
    ['estou sem ar', 'emergencia', 'sintoma_agudo'],
    ['vomito de propósito', 'transtorno_alimentar', 'risco_transtorno'],
    ['tento induzir o vômito', 'transtorno_alimentar', 'risco_transtorno'],
    ['fico dias sem comer', 'transtorno_alimentar', 'risco_transtorno'],
    ['fico o dia todo sem comer', 'transtorno_alimentar', 'risco_transtorno'],
    ['passei um dia sem comer', 'transtorno_alimentar', 'risco_transtorno'],
  ])('%s → %s', (texto, risco, textoFixo) => expect(detectarRisco(texto)).toEqual({ risco, textoFixo }));

  it.each(['quanto de arroz no almoço?', 'posso trocar a banana pela maçã?', 'que horas é o jantar?', 'a vitamina de banana leva leite?'])(
    'sem risco: %s',
    (t) => expect(detectarRisco(t)).toBeNull(),
  );

  it('sem acento e sem diferença de maiúsculas; nada vai a log (a função é pura)', () => expect(detectarRisco('QUERO MORRER')).not.toBeNull());

  it('a ordem é autolesão → sintoma agudo → transtorno: o mais grave vence', () => {
    expect(detectarRisco('desmaiei e quero morrer')).toEqual({ risco: 'emergencia', textoFixo: 'risco_emergencia' });
    expect(detectarRisco('tomei laxante e agora estou com falta de ar')).toEqual({ risco: 'emergencia', textoFixo: 'sintoma_agudo' });
  });

  it('espaços repetidos e quebras de linha não escondem o sinal', () => expect(detectarRisco('quero\n\n   morrer')).not.toBeNull());

  it('normalizar: sem acento, minúsculas e um espaço só', () => expect(normalizar('  Ômega   ÇÃO\tX ')).toBe(' omega cao x '));
});
