import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, Home, ShieldCheck, UtensilsCrossed } from 'lucide-react';
import { Reveal } from '@/components/ui/motion';

const FEATURES = [
  { icon: UtensilsCrossed, text: 'Pedidos, caja y cocina en un solo lugar' },
  { icon: Clock3, text: 'Operación simple durante cada turno' },
  { icon: ShieldCheck, text: 'Acceso protegido para el equipo de RikoPollo' },
];

const AuthLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen items-stretch overflow-hidden bg-[#fff8e9]">
    <div className="relative z-10 flex flex-1 flex-col items-center justify-center bg-[#fff8e9] px-5 py-10 sm:px-8">
      <Link to="/" className="mb-7 flex items-center gap-3 text-[#25140b] hover:text-[#25140b] lg:hidden">
        <img src="/rikopollo/logo.jpeg" alt="RikoPollo" className="h-16 w-16 rounded-full border-2 border-[#e89b13] object-cover" />
        <div><p className="text-xl font-black">RikoPollo</p><p className="text-xs font-bold uppercase tracking-widest text-[#8a541b]">Acceso al personal</p></div>
      </Link>
      <Reveal y={16} delay={0.05} inView={false} className="w-full max-w-[420px]">{children}</Reveal>
      <Link to="/" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#8a541b] hover:text-[#d36d0b]"><Home className="h-4 w-4" /> Volver a la tienda</Link>
      <footer className="mt-5 text-center text-xs text-[#7a6658]">© {new Date().getFullYear()} RikoPollo</footer>
    </div>

    <aside className="relative hidden overflow-hidden bg-[#17120f] lg:flex lg:w-[480px] lg:flex-col lg:items-center lg:justify-center xl:w-[540px]">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f5a915]/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#d85d0a]/20 blur-3xl" />
      <div className="relative z-10 flex flex-col items-center gap-8 px-12 text-center">
        <img src="/rikopollo/logo.jpeg" alt="RikoPollo, sabor que da gusto" className="h-56 w-56 rounded-full border-4 border-[#f0a311] object-cover shadow-2xl" />
        <div><h2 className="text-4xl font-black text-white">Gestión de RikoPollo</h2><p className="mt-3 text-white/65">Área exclusiva para el propietario y el personal autorizado.</p></div>
        <ul className="w-full space-y-3" aria-label="Funciones del sistema">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/85">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f3a813]/15"><Icon className="h-4 w-4 text-[#ffc43c]" /></span>{text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  </div>
);

export default AuthLayout;
