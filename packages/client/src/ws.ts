// ============================================================================
// @dce/client — Cliente WebSocket con reconexión exponencial.
// Eventos del servidor: hello, country_created, tick, famine.
// ============================================================================

export interface WsHandlers {
  onCountryCreated?: (payload: { country: { id: string; name: string; color: string } }) => void;
  onTick?: (payload: { nextTickAt: number; tickSeconds: number }) => void;
  onFamine?: (payload: { countryId: string }) => void;
  onNews?: (payload: { event: { message: string } }) => void;
  onOpen?: () => void;
}

export function connectWs(handlers: WsHandlers): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const connect = () => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      handlers.onOpen?.();
    };
    ws.onmessage = (ev) => {
      let msg: { type: string; payload: any };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === 'country_created') handlers.onCountryCreated?.(msg.payload);
      if (msg.type === 'tick') handlers.onTick?.(msg.payload);
      if (msg.type === 'famine') handlers.onFamine?.(msg.payload);
      if (msg.type === 'news') handlers.onNews?.(msg.payload);
    };
    ws.onclose = () => {
      if (!closed) {
        const delay = Math.min(30_000, 1_000 * 2 ** retry);
        retry += 1;
        setTimeout(connect, delay);
      }
    };
    ws.onerror = () => ws?.close();
  };

  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
