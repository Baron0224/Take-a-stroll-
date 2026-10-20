const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const records = db.collection('walkRecords')
const profiles = db.collection('walkProfiles')

function safeProfile(profile) {
  return {
    nickname: String(profile.nickname || '').slice(0, 32),
    avatarFileID: String(profile.avatarFileID || '').slice(0, 512),
    updatedAt: db.serverDate()
  }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext()
  if (!openid) throw new Error('无法识别当前微信用户，请重新打开小程序')

  switch (event.action) {
    case 'getProfile': {
      const result = await profiles.where({ openid }).limit(1).get()
      return { profile: result.data[0] || null }
    }
    case 'saveProfile': {
      const data = safeProfile(event.profile || {})
      const result = await profiles.where({ openid }).limit(1).get()
      if (result.data.length) {
        await profiles.doc(result.data[0]._id).update({ data })
      } else {
        await profiles.add({ data: { ...data, openid, createdAt: db.serverDate() } })
      }
      return { ok: true }
    }
    case 'listRecords': {
      const result = await records.where({ openid }).orderBy('endedAt', 'desc').limit(100).get()
      return { records: result.data }
    }
    case 'saveRecord': {
      const record = event.record || {}
      const points = Array.isArray(record.points) ? record.points.slice(0, 1000) : []
      const data = {
        openid,
        title: String(record.title || '散步记录').slice(0, 40),
        distanceMeters: Math.max(0, Math.round(Number(record.distanceMeters) || 0)),
        durationSeconds: Math.max(0, Math.round(Number(record.durationSeconds) || 0)),
        points: points.map(point => ({
          latitude: Number(point.latitude),
          longitude: Number(point.longitude)
        })).filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
        demo: Boolean(record.demo),
        startedAt: Number(record.startedAt) || Date.now(),
        endedAt: Number(record.endedAt) || Date.now(),
        createdAt: db.serverDate()
      }
      const result = await records.add({ data })
      return { ok: true, id: result._id }
    }
    case 'clearRecords': {
      let removed = 0
      while (true) {
        const result = await records.where({ openid }).limit(100).get()
        if (!result.data.length) break
        await Promise.all(result.data.map(item => records.doc(item._id).remove()))
        removed += result.data.length
      }
      return { ok: true, removed }
    }
    default:
      throw new Error('不支持的云端操作')
  }
}
