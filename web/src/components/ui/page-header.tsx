import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * PageContainer — vertical rhythm wrapper for a page's content. The horizontal
 * max-width + gutters already come from MainLayout; this just provides
 * consistent vertical spacing between stacked sections.
 */
export function PageContainer({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-w-0 space-y-5 sm:space-y-7 lg:space-y-8", className)} {...props}>
      {children}
    </div>
  );
}

/**
 * PageHeader — the standard page title block.
 *
 *   <PageHeader
 *     eyebrow="Operations"
 *     title="Menu"
 *     description="Manage what your customers can order."
 *     actions={<Button>New item</Button>}
 *   />
 *
 * The title renders in Inter at display weight (font-display), matching the rest of the app.
 * `icon` (a lucide component) renders in a soft branded chip to the left.
 */
interface PageHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  titleClassName?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
  className,
  titleClassName,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 sm:h-11 sm:w-11 sm:rounded-2xl">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "font-display break-words text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl text-balance",
              titleClassName
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-[0.95rem] text-pretty">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1 lg:w-auto lg:max-w-full lg:[&>*]:flex-none">{actions}</div>
      )}
    </div>
  );
}

export default PageHeader;
