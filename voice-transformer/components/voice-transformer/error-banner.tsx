"use client";

import type { ReactNode } from "react";
import { AlertIcon } from "@/components/ui/icons";
import type { UserFacingError } from "@/types/audio";

type ErrorBannerProps = {
  error: UserFacingError;
  actions?: ReactNode;
};

export function ErrorBanner({ error, actions }: ErrorBannerProps) {
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-danger">
          <AlertIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{error.title}</p>
          <p className="mt-1 text-sm text-muted">{error.message}</p>
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}
