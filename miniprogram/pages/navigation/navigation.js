function distanceBetween(first, second) {
  const radians = Math.PI / 180
  const latitudeDelta = (second.latitude - first.latitude) * radians
  const longitudeDelta = (second.longitude - first.longitude) * radians
  const firstLatitude = first.latitude * radians
  const secondLatitude = second.latitude * radians
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function getRouteProgress(points, location) {
  if (!Array.isArray(points) || points.length < 2) return null
  const latitudeScale = 111320
  const longitudeScale = latitudeScale * Math.cos(location.latitude * Math.PI / 180)
  const segmentLengths = []
  let totalLength = 0
  for (let index = 1; index < points.length; index += 1) {
    const length = distanceBetween(points[index - 1], points[index])
    segmentLengths.push(length)
    totalLength += length
  }
  if (!totalLength) return null

  let bestDistance = Infinity
  let bestAlong = 0
  let traversed = 0
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const first = points[index]
    const second = points[index + 1]
    const firstX = (first.longitude - location.longitude) * longitudeScale
    const firstY = (first.latitude - location.latitude) * latitudeScale
    const secondX = (second.longitude - location.longitude) * longitudeScale
    const secondY = (second.latitude - location.latitude) * latitudeScale
    const dx = secondX - firstX
    const dy = secondY - firstY
    const lengthSquared = dx * dx + dy * dy
    const fraction = lengthSquared
      ? Math.max(0, Math.min(1, -(firstX * dx + firstY * dy) / lengthSquared))
      : 0
    const distance = Math.hypot(firstX + fraction * dx, firstY + fraction * dy)
    if (distance < bestDistance) {
      bestDistance = distance
      bestAlong = traversed + segmentLengths[index] * fraction
    }
    traversed += segmentLengths[index]
  }
  return { fraction: Math.max(0, Math.min(1, bestAlong / totalLength)), distance: bestDistance }
}

function getRemainingRoute(points, fraction) {
  if (!Array.isArray(points) || points.length < 2 || fraction >= 1) return []
  if (fraction <= 0) return points

  const lengths = []
  let totalLength = 0
  for (let index = 1; index < points.length; index += 1) {
    const length = distanceBetween(points[index - 1], points[index])
    lengths.push(length)
    totalLength += length
  }
  if (!totalLength) return points

  let remainingLength = totalLength * fraction
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index]
    if (remainingLength <= segmentLength) {
      const segmentFraction = segmentLength ? remainingLength / segmentLength : 0
      const first = points[index]
      const second = points[index + 1]
      return [{
        longitude: first.longitude + (second.longitude - first.longitude) * segmentFraction,
        latitude: first.latitude + (second.latitude - first.latitude) * segmentFraction
      }].concat(points.slice(index + 1))
    }
    remainingLength -= segmentLength
  }
  return []
}

function getWalkedRoute(points, fraction) {
  if (!Array.isArray(points) || points.length < 2 || fraction <= 0) return []
  if (fraction >= 1) return points
  const lengths = []
  let totalLength = 0
  for (let index = 1; index < points.length; index += 1) {
    const length = distanceBetween(points[index - 1], points[index])
    lengths.push(length)
    totalLength += length
  }
  if (!totalLength) return [points[0]]
  let targetLength = totalLength * fraction
  const result = [points[0]]
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (targetLength >= length) {
      result.push(points[index + 1])
      targetLength -= length
      continue
    }
    const part = length ? targetLength / length : 0
    result.push({
      longitude: points[index].longitude + (points[index + 1].longitude - points[index].longitude) * part,
      latitude: points[index].latitude + (points[index + 1].latitude - points[index].latitude) * part
    })
    break
  }
  return result
}

function formatElapsed(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainder = safeSeconds % 60
  if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
  return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
}

function formatDistance(meters) {
  if (meters >= 1000) return (meters / 1000).toFixed(1) + ' 公里'
  return Math.max(0, Math.round(meters / 10) * 10) + ' 米'
}

