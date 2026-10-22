"use client";

import { useCallback, useState, useSyncExternalStore, type SetStateAction } from "react";
import { operationSnapshot, projectEntityRows, serverOperationSnapshot, subscribeOperations } from "@/lib/adminOperations";

type Row = Record<string, any>;
export function useOptimisticProjection<T extends Row>(base: T[], entity: string, scope: Record<string, string> = {}, insert = true) {
  const all = useSyncExternalStore(subscribeOperations, operationSnapshot, serverOperationSnapshot);
  const operations = insert ? all : all.filter((operation) => operation.change?.method !== "POST" || base.some((row) => row.id === operation.result?.id));
  return projectEntityRows(base, operations, entity, scope);
}
export function useOptimisticEntityRows<T extends Row>(entity: string, scope: Record<string, string> = {}) {
  const [base, setBase] = useState<T[]>([]);
  return [useOptimisticProjection(base, entity, scope), setBase] as const;
}
export function useOptimisticEntityRow<T extends Row>(entity: string) {
  const [base, setBase] = useState<T | null>(null);
  const rows = useOptimisticProjection(base ? [base] : [], entity, {}, false);
  const setRow = useCallback((value: SetStateAction<T | null>) => setBase(value), []);
  return [rows[0] ?? null, setRow] as const;
}
