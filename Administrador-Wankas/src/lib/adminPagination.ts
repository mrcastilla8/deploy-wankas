const pageSize = 500;

type Page<Row> = { data: Row[] | null; error: unknown };

export async function collectAdminRows<Row extends { id: string }>(
  readPage: (limit: number, afterId: string | undefined) => PromiseLike<Page<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let afterId: string | undefined;

  while (true) {
    const { data, error } = await readPage(pageSize, afterId);
    if (error || !data) throw new Error('Admin list query failed');
    // PostgREST can return fewer rows than requested even when more remain.
    if (data.length === 0) return rows;

    const lastId = data[data.length - 1].id;
    if (afterId !== undefined && lastId <= afterId) throw new Error('Admin list cursor did not advance');
    rows.push(...data);
    afterId = lastId;
  }
}
