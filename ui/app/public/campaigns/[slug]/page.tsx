import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { FeedClient } from './FeedClient';

const API_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

async function fetchFeed(slug: string) {
  const res = await fetch(`${API_URL}/api/public/campaigns/${encodeURIComponent(slug)}/feed`, {
    next: { revalidate: 5 },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchFeed(slug);
  return {
    title: data?.campaign?.name ?? 'Feed público — Orkestai Voice',
    description: data?.campaign?.description ?? 'Resultados en tiempo real',
  };
}

export default async function PublicFeedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const initialData = await fetchFeed(slug);
  if (!initialData) notFound();
  return <FeedClient slug={slug} initialData={initialData} />;
}
