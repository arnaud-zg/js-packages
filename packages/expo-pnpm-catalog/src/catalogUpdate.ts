export type VersionChange = {
  name: string;
  from: string;
  to: string;
};

export class CatalogUpdate {
  readonly name: string;
  readonly from: string;
  readonly to: string;

  constructor({ name, from, to }: VersionChange) {
    this.name = name;
    this.from = from;
    this.to = to;
  }

  static between(change: VersionChange): CatalogUpdate | null {
    if (!change.from || !change.to || change.from === change.to) return null;
    return new CatalogUpdate(change);
  }
}
