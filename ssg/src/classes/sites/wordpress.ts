import { SiteType } from '../../enums/siteEnum'
import { BaseData, BaseSite } from './baseSite'
import PQueue from 'p-queue'
import { requestHandler } from 'src/services/requestService'
import { ContentType } from 'src/enums/contentTypeEnum'
import HttpRequest from 'src/interfaces/httpRequest'
import { Manga } from 'src/classes/manga'
import qs from 'qs'
import moment from 'moment'
import { getDateFromNow, matchNum, parseHtmlFromString, titleContainsQuery } from 'src/utils/siteUtils'
import { getPlatform } from 'src/services/platformService'
import { Platform } from 'src/enums/platformEnum'
import { HEADER_USER_AGENT, MOBILE_USER_AGENT } from '../requests/baseRequest'

class WordPressData extends BaseData {
  volume?: Element
  volumeList?: Element[]
  chapterText?: string | null
}

export class WordPress extends BaseSite {
  siteType: SiteType;

  constructor (siteType: SiteType) {
    super()
    this.siteType = siteType

    if (siteType === SiteType.HiperDEX) {
      this.requestQueue = new PQueue({ interval: 1000, intervalCap: 1 })
    }
  }

  getChapter (data: WordPressData): string {
    const volume = data.volume?.textContent?.trim() || 'Vol.01'
    const chapterDate = data.chapterDate?.textContent?.trim() || ''
    const chapter = data.chapterText?.replace(chapterDate, '').trim()

    if (!volume.endsWith('.01') && !volume.endsWith(' 1') && chapter) {
      return `${volume} | ${chapter}`
    } else if (chapter) {
      return chapter
    } else {
      return 'Unknown'
    }
  }

  getChapterNum (data: WordPressData): number {
    if (data.volumeList?.length === 0) return this.getSimpleChapterNum(this.getChapter(data))
    let chapterNum = 0

    data.volumeList?.forEach((element, index) => {
      const matchingChapter = this.getMatchingChapter(
        Array.from(element.querySelectorAll('.wp-manga-chapter a') ?? [])
      )

      const chapterText = matchingChapter?.text
      const chapterOfVolume = this.getSimpleChapterNum(chapterText)

      // We only want decimal places if this is the current chapter, otherwise just add the floored volume number
      if (index === 0) {
        chapterNum += chapterOfVolume
      } else {
        chapterNum += Math.floor(chapterOfVolume)
      }
    })

    return chapterNum
  }

  private getSimpleChapterNum (chapter: string | undefined): number {
    return matchNum(chapter)
  }

  getChapterDate (data: BaseData): string {
    const chapterDateText = data.chapterDate?.textContent?.trim()

    let format
    if (chapterDateText?.includes('/')) {
      format = 'DD/MM/YYYY'
    } else if (chapterDateText?.includes(',')) {
      format = 'MMMM DD, YYYY'
    } else if (chapterDateText?.includes('-')) {
      format = 'DD-MM-YYYY'
    } else if (chapterDateText?.length === 6) {
      format = 'MMM DD'
    } else {
      format = 'Do MMMM YYYY'
    }

    const chapterDate = moment(chapterDateText, format)
    if (!chapterDateText?.endsWith('ago') && chapterDate.isValid()) {
      return chapterDate.fromNow()
    } else {
      return getDateFromNow(data.chapterDate?.textContent) || getDateFromNow(data.chapterDate?.querySelectorAll('a')[0]?.getAttribute('title'))
    }
  }

  getImage (data: BaseData): string {
    return this.getImageSrc(data.image)
  }

  getTitle (data: BaseData): string {
    return data.title?.getAttribute('content') || ''
  }

  protected async readUrlImpl (url: string): Promise<Error | Manga> {
    const request: HttpRequest = { method: 'GET', url }
    this.trySetUserAgent(request)

    const response = await requestHandler.sendRequest(request)
    const doc = await parseHtmlFromString(response.data)

    let data = new WordPressData(url)
    data = this.setVolume(doc, data)
    data = this.setChapter(doc, data)

    if (!data.chapter?.innerHTML || !data.chapterDate?.innerHTML) {
      const mangaId = doc.querySelectorAll('#manga-chapters-holder')[0]?.getAttribute('data-id') || ''
      let result = await this.readChapters(mangaId, data, `${this.getUrl()}/wp-admin/admin-ajax.php`)

      if (result instanceof Error) {
        const baseUrl = data.url.endsWith('/') ? data.url : `${data.url}/`
        const actualUrl = doc.querySelectorAll('meta[property="og:url"]')[0]?.getAttribute('content') || baseUrl
        result = await this.readChapters(mangaId, data, `${actualUrl}ajax/chapters`)
      }

      if (result instanceof Error) return result
      data = result
    }

    const summaryImage = doc.querySelectorAll('.summary_image img')
    if (summaryImage.length > 0) {
      data.image = summaryImage[0]
    } else {
      data.image = doc.querySelectorAll('meta[property="og:image"]')[0]
    }

    const metaTitles = doc.querySelectorAll('meta[property="og:title"]')
    data.title = metaTitles.length > 0 ? metaTitles[metaTitles.length - 1] : undefined

    return this.buildManga(data)
  }

