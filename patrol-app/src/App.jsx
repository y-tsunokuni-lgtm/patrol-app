import React, { useState, useRef } from 'react'
import { KEYWORDS, analyzeScreenshot, generateMail, saveToGAS, sendSlack } from './lib/api.js'

const PLATFORMS = ['Google', 'Yahoo!', 'Google + Yahoo!']
const STATUS_LABELS = { new: '新規', reviewing: '対応中', sent: '送信済' }
const RISK_COLORS = { 高: '#dc2626', 中: '#d97706', 低: '#16a34a' }

function useLocalLogs() {
  const [logs, setLogs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('patrol_logs') || '[]') } catch { return [] }
  })
  const save = (next) => {
    setLogs(next)
    localStorage.setItem('patrol_logs', JSON.stringify(next))
  }
  return [logs, save]
}

export default function App() {
  const [tab, setTab] = useState('patrol')
  const [logs, setLogs] = useLocalLogs()
  const [images, setImages] = useState([])
  const [advertiser, setAdvertiser] = useState('')
  const [url, setUrl] = useState('')
  const [platform, setPlatform] = useState('Google')
  const [kw, setKw] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [modal, setModal] = useState(null)
  const fileRef = useRef()

  const handleFiles = (files) => {
    Array.from(files).forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setImages(prev => [...prev, { name: f.name, data: e.target.result }])
      reader.readAsDataURL(f)
    })
  }

  const handleAnalyze = async () => {
    if (images.length === 0 && !url) { setStatus('スクショまたはURLを入力してください'); return }
    setLoading(true); setStatus('AIで解析中...')
    try {
      let result = { has_ad: true, advertisers: [advertiser || '不明'], display_urls: [url || '不明'], detected_keywords: [kw || 'カーセブン'], ad_texts: [], risk_level: '中', summary: '' }

      if (images.length > 0) {
        const base64 = images[0].data.split(',')[1]
        result = await analyzeScreenshot(base64, { advertiser, url, platform })
      }

      const entry = {
        id: Date.now(),
        date: new Date().toLocaleString('ja-JP'),
        platform,
        kw: result.detected_keywords?.[0] || kw || 'カーセブン',
        advertiser: result.advertisers?.[0] || advertiser || '不明',
        display_url: result.display_urls?.[0] || url || '不明',
        ad_text: result.ad_texts?.[0] || '',
        risk: result.risk_level || '中',
        has_ad: result.has_ad,
        summary: result.summary || '',
        images: images.map(i => i.data),
        status: 'new',
        mail: ''
      }

      setStatus(result.has_ad ? `検知しました：${entry.advertiser}` : '広告なし — 記録しました')

      if (result.has_ad) {
        setStatus('メール文を生成中...')
        const mailText = await generateMail(entry)
        entry.mail = mailText

        await saveToGAS(entry)
        await sendSlack(entry, mailText)

        setModal({ type: 'mail', text: mailText, entry })
      }

      setLogs([entry, ...logs])
      setImages([]); setAdvertiser(''); setUrl(''); setKw('')
    } catch (e) {
      setStatus('エラー：' + e.message)
    }
    setLoading(false)
  }

  const updateStatus = (id, next) => {
    setLogs(logs.map(l => l.id === id ? { ...l, status: next } : l))
  }

  const exportCSV = () => {
    const rows = [['日時', '媒体', '検知KW', '広告主', '表示URL', 'リスク', '状態']]
    logs.forEach(l => rows.push([l.date, l.platform, l.kw, l.advertiser, l.display_url, l.risk, STATUS_LABELS[l.status]]))
    const csv = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `patrol_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f0' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e5e0', padding: '0 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, height: 52 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 0 2px #bbf7d0', animation: 'pulse 2s infinite' }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>商標侵害広告パトロール</span>
          <span style={{ color: '#888', fontSize: 12 }}>カーセブン / Car Seven</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {['patrol', 'log', 'keywords'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: tab === t ? '#1a1a1a' : 'transparent', color: tab === t ? '#fff' : '#555', fontSize: 13, fontWeight: tab === t ? 500 : 400 }}>
                {t === 'patrol' ? 'パトロール' : t === 'log' ? `ログ (${logs.length})` : '監視KW'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>

        {/* パトロールタブ */}
        {tab === 'patrol' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <Card title="スクリーンショットをアップロード">
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
                style={{ border: '1.5px dashed #ccc', borderRadius: 8, padding: '28px 16px', textAlign: 'center', cursor: 'pointer', background: '#fafafa', color: '#888', fontSize: 13 }}
              >
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                <div style={{ fontSize: 28, marginBottom: 6 }}>↑</div>
                クリックまたはドラッグ＆ドロップでスクショを追加
              </div>
              {images.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {images.map((img, i) => (
                    <div key={i} style={{ position: 'relative', width: 72, height: 48, borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e5e0' }}>
                      <img src={img.data} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button onClick={() => setImages(images.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="検知情報を入力">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={labelStyle}>
                  媒体
                  <select value={platform} onChange={e => setPlatform(e.target.value)} style={inputStyle}>
                    {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  検知KW（例：カーセブン）
                  <input value={kw} onChange={e => setKw(e.target.value)} placeholder="カーセブン" style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  広告主名（わかれば）
                  <input value={advertiser} onChange={e => setAdvertiser(e.target.value)} placeholder="例：競合他社株式会社" style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  表示URL
                  <input value={url} onChange={e => setUrl(e.target.value)} placeholder="例：example.com" style={inputStyle} />
                </label>
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={handleAnalyze} disabled={loading} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff', opacity: loading ? 0.6 : 1 }}>
                  {loading ? '解析中...' : 'AIで解析して登録'}
                </button>
                {status && <span style={{ fontSize: 12, color: status.startsWith('エラー') ? '#dc2626' : '#16a34a' }}>{status}</span>}
              </div>
            </Card>
          </div>
        )}

        {/* ログタブ */}
        {tab === 'log' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: '#555' }}>全 {logs.length} 件</span>
              <button onClick={exportCSV} style={{ ...btnStyle, fontSize: 12 }}>CSV出力</button>
            </div>
            {logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#aaa', fontSize: 13 }}>まだ検知記録がありません</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {logs.map(l => (
                  <div key={l.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e5e0', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      {l.images?.[0] && <img src={l.images[0]} style={{ width: 80, height: 52, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e5e0', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>{l.advertiser}</span>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: '#f0f0ec', color: '#555' }}>{l.platform}</span>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: RISK_COLORS[l.risk] + '18', color: RISK_COLORS[l.risk], fontWeight: 500 }}>{l.risk}</span>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: l.status === 'sent' ? '#dcfce7' : l.status === 'reviewing' ? '#fef9c3' : '#fee2e2', color: l.status === 'sent' ? '#16a34a' : l.status === 'reviewing' ? '#a16207' : '#dc2626' }}>{STATUS_LABELS[l.status]}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#666' }}>{l.display_url}　<span style={{ color: '#999' }}>KW: {l.kw}</span></div>
                        {l.summary && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{l.summary}</div>}
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{l.date}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {l.mail && <button onClick={() => setModal({ type: 'mail', text: l.mail, entry: l })} style={{ ...btnStyle, fontSize: 11, padding: '4px 10px' }}>メール</button>}
                        <select value={l.status} onChange={e => updateStatus(l.id, e.target.value)} style={{ ...inputStyle, width: 'auto', height: 30, padding: '0 8px', fontSize: 11 }}>
                          <option value="new">新規</option>
                          <option value="reviewing">対応中</option>
                          <option value="sent">送信済</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 監視KWタブ */}
        {tab === 'keywords' && (
          <Card title="監視キーワード一覧（フレーズ一致）">
            <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Google広告・Yahoo!広告 検索広告 全キャンペーン対象</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {KEYWORDS.map(k => (
                <span key={k} style={{ background: '#f0f0ec', border: '1px solid #e0e0d8', borderRadius: 20, padding: '5px 14px', fontSize: 13 }}>{k}</span>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* メールモーダル */}
      {modal?.type === 'mail' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 540, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>除外依頼メール</div>
            <textarea defaultValue={modal.text} style={{ ...inputStyle, minHeight: 260, resize: 'vertical', flex: 1, fontSize: 12, lineHeight: 1.7 }} id="mail-ta" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btnStyle}>閉じる</button>
              <button onClick={() => { navigator.clipboard.writeText(document.getElementById('mail-ta').value); alert('コピーしました') }} style={{ ...btnStyle, background: '#f0f0ec' }}>コピー</button>
              <button onClick={() => setModal(null)} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>完了</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e5e0', padding: '16px 18px' }}>
      {title && <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  )
}

const inputStyle = { display: 'block', width: '100%', height: 36, padding: '0 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, background: '#fafafa', marginTop: 4 }
const labelStyle = { fontSize: 12, color: '#555', display: 'block' }
const btnStyle = { height: 34, padding: '0 14px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', fontSize: 13, fontWeight: 400 }
