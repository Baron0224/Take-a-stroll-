const { planWalkingRoute } = require('../../utils/walking-route.js')

Page({
  data: {
    title: '附近随机散步路线',
    subtitle: '',
    distanceText: '—',
    durationText: '—',
    latitude: 0,
    longitude: 0,
    markers: [],
    polyline: [],
    returnHome: true,
    favorite: false,
    routeLoading: false,
    routeReady: false
  },

  onLoad() {
    this.makePreview()
  },

  async makePreview() {
    const route = getApp().globalData.currentRoute
    if (!route) {
      wx.showToast({ title: '请先设置散步路线', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    if (this.data.routeLoading) return

    route.routeId = Date.now().toString() + Math.random().toString(36).slice(2, 7)
    this.setData({ routeLoading: true, routeReady: false })
    try {
      const planned = await planWalkingRoute({
        latitude: route.latitude,
        longitude: route.longitude,
        mode: route.mode,
        requested: route.requested,
        returnHome: route.returnHome
      })
      const points = planned.points
      const distance = planned.distance / 1000
      const duration = Math.max(1, Math.round(planned.duration / 60))
      const last = points[points.length - 1]
      const markers = [
        { id: 1, latitude: route.latitude, longitude: route.longitude, title: '出发点', width: 28, height: 34 },
        { id: 2, latitude: last.latitude, longitude: last.longitude, title: route.returnHome ? '回到出发点' : '随机终点', width: 28, height: 34 }
      ]
      const savedFavorites = wx.getStorageSync('walkFavorites') || []
      const isFavorite = savedFavorites.some(item => item.id === route.routeId)
      route.plannedDistance = distance
      route.plannedDuration = duration
      route.previewPoints = points
      route.previewMarkers = markers
      route.title = route.returnHome ? '随机环形散步路线' : '附近随机散步路线'
      this.setData({
        title: route.title,
        subtitle: route.returnHome ? '从当前位置出发 · 回到出发点' : '从当前位置出发 · 随机选择终点',
        distanceText: distance.toFixed(1) + ' 公里',
        durationText: '约 ' + duration + ' 分钟',
        favorite: isFavorite,
        latitude: route.latitude,
        longitude: route.longitude,
        returnHome: route.returnHome,
        markers,
        polyline: [{ points, color: '#426d54', width: 7, arrowLine: true }],
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
    this.makePreview()
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
        demo: false,
        returnHome: route.returnHome
      })
      this.setData({ favorite: true })
      wx.showToast({ title: '已加入我的收藏', icon: 'none' })
    }
    wx.setStorageSync('walkFavorites', favorites)
  },

  startNavigation() {
    wx.showModal({
      title: '实时导航还没接入',
      content: '路线已经由高德步行规划生成，但小程序内的实时定位跟随、语音提示和偏航重规划还没有完成。你可以先点地图全屏查看路线。',
      confirmText: '知道了',
      showCancel: false
    })
  },

  finishDemo() {
    wx.showModal({
      title: '保存示例记录？',
      content: '当前距离和时长是演示数据，不代表真实散步记录。',
      confirmText: '保存示例',
      success: (res) => {
        if (!res.confirm) return
        const route = getApp().globalData.currentRoute
        const distance = parseFloat(this.data.distanceText)
        const duration = parseInt(this.data.durationText.replace(/\D/g, ''), 10)
        const records = wx.getStorageSync('walkRecords') || []
        records.unshift({
          title: this.data.title,
          distance,
          duration,
          date: new Date().toLocaleDateString('zh-CN'),
          demo: true,
          returnHome: route.returnHome
        })
        wx.setStorageSync('walkRecords', records)
        wx.showToast({ title: '示例记录已保存', icon: 'success' })
        setTimeout(() => wx.navigateTo({ url: '/pages/profile/profile' }), 450)
      }
    })
  },

  backToSettings() {
    wx.navigateBack()
  }
})
