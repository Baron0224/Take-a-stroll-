const { AMapWX } = require('../libs/amap-wx.js')
const config = require('./amap-config')

// Keep all walking requests in this mini-program instance below one request per second.
let walkingRequestQueue = Promise.resolve()
let lastWalkingRequestAt = 0

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function makeClient() {
  const key = String(config.key || '').trim()
  if (!key || key.indexOf('请替换') === 0) {
    throw new Error('请先在 utils/amap-config.js 填写高德微信小程序 Key。')
  }
  return new AMapWX({ key })
}

function offsetPoint(origin, meters, bearing) {
  const radians = bearing * Math.PI / 180
  const latitudeOffset = meters * Math.cos(radians) / 111320
  const longitudeOffset = meters * Math.sin(radians) / (111320 * Math.max(0.2, Math.cos(origin.latitude * Math.PI / 180)))
  return {
    latitude: origin.latitude + latitudeOffset,
    longitude: origin.longitude + longitudeOffset
  }
}

function requestWalkingLeg(client, origin, destination) {
  const request = walkingRequestQueue.then(async () => {
    const spacing = 1100 - (Date.now() - lastWalkingRequestAt)
    if (spacing > 0) await wait(spacing)
    lastWalkingRequestAt = Date.now()

    return new Promise((resolve, reject) => {
    const params = Object.assign({}, client.requestConfig, {
      key: client.key,
      origin: origin.longitude + ',' + origin.latitude,
      destination: destination.longitude + ',' + destination.latitude
    })

    wx.request({
      url: 'https://restapi.amap.com/v3/direction/walking',
      data: params,
      method: 'GET',
      timeout: 12000,
      header: { 'content-type': 'application/json' },
      success(response) {
        const data = response && response.data
        if (!data || data.status !== '1' || !data.route) {
          const details = data && (data.info || data.message)
          const code = data && data.infocode
          const message = String(code) === '10021'
            ? '高德路线服务当前请求太频繁（10021），请等一分钟后再试。'
            : details
            ? '高德路线服务返回错误：' + details + (code ? '（' + code + '）' : '')
            : '高德没有返回路线数据，请检查 Key 和服务配置。'
          const error = new Error(message)
          error.retryable = false
          reject(error)
          return
        }

        const path = data.route.paths && data.route.paths[0]
        if (!path || !Array.isArray(path.steps) || path.steps.length === 0) {
          reject(new Error('高德没有找到这段步行路线，请重新抽取。'))
          return
        }

        const steps = []
        const points = []
        path.steps.forEach(step => {
          const stepPoints = []
          String(step.polyline || '').split(';').forEach(pair => {
            const [longitude, latitude] = pair.split(',').map(Number)
            if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
              const point = { longitude, latitude }
              const previousStepPoint = stepPoints[stepPoints.length - 1]
              if (!previousStepPoint || previousStepPoint.longitude !== longitude || previousStepPoint.latitude !== latitude) {
                stepPoints.push(point)
              }
            }
          })
          if (stepPoints.length > 1) {
            let previous = points[points.length - 1]
            stepPoints.forEach(point => {
              if (!previous || previous.longitude !== point.longitude || previous.latitude !== point.latitude) {
                points.push(point)
              }
              previous = point
            })
            steps.push({
              points: stepPoints,
              distance: Number(step.distance || 0),
              duration: Number(step.duration || 0)
            })
          }
        })

        if (points.length < 2) {
          reject(new Error('高德返回的路线数据不完整，请重新抽取。'))
          return
        }
        resolve({
          points,
          steps,
          distance: Number(path.distance || 0),
          duration: Number(path.duration || 0)
        })
      },
      fail(error) {
        const detail = error && error.errMsg
        const message = detail && detail.indexOf('url not in domain list') !== -1
          ? '微信还没有放行高德请求域名，请确认 https://restapi.amap.com 已添加到 request 合法域名。'
          : '高德步行路线请求失败：' + (detail || '请检查网络、Key 和 request 合法域名。')
        reject(new Error(message))
      }
    })
    })
  })
  walkingRequestQueue = request.catch(() => {})
  return request
}

