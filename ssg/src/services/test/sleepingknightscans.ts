import { Manga } from 'src/classes/manga'
import { BaseSite } from 'src/classes/sites/baseSite'
import { SiteType } from 'src/enums/siteEnum'
import { getMangaInfo, getSite, searchManga } from '../siteService'
import { mangaEqual, searchValid } from '../testService'

const SITE_TYPE = SiteType.SleepingKnightScans
const QUERY = 'chronicles of the martial god\'s return'

export async function testSleepingKnightScans (): Promise<void> {
  const site = getSite(SITE_TYPE)
  if (!site) throw Error('Site not found')

  await readUrl(site)
  await search(site)
}

async function readUrl (site: BaseSite): Promise<void> {
  const manga = await getMangaInfo(site.getTestUrl(), SITE_TYPE)
  const desired = new Manga(site.getTestUrl(), SITE_TYPE)
  desired.chapter = 'Chapter 45'
  desired.image = 'https://skscans.com/wp-content/uploads/2022/09/COVER.jpg'
  desired.title = 'Chronicles of the Martial God’s Return'
  desired.chapterUrl = 'https://skscans.com/manga/chronicles-of-the-martial-gods-return/chapter-45/'
  desired.chapterNum = 45
  desired.chapterDate = '8 months ago'

  mangaEqual(manga, desired)
}

async function search (site: BaseSite): Promise<void> {
  const results = await searchManga(QUERY, SITE_TYPE)
  const desired = new Manga(site.getTestUrl(), SITE_TYPE)
  desired.image = 'https://skscans.com/wp-content/uploads/2022/09/COVER-193x278.jpg'
  desired.chapter = 'Chapter 45'
  desired.url = 'https://skscans.com/manga/chronicles-of-the-martial-gods-return/'

  return searchValid(results, desired, 'Chronicles of the Martial God’s Return')
}
