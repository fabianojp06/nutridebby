import { SwProvider } from './sw-provider';

export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return <SwProvider>{children}</SwProvider>;
}
