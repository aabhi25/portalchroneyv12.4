import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * useState that is remembered in browser storage and shared by every component using the same key
 * (e.g. the group picked in the sidebar and the page showing that group's leads).
 *
 * "session" storage lasts for the browser tab (filters); "local" storage survives reloads (the
 * picked group). Storage can be missing or blocked, so every read and write is optional.
 */
type Store = "session" | "local";
const EVENT = "sticky-state-change";

function storage(store: Store): Storage | null {
  try {
    return store === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(store: Store, key: string, fallback: T): T {
  try {
    const raw = storage(store)?.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function useStickyState<T>(key: string, fallback: T, store: Store = "session"): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(store, key, fallback));

  // Other components using the same key follow along.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: T }>).detail;
      if (detail?.key === key) setValue(detail.value);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [key]);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        if (resolved === undefined) storage(store)?.removeItem(key);
        else storage(store)?.setItem(key, JSON.stringify(resolved));
      } catch { /* storage blocked: still works for this page */ }
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value: resolved } })));
      return resolved;
    });
  }, [key, store]);

  return [value, set];
}

/** A remembered optional date (stored as text). */
export function useStickyDate(key: string): [Date | undefined, (value: Date | undefined) => void] {
  const [iso, setIso] = useStickyState<string | undefined>(key, undefined);
  // Same Date object until the value changes (pages compare filters by identity).
  const date = useMemo(() => {
    const d = iso ? new Date(iso) : undefined;
    return d && !isNaN(d.getTime()) ? d : undefined;
  }, [iso]);
  const set = useCallback((d: Date | undefined) => setIso(d ? d.toISOString() : undefined), [setIso]);
  return [date, set];
}

/** The group a group admin is looking at (picked in the sidebar), remembered on this device. */
export function useGroupAdminGroupId(): [string | null, (groupId: string) => void] {
  return useStickyState<string | null>("groupAdmin.groupId", null, "local");
}