function distanceBetweenPoints(first, second) {
  const radians = Math.PI / 180
  const latitudeDelta = (second.latitude - first.latitude) * radians
  const longitudeDelta = (second.longitude - first.longitude) * radians
  const firstLatitude = first.latitude * radians
  const secondLatitude = second.latitude * radians
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function simplifyRoutePoints(points, toleranceMeters, maxPoints) {
  if (!Array.isArray(points) || points.length <= 2) return points || []

  const tolerance = Number(toleranceMeters) || 8
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]

  while (stack.length) {
    const range = stack.pop()
    const start = points[range[0]]
    const end = points[range[1]]
    const meanLatitude = (start.latitude + end.latitude) / 2 * Math.PI / 180
    const longitudeScale = 111320 * Math.cos(meanLatitude)
    const startX = start.longitude * longitudeScale
    const startY = start.latitude * 111320
    const endX = end.longitude * longitudeScale
    const endY = end.latitude * 111320
    const dx = endX - startX
    const dy = endY - startY
    const lengthSquared = dx * dx + dy * dy
    let farthestDistance = tolerance
    let farthestIndex = -1

    for (let index = range[0] + 1; index < range[1]; index += 1) {
      const point = points[index]
      const pointX = point.longitude * longitudeScale
      const pointY = point.latitude * 111320
      const fraction = lengthSquared
        ? Math.max(0, Math.min(1, ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared))
        : 0
      const distance = Math.hypot(pointX - (startX + fraction * dx), pointY - (startY + fraction * dy))
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthestIndex = index
      }
    }

    if (farthestIndex >= 0) {
      keep[farthestIndex] = 1
      stack.push([range[0], farthestIndex], [farthestIndex, range[1]])
    }
  }

  let result = points.filter((point, index) => keep[index])
  const limit = Number(maxPoints) || 400
  if (result.length > limit) {
    const stride = (result.length - 1) / (limit - 1)
    result = Array.from({ length: limit }, (_, index) => result[Math.round(index * stride)])
  }
  return result
}

function slicePolyline(points, fraction) {
  if (fraction >= 1) return points.slice()
  const lengths = []
  let totalLength = 0
  for (let index = 1; index < points.length; index += 1) {
    const length = distanceBetweenPoints(points[index - 1], points[index])
    lengths.push(length)
    totalLength += length
  }
  if (!totalLength) return points.slice(0, 1)

  const targetLength = totalLength * fraction
  let walked = 0
  const result = [points[0]]
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index]
    if (walked + segmentLength >= targetLength) {
      const segmentFraction = segmentLength ? (targetLength - walked) / segmentLength : 0
      const first = points[index]
      const second = points[index + 1]
      result.push({
        longitude: first.longitude + (second.longitude - first.longitude) * segmentFraction,
        latitude: first.latitude + (second.latitude - first.latitude) * segmentFraction
      })
      break
    }
    result.push(points[index + 1])
    walked += segmentLength
  }
  return result
}

function trimWalkingPath(steps, mode, targetMeasure) {
  let remaining = targetMeasure
  let distance = 0
  let duration = 0
  const points = []

  for (const step of steps) {
    if (remaining <= 0) break
    const stepMeasure = mode === 'distance' ? step.distance : step.duration
    if (!stepMeasure || !step.points.length) continue
    const portion = Math.min(1, remaining / stepMeasure)
    const selectedPoints = slicePolyline(step.points, portion)
    selectedPoints.forEach(point => {
      const previous = points[points.length - 1]
      if (!previous || previous.longitude !== point.longitude || previous.latitude !== point.latitude) {
        points.push(point)
      }
    })
    distance += step.distance * portion
    duration += step.duration * portion
    remaining -= stepMeasure * portion
  }
  if (remaining > 1 || points.length < 2) return null
  return { points, distance, duration }
}

function routeMeasure(route, mode) {
  return mode === 'distance' ? route.distance : route.duration
}

function isWithinInterval(route, mode, interval) {
  const measure = routeMeasure(route, mode)
  return measure >= interval.min && measure < interval.max
}

function joinRouteLegs(legs) {
  const points = []
  legs.forEach(leg => {
    leg.points.forEach(point => {
      const previous = points[points.length - 1]
      if (!previous || previous.longitude !== point.longitude || previous.latitude !== point.latitude) {
        points.push(point)
      }
    })
  })
  return {
    points,
    distance: legs.reduce((sum, leg) => sum + leg.distance, 0),
    duration: legs.reduce((sum, leg) => sum + leg.duration, 0),
    style: 'loop'
  }
}

