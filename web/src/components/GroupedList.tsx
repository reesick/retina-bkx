import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Group({ header, footer, children, className = "" }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {header && <h3 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-l2">{header}</h3>}
      <div className="overflow-hidden rounded-card bg-s1 [&>*+*]:border-t [&>*+*]:border-sep/70" style={{ ["--tw-border-opacity" as string]: 1 }}>
        {children}
      </div>
      {footer && <p className="mt-2 px-4 text-footnote text-l2">{footer}</p>}
    </section>
  );
}

export function Row({
  label, value, chevron, onClick, to, danger, right, icon, sub, className = "",
}: {
  label: ReactNode; value?: ReactNode; chevron?: boolean; onClick?: () => void; to?: string; danger?: boolean; right?: ReactNode;
  icon?: ReactNode; sub?: ReactNode; className?: string;
}) {
  const inner = (
    <>
      {icon && <span className="mr-3 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-s2 text-white/80">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block break-words text-[16px] ${danger ? "text-urgent" : "text-white"}`}>{label}</span>
        {sub && <span className="block break-words text-footnote leading-snug text-l2">{sub}</span>}
      </span>
      {value != null && <span className="ml-3 shrink-0 text-[15px] text-l2 num">{value}</span>}
      {right && <span className="ml-3 shrink-0">{right}</span>}
      {(chevron || to) && <ChevronRight className="ml-2 h-4 w-4 shrink-0 text-l3" />}
    </>
  );
  const cls = `flex min-h-[52px] w-full items-center px-4 py-2 text-left ${onClick || to ? "transition-colors hover:bg-white/[0.04] active:bg-white/[0.07]" : ""} ${className}`;
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}
