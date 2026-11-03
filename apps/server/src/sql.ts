import type { Database, SQLQueryBindings } from "bun:sqlite";

/**
 * Typed wrappers over `db.query`. The row type is the caller's claim about the
 * SELECT list, so keep each row type next to the query that produces it.
 */
export const one = <Row>(db: Database, sql: string, ...params: SQLQueryBindings[]): Row | null =>
  db.query<Row, SQLQueryBindings[]>(sql).get(...params);

export const all = <Row>(db: Database, sql: string, ...params: SQLQueryBindings[]): Row[] =>
  db.query<Row, SQLQueryBindings[]>(sql).all(...params);

/** First column of the first row (`SELECT COUNT(*)`, `SELECT MAX(...)`), or `fallback` when there is no row or the value is NULL. */
export const scalar = <T extends number | string>(db: Database, sql: string, fallback: T, ...params: SQLQueryBindings[]): Widen<T> =>
  (db.query<[Widen<T> | null], SQLQueryBindings[]>(sql).values(...params)[0]?.[0] ?? fallback) as Widen<T>;

/** `0` widens to `number`, `""` to `string`: the fallback fixes the column's kind, not its value. */
type Widen<T> = T extends number ? number : T extends string ? string : T;

export const exists = (db: Database, sql: string, ...params: SQLQueryBindings[]): boolean =>
  db.query<Record<string, never>, SQLQueryBindings[]>(sql).get(...params) !== null;

export const run = (db: Database, sql: string, ...params: SQLQueryBindings[]) =>
  db.query<never, SQLQueryBindings[]>(sql).run(...params);
