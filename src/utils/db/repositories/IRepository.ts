export interface IRepository<TExport = unknown> {
  // Empty repository slices return null rather than an error, so callers treat null as absent data.
  toExportShape(ownerId: string | number): Promise<TExport | null>;

  // Implementations must be idempotent because re-importing the same export shape must not create duplicates.
  fromExportShape(ownerId: string | number, data: TExport): Promise<boolean>;
}
