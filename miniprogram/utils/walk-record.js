function saveWalkRecord(record) {
  const app = getApp()
  if (!wx.cloud || !app.globalData.cloudReady) {
    return Promise.reject(new Error('云端还没有连接，请先重新编译小程序并确认云开发环境。'))
  }
  return wx.cloud.callFunction({
    name: 'walkData',
    data: { action: 'saveRecord', record }
  }).then(response => {
    const result = response && response.result
    if (!result || !result.ok) throw new Error('云端没有确认保存，请稍后重试。')
    return result
  })
}

function openWalkRecords() {
  wx.navigateTo({ url: '/pages/profile/profile' })
}

module.exports = { saveWalkRecord, openWalkRecords }
