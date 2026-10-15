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
    favorite: false
  },

  onLoad() {
    this.makePreview()
  },

  makePreview() {
    const route = getApp().globalData.currentRoute
    if (!route) {
      wx.showToast({ title: '请先设置散步路线', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }

    // 这是用于体验页面的示意轨迹。接入高德步行规划后会替换为真实道路折线。
    const distance = route.mode === 'distance'
      ? Math.max(0.8, route.requested + (Math.random() * 0.4 - 0.2))
      : Math.max(0.8, route.requested / 60 * 4.5)
    const duration = route.mode === 'time'
      ? route.requested
      : Math.max(1, Math.round(distance / 4.5 * 60))
    const lat = route.latitude
    const lon = route.longitude
    const dx = 0.0014 + Math.random() * 0.001
    const dy = 0.0014 + Math.random() * 0.001
    const direction = Math.random() > 0.5 ? 1 : -1
    let points
    if (route.returnHome) {
      points = [
        { latitude: lat, longitude: lon },
        { latitude: lat + dy * direction, longitude: lon + dx * 0.45 },
        { latitude: lat + dy * 0.7 * direction, longitude: lon + dx * 1.15 },
        { latitude: lat - dy * 0.15 * direction, longitude: lon + dx * 1.3 },
        { latitude: lat - dy * 0.45 * direction, longitude: lon + dx * 0.55 },
        { latitude: lat, longitude: lon }
      ]
    } else {
      points = [
        { latitude: lat, longitude: lon },
        { latitude: lat + dy * direction, longitude: lon + dx * 0.45 },
        { latitude: lat + dy * 0.7 * direction, longitude: lon + dx * 1.15 },
        { latitude: lat - dy * 0.15 * direction, longitude: lon + dx * 1.3 }
      ]
    }
    const last = points[points.length - 1]
    this.setData({
      subtitle: route.returnHome ? '从当前位置出发 · 回到出发点' : '从当前位置出发 · 随机选择终点',
      distanceText: distance.toFixed(1) + ' 公里',
      durationText: '约 ' + duration + ' 分钟',
      latitude: lat,
      longitude: lon,
      returnHome: route.returnHome,
      markers: [
        { id: 1, latitude: lat, longitude: lon, title: '出发点', width: 28, height: 34 },
        { id: 2, latitude: last.latitude, longitude: last.longitude, title: route.returnHome ? '回到出发点' : '随机终点', width: 28, height: 34 }
      ],
      polyline: [{ points, color: '#426d54', width: 6, arrowLine: true, dottedLine: true }]
    })
  },

  reroll() {
    this.makePreview()
  },

  toggleFavorite() {
    const next = !this.data.favorite
    this.setData({ favorite: next })
    wx.showToast({ title: next ? '已收藏示意路线' : '已取消收藏', icon: 'none' })
  },

  startNavigation() {
    wx.showModal({
      title: '导航还没接入',
      content: '当前路线是页面演示用的示意轨迹，不是实际道路路线。接入高德后才能开始真实步行导航。',
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
