import { readFile } from 'node:fs/promises';
import { SiteSchema, type Site } from '@mcpify/contracts';
import { fromRoot } from './paths.js';

/** Sites known before the API exists (01-CONTRACTS §15): fixtures/sites.json. */
export async function loadSites(path = fromRoot('fixtures/sites.json')): Promise<Site[]> {
  try {
    return SiteSchema.array().parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return [];
  }
}

export async function siteBySlug(slug: string): Promise<Site | undefined> {
  return (await loadSites()).find(s => s.slug === slug);
}

export async function siteByOrigin(origin: string): Promise<Site | undefined> {
  return (await loadSites()).find(s => s.origin === origin);
}
