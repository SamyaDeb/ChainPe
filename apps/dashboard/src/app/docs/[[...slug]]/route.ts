import { readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { NextRequest, NextResponse } from 'next/server'

const DOCS_ROOT = resolve(process.cwd(), 'public', 'docs')

function safeJoin(...segments: string[]): string | null {
  const resolved = resolve(DOCS_ROOT, ...segments)
  if (resolved !== DOCS_ROOT && !resolved.startsWith(DOCS_ROOT + sep)) {
    return null
  }
  return resolved
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await params
  const segments = slug ?? []

  const htmlFile = safeJoin(...segments)
  if (htmlFile === null) {
    return new NextResponse('Not found', { status: 404 })
  }

  const candidates = [
    htmlFile + '.html',
    join(htmlFile, 'index.html'),
    // SPA fallback — Docusaurus handles routing client-side
    join(DOCS_ROOT, 'index.html'),
  ]

  for (const candidate of candidates) {
    try {
      const html = readFileSync(candidate)
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    } catch {
      // try next candidate
    }
  }

  return new NextResponse('Not found', { status: 404 })
}
