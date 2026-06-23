// Cross-tab session-list sync. Each browser tab is its own renderer process
// with its own gateway socket and session store, so a mutation in one (e.g. a
// new chat started while another tab is open) never reaches the others.
// This bus pings every tab to re-pull the shared session list; the data
// already lives in the backend, the other tab just doesn't know to look.
const CHANNEL = 'verxio:sessions'

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)

// A tab that mutated the session list (created / titled a chat) tells the
// others to refresh. A BroadcastChannel never delivers to its own poster, so the
// caller refreshes locally as it already does.
export function broadcastSessionsChanged(): void {
  channel?.postMessage(1)
}

export function onSessionsChanged(handler: () => void): () => void {
  if (!channel) {
    return () => {}
  }

  channel.addEventListener('message', handler)

  return () => channel.removeEventListener('message', handler)
}
