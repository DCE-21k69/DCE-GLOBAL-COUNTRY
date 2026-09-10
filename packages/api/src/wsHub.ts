// ============================================================================
// @dce/api — Hub de WebSockets: eventos del mundo a todos los clientes.
// En producción esto migraría a Redis pub/sub (docs/01 §3); la interfaz de
// broadcast ya está aislada para que ese cambio no toque el resto del código.
// ============================================================================

import { WebSocket } from 'ws';

export class WsHub {
  private sockets = new Set<WebSocket>();

  connect(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify({ type: 'hello', payload: { at: Date.now() } }));
  }

  disconnect(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  broadcast(type: string, payload: unknown): void {
    const message = JSON.stringify({ type, payload, at: Date.now() });
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  get clientCount(): number {
    return this.sockets.size;
  }
}
