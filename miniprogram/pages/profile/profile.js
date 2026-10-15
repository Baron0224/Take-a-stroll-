Page({
  data: {
    totalDistance: '0.0',
    totalDuration: 0,
    records: [],
    favorites: [],
    activeTab: 'records'
  },

  onShow() {
    const records = wx.getStorageSync('walkRecords') || []
    const favorites = wx.getStorageSync('walkFavorites') || []
    const totalDistance = records.reduce((sum, record) => sum + Number(record.distance || 0), 0)
    const totalDuration = records.reduce((sum, record) => sum + Number(record.duration || 0), 0)
    this.setData({
      records,
      favorites,
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
  },
  selectTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.tab })
  },

  removeFavorite(event) {
    const id = event.currentTarget.dataset.id
    const favorites = (wx.getStorageSync('walkFavorites') || []).filter(item => item.id !== id)
    wx.setStorageSync('walkFavorites', favorites)
    this.setData({ favorites })
    wx.showToast({ title: '已取消收藏', icon: 'none' })
  },

  clearFavorites() {
    wx.showModal({
      title: '清空收藏路线？',
      content: '清空后，收藏列表会被删除。',
      success: (res) => {
        if (!res.confirm) return
        wx.removeStorageSync('walkFavorites')
        this.setData({ favorites: [] })
      }
    })
  }
})
