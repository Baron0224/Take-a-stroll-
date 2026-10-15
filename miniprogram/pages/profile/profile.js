Page({
  data: {
    totalDistance: '0.0',
    totalDuration: 0,
    records: []
  },

  onShow() {
    const records = wx.getStorageSync('walkRecords') || []
    const totalDistance = records.reduce((sum, record) => sum + Number(record.distance || 0), 0)
    const totalDuration = records.reduce((sum, record) => sum + Number(record.duration || 0), 0)
    this.setData({
      records,
      totalDistance: totalDistance.toFixed(1),
      totalDuration
    })
  },

  backHome() {
    wx.navigateBack({ delta: 1 })
  },

  clearRecords() {
    wx.showModal({
      title: '清空散步记录？',
      content: '清空后，累计距离和时长也会归零。',
      success: (res) => {
        if (!res.confirm) return
        wx.removeStorageSync('walkRecords')
        this.onShow()
      }
    })
  }
})
