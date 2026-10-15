Page({
  data: {
    safeTop: 24,
    latitude: 0,
    longitude: 0,
    markers: [],
    polyline: [],
    remainingDistance: '—',
    remainingDuration: '—',
    clockTime: '--:--'
  },

  onLoad() {
    const route = getApp().globalData.currentRoute
    if (!route || !route.previewPoints) {
      wx.showToast({ title: '请先生成路线', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }

    const info = wx.getSystemInfoSync()
    const distance = Number(route.plannedDistance || 0)
    const duration = Number(route.plannedDuration || 0)
    this.setData({
      safeTop: info.statusBarHeight || 24,
      latitude: route.latitude,
      longitude: route.longitude,
      markers: route.previewMarkers || [],
      polyline: [{ points: route.previewPoints, color: '#426d54', width: 7, arrowLine: true }],
      remainingDistance: distance.toFixed(1) + ' 公里',
      remainingDuration: '约 ' + duration + ' 分钟',
      clockTime: this.getClockTime()
    })
    this.timer = setInterval(() => this.setData({ clockTime: this.getClockTime() }), 15000)
  },

  onShow() {
    this.setData({ clockTime: this.getClockTime() })
  },

  getClockTime() {
    const now = new Date()
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  },

  backToRoute() {
    wx.navigateBack()
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer)
  }
})