Page({
  data: {
    safeTop: 24,
    latitude: 0,
    longitude: 0,
    markers: [],
    polyline: [],
    remainingDistance: '定位中…',
    remainingDuration: '计算中…',
    walkedDistance: '0 米',
    elapsedTime: '00:00',
    clockTime: '--:--',
    trackingStatus: '正在连接实时定位…',
    savingWalk: false
  },

  onLoad() {
    const route = getApp().globalData.currentRoute
    if (!route || !route.previewPoints || route.previewPoints.length < 2) {
      wx.showToast({ title: '请先生成路线', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }

    const info = wx.getSystemInfoSync()
    this.route = route
    this.routePoints = route.previewPoints
    this.displayRoutePoints = route.displayPoints || route.previewPoints
    this.plannedDistance = Number(route.plannedDistanceMeters || Number(route.plannedDistance || 0) * 1000)
    this.plannedDuration = Number(route.plannedDurationSeconds || Number(route.plannedDuration || 0) * 60)
    this.progressFraction = 0
    this.renderedProgressFraction = 0
    this.walkedMeters = 0
    this.walkedPoints = []
    this.activeSince = 0
    this.startedAt = Date.now()
    this.elapsedBeforeHide = 0
    this.trackingActive = false
    this.lastLocation = null
    this.locationListener = this.handleLocationChange.bind(this)
    this.setData({
      safeTop: info.statusBarHeight || 24,
      latitude: route.latitude,
      longitude: route.longitude,
      markers: route.previewMarkers || [],
      polyline: route.previewPolylines || [{ points: route.previewPoints, color: '#426d54', width: 7, arrowLine: true }],
      remainingDistance: formatDistance(this.plannedDistance),
      remainingDuration: '约 ' + Math.max(1, Math.ceil(this.plannedDuration / 60)) + ' 分钟',
      clockTime: this.getClockTime()
    })

    wx.onLocationChange(this.locationListener)
    wx.startLocationUpdate({
      type: 'gcj02',
      success: () => {
        this.activeSince = Date.now()
        this.trackingActive = true
        this.setData({ trackingStatus: '实时定位已开启 · 请沿路线行走' })
      },
      fail: (error) => this.handleLocationStartFailure(error)
    })
    this.timer = setInterval(() => this.updateElapsedTime(), 1000)
  },

  onShow() {
    this.setData({ clockTime: this.getClockTime() })
    if (this.trackingActive && !this.activeSince) this.activeSince = Date.now()
    this.updateElapsedTime()
  },

  onHide() {
    if (this.activeSince) {
      this.elapsedBeforeHide += Date.now() - this.activeSince
      this.activeSince = 0
    }
  },

  getClockTime() {
    const now = new Date()
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  },

  updateElapsedTime() {
    const elapsed = this.elapsedBeforeHide + (this.activeSince ? Date.now() - this.activeSince : 0)
    this.setData({
      elapsedTime: formatElapsed(elapsed / 1000),
      clockTime: this.getClockTime()
    })
  },

  handleLocationChange(location) {
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return
    const current = { latitude: Number(location.latitude), longitude: Number(location.longitude) }
    const accuracy = Number(location.accuracy || location.horizontalAccuracy || 0)
    if (accuracy > 80) {
      this.setData({ trackingStatus: '定位精度较低 · 正在等待更准确的位置' })
      return
    }

    const progress = getRouteProgress(this.routePoints, current)
    const isOnRoute = progress && progress.distance <= 50
    if (isOnRoute && (!this.walkedPoints.length || distanceBetween(this.walkedPoints[this.walkedPoints.length - 1], current) >= 5)) {
      this.walkedPoints.push(current)
      if (this.walkedPoints.length > 1000) this.walkedPoints.splice(1, 2)
    }
    if (this.lastLocation && isOnRoute) {
      const delta = distanceBetween(this.lastLocation, current)
      const noiseAllowance = Math.max(3, Math.min(12, accuracy * 0.25))
      if (delta > noiseAllowance && delta < 100) this.walkedMeters += delta
    }
    this.lastLocation = current

    let status = '实时定位已开启 · 请沿路线行走'
    if (isOnRoute) {
      // Use distance traveled while snapped to the route. This avoids jumping
      // to the wrong leg when an out-and-back route reuses the same road.
      this.progressFraction = Math.max(this.progressFraction, Math.min(1, this.walkedMeters / Math.max(1, this.plannedDistance)))
    } else if (progress) {
      status = '当前位置偏离路线 · 请回到路线附近'
    }

    const renderStep = 2 / Math.max(1, this.plannedDistance)
    const shouldTrimRoute = isOnRoute && this.progressFraction - this.renderedProgressFraction >= renderStep
    const nextPolyline = shouldTrimRoute
      ? (this.progressFraction >= 1
          ? []
          : [{
              points: getRemainingRoute(this.displayRoutePoints, this.progressFraction),
              color: '#426d54',
              width: 7,
              arrowLine: true
            }])
      : null
    if (shouldTrimRoute) this.renderedProgressFraction = this.progressFraction

    const remainingMeters = this.plannedDistance * (1 - this.progressFraction)
    const remainingSeconds = this.plannedDistance > 0
      ? this.plannedDuration * (remainingMeters / this.plannedDistance)
      : 0
    this.setData({
      latitude: current.latitude,
      longitude: current.longitude,
      remainingDistance: formatDistance(remainingMeters),
      remainingDuration: remainingSeconds < 60 ? '不足 1 分钟' : '约 ' + Math.ceil(remainingSeconds / 60) + ' 分钟',
      walkedDistance: formatDistance(this.walkedMeters),
      trackingStatus: status,
      ...(nextPolyline ? { polyline: nextPolyline } : {})
    })
  },

  handleLocationStartFailure(error) {
    this.setData({ trackingStatus: '实时定位未开启' })
    wx.showModal({
      title: '无法开启实时定位',
      content: '请允许小程序使用位置信息，并确认微信公众平台已开通“监听实时地理位置变化”接口。' + (error && error.errMsg ? '\n\n' + error.errMsg : ''),
      confirmText: '知道了',
      showCancel: false
    })
  },

  backToRoute() {
    wx.navigateBack()
  },

  finishWalk() {
    if (this.data.savingWalk) return
    wx.showModal({
      title: '结束这次散步？',
      content: `本次已走 ${formatDistance(this.walkedMeters)}，用时 ${this.data.elapsedTime}。结束后会保存到当前微信账号。`,
      confirmText: '结束并保存',
      success: async (result) => {
        if (!result.confirm) return
        if (!getApp().globalData.cloudReady || !wx.cloud) {
          wx.showModal({ title: '云端尚未连接', content: '请先在微信开发者工具中确认云环境并部署 walkData 云函数。', showCancel: false })
          return
        }
        this.setData({ savingWalk: true })
        const durationSeconds = Math.floor((this.elapsedBeforeHide + (this.activeSince ? Date.now() - this.activeSince : 0)) / 1000)
        const walkedFraction = Math.min(1, this.walkedMeters / Math.max(1, this.plannedDistance))
        const points = this.walkedPoints.length > 1
          ? this.walkedPoints
          : getWalkedRoute(this.displayRoutePoints, walkedFraction)
        try {
          await wx.cloud.callFunction({
            name: 'walkData',
            data: {
              action: 'saveRecord',
              record: {
                title: '随机散步',
                distanceMeters: this.walkedMeters,
                durationSeconds,
                points,
                startedAt: this.startedAt,
                endedAt: Date.now()
              }
            }
          })
          this.trackingActive = false
          this.activeSince = 0
          if (this.timer) clearInterval(this.timer)
          if (this.locationListener) wx.offLocationChange(this.locationListener)
          wx.stopLocationUpdate({})
          wx.showToast({ title: '散步记录已保存', icon: 'success' })
          setTimeout(() => wx.navigateTo({ url: '/pages/profile/profile' }), 400)
        } catch (error) {
          console.error('保存散步记录失败', error)
          wx.showModal({ title: '保存失败', content: '请确认已部署 walkData 云函数并创建 walkRecords 数据库集合。当前散步没有被保存，请重试。', showCancel: false })
        } finally {
          this.setData({ savingWalk: false })
        }
      }
    })
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
    if (this.locationListener) wx.offLocationChange(this.locationListener)
    wx.stopLocationUpdate({})
  }
})
