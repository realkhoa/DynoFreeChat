/** A row type usable as the type argument of `SqlStorageCursor`. */
export type SqlRow<T> = T & Record<string, string | number | null>;
