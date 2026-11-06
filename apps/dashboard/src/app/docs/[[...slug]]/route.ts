import { NextResponse } from 'next/server'

const DOCS_URL = 'https://chainpe.vercel.app/docs'

export function GET() {
  return NextResponse.redirect(DOCS_URL, 308)
}
