/**
 * @file
 *
 * Where the metadata worker reads a markdown link's destination as a path in the vault, and how it fails.
 */

/**
 * What makes the metadata worker throw: a front matter string that is a markdown link with no destination, or a front
 * matter object with a key `hasOwnProperty`.
 */
export type WorkerFailureTrigger = 'blankLinkDestination' | 'hasOwnPropertyKey';

/**
 * Thrown where the metadata worker throws while it builds the metadata, so it posts `null` for the document.
 */
export class WorkerFailure extends Error {
  /**
   * Creates the failure.
   *
   * @param trigger - What makes the worker throw.
   * @param message - Where the worker throws.
   */
  public constructor(public readonly trigger: WorkerFailureTrigger, message: string) {
    super(message);
    this.name = 'WorkerFailure';
  }
}

/**
 * Whether a markdown link's destination is a path in the vault rather than a URL: it starts with `./` or `../`, or it
 * holds no `:`.
 *
 * @param destination - The destination.
 * @returns Whether it is a path.
 */
export function isLinkPath(destination: string): boolean {
  return destination.startsWith('./') || destination.startsWith('../') || !destination.includes(':');
}
