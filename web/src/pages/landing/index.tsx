import { ArrowRight, CheckCircle2, Clock3, Instagram, LockKeyhole, MapPin, MessageCircle, ShoppingBag, Sparkles, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router-dom';

const WHATSAPP_URL = 'https://wa.me/5493755437366';

const menuItems = [
  { name: 'Pollo al espiedo', description: 'Pollo entero con papas asadas, ensalada, salsa de ajo y aderezo.', price: '$ 25.000', badge: 'Clásico de la casa' },
  { name: 'Combo broaster · 6 piezas', description: 'Seis piezas de pollo broaster, papas fritas y Coca-Cola de 1,5 L.', price: '$ 19.900', badge: 'Para compartir' },
  { name: 'Combo broaster · 12 piezas', description: 'Doce piezas de pollo broaster, papas fritas y Coca-Cola de 1,5 L.', price: '$ 31.900', badge: 'Rinde más' },
  { name: 'Combo pollo al espiedo', description: 'Pollo con papas asadas, ensalada, salsas, aderezo y Coca-Cola de 1,5 L.', price: '$ 29.500', badge: 'Combo completo' },
];

const schedules = [
  { days: 'Domingo, lunes, miércoles y jueves', hours: ['11:00 a 14:00', '19:00 a 22:00'] },
  { days: 'Viernes y sábado', hours: ['11:00 a 14:00', '19:00 a 00:00'] },
  { days: 'Martes', hours: ['Cerrado'] },
];

const LandingPage = () => (
  <div className="min-h-screen overflow-x-hidden bg-[#f7ead3] text-[#25140b]">
    <header className="sticky top-0 z-50 border-b border-[#6f461e]/15 bg-[#f7ead3]/95 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
        <a href="#inicio" className="flex items-center gap-3 text-[#25140b] hover:text-[#25140b]" aria-label="RikoPollo, inicio">
          <img src="/rikopollo/logo.jpeg" alt="RikoPollo" className="h-12 w-12 rounded-full border-2 border-[#e69a12] object-cover shadow-sm sm:h-14 sm:w-14" />
          <div>
            <p className="font-display text-xl font-black leading-none">RikoPollo</p>
            <p className="mt-1 hidden text-xs font-semibold uppercase tracking-[0.18em] text-[#7a4e1b] sm:block">Sabor que da gusto</p>
          </div>
        </a>
        <nav className="hidden items-center gap-7 text-sm font-bold md:flex" aria-label="Navegación principal">
          <a href="#menu" className="text-[#3b2112] hover:text-[#dc7b0b]">Menú</a>
          <a href="#horarios" className="text-[#3b2112] hover:text-[#dc7b0b]">Horarios</a>
          <a href="#ubicacion" className="text-[#3b2112] hover:text-[#dc7b0b]">Ubicación</a>
        </nav>
        <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-[#1f9d4c] px-3 py-2 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#17813d] hover:text-white sm:px-4">
          <MessageCircle className="h-4 w-4" /><span className="hidden sm:inline">Pedir por WhatsApp</span><span className="sm:hidden">Pedir</span>
        </a>
      </div>
    </header>

    <main>
      <section id="inicio" className="relative isolate overflow-hidden bg-[#11100e] text-white">
        <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-[#f3a313]/20 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-[#df5f12]/20 blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:py-28">
          <div className="relative z-10 max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#ffc12b]/35 bg-[#ffc12b]/10 px-4 py-2 text-sm font-bold text-[#ffd56b]"><Sparkles className="h-4 w-4" /> Pollo hecho para disfrutar</div>
            <h1 className="text-5xl font-black tracking-tight sm:text-6xl lg:text-7xl">El sabor que <span className="text-[#ffb914]">da gusto.</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-white/75 sm:text-xl">Pollo al espiedo, broaster crujiente y combos abundantes, preparados para retirar y compartir.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-xl bg-[#ffb914] px-6 py-3 font-black text-[#201207] shadow-[0_10px_30px_rgba(255,185,20,.22)] transition hover:-translate-y-0.5 hover:bg-[#ffc640] hover:text-[#201207]"><MessageCircle className="h-5 w-5" /> Hacer un pedido <ArrowRight className="h-4 w-4" /></a>
              <a href="#menu" className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-xl border border-white/20 px-6 py-3 font-bold text-white transition hover:border-[#ffb914] hover:bg-white/5 hover:text-white"><UtensilsCrossed className="h-5 w-5" /> Ver el menú</a>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-white/70">
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#ffb914]" /> Preparado en el momento</span>
              <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#ffb914]" /> Pedidos para llevar</span>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-lg">
            <div className="absolute -inset-4 rotate-3 rounded-[2rem] bg-[#ffb914]" />
            <img src="/rikopollo/menu.jpeg" alt="Menú de pollo al espiedo y pollo broaster de RikoPollo" className="relative aspect-[2/3] w-full rounded-[1.5rem] object-cover shadow-2xl" />
          </div>
        </div>
      </section>

      <section id="menu" className="scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-[#c8640b]">Nuestro menú</p>
            <h2 className="mt-3 text-4xl font-black sm:text-5xl">Elegí tu favorito</h2>
            <p className="mt-4 text-base leading-7 text-[#65452f]">Combos completos, porciones generosas y ese sabor casero que invita a volver.</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {menuItems.map((item) => (
              <article key={item.name} className="group rounded-2xl border border-[#714718]/15 bg-[#fff8e9] p-6 shadow-[0_12px_40px_rgba(95,55,12,.08)] transition hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(95,55,12,.14)]">
                <div className="flex items-start justify-between gap-5">
                  <div><span className="inline-flex rounded-full bg-[#ffe2a0] px-3 py-1 text-xs font-black uppercase tracking-wide text-[#8b4505]">{item.badge}</span><h3 className="mt-4 text-2xl font-black">{item.name}</h3></div>
                  <span className="shrink-0 rounded-xl bg-[#19130f] px-4 py-3 font-mono text-lg font-black text-[#ffbd20]">{item.price}</span>
                </div>
                <p className="mt-4 leading-7 text-[#684a35]">{item.description}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 text-center"><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#24150b] px-6 py-3 font-black text-white hover:bg-[#df790b] hover:text-white"><ShoppingBag className="h-5 w-5" /> Pedir para llevar</a></div>
        </div>
      </section>

      <section id="horarios" className="scroll-mt-24 bg-[#e99a10] px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
          <img src="/rikopollo/horarios.jpeg" alt="Horarios de atención de RikoPollo" className="mx-auto w-full max-w-md rounded-3xl border-4 border-[#27160b] shadow-2xl" />
          <div>
            <p className="text-sm font-black uppercase tracking-[0.25em] text-[#542b09]">Cuándo encontrarnos</p>
            <h2 className="mt-3 text-4xl font-black text-[#1b110b] sm:text-5xl">Horarios de atención</h2>
            <div className="mt-8 space-y-4">
              {schedules.map((schedule) => (
                <div key={schedule.days} className="rounded-2xl border-2 border-[#2c190c]/15 bg-[#fff2d5] p-5 sm:flex sm:items-center sm:justify-between sm:gap-8">
                  <div className="flex items-start gap-3"><Clock3 className="mt-1 h-5 w-5 shrink-0 text-[#b85307]" /><p className="font-black">{schedule.days}</p></div>
                  <div className="mt-3 flex flex-wrap gap-2 sm:mt-0 sm:justify-end">{schedule.hours.map((hour) => <span key={hour} className="rounded-lg bg-[#21140c] px-3 py-2 font-mono text-sm font-bold text-white">{hour}</span>)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="ubicacion" className="scroll-mt-24 bg-[#fff8e9] px-5 py-20 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-3">
          <div className="rounded-3xl bg-[#1a1511] p-7 text-white lg:col-span-2">
            <MapPin className="h-9 w-9 text-[#ffb914]" /><h2 className="mt-6 text-4xl font-black">Estamos en Misiones</h2><p className="mt-4 text-lg text-white/70">Av. Las Américas 123, Misiones, Argentina.</p>
            <a href="https://www.google.com/maps/search/?api=1&query=Av.%20Las%20Am%C3%A9ricas%20123%2C%20Misiones%2C%20Argentina" target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 font-black text-[#ffbd20] hover:text-[#ffd777]">Cómo llegar <ArrowRight className="h-4 w-4" /></a>
          </div>
          <div className="rounded-3xl border border-[#704415]/15 bg-[#f7ead3] p-7">
            <Instagram className="h-9 w-9 text-[#ce5f0a]" /><h2 className="mt-6 text-2xl font-black">Seguinos</h2><p className="mt-3 text-[#674832]">Novedades, promos y todo lo que sale de nuestra cocina.</p><a href="https://www.instagram.com/riko.pollo_/" target="_blank" rel="noreferrer" className="mt-6 inline-flex font-black text-[#b34f08] hover:text-[#de790c]">@riko.pollo_</a>
          </div>
        </div>
      </section>

      <section className="bg-[#5a3517] px-5 py-16 text-center text-white sm:px-8">
        <div className="mx-auto max-w-3xl"><h2 className="text-4xl font-black sm:text-5xl">¿Ya elegiste?</h2><p className="mt-4 text-lg text-white/75">Escribinos por WhatsApp y prepará tu pedido para retirar.</p><a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-8 inline-flex min-h-[3.25rem] items-center gap-2 rounded-xl bg-[#ffbd20] px-7 py-3 font-black text-[#24150b] hover:bg-[#ffd063] hover:text-[#24150b]"><MessageCircle className="h-5 w-5" /> 3755 437366</a></div>
      </section>
    </main>

    <footer className="bg-[#110f0d] px-5 py-9 text-white/60 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 text-sm sm:flex-row"><p>© {new Date().getFullYear()} RikoPollo · Sabor que da gusto.</p><Link to="/signin" className="inline-flex items-center gap-2 text-xs font-semibold text-white/45 transition hover:text-[#ffbd20]"><LockKeyhole className="h-3.5 w-3.5" /> Acceso al personal</Link></div>
    </footer>
  </div>
);

export default LandingPage;
