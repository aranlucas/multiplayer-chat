export function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {
    throw new Error("Promise not initialized");
  };

  let rejectPromise: (cause: unknown) => void = () => {
    throw new Error("Promise not initialized");
  };

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
