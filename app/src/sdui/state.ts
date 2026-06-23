/**
 * Per-screen state store. Holds the screen's `state` object, supports dot-path
 * get/set, and notifies subscribers so bound Nodes re-render.
 */
import { useEffect, useState } from "react";

export function getPath(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function setPath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== "object" || cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

export class Store {
  private data: Record<string, any>;
  private listeners = new Set<() => void>();
  version = 0;

  constructor(initial: Record<string, any> = {}) {
    this.data = JSON.parse(JSON.stringify(initial));
  }

  get(path: string): any {
    return getPath(this.data, path);
  }

  set(path: string, value: any): void {
    setPath(this.data, path, value);
    this.emit();
  }

  toggle(path: string): void {
    this.set(path, !this.get(path));
  }

  snapshot(): Record<string, any> {
    return this.data;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

/** Re-render the calling component whenever the store changes. */
export function useStoreVersion(store: Store): number {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);
  return store.version;
}
