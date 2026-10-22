"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type SetStateAction } from "react";
import { operationSnapshot, projectEntityRows, serverOperationSnapshot, subscribeOperations } from "@/lib/adminOperations";

type Row = Record<string, any>;
export function useOptimisticProjection<T extends Row>(base: T[], entity: string, scope: Record<string, string> = {}, insert = true) {
  const [acknowledged, setAcknowledged] = useState(new Set<string>());
  const all = useSyncExternalStore(subscribeOperations, operationSnapshot, serverOperationSnapshot);
  const operations = insert ? all : all.filter((operation) => operation.change?.method !== "POST" || base.some((row) => row.id === operation.result?.id));
  useEffect(() => {
    const seen = operations.filter((operation) => {
      if (operation.change?.entity !== entity || operation.state === "pending" || operation.state === "error" || acknowledged.has(operation.id)) return false;
      const change = operation.change;
      const id = change.id ?? operation.result?.id;
      if (change.method === "DELETE") return !base.some((row) => row.id === id);
      const saved = base.find((row) => row.id === id);
      if (!saved) return false;
      if (operation.result?.updatedAt && saved.updatedAt && new Date(saved.updatedAt) >= new Date(operation.result.updatedAt)) return true;
      return Object.entries(change.values).every(([key, value]) => JSON.stringify(saved[key] ?? null) === JSON.stringify(value ?? null));
    });
    if (seen.length) setAcknowledged((old) => new Set([...old, ...seen.map((operation) => operation.id)]));
  }, [base, all, entity, acknowledged]); // derived operations are filtered from all
  return projectEntityRows(base, operations, entity, scope, acknowledged);
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
