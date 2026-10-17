App({
  globalData: { currentRoute: null, cloudReady: false },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发')
      return
    }
    wx.cloud.init({
      env: 'strolldev-d1gc6jblsab6bdec3',
      traceUser: true
    })
    this.globalData.cloudReady = true
  }
})
