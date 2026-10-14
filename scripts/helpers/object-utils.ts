/**
 * @file
 *
 * The one helper the vendored `eslint-rules/ts-estree-node.ts` needs from `obsidian-dev-utils`' `object-utils.ts`.
 */

/**
 * Casts a value to a specific type.
 *
 * @typeParam T - The target type to cast to.
 * @param value - The value to cast.
 * @returns The value as the specified type.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- We need to cast.
export function castTo<T>(value: unknown): T {
  return value as T;
}
