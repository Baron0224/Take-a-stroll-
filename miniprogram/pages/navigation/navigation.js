const { saveWalkRecord, openWalkRecords } = require('../../utils/walk-record.js')
const { planWalkingRouteTo, simplifyRoutePoints } = require('../../utils/walking-route.js')

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

function getRouteProgress(points, location, minFraction = 0, maxFraction = 1) {
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
    const segmentLength = segmentLengths[index]
    const minPart = segmentLength
      ? Math.max(0, Math.min(1, (minFraction * totalLength - traversed) / segmentLength))
      : 0
    const maxPart = segmentLength
      ? Math.max(0, Math.min(1, (maxFraction * totalLength - traversed) / segmentLength))
      : 0
    if (minPart > maxPart || traversed + segmentLength < minFraction * totalLength || traversed > maxFraction * totalLength) {
      traversed += segmentLength
      continue
    }
    const first = points[index]
    const second = points[index + 1]
    const firstX = (first.longitude - location.longitude) * longitudeScale
    const firstY = (first.latitude - location.latitude) * latitudeScale
    const secondX = (second.longitude - location.longitude) * longitudeScale
    const secondY = (second.latitude - location.latitude) * latitudeScale
    const dx = secondX - firstX
    const dy = secondY - firstY
    const lengthSquared = dx * dx + dy * dy
    const projectedPart = lengthSquared
      ? Math.max(0, Math.min(1, -(firstX * dx + firstY * dy) / lengthSquared))
      : 0
    const fraction = Math.max(minPart, Math.min(maxPart, projectedPart))
    const distance = Math.hypot(firstX + fraction * dx, firstY + fraction * dy)
    if (distance < bestDistance) {
      bestDistance = distance
      bestAlong = traversed + segmentLengths[index] * fraction
    }
    traversed += segmentLengths[index]
  }
  if (!Number.isFinite(bestDistance)) return null
  return {
    fraction: Math.max(0, Math.min(1, bestAlong / totalLength)),
    alongMeters: bestAlong,
    totalLength,
    distance: bestDistance
  }
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

function getPolylineLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += distanceBetween(points[index - 1], points[index])
  }
  return length
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
    trackingStatusType: 'normal',
    savingWalk: false,
    rerouting: false,
    isPaused: false,
    canRetryReroute: false,
    trackingReady: false
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
    this.displayRoutePoints = route.displayPoints || route.previewPoints
    this.plannedDistance = Number(route.plannedDistanceMeters || Number(route.plannedDistance || 0) * 1000)
    this.plannedDuration = Number(route.plannedDurationSeconds || Number(route.plannedDuration || 0) * 60)
    this.progressFraction = 0
    this.renderedProgressFraction = 0
    this.walkedMeters = 0
    this.walkedPoints = []
    this.offRouteReadings = 0
    this.offRouteNotified = false
    this.isRerouting = false
    this.lastRerouteAt = 0
    this.completionPrompted = false
    const finalPoint = this.displayRoutePoints[this.displayRoutePoints.length - 1]
    this.destination = { latitude: finalPoint.latitude, longitude: finalPoint.longitude }
    this.startedAt = Date.now()
    this.activeElapsedMs = 0
    this.activeSince = 0
    this.isPaused = false
    this.lastLocation = null
    this.lastAcceptedLocationAt = 0
    this.backgroundLocationEnabled = false
    this.lastLocationAt = 0
    this.appWentBackground = false
    this.pausedForBackground = false
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
    this.startLocationTracking((backgroundEnabled) => {
        this.backgroundLocationEnabled = backgroundEnabled
        this.startedAt = Date.now()
        this.activeSince = this.startedAt
        this.setData({
          trackingReady: true,
          trackingStatus: backgroundEnabled ? '实时定位已开启 · 锁屏后仍会记录' : '实时定位已开启 · 锁屏时请保持小程序打开',
          trackingStatusType: backgroundEnabled ? 'normal' : 'warning'
        })
        this.updateElapsedTime()
      }, error => this.handleLocationStartFailure(error))
    this.timer = setInterval(() => this.updateElapsedTime(), 1000)
  },

  onShow() {
    this.setData({ clockTime: this.getClockTime() })
    this.updateElapsedTime()
  },

  getClockTime() {
    const now = new Date()
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  },

  updateElapsedTime() {
    const elapsed = this.getActiveElapsedMs()
    this.setData({
      elapsedTime: formatElapsed(elapsed / 1000),
      clockTime: this.getClockTime()
    })
  },

  getActiveElapsedMs() {
    return this.activeElapsedMs + (this.activeSince ? Date.now() - this.activeSince : 0)
  },

  onAppHide() {
    this.appWentBackground = true
    if (!this.data.trackingReady || this.isPaused || this.backgroundLocationEnabled) return
    if (this.activeSince) this.activeElapsedMs += Date.now() - this.activeSince
    this.activeSince = 0
    this.isPaused = true
    this.pausedForBackground = true
    this.lastLocation = null
    wx.stopLocationUpdate({})
    this.setData({
      isPaused: true,
      trackingStatus: '后台定位不可用 · 已自动暂停，回来后点继续',
      trackingStatusType: 'warning'
    })
    this.updateElapsedTime()
  },

  onAppShow() {
    if (!this.appWentBackground) return
    this.appWentBackground = false
    if (this.pausedForBackground) {
      this.pausedForBackground = false
      wx.showToast({ title: '刚才已自动暂停，点击继续恢复散步', icon: 'none', duration: 3000 })
      return
    }
    if (!this.data.trackingReady || this.isPaused || !this.backgroundLocationEnabled) return
    if (Date.now() - (this.lastLocationAt || this.startedAt) < 90000) return

    this.setData({ trackingStatus: '后台定位似乎中断 · 正在恢复', trackingStatusType: 'warning' })
    wx.stopLocationUpdate({})
    this.startLocationTracking((backgroundEnabled) => {
      this.backgroundLocationEnabled = backgroundEnabled
      this.setData({
        trackingStatus: backgroundEnabled ? '定位已恢复 · 锁屏后仍会记录' : '定位已恢复 · 锁屏时请保持小程序打开',
        trackingStatusType: backgroundEnabled ? 'normal' : 'warning'
      })
    }, error => {
      this.setData({ trackingStatus: '后台定位中断 · 请检查位置权限', trackingStatusType: 'warning' })
      console.error('恢复后台定位失败', error)
    })
  },

  startLocationTracking(onSuccess, onFail) {
    const startForeground = (backgroundError) => {
      wx.startLocationUpdate({
        type: 'gcj02',
        success: () => onSuccess(false, backgroundError),
        fail: error => onFail(error || backgroundError)
      })
    }
    if (typeof wx.startLocationUpdateBackground !== 'function') {
      startForeground()
      return
    }
    wx.startLocationUpdateBackground({
      type: 'gcj02',
      success: () => onSuccess(true),
      fail: error => startForeground(error)
    })
  },

  togglePause() {
    if (this.isRerouting) {
      wx.showToast({ title: '正在重新规划，请稍后再操作', icon: 'none' })
      return
    }
    if (!this.data.trackingReady) {
      wx.showToast({ title: '定位开启后才能暂停', icon: 'none' })
      return
    }
    if (!this.isPaused) {
      if (this.activeSince) this.activeElapsedMs += Date.now() - this.activeSince
      this.activeSince = 0
      this.isPaused = true
      this.lastLocation = null
      this.setData({
        isPaused: true,
        trackingStatus: '散步已暂停 · 点击继续恢复定位',
        trackingStatusType: 'normal'
      })
      wx.stopLocationUpdate({})
      this.updateElapsedTime()
      return
    }

    this.startLocationTracking((backgroundEnabled) => {
        this.backgroundLocationEnabled = backgroundEnabled
        this.isPaused = false
        this.activeSince = Date.now()
        this.lastLocation = null
        this.offRouteReadings = 0
        this.setData({
          isPaused: false,
          trackingStatus: backgroundEnabled ? '散步已继续 · 锁屏后仍会记录' : '散步已继续 · 锁屏时请保持小程序打开',
          trackingStatusType: backgroundEnabled ? 'normal' : 'warning'
        })
        this.updateElapsedTime()
      }, error => {
        this.setData({ trackingStatus: '定位未能恢复 · 请检查位置权限', trackingStatusType: 'warning' })
        wx.showModal({
          title: '无法继续散步',
          content: '请确认微信仍有位置权限后重试。' + (error && error.errMsg ? '\n\n' + error.errMsg : ''),
          showCancel: false
        })
      })
  },

  handleLocationChange(location) {
    if (this.isPaused) return
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return
    const current = { latitude: Number(location.latitude), longitude: Number(location.longitude) }
    const accuracy = Number(location.accuracy || location.horizontalAccuracy || 0)
    if (accuracy > 65) {
      this.setData({ trackingStatus: '定位精度较低 · 暂不计入距离，正在等待更准确的位置', trackingStatusType: 'warning' })
      return
    }
    this.lastLocationAt = Date.now()

    // Match against the same simplified path that is actually drawn on the map,
    // so the disappearing point and visible route stay aligned.
    const routeLengthMeters = getPolylineLength(this.displayRoutePoints)
    if (!routeLengthMeters) return
    // Only match the current position to the current/upcoming portion of the
    // route. Searching the whole loop can snap a nearby GPS fix to a later
    // parallel leg and leave the already-walked line visible.
    const minRouteFraction = this.progressFraction
    const maxRouteFraction = Math.min(1, Math.max(
      this.progressFraction + 150 / routeLengthMeters,
      (this.walkedMeters + 75) / routeLengthMeters
    ))
    const progress = getRouteProgress(this.displayRoutePoints, current, minRouteFraction, maxRouteFraction)
    const routeTolerance = Math.max(20, Math.min(45, accuracy * 1.8))
    const isOnRoute = progress && progress.distance <= routeTolerance
    if (!isOnRoute) {
      if (accuracy <= 50) this.offRouteReadings += 1
      else this.offRouteReadings = 0
    } else {
      this.offRouteReadings = 0
      this.offRouteNotified = false
    }
    if (!this.lastLocation) {
      this.lastLocation = current
      this.lastAcceptedLocationAt = Date.now()
      if (!this.walkedPoints.length) this.walkedPoints.push(current)
    } else {
      // Count real movement even while off route; the walk record must reflect
      // the path the person actually walked, not only the planned route.
      const delta = distanceBetween(this.lastLocation, current)
      const noiseAllowance = Math.max(4, Math.min(12, accuracy * 0.4))
      const elapsedSinceAccepted = Math.max(1, (Date.now() - this.lastAcceptedLocationAt) / 1000)
      const plausibleMaxMeters = Math.max(60, Math.min(250, elapsedSinceAccepted * 4 + accuracy * 2))
      if (delta >= noiseAllowance && delta <= plausibleMaxMeters) {
        this.walkedMeters += delta
        this.lastLocation = current
        this.lastAcceptedLocationAt = Date.now()
        const previousPoint = this.walkedPoints[this.walkedPoints.length - 1]
        if (!previousPoint || distanceBetween(previousPoint, current) >= Math.max(5, accuracy * 0.5)) {
          this.walkedPoints.push(current)
          if (this.walkedPoints.length > 1000) this.walkedPoints.splice(1, 2)
        }
      } else if (delta > plausibleMaxMeters) {
        // Discard an implausible GPS jump and begin measuring from its endpoint.
        this.lastLocation = current
        this.lastAcceptedLocationAt = Date.now()
      }
    }

    let status = '实时定位已开启 · 请沿路线行走'
    if (isOnRoute) {
      this.progressFraction = Math.max(this.progressFraction, progress.fraction)
    } else {
      status = this.isRerouting ? '已偏离路线 · 正在重新规划' : '已偏离路线 · 正在尝试重新规划'
    }

    const renderStep = 0.5 / Math.max(1, routeLengthMeters)
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
      trackingStatusType: isOnRoute ? 'normal' : 'warning',
      canRetryReroute: this.data.canRetryReroute && !isOnRoute,
      ...(nextPolyline ? { polyline: nextPolyline } : {})
    })

    // Reaching the planned finish should ask before ending. Saving remains a
    // deliberate user action, so a completed route never silently exits.
    const isAtPlannedFinish = isOnRoute && (
      this.progressFraction >= 0.995
      || (remainingMeters <= 25 && distanceBetween(current, this.destination) <= 35)
    )
    if (isAtPlannedFinish && !this.completionPrompted) {
      this.completionPrompted = true
      wx.showModal({
        title: '散步路线已完成',
        content: '已走 ' + formatDistance(this.walkedMeters) + '，用时 ' + formatElapsed(this.getActiveElapsedMs() / 1000) + '。要退出并保存本次散步吗？',
        confirmText: '退出并保存',
        cancelText: '继续散步',
        success: result => {
          if (result.confirm) this.finishWalk()
        }
      })
    }

    // Ignore a single noisy GPS fix. Three consecutive accurate fixes away
    // from the route trigger a fresh walking route that rejoins the upcoming
    // portion instead of sending a loop walker straight to the start.
    if (!isOnRoute && accuracy <= 50 && this.offRouteReadings >= 3 && !this.isRerouting
      && Date.now() - this.lastRerouteAt >= 30000) {
      if (!this.offRouteNotified) {
        this.offRouteNotified = true
        wx.showToast({ title: '已偏离路线，正在重新规划', icon: 'none', duration: 2500 })
        if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      }
      this.rerouteFrom(current)
    }
  },

  async rerouteFrom(origin) {
    if (!this.destination || this.isRerouting) return
    this.isRerouting = true
    this.lastRerouteAt = Date.now()
    this.setData({ rerouting: true, trackingStatusType: 'warning', trackingStatus: '已偏离路线 · 正在规划并接回前方路线' })
    try {
      const oldRoutePoints = this.displayRoutePoints
      const oldRouteLength = getPolylineLength(oldRoutePoints)
      const rejoinMinFraction = Math.min(1, this.progressFraction + 35 / Math.max(1, oldRouteLength))
      // Rejoin nearby on the upcoming route, rather than searching a large
      // portion of a loop. A wide search could pick the loop's final point
      // (the start) and turn a small detour into a direct trip back home.
      const rejoinLookAheadMeters = Math.max(120, Math.min(300, oldRouteLength * 0.08))
      const rejoinMaxFraction = Math.min(
        1,
        this.progressFraction + rejoinLookAheadMeters / Math.max(1, oldRouteLength)
      )
      const rejoin = rejoinMinFraction < rejoinMaxFraction
        ? getRouteProgress(oldRoutePoints, origin, rejoinMinFraction, rejoinMaxFraction)
        : null
      // Even when the walker is well away from the planned line, ask the
      // walking router to guide them back to a forward point on that line.
      // A small straight-line distance cutoff here prevented useful reroutes
      // after a genuine detour. Let the map service decide whether the
      // connector is routable; the remaining original route is appended below.
      if (!rejoin) {
        throw new Error('没有找到原路线前方的接入点，请稍后重试。')
      }

      const routeTail = getRemainingRoute(oldRoutePoints, rejoin.fraction)
      if (routeTail.length < 2) throw new Error('前方剩余路线不足，暂时无法重新规划。')
      const connector = await planWalkingRouteTo(origin, routeTail[0])
      const joinedPoints = connector.points.concat(routeTail.slice(1))
      const remainingGeometry = Math.max(1, oldRouteLength * (1 - this.progressFraction))
      const tailGeometry = getPolylineLength(routeTail)
      const tailRatio = Math.max(0, Math.min(1, tailGeometry / remainingGeometry))
      const remainingPlannedDistance = this.plannedDistance * (1 - this.progressFraction)
      const remainingPlannedDuration = this.plannedDuration * (1 - this.progressFraction)
      this.displayRoutePoints = simplifyRoutePoints(joinedPoints, 8, 400)
      this.plannedDistance = connector.distance + remainingPlannedDistance * tailRatio
      this.plannedDuration = connector.duration + remainingPlannedDuration * tailRatio
      this.progressFraction = 0
      this.renderedProgressFraction = 0
      this.offRouteReadings = 0
      this.lastLocation = origin
      this.lastAcceptedLocationAt = Date.now()
      this.setData({
        polyline: [{ points: this.displayRoutePoints, color: '#426d54', width: 7, arrowLine: true }],
        remainingDistance: formatDistance(this.plannedDistance),
        remainingDuration: this.plannedDuration < 60 ? '不足 1 分钟' : '约 ' + Math.ceil(this.plannedDuration / 60) + ' 分钟',
        trackingStatus: '已重新规划并接回前方路线 · 请沿新路线行走',
        trackingStatusType: 'success',
        rerouting: false,
        canRetryReroute: false
      })
    } catch (error) {
      console.error('偏航后重新规划失败', error)
      this.setData({
        trackingStatus: '重新规划失败 · 请靠近路线后重试',
        trackingStatusType: 'warning',
        rerouting: false,
        canRetryReroute: true
      })
      wx.showToast({ title: '重新规划失败，请检查网络后再试', icon: 'none', duration: 2500 })
    } finally {
      this.isRerouting = false
    }
  },

  retryReroute() {
    if (!this.data.canRetryReroute || this.isRerouting || this.isPaused) return
    const origin = { latitude: this.data.latitude, longitude: this.data.longitude }
    this.rerouteFrom(origin)
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
    if (!this.data.trackingReady) {
      wx.showModal({
        title: '实时定位尚未开启',
        content: '定位没有启动，暂时无法统计真实走过的路程。请先允许位置权限后重新开始散步。',
        showCancel: false
      })
      return
    }

    this.setData({ savingWalk: true })
    wx.showLoading({ title: '正在保存' })
    const endedAt = Date.now()
    const durationSeconds = Math.max(0, Math.floor(this.getActiveElapsedMs() / 1000))
    const points = this.walkedPoints.slice()
    saveWalkRecord({
      title: '随机散步',
      distanceMeters: this.walkedMeters,
      durationSeconds,
      points,
      startedAt: this.startedAt,
      endedAt,
      demo: false
    }).then(() => {
      if (this.timer) clearInterval(this.timer)
      if (this.locationListener) wx.offLocationChange(this.locationListener)
      wx.stopLocationUpdate({})
      wx.hideLoading()
      wx.showToast({ title: '散步记录已保存', icon: 'success' })
      setTimeout(openWalkRecords, 350)
    }).catch(error => {
      console.error('保存散步记录失败', error)
      wx.hideLoading()
      wx.showModal({
        title: '保存失败',
        content: (error && error.message ? error.message + '\n\n' : '') + '请检查云开发环境、walkData 云函数和 walkRecords 集合，然后重试。',
        showCancel: false
      })
    }).finally(() => {
      wx.hideLoading()
      this.setData({ savingWalk: false })
    })
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
    if (this.locationListener) wx.offLocationChange(this.locationListener)
    wx.stopLocationUpdate({})
  }
})
