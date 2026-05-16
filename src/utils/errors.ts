/**
 * Safely extract a printable message from any thrown value. Discord.js usually
 * throws `Error` subclasses, but rejected promises and `throw "string"` paths
 * still happen — this helper keeps every call-site one line.
 */
export function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'unknown';
}
