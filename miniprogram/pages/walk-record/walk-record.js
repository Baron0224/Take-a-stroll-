function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const rest = value % 60
  if (hours) return `${hours}小时${minutes}分`
  if (minutes) return `${minutes}分${rest}秒`
  return `${rest}秒`
}

Page({
  data: { latitude: 0, longitude: 0, points: [], polyline: [], distance: '0 m', duration: '', date: '' },

  onLoad() {
    const record = getApp().globalData.walkRecord
    if (!record) {
      wx.showToast({ title: '没有找到这条记录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
      return
    }
    const points = record.points || []
    const first = points[0] || { latitude: 0, longitude: 0 }
    const distanceMeters = Number(record.distanceMeters || 0)
    this.setData({
      latitude: first.latitude,
      longitude: first.longitude,
      points,
      polyline: [{ points, color: '#426d54', width: 7, arrowLine: true }],
      distance: distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`,
      duration: formatDuration(record.durationSeconds),
      date: record.date || new Date(Number(record.endedAt) || Date.now()).toLocaleString()
    })
  },

  onReady() {
    if (!this.data.points.length) return
    this.mapContext = wx.createMapContext('walkRecordMap', this)
    this.mapContext.includePoints({ points: this.data.points, padding: [72, 48, 72, 48] })
  }
})