  protected async searchImpl (query: string): Promise<Error | Manga[]> {
    let queryParam = ''
    query.split(' ').forEach((word, index) => {
      if (index > 0) { queryParam += '+' }
      queryParam += word
    })

    const queryString = qs.stringify({
      s: queryParam,
      post_type: 'wp-manga'
    })
    const request: HttpRequest = { method: 'GET', url: `${this.getUrl()}/?${queryString}` }
    this.trySetUserAgent(request)

    const response = await requestHandler.sendRequest(request)
    const doc = await parseHtmlFromString(response.data)

    const mangaList: Manga[] = []

    doc.querySelectorAll('.c-tabs-item__content').forEach((elem) => {
      const imageElem = elem.querySelectorAll('a')[0]

      const url = imageElem?.getAttribute('href') ?? ''
      const regex = /\/manga\/(\d*-).*\//gm
      const prefixNumbers = regex.exec(url)?.[1] ?? ''
      const cleanUrl = url.replace(prefixNumbers, '')

      const manga = new Manga(cleanUrl, this.siteType)
      manga.image = this.getImageSrc(imageElem?.querySelectorAll('img')[0])
      manga.title = elem.querySelectorAll('.post-title')[0]?.textContent?.trim() || ''
      manga.chapter = elem.querySelectorAll('.font-meta.chapter')[0]?.textContent?.trim() || 'Unknown'

      if (titleContainsQuery(query, manga.title)) {
        mangaList.push(manga)
      }
    })

    return mangaList
  }

  private async readChapters (mangaId: string, data: WordPressData, chapterPath: string): Promise<WordPressData | Error> {
    const parser = new DOMParser()
    let doc: Document

    const requestData = {
      action: 'manga_get_chapters',
      manga: mangaId
    }

    try {
      const request: HttpRequest = {
        method: 'POST',
        url: chapterPath,
        data: JSON.stringify(requestData),
        headers: { 'Content-Type': ContentType.URLENCODED }
      }
      this.trySetUserAgent(request)

      const response = await requestHandler.sendRequest(request)
      if (response.data === '0') throw Error('Invalid chapter data')

      doc = await parseHtmlFromString(response.data, parser)
    } catch (error) {
      return error instanceof Error ? error : Error(error as string)
    }

    let newData = this.setVolume(doc, data)
    newData = this.setChapter(doc, newData)

    return newData
  }

  private trySetUserAgent (request: HttpRequest) {
    const headers = request.headers || {}

    if (getPlatform() === Platform.Cordova) {
      headers[HEADER_USER_AGENT] = MOBILE_USER_AGENT
    } else {
      headers[HEADER_USER_AGENT] = navigator.userAgent
    }

    request.headers = headers
  }

  private setVolume (doc: Document, data: WordPressData): WordPressData {
    const volumes = doc.querySelectorAll('.parent.has-child .has-child')
    let volume: { element: Element, number: number } | undefined

    volumes.forEach((element) => {
      const text = element.textContent?.trim()
      if (!text) return

      const number = parseInt(text.replace(/\D/g, ''))
      if (isNaN(number)) return

      if (!volume || volume.number < number) {
        volume = { element, number }
      }
    })

    data.volume = volume?.element
    return data
  }

  private setChapter (doc: Document, data: WordPressData): WordPressData {
    const chapterSelector = '.wp-manga-chapter a'
    const chapterDateSelector = '.chapter-release-date'

    if (data.volume) {
      const volumeParent = data.volume.parentElement
      const matchingChapter = this.getMatchingChapter(
        Array.from(volumeParent?.querySelectorAll(chapterSelector) ?? [])
      )

      data.chapter = matchingChapter?.element
      data.chapterText = matchingChapter?.text
      data.chapterDate = volumeParent?.querySelectorAll(chapterDateSelector)[0]
      if (volumeParent) data.volumeList = [volumeParent]

      return data
    }

    const matchingChapter = this.getMatchingChapter(
      Array.from(doc.querySelectorAll(chapterSelector) ?? [])
    )

    data.chapter = matchingChapter?.element
    data.chapterText = matchingChapter?.text
    data.chapterDate = doc.querySelectorAll(chapterDateSelector)[0]
    data.volumeList = Array.from(doc.querySelectorAll('.parent.has-child'))

    return data
  }

  private getImageSrc (elem: Element | undefined) {
    let url = elem?.getAttribute('content') || elem?.getAttribute('data-src') || elem?.getAttribute('data-lazy-src') || elem?.getAttribute('data-cfsrc') || elem?.getAttribute('src') || ''
    if (url.startsWith('//')) url = `https:${url}`

    return url
  }

  private getMatchingChapter (elements: Element[] | undefined): ({ element: Element, text: string }) | undefined {
    if (!elements) return undefined

    for (const element of elements) {
      const text = element?.childNodes[0]?.textContent?.trim() || element?.textContent?.trim()
      if (text) return { element, text }
    }

    return undefined
  }

  getLoginUrl (): string {
    return this.getUrl()
  }

  getTestUrl (): string {
    switch (this.siteType) {
      case SiteType.FirstKissManga:
        return `${this.getUrl()}/manga/the-elegant-sea-of-savagery/`
      case SiteType.MangaKomi:
        return `${this.getUrl()}/manga/good-night/`
      case SiteType.HiperDEX:
        return `${this.getUrl()}/manga/10-years-in-the-friend-zone/`
      case SiteType.MangaTx:
        return `${this.getUrl()}/manga/grandest-wedding/`
      case SiteType.LeviatanScans:
        return `${this.getUrl()}/manga/trash-of-the-counts-family/`
      case SiteType.SleepingKnightScans:
        return `${this.getUrl()}/manga/chronicles-of-the-martial-gods-return/`
      case SiteType.ResetScans:
        return `${this.getUrl()}/manga/the-unwanted-undead-adventurer/`
    }

    return this.getUrl()
  }
}
