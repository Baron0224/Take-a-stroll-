function callWalkData(data) {
  return wx.cloud.callFunction({ name: 'walkData', data }).then(result => result.result || {})
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toDisplayRecord(record) {
  return {
    ...record,
    distance: (Number(record.distanceMeters || Number(record.distance || 0) * 1000) / 1000).toFixed(1),
    duration: Math.max(1, Math.round(Number(record.durationSeconds || Number(record.duration || 0) * 60) / 60)),
    date: record.date || formatDate(record.endedAt || record.createdAt)
  }
}

Page({
  data: {
    totalDistance: '0.0',
    totalDuration: 0,
    records: [],
    favorites: [],
    activeTab: 'records',
    nickname: '散步的人',
    avatarUrl: '',
    profileSaving: false,
    cloudReady: false
  },

  onShow() {
    this.setData({ favorites: wx.getStorageSync('walkFavorites') || [] })
    const app = getApp()
    if (!app.globalData.cloudReady || !wx.cloud) {
      this.loadLocalRecords()
      return
    }
    Promise.all([callWalkData({ action: 'getProfile' }), callWalkData({ action: 'listRecords' })])
      .then(([profileResult, recordResult]) => {
        const profile = profileResult.profile || {}
        const records = (recordResult.records || []).map(toDisplayRecord)
        this.setData({
          cloudReady: true,
          nickname: profile.nickname || '散步的人',
          avatarFileID: profile.avatarFileID || '',
          records: records.concat((wx.getStorageSync('walkRecords') || []).filter(item => item.demo).map(toDisplayRecord))
        }, () => this.refreshStats())
        this.refreshAvatar(profile.avatarFileID || '')
      })
      .catch(error => {
        console.error('读取云端散步资料失败', error)
        this.loadLocalRecords()
        wx.showToast({ title: '云端记录暂不可用', icon: 'none' })
      })
  },

  loadLocalRecords() {
    this.setData({ records: (wx.getStorageSync('walkRecords') || []).map(toDisplayRecord), cloudReady: false }, () => this.refreshStats())
  },

  refreshStats() {
    const records = this.data.records || []
    const totalDistance = records.reduce((sum, record) => sum + Number(record.distance || 0), 0)
    const totalDuration = records.reduce((sum, record) => sum + Number(record.duration || 0), 0)
    this.setData({ totalDistance: totalDistance.toFixed(1), totalDuration })
  },

  refreshAvatar(fileID) {
    if (!fileID || !wx.cloud || !wx.cloud.getTempFileURL) {
      this.setData({ avatarUrl: '' })
      return
    }
    wx.cloud.getTempFileURL({ fileList: [fileID] }).then(result => {
      const item = result.fileList && result.fileList[0]
      if (item && item.tempFileURL) this.setData({ avatarUrl: item.tempFileURL })
    }).catch(error => console.error('读取头像失败', error))
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl
    if (avatarUrl) this.setData({ pendingAvatarPath: avatarUrl, avatarUrl })
  },

  onNicknameInput(event) {
    this.setData({ nickname: String(event.detail.value || '').trim().slice(0, 32) })
  },

  async saveProfile() {
    if (this.data.profileSaving) return
    if (!getApp().globalData.cloudReady) {
      wx.showToast({ title: '云开发尚未连接', icon: 'none' })
      return
    }
    this.setData({ profileSaving: true })
    try {
      let avatarFileID = this.data.avatarFileID || ''
      if (this.data.pendingAvatarPath) {
        const extension = (this.data.pendingAvatarPath.match(/\.(png|jpe?g|webp)$/i) || [])[0] || '.jpg'
        const upload = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`,
          filePath: this.data.pendingAvatarPath
        })
        avatarFileID = upload.fileID
      }
      await callWalkData({ action: 'saveProfile', profile: { nickname: this.data.nickname, avatarFileID } })
      this.setData({ avatarFileID, pendingAvatarPath: '' })
      this.refreshAvatar(avatarFileID)
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      console.error('保存用户资料失败', error)
      wx.showModal({ title: '保存失败', content: '请确认已部署 walkData 云函数并创建数据库集合。', showCancel: false })
    } finally {
      this.setData({ profileSaving: false })
    }
  },

  backHome() {
    wx.navigateBack({ delta: 1 })
  },

  openRecord(event) {
    const id = event.currentTarget.dataset.id
    const record = this.data.records.find(item => item._id === id)
    if (!record || !Array.isArray(record.points) || record.points.length < 2) {
      wx.showToast({ title: '这条记录没有路线轨迹', icon: 'none' })
      return
    }
    getApp().globalData.walkRecord = record
    wx.navigateTo({ url: '/pages/walk-record/walk-record' })
  },

  clearRecords() {
    wx.showModal({
      title: '清空散步记录？',
      content: '清空后，云端的散步记录和累计距离、时长也会删除。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          if (this.data.cloudReady) await callWalkData({ action: 'clearRecords' })
          wx.removeStorageSync('walkRecords')
          this.setData({ records: [] }, () => this.refreshStats())
        } catch (error) {
          console.error('清空云端记录失败', error)
          wx.showToast({ title: '清空失败，请稍后再试', icon: 'none' })
        }
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
