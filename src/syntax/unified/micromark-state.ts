/**
 * @file
 *
 * The result of a micromark state function, named once for the constructs written against micromark.
 */

import type { State } from 'micromark-util-types';

/**
 * What a micromark `State` returns: the next state, or `undefined` once the construct is done. micromark's own
 * `State` type dictates the `undefined`, so a state function declared on its own is typed by this rather than spelling
 * the union, which a "no value" return of ours would spell with `null`.
 */
export type StateResult = ReturnType<State>;
