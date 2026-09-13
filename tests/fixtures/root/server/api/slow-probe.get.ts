export default defineEventHandler(async (event) => {
  event.node.res.writeHead(200, { "content-type": "text/plain" })
  event.node.res.write("BEGIN\n")
  await new Promise((resolve) => event.node.res.once("close", resolve))
})
