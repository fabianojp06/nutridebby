import type { PgBoss } from 'pg-boss';
import type { Db } from '@/db/client';
import type { PausaIaNutri } from '@/modules/plataforma/ia-nutri-pausa';
import type { ConfigIA } from '../modo';

/** As dependências das ações do paciente na IA Nutri (consentimento, desativação e, na T8, a conversa). Só o tipo. */
export type DepsIaNutri = {
  ia: ConfigIA;
  appUrl: string;
  db?: Db;
  boss?: PgBoss;
  agora?: Date;
  ip?: string | null;
  userAgent?: string | null;
  /** testes: a pausa injetada (a linha é uma só para o banco) */
  pausa?: PausaIaNutri;
};
