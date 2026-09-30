import { redirect } from 'next/navigation';

// A home do paciente fica dentro do escopo `/p/` do service worker e do manifest
// (`/p` sozinho fica fora do escopo `/p/`).
export default function PacienteRaiz() {
  redirect('/p/inicio');
}
