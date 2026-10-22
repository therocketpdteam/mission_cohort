"use client";

import type { ReactNode } from "react";
import { OperationNotifications } from "@/components/layout/OperationNotifications";

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}<OperationNotifications /></>;
}
