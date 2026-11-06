import type { ReactNode } from 'react'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
}

/**
 * One table that turns into stacked cards below 640 px. Each cell carries its header
 * as a visible label on small screens.
 */
export function DataTable<T>({ columns, rows, rowKey, caption }: { columns: Array<Column<T>>; rows: T[]; rowKey: (row: T) => string; caption: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="block w-full border-collapse text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden border-b border-line bg-subtle sm:table-header-group">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="block border-b border-line p-4 last:border-b-0 sm:table-row sm:p-0">
              {columns.map((c) => (
                <td
                  key={c.header}
                  data-label={c.header}
                  className="flex items-start justify-between gap-4 py-1 before:shrink-0 before:text-xs before:text-muted before:content-[attr(data-label)] sm:table-cell sm:px-4 sm:py-3 sm:align-top sm:before:hidden"
                >
                  <div className="min-w-0 break-words text-right sm:text-left">{c.cell(row)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
