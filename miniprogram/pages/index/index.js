Page({
  data: {
    mode: 'distance',
    modeLabel: '公里',
    range: 3,
    min: 1,
    max: 10,
    step: 1,
    returnHome: true,
    hasLocation: false,
    latitude: 0,
    longitude: 0,
    locating: false
  },

  chooseMode(event) {
    const mode = event.currentTarget.dataset.mode
    const isDistance = mode === 'distance'
    this.setData({
      mode,
      modeLabel: isDistance ? '公里' : '分钟',
      range: isDistance ? 3 : 40,
      min: isDistance ? 1 : 15,
      max: isDistance ? 10 : 120,
      step: isDistance ? 1 : 5
    })
  },

  onRangeChange(event) {
    this.setData({ range: Number(event.detail.value) })
  },

  onReturnChange(event) {
    this.setData({ returnHome: event.detail.value })
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        success: resolve,
        fail: reject
      })
    })
  },

  async makeRoute() {
    if (this.data.locating) return
    this.setData({ locating: true })
    try {
      const location = await this.getLocation()
      this.setData({
        hasLocation: true,
        latitude: location.latitude,
        longitude: location.longitude
      })
      getApp().globalData.currentRoute = {
        mode: this.data.mode,
        requested: this.data.range,
        unit: this.data.modeLabel,
        returnHome: this.data.returnHome,
        latitude: location.latitude,
        longitude: location.longitude,
        createdAt: Date.now()
      }
      wx.navigateTo({ url: '/pages/route/route' })
    } catch (error) {
      wx.showModal({
        title: '需要位置权限',
        content: '散步路线要从你当前的位置出发。请允许小程序使用位置信息后再试。',
        confirmText: '知道了',
        showCancel: false
      })
    } finally {
      this.setData({ locating: false })
    }
  },

  openProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
