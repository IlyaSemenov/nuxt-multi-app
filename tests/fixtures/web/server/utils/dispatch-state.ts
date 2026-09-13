export const dispatchState = {
  generation: crypto.randomUUID(),
  cancelled: 0,
  produced: 0,
  slowStarted: 0,
  transaction: undefined as string | undefined,
}
