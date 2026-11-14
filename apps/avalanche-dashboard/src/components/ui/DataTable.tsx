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
    <div className="rise overflow-x-auto border border-ink/10 bg-surface">
      <table className="block w-full border-collapse text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden border-b border-ink/10 sm:table-header-group">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className="whitespace-nowrap px-6 py-4 text-left font-mono text-xs font-normal text-muted">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="row-in block border-b border-ink/10 p-6 transition-colors duration-300 last:border-b-0 hover:bg-ink/[0.03] sm:table-row sm:p-0">
              {columns.map((c) => (
                <td
                  key={c.header}
                  data-label={c.header}
                  className="flex items-start justify-between gap-4 py-1 before:shrink-0 before:font-mono before:text-xs before:text-muted before:content-[attr(data-label)] sm:table-cell sm:px-6 sm:py-4 sm:align-top sm:before:hidden"
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
