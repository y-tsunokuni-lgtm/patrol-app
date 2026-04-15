const KEYWORDS = [
  'カーセブン', 'かーせぶん', 'carseven',
  'カーセブンデジフィールド', 'カーセブン デジフィールド', 'carseven digifield'
]

const MAIL_TEMPLATE = `件名：【商標キーワード除外のお願い】カーセブン関連KWについて

{ADVERTISER} 御中

お世話になっております。
株式会社デジフィールド マーケティング部と申します。

貴社の{PLATFORM}広告において、弊社の登録商標「カーセブン（CarSeven）」を含むキーワードでの広告出稿を確認いたしました。

確認日時：{DATE}
確認媒体：{PLATFORM}
表示URL：{URL}

商標権保護の観点より、下記キーワードの除外設定をお願い申し上げます。

【除外依頼キーワード（フレーズ一致）】
・カーセブン
・かーせぶん
・carseven
・カーセブンデジフィールド
・カーセブン デジフィールド
・carseven digifield

ご対応のほど、よろしくお願いいたします。

株式会社デジフィールド
マーケティング部`

export { KEYWORDS, MAIL_TEMPLATE }

const GEMINI_MODEL = 'gemini-2.0-flash'

export async function analyzeScreenshot(base64Image, hints = {}) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません')

  const prompt = `これはGoogle広告またはYahoo!広告の検索結果スクリーンショットです。
カーセブン（CarSeven）の商標キーワードを使った競合他社のスポンサー広告が表示されているか確認してください。

以下のJSON形式のみで返してください（他のテキストは不要）:
{
  "has_ad": true または false,
  "advertisers": ["広告主名またはドメイン"],
  "display_urls": ["表示URL"],
  "detected_keywords": ["検出されたKW"],
  "ad_texts": ["広告テキスト冒頭（30文字程度）"],
  "risk_level": "高" または "中" または "低",
  "summary": "1〜2文の日本語サマリー"
}

${hints.advertiser ? `広告主ヒント：${hints.advertiser}` : ''}
${hints.url ? `URLヒント：${hints.url}` : ''}
${hints.platform ? `媒体：${hints.platform}` : ''}`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: 'image/png', data: base64Image } },
            { text: prompt }
          ]
        }]
      })
    }
  )

  if (!res.ok) throw new Error(`API Error: ${res.status}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

export async function generateMail(entry) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `以下の情報をもとに商標KW除外依頼メールを作成してください。メール本文のみ返してください。

テンプレート：
${MAIL_TEMPLATE}

情報：
- 広告主：${entry.advertiser}
- 媒体：${entry.platform}
- 表示URL：${entry.display_url}
- 検知日時：${entry.date}
- 検知KW：${entry.detected_keywords?.join('、') || entry.kw}`
          }]
        }]
      })
    }
  )

  if (!res.ok) throw new Error(`API Error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

export async function saveToGAS(entry) {
  const endpoint = import.meta.env.VITE_GAS_ENDPOINT
  if (!endpoint) return { ok: false, reason: 'GAS未設定' }

  const payload = {
    date: entry.date,
    platform: entry.platform,
    kw: entry.kw,
    advertiser: entry.advertiser,
    display_url: entry.display_url,
    risk: entry.risk,
    summary: entry.summary,
    status: entry.status
  }

  try {
    await fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addLog', data: payload })
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

export async function sendSlack(entry, mailText = '') {
  const webhook = import.meta.env.VITE_SLACK_WEBHOOK
  if (!webhook) return { ok: false, reason: 'Webhook未設定' }

  const risk = entry.risk === '高' ? ':red_circle:' : entry.risk === '中' ? ':large_yellow_circle:' : ':large_green_circle:'
  let text = `${risk} *商標侵害広告を検知しました*\n`
  text += `• 媒体：${entry.platform}\n`
  text += `• 検知KW：${entry.kw}\n`
  text += `• 広告主：${entry.advertiser}\n`
  text += `• 表示URL：${entry.display_url}\n`
  text += `• 検知日時：${entry.date}\n`
  text += `• リスク：${entry.risk}\n`
  if (entry.summary) text += `• 概要：${entry.summary}\n`
  if (mailText) text += `\n*除外依頼メール（下書き）*\n\`\`\`${mailText}\`\`\``

  try {
    await fetch(webhook, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}
