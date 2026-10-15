/**
 * Plano 16 (RN-201): "Agora não" nos cartões do aparelho (notificações, instalar) esconde por 30 dias NESTE aparelho, por
 * conta (a chave leva a conta: outra pessoa no mesmo aparelho vê o cartão). Sai no "Sair" e no /entrar (como a lista de
 * compras). Sem dado de saúde. Sem armazenamento, o cartão aparece (nunca quebra a tela).
 */
const PREFIXO = 'nd-cartao:';
export const DISPENSA_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Plano 15 (§7.8): o convite da IA Nutri em Hoje. Diferente dos cartões do aparelho, a chave é o VÍNCULO (o `patientId`
 * no lugar da conta): o paciente de dois consultórios decide em cada um, e o "Agora não" de um não esconde o do outro.
 */
export const CARTAO_IA_NUTRI = 'ia_nutri';
const chave = (conta: string, cartao: string) => `${PREFIXO}${conta}:${cartao}`;

export function dispensado(conta: string, cartao: string, agora: number = Date.now()): boolean {
  try {
    const v = Number(localStorage.getItem(chave(conta, cartao)));
    return Number.isFinite(v) && v > 0 && agora - v < DISPENSA_MS;
  } catch {
    return false;
  }
}

export function dispensar(conta: string, cartao: string, agora: number = Date.now()): void {
  try {
    localStorage.setItem(chave(conta, cartao), String(agora));
  } catch {
    // sem armazenamento: vale enquanto a tela estiver aberta (estado do componente)
  }
}

export function esquecerCartoesDoAparelho(): void {
  try {
    const chaves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIXO)) chaves.push(k);
    }
    for (const k of chaves) localStorage.removeItem(k);
  } catch {
    // sem armazenamento: nada guardado
  }
}
