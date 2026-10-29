import type { IncomingMessage } from "node:http";
import type net from "node:net";
import type { WebSocketServer } from "ws";

// Node runs every "upgrade" listener for every request. The service proxy claims
// upgrades addressed to a workspace service; the daemon's own listener must then
// leave them alone, or it answers 400 on top of the proxied connection.
const serviceProxyUpgrades = new WeakSet<IncomingMessage>();

export function claimUpgradeForServiceProxy(req: IncomingMessage): void {
  serviceProxyUpgrades.add(req);
}

export function isServiceProxyUpgrade(req: IncomingMessage): boolean {
  return serviceProxyUpgrades.has(req);
}

// Replaces `new WebSocketServer({ server, path })`, whose built-in listener rejects
// every upgrade on another path with 400, including ones the service proxy claimed.
export function createDaemonUpgradeListener({
  wss,
  path,
}: {
  wss: WebSocketServer;
  path: string;
}): (req: IncomingMessage, socket: net.Socket, head: Buffer) => void {
  return (req, socket, head) => {
    if (isServiceProxyUpgrade(req)) {
      return;
    }
    if (requestPathname(req) !== path) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
}

function requestPathname(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function rejectUpgrade(socket: net.Socket, status: number, message: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.once("finish", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/html\r\nContent-Length: ${message.length}\r\n\r\n${message}`,
  );
}
