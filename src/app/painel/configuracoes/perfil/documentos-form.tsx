'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { Botao } from '@/components/ui/botao';
import { salvarDadosDocumentosAction, type DadosDocState } from './actions';

/** US-140: o carimbo dos documentos. O CRN e o endereço ficam no formulário de cima ("Perfil e marca"). Recebe só estes campos (G2). */
export function DocumentosForm({ dados }: { dados: { nomeProfissional: string; contatoEmail: string; contatoTelefone: string } }) {
  const [s, action, pendente] = useActionState<DadosDocState, FormData>(salvarDadosDocumentosAction, {});
  const e = s.erros ?? {};
  const v = s.valores ?? dados;
  return (
    <form action={action} className="space-y-4" data-guia="dados-documentos">
      <Campo id="nomeProfissional" rotulo="Nome completo" required defaultValue={v.nomeProfissional} erro={e.nomeProfissional} dica="Sai no carimbo das receitas, como no seu registro no CRN." />
      <Campo id="contatoEmail" rotulo="E-mail profissional" type="email" required defaultValue={v.contatoEmail} erro={e.contatoEmail} />
      <Campo id="contatoTelefone" rotulo="Telefone profissional" type="tel" required defaultValue={v.contatoTelefone} erro={e.contatoTelefone} dica="Com DDD. Ex.: (11) 91234-5678" />
      {s.ok && <p role="status">Dados para documentos salvos.</p>}
      <Botao disabled={pendente}>Salvar dados para documentos</Botao>
    </form>
  );
}
