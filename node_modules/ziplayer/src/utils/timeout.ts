/**
 * Utility function to add timeout to a promise
 * @param promise The promise to add timeout to
 * @param timeoutMs Timeout in milliseconds
 * @param message Error message when timeout occurs
 * @returns Promise that rejects if timeout is reached
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))]);
}
