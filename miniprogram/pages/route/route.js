const { planWalkingRoute, simplifyRoutePoints } = require('../../utils/walking-route.js')

Page({
  data: {
    title: '附近随机散步路线',
    subtitle: '',
    distanceText: '—',
    durationText: '—',
    targetText: '',
    latitude: 0,
    longitude: 0,
    markers: [],
    polyline: [],
    includePoints: [],
    returnHome: true,
    routeStyle: 'loop',
    favorite: false,
    routeLoading: false,
    routeReady: false
  },

  onLoad() {
    this.makePreview()
  },

  async makePreview(preferredStyle) {
    const route = getApp().globalData.currentRoute
    if (!route) {
      wx.showToast({ title: '请先设置散步路线', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    if (this.data.routeLoading) return

    const requestedStyle = preferredStyle || 'loop'
    const nextRouteId = Date.now().toString() + Math.random().toString(36).slice(2, 7)
    this.setData({ routeLoading: true, routeReady: this.data.routeReady })
    try {
      const planned = await planWalkingRoute({
        latitude: route.latitude,
        longitude: route.longitude,
        mode: route.mode,
        requested: route.requested,
        returnHome: route.returnHome,
        preferredStyle: requestedStyle
      })
      const points = planned.points
      const displayPoints = simplifyRoutePoints(points, 8, 400)
      // Round down so a valid value near the exclusive upper boundary is not
      // displayed as if it reached or exceeded that boundary (e.g. 1.99 -> 1.9 km).
      const distance = Math.floor(planned.distance / 100) / 10
      const duration = Math.max(1, Math.floor(planned.duration / 60))
      const last = points[points.length - 1]
      const markers = [
        { id: 1, latitude: route.latitude, longitude: route.longitude, title: route.returnHome ? '出发点 / 终点' : '出发点', width: 28, height: 34 }
      ]
      if (!route.returnHome) {
        markers.push({ id: 2, latitude: last.latitude, longitude: last.longitude, title: '随机终点', width: 28, height: 34 })
      }
      const savedFavorites = wx.getStorageSync('walkFavorites') || []
      const isFavorite = savedFavorites.some(item => item.id === nextRouteId)
      const requested = Number(route.requested).toFixed(0)
      const targetText = route.mode === 'distance'
        ? '目标 ' + requested + '–<' + (Number(route.requested) + 1) + ' 公里 · 实际步行路线'
        : '目标 ' + requested + '–<' + (Number(route.requested) + 5) + ' 分钟 · 实际步行路线'
      route.plannedDistance = distance
      route.routeId = nextRouteId
      route.plannedDuration = duration
      route.plannedDistanceMeters = planned.distance
      route.plannedDurationSeconds = planned.duration
      route.routeStyle = planned.style
      route.previewPoints = points
      route.displayPoints = displayPoints
      route.previewPolylines = [{
        points: displayPoints,
        color: '#426d54',
        width: 7,
        arrowLine: true
      }]
      route.previewMarkers = markers
      route.title = planned.style === 'loop'
        ? '随机环形散步路线'
        : planned.style === 'outback'
          ? '随机往返散步路线'
          : '附近随机散步路线'
      const subtitle = planned.style === 'loop'
        ? '沿不同步行道路环绕 · 回到出发点'
        : planned.style === 'outback'
          ? (requestedStyle === 'loop' ? '附近暂时没有合适环线 · 沿原路返回' : '沿真实步行道路前往 · 再沿原路返回')
          : '从当前位置出发 · 随机选择终点'
      this.setData({
        title: route.title,
        subtitle,
        distanceText: distance.toFixed(1) + ' 公里',
        durationText: '约 ' + duration + ' 分钟',
        targetText,
        favorite: isFavorite,
        latitude: route.latitude,
        longitude: route.longitude,
        returnHome: route.returnHome,
        routeStyle: planned.style,
        markers,
        polyline: route.previewPolylines,
        includePoints: displayPoints,
        routeReady: true
      })
    } catch (error) {
      wx.showModal({
        title: '路线规划失败',
        content: error.message || '暂时没有找到步行路线，请稍后重试。',
        confirmText: '知道了',
        showCancel: false
      })
    } finally {
      this.setData({ routeLoading: false })
    }
  },

  reroll() {
    const route = getApp().globalData.currentRoute
    const preferredStyle = route && route.returnHome && route.routeStyle === 'loop' ? 'outback' : 'loop'
    this.makePreview(preferredStyle)
  },

  openFullscreen() {
    if (!this.data.routeReady) {
      wx.showToast({ title: '请先等待路线规划完成', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/navigation/navigation' })
  },

  toggleFavorite() {
    if (!this.data.routeReady) return
    const route = getApp().globalData.currentRoute
    const favorites = wx.getStorageSync('walkFavorites') || []
    const existingIndex = favorites.findIndex(item => item.id === route.routeId)
    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1)
      this.setData({ favorite: false })
      wx.showToast({ title: '已取消收藏', icon: 'none' })
    } else {
      const distance = Number.parseFloat(this.data.distanceText)
      const duration = Number.parseInt(this.data.durationText.replace(/\D/g, ''), 10)
      favorites.unshift({
        id: route.routeId,
        title: this.data.title,
        distance,
        duration,
        date: new Date().toLocaleDateString('zh-CN'),
        returnHome: route.returnHome
      })
      this.setData({ favorite: true })
      wx.showToast({ title: '已加入我的收藏', icon: 'none' })
    }
    wx.setStorageSync('walkFavorites', favorites)
  },

  startNavigation() {
    // Open the third, full-screen map page with the already planned route.
    this.openFullscreen()
  }

})
