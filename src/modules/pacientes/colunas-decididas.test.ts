import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';

/**
 * Plano 18 (§10, D18, RN-262, RN-282, RN-283): cada coluna de `patients` e de `patient_cadastro` tem o destino decidido na
 * exportação (`dados.json`, `prontuario.pdf`), na anonimização e na IA. Coluna nova sem decisão quebra este teste: quem a
 * criou decide (e acerta `montarDados`, `prontuario-pdf.tsx`, `anonimizarVencidos` e a máscara da IA) antes do merge.
 */
type Exportacao =
  | 'dados.json e PDF' // no dados.json (os dois escopos) e na Identificação do prontuario.pdf
  | 'dados.json' // só no dados.json (os dois escopos; os campos legados da IA, só quando preenchidos)
  | 'fora'; // técnica ou interna (ids, marcas da guarda, opt-in do WhatsApp — este, aguardando o advogado, E-09)
type Anonimizacao =
  | 'troca' // o UPDATE grava um valor sem identificação (nome, e-mail)
  | 'anula' // o UPDATE grava nulo
  | 'marca' // o UPDATE grava a data da anonimização (anonimizado_em, updated_at)
  | 'fica' // não identifica (ou já foi limpa no bloqueio)
  | 'apaga a linha'; // patient_cadastro: a linha inteira sai (RN-283)
type Ia =
  | 'mascara' // só para a máscara (outrosNomes, e-mail, telefone): nunca sai ao provedor
  | 'derivado' // sai só o derivado (a idade, do nascimento)
  | 'enviado' // sai como está (o sexo, para as fórmulas)
  | 'nunca';
type Decisao = { exportacao: Exportacao; anonimizacao: Anonimizacao; ia: Ia };

const PATIENTS: Record<string, Decisao> = {
  id: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  tenant_id: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  user_id: { exportacao: 'fora', anonimizacao: 'anula', ia: 'nunca' },
  nome: { exportacao: 'dados.json e PDF', anonimizacao: 'troca', ia: 'mascara' },
  data_nascimento: { exportacao: 'dados.json e PDF', anonimizacao: 'anula', ia: 'derivado' },
  sexo: { exportacao: 'dados.json e PDF', anonimizacao: 'fica', ia: 'enviado' },
  telefone_e164: { exportacao: 'dados.json e PDF', anonimizacao: 'anula', ia: 'mascara' },
  email: { exportacao: 'dados.json e PDF', anonimizacao: 'troca', ia: 'mascara' },
  origem: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  // limpos na exclusão atendida (atenderPedidoExclusao), antes da anonimização
  whatsapp_optin_em: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  whatsapp_optin_origem: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  whatsapp_optout_em: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  ia_recusada_em: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  ia_aviso_versao: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  ia_aviso_em: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  ia_aviso_canal: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  ia_aviso_enviado_em: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  peso_oculto_no_app_em: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  lembretes_pausados_em: { exportacao: 'dados.json', anonimizacao: 'anula', ia: 'nunca' },
  status: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  bloqueado_em: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  anonimizar_apos: { exportacao: 'fora', anonimizacao: 'fica', ia: 'nunca' },
  anonimizado_em: { exportacao: 'fora', anonimizacao: 'marca', ia: 'nunca' },
  created_at: { exportacao: 'dados.json', anonimizacao: 'fica', ia: 'nunca' },
  updated_at: { exportacao: 'fora', anonimizacao: 'marca', ia: 'nunca' },
};

// RN-283: a linha inteira sai na anonimização. RN-262: o CPF só no dados.json; §10: a observação também (fora do PDF).
// RN-282: da tabela, só o nome social vai à máscara da IA.
const PATIENT_CADASTRO: Record<string, Decisao> = {
  id: { exportacao: 'fora', anonimizacao: 'apaga a linha', ia: 'nunca' },
  tenant_id: { exportacao: 'fora', anonimizacao: 'apaga a linha', ia: 'nunca' },
  patient_id: { exportacao: 'fora', anonimizacao: 'apaga a linha', ia: 'nunca' },
  cpf: { exportacao: 'dados.json', anonimizacao: 'apaga a linha', ia: 'nunca' },
  nome_social: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'mascara' },
  identidade_genero: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  estado_civil: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  escolaridade: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  ocupacao: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  nacionalidade: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  naturalidade: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  telefone_fixo_e164: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  cep: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  logradouro: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  numero: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  complemento: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  bairro: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  cidade: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  uf: { exportacao: 'dados.json e PDF', anonimizacao: 'apaga a linha', ia: 'nunca' },
  observacao: { exportacao: 'dados.json', anonimizacao: 'apaga a linha', ia: 'nunca' },
  created_at: { exportacao: 'fora', anonimizacao: 'apaga a linha', ia: 'nunca' },
  updated_at: { exportacao: 'fora', anonimizacao: 'apaga a linha', ia: 'nunca' },
};

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const colunasDe = async (tabela: string) =>
  (
    await app.db.execute<{ coluna: string }>(
      sql`select column_name as coluna from information_schema.columns where table_schema = 'public' and table_name = ${tabela} order by column_name`,
    )
  ).rows.map((r) => r.coluna);

describe('Plano 18 (§10): toda coluna do paciente tem o destino decidido (exportação, anonimização, IA)', () => {
  for (const [tabela, mapa] of [
    ['patients', PATIENTS],
    ['patient_cadastro', PATIENT_CADASTRO],
  ] as const) {
    it(`${tabela}: as colunas do banco são as do mapa`, async () => {
      const colunas = await colunasDe(tabela);
      expect(colunas.length, 'a tabela é lida (controle positivo)').toBeGreaterThan(5);
      expect(
        colunas.filter((c) => !(c in mapa)),
        `coluna nova em ${tabela}: decida exportação, anonimização e IA e acrescente aqui`,
      ).toEqual([]);
      expect(
        Object.keys(mapa).filter((c) => !colunas.includes(c)),
        `coluna que saiu de ${tabela}: tire do mapa`,
      ).toEqual([]);
    });
  }

  it('as decisões que a spec fixa: CPF e observação fora do PDF; só o nome social à IA; a linha do cadastro sai inteira', () => {
    expect(PATIENT_CADASTRO.cpf.exportacao).toBe('dados.json');
    expect(PATIENT_CADASTRO.observacao.exportacao).toBe('dados.json');
    expect(Object.entries(PATIENT_CADASTRO).filter(([, d]) => d.ia !== 'nunca').map(([c]) => c)).toEqual(['nome_social']);
    expect(new Set(Object.values(PATIENT_CADASTRO).map((d) => d.anonimizacao))).toEqual(new Set(['apaga a linha']));
  });
});
