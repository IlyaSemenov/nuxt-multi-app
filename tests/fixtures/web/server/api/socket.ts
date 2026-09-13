export default defineWebSocketHandler({
  open(peer) {
    peer.send("web")
  },
})
