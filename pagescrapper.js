import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import fs from 'fs';

// List of sitemap URLs
const sitemaps = [
  'http://1stlatinwomen.local:8080/sitemap_root.xml',
  'http://1stlatinwomen.local:8080/sitemap_blog_dating.xml'
];

// Fetch URLs from a sitemap (non-recursive)
async function getUrlsFromSitemap(sitemapUrl) {
  try {
    const response = await axios.get(sitemapUrl);
    const xml = response.data;
    const result = await parseStringPromise(xml);

    // Only get URLs listed directly under <urlset>
    const urls = result.urlset.url.map(u => u.loc[0]);
    return urls;
  } catch (err) {
    console.error(`Error fetching/parsing sitemap: ${sitemapUrl}`, err);
    return [];
  }
}

(async () => {
  const allUrls = [];

  for (const sitemap of sitemaps) {
    console.log(`Fetching sitemap: ${sitemap}`);
    const urls = await getUrlsFromSitemap(sitemap);
    console.log(`Found ${urls.length} URLs in sitemap: ${sitemap}`);
    allUrls.push(...urls);
  }

  // Write all URLs to pages.json
  fs.writeFileSync('pages.json', JSON.stringify(allUrls, null, 2), 'utf-8');
  console.log(`All URLs saved to pages.json (${allUrls.length} URLs)`);
})();
