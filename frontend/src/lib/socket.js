/**
 * Close a WebSocket without the browser's "closed before the connection is
 * established" warning. React runs effect cleanups while a socket may still
 * be connecting (always, in development's double-mount); closing then logs
 * a console warning, so wait for it to open and close it immediately after.
 */
export function closeSocket(ws) {
  if (!ws) return
  ws.onmessage = null
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.onopen = () => ws.close()
    ws.onerror = () => {}
  } else if (ws.readyState === WebSocket.OPEN) {
    ws.close()
  }
}
