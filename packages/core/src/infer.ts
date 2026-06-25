/**
 * Compile-time inference from JSON Schema literals to data shapes and field paths.
 *
 * Bounded coverage: common object/array/primitive/enum/const constructs only.
 * Unsupported keywords and schema shapes degrade to `unknown` rather than erroring.
 */

/** Maximum nesting depth for {@link FieldPath} dot-path expansion. */
type FieldPathDepthLimit = 5

type DecrementDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
type NextDepth<D extends number> = DecrementDepth[D]

type JoinPath<Prefix extends string, Key extends string> = Prefix extends ''
  ? Key
  : `${Prefix}.${Key}`

type RequiredKeys<S> = S extends { readonly required: readonly (infer K)[] }
  ? K extends string
    ? K
    : never
  : never

type InferObjectData<
  P extends Record<string, unknown>,
  Req extends string,
> = {
  [K in keyof P & string as K extends Req ? K : never]: InferSchemaData<P[K]>
} & {
  [K in keyof P & string as K extends Req ? never : K]?: InferSchemaData<P[K]>
}

type InferSchemaData<S> = S extends { readonly const: infer C }
  ? C
  : S extends { readonly enum: readonly (infer E)[] }
    ? E
    : S extends {
          readonly type: 'object'
          readonly properties: infer P extends Record<string, unknown>
        }
      ? InferObjectData<P, RequiredKeys<S>>
      : S extends { readonly properties: infer P extends Record<string, unknown> }
        ? InferObjectData<P, RequiredKeys<S>>
        : S extends { readonly type: 'array'; readonly items: infer I }
          ? readonly InferSchemaData<I>[]
          : S extends { readonly type: 'string' }
            ? string
            : S extends { readonly type: 'number' | 'integer' }
              ? number
              : S extends { readonly type: 'boolean' }
                ? boolean
                : S extends { readonly type: 'null' }
                  ? null
                  : unknown

type FieldPathFromProperties<
  P extends Record<string, unknown>,
  Prefix extends string,
  Depth extends number,
> = {
  [K in keyof P & string]:
    | JoinPath<Prefix, K>
    | FieldPathFromSchema<P[K], JoinPath<Prefix, K>, NextDepth<Depth>>
}[keyof P & string]

type FieldPathFromSchema<
  S,
  Prefix extends string = '',
  Depth extends number = FieldPathDepthLimit,
> = Depth extends 0
  ? never
  : S extends {
        readonly type: 'object'
        readonly properties: infer P extends Record<string, unknown>
      }
    ? FieldPathFromProperties<P, Prefix, Depth>
    : S extends { readonly properties: infer P extends Record<string, unknown> }
      ? FieldPathFromProperties<P, Prefix, Depth>
      : S extends { readonly type: 'array'; readonly items: infer I }
        ? Prefix extends ''
          ? never
          : Prefix | FieldPathFromSchema<I, Prefix, NextDepth<Depth>>
        : never

/**
 * Maps a `const`-typed JSON Schema literal to its corresponding data type.
 *
 * Supports: object (with `properties` / `required`), array (`items`), primitives,
 * `enum`, and `const`. Everything else resolves to `unknown`.
 */
export type InferData<S> = InferSchemaData<S>

/**
 * String-literal union of dot-paths into schema data (e.g. `"address.street"`).
 *
 * Recursion is bounded by {@link FieldPathDepthLimit}. Paths through array items
 * use the array property prefix plus item field names (e.g. `"users.name"`).
 */
export type FieldPath<S> = FieldPathFromSchema<S>
