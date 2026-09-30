import type { PatientRow } from '@/db/schema';
import { formatarTelefone } from '@/modules/pacientes/telefone';

/** O que o formulário de cadastro manda e recebe de volta num erro (PF-N9: nada do que foi digitado se perde). */
export type ValoresPaciente = {
  nome: string;
  dataNascimento: string;
  sexo: string;
  email: string;
  telefone: string;
  whatsappAutorizado: boolean;
};

const campo = (f: FormData, k: string) => String(f.get(k) ?? '');

export function valoresDoFormulario(f: FormData): ValoresPaciente {
  return {
    nome: campo(f, 'nome'),
    dataNascimento: campo(f, 'dataNascimento'),
    sexo: campo(f, 'sexo'),
    email: campo(f, 'email'),
    telefone: campo(f, 'telefone'),
    whatsappAutorizado: f.get('whatsappAutorizado') === 'on',
  };
}

export function valoresDoPaciente(p: PatientRow): ValoresPaciente {
  return {
    nome: p.nome,
    dataNascimento: p.dataNascimento ?? '',
    sexo: p.sexo ?? '',
    email: p.email,
    telefone: p.telefoneE164 ? formatarTelefone(p.telefoneE164) : '',
    whatsappAutorizado: !!p.whatsappOptinEm && !p.whatsappOptoutEm,
  };
}

/** Selo do cabeçalho do prontuário (US-018 "Arquivado"). */
export function seloDoPaciente(p: Pick<PatientRow, 'status' | 'origem' | 'dataNascimento' | 'sexo'>): string | null {
  if (p.status === 'arquivado') return 'Arquivado';
  if (p.status === 'bloqueado') return 'Bloqueado (pedido de exclusão)';
  if (p.origem === 'agendamento_publico' && (!p.dataNascimento || !p.sexo)) return 'Completar cadastro';
  return null;
}
