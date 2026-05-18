export async function retryWithBreaker<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    intervalMs: number = 5000
  ): Promise<{ success: boolean; result?: T; lastError?: any }> {
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fn();
        return { success: true, result };
      } catch (err) {
        lastError = err;
        await new Promise(res => setTimeout(res, intervalMs));
      }
    }

    return { success: false, lastError };
  }
