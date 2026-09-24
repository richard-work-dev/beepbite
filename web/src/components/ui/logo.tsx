// Logo — two lockups: `minimal` (top bar, small) and `default` (auth pages,
// empty states). The old "default" mark carried a pulsing red notification
// dot on the icon tile — a leftover from BeepBite's earlier life as a table-
// ready notifier. That's gone: this is a point-of-sale now, and a badge that
// reads "something needs your attention" has no business sitting on the
// wordmark of every screen.
interface LogoProps {
  className?: string;
  variant?: "default" | "minimal";
}

const Logo = ({ className = "", variant = "default" }: LogoProps) => {
  if (variant === "minimal") {
    return (
      <div className={`flex items-center ${className}`}>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-primary/30 bg-card shadow-card">
          <img src="/rikopollo/logo.jpeg" alt="" className="h-full w-full object-cover" />
        </div>
        <span className="font-display ml-3 text-2xl leading-none">
          <span className="text-foreground">Riko</span>
          <span className="text-primary">Pollo</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`text-center ${className}`}>
      <div className="mb-4 flex items-center justify-center">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-primary/30 bg-card shadow-elevated">
          <img src="/rikopollo/logo.jpeg" alt="RikoPollo" className="h-full w-full object-cover" />
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-4xl leading-none sm:text-5xl">
          <span className="text-foreground">Riko</span>
          <span className="text-primary">Pollo</span>
        </h1>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground sm:text-base">
          Sabor que da gusto
        </p>
      </div>
    </div>
  );
};

export default Logo;
