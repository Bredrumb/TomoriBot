/**
 * Base contract every repository must satisfy.
 *
 * TExport — the shape returned by toExportShape() and expected by fromExportShape()
 *
 * All repositories must implement both export methods from day one.
 * Phase 6 (#16.7) replaces the old god-table export pipeline by composing
 * per-repository toExportShape() calls — any repository that ships without
 * them requires a second touch during that phase.
 */
export interface IRepository<TExport = unknown> {
  /**
   * Serializes this repository's portion of a data export for a given owner.
   * Returns null when the owner has no data in this repository (not an error).
   *
   * @param ownerId - Discord snowflake or internal DB ID identifying the export subject
   */
  toExportShape(ownerId: string | number): Promise<TExport | null>;

  /**
   * Deserializes and writes back a previously exported shape.
   * Must be idempotent — re-importing the same shape must not create duplicates.
   *
   * @param ownerId - Discord snowflake or internal DB ID of the import target
   * @param data    - The previously exported shape to restore
   * @returns true on success, false on validation or write failure
   */
  fromExportShape(ownerId: string | number, data: TExport): Promise<boolean>;
}
