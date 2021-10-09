import { SiteType } from '../enums/siteEnum'
import { requestHandler } from './requestService'
import { BiliBiliComicsQueryData, BiliBiliComicsWorker, ComicDetailResponse } from '../classes/sites/bilibilicomics/bilibilicomicsWorker'
import qs from 'qs'
import { ContentType } from 'src/enums/contentTypeEnum'

const BASE_BILIBILICOMICS_API_URL = `${BiliBiliComicsWorker.url}/twirp/comic.v1.Comic`

export interface ChapterData {
  id: number,
  chapterNum: number,
  chapter: string
}

interface ImageData {
  id: number,
  images: string[]
}

interface ImageIndexData {
  data: {
    host: string,
    images: { path: string }[],
  }
}

interface ImageTokenData {
  data: {
    token: string,
    url: string
  }[]
}

export async function getImagesFromData (type: string, data: string): Promise<ImageData | null> {
  if (type !== SiteType.BiliBiliComics) return null
  if (!data) return null

  const bilibiliComicsData = JSON.parse(data) as BiliBiliComicsQueryData
  if (!bilibiliComicsData.chapter) return { id: -1, images: [] }

  const queryString = qs.stringify({
    device: 'pc',
    platform: 'web'
  })

  const imageIndexResponse = await requestHandler.sendRequest({
    method: 'POST',
    url: `${BASE_BILIBILICOMICS_API_URL}/GetImageIndex?${queryString}`,
    data: { ep_id: bilibiliComicsData.chapter },
    headers: { 'Content-Type': ContentType.JSON }
  })
  const imageIndexData = JSON.parse(imageIndexResponse.data) as ImageIndexData

  const imageTokenResponse = await requestHandler.sendRequest({
    method: 'POST',
    url: `${BASE_BILIBILICOMICS_API_URL}/ImageToken?${queryString}`,
    data: { urls: JSON.stringify(imageIndexData.data.images.map((image) => image.path)) },
    headers: { 'Content-Type': ContentType.JSON }
  })
  const imageTokenData = JSON.parse(imageTokenResponse.data) as ImageTokenData

  const images = imageTokenData.data.map((image) => {
    return `${image.url}?token=${image.token}`
  })

  return {
    id: bilibiliComicsData.chapter,
    images
  }
}

export async function getChaptersFromData (type: string, data: string): Promise<ChapterData[]> {
  if (type !== SiteType.BiliBiliComics) return []
  if (!data) return []

  const bilibiliComicsData = JSON.parse(data) as BiliBiliComicsQueryData
  if (!bilibiliComicsData.id) return []

  const queryString = qs.stringify({
    device: 'pc',
    platform: 'web'
  })

  const response = await requestHandler.sendRequest({
    method: 'POST',
    url: `${BASE_BILIBILICOMICS_API_URL}/ComicDetail?${queryString}`,
    data: { comic_id: bilibiliComicsData.id },
    headers: { 'Content-Type': ContentType.JSON }
  })

  const comicDetailResponse = JSON.parse(response.data) as ComicDetailResponse
  return comicDetailResponse.data.ep_list.map((chapter) => {
    return {
      id: chapter.id,
      chapterNum: chapter.ord,
      chapter: chapter.title
    }
  })
}
