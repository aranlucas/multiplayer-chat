function notInitialized(): never {
  throw new Error("Promise not initialized");
}

export function deferred<T>() {
  let resolvePromise: (value: T) => void = notInitialized;

  let rejectPromise: (cause: unknown) => void = notInitialized;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
