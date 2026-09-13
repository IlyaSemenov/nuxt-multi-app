export default defineEventHandler(async (event) => {
  dispatchState.produced = 0
  const encoder = new TextEncoder()
  const chunk = (index: number) => encoder.encode(`${index}:${"x".repeat(65_536)}\n`)
  if (import.meta.dev) {
    event.node.res.writeHead(200, { "content-type": "text/plain" })
    for (let index = 1; index <= 64 && !event.node.res.closed; index++) {
      dispatchState.produced = index
      if (!event.node.res.write(chunk(index))) {
        await new Promise((resolve) => event.node.res.once("drain", resolve))
      }
    }
    event.node.res.end()
    return
  }
  return new Response(
    new ReadableStream({
      pull(controller) {
        dispatchState.produced++
        controller.enqueue(chunk(dispatchState.produced))
        if (dispatchState.produced === 64) controller.close()
      },
    }),
    { headers: { "content-type": "text/plain" } },
  )
})