async function tryLoopRoute(client, start, options, targetMeasure, desiredMeters, interval) {
  let radiusScale = 1
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // A smaller initial radius avoids the long detours seen in earlier triangular routes.
    const radius = Math.max(100, desiredMeters / 5.5 * radiusScale)
    const angle = Math.random() * 360
    const stops = [
      start,
      offsetPoint(start, radius, angle),
      offsetPoint(start, radius, angle + 120),
      start
    ]
    const legs = []
    for (let index = 0; index < stops.length - 1; index += 1) {
      const legStart = index === 0 ? stops[index] : legs[index - 1].points[legs[index - 1].points.length - 1]
      legs.push(await requestWalkingLeg(client, legStart, stops[index + 1]))
    }
    const route = joinRouteLegs(legs)
    if (isWithinInterval(route, options.mode, interval)) return route

    const ratio = targetMeasure / Math.max(1, routeMeasure(route, options.mode))
    radiusScale = Math.max(0.25, Math.min(2, radiusScale * ratio))
  }
  return null
}

async function planOutAndBackRoute(client, start, options, targetMeasure, desiredMeters, interval) {
  const isDistance = options.mode === 'distance'
  const oneWayTarget = targetMeasure * (options.returnHome ? 0.5 : 1)
  const oneWayDesiredMeters = desiredMeters * (options.returnHome ? 0.5 : 1)
  let radiusScale = 1
  let closest = null
  let bestScore = Infinity

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const radius = Math.max(100, oneWayDesiredMeters / 1.25 * radiusScale)
    const destination = offsetPoint(start, radius, Math.random() * 360)
    const outbound = await requestWalkingLeg(client, start, destination)
    const multiplier = options.returnHome ? 2 : 1
    const estimate = {
      distance: outbound.distance * multiplier,
      duration: outbound.duration * multiplier
    }
    const score = Math.abs(routeMeasure(estimate, options.mode) - targetMeasure)
    if (score < bestScore) {
      closest = estimate
      bestScore = score
    }

    const availableMeasure = isDistance ? outbound.distance : outbound.duration
    const trimmed = availableMeasure >= oneWayTarget
      ? trimWalkingPath(outbound.steps, options.mode, oneWayTarget)
      : null
    if (trimmed) {
      const points = trimmed.points.slice()
      if (options.returnHome) {
        for (let index = trimmed.points.length - 2; index >= 0; index -= 1) {
          points.push(trimmed.points[index])
        }
      }
      return {
        points,
        distance: trimmed.distance * multiplier,
        duration: trimmed.duration * multiplier,
        style: options.returnHome ? 'outback' : 'oneway'
      }
    }

    const ratio = oneWayTarget / Math.max(1, availableMeasure)
    radiusScale = Math.max(0.1, Math.min(4, radiusScale * Math.max(1.15, ratio * 1.2)))
  }

  const unit = isDistance ? '公里' : '分钟'
  const min = Number(options.requested)
  const max = isDistance ? min + 1 : min + 5
  const closestText = isDistance ? (closest.distance / 1000).toFixed(1) : Math.round(closest.duration / 60)
  throw new Error('附近暂时没有足够长的连续步行道路，无法生成 ' + min + ' 到小于 ' + max + unit + ' 的路线；最近一次约为 ' + closestText + unit + '。请换个方向再试。')
}

async function planWalkingRoute(options) {
  const client = makeClient()
  const start = { latitude: options.latitude, longitude: options.longitude }
  const requested = Number(options.requested)
  const isDistance = options.mode === 'distance'
  const interval = isDistance
    ? { min: requested * 1000, max: (requested + 1) * 1000 }
    : { min: requested * 60, max: (requested + 5) * 60 }
  const targetMeasure = (interval.min + interval.max) / 2
  const desiredMeters = isDistance ? targetMeasure : targetMeasure * 1.2

  if (options.returnHome && options.preferredStyle !== 'outback') {
    const loopRoute = await tryLoopRoute(client, start, options, targetMeasure, desiredMeters, interval)
    if (loopRoute) return loopRoute
  }

  return planOutAndBackRoute(client, start, options, targetMeasure, desiredMeters, interval)
}

async function planWalkingRouteTo(origin, destination) {
  const client = makeClient()
  return requestWalkingLeg(client, origin, destination)
}

module.exports = { planWalkingRoute, planWalkingRouteTo, simplifyRoutePoints }
