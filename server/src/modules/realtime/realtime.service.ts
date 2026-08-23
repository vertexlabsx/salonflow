type RealtimeListener = (event: string, data: unknown) => void;

const subscribers = new Map<string, Set<RealtimeListener>>();

export function subscribeRealtime(salonId: string, listener: RealtimeListener): () => void {
  let set = subscribers.get(salonId);
  if (!set) {
    set = new Set();
    subscribers.set(salonId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) subscribers.delete(salonId);
  };
}

export function publishRealtimeEvent(salonId: string, event: string, data: unknown): void {
  const set = subscribers.get(salonId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event, data);
    } catch {
      set.delete(listener);
    }
  }
}
