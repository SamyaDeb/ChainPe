import { source } from '@/lib/source';
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import defaultMdxComponents from 'fumadocs-ui/mdx';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <div role="note" className="rounded-lg border p-4 text-sm">
        <strong>These pages describe the June 2026 Avalanche version of ChainPe.</strong> ChainPe now runs on Arc, and
        these docs have not been rewritten yet. For the current version, see the{' '}
        <a className="underline underline-offset-4" href="https://github.com/SamyaDeb/ChainPe#readme">README</a> and the{' '}
        <a className="underline underline-offset-4" href="https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/TRY-IT.md">5-minute guide</a>.
      </div>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
