/** Runs `work` on every item, at most `limit` at once; results in input order, rejects like Promise.all. */
export const mapLimit = async <Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> => {
  const results = new Array<Result>(items.length);
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await work(item, index);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
