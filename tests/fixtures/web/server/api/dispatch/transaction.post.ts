export default defineEventHandler(() => {
  dispatchState.transaction = crypto.randomUUID()
  return { generation: dispatchState.generation, transaction: dispatchState.transaction }
})
