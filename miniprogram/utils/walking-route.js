const { AMapWX } = require('../libs/amap-wx.js')
const config = require('./amap-config')

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
  return new Promise((resolve, reject) => {
    client.getWalkingRoute({
      origin: origin.longitude + ',' + origin.latitude,
      destination: destination.longitude + ',' + destination.latitude,
      success(result) {
        const path = result && result.paths && result.paths[0]
        if (!path || !Array.isArray(path.steps) || path.steps.length === 0) {
          reject(new Error('高德没有找到这段步行路线，请重新抽取。'))
          return
        }

        const points = []
        path.steps.forEach(step => {
          String(step.polyline || '').split(';').forEach(pair => {
            const [longitude, latitude] = pair.split(',').map(Number)
            if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
              const previous = points[points.length - 1]
              if (!previous || previous.longitude !== longitude || previous.latitude !== latitude) {
                points.push({ longitude, latitude })
              }
            }
          })
        })

        if (points.length < 2) {
          reject(new Error('高德返回的路线数据不完整，请重新抽取。'))
          return
        }
        resolve({
          points,
          distance: Number(path.distance || 0),
          duration: Number(path.duration || 0)
        })
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || '高德步行路线请求失败。请检查 Key 和 request 合法域名。'))
      }
    })
  })
}

async function assembleRoute(client, start, returnHome, desiredMeters, angle) {
  let stops
  if (returnHome) {
    // 由三段高德步行规划路线组成回环，每一段都沿高德返回的可步行道路。
    const radius = Math.max(180, desiredMeters / 4.2)
    stops = [
      start,
      offsetPoint(start, radius, angle),
      offsetPoint(start, radius, angle + 120 + Math.random() * 24 - 12),
      start
    ]
  } else {
    // 终点按目标路程的大致范围随机选择，最终显示高德实际规划距离。
    const radius = Math.max(250, desiredMeters / 1.45)
    stops = [start, offsetPoint(start, radius, angle)]
  }

  const legs = []
  for (let index = 0; index < stops.length - 1; index += 1) {
    legs.push(await requestWalkingLeg(client, stops[index], stops[index + 1]))
  }

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
    duration: legs.reduce((sum, leg) => sum + leg.duration, 0)
  }
}

async function planWalkingRoute(options) {
  const client = makeClient()
  const start = { latitude: options.latitude, longitude: options.longitude }
  const desiredMeters = options.mode === 'distance'
    ? Number(options.requested) * 1000
    : Number(options.requested) * 60 * 1.2
  const attempts = options.returnHome ? 2 : 3
  const candidates = []
  let lastError

  for (let index = 0; index < attempts; index += 1) {
    try {
      const route = await assembleRoute(client, start, options.returnHome, desiredMeters, Math.random() * 360)
      const actualValue = options.mode === 'distance' ? route.distance : route.duration / 60
      const targetValue = options.mode === 'distance' ? desiredMeters : Number(options.requested)
      route.score = Math.abs(actualValue - targetValue) / Math.max(1, targetValue)
      candidates.push(route)
    } catch (error) {
      lastError = error
    }
  }

  if (!candidates.length) throw (lastError || new Error('暂时没有找到可用的步行路线，请稍后重试。'))
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]
}

module.exports = { planWalkingRoute }
